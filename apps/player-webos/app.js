(function () {
  "use strict";

  var VERSION = "0.1.0";
  var VERSION_CODE = 1;
  var STORE = "tilecast.webos.";
  var stage = document.getElementById("stage");
  var state = {
    serverUrl: localStorage.getItem(STORE + "serverUrl") || "",
    installationId: localStorage.getItem(STORE + "installationId") || "",
    credential: readJson("credential"),
    manifest: readJson("manifest"),
    currentPlaylist: null,
    currentItem: null,
    itemIndex: -1,
    itemTimer: null,
    syncTimer: null,
    heartbeatTimer: null,
    scheduleTimer: null,
    pairingTimer: null,
    objectUrl: null,
    playbackState: "starting",
    lastError: null,
    lastHealthyPlaybackAt: null
  };

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(STORE + key) || "null"); }
    catch (_) { return null; }
  }

  function writeJson(key, value) {
    localStorage.setItem(STORE + key, JSON.stringify(value));
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

  function request(method, path, body, extraHeaders, expectBlob) {
    var headers = extraHeaders || {};
    if (body != null) headers["Content-Type"] = "application/json";
    if (state.credential && state.credential.deviceCredential && !headers.Authorization) {
      headers.Authorization = "Bearer " + state.credential.deviceCredential;
    }
    return fetch(state.serverUrl + path, {
      method: method,
      headers: headers,
      body: body == null ? null : JSON.stringify(body)
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          var message = method + " " + path + ": HTTP " + response.status;
          try { message = JSON.parse(text).error.message || message; } catch (_) {}
          var error = new Error(message);
          error.status = response.status;
          throw error;
        });
      }
      if (expectBlob) return response.blob();
      return response.text().then(function (text) {
        var json = text ? JSON.parse(text) : {};
        return json.data == null ? json : json.data;
      });
    });
  }

  function showSetup(message) {
    clearPlayback();
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
    showMessage("Подключение", "Создаём код привязки…");
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
    var delay = Math.max(2, session.pollingIntervalSeconds || 3) * 1000;
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
      state.pairingTimer = setTimeout(function () { pollPairing(session); }, delay);
    }).catch(function (error) {
      if (error.status === 404 || error.status === 410) return beginPairing();
      state.pairingTimer = setTimeout(function () { pollPairing(session); }, delay);
    });
  }

  function runPaired() {
    if (state.manifest) activateManifest(state.manifest);
    else showMessage("Синхронизация", "Получаем расписание и контент…");
    syncManifest();
    sendHeartbeat();
    clearInterval(state.syncTimer);
    clearInterval(state.heartbeatTimer);
    clearInterval(state.scheduleTimer);
    state.syncTimer = setInterval(syncManifest, 30000);
    state.heartbeatTimer = setInterval(sendHeartbeat, 15000);
    state.scheduleTimer = setInterval(evaluateManifest, 30000);
  }

  function syncManifest() {
    request("GET", "/api/v1/player/manifest", null, {}, false).then(function (manifest) {
      state.manifest = manifest;
      writeJson("manifest", manifest);
      state.lastError = null;
      activateManifest(manifest);
    }).catch(function (error) {
      state.lastError = error.message;
      if (error.status === 401 || error.status === 403) {
        resetEnrollment();
        beginPairing();
      } else if (!state.manifest) {
        showMessage("Нет связи с сервером", error.message);
      }
    });
  }

  function activateManifest(manifest) {
    var selected = selectPlaylist(manifest, new Date());
    if (!selected) return showMessage("Нет контента", "Для экрана не назначено активное расписание или плейлист.");
    if (!state.currentPlaylist || state.currentPlaylist.id !== selected.id || state.currentPlaylist.revision !== selected.revision) {
      state.currentPlaylist = selected;
      state.itemIndex = -1;
      playNext();
    }
  }

  function evaluateManifest() {
    if (!state.manifest) return;
    var selected = selectPlaylist(state.manifest, new Date());
    if (!selected) return;
    if (!state.currentPlaylist || selected.id !== state.currentPlaylist.id || selected.revision !== state.currentPlaylist.revision) {
      activateManifest(state.manifest);
    }
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

  function playNext() {
    clearTimeout(state.itemTimer);
    var items = state.currentPlaylist && state.currentPlaylist.items || [];
    if (!items.length) return showMessage("Пустой плейлист", "В активном плейлисте нет элементов.");
    state.itemIndex = (state.itemIndex + 1) % items.length;
    renderItem(items[state.itemIndex]);
  }

  function renderItem(item) {
    clearPlayback();
    state.currentItem = item;
    state.playbackState = "loading";
    var duration = Math.max(1000, Number(item.durationMs) || 30000);
    if (item.assetType === "website") {
      var website = findWebsite(item.assetId);
      if (!website) return itemFailed("Website configuration is missing", duration);
      var frame = document.createElement("iframe");
      frame.className = "website";
      frame.src = website.url;
      frame.onload = itemHealthy;
      frame.onerror = function () { itemFailed("Website load failed", duration); };
      stage.appendChild(frame);
      armNext(duration);
      return;
    }
    var asset = findAsset(item.assetId, item.variantId);
    if (!asset) return itemFailed("Media asset is missing", duration);
    fetchAsset(asset).then(function (url) {
      state.objectUrl = url;
      if ((asset.mimeType || "").indexOf("video/") === 0) renderVideo(item, url, duration);
      else renderImage(item, url, duration);
    }).catch(function (error) { itemFailed(error.message, duration); });
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

  function fetchAsset(asset) {
    var path = asset.downloadPath;
    if (/^https?:\/\//i.test(path)) {
      return fetch(path, { headers: { Authorization: "Bearer " + state.credential.deviceCredential } }).then(blobResponse);
    }
    return request("GET", path, null, {}, true).then(function (blob) { return URL.createObjectURL(blob); });
  }

  function blobResponse(response) {
    if (!response.ok) throw new Error("Media download failed: HTTP " + response.status);
    return response.blob().then(function (blob) { return URL.createObjectURL(blob); });
  }

  function fitClass(fit) {
    return fit === "cover" ? "fit-cover" : fit === "stretch" ? "fit-stretch" : "fit-contain";
  }

  function renderImage(item, url, duration) {
    var image = document.createElement("img");
    image.className = "media " + fitClass(item.fitMode);
    image.onload = itemHealthy;
    image.onerror = function () { itemFailed("Image decode failed", duration); };
    image.src = url;
    stage.appendChild(image);
    armNext(duration);
  }

  function renderVideo(item, url, duration) {
    var video = document.createElement("video");
    video.className = "media " + fitClass(item.fitMode);
    video.autoplay = true;
    video.muted = item.audioEnabled === false;
    video.volume = Math.max(0, Math.min(1, Number(item.volume == null ? 100 : item.volume) / 100));
    video.onplaying = itemHealthy;
    video.onended = playNext;
    video.onerror = function () { itemFailed("Video playback failed", duration); };
    video.src = url;
    stage.appendChild(video);
    var promise = video.play();
    if (promise && promise.catch) promise.catch(function () { video.muted = true; video.play(); });
    armNext(duration);
  }

  function itemHealthy() {
    state.playbackState = "playing";
    state.lastError = null;
    state.lastHealthyPlaybackAt = new Date().toISOString();
  }

  function itemFailed(message, duration) {
    state.playbackState = "failed";
    state.lastError = message;
    stage.innerHTML = '<div class="center"><section class="panel"><h1>Контент недоступен</h1><p>' + escapeHtml(message) + '</p></section></div>';
    armNext(Math.min(duration || 10000, 10000));
  }

  function armNext(duration) {
    clearTimeout(state.itemTimer);
    state.itemTimer = setTimeout(playNext, duration);
  }

  function clearPlayback() {
    clearTimeout(state.itemTimer);
    state.itemTimer = null;
    var videos = stage.querySelectorAll("video");
    for (var i = 0; i < videos.length; i++) { videos[i].pause(); videos[i].removeAttribute("src"); videos[i].load(); }
    stage.innerHTML = "";
    if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
  }

  function sendHeartbeat() {
    if (!state.credential) return;
    var item = state.currentItem;
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
      expectedMotion: item && item.assetType === "video"
    }, {}, false).catch(function (error) {
      if (error.status === 401 || error.status === 403) {
        resetEnrollment();
        beginPairing();
      }
    });
  }

  function resetEnrollment() {
    state.credential = null;
    state.manifest = null;
    state.currentPlaylist = null;
    state.currentItem = null;
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
