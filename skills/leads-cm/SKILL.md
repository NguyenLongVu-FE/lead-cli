---
name: leads-cm
description: Use when a user asks to search, filter, inspect, copy, locally exclude, blacklist-check, or export authorized leads.cm LinkedIn Leads without opening the web app.
---

# leads-cm

Use the deterministic `leads-cm` CLI. Do not open or automate the leads.cm website.

## Required workflow

1. Run `leads-cm --help`, then `--help` for the chosen subcommand.
2. Translate the request only into flags shown by that help. Never guess commands, flags, fields, or values.
3. Before `--all` or `linkedin export datasets`, run the same selection with `--dry-run`.
4. Send PII only to stdout or an explicit user-approved output path. Keep narration and logs aggregate-only.
5. Report actual result counts and exit status. Never repeat lead values in narration.

## Semantics

- `linkedin verify` and `--exclude-blacklist` only remove emails found in the selected country's blacklist. They do not test mailbox deliverability or update leads.cm.
- A request to “delete” or remove a lead means adding repeatable `--exclude-ref <sourceRef>` for that command. Nothing is deleted remotely or persisted.
- `linkedin lead view <sourceRef>` reads the exact source row.
- A full filtered stream uses `linkedin search --country <country> --all`. `linkedin export datasets` instead requires an explicit dataset range and produces split CSV files; never add `--all` to it.
- `--status Valid` filters the source's existing status label only. It is not proof of mailbox deliverability.
- stdout is lead data; stderr is progress, warnings, and errors.
- Exit code `5` means the upstream data or blacklist schema was invalid. Surface it; do not silently retry or invent results.

## Command map

- Search, filtering, pagination, local exclusion: `leads-cm linkedin search --help`
- Country blacklist-only filtering: `leads-cm linkedin verify --help`
- Exact row lookup: `leads-cm linkedin lead view --help`
- Split dataset export: `leads-cm linkedin export datasets --help`
- Available filter values: `leads-cm linkedin filters --json`

## Clipboard recipes

First run the relevant help command. Then pipe TSV data without narrating it:

- macOS: `leads-cm linkedin search ... --format tsv | pbcopy`
- Windows PowerShell: `leads-cm linkedin search ... --format tsv | Set-Clipboard`
- Linux: `leads-cm linkedin search ... --format tsv | xclip -selection clipboard`

Example for France, revenue band 1–10M, page 3:

```powershell
leads-cm linkedin search --country France --revenue-band 1-10M --page 3 --page-size 50 --format tsv | Set-Clipboard
```

Example full filtered TSV export, always preceded by the same command with `--dry-run`:

```sh
leads-cm linkedin search --country "United States" --all --status Valid --format tsv --output /approved/path/us.tsv
```
