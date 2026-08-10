@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Project Launcher

echo ================================================
echo   Launching: dashboard (3000) + courses (3001)
echo ================================================

rem ---------- 1. Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from: https://nodejs.org
  pause
  exit /b 1
)

rem ---------- 2. Dependencies ----------
if not exist "node_modules" (
  echo [1/4] Installing dashboard dependencies...
  call npm install
)
if not exist "courses-site\node_modules" (
  echo [2/4] Installing courses site dependencies...
  pushd courses-site
  call npm install
  popd
)

rem ---------- 3. MySQL ----------
set "MYSQL=mysql"
where mysql >nul 2>nul
if errorlevel 1 (
  set "MYSQL="
  for /d %%D in ("C:\Program Files\MySQL\*") do if exist "%%D\bin\mysql.exe" if not defined MYSQL set "MYSQL=%%D\bin\mysql.exe"
  if not defined MYSQL for /d %%D in ("C:\Program Files (x86)\MySQL\*") do if exist "%%D\bin\mysql.exe" if not defined MYSQL set "MYSQL=%%D\bin\mysql.exe"
)
if not defined MYSQL (
  echo [ERROR] MySQL not found. Install MySQL 8.4: https://dev.mysql.com/downloads/installer/
  echo         After installation run this file again.
  pause
  exit /b 1
)

echo [3/4] Checking database...
"%MYSQL%" -u app -papp_password courses_db -e "SELECT 1" >nul 2>nul
if errorlevel 1 (
  echo   Database not configured. MySQL will now ask for the root password
  echo   the one you set when installing MySQL.
  "%MYSQL%" -u root -p < init_db.sql
  if errorlevel 1 (
    echo [ERROR] Failed to create the database.
    echo         Run manually: mysql -u root -p ^< init_db.sql
    pause
    exit /b 1
  )
  echo   Database created.
)

rem ---------- 4. phpMyAdmin (if PHP is installed) ----------
where php >nul 2>nul
if not errorlevel 1 if exist "courses-site\phpmyadmin" (
  start "phpMyAdmin" /D "%~dp0courses-site\phpmyadmin" cmd /k php -S 127.0.0.1:8080
)

rem ---------- 5. Start servers ----------
echo [4/4] Starting servers...
start "Courses Server" /D "%~dp0courses-site" cmd /k node server.js
start "Dashboard Server" /D "%~dp0" cmd /k node server.js

timeout /t 5 /nobreak >nul
start "" "http://localhost:3001"
start "" "http://localhost:3000"

echo.
echo ================================================
echo   Done!
echo   Dashboard:    http://localhost:3000
echo   Courses:      http://localhost:3001
echo   Courses admin: admin@courses.ru / admin123
echo   Courses user:  user@courses.ru / user123
echo   phpMyAdmin:   http://127.0.0.1:8080 (app / app_password)
echo   (keep the server windows open, they run in background)
echo ================================================
pause
