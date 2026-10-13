# Standards to load

Always start with the repo's root `AGENTS.md`/`CLAUDE.md` and its review doc: `docs/CODE_REVIEW_GUIDELINES.md` in alumni_connect, `docs/pr-review.md` in hivetests. In front-monorepo, add the `AGENTS.md` of each touched package. The table below is alumni_connect only.

| Changed path | Read |
|---|---|
| `app/**/*.rb` | `app/CLAUDE.md` |
| `app/controllers/**`, `app/api/**` | + `app/api/CLAUDE.md` |
| `app/models/**`, `app/jobs/**` | + `docs/backend/QUERY_PERFORMANCE.md` |
| `front/**/*.{ts,tsx,js,jsx}` | `front/CLAUDE.md`, `docs/front/CODE_GUIDELINES.md`, `docs/frontend/DESIGN_SYSTEM.md`, `docs/internationalization/INTERNATIONALIZATION_GUIDELINES.md` |
| `front/**/*.test.*`, `front/**/__tests__/**` | + `docs/frontend/TESTING.md` |
| `spec/**` | `spec/CLAUDE.md`, `docs/testing/RSPEC_GUIDELINES.md` |
| `db/migrate/**` | `db/CLAUDE.md`, `docs/RAILS_MIGRATIONS_GUIDELINES.md` |
| feature flag added or removed | `docs/FEATURE_FLAGS.md` |

`front/CLAUDE.md` links to topic docs under `docs/frontend/`; follow the ones the diff touches. Files that don't exist in this repo are skipped.
