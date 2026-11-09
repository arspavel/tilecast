(function () {
  "use strict";

  var VERSION = "0.5.1";
  var VERSION_CODE = 13;
  var STORE = "tilecast.webos.";
  // Media is kept in memory between playlist cycles so a loop does not
  // download every item again. Items on screen are never evicted.
  var MEDIA_CACHE_BYTES = 384 * 1024 * 1024;
  // Downloads live in browser memory, which LG signage firmware caps far
  // below the panel's flash. Videos above this size play straight from the
  // server instead of evicting everything else or failing outright.
  var STREAM_VIDEO_BYTES = 96 * 1024 * 1024;
  var STREAM_URL_REFRESH_MS = 60 * 60 * 1000;
  var VIDEO_STALL_MS = 20000;
  var READY_TIMEOUT_MS = 30000;
  var RELOAD_AFTER_UNHEALTHY_MS = 5 * 60 * 1000;
  var stage = document.getElementById("stage");
  var state = {
    serverUrl: localStorage.getItem(STORE + "serverUrl") || defaultServerUrl(),
    installationId: localStorage.getItem(STORE + "installationId") || "",
    credential: readJson("credential"),
    manifest: readJson("manifest"),
    playbackDefaults: readJson("playbackDefaults") || {},
    currentPlaylist: null,
    currentItem: null,
    itemIndex: -1,
    itemTimer: null,
    readyTimer: null,
    stallTimer: null,
    syncTimer: null,
    heartbeatTimer: null,
    scheduleTimer: null,
    pairingTimer: null,
    renderToken: 0,
    consecutiveFailures: 0,
    playbackState: "starting",
    mode: "starting",
    messageTitle: null,
    messageText: null,
    lastError: null,
    lastHealthyPlaybackAt: null,
    lastConfigSyncAt: 0,
    lastServerContactAt: 0,
    lastDownloadBps: null,
    downloads: {},
    startedAt: Date.now()
  };
  var media = { entries: {}, bytes: 0, clock: 0 };

  function defaultServerUrl() {
    // When the panel opens the player from the Tilecast server itself
    // ("Play via URL"), that server is the obvious default.
    var origin = window.location && window.location.origin;
    return /^https?:\/\//i.test(origin || "") ? origin : "";
  }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(STORE + key) || "null"); }
    catch (_) { return null; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(STORE + key, JSON.stringify(value)); }
    catch (_) { /* A full quota must not stop playback. */ }
  }

  function uuid() {
    if (window.crypto && window.crypto.getRandomValues) {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      return Array.prototype.map.call(bytes, function (b, i) {
        return (i === 4 || i === 6 || i === 8 || i === 10 ? "-" : "") + (b + 256).toString(16).slice(1);
      }).join("");
    }
    return "webos-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function normalizedUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function request(method, path, body, extraHeaders, expectBlob) {
    var headers = extraHeaders || {};
    var raw = body instanceof Blob || body instanceof FormData;
    if (body != null && !raw) headers["Content-Type"] = "application/json";
    if (state.credential && state.credential.deviceCredential && !headers.Authorization) {
      headers.Authorization = "Bearer " + state.credential.deviceCredential;
    }
    return fetch(state.serverUrl + path, {
      method: method,
      headers: headers,
      cache: "no-store",
      body: body == null ? null : raw ? body : JSON.stringify(body)
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          var message = method + " " + path + ": HTTP " + response.status;
          var code = "";
          try {
            var parsed = JSON.parse(text).error;
            message = parsed.message || message;
            code = parsed.code || "";
          } catch (_) {}
          var error = new Error(message);
          error.status = response.status;
          error.code = code;
          throw error;
        });
      }
      state.lastServerContactAt = Date.now();
      if (expectBlob) return response.blob();
      if (response.status === 204) return null;
      return response.text().then(function (text) {
        var json = text ? JSON.parse(text) : {};
        return json.data == null ? json : json.data;
      });
    });
  }

  // Only an explicit credential rejection clears pairing. A disabled screen,
  // a proxy error, or an outage must never force the panel to pair again.
  function credentialRejected(error) {
    return !!error && error.status === 401 &&
      (error.code === "device_credential_invalid" || error.code === "device_credential_revoked");
  }

  function handleDeviceError(error) {
    if (credentialRejected(error)) {
      resetEnrollment();
      beginPairing();
      return true;
    }
    if (error && error.status === 403 && error.code === "screen_disabled") {
      if (state.mode !== "disabled") {
        state.currentPlaylist = null;
        state.playbackState = "disabled";
        showMessage("Экран отключён", "Экран отключён в LSR signage. Показ продолжится после включения.");
        state.mode = "disabled";
      }
      return true;
    }
    return false;
  }

  function showSetup(message) {
    clearPlayback();
    state.mode = "setup";
    stage.innerHTML = '<div class="center"><section class="panel">' +
      '<div class="brand">LSR signage webOS</div><h1>Подключение к серверу</h1>' +
      '<p>Введите публичный адрес LSR signage, доступный с телевизора.</p>' +
      '<form class="server-form" id="server-form"><input id="server-url" type="url" inputmode="url" placeholder="https://tilecast.example.com" value="' + escapeHtml(state.serverUrl) + '"><button type="submit">Подключить</button></form>' +
      (message ? '<p class="error">' + escapeHtml(message) + '</p>' : '') +
      '</section></div>';
    var form = document.getElementById("server-form");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var next = normalizedUrl(document.getElementById("server-url").value);
      if (!/^https?:\/\//i.test(next)) return showSetup("Адрес должен начинаться с http:// или https://");
      if (state.serverUrl && state.serverUrl !== next) resetEnrollment();
      state.serverUrl = next;
      localStorage.setItem(STORE + "serverUrl", next);
      start();
    });
    document.getElementById("server-url").focus();
  }

  function showPairing(session) {
    clearPlayback();
    state.mode = "pairing";
    stage.innerHTML = '<div class="center"><section class="panel">' +
      '<div class="brand">LSR signage webOS</div><h1>Привязка экрана</h1>' +
      '<p>Откройте адрес в браузере и подтвердите телевизор:</p>' +
      '<p class="url">' + escapeHtml(session.approvalUrl) + '</p>' +
      '<div class="code">' + escapeHtml(session.code) + '</div>' +
      '<p>Код обновится автоматически, если истечёт срок действия.</p>' +
      '</section></div>';
  }

  function showMessage(title, message) {
    clearPlayback();
    state.messageTitle = title;
    state.messageText = message;
    stage.innerHTML = '<div class="center"><section class="panel"><div class="brand">LSR signage webOS</div><h1>' +
      escapeHtml(title) + '</h1><p>' + escapeHtml(message) + '</p></section></div>';
  }

  function metadata() {
    var platform = window.webOSSystem ? "LG webOS TV" : navigator.platform;
    return {
      playerInstallationId: state.installationId,
      platform: "webos",
      manufacturer: "LG",
      model: String(platform || "webOS TV").slice(0, 120),
      androidVersion: String(navigator.userAgent || "webOS").slice(0, 120),
      playerVersion: VERSION,
      screenWidth: Math.max(1, window.screen.width || window.innerWidth || 1920),
      screenHeight: Math.max(1, window.screen.height || window.innerHeight || 1080),
      density: window.devicePixelRatio || 1,
      locale: String(navigator.language || "ru-RU").slice(0, 120),
      timezone: resolvedTimezone()
    };
  }

  function resolvedTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
    catch (_) { return "UTC"; }
  }

  function beginPairing() {
    stopPairedLoops();
    showMessage("Подключение", "Создаём код привязки…");
    state.mode = "pairing";
    return request("GET", "/api/v1/system/identity", null, {}, false).then(function (identity) {
      if (!identity.pairingEnabled) throw new Error("На сервере отключена привязка новых экранов.");
      return request("POST", "/api/v1/player/pairing-sessions", {
        installationId: identity.installationId,
        metadata: metadata()
      }, {}, false).then(function (session) {
        session.serverInstallationId = identity.installationId;
        showPairing(session);
        pollPairing(session);
      });
    }).catch(function (error) {
      showSetup(error.message);
    });
  }

  function pollPairing(session) {
    clearTimeout(state.pairingTimer);
    var wait = Math.max(2, session.pollingIntervalSeconds || 3) * 1000;
    if (Date.parse(session.expiresAt) <= Date.now()) return beginPairing();
    request("GET", "/api/v1/player/pairing-sessions/" + encodeURIComponent(session.id), null, {
      Authorization: "Pairing " + session.pollSecret
    }, false).then(function (result) {
      if (result.status === "claimed" && result.enrollmentToken) {
        return request("POST", "/api/v1/player/enroll", {
          pairingSessionId: session.id,
          enrollmentToken: result.enrollmentToken
        }, {}, false).then(function (enrolled) {
          state.credential = {
            serverUrl: state.serverUrl,
            installationId: session.serverInstallationId,
            screenId: enrolled.screenId,
            screenName: enrolled.screenName,
            deviceCredential: enrolled.deviceCredential,
            enrolledAt: new Date().toISOString()
          };
          writeJson("credential", state.credential);
          runPaired();
        });
      }
      if (result.status === "rejected" || result.status === "expired") return beginPairing();
      state.pairingTimer = setTimeout(function () { pollPairing(session); }, wait);
    }).catch(function (error) {
      if (error.status === 404 || error.status === 410) return beginPairing();
      state.pairingTimer = setTimeout(function () { pollPairing(session); }, wait);
    });
  }

  function stopPairedLoops() {
    clearInterval(state.syncTimer);
    clearInterval(state.heartbeatTimer);
    clearInterval(state.scheduleTimer);
    clearInterval(commands.timer);
  }

  function runPaired() {
    state.mode = "playback";
    if (state.manifest) activateManifest(state.manifest);
    else showMessage("Синхронизация", "Получаем расписание и контент…");
    syncManifest();
    sendHeartbeat();
    stopPairedLoops();
    state.syncTimer = setInterval(syncManifest, 30000);
    state.heartbeatTimer = setInterval(sendHeartbeat, 15000);
    state.scheduleTimer = setInterval(evaluateManifest, 30000);
    startPreviewLoop();
    startLiveStreamLoop();
    startCommandLoop();
  }

  function syncConfig() {
    if (Date.now() - state.lastConfigSyncAt < 5 * 60 * 1000) return;
    state.lastConfigSyncAt = Date.now();
    request("GET", "/api/v1/player/config", null, {}, false).then(function (config) {
      if (config && config.configRevision != null) state.configRevision = config.configRevision;
      if (config && config.playback) {
        state.playbackDefaults = config.playback;
        writeJson("playbackDefaults", config.playback);
      }
    }).catch(function () { state.lastConfigSyncAt = 0; });
  }

  function syncManifest() {
    if (!state.credential) return;
    syncConfig();
    request("GET", "/api/v1/player/manifest", null, {}, false).then(function (manifest) {
      if (state.mode === "disabled") state.mode = "playback";
      // Positive when this TV's clock runs ahead of the server's.
      if (manifest && manifest.serverTime) {
        var serverNow = Date.parse(manifest.serverTime);
        if (isFinite(serverNow)) state.clockOffsetSeconds = Math.round((Date.now() - serverNow) / 1000);
      }
      state.manifest = manifest;
      writeJson("manifest", manifest);
      state.lastError = null;
      pruneMedia(manifest);
      syncDisk(manifest);
      activateManifest(manifest);
    }).catch(function (error) {
      state.lastError = error.message;
      if (handleDeviceError(error)) return;
      // Keep playing the cached manifest through an outage.
      if (!state.manifest) showMessage("Нет связи с сервером", error.message);
    });
  }

  function activateManifest(manifest) {
    if (state.mode === "disabled") return;
    var selected = selectPlaylist(manifest, new Date());
    if (!selected) {
      if (state.currentPlaylist || state.playbackState !== "idle") {
        state.currentPlaylist = null;
        showMessage("Нет контента", "Для экрана не назначено активное расписание или плейлист.");
        state.playbackState = "idle";
      }
      return;
    }
    if (!state.currentPlaylist || state.currentPlaylist.id !== selected.id || state.currentPlaylist.revision !== selected.revision) {
      state.currentPlaylist = selected;
      state.itemIndex = -1;
      state.consecutiveFailures = 0;
      playNext();
    }
  }

  function evaluateManifest() {
    if (state.manifest) activateManifest(state.manifest);
  }

  function selectPlaylist(manifest, now) {
    var byId = {};
    (manifest.playlists || []).forEach(function (p) { byId[p.id] = p; });
    if (manifest.playlist) byId[manifest.playlist.id] = manifest.playlist;
    if (manifest.directFallbackPlaylist) byId[manifest.directFallbackPlaylist.id] = manifest.directFallbackPlaylist;
    var takeover = manifest.takeover || manifest.emergency;
    if (takeover && inWindow(now, takeover.activatedAt, takeover.expiresAt) && byId[takeover.playlistId]) { state.selectionSource = "takeover"; return byId[takeover.playlistId]; }
    var override = manifest.presentationOverride;
    if (override && override.playlistId && inWindow(now, override.startedAt, override.expiresAt) && byId[override.playlistId]) { state.selectionSource = "quick_present"; return byId[override.playlistId]; }
    var active = (manifest.schedules || []).filter(function (s) { return s.playlistId && scheduleApplies(s, now); });
    active.sort(function (a, b) { return (b.priority || 0) - (a.priority || 0) || (b.specificity || 0) - (a.specificity || 0); });
    if (active.length && byId[active[0].playlistId]) { state.selectionSource = "schedule"; state.currentScheduleId = active[0].id || null; return byId[active[0].playlistId]; }
    state.currentScheduleId = null;
    var fallback = manifest.playlist || manifest.directFallbackPlaylist || null;
    // The server accepts only these sources; "webos" was rejected on every heartbeat.
    state.selectionSource = fallback ? "direct_fallback" : "none";
    return fallback;
  }

  function inWindow(now, start, end) {
    var n = now.getTime(), s = start ? Date.parse(start) : -Infinity, e = end ? Date.parse(end) : Infinity;
    return n >= s && n < e;
  }

  function scheduleApplies(s, now) {
    if (s.type === "one_time") return inWindow(now, s.oneTimeStart, s.oneTimeEnd);
    var parts = zonedParts(now, s.timezone || "UTC");
    if (!parts) return false;
    var date = parts.date;
    if ((s.startDate && date < s.startDate) || (s.endDate && date > s.endDate)) return false;
    var isoDay = parts.weekday === 0 ? 7 : parts.weekday;
    var days = s.daysOfWeek || [];
    var minute = parts.hour * 60 + parts.minute;
    var start = clockMinutes(s.dailyStart), end = clockMinutes(s.dailyEnd);
    if (start == null || end == null) return false;
    if (end > start) return hasDay(days, isoDay) && minute >= start && minute < end;
    if (minute >= start) return hasDay(days, isoDay);
    var previous = isoDay === 1 ? 7 : isoDay - 1;
    return minute < end && hasDay(days, previous);
  }

  // Studio and the server number Sunday 0 (JavaScript and Go weekdays); the
  // ISO numbering used above calls it 7. Accept both so Sunday windows apply.
  function hasDay(days, isoDay) {
    return days.indexOf(isoDay) >= 0 || (isoDay === 7 && days.indexOf(0) >= 0);
  }

  // Building an Intl formatter is slow on TV hardware; the next-change search
  // evaluates schedules thousands of times, so formatters are reused.
  var zoneFormatters = {};

  function zonedParts(date, timezone) {
    try {
      var formatter = zoneFormatters[timezone] || (zoneFormatters[timezone] = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }));
      var parts = formatter.formatToParts(date), out = {};
      parts.forEach(function (p) { out[p.type] = p.value; });
      var dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return { date: out.year + "-" + out.month + "-" + out.day, hour: Number(out.hour) % 24, minute: Number(out.minute), weekday: dayMap[out.weekday] };
    } catch (_) { return null; }
  }

  function clockMinutes(value) {
    var match = /^(\d{1,2}):(\d{2})/.exec(value || "");
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  // ---- Item settings -------------------------------------------------------

  function itemDuration(item) {
    var defaults = state.playbackDefaults || {};
    var explicit = Number(item.durationMs);
    if (!item.usePlayerDefaults && isFinite(explicit) && explicit > 0) return Math.max(1000, explicit);
    if (item.assetType === "website" || item.assetType === "widget") return 30000;
    return Math.max(1, Number(defaults.defaultImageDurationSeconds) || 10) * 1000;
  }

  // The server stores volume as 0..1; older data and defaults may use 0..100.
  function itemVolume(item) {
    var defaults = state.playbackDefaults || {};
    var value = Number(item.usePlayerDefaults ? defaults.defaultVolume : item.volume);
    if (!isFinite(value)) value = 1;
    if (value > 1) value = value / 100;
    return Math.max(0, Math.min(1, value));
  }

  function itemAudio(item) {
    var defaults = state.playbackDefaults || {};
    return item.usePlayerDefaults ? defaults.defaultAudioEnabled !== false : item.audioEnabled !== false;
  }

  function itemFit(item) {
    return item.fitMode || (state.playbackDefaults || {}).defaultFitMode || "contain";
  }

  // ---- Media cache -------------------------------------------------------

  function mediaKey(asset) {
    return asset.assetId + ":" + (asset.variantId || "");
  }

  // The panel's own storage is checked first, so a file kept there plays
  // without the network even right after a reboot.
  function loadMedia(asset) {
    return diskWhenReady().then(function () {
      var name = diskName(asset);
      if (diskPlayable(name)) {
        var cached = media.entries[mediaKey(asset)];
        if (cached && cached.url && cached.pins === 0) dropMedia(cached);
        return disk.base + name;
      }
      return loadMediaInMemory(asset);
    });
  }

  function loadMediaInMemory(asset) {
    var key = mediaKey(asset);
    var entry = media.entries[key];
    if (entry && entry.streamed && entry.expiresAt && entry.expiresAt - Date.now() < STREAM_URL_REFRESH_MS && entry.pins === 0) {
      delete media.entries[key];
      entry = null;
    }
    if (entry) {
      entry.used = ++media.clock;
      return entry.promise;
    }
    entry = { key: key, url: null, size: 0, used: ++media.clock, pins: 0 };
    if (shouldStream(asset)) {
      entry.streamed = true;
      entry.promise = request("POST", asset.downloadPath + "/stream-url", {}).then(function (link) {
        entry.url = state.serverUrl + link.path;
        entry.expiresAt = Date.parse(link.expiresAt) || Date.now() + STREAM_URL_REFRESH_MS * 2;
        return entry.url;
      }, function (error) {
        delete media.entries[key];
        // A server without streaming support still serves the whole file.
        if (error.status === 404 || error.status === 405) {
          state.streamUnsupported = true;
          return loadMediaInMemory(asset);
        }
        throw error;
      });
      media.entries[key] = entry;
      return entry.promise;
    }
    entry.promise = downloadWithRetry(asset, 3).then(function (blob) {
      entry.url = URL.createObjectURL(blob);
      entry.size = blob.size || 0;
      media.bytes += entry.size;
      evictMedia();
      return entry.url;
    }, function (error) {
      delete media.entries[key];
      throw error;
    });
    media.entries[key] = entry;
    return entry.promise;
  }

  function shouldStream(asset) {
    return !state.streamUnsupported &&
      (asset.mimeType || "").indexOf("video/") === 0 &&
      Number(asset.fileSize) > STREAM_VIDEO_BYTES &&
      /^\/api\/v1\/player\/assets\//.test(asset.downloadPath || "");
  }

  function downloadWithRetry(asset, attempts) {
    return downloadAsset(asset).catch(function (error) {
      if (attempts <= 1 || credentialRejected(error) || error.status === 404) throw error;
      return delay(2000).then(function () { return downloadWithRetry(asset, attempts - 1); });
    });
  }

  function downloadAsset(asset) {
    var path = asset.downloadPath;
    var url = /^https?:\/\//i.test(path) ? path : state.serverUrl + path;
    return fetch(url, { headers: { Authorization: "Bearer " + state.credential.deviceCredential }, cache: "no-store" }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          var error = new Error("Media download failed: HTTP " + response.status);
          error.status = response.status;
          try { error.code = JSON.parse(text).error.code || ""; } catch (_) {}
          throw error;
        });
      }
      state.lastServerContactAt = Date.now();
      return readWithProgress(response, asset);
    });
  }

  // Streams the body so the service overlay can show progress and speed.
  function readWithProgress(response, asset) {
    var transfer = {
      key: mediaKey(asset),
      total: Number(response.headers.get("Content-Length")) || Number(asset.fileSize) || 0,
      loaded: 0,
      startedAt: Date.now()
    };
    state.downloads[transfer.key] = transfer;
    var finish = function (blob) {
      var elapsed = Date.now() - transfer.startedAt;
      if (elapsed > 300 && blob.size > 64 * 1024) state.lastDownloadBps = Math.round(blob.size * 1000 / elapsed);
      delete state.downloads[transfer.key];
      return blob;
    };
    var fail = function (error) { delete state.downloads[transfer.key]; throw error; };
    if (!response.body || !response.body.getReader) return response.blob().then(finish, fail);
    var reader = response.body.getReader();
    var chunks = [];
    var pump = function () {
      return reader.read().then(function (result) {
        if (result.done) return finish(new Blob(chunks, { type: response.headers.get("Content-Type") || asset.mimeType || "" }));
        chunks.push(result.value);
        transfer.loaded += result.value.byteLength;
        return pump();
      });
    };
    return pump().catch(fail);
  }

  function pinMedia(key, change) {
    var entry = media.entries[key];
    if (entry) entry.pins = Math.max(0, entry.pins + change);
  }

  function evictMedia() {
    if (media.bytes <= MEDIA_CACHE_BYTES) return;
    var candidates = Object.keys(media.entries).map(function (k) { return media.entries[k]; })
      .filter(function (e) { return e.url && e.pins === 0; })
      .sort(function (a, b) { return a.used - b.used; });
    for (var i = 0; i < candidates.length && media.bytes > MEDIA_CACHE_BYTES; i++) dropMedia(candidates[i]);
  }

  function dropMedia(entry) {
    if (entry.url && !entry.streamed) URL.revokeObjectURL(entry.url);
    media.bytes -= entry.size;
    delete media.entries[entry.key];
  }

  function pruneMedia(manifest) {
    var keep = {};
    (manifest.assets || []).forEach(function (a) { keep[mediaKey(a)] = true; });
    Object.keys(media.entries).forEach(function (k) {
      var entry = media.entries[k];
      if (!keep[k] && entry.url && entry.pins === 0) dropMedia(entry);
    });
  }

  // ---- Panel storage (LG Signage) ------------------------------------------
  // Browser memory on LG signage firmware holds a few hundred megabytes while
  // the panel has gigabytes of flash. Signage panels reach that flash through
  // the SCAP storage service: the service downloads a file into
  // file://internal/ itself and the panel's local web server plays it back,
  // so content survives reboots and network outages. A TV without the service
  // keeps the memory cache and streaming.

  var STORAGE_SERVICE = "luna://com.webos.service.commercial.signage.storageservice/";
  var DISK_ROOT = "file://internal/";
  var DISK_PREFIX = "tc-";
  // Left free for the firmware and the panel's own logs.
  var DISK_RESERVE_BYTES = 512 * 1024 * 1024;
  var DISK_COPY_TIMEOUT_MS = 4 * 60 * 60 * 1000;
  var DISK_PLAYBACK_BASES = ["http://127.0.0.1:9080/"];
  var disk = {
    state: "unknown", base: null, playback: "unknown", files: {}, usedBytes: 0,
    freeBytes: 0, totalBytes: 0, queue: [], queued: {}, busy: null, error: null, ready: null
  };

  function diskName(asset) {
    return DISK_PREFIX + asset.assetId + "-" + (asset.variantId || "original") + diskExtension(asset.mimeType);
  }

  // The panel's web server picks the content type from the extension.
  function diskExtension(mime) {
    var known = {
      "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/x-matroska": ".mkv",
      "video/mp2t": ".ts", "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"
    };
    return known[(mime || "").toLowerCase()] || ".bin";
  }

  function diskStorable(asset) {
    var mime = asset.mimeType || "";
    return (mime.indexOf("video/") === 0 || mime.indexOf("image/") === 0) &&
      /^\/api\/v1\/player\/assets\//.test(asset.downloadPath || "");
  }

  function diskPlayable(name) {
    return disk.state === "ready" && !!disk.base && disk.files[name] != null;
  }

  function diskCall(method, params, timeoutMs) {
    return lunaCall(STORAGE_SERVICE + method, params, timeoutMs || 15000);
  }

  // Waits for the first storage check, but never holds playback for long.
  function diskWhenReady() {
    if (!disk.ready) return Promise.resolve();
    return Promise.race([disk.ready, delay(20000)]);
  }

  function initDisk() {
    disk.state = "checking";
    var completed = readJson("diskFiles") || {};
    disk.ready = refreshDiskSpace().then(function () {
      return diskCall("fs/listFiles", { pathURI: DISK_ROOT });
    }).then(function (result) {
      var leftovers = [];
      disk.files = {};
      (result.files || []).forEach(function (file) {
        if (file.type === "folder" || String(file.name).indexOf(DISK_PREFIX) !== 0) return;
        // Only files recorded after a finished download count; anything else
        // is a copy cut short by a power loss.
        if (completed[file.name] != null && Number(completed[file.name]) === Number(file.size)) disk.files[file.name] = Number(file.size);
        else leftovers.push(file.name);
      });
      saveDiskIndex();
      leftovers.forEach(removeDiskFile);
      disk.state = "ready";
      var any = Object.keys(disk.files)[0];
      return any ? probeDiskPlayback(any) : null;
    }).catch(function (error) {
      disk.state = "unavailable";
      disk.error = error.message;
    });
    return disk.ready;
  }

  function refreshDiskSpace() {
    return diskCall("fs/storageInfo", {}, 8000).then(function (result) {
      var info = result.spaceInfo || {};
      var total = Number(info.totalSize) || 0;
      // SCAP reports kilobytes; a panel never has less than a gigabyte.
      var scale = total > 0 && total < 1e9 ? 1024 : 1;
      disk.totalBytes = total * scale;
      disk.freeBytes = (Number(info.freeSize) || 0) * scale;
    });
  }

  function saveDiskIndex() {
    disk.usedBytes = 0;
    Object.keys(disk.files).forEach(function (name) { disk.usedBytes += disk.files[name]; });
    writeJson("diskFiles", disk.files);
  }

  function removeDiskFile(name) {
    delete disk.files[name];
    saveDiskIndex();
    return diskCall("fs/removeFile", { file: DISK_ROOT + name }).catch(function () { /* Already gone. */ });
  }

  // The address the panel serves internal storage on is checked once with a
  // real file; without it the stored files cannot be shown and the player
  // keeps memory and streaming instead.
  function probeDiskPlayback(name) {
    if (disk.base) return Promise.resolve(disk.base);
    var bases = DISK_PLAYBACK_BASES.slice();
    var next = function () {
      if (!bases.length) {
        disk.playback = "failed";
        disk.error = "Панель не отдаёт файлы с накопителя";
        return null;
      }
      var base = bases.shift();
      return probeUrl(base + name, name).then(function () {
        disk.base = base;
        disk.playback = "ok";
        disk.error = null;
        return base;
      }, next);
    };
    return next();
  }

  function probeUrl(url, name) {
    return new Promise(function (resolve, reject) {
      var isVideo = /\.(mp4|webm|mov|mkv|ts)$/.test(name);
      var element = isVideo ? document.createElement("video") : new Image();
      var timer = setTimeout(function () { done(false); }, 10000);
      function done(ok) {
        clearTimeout(timer);
        element.onloadedmetadata = element.onload = element.onerror = null;
        if (isVideo) { element.removeAttribute("src"); element.load(); }
        if (ok) resolve(); else reject(new Error("probe_failed"));
      }
      if (isVideo) {
        element.muted = true;
        element.preload = "metadata";
        element.onloadedmetadata = function () { done(true); };
      } else {
        element.onload = function () { done(true); };
      }
      element.onerror = function () { done(false); };
      element.src = url;
    });
  }

  // Called with every manifest: keeps what the manifest still uses, removes
  // the rest and queues missing files one at a time.
  function syncDisk(manifest) {
    if (!disk.ready) return;
    disk.ready.then(function () {
      if (disk.state !== "ready" || disk.playback === "failed") return;
      var wanted = {};
      (manifest.assets || []).forEach(function (asset) {
        if (!diskStorable(asset)) return;
        var name = diskName(asset);
        wanted[name] = true;
        if (disk.files[name] == null && !disk.queued[name]) {
          disk.queued[name] = true;
          disk.queue.push(asset);
        }
      });
      var playing = state.currentItem && state.currentItem.assetId;
      Object.keys(disk.files).forEach(function (name) {
        if (wanted[name]) return;
        if (playing && name.indexOf(DISK_PREFIX + playing + "-") === 0) return;
        removeDiskFile(name);
      });
      pumpDisk();
    });
  }

  function pumpDisk() {
    if (disk.busy || !disk.queue.length || !state.credential) return;
    var asset = disk.queue.shift();
    var name = diskName(asset);
    delete disk.queued[name];
    if (disk.files[name] != null) return pumpDisk();
    disk.busy = { name: name, total: Number(asset.fileSize) || 0, startedAt: Date.now() };
    refreshDiskSpace().catch(function () {}).then(function () {
      var size = Number(asset.fileSize) || 0;
      if (disk.freeBytes && size + DISK_RESERVE_BYTES > disk.freeBytes) {
        throw new Error("Мало места на накопителе панели для файла " + formatBytes(size));
      }
      return request("POST", asset.downloadPath + "/stream-url", {});
    }).then(function (link) {
      // The storage service fetches the file itself; the signed link carries
      // the authorisation a plain URL cannot.
      return diskCall("fs/copyFile", {
        src: state.serverUrl + link.path,
        dest: DISK_ROOT + name,
        maxRedirection: 3
      }, DISK_COPY_TIMEOUT_MS);
    }).then(function () {
      return diskCall("fs/listFiles", { pathURI: DISK_ROOT });
    }).then(function (result) {
      var stored = null;
      (result.files || []).forEach(function (file) { if (file.name === name) stored = Number(file.size); });
      var expected = Number(asset.fileSize) || 0;
      if (stored == null || (expected > 0 && stored !== expected)) {
        removeDiskFile(name);
        throw new Error("Файл на накопителе не совпал по размеру, будет скачан снова");
      }
      disk.files[name] = stored;
      saveDiskIndex();
      disk.error = null;
      return probeDiskPlayback(name);
    }).catch(function (error) {
      // Tried again with the next manifest sync.
      disk.error = error.message;
    }).then(function () {
      disk.busy = null;
      if (disk.playback !== "failed") pumpDisk();
    });
  }

  // A stored file that no longer plays is removed and fetched again.
  function diskPlaybackFailed(url) {
    if (!disk.base || !url || url.indexOf(disk.base) !== 0) return;
    removeDiskFile(url.slice(disk.base.length));
    if (state.manifest) syncDisk(state.manifest);
  }

  // ---- Playback ----------------------------------------------------------

  function playlistItems() {
    return state.currentPlaylist && state.currentPlaylist.items || [];
  }

  function playNext() {
    clearTimeout(state.itemTimer);
    var items = playlistItems();
    if (!items.length) {
      showMessage("Пустой плейлист", "В активном плейлисте нет элементов.");
      state.playbackState = "idle";
      return;
    }
    state.itemIndex = (state.itemIndex + 1) % items.length;
    renderItem(items[state.itemIndex]);
  }

  function prefetchNext() {
    var items = playlistItems();
    if (items.length < 2) return;
    var next = items[(state.itemIndex + 1) % items.length];
    if (!next || next.assetType === "website" || next.assetType === "widget") return;
    var asset = findAsset(next.assetId, next.variantId);
    if (asset) loadMedia(asset).catch(function () { /* Retried when the item plays. */ });
  }

  // The next item is built hidden on top of the current one and revealed only
  // once it can show something, so a slow download or a failed item leaves
  // the previous content on screen instead of a black frame.
  function renderItem(item) {
    var token = ++state.renderToken;
    var previous = state.currentItem;
    clearTimeout(state.readyTimer);
    clearInterval(state.stallTimer);
    state.currentItem = item;
    state.playbackState = "loading";
    state.mode = "playback";
    state.readyTimer = setTimeout(function () {
      itemFailed("Элемент не загрузился вовремя", token);
    }, READY_TIMEOUT_MS);

    if (item.assetType === "website" || item.assetType === "widget") {
      var website = item.assetType === "website" ? findWebsite(item.assetId) : findWidgetWebsite(item.assetId);
      if (!website) {
        return itemFailed(item.assetType === "widget"
          ? "Этот вид виджета пока не показывается на webOS"
          : "Нет настроек веб-страницы", token);
      }
      // The same website again (for example a one-item playlist) stays loaded
      // instead of reloading at every cycle.
      var visible = visibleElement();
      if (visible && visible.tagName === "IFRAME" && visible.getAttribute("data-site") === website.url &&
          previous && previous.assetType === item.assetType && previous.assetId === item.assetId) {
        clearTimeout(state.readyTimer);
        itemHealthy();
        armNext(itemDuration(item), token);
        return;
      }
      var frame = document.createElement("iframe");
      frame.className = "website pending";
      frame.setAttribute("data-site", website.url);
      frame.onload = function () {
        if (token !== state.renderToken) return;
        reveal(frame, null, token);
        armNext(itemDuration(item), token);
      };
      frame.src = website.url;
      stage.appendChild(frame);
      return;
    }

    var asset = findAsset(item.assetId, item.variantId);
    if (!asset) return itemFailed("Медиафайл не найден", token);
    var key = mediaKey(asset);
    loadMedia(asset).then(function (url) {
      if (token !== state.renderToken) return;
      if ((asset.mimeType || "").indexOf("video/") === 0) renderVideo(item, url, key, token);
      else renderImage(item, url, key, token);
    }).catch(function (error) {
      itemFailed(error.message, token);
    });
  }

  // A "Веб-сайт" widget carries its address in the widget configuration rather
  // than in manifest.websites; other widget kinds need a renderer webOS lacks.
  function findWidgetWebsite(assetId) {
    var list = state.manifest && state.manifest.widgets || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].assetId !== assetId) continue;
      var config = list[i].configuration || {};
      var url = config.displayUrl || config.url;
      return list[i].provider === "website" && url ? { assetId: assetId, url: url } : null;
    }
    return null;
  }

  function findWebsite(assetId) {
    var list = state.manifest && state.manifest.websites || [];
    for (var i = 0; i < list.length; i++) if (list[i].assetId === assetId) return list[i];
    return null;
  }

  function findAsset(assetId, variantId) {
    var list = state.manifest && state.manifest.assets || [];
    for (var i = 0; i < list.length; i++) if (list[i].assetId === assetId && (!variantId || list[i].variantId === variantId)) return list[i];
    return null;
  }

  function fitClass(fit) {
    return fit === "cover" ? "fit-cover" : fit === "stretch" ? "fit-stretch" : "fit-contain";
  }

  function renderImage(item, url, key, token) {
    var image = document.createElement("img");
    var fit = itemFit(item);
    image.className = "media pending " + fitClass(fit);
    image.setAttribute("data-fit", fit);
    image.onload = function () {
      if (token !== state.renderToken) return;
      reveal(image, key, token);
      armNext(itemDuration(item), token);
    };
    image.onerror = function () {
      diskPlaybackFailed(url);
      itemFailed("Не удалось открыть изображение", token);
    };
    image.src = url;
    stage.appendChild(image);
  }

  function renderVideo(item, url, key, token) {
    var video = document.createElement("video");
    var fit = itemFit(item);
    var startMs = Math.max(0, Number(item.videoStartOffsetMs) || 0);
    var endMs = Math.max(0, Number(item.videoEndOffsetMs) || 0);
    var revealed = false;
    video.className = "media pending " + fitClass(fit);
    video.setAttribute("data-fit", fit);
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "auto";
    // A silent item stays silent; the Studio mute and volume commands apply
    // on top of the item's own settings.
    if (!itemAudio(item)) video.setAttribute("data-silent", "1");
    video.muted = !itemAudio(item) || !!state.muted;
    video.volume = state.volumeOverride == null ? itemVolume(item) : state.volumeOverride;
    video.onloadedmetadata = function () {
      if (startMs > 0 && startMs / 1000 < (video.duration || Infinity)) video.currentTime = startMs / 1000;
    };
    video.onplaying = function () {
      if (token !== state.renderToken || revealed) return;
      revealed = true;
      reveal(video, key, token);
      watchVideo(video, endMs, token);
      // A video plays to its natural end or its end offset. Only an explicit
      // positive item duration cuts it short; no default ever truncates it.
      var cap = Number(item.durationMs);
      if (!item.usePlayerDefaults && isFinite(cap) && cap > 0) armNext(cap, token);
    };
    video.onended = function () { if (token === state.renderToken) playNext(); };
    video.onerror = function () {
      diskPlaybackFailed(url);
      itemFailed("Ошибка воспроизведения видео", token);
    };
    video.src = url;
    stage.appendChild(video);
    var promise = video.play();
    if (promise && promise.catch) promise.catch(function () {
      if (token !== state.renderToken) return;
      video.muted = true;
      var retry = video.play();
      if (retry && retry.catch) retry.catch(function () { itemFailed("Телевизор заблокировал автозапуск видео", token); });
    });
  }

  function watchVideo(video, endMs, token) {
    var lastTime = -1;
    var lastProgress = Date.now();
    clearInterval(state.stallTimer);
    state.stallTimer = setInterval(function () {
      if (token !== state.renderToken) return clearInterval(state.stallTimer);
      if (endMs > 0 && video.currentTime * 1000 >= endMs) {
        clearInterval(state.stallTimer);
        return playNext();
      }
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastProgress = Date.now();
        state.lastHealthyPlaybackAt = new Date().toISOString();
      } else if (Date.now() - lastProgress > VIDEO_STALL_MS) {
        clearInterval(state.stallTimer);
        itemFailed("Видео остановилось", token);
      }
    }, 500);
  }

  function reveal(element, key, token) {
    clearTimeout(state.readyTimer);
    Array.prototype.slice.call(stage.children).forEach(function (child) {
      if (child !== element) removeElement(child);
    });
    element.className = element.className.replace(/\bpending\b/, "").replace(/\s+/g, " ").trim();
    if (key) {
      element.setAttribute("data-media-key", key);
      pinMedia(key, 1);
    }
    state.messageTitle = null;
    state.messageText = null;
    itemHealthy();
    if (token === state.renderToken) prefetchNext();
  }

  function removeElement(element) {
    if (element.tagName === "VIDEO") {
      element.onplaying = element.onended = element.onerror = element.onloadedmetadata = null;
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    var key = element.getAttribute && element.getAttribute("data-media-key");
    if (key) pinMedia(key, -1);
    if (element.parentNode) element.parentNode.removeChild(element);
    evictMedia();
  }

  function itemHealthy() {
    state.playbackState = "playing";
    state.lastError = null;
    state.consecutiveFailures = 0;
    state.lastHealthyPlaybackAt = new Date().toISOString();
  }

  // A failed item is skipped quickly while the previous content stays on
  // screen. The error panel appears only when every item in the playlist fails.
  function itemFailed(message, token) {
    if (token !== state.renderToken) return;
    clearTimeout(state.readyTimer);
    clearInterval(state.stallTimer);
    state.lastError = message;
    state.consecutiveFailures += 1;
    var pending = stage.querySelectorAll(".pending");
    for (var i = 0; i < pending.length; i++) removeElement(pending[i]);
    if (state.consecutiveFailures >= Math.max(1, playlistItems().length)) {
      showMessage("Контент недоступен", message);
      state.playbackState = "failed";
      state.consecutiveFailures = 0;
      armNext(15000, state.renderToken);
    } else {
      armNext(1000, token);
    }
  }

  function armNext(duration, token) {
    clearTimeout(state.itemTimer);
    state.itemTimer = setTimeout(function () {
      if (token === state.renderToken) playNext();
    }, duration);
  }

  function clearPlayback() {
    state.renderToken += 1;
    clearTimeout(state.itemTimer);
    clearTimeout(state.readyTimer);
    clearInterval(state.stallTimer);
    state.itemTimer = null;
    Array.prototype.slice.call(stage.children).forEach(removeElement);
    stage.innerHTML = "";
  }

  // Last resort: a page that has shown nothing healthy for several minutes
  // while it should be playing reloads itself. Pairing and the cached
  // manifest survive in localStorage.
  setInterval(function () {
    if (state.mode !== "playback" || !state.currentPlaylist) return;
    var healthyAt = state.lastHealthyPlaybackAt ? Date.parse(state.lastHealthyPlaybackAt) : 0;
    if (Date.now() - Math.max(healthyAt, state.startedAt) > RELOAD_AFTER_UNHEALTHY_MS) window.location.reload();
  }, 60000);

  // ---- Screen capture for Studio preview and live view ---------------------

  function visibleElement() {
    var children = stage.children;
    for (var i = children.length - 1; i >= 0; i--) {
      if (!/\bpending\b/.test(children[i].className)) return children[i];
    }
    return null;
  }

  function fitRect(fit, sourceWidth, sourceHeight, width, height) {
    if (fit === "stretch" || !sourceWidth || !sourceHeight) return [0, 0, width, height];
    var scale = fit === "cover" ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight);
    var w = sourceWidth * scale, h = sourceHeight * scale;
    return [(width - w) / 2, (height - h) / 2, w, h];
  }

  function mostlyBlack(context, width, height) {
    try {
      var data = context.getImageData(0, 0, width, height).data;
      var step = Math.max(4, Math.floor(data.length / 4 / 400) * 4);
      var bright = 0, samples = 0;
      for (var i = 0; i < data.length; i += step) {
        samples += 1;
        if (data[i] + data[i + 1] + data[i + 2] > 48) bright += 1;
      }
      return bright < samples * 0.02;
    } catch (_) { return false; }
  }

  function drawCard(context, width, height, title, lines) {
    context.fillStyle = "#0e141b";
    context.fillRect(0, 0, width, height);
    var unit = height / 20;
    context.fillStyle = "#5eead4";
    context.font = "bold " + Math.round(unit * 0.9) + "px Arial, sans-serif";
    context.fillText("LSR SIGNAGE", unit * 1.5, unit * 2.2);
    context.fillStyle = "#f8fafc";
    context.font = "bold " + Math.round(unit * 1.6) + "px Arial, sans-serif";
    context.fillText(String(title).slice(0, 60), unit * 1.5, unit * 5.5);
    context.fillStyle = "#cbd5e1";
    context.font = Math.round(unit * 1.05) + "px Arial, sans-serif";
    lines.forEach(function (line, index) {
      context.fillText(String(line).slice(0, 90), unit * 1.5, unit * (8.5 + index * 1.8));
    });
  }

  function statusLines() {
    var items = playlistItems();
    var lines = [];
    if (state.currentPlaylist) lines.push("Плейлист: " + (state.currentPlaylist.name || state.currentPlaylist.id));
    if (state.currentItem && items.length) lines.push("Элемент " + (state.itemIndex + 1) + " из " + items.length + (state.currentItem.name ? ": " + state.currentItem.name : ""));
    lines.push("Состояние: " + state.playbackState + " · " + new Date().toLocaleTimeString());
    if (state.lastError) lines.push("Ошибка: " + state.lastError);
    return lines;
  }

  function clock(seconds) {
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // Draws what the player shows. Images and videos held in browser memory are
  // copied from their same-origin blob URLs. A website frame, a file played
  // from the panel's own storage (another origin) and video on a hardware
  // plane cannot be read by the page, so those cases produce a status card
  // that names the content instead of a broken or misleading frame.
  function captureFrame(maxWidth, maxHeight) {
    var screenWidth = window.innerWidth || 1920, screenHeight = window.innerHeight || 1080;
    var scale = Math.min(1, maxWidth / screenWidth, maxHeight / screenHeight);
    var width = Math.max(2, Math.round(screenWidth * scale)), height = Math.max(2, Math.round(screenHeight * scale));
    var canvas = blankCanvas(width, height);
    var context = canvas.getContext("2d");
    var element = visibleElement();
    var drawn = false;
    if (element && (element.tagName === "IMG" || element.tagName === "VIDEO")) {
      var isImage = element.tagName === "IMG";
      try {
        var rect = fitRect(element.getAttribute("data-fit"),
          isImage ? element.naturalWidth : element.videoWidth,
          isImage ? element.naturalHeight : element.videoHeight, width, height);
        context.drawImage(element, rect[0], rect[1], rect[2], rect[3]);
        // Throws for a file played from the panel's own storage: it comes from
        // another origin, and a canvas holding it can no longer be exported.
        context.getImageData(0, 0, 1, 1);
        drawn = isImage || !mostlyBlack(context, width, height);
      } catch (_) {
        canvas = blankCanvas(width, height);
        context = canvas.getContext("2d");
        drawn = false;
      }
      if (!drawn && isImage) {
        drawCard(context, width, height, "Показывается изображение", statusLines());
        drawn = true;
      }
      if (!drawn && !isImage) {
        var position = Math.floor(element.currentTime || 0), total = Math.floor(element.duration || 0);
        drawCard(context, width, height, "Воспроизводится видео", statusLines().concat([
          "Позиция: " + clock(position) + (isFinite(total) && total ? " / " + clock(total) : "")
        ]));
        drawn = true;
      }
    }
    if (!drawn && element && element.tagName === "IFRAME") {
      drawCard(context, width, height, "Показывается веб-страница", [element.getAttribute("data-site") || ""].concat(statusLines()));
      drawn = true;
    }
    if (!drawn) {
      drawCard(context, width, height, state.messageTitle || "LSR signage Player", (state.messageText ? [state.messageText] : []).concat(statusLines()));
    }
    return { canvas: canvas, width: width, height: height };
  }

  function blankCanvas(width, height) {
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    return canvas;
  }

  function canvasJpeg(canvas, quality) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) return canvas.toBlob(resolve, "image/jpeg", quality);
      var binary = atob(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      resolve(new Blob([bytes], { type: "image/jpeg" }));
    });
  }

  function jpegWithin(canvas, maxBytes, quality) {
    return canvasJpeg(canvas, quality).then(function (blob) {
      if (!blob) throw new Error("capture_encode_failed");
      if (blob.size <= maxBytes || quality <= 0.35) return blob;
      return jpegWithin(canvas, maxBytes, quality - 0.15);
    });
  }

  // Setup and pairing show the server form or pairing code; they are never uploaded.
  function captureBlocked() {
    return state.mode === "pairing" || state.mode === "setup" || !state.credential;
  }

  // ---- LG system services ----------------------------------------------------
  // webOS reaches system services through PalmServiceBridge. A bridge is kept
  // referenced until its answer arrives; a collected bridge drops the call.

  var pendingBridges = [];

  function lunaCall(uri, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof window.PalmServiceBridge !== "function") return reject(new Error("luna_unavailable"));
      var bridge = new window.PalmServiceBridge();
      var finished = false;
      var timer = setTimeout(function () {
        if (finished) return;
        finish();
        reject(new Error("luna_timeout"));
      }, timeoutMs || 5000);
      function finish() {
        finished = true;
        clearTimeout(timer);
        var index = pendingBridges.indexOf(bridge);
        if (index >= 0) pendingBridges.splice(index, 1);
      }
      pendingBridges.push(bridge);
      bridge.onservicecallback = function (text) {
        if (finished) return;
        finish();
        var result;
        try { result = JSON.parse(text); } catch (error) { return reject(error); }
        if (result && result.returnValue === false) return reject(new Error(result.errorText || result.errorCode || "luna_failed"));
        resolve(result || {});
      };
      try { bridge.call(uri, JSON.stringify(params || {})); }
      catch (error) { finish(); reject(error); }
    });
  }

  // ---- Real screen capture (LG Signage) ---------------------------------------
  // The canvas copy above cannot see a website frame or video drawn on the
  // panel's hardware plane. LG Signage panels can capture the actual output, so
  // Studio sees exactly what viewers see. A consumer TV has no such service:
  // after a few failures the player stops asking for ten minutes and uses the
  // canvas copy.

  var SIGNAGE_CAPTURE = "luna://com.webos.service.commercial.signage.storageservice/captureScreen";
  var hardware = { failures: 0, retryAt: 0 };

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error("capture_decode_failed")); };
      image.src = src;
    });
  }

  function hardwareFrame(maxWidth, maxHeight) {
    if (Date.now() < hardware.retryAt) return Promise.reject(new Error("hardware_capture_paused"));
    return lunaCall(SIGNAGE_CAPTURE, { save: false, thumbnail: false, imgResolution: "HD" }, 6000).then(function (result) {
      var data = result.data || result.imageData || result.image;
      if (!data) throw new Error("capture_empty");
      return loadImage(/^data:/.test(data) ? data : "data:image/jpeg;base64," + data);
    }).then(function (image) {
      hardware.failures = 0;
      var scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
      var width = Math.max(2, Math.round(image.naturalWidth * scale));
      var height = Math.max(2, Math.round(image.naturalHeight * scale));
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(image, 0, 0, width, height);
      return { canvas: canvas, width: width, height: height };
    }, function (error) {
      hardware.failures += 1;
      if (hardware.failures >= 3) {
        hardware.failures = 0;
        hardware.retryAt = Date.now() + 10 * 60 * 1000;
      }
      throw error;
    });
  }

  function screenFrame(maxWidth, maxHeight) {
    return hardwareFrame(maxWidth, maxHeight).catch(function () {
      return captureFrame(maxWidth, maxHeight);
    });
  }

  // ---- Studio commands ----------------------------------------------------------
  // The same command queue Android players use. Each command is acknowledged,
  // run once, and answered; a command this panel cannot perform is answered as
  // unsupported so Studio does not wait for it.

  var commands = { timer: null, busy: false, seen: {} };

  function startCommandLoop() {
    clearInterval(commands.timer);
    commands.timer = setInterval(pollCommands, 10000);
    pollCommands();
  }

  function pollCommands() {
    if (!state.credential || commands.busy) return;
    commands.busy = true;
    request("GET", "/api/v1/player/commands", null, {}, false).then(function (list) {
      return ((list && list.items) || []).reduce(function (chain, command) {
        return chain.then(function () { return runCommand(command); });
      }, Promise.resolve());
    }).catch(function (error) {
      handleDeviceError(error);
    }).then(function () {
      commands.busy = false;
    });
  }

  function commandError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function runCommand(command) {
    if (commands.seen[command.id]) return Promise.resolve();
    commands.seen[command.id] = true;
    var path = "/api/v1/player/commands/" + encodeURIComponent(command.id);
    return request("POST", path + "/acknowledge", {}, {}, false).catch(function () {}).then(function () {
      return executeCommand(command);
    }).then(function (message) {
      return { success: true, code: "ok", message: message || "" };
    }, function (error) {
      return { success: false, code: error.code || "command_failed", message: String(error.message || error).slice(0, 240) };
    }).then(function (result) {
      return request("POST", path + "/result", result, {}, false).catch(function () {}).then(function () {
        if (result.success && command.type === "restart_player_process") setTimeout(function () { window.location.reload(); }, 300);
      });
    });
  }

  function videoElements() {
    return Array.prototype.slice.call(stage.querySelectorAll("video"));
  }

  function clamp(value, low, high) {
    var number = Math.round(Number(value));
    if (!isFinite(number)) throw commandError("invalid_payload", "Неверное значение");
    return Math.max(low, Math.min(high, number));
  }

  // System volume first; when the panel refuses, the player's own video volume
  // still changes and the answer says so.
  function setVolume(level) {
    return lunaCall("luna://com.webos.audio/setVolume", { volume: level }).then(function () {
      return "Громкость телевизора: " + level;
    }, function () {
      state.volumeOverride = level / 100;
      videoElements().forEach(function (video) { video.volume = state.volumeOverride; });
      return "Громкость плеера: " + level + " (системная громкость недоступна)";
    });
  }

  function setMuted(muted) {
    state.muted = muted;
    videoElements().forEach(function (video) { video.muted = muted || !!video.getAttribute("data-silent"); });
    return lunaCall("luna://com.webos.audio/setMuted", { muted: muted }).then(function () {
      return muted ? "Звук выключен" : "Звук включён";
    }, function () {
      return muted ? "Звук плеера выключен" : "Звук плеера включён";
    });
  }

  function clearMediaCache() {
    var dropped = 0;
    Object.keys(media.entries).forEach(function (key) {
      var entry = media.entries[key];
      if (entry.url && entry.pins === 0) { dropMedia(entry); dropped += 1; }
    });
    return "Удалено файлов из памяти: " + dropped;
  }

  function executeCommand(command) {
    var payload = command.payload || {};
    switch (command.type) {
      case "sync_now":
      case "resynchronize_player":
        state.lastConfigSyncAt = 0;
        syncManifest();
        return Promise.resolve("Синхронизация запущена");
      case "reload_playback":
      case "recreate_renderer":
      case "recreate_playback_session":
      case "retry_current_item":
        state.currentPlaylist = null;
        evaluateManifest();
        return Promise.resolve("Воспроизведение перезапущено");
      case "skip_current_item":
        playNext();
        return Promise.resolve("Элемент пропущен");
      case "clear_media_cache":
        return Promise.resolve(clearMediaCache());
      case "restart_player_process":
      case "restart_activity":
        return Promise.resolve("Плеер перезапускается");
      case "identify_screen":
        toggleInfo();
        return Promise.resolve("Служебная строка показана");
      case "display_set_volume":
        return setVolume(clamp(payload.volume, 0, 100));
      case "display_mute":
        return setMuted(true);
      case "display_unmute":
        return setMuted(false);
      case "display_set_brightness":
        return lunaCall("luna://com.webos.settingsservice/setSystemSettings", {
          category: "picture", settings: { backlight: clamp(payload.brightness, 0, 100) }
        }).then(function () { return "Яркость изменена"; }, function () {
          throw commandError("unsupported_command", "Телевизор не разрешает менять яркость");
        });
      case "display_power_off":
        return lunaCall("luna://com.webos.service.tvpower/power/turnOffScreen", {}).then(function () { return "Экран выключен"; }, function () {
          throw commandError("unsupported_command", "Телевизор не разрешает выключать экран");
        });
      case "display_power_on":
        return lunaCall("luna://com.webos.service.tvpower/power/turnOnScreen", {}).then(function () { return "Экран включён"; }, function () {
          throw commandError("unsupported_command", "Телевизор не разрешает включать экран");
        });
      default:
        return Promise.reject(commandError("unsupported_command", "webOS-плеер не поддерживает эту команду"));
    }
  }

  // ---- Studio live preview (periodic still image) --------------------------

  var preview = { running: false, lastCaptureAt: 0, forceSeen: false };

  function startPreviewLoop() {
    if (preview.running) return;
    preview.running = true;
    previewTick();
  }

  function previewTick() {
    if (!state.credential) { preview.running = false; return; }
    request("GET", "/api/v1/player/preview-session", null, {}, false).then(function (session) {
      if (!session || !session.active) { preview.forceSeen = false; return; }
      if (!session.captureNow) preview.forceSeen = false;
      var interval = Math.max(10, session.captureIntervalSeconds || 20) * 1000;
      var forceDue = session.captureNow && !preview.forceSeen;
      if (!forceDue && Date.now() - preview.lastCaptureAt < interval) return;
      if (session.captureNow) preview.forceSeen = true;
      preview.lastCaptureAt = Date.now();
      return uploadPreview();
    }).catch(function (error) {
      handleDeviceError(error);
    }).then(function () {
      setTimeout(previewTick, 5000);
    });
  }

  function uploadPreview() {
    var form = new FormData();
    form.append("capturedAt", new Date().toISOString());
    form.append("playerVersion", VERSION);
    if (captureBlocked()) {
      form.append("failureStatus", "sensitive_pairing");
      return request("POST", "/api/v1/player/preview", form, {}, false);
    }
    var shot;
    return screenFrame(960, 540).then(function (frame) {
      shot = frame;
      return jpegWithin(shot.canvas, 480 * 1024, 0.75);
    }).then(function (blob) {
      form.append("width", String(shot.width));
      form.append("height", String(shot.height));
      form.append("preview", blob, "preview.jpg");
      return request("POST", "/api/v1/player/preview", form, {}, false);
    }, function () {
      form.append("failureStatus", "capture_failed");
      return request("POST", "/api/v1/player/preview", form, {}, false);
    });
  }

  // ---- Studio "Watch live" (short-lived MJPEG relay) -----------------------

  var live = { running: false, session: null, checkedAt: 0 };

  function startLiveStreamLoop() {
    if (live.running) return;
    live.running = true;
    liveTick();
  }

  function liveSessionActive(session) {
    return !!session && session.active && !!session.id && Date.parse(session.expiresAt) > Date.now();
  }

  function liveTick() {
    if (!state.credential) { live.running = false; return; }
    var check = !liveSessionActive(live.session) || Date.now() - live.checkedAt > 4000
      ? request("GET", "/api/v1/player/live-stream-session", null, {}, false).then(function (session) {
        live.session = session;
        live.checkedAt = Date.now();
      })
      : Promise.resolve();
    check.then(function () {
      if (!liveSessionActive(live.session) || captureBlocked()) return 2500;
      var started = Date.now();
      return sendLiveFrame(live.session).then(function () {
        return Math.max(60, (live.session.frameIntervalMillis || 125) - (Date.now() - started));
      });
    }).catch(function (error) {
      if (error && error.status === 404) live.session = null;
      handleDeviceError(error);
      return 3000;
    }).then(function (wait) {
      setTimeout(liveTick, wait || 3000);
    });
  }

  function uuidBytes(value) {
    var hex = String(value).replace(/-/g, "");
    var bytes = new Uint8Array(16);
    for (var i = 0; i < 16; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  }

  // TCLS version 1: magic, version, session UUID, capture time in
  // milliseconds (big-endian uint64), width and height (uint16), then JPEG.
  function sendLiveFrame(session) {
    var shot;
    var limit = Math.max(4096, (session.maxFrameBytes || 102400) - 64);
    return screenFrame(session.maxWidth || 640, session.maxHeight || 360).then(function (frame) {
      shot = frame;
      return jpegWithin(shot.canvas, limit, 0.6);
    }).then(function (jpeg) {
      var header = new ArrayBuffer(33);
      var view = new DataView(header);
      var bytes = new Uint8Array(header);
      bytes.set([84, 67, 76, 83], 0);
      bytes[4] = 1;
      bytes.set(uuidBytes(session.id), 5);
      var now = Date.now();
      view.setUint32(21, Math.floor(now / 4294967296));
      view.setUint32(25, now >>> 0);
      view.setUint16(29, shot.width);
      view.setUint16(31, shot.height);
      var body = new Blob([header, jpeg], { type: "application/octet-stream" });
      return request("POST", "/api/v1/player/live-stream-frame", body, { "Content-Type": "application/octet-stream" }, false);
    });
  }

  // ---- Heartbeat and lifecycle -----------------------------------------------

  function sendHeartbeat() {
    if (!state.credential) return;
    var item = state.currentItem;
    var video = stage.querySelector("video:not(.pending)");
    var download = activeDownload();
    var upcoming = nextChange();
    var sentAt = Date.now();
    request("POST", "/api/v1/player/heartbeat", {
      screenWidth: window.screen.width || window.innerWidth || 1920,
      screenHeight: window.screen.height || window.innerHeight || 1080,
      playerVersion: VERSION,
      playerVersionCode: VERSION_CODE,
      uptimeSeconds: Math.floor(performance.now() / 1000),
      activeManifestVersion: state.manifest && state.manifest.manifestVersion,
      currentItemId: item && item.id,
      currentAssetId: item && item.assetId,
      playbackState: state.playbackState,
      currentPlaylistId: state.currentPlaylist && state.currentPlaylist.id,
      selectionSource: state.selectionSource || "none",
      lastHealthyPlaybackAt: state.lastHealthyPlaybackAt,
      lastPlaybackError: state.lastError,
      rendererResponding: true,
      expectedMotion: !!video,
      // Reported like the Android player, so Studio's screen page has data.
      activeConfigRevision: state.configRevision,
      deviceClockOffsetSeconds: state.clockOffsetSeconds,
      currentScheduleId: state.currentScheduleId || undefined,
      nextTransitionAt: upcoming ? upcoming.toISOString() : undefined,
      downloadQueueCount: download ? download.count : 0,
      downloadedBytes: download ? download.loaded : 0,
      requiredBytes: download ? download.total : 0,
      cacheUsedBytes: media.bytes + (diskInUse() ? disk.usedBytes : 0),
      cacheLimitBytes: diskInUse() ? disk.usedBytes + Math.max(0, disk.freeBytes - DISK_RESERVE_BYTES) : MEDIA_CACHE_BYTES
    }, {}, false).then(function () {
      // The round trip doubles as the latency shown in the service overlay,
      // so the figure is known even when nobody opened it on the panel.
      if (!info.element) {
        info.latencyMs = Date.now() - sentAt;
        info.latencyError = null;
      }
      sendServiceInfo();
      // The screen was enabled again in Studio; resume without re-pairing.
      if (state.mode === "disabled") syncManifest();
    }).catch(function (error) {
      handleDeviceError(error);
    });
  }

  // Studio shows the same lines as the remote's Up button. A server without
  // this endpoint is asked again only after an hour.
  function sendServiceInfo() {
    if (state.serviceInfoUnsupportedUntil && Date.now() < state.serviceInfoUnsupportedUntil) return;
    request("POST", "/api/v1/player/service-info", { lines: infoLines().lines }, {}, false).catch(function (error) {
      if (error.status === 404 || error.status === 405) state.serviceInfoUnsupportedUntil = Date.now() + 60 * 60 * 1000;
    });
  }

  function resetEnrollment() {
    state.credential = null;
    state.manifest = null;
    state.currentPlaylist = null;
    state.currentItem = null;
    live.session = null;
    localStorage.removeItem(STORE + "credential");
    localStorage.removeItem(STORE + "manifest");
  }

  function start() {
    if (!state.installationId) {
      state.installationId = uuid();
      localStorage.setItem(STORE + "installationId", state.installationId);
    }
    if (!state.serverUrl) return showSetup("");
    if (!disk.ready) initDisk();
    if (state.credential && state.credential.serverUrl !== state.serverUrl) resetEnrollment();
    if (state.credential) runPaired(); else beginPairing();
  }

  // ---- Service overlay (remote Up) ------------------------------------------

  var info = { element: null, refreshTimer: null, latencyTimer: null, hideTimer: null, latencyMs: null, latencyError: null, nextChange: null, nextChangeAt: 0 };

  function formatBytes(value) {
    var units = ["Б", "КБ", "МБ", "ГБ", "ТБ"], size = Number(value) || 0, unit = 0;
    if (size < 1024) return size + " Б";
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
    return (size >= 100 ? size.toFixed(0) : size.toFixed(1)) + " " + units[unit];
  }

  function formatSpeed(bytesPerSecond) {
    var bits = bytesPerSecond * 8;
    return bits >= 1e6 ? (bits / 1e6).toFixed(1) + " Мбит/с" : Math.round(bits / 1e3) + " Кбит/с";
  }

  function formatDuration(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    if (d > 0) return d + " д " + h + " ч";
    if (h > 0) return h + " ч " + m + " мин";
    if (m > 0) return m + " мин " + (s % 60) + " с";
    return s + " с";
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // The webOS player has no transition list, so the next change is found by
  // evaluating the cached manifest minute by minute for the next 48 hours.
  function computeNextChange() {
    if (!state.manifest) return null;
    var now = Date.now();
    var current = selectPlaylist(state.manifest, new Date(now));
    var key = current ? current.id + ":" + current.revision : "";
    var start = Math.floor(now / 60000) * 60000;
    for (var minute = 1; minute <= 48 * 60; minute++) {
      var at = new Date(start + minute * 60000);
      var next = selectPlaylist(state.manifest, at);
      if ((next ? next.id + ":" + next.revision : "") !== key) return at;
    }
    return null;
  }

  // Recomputed at most once a minute; the heartbeat and the overlay share it.
  function nextChange() {
    if (Date.now() - info.nextChangeAt > 60000) {
      info.nextChange = computeNextChange();
      info.nextChangeAt = Date.now();
    }
    return info.nextChange;
  }

  function nextChangeText() {
    var at = nextChange();
    if (!at) return "не запланирована";
    var today = new Date().toDateString() === at.toDateString();
    var when = (today ? "" : pad(at.getDate()) + "." + pad(at.getMonth() + 1) + " ") + pad(at.getHours()) + ":" + pad(at.getMinutes());
    var left = at.getTime() - Date.now();
    return left > 0 ? when + " (через " + formatDuration(left) + ")" : when;
  }

  function diskInUse() {
    return disk.state === "ready" && disk.playback !== "failed";
  }

  function diskStateLabel() {
    if (disk.state === "checking" || disk.state === "unknown") return "проверка…";
    if (disk.state === "unavailable") return "недоступен на этой модели (" + (disk.error || "нет службы") + ")";
    if (disk.playback === "failed") return "файлы не воспроизводятся с накопителя";
    return "готов";
  }

  function activeDownload() {
    var loaded = 0, total = 0, count = 0, startedAt = Date.now();
    Object.keys(state.downloads).forEach(function (key) {
      var t = state.downloads[key];
      loaded += t.loaded;
      total += t.total;
      startedAt = Math.min(startedAt, t.startedAt);
      count++;
    });
    if (!count) return null;
    var elapsed = Date.now() - startedAt;
    return { loaded: loaded, total: total, count: count, bytesPerSecond: elapsed > 500 && loaded > 0 ? Math.round(loaded * 1000 / elapsed) : null };
  }

  function infoLines() {
    var lines = [];
    var credential = state.credential || {};
    var host = (/^https?:\/\/([^\/:]+)/i.exec(state.serverUrl || "") || [])[1] || "—";
    lines.push("Экран: " + (credential.screenName || "не привязан") + " · LSR signage webOS " + VERSION);
    var contactAge = state.lastServerContactAt ? Date.now() - state.lastServerContactAt : Infinity;
    lines.push("Сервер: " + host + " · " + (contactAge < 45000 ? "на связи" : "нет связи" + (isFinite(contactAge) ? " " + formatDuration(contactAge) : "")));
    var download = activeDownload();
    var latency = info.latencyMs != null ? "задержка " + info.latencyMs + " мс" : info.latencyError ? "ошибка: " + info.latencyError : "задержка …";
    var speed = download && download.bytesPerSecond ? "загрузка " + formatSpeed(download.bytesPerSecond) :
      state.lastDownloadBps ? "последняя загрузка " + formatSpeed(state.lastDownloadBps) : null;
    lines.push("Соединение: " + latency + (speed ? " · " + speed : ""));
    var items = playlistItems();
    if (state.currentPlaylist) {
      lines.push("Плейлист: " + (state.currentPlaylist.name || state.currentPlaylist.id) + (items.length ? " (элемент " + (state.itemIndex + 1) + " из " + items.length + ")" : ""));
    } else {
      lines.push("Плейлист: нет активного контента");
    }
    lines.push("Следующая смена: " + nextChangeText());
    if (diskInUse()) {
      lines.push("Накопитель панели: " + formatBytes(disk.usedBytes) + " · файлов " + Object.keys(disk.files).length + " · свободно " + formatBytes(disk.freeBytes));
    } else {
      lines.push("Накопитель панели: " + diskStateLabel());
    }
    if (disk.busy) {
      lines.push("Сохранение на накопитель: " + (disk.busy.total ? formatBytes(disk.busy.total) + " · " : "") +
        Math.round((Date.now() - disk.busy.startedAt) / 1000) + " с" + (disk.queue.length ? " · в очереди " + disk.queue.length : ""));
    }
    if (disk.error) lines.push("Накопитель: " + disk.error);
    lines.push("Память плеера: " + formatBytes(media.bytes) + " из " + formatBytes(MEDIA_CACHE_BYTES));
    if (download) {
      var percent = download.total ? Math.min(100, Math.round(download.loaded * 100 / download.total)) : 0;
      lines.push("Загрузка контента: " + percent + "% · " + formatBytes(download.loaded) + (download.total ? " из " + formatBytes(download.total) : "") + " · файлов " + download.count);
    }
    if (state.lastError) lines.push("Ошибка: " + state.lastError);
    if (state.manifest && state.manifest.manifestVersion) lines.push("Версия манифеста: " + state.manifest.manifestVersion);
    return { lines: lines, progress: download && download.total ? download.loaded / download.total : null };
  }

  function renderInfo() {
    if (!info.element) return;
    var data = infoLines();
    info.element.textContent = "";
    data.lines.forEach(function (line) {
      var row = document.createElement("div");
      row.textContent = line;
      info.element.appendChild(row);
    });
    if (data.progress != null) {
      // Width is set through the CSSOM: the player CSP blocks inline style attributes.
      var bar = document.createElement("div");
      var fill = document.createElement("span");
      bar.className = "info-bar";
      fill.style.width = Math.round(data.progress * 100) + "%";
      bar.appendChild(fill);
      info.element.appendChild(bar);
    }
  }

  function measureLatency() {
    if (!state.serverUrl) return;
    var started = Date.now();
    request("GET", "/api/v1/system/identity", null, {}, false).then(function () {
      info.latencyMs = Date.now() - started;
      info.latencyError = null;
    }).catch(function (error) {
      info.latencyMs = null;
      info.latencyError = error.message || "нет ответа";
    });
  }

  function hideInfo() {
    clearInterval(info.refreshTimer);
    clearInterval(info.latencyTimer);
    clearTimeout(info.hideTimer);
    if (info.element && info.element.parentNode) info.element.parentNode.removeChild(info.element);
    info.element = null;
  }

  function toggleInfo() {
    if (info.element) return hideInfo();
    info.element = document.createElement("div");
    info.element.className = "info";
    document.body.appendChild(info.element);
    info.nextChangeAt = 0;
    measureLatency();
    renderInfo();
    info.refreshTimer = setInterval(renderInfo, 1000);
    info.latencyTimer = setInterval(measureLatency, 5000);
    info.hideTimer = setTimeout(hideInfo, 30000);
  }

  document.addEventListener("keydown", function (event) {
    if (event.keyCode === 38 && !document.getElementById("server-form")) {
      toggleInfo();
      event.preventDefault();
      return;
    }
    if (event.keyCode === 461 || event.keyCode === 27) {
      if (!document.getElementById("server-form")) showSetup("");
      event.preventDefault();
    }
    if (event.keyCode === 403) {
      resetEnrollment();
      showSetup("Привязка удалена. Введите адрес сервера заново.");
      event.preventDefault();
    }
  });

  window.addEventListener("online", function () { if (state.credential) syncManifest(); });
  window.addEventListener("unhandledrejection", function (event) { state.lastError = String(event.reason || "Необработанная ошибка"); });
  start();
}());
