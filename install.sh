#!/bin/bash
# Installs (or updates) Blaube on a Mac, with no "Open Anyway" step:
#
#   curl -fsSL https://raw.githubusercontent.com/syverlauritz/blaube/main/install.sh | bash
#
# It downloads the newest release for your Mac's chip from GitHub, puts
# Blaube.app in /Applications (or ~/Applications if that isn't writable),
# and opens it. A file curl downloads isn't marked as "from the internet",
# so macOS doesn't stop it the first time. Run it again to update.
set -euo pipefail

REPO="syverlauritz/blaube"
APP="Blaube.app"

say() { printf '\033[38;2;217;119;87m●\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS. On Windows, see https://github.com/$REPO#getting-started"

case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64)
    # An Intel shell on an Apple Silicon Mac (Rosetta) still gets the native build.
    if [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = "1" ]; then ARCH=arm64; else ARCH=x64; fi ;;
  *) die "Unknown Mac chip: $(uname -m)" ;;
esac

URL="https://github.com/$REPO/releases/latest/download/Blaube-mac-$ARCH.zip"

if [ -w /Applications ]; then DEST=/Applications; else DEST="$HOME/Applications"; mkdir -p "$DEST"; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "Downloading Blaube for $([ $ARCH = arm64 ] && echo 'Apple Silicon' || echo 'Intel')…"
curl -fL --progress-bar "$URL" -o "$TMP/blaube.zip" || die "Couldn't download $URL"

say "Unpacking…"
ditto -x -k "$TMP/blaube.zip" "$TMP/unpacked"
[ -d "$TMP/unpacked/$APP" ] || die "The download didn't contain $APP"

# Quit a running Blaube before replacing it.
if pgrep -x Blaube >/dev/null 2>&1; then
  say "Quitting the Blaube that's running…"
  osascript -e 'quit app "Blaube"' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x Blaube >/dev/null 2>&1 || break; sleep 0.5; done
  pkill -x Blaube >/dev/null 2>&1 || true
fi

say "Installing into $DEST…"
rm -rf "${DEST:?}/$APP"
ditto "$TMP/unpacked/$APP" "$DEST/$APP"
# (Nothing here was quarantined, but be sure.)
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

VERSION="$(defaults read "$DEST/$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo '')"
say "Blaube ${VERSION:+$VERSION }is installed. Opening it…"
open "$DEST/$APP"

cat <<'EOF'

  Next: right-click the blob and choose "Connect Claude Code…",
  then start (or restart) a Claude Code session. Its blob pops out.

  To update later, run this same command again.
EOF
