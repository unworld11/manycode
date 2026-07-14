#!/bin/sh
# ccshare installer and updater - safe to re-run any time.
#   curl -fsSL https://getccshare.vercel.app/install.sh | sh
set -e

REPO="https://github.com/unworld11/ccshare"
DIR="${CCSHARE_DIR:-$HOME/ccshare}"

if [ -d "$DIR/.git" ]; then
  echo "ccshare: found existing install at $DIR - updating"
  # npm install rewrites the lockfile; that isn't a user edit
  git -C "$DIR" checkout -- package-lock.json 2>/dev/null || true
  if [ -n "$(git -C "$DIR" status --porcelain)" ]; then
    echo "ccshare: you have local changes in $DIR - stash or commit them, then re-run"
    exit 1
  fi
  git -C "$DIR" fetch origin
  git -C "$DIR" reset --hard origin/master
else
  git clone "$REPO" "$DIR"
fi

cd "$DIR"
npm install --no-fund --no-audit
npm link >/dev/null 2>&1 || true

# npm link can land in a bin dir that isn't on PATH (homebrew node keeps its
# own Cellar); fall back to a symlink somewhere that is
if ! command -v ccshare >/dev/null 2>&1; then
  BIN="$DIR/bin/ccshare.js"
  for d in /opt/homebrew/bin /usr/local/bin; do
    if [ -d "$d" ] && [ -w "$d" ]; then
      ln -sf "$BIN" "$d/ccshare"
      break
    fi
  done
fi

echo ""
if command -v ccshare >/dev/null 2>&1; then
  echo "ccshare $(git -C "$DIR" rev-parse --short HEAD) ready. host a session with: ccshare host"
else
  echo "ccshare: installed at $DIR but no writable bin dir on PATH."
  echo "add this line to your shell profile:"
  echo "  alias ccshare=\"node $DIR/bin/ccshare.js\""
fi
