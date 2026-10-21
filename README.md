# Dans Challenge

Kulüp standı için dans taklit oyunu. Ekranda referans dans oynar, oyuncu kameranın karşısında taklit eder. Uygulama her saniyeyi PERFECT / GREAT / GOOD / MISS diye değerlendirir, sonunda yüzde, yıldız, skor tablosu ve "en iyi an" fotoğrafı verir.

Tarayıcıda çalışır (Chrome veya Edge önerilir). Kurulum gerekmez, internetsiz de çalışır.

## Klasörler

| Ne | Ne işe yarar |
|---|---|
| `Dans Challenge.pyw` | Oyunu açar. Çift tıkla. |
| `oyun/` | Oyunun kendisi: sayfa, kod, şarkılar (`oyun/sarkilar`), yazı tipleri, hareket algılama modeli. |
| `araclar/` | Yeni şarkı hazırlama scriptleri. Sadece şarkı eklerken gerekir. |

## Laptopta açmak

`Dans Challenge.pyw` dosyasına çift tıkla. Oyun adres çubuğu olmayan tam ekran bir pencerede açılır (Edge, yoksa Chrome). Pencereyi kapatınca oyun da kapanır. Bilgisayarda Python kurulu olmalı.

Elle başlatmak istersen `oyun` klasöründe `py serve.py` yaz, sonra tarayıcıda `http://localhost:8000` aç.

- Tarayıcı kamera izni isterse **İzin ver**'e bas.
- **F** tuşu tam ekran yapar.
- `index.html` dosyasına doğrudan çift tıklarsan çalışmaz, mutlaka `Dans Challenge.pyw` ya da internet linki ile aç.
- Tam ekrandan çıkmak için **F11**, oyunu kapatmak için **Alt+F4**.

## Kısayollar

| Tuş | Ne yapar |
|---|---|
| Space / Enter | Başla, tekrar oyna |
| ↑ ↓ | Ana ekranda şarkı değiştir |
| ← → | Ana ekranda tür değiştir (birden fazla tür varsa) |
| Esc | Ana ekrana dön |
| F | Tam ekran |
| S | Ayarlar |
| D | Sonuç ekranında fotoğrafı indir |


## Şarkı eklemek ve değiştirmek

**Kolay yol (sadece o bilgisayarda):** Ana ekranda **Şarkıları yönet** > **+ Video ekle**. Videoyu seç, başlangıç ve bitişi işaretle, **Kaydet**. Video bir kez analiz edilir (laptopta 20-30 saniye) ve o tarayıcıda saklanır.

**Herkes için kalıcı yol:** Videoyu `oyun/sarkilar` klasörüne koy ve `oyun/sarkilar/sarkilar.json` dosyasına bir satır ekle:

```json
{
  "songs": [
    { "id": "manifest", "title": "Manifest", "tur": "Pop", "file": "sarkilar/manifest.mp4", "pose": "sarkilar/manifest.pose.json", "start": 0, "end": 20.9 },
    { "id": "yeni", "title": "Yeni Şarkı", "tur": "Oyun Havası", "file": "sarkilar/yeni.mp4", "start": 12, "end": 52 }
  ]
}
```

- `id`: boşluksuz, benzersiz bir ad.
- `tur`: ana ekrandaki sekme (Pop, Oyun Havası, Roman Havası…). Aynı yazılan türler aynı sekmede toplanır. Birden fazla tür olunca sekmeler kendiliğinden çıkar.
- `start`, `end`: dansın kaçıncı saniyeden başlayıp nerede bittiği. Stant için 30-45 saniye ideal.
- `pose` yazmazsan uygulama videoyu ilk oynatılışta kendisi analiz eder.
- Hazır analizi önceden üretmek için ana klasörde: `venv\Scripts\python araclar\poz_cikar.py oyun\sarkilar\yeni.mp4` (videonun yanına `yeni.pose.json` yazar).

**Tek komutla şarkı eklemek:** Ana klasörde

```
venv\Scripts\python araclar\sarki_hazirla.py yeni "Yeni Şarkı" tekli-dans.mp4 --tur "Oyun Havası"
```

`--tur` yazmazsan şarkı "Pop" sekmesine girer.

Dansçının hareket etmeye başladığı ve bitirdiği an bulunup müziğin vuruşuna oturtulur, video o bölümden kesilir (başta 1 sn giriş payı), poz verisi çıkarılır ve `sarkilar.json` güncellenir. Kesimi elle vermek için `--bas SANİYE --son SANİYE`. Gerekli paketler: `venv\Scripts\python -m pip install -r araclar\requirements.txt` ve FFmpeg.

**Puanlamayı değiştirdikten sonra:** `node oyun/engine.test.js` her şarkıda kendi dansın yüksek, başka dansın düşük puan aldığını kontrol eder.

**İyi bir referans video:** Tek kişi, önden çekilmiş, baştan sona tüm vücut görünüyor, sabit kamera.

## Ayarlar (sağ üstteki çark)

- **Kamera:** Birden fazla kamera varsa buradan seç.
- **Zorluk:** Kolay / Normal / Zor. Stantta herkes düşük alıyorsa Kolay'a çek.
- **Taklit şekli:** Otomatik bırak. Oyuncu ayna gibi mi birebir mi oynuyor, uygulama kendisi anlar.
- **Kamera gecikmesi:** Laptop kamerasında 0.1. Görüntü geç geliyorsa artır.
- **Performans:** Kasarsa "Hızlı"yı seç.
- **Görünüm:** Başlık ve kulüp adı. Logo için `oyun` klasörüne `logo.png` koyman yeterli.

## Arka plan müziği

Ana ekranda müziği kendin aç (Spotify, YouTube, herhangi bir müzik uygulaması). Biri **Başla**'ya basınca oyun çalan müziği durdurur. Oyun bitip sonuç ekranı gelince ya da ana ekrana dönülünce müzik kaldığı yerden devam eder. Sadece oyunun durdurduğu müzik devam ettirilir: sen kendin durdurduysan oyun onu açmaz.

Bu özellik oyun `Dans Challenge.pyw` (ya da `oyun` klasöründe `py serve.py`) ile açıldığında çalışır, internet linkinde çalışmaz. Windows'un medya kontrolünü kullanır: klavyedeki medya tuşlarıyla durdurulabilen her uygulama olur.

## Güvenlik kamerası bağlamak

- **USB kamera:** Tak, Ayarlar > Kamera listesinde görünür.
- **IP kamera (RTSP):** Uygulamayı `Dans Challenge.pyw` ile aç (internet linkinde çalışmaz). Bilgisayarda FFmpeg kurulu olmalı (`winget install Gyan.FFmpeg`).
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
