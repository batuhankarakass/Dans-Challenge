/* Cok oyunculu mod mantigi — tarayicida (window.DanceTeam) ve Node'da (require) ayni kod.
 *
 * 1) Crowd: kadrajdaki kisileri kareden kareye takip eder (track), el kaldiran kisiyi sirayla bir oyuncu
 *    yuvasina (slot) kaydeder, oyuncu kadrajdan cikip donerse yuvasini geri verir.
 * 2) Takim skoru: x oyuncunun toplam puani x'e bolunur (ortalama).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DanceTeam = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Nokta sirasi engine.js ile ayni: LS RS LE RE LW RW LH RH LK RK LA RA
  const LS = 0, RS = 1, LW = 4, RW = 5, LH = 6, RH = 7;

  const DEFAULTS = {
    minVis: 0.5,
    raiseSec: 0.6,       // el bu kadar suredir havadaysa oyuncu kaydedilir
    raiseGrace: 0.25,    // el bu kadar sure inip cikarsa sayac sifirlanmaz
    raiseFrac: 0.4,      // bilek, omuz cizgisinin govde boyunun bu kadar ustunde olmali
    matchDist: 0.25,     // ayni kisi sayilmak icin kareler arasi en fazla uzaklik (normalize)
    matchGrow: 0.5,      // dusuk fps'te kisi kareler arasinda daha cok yer degistirir: sinir, gecen her sn icin bu kadar genisler
    matchMax: 0.5,
    holdSec: 0.4,        // kaydi olan oyuncu bu sure kadar kayip olsa da son pozu kullanilir (tek karelik algilama kayiplari puan dusurmesin)
    lostSec: 6,          // kaybolan kisi bu sure sonra silinir
    takeNearSec: 0.3,    // yuvasi bos kalan oyuncunun yerine yakindaki kisi bu sure sonra gecer
    takeNear: 0.3,
  };

  function mid(pts, a, b) { return [(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2]; }

  /** govde boyu (y ekseninde, normalize). Kalcalar gorunmuyorsa omuz genisliginden tahmin edilir. */
  function torsoLen(pts, aspect, minVis) {
    if (pts[LH][2] >= minVis && pts[RH][2] >= minVis) return Math.abs(mid(pts, LH, RH)[1] - mid(pts, LS, RS)[1]);
    return Math.abs(pts[LS][0] - pts[RS][0]) * aspect * 1.3;
  }

  /** omuzlar gorunuyor mu (bir kisinin takip edilebilmesi icin sart) */
  function usable(pts, minVis) {
    return !!pts && pts[LS][2] >= minVis && pts[RS][2] >= minVis;
  }

  /** bilek, omuz cizgisinin belirgin sekilde ustunde mi (el kalkik) */
  function handRaised(pts, aspect, cfg) {
    cfg = Object.assign({}, DEFAULTS, cfg || {});
    aspect = aspect || 16 / 9;
    if (!usable(pts, cfg.minVis)) return false;
    const sy = mid(pts, LS, RS)[1], torso = torsoLen(pts, aspect, cfg.minVis);
    if (!(torso > 0.02)) return false;
    const up = (w) => pts[w][2] >= cfg.minVis && pts[w][1] < sy - cfg.raiseFrac * torso;
    return up(LW) || up(RW);
  }

  /** kisinin kadrajdaki belirginligi: omuz cizgisinin uzunlugu (buyuk = kameraya yakin) */
  function prominence(pts) { return Math.hypot(pts[LS][0] - pts[RS][0], pts[LS][1] - pts[RS][1]); }

  class Crowd {
    constructor(n, opts) { this.cfg = Object.assign({}, DEFAULTS, opts || {}); this._id = 0; this.aspect = 16 / 9; this.reset(n || 1); }

    reset(n) {
      this.n = n; this.tracks = []; this.takeover = false;
      this.zoned = false; this.locked = false; this.zoneN = n;   // zoned: kadraj n dikey bolmeye ayrilir, her bolme bir oyuncu
      this.slots = Array.from({ length: n }, () => ({ trackId: 0, cx: 0, cy: 0, lastSeen: 0 }));
    }

    _slotOf(id) { return this.slots.findIndex((s) => s.trackId === id); }

    /** t: sn (artan bir saat), list: 12 noktalik kisi dizileri. Doner: [{type:"register", slot}] */
    update(t, list, aspect) {
      const cfg = this.cfg, events = [];
      if (aspect) this.aspect = aspect;
      this.now = t;
      const people = (list || []).filter((p) => usable(p, cfg.minVis)).map((pts) => {
        const c = mid(pts, LS, RS); return { pts, cx: c[0], cy: c[1], size: prominence(pts) };
      });
      // 1) eslestirme: en dusuk maliyetli cift once (greedy). Maliyet = uzaklik + boyut farki;
      //    sinir, izin son goruldugunden beri gecen sureyle genisler (dusuk fps'te kisi cok yer degistirir)
      const pairs = [];
      this.tracks.forEach((tr, ti) => people.forEach((p, pi) => {
        const d = Math.hypot(tr.cx - p.cx, tr.cy - p.cy);
        const gate = Math.min(cfg.matchMax, cfg.matchDist + cfg.matchGrow * Math.min(0.6, Math.max(0, t - tr.lastT)));
        if (d < gate) pairs.push([d + 0.5 * Math.abs(Math.log((p.size + 1e-6) / (tr.size + 1e-6))) * 0.2, ti, pi]);
      }));
      pairs.sort((a, b) => a[0] - b[0]);
      const tUsed = new Set(), pUsed = new Set();
      for (const [, ti, pi] of pairs) {
        if (tUsed.has(ti) || pUsed.has(pi)) continue;
        tUsed.add(ti); pUsed.add(pi);
        const tr = this.tracks[ti], p = people[pi];
        tr.pts = p.pts; tr.cx = p.cx; tr.cy = p.cy; tr.size = p.size; tr.vis = true; tr.lastT = t;
      }
      this.tracks.forEach((tr, ti) => { if (!tUsed.has(ti)) tr.vis = false; });
      people.forEach((p, pi) => {
        if (pUsed.has(pi)) return;
        this.tracks.push({ id: ++this._id, pts: p.pts, cx: p.cx, cy: p.cy, size: p.size, vis: true, lastT: t, raiseT: null, raiseSeen: 0, progress: 0 });
      });
      this.tracks = this.tracks.filter((tr) => tr.vis || t - tr.lastT <= cfg.lostSec);
      // 2) yuvalarin son konumu
      this.slots.forEach((s) => {
        const tr = s.trackId && this.tracks.find((x) => x.id === s.trackId && x.vis);
        if (tr) { s.cx = tr.cx; s.cy = tr.cy; s.lastSeen = t; }
      });
      // 3) kadrajdan cikip donen oyuncunun yuvasini geri ver (sadece oyun basladiktan sonra)
      if (this.takeover) this._takeover(t);
      // 4) el kaldirma ile kayit
      for (const tr of this.tracks) {
        if (!tr.vis || this._slotOf(tr.id) >= 0) { tr.raiseT = null; tr.progress = 0; continue; }
        if (handRaised(tr.pts, this.aspect, cfg)) {
          if (tr.raiseT == null) tr.raiseT = t;
          tr.raiseSeen = t;
          tr.progress = Math.min(1, (t - tr.raiseT) / cfg.raiseSec);
          if (tr.progress >= 1) {
            // once hic kullanilmamis yuva, yoksa kadrajdan cikmis bir oyuncunun yuvasi (el kaldirarak geri doner)
            let slot = this.slots.findIndex((s) => !s.trackId);
            if (slot < 0) slot = this.slots.findIndex((s, i) => !this.trackOf(i));
            if (slot >= 0) { this._assign(slot, tr, t); events.push({ type: "register", slot, trackId: tr.id }); }
          }
        } else if (tr.raiseT != null && t - tr.raiseSeen > cfg.raiseGrace) { tr.raiseT = null; tr.progress = 0; }
      }
      return events;
    }

    /**
     * Bolmeli mod: perZone[k] = k. bolmedeki (ekranda soldan saga) kisinin 12 noktasi ya da null.
     * Kimlik bolmeden gelir (track id = k + 1); yuva k, k. bolmedeki el kaldiran kisiye verilir.
     */
    updateZones(t, perZone, aspect) {
      const cfg = this.cfg, events = [];
      this.now = t;
      if (aspect) this.aspect = aspect;
      for (let k = 0; k < this.zoneN; k++) {
        const pts = usable(perZone[k], cfg.minVis) ? perZone[k] : null;
        let tr = this.tracks.find((x) => x.zone === k);
        if (!tr) { tr = { id: k + 1, zone: k, pts: null, cx: 0, cy: 0, size: 0, vis: false, lastT: -1e9, raiseT: null, raiseSeen: 0, progress: 0 }; this.tracks.push(tr); }
        if (!pts) { tr.vis = false; tr.raiseT = null; tr.progress = 0; continue; }
        const c = mid(pts, LS, RS);
        tr.pts = pts; tr.cx = c[0]; tr.cy = c[1]; tr.size = prominence(pts); tr.vis = true; tr.lastT = t;
        const si = this._slotOf(tr.id);
        if (si >= 0) { const s = this.slots[si]; s.cx = tr.cx; s.cy = tr.cy; s.lastSeen = t; tr.raiseT = null; tr.progress = 0; continue; }
        if (this.locked) continue;
        if (handRaised(pts, this.aspect, cfg)) {
          if (tr.raiseT == null) tr.raiseT = t;
          tr.raiseSeen = t;
          tr.progress = Math.min(1, (t - tr.raiseT) / cfg.raiseSec);
          if (tr.progress >= 1 && this.slots[k] && !this.slots[k].trackId) { this._assign(k, tr, t); events.push({ type: "register", slot: k, trackId: tr.id }); }
        } else if (tr.raiseT != null && t - tr.raiseSeen > cfg.raiseGrace) { tr.raiseT = null; tr.progress = 0; }
      }
      return events;
    }

    _assign(slot, tr, t) {
      const s = this.slots[slot];
      s.trackId = tr.id; s.cx = tr.cx; s.cy = tr.cy; s.lastSeen = t;
      tr.raiseT = null; tr.progress = 1;
    }

    _takeover(t) {
      const cfg = this.cfg;
      this.slots.forEach((s, i) => {
        if (!s.trackId || this.trackOf(i)) return;
        const lost = t - s.lastSeen;
        const free = this.tracks.filter((x) => x.vis && this._slotOf(x.id) < 0);
        if (!free.length) return;
        let pick = null;
        if (lost >= cfg.takeNearSec) {
          let best = cfg.takeNear;
          for (const x of free) { const d = Math.hypot(x.cx - s.cx, x.cy - s.cy); if (d < best) { best = d; pick = x; } }
        }
        if (pick) { s.trackId = pick.id; s.cx = pick.cx; s.cy = pick.cy; s.lastSeen = t; }
      });
    }

    /** bu karede gorunen takip kayitlari */
    visible() { return this.tracks.filter((tr) => tr.vis); }
    /** yuvadaki oyuncunun kaydi: bu karede gorunuyorsa ya da holdSec icinde kaybolduysa (son poz), degilse null */
    trackOf(slot) {
      const s = this.slots[slot];
      if (!s || !s.trackId) return null;
      return this.tracks.find((x) => x.id === s.trackId && (x.vis || (this.now || 0) - x.lastT <= this.cfg.holdSec)) || null;
    }
    slotPts(slot) { const tr = this.trackOf(slot); return tr ? tr.pts : null; }
    slotOfTrack(tr) { return this._slotOf(tr.id); }
    registeredCount() { return this.slots.filter((s) => s.trackId).length; }
    presentCount() { return this.slots.filter((s, i) => s.trackId && this.trackOf(i)).length; }

    /** bos yuvalari, kayitsiz gorunen kisilerden en belirgin olanlarla doldurur (Space kisayolu, test) */
    registerProminent(t) {
      if (this.zoned) {                               // bolmeli modda yuva = bolme
        let added = 0;
        for (const tr of this.visible()) {
          const s = this.slots[tr.zone];
          if (!this.locked && s && !s.trackId && this._slotOf(tr.id) < 0) { this._assign(tr.zone, tr, t || 0); added++; }
        }
        return added;
      }
      const free = this.visible().filter((tr) => this._slotOf(tr.id) < 0).sort((a, b) => prominence(b.pts) - prominence(a.pts));
      let added = 0;
      for (const tr of free) {
        const slot = this.slots.findIndex((s) => !s.trackId);
        if (slot < 0) break;
        this._assign(slot, tr, t || 0); added++;
      }
      return added;
    }

    /** kadrajda olmayan yuvalari atar, kalanlari yeniden numaralar. Doner: eski yuva indeksleri */
    compact() {
      const keep = [];
      this.slots.forEach((s, i) => { if (s.trackId && this.trackOf(i)) keep.push(i); });
      this.slots = keep.map((i) => this.slots[i]);
      this.n = this.slots.length;
      if (this.zoned) this.locked = true;             // bolmeli modda dans basladiktan sonra yeni kayit yok
      return keep;
    }
  }

  // ------------------------------------------------------------ takim skoru
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  /**
   * Ayni pencerede kapanan oyuncu yargilarindan takim yargisi. Skor ortalamasi etikete cevrilir,
   * puan = oyuncu puanlarinin toplami / oyuncu sayisi. Hic yargi yoksa null.
   */
  function teamWindow(events, judgeFn, cfg) {
    const js = (events || []).filter((e) => e && e.type === "judge");
    if (!js.length) return null;
    const score = mean(js.map((e) => e.score));
    return { label: judgeFn(score, cfg), score, points: Math.round(mean(js.map((e) => e.points))), i: js[0].i };
  }

  /** oyuncu ozetlerinden (Session.finish) takim ozeti: puan = toplam / oyuncu sayisi */
  function teamSummary(sums, starsFn, teamCounts) {
    const n = sums.length || 1;
    const points = Math.round(sums.reduce((x, s) => x + s.points, 0) / n);
    const accuracy = Math.round(sums.reduce((x, s) => x + s.accuracy, 0) / n);
    const counts = n === 1 ? Object.assign({}, sums[0].counts)
      : Object.assign({ PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 }, teamCounts || {});
    return {
      points, accuracy, stars: starsFn(accuracy), counts,
      maxCombo: Math.max(0, ...sums.map((s) => s.maxCombo)),
      mode: sums[0] ? sums[0].mode : "M", windows: Math.max(0, ...sums.map((s) => s.windows)),
      players: sums.map((s) => ({ points: s.points, accuracy: s.accuracy, stars: s.stars, maxCombo: s.maxCombo, counts: s.counts })),
    };
  }

  /**
   * Yarisma siralamasi: once puan, esitse dogruluk (%). Ikisi de esitse beraberlik (ayni sira).
   * Doner: { order: oyuncu indeksleri (1.den sona), ranks: oyuncu basina sira (1 = en iyi), winners: kazananlarin indeksleri }
   */
  function rankPlayers(players) {
    const order = players.map((_, i) => i).sort((a, b) => players[b].points - players[a].points || players[b].accuracy - players[a].accuracy || a - b);
    const ranks = new Array(players.length);
    order.forEach((idx, pos) => {
      const prev = order[pos - 1];
      const tie = pos > 0 && players[prev].points === players[idx].points && players[prev].accuracy === players[idx].accuracy;
      ranks[idx] = tie ? ranks[prev] : pos + 1;
    });
    return { order, ranks, winners: order.filter((i) => ranks[i] === 1) };
  }

  return { DEFAULTS, Crowd, handRaised, prominence, teamWindow, teamSummary, rankPlayers };
});
