@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
call "C:\Program Files\nodejs\npm.cmd" --prefix "%~dp0frontend" run web -- --port 8082
