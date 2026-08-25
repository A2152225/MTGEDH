# Split handoff - chat AG (counters_tokens.ts)

Parent now: **124215 B / 121.3 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AG.md.
Sole writer for server/src/state/modules/counters_tokens.ts and new
counters_tokens-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create counters_tokens-handlers/index.ts on extract #1. Never create
counters_tokens/ beside counters_tokens.ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/counters_tokens.ts --min-bytes 2000

Order:
1. inferDeathTriggerStackMetadata (~13.7 KB) + pushDeathTriggerOntoStack (~10.6 KB)
   if they form one cluster under 40KB, else two leaves.
2. createToken (~9.3 KB) + createCopyTokensOfCard (~5.4 KB) if exclusive helpers fit.
3. movePermanentToGraveyard (~18.4 KB) then movePermanentToExile (~8.6 KB).
4. runSBA (~18.5 KB) — do NOT pack with graveyard/exile if the new file would
   exceed 40KB after LF+header. resolveLegendRuleChoice (~2.5 KB) with SBA if it
   only serves that path.
5. Remaining counter-placement helpers until parent < 40960.

Public exports stay on counters_tokens.ts (re-export from leaf).
Leaf must not import counters_tokens.ts or the index. Byte-copy --dry first.
Typecheck server. Token / SBA / death-trigger vitest. No ts-morph.
```
