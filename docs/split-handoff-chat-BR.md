# Split handoff - chat BR (triggeredAbilitiesEventDetection.ts)

Parent now: **42373 B / 41.4 KB**. Still over 40960. Parent is LF.

The file is one function (`detectTriggeredAbilityEvent`, 41.4 KB). Do not move it whole.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BR.md.
Sole writer for rules-engine/src/triggeredAbilitiesEventDetection.ts and new
triggeredAbilitiesEventDetection-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create triggeredAbilitiesEventDetection-handlers/index.ts on extract #1.
Never create triggeredAbilitiesEventDetection/ beside the .ts.
Parent LF; leaves LF. Do not Read the whole parent.

Do NOT move whole detectTriggeredAbilityEvent (41.4 KB). Split the if-chain by
contiguous event-family phase (undefined = fall through), same as impulse-permission.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/triggeredAbilitiesEventDetection.ts --min-bytes 2000

Order:
1. Early return families (spell countered / beginning-of-main / similar) into
   tryParse* that returns undefined to fall through.
2. Next contiguous if-chain until leftover function body and parent are both
   under 40960.

Public export stays on the parent. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck rules-engine. Triggered-ability event vitest. No ts-morph.
```
