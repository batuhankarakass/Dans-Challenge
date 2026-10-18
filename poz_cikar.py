"""Dans Challenge icin hazir poz verisi (.pose.json) uretir.

Kullanim:
    python poz_cikar.py dans-challenge/sarkilar/tralala.mp4 [baska.mp4 ...]

Her videonun yanina ayni isimle .pose.json yazar. Bicim, uygulamanin kendi
analiziyle ayni (v2): 15 fps, 12 eklem noktasi [x, y, gorunurluk], ts = kare zamani.
"""
import json
import os
import sys

import cv2
import mediapipe as mp

FPS = 15
MP_IDX = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]   # engine.js ile ayni sira


def analyse(path):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        sys.exit(f"HATA: video acilamadi: {path}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w, h = cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    pose = mp.solutions.pose.Pose(model_complexity=1, smooth_landmarks=True,
                                  min_detection_confidence=0.5, min_tracking_confidence=0.5)
    frames, ts = [], []
    i, next_t = 0, 0.0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        t = i / src_fps
        i += 1
        if t + 1e-6 < next_t:
            continue
        next_t += 1 / FPS
        r = pose.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        if r.pose_landmarks:
            lm = r.pose_landmarks.landmark
            frames.append([[round(lm[k].x, 4), round(lm[k].y, 4), round(lm[k].visibility, 4)] for k in MP_IDX])
        else:
            frames.append(None)
        ts.append(round(t, 3))
    cap.release()
    pose.close()
    found = sum(f is not None for f in frames)
    return {"v": 2, "fps": FPS, "aspect": round(w / h, 5), "duration": round(i / src_fps, 3),
            "t0": ts[0] if ts else 0, "ts": ts, "frames": frames}, found


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for path in sys.argv[1:]:
        data, found = analyse(path)
        out = os.path.splitext(path)[0] + ".pose.json"
        with open(out, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"{os.path.basename(out)}: {len(data['frames'])} kare, kisi bulunan %{found * 100 // max(1, len(data['frames']))}, "
              f"sure {data['duration']} sn")


if __name__ == "__main__":
    main()
