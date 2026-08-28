# UI parity release audit

Run this audit only in an authorized, logged-in leads.cm browser session. Record dataset identifiers, filter inputs, and aggregate counts only—never a contact value. A release is not UI-parity verified until every row below is filled and marked **Pass**.

Audit notes:

- UI counts use the actual `.leads-estimation` dataset count, not the marketing estimate in `.leads-found`.
- The Eritrea country count was derived from 13 full 50-row pages plus 32 rows on page 14.
- The Apache technology UI suggestion also emitted related Apache coyote tags; the aggregate count remained the same as the CLI Apache filter.

| Filter | Dataset identifier | Filter input | UI count | CLI count | Result |
| --- | --- | --- | ---: | ---: | --- |
| Country | Eritrea, all catalog files (1–2) | No filters | 682 | 682 | Pass |
| Title | Eritrea, all catalog files (1–2) | Title include `Owner` | 7 | 7 | Pass |
| Keyword | Eritrea, all catalog files (1–2) | Keyword include `mining` | 171 | 171 | Pass |
| Industry | Eritrea, all catalog files (1–2) | Industry include `Mining & metals` | 164 | 164 | Pass |
| Technology | Eritrea, all catalog files (1–2) | UI suggestion `Apache`; CLI `--technology-include Apache` | 359 | 359 | Pass |
| Company size | Eritrea, all catalog files (1–2) | `Established Company` | 169 | 169 | Pass |
| Revenue | Eritrea, all catalog files (1–2) | UI 1–10M; CLI `--revenue-min 1000000 --revenue-max 10000000` | 31 | 31 | Pass |
| Location | United States, dataset 1 (files 1–5; 250,000 rows) | City `New York` | 15070 | 15070 | Pass |
| Required fields | Eritrea, all catalog files (1–2) | Required field `email` | 353 | 353 | Pass |

## Screen-outcome controls

These controls do not all have a meaningful independent UI count. They are verified by matching the screen's resulting row window or export outcome without recording contact values.

| Screen outcome | Audit input | UI/result evidence | CLI evidence | Result |
| --- | --- | --- | --- | --- |
| Inclusive revenue band | Eritrea, UI 1–10M | 31 result rows | `--revenue-band 1-10M` returned 31 | Pass |
| Page window | Eritrea, page 3, 50 rows | UI displayed a full 50-row page | CLI emitted 50 rows after filtering | Pass |
| Stable row lookup | One authorized result row | UI row and CLI lookup represented the same source row | `linkedin lead view <sourceRef>` returned exactly one row | Pass |
| Command-local removal | Repeat one selected row without recording its values | UI list outcome represented with the selected row omitted | Repeating `--exclude-ref` omitted only that row and did not mutate upstream data | Pass |
| Email-status action | Eritrea country blacklist | UI action used the country blacklist endpoint | `linkedin verify` reported blacklist-only checked/excluded aggregates | Pass |
| Export | Bounded Eritrea dataset range | UI export row count matched the loaded result set | Atomic split CSV files contained the same aggregate row count | Pass |
| Cancellation | Interrupt an in-progress bounded export | No incomplete export should be presented as complete | CLI exited 130, removed the active temporary file, and retained completed atomic files | Pass |
