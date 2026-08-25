# Split handoff — chat C (triggered-abilities.ts + triggers/)

Sole writer for: `server/src/state/modules/triggered-abilities.ts` and
`server/src/state/modules/triggers/**` (including `intervening-if.ts` and `triggers/combat.ts`).

Campaign 0 and the green test baseline were already done before this chat; not redone here.
`docs/mtg-logic-module-map.md` is intentionally **not** edited from this chat — rows this chat
would have added are listed under "Module map rows owed" below.

## Dual-copy rule (do not violate)

`detectDeathTriggers` / `detectETBTriggers` / `detectAttackTriggers` must never gain a third
implementation. Merge leftover unique logic into the folder module; leftover becomes a re-export;
then split the folder module if it would stay over 40KB.

## Conventions

- Leftover is LF; `zone-changes.ts` is CRLF; new `triggers/` extracts are LF.
- Detector wire type lives in `triggers/detectorTriggeredAbility.ts` (leftover's rich
  `TriggeredAbility`). Distinct from `triggers/types.ts` `TriggeredAbility` (skinny).
- Leaves must not import leftover `triggered-abilities.ts` or `triggers/index.ts`.
- Byte-exact cluster moves use `tools/_tmp-chatC-extract-cluster.mjs` and the hoist scripts.
  Do not retype detector bodies. `--export` prefixes `export ` onto the first line of the
  moved bytes — do not use it when the range starts with a JSDoc (`export /**` is invalid).
- Zone-changes function replacement must find the next `^export function`, not brace-count
  (regex literals contain `}` and stop too early). Learned on the ETB hoist dry-run.

## Progress

### Helper extracts (JIT for death/ETB)

| New file | What | Size |
| --- | --- | --- |
| `triggers/detectorTriggeredAbility.ts` | leftover detector `TriggeredAbility` | 2.3 KB |
| `triggers/cardNameRegexAlternatives.ts` | `buildCardNameRegexAlternatives` | 1.7 KB |
| `triggers/enters-or-other-event-prefix.ts` | `ENTERS_OR_OTHER_EVENT_PREFIX` | 0.3 KB |
| `triggers/hideaway-ability.ts` | `HideawayAbility` + `detectHideawayAbility` | 2.9 KB |
| `triggers/detect-target-type.ts` | `detectTargetType` | 0.8 KB |

### Death detector dual-copy (done)

Leftover `detectDeathTriggers` (87.8 KB) was the evolved copy; folder `zone-changes.ts`
(5.5 KB) was a stale subset. Folder-only regex formulations were **not** merged on top
(would double-fire). Leftover body is the implementation.

Split under 40KB by hoisting contiguous pattern runs that mutate a shared
`DeathDetectionState`:

- `triggers/death-detection.ts` — orchestrator + `collectDeathTriggerEffectText` (5.4 KB)
- `triggers/death-detection-state.ts`
- `triggers/death-detection-early.ts` (31.0 KB)
- `triggers/death-detection-mid.ts` (32.5 KB)
- `triggers/death-detection-late.ts` (23.6 KB)

Leftover: `export { detectDeathTriggers } from "./triggers/zone-changes.js"` plus a local
import from `death-detection.js` for leftover callers (`getDeathTriggers` helpers).
`zone-changes.ts` re-exports from `death-detection.js`. **One** `export function detectDeathTriggers`.

Verified: server typecheck green; death vitest 95 passed
(`death-emitter-parity`, `death-attack-life-trigger-detection`, `zulaport-death-trigger`,
`copy-token-death-trigger`, `goad-static-death`, `enters-or-other-event-fire`,
`flickering-ward-hateful-eidolon`, `chosen-creature-type-support`).

### ETB detector dual-copy (done)

Leftover `detectETBTriggers` (71.0 KB) replaced folder stale copy (17.4 KB). Same rule:
leftover body only; do not stack folder regexes.

- `triggers/etb-detection.ts` — orchestrator + `getETBTriggersForPermanent` (uses detector
  `TriggeredAbility`, not zone-changes skinny type)
- `triggers/etb-detection-state.ts`
- `triggers/etb-detection-helpers.ts` — including `LTB_STATIC_ALTERNATIVES` (leftover
  `detectLTBTriggers` imports this)
- `triggers/etb-detection-early.ts` (29.9 KB)
- `triggers/etb-detection-mid.ts` (33.6 KB)
- `triggers/etb-detection-late.ts` (7.0 KB)

Leftover: `export { detectETBTriggers, getETBTriggersForPermanent } from "./triggers/zone-changes.js"`.
`zone-changes.ts` re-exports both from `etb-detection.js`. **One** `export function detectETBTriggers`.

`getETBTriggersForPermanent` must keep the detector wire type. Wrapping it in zone-changes'
skinny `TriggeredAbility[]` made `triggerEtbEntryEffects.ts` fail (12× TS2339
`requiresTarget` / `targetType` / `value`). Fixed by exporting the wrapper from
`etb-detection.ts`.

Verified: server typecheck green (exit 0); death+ETB vitest 77 passed
(`etb-known-trigger-optional`, `hideaway-etb-detection`, `auriok-champion-etb-trigger`,
`bounce-land-trigger`, `kogla-yidaro-etb`, `killian-enchantment-etb`, `sakura-tribe-etb`,
`ghalta-stampede-tyrant-etb`, `casal-etb-library-search`, `ltb-etb-trigger-detection`,
plus death suites above).

### Sizes

| File | Start | Now |
| --- | --- | --- |
| leftover `triggered-abilities.ts` | 694901 B (678.6 KB) | 521655 B (509.4 KB) |
| `triggers/zone-changes.ts` | 44593 B (OVER) | 19575 B (19.1 KB) |

## Remaining dual copies in zone-changes.ts (still this family)

Folder still has stale runtime wrappers vs leftover evolved copies:

| Symbol | leftover | folder |
| --- | --- | --- |
| `getDeathTriggersForCreature` | 7084 | 121 |
| `processUndyingPersist` | 7247 | 158 |
| `getDeathTriggers` | 7851 (16.4 KB) + helpers ~7298–7850 | 189 |
| `getPlayersWhoMustSacrifice` | 8285 | 326 |
| `detectETBUntapEffects` / `getETBUntapEffects` / `applyETBUntapEffect` | 8324+ | 345+ |
| `checkETBAutoSacrifice` | 11081 | 492 |

Merge leftover unique into folder (likely `death-emission.ts` / `etb-untap.ts`), leftover
re-exports from `zone-changes.js`. Do not create a third `detectDeathTriggers` /
`detectETBTriggers`.

## Next (same chat C order)

1. Finish remaining zone-changes dual copies (above).
2. Attack/combat: leftover `detectAttackTriggers` (66.8 KB at 3744) vs `triggers/combat.ts` (127.6 KB, already OVER). Merge leftover unique into combat.ts, leftover re-export, then split combat.ts.
3. Leftover-only exports (detectLTBTriggers, spell-cast, tap, etc.) into `triggers/` siblings.
4. Split `triggers/intervening-if.ts` (575 KB).
5. Finish splitting `triggers/combat.ts` if still over after the attack merge.

## Tooling (throwaway, keep until campaign end)

- `_tmp-chatC-toc.mjs`, `_tmp-chatC-cluster-deps.mjs`, `_tmp-chatC-unique-literals.mjs`
- `_tmp-chatC-indent2-blocks.mjs`, `_tmp-chatC-fn-locals.mjs`
- `_tmp-chatC-extract-cluster.mjs`
- `_tmp-chatC-hoist-death-detection.mjs`, `_tmp-chatC-hoist-etb-detection.mjs`

## Module map rows owed

- `triggers/detectorTriggeredAbility.ts` — leftover detector `TriggeredAbility` wire type
- `triggers/cardNameRegexAlternatives.ts` — card-name regex variants for detectors
- `triggers/enters-or-other-event-prefix.ts` — compound "enters or \<event\>" prefix
- `triggers/death-detection.ts` (+ early/mid/late/state) — `detectDeathTriggers`
- `triggers/etb-detection.ts` (+ early/mid/late/helpers/state) — `detectETBTriggers`, `getETBTriggersForPermanent`
- `triggers/hideaway-ability.ts` — `detectHideawayAbility`
- `triggers/detect-target-type.ts` — `detectTargetType`
