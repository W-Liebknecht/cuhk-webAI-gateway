@echo off
setlocal
set "OPENCLI_ROOT=%CUHK_OPENCLI_ROOT%"
if not defined OPENCLI_ROOT set "OPENCLI_ROOT=%~dp0..\..\cuhk-ai-opencli"
if not exist "%OPENCLI_ROOT%\dist\src\main.js" (
  echo OpenCLI build not found at "%OPENCLI_ROOT%\dist\src\main.js" 1>&2
  echo Set CUHK_OPENCLI_ROOT or place cuhk-ai-opencli beside this repository. 1>&2
  exit /b 2
)
node "%OPENCLI_ROOT%\dist\src\main.js" %*
