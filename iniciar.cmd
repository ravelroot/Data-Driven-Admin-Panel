@echo off
setlocal
cd /d "%~dp0"
if not exist .env powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\criar-env.ps1"
set "PORTA=8080"
for /f "tokens=2 delims==" %%p in ('findstr /b "BENTO_PORTA=" .env') do set "PORTA=%%p"

where docker >nul 2>nul
if errorlevel 1 goto semdocker
docker info >nul 2>nul
if errorlevel 1 goto semdocker

docker compose up -d --build || (pause & exit /b 1)
echo.
echo Aguardando o Bento subir...
powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){ try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ('http://localhost:%PORTA%/api/v1/saude') | Out-Null; Start-Process ('http://localhost:%PORTA%'); exit 0 } catch { Start-Sleep 2 } }; exit 1"
if errorlevel 1 (echo O Bento ainda esta subindo. Acompanhe com: docker compose logs -f bento) else (echo Pronto! Entre com admin@bento.local e a senha bento123.)
pause
exit /b 0

:semdocker
where node >nul 2>nul || (echo Instale o Docker Desktop ^(https://docs.docker.com/desktop/^) ou o Node.js 22+ ^(https://nodejs.org^) e rode de novo. & pause & exit /b 1)
echo Docker nao encontrado: usando Node.js com o banco embutido ^(PGlite^).
call npm install --no-audit --no-fund || (pause & exit /b 1)
call npm run build || (pause & exit /b 1)
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 6; Start-Process 'http://localhost:%PORTA%'"
call npm start
pause
