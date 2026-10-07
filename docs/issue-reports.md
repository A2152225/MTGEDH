# Player issue reports ("Report Issue")

Players can right-click any card (battlefield, hand, graveyard, exile, library/commander zone menus, graveyard and
exile view modals, and stack items) and choose **Report Issue**. A modal asks for a required description (max 2000
characters) and an optional category (Rules / Wrong outcome, Missing effect, UI problem, Crash / Error, Other).
The report is stored on the server for later review. Nothing is shown to other players.

## Where it is stored

- Separate SQLite file (not the game database): **`server/data/issue-reports.sqlite`** (gitignored through `/server/data/`).
- Override with `ISSUE_REPORTS_SQLITE_FILE` (absolute path, path relative to the server's working directory, or `:memory:`).
- The file and the `issue_reports` table are created automatically the first time a report is stored or the CLI runs
  (`CREATE TABLE IF NOT EXISTS` plus additive `ALTER TABLE` for columns added in later versions). No manual migration.

### Table `issue_reports`

| column | notes |
| --- | --- |
| `id` | integer, autoincrement |
| `created_at` | ISO-8601 UTC |
| `created_at_local` | ISO-8601 with the server's local offset |
| `player_id`, `player_name` | reporter |
| `game_id` | |
| `card_id`, `permanent_id` | card id and (battlefield) permanent id |
| `card_name`, `card_oracle_id`, `card_scryfall_id` | oracle/scryfall ids when the card data has them |
| `card_type_line`, `card_oracle_text` | as the server sees the card (current text) |
| `card_zone` | battlefield / hand / graveyard / exile / library / commander / stack |
| `card_controller`, `card_owner` | |
| `card_state` | JSON: tapped, counters, attachments/attachedTo, current + base power/toughness, damage, loyalty, modifiers, temporary effects, granted abilities, timestamp |
| `game_context` | JSON: turn, phase, step, active player, priority holder, stack summary, battlefield count, last ~20 log lines the reporter saw |
| `category` | `rules_wrong_outcome`, `missing_effect`, `ui_problem`, `crash_error`, `other` (nullable) |
| `description` | the player's text (sanitized, control characters removed) |
| `client_version` | server git commit (short) when it can be determined |
| `resolved_at` | NULL until resolved (ISO-8601 UTC) |
| `resolved_by`, `resolution_notes` | nullable |

## Reviewing and resolving (CLI)

### Quick commands (repository root)

```
npm run issues              # every report (open + closed), with full details
npm run issues open         # only open reports
npm run issues closed       # only resolved reports ("resolved" also works)
npm run issues -- closed    # identical - the extra "--" is optional for plain words (same for open / all)
```

Each report is printed as a block: id and local time, status, player, game id, card name/zone/type line, category,
description, resolved_at / resolved_by / notes, a one-line **card state** (P/T vs base, damage, tapped, counters,
attachments, combat role) and **game state** (turn, phase/step, active player, priority, stack, permanent count) and
the **last 5 log lines**. `issues show <id>` still prints everything (full JSON).

**PowerShell 5 / npm argument rules (tested):**

- Plain words (`open`, `closed`, `all`, `show 12`, `resolve 12`, `reopen 12`, `path`) pass through with or without `--`:
  `npm run issues open` and `npm run issues -- open` behave the same.
- Anything starting with `--` (`--note`, `--by`, `--all`, `--resolved`, `--csv`, `--out`) **must come after `--`**, otherwise npm
  treats it as its own config flag and silently drops it (you only get an "npm warn Unknown cli config" message):
  `npm run issues -- resolve 12 --note "Fixed in abc1234" --by "Robert"` (not `npm run issues resolve 12 --note ...`).
- Quote values with spaces in double quotes. Do not use `&&` in PowerShell 5; run commands one per line or separate with `;`.

### Full command list

The long workspace form keeps working exactly as before:

```
npm --workspace @mtgedh/server run issues -- list              # open reports (default)
npm --workspace @mtgedh/server run issues -- list --all        # or --resolved
npm --workspace @mtgedh/server run issues -- show 12           # everything about #12
npm --workspace @mtgedh/server run issues -- resolve 12 --note "Fixed in abc1234"   # optional: --by "name"
npm --workspace @mtgedh/server run issues -- reopen 12
npm --workspace @mtgedh/server run issues -- export --csv --out issues.csv   # or omit --out for stdout; --open/--resolved/--all
npm --workspace @mtgedh/server run issues -- path              # where the database file is
```

CSV export prefixes cells that start with `=`, `+`, `-`, `@` with `'` so player text cannot run as a spreadsheet formula.
There is intentionally **no HTTP endpoint** for reading reports.

## Finding and fixing a report

1. **Find open reports.** From the repository root: `npm run issues open`. Each block has the id, card, category, description, card state, and the last few log lines.
2. **Read the one you are fixing.** `npm run issues -- show <id>` prints the stored oracle text, full card state, and game context (turn, phase, stack, recent log). Treat that snapshot as the bug report. Look up current oracle text from `oracle-cards.jsonl` or `mtg_data.db` before changing card behavior; the snapshot can be stale.
3. **Fix the behavior, not the card name.** Route the effect through Oracle IR (parse the clause, apply the step, resume from the queue). Add a test that asserts the outcome (zones, choices, types, payment), with the live IR flags the rest of the card tests use. Do not add a `cardName === '...'` handler or a one-card `KNOWN_*` row.
4. **Resolve it in the database** in the same turn, after the targeted tests pass:

```
npm run issues -- resolve <id> --note "What changed and why, in one or two sentences."
npm run issues -- show <id>
```

The note is stored as `resolution_notes`. The CLI sets `resolved_at` and `resolved_by`. Pass `--by` only when someone named the resolver. Confirm the show output says `RESOLVED` and includes the note.

Resolve only the reports this change actually fixes. Leave a report open when the fix is incomplete or the tests failed. Do not edit `issue-reports.sqlite` by hand. `npm run issues -- reopen <id>` clears a resolution.

## Safety and privacy

- Socket event `reportIssue` (payload `IssueReportRequest`, optional ack `IssueReportResult`) requires the socket to be
  in the game's room; spectators may report too.
- Per-player limit: 10 reports per rolling minute (in memory). Description max 2000 characters, card name 200, log lines
  20 x 300, control/bidi characters stripped.
- Only what the reporter may see is stored: battlefield/stack/graveyard/exile are public; hand, library and command-zone
  cards are captured **only for the reporting player's own cards**; an opponent's hidden-zone card (or face-down card) is
  stored by the name the client sent and nothing else.

## Code map

- `shared/src/issueReport.ts` request/limits/validation (shared by client and server)
- `server/src/socket/issueReport.ts` handler; `issueReportSnapshot.ts` privacy-safe snapshot; `issueReportRateLimit.ts`
- `server/src/db/issueReports.ts` database; `issueReportsCli.ts` + `server/scripts/issues.ts` CLI
- `client/src/components/ReportIssueMenuItem.tsx`, `ReportIssueModal.tsx`, `ReportIssueHost.tsx` (mounted in `main.tsx`);
  `client/src/utils/reportIssueStore.ts`, `issueReportClient.ts`
- Tests: `server/tests/issue-report.integration.test.ts`, `client/tests/report-issue.test.ts`