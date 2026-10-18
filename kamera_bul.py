"""Hangi kamera numarasi hangi kamera? Her numarayi sirayla gosterir.
ENTER = bu kamerayi kullan (kaydeder)   BOSLUK = sonraki   Q = cik"""
import sys
import cv2

WIN = sys.platform == "win32"


def main():
    found = False
    for idx in range(6):
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW) if WIN else cv2.VideoCapture(idx)
        if not cap.isOpened():
            print(f"[{idx}] acilamadi")
            cap.release()
            continue
        found = True
        print(f"[{idx}] aciliyor... (ENTER: bunu kullan, BOSLUK: sonraki, Q: cik)")
        choice = None
        while True:
            ok, f = cap.read()
            if not ok:
                f = None
            if f is not None:
                f = f.copy()
                cv2.putText(f, f"Kamera {idx}  |  ENTER: bu  BOSLUK: sonraki  Q: cik", (10, 25),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
                cv2.imshow("kamera_bul", f)
            k = cv2.waitKey(30) & 0xFF
            if k in (13, 10):
                choice = "use"
                break
            if k == ord(" "):
                break
            if k in (ord("q"), 27):
                choice = "quit"
                break
        cap.release()
        if choice == "use":
            open("kaynak.txt", "w").write(str(idx))
            print(f"\nKaydedildi: kamera {idx}. Artik baslat.bat bu kamerayi kullanacak.")
            break
        if choice == "quit":
            break
    cv2.destroyAllWindows()
    if not found:
        print("Hic kamera acilamadi. Baska uygulamalari kapat, Windows kamera iznini kontrol et.")


if __name__ == "__main__":
    main()
