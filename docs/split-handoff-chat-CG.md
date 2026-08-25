# Split handoff - chat CG (TargetSelectionModal.tsx)

Parent now: **44611 B / 43.6 KB**. Still over 40960. Parent is CRLF.

`TargetSelectionModal` itself is **37.5 KB**. Do not move it whole if that would pack it into a near-40KB leaf.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-CG.md.
Sole writer for client/src/components/TargetSelectionModal.tsx and new
client/src/components/TargetSelectionModal-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit any docs/mtg-logic-module-map*.md — report owed rows.
Create TargetSelectionModal-handlers/index.ts on extract #1.
Never create TargetSelectionModal/ beside TargetSelectionModal.tsx.
Parent CRLF; leaves LF. Do not Read the whole parent.

Do NOT move TargetSelectionModal (~224-1152, 37.5 KB) whole.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/components/TargetSelectionModal.tsx --min-bytes 400

Order:
1. Top-level helpers (~21-223): TargetOption, isGroupedTargetSelectionComplete,
   ownershipStyle, PermanentOwnershipBadge, PermanentTargetCaption,
   TargetSelectionModalProps. Moving these may put the parent under 40 KB
   without touching the 37.5 KB component.
2. Nested memos/callbacks inside TargetSelectionModal (--allow-nested)
   only if the parent is still over.

Public TargetSelectionModal stays on the parent. Leaf must not import the
parent or index.
Byte-copy --dry first. Typecheck client. No ts-morph. No UI behavior changes.
```
