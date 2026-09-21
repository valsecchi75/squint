@echo off
setlocal
rem ------------------------------------------------------------------
rem  squint - installazione su un PC nuovo (Windows, cmd)
rem  Serve: Node >= 20, git, Claude Code. La chiave TypeSafe viene
rem  chiesta alla fine e salvata nelle variabili utente: NON sta qui.
rem ------------------------------------------------------------------

set "DEST=%USERPROFILE%\tools\squint"

where node >nul 2>nul || (echo [ERRORE] node non trovato: installa Node 20 o superiore da https://nodejs.org & exit /b 1)
where git  >nul 2>nul || (echo [ERRORE] git non trovato: installa Git for Windows & exit /b 1)

if exist "%DEST%\.git" (
  echo Aggiorno la copia esistente in %DEST%
  git -C "%DEST%" pull --ff-only || exit /b 1
) else (
  echo Clono in %DEST%
  if not exist "%USERPROFILE%\tools" mkdir "%USERPROFILE%\tools"
  git clone https://github.com/valsecchi75/squint "%DEST%" || exit /b 1
)

cd /d "%DEST%" || exit /b 1
call npm install || exit /b 1
call npm run install-hook || exit /b 1

echo.
echo Ora la chiave TypeSafe: incollala quando richiesto. Viene salvata con setx
echo nelle variabili utente e non viene mai stampata ne' scritta da squint.
node dist\src\bin.js key

echo.
echo Controllo finale (la chiave risulta presente solo in un terminale NUOVO):
node dist\src\bin.js doctor

echo.
echo Fatto. Apri un NUOVO terminale, entra in un progetto e usa Claude Code normalmente.
echo   /squint            nel progetto: cosa ha fatto e perche'
echo   /squint off        lo spegne li', senza disinstallare
echo   npm run uninstall-hook   (da %DEST%) lo toglie del tutto
pause
endlocal
