@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0node-run.ps1" "%~dp0cuhk-opencli.mjs" %*
