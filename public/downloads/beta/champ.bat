@echo off
setlocal
cd /d "%~dp0"

rem Champ Client for Windows.
rem Keep this file next to champ.exe. Start Minecraft 1.21.11 first, then
rem double-click this file (or champ.exe directly). Champ draws its own window,
rem checks your license and this PC, then puts the client into the running game.

if not exist "champ.exe" (
    echo.
    echo   champ.exe is missing next to champ.bat.
    echo   Keep both files in the same folder and try again.
    echo.
    pause
    exit /b 1
)

rem No /wait: the console belongs to this .bat only, and closing it immediately
rem leaves just the rounded Champ window on screen.
start "" "champ.exe"
exit /b 0
