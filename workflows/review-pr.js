// Parallel PR review for /chore-code-review-pr and /chore-code-review-my-pr.
// Slices the diff by file type, reviews each slice in its own agent, dedups
// by location, then has two independent agents try to refute every finding
// before the calling skill posts anything. The skill passes the
// PR metadata in `args` and never reads the full diff itself.
//
// args: {
//   pr: { number, repo, base, head, sha, url, author },
//   mode: 'git-objects' | 'worktree',   // colleague PR vs. own PR
//   refDir: '/abs/path/to/chore-code-review-pr/references',
//   files: [{ path, additions, deletions }],   // gh pr view --json files
// }
export const meta = {
  name: 'review-pr',
  description: 'Review a PR in parallel slices against the Hivebrite checklist, then adversarially verify every finding',
  whenToUse: 'Called by the code-review chores above their size threshold with the PR metadata in args; not meant to be run by hand',
  phases: [
    { title: 'Review', detail: 'one reviewer per slice plus a reinvention audit' },
    { title: 'Verify', detail: 'evidence and impact check per finding' },
  ],
}

const SPLIT_ABOVE = 60
const MIN_GROUP = 5
const SEVERITIES = ['CRITICAL', 'WARNING', 'SUGGESTION']
// Keep in sync with the Category section of checklist.md
const CATEGORIES = ['Bug', 'Security', 'Data Integrity', 'Performance', 'Architecture', 'Reuse', 'Design System', 'UI/UX', 'a11y', 'i18n', 'Test Coverage', 'Conventions', 'Simplify', 'Cleanup', 'Docs']

const SKIP = /(^|\/)(yarn\.lock|package-lock\.json|pnpm-lock\.yaml|Gemfile\.lock|schema\.rb|structure\.sql)$|(^|\/)(locales?|generated|__snapshots__)\/|\.(svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|snap)$/
const RUBY = /\.(rb|rake|erb|haml|slim|gemspec)$|(^|\/)(Gemfile|Rakefile)$/
const FRONT = /\.(ts|tsx|js|jsx|mjs|cjs|scss|css|mdx|html)$/

const SECTIONS = {
  Backend: '2, 3, 5 (Ruby), 6, 7, 8 and 9',
  Frontend: '2, 3, 4, 5 (TypeScript/React and i18n), 7, 8 and 9',
}

const TONE = `Tone: direct, not diplomatic ("this will break when two requests race", not "consider a lock"). Every finding states the real-world consequence: who hits it, where (page or screen, role, flag state), how to see it. Don't flag what RuboCop, ESLint or TypeScript catch, generated files, or naming preferences with no real-world impact. Write logins without "@".`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          category: { type: 'string', enum: CATEGORIES, description: 'primary concern, from the checklist Category section' },
          path: { type: 'string' },
          line: { type: 'integer', description: 'line in the head commit, on an added line whenever one fits' },
          endLine: { type: 'integer', description: 'last line when the finding spans a range' },
          summary: { type: 'string', description: 'one line' },
          consequence: { type: 'string', description: 'who hits it, where, how to see it' },
          fix: { type: 'string' },
          standard: { type: 'string', description: 'the standards doc or rule violated, if any' },
          replacement: { type: 'string', description: 'exact replacement for lines line..endLine when the fix is one' },
        },
        required: ['severity', 'category', 'path', 'line', 'summary', 'consequence', 'fix'],
      },
    },
    praise: { type: 'array', items: { type: 'string' }, description: 'up to two bullets on what the slice does well' },
  },
  required: ['findings'],
}

const EVIDENCE_SCHEMA = {
  type: 'object',
  properties: {
    holds: { type: 'boolean', description: 'false when the cited code does not have the problem as described' },
    line: { type: 'integer', description: 'corrected anchor line when the original one was wrong' },
    reason: { type: 'string' },
  },
  required: ['holds', 'reason'],
}

const IMPACT_SCHEMA = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: [...SEVERITIES, 'NONE'], description: 'severity the checklist test supports; NONE when there is no real consequence' },
    reason: { type: 'string' },
  },
  required: ['severity', 'reason'],
}

const { pr, mode, refDir, files } = args

function readRules() {
  if (mode === 'worktree') {
    return `The working tree is checked out at the PR head, so read files with Read, Grep and Glob, and the diff with \`gh pr diff ${pr.number}\`. Never edit anything.`
  }
  return `The working tree belongs to someone else: never checkout, switch, stash, reset, edit, or \`git fetch\`. Read files with \`git show "${pr.sha}:<path>"\`, search with \`git grep -n <pattern> "${pr.sha}" -- <paths>\`, list with \`git ls-tree -r --name-only "${pr.sha}" -- <dir>\` (the standards docs too), and the diff with \`gh pr diff ${pr.number}\`. Keep the quotes: zsh mangles a bare \`$SHA:\`.`
}

function header() {
  return `PR ${pr.repo}#${pr.number} (${pr.url}) by ${pr.author}, ${pr.base} ← ${pr.head}, head ${pr.sha}.\n${readRules()}\nReferences are under ${refDir}/ (read them with Read: they are local files, not in the PR).`
}

function slice(allFiles) {
  const skipped = allFiles.filter((f) => SKIP.test(f.path)).map((f) => f.path)
  const kept = allFiles.filter((f) => !SKIP.test(f.path))
  const backend = kept.filter((f) => RUBY.test(f.path)).map((f) => f.path)
  const frontend = kept.filter((f) => FRONT.test(f.path)).map((f) => f.path)
  const other = kept.filter((f) => !RUBY.test(f.path) && !FRONT.test(f.path)).map((f) => f.path)
  if (backend.length || !frontend.length) backend.push(...other)
  else frontend.push(...other)
  const slices = [
    ...split('Backend', backend),
    ...split('Frontend', frontend),
  ]
  return { slices, skipped, reviewed: kept.map((f) => f.path) }
}

// A slice above SPLIT_ABOVE files splits by its first two path segments; tiny
// groups fold into a misc slice so no agent gets three files.
function split(kind, paths) {
  if (!paths.length) return []
  if (paths.length <= SPLIT_ABOVE) return [{ name: kind, kind, files: paths }]
  const groups = new Map()
  for (const p of paths) {
    const key = p.split('/').slice(0, 2).join('/')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }
  const out = []
  const misc = []
  for (const [key, group] of groups) {
    if (group.length < MIN_GROUP) misc.push(...group)
    else out.push({ name: `${kind} ${key}`, kind, files: group })
  }
  if (misc.length) out.push({ name: `${kind} misc`, kind, files: misc })
  return out
}

function reviewerPrompt(s) {
  return `${header()}

You review one slice of this PR: the ${s.kind} slice${s.name !== s.kind ? ` (${s.name})` : ''}. Its files, and only these:
${s.files.map((f) => `- ${f}`).join('\n')}

1. Read ${refDir}/standards.md and load the standards docs it lists for these paths (skip files the repo does not have).
2. Read the critical files of the slice in full, not just the diff: operations, models, controllers, anything security-sensitive. N+1s, tenancy scoping, Railway chains and rescue contracts only show with the surrounding class. The diff is enough for specs, locales, schema and generated files.
3. Review against ${refDir}/checklist.md, sections ${SECTIONS[s.kind]}, with its severity definitions, its severity test (who hits it, how often, is it new in this PR) and its Category list.
${TONE}

Return findings only, no prose review: each with severity, one category from the checklist Category section, path, line in the head commit (on an added line whenever one fits; endLine for a range), a one-line summary, the consequence, the concrete fix, the standard violated if any, and an exact replacement for the anchored lines when the fix is one. No code excerpts beyond the replacement. Up to two praise bullets on what the slice does well.`
}

function reinventionPrompt(paths) {
  return `${header()}

Reinventing-the-wheel audit. Using \`gh pr diff ${pr.number}\`, list every non-trivial hook, component, utility, service or concern the PR adds (new files and new exported names) among these files:
${paths.map((f) => `- ${f}`).join('\n')}

Then, following ${refDir}/reinvention.md (where to look, known patterns), search the codebase for an existing equivalent of each one. Report only clear existing equivalents, as WARNING findings in category "Reuse": path and line of the new construct's definition, a one-line summary naming the existing equivalent, the consequence (two implementations to maintain, the existing one's behaviour the new one misses), and the fix (use the existing one). Nothing speculative. No praise.`
}

function evidencePrompt(f) {
  return `${header()}

A first-pass reviewer claims this ${f.severity} finding:
- ${f.path}:${f.line}${f.endLine ? `-${f.endLine}` : ''} — ${f.summary}
- Consequence: ${f.consequence}
- Fix: ${f.fix}

You are the skeptic. Re-read the cited lines and enough surrounding code to judge, and try to refute the claim: does this code actually have the problem as described? Check that the anchor is a line the PR changed (\`gh pr diff ${pr.number}\`); if the problem is real but the line is wrong, give the corrected line. A problem the code does not exhibit, a misread of what the code does, or a claim you cannot find evidence for in the code is refuted (holds: false). Default to refuted when uncertain.`
}

function impactPrompt(f) {
  return `${header()}

Take this finding as factually accurate about the code:
- ${f.severity} · ${f.category} · ${f.path}:${f.line} — ${f.summary}
- Consequence: ${f.consequence}

Apply the severity test from ${refDir}/checklist.md ("Severity" section): who hits it, how often, and is it new in this PR? Behaviour that predates the PR (check \`gh pr diff ${pr.number}\` and the surrounding code), an edge case that needs an unusual sequence, and risk to something that gates nothing are a SUGGESTION at most. A SUGGESTION earns its comment only if the author would act on it: a simplification that removes real complexity, duplicated logic, a misleading name. Style preferences, what RuboCop, ESLint or TypeScript already catch, and "could also be written as" are NONE. Return the severity the test supports: CRITICAL, WARNING, SUGGESTION, or NONE when the finding is not worth a comment.`
}

function dedup(findings) {
  const byLocation = new Map()
  for (const f of findings) {
    const key = `${f.path}:${f.line}`
    const prev = byLocation.get(key)
    if (!prev) byLocation.set(key, f)
    else if (rank(f) < rank(prev) || (rank(f) === rank(prev) && (f.consequence || '').length > (prev.consequence || '').length)) byLocation.set(key, f)
  }
  return [...byLocation.values()]
}

function rank(f) {
  return SEVERITIES.indexOf(f.severity)
}

// `checks` carries both verifiers' reasoning on every outcome, and `reported`
// the severity and line as the reviewer wrote them, for the audit table.
function judge(f, evidence, impact) {
  const reported = { severity: f.severity, line: f.line }
  if (!evidence || !impact) return { ...f, reported, checks: { evidence: evidence?.reason, impact: impact?.reason }, verification: 'unverified: a verifier died' }
  const checks = { evidence: evidence.reason, impact: impact.reason }
  if (!evidence.holds) return { dropped: { ...f, reported, checks, reason: `refuted: ${evidence.reason}` } }
  if (impact.severity === 'NONE') return { dropped: { ...f, reported, checks, reason: `not worth a comment: ${impact.reason}` } }
  const severity = SEVERITIES[Math.max(rank(f), SEVERITIES.indexOf(impact.severity))]
  const line = evidence.line || f.line
  const notes = [
    severity !== f.severity ? `downgraded from ${f.severity}: ${impact.reason}` : null,
    line !== f.line ? `anchor moved from ${f.line}: ${evidence.reason}` : null,
  ].filter(Boolean)
  return { ...f, severity, line, reported, checks, verification: notes.length ? notes.join('; ') : 'confirmed' }
}

const plan = slice(files)
if (plan.skipped.length) log(`Skipped ${plan.skipped.length} locale/asset/generated files`)
log(`${plan.slices.length} review slice(s): ${plan.slices.map((s) => `${s.name} (${s.files.length})`).join(', ')}`)

// Barrier on purpose: dedup needs every slice's findings before verification.
phase('Review')
const reviews = await parallel([
  ...plan.slices.map((s) => () => agent(reviewerPrompt(s), { label: `review:${s.name}`, phase: 'Review', schema: FINDINGS_SCHEMA }).then((r) => ({ slice: s, result: r }))),
  () => agent(reinventionPrompt(plan.reviewed), { label: 'review:reinvention', phase: 'Review', schema: FINDINGS_SCHEMA, agentType: 'Explore' }).then((r) => ({ slice: { name: 'Reinvention', files: plan.reviewed }, result: r })),
])

const failedSlices = reviews.filter((r) => r && !r.result).map((r) => r.slice.name)
if (failedSlices.length) log(`Not reviewed (agent died): ${failedSlices.join(', ')}`)
const raw = reviews.filter((r) => r && r.result).flatMap((r) => r.result.findings || [])
const praise = reviews.filter((r) => r && r.result).flatMap((r) => r.result.praise || [])
const unique = dedup(raw)
const merged = raw.filter((f) => !unique.includes(f)).map((f) => ({ ...f, reason: `merged into the finding at ${f.path}:${f.line}, which was more severe or more precise` }))
log(`${raw.length} raw findings, ${unique.length} after dedup`)

phase('Verify')
const judged = await parallel(unique.map((f) => () =>
  parallel([
    () => agent(evidencePrompt(f), { label: `evidence:${f.path}:${f.line}`, phase: 'Verify', schema: EVIDENCE_SCHEMA }),
    () => agent(impactPrompt(f), { label: `impact:${f.path}:${f.line}`, phase: 'Verify', schema: IMPACT_SCHEMA }),
  ]).then(([evidence, impact]) => judge(f, evidence, impact))))

const kept = judged.filter((j) => j && !j.dropped).sort((a, b) => rank(a) - rank(b))
const dropped = judged.filter((j) => j && j.dropped).map((j) => j.dropped)
log(`${kept.length} findings kept, ${dropped.length} dropped`)

return {
  findings: kept,
  praise,
  dropped,
  merged,
  slices: plan.slices.map((s) => ({ name: s.name, files: s.files.length })),
  skipped: plan.skipped,
  failedSlices,
}
