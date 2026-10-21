"""Tek kisilik bir dans videosunu uygulamaya sarki olarak hazirlar.

Kullanim:
    python sarki_hazirla.py <id> "<Baslik>" <dans.mp4> [--bas SN] [--son SN] [--tur TUR] [--max SN] [--ses ORIJINAL.m4a]

1. Pozlar cikarilir (poz_cikar.py).
2. Dansin basladigi ve bittigi an bulunur: dansci hareket etmeye basladigi yer, muzigin
   vurusuna oturtulur (--bas / --son ile elle de verilebilir).
3. Video o bolumden kesilir (basta 1 sn giris payi, skor sayilmaz), H.264'e cevrilir.
4. oyun/sarkilar/<id>.mp4 + <id>.pose.json yazilir, sarkilar.json guncellenir.
"""
import argparse
import json
import os
import subprocess

import numpy as np

import poz_cikar
import ses_hizala

ROOT = os.path.dirname(os.path.abspath(__file__))
SARKILAR = os.path.join(os.path.dirname(ROOT), "oyun", "sarkilar")
LEAD = 1.0       # dans baslamadan once oynayacak sure (sn), skor sayilmaz
HEDEF_DB = -11.0 # kisik sesli videolar bu ortalama ses seviyesine getirilir (diger sarkilarla ayni)


def mean_db(path):
    """Ortalama ses seviyesi (dB, ffmpeg volumedetect)."""
    err = subprocess.run([ses_hizala.ffmpeg_exe(), "-hide_banner", "-i", path, "-vn", "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(err.split("mean_volume:")[1].split("dB")[0])


def beats(path):
    """Videonun sesinden vurus zamanlari (sn)."""
    env = ses_hizala.envelope(ses_hizala.load(path))
    fps = ses_hizala.ENV_FPS
    lo, hi = int(fps * 60 / 180), int(fps * 60 / 75)          # 75-180 BPM
    ac = np.correlate(env, env, "full")[len(env) - 1:]
    lag = lo + int(np.argmax(ac[lo:hi]))
    best = max(range(lag), key=lambda ph: env[ph::lag].sum())
    return np.arange(best, len(env), lag) / fps, 60 * fps / lag


def best_window(path, b, start, end, length):
    """[start, end] icinde en fazla 'length' sn'lik, sesi en gur pencere (nakarat genelde en gur yer).
    Baslangic ve bitis vurusa oturtulur."""
    x = ses_hizala.load(path)
    step = ses_hizala.SR // 10                                   # 0.1 sn
    r = np.sqrt(np.add.reduceat(x.astype(np.float64) ** 2, np.arange(0, len(x), step)) / step)
    cs = np.concatenate([[0], np.cumsum(r)])
    n = int(length * 10)
    cands = [t for t in b if start - 1e-6 <= t <= end - length] or [start]
    t0 = max(cands, key=lambda t: cs[min(len(r), int(t * 10) + n)] - cs[min(len(r), int(t * 10))])
    ends = [t for t in b if t0 < t <= t0 + length]
    return float(t0), float(ends[-1] if ends else t0 + length)


def dance_span(data):
    """Dansin hareketli oldugu [bas, son] (sn): hareketin belirgin oldugu ilk ve son an."""
    ts, fr = np.array(data["ts"]), data["frames"]
    pts = np.array([np.array(f)[:, :2] if f else np.full((12, 2), np.nan) for f in fr])
    mot = np.nansum(np.abs(np.diff(pts, axis=0)), axis=(1, 2))
    mot = np.convolve(np.nan_to_num(mot), np.ones(5) / 5, "same")
    thr = 0.35 * np.median(mot[mot > np.percentile(mot, 40)])
    active = np.where(mot > thr)[0]
    if len(active) == 0:
        return ts[0], ts[-1]
    return ts[active[0]], ts[min(len(ts) - 1, active[-1] + 1)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id"); ap.add_argument("baslik"); ap.add_argument("dans")
    ap.add_argument("--bas", type=float); ap.add_argument("--son", type=float)
    ap.add_argument("--tur", default="Türkçe", help='ana ekrandaki sekme, ör. "K-Pop"')
    ap.add_argument("--max", type=float, default=60, help="en uzun oyun suresi (sn); uzunsa en gur bolum secilir")
    ap.add_argument("--ses", help="orijinal sarki ses dosyasi; videonun kisik sesi yerine hizalanip konur")
    a = ap.parse_args()

    data, found = poz_cikar.analyse(a.dans)
    b, bpm = beats(a.dans)
    d0, d1 = dance_span(data)
    snap = lambda t: float(b[np.argmin(np.abs(b - t))]) if len(b) else t
    start = a.bas if a.bas is not None else snap(d0)
    end = a.son if a.son is not None else snap(d1)
    end = min(end, data["ts"][-1])
    if end - start > a.max:
        start, end = best_window(a.dans, b, start, end, a.max)

    cut0 = max(0.0, start - LEAD)
    # --ses: videodaki (mikrofonla kaydedilmis, kisik) muzik yerine orijinal sarki sesi, videoya hizalanarak
    # Hizalama net degilse (nakarat tekrari) yanlis yere oturtmak yerine videonun kendi sesi yukseltilir.
    ses, af = [], ""
    if a.ses:
        al = ses_hizala.align_chroma(a.ses, a.dans)
        if al["peak"] >= 0.35 and al["peak"] >= 1.2 * al["second"]:
            ses = ["-ss", f"{al['offset'] + cut0:.3f}", "-i", a.ses, "-map", "0:v", "-map", "1:a", "-shortest"]
            print(f"orijinal ses: videonun 0. sn'si sarkida {al['offset']:.2f}. sn ({al})")
        else:
            gain = HEDEF_DB - mean_db(a.dans)
            af = f"volume={gain:.1f}dB,alimiter=limit=0.9," if gain > 0 else ""
            print(f"UYARI: orijinal ses net hizalanamadi ({al}), video sesi {gain:+.1f} dB yukseltiliyor")
    out_mp4 = os.path.join(SARKILAR, a.id + ".mp4")
    subprocess.run([ses_hizala.ffmpeg_exe(), "-v", "error", "-y", "-ss", f"{cut0:.3f}", "-to", f"{end + 0.3:.3f}",
                    "-i", a.dans, *ses, "-vf", "scale=-2:'min(1920,ih)'", "-c:v", "libx264", "-preset", "medium",
                    "-crf", "21", "-r", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
                    "-af", f"{af}afade=t=in:d=0.4,afade=t=out:st={max(0, end - cut0 - 0.5):.2f}:d=0.8",
                    "-movflags", "+faststart", out_mp4], check=True)

    # kesilmis videoya gore zamanlar; dans baslamadan onceki kareler skor disi (None)
    ts, frames = [], []
    for t, f in zip(data["ts"], data["frames"]):
        if t < cut0 - 1e-6 or t > end + 1e-6:
            continue
        ts.append(round(t - cut0, 3))
        frames.append(f if t >= start - 1e-6 else None)
    pose = {"v": 2, "fps": poz_cikar.FPS, "aspect": data["aspect"], "duration": round(end + 0.3 - cut0, 3),
            "t0": ts[0], "ts": ts, "frames": frames}
    with open(os.path.join(SARKILAR, a.id + ".pose.json"), "w") as f:
        json.dump(pose, f, separators=(",", ":"))

    song = {"id": a.id, "title": a.baslik, "tur": a.tur, "file": f"sarkilar/{a.id}.mp4", "pose": f"sarkilar/{a.id}.pose.json",
            "start": ts[0], "end": round(ts[-1] - 0.05, 2)}
    lst_path = os.path.join(SARKILAR, "sarkilar.json")
    lst = json.load(open(lst_path, encoding="utf-8")) if os.path.exists(lst_path) else {"songs": []}
    old = [s["id"] for s in lst["songs"]]
    songs = [s for s in lst["songs"] if s["id"] != a.id]
    songs.insert(old.index(a.id) if a.id in old else len(songs), song)
    json.dump({"songs": songs}, open(lst_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"{a.id}: {bpm:.0f} BPM, dans {start:.2f}-{end:.2f} sn (hareket {d0:.2f}-{d1:.2f}), "
          f"oyun {song['end'] - song['start']:.1f} sn, kisi bulunan %{found * 100 // max(1, len(data['frames']))}")


if __name__ == "__main__":
    main()
