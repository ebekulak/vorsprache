@echo off
rem Double-click to start Vorsprache with listening. The first start installs what it needs.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo First start: installing speech tools. This takes a few minutes.
  py -3 -m venv .venv || python -m venv .venv || goto :nopython
  .venv\Scripts\python -m pip install -q --upgrade pip
  .venv\Scripts\python -m pip install -q -r server\requirements.txt || goto :failed
)
start "" "http://localhost:4173"
.venv\Scripts\python server\app.py
goto :eof
:nopython
echo Python 3.10 or newer is needed. Get it from https://www.python.org/downloads/ and try again.
pause
goto :eof
:failed
echo Installation failed. Please check your internet connection and try again.
pause
