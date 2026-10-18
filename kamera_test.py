"""Kamera tani testi: her kamera numarasini farkli yontemlerle dener, sonucu yazdirir."""
import sys
import time

import cv2

WIN = sys.platform == "win32"
print("python", sys.version.split()[0], "| opencv", cv2.__version__, "|", sys.platform, flush=True)

backends = [("DSHOW", cv2.CAP_DSHOW), ("MSMF", cv2.CAP_MSMF), ("ANY", cv2.CAP_ANY)] if WIN else [("ANY", cv2.CAP_ANY)]

for name, b in backends:
    for idx in range(4):
        t0 = time.time()
        try:
            cap = cv2.VideoCapture(idx, b)
            opened = cap.isOpened()
        except Exception as e:  # noqa
            print(f"{name} idx={idx} HATA: {e}", flush=True)
            continue
        ok_n, mean, std, shape = 0, None, None, None
        if opened:
            t1 = time.time()
            while time.time() - t1 < 4 and ok_n < 30:
                ok, f = cap.read()
                if ok and f is not None:
                    ok_n += 1
                    mean, std, shape = float(f.mean()), float(f.std()), f.shape
                else:
                    time.sleep(0.05)
        cap.release()
        print(f"{name:5s} idx={idx} acildi={opened} okunan_kare={ok_n} boyut={shape} "
              f"parlaklik={None if mean is None else round(mean, 1)} "
              f"kontrast={None if std is None else round(std, 1)} sure={time.time() - t0:.1f}s", flush=True)
print("TEST BITTI", flush=True)
