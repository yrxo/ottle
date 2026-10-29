@echo off
title Ottle Launcher
cd /d "%~dp0"

REM Agar server pehle se chal raha hai to dobara start mat karo
tasklist /FI "IMAGENAME eq python.exe" 2>NUL | find /I "python.exe" >NUL
if errorlevel 1 (
    start "Ottle Server" /min "C:\Users\lenovo\AppData\Local\Python\bin\python.exe" server.py
    timeout /t 2 /nobreak >NUL
)

start "" http://localhost:5173
exit
