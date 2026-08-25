# Split wave 8 — unused overs

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns `docs/mtg-logic-module-map.md`.

These eight are disjoint. One writer per parent. Do not touch wave-7 AH (`mana-check.ts`).

| Chat | Parent now | First cluster |
| --- | --- | --- |
| AO | `RulesEngineAdapter.ts` **39.3 KB** (done) | indented class methods with `--allow-nested`; do not move the class whole |
| AP | `planeswalker/templates/registry.ts` **2.1 KB** (done) | regex const families (~18 KB each), then split `getPlaneswalkerTemplateMatch` (72.8 KB) by phase — do not move it whole |
| AQ | `state/modules/zones.ts` **35.7 KB** (done) | `drawCards` / `processDrawTriggers` / mill / library-hand moves |
| AR | `rules-engine/src/actions/combat.ts` **36.6 KB** (done) | legality helpers then `validateDeclare*` / `executeCombatDamage`; folder is `actions/combat-handlers/` (not `socket/combat-handlers/`) |
| AS | `graveyard-permissions.ts` **36.8 KB** (done) | text-grant apply family then static-source helpers |
| AT | `AutomationService.ts` **28.9 KB** (done) | combat-damage apply/calc then trigger/automation runners |
| AU | `oracleIRParserStaticAbilityClauses.ts` **33.1 KB** (done) | split `tryParseStaticAbilityGrantClause` (43.8 KB) by if-chain phase; do not move it whole |
| AV | `socket/join.ts` **38.4 KB** (done) | `ensureStateZonesForPlayers` then nested sockets; `registerJoinHandlers` stays a real function |

Skipped this wave: client UI (`App.tsx`, table/combat/cast modals). Next unused overs: `docs/split-handoff-wave-9.md`.

**Executor ledger:** do not change how `appliedSteps` records `conditional` wrappers. After inner or else steps fire, record those only; record the wrapper only when that branch applied nothing.
