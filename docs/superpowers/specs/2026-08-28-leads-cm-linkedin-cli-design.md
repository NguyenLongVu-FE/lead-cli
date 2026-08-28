# leads.cm LinkedIn CLI design

Date: 2026-08-28

Status: approved in chat

## Goal

Build a public, cross-platform npm package that lets a person or coding agent search the leads.cm LinkedIn dataset without opening or controlling the leads.cm website.

The npm package will be named `leads-cm-cli`. Its executable will be `leads-cm`. Both names were available on npm when this design was written. Availability is not ownership until the package is published.

The CLI will be deterministic. A user may describe a search to Codex or another agent, but the agent must translate that request into documented flags. The CLI will not call an LLM.

## Evidence and constraints

The LinkedIn page loads tabular JSON files from URLs shaped like `https://vorbidden.com/<country>/<file>.json`. Each response contains a `headers` array and a `rows` array. The browser maps each row to the headers and applies every filter locally.

Live probes on 2026-08-28 established these facts:

- A request without the leads.cm referrer returned HTTP 403.
- The same request with `Referer: https://app.leads.cm/linkedin/` returned JSON without browser cookies.
- `Eritrea/1.json` contained 644 rows and 30 columns.
- Large country files were about 75 to 80 MB each and held up to about 50,000 rows.
- Country pagination ended with HTTP 404. Eritrea had files 1 and 2; file 3 returned 404.
- The United States data had one additional `status` column.
- The website's "Verify Emails" action did not test mailboxes. It removed addresses found in a country blacklist file.

The user confirmed that they have permission from leads.cm to automate access. The CLI documentation must still tell users that they are responsible for their authorization and handling of personal data. The package will not claim that technical access grants permission. See the [leads.cm Terms of Service](https://www.leads.cm/terms-of-service/) and [Privacy Policy](https://www.leads.cm/privacy-policy/).

## Scope

Version 1 includes:

- Headless HTTP access. No Chrome, Playwriter, cookies, account token, or website control.
- Country discovery from a bundled catalog.
- LinkedIn lead search with the filters listed below.
- Single-file, dataset, and all-file traversal.
- NDJSON output by default and streaming CSV output on request.
- A small TypeScript library used by the CLI and available through the package root export.
- A setup probe, stable exit codes, shell completions, and agent-readable help.
- An MIT license, matching the reference CLI.

Version 1 does not include:

- A natural-language `ask` command.
- Instagram leads or technology lookup.
- Browser fallback.
- Blacklist-based email filtering or any claim of live email verification.
- Contact deletion, list persistence, CRM integrations, or a local database.
- Background jobs, a daemon, or parallel country searches.

## Command design

The top-level commands are:

```text
leads-cm setup
leads-cm countries
leads-cm linkedin filters
leads-cm linkedin search [options]
```

`setup` sends a small range request to a known dataset and checks the status, content type, and JSON header prefix. It does not print lead values.

`countries` reads the bundled catalog. Human-readable text is the default. `--json` returns stable JSON for agents and scripts.

`linkedin filters` prints valid company-size labels, mandatory fields, output fields, and status values. `--json` returns the same information as structured JSON.

`linkedin search` requires `--country`. It accepts exactly one selection mode:

- No selection flag fetches file 1.
- `--file <n>` fetches one numbered file.
- `--dataset <n>` fetches the five files used by that website dataset. The final dataset may contain fewer files.
- `--all` fetches files in order until the first 404.
- `--max-files <n>` caps `--all` without changing its start point.
- `--start-file <n>` changes the first file for `--all`.

`--dry-run` prints the resolved country, URLs, file limits, filters, and output mode without downloading contact data. It never prints request headers that may later contain secrets.

Example:

```bash
leads-cm linkedin search \
  --country "United States" \
  --title-include "CEO" \
  --title-include "Founder" \
  --industry-include "Computer Software" \
  --technology-include "HubSpot" \
  --require "email,linkedin" \
  --dataset 1 \
  | jq .
```

## Filter behavior

The CLI supports these filters:

- Job title and keyword include or exclude, with optional exact matching.
- Industry include or exclude.
- Management level include or exclude.
- Department include or exclude.
- Technology include or exclude.
- Company-size labels.
- Minimum and maximum revenue in US dollars.
- State and city.
- Required fields such as email, phone, LinkedIn, website, or company phone.
- Email status when the source file contains that field.

All include and exclude flags are repeatable. Values are not split on commas because valid industries and phrases may contain commas. Exact title and keyword matching use separate `--title-include-exact`, `--title-exclude-exact`, `--keyword-include-exact`, and `--keyword-exclude-exact` flags. Company size uses repeatable `--company-size`; revenue uses `--revenue-min` and `--revenue-max`; location uses repeatable `--state` and `--city`; status uses repeatable `--status`. `--require` and `--fields` accept either repeated flags or comma-separated field names because field names cannot contain commas.

Repeated values inside one include category use OR. Different filter categories use AND. Any matching exclude value rejects the row.

Text matching follows the website's final `applyAllFilters` behavior. It normalizes case and accents. Exact terms use word boundaries. Phrases use substring matching. Short terms of one or two characters use word matching. Longer single words use prefix matching.

The website contains helper functions that disagree with its final filter pipeline. Department matching is one example. The CLI will follow the observed UI result and the final pipeline, not merge conflicting helper behavior. UI parity tests decide the contract when source helpers disagree.

Company size is derived from the numeric employee field using the website ranges:

```text
1               Solo Entrepreneur
2-10            Small Team
11-20           Growing Startup
21-50           Emerging Business
51-100          Small Enterprise
101-200         Medium Enterprise
201-500         Established Company
501-1000        Large Company
1001-2000       Major Enterprise
2001-5000       Leading Organization
5001-10000      Corporate Giant
10001 and above Global Corporation
```

The source revenue value is expressed in thousands of US dollars. The CLI preserves it as `revenue` and adds numeric `revenueUsd`. It preserves numeric `employees` and adds the derived `companysize` label. URL fields receive the same LinkedIn, company LinkedIn, Facebook, X, and website prefixes used by the website export.

## Architecture

The project will use TypeScript ESM on Node.js 22 or newer. The CLI and library share one implementation.

```text
CLI and Zod validation
        |
Country catalog and file planner
        |
HTTP transport
        |
Streaming tabular JSON parser
        |
Normalization and filter predicate
        |
Field projection
        |
NDJSON or CSV writer
```

Proposed source files:

```text
src/cli.ts
src/index.ts
src/client.ts
src/catalog.ts
src/planner.ts
src/transport.ts
src/parser.ts
src/normalize.ts
src/filters.ts
src/output.ts
src/errors.ts
src/types.ts
src/data/countries.json
```

The HTTP transport is an interface because tests need to replace it with a local server or fixture transport. Version 1 has one production implementation.

The parser will use `@streamparser/json` with paths for `headers` and individual `rows` values and `keepStack: false`. This setting matters. Keeping the parser stack would retain emitted rows and defeat bounded-memory processing. The library has TypeScript declarations and accepts UTF-8 chunks from a Node or WHATWG stream. See the [upstream parser documentation](https://github.com/juanjoDiaz/streamparser-json).

The parser obtains and validates `headers` before accepting rows. It maps only the current row, runs normalization and filters, writes a matching result, then releases that row.

The CLI processes one source file at a time. Version 1 does not expose concurrency because an 80 MB file already keeps the network and parser busy, and higher concurrency would increase load on leads.cm infrastructure.

## Country catalog

`src/data/countries.json` contains the country name, URL slug, displayed lead estimate, and observed file count. The catalog is a release-time snapshot derived from the leads.cm LinkedIn page.

Runtime status is authoritative:

- A requested file that returns 200 is parsed.
- A 404 ends `--all`.
- During `--dataset`, a 404 ends a partial final dataset only after at least one file in that dataset returned 200. A 404 on its first file is an error.
- A 404 for an explicit `--file` is an error.
- A non-404 failure never masquerades as the end of pagination.

The catalog is not refreshed automatically in version 1 because the app page rejects ordinary HTTP clients and the CLI must not require a browser. A new package release can update it. Users may still search a country slug not present in the catalog with an explicit `--file`; `--all` requires a catalog entry so the CLI can display a meaningful safety estimate before it starts.

## Output rules

NDJSON is the default. Each stdout line is one valid JSON object. Progress, file numbers, retries, counts, and warnings go to stderr.

`--format csv` writes RFC 4180 compatible CSV. `--fields` selects and orders columns. Without `--fields`, the CLI uses the website's export order while retaining the derived `revenueUsd` and `companysize` fields.

`--output <path>` writes to a temporary sibling file and renames it only after every requested file succeeds. A failed run does not leave a file that looks complete. Stdout cannot be rolled back, so a failure after output begins prints `partial output` to stderr and returns the partial-output exit code.

`--limit <n>` stops after writing `n` matching leads. It aborts the current response stream and does not fetch later files.

The CLI does not cache raw or filtered contact data. It never logs contact values, emails, phones, cookies, or request credentials to stderr.

## HTTP and error policy

Every data request sets the leads.cm LinkedIn referrer, an explicit accept header, a package user agent, and a configurable timeout.

The transport retries HTTP 408, 429, and 5xx responses at most three times. It honors `Retry-After`; otherwise it uses capped exponential backoff with jitter. It does not retry 401, 403, 404, schema errors, or validation errors.

Stable exit codes are:

```text
0 success
1 invalid command or option
2 setup or access failure
3 network failure before output
4 partial output
5 response schema or parse failure
```

A 403 tells the user that the endpoint access policy may have changed and recommends upgrading the package. The message does not suggest bypassing a new security control.

## Testing

The deterministic suite covers:

- Country resolution, URL construction, file and dataset planning.
- Every filter, normalization rule, and include or exclude combination.
- Parser input split at arbitrary byte boundaries.
- Unicode, nulls, empty fields, extra columns, missing columns, malformed JSON, and truncated responses.
- NDJSON validity and CSV quoting.
- CLI help, validation, exit codes, stdout and stderr separation, dry run, limits, and field projection.
- HTTP 200, 403, 404, 408, 429 with `Retry-After`, 5xx, timeout, and interrupted bodies through a local server.
- Atomic output success and cleanup after failure.

Fixtures committed to Git contain invented people and companies. No live PII enters snapshots or test fixtures.

The large-stream test uses a local server that generates at least 100,000 rows without building the response in memory. It launches the CLI with a restricted Node heap. The test must finish without an out-of-memory error and produce the expected match count.

The live contract suite downloads a small real dataset. It checks status, schema, column types, pagination, and aggregate counts only. It does not print or snapshot contact values.

Before release, a browser audit compares CLI counts with the logged-in leads.cm UI for country, title, keyword, industry, technology, company size, revenue, location, and required-field filters. This audit resolves any ambiguity in the page source. Browser use belongs to release verification and is not a CLI runtime dependency.

CI runs build, typecheck, deterministic tests, the large-stream test, package packing, and install smoke tests on Linux, macOS, and Windows. Live tests and the UI audit run in the authorized release environment.

No completion claim may hide a skipped suite. Release evidence must show:

```text
build pass
typecheck pass
unit pass
integration pass
large-stream pass
live contract pass
UI parity matrix pass
npm package smoke-install pass
0 skipped tests
```

This proves the current release against the current leads.cm behavior. It cannot promise that an undocumented third-party endpoint will never change.

## References

- [remorses/subito-cli](https://github.com/remorses/subito-cli)
- [leads.cm Terms of Service](https://www.leads.cm/terms-of-service/)
- [leads.cm Privacy Policy](https://www.leads.cm/privacy-policy/)
- [`@streamparser/json`](https://github.com/juanjoDiaz/streamparser-json)
