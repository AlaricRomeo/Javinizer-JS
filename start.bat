@echo off
cd /d "%~dp0"
echo ============================================
echo    Javinizer-JS - JAV Metadata Manager
echo ============================================
echo.

REM Node.js: use the system one if recent enough (engines.node in package.json,
REM checked by bin\check-node-version.js), otherwise a private copy in
REM data\runtime\node, downloaded on first start and again whenever a new
REM release raises the minimum version
set "NODE_RUNTIME=%~dp0data\runtime\node"
REM engines.node is ">=X.Y.Z": Substring(2) keeps X.Y.Z (no quotes or carets, which cmd would mangle here)
for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content package.json -Raw | ConvertFrom-Json).engines.node.Substring(2)"') do set "NODE_REQUIRED=%%v"
call :node_ok
if errorlevel 1 (
    if exist "%NODE_RUNTIME%\node.exe" set "PATH=%NODE_RUNTIME%;%PATH%"
)
call :node_ok
if errorlevel 1 (
    echo [INFO] Node.js %NODE_REQUIRED% or newer not found, downloading a private copy...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bin\install-node.ps1" -Dest "%~dp0data\runtime"
    if errorlevel 1 (
        echo [ERROR] Failed to download Node.js!
        echo Please install Node.js %NODE_REQUIRED% or newer from: https://nodejs.org/
        pause
        exit /b 1
    )
    set "PATH=%NODE_RUNTIME%;%PATH%"
    echo.
)
call :node_ok
if errorlevel 1 (
    echo [ERROR] Node.js %NODE_REQUIRED% or newer is required!
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [INFO] Using Node.js %%v

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

REM Fix sharp native bindings for Windows (runs once or after npm install)
echo [INFO] Checking sharp native bindings for Windows...
node -e "require('sharp')" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Reinstalling sharp for Windows platform...
    call npm install --os=win32 --cpu=x64 --no-audit sharp
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install sharp!
        pause
        exit /b 1
    )
    echo.
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
exit /b

REM Exit code 0 if "node" is on PATH and satisfies engines.node in package.json
:node_ok
where node >nul 2>nul || exit /b 1
node bin\check-node-version.js >nul 2>nul
exit /b %ERRORLEVEL%
