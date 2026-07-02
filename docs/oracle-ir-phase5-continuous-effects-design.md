# Phase 5 Design — Continuous & Replacement Effects in Oracle IR

**Status:** Design draft (2026-07-02, from architecture review). No implementation scheduled yet — this documents the target so Phase 5 work starts from a shared plan instead of ad-hoc patches.

**Why this doc exists:** The step-based `OracleEffectStep[]` pipeline is complete for **one-shot** effects (Layers 1–3 green). The one class it structurally cannot express is **continuous effects** ("creatures you control get +1/+1", "players can't draw more than one card each turn") and **replacement effects** ("if a card would be put into a graveyard, exile it instead"). Today these live in scattered bespoke systems; that scattering is the last architectural ceiling for seamless new-card automation.

---

## 1. What exists today (do not rebuild)

| System | Location | Coverage |
|--------|----------|----------|
| Zone-transition replacement interception | `server/src/state/modules/oracleIrTransitionPipeline.ts` → `evaluateReplacementEvent` | IR-bridged zone steps only |
| Counter replacement sync | `syncCounterReplacementEffectsAfterOracleIR` (`oracleIrServerZoneSync.ts`) | doubling/adding counters after IR apply |
| Mill replacement pre-pass | `applyMillReplacementEffectsToSteps` | mill count modification |
| Would-enter choices | would-enter arc (Track E batches 431–435), `transitionHaltState` | tapped/counters/instead choices on entry |
| Static P/T & keyword grants | ad-hoc battlefield recompute paths (`modify_pt`, anthem-style handlers) | partial; not layered |

These are correct but **event-specific**: each new replacement template needs a new hook. Phase 5 replaces the *dispatch*, not the individual behaviors.

## 2. Target model

Two new declarative IR ability types alongside `OracleEffectStep`:

```ts
type StaticEffectSpec = {
  kind: 'static';
  scope: OracleObjectSelector;          // reuses IR selectors
  layer: 4 | 5 | 6 | 7;                 // type / color / ability / P&T (CR 613 subset)
  sublayer?: '7a' | '7b' | '7c' | '7d';
  grant?: { abilities?: string[]; pt?: { power: number; toughness: number } };
  condition?: OracleConditionSpec;      // "as long as ..."
  raw: string;
};

type ReplacementEffectSpec = {
  kind: 'replacement';
  event: 'zone_change' | 'draw' | 'damage' | 'counter_add' | 'token_create' | 'life_gain';
  match: OracleEventFilter;             // what would happen
  instead: OracleEffectStep[] | { modify: 'double' | 'plus' | 'prevent' | 'redirect'; ... };
  selfOnly?: boolean;
  raw: string;
};
```

Parse sources: same three-tier collection as steps — regex parser → **compiled overlay** (`abilities[].ability_type: 'STATIC'`) → `fallback_to_bespoke`.

## 3. Evaluation points

1. **Replacements:** single choke point. `evaluateReplacementEvent` already intercepts IR zone transitions; extend its registry to consume `ReplacementEffectSpec` from battlefield permanents, and route the remaining event families (draw, damage, counters, tokens, life) through the same registry. `applyEvent` handlers call the registry before mutating — replay therefore replays replacements deterministically.
2. **Statics:** a `recomputeContinuousEffects(state)` pass producing a derived view (effective P/T, granted abilities), invoked at the existing SBA points (`runSBA`) and after IR apply. Store derived values separately from base values (`permanent.derived`) so undo/replay never persists computed state.
3. **Ordering:** timestamp per effect source (already tracked for permanents); dependency handling deferred — CR 613 full dependency graphs are out of scope for the first pass. Layer subset {4, 5, 6, 7a–7d} with timestamps covers the overwhelming majority of EDH-relevant statics.

## 4. Migration order (when Phase 5 is scheduled)

| Step | Scope | Exit criterion |
|------|-------|----------------|
| 5.1 | `ReplacementEffectSpec` registry; port existing zone/counter/mill hooks onto it | Existing tests green with hooks reading the registry |
| 5.2 | Parse the top ~20 replacement templates ("would die, exile instead", "enters with an additional counter", "if you would draw…") | Delta audit stops flagging these as `fallback_to_bespoke` |
| 5.3 | `StaticEffectSpec` + derived-view recompute for P/T + ability grants (anthems, lords) | Anthem/lord cards drop bespoke handlers |
| 5.4 | Layer ordering + conditional statics ("as long as") | CR 613 subset tests |
| 5.5 | Overlay support for STATIC / REPLACEMENT ability types | New-card statics ship as overlays same-day |

## 5. Invariants (same as the step pipeline)

- **All-or-nothing:** a partially-expressible static/replacement returns unparsed (`fallback_to_bespoke`) rather than half-applying.
- **Replay determinism:** replacements apply inside `applyEvent`; derived static state is always recomputed, never persisted.
- **No card-name routing** (`.cursor/rules/oracle-ir-no-bespoke-handlers.mdc`).
- **Telemetry:** unhandled replacement/static text records to `oracleIrGapTelemetry` like any other gap.

## 6. Non-goals (first pass)

- Full CR 613 dependency ordering and characteristic-defining abilities interplay
- Copy effects layer (1) rework — existing copy system stays
- Text-changing effects (layer 3)

---

*Related: [oracle-ir-architecture-guide.md](./oracle-ir-architecture-guide.md) §15 · [oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md) Phase 5 · [oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md) D7.*
