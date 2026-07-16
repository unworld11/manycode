#!/bin/sh
# manycode installer and updater - safe to re-run any time.
#   curl -fsSL https://manycode.vercel.app/install.sh | sh
set -e

REPO="https://github.com/unworld11/manycode"
DIR="${MANYCODE_DIR:-${CCSHARE_DIR:-$HOME/manycode}}"
# manycode was born as ccshare - keep updating an existing checkout, but only
# if it's clean. a checkout with local changes (someone hacking on it) is left
# alone and we clone fresh to ~/manycode instead of failing the install.
if [ ! -d "$DIR/.git" ] && [ -d "$HOME/ccshare/.git" ]; then
  if [ -z "$(git -C "$HOME/ccshare" status --porcelain 2>/dev/null)" ]; then DIR="$HOME/ccshare"; fi
fi

for tool in git node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "manycode: $tool is required but not installed - install it and re-run"
    exit 1
  fi
done

if [ -d "$DIR/.git" ]; then
  echo "manycode: found existing install at $DIR - updating"
  # npm install rewrites the lockfile; that isn't a user edit
  git -C "$DIR" checkout -- package-lock.json 2>/dev/null || true
  if [ -n "$(git -C "$DIR" status --porcelain)" ]; then
    echo "manycode: $DIR has local changes - leaving it untouched."
    echo "manycode: commit or stash there, or run with MANYCODE_DIR=~/manycode-fresh to install elsewhere."
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
if ! command -v manycode >/dev/null 2>&1; then
  BIN="$DIR/bin/manycode.js"
  for d in /opt/homebrew/bin /usr/local/bin; do
    if [ -d "$d" ] && [ -w "$d" ]; then
      ln -sf "$BIN" "$d/manycode"
      break
    fi
  done
fi

echo ""
if command -v manycode >/dev/null 2>&1; then
  echo "manycode $(git -C "$DIR" rev-parse --short HEAD) ready."
  echo "next: manycode setup   (30-second onboarding, or just run: manycode host)"
else
  echo "manycode: installed at $DIR but no writable bin dir on PATH."
  echo "add this line to your shell profile:"
  echo "  alias manycode=\"node $DIR/bin/manycode.js\""
fi
