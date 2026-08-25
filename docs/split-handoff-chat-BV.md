# Split handoff - chat BV (AIEngine.ts)

Parent now: **41037 B / 40.1 KB**. Still over 40960 by **77 B**. Parent is LF.

The leftover is class `AIEngine` (~247-1120, 31.2 KB). Do not move the class whole.

Existing `aiEngine*.ts` siblings stay put — do not append. Grep dual-copy first:
`assessBattlefieldThreats` already lives in `aiEngineThreatSupport.ts`.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BV.md.
Sole writer for rules-engine/src/AIEngine.ts and new AIEngine-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create AIEngine-handlers/index.ts on extract #1. Never create AIEngine/ beside
AIEngine.ts. Parent LF; leaves LF. Do not Read the whole parent.

Do NOT move the AIEngine class whole. Extract one method cluster with
--allow-nested (CardAnalyzer pattern). Parent methods become thin .call(this)
wrappers. Grep dual-copy vs existing aiEngine*.ts siblings before extracting —
merge into the sibling if it already owns the method; do not create a third copy.
Do not append to existing aiEngine* siblings.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/AIEngine.ts --min-bytes 2000

Order:
1. One unused method cluster still defined on the class (not already a thin
   wrapper to aiEngine* support), e.g. analyzeLibraryForPlanning / detectOpponentCombo
   / makeDecision family, until parent < 40960.
2. Stop once under the ceiling.

Public API stays on AIEngine.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck rules-engine. AIEngine vitest if present. No ts-morph.
```
