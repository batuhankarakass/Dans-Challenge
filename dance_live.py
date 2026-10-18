"""
CANLI dans skoru: referans video ekranda oynar, sen kameranin onunde taklit edersin,
skor anlik guncellenir. (dance_score.py ile ayni klasorde olmali.)

Kullanim:
    python dance_live.py referans.mp4                         # USB/dahili webcam (0)
    python dance_live.py referans.mp4 --kaynak 1              # ikinci kamera
    python dance_live.py referans.mp4 --kaynak http://192.168.1.5:8080/video   # telefon (IP Webcam)
    python dance_live.py referans.mp4 --kaynak rtsp://kullanici:sifre@192.168.1.64:554/stream1
    python dance_live.py referans.mp4 --fullscreen            # stant ekrani

Tuslar:  SPACE = basla / tekrar oyna     Q = cikis
Notlar:
  * ffplay kuruluysa (ffmpeg ile gelir) referans videonun sesi otomatik calar.
    Yoksa muzigi baska yerden cal, SPACE'e muzikle ayni anda bas.
  * Kamera goruntusu ayna ise (selfie kamera) --mirror ekle.
"""
import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
import warnings
from collections import deque

import cv2
import numpy as np
import mediapipe as mp

import dance_score as ds

mp_pose = ds.mp_pose
FONT = cv2.FONT_HERSHEY_SIMPLEX
H = 360                 # ekranda her panelin yuksekligi
MAX_LIVE_H = 240        # kamera karesi bundan buyukse kucult (hiz icin)
WINDOW_S = 0.6          # zaman toleransi: +-0.6 sn icindeki referans karelerinden en iyisiyle kiyasla
COUNTDOWN_S = 3


# ---------------------------------------------------------------- kaynak (kamera / akis / dosya)
class Source:
    """Canli kaynakta arka planda hep EN SON kareyi okur (RTSP'de gecikme birikmesin).
    Dosyada kare kare okur ve sanal saat kullanir (test icin)."""

    def __init__(self, src, emulate=False):
        self.src = src
        self.file = ds._is_file(src) and not emulate
        self.emulate = emulate
        self.n = 0
        self.seq = 0
        self.frame = None
        self.lock = threading.Lock()
        self.stop = False
        if self.file:
            self._open()
        else:
            # Kamera, okunacagi thread'de acilir: Camo gibi sanal kameralar baska
            # thread'den okununca siyah kare veriyor.
            self.opened = threading.Event()
            threading.Thread(target=self._loop, daemon=True).start()
            self.opened.wait()
        if not self.cap.isOpened():
            sys.exit(f"HATA: kamera/akis acilamadi: {src}")

    def _open(self):
        if isinstance(self.src, int) and sys.platform == "win32":
            # Format/boyut zorlanmaz: Camo gibi sanal kameralar o zaman siyah kare veriyor.
            # Kare zaten asagida MAX_LIVE_H'ye kucultuluyor.
            self.cap = cv2.VideoCapture(self.src, cv2.CAP_DSHOW)
        else:
            self.cap = cv2.VideoCapture(self.src)
        fps = self.cap.get(cv2.CAP_PROP_FPS)
        self.fps = fps if 1 <= (fps or 0) <= 120 else 30.0

    def _loop(self):
        self._open()
        self.opened.set()
        if not self.cap.isOpened():
            return
        while not self.stop:
            ok, f = self.cap.read()
            if not ok:
                if self.emulate:       # test dosyasi bitti
                    with self.lock:
                        self.frame = None
                    self.stop = True
                    break
                time.sleep(0.05)
                continue
            with self.lock:
                self.frame, self.seq = f, self.seq + 1
            if self.emulate:
                time.sleep(1.0 / self.fps)
        self.cap.release()

    def read(self):
        """(kare, sira_no). Dosya bitti ya da henuz kare yoksa kare=None."""
        if self.file:
            ok, f = self.cap.read()
            self.n += 1
            return (f if ok else None), self.n
        with self.lock:
            return self.frame, self.seq

    def finished(self):
        return self.emulate and self.stop

    def close(self):
        self.stop = True
        if self.file:
            self.cap.release()
        # canli kaynakta cap, kendi thread'i durunca birakilir


# ---------------------------------------------------------------- olcum
def analyse(pose, img):
    """Kareden 8 eklem acisi cikarir (gorunmeyen = NaN), iskeleti img uzerine cizer."""
    h, w = img.shape[:2]
    res = pose.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    row = np.full(len(ds.JOINTS), np.nan)
    if res.pose_landmarks:
        lm = res.pose_landmarks.landmark
        pts = lambda k: np.array([lm[k].x * w, lm[k].y * h])
        for j, (_, a, b, c) in enumerate(ds.JOINTS):
            if min(lm[a].visibility, lm[b].visibility, lm[c].visibility) >= ds.MIN_VIS:
                row[j] = ds.angle(pts(a), pts(b), pts(c))
        mp.solutions.drawing_utils.draw_landmarks(img, res.pose_landmarks, mp_pose.POSE_CONNECTIONS)
    return row


def compare(ref_a, i, u, w):
    """u (8 aci) ile referansin i civarindaki (+-w kare) en iyi eslesmeyi bul.
    Doner: (ortalama fark, eklem farklari, referans indeksi) ya da kisi yoksa None."""
    valid = ~np.isnan(u)
    if valid.sum() < 4:
        return None
    lo, hi = max(0, i - w), min(len(ref_a), i + w + 1)
    d = np.abs(ref_a[lo:hi] - u)
    dm = d[:, valid].mean(axis=1)
    k = int(np.argmin(dm))
    return float(dm[k]), d[k], lo + k


def frame_score(mean_diff):
    return 100.0 / (1.0 + (mean_diff / ds.HALF_DEG) ** 2)


class Run:
    def __init__(self):
        self.sum, self.n, self.inst = 0.0, 0, None
        self.pj, self.pjn = np.zeros(8), np.zeros(8)
        self.hist = deque(maxlen=3)

    def add(self, s, d=None):
        self.sum += s
        self.n += 1
        self.inst = s if self.inst is None else 0.85 * self.inst + 0.15 * s
        if d is not None:
            ok = ~np.isnan(d)
            self.pj[ok] += d[ok]
            self.pjn[ok] += 1

    @property
    def final(self):
        return self.sum / max(1, self.n)

    def worst(self):
        avg = self.pj / np.maximum(1, self.pjn)
        order = np.argsort(-avg)
        return [(ds.NAMES[k], avg[k]) for k in order]


# ---------------------------------------------------------------- cizim
def put(img, text, org, scale=0.8, color=(255, 255, 255), th=2):
    cv2.putText(img, text, (org[0] + 1, org[1] + 1), FONT, scale, (0, 0, 0), th + 2, cv2.LINE_AA)
    cv2.putText(img, text, org, FONT, scale, color, th, cv2.LINE_AA)


def score_color(s):
    return (0, 200, 0) if s >= 70 else (0, 200, 255) if s >= 40 else (0, 0, 255)


def fit_h(img, h=H):
    return cv2.resize(img, (int(img.shape[1] * h / img.shape[0]), h))


def find_ffplay():
    exe = shutil.which("ffplay")
    if exe or sys.platform != "win32":
        return exe
    # winget ile kurulduysa PATH bu pencereye henuz gelmemis olabilir
    import glob
    hits = glob.glob(os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages",
                                  "Gyan.FFmpeg*", "*", "bin", "ffplay.exe"))
    return hits[0] if hits else None


def start_audio(path, enabled):
    exe = find_ffplay()
    if enabled and not exe:
        print("UYARI: ffplay bulunamadi, ses calmayacak. Kurmak icin: winget install Gyan.FFmpeg "
              "(sonra PowerShell'i kapatip ac). Muzigi baska yerden de calabilirsin.")
    if not enabled or not exe:
        return None
    try:
        return subprocess.Popen([exe, "-nodisp", "-autoexit", "-loglevel", "quiet", path],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return None


def stop_audio(p):
    if p and p.poll() is None:
        p.terminate()


def print_summary(run):
    print(f"\nSKOR: {run.final:.0f}/100   ({run.n} kare olculdu)")
    print("Eklem bazli ortalama fark (derece), en kotuden iyiye:")
    for name, v in run.worst():
        print(f"  {name:<11} {v:5.1f}")


# ---------------------------------------------------------------- ana dongu
def main():
    ap = argparse.ArgumentParser(description="Canli dans skoru")
    ap.add_argument("referans", help="referans video")
    ap.add_argument("--kaynak", default="0", help="kamera no (0,1..), rtsp:// veya http:// akis (varsayilan 0)")
    ap.add_argument("--mirror", action="store_true", help="kamera goruntusu ayna ise (selfie kamera)")
    ap.add_argument("--fullscreen", action="store_true", help="tam ekran (stant icin)")
    ap.add_argument("--no-audio", action="store_true", help="referansin sesini calma")
    ap.add_argument("--lite", action="store_true", help="daha hafif/hizli pose modeli (ilk seferde kucuk bir model indirir)")
    ap.add_argument("--fast", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--out", help="sonucu video olarak kaydet (ornek: kayit.mp4)")
    ap.add_argument("--headless", action="store_true", help="pencere acma, hemen basla (test)")
    ap.add_argument("--emulate-live", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args()

    print("Referans hazirlaniyor (acilista bir kez, biraz surer)...")
    ref_a, ref_f, rfps = ds.extract(args.referans)
    n_ref, dur = len(ref_a), len(ref_a) / rfps
    w_frames = max(1, int(round(WINDOW_S * rfps)))

    ksrc = int(args.kaynak) if args.kaynak.isdigit() else args.kaynak
    src = Source(ksrc, emulate=args.emulate_live)
    pose = mp_pose.Pose(static_image_mode=False, model_complexity=0 if (args.lite or args.fast) else 1,
                        smooth_landmarks=True, min_detection_confidence=0.5, min_tracking_confidence=0.5)

    win = "Dans Skoru"
    if not args.headless:
        cv2.namedWindow(win, cv2.WINDOW_NORMAL)
        if args.fullscreen:
            cv2.setWindowProperty(win, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

    state = "play" if args.headless else "wait"
    run, audio, writer = Run(), None, None
    t_start = time.time()
    n_start = 0
    t_cd = 0.0
    last_seq, last_view = -1, None
    t_loop0, warned, got_frame = time.time(), False, False
    print("Hazir. Kameranin onune gec, SPACE ile basla, Q ile cik." if not args.headless else "Baslandi.")

    while True:
        frame, seq = src.read()
        if frame is None:
            if src.file or src.finished():
                if state == "play":
                    state = "done"
                else:
                    break
            else:
                if last_view is None and not args.headless:
                    ph = np.zeros((H, 640, 3), np.uint8)
                    put(ph, "Kamera goruntusu bekleniyor...", (20, 150), 0.9)
                    put(ph, f"Kaynak: {args.kaynak}", (20, 195), 0.7, (200, 200, 200))
                    put(ph, "Gelmiyorsa: baslat.bat --kaynak 1  (2, 3...)", (20, 235), 0.7, (200, 200, 200))
                    last_view = ph
                if not got_frame and not warned and time.time() - t_loop0 > 10:
                    warned = True
                    print("UYARI: 10 saniyedir kameradan goruntu gelmiyor. Baska kamera numarasi dene "
                          "(baslat.bat --kaynak 1), kamerayi kullanan baska uygulamalari kapat, "
                          "Windows Ayarlar > Gizlilik > Kamera'da masaustu uygulamalarina izin ver.")
                time.sleep(0.01)
        elif src.file or seq != last_seq:
            last_seq = seq
            got_frame = True
            if frame.shape[0] > MAX_LIVE_H:
                s = MAX_LIVE_H / frame.shape[0]
                frame = cv2.resize(frame, (int(frame.shape[1] * s), MAX_LIVE_H))

            if state == "done":
                pass
            else:
                row = analyse(pose, frame)
                run.hist.append(row)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", RuntimeWarning)
                    u = np.nanmean(np.array(run.hist), axis=0)
                if args.mirror:
                    u = u[ds.MIRROR_PERM]
                live = fit_h(frame)
                ref_img = ref_f[0].copy()

                if state == "wait":
                    ok_n = int((~np.isnan(row)).sum())
                    ready = ok_n == len(row)
                    put(live, "HAZIR - SPACE ile basla" if ready else "Tum vucudun kadraja girsin",
                        (10, 30), 0.8, (0, 220, 0) if ready else (0, 0, 255))

                elif state == "countdown":
                    left = COUNTDOWN_S - (time.time() - t_cd)
                    if left <= 0:
                        state, t_start, run = "play", time.time(), Run()
                        audio = start_audio(args.referans, not args.no_audio)
                    else:
                        txt = str(int(np.ceil(left)))
                        (tw, th_), _ = cv2.getTextSize(txt, FONT, 5, 8)
                        put(live, txt, ((live.shape[1] - tw) // 2, (H + th_) // 2), 5, (0, 255, 255), 8)

                if state == "play":
                    t = ((src.n - n_start) / src.fps) if src.file else (time.time() - t_start)
                    i = min(n_ref - 1, int(t * rfps))
                    ref_img = ref_f[i].copy()
                    res = compare(ref_a, i, u, w_frames)
                    if res is None:
                        run.add(0.0)
                        put(live, "Kadraja gir!", (10, 30), 0.9, (0, 0, 255))
                    else:
                        dm, d, _ = res
                        run.add(frame_score(dm), d)
                    sc = run.inst or 0.0
                    put(live, f"{sc:.0f}", (live.shape[1] - 130, 70), 2.2, score_color(sc), 5)
                    put(live, f"ort: {run.final:.0f}", (10, H - 40), 0.7, (255, 255, 255))
                    cv2.rectangle(live, (0, H - 8), (int(live.shape[1] * min(1, t / dur)), H),
                                  (0, 200, 255), -1)
                    if t >= dur:
                        state = "done"

                put(ref_img, "REFERANS", (10, 30), 0.8)
                last_view = np.hstack([ref_img, live])

            if state == "done" and last_view is not None and not args.headless and run.n:
                # bitis ekrani
                v = (last_view * 0.35).astype(np.uint8)
                put(v, f"SKOR: {run.final:.0f}", (v.shape[1] // 2 - 170, 150), 2.2, score_color(run.final), 5)
                put(v, f"En cok sapma: {run.worst()[0][0]}", (v.shape[1] // 2 - 170, 210), 0.9)
                put(v, "SPACE: tekrar    Q: cikis", (v.shape[1] // 2 - 170, 260), 0.8, (200, 200, 200))
                last_view = v
                stop_audio(audio)

            if args.out and last_view is not None and state in ("play", "done"):
                if writer is None:
                    writer = cv2.VideoWriter(args.out, cv2.VideoWriter_fourcc(*"mp4v"),
                                             src.fps if (src.file or src.emulate) else 15,
                                             (last_view.shape[1], last_view.shape[0]))
                if state == "play":
                    writer.write(last_view)

        if frame is not None and not src.file and seq == last_seq:
            time.sleep(0.003)           # yeni kare gelmedi, islemciyi bos yorma

        if state == "done" and args.headless:
            break

        if not args.headless:
            if last_view is not None:
                cv2.imshow(win, last_view if args.fullscreen else cv2.resize(last_view, None, fx=2, fy=2))
            k = cv2.waitKey(1) & 0xFF
            if k in (ord("q"), 27):
                break
            if k == ord(" "):
                if state in ("wait", "done"):
                    state, t_cd, run = "countdown", time.time(), Run()
                    stop_audio(audio)

    stop_audio(audio)
    src.close()
    pose.close()
    if writer:
        writer.release()
        print(f"Video kaydedildi: {args.out}")
    if not args.headless:
        cv2.destroyAllWindows()
    if run.n:
        print_summary(run)


if __name__ == "__main__":
    main()
