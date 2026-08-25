# Split handoff - chat BA (triggerEtbEntryEffects.ts)

Parent now: **59176 B / 57.8 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BA.md.
Sole writer for server/src/state/modules/triggerEtbEntryEffects.ts and new
triggerEtbEntryEffects-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create triggerEtbEntryEffects-handlers/index.ts on extract #1. Never create
triggerEtbEntryEffects/ beside the .ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

Grep dual-copy: persistTriggeredAbilityPush also exists in
socket/combat-handlers/combatDeclareBlockersRequest.ts. Different functions —
do not merge; do not create a third copy of the same export.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/triggerEtbEntryEffects.ts --min-bytes 2000

Order:
1. triggerETBEffectsForToken (~871-1272, 17.5 KB) plus exclusive helpers.
2. queueSelfETBTriggersForPermanent (~296-542, 13.9 KB).
3. persistTriggeredAbilityPush / queueTemporaryEtbTriggersForEntry /
   recordBattlefieldEntryTurnTracking / tryBuildTypedPermanentEtbStackItem
   until parent < 40960.

Public exports stay on the parent (re-export from leaf).
Leaf must not import the parent or the index. Byte-copy --dry first.
Typecheck server. ETB / token-entry vitest. No ts-morph.
```
