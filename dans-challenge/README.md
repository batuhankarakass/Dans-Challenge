# Dans Challenge

Kulüp standı için dans taklit oyunu. Ekranda referans dans oynar, oyuncu kameranın karşısında taklit eder. Uygulama her saniyeyi PERFECT / GREAT / GOOD / MISS diye değerlendirir, sonunda yüzde, yıldız, skor tablosu ve "en iyi an" fotoğrafı verir.

Tarayıcıda çalışır (Chrome veya Edge önerilir). Kurulum gerekmez, internetsiz de çalışır.

## Laptopta açmak

`baslat.bat` dosyasına çift tıkla. Tarayıcı `http://localhost:8000` adresinde açılır. Siyah pencere açık kaldığı sürece uygulama çalışır.

- Tarayıcı kamera izni isterse **İzin ver**'e bas.
- **F** tuşu tam ekran yapar.
- `index.html` dosyasına doğrudan çift tıklarsan çalışmaz, mutlaka `baslat.bat` ya da internet linki ile aç.

## Kısayollar

| Tuş | Ne yapar |
|---|---|
| Space / Enter | Başla, tekrar oyna |
| ↑ ↓ | Ana ekranda şarkı değiştir |
| Esc | Ana ekrana dön |
| F | Tam ekran |
| S | Ayarlar |
| D | Sonuç ekranında fotoğrafı indir |

## Arkadaşlara link olarak göndermek (GitHub Pages)

Bir kere yapılır, sonra herkes linke tıklayıp oynar. Linkte kamera da çalışır.

1. https://github.com adresinde oturum aç, sağ üstte **+** > **New repository**.
2. İsim olarak `dans-challenge` yaz, **Public** seçili olsun, **Create repository**.
3. Açılan sayfada **uploading an existing file** bağlantısına tıkla.
4. Bu klasörün **içindeki her şeyi** (klasörler dahil: `lib`, `fonts`, `sarkilar`) sürükleyip bırak. Yükleme bitince **Commit changes**.
5. Repo sayfasında **Settings** > soldan **Pages**. "Branch" kısmında `main` ve `/ (root)` seç, **Save**.
6. 1-2 dakika sonra aynı sayfanın üstünde link çıkar: `https://KULLANICI-ADIN.github.io/dans-challenge/`

Sonradan bir şeyi değiştirirsen aynı dosyayı tekrar yüklemen yeterli, link aynı kalır.

Not: Repo herkese açık olduğu için içindeki dans videosu da herkese açık olur. Başkasına ait bir video ise telif şikâyeti gelebilir.

Skor tablosu her cihazın kendi tarayıcısında tutulur. Stanttaki laptopun tablosu sadece o laptopta görünür.

## Şarkı eklemek ve değiştirmek

**Kolay yol (sadece o bilgisayarda):** Ana ekranda **Şarkıları yönet** > **+ Video ekle**. Videoyu seç, başlangıç ve bitişi işaretle, **Kaydet**. Video bir kez analiz edilir (laptopta 20-30 saniye) ve o tarayıcıda saklanır.

**Herkes için kalıcı yol:** Videoyu `sarkilar` klasörüne koy ve `sarkilar/sarkilar.json` dosyasına bir satır ekle:

```json
{
  "songs": [
    { "id": "manifest", "title": "Manifest", "file": "sarkilar/manifest.mp4", "pose": "sarkilar/manifest.pose.json", "start": 0, "end": 20.9 },
    { "id": "yeni", "title": "Yeni Şarkı", "file": "sarkilar/yeni.mp4", "start": 12, "end": 52 }
  ]
}
```

- `id`: boşluksuz, benzersiz bir ad.
- `start`, `end`: dansın kaçıncı saniyeden başlayıp nerede bittiği. Stant için 30-45 saniye ideal.
- `pose` yazmazsan uygulama videoyu ilk oynatılışta kendisi analiz eder.
- Hazır analizi önceden üretmek için üst klasörde: `venv\Scripts\python poz_cikar.py dans-challenge\sarkilar\yeni.mp4` (videonun yanına `yeni.pose.json` yazar).

**Tek komutla şarkı eklemek:** Üst klasörde

```
venv\Scripts\python sarki_hazirla.py yeni "Yeni Şarkı" tekli-dans.mp4
```

Dansçının hareket etmeye başladığı ve bitirdiği an bulunup müziğin vuruşuna oturtulur, video o bölümden kesilir (başta 1 sn giriş payı), poz verisi çıkarılır ve `sarkilar.json` güncellenir. Kesimi elle vermek için `--bas SANİYE --son SANİYE`. Gerekli paketler: `venv\Scripts\pip install -r requirements.txt` ve FFmpeg.

**Puanlamayı değiştirdikten sonra:** `node dans-challenge/engine.test.js` her şarkıda kendi dansın yüksek, başka dansın düşük puan aldığını kontrol eder.

**İyi bir referans video:** Tek kişi, önden çekilmiş, baştan sona tüm vücut görünüyor, sabit kamera.

## Ayarlar (sağ üstteki çark)

- **Kamera:** Birden fazla kamera varsa buradan seç.
- **Zorluk:** Kolay / Normal / Zor. Stantta herkes düşük alıyorsa Kolay'a çek.
- **Taklit şekli:** Otomatik bırak. Oyuncu ayna gibi mi birebir mi oynuyor, uygulama kendisi anlar.
- **Kamera gecikmesi:** Laptop kamerasında 0.1. Görüntü geç geliyorsa artır.
- **Performans:** Kasarsa "Hızlı"yı seç.
- **Görünüm:** Başlık ve kulüp adı. Logo için bu klasöre `logo.png` koyman yeterli.

## Güvenlik kamerası bağlamak

- **USB kamera:** Tak, Ayarlar > Kamera listesinde görünür.
- **IP kamera (RTSP):** Uygulamayı `baslat.bat` ile aç (internet linkinde çalışmaz). Bilgisayarda FFmpeg kurulu olmalı (`winget install Gyan.FFmpeg`).
  1. Ayarlar > Kamera > **IP kamera (RTSP)** seç.
  2. Altındaki kutuya kameranın RTSP adresini yaz, örneğin `rtsp://192.168.1.106:554/stream1`.
  3. **Kamera gecikmesi**ni ayarla (bu kamera için 0.35 civarı).

  Bağlantı koparsa uygulama kendisi yeniden bağlanır. Kameranın kendi programı (IPCBatchTool vb.) açıkken kamera bağlantıyı koparabilir, o programı kapat.
- **Kameranın kendi programından (IPCBatchTool):** Programda canlı görüntüyü aç, sonra Ayarlar > Kamera > **Pencere yakalama (IPCBatchTool)** seç ve açılan listeden görüntü penceresini seç. Pencere açık kalmalı (arkada kalabilir, simge durumuna küçültülmemeli). Sayfa her açıldığında pencere tekrar sorulur.

## Sorun giderme

| Sorun | Çözüm |
|---|---|
| "Kamera kullanımda" | Zoom, Teams, Discord, DroidCam gibi kamerayı kullanan uygulamaları kapat, sayfayı yenile. |
| "Kamera izni verilmedi" | Adres çubuğundaki kamera simgesine tıkla, izin ver, sayfayı yenile. |
| Kasıyor | Ayarlar > Performans > Hızlı. Chrome ayarlarında "Donanım hızlandırmayı kullan" açık olsun. |
| Skorlar hep düşük | Oyuncu tüm vücudu görünecek kadar geri çekilsin, ışık önden gelsin. Gerekirse Zorluk > Kolay. |
| Ses yok | Bilgisayarın sesini ve tarayıcı sekmesinin sessizde olmadığını kontrol et. |

## Kullanılan açık kaynaklar

- MediaPipe Pose (Google, Apache 2.0): vücut algılama
- Bungee ve Outfit yazı tipleri (SIL Open Font License)
