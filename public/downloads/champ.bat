@echo off
setlocal
cd /d "%~dp0"

rem Champ Client for Windows.
rem Keep this file next to champ.exe. Start Minecraft 1.21.11 first, then
rem double-click this file (or champ.exe directly). The loader signs in,
rem checks your license and this PC, and puts Champ into the running game.

if not exist "champ.exe" (
    echo.
    echo   champ.exe is missing next to champ.bat.
    echo   Keep both files in the same folder and try again.
    echo.
    pause
    exit /b 1
)

start "" "champ.exe"
exit /b 0
