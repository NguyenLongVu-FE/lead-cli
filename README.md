# leads-cm-cli

`leads-cm` is a headless command-line client for searching LinkedIn data you are authorized to access through leads.cm. It is not a public API client and does not make technical access equivalent to permission. You are responsible for confirming your authorization and for handling any personal data lawfully.

## Install and setup

Requires Node.js 22 or later.

```sh
npm install --global leads-cm-cli
leads-cm setup
```

`setup` makes a small request to confirm that the expected JSON format is reachable. It prints no lead values. If the access policy has changed, upgrade the package or contact leads.cm; do not attempt to bypass an access control.

### macOS Apple Silicon

The standalone macOS package does not require Node.js. Extract it, move the executable onto your `PATH`, then run setup:

```sh
tar -xzf leads-cm-0.1.0-macos-arm64.tar.gz
sudo install -m 755 leads-cm /usr/local/bin/leads-cm
leads-cm setup
```

The archive also contains `skills/leads-cm/SKILL.md`. Install it for a supported agent from the extracted directory with the vendor-neutral [skills CLI](https://skills.sh/):

```sh
npx -y skills add . --skill leads-cm --copy -y
```

The release includes a SHA-256 checksum. This local build is ad-hoc signed, not notarized with an Apple Developer ID. If macOS quarantines a downloaded copy, the distributor must sign and notarize the release before broad public distribution.

## Commands

```text
leads-cm setup
leads-cm countries [--json]
leads-cm linkedin filters [--json]
leads-cm linkedin search --country <country> [options]
leads-cm linkedin verify --country <country> [options]
leads-cm linkedin lead view <source-ref> [--format json|text]
leads-cm linkedin export datasets --country <country> [options]
```

`countries` lists the bundled country snapshot. Use `--json` for stable script output. `linkedin filters --json` lists valid company-size labels, required fields, output fields, and source status values.

`linkedin search` writes NDJSON to standard output by default; progress and errors go to standard error. Each line can be processed independently:

```sh
leads-cm linkedin search --country Eritrea --file 1 --title-include Founder \
  | jq -c '{name, title, company, linkedin}'
```

Use `--format csv` for RFC 4180 CSV, `--format tsv` for spreadsheet/clipboard output, and `--fields` to select and order columns. Full output includes `sourceRef`, a stable URI-encoded `<country-slug>:<file>:<row>` reference. `--output report.csv` writes to a temporary sibling file and renames it only after the requested search succeeds.

```sh
leads-cm linkedin search --country Eritrea --file 1 --format csv \
  --fields name,title,company,linkedin --output founders.csv
```

### Selection flags

Exactly one selection mode is allowed. For a catalogued country, no selection flag uses `--file 1`; an unknown country always requires an explicit `--file`.

- `--file <n>` fetches one numbered file.
- `--dataset <n>` fetches one website dataset. `--dataset-size 5` is the default and `--dataset-size 2` selects the alternate two-file grouping; a partial final dataset ends at its first 404 after a successful file.
- `--all` fetches files in order until the first 404. Before its first request, it prints a PII-free catalog estimate to standard error. Use `--start-file <n>` and `--max-files <n>` to bound it.
- `--dry-run` prints the resolved country, planned URLs, filters, and output configuration without downloading lead data.

Files can be large (roughly 75–80 MB in observed large countries). A dataset is up to five files; start with `--file`, then use `--dataset`, `--max-files`, or `--limit` deliberately to control network, time, and data-handling cost.

Pagination is applied after filters, blacklist filtering, and local exclusions:

```sh
leads-cm linkedin search --country France --revenue-band 1-10M \
  --page 3 --page-size 50 --format tsv | pbcopy
```

For Windows PowerShell, replace `pbcopy` with `Set-Clipboard`; on Linux, use `xclip -selection clipboard`.

### Filter and output flags

All include/exclude flags are repeatable. Repeated values within a category are ORed; different categories are ANDed. Values are not split on commas except `--require` and `--fields`, whose field names are comma-separated.

- Titles: `--title-include`, `--title-exclude`, `--title-include-exact`, `--title-exclude-exact`
- Keywords: `--keyword-include`, `--keyword-exclude`, `--keyword-include-exact`, `--keyword-exclude-exact`
- Company metadata: `--industry-include`, `--industry-exclude`, `--management-include`, `--management-exclude`, `--department-include`, `--department-exclude`, `--technology-include`, `--technology-exclude`, `--company-size`
- Geography and revenue: `--state`, `--city`, `--revenue-min <usd>`, `--revenue-max <usd>`, or an inclusive website band via `--revenue-band <band>`
- Presence and source status: `--require <email,linkedin>`, `--status <value>` (current audited source values: `Valid`, `Good`, `Risky`, `Invalid`)
- Output controls: `--format <ndjson|csv|tsv>`, `--fields <field,...>`, `--output <path>`, `--limit <n>`
- Local exclusion: repeat `--exclude-ref <sourceRef>` to omit exact rows from that command. This does not delete or update leads.cm.
- Blacklist filtering: `--exclude-blacklist`, or the equivalent `linkedin verify` command, removes emails found in that country's published blacklist.

For example:

```sh
leads-cm linkedin search --country "United States" --dataset 1 \
  --title-include CEO --title-include Founder \
  --industry-include "Computer Software" --technology-include HubSpot \
  --require email,linkedin --limit 100 | jq -c '.email // empty'
```

Do not redirect personally identifiable information into logs, issue trackers, or committed fixtures. The CLI does not cache raw or filtered contacts, and its progress output deliberately excludes contact values.

### Lookup, blacklist-only verification, and exports

```sh
leads-cm linkedin lead view 'France:1:8' --format json
leads-cm linkedin verify --country France --dataset 1 --format tsv --output verified.tsv
leads-cm linkedin export datasets --country France --start-dataset 1 --end-dataset 3 \
  --output-dir ./france-datasets --dry-run
```

`linkedin verify` is deliberately named after the screen action, but its guarantee is narrower: it only checks the country blacklist. It does not contact a mailbox, establish deliverability, or mutate a remote status. If a country blacklist is unavailable, the CLI warns and reports zero checked rows instead of claiming success.

`linkedin export datasets` writes each requested dataset to a separate atomic CSV file. Run it with `--dry-run` first. Pressing Ctrl-C cancels network work, removes the active temporary file, and exits with code 130; already completed dataset files remain valid.

## Agent Skill

The repository ships a vendor-neutral Agent Skill at `skills/leads-cm/SKILL.md`, modeled after CLI-first agent tools: the agent discovers commands from `--help`, dry-runs bulk work, keeps PII out of narration, and never opens the web app.

From a clone:

```sh
npx -y skills add . --skill leads-cm --copy -y
```

After this repository has a public remote, users can replace `.` with its Git URL. The skill works with agents supported by the skills CLI; it is not Codex-only.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Invalid command or option |
| 2 | Setup or access failure |
| 3 | Network failure before output |
| 4 | Partial output was written before failure |
| 5 | Response schema or parse failure |

Mailbox verification remains out of scope. Website-equivalent country blacklist filtering is supported. Shell completion is unsupported.

## Library

The package root exports the TypeScript client, transport, output helpers, country catalog, planner, filters, and typed errors for applications that need the same streaming behavior as the CLI.

## Development and release checks

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:large
pnpm test:package
pnpm test:skill-install
pnpm package:macos
pnpm test:package:macos
LEADS_CM_LIVE_CONTRACT=1 pnpm test:live
```

The live contract is intentionally opt-in. When enabled it performs bounded requests against authorized small-country files and the country-blacklist contract, uses production parsing, and prints only statuses, headers, row counts, and value-type aggregates. It never prints lead values. The live suite is excluded by default; that exclusion is not a passing live verification.

Passing tests demonstrate compatibility with the audited contracts and fixtures at that release. No client can promise permanent 100% operation if a third-party endpoint, schema, access policy, or website behavior changes; live contract checks are the release gate for detecting that drift.
