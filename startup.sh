#!/bin/sh
set -eu
cd /workspace
# Only the game. Extra HTTP servers make Grok Play open a blank "ok" page.
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  html=$(curl -s --max-time 2 http://127.0.0.1:8080/ | head -c 80 || true)
  case "$html" in
    *"<html"*|*"<!DOCTYPE"*) exit 0 ;;
  esac
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
