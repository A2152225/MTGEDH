# Split handoff - chat BU (triggerReflexiveWhenYouDoQueueUtils.ts)

Parent now: **41084 B / 40.1 KB**. Still over 40960 by **124 B**. Parent is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BU.md.
Sole writer for server/src/state/modules/triggerReflexiveWhenYouDoQueueUtils.ts
and new triggerReflexiveWhenYouDoQueueUtils-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create triggerReflexiveWhenYouDoQueueUtils-handlers/index.ts on extract #1.
Never create triggerReflexiveWhenYouDoQueueUtils/ beside the .ts.
Parent LF; leaves LF. Do not Read the whole parent.

Existing sibling triggerReflexiveBoundSelfExilePreludeUtils.ts stays put —
do not append more cases there.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/triggerReflexiveWhenYouDoQueueUtils.ts --min-bytes 2000

Order:
1. maybeQueueReflexiveAnyAmountManaPayment (~48-102, 2.4 KB) plus exclusive helpers.
2. Next maybeQueue* family only if still over.

Public exports stay on the parent. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck server. Reflexive / when-you-do vitest. No ts-morph.
```
