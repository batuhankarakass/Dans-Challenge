// Puanlama motoru testi: node oyun/engine.test.js
// Her sarkinin kendi dansi yuksek, baska sarkinin dansi belirgin dusuk puan almali.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const E = require("./engine.js");

const dir = path.join(__dirname, "sarkilar");
const songs = JSON.parse(fs.readFileSync(path.join(dir, "sarkilar.json"), "utf8")).songs;
const load = (s) => JSON.parse(fs.readFileSync(path.join(__dirname, s.pose), "utf8"));

function play(song, ref, player) {
  const ses = new E.Session(E.prepareRef(ref), { start: song.start, end: song.end });
  // oyuncu verisi 15 fps; sarkinin zamanina gore en yakin kareyi gonder
  for (let t = song.start; t < song.end; t += 1 / 30) {
    const k = Math.min(player.frames.length - 1, Math.max(0, Math.round((t - player.t0) * player.fps)));
    ses.push(t, player.frames[k], player.aspect);
  }
  return ses.finish().accuracy;
}

songs.forEach((song, i) => {
  const ref = load(song), other = load(songs[(i + 1) % songs.length]);
  const self = play(song, ref, ref), wrong = play(song, ref, other);
  console.log(`${song.id.padEnd(14)} kendi %${self}  baska %${wrong}`);
  assert(self >= 90, `${song.id}: kendi dansi %${self}, en az %90 olmali`);
  assert(wrong <= self - 25, `${song.id}: baska dans %${wrong}, kendi dansindan (%${self}) en az 25 puan dusuk olmali`);
});
console.log("tamam");
