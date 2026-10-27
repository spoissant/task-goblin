#!/usr/bin/env bash
# Symlinks every skill in skills/ into ~/.claude/skills/ and every workflow in
# workflows/ into ~/.claude/workflows/ so chore sessions find them from any
# repo, and `git pull` keeps them up to date. Safe to rerun; a real
# (non-symlink) entry of the same name is left alone with a warning.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

link() {
  local src="$1" target="$2" name
  name="$(basename "$target")"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "skip $name: $target exists and is not a symlink (move it away, then rerun)"
    return
  fi
  ln -sfn "$src" "$target"
  echo "linked $name"
}

SKILLS_DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
mkdir -p "$SKILLS_DEST"
for dir in "$ROOT"/skills/*/; do
  link "${dir%/}" "$SKILLS_DEST/$(basename "$dir")"
done

WORKFLOWS_DEST="${CLAUDE_WORKFLOWS_DIR:-$HOME/.claude/workflows}"
mkdir -p "$WORKFLOWS_DEST"
for file in "$ROOT"/workflows/*.js; do
  [ -e "$file" ] || continue
  link "$file" "$WORKFLOWS_DEST/$(basename "$file")"
done
