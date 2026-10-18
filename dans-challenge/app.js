/* Dans Challenge — stant uygulamasi
 * Ekranlar: yukleniyor -> ana ekran -> isim -> hazirlik -> geri sayim -> dans -> sonuc
 */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const E = window.DanceEngine;
  const params = new URLSearchParams(location.search);
  // Test icin gizli parametreler (normal kullanimda gerek yok)
  const TEST = {
    cam: params.get("cam"),                 // kamera yerine video dosyasi
    sim: params.get("sim"),                 // pose yerine hazir eklem verisi (json)
    simLag: params.has("simlag") ? +params.get("simlag") : 0.25,
    auto: params.has("auto"),               // otomatik oyna (isim: Test)
    songs: params.get("songs"),             // farkli sarki listesi
    mute: params.has("mute"),
    model: params.get("model"),
  };

  // ------------------------------------------------------------ ayarlar
  const DEFAULTS = {
    cameraId: "", difficulty: "normal", mirror: "auto", latency: 0.1, model: 1, fps: false,
    title: "Dans Challenge", club: "Google Developer Groups on Campus", autoReturn: 30, songId: "",
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* gizli mod */ } },
  };
  const settings = Object.assign({}, DEFAULTS, store.get("dc.settings", {}));
  if (TEST.model != null) settings.model = +TEST.model;
  const saveSettings = () => store.set("dc.settings", settings);

  // ------------------------------------------------------------ IndexedDB (eklenen videolar + analizler)
  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        let req;
        try { req = indexedDB.open("dans-challenge", 1); } catch (e) { rej(e); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of ["videos", "songs", "poses"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        };
        req.onsuccess = () => { this.db = req.result; res(this.db); };
        req.onerror = () => rej(req.error);
      });
    },
    async op(storeName, mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction(storeName, mode);
        const r = fn(tx.objectStore(storeName));
        tx.oncomplete = () => res(r && r.result);
        tx.onerror = () => rej(tx.error);
      });
    },
    get(s, k) { return this.op(s, "readonly", (st) => st.get(k)); },
    put(s, k, v) { return this.op(s, "readwrite", (st) => st.put(v, k)); },
    del(s, k) { return this.op(s, "readwrite", (st) => st.delete(k)); },
    all(s) { return this.op(s, "readonly", (st) => st.getAll()); },
  };

  // ------------------------------------------------------------ yardimcilar
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmtSec = (s) => `${s.toFixed(1)} sn`;
  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    const el = $("#toast"); el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), ms);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function onceEvent(el, ev, timeout = 8000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { el.removeEventListener(ev, h); rej(new Error(ev + " zaman aşımı")); }, timeout);
      const h = () => { clearTimeout(t); res(); };
      el.addEventListener(ev, h, { once: true });
    });
  }

  // ------------------------------------------------------------ ses efektleri (WebAudio, dosya yok)
  const sfx = {
    ctx: null,
    ensure() {
      if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },
    tone(freq, dur, type = "sine", vol = 0.12, when = 0) {
      if (!this.ctx || TEST.mute) return;
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    tick() { this.tone(740, 0.14, "square", 0.07); },
    go() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.09, i * 0.04)); },
    perfect() { [880, 1175, 1568].forEach((f, i) => this.tone(f, 0.16, "sine", 0.06, i * 0.05)); },
    great() { [784, 1047].forEach((f, i) => this.tone(f, 0.14, "sine", 0.05, i * 0.05)); },
    miss() { this.tone(150, 0.18, "sawtooth", 0.035); },
    fanfare() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.45, "triangle", 0.08, i * 0.09)); },
  };

  // ------------------------------------------------------------ ekranlar
  let screen = "loading";
  function show(name) {
    // isim kutusunda kalan odak klavye kisayollarini engellemesin
    if (name !== "name" && document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    screen = name;
    document.querySelectorAll(".screen").forEach((s) => s.removeAttribute("data-active"));
    const map = { loading: "#scrLoading", home: "#scrHome", name: "#scrName", play: "#scrPlay", result: "#scrResult" };
    $(map[name]).setAttribute("data-active", "");
    if (name === "name") $("#scrHome").setAttribute("data-active", "");  // ismin arkasinda ana ekran kalsin
    document.body.classList.toggle("playing", name === "play");
    if (name === "home" || name === "name") mountCam($("#homeCamStage"));
    if (name === "play") mountCam($("#playCamStage"));
  }
  function loading(text, hint = "") { $("#loadingText").textContent = text; $("#loadingHint").textContent = hint; }

  function applyTexts() {
    // baslik: her harf sirayla bir Google rengi (kelimeler bolunmesin)
    const title = settings.title || DEFAULTS.title;
    let ci = 0;
    $("#eventTitle").innerHTML = title.split(/(\s+)/).map((w) => /^\s+$/.test(w) ? " " :
      `<span class="word">${[...w].map((ch) => `<span class="ch c${ci++ % 4}">${escapeHtml(ch)}</span>`).join("")}</span>`).join("");
    $("#eventTitle").setAttribute("aria-label", title);
    $("#clubName").textContent = settings.club || "";
    document.title = settings.title || DEFAULTS.title;
  }

  // ------------------------------------------------------------ sarkilar
  let songs = [];
  async function loadSongs() {
    let builtins = [];
    try {
      const r = await fetch(TEST.songs || "sarkilar/sarkilar.json", { cache: "no-cache" });
      const j = await r.json();
      builtins = (j.songs || []).map((s) => Object.assign({}, s, { builtin: true, src: s.file }));
    } catch (e) { console.warn("sarkilar.json okunamadi", e); }
    const over = store.get("dc.songOverrides", {});
    const hidden = store.get("dc.hiddenSongs", []);
    builtins = builtins.filter((s) => !hidden.includes(s.id)).map((s) => Object.assign(s, over[s.id] || {}));
    let user = [];
    try {
      user = (await idb.all("songs")) || [];
      for (const u of user) {
        const blob = await idb.get("videos", u.id);
        if (blob) { u.src = URL.createObjectURL(blob); u.builtin = false; }
      }
    } catch (e) { console.warn("IndexedDB kullanilamiyor", e); }
    songs = builtins.concat(user.filter((u) => u.src));
    if (!songs.find((s) => s.id === settings.songId)) settings.songId = songs[0] ? songs[0].id : "";
  }
  const currentSong = () => songs.find((s) => s.id === settings.songId) || songs[0] || null;

  // ------------------------------------------------------------ skor tablosu
  const boardKey = (id) => "dc.board." + id;
  const getBoard = (id) => store.get(boardKey(id), []);
  function addToBoard(id, entry) {
    const b = getBoard(id);
    entry.key = Date.now() + Math.random();
    b.push(entry);
    b.sort((x, y) => y.points - x.points || y.acc - x.acc);
    const top = b.slice(0, 10);
    store.set(boardKey(id), top);
    const i = top.findIndex((e) => e.key === entry.key);
    return { rank: i >= 0 ? i + 1 : null, key: entry.key, size: top.length };
  }

  // ------------------------------------------------------------ pose (MediaPipe)
  const poseSys = {
    pose: null, ready: false, busy: false, complexity: null, _res: null,
    async init(complexity) {
      if (!window.Pose) throw new Error("Pose kütüphanesi yüklenemedi");
      if (!this.pose) {
        this.pose = new window.Pose({ locateFile: (f) => "lib/pose/" + f });
        this.pose.onResults((r) => { const res = this._res; this._res = null; if (res) res(r); });
      }
      this.ready = false;
      this.pose.setOptions({ modelComplexity: complexity, smoothLandmarks: true, enableSegmentation: false,
        minDetectionConfidence: 0.5, minTrackingConfidence: 0.5, selfieMode: false });
      await this.pose.initialize();
      this.complexity = complexity; this.ready = true;
    },
    async detect(img) {
      if (this.busy || !this.ready) return null;
      this.busy = true;
      try {
        const got = new Promise((r) => { this._res = r; });
        await Promise.race([this.pose.send({ image: img }), sleep(4000)]);
        return await Promise.race([got, sleep(500).then(() => null)]);
      } catch (e) { console.warn("pose hatasi", e); return null; }
      finally { this.busy = false; this._res = null; }
    },
    reset() { try { this.pose && this.pose.reset(); } catch (e) { /* yok */ } },
  };

  // ------------------------------------------------------------ kamera
  const cam = { video: document.createElement("video"), overlay: document.createElement("canvas"), stream: null, ok: false, aspect: 4 / 3, label: "", msg: null };
  cam.video.muted = true; cam.video.playsInline = true; cam.video.autoplay = true;
  cam.video.setAttribute("muted", ""); cam.video.setAttribute("playsinline", "");
  const camCtx = cam.overlay.getContext("2d");
  let camMsgEl = null;

  function mountCam(stage) {
    if (cam.video.parentElement !== stage) stage.append(cam.video, cam.overlay);
    if (camMsgEl && camMsgEl.parentElement !== stage) stage.append(camMsgEl);
  }
  function camMessage(title, body) {
    if (!camMsgEl) { camMsgEl = document.createElement("div"); camMsgEl.className = "cam-msg"; }
    if (!title) { camMsgEl.remove(); return; }
    camMsgEl.innerHTML = `<div><b>${escapeHtml(title)}</b>${escapeHtml(body || "")}</div>`;
    const stage = cam.video.parentElement; if (stage) stage.append(camMsgEl);
  }
  function stopCamera() {
    if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
    cam.stream = null; cam.ok = false;
  }
  function camErrorText(e) {
    const n = e && e.name;
    if (n === "NotAllowedError" || n === "SecurityError") return ["Kamera izni verilmedi", "Adres çubuğundaki kamera simgesine tıklayıp izin ver, sonra sayfayı yenile."];
    if (n === "NotFoundError" || n === "DevicesNotFoundError") return ["Kamera bulunamadı", "Kameranın bağlı olduğundan emin ol."];
    if (n === "NotReadableError" || n === "TrackStartError" || n === "AbortError") return ["Kamera kullanımda", "Zoom, Teams, Discord veya DroidCam gibi kamerayı kullanan uygulamaları kapat, sonra sayfayı yenile."];
    return ["Kamera açılamadı", (e && e.message) || ""];
  }
  async function startCamera() {
    stopCamera();
    $("#camChip").textContent = "Kamera açılıyor…"; $("#camChip").className = "chip";
    try {
      if (TEST.cam) {
        cam.video.srcObject = null; cam.video.src = TEST.cam; cam.video.loop = true;
        await cam.video.play().catch(() => {});
        if (cam.video.readyState < 1) await onceEvent(cam.video, "loadedmetadata");
        cam.label = "Test videosu";
      } else {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw Object.assign(new Error("Bu tarayıcı kamerayı desteklemiyor ya da sayfa güvenli adresten (https veya localhost) açılmadı."), { name: "Unsupported" });
        }
        const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
        if (settings.cameraId) video.deviceId = { exact: settings.cameraId };
        let stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video }); }
        catch (e) {
          if (settings.cameraId && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
            settings.cameraId = ""; saveSettings(); delete video.deviceId;
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
          } else throw e;
        }
        cam.stream = stream;
        cam.video.src = ""; cam.video.srcObject = stream;
        await cam.video.play().catch(() => {});
        if (cam.video.readyState < 1) await onceEvent(cam.video, "loadedmetadata");
        const track = stream.getVideoTracks()[0];
        cam.label = (track && track.label) || "Kamera";
        const st = track && track.getSettings ? track.getSettings() : {};
        if (st.deviceId && !settings.cameraId) { /* varsayilan kamera; secim kaydedilmez */ }
      }
      cam.aspect = (cam.video.videoWidth || 4) / (cam.video.videoHeight || 3);
      cam.ok = true;
      camMessage(null);
      $("#camChip").textContent = cam.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*/i, "");
      $("#camChip").className = "chip ok";
      fillCameraList();
    } catch (e) {
      console.warn("kamera", e);
      cam.ok = false;
      const [t, b] = e.name === "Unsupported" ? ["Kamera kullanılamıyor", e.message] : camErrorText(e);
      camMessage(t, b);
      $("#camChip").textContent = t; $("#camChip").className = "chip bad";
    }
  }
  async function fillCameraList() {
    const sel = $("#setCamera");
    if (TEST.cam) { sel.innerHTML = `<option>Test videosu</option>`; return; }
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      const cur = cam.stream && cam.stream.getVideoTracks()[0] && cam.stream.getVideoTracks()[0].getSettings().deviceId;
      sel.innerHTML = devs.map((d, i) => `<option value="${escapeHtml(d.deviceId)}"${d.deviceId === cur ? " selected" : ""}>${escapeHtml(d.label || "Kamera " + (i + 1))}</option>`).join("");
    } catch (e) { /* yok */ }
  }

  // ------------------------------------------------------------ eklem cizimi
  const COLORS = { PERFECT: "#34a853", GREAT: "#4285f4", GOOD: "#fbbc05", MISS: "#ea4335" };
  function segColor(d) {
    if (d == null || Number.isNaN(d)) return "rgba(255,255,255,.55)";
    return d < 18 ? COLORS.PERFECT : d < 30 ? COLORS.GREAT : d < 45 ? COLORS.GOOD : COLORS.MISS;
  }
  function sizeCanvas(c) {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return dpr;
  }
  /** normalize nokta -> ekrandaki (ayna, object-fit: cover) */
  function mapPt(p, W, H, vw, vh) {
    const s = Math.max(W / vw, H / vh), ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    return [W - (ox + p[0] * vw * s), oy + p[1] * vh * s];
  }
  function drawSkeleton(ctx, pts, W, H, vw, vh, segDiff, scale = 1, mapper = mapPt) {
    if (!pts) return;
    const P = pts.map((p) => mapper(p, W, H, vw, vh));
    const vis = (i) => pts[i][2] >= 0.5;
    const lw = Math.max(4, Math.min(W, H) * 0.018) * scale;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const line = (a, b) => { ctx.beginPath(); ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]); ctx.stroke(); };
    // govde (golge efekti yerine genis yari saydam alt cizgi: ekran karti icin cok daha ucuz)
    const torso = [[0, 1], [6, 7], [0, 6], [1, 7]].filter(([a, b]) => vis(a) && vis(b));
    ctx.strokeStyle = "rgba(66,133,244,.35)"; ctx.lineWidth = lw * 1.6; torso.forEach(([a, b]) => line(a, b));
    ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = lw * 0.6; torso.forEach(([a, b]) => line(a, b));
    // bas: omuzlarin ustunde
    if (vis(0) && vis(1)) {
      const mx = (P[0][0] + P[1][0]) / 2, my = (P[0][1] + P[1][1]) / 2;
      const sw = Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1]);
      ctx.beginPath(); ctx.arc(mx, my - sw * 0.62, sw * 0.26, 0, Math.PI * 2); ctx.stroke();
    }
    // uzuvlar: isabetine gore renkli (once parlama, sonra cizgi)
    const limbs = [];
    for (let s = 0; s < 8; s++) {
      const [a, b] = E.SEGS[s];
      if (vis(a) && vis(b)) limbs.push([a, b, segDiff ? segColor(segDiff[s]) : "#ffffff"]);
    }
    ctx.globalAlpha = 0.35; ctx.lineWidth = lw * 2.2;
    for (const [a, b, col] of limbs) { ctx.strokeStyle = col; line(a, b); }
    ctx.globalAlpha = 1; ctx.lineWidth = lw;
    for (const [a, b, col] of limbs) { ctx.strokeStyle = col; line(a, b); }
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 12; i++) if (vis(i)) { ctx.beginPath(); ctx.arc(P[i][0], P[i][1], lw * 0.42, 0, Math.PI * 2); ctx.fill(); }
  }

  // ------------------------------------------------------------ canli dongu
  const live = { pts: null, at: 0, segDiff: null, poseCount: 0, frameCount: 0, fpsT: performance.now(), poseFps: 0, loopFps: 0 };
  let lastCamTime = -1;
  let analyzing = false;
  let sim = null; // test: hazir eklem verisi
  const simAt = (t) => { if (!sim) return null; const k = Math.round(t * sim.fps); return k >= 0 && k < sim.frames.length ? sim.frames[k] : null; };

  function onPose(pts) {
    live.pts = pts; live.at = performance.now(); live.poseCount++;
    if (game.state === "play") game.onPose(pts);
  }

  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    live.frameCount++;
    if (now - live.fpsT > 1000) {
      live.poseFps = live.poseCount * 1000 / (now - live.fpsT); live.loopFps = live.frameCount * 1000 / (now - live.fpsT);
      live.poseCount = 0; live.frameCount = 0; live.fpsT = now;
      if (settings.fps) { $("#fps").hidden = false; $("#fps").textContent = `Algılama ${live.poseFps.toFixed(0)} fps · Ekran ${live.loopFps.toFixed(0)} fps`; }
      else $("#fps").hidden = true;
    }
    if (cam.ok && !analyzing && cam.video.readyState >= 2) {
      if (sim) {
        /* test modu: eklemler setInterval ile geliyor (asagida) */
      } else if (!poseSys.busy && poseSys.ready && cam.video.currentTime !== lastCamTime) {
        lastCamTime = cam.video.currentTime;
        poseSys.detect(cam.video).then((r) => { if (r) onPose(E.fromMediaPipe(r.poseLandmarks)); });
      }
    }
    // kisi 1.2 sn'dir gorulmediyse yok say
    if (now - live.at > 1200 && !sim) live.pts = null;
    draw();
    game.update(now);
    fx.step();
  }

  function draw() {
    const c = cam.overlay;
    if (!c.isConnected || analyzing) return;
    const dpr = sizeCanvas(c);
    const W = c.width, H = c.height;
    camCtx.clearRect(0, 0, W, H);
    if (!cam.ok) return;
    const vw = cam.video.videoWidth || 640, vh = cam.video.videoHeight || 480;
    const sd = game.state === "play" ? live.segDiff : null;
    drawSkeleton(camCtx, live.pts, W, H, vw, vh, sd, dpr * 0.8);
    // ana ekran: vucut durumu
    if (screen === "home") {
      const ok = bodyStatus(live.pts) >= 1;
      $("#bodyChip").hidden = !ok;
      $("#bodyChip").className = "chip ok";
    }
  }

  /** 0: yok, 1: ust vucut tamam, 2: tam vucut */
  function bodyStatus(pts) {
    if (!pts) return 0;
    const v = (i) => pts[i][2] >= 0.5;
    const upper = v(0) && v(1) && v(6) && v(7) && (v(2) + v(3) + v(4) + v(5)) >= 2;
    if (!upper) return 0;
    return (v(8) + v(9) + v(10) + v(11)) >= 3 ? 2 : 1;
  }

  // ------------------------------------------------------------ efektler (parcaciklar)
  const fx = {
    canvas: $("#fxCanvas"), ctx: $("#fxCanvas").getContext("2d"), parts: [],
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    burst(x, y, colors, n) {
      if (this.reduced) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
        this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, life: 1, c: colors[i % colors.length], r: 4 + Math.random() * 7, rot: Math.random() * 6 });
      }
    },
    dirty: false,
    step() {
      const c = this.canvas;
      if (screen !== "play") { if (this.parts.length) this.parts = []; }
      if (!this.parts.length) {
        if (this.dirty) { this.ctx.clearRect(0, 0, c.width, c.height); this.dirty = false; }
        return;
      }
      sizeCanvas(c); this.dirty = true;
      const ctx = this.ctx; ctx.clearRect(0, 0, c.width, c.height);
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      this.parts = this.parts.filter((p) => p.life > 0);
      for (const p of this.parts) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.vx *= 0.985; p.life -= 0.018; p.rot += 0.2;
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x * dpr, p.y * dpr); ctx.rotate(p.rot);
        ctx.fillRect(-p.r * dpr / 2, -p.r * dpr / 4, p.r * dpr, p.r * dpr / 2); ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
  };

  // ------------------------------------------------------------ fotograf (en iyi an)
  const photo = { shot: document.createElement("canvas"), has: false };
  photo.shot.width = 640; photo.shot.height = 640;
  function capturePhoto(pts, segDiff) {
    if (!cam.ok || cam.video.readyState < 2) return;
    const vw = cam.video.videoWidth, vh = cam.video.videoHeight;
    const ctx = photo.shot.getContext("2d");
    const side = Math.min(vw, vh);
    // kisiyi ortala (omuz-kalca merkezi)
    let cx = vw / 2;
    if (pts && pts[0][2] > 0.5 && pts[1][2] > 0.5) cx = ((pts[0][0] + pts[1][0]) / 2) * vw;
    const sx = clamp(cx - side / 2, 0, vw - side), sy = (vh - side) / 2;
    ctx.save(); ctx.translate(640, 0); ctx.scale(-1, 1);
    ctx.drawImage(cam.video, sx, sy, side, side, 0, 0, 640, 640);
    ctx.restore();
    // iskelet (kirpilmis kareye gore)
    const mapper = (p) => [640 - ((p[0] * vw - sx) / side) * 640, ((p[1] * vh - sy) / side) * 640];
    drawSkeleton(ctx, pts, 640, 640, vw, vh, segDiff, 0.9, mapper);
    photo.has = true;
  }
  async function composePolaroid(r) {
    const c = $("#photoCanvas"), ctx = c.getContext("2d");
    try { await Promise.all([document.fonts.load("40px Bungee"), document.fonts.load("700 30px Outfit")]); } catch (e) { /* yok */ }
    ctx.fillStyle = "#fbfaf6"; ctx.fillRect(0, 0, 720, 900);
    if (photo.has) ctx.drawImage(photo.shot, 40, 40, 640, 640);
    else { ctx.fillStyle = "#1d2063"; ctx.fillRect(40, 40, 640, 640); }
    ctx.fillStyle = "#13154a";
    ctx.font = "700 40px Outfit, sans-serif"; ctx.textBaseline = "alphabetic";
    ctx.fillText(r.name, 44, 740, 420);
    ctx.font = "62px Bungee, sans-serif"; ctx.textAlign = "right";
    ctx.fillStyle = COLORS[r.acc >= 85 ? "PERFECT" : r.acc >= 70 ? "GREAT" : r.acc >= 55 ? "GOOD" : "MISS"];
    ctx.fillText(`%${r.acc}`, 676, 752);
    ctx.textAlign = "left";
    // yildizlar
    for (let i = 0; i < 5; i++) starPath(ctx, 58 + i * 46, 790, 18, i < r.stars ? "#fbbc05" : "#d9d9e3");
    ctx.fillStyle = "#5b5f8f"; ctx.font = "500 24px Outfit, sans-serif";
    ctx.fillText(`${r.song} · ${r.points} puan`, 44, 845, 632);
    ctx.font = "600 21px Outfit, sans-serif"; ctx.fillStyle = "#13154a";
    ["#4285f4", "#ea4335", "#fbbc05", "#34a853"].forEach((col, i) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(52 + i * 15, 871, 5.5, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = "#13154a";
    ctx.fillText(settings.club || "", 118, 878, 440);
    const d = new Date(); ctx.textAlign = "right"; ctx.fillStyle = "#8c8fb3";
    ctx.fillText(d.toLocaleDateString("tr-TR"), 676, 878); ctx.textAlign = "left";
  }
  function starPath(ctx, cx, cy, r, color) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }

  // ------------------------------------------------------------ referans analizi
  const refCache = {};
  const covers = (data, song) => {
    const t0 = data.t0 || 0;
    const t1 = data.ts && data.ts.length ? data.ts[data.ts.length - 1] : t0 + (data.frames.length - 1) / data.fps;
    return t0 <= song.start + 0.1 && t1 >= song.end - 0.25;
  };
  let analyzeCancel = false;
  async function getRef(song) {
    const c = refCache[song.id];
    if (c && covers(c.data, song)) return c.prep;
    if (song.pose) {
      try {
        const data = await (await fetch(song.pose)).json();
        if (covers(data, song)) { refCache[song.id] = { data, prep: E.prepareRef(data) }; return refCache[song.id].prep; }
      } catch (e) { console.warn("hazir analiz okunamadi", e); }
    }
    try {
      const data = await idb.get("poses", song.id);
      if (data && covers(data, song)) { refCache[song.id] = { data, prep: E.prepareRef(data) }; return refCache[song.id].prep; }
    } catch (e) { /* yok */ }
    const data = await analyzeSong(song);
    if (!data) return null;
    try { await idb.put("poses", song.id, data); } catch (e) { /* yok */ }
    refCache[song.id] = { data, prep: E.prepareRef(data) };
    return refCache[song.id].prep;
  }
  /**
   * Videoyu analiz eder. Yontem: video oynatilir, her yeni kare ekrana geldiginde durdurulur,
   * o kare isleme verilir, sonra devam eder (requestVideoFrameCallback). Bu, tarayicinin
   * gercekten gosterdigi kareyi garanti eder; sarma (seek) bazen eski kareyi verebiliyor.
   */
  async function analyzeSong(song) {
    const dlg = $("#dlgAnalyze"), box = $("#anVideoBox");
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = song.src;
    const ov = document.createElement("canvas"), octx = ov.getContext("2d");
    box.replaceChildren(v, ov);
    analyzeCancel = false; analyzing = true; document.body.classList.add("analyzing");
    $("#anBar").style.width = "0%"; $("#anPct").textContent = "%0";
    if (!dlg.open) dlg.showModal();
    const FPS = 15, frames = [], ts = [];
    const showProgress = (t, a, b) => { const pct = Math.round(clamp((t - a) / (b - a), 0, 1) * 100); $("#anBar").style.width = pct + "%"; $("#anPct").textContent = "%" + pct; };
    const drawOverlay = (pts) => {
      sizeCanvas(ov); octx.clearRect(0, 0, ov.width, ov.height);
      if (!pts) return;
      // video object-fit: contain, ayna yok
      const W = ov.width, H = ov.height, vw = v.videoWidth, vh = v.videoHeight, sc = Math.min(W / vw, H / vh);
      const ox = (W - vw * sc) / 2, oy = (H - vh * sc) / 2;
      drawSkeleton(octx, pts, W, H, vw, vh, null, 0.6, (p) => [ox + p[0] * vw * sc, oy + p[1] * vh * sc]);
    };
    const process = async (img, t) => {
      const r = await poseSys.detect(img);
      const pts = r && r.poseLandmarks ? E.fromMediaPipe(r.poseLandmarks).map((p) => p.map((x) => Math.round(x * 1e4) / 1e4)) : null;
      frames.push(pts); ts.push(Math.round(t * 1000) / 1000);
      drawOverlay(pts);
    };
    try {
      if (v.readyState < 2) await onceEvent(v, "loadeddata", 20000);
      if (sim) throw new Error("test modunda analiz yok");
      const dur = v.duration;
      const a = dur <= 120 ? 0 : Math.max(0, song.start - 1), b = dur <= 120 ? dur : Math.min(dur, song.end + 1);
      for (let i = 0; i < 200 && poseSys.busy; i++) await sleep(20);   // kameradan islenen kare bitsin
      poseSys.reset();
      v.currentTime = a; await onceEvent(v, "seeked", 10000);
      const hasRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
      /** sar ve yeni karenin gercekten ekrana gelmesini bekle; gelmezse null */
      const seekFrame = async (t) => {
        let id = 0;
        const fp = new Promise((r) => { id = v.requestVideoFrameCallback((n, m) => r(m.mediaTime)); setTimeout(() => r(null), 700); });
        v.currentTime = t; await onceEvent(v, "seeked", 8000);
        const mt = await fp;
        if (mt == null) try { v.cancelVideoFrameCallback(id); } catch (e) { /* yok */ }
        return mt;
      };
      // Bu tarayici sarinca yeni kareyi gosteriyor mu? (gercek Chrome/Edge: evet) -> her kare eksiksiz
      let seekMode = false;
      if (hasRVFC) {
        const t1 = Math.min(b, a + 0.4), t2 = Math.min(b, a + 0.8);
        const m1 = await seekFrame(t1), m2 = await seekFrame(t2);
        seekMode = m1 != null && m2 != null && Math.abs(m1 - t1) < 0.06 && Math.abs(m2 - t2) < 0.06;
        v.currentTime = a; await onceEvent(v, "seeked", 8000);
      }
      if (seekMode) {
        for (let t = a; t <= b + 1e-3; t += 1 / FPS) {
          if (analyzeCancel) throw new Error("iptal");
          const mt = await seekFrame(Math.min(dur - 0.01, t));
          await process(v, mt != null ? mt : v.currentTime);
          showProgress(t, a, b);
        }
      } else if (hasRVFC) {
        await new Promise((resolve, reject) => {
          let next = a, done = false, watchdog = 0, rewinds = 0;
          const finish = (err) => { if (done) return; done = true; clearTimeout(watchdog); v.pause(); err ? reject(err) : resolve(); };
          const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => finish(new Error("video oynatılamadı")), 15000); };
          v.addEventListener("ended", () => finish(), { once: true });
          const onFrame = async (now, meta) => {
            if (done) return;
            if (analyzeCancel) return finish(new Error("iptal"));
            const t = meta.mediaTime;
            // sayfa takildiysa video ileri kacmis olabilir: kaldigimiz yere geri sar (bosluk kalmasin)
            if (t > next + 1.5 / FPS && next < b - 0.02 && rewinds < 2) {
              rewinds++;
              v.pause();
              try { v.currentTime = next; await onceEvent(v, "seeked", 8000); } catch (e) { return finish(e); }
              arm(); v.requestVideoFrameCallback(onFrame); v.play().catch((e) => { if (e.name !== "AbortError") finish(e); });
              return;
            }
            if (t + 0.017 >= next) {
              v.pause();
              await process(v, t);
              showProgress(t, a, b);
              while (next <= t + 0.001) next += 1 / FPS;
              rewinds = 0;
              if (t >= b - 0.02) return finish();
              arm(); v.requestVideoFrameCallback(onFrame); v.play().catch((e) => { if (e.name !== "AbortError") finish(e); });
            } else v.requestVideoFrameCallback(onFrame);
          };
          v.playbackRate = 0.25;   // kareler arasi cok az ilerlesin (sayfa takilsa bile)
          arm(); v.requestVideoFrameCallback(onFrame); v.play().catch((e) => { if (e.name !== "AbortError") finish(e); });
        });
      } else {
        // eski tarayicilar: sar + tuvale ciz
        const c = document.createElement("canvas"), cx = c.getContext("2d");
        const sc = Math.min(1, 640 / v.videoWidth); c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc);
        for (let t = a; t <= b; t += 1 / FPS) {
          if (analyzeCancel) throw new Error("iptal");
          v.currentTime = Math.min(dur - 0.01, t); await onceEvent(v, "seeked", 8000);
          cx.drawImage(v, 0, 0, c.width, c.height);
          await process(c, v.currentTime); showProgress(t, a, b);
        }
      }
      const found = frames.filter(Boolean).length;
      if (found < frames.length * 0.3) toast("Videoda kişi zor algılandı. Tek kişinin önden ve tüm vücudunun göründüğü bir video daha iyi sonuç verir.", 6000);
      return { v: 2, fps: FPS, aspect: v.videoWidth / v.videoHeight, duration: dur, t0: ts[0] || a, ts, frames };
    } catch (e) {
      if (e.message !== "iptal") toast("Video analiz edilemedi: " + e.message, 5000);
      return null;
    } finally {
      analyzing = false; document.body.classList.remove("analyzing"); poseSys.reset();
      v.pause(); v.removeAttribute("src"); v.load(); box.replaceChildren();
      if (dlg.open) dlg.close();
    }
  }

  // ------------------------------------------------------------ oyun
  const refVideo = $("#refVideo");
  const game = {
    state: "idle", song: null, prep: null, session: null, name: "", readySince: 0, cdStart: 0, cdStep: -1,
    shownPoints: 0, lastJudgeAt: 0, summary: null, resultTimer: 0, returnAt: 0, lastPushT: -1,

    async begin(name) {
      const song = currentSong();
      if (!song) { toast("Önce bir şarkı ekle (Ayarlar > Şarkılar)."); return show("home"); }
      if (!cam.ok) { toast("Kamera çalışmıyor. Kamera kartındaki mesaja bak."); return show("home"); }
      this.name = (name || "").trim() || "Misafir";
      this.song = song;
      sfx.ensure();
      const prep = await getRef(song);
      if (!prep) return show("home");
      this.prep = prep;
      refVideo.src = song.src; refVideo.muted = TEST.mute; refVideo.loop = false;
      try { if (refVideo.readyState < 1) await onceEvent(refVideo, "loadedmetadata", 15000); } catch (e) { toast("Şarkı videosu açılamadı."); return show("home"); }
      refVideo.currentTime = song.start;
      $("#hudSong").textContent = song.title;
      $("#hudPlayer").textContent = this.name;
      $("#hudPoints").textContent = "0"; this.shownPoints = 0;
      $("#hudCombo").hidden = true; $("#hudProgress").style.width = "0%";
      $("#judge").innerHTML = ""; $("#playCamPanel").removeAttribute("data-j");
      photo.has = false; live.segDiff = null;
      show("play");
      this.state = "ready"; this.readySince = 0;
      $("#readyGuide").hidden = false; $("#readyGuide").classList.remove("ok");
      $("#countdown").innerHTML = "";
    },

    startCountdown() {
      if (this.state !== "ready") return;
      this.state = "countdown"; this.cdStart = performance.now(); this.cdStep = -1;
      $("#readyGuide").hidden = true;
    },

    go() {
      this.state = "play";
      this.session = new E.Session(this.prep, { start: this.song.start, end: this.song.end, latency: settings.latency,
        mirror: settings.mirror, difficulty: settings.difficulty });
      this.lastPushT = -1; window.__app.events = []; window.__app.pushes = 0;
      refVideo.currentTime = this.song.start;
      const p = refVideo.play();
      if (p && p.catch) p.catch(() => { refVideo.muted = true; refVideo.play().catch(() => {}); toast("Ses otomatik başlatılamadı."); });
      if (TEST.cam) { try { cam.video.currentTime = this.song.start; } catch (e) { /* yok */ } }
    },

    onPose(pts) {
      if (this.state !== "play" || !this.session) return;
      const t = refVideo.currentTime;
      if (t === this.lastPushT || t < this.song.start) return;
      this.lastPushT = t;
      const r = this.session.push(t, pts, cam.aspect);
      window.__app.pushes++;
      live.segDiff = r.segDiff;
      for (const ev of r.events) this.onEvent(ev);
      if (r.newBest && r.score >= 40) capturePhoto(pts, r.segDiff);
    },

    onEvent(ev) {
      window.__app.events.push(Object.assign({ vt: +refVideo.currentTime.toFixed(2) }, ev));
      if (ev.type !== "judge") return;
      const j = $("#judge");
      j.innerHTML = `<span class="word" data-l="${ev.label}">${ev.label}</span>` + (ev.points ? `<span class="plus">+${ev.points}</span>` : "");
      const panel = $("#playCamPanel"); panel.setAttribute("data-j", ev.label);
      document.body.classList.remove("flash-PERFECT"); void document.body.offsetWidth;
      if (ev.label === "PERFECT") document.body.classList.add("flash-PERFECT");
      const combo = $("#hudCombo");
      if (ev.combo >= 2) { combo.hidden = false; $("#hudComboN").textContent = ev.combo; combo.classList.remove("bump"); void combo.offsetWidth; combo.classList.add("bump"); }
      else combo.hidden = true;
      const rect = panel.getBoundingClientRect(), host = $("#scrPlay").getBoundingClientRect();
      const x = rect.left - host.left + rect.width / 2, y = rect.top - host.top + rect.height * 0.25;
      if (ev.label === "PERFECT") { fx.burst(x, y, [COLORS.PERFECT, COLORS.GREAT, COLORS.GOOD, COLORS.MISS], 46); sfx.perfect(); }
      else if (ev.label === "GREAT") { fx.burst(x, y, [COLORS.GREAT, "#ffffff"], 22); sfx.great(); }
      else if (ev.label === "MISS") sfx.miss();
      this.lastJudgeAt = performance.now();
    },

    update(now) {
      if (this.state === "ready") {
        const st = bodyStatus(live.pts);
        const g = $("#readyGuide");
        if (st >= 1) {
          if (!this.readySince) this.readySince = now;
          g.classList.add("ok");
          $("#readyText").textContent = st === 2 ? "Harika, hazırsın!" : "Hazırsın! Bacakların da görünürse daha iyi olur";
          if (now - this.readySince > (st === 2 ? 900 : 1800)) this.startCountdown();
        } else {
          this.readySince = 0; g.classList.remove("ok");
          $("#readyText").textContent = live.pts ? "Biraz geri çekil, kolların ve kalçan görünsün" : "Kameranın karşısına geç, tüm vücudun görünsün";
        }
      } else if (this.state === "countdown") {
        // takilma olup adim atlansa bile 3. adimda (DANS!) oyun mutlaka baslar
        const step = Math.min(3, Math.floor((now - this.cdStart) / 800));
        if (step !== this.cdStep) {
          this.cdStep = step;
          const seq = [["3", "--blue"], ["2", "--red"], ["1", "--yellow"], ["DANS!", "--green"]];
          const [txt, col] = seq[step];
          $("#countdown").innerHTML = `<span class="n" style="--c: var(${col}); ${step === 3 ? "font-size: clamp(90px, 14vw, 230px)" : ""}">${txt}</span>`;
          if (step < 3) sfx.tick(); else { sfx.go(); this.go(); }
        }
      } else if (this.state === "play") {
        const t = refVideo.currentTime, s = this.song;
        $("#hudProgress").style.width = clamp((t - s.start) / (s.end - s.start), 0, 1) * 100 + "%";
        if (this.state === "play" && this.cdStep >= 3 && now - this.cdStart > 4000) $("#countdown").innerHTML = "";
        if (t >= s.end - 0.02 || refVideo.ended) this.finish();
        if (now - this.lastJudgeAt > 1200) $("#playCamPanel").removeAttribute("data-j");
      }
      // puan sayaci yumusak artsin
      if (this.session && (this.state === "play")) {
        const target = this.session.points;
        if (this.shownPoints !== target) {
          this.shownPoints += Math.max(1, Math.round((target - this.shownPoints) * 0.18));
          if (this.shownPoints > target) this.shownPoints = target;
          $("#hudPoints").textContent = this.shownPoints.toLocaleString("tr-TR");
        }
      }
      if (screen === "result" && this.returnAt) {
        const left = Math.ceil((this.returnAt - now) / 1000);
        $("#resAuto").textContent = left > 0 ? `${left} sn sonra ana ekrana dönülecek` : "";
        if (left <= 0) { this.returnAt = 0; goHome(); }
      }
    },

    async finish() {
      if (this.state !== "play") return;
      this.state = "done";
      refVideo.pause();
      const sum = this.session.finish();
      for (const ev of sum.events) if (ev.type === "judge") this.onEvent(ev);
      this.summary = sum;
      if (!photo.has) capturePhoto(live.pts, live.segDiff);
      const entry = { name: this.name, points: sum.points, acc: sum.accuracy, stars: sum.stars, date: Date.now() };
      const placed = addToBoard(this.song.id, entry);
      this.lastPlaced = placed;
      await sleep(700);
      if (this.state !== "done") return;   // bu arada Esc ile cikildiysa
      showResult(sum, placed);
    },

    abort() {
      refVideo.pause();
      this.state = "idle"; this.session = null;
      $("#countdown").innerHTML = "";
    },
  };

  const TITLES = { 5: "Sahnenin yıldızı", 4: "Ritim ustası", 3: "Gayet iyi", 2: "Isınıyorsun", 1: "Bir tur daha?" };
  function showResult(sum, placed) {
    show("result");
    sfx.fanfare();
    $("#resName").textContent = game.name;
    $("#resTitle").textContent = TITLES[sum.stars];
    $("#resPoints").textContent = sum.points.toLocaleString("tr-TR");
    $("#resCombo").textContent = sum.maxCombo;
    $("#resRank").textContent = placed.rank ? `${placed.rank}.` : "İlk 10 dışı";
    const st = $("#resStars"); st.setAttribute("aria-label", `${sum.stars} yıldız`);
    st.innerHTML = [1, 2, 3, 4, 5].map((i) => `<svg viewBox="0 0 24 24" class="${i <= sum.stars ? "on" : "off"}" style="animation-delay:${0.5 + i * 0.12}s"><path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z"/></svg>`).join("");
    const cnt = sum.counts;
    $("#resCounts").innerHTML = [["PERFECT", "--green"], ["GREAT", "--blue"], ["GOOD", "--yellow"], ["MISS", "--red"]]
      .map(([k, c]) => `<span class="c" style="--cc: var(${c})">${k}<b>${cnt[k]}</b></span>`).join("");
    // yuzde sayaci
    const target = sum.accuracy, t0 = performance.now();
    const tick = () => { const p = Math.min(1, (performance.now() - t0) / 1200); $("#resAcc").textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
    tick();
    composePolaroid({ name: game.name, acc: sum.accuracy, stars: sum.stars, points: sum.points, song: game.song.title });
    game.returnAt = settings.autoReturn > 0 ? performance.now() + settings.autoReturn * 1000 : 0;
    if (!game.returnAt) $("#resAuto").textContent = "";
    window.__app.lastResult = { summary: sum, placed, name: game.name, song: game.song.id };
  }

  function goHome() {
    game.abort();
    game.returnAt = 0;
    renderHome();
    show("home");
  }

  // ------------------------------------------------------------ ana ekran
  function renderHome() {
    const list = $("#songList");
    list.innerHTML = "";
    if (!songs.length) {
      list.innerHTML = `<p class="hint">Henüz şarkı yok. "Şarkıları yönet" ile bir dans videosu ekle.</p>`;
    }
    for (const s of songs) {
      const best = getBoard(s.id)[0];
      const b = document.createElement("button");
      b.className = "song"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(s.id === settings.songId));
      b.innerHTML = `<span class="disc" aria-hidden="true"></span><span><span class="name">${escapeHtml(s.title)}</span><br><span class="meta">${Math.round(s.end - s.start)} sn${best ? " · rekor: " + escapeHtml(best.name) : ""}</span></span><span class="best">${best ? best.points.toLocaleString("tr-TR") : ""}</span>`;
      b.addEventListener("click", () => { settings.songId = s.id; saveSettings(); renderHome(); });
      list.append(b);
    }
    const song = currentSong();
    $("#boardSong").textContent = song ? "· " + song.title : "";
    const board = song ? getBoard(song.id) : [];
    const fresh = game.lastPlaced && game.lastPlaced.key;
    $("#boardList").innerHTML = board.length
      ? board.slice(0, 5).map((e, i) => `<li class="${e.key === fresh ? "fresh" : ""}"><span class="rk">${i + 1}</span><span class="nm">${escapeHtml(e.name)}</span><span class="st">${"★".repeat(e.stars)}</span><span class="pt">${e.points.toLocaleString("tr-TR")}</span></li>`).join("")
      : `<li class="empty">Henüz skor yok. İlk sen ol!</li>`;
    $("#btnStart").disabled = !song;
  }

  function openName() {
    if (!currentSong()) { toast("Önce bir şarkı ekle."); return; }
    show("name");
    const inp = $("#nameInput"); inp.value = ""; inp.focus(); setTimeout(() => inp.focus(), 50);
  }

  // ------------------------------------------------------------ ayarlar
  const dlgS = $("#dlgSettings");
  function openSettings(tab = "tabGame") {
    $("#setDifficulty").value = settings.difficulty;
    $("#setMirror").value = settings.mirror;
    $("#setLatency").value = settings.latency; $("#latencyVal").textContent = (+settings.latency).toFixed(2);
    $("#setModel").value = String(settings.model);
    $("#setFps").checked = settings.fps;
    $("#setTitle").value = settings.title; $("#setClub").value = settings.club;
    $("#setAutoReturn").value = String(settings.autoReturn);
    fillCameraList(); renderSongAdmin(); selectTab(tab);
    if (!dlgS.open) dlgS.showModal();
  }
  function selectTab(id) {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === id)));
    document.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = p.id !== id; });
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));
  $("#setCamera").addEventListener("change", (e) => { settings.cameraId = e.target.value; saveSettings(); startCamera(); });
  $("#setDifficulty").addEventListener("change", (e) => { settings.difficulty = e.target.value; saveSettings(); });
  $("#setMirror").addEventListener("change", (e) => { settings.mirror = e.target.value; saveSettings(); });
  $("#setLatency").addEventListener("input", (e) => { settings.latency = +e.target.value; $("#latencyVal").textContent = settings.latency.toFixed(2); saveSettings(); });
  $("#setModel").addEventListener("change", async (e) => {
    settings.model = +e.target.value; saveSettings();
    if (!sim) { toast("Model değiştiriliyor…"); try { await poseSys.init(settings.model); toast("Hazır."); } catch (err) { toast("Model yüklenemedi: " + err.message); } }
  });
  $("#setFps").addEventListener("change", (e) => { settings.fps = e.target.checked; saveSettings(); });
  $("#setTitle").addEventListener("input", (e) => { settings.title = e.target.value; saveSettings(); applyTexts(); });
  $("#setClub").addEventListener("input", (e) => { settings.club = e.target.value; saveSettings(); applyTexts(); });
  $("#setAutoReturn").addEventListener("change", (e) => { settings.autoReturn = +e.target.value; saveSettings(); });
  armButton($("#btnResetBoard"), "Emin misin? Tekrar bas", () => {
    const s = currentSong(); if (!s) return;
    store.set(boardKey(s.id), []); renderHome(); toast(`"${s.title}" skor tablosu sıfırlandı.`);
  });
  /** iki asamali onay: ilk tik "emin misin", 4 sn icinde ikinci tik islemi yapar */
  function armButton(btn, armedText, action) {
    const orig = btn.textContent; let t = 0;
    btn.addEventListener("click", () => {
      if (btn.classList.contains("armed")) { clearTimeout(t); btn.classList.remove("armed"); btn.textContent = orig; action(); return; }
      btn.classList.add("armed"); btn.textContent = armedText;
      t = setTimeout(() => { btn.classList.remove("armed"); btn.textContent = orig; }, 6000);
    });
  }

  // ------------------------------------------------------------ sarki yonetimi
  function renderSongAdmin() {
    const el = $("#songAdmin");
    el.innerHTML = songs.length ? "" : `<p class="hint">Liste boş.</p>`;
    for (const s of songs) {
      const row = document.createElement("div"); row.className = "item";
      row.innerHTML = `<div><b>${escapeHtml(s.title)}</b><small>${fmtSec(s.start)} – ${fmtSec(s.end)} · ${s.builtin ? "uygulama klasöründen" : "bu bilgisayarda eklendi"}</small></div>`;
      const b = document.createElement("button"); b.type = "button"; b.className = "ghost-btn"; b.textContent = "Düzenle";
      b.addEventListener("click", () => openSongEditor(s));
      row.append(b); el.append(row);
    }
    const hidden = store.get("dc.hiddenSongs", []);
    if (hidden.length) {
      const r = document.createElement("button"); r.type = "button"; r.className = "link-btn"; r.textContent = `Gizlenen ${hidden.length} şarkıyı geri getir`;
      r.addEventListener("click", async () => { store.set("dc.hiddenSongs", []); await loadSongs(); renderSongAdmin(); renderHome(); });
      el.append(r);
    }
  }

  $("#addSongInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file) return;
    const id = "u_" + Date.now();
    const url = URL.createObjectURL(file);
    const v = document.createElement("video"); v.muted = true; v.preload = "metadata"; v.src = url;
    try { await onceEvent(v, "loadedmetadata", 15000); } catch (err) { toast("Bu video açılamadı. MP4 formatında bir video dene."); return; }
    const dur = v.duration;
    const song = { id, title: file.name.replace(/\.[^.]+$/, "").slice(0, 40), start: 0, end: Math.min(dur, 45), duration: dur, builtin: false, src: url };
    try { await idb.put("videos", id, file); await idb.put("songs", id, { id, title: song.title, start: song.start, end: song.end, duration: dur }); }
    catch (err) { toast("Video bu tarayıcıya kaydedilemedi (gizli pencere olabilir). Sadece bu oturumda kullanılabilir.", 6000); }
    songs.push(song); settings.songId = id; saveSettings();
    renderSongAdmin(); renderHome();
    openSongEditor(song, true);
  });

  let editing = null;
  const dlgSong = $("#dlgSong");
  function openSongEditor(song, isNew) {
    editing = { song, start: song.start, end: song.end, isNew };
    $("#songTitle").value = song.title;
    const v = $("#editVideo"); v.src = song.src; v.currentTime = song.start;
    updateSeg();
    $("#btnSongDelete").textContent = song.builtin ? "Listeden gizle" : "Şarkıyı sil";
    $("#btnSongDelete").classList.remove("armed");
    dlgSong.showModal();
  }
  function updateSeg() {
    $("#segStart").textContent = fmtSec(editing.start); $("#segEnd").textContent = fmtSec(editing.end);
    $("#segLen").textContent = Math.round(editing.end - editing.start) + " sn";
  }
  $("#btnSegStart").addEventListener("click", () => { editing.start = $("#editVideo").currentTime; if (editing.end <= editing.start + 3) editing.end = Math.min($("#editVideo").duration, editing.start + 40); updateSeg(); });
  $("#btnSegEnd").addEventListener("click", () => { const t = $("#editVideo").currentTime; if (t <= editing.start + 3) { toast("Bitiş, başlangıçtan en az 3 sn sonra olmalı."); return; } editing.end = t; updateSeg(); });
  $("#btnSongSave").addEventListener("click", async () => {
    const s = editing.song;
    s.title = $("#songTitle").value.trim() || s.title; s.start = editing.start; s.end = editing.end;
    if (s.builtin) {
      const over = store.get("dc.songOverrides", {}); over[s.id] = { title: s.title, start: s.start, end: s.end }; store.set("dc.songOverrides", over);
    } else {
      try { await idb.put("songs", s.id, { id: s.id, title: s.title, start: s.start, end: s.end, duration: s.duration }); } catch (e) { /* yok */ }
    }
    $("#editVideo").pause(); dlgSong.close();
    renderSongAdmin(); renderHome();
    // analizi simdi yap ki stantta beklenmesin
    if (!sim) { const ok = await getRef(s); if (ok) toast(`"${s.title}" hazır.`); }
  });
  armButton($("#btnSongDelete"), "Emin misin? Tekrar bas", async () => {
    const s = editing.song;
    if (s.builtin) { const h = store.get("dc.hiddenSongs", []); h.push(s.id); store.set("dc.hiddenSongs", h); }
    else { try { await idb.del("videos", s.id); await idb.del("songs", s.id); await idb.del("poses", s.id); } catch (e) { /* yok */ } }
    delete refCache[s.id];
    $("#editVideo").pause(); dlgSong.close();
    await loadSongs(); renderSongAdmin(); renderHome();
  });
  dlgSong.addEventListener("close", () => $("#editVideo").pause());
  $("#btnAnCancel").addEventListener("click", () => { analyzeCancel = true; });

  // ------------------------------------------------------------ butonlar ve klavye
  $("#btnStart").addEventListener("click", openName);
  $("#nameForm").addEventListener("submit", (e) => { e.preventDefault(); game.begin($("#nameInput").value); });
  $("#btnNameBack").addEventListener("click", () => show("home"));
  $("#btnAgain").addEventListener("click", () => game.begin(game.name));
  $("#btnHome").addEventListener("click", goHome);
  $("#btnDownload").addEventListener("click", downloadPhoto);
  $("#btnSettings").addEventListener("click", () => openSettings());
  $("#btnManageSongs").addEventListener("click", () => openSettings("tabSongs"));
  $("#btnFullscreen").addEventListener("click", toggleFullscreen);
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => toast("Tam ekran açılamadı. F11 tuşunu dene."));
  }
  function downloadPhoto() {
    $("#photoCanvas").toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a"); a.href = URL.createObjectURL(b);
      a.download = `dans-${(game.name || "oyuncu").replace(/[^\wçğıöşüÇĞİÖŞÜ-]+/g, "_")}-${game.summary ? game.summary.accuracy : 0}.png`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, "image/png");
  }

  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;            // modal acikken kisayol yok
    const typing = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT");
    if (typing && e.key !== "Escape") return;
    const k = e.key.toLowerCase();
    if (k === "f") { toggleFullscreen(); return; }
    if (screen === "home") {
      if (k === " " || k === "enter") { e.preventDefault(); openName(); }
      else if (k === "s") openSettings();
      else if (k === "arrowdown" || k === "arrowup") {
        e.preventDefault();
        const i = songs.findIndex((s) => s.id === settings.songId);
        const n = songs[(i + (k === "arrowdown" ? 1 : -1) + songs.length) % songs.length];
        if (n) { settings.songId = n.id; saveSettings(); renderHome(); }
      }
    } else if (screen === "name") {
      if (k === "escape") show("home");
      else if (k === "enter" && !typing) { e.preventDefault(); game.begin($("#nameInput").value); }
    } else if (screen === "play") {
      if (k === "escape") goHome();
      else if (k === " " && game.state === "ready") { e.preventDefault(); game.startCountdown(); }
    } else if (screen === "result") {
      if (k === " " || k === "enter") { e.preventDefault(); game.begin(game.name); }
      else if (k === "escape" || k === "h") goHome();
      else if (k === "d") downloadPhoto();
    }
  });

  // ------------------------------------------------------------ baslangic
  window.__app = {
    get screen() { return screen; }, get state() { return game.state; }, get songs() { return songs; },
    settings, game, live, cam, poseSys, lastResult: null, errors: [], events: [], pushes: 0,
  };
  window.addEventListener("error", (e) => window.__app.errors.push(String(e.message)));

  async function boot() {
    applyTexts();
    if (location.protocol === "file:") {
      loading("Bu sayfa doğrudan dosyadan açılmış", "Uygulamayı klasördeki baslat.bat ile ya da paylaşılan internet linkinden aç. Kamera ve model dosyadan açılınca çalışmaz.");
      document.querySelector(".loader-dots").hidden = true;
      return;
    }
    loading("Şarkılar yükleniyor…");
    await loadSongs();
    loading("Kamera açılıyor…", "Tarayıcı izin isterse \"İzin ver\"e bas.");
    mountCam($("#homeCamStage"));
    const camP = startCamera();
    if (TEST.sim) {
      try { sim = await (await fetch(TEST.sim)).json(); } catch (e) { console.warn(e); }
    } else {
      loading("Hareket algılama modeli yükleniyor…", "İlk açılış birkaç saniye sürebilir.");
      try { await poseSys.init(settings.model); }
      catch (e) {
        console.error(e);
        loading("Hareket algılama başlatılamadı", "Chrome veya Edge'in güncel sürümünü kullan. Ayarlar > Sistem > \"Donanım hızlandırmayı kullan\" açık olmalı. (" + e.message + ")");
        document.querySelector(".loader-dots").hidden = true;
        return;
      }
    }
    await camP;
    if (sim) setInterval(() => {
      if (!cam.ok || analyzing) return;
      const t = game.state === "play" ? refVideo.currentTime - TEST.simLag : cam.video.currentTime;
      onPose(simAt(t));
    }, 33);
    renderHome();
    show("home");
    requestAnimationFrame(loop);
    if (TEST.auto) { await sleep(800); game.begin("Test"); }
  }
  boot();
})();
