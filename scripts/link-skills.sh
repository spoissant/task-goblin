#!/usr/bin/env bash
# Symlinks every skill in skills/ into ~/.claude/skills/ so chore sessions find
# them from any repo, and `git pull` keeps them up to date. Safe to rerun; a
# real (non-symlink) folder of the same name is left alone with a warning.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../skills" && pwd)"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
mkdir -p "$DEST"

for dir in "$SRC"/*/; do
  name="$(basename "$dir")"
  target="$DEST/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "skip $name: $target exists and is not a symlink (move it away, then rerun)"
    continue
  fi
  ln -sfn "${dir%/}" "$target"
  echo "linked $name"
done
