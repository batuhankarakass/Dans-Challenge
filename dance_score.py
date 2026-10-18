"""
Dans skoru: referans video ile deneme videosunu karsilastirir.

Kullanim:
    python dance_score.py referans.mp4 deneme.mp4
    python dance_score.py referans.mp4 deneme.mp4 --mirror      # on kamera (ayna) goruntusuyse
    python dance_score.py referans.mp4 http://192.168.1.5:8080/video --seconds 30   # canli kaynak

Yontem: MediaPipe Pose -> eklem acilari (konum/olcek bagimsiz) -> DTW ile zaman hizalama -> skor.
Orijinal repo: https://github.com/PrashantSaikia/Body-Movement-Comparison-with-Mediapipe
"""
import argparse
import sys
import time

import cv2
import numpy as np
import mediapipe as mp
from fastdtw import fastdtw

mp_pose = mp.solutions.pose
L = mp_pose.PoseLandmark

# (isim, a, b(tepe nokta), c)
JOINTS = [
    ("sol dirsek", L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST),
    ("sag dirsek", L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST),
    ("sol omuz", L.LEFT_HIP, L.LEFT_SHOULDER, L.LEFT_ELBOW),
    ("sag omuz", L.RIGHT_HIP, L.RIGHT_SHOULDER, L.RIGHT_ELBOW),
    ("sol kalca", L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE),
    ("sag kalca", L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_KNEE),
    ("sol diz", L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE),
    ("sag diz", L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE),
]
NAMES = [j[0] for j in JOINTS]
# ayna modunda sol<->sag yer degistirir
MIRROR_PERM = [1, 0, 3, 2, 5, 4, 7, 6]

TARGET_FPS = 15          # her iki videoyu da bu hizda ornekle
MIN_VIS = 0.5            # bundan dusuk gorunurluktaki eklem "yok" sayilir
HALF_DEG = 25.0          # ortalama 25 derece fark = 50 puan


def angle(a, b, c):
    """b noktasindaki aci (0-180 derece)."""
    v1, v2 = a - b, c - b
    n = np.linalg.norm(v1) * np.linalg.norm(v2)
    if n < 1e-6:
        return np.nan
    cosv = np.clip(np.dot(v1, v2) / n, -1.0, 1.0)
    return float(np.degrees(np.arccos(cosv)))


def extract(source, seconds=None, show=False, label="video"):
    """Videodan (dosya/URL/kamera) kare kare eklem acilarini cikarir.
    Doner: aci matrisi (kare x 8), cizimli kareler listesi (kucuk), gercek fps."""
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        sys.exit(f"HATA: '{source}' acilamadi.")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if src_fps > 120 or src_fps < 1:   # bazi akislar fps vermez
        src_fps = 30.0
    step = max(1, int(round(src_fps / TARGET_FPS)))

    angles, frames = [], []
    pose = mp_pose.Pose(static_image_mode=False, model_complexity=1,
                        smooth_landmarks=True,
                        min_detection_confidence=0.5, min_tracking_confidence=0.5)
    i, t0 = 0, time.time()
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if seconds and (time.time() - t0 > seconds) and not _is_file(source):
            break
        if seconds and _is_file(source) and i / src_fps > seconds:
            break
        i += 1
        if (i - 1) % step:
            continue
        h, w = img.shape[:2]
        res = pose.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        row = [np.nan] * len(JOINTS)
        if res.pose_landmarks:
            lm = res.pose_landmarks.landmark
            # piksel olcegi (x'i w, y'yi h ile carp): aci bozulmasin
            pts = lambda k: np.array([lm[k].x * w, lm[k].y * h])
            for j, (_, a, b, c) in enumerate(JOINTS):
                if min(lm[a].visibility, lm[b].visibility, lm[c].visibility) >= MIN_VIS:
                    row[j] = angle(pts(a), pts(b), pts(c))
            mp.solutions.drawing_utils.draw_landmarks(
                img, res.pose_landmarks, mp_pose.POSE_CONNECTIONS)
        angles.append(row)
        scale = 360.0 / h
        frames.append(cv2.resize(img, (int(w * scale), 360)))
        if show:
            cv2.imshow(label, frames[-1])
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    cap.release()
    pose.close()
    if show:
        cv2.destroyAllWindows()
    if not angles:
        sys.exit(f"HATA: '{source}' icinde kare okunamadi.")
    return _clean(np.array(angles, dtype=float)), frames, src_fps / step


def _is_file(src):
    return isinstance(src, str) and not src.startswith(("rtsp://", "http://", "https://"))


def _clean(a):
    """NaN'lari (gorunmeyen eklem) en yakin degerle doldur, hafif yumusat."""
    out = a.copy()
    for j in range(out.shape[1]):
        col = out[:, j]
        good = ~np.isnan(col)
        if not good.any():
            out[:, j] = 90.0          # hic gorunmediyse notr deger
            continue
        idx = np.arange(len(col))
        out[:, j] = np.interp(idx, idx[good], col[good])
    k = 3
    pad = np.pad(out, ((k // 2, k // 2), (0, 0)), mode="edge")
    return np.stack([np.convolve(pad[:, j], np.ones(k) / k, mode="valid")
                     for j in range(out.shape[1])], axis=1)


def score(ref, usr):
    """DTW ile hizala, ortalama aci farkindan 0-100 skor uret."""
    dist, path = fastdtw(ref, usr, dist=lambda x, y: float(np.mean(np.abs(x - y))))
    diffs = np.array([np.abs(ref[i] - usr[j]) for i, j in path])   # (adim x 8)
    per_joint = diffs.mean(axis=0)
    mean_diff = float(diffs.mean())
    total = 100.0 / (1.0 + (mean_diff / HALF_DEG) ** 2)
    return total, per_joint, mean_diff, path


def write_video(path, ref_frames, usr_frames, ref_ang, usr_ang, fps, align_path, total):
    """Yan yana video: sol referans, sag deneme (DTW'ye gore eslesen kareler)."""
    hh = 360
    rw, uw = ref_frames[0].shape[1], usr_frames[0].shape[1]
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (rw + uw, hh))
    for i, j in align_path:
        fr_r, fr_u = ref_frames[i].copy(), usr_frames[j].copy()
        d = float(np.mean(np.abs(ref_ang[i] - usr_ang[j])))
        good = d < 20
        cv2.putText(fr_u, f"fark: {d:.0f} derece", (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                    0.8, (0, 200, 0) if good else (0, 0, 255), 2)
        cv2.putText(fr_r, "REFERANS", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.putText(fr_u, f"SKOR: {total:.0f}", (10, hh - 15), cv2.FONT_HERSHEY_SIMPLEX,
                    1.0, (0, 255, 255), 2)
        out.write(np.hstack([fr_r, fr_u]))
    out.release()


def main():
    ap = argparse.ArgumentParser(description="Dans taklit skoru")
    ap.add_argument("referans", help="referans video dosyasi")
    ap.add_argument("deneme", help="deneme videosu / kamera no (0) / rtsp:// / http:// akis")
    ap.add_argument("--mirror", action="store_true", help="deneme goruntusu ayna ise (on kamera)")
    ap.add_argument("--seconds", type=float, help="deneme icin en fazla bu kadar saniye al")
    ap.add_argument("--show", action="store_true", help="isleme sirasinda pencerede goster")
    ap.add_argument("--out", default="sonuc.mp4", help="yan yana sonuc videosu")
    args = ap.parse_args()

    usr_src = int(args.deneme) if args.deneme.isdigit() else args.deneme
    print("Referans isleniyor...")
    ref_a, ref_f, fps = extract(args.referans, show=args.show, label="referans")
    print("Deneme isleniyor...")
    usr_a, usr_f, _ = extract(usr_src, seconds=args.seconds, show=args.show, label="deneme")
    if args.mirror:
        usr_a = usr_a[:, MIRROR_PERM]

    total, per_joint, mean_diff, path = score(ref_a, usr_a)
    print(f"\nSKOR: {total:.0f}/100   (ortalama aci farki: {mean_diff:.1f} derece)")
    print("Eklem bazli ortalama fark (derece):")
    for n, v in sorted(zip(NAMES, per_joint), key=lambda x: -x[1]):
        print(f"  {n:<11} {v:5.1f}")
    print(f"En cok sapma: {NAMES[int(np.argmax(per_joint))]}")

    write_video(args.out, ref_f, usr_f, ref_a, usr_a, fps, path, total)
    print(f"\nYan yana video kaydedildi: {args.out}")


if __name__ == "__main__":
    main()
