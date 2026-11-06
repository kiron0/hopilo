#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Cleaning generated Hopilo files..."

rm -rf -- \
  "$ROOT_DIR/apps/desktop/dist" \
  "$ROOT_DIR/apps/desktop/src-tauri/binaries" \
  "$ROOT_DIR/apps/extension/dist" \
  "$ROOT_DIR/apps/extension/dist-firefox"

if [ -d "$ROOT_DIR/target" ]; then
  while IFS= read -r bundle_dir; do
    case "$bundle_dir" in
      "$ROOT_DIR/target/release/bundle"|"$ROOT_DIR/target/"*/release/bundle)
        rm -rf -- "$bundle_dir"
        ;;
      *)
        echo "Refusing unexpected clean target: $bundle_dir" >&2
        exit 1
        ;;
    esac
  done < <(find "$ROOT_DIR/target" -type d -path '*/release/bundle' -prune -print)
fi

if [ "${1:-}" = "--all" ]; then
  (cd "$ROOT_DIR" && cargo clean)
fi

echo "Clean complete. Dependencies, signing keys, installed app, app data preserved."
