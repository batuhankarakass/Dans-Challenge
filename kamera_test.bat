@echo off
cd /d "%~dp0"
call venv\Scripts\activate
set OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS=0
echo Kamera testi calisiyor, 1-2 dakika surebilir. Pencereyi kapatma...
python kamera_test.py > kamera_rapor.txt 2>&1
echo. >> kamera_rapor.txt
echo --- Windows kamera cihazlari >> kamera_rapor.txt
powershell -NoProfile -Command "Get-PnpDevice -Class Camera,Image -ErrorAction SilentlyContinue | Format-Table Status,FriendlyName -AutoSize | Out-String -Width 200" >> kamera_rapor.txt 2>&1
echo --- Kamera izni (Allow = acik, Deny = kapali) >> kamera_rapor.txt
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam" /v Value >> kamera_rapor.txt 2>&1
reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam" /v Value >> kamera_rapor.txt 2>&1
echo --- Paketler >> kamera_rapor.txt
pip list 2>nul | findstr /i "opencv mediapipe numpy" >> kamera_rapor.txt
echo.
echo Bitti. Bu pencereyi kapat ve Claude'a "bitti" yaz.
pause
