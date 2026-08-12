@echo off
setlocal
title Seven Bits Coffee - Server
echo ============================================
echo   Seven Bits Coffee - Starting Server
echo ============================================
echo.

REM --- Check Node.js is installed ---
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed, or not found on your PATH.
    echo Download and install it from https://nodejs.org, then try again.
    echo.
    pause
    exit /b 1
)

REM --- Create a local settings file the first time this is run ---
if not exist "server-settings.bat" (
    echo No server-settings.bat found - creating one with default values.
    echo IMPORTANT: open server-settings.bat in Notepad and set your own
    echo OWNER_PASSWORD ^(and UPI details, if you want online payment QR codes^)
    echo before you start taking real orders.
    echo.
    (
        echo @echo off
        echo REM Edit these values, then save this file. See README-BACKEND.md for details.
        echo set OWNER_USERNAME=owner
        echo set OWNER_PASSWORD=changeme123
        echo set UPI_VPA=
        echo set UPI_PAYEE_NAME=
        echo set PORT=3000
    ) > server-settings.bat
)

call server-settings.bat

echo.
echo Starting server on http://localhost:%PORT%
echo Leave this window open while you're using the app.
echo Press Ctrl+C to stop the server.
echo.

node server.js

echo.
echo Server stopped.
pause
