# Split handoff - chat Q2 (ai.ts, continue)

Parent now: **222954 B / 217.7 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-Q2.md.
CONTINUE server/src/socket/ai.ts (now 222954 B / 217.7 KB) and ai-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Never create socket/ai/. Parent CRLF; leaves LF.
registerAIHandlers stays a real exported function on the public barrel.
Do not Read the whole parent. handleAIResolutionStep is already a thin dispatcher - do not re-split.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/ai.ts --min-bytes 3000
  node tools/ts-cluster-deps.mjs server/src/socket/ai.ts START END

Do NOT move whole: snapshotAIAbilityActivationState (~1839-2823, 36.9 KB) or
getPaymentSources (~3243-3880, 27.2 KB). TOC ranges are NOT single functions —
they include 2-space-indented helpers. Chat Q had to revert those peels.

Order:
1. Hoist the indented mana/payment/activation helper family FIRST into
   aiManaActivationHelpers.ts (split if over 40KB).
2. Then the short snapshotAIAbilityActivationState as its own leaf.
3. Then getPaymentSources as its own leaf.
4. handleAIPriority (~4082-4780, 29.2 KB) then findCastableSpells.
5. Land tap / bounce / executeAIActivateAbility until parent < 40960.

If you see a broken import `../rules-engine/targeting.js` from aiTargetChoiceHandlers.ts,
the file lives at server/src/rules-engine/targeting.ts — fix that import as part of
wiring (path only, no behavior change).

Leaf must not import ai.ts or the index. Byte-copy --dry first. Typecheck server.
AI / priority / resolution vitest. No ts-morph.
```
