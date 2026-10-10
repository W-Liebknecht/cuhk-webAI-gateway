@echo off
if exist "%~dp0app\CUHK-AI-Settings.exe" (
    start "" "%~dp0app\CUHK-AI-Settings.exe"
    exit /b 0
)
where pyw.exe >nul 2>nul
if not errorlevel 1 goto python_launcher
where pythonw.exe >nul 2>nul
if not errorlevel 1 goto python_path
echo Python 3 with Tkinter was not found. Install Python and its Windows launcher.
pause
exit /b 1
:python_launcher
start "" pyw -3 "%~dp0app\settings_app.py"
exit /b 0
:python_path
start "" pythonw "%~dp0app\settings_app.py"
