// Cok oyunculu mantik testi: node dans-challenge/team.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const E = require("./engine.js");
const T = require("./team.js");

/** cx merkezli sentetik kisi; raised: sag el havada */
function person(cx, raised = false, scale = 1) {
  const w = 0.06 * scale, h = 0.25 * scale, v = 0.95;
  const p = [
    [cx - w, 0.3, v], [cx + w, 0.3, v],                                   // omuzlar (LS RS)
    [cx - w * 1.5, 0.42, v], [cx + w * 1.5, 0.42, v],                     // dirsekler
    [cx - w * 1.5, 0.55, v], [cx + w * 1.5, raised ? 0.12 : 0.55, v],     // bilekler (RW havada olabilir)
    [cx - w * 0.7, 0.3 + h, v], [cx + w * 0.7, 0.3 + h, v],               // kalcalar
    [cx - w * 0.7, 0.8, v], [cx + w * 0.7, 0.8, v],
    [cx - w * 0.7, 0.95, v], [cx + w * 0.7, 0.95, v],
  ];
  return p;
}
const A = 16 / 9;

// --- el kaldirma
assert(!T.handRaised(person(0.5), A), "el asagidayken kalkik sayilmamali");
assert(T.handRaised(person(0.5, true), A), "el yukaridayken kalkik sayilmali");
const noVis = person(0.5, true); noVis[5][2] = 0.1;
assert(!T.handRaised(noVis, A), "bilek gorunmuyorsa kalkik sayilmamali");
const noShoulder = person(0.5, true); noShoulder[0][2] = 0.1;
assert(!T.handRaised(noShoulder, A), "omuz gorunmuyorsa kalkik sayilmamali");
const noHips = person(0.5, true); noHips[6][2] = 0; noHips[7][2] = 0;
assert(T.handRaised(noHips, A), "kalca yokken de omuz genisliginden tahmin edilmeli");

// --- kayit: el 0.6 sn havada kalinca, sirayla
let c = new T.Crowd(2); let t = 0;
const step = (list, dt = 1 / 15) => { t += dt; return c.update(t, list, A); };
for (let i = 0; i < 20; i++) step([person(0.25), person(0.75)]);
assert.strictEqual(c.registeredCount(), 0, "el kaldirmadan kimse kaydedilmemeli");
let regs = [];
for (let i = 0; i < 12; i++) regs = regs.concat(step([person(0.25, true), person(0.75)]));   // 0.8 sn
assert.strictEqual(regs.length, 1, "soldaki kisi kaydedilmeli");
assert.strictEqual(regs[0].slot, 0);
for (let i = 0; i < 4; i++) step([person(0.25), person(0.75, true)]);                          // kisa el: kayit yok
assert.strictEqual(c.registeredCount(), 1, "0.6 sn dolmadan kayit olmamali");
for (let i = 0; i < 12; i++) step([person(0.25), person(0.75, true)]);
assert.strictEqual(c.registeredCount(), 2);
assert.deepStrictEqual([c.slots[0].trackId !== c.slots[1].trackId, !!c.slotPts(0), !!c.slotPts(1)], [true, true, true]);
// fazla kisi: yuvalar doluyken ucuncu el kaldirsa da kayit olmaz
for (let i = 0; i < 20; i++) step([person(0.25), person(0.75), person(0.5, true, 0.8)]);
assert.strictEqual(c.registeredCount(), 2, "yuvalar doluyken yeni kayit olmamali");

// --- takip: kisiler yer degistirmeden hareket ederse ayni yuvada kalir
const s0 = c.slots[0].trackId;
for (let i = 0; i < 15; i++) step([person(0.25 + i * 0.005), person(0.75 - i * 0.005)]);
assert.strictEqual(c.slots[0].trackId, s0, "yavas hareket takibi bozmamali");
assert(c.slotPts(0)[0][0] < c.slotPts(1)[0][0], "slot 0 soldaki kisi olarak kalmali");

// --- yuva geri verme: oyuncu 1 kadrajdan cikip ayni yerde geri gelir
c.takeover = true;
for (let i = 0; i < 30; i++) step([person(0.75)]);        // 2 sn yok
assert(!c.trackOf(0), "kaybolan oyuncunun kaydi gorunmemeli");
for (let i = 0; i < 20; i++) step([person(0.75), person(0.3)]);
assert(c.trackOf(0), "ayni civarda donen kisi yuvasini geri almali");

// --- dusuk fps: kisiler kareler arasi 0.3 sn'de 0.3 yer degistirse de ayni yuvada kalir
c = new T.Crowd(2); t = 0;
for (let i = 0; i < 12; i++) step([person(0.2, true), person(0.8, true)]);
assert.strictEqual(c.registeredCount(), 2);
c.takeover = true;
const ids = c.slots.map((x) => x.trackId);
for (let i = 0; i < 6; i++) { const dx = (i % 2 ? 1 : -1) * 0.12; step([person(0.35 + dx), person(0.65 - dx)], 0.3); }
assert.deepStrictEqual(c.slots.map((x) => x.trackId), ids, "dusuk fps'te yuvalar karismamali");
assert(c.slotPts(0)[0][0] < c.slotPts(1)[0][0], "slot 0 solda kalmali");

// --- tek karelik algilama kaybi: son poz tutulur, 0.4 sn sonra bos
const before = c.slotPts(1);
step([person(0.35)], 1 / 15);
assert(c.slotPts(1) === before, "kisa kayipta son poz kullanilmali");
for (let i = 0; i < 8; i++) step([person(0.35)], 1 / 15);
assert(!c.slotPts(1), "0.4 sn sonra kayip sayilmali");

// --- iki kisi yan yana (0.18 arayla), biri bir kare kaybolup donunce yer degistirmez
c = new T.Crowd(2); t = 0;
for (let i = 0; i < 12; i++) step([person(0.41, true), person(0.59, true)]);
c.takeover = true;
const near = c.slots.map((x) => x.trackId);
step([person(0.59)]); step([person(0.41), person(0.59)]); step([person(0.41), person(0.59)]);
assert.deepStrictEqual(c.slots.map((x) => x.trackId), near, "yakin duran iki kisi yer degistirmemeli");

// --- herkes taninir ama sadece el kaldiran dansci olur; kayip oyuncu uzakta donunce el kaldirarak yuvasina doner
c = new T.Crowd(1); t = 0;
for (let i = 0; i < 12; i++) step([person(0.2, true), person(0.7), person(0.5)]);
assert.strictEqual(c.visible().length, 3, "kadrajdaki herkes takip edilmeli");
assert.strictEqual(c.registeredCount(), 1, "sadece el kaldiran kaydedilmeli");
assert(c.slotPts(0)[0][0] < 0.3, "dansci el kaldiran (sol) kisi olmali");
c.takeover = true;
for (let i = 0; i < 60; i++) step([person(0.7), person(0.5)]);                       // dansci 4 sn yok, izleyiciler 1.5 sn+ yerinde
assert(!c.slotPts(0), "izleyiciler kayip oyuncunun yuvasini almamali");
for (let i = 0; i < 12; i++) step([person(0.9, true), person(0.7), person(0.5)]);    // uzakta, elini kaldirarak doner
assert(c.slotPts(0) && c.slotPts(0)[0][0] > 0.8, "el kaldiran kayip yuvaya geri donmeli");

// --- bolmeli mod: yuva = bolme; herkes kendi bolmesinde el kaldirarak kaydolur
c = new T.Crowd(3); c.zoned = true; t = 0;
const zstep = (pz, dt = 1 / 15) => { t += dt; return c.updateZones(t, pz, A); };
const cxOf = (k) => (c.zoneN - 1 - k + 0.5) / c.zoneN;     // k. bolmenin kamera koordinatindaki ortasi (ekran aynali)
const Z = (flags) => flags.map((f, k) => (f === null ? null : person(cxOf(k), f)));
for (let i = 0; i < 20; i++) zstep(Z([false, false, false]));
assert.strictEqual(c.registeredCount(), 0);
for (let i = 0; i < 12; i++) zstep(Z([false, true, false]));        // sadece 2. bolmedeki el kaldirir
assert.strictEqual(c.registeredCount(), 1);
assert(c.slots[1].trackId && !c.slots[0].trackId, "yuva 1 (2. oyuncu) dolu olmali");
for (let i = 0; i < 12; i++) zstep(Z([true, true, true]));
assert.strictEqual(c.registeredCount(), 3, "ayni anda uc kisi de kaydolmali");
assert(c.slotPts(0)[0][0] > c.slotPts(2)[0][0], "ekranda soldaki (1.) oyuncu kamerada sagda olmali (ayna)");
zstep(Z([false, null, false]));                                   // 2. bolme bos
assert(c.slotPts(1), "kisa kayipta son poz tutulmali");
for (let i = 0; i < 8; i++) zstep(Z([false, null, false]));
assert(!c.slotPts(1) && c.slotPts(0) && c.slotPts(2), "2. oyuncu kayip, digerleri duruyor");
assert.deepStrictEqual(c.compact(), [0, 2]);
assert(c.locked, "dans baslayinca yeni kayit kapanmali");
c = new T.Crowd(2); c.zoned = true; t = 0;
zstep(Z([false, false]));
assert.strictEqual(c.registerProminent(t), 2, "Space: iki bolmedeki kisiler de kaydolmali");

// --- compact: kadrajda olmayan oyuncu atilir
let n = new T.Crowd(3); t = 0; c = n;
for (let i = 0; i < 12; i++) step([person(0.2, true), person(0.5, true), person(0.8, true)]);
assert.strictEqual(c.registeredCount(), 3);
for (let i = 0; i < 8; i++) step([person(0.2), person(0.8)]);
assert.deepStrictEqual(c.compact(), [0, 2], "ortadaki kayip oyuncu atilmali");
assert.strictEqual(c.n, 2);

// --- registerProminent (Space): en belirgin kisiler once
c = new T.Crowd(2); t = 0;
step([person(0.2, false, 0.5), person(0.5, false, 1.2), person(0.8, false, 0.9)]);
assert.strictEqual(c.registerProminent(t), 2);
assert(c.slotPts(0)[0][0] > 0.4 && c.slotPts(0)[0][0] < 0.6, "ilk yuvaya en buyuk (en yakin) kisi gelmeli");

// --- takim skoru: x oyuncunun toplami / x
const sums = [{ points: 900, accuracy: 90, stars: 5, counts: {}, maxCombo: 7, mode: "M", windows: 20 },
  { points: 600, accuracy: 70, stars: 4, counts: {}, maxCombo: 3, mode: "M", windows: 20 },
  { points: 300, accuracy: 40, stars: 2, counts: {}, maxCombo: 1, mode: "M", windows: 20 }];
const ts = T.teamSummary(sums, E.stars, { PERFECT: 5 });
assert.strictEqual(ts.points, 600, "(900+600+300)/3 = 600");
assert.strictEqual(ts.accuracy, 67);
assert.strictEqual(ts.stars, E.stars(67));
assert.strictEqual(ts.maxCombo, 7);
assert.strictEqual(ts.counts.PERFECT, 5);
const solo = T.teamSummary([sums[0]], E.stars, null);
assert.strictEqual(solo.points, 900, "tek oyuncuda puan degismemeli");
assert.strictEqual(solo.accuracy, 90);
const tw = T.teamWindow([{ type: "judge", i: 3, score: 90, points: 100 }, { type: "judge", i: 3, score: 30, points: 0 }, { type: "skip" }], E.judge, E.DEFAULTS);
assert.strictEqual(tw.label, "GOOD", "ortalama skor 60: GREAT esigi 62 -> GOOD");
assert.strictEqual(tw.points, 50);

// --- uctan uca: gercek sarki, 2 oyuncu (biri kendi dansini, biri baska dansi yapiyor)
const dir = path.join(__dirname, "sarkilar");
const songs = JSON.parse(fs.readFileSync(path.join(dir, "sarkilar.json"), "utf8")).songs;
const load = (s) => JSON.parse(fs.readFileSync(path.join(__dirname, s.pose), "utf8"));
const song = songs[0], ref = load(song), other = load(songs[1]);
const prep = E.prepareRef(ref);
const sessions = [new E.Session(prep, { start: song.start, end: song.end }), new E.Session(prep, { start: song.start, end: song.end })];
const frameOf = (d, t) => d.frames[Math.min(d.frames.length - 1, Math.max(0, Math.round((t - d.t0) * d.fps)))];
const teamCounts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
const closeTeam = (evs) => { const w = T.teamWindow(evs, E.judge, sessions[0].cfg); if (w) teamCounts[w.label]++; };
for (let tt = song.start; tt < song.end; tt += 1 / 30) {
  const evs = [sessions[0].push(tt, frameOf(ref, tt), ref.aspect).events, sessions[1].push(tt, frameOf(other, tt), ref.aspect).events];
  const flat = [].concat(...evs);
  if (flat.some((e) => e.type === "judge")) closeTeam(flat);
}
const fin = sessions.map((s) => s.finish());
const last = [].concat(...fin.map((f) => f.events));
if (last.some((e) => e.type === "judge")) closeTeam(last);
const team = T.teamSummary(fin, E.stars, teamCounts);
assert.strictEqual(team.points, Math.round((fin[0].points + fin[1].points) / 2), "takim puani = (p1 + p2) / 2");
assert(fin[0].accuracy >= 90 && fin[1].accuracy <= fin[0].accuracy - 25, "kendi dansi yuksek, baska dans dusuk");
assert(team.accuracy > fin[1].accuracy && team.accuracy < fin[0].accuracy, "takim yuzdesi iki oyuncunun arasinda");
const nWin = Object.values(team.counts).reduce((x, y) => x + y, 0);
assert(nWin >= 15, "takim pencereleri sayilmali, bulunan: " + nWin);
console.log(`takim: ${team.points} puan, %${team.accuracy} (oyuncular ${fin[0].points}/${fin[1].points}, %${fin[0].accuracy}/%${fin[1].accuracy}), pencereler`, JSON.stringify(team.counts));
console.log("tamam");

// --- yarisma siralamasi
let rk = T.rankPlayers([{ points: 500, accuracy: 60 }, { points: 900, accuracy: 70 }, { points: 700, accuracy: 80 }]);
assert.deepStrictEqual(rk.order, [1, 2, 0]);
assert.deepStrictEqual(rk.ranks, [3, 1, 2]);
assert.deepStrictEqual(rk.winners, [1]);
rk = T.rankPlayers([{ points: 800, accuracy: 60 }, { points: 800, accuracy: 75 }]);
assert.deepStrictEqual(rk.winners, [1], "puan esitse dogruluk belirler");
rk = T.rankPlayers([{ points: 800, accuracy: 70 }, { points: 800, accuracy: 70 }, { points: 100, accuracy: 10 }]);
assert.deepStrictEqual(rk.winners, [0, 1], "puan ve dogruluk esitse beraberlik");
assert.deepStrictEqual(rk.ranks, [1, 1, 3]);
console.log("siralama tamam");
