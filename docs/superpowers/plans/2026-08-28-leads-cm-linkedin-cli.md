# leads.cm LinkedIn CLI implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a headless `leads-cm` CLI and TypeScript library that stream, filter, and export the leads.cm LinkedIn dataset without browser control.

**Architecture:** Validate commands with Zod, resolve a bundled country catalog, fetch one tabular JSON file at a time, and emit matching rows through a bounded-memory parser. Keep stdout machine-readable; send progress and failures to stderr.

**Tech Stack:** Node.js 22+, TypeScript ESM, pnpm, goke, Zod, `@streamparser/json`, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-28-leads-cm-linkedin-cli-design.md`

## Global constraints

- Package name `leads-cm-cli`; executable `leads-cm`.
- No browser, cookies, account token, LLM, database, or contact cache.
- Publish under the MIT license, matching the reference CLI.
- Process source files sequentially. Do not add a concurrency flag.
- Default output is NDJSON on stdout. Progress and errors use stderr.
- Never commit live lead values or PII fixtures.
- No completion claim until deterministic, large-stream, live contract, UI parity, pack, and install checks pass with zero skipped tests.

## File map

```text
package.json                         package metadata and scripts
LICENSE                              MIT license text
tsconfig.json                        strict ESM build
vitest.config.ts                     deterministic test configuration
src/cli.ts                           commands, flags, exit codes
src/index.ts                         public library exports
src/types.ts                         shared data and option types
src/errors.ts                        typed operational errors
src/catalog.ts                       country lookup
src/data/countries.json              release-time country snapshot
src/planner.ts                       file, dataset, and all-file planning
src/transport.ts                     HTTP headers, timeout, retry
src/parser.ts                        bounded-memory tabular JSON parsing
src/normalize.ts                     source-to-output conversion
src/filters.ts                       website-compatible predicates
src/output.ts                        NDJSON, CSV, projection, atomic files
src/client.ts                        sequential search orchestration
tests/*.test.ts                      unit and integration tests
tests/fixtures/*.json                invented tabular fixtures
scripts/live-contract.ts             aggregate-only live verification
scripts/large-stream.ts              generated large response test
scripts/package-smoke.ts             packed-package install test
.github/workflows/ci.yml              Linux, macOS, Windows CI
README.md                             install, commands, authorization notice
```

---

### Task 1: Package base, types, catalog, and planner

**Files:** Create `package.json`, `LICENSE`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `src/errors.ts`, `src/catalog.ts`, `src/planner.ts`, `src/data/countries.json`, `tests/catalog.test.ts`, `tests/planner.test.ts`.

**Interfaces:** Produces `Country`, `Selection`, `FilePlan`, `resolveCountry()`, `countryDataUrl()`, and `planSelection()` for every later task.

- [ ] **Step 1: Add the package configuration**

Use ESM, MIT license metadata, `bin: { "leads-cm": "dist/cli.js" }`, Node `>=22`, and scripts `build`, `typecheck`, `test`, `test:live`, `test:large`, and `test:package`. Add runtime dependencies `@streamparser/json`, `goke`, `string-dedent`, and `zod`; add `@types/node`, `rimraf`, `tsx`, `typescript`, and `vitest` as dev dependencies. Configure strict TypeScript with `resolveJsonModule`, `verbatimModuleSyntax`, `rootDir: src`, and `outDir: dist`. Add the standard MIT license text with `Copyright (c) 2026 leads-cm-cli contributors`.

- [ ] **Step 2: Write failing catalog and planner tests**

```ts
expect(resolveCountry('united states')).toMatchObject({ slug: 'United_States', hasStatus: true })
expect(countryDataUrl('Côte_d\'Ivoire', 2)).toBe('https://vorbidden.com/C%C3%B4te_d%27Ivoire/2.json')
expect(planSelection({ kind: 'dataset', dataset: 2 })).toEqual({ start: 6, end: 10, stopOn404: true })
expect(planSelection({ kind: 'file', file: 3 })).toEqual({ start: 3, end: 3, stopOn404: false })
expect(() => planSelection({ kind: 'dataset', dataset: 0 })).toThrow('dataset must be at least 1')
```

- [ ] **Step 3: Run the focused tests and confirm the red state**

Run `pnpm vitest run tests/catalog.test.ts tests/planner.test.ts`. Expected: failure because the modules do not exist.

- [ ] **Step 4: Implement the contracts and minimum planner**

```ts
export interface Country { name: string; slug: string; estimatedLeads: number; fileCount: number; hasStatus: boolean }
export type Selection = { kind: 'file'; file: number } | { kind: 'dataset'; dataset: number } | { kind: 'all'; startFile: number; maxFiles?: number }
export interface FilePlan { start: number; end: number; stopOn404: boolean }
```

`all` uses `end = startFile + (maxFiles ?? 10_000) - 1`. Encode each URL path segment with `encodeURIComponent(value).replace(/'/g, '%27')`; do not encode `/`. Resolve names case-insensitively after trimming spaces.

- [ ] **Step 5: Populate and validate the catalog**

Use the authorized leads.cm page audit to extract country name, URL slug, lead estimate, file count, and US status support. Commit only metadata. Add a test that every slug is unique, file counts are positive integers, and `United States`, `India`, and `Eritrea` match the audited values.

- [ ] **Step 6: Run checks and commit**

Run `pnpm typecheck && pnpm vitest run tests/catalog.test.ts tests/planner.test.ts`. Expected: pass.

```bash
git add package.json LICENSE tsconfig.json vitest.config.ts src tests/catalog.test.ts tests/planner.test.ts
git commit -m "feat: add country catalog and file planner"
```

### Task 2: HTTP transport and retry policy

**Files:** Create `src/transport.ts`, `tests/transport.test.ts`, `tests/http-server.ts`.

**Interfaces:** Consumes planned URLs. Produces `Transport.get(url, options)` returning `{ status, headers, body }` and `FetchTransport`. `options` has optional `signal` and request `headers`; `setup` uses it for a byte range without replacing required transport headers.

- [ ] **Step 1: Write local-server tests**

Cover the exact request headers, caller-supplied `Range`, a successful stream, 403 without retry, 404 passthrough, 429 with `Retry-After`, 500 retry then success, timeout, and an interrupted body. Inject `fetch`, `sleep`, and `random` so retry tests do not wait.

```ts
const transport = new FetchTransport({ fetchImpl, sleep: async ms => waits.push(ms), random: () => 0 })
await transport.get('https://vorbidden.com/Eritrea/1.json')
expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: expect.objectContaining({ Referer: 'https://app.leads.cm/linkedin/' }) }))
```

- [ ] **Step 2: Run the test and confirm it fails**

Run `pnpm vitest run tests/transport.test.ts`. Expected: module-not-found failure.

- [ ] **Step 3: Implement typed errors and transport**

Define `AccessError`, `NetworkError`, `PartialOutputError`, and `SchemaError` with exit codes 2, 3, 4, and 5. Set `Accept: application/json`, the leads.cm referrer, and `User-Agent: leads-cm-cli/<version>`. Retry only 408, 429, and 5xx, at most three retries after the first attempt. Honor seconds or HTTP-date `Retry-After`; otherwise use capped exponential delay plus jitter. Abort each attempt at the configured timeout.

- [ ] **Step 4: Verify and commit**

Run `pnpm typecheck && pnpm vitest run tests/transport.test.ts`. Expected: pass.

```bash
git add src/errors.ts src/transport.ts tests/transport.test.ts tests/http-server.ts
git commit -m "feat: add resilient HTTP transport"
```

### Task 3: Streaming parser and normalization

**Files:** Create `src/parser.ts`, `src/normalize.ts`, `tests/parser.test.ts`, `tests/normalize.test.ts`, `tests/fixtures/leads.json`.

**Interfaces:** Produces `parseTabular(stream, callbacks): Promise<ParseStats>` and `normalizeLead(raw): Lead`.

- [ ] **Step 1: Add invented fixtures and failing tests**

```ts
const fixture = { headers: ['name', 'employees', 'revenue', 'linkedin'], rows: [['Ada Example', '11', '250', 'ada-example']] }
expect(normalizeLead({ name: 'Ada Example', employees: '11', revenue: '250', linkedin: 'ada-example' })).toMatchObject({ employees: 11, companysize: 'Growing Startup', revenueUsd: 250000, linkedin: 'http://www.linkedin.com/in/ada-example' })
```

Feed the fixture one byte at a time and assert one header event, one row event, and correct stats. Add malformed, truncated, missing-header, short-row, extra-column, null, and Unicode cases.

- [ ] **Step 2: Run tests and confirm failure**

Run `pnpm vitest run tests/parser.test.ts tests/normalize.test.ts`. Expected: missing implementations.

- [ ] **Step 3: Implement bounded parsing**

Configure `@streamparser/json` with `paths: ['$.headers', '$.rows.*']` and `keepStack: false`. Reject rows before headers. Convert each row into a record by header index, call the synchronous row visitor, and await the caller's `onChunkComplete` after every response chunk so an output writer can drain.

- [ ] **Step 4: Implement normalization**

Preserve source fields. Parse `employees` as a number or null, add `companysize`, preserve raw `revenue`, add `revenueUsd`, and prefix the five URL categories exactly as the spec states. Do not invent an ID.

- [ ] **Step 5: Verify and commit**

Run `pnpm typecheck && pnpm vitest run tests/parser.test.ts tests/normalize.test.ts`. Expected: pass.

```bash
git add src/parser.ts src/normalize.ts tests/parser.test.ts tests/normalize.test.ts tests/fixtures/leads.json
git commit -m "feat: stream and normalize tabular leads"
```

### Task 4: Website-compatible filters

**Files:** Create `src/filters.ts`, `tests/filters.test.ts`.

**Interfaces:** Produces `compileFilters(options: FilterOptions): (lead: Lead) => boolean` and filter metadata for `linkedin filters`.

- [ ] **Step 1: Write table-driven failing tests**

Cover accent and punctuation normalization, exact word boundaries, one-character and two-character words, long-word prefixes, phrases, OR within include lists, AND across categories, exclude precedence, comma-bearing industries, technology lists, exact department behavior, employee ranges, revenue bounds, state, city, required fields, and optional status.

```ts
const matches = compileFilters({ titleInclude: ['chief'], required: ['email'], industryInclude: ['Leisure, Travel & Tourism'] })
expect(matches(makeLead({ title: 'Chief Revenue Officer', email: 'a@example.test', industry: 'Leisure, Travel & Tourism' }))).toBe(true)
expect(matches(makeLead({ title: 'Chief Revenue Officer', email: '', industry: 'Leisure, Travel & Tourism' }))).toBe(false)
```

- [ ] **Step 2: Run tests and confirm failure**

Run `pnpm vitest run tests/filters.test.ts`. Expected: missing implementation.

- [ ] **Step 3: Implement the minimum predicate compiler**

Normalize once per configured value. Use OR inside each include category, reject on any exclude match, then AND the category results. Split technologies on commas; compare department as one lower-cased field because the final website pipeline does so.

- [ ] **Step 4: Verify and commit**

Run `pnpm typecheck && pnpm vitest run tests/filters.test.ts`. Expected: pass.

```bash
git add src/filters.ts tests/filters.test.ts
git commit -m "feat: add LinkedIn lead filters"
```

### Task 5: Output writers and client orchestration

**Files:** Create `src/output.ts`, `src/client.ts`, `src/index.ts`, `tests/output.test.ts`, `tests/client.test.ts`.

**Interfaces:** Produces `createOutput(options)`, `LeadsCmClient.search(options)`, and public package exports.

- [ ] **Step 1: Write failing output tests**

Assert one JSON object per NDJSON line, RFC 4180 quoting, stable field projection, website-compatible default order, backpressure drain, limit handling, atomic rename on success, and temporary-file cleanup on failure.

- [ ] **Step 2: Write failing client tests**

Use a fake transport to prove sequential requests, default file 1, five-file datasets, 404 rules, `--all`, max files, early limit abort, aggregate counts, and partial-output classification after the first emitted lead.

```ts
const result = await client.search({ country: 'Eritrea', selection: { kind: 'all', startFile: 1, maxFiles: 3 }, filters: {}, output })
expect(requestedUrls.map(String)).toEqual([expect.stringContaining('/1.json'), expect.stringContaining('/2.json'), expect.stringContaining('/3.json')])
expect(result.filesCompleted).toBe(2)
```

- [ ] **Step 3: Run tests and confirm failure**

Run `pnpm vitest run tests/output.test.ts tests/client.test.ts`. Expected: missing modules.

- [ ] **Step 4: Implement writers and client**

Writers expose `write(lead): void`, `flush(): Promise<void>`, `commit(): Promise<void>`, and `abort(): Promise<void>`. The client fetches one file at a time, parses rows, normalizes, filters, projects, writes, and flushes after each input chunk. Abort the active fetch as soon as the output limit is reached.

- [ ] **Step 5: Export the library and commit**

Export `LeadsCmClient`, option and result types, catalog helpers, filter metadata, and operational errors from `src/index.ts`. Run the focused tests and typecheck.

```bash
git add src/output.ts src/client.ts src/index.ts tests/output.test.ts tests/client.test.ts
git commit -m "feat: orchestrate streaming lead searches"
```

### Task 6: CLI commands and agent-facing behavior

**Files:** Create `src/cli.ts`, `tests/cli.test.ts`.

**Interfaces:** Consumes the public client. Produces the `leads-cm` executable and stable exit behavior.

- [ ] **Step 1: Write subprocess tests**

Test `--help`, `setup`, `countries`, `countries --json`, `linkedin filters --json`, missing country, mutually exclusive selection flags, repeatable filters, dry run, fields, CSV output, all five exit-code classes, clean stdout, and progress-only stderr. Prove an unknown country works only with explicit `--file` and fails with `--all`. Use the local HTTP server, never the live endpoint.

- [ ] **Step 2: Run tests and confirm failure**

Run `pnpm build && pnpm vitest run tests/cli.test.ts`. Expected: missing CLI entry.

- [ ] **Step 3: Implement commands with goke and Zod**

Start `src/cli.ts` with `#!/usr/bin/env node`. Mirror the command hierarchy and exact option names from the spec, and call goke's completion installer. Split commas only for `--require` and `--fields`; all filter options remain repeatable strings. Map typed errors to their declared exit codes and print no stack trace for expected operational errors.

- [ ] **Step 4: Verify and commit**

Run `pnpm build && pnpm typecheck && pnpm vitest run tests/cli.test.ts`. Expected: pass.

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: add leads-cm command interface"
```

### Task 7: Scale, live contract, packaging, docs, and CI

**Files:** Create `scripts/large-stream.ts`, `scripts/live-contract.ts`, `scripts/package-smoke.ts`, `.github/workflows/ci.yml`, `README.md`, `tests/ui-parity.md`; modify `package.json`.

**Interfaces:** Produces the release evidence required by the spec.

- [ ] **Step 1: Add the large-stream test**

Generate 100,000 invented rows from a local HTTP server as it writes. Spawn `node --max-old-space-size=128 dist/cli.js`, filter to a known 1,000-row result, discard stdout, and assert exit 0 plus the exact count reported on stderr.

- [ ] **Step 2: Add the live aggregate contract**

`scripts/live-contract.ts` must request the authorized small-country files, parse them through the production client, and print only status, headers, row counts, type counts, and the final 404. It must fail on any schema drift and must never print a lead value.

- [ ] **Step 3: Add package and platform checks**

Pack with `pnpm pack`, install the tarball into a temporary directory, run `leads-cm --help`, import the library from ESM, and assert both succeed. CI runs build, typecheck, deterministic tests, large-stream, pack, and smoke install on Linux, macOS, and Windows with Node 22 and Node 24.

- [ ] **Step 4: Write user documentation**

Document install, setup, all commands and flags, jq examples, CSV output, dataset costs, exit codes, authorization responsibility, PII handling, and the fact that email verification is out of scope. Do not describe the endpoint as a public API.

- [ ] **Step 5: Run deterministic release checks**

Run `pnpm build && pnpm typecheck && pnpm test && pnpm test:large && pnpm test:package`. Expected: every command passes with zero skipped tests.

- [ ] **Step 6: Run authorized live and UI parity checks**

Run `pnpm test:live`. Then use the logged-in leads.cm UI to fill `tests/ui-parity.md` with dataset identifiers, filter inputs, UI count, CLI count, and pass or fail for country, title, keyword, industry, technology, company size, revenue, location, and required fields. Do not record contact values.

- [ ] **Step 7: Final package audit and commit**

Run `pnpm pack --dry-run`, confirm the tarball contains `dist`, README, license, package metadata, and no tests, fixtures, live outputs, or temporary files.

```bash
git add package.json scripts .github/workflows/ci.yml README.md tests/ui-parity.md
git commit -m "docs: add release verification and usage guide"
```

## Final verification

- [ ] Run `git status --short` and confirm only intentional changes exist.
- [ ] Run the full deterministic and live command set again after the last commit.
- [ ] Compare `tests/ui-parity.md` with the spec filter list and confirm every row passes.
- [ ] Record exact command output in the delivery report. Never summarize a skipped command as passing.
- [ ] Ask for action-time approval of the npm version and publication. Only after approval, run `pnpm publish --access public` and verify the published version with `npm view leads-cm-cli version`.
