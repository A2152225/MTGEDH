# Split handoff - chat CA (activatedAbilityParser.ts)

Parent now: **68938 B / 67.3 KB**. Still over 40960. Parent is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-CA.md.
Sole writer for client/src/utils/activatedAbilityParser.ts and new
client/src/utils/activatedAbilityParser-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create activatedAbilityParser-handlers/index.ts on extract #1. Never create
activatedAbilityParser/ beside activatedAbilityParser.ts.
Parent LF; leaves LF. Do not Read the whole parent.

Dual-copy: rules-engine parseActivatedAbilitiesFromText is a different function.
Do not merge.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/utils/activatedAbilityParser.ts --min-bytes 2000

Order:
1. parseActivatedAbilities (~819-1773, 38.0 KB) plus exclusive helpers it
   closes over — only if the leaf stays under 40KB after header. Otherwise
   split that function by phase.
2. Remaining parse helpers until parent < 40960.

Public exports stay on activatedAbilityParser.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck client. Activated-ability parser vitest if present. No ts-morph.
```
