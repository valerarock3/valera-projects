$ErrorActionPreference = "Stop"

# 1. Запуск MySQL, если не запущен
$mysqldRunning = Get-Process -Name mysqld -ErrorAction SilentlyContinue
if (-not $mysqldRunning) {
  Write-Host "Запуск MySQL..."
  Start-Process -WindowStyle Hidden -FilePath "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" -ArgumentList "--defaults-file=C:\Users\6F61~1\AppData\Local\Temp\opencode\my-mysql.ini"
  Start-Sleep -Seconds 12
  Write-Host "MySQL запущен"
} else {
  Write-Host "MySQL уже работает"
}

# 2. Запуск сайта курсов
$nodeRunning = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq "C:\Program Files\nodejs\node.exe" }
Start-Process -WindowStyle Hidden -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList "server.js" -WorkingDirectory "C:\Users\Ученик\Desktop\valera\courses-site"

# 3. Запуск phpMyAdmin
$php = "C:\Users\Ученик\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"
$pmaDir = "C:\Users\Ученик\Desktop\valera\courses-site\phpmyadmin"
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
