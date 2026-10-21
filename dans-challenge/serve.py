"""Dans Challenge yerel sunucusu. baslat.bat bunu calistirir; ek paket gerekmez."""
import functools
import http.server
import os
import shutil
import socketserver
import subprocess
import sys
import threading
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows kayit defteri bazen yanlis tur dondurur; bunlari sabitliyoruz
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm",
        ".json": "application/json", ".css": "text/css", ".html": "text/html; charset=utf-8",
        ".woff2": "font/woff2", ".mp4": "video/mp4", ".webm": "video/webm",
        ".tflite": "application/octet-stream", ".data": "application/octet-stream",
        ".binarypb": "application/octet-stream",
    }

    def do_GET(self):
        if self.path.startswith("/ipcam?"):
            return self.ipcam()
        super().do_GET()

    # IP kamera: RTSP'yi FFmpeg ile ardisik JPEG'e cevirip akitir (tarayici RTSP acamaz)
    def ipcam(self):
        url = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("url", [""])[0]
        ffmpeg = shutil.which("ffmpeg")
        err = None
        if not url.lower().startswith(("rtsp://", "rtsps://")):
            err = "Adres rtsp:// ile başlamalı."
        elif not ffmpeg:
            err = "FFmpeg bulunamadı. IP kamera için FFmpeg kurulu olmalı."
        if err:
            body = err.encode()
            self.send_response(400)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        p = subprocess.Popen([ffmpeg, "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", "5000000",
                              "-fflags", "nobuffer", "-flags", "low_delay", "-i", url,
                              # -threads 1: cok cekirdekte kodlayici her cekirdek icin bir kare bekletir (~0.6 sn gecikme)
                              "-an", "-c:v", "mjpeg", "-q:v", "5", "-threads", "1", "-flush_packets", "1",
                              "-f", "mjpeg", "pipe:1"],
                             stdout=subprocess.PIPE, stdin=subprocess.DEVNULL)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.end_headers()
            while True:
                chunk = p.stdout.read1(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            p.kill()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    # Video sarma icin "Range" destegi (Python'un hazir sunucusunda yok)
    def send_head(self):
        rng = self.headers.get("Range")
        if not rng or not rng.startswith("bytes="):
            self._range = None
            return super().send_head()
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            self._range = None
            return super().send_head()
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        size = os.fstat(f.fileno()).st_size
        try:
            a, b = rng[6:].split(",")[0].split("-")
            start = int(a) if a else max(0, size - int(b))
            end = int(b) if (a and b) else size - 1
        except ValueError:
            f.close(); self.send_error(400, "Bad range"); return None
        if start >= size or start > end:
            f.close()
            self.send_response(416); self.send_header("Content-Range", f"bytes */{size}"); self.end_headers()
            return None
        end = min(end, size - 1)
        self._range = (start, end)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        f.seek(start)
        return f

    def copyfile(self, source, outputfile):
        r = getattr(self, "_range", None)
        if not r:
            return super().copyfile(source, outputfile)
        left = r[1] - r[0] + 1
        while left > 0:
            chunk = source.read(min(65536, left))
            if not chunk:
                break
            try:
                outputfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                break
            left -= len(chunk)

    def log_message(self, fmt, *args):  # konsolu kirletme
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    handler = functools.partial(Handler, directory=ROOT)
    for port in range(8000, 8011):
        try:
            httpd = Server(("127.0.0.1", port), handler)
            break
        except OSError:
            continue
    else:
        print("8000-8010 arasinda bos port bulunamadi.")
        input("Kapatmak icin Enter'a bas...")
        sys.exit(1)
    url = f"http://localhost:{port}/"
    print(f"Dans Challenge calisiyor: {url}")
    print("Bu pencere acik kaldigi surece uygulama calisir. Kapatmak icin pencereyi kapat.")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
