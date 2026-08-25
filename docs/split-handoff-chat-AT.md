# Split handoff - chat AT (AutomationService.ts)

Parent now: **69830 B / 68.2 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AT.md.
Sole writer for rules-engine/src/AutomationService.ts and new
AutomationService-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create AutomationService-handlers/index.ts on extract #1. Never create
AutomationService/ beside AutomationService.ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

Grep dual-copy vs actions/combat calculateCombatDamage / applyCombatDamage and
socket combat. Do not create a third copy of the same export.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/AutomationService.ts --min-bytes 2000

Order:
1. calculateCombatDamage (~969-1084, 3.8 KB) + applyCombatDamage (~1135-1234, 4.0 KB)
   plus exclusive helpers if they form one cluster under 40KB.
2. processTriggeredAbilities (~1528-1664, 4.9 KB) then hasAvailableActions (~1407-1527, 4.7 KB).
3. runAutomation (~1726-1842, 3.3 KB) + requiresDecisionToResolve / target-decision builders.
4. Remaining autoTap / SBA / cleanup until parent < 40960.

Public exports stay on AutomationService.ts (re-export from leaf).
Leaf must not import AutomationService.ts or the index. Byte-copy --dry first.
Typecheck rules-engine. Automation / combat-damage vitest. No ts-morph.
```
