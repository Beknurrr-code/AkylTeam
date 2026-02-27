# AkylTeam — запуск сервера + ngrok туннель
Set-Location "C:\Users\Beknur\Desktop\ai helper"

# 1. Запуск FastAPI сервера в фоне
Start-Process -FilePath ".venv\Scripts\python.exe" `
  -ArgumentList "-m uvicorn backend.main:app --host 0.0.0.0 --port 8000" `
  -WindowStyle Normal

Write-Host "Сервер запускается..." -ForegroundColor Cyan
Start-Sleep -Seconds 3

# 2. Запуск ngrok туннеля
Write-Host "Запускаю туннель..." -ForegroundColor Cyan
& ".venv\Scripts\python.exe" -c "
from pyngrok import ngrok
import time
ngrok.set_auth_token('39zVprwhAA5Hyypf7XPeVo4TjF6_5HV6cx6uKdcGkkYvXh7r6')
ngrok.kill()
time.sleep(1)
t = ngrok.connect(8000, 'http')
print('')
print('='*50)
print('  AkylTeam online!')
print('  URL:', t.public_url)
print('='*50)
print('')
print('Не закрывай это окно!')
while True:
    time.sleep(60)
"
