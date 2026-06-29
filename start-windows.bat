@echo off
REM ==== APROVA - abrir no Windows (de dois cliques neste arquivo) ====
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js nao encontrado.
  echo     Vou abrir a pagina de download. Instale a versao "LTS",
  echo     depois de dois cliques NESTE arquivo novamente.
  echo.
  start "" https://nodejs.org/pt-br/download
  pause
  exit /b 1
)
node launch.mjs
echo.
echo (O APROVA foi encerrado. Voce pode fechar esta janela.)
pause
