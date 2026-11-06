#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="Hopilo"
KEY_PATH="$ROOT_DIR/apps/desktop/.tauri/hopilo.key"

os_name() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux) echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unsupported" ;;
  esac
}

wait_for_exit() {
  local attempt=0
  while pgrep -x "$APP_NAME" >/dev/null 2>&1 && [ "$attempt" -lt 20 ]; do
    sleep 0.25
    attempt=$((attempt + 1))
  done
  if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
    echo "$APP_NAME did not exit." >&2
    exit 1
  fi
}

latest_file() {
  find "$ROOT_DIR/target" -type f -path '*/release/bundle/*' -name "$1" -print | head -n 1
}

OS="$(os_name)"
if [ "$OS" = "unsupported" ]; then
  echo "Unsupported OS: $(uname -s)" >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "[1/5] Verify"
pnpm --filter @hopilo/desktop typecheck
pnpm --filter @hopilo/desktop test
node apps/desktop/scripts/sidecar.mjs
cargo check -p hopilo-desktop

echo "[2/5] Build signed $OS bundle"
if [ -f "$KEY_PATH" ]; then
  case "$OS" in
    macos)
      TAURI_SIGNING_PRIVATE_KEY="$KEY_PATH" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" pnpm --filter @hopilo/desktop tauri build --bundles app
      ;;
    linux)
      TAURI_SIGNING_PRIVATE_KEY="$KEY_PATH" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" pnpm --filter @hopilo/desktop tauri build --bundles appimage
      ;;
    windows)
      TAURI_SIGNING_PRIVATE_KEY="$KEY_PATH" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" pnpm --filter @hopilo/desktop tauri build --bundles nsis
      ;;
  esac
else
  echo "Updater signing key missing: $KEY_PATH" >&2
  exit 1
fi

echo "[3/5] Stop running $APP_NAME"
case "$OS" in
  windows)
    powershell.exe -NoProfile -Command "Get-Process '$APP_NAME' -ErrorAction SilentlyContinue | Stop-Process -Force"
    ;;
  *)
    pkill -x "$APP_NAME" 2>/dev/null || true
    wait_for_exit
    ;;
esac

echo "[4/5] Install native bundle"
case "$OS" in
  macos)
    BUNDLE="$(find "$ROOT_DIR/target" -type d -path '*/release/bundle/macos/Hopilo.app' -print | head -n 1)"
    if [ -z "$BUNDLE" ]; then
      echo "macOS app bundle not found." >&2
      exit 1
    fi
    DEST="$HOME/Applications/Hopilo.app"
    mkdir -p "$HOME/Applications"
    rm -rf -- "$DEST"
    ditto "$BUNDLE" "$DEST"
    DATA_DIR="$HOME/Library/Application Support/io.coreify.hopilo"
    ;;
  linux)
    BUNDLE="$(latest_file '*.AppImage')"
    if [ -z "$BUNDLE" ]; then
      echo "Linux AppImage not found." >&2
      exit 1
    fi
    mkdir -p "$HOME/.local/bin"
    DEST="$HOME/.local/bin/Hopilo.AppImage"
    install -m 755 "$BUNDLE" "$DEST"
    DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/io.coreify.hopilo"
    ;;
  windows)
    BUNDLE="$(latest_file '*-setup.exe')"
    if [ -z "$BUNDLE" ]; then
      echo "Windows NSIS installer not found." >&2
      exit 1
    fi
    WIN_BUNDLE="$(cygpath -w "$BUNDLE")"
    powershell.exe -NoProfile -Command "Start-Process -FilePath '$WIN_BUNDLE' -ArgumentList '/S' -Wait"
    DEST="$(powershell.exe -NoProfile -Command '$candidates = @("$env:LOCALAPPDATA\\Programs\\Hopilo\\Hopilo.exe", "$env:LOCALAPPDATA\\Hopilo\\Hopilo.exe"); $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1' | tr -d '\r')"
    if [ -z "$DEST" ]; then
      echo "Installed Hopilo.exe not found." >&2
      exit 1
    fi
    DATA_DIR="%APPDATA%\\io.coreify.hopilo"
    ;;
esac

echo "Installed: $DEST"
echo "App data preserved: $DATA_DIR"

echo "[5/5] Launch + verify"
case "$OS" in
  macos)
    open -n "$DEST"
    ;;
  linux)
    nohup "$DEST" > /tmp/hopilo-ship.log 2>&1 &
    ;;
  windows)
    WIN_DEST="$(cygpath -w "$DEST")"
    powershell.exe -NoProfile -Command "Start-Process -FilePath '$WIN_DEST'"
    ;;
esac

sleep 2
if [ "$OS" = "windows" ]; then
  powershell.exe -NoProfile -Command "if (-not (Get-Process '$APP_NAME' -ErrorAction SilentlyContinue)) { exit 1 }"
elif ! pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  echo "$APP_NAME launch verification failed." >&2
  exit 1
fi

echo "$APP_NAME installed, launched, app data kept."
