@echo off
echo ============================================
echo    Javinizer-JS - JAV Metadata Manager
echo ============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "node_modules\" (
    echo [INFO] Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
    echo.
)

REM Start the server and open browser
echo [INFO] Starting Javinizer-JS server...
echo [INFO] Opening browser at http://localhost:4004
echo.
echo Press Ctrl+C to stop the server
echo ============================================
echo.

REM Open browser after a short delay
start "" timeout /t 2 /nobreak >nul && start http://localhost:4004

REM Start the Node.js server
node src/server/index.js

pause
