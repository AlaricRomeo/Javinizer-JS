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

REM Check if dependencies are installed and up-to-date
if not exist "node_modules\" (
    echo [INFO] Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
    echo.
) else (
    REM Check if package-lock.json exists or is older than package.json
    if not exist "package-lock.json" (
        echo [INFO] Installing or updating dependencies...
        call npm install
        if %ERRORLEVEL% NEQ 0 (
            echo [ERROR] Failed to install dependencies!
            pause
            exit /b 1
        )
        echo.
    ) else (
        REM Compare timestamps using PowerShell
        powershell -command "if ((Get-Item package.json).LastWriteTime -gt (Get-Item package-lock.json).LastWriteTime) { exit 1 } else { exit 0 }" 2>nul
        if %ERRORLEVEL% EQU 1 (
            echo [INFO] Installing or updating dependencies...
            call npm install
            if %ERRORLEVEL% NEQ 0 (
                echo [ERROR] Failed to install dependencies!
                pause
                exit /b 1
            )
            echo.
        ) else (
            REM Check if any dependencies are missing by trying to require them
            echo [INFO] Checking if all dependencies are installed...
            node -e "Object.keys(require('./package.json').dependencies).forEach(dep => { try { require(dep); } catch(e) { console.log('Missing dependency: ' + dep); process.exit(1); } }); process.exit(0);" 2>nul
            if %ERRORLEVEL% EQU 1 (
                echo [INFO] Installing missing dependencies...
                call npm install
                if %ERRORLEVEL% NEQ 0 (
                    echo [ERROR] Failed to install dependencies!
                    pause
                    exit /b 1
                )
                echo.
            )
        )
    )
)

REM Kill any existing processes on port 4004
echo [INFO] Checking for existing processes on port 4004...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4004 ^| findstr LISTENING') do (
    echo [INFO] Found existing process on port 4004. Terminating PID: %%a
    taskkill /f /pid %%a 2>nul
    timeout /t 2 /nobreak >nul
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
