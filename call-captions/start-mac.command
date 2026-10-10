#!/bin/bash
# Double-click to start Call Captions on a Mac.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and try again."
  open https://nodejs.org
  read -r -p "Press Return to close."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing for the first time, this takes a minute..."
  if ! npm install --omit=dev --no-fund --no-audit; then
    echo "Install failed. Check your internet connection and try again."
    read -r -p "Press Return to close."
    exit 1
  fi
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created your settings file. Fill in your AWS details in TextEdit, save, then double-click this file again."
  open -e .env
  exit 0
fi

echo "Starting Call Captions. Keep this window open while you use captions."
(sleep 1 && open http://127.0.0.1:8787) &
node server.js
