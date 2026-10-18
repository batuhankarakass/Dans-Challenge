@echo off
cd /d "%~dp0"
call venv\Scripts\activate
python kamera_bul.py
echo.
pause
