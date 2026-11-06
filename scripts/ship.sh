#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="Hopilo"
BUNDLE_ID="io.coreify.hopilo"
KEY_PATH="$ROOT_DIR/apps/desktop/.tauri/hopilo.key"

os_name() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux) echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unsupported" ;;
  esac
}

running_pids() {
  case "$OS" in
    macos)
      lsappinfo list 2>/dev/null | awk -v id="\"$BUNDLE_ID\"" '
        /bundleID=/ { want = index($0, "bundleID=" id) > 0 }
        want && /pid = / { for (i = 1; i <= NF; i++) if ($i == "pid") { print $(i + 2); want = 0 } }
      '
      pgrep -f "\.app/Contents/MacOS/$APP_NAME\$" 2>/dev/null || true
      ;;
    linux)
      pgrep -f "$APP_NAME\.AppImage" 2>/dev/null || true
      pgrep -x "$APP_NAME" 2>/dev/null || true
      ;;
  esac | sort -u
}

stop_running() {
  local pids attempt=0
  pids="$(running_pids)"
  [ -z "$pids" ] && return 0
  echo "Stopping $APP_NAME (pid $(echo $pids | tr '\n' ' '))"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  while [ -n "$(running_pids)" ] && [ "$attempt" -lt 20 ]; do
    sleep 0.25
    attempt=$((attempt + 1))
  done
  pids="$(running_pids)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 0.5
  fi
  if [ -n "$(running_pids)" ]; then
    echo "$APP_NAME did not exit." >&2
    exit 1
  fi
}

repoint_login_item() {
  local exe="$1"
  case "$OS" in
    macos)
      local plist="$HOME/Library/LaunchAgents/$APP_NAME.plist"
      [ -f "$plist" ] || return 0
      local current
      current="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$plist" 2>/dev/null || true)"
      if [ "$current" != "$exe" ]; then
        /usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $exe" "$plist"
        echo "Launch at login now starts: $exe (was: ${current:-unset})"
      fi
      ;;
    linux)
      local desktop="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/$APP_NAME.desktop"
      [ -f "$desktop" ] || return 0
      sed -i "s|^Exec=.*|Exec=$exe|" "$desktop"
      ;;
  esac
}

warn_other_copies() {
  local dest="$1"
  [ "$OS" = "macos" ] || return 0
  mdfind "kMDItemCFBundleIdentifier == '$BUNDLE_ID'" 2>/dev/null | while read -r app; do
    case "$app" in
      "$dest"|"$ROOT_DIR"/*) ;;
      *) echo "Note: another copy of $APP_NAME is installed at $app ($(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo '?')). Only one runs at a time; remove it if you no longer need it." ;;
    esac
  done
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

echo "[3/5] Stop every running $APP_NAME"
case "$OS" in
  windows)
    powershell.exe -NoProfile -Command "Get-Process '$APP_NAME' -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Milliseconds 500"
    ;;
  *)
    stop_running
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
case "$OS" in
  macos) repoint_login_item "$DEST/Contents/MacOS/$APP_NAME" ;;
  linux) repoint_login_item "$DEST" ;;
esac
warn_other_copies "$DEST"
echo "App data preserved: $DATA_DIR"

echo "[5/5] Launch + verify"
case "$OS" in
  macos)
    open "$DEST"
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
else
  count="$(running_pids | grep -c . || true)"
  if [ "$count" -eq 0 ]; then
    echo "$APP_NAME launch verification failed." >&2
    exit 1
  elif [ "$count" -gt 1 ]; then
    echo "More than one $APP_NAME is running: $(running_pids | tr '\n' ' ')" >&2
    exit 1
  fi
fi

echo "$APP_NAME installed, launched, app data kept."
