"""Bir kisa videonun sesinin, sarkinin (klibin) hangi saniyesine denk geldigini bulur.

Yontem: iki sesin "vurus zarfi" (spectral flux, 100 kare/sn) cikarilir ve capraz korelasyonla
en iyi kayma bulunur. TikTok'ta sarki hizlandirilmis olabildigi icin farkli hizlar denenir.

Kullanim:
    python ses_hizala.py klip.mp4 kisa.mp4
Cikti: kayma (sn), hiz ve guven puani. kisa videonun t. saniyesi = klipte kayma + t * hiz.
"""
import subprocess
import sys

import numpy as np

SR = 11025
HOP = SR // 100          # 100 zarf karesi / sn
ENV_FPS = SR / HOP


def ffmpeg_exe():
    import shutil, glob, os
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    hits = glob.glob(os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages",
                                  "Gyan.FFmpeg*", "*", "bin", "ffmpeg.exe"))
    if not hits:
        sys.exit("HATA: ffmpeg bulunamadi")
    return hits[0]


def load(path, speed=1.0):
    """Mono ses; speed != 1 ise sure (perde degil) degistirilir."""
    af = ["-af", f"atempo={speed}"] if abs(speed - 1) > 1e-3 else []
    raw = subprocess.run([ffmpeg_exe(), "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), *af,
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def envelope(x):
    n = len(x) // HOP - 1
    if n <= 4:
        return np.zeros(1)
    win = np.hanning(2 * HOP)
    frames = np.lib.stride_tricks.as_strided(x, shape=(n, 2 * HOP), strides=(x.strides[0] * HOP, x.strides[0]))
    mag = np.log1p(np.abs(np.fft.rfft(frames * win, axis=1)))
    flux = np.maximum(0, np.diff(mag, axis=0)).sum(axis=1)
    flux -= np.convolve(flux, np.ones(50) / 50, mode="same")      # yerel ortalamayi cikar
    flux = np.maximum(flux, 0)
    return (flux - flux.mean()) / (flux.std() + 1e-9)


def best_offset(song_env, clip_env):
    """clip_env'in song_env icindeki en iyi yeri: (kayma_kare, guven)."""
    n = len(song_env) + len(clip_env)
    size = 1 << (n - 1).bit_length()
    corr = np.fft.irfft(np.fft.rfft(song_env, size) * np.conj(np.fft.rfft(clip_env, size)), size)[:len(song_env)]
    corr /= len(clip_env)
    k = int(np.argmax(corr))
    # guven: tepe, diger tepelerden ne kadar ayrisiyor
    mask = np.ones_like(corr, bool); mask[max(0, k - 100):k + 100] = False
    rest = corr[mask]
    z = (corr[k] - rest.mean()) / (rest.std() + 1e-9)
    return k, float(corr[k]), float(z)


def align(song_path, clip_path, speeds=(1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 0.95, 0.9)):
    song_env = envelope(load(song_path))
    best = None
    for sp in speeds:
        # kisa videoyu 'sp' kat yavaslat -> sarkinin hizina getir (kisa video sp kat hizli ise)
        clip_env = envelope(load(clip_path, 1 / sp))
        k, c, z = best_offset(song_env, clip_env)
        if best is None or z > best[3]:
            best = (k / ENV_FPS, sp, c, z)
    return {"offset": round(best[0], 3), "speed": best[1], "corr": round(best[2], 3), "z": round(best[3], 1)}


def chroma(x, fps=10):
    """12 nota sinifi enerjisi (kromagram), kare basina normalize: kisik/yankili kayitta da melodiyi korur."""
    hop, n = SR // fps, 4096
    m = len(x) // hop - n // hop
    if m <= 4:
        return np.zeros((1, 12))
    frames = np.lib.stride_tricks.as_strided(x, shape=(m, n), strides=(x.strides[0] * hop, x.strides[0]))
    mag = np.abs(np.fft.rfft(frames * np.hanning(n), axis=1))
    f = np.fft.rfftfreq(n, 1 / SR)
    ok = (f > 80) & (f < 4000)
    pc = np.round(12 * np.log2(f[ok] / 440)).astype(int) % 12
    c = np.zeros((m, 12))
    for k in range(12):
        c[:, k] = mag[:, ok][:, pc == k].sum(axis=1)
    c = np.log1p(c)
    c -= c.mean(axis=1, keepdims=True)
    return c / (np.linalg.norm(c, axis=1, keepdims=True) + 1e-9)


def align_chroma(song_path, clip_path, fps=10):
    """Kisa videonun sesi sarkinin neresinde (1x hiz): melodi uzerinden. {'offset', 'z'}"""
    s, c = chroma(load(song_path), fps), chroma(load(clip_path), fps)
    size = 1 << (len(s) + len(c)).bit_length()
    corr = sum(np.fft.irfft(np.fft.rfft(s[:, k], size) * np.conj(np.fft.rfft(c[:, k], size)), size)[:len(s)]
               for k in range(12)) / len(c)
    k = int(np.argmax(corr))
    mask = np.ones_like(corr, bool); mask[max(0, k - fps):k + fps] = False
    z = (corr[k] - corr[mask].mean()) / (corr[mask].std() + 1e-9)
    # ikinci en iyi yer (tekrarlanan nakarat): net degilse hangi tekrar oldugu belirsizdir
    second = float(corr[mask].max()) if mask.any() else 0.0
    return {"offset": round(k / fps, 2), "z": round(float(z), 1), "peak": round(float(corr[k]), 3),
            "second": round(second, 3)}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(align(sys.argv[1], sys.argv[2]))
