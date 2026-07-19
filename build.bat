@echo off
:: ============================================================
::  fog.chess — Windows Electron build script
::  Run this once to enter your credentials and produce a .exe
::  installer in dist-electron\
:: ============================================================
::
::  Prerequisites (must be in PATH):
::    Node.js 18+  https://nodejs.org
::    npm          (bundled with Node.js)
::
::  You will also need accounts / credentials for:
::    Supabase  https://supabase.com   (database + auth)
::    PartyKit  https://partykit.io   (real-time multiplayer)
::
:: ============================================================

title fog.chess builder

:: --- Check Node.js ----------------------------------------
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: Node.js is not installed or not in PATH.
    echo  Download it from https://nodejs.org and re-run this script.
    echo.
    pause
    exit /b 1
)
echo  [OK] Node.js found.

:: --- Check npm --------------------------------------------
npm --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: npm not found. It should ship with Node.js.
    pause
    exit /b 1
)
echo  [OK] npm found.

echo.
echo  ============================================================
echo   STEP 1 — Supabase credentials
echo   Get these from https://supabase.com/dashboard
echo   Project Settings ^> API
echo  ============================================================
echo.
echo  You need THREE values:
echo    1. Project URL         (looks like: https://xxxxxxxxxxxx.supabase.co)
echo    2. anon / publishable key  (starts with: sb_publishable_  or  eyJ...)
echo    3. service_role key    (starts with: sb_secret_  or  eyJ... — keep this private!)
echo.

set /p SUPABASE_URL="  Supabase Project URL: "
set /p SUPABASE_ANON="  Supabase anon key:    "
set /p SUPABASE_SVC="  Supabase service_role key: "

echo.
echo  ============================================================
echo   STEP 2 — PartyKit (real-time multiplayer)
echo   https://partykit.io — free tier available
echo  ============================================================
echo.
echo  PartyKit powers live move sync between opponents.
echo  You need to deploy the party server once:
echo.
echo    npx partykit deploy
echo.
echo  After deploying, PartyKit will print a host like:
echo    fog-chess.YOUR_USERNAME.partykit.dev
echo.
echo  If you skip this, vs-AI mode still works but online play won't.
echo.
set /p PARTYKIT_HOST="  PartyKit host (or press Enter to skip): "

echo.
echo  ============================================================
echo   STEP 3 — Building fog.chess
echo  ============================================================
echo.

:: Write .env so Vite bakes VITE_* vars into the client bundle at build time
echo Writing .env...
(
    echo SUPABASE_URL=%SUPABASE_URL%
    echo SUPABASE_PUBLISHABLE_KEY=%SUPABASE_ANON%
    echo SUPABASE_SERVICE_ROLE_KEY=%SUPABASE_SVC%
    echo VITE_SUPABASE_URL=%SUPABASE_URL%
    echo VITE_SUPABASE_PUBLISHABLE_KEY=%SUPABASE_ANON%
    echo VITE_PARTYKIT_HOST=%PARTYKIT_HOST%
) > .env

echo Installing app dependencies...
call npm install
if errorlevel 1 (
    echo.
    echo  ERROR: npm install failed. See output above.
    pause
    exit /b 1
)

echo Building fog.chess ^(this takes 1-2 minutes^)...
call npm run build
if errorlevel 1 (
    echo.
    echo  ERROR: Build failed. See output above.
    pause
    exit /b 1
)

:: Write electron/config.json with runtime credentials.
:: VITE_* vars are already baked into the bundle; config.json carries the
:: server-side keys that the Nitro SSR process needs at runtime.
echo Writing electron\config.json...
node -e "const fs=require('fs');const cfg={SUPABASE_URL:process.env.SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_ANON,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SVC};fs.writeFileSync('electron\\\\config.json',JSON.stringify(cfg,null,2))" 2>nul

:: Fallback plain-text write if Node approach fails (rare edge case)
if not exist electron\config.json (
    (
        echo {
        echo   "SUPABASE_URL": "%SUPABASE_URL%",
        echo   "VITE_SUPABASE_PUBLISHABLE_KEY": "%SUPABASE_ANON%",
        echo   "SUPABASE_SERVICE_ROLE_KEY": "%SUPABASE_SVC%"
        echo }
    ) > electron\config.json
)

echo.
echo  ============================================================
echo   STEP 4 — Packaging .exe
echo  ============================================================
echo.

cd electron

echo Installing Electron + electron-builder...
call npm install
if errorlevel 1 (
    echo.
    echo  ERROR: Electron install failed.
    cd ..
    pause
    exit /b 1
)

echo Building installer (downloads Electron ~200 MB on first run)...
call npm run dist
if errorlevel 1 (
    echo.
    echo  ERROR: electron-builder failed. See output above.
    cd ..
    pause
    exit /b 1
)

cd ..

echo.
echo  ============================================================
echo   Done!
echo.
echo   Installer:  dist-electron\fog.chess Setup 1.0.0.exe
echo.
echo   Share that file with anyone — it installs fog.chess and
echo   runs it with YOUR Supabase + PartyKit backend.
echo  ============================================================
echo.
pause
