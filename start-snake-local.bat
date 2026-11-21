@echo off
setlocal
set "PROJECT=C:\my\project\snake"
set "NODE=C:\Users\lijia\Documents\Codex\2026-11-21\new-chat-2\SnakeOJ\runtime\node.exe"
set "COMPILER=C:\my\environment\MSYS2\ucrt64\bin"
set "PATH=%COMPILER%;%PATH%"
set "CXX=%COMPILER%\g++.exe"
if not exist "%PROJECT%\server.mjs" goto failed
if not exist "%NODE%" goto failed
if not exist "%CXX%" goto failed
if /i "%~1"=="--check" goto check
"%NODE%" "%PROJECT%\server.mjs" --open
if errorlevel 1 goto failed
exit /b 0

:check
"%NODE%" "%PROJECT%\arena.mjs" check "%PROJECT%\example.cpp"
exit /b %errorlevel%

:failed
echo Could not start Snake OJ. Check the messages above.
pause
exit /b 1
