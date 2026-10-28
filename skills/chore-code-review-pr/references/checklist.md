# Review checklist

Organise findings into these categories. Evaluate queries against the largest networks: ~1.7M scoring_scores, ~751K users, ~685K bookings per network.

## Severity

- **CRITICAL** — production bugs, security, data loss, races, broken existing behaviour. Fix before merge.
- **WARNING** — architecture violations, conventions that create real debt, design-system misuse, missing translations, reinvented wheels, performance at scale, missing tests on critical paths, concrete reusability. Fix, or track as follow-up with explicit risk acceptance.
- **SUGGESTION** — simplifications and minor alignment. Author's discretion.

Before posting, test every CRITICAL and WARNING: who hits it, how often, and is it new in this PR? Behaviour that predates the PR, an edge case that needs an unusual sequence, and risk to something that gates nothing (a local-only suite, an export nobody imports, a pattern the codebase doesn't follow consistently) is a SUGGESTION at most, or a line in the summary.

## Category

Every finding gets exactly one category, for its primary concern (an unscoped query is Security, not Performance):

- **Bug**: wrong or broken behaviour, edge cases, flags read before LaunchDarkly loads, broken Railway chains, bare rescues
- **Security**: authorization, `network_id` tenancy, injection, mass assignment, missing audit logs
- **Data Integrity**: races, multi-step writes outside a transaction, non-idempotent jobs, unguarded destructive operations
- **Performance**: N+1s, missing indexes, Ruby filtering that belongs in SQL, unbounded table growth
- **Architecture**: logic in the wrong layer, raw services instead of operations, bypassing `contracts.ts`, missing ErrorBoundary, flag setup
- **Reuse**: reinvented wheels, the same pattern twice in the PR
- **Design System**: raw HTML over DS components, hardcoded tokens, wrong DS imports
- **UI/UX**: what the user sees or does: layout, states, flows, copy
- **a11y**: roles, labels, focus, keyboard, contrast
- **i18n**: unwrapped strings, wrong `s__` context, template-literal interpolation
- **Test Coverage**: missing specs or cases, banned test patterns, missing `data-testid`
- **Conventions**: Ruby/TypeScript idioms, log shape, import order
- **Simplify**: same behaviour with less code: named predicates, flatter conditionals, extracted repeated logic
- **Cleanup**: code that shouldn't be there: dead code, unused imports or exports, debug code, stale TODOs
- **Docs**: comments on non-obvious logic, README/ADR, misleading names

## 1. Summary

3–5 bullets: what the PR does, what it changes, domains touched, notable risks, what is done well.

## 2. Critical issues

- SQL injection: interpolation in `where`, `find_by`, `order`, raw SQL
- Mass assignment: params reaching a model without `.permit`
- Missing authorization: endpoints or operations not checking network membership / permissions
- Missing multi-tenancy: queries or operations not scoped by `network_id`
- Races: concurrent writes without locking or atomic operations
- Destructive operations (delete, truncate, bulk update) without safeguards
- Sidekiq jobs that duplicate work on retry (no uniqueness guard, non-idempotent writes)
- Multi-step writes outside a `transaction`
- Broken Railway chain: `yield` without failure handling, paths that bypass the monad
- Feature flag in React Query `enabled` without `flagsLoaded`: before LaunchDarkly loads, flags are `undefined` and `enabled: undefined` behaves as `true`. Required shape: `enabled: flagsLoaded && flag && condition`

## 3. Architecture violations

Business logic lives in operations/services; controllers, serializers, views and the frontend are presentation.

- Pricing, eligibility, or authorization rules in controllers, serializers, decorators, or frontend
- Frontend enforcing a rule the backend does not (`useAdminCan` is fine for UX only when the backend enforces the same check)
- Money arithmetic or display with raw numbers instead of the `Money` VO from `@hivebrite/utils`
- Backend logic that should be a Railway operation written inline or as a raw service
- New React entry points (`entries/`) without a team ErrorBoundary (`AdminXpTeamErrorBoundary`, `EvolutionTeamErrorBoundary`, `UjTeamErrorBoundary`); deprecated: `EvErrorBoundary`, `UjErrorBoundary`, `AdminXpErrorBoundary`
- CRUD on sensitive resources without `auditable_as` / `AuditLog.capture`
- Components importing OpenAPI SDK types or `@hivebrite/realtime-events` types directly instead of via the local `contracts.ts`
- Translatable model columns: only the `*_translations` jsonb column plus `I18nDatabaseConcern`; no separate base column
- New feature flags without `launchdarkly.production.yml.dist` defaults and, for frontend use, `front/src/react/shared/hooks/useFeatureFlag/flags.ts`
- Operations returning OpenAPI SDK error constants; operations use plain string codes, controllers translate

## 4. Design system and theme

All UI uses `@hivebrite/design-system` components and theme tokens.

- Raw HTML where a DS equivalent exists: `div`→`Box`, `button`→`Button`, `a`→`Link`, inputs→`Inputs.*`, `img`→`Image`/`Avatar`, styled lists→`ContentList`/`ActionsList`
- Custom modals, tooltips, dropdowns, spinners, pagination, tabs, accordions, breadcrumbs, progress bars, avatars, badges/pills/tags, toasts, cards when the DS has them
- `Text` component does not exist: `<Box font="h3-semibold">`
- `gap` on `Box` does not exist: `gridGap`, `gridColumnGap`, `gridRowGap`
- `theme.shadows` does not exist: `primaryShadow`, `defaultShadow`, `bottomShadow`, `separatorShadow`, `focusOutline` from `@hivebrite/design-system/theme`
- Font tokens must be valid `FontName` values (`h1-bold` … `metadata-regular-link`); check the type when unsure
- Legacy `CATEGORIES.*` icon imports: use `@hivebrite/icons/{solid,regular,light,duotone}`
- DS imports are lowercase subpaths (`@hivebrite/design-system/box`), never `@design-system/*` or barrels
- Hardcoded colors, spacing px, z-index, border-radius, box-shadow: use `theme.colors.*`, `theme.space` indices 0–10 (4px steps), `theme.zIndices.*`, `theme.themeVariables.*BorderRadius`, the shadow exports
- CSS `transform` on floating elements conflicts with floating-ui; use `scale`/`rotate` or a child element
- More than 5 inline style props: extract to `styled(Box).attrs({})`

## 5. Conventions

**Ruby**: `{user:}` shorthand; `Model.arel_table[:col]` over table-name strings; block-form `Rails.logger.info { }`; structured log context (`context:`, `msg:`, `error: { stack:, message:, kind: }`); no bare `rescue StandardError`; `object_locale` set before serialization under `PageLocaleConcern`; `LEFT JOIN … IS NULL` over `NOT IN (subquery)` on large tables; `find_by` over `.find { }` and `exists?` over `find_by(...).present?`; jobs with `retry_on wait: :exponentially_longer` that check `result.success?`.

**TypeScript/React**: `interface` for object shapes; `as const` maps over enums; `Array<T>`; `Box` over `div`; named exports; routes from `@alumni-connect/routes` not `window.Routes`; dayjs via `hb-react/shared/utils/dayjs/dayjs`; storage via `hb-react/shared/utils/Storage`; `usePress`/`useHover`/`useFocusRing` from React Aria instead of DIY key and pointer handlers; `useExternalLink` over `window.open`; `useRealtimeEvent` over direct Ably; arrow-function components and handlers; positive conditions with early returns; large subcomponents and static content in their own files; import groups external → `@hivebrite/*` → `hb-react/` → relative.

**i18n**: every user-visible string (JSX text, placeholder, aria-label, title, alt, toast, error, button) wrapped in `__`, `s__`, `n__`, `ns__`; `s__('PascalCaseContext|text')` for non-generic terms (generic: Edit, Cancel, Save, Delete, Close, Submit, Back, Next, Yes, No); interpolation via `.i__({ })`, never template literals; the functions are ambient globals from `front/src/react/types/global.d.ts`, never imported; no hardcoded English in Grape entities, serializers, or tests (`I18n.t` / `__`).

## 6. Performance

- N+1: association access in a loop without `includes`/`preload` (already-preloaded associations are fine)
- Ruby `.select { }`/`.find { }`/`.reject { }` on a relation that should be SQL
- `.all.each` instead of `find_each`; `map(&:id)` instead of `pluck`; `any?`/`present?` instead of `exists?`
- Serializers touching associations the controller did not preload
- New columns used in `where`/`order` without an index
- Queries not scoped by `network_id`
- Monotonically growing tables without cleanup or archival

## 7. Testing gaps

- Railway operations without both `:success` and `:failure` specs
- Endpoints without request specs for authenticated, unauthenticated, forbidden
- React components without Jest tests; components with stories missing `composedStories` + `testA11y`
- Feature flags not tested both on and off; jobs without retry/idempotency specs
- `create` where `build_stubbed` suffices; snapshot tests and disabled axe rules (both banned)
- `fireEvent` instead of `userEvent.setup()` from `@hivebrite/test-utils`; manual `jest.mock` of flags instead of `mockFeatureFlags` via `createTest`; `wrapper` in `optionsRender` (breaks the custom wrappers)
- Missing MSW handlers; `getByRole` where `getByTestId`/`getByText`/`getByLabelText` is faster; `getByLabelText` on required fields without `{ exact: false }`
- Missing `data-testid` on new interactive components or page sections

## 8. Reuse (WARNING)

Flag only concrete opportunities: a domain-agnostic hook, util, or component living in a feature directory when `shared/` is the natural home; the same pattern appearing twice in the PR; inline backend logic that is obviously a concern or service. Not speculative "might be useful someday".

## 9. Suggestions

Keep short: simplifications without loss of clarity, repeated logic to extract, complex conditionals that want a named predicate, missing comments on non-obvious logic.
