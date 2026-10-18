"""Bir sarkiyi uygulamaya hazirlar: ekranda resmi klip oynar, skor tek kisilik dans videosundan gelir.

Kullanim:
    python sarki_hazirla.py <id> "<Baslik>" <klip.mp4> <dans.mp4> [--kayma SN] [--hiz H]

1. Dans videosunun sesi klipte aranir (ses_hizala.py) -> dansin klipteki yeri bulunur.
   --kayma verilirse arama yapilmaz.
2. Dans videosunun pozu cikarilir (poz_cikar.py) ve zamanlari klibin zamanina kaydirilir.
3. Klip o bolumden kesilir (H.264, 720p) -> dans-challenge/sarkilar/<id>.mp4 + <id>.pose.json
4. dans-challenge/sarkilar/sarkilar.json'daki kayit eklenir / guncellenir.
"""
import argparse
import json
import os
import subprocess

import poz_cikar
import ses_hizala

ROOT = os.path.dirname(os.path.abspath(__file__))
SARKILAR = os.path.join(ROOT, "dans-challenge", "sarkilar")
LEAD = 1.0      # dans baslamadan once klibin oynayacagi sure (sn), skor sayilmaz
TAIL = 0.3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id"); ap.add_argument("baslik"); ap.add_argument("klip"); ap.add_argument("dans")
    ap.add_argument("--kayma", type=float); ap.add_argument("--hiz", type=float, default=1.0)
    a = ap.parse_args()

    if a.kayma is None:
        r = ses_hizala.align(a.klip, a.dans)
        print(f"hizalama: {r}")
        if r["corr"] < 0.4:
            raise SystemExit("HATA: dans videosunun sesi klipte bulunamadi (corr < 0.4). --kayma ile elle ver.")
        a.kayma, a.hiz = r["offset"], r["speed"]

    data, found = poz_cikar.analyse(a.dans)
    ts_klip = [a.kayma + t * a.hiz for t in data["ts"]]
    dance_start, dance_end = ts_klip[0], ts_klip[-1]

    # klibi kes: [dans_basi - LEAD - 0.5, dans_sonu + TAIL + 0.5]
    cut0 = max(0.0, dance_start - LEAD - 0.5)
    cut1 = dance_end + TAIL + 0.5
    out_mp4 = os.path.join(SARKILAR, a.id + ".mp4")
    subprocess.run([ses_hizala.ffmpeg_exe(), "-v", "error", "-y", "-ss", f"{cut0:.3f}", "-to", f"{cut1:.3f}",
                    "-i", a.klip, "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "medium",
                    "-crf", "23", "-r", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
                    "-movflags", "+faststart", out_mp4], check=True)

    # poz zamanlari kesilmis klibe gore; basa LEAD kadar bos kare (skor sayilmaz)
    ts = [round(t - cut0, 3) for t in ts_klip]
    frames = data["frames"]
    step = 1 / poz_cikar.FPS
    lead_ts, t = [], ts[0] - step
    while t > ts[0] - LEAD - 1e-6:
        lead_ts.insert(0, round(t, 3)); t -= step
    ts = lead_ts + ts
    frames = [None] * len(lead_ts) + frames
    pose = {"v": 2, "fps": poz_cikar.FPS, "aspect": data["aspect"], "duration": round(cut1 - cut0, 3),
            "t0": ts[0], "ts": ts, "frames": frames}
    with open(os.path.join(SARKILAR, a.id + ".pose.json"), "w") as f:
        json.dump(pose, f, separators=(",", ":"))

    song = {"id": a.id, "title": a.baslik, "file": f"sarkilar/{a.id}.mp4", "pose": f"sarkilar/{a.id}.pose.json",
            "start": ts[0], "end": round(ts[-1] - 0.05, 2)}
    lst_path = os.path.join(SARKILAR, "sarkilar.json")
    lst = json.load(open(lst_path, encoding="utf-8"))
    songs = [s for s in lst["songs"] if s["id"] != a.id]
    old = [s["id"] for s in lst["songs"]]
    songs.insert(old.index(a.id) if a.id in old else len(songs), song)
    json.dump({"songs": songs}, open(lst_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"{a.id}: klipte {dance_start:.1f}-{dance_end:.1f} sn, oyun {song['end'] - song['start']:.1f} sn, "
          f"kisi bulunan %{found * 100 // max(1, len(data['frames']))}")


if __name__ == "__main__":
    main()
