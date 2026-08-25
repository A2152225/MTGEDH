# Split handoff - chat BF (actions/triggersHandler.ts)

Parent now: **55924 B / 54.6 KB**. Still over 40960. Parent is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BF.md.
Sole writer for rules-engine/src/actions/triggersHandler.ts and new
rules-engine/src/actions/triggersHandler-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create actions/triggersHandler-handlers/index.ts on extract #1.
Never create actions/triggersHandler/ beside triggersHandler.ts.
Parent LF; leaves LF. Do not Read the whole parent.

Grep dual-copy vs server/src/state/modules/triggers/ (detectETBTriggers,
detectDeathTriggers, detectAttackTriggers). Merge into the existing folder copy
if it is the same export; do not create a third implementation.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/actions/triggersHandler.ts --min-bytes 2000

Order:
1. findTriggeredAbilities (~295-472, 6.6 KB) + checkStepTriggers (~629-810, 6.4 KB)
   if they fit under 40KB with exclusive helpers, else two leaves.
2. checkDiesTriggers / checkETBTriggers / checkSpellCastTriggers /
   checkAttackTriggers / checkCombatDamageToPlayerTriggers.
3. Remaining delayed / tribal / blocked / processTriggers until parent < 40960.

Public exports stay on triggersHandler.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck rules-engine. Trigger-detection vitest. No ts-morph.
```
