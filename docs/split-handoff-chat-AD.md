# Split handoff - chat AD (targeting.ts)

Parent now: **159889 B / 156.1 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AD.md.
Sole writer for server/src/rules-engine/targeting.ts and new targeting-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create targeting-handlers/index.ts on extract #1. Never create targeting/ beside
targeting.ts. Parent CRLF; leaves LF. Do not Read the whole parent.

Do NOT move whole categorizeSpellWithoutPrimaryRetirement (~865-3004, 89.8 KB).

Inventory:
  node tools/ts-cluster-toc.mjs server/src/rules-engine/targeting.ts --min-bytes 2500
  node tools/ts-cluster-range-bytes.mjs server/src/rules-engine/targeting.ts
    parse=455-864 cat=865-3004 a=865-1400 b=1401-2000 c=2001-2500 d=2501-3004 eval=3210-3505

Order:
1. parseTargetRequirements (~455-864, 19.5 KB) plus exclusive helpers it closes over.
2. Split categorizeSpellWithoutPrimaryRetirement by pattern family (stack/counter,
   destroy/exile-all, bounce, damage, …). Confirm chunks ~21.5 / 20.7 / 25.3 / 22.4 KB.
   Parent keeps the exported function as a dispatcher: normalize oracle, then
   tryCategorize… (null = fall through).
3. evaluateTargeting (~3210-3505, 12.5 KB), then remaining exports
   (canPermanentBeTargetedByPlayer, resolveSpell, parseAbilityTargeting, …)
   until parent < 40960.

Public exports stay on targeting.ts (re-export from leaf).
Leaf must not import targeting.ts or the index. Byte-copy --dry first.
Typecheck server. Targeting / spell-spec vitest. No ts-morph.
```
