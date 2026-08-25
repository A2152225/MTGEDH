# Split handoff - chat Q (ai.ts)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-Q.md.
Sole writer for server/src/socket/ai.ts and new ai-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create ai-handlers/index.ts on extract #1 (named re-exports only). Never create socket/ai/.
Parent is CRLF; new leaves are LF. Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/ai.ts --min-bytes 3000
  node tools/ts-cluster-deps.mjs server/src/socket/ai.ts START END

Do NOT move whole: handleAIResolutionStep (~11660-12653, 44.6 KB). Split by step-type family.
snapshotAIAbilityActivationState (~7218-8201, 36.9 KB) is near ceiling - own leaf, do not pack more into it.

Order:
1. Pregame: findBestCommanders, ensureAIPreGameDeckLoaded, autoSelectAICommander, handleAIGameFlow,
   handleAIMulligan -> ai-handlers/aiPregameHandlers.ts (split if over 40KB).
2. registerAIHandlers (~13171-14066, 33.7 KB) -> aiRegisterHandlers.ts if OUT->IN is small.
   registerAIHandlers must stay a real exported function (callers import it).
3. handleAIPriority (~9482-10180) then getPaymentSources / findCastableSpells.
4. Split handleAIResolutionStep by ResolutionStepType families into aiResolution* leaves.
   Parent keeps the switch dispatcher.

Leaf must not import ai.ts or the index. Byte-copy --dry first. Typecheck server.
AI / commander-select / priority vitest. No ts-morph / _refactor_scratch.
```
