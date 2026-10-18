@echo off
cd /d "%~dp0"
call venv\Scripts\activate
set KAYNAK=0
if exist kaynak.txt set /p KAYNAK=<kaynak.txt

set S=dans-challenge\sarkilar
echo Sarki sec:
echo   1 - Manifest
echo   2 - Tralala
echo   3 - Toz Pembe
echo   4 - Snap
echo   5 - Ariyo
echo   6 - KTS
echo   7 - Zamansizdik
set SEC=1
set /p SEC=Numara (Enter = 1):
set REF=%S%\manifest.mp4
if "%SEC%"=="2" set REF=%S%\tralala.mp4
if "%SEC%"=="3" set REF=%S%\toz-pembe.mp4
if "%SEC%"=="4" set REF=%S%\snap.mp4
if "%SEC%"=="5" set REF=%S%\ariyo.mp4
if "%SEC%"=="6" set REF=%S%\kts.mp4
if "%SEC%"=="7" set REF=%S%\zamansizdik.mp4

python dance_live.py %REF% --kaynak %KAYNAK% %*
echo.
pause
