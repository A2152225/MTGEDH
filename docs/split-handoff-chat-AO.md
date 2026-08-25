# Split handoff - chat AO (RulesEngineAdapter.ts)

Parent now: **178580 B / 174.4 KB**. Still over 40960. Parent is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AO.md.
Sole writer for rules-engine/src/RulesEngineAdapter.ts and new
RulesEngineAdapter-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create RulesEngineAdapter-handlers/index.ts on extract #1. Never create
RulesEngineAdapter/ beside RulesEngineAdapter.ts. Parent LF; leaves LF.
Do not Read the whole parent.

The elephant is `export class RulesEngineAdapter` (~188-4669, 168.8 KB).
Do NOT move the class whole. Extract indented methods with --allow-nested.
Class methods become thin wrappers that call the leaf.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/RulesEngineAdapter.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs rules-engine/src/RulesEngineAdapter.ts
    extraCosts=1467-2206 castSpell=3166-3524 resolveStack=3956-4276
    validateSpell=417-654

Order:
1. Activated-ability additional-cost family (~1467-2206, 32.4 KB). Do not pack
   more into that leaf — it is already near the warning.
2. validatePlayLand + validateSpellCast + validateAbilityActivation
   (~290-730) if they fit under 40KB after LF+header, else two leaves.
3. castSpellAction (~3166-3524, 14.9 KB) then resolveStackTop (~3956-4276, 13.0 KB).
4. activateAbilityAction / playLandAction / targeting helpers / SBA until
   parent < 40960.

Leaf must not import RulesEngineAdapter.ts or the index. Byte-copy --dry first.
Typecheck rules-engine. Adapter / cast / stack vitest. No ts-morph.
```
