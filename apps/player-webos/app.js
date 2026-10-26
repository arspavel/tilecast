(function () {
  "use strict";

  var VERSION = "0.2.0";
  var VERSION_CODE = 4;
  var STORE = "tilecast.webos.";
  // Media is kept in memory between playlist cycles so a loop does not
  // download every item again. Items on screen are never evicted.
  var MEDIA_CACHE_BYTES = 384 * 1024 * 1024;
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
        showMessage("Экран отключён", "Экран отключён в Tilecast Studio. Показ продолжится после включения.");
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
      '<div class="brand">Tilecast webOS</div><h1>Подключение к серверу</h1>' +
      '<p>Введите публичный адрес Tilecast, доступный с телевизора.</p>' +
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
      '<div class="brand">Tilecast webOS</div><h1>Привязка экрана</h1>' +
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
    stage.innerHTML = '<div class="center"><section class="panel"><div class="brand">Tilecast webOS</div><h1>' +
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
  }

  function syncConfig() {
    if (Date.now() - state.lastConfigSyncAt < 5 * 60 * 1000) return;
    state.lastConfigSyncAt = Date.now();
    request("GET", "/api/v1/player/config", null, {}, false).then(function (config) {
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
      state.manifest = manifest;
      writeJson("manifest", manifest);
      state.lastError = null;
      pruneMedia(manifest);
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
    if (takeover && inWindow(now, takeover.activatedAt, takeover.expiresAt) && byId[takeover.playlistId]) return byId[takeover.playlistId];
    var override = manifest.presentationOverride;
    if (override && override.playlistId && inWindow(now, override.startedAt, override.expiresAt) && byId[override.playlistId]) return byId[override.playlistId];
    var active = (manifest.schedules || []).filter(function (s) { return s.playlistId && scheduleApplies(s, now); });
    active.sort(function (a, b) { return (b.priority || 0) - (a.priority || 0) || (b.specificity || 0) - (a.specificity || 0); });
    if (active.length && byId[active[0].playlistId]) return byId[active[0].playlistId];
    return manifest.playlist || manifest.directFallbackPlaylist || null;
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
    if (end > start) return days.indexOf(isoDay) >= 0 && minute >= start && minute < end;
    if (minute >= start) return days.indexOf(isoDay) >= 0;
    var previous = isoDay === 1 ? 7 : isoDay - 1;
    return minute < end && days.indexOf(previous) >= 0;
  }

  function zonedParts(date, timezone) {
    try {
      var formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" });
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
    if (item.assetType === "website") return 30000;
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

  function loadMedia(asset) {
    var key = mediaKey(asset);
    var entry = media.entries[key];
    if (entry) {
      entry.used = ++media.clock;
      return entry.promise;
    }
    entry = { key: key, url: null, size: 0, used: ++media.clock, pins: 0 };
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

  function downloadWithRetry(asset, attempts) {
    return downloadAsset(asset).catch(function (error) {
      if (attempts <= 1 || credentialRejected(error) || error.status === 404) throw error;
      return delay(2000).then(function () { return downloadWithRetry(asset, attempts - 1); });
    });
  }

  function downloadAsset(asset) {
    var path = asset.downloadPath;
    if (/^https?:\/\//i.test(path)) {
      return fetch(path, { headers: { Authorization: "Bearer " + state.credential.deviceCredential } }).then(function (response) {
        if (!response.ok) {
          var error = new Error("Media download failed: HTTP " + response.status);
          error.status = response.status;
          throw error;
        }
        return response.blob();
      });
    }
    return request("GET", path, null, {}, true);
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
    if (entry.url) URL.revokeObjectURL(entry.url);
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
    if (!next || next.assetType === "website") return;
    var asset = findAsset(next.assetId, next.variantId);
    if (asset) loadMedia(asset).catch(function () { /* Retried when the item plays. */ });
  }

  // The next item is built hidden on top of the current one and revealed only
  // once it can show something, so a slow download or a failed item leaves
  // the previous content on screen instead of a black frame.
  function renderItem(item) {
    var token = ++state.renderToken;
    clearTimeout(state.readyTimer);
    clearInterval(state.stallTimer);
    state.currentItem = item;
    state.playbackState = "loading";
    state.mode = "playback";
    state.readyTimer = setTimeout(function () {
      itemFailed("Элемент не загрузился вовремя", token);
    }, READY_TIMEOUT_MS);

    if (item.assetType === "website") {
      var website = findWebsite(item.assetId);
      if (!website) return itemFailed("Website configuration is missing", token);
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
    if (!asset) return itemFailed("Media asset is missing", token);
    var key = mediaKey(asset);
    loadMedia(asset).then(function (url) {
      if (token !== state.renderToken) return;
      if ((asset.mimeType || "").indexOf("video/") === 0) renderVideo(item, url, key, token);
      else renderImage(item, url, key, token);
    }).catch(function (error) {
      itemFailed(error.message, token);
    });
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
    image.onerror = function () { itemFailed("Image decode failed", token); };
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
    video.muted = !itemAudio(item);
    video.volume = itemVolume(item);
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
    video.onerror = function () { itemFailed("Video playback failed", token); };
    video.src = url;
    stage.appendChild(video);
    var promise = video.play();
    if (promise && promise.catch) promise.catch(function () {
      if (token !== state.renderToken) return;
      video.muted = true;
      var retry = video.play();
      if (retry && retry.catch) retry.catch(function () { itemFailed("Video autoplay was blocked", token); });
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
    context.fillText("TILECAST WEBOS", unit * 1.5, unit * 2.2);
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

  // Draws what the player shows. Images and videos are copied from their own
  // same-origin blob URLs. A website frame cannot be read by the page, and some
  // panels render video on a hardware plane, so those cases produce a status
  // card that names the content instead of a misleading black frame.
  function captureFrame(maxWidth, maxHeight) {
    var screenWidth = window.innerWidth || 1920, screenHeight = window.innerHeight || 1080;
    var scale = Math.min(1, maxWidth / screenWidth, maxHeight / screenHeight);
    var width = Math.max(2, Math.round(screenWidth * scale)), height = Math.max(2, Math.round(screenHeight * scale));
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    var element = visibleElement();
    var drawn = false;
    if (element && (element.tagName === "IMG" || element.tagName === "VIDEO")) {
      var isImage = element.tagName === "IMG";
      try {
        var rect = fitRect(element.getAttribute("data-fit"),
          isImage ? element.naturalWidth : element.videoWidth,
          isImage ? element.naturalHeight : element.videoHeight, width, height);
        context.drawImage(element, rect[0], rect[1], rect[2], rect[3]);
        drawn = isImage || !mostlyBlack(context, width, height);
      } catch (_) { drawn = false; }
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
      drawCard(context, width, height, state.messageTitle || "Tilecast Player", (state.messageText ? [state.messageText] : []).concat(statusLines()));
    }
    return { canvas: canvas, width: width, height: height };
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
    var shot = captureFrame(960, 540);
    return jpegWithin(shot.canvas, 480 * 1024, 0.75).then(function (blob) {
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
    var shot = captureFrame(session.maxWidth || 640, session.maxHeight || 360);
    var limit = Math.max(4096, (session.maxFrameBytes || 102400) - 64);
    return jpegWithin(shot.canvas, limit, 0.6).then(function (jpeg) {
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
      selectionSource: "webos",
      lastHealthyPlaybackAt: state.lastHealthyPlaybackAt,
      lastPlaybackError: state.lastError,
      rendererResponding: true,
      expectedMotion: !!video
    }, {}, false).then(function () {
      // The screen was enabled again in Studio; resume without re-pairing.
      if (state.mode === "disabled") syncManifest();
    }).catch(function (error) {
      handleDeviceError(error);
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
    if (state.credential && state.credential.serverUrl !== state.serverUrl) resetEnrollment();
    if (state.credential) runPaired(); else beginPairing();
  }

  document.addEventListener("keydown", function (event) {
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
  window.addEventListener("unhandledrejection", function (event) { state.lastError = String(event.reason || "Unhandled error"); });
  start();
}());
