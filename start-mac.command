#!/bin/zsh
# Double-click to start Vorsprache with listening. The first start installs what it needs.
cd "${0:A:h}" || exit 1
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
  echo "Python 3.10 or newer is needed. Get it from https://www.python.org/downloads/ and try again."; read -k1; exit 1
fi
if [[ ! -x .venv/bin/python ]] || ! .venv/bin/python -c "import faster_whisper, flask, torch, transformers" 2>/dev/null; then
  echo "First start: installing speech tools (about 1 GB). This takes a few minutes."
  python3 -m venv .venv && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -r server/requirements.txt || {
    echo "Installation failed. Please check your internet connection and try again."; read -k1; exit 1; }
fi
(sleep 2; open "http://localhost:4173") &
exec .venv/bin/python server/app.py
