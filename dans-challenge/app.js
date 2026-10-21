/* Dans Challenge — stant uygulamasi
 * Ekranlar: yukleniyor -> ana ekran -> isim -> hazirlik -> geri sayim -> dans -> sonuc
 */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const E = window.DanceEngine;
  const DT = window.DanceTeam;
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
    players: params.get("players"),         // oyuncu sayisi (1-3)
    simDiff: params.has("simdiff") ? +params.get("simdiff") : 0,   // sim: k. oyuncu k*simdiff sn geriden dansi yapar (farkli puan icin)
  };

  // ------------------------------------------------------------ ayarlar
  const DEFAULTS = {
    cameraId: "", difficulty: "normal", mirror: "auto", latency: 0.1, model: 1, fps: false,
    title: "Dans Challenge", club: "Google Developer Groups on Campus", autoReturn: 30, songId: "", players: 1,
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* gizli mod */ } },
  };
  const settings = Object.assign({}, DEFAULTS, store.get("dc.settings", {}));
  if (TEST.model != null) settings.model = +TEST.model;
  if (TEST.players) settings.players = +TEST.players;
  settings.players = Math.max(1, Math.min(3, Math.round(+settings.players) || 1));
  // ?players= ve ?model= yalnizca o oturum icin (kalici ayara yazilmaz)
  const TEST_ONLY = { players: !!TEST.players, model: TEST.model != null };
  const saveSettings = () => {
    const out = Object.assign({}, settings);
    const saved = store.get("dc.settings", {});
    for (const k of Object.keys(TEST_ONLY)) if (TEST_ONLY[k]) { if (k in saved) out[k] = saved[k]; else delete out[k]; }
    store.set("dc.settings", out);
  };

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
  let bootReady = Promise.resolve();   // kamera + model hazir olunca biter (boot'ta atanir)
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
  const boardKey = (id, n = settings.players) => "dc.board." + id + (n > 1 ? "." + n : "");
  const getBoard = (id, n) => store.get(boardKey(id, n), []);
  function addToBoard(id, entry, n) {
    const b = getBoard(id, n);
    entry.key = Date.now() + Math.random();
    b.push(entry);
    b.sort((x, y) => y.points - x.points || y.acc - x.acc);
    const top = b.slice(0, 10);
    store.set(boardKey(id, n), top);
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

  // ------------------------------------------------------------ cok kisili algilama (MediaPipe Tasks) + oyuncu takibi
  const PCOLORS = ["#c58af9", "#ff8a3d", "#24c1e0"];   // oyuncu 1-3 (PERFECT/GREAT/GOOD/MISS renklerinden farkli)
  const detector = {
    lm: null, ready: false, last: 0, poses: 0, promise: null, gen: 0, fails: 0, cpu: false,
    mod: null, fileset: null, zoneLms: [], zoneKey: "", zoneCv: document.createElement("canvas"),
    /** variant: "full" | "lite" */
    make(variant, numPoses, delegate) {
      return this.mod.PoseLandmarker.createFromOptions(this.fileset, {
        baseOptions: { modelAssetPath: `lib/tasks/pose_landmarker_${variant}.task`, delegate },
        runningMode: "VIDEO", numPoses, minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
      });
    },
    /** n bolme icin her birine ayri (kendi takibi olan) bir algilayici kurar; true = hazir */
    async ensureZones(n) {
      await this.promise;
      if (!this.mod) return false;
      const variant = settings.model && n <= 2 ? "full" : "lite", key = `${variant}:${n}:${this.cpu}`;
      if (this.zoneKey === key && this.zoneLms.length === n) return true;
      for (const z of this.zoneLms) { try { z.close(); } catch (e) { /* yok */ } }
      this.zoneLms = []; this.zoneKey = "";
      try {
        for (let k = 0; k < n; k++) this.zoneLms.push(await this.make(variant, 1, this.cpu ? "CPU" : "GPU").catch(() => { this.cpu = true; return this.make(variant, 1, "CPU"); }));
      } catch (e) { console.warn("bolme algilayicilari kurulamadi", e); this.zoneLms = []; return false; }
      this.zoneKey = key;
      return true;
    },
    /**
     * Kadraji n dikey bolmeye ayirir; her bolmeyi kendi algilayicisina verir.
     * Doner: [ekranda soldan saga k. bolmedeki kisi (12 nokta, tum kadraja gore normalize) | null]
     * (goruntu ekranda aynalandigi icin ekranin solu = kameranin saginda)
     */
    detectZones(video, n) {
      const vw = video.videoWidth, vh = video.videoHeight, zw = vw / n, cv = this.zoneCv;
      if (!vw || this.zoneLms.length !== n) return new Array(n).fill(null);
      const w = Math.round(zw);
      if (cv.width !== w || cv.height !== vh) { cv.width = w; cv.height = vh; }
      const cx = cv.getContext("2d"), ts = Math.max(performance.now(), this.last + 1); this.last = ts;
      const out = [];
      for (let k = 0; k < n; k++) {
        const x0 = (n - 1 - k) * zw;
        cx.drawImage(video, x0, 0, zw, vh, 0, 0, w, vh);
        let pts = null;
        try {
          const lm = this.zoneLms[k].detectForVideo(cv, ts).landmarks;
          if (lm && lm[0]) pts = E.fromMediaPipe(lm[0]).map((p) => [(x0 + p[0] * zw) / vw, p[1], p[2]]);
          this.fails = 0;
        } catch (e) { console.warn("bolme algilama hatasi", e); }
        out.push(pts);
      }
      return out;
    },
    init(model) {
      const gen = ++this.gen;
      this.ready = false; this.fails = 0;
      this.promise = (async () => {
        if (!this.mod) { this.mod = await import("./lib/tasks/vision_bundle.mjs"); this.fileset = await this.mod.FilesetResolver.forVisionTasks("lib/tasks/wasm"); }
        const make = (delegate) => this.make(model ? "full" : "lite", 4, delegate);
        let lm;
        if (this.cpu) lm = await make("CPU");
        else { try { lm = await make("GPU"); } catch (e) { lm = await make("CPU"); this.cpu = true; } }
        if (gen !== this.gen) { try { lm.close(); } catch (e) { /* yok */ } return; }   // daha yeni bir init basladi
        if (this.lm) { try { this.lm.close(); } catch (e) { /* yok */ } }
        this.lm = lm; this.poses = 4; this.ready = true;
      })().catch((e) => { console.warn("cok kisili model yuklenemedi, tek kisilik algilama kullanilacak", e); if (gen === this.gen) this.ready = false; });
      return this.promise;
    },
    setPoses(n) { if (this.ready && n !== this.poses) { try { this.lm.setOptions({ numPoses: n }); this.poses = n; } catch (e) { /* yok */ } } },
    /** video karesindeki herkes: 12 noktalik diziler listesi */
    detect(video) {
      const ts = Math.max(performance.now(), this.last + 1); this.last = ts;
      try { const out = (this.lm.detectForVideo(video, ts).landmarks || []).map(E.fromMediaPipe); this.fails = 0; return out; }
      catch (e) {
        // GPU "kuruldu ama calismiyor" durumu: 5 ardisik hatadan sonra CPU ile yeniden kur
        console.warn("algilama hatasi", e);
        if (++this.fails === 5 && !this.cpu) { this.cpu = true; this.init(settings.model); }
        return [];
      }
    },
  };
  const crowd = new DT.Crowd(1);
  /** algilama hazir mi: once Tasks (cok kisili), olmazsa eski tek kisilik kutuphane */
  const poseOk = () => detector.ready || poseSys.ready;
  /** ayni anda iki MediaPipe wasm modulu yuklenemez (global Module cakisir): yedek yalnizca Tasks basarisizsa acilir */
  async function initModels() {
    await detector.init(settings.model);
    if (detector.ready) return;
    await poseSys.init(settings.model);
  }
  /** tek goruntude en belirgin kisi (referans video analizi icin): 12 noktalik dizi ya da null */
  async function detectOne(img) {
    if (detector.ready) {
      const list = detector.detect(img);
      return list.length ? list.reduce((a, b) => (DT.prominence(b) > DT.prominence(a) ? b : a)) : null;
    }
    const r = await poseSys.detect(img);
    return r && r.poseLandmarks ? E.fromMediaPipe(r.poseLandmarks) : null;
  }

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
  let camGen = 0;
  async function startCamera(retry = true) {
    // ayni anda iki acilis olursa (acilis + ayarlardan kamera secimi) eski olanin sonucu yok sayilir;
    // yoksa biri goruntuyu gosterirken digeri "Kamera kullanimda" yazar
    const gen = ++camGen;
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
        if (gen !== camGen) { stream.getTracks().forEach((t) => t.stop()); return; }
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
      if (gen !== camGen) return;
      // Windows kamerayi onceki sayfadan (yenileme) gec birakabiliyor: bir kez daha dene
      if (retry && (e.name === "NotReadableError" || e.name === "AbortError" || e.name === "TrackStartError")) {
        await sleep(1200);
        if (gen === camGen) return startCamera(false);
        return;
      }
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
  const DIM = new Float32Array(9).fill(NaN);   // kayitsiz kisi: soluk iskelet
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
  const live = { pts: null, people: [], segDiffs: [], at: 0, poseCount: 0, frameCount: 0, fpsT: performance.now(), poseFps: 0, loopFps: 0 };
  let lastCamTime = -1;
  let analyzing = false;
  let sim = null; // test: hazir eklem verisi
  const simAt = (t) => { if (!sim) return null; const k = Math.round(t * sim.fps); return k >= 0 && k < sim.frames.length ? sim.frames[k] : null; };

  /** list: bu karede algilanan herkesin 12 noktalik dizisi (bos = kimse yok) */
  function onPeople(list) {
    live.at = performance.now(); live.poseCount++;
    crowd.update(live.at / 1000, list, cam.aspect);
    live.people = crowd.visible();
    live.pts = live.people.length ? live.people.reduce((a, b) => (DT.prominence(b.pts) > DT.prominence(a.pts) ? b : a)).pts : null;
    if (game.state === "play") game.onPeople();
  }
  /** bolmeli mod: perZone[k] = k. bolmedeki kisi ya da null */
  function onZones(perZone) {
    live.at = performance.now(); live.poseCount++;
    crowd.updateZones(live.at / 1000, perZone, cam.aspect);
    live.people = crowd.visible();
    live.pts = live.people.length ? live.people[0].pts : null;
    if (game.state === "play") game.onPeople();
  }
  const onPose = (pts) => onPeople(pts ? [pts] : []);   // tek kisilik kaynak (legacy Pose)
  /** test (sim): ayni eklem verisini oyuncu sayisi kadar yana kaydirip cogaltir */
  function simZones(t) {
    const n = settings.players;
    return Array.from({ length: n }, (_, k) => {
      const pts = simAt(t - k * TEST.simDiff);
      if (!pts) return null;
      const c0 = (pts[0][0] + pts[1][0]) / 2;
      const dx = (n - 1 - k + 0.5) / n - c0;     // k. bolmenin (kamera koordinatinda) ortasina tasi
      return pts.map((q) => [q[0] + dx, q[1], q[2]]);
    });
  }
  function simPeople(pts) {
    if (!pts) return [];
    const n = settings.players, offs = n === 1 ? [0] : n === 2 ? [-0.22, 0.22] : [-0.3, 0, 0.3];
    return offs.map((dx) => pts.map((q) => [q[0] + dx, q[1], q[2]]));
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
      } else if (crowd.zoned && detector.zoneLms.length === crowd.zoneN) {
        if (cam.video.currentTime !== lastCamTime) { lastCamTime = cam.video.currentTime; onZones(detector.detectZones(cam.video, crowd.zoneN)); }
      } else if (detector.ready) {
        if (cam.video.currentTime !== lastCamTime) { lastCamTime = cam.video.currentTime; onPeople(detector.detect(cam.video)); }
      } else if (!poseSys.busy && poseSys.ready && cam.video.currentTime !== lastCamTime) {
        lastCamTime = cam.video.currentTime;
        poseSys.detect(cam.video).then((r) => { if (r) onPose(r.poseLandmarks ? E.fromMediaPipe(r.poseLandmarks) : null); });
      }
    }
    // kisi 1.2 sn'dir gorulmediyse yok say
    if (now - live.at > 1200 && !sim) { live.pts = null; live.people = []; if (crowd.visible().length) crowd.update(now / 1000, [], cam.aspect); }
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
    const playing = game.state === "play", inGame = screen === "play";
    if (inGame && crowd.zoned && game.state !== "done") drawZones(camCtx, W, H, dpr);
    for (const tr of live.people) {
      const slot = crowd.slotOfTrack(tr);
      // herkes cizilir; elini kaldirip kaydolmayanlar soluk (puanlanmaz)
      drawSkeleton(camCtx, tr.pts, W, H, vw, vh, slot >= 0 ? (playing ? live.segDiffs[slot] : null) : (playing ? DIM : null), dpr * 0.8);
      if (!inGame) continue;
      if (slot >= 0 && playing && crowd.n > 1) {
        const jd = game.lastJudge[slot], age = jd ? (performance.now() - jd.at) / 1000 : 9;
        if (age < 1.7) drawJudge(camCtx, tr.pts, W, H, vw, vh, dpr, jd, age);
      }
      if (slot >= 0 && crowd.n > 1 && !crowd.zoned) drawTag(camCtx, tr.pts, W, H, vw, vh, dpr, `${slot + 1} · ${game.names[slot] || ""}`, PCOLORS[slot], 1);
      else if (slot < 0 && tr.progress > 0) drawTag(camCtx, tr.pts, W, H, vw, vh, dpr, "✋", "#ffffff", tr.progress);
    }
    // ana ekran: vucut durumu
    if (screen === "home") {
      const ok = bodyStatus(live.pts) >= 1;
      $("#bodyChip").hidden = !ok;
      $("#bodyChip").textContent = live.people.length > 1 ? `${live.people.length} kişi algılandı` : "Vücut algılandı";
      $("#bodyChip").className = "chip ok";
    }
  }

  /** oyuncunun kafasinin ustunde o saniyenin yargisi (PERFECT / GREAT / GOOD / MISS) ve +puan */
  function drawJudge(ctx, pts, W, H, vw, vh, dpr, jd, age) {
    const a = mapPt(pts[0], W, H, vw, vh), b = mapPt(pts[1], W, H, vw, vh);
    const sw = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2 - sw * 1.2 - age * 14 * dpr;     // hafifce yukari suzulur
    const pop = 1 + 0.35 * Math.max(0, 1 - age / 0.22), fade = age > 1.2 ? Math.max(0, 1 - (age - 1.2) / 0.5) : 1;
    const size = Math.max(22, Math.min(46, sw / dpr * 0.42)) * dpr * pop;
    ctx.save();
    ctx.globalAlpha = fade; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `${Math.round(size)}px Bungee, Outfit, sans-serif`;
    ctx.lineJoin = "round"; ctx.lineWidth = Math.max(4, size * 0.2); ctx.strokeStyle = "rgba(8,9,40,.9)";
    ctx.strokeText(jd.label, x, y);
    ctx.fillStyle = COLORS[jd.label]; ctx.fillText(jd.label, x, y);
    if (jd.points) {
      ctx.font = `800 ${Math.round(size * 0.55)}px Outfit, sans-serif`;
      ctx.lineWidth = Math.max(3, size * 0.14);
      ctx.strokeText(`+${jd.points}`, x, y + size * 0.78); ctx.fillStyle = "#ffffff"; ctx.fillText(`+${jd.points}`, x, y + size * 0.78);
    }
    ctx.restore();
  }

  /** bolmeli mod: bolme cizgileri ve ustte "1 · Ali" etiketleri (kaydolmamis bolme: ✋ ve soluk) */
  function drawZones(ctx, W, H, dpr) {
    const n = crowd.zoneN;
    ctx.save();
    ctx.setLineDash([14 * dpr, 12 * dpr]); ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "rgba(255,255,255,.45)";
    for (let k = 1; k < n; k++) { ctx.beginPath(); ctx.moveTo(W * k / n, 0); ctx.lineTo(W * k / n, H); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.font = `800 ${Math.round(20 * dpr)}px Outfit, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const top = game.state === "play" || game.state === "countdown" ? 70 * dpr : 24 * dpr;
    for (let k = 0; k < n; k++) {
      const reg = crowd.slots.some((s) => s.trackId === k + 1);
      if (!reg && (game.state === "play" || game.state === "countdown")) continue;   // dans basladi: kaydolmayan bolmeye etiket yok
      const text = `${k + 1} · ${game.entered[k] || ""}${reg ? "" : "  ✋"}`;
      const w = ctx.measureText(text).width + 24 * dpr, h = 34 * dpr, x = W * (k + 0.5) / n, y = top;
      ctx.globalAlpha = reg ? 1 : 0.75;
      ctx.fillStyle = reg ? PCOLORS[k] : "rgba(8,9,40,.85)"; ctx.strokeStyle = PCOLORS[k]; ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); else ctx.rect(x - w / 2, y - h / 2, w, h);
      ctx.fill(); if (!reg) ctx.stroke();
      ctx.fillStyle = reg ? "#10123a" : "#ffffff"; ctx.fillText(text, x, y + dpr);
    }
    ctx.restore();
  }

  /** kisinin basinin ustune oyuncu etiketi (progress < 1: el kaldirma halkasi) */
  function drawTag(ctx, pts, W, H, vw, vh, dpr, text, color, progress) {
    const a = mapPt(pts[0], W, H, vw, vh), b = mapPt(pts[1], W, H, vw, vh);
    const sw = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2 - sw * 1.25;
    if (progress < 1) {
      ctx.lineWidth = 6 * dpr; ctx.strokeStyle = "rgba(255,255,255,.25)";
      ctx.beginPath(); ctx.arc(x, y, 26 * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(x, y, 26 * dpr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); ctx.stroke();
      return;
    }
    ctx.font = `800 ${Math.round(20 * dpr)}px Outfit, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 22 * dpr, h = 34 * dpr;
    ctx.fillStyle = color; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); else ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = "#10123a"; ctx.fillText(text, x, y + 1 * dpr);
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
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
  /** items: [{pts, segDiff}] — tek oyuncuda kisiyi ortalar, cok oyuncuda butun kadrajı sigdirir */
  function capturePhoto(items) {
    if (!cam.ok || cam.video.readyState < 2) return;
    const vw = cam.video.videoWidth, vh = cam.video.videoHeight;
    const ctx = photo.shot.getContext("2d");
    const seen = (items || []).filter((it) => it && it.pts);
    if (seen.length > 1) {
      const h = vh * (640 / vw), oy = (640 - h) / 2;
      ctx.fillStyle = "#1d2063"; ctx.fillRect(0, 0, 640, 640);
      ctx.save(); ctx.translate(640, 0); ctx.scale(-1, 1);
      ctx.drawImage(cam.video, 0, 0, vw, vh, 0, oy, 640, h);
      ctx.restore();
      const wide = (p) => [640 - p[0] * 640, oy + p[1] * h];
      for (const it of seen) drawSkeleton(ctx, it.pts, 640, 640, vw, vh, it.segDiff, 0.9, wide);
      photo.has = true;
      return;
    }
    const pts = seen.length ? seen[0].pts : null, segDiff = seen.length ? seen[0].segDiff : null;
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
    await bootReady;
    // model yokken analiz bos kare uretir ve bozuk sonuc kalici kaydedilir
    if (!poseOk() && !sim) { toast("Hareket algılama hazır değil, video analiz edilemedi."); return null; }
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
      const raw = await detectOne(img);
      const pts = raw ? raw.map((p) => p.map((x) => Math.round(x * 1e4) / 1e4)) : null;
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
    state: "idle", song: null, prep: null, sessions: [], entered: [], names: [], name: "", readySince: 0, readyAt: 0, cdStart: 0, cdStep: -1,
    shownPoints: 0, lastJudgeAt: 0, summary: null, resultTimer: 0, returnAt: 0, lastPushT: -1,
    teamCounts: null, teamCombo: 0, teamBest: -1, lastLabels: [], lastJudge: [], uiKey: "",

    /** names: isim dizisi (ya da tek isim); bos birakilanlar "Misafir" / "Oyuncu k" olur */
    beginTok: 0,
    async begin(names) {
      const tok = ++this.beginTok;
      this.returnAt = 0;
      const n = settings.players, list = Array.isArray(names) ? names : [names];
      const entered = Array.from({ length: n }, (_, i) => String(list[i] || "").trim() || (n === 1 ? "Misafir" : `Oyuncu ${i + 1}`));
      const song = currentSong();
      if (!song) { toast("Önce bir şarkı ekle (Ayarlar > Şarkılar)."); return show("home"); }
      if ((!poseOk() && !sim) || !cam.ok) {
        toast("Hazırlanıyor, bir saniye…");
        await bootReady;
        if (screen !== "name" && screen !== "result") return;   // beklerken Esc ile cikildi
      }
      if (!poseOk() && !sim) return show("loading");
      if (!cam.ok) { toast("Kamera çalışmıyor. Kamera kartındaki mesaja bak."); return show("home"); }
      if (n > 1 && !sim && !(detector.ready && detector.zoneKey && detector.zoneLms.length === n)) {
        toast("Çok kişili algılama hazırlanıyor…");
        const ok = await detector.ensureZones(n);
        if (tok !== this.beginTok) return;
        if (screen !== "name" && screen !== "result") return;
        if (!ok) {
          toast("Çok kişili algılama başlatılamadı. Tek kişilik moda dönüldü.", 5000);
          settings.players = 1; saveSettings(); renderHome(); return show("home");
        }
      }
      this.entered = entered; this.names = entered.slice(); this.name = entered.join(" & ");
      sfx.ensure();
      const prep = await getRef(song);
      if (tok !== this.beginTok) return;                      // beklerken Esc / ana ekran / yeni begin
      if (!prep) return show("home");
      this.song = song; this.prep = prep;
      refVideo.src = song.src; refVideo.muted = TEST.mute; refVideo.loop = false;
      try { if (refVideo.readyState < 1) await onceEvent(refVideo, "loadedmetadata", 15000); } catch (e) { if (tok === this.beginTok) { toast("Şarkı videosu açılamadı."); show("home"); } return; }
      if (tok !== this.beginTok) return;
      refVideo.currentTime = song.start;
      $("#hudSong").textContent = song.title;
      $("#hudPlayer").textContent = this.name;
      $("#hudPoints").textContent = "0"; this.shownPoints = 0;
      $("#hudCombo").hidden = true; $("#hudProgress").style.width = "0%";
      $("#judge").innerHTML = ""; $("#playCamPanel").removeAttribute("data-j");
      photo.has = false; live.segDiffs = []; this.sessions = []; this.lastLabels = []; this.lastJudge = [];
      crowd.reset(n); crowd.zoned = n > 1; detector.setPoses(4);
      show("play");
      this.state = "ready"; this.readySince = 0; this.readyAt = performance.now(); this.uiKey = "";
      $("#readyGuide").hidden = false; $("#readyGuide").classList.remove("ok");
      $("#countdown").innerHTML = "";
      renderPlayerStrip();
    },

    startCountdown() {
      if (this.state !== "ready") return;
      crowd.registerProminent(performance.now() / 1000);   // Space: elini kaldirmayan ama gorunenleri de al
      const keep = crowd.compact();                          // kadrajda olmayan kayitli oyuncular atilir
      if (!keep.length) { toast("Kimse algılanmadı. Kameraya geç ve elini kaldır."); return; }
      this.names = keep.map((i) => this.entered[i]); this.name = this.names.join(" & ");
      $("#hudPlayer").textContent = this.name;
      crowd.takeover = true; detector.setPoses(4);   // kadrajdaki herkes algilanmaya devam eder
      this.state = "countdown"; this.cdStart = performance.now(); this.cdStep = -1;
      $("#readyGuide").hidden = true;
      renderPlayerStrip();
    },

    go() {
      this.state = "play";
      const opts = { start: this.song.start, end: this.song.end, latency: settings.latency, mirror: settings.mirror, difficulty: settings.difficulty };
      this.sessions = this.names.map(() => new E.Session(this.prep, opts));
      this.teamCounts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 }; this.teamCombo = 0; this.teamBest = -1;
      live.segDiffs = []; this.lastLabels = []; this.lastJudge = [];
      this.lastPushT = -1; window.__app.events = []; window.__app.pushes = 0;
      refVideo.currentTime = this.song.start;
      const p = refVideo.play();
      if (p && p.catch) p.catch(() => { refVideo.muted = true; refVideo.play().catch(() => {}); toast("Ses otomatik başlatılamadı."); });
      if (TEST.cam) { try { cam.video.currentTime = this.song.start; } catch (e) { /* yok */ } }
    },

    /** x oyuncunun toplam puani / x */
    teamTotal() {
      const s = this.sessions;
      return s.length ? Math.round(s.reduce((a, b) => a + b.points, 0) / s.length) : 0;
    },

    onPeople() {
      if (this.state !== "play" || !this.sessions.length) return;
      const t = refVideo.currentTime;
      if (t === this.lastPushT || t < this.song.start) return;
      this.lastPushT = t;
      window.__app.pushes++;
      const evs = [], items = [], scores = [];
      let best = null;
      this.sessions.forEach((ses, i) => {
        const tr = crowd.trackOf(i), pts = tr ? tr.pts : null;
        const r = ses.push(t, pts, cam.aspect);
        live.segDiffs[i] = r.segDiff;
        for (const ev of r.events) evs.push(Object.assign({ slot: i }, ev));
        if (r.score != null) scores.push(r.score);
        if (r.newBest) best = r;
        items.push({ pts, segDiff: r.segDiff });
      });
      this.handleEvents(evs);
      if (this.sessions.length === 1) { if (best && best.score >= 40) capturePhoto(items); }
      else if (scores.length && t - this.song.start > 1.5) {
        const m = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (m > this.teamBest + 0.5 && m >= 40) { this.teamBest = m; capturePhoto(items); }
      }
    },

    /** tek oyuncuda olaylar aynen iletilir; cok oyuncuda ayni pencerenin yargilari takim yargisina cevrilir */
    handleEvents(evs) {
      if (this.sessions.length === 1) { for (const ev of evs) this.onEvent(ev); return; }
      const groups = new Map();
      for (const ev of evs) if (ev.type === "judge") { if (!groups.has(ev.i)) groups.set(ev.i, []); groups.get(ev.i).push(ev); }
      for (const [i, group] of groups) {
        const w = DT.teamWindow(group, E.judge, this.sessions[0].cfg);
        if (!w) continue;
        const at = performance.now();
        for (const ev of group) { this.lastLabels[ev.slot] = ev.label; this.lastJudge[ev.slot] = { label: ev.label, points: ev.points, at }; }
        if (w.label === "MISS") this.teamCombo = 0; else this.teamCombo++;
        this.teamCounts[w.label]++;
        this.onEvent({ type: "judge", i, label: w.label, score: w.score, points: w.points, total: this.teamTotal(), combo: this.teamCombo, team: true, players: group.map((e) => ({ slot: e.slot, label: e.label, points: e.points })) });
      }
    },

    onEvent(ev) {
      window.__app.events.push(Object.assign({ vt: +refVideo.currentTime.toFixed(2) }, ev));
      if (ev.type !== "judge") return;
      const j = $("#judge");
      // cok oyunculuda yargi her oyuncunun kafasinda gosterilir; ortadaki buyuk yazi yalnizca solo icin
      j.innerHTML = ev.team ? "" : `<span class="word" data-l="${ev.label}">${ev.label}</span>` + (ev.points ? `<span class="plus">+${ev.points}</span>` : "");
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
        const st = this.readyStep(now);
        if (st && now - this.readySince > (st === 2 ? 900 : 1800)) this.startCountdown();
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
      // puan sayaci yumusak artsin (takim puani)
      if (this.sessions.length && (this.state === "play")) {
        const target = this.teamTotal();
        if (this.shownPoints !== target) {
          this.shownPoints += Math.max(1, Math.round((target - this.shownPoints) * 0.18));
          if (this.shownPoints > target) this.shownPoints = target;
          $("#hudPoints").textContent = this.shownPoints.toLocaleString("tr-TR");
        }
        updatePlayerStrip();
      }
      if (screen === "result" && this.returnAt) {
        const left = Math.ceil((this.returnAt - now) / 1000);
        $("#resAuto").textContent = left > 0 ? `${left} sn sonra ana ekrana dönülecek` : "";
        if (left <= 0) { this.returnAt = 0; goHome(); }
      }
    },

    /** hazirlik: el kaldiranlari kaydet, herkes hazirsa 1/2 sayisi doner (0 = henuz degil) */
    readyStep(now) {
      const g = $("#readyGuide"), n = crowd.n, reg = crowd.registeredCount();
      if ((TEST.auto || sim) && reg < n && now - this.readyAt > 400) crowd.registerProminent(now / 1000);
      const present = crowd.presentCount();
      let st = 0, text;
      if (reg === n && present === n) {
        st = 2;
        for (let i = 0; i < n; i++) st = Math.min(st, bodyStatus(crowd.slotPts(i)));
        text = st === 2 ? (n === 1 ? "Harika, hazırsın!" : "Harika, hazırsınız!")
          : st === 1 ? "Hazır! Bacakların da görünürse daha iyi olur" : "Biraz geri çekil, kolların ve kalçan görünsün";
      } else if (reg < n && crowd.visible().length === 0) {
        text = "Kameranın karşısına geç, tüm vücudun görünsün";
      } else if (reg < n) {
        if (n === 1) text = "Elini kaldır: dansçı sen olduğunu göster";
        else {
          const wait = this.entered.filter((_, i) => !(crowd.slots[i] && crowd.slots[i].trackId));
          text = `${wait.join(", ")}: kendi bölmende elini kaldır (${reg}/${n})`;
        }
      } else text = "Herkes kadraja girsin";
      if (st >= 1) { if (!this.readySince) this.readySince = now; g.classList.add("ok"); }
      else { this.readySince = 0; g.classList.remove("ok"); }
      $("#readyText").textContent = text;
      // oyuncu yuvalari (isim + kayit durumu)
      const key = this.entered.map((nm, i) => nm + (crowd.slots[i] && crowd.slots[i].trackId ? (crowd.trackOf(i) ? "+" : "?") : "-")).join("|");
      if (key !== this.uiKey) {
        this.uiKey = key;
        $("#readySlots").innerHTML = n === 1 ? "" : this.entered.map((nm, i) => {
          const s = crowd.slots[i], on = s && s.trackId, here = on && crowd.trackOf(i);
          return `<li style="--pc:${PCOLORS[i]}" class="${here ? "on" : on ? "lost" : ""}"><b>${i + 1}</b><span>${escapeHtml(nm)}</span><i>${here ? "✓" : on ? "kadrajda değil" : "✋"}</i></li>`;
        }).join("");
      }
      return st;
    },

    async finish() {
      if (this.state !== "play") return;
      this.state = "done";
      refVideo.pause();
      const sums = this.sessions.map((s) => s.finish());
      this.handleEvents([].concat(...sums.map((s, i) => s.events.map((e) => Object.assign({ slot: i }, e)))));
      const sum = Object.assign({}, sums[0], DT.teamSummary(sums, E.stars, this.teamCounts));
      this.summary = sum;
      if (!photo.has) capturePhoto(this.sessions.map((_, i) => { const tr = crowd.trackOf(i); return { pts: tr ? tr.pts : null, segDiff: live.segDiffs[i] }; }));
      const entry = { name: this.name, points: sum.points, acc: sum.accuracy, stars: sum.stars, date: Date.now(), n: this.sessions.length };
      const placed = addToBoard(this.song.id, entry, this.sessions.length);
      this.lastPlaced = placed;
      await sleep(700);
      if (this.state !== "done") return;   // bu arada Esc ile cikildiysa
      showResult(sum, placed);
    },

    abort() {
      this.beginTok++;
      refVideo.pause();
      this.state = "idle"; this.sessions = [];
      crowd.takeover = false;
      renderPlayerStrip();
      $("#countdown").innerHTML = "";
    },
  };

  /** cam panelinin ustundeki oyuncu seridi (yalnizca 2+ oyuncuda) */
  function renderPlayerStrip() {
    const el = $("#playerStrip"), n = game.state === "ready" ? crowd.n : game.names.length;
    el.hidden = !(n > 1 && game.state !== "idle" && game.state !== "ready");
    el.innerHTML = el.hidden ? "" : game.names.map((nm, i) => `<span class="pchip" style="--pc:${PCOLORS[i]}"><b>${i + 1}</b><span class="nm">${escapeHtml(nm)}</span><em class="pt" data-i="${i}">0</em><small class="lb" data-i="${i}"></small></span>`).join("");
    game.stripKey = "";
  }
  function updatePlayerStrip() {
    if (game.sessions.length < 2) return;
    const key = game.sessions.map((s, i) => s.points + (game.lastLabels[i] || "")).join("|");
    if (key === game.stripKey) return;
    game.stripKey = key;
    game.sessions.forEach((s, i) => {
      const pt = document.querySelector(`#playerStrip .pt[data-i="${i}"]`), lb = document.querySelector(`#playerStrip .lb[data-i="${i}"]`);
      if (pt) pt.textContent = s.points.toLocaleString("tr-TR");
      if (lb) { lb.textContent = game.lastLabels[i] || ""; lb.dataset.l = game.lastLabels[i] || ""; }
    });
  }

  const TITLES = { 5: "Sahnenin yıldızı", 4: "Ritim ustası", 3: "Gayet iyi", 2: "Isınıyorsun", 1: "Bir tur daha?" };
  function showResult(sum, placed) {
    show("result");
    sfx.fanfare();
    $("#resName").textContent = game.name;
    const pl = $("#resPlayers"), many = sum.players && sum.players.length > 1;
    pl.hidden = !many; $("#resTeamNote").hidden = !many;
    const wn = $("#resWinner"); wn.hidden = !many; wn.className = "res-winner";
    if (many) {
      const rk = DT.rankPlayers(sum.players);
      const tie = rk.winners.length > 1, medal = ["gold", "silver", "bronze"];
      wn.innerHTML = tie
        ? `<small>Berabere</small><b>${rk.winners.map((i) => escapeHtml(game.names[i] || "")).join(" &amp; ")}</b>`
        : `<small>Kazanan</small><b>${escapeHtml(game.names[rk.winners[0]] || "")}</b>`;
      wn.style.setProperty("--pc", PCOLORS[rk.winners[0]]);
      pl.innerHTML = rk.order.map((i) => { const p = sum.players[i];
        return `<li class="${rk.ranks[i] === 1 ? "win" : ""}" style="--pc:${PCOLORS[i]}"><b class="rank ${medal[rk.ranks[i] - 1] || ""}">${rk.ranks[i]}</b><span class="nm">${escapeHtml(game.names[i] || "")}</span><span class="ac">%${p.accuracy}</span><span class="pt">${p.points.toLocaleString("tr-TR")}</span></li>`; }).join("");
      const total = sum.players.reduce((a, p) => a + p.points, 0);
      $("#resTeamNote").textContent = `Takım puanı = ${sum.players.map((p) => p.points.toLocaleString("tr-TR")).join(" + ")} = ${total.toLocaleString("tr-TR")} ÷ ${sum.players.length} = ${sum.points.toLocaleString("tr-TR")}`;
    }
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
    document.querySelectorAll("#modePick .mode").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.n === settings.players)));
    $("#boardSong").textContent = song ? "· " + song.title + (settings.players > 1 ? ` (${settings.players} kişi)` : "") : "";
    const board = song ? getBoard(song.id) : [];
    const fresh = game.lastPlaced && game.lastPlaced.key;
    $("#boardList").innerHTML = board.length
      ? board.slice(0, 5).map((e, i) => `<li class="${e.key === fresh ? "fresh" : ""}"><span class="rk">${i + 1}</span><span class="nm">${escapeHtml(e.name)}</span><span class="st">${"★".repeat(e.stars)}</span><span class="pt">${e.points.toLocaleString("tr-TR")}</span></li>`).join("")
      : `<li class="empty">Henüz skor yok. İlk sen ol!</li>`;
    $("#btnStart").disabled = !song;
  }

  const nameInputs = () => ["#nameInput", "#nameInput2", "#nameInput3"].map((q) => $(q));
  const readNames = () => nameInputs().slice(0, settings.players).map((i) => i.value);
  function openName() {
    if (!currentSong()) { toast("Önce bir şarkı ekle."); return; }
    const n = settings.players;
    $("#nameTitle").textContent = n === 1 ? "Adın ne?" : "Oyuncular kim?";
    $("#nameHint").textContent = n === 1 ? "Skor tablosunda bu isim görünecek. Boş bırakırsan \"Misafir\" yazar."
      : "Ekran oyuncu sayısı kadar bölmeye ayrılır; 1. oyuncu ekranda en solda durur. Herkes kendi bölmesinde elini kaldırarak kaydolur. Boş bırakırsan \"Oyuncu 1, 2…\" yazar.";
    nameInputs().forEach((inp, i) => { inp.hidden = i >= n; inp.value = ""; inp.placeholder = n === 1 ? "Adın" : `${i + 1}. oyuncunun adı`; inp.setAttribute("aria-label", inp.placeholder); });
    show("name");
    const inp = $("#nameInput"); inp.focus(); setTimeout(() => inp.focus(), 50);
  }
  function setPlayers(n) {
    settings.players = Math.max(1, Math.min(3, n)); saveSettings(); renderHome();
    if (settings.players > 1 && !sim) detector.ensureZones(settings.players);   // bolme algilayicilari arka planda hazirlansin
  }
  document.querySelectorAll("#modePick .mode").forEach((b) => b.addEventListener("click", () => setPlayers(+b.dataset.n)));

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
    if (!sim) { toast("Model değiştiriliyor…"); try { await initModels(); toast("Hazır."); } catch (err) { toast("Model yüklenemedi: " + err.message); } }
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
  $("#nameForm").addEventListener("submit", (e) => { e.preventDefault(); game.begin(readNames()); });
  $("#btnNameBack").addEventListener("click", () => { game.beginTok++; show("home"); });
  $("#btnAgain").addEventListener("click", () => game.begin(game.entered));
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
      else if (k === "1" || k === "2" || k === "3") setPlayers(+k);
      else if (k === "arrowdown" || k === "arrowup") {
        e.preventDefault();
        const i = songs.findIndex((s) => s.id === settings.songId);
        const n = songs[(i + (k === "arrowdown" ? 1 : -1) + songs.length) % songs.length];
        if (n) { settings.songId = n.id; saveSettings(); renderHome(); }
      }
    } else if (screen === "name") {
      if (k === "escape") { game.beginTok++; show("home"); }
      else if (k === "enter" && !typing) { e.preventDefault(); game.begin(readNames()); }
    } else if (screen === "play") {
      if (k === "escape") goHome();
      else if (k === " " && game.state === "ready") { e.preventDefault(); game.startCountdown(); }
    } else if (screen === "result") {
      if (k === " " || k === "enter") { e.preventDefault(); game.begin(game.entered); }
      else if (k === "escape" || k === "h") goHome();
      else if (k === "d") downloadPhoto();
    }
  });

  // ------------------------------------------------------------ baslangic
  window.__app = {
    get screen() { return screen; }, get state() { return game.state; }, get songs() { return songs; },
    settings, game, live, cam, poseSys, crowd, detector, lastResult: null, errors: [], events: [], pushes: 0,
  };
  window.addEventListener("error", (e) => window.__app.errors.push(String(e.message)));

  async function boot() {
    applyTexts();
    if (location.protocol === "file:") {
      loading("Bu sayfa doğrudan dosyadan açılmış", "Uygulamayı klasördeki baslat.bat ile ya da paylaşılan internet linkinden aç. Kamera ve model dosyadan açılınca çalışmaz.");
      document.querySelector(".loader-dots").hidden = true;
      return;
    }
    loading("Hazırlanıyor…");
    // Kamera, model ve sarkilar ayni anda yuklenir; ana ekran sarkilar gelir gelmez acilir.
    // Kamera kendi kartinda "Kamera aciliyor" gosterir, model arka planda hazirlanir.
    mountCam($("#homeCamStage"));
    const camP = startCamera();
    const modelP = TEST.sim
      ? fetch(TEST.sim).then((r) => r.json()).then((d) => { sim = d; }).catch((e) => console.warn(e))
      : initModels().catch((e) => {
        console.error(e);
        loading("Hareket algılama başlatılamadı", "Chrome veya Edge'in güncel sürümünü kullan. Ayarlar > Sistem > \"Donanım hızlandırmayı kullan\" açık olmalı. (" + e.message + ")");
        document.querySelector(".loader-dots").hidden = true;
        show("loading");
      });
    bootReady = Promise.all([camP, modelP]);
    await loadSongs();
    renderHome();
    show("home");
    requestAnimationFrame(loop);
    await bootReady;
    if (settings.players > 1 && !sim) detector.ensureZones(settings.players);
    if (!poseOk() && !sim) return show("loading");   // model hatasi ana ekrandan once geldiyse ustu kapanmasin
    if (sim) setInterval(() => {
      if (!cam.ok || analyzing) return;
      const t = game.state === "play" ? refVideo.currentTime - TEST.simLag : cam.video.currentTime;
      if (settings.players > 1) onZones(simZones(t)); else onPeople(simPeople(simAt(t)));
    }, 33);
    if (TEST.auto) { await sleep(800); game.begin("Test"); }
  }
  boot();
})();
