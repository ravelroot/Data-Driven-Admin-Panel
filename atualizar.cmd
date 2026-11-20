@echo off
setlocal
cd /d "%~dp0"
echo 1/5 Conferindo o .env
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\preparar-env.ps1" || (pause & exit /b 1)
set "PORTA=8080"
for /f "tokens=2 delims==" %%p in ('findstr /b "BENTO_PORTA=" .env') do set "PORTA=%%p"

where docker >nul 2>nul
if errorlevel 1 goto semdocker
docker info >nul 2>nul
if errorlevel 1 goto semdocker

echo 2/5 Gravando um backup antes de atualizar
set "RODANDO="
for /f %%c in ('docker compose ps -q bento 2^>nul') do set "RODANDO=%%c"
if defined RODANDO (docker compose exec -T bento node api/dist/cli.js backup) else (echo     O Bento nao esta rodando; sem backup novo.)
echo 3/5 Baixando a versao nova
if exist .git (where git >nul 2>nul && git pull --ff-only) else (echo     Sem Git: copie os arquivos da versao nova por cima desta pasta antes de rodar o script.)
echo 4/5 Reconstruindo e subindo
docker compose up -d --build || (pause & exit /b 1)
echo     Aguardando o Bento...
powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){ try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ('http://localhost:%PORTA%/api/v1/saude/pronto') | Out-Null; exit 0 } catch { Start-Sleep 2 } }; exit 1"
if errorlevel 1 (echo O Bento nao ficou pronto. Veja o motivo com: docker compose logs --tail 80 bento & pause & exit /b 1)
echo 5/5 Conferindo a instalacao
docker compose exec -T bento node api/dist/cli.js diagnostico
echo.
echo Atualizado. Painel em http://localhost:%PORTA%
pause
exit /b 0

:semdocker
where node >nul 2>nul || (echo Instale o Docker Desktop ou o Node.js 22+ e rode de novo. & pause & exit /b 1)
echo 2/5 Gravando um backup antes de atualizar ^(pare o servidor se estiver usando o banco embutido^)
call npm run --silent backup || echo     Backup nao gravado; continue so se ja tiver um recente.
echo 3/5 Baixando a versao nova
if exist .git (where git >nul 2>nul && git pull --ff-only)
echo 4/5 Instalando e compilando
call npm install --no-audit --no-fund || (pause & exit /b 1)
call npm run build || (pause & exit /b 1)
echo 5/5 Conferindo a instalacao
call npm run --silent diagnostico
echo.
echo Atualizado. Suba de novo com: npm start
pause
