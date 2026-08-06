@echo off
start "Servidor Python" cmd /k "cd /d %~dp0vision && python server.py"
timeout /t 3 /nobreak >nul
start "Angular" cmd /k "cd /d %~dp0 && ng serve"