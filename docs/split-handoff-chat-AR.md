# Split handoff - chat AR (actions/combat.ts)

Parent now: **81701 B / 79.8 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AR.md.
Sole writer for rules-engine/src/actions/combat.ts and new
rules-engine/src/actions/combat-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create actions/combat-handlers/index.ts on extract #1. Never create actions/combat/
beside combat.ts. Distinct from server/src/socket/combat-handlers/.
Parent CRLF; leaves LF. Do not Read the whole parent.

Grep dual-copy: executeCombatDamage vs turn.ts dealCombatDamage / socket combat.
Do not merge different functions; do not create a third copy of the same export.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/actions/combat.ts --min-bytes 2000

Order:
1. Legality helpers: isCurrentlyCreature / canPermanentAttack / canPermanentBlock /
   checkEvasionAbilities / hasAbility (~306-968) if they fit under 40KB, else split.
2. validateDeclareAttackers (~1395-1546, 5.7 KB) then validateDeclareBlockers
   (~1614-1772, 6.8 KB) + executeDeclareBlockers.
3. executeCombatDamage (~1889-2203, 12.0 KB) plus exclusive helpers.
4. Remaining goad / forced-block until parent < 40960.

Public exports stay on actions/combat.ts (re-export from leaf).
Leaf must not import actions/combat.ts or the index. Byte-copy --dry first.
Typecheck rules-engine. Combat declare / damage vitest. No ts-morph.
```
