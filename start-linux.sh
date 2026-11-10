#!/usr/bin/env bash
# Starts Vorsprache with listening. The first start installs what it needs.
cd "$(dirname "$0")" || exit 1
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
  echo "Python 3.10 or newer is needed (with the venv module, e.g. 'sudo apt install python3-venv')."; exit 1
fi
if [[ ! -x .venv/bin/python ]] || ! .venv/bin/python -c "import faster_whisper, flask, torch, transformers" 2>/dev/null; then
  echo "First start: installing speech tools. This takes a few minutes."
  python3 -m venv .venv && .venv/bin/pip install -q --upgrade pip \
    && .venv/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cpu \
    && .venv/bin/pip install -q -r server/requirements.txt || {
    echo "Installation failed. Please check your internet connection and try again."; exit 1; }
fi
(sleep 2; xdg-open "http://localhost:4173" >/dev/null 2>&1 || true) &
exec .venv/bin/python server/app.py
