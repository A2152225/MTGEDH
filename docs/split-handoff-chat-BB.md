# Split handoff - chat BB (CardAnalyzer.ts)

Parent now: **58812 B / 57.4 KB**. Still over 40960. Parent is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BB.md.
Sole writer for rules-engine/src/CardAnalyzer.ts and new CardAnalyzer-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create CardAnalyzer-handlers/index.ts on extract #1. Never create CardAnalyzer/
beside CardAnalyzer.ts. Parent LF; leaves LF. Do not Read the whole parent.

The class `CardAnalyzer` (~408-1488, 38.9 KB) plus PATTERNS / BENEFICIAL_DEATH_CARDS
make the file over the ceiling. Do NOT move the class whole.
Extract PATTERNS (~194-280, 4.7 KB) and BENEFICIAL_DEATH_CARDS (~370-407, 2.9 KB)
first, then indented methods with --allow-nested until parent < 40960.
Class methods become thin wrappers that call the leaf.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/CardAnalyzer.ts --min-bytes 2000

Public exports stay on CardAnalyzer.ts.
Leaf must not import CardAnalyzer.ts or the index. Byte-copy --dry first.
Typecheck rules-engine. CardAnalyzer vitest. No ts-morph.
```
