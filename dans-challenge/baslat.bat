@echo off
chcp 65001 >nul
title Dans Challenge
cd /d "%~dp0"

rem Uygulama icin hicbir paket gerekmez, sadece Python'un kendisi
where py >nul 2>nul && (py serve.py & goto :eof)
where python >nul 2>nul && (python serve.py & goto :eof)

echo Python bulunamadi. https://www.python.org/downloads/ adresinden kurup tekrar dene.
echo Ya da paylasilan internet linkini kullan.
pause
