$ErrorActionPreference = "Stop"

$base = "C:\Users\valera333\Desktop\vork\valera-projects-master\courses-site"
$mysqld = "C:\OSPanel\modules\database\MySQL-8.0-Win10\bin\mysqld.exe"
$ini = "C:\Users\valera333\AppData\Local\Temp\opencode\my-mysql.ini"
$node = "C:\Program Files\nodejs\node.exe"
$php = "C:\OSPanel\modules\php\PHP_8.1\php.exe"
$pmaDir = Join-Path $base "phpmyadmin"

# 1. MySQL
$mysqldRunning = Get-Process -Name mysqld -ErrorAction SilentlyContinue
if (-not $mysqldRunning) {
  Write-Host "Запуск MySQL..."
  Start-Process -WindowStyle Hidden -FilePath $mysqld -ArgumentList "--defaults-file=$ini"
  Start-Sleep -Seconds 12
  Write-Host "MySQL запущен"
} else {
  Write-Host "MySQL уже работает"
}

# 2. Сайт курсов
$nodeRunning = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $node }
if (-not $nodeRunning) {
  Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList "server.js" -WorkingDirectory $base
}

# 3. phpMyAdmin
$pmaRunning = Get-CimInstance Win32_Process -Filter "Name='php.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "127.0.0.1:8080" }
if (-not $pmaRunning) {
  Start-Process -WindowStyle Hidden -FilePath $php -ArgumentList "-S","127.0.0.1:8080","-t",$pmaDir
}

Start-Sleep -Seconds 3
Write-Host ""
Write-Host "=============================================="
Write-Host "Сайт курсов: http://localhost:3001"
Write-Host "Админ: admin@courses.ru / admin123"
Write-Host "Пользователь: user@courses.ru / user123"
Write-Host "phpMyAdmin: http://127.0.0.1:8080  (app / app_password)"
Write-Host "=============================================="
