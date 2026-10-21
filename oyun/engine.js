/* Dans skor motoru — tarayicida (window.DanceEngine) ve Node'da (require) ayni kod.
 *
 * Fikir: her uzvun (ust kol, on kol, uyluk, baldir) yonunu govdeye gore aci olarak olcer.
 * Bu sayede kisinin kadrajdaki yeri, boyu ve kameraya uzakligi skoru etkilemez.
 * Oyuncunun pozu, referansin ayni anina yakin (+-tolerans) karelerle karsilastirilir.
 * Oyuncu referansi ayna gibi mi yoksa birebir mi taklit ediyor, otomatik anlasilir.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DanceEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Nokta sirasi (veride): LS RS LE RE LW RW LH RH LK RK LA RA
  // MediaPipe indeksleri: 11 12 13 14 15 16 23 24 25 26 27 28
  const MP_IDX = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const LS = 0, RS = 1, LE = 2, RE = 3, LW = 4, RW = 5, LH = 6, RH = 7, LK = 8, RK = 9, LA = 10, RA = 11;

  // [baslangic, bitis, agirlik]
  const SEGS = [
    [LS, LE, 1.0], [LE, LW, 0.9],   // sol kol (kisinin kendi solu)
    [RS, RE, 1.0], [RE, RW, 0.9],   // sag kol
    [LH, LK, 0.6], [LK, LA, 0.5],   // sol bacak
    [RH, RK, 0.6], [RK, RA, 0.5],   // sag bacak
  ];
  const TORSO = 8;
  const NF = 9;
  const W = [1.0, 0.9, 1.0, 0.9, 0.6, 0.5, 0.6, 0.5, 0.4];
  const SWAP = [2, 3, 0, 1, 6, 7, 4, 5, 8];          // ayna: sol <-> sag
  const SEG_NAMES = ["sol kol", "sol ön kol", "sağ kol", "sağ ön kol",
    "sol bacak", "sol baldır", "sağ bacak", "sağ baldır", "gövde"];

  const DEFAULTS = {
    minVis: 0.5,
    tolBack: 0.45,     // oyuncu referansin bu kadar gerisinde kalabilir (sn)
    tolFwd: 0.2,       // bu kadar onunde olabilir (sn)
    beat: 1.0,         // her degerlendirme penceresi (sn)
    dPerfect: 11,      // ortalama aci farki (derece) bu ve alti = 100 puan
    dZero: 50,         // bu ve ustu = 0 puan
    th: { perfect: 80, great: 62, good: 40 },
    motionDt: 0.3,     // hareket olcumu icin zaman araligi (sn)
    motionCalm: 9,     // referansin hareketi bundan azsa (derece/0.3sn) hareket sartı aranmaz
    motionLo: 0.1, motionHi: 0.45,   // oyuncu/referans hareket orani: bu araliga gore ceza
    points: { PERFECT: 100, GREAT: 75, GOOD: 45, MISS: 0 },
  };

  const DIFFICULTY = {
    kolay: { dPerfect: 14, dZero: 58 },
    normal: { dPerfect: 11, dZero: 50 },
    zor: { dPerfect: 8, dZero: 40 },
  };

  const deg = Math.PI / 180;
  function dirAngle(dx, dy) { return Math.atan2(dx, -dy) / deg; } // 0 = yukari, saat yonu +
  function wrap(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a; }

  /** pts: 12 nokta [x,y,vis] (normalize), aspect: genislik/yukseklik */
  function features(pts, aspect, minVis) {
    minVis = minVis == null ? DEFAULTS.minVis : minVis;
    const a = new Float32Array(NF), ok = new Uint8Array(NF);
    if (!pts) return { a, ok, n: 0 };
    const vis = (i) => pts[i][2] >= minVis;
    const X = (i) => pts[i][0] * aspect, Y = (i) => pts[i][1];
    if (!vis(LS) || !vis(RS)) return { a, ok, n: 0 };
    // govde "yukari" yonu: kalcalar gorunuyorsa omuz ortasi - kalca ortasi, yoksa omuz cizgisine dik
    let ux, uy;
    if (vis(LH) && vis(RH)) {
      ux = (X(LS) + X(RS)) / 2 - (X(LH) + X(RH)) / 2;
      uy = (Y(LS) + Y(RS)) / 2 - (Y(LH) + Y(RH)) / 2;
    } else {
      const sx = X(LS) - X(RS), sy = Y(LS) - Y(RS);   // kameraya donuk kiside saga dogru
      ux = sy; uy = -sx;
    }
    if (ux * ux + uy * uy < 1e-8) return { a, ok, n: 0 };
    const tA = dirAngle(ux, uy);
    a[TORSO] = tA; ok[TORSO] = 1;
    let n = 1;
    for (let s = 0; s < 8; s++) {
      const p = SEGS[s][0], q = SEGS[s][1];
      if (!vis(p) || !vis(q)) continue;
      const dx = X(q) - X(p), dy = Y(q) - Y(p);
      if (dx * dx + dy * dy < 1e-8) continue;
      a[s] = wrap(dirAngle(dx, dy) - tA);
      ok[s] = 1; n++;
    }
    return { a, ok, n };
  }

  /** Ayna goruntusunun ozellikleri (x cevrilir + sol/sag yer degistirir) */
  function mirrorFeat(f) {
    const a = new Float32Array(NF), ok = new Uint8Array(NF);
    for (let i = 0; i < NF; i++) { a[i] = -f.a[SWAP[i]]; ok[i] = f.ok[SWAP[i]]; }
    return { a, ok, n: f.n };
  }

  /** iki ozellik arasinda agirlikli ortalama aci farki; yeterli ortak uzuv yoksa null */
  function diff(p, r, perSeg) {
    let sw = 0, sd = 0, nArm = 0, n = 0;
    for (let i = 0; i < NF; i++) {
      if (!p.ok[i] || !r.ok[i]) { if (perSeg) perSeg[i] = NaN; continue; }
      const d = Math.abs(wrap(p.a[i] - r.a[i]));
      if (perSeg) perSeg[i] = d;
      sw += W[i]; sd += W[i] * d; n++;
      if (i < 4) nArm++;
    }
    if (nArm < 2 || n < 3) return null;
    return sd / sw;
  }

  /** iki an arasindaki ortalama uzuv aci degisimi (derece); hesaplanamazsa null */
  function motionBetween(a, b) {
    let s = 0, n = 0;
    for (let i = 0; i < 8; i++) {
      if (!a.ok[i] || !b.ok[i]) continue;
      s += Math.abs(wrap(a.a[i] - b.a[i])); n++;
    }
    return n >= 2 ? s / n : null;
  }

  function scoreFromDiff(d, cfg) {
    if (d == null) return 0;
    if (d <= cfg.dPerfect) return 100;
    if (d >= cfg.dZero) return 0;
    const x = (d - cfg.dPerfect) / (cfg.dZero - cfg.dPerfect);
    return 100 * (1 - x) * (1 - x * 0.35);   // hafif egri: orta farklar cok sert cezalanmasin
  }

  function judge(s, cfg) {
    if (s >= cfg.th.perfect) return "PERFECT";
    if (s >= cfg.th.great) return "GREAT";
    if (s >= cfg.th.good) return "GOOD";
    return "MISS";
  }

  function stars(acc) { return acc >= 85 ? 5 : acc >= 70 ? 4 : acc >= 55 ? 3 : acc >= 40 ? 2 : 1; }

  /** Referans verisini (extract formatı) ozelliklere cevirir */
  function prepareRef(ref, minVis) {
    const t0 = ref.t0 || 0;   // analiz videonun ortasindan basladiysa ilk karenin zamani
    const out = { fps: ref.fps, aspect: ref.aspect, duration: ref.duration, t0, t: [], f: [] };
    for (let k = 0; k < ref.frames.length; k++) {
      out.t.push(ref.ts ? ref.ts[k] : t0 + k / ref.fps);   // ts: analizde gercek kare zamanlari
      out.f.push(features(ref.frames[k], ref.aspect, minVis));
    }
    const off = Math.max(1, Math.round(DEFAULTS.motionDt * ref.fps));
    out.motion = out.f.map((f, k) => (k >= off ? motionBetween(f, out.f[k - off]) : null));
    return out;
  }

  /** MediaPipe landmark dizisinden (33 nokta) 12 noktalik veri */
  function fromMediaPipe(lms) {
    if (!lms) return null;
    return MP_IDX.map((i) => [lms[i].x, lms[i].y, lms[i].visibility == null ? 1 : lms[i].visibility]);
  }

  class Session {
    /**
     * prep: prepareRef cikisi; opts: {start, end, latency, mirror:'auto'|'on'|'off'} + DEFAULTS uzerine yazilabilir
     */
    constructor(prep, opts) {
      this.prep = prep;
      this.cfg = Object.assign({}, DEFAULTS, DIFFICULTY[(opts && opts.difficulty) || "normal"] || {}, opts || {});
      this.cfg.th = Object.assign({}, DEFAULTS.th, (opts && opts.th) || {});
      this.cfg.points = Object.assign({}, DEFAULTS.points, (opts && opts.points) || {});
      this.start = this.cfg.start || 0;
      this.end = this.cfg.end || prep.duration;
      this.latency = this.cfg.latency || 0;
      this.mirrorPref = this.cfg.mirror || "auto";
      this.sumN = 0; this.sumM = 0; this.nFrames = 0;
      this.mode = this.mirrorPref === "off" ? "N" : "M";
      this.win = -1; this._resetWin();
      this.hist = [];           // oyuncunun son ~1 sn'lik ozellikleri (hareket icin)
      this.windows = [];        // {i, label, sN, sM, mode}
      this.points = 0; this.combo = 0; this.maxCombo = 0;
      this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
      this.best = { s: -1, t: 0 };
      this.lastFrame = null;
      this._segN = new Float32Array(NF); this._segM = new Float32Array(NF);
    }

    _resetWin() { this.winN = []; this.winM = []; this.winSeen = 0; this.winEp = 0; this.winEr = 0; this.winMot = 0; }

    _bestMatch(pf, tEff, perSeg) {
      const { t, f } = this.prep;
      const lo = tEff - this.cfg.tolBack, hi = tEff + this.cfg.tolFwd;
      // ikili arama ile baslangic
      let a = 0, b = t.length;
      while (a < b) { const m = (a + b) >> 1; if (t[m] < lo) a = m + 1; else b = m; }
      let best = null, bestK = -1;
      const tmp = new Float32Array(NF);
      for (let k = a; k < t.length && t[k] <= hi; k++) {
        const d = diff(pf, f[k], tmp);
        if (d != null && (best == null || d < best)) { best = d; bestK = k; if (perSeg) perSeg.set(tmp); }
      }
      return { d: best, k: bestK };
    }

    /**
     * t: referans videosunun su anki zamani (sn), pts: oyuncunun 12 noktasi (null = kisi yok), aspect: kamera en/boy
     * Doner: {score, mode, segDiff (oyuncunun KENDI uzuvlarina gore, derece / NaN), events:[...], newBest}
     */
    push(t, pts, aspect) {
      const events = [];
      if (t < this.start) return { score: 0, mode: this.mode, segDiff: null, events, newBest: false };
      const w = Math.floor((t - this.start) / this.cfg.beat);
      if (w !== this.win) {
        if (this.win >= 0) events.push(this._closeWindow());
        this.win = w; this._resetWin();
      }
      const tEff = t - this.latency;
      const pf = features(pts, aspect, this.cfg.minVis);
      let sN = 0, sM = 0, dN = null, dM = null, kN = -1, kM = -1;
      // referansin bu civarinda olculebilir bir poz var mi? yoksa bu kare sayilmaz (oyuncu cezalanmaz)
      const refScorable = this._refScorable(tEff);
      if (pf.n > 0 && refScorable) {
        if (this.mirrorPref !== "on") { const m = this._bestMatch(pf, tEff, this._segN); dN = m.d; kN = m.k; sN = scoreFromDiff(dN, this.cfg); }
        if (this.mirrorPref !== "off") { const m = this._bestMatch(mirrorFeat(pf), tEff, this._segM); dM = m.d; kM = m.k; sM = scoreFromDiff(dM, this.cfg); }
        if (dN != null || dM != null) this.winSeen++;
      }
      // hareket: oyuncunun son 0.3 sn'deki degisimi vs referansin eslesen andaki degisimi
      if (pf.n > 0) {
        this.hist.push({ t, f: pf });
        while (this.hist.length && this.hist[0].t < t - 1.0) this.hist.shift();
        const k = this.mode === "M" ? kM : kN;
        const prev = this._histAt(t - this.cfg.motionDt);
        if (prev && k >= 0 && this.prep.motion[k] != null) {
          const ep = motionBetween(pf, prev.f);
          if (ep != null) { this.winEp += ep; this.winEr += this.prep.motion[k]; this.winMot++; }
        }
      }
      const unscored = !refScorable || (pf.n > 0 && dN == null && dM == null);
      if (unscored) { this.lastFrame = { t, score: null, mode: this.mode }; return { score: null, mode: this.mode, segDiff: null, events, newBest: false, d: null }; }
      this.winN.push(sN); this.winM.push(sM);
      this.sumN += sN; this.sumM += sM; this.nFrames++;
      if (this.mirrorPref === "auto" && this.nFrames > 20) {
        // histerezis: diger mod belirgin onde ise gec
        if (this.mode === "M" && this.sumN > this.sumM * 1.08 + 50) this.mode = "N";
        else if (this.mode === "N" && this.sumM > this.sumN * 1.08 + 50) this.mode = "M";
      }
      const score = this.mode === "M" ? sM : sN;
      // uzuv farklarini oyuncunun kendi uzuvlarina cevir (ayna modunda indeksler yer degistirir)
      let segDiff = null;
      const dUsed = this.mode === "M" ? dM : dN;
      if (dUsed != null) {
        segDiff = new Float32Array(NF);
        if (this.mode === "M") for (let i = 0; i < NF; i++) segDiff[SWAP[i]] = this._segM[i];
        else segDiff.set(this._segN);
      }
      let newBest = false;
      if (t - this.start > 1.5 && score > this.best.s + 0.5) { this.best = { s: score, t }; newBest = true; }
      this.lastFrame = { t, score, mode: this.mode };
      return { score, mode: this.mode, segDiff, events, newBest, d: dUsed };
    }

    _refScorable(tEff) {
      const { t, f } = this.prep;
      const lo = tEff - this.cfg.tolBack, hi = tEff + this.cfg.tolFwd;
      for (let k = 0; k < t.length; k++) {
        if (t[k] < lo) continue;
        if (t[k] > hi) break;
        let arms = 0; for (let i = 0; i < 4; i++) arms += f[k].ok[i];
        if (arms >= 2) return true;
      }
      return false;
    }

    _histAt(tq) {
      let best = null, bd = 1e9;
      for (const h of this.hist) { const d = Math.abs(h.t - tq); if (d < bd) { bd = d; best = h; } }
      return best && bd < 0.12 ? best : null;
    }

    /** referans hareket ederken oyuncu da hareket ediyor mu? 0.2..1 arasi carpan */
    _motionFactor() {
      if (this.winMot < 3) return 1;
      const er = this.winEr / this.winMot, ep = this.winEp / this.winMot;
      if (er < this.cfg.motionCalm) return 1;
      const x = Math.min(1, Math.max(0, (ep / er - this.cfg.motionLo) / (this.cfg.motionHi - this.cfg.motionLo)));
      return 0.25 + 0.75 * x;
    }

    _closeWindow() {
      const mean = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0);
      if (this.winN.length === 0) {           // referans bu pencerede olculemedi: atla
        return { type: "skip", i: this.win, total: this.points, combo: this.combo };
      }
      const enough = this.winSeen >= Math.max(2, Math.floor(this.winN.length * 0.4));
      const mf = this._motionFactor();
      const sN = enough ? mean(this.winN) * mf : 0, sM = enough ? mean(this.winM) * mf : 0;
      const s = this.mode === "M" ? sM : sN;
      const label = judge(s, this.cfg);
      const mult = 1 + Math.min(this.combo, 20) * 0.025;
      const pts = Math.round(this.cfg.points[label] * mult);
      if (label === "MISS") this.combo = 0; else this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.counts[label]++;
      this.points += pts;
      const ev = { type: "judge", i: this.win, label, score: s, points: pts, total: this.points, combo: this.combo, seen: this.winSeen, motion: mf };
      this.windows.push({ i: this.win, label, sN, sM, mode: this.mode });
      return ev;
    }

    /** Oyunu bitir: acik pencereyi kapatir, ozet doner */
    finish() {
      const events = [];
      if (this.win >= 0 && (this.winN.length || this.winSeen)) { events.push(this._closeWindow()); this._resetWin(); }
      const n = this.windows.length || 1;
      const accN = this.windows.reduce((x, w) => x + w.sN, 0) / n;
      const accM = this.windows.reduce((x, w) => x + w.sM, 0) / n;
      let mode = this.mode, acc;
      if (this.mirrorPref === "on") { mode = "M"; acc = accM; }
      else if (this.mirrorPref === "off") { mode = "N"; acc = accN; }
      else { acc = Math.max(accN, accM); mode = accM >= accN ? "M" : "N"; }
      acc = Math.round(acc);
      return {
        events, points: this.points, accuracy: acc, stars: stars(acc), counts: Object.assign({}, this.counts),
        maxCombo: this.maxCombo, mode, best: this.best, windows: this.windows.length,
      };
    }
  }

  return { MP_IDX, SEGS, SEG_NAMES, NF, DEFAULTS, DIFFICULTY, features, mirrorFeat, diff, scoreFromDiff, judge, stars,
    prepareRef, fromMediaPipe, Session, wrap, motionBetween };
});
