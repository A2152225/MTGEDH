# Split handoff - chat P2 (intervening-if.ts, continue)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-P2.md.
CONTINUE triggers/intervening-if.ts (now 576191 B / 562.7 KB).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count. Report leftover TOC only if you must abort. Do not edit the module map.
Do not Read the whole parent. Do not touch leftover triggered-abilities.ts or combat.ts.
Already extracted: intervening-if-this-turn-counts.ts. Do not re-move.

The elephant is evaluateInterveningIfClauseInternal (~1346-13631, 510.5 KB). Do NOT move it whole.
Same technique as move-zone guard chains: hoist contiguous clause-family runs into
triggers/intervening-if-<family>.ts that take (ctx, controllerId, clause, ...) and return
boolean | sentinel | undefined (undefined = fall through). Parent calls tryX; if defined, return.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/triggers/intervening-if.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs server/src/state/modules/triggers/intervening-if.ts internal=1346-13631

Grep the internal function for comment banners or leading `if (clause` families (life-total, control-count,
this-turn, attacking, graveyard, commander). Byte-copy contiguous runs that each stay under 40KB, then the
next family, until the remaining internal body is also under 40KB. Parent keeps extractInterveningIfClause*
wrappers and the overloads of evaluateInterveningIfClause.

Do not change unknown-clause fallback (FALLBACK_INTERVENING_IF / UNMATCHED_INTERVENING_IF).
Typecheck server. intervening-if vitest. No ts-morph reprint.
```
