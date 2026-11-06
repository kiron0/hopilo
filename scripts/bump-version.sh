#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PACKAGE_JSON="$ROOT_DIR/package.json"
TAURI_CONF="$ROOT_DIR/apps/desktop/src-tauri/tauri.conf.json"
DESKTOP_PKG="$ROOT_DIR/apps/desktop/package.json"
EXT_PKG="$ROOT_DIR/apps/extension/package.json"
MANIFEST_JSON="$ROOT_DIR/apps/extension/public/manifest.json"
CARGO_TOML="$ROOT_DIR/Cargo.toml"
CHANGELOG_FILE="$ROOT_DIR/CHANGELOG.md"

for req in "$PACKAGE_JSON" "$TAURI_CONF" "$CARGO_TOML"; do
    if [ ! -f "$req" ]; then
        echo "Error: Required file not found: $req" >&2
        exit 1
    fi
done

CURRENT_VERSION=$(awk -F'"' '/"version"/ { print $4; exit }' "$TAURI_CONF")
if [ -z "$CURRENT_VERSION" ]; then
    CURRENT_VERSION=$(awk -F'"' '/"version"/ { print $4; exit }' "$PACKAGE_JSON")
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "${CURRENT_VERSION%%-*}"
MAJOR=${MAJOR:-0}
MINOR=${MINOR:-0}
PATCH=${PATCH:-0}

SUGGESTED_PATCH="$MAJOR.$MINOR.$((PATCH + 1))"
SUGGESTED_MINOR="$MAJOR.$((MINOR + 1)).0"
SUGGESTED_MAJOR="$((MAJOR + 1)).0.0"

INPUT_VERSION="${1:-}"

if [ -z "$INPUT_VERSION" ]; then
    echo "Current version: $CURRENT_VERSION"
    echo ""
    echo "Select bump type:"
    echo "  1) Patch  -> $SUGGESTED_PATCH"
    echo "  2) Minor  -> $SUGGESTED_MINOR"
    echo "  3) Major  -> $SUGGESTED_MAJOR"
    echo "  4) Custom"
    read -r -p "Enter choice [1-4] (default: 1): " CHOICE

    case "$CHOICE" in
        2)
            TARGET_VERSION="$SUGGESTED_MINOR"
            ;;
        3)
            TARGET_VERSION="$SUGGESTED_MAJOR"
            ;;
        4)
            read -r -p "Enter new version (e.g. 1.0.3): " CUSTOM_VER
            TARGET_VERSION="$CUSTOM_VER"
            ;;
        *)
            TARGET_VERSION="$SUGGESTED_PATCH"
            ;;
    esac
else
    case "$INPUT_VERSION" in
        patch|--patch|-p)
            TARGET_VERSION="$SUGGESTED_PATCH"
            ;;
        minor|--minor|-m)
            TARGET_VERSION="$SUGGESTED_MINOR"
            ;;
        major|--major)
            TARGET_VERSION="$SUGGESTED_MAJOR"
            ;;
        *)
            TARGET_VERSION="$INPUT_VERSION"
            ;;
    esac
fi

TARGET_VERSION="${TARGET_VERSION#v}"

if [[ ! "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    echo "Error: Invalid version format '$TARGET_VERSION'. Must match semver (e.g. 1.0.3 or 1.0.3-beta.1)." >&2
    exit 1
fi

echo ""
echo "Summary of changes:"
echo "  Version: $CURRENT_VERSION -> $TARGET_VERSION"
echo ""

if [ -z "${1:-}" ]; then
    read -r -p "Apply changes? [Y/n]: " CONFIRM
    CONFIRM="${CONFIRM:-Y}"
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

node -e '
  const fs = require("fs");
  const ver = process.argv[1];
  const files = process.argv.slice(2);
  for (const f of files) {
    if (fs.existsSync(f)) {
      const data = JSON.parse(fs.readFileSync(f, "utf8"));
      if (data.version === ver) continue;
      data.version = ver;
      fs.writeFileSync(f, JSON.stringify(data, null, 2) + "\n");
      const rel = f.replace(process.cwd() + "/", "");
      console.log("  ✓ Updated " + rel);
    }
  }
' "$TARGET_VERSION" "$PACKAGE_JSON" "$DESKTOP_PKG" "$EXT_PKG" "$MANIFEST_JSON" "$TAURI_CONF"

node -e '
  const fs = require("fs");
  const ver = process.argv[1];
  const cargoPath = process.argv[2];
  const cargo = fs.readFileSync(cargoPath, "utf8");
  const pattern = /(\[workspace\.package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/;
  if (!pattern.test(cargo)) {
    console.error("Error: [workspace.package] version not found in " + cargoPath);
    process.exit(1);
  }
  const nextCargo = cargo.replace(pattern, `$1"${ver}"`);
  if (nextCargo !== cargo) {
    fs.writeFileSync(cargoPath, nextCargo);
    const rel = cargoPath.replace(process.cwd() + "/", "");
    console.log("  ✓ Updated " + rel);
  }
' "$TARGET_VERSION" "$CARGO_TOML"

if command -v cargo >/dev/null 2>&1; then
    (cd "$ROOT_DIR" && cargo check --workspace --quiet 2>/dev/null || (cd "$ROOT_DIR" && cargo check --workspace))
    echo "  ✓ Updated Cargo.lock"
fi

if command -v pnpm >/dev/null 2>&1; then
    (cd "$ROOT_DIR" && pnpm install --lockfile-only --quiet 2>/dev/null || (cd "$ROOT_DIR" && pnpm install --no-frozen-lockfile))
    echo "  ✓ Updated pnpm-lock.yaml"
fi

if [ -f "$CHANGELOG_FILE" ]; then
    if ! grep -q "## $TARGET_VERSION" "$CHANGELOG_FILE"; then
        awk -v ver="$TARGET_VERSION" '
            BEGIN { inserted = 0 }
            /^## / && !inserted {
                print "## " ver "\n\n### Added\n\n- \n\n### Fixed\n\n- \n\n### Changed\n\n- \n"
                inserted = 1
            }
            { print }
        ' "$CHANGELOG_FILE" > "$CHANGELOG_FILE.tmp" && mv "$CHANGELOG_FILE.tmp" "$CHANGELOG_FILE"
        echo "  ✓ Added release section to CHANGELOG.md"
    fi
fi

echo ""
echo "✅ Version bumped to $TARGET_VERSION successfully!"
