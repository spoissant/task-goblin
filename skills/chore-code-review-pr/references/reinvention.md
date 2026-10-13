# Reinventing-the-wheel audit

Search the codebase before flagging, the way the calling skill says to read code. Flag only clear existing equivalents.

## Where to look

Frontend: `front/src/react/shared/hooks/`, `front/src/react/shared/utils/`, `front/src/react/shared/components/` (incl. `formik/`, `DesignSystem/`, `ErrorBoundary/`), and the packages `@hivebrite/design-system`, `@hivebrite/react-hooks`, `@hivebrite/utils` (incl. `Money`), `@hivebrite/i18n`, `@hivebrite/icons`, `@hivebrite/realtime-events`, `@hivebrite/test-utils`.

Backend: `app/models/concerns/`, `app/controllers/concerns/`, `app/services/`, and the internal gems under `gems/`: `hivebrite_railway`, `feature_flag`, `dto`, `hivebrite-elasticsearch`, `hivebrite-forex`, `multi_table_finder`, `categories`.

## Known patterns

| Reimplemented | Existing |
|---|---|
| Debounce | `useDebounce` |
| Deep-compare memo | `useDeepMemo` |
| Clipboard | `useCopyToClipboard` |
| DOM listener in effect | `useEventListener` |
| Key press / Escape | `useKeyDown`, `useOnEscape` |
| Infinite scroll | `useInfiniteScroll` + `InfiniteLoadObserver` |
| local/sessionStorage | `useLocalStorage`, `useSessionStorage`, `Storage` utils |
| Feature flag check | `useFeatureFlag` |
| Date / number / currency formatting | `date/`, `dateIntl/`, `dayjs/`, `formatNumber/` utils, `Date` component |
| Money math | `Money` from `@hivebrite/utils` |
| API errors into a form | `handleMutationError` (`formik/` utils) |
| File validation | `files/` utils |
| Distance | `getDistanceFromLatLonInKm` |
| Truncation | `truncateHtmlAt`, `ReadMore` |
| Query strings | `objectToQuery` |
| Ref merging | `mergeRefs` |
| Confirm dialog | `ConfirmationDialog` |
| Error boundary | team `ErrorBoundary` components |
| Rich text | `QuillEditorWrappedV3` |
| Form inputs | `shared/components/formik/` |
| External link confirm | `ExternalLinkProvider` + `useExternalLink` |
| Realtime subscription | `useRealtimeEvent` |
| Scroll to element | `scrollToElementAndFocus` |
| Empty state / loading | `EmptyCard`, `Loader`, `Skeleton` |
| User picker | `UserSearch` |
| Modal, tooltip, dropdown, pagination, avatar, badge/pill/tag, progress, breadcrumb, tabs, accordion | the DS component of the same name (`Dialog`/`SidePanel`/`Modal`, `Tooltip`/`InformationTooltip`, `Dropdown`, `Pagination`/`PaginationPrevNext`, `Avatar`/`UsersAvatarList`, `Badge`/`Pill`/`Tag`, `ProgressBar`, `Breadcrumb`, `TabsList`+`Tab`, `Accordion`) |
| HTML sanitisation | `HtmlEditorSanitizer` |
| Cache | `cache_services/` |
| Soft delete / audit trail | `discard_concern`, `paper_trail_concern` |
| Full-text search | `pg_full_text_searchable_concern`, `hivebrite-elasticsearch` |
| Flags, monads, multi-table, forex, categories, DTOs | the gems listed above |
