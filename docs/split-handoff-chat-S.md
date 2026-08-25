# Split handoff - chat S (planeswalker resolve.ts)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-S.md.
Sole writer for server/src/state/planeswalker/templates/resolve.ts and new
templates/resolve-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create resolve-handlers/index.ts on extract #1. Never create templates/resolve/
beside resolve.ts. Do not touch templates/registry.ts (141.7 KB, different parent).
Parent CRLF; leaves LF. Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/planeswalker/templates/resolve.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs server/src/state/planeswalker/templates/resolve.ts START END

The elephant is tryResolvePlaneswalkerLoyaltyTemplate (~739-12841, 485.8 KB).
Do NOT move it whole. Hoist contiguous switch-case families into
resolve-handlers/loyaltyTemplate<Family>.ts that take (ctx, ...) and return
handled | undefined (undefined = fall through). Parent keeps the switch dispatcher.

Order:
1. restartGameWithKarnExemptions (~87-305, 7.9 KB) if OUT->IN is small.
2. First contiguous case run from the switch (FALLBACK_MANUAL_RESOLUTION /
   HEAD_TO_ASKURZA / DAVRIEL / CHOOSE_LEFT_OR_RIGHT / SEEK_AN_ELF / CONJURE / DRAFT /
   ROLL_A_D20 / OPEN_SEALED...). Each leaf under 40KB.
3. Keep hoisting the next case family until the remaining function body is under 40KB.

This is an extract of existing template cases, not new card-name routing.
Leaf must not import resolve.ts or the index. Byte-copy --dry first.
Typecheck server. Planeswalker loyalty vitest. No ts-morph.
```
