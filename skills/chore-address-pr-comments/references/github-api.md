# Closing items

| Action | Command | ID |
|---|---|---|
| Reply in a review thread | `gh api repos/<o>/<r>/pulls/<pr>/comments/<restId>/replies -f body=…` | `restId` (numeric) |
| Reply to a PR-level comment | `gh api repos/<o>/<r>/issues/<pr>/comments -f body=…` (new comment; no threaded replies) | PR number |
| Resolve a thread | `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<id>"}) { thread { isResolved } } }'` | thread `id` (`PRRT_…`) |

A 404 on reply usually means the GraphQL node id was used where the numeric `restId` was needed; the reverse mistake breaks `resolveReviewThread`. PR-level comments cannot be resolved.
