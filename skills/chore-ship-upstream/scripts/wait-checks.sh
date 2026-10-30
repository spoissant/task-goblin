#!/usr/bin/env bash
# Waits for the checks of one PR head to settle, polling every minute.
# Settled = every named check has appeared and nothing was pending for two
# polls in a row (checks register late, so one quiet poll is not enough).
# Last line: SETTLED, FAILED <checks>, HEAD_MOVED <sha> or TIMEOUT.
#
# usage: wait-checks.sh <owner/repo> <pr> <head sha> <minutes> [<check name>...]
set -u
repo=$1 pr=$2 sha=$3 minutes=$4
shift 4

quiet=0
for ((i = 1; i <= minutes; i++)); do
  sleep 60
  head=$(gh pr view "$pr" --repo "$repo" --json headRefOid --jq .headRefOid) || continue
  if [ "$head" != "$sha" ]; then
    echo "HEAD_MOVED $head"
    exit 3
  fi
  # gh exits non-zero while checks are pending or failing; the JSON is still printed.
  checks=$(gh pr checks "$pr" --repo "$repo" --json name,bucket 2>/dev/null) || true
  if [ -z "$checks" ]; then
    echo "$(date +%T) no checks yet"
    quiet=0
    continue
  fi
  pending=$(jq '[.[] | select(.bucket == "pending")] | length' <<<"$checks")
  missing=""
  for name in "$@"; do
    jq -e --arg n "$name" 'any(.[]; .name == $n)' <<<"$checks" >/dev/null || missing="${missing:+$missing,}$name"
  done
  echo "$(date +%T) pending=$pending missing=${missing:-none}"
  if [ "$pending" -eq 0 ] && [ -z "$missing" ]; then quiet=$((quiet + 1)); else quiet=0; fi
  if [ "$quiet" -ge 2 ]; then
    failed=$(jq -r '[.[] | select(.bucket == "fail" or .bucket == "cancel") | .name] | join(", ")' <<<"$checks")
    if [ -n "$failed" ]; then
      echo "FAILED $failed"
      exit 1
    fi
    echo "SETTLED"
    exit 0
  fi
done
echo "TIMEOUT"
exit 2
