# Split handoff - chat R3 (interaction.ts, continue)

Parent now: **120068 B / 117.3 KB**. Still over 40960.

Chat R2 extracted families + helpers + replacement/cycling sockets. Leftover is the `activateBattlefieldAbility` mid/late body (otherParse + genericMana split).

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-R3.md.
CONTINUE server/src/socket/interaction.ts (now 120068 B / 117.3 KB) and interaction-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Never create socket/interaction/. Parent CRLF; leaves LF.
registerInteractionHandlers stays a real function.
Do NOT move the remaining activateBattlefieldAbility socket.on whole.

Already extracted (do not re-move): tryHandleActivate SpecialLand, FetchLand, SacrificeDraw,
EquipFortifyReconfigure, GrantFightCounterTap, CrewStation, LevelOutlastUpgrade, Mana,
Planeswalker, CostPromptTapBlight, SacrificeCostPrompt, PayLifeExileCounters,
CostPromptDiscardExileHand (39.4 KB near ceiling - do not append).
Helpers: interactionActivateBattlefieldAbilityHelpers.ts (import persistAbilityActivatedTriggerPushes,
parseStationThreshold, applyXValueToText, extractActivatedAbilitiesFromText, … from there).
Sockets: registerReplacementAndCyclingSocketHandlers.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/interaction.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs server/src/socket/interaction.ts
    otherParse=451-832 detect=920-957 nonManaIf=958-1708
    manaElse=1709-2285 trailing=2286-2459 comments=2464-2501

Wrap leftover activate families with tryHandleActivateX(activateCtx, extras); if (handled) return.
Byte-copy --dry first. tools/_tmp-wrap-activate-extract.mjs: LF, 2-space dedent of body after `} = ctx;`,
bare `return;` -> `return true;`, rewrite `await import('../` to `await import('../../`.
Footer copy-back lines must be 4-space indent so wrap dedents them to 2-space.

Order:
1. otherParse (451-832, ~18.1 KB) — NOT a handle-or-skip family. It DECLAREs lets
   (manaCost, abilityText, requiresTap, sacrificeType, selectedAbilityFullText, …)
   that tapBlight / sacPrompt / genericMana still use. Extract as trySetup that
   fills an out object and returns true on error (parent return). Parent then
   `let { manaCost, abilityText, … } = parsed;` so later `manaCost =` still works.
2. genericMana SPLIT (do not move 70.6 KB whole). Confirm lines with toc:
   - detect isManaAbility + chosen-name (920-957) can stay in parent (~2.3 KB)
   - nonMana if-BODY (959-1707, ~33.7 KB) — after header+LF+dedent stay under 40KB.
     Parent keeps `if (!isManaAbility) { if (await tryHandle…) return; }`
   - mana else-BODY (1710-2279, ~26.5 KB)
   - trailing persist (2281-2459, ~8.0 KB) runs after BOTH branches — own leaf
     `applyActivateBattlefieldAbilityPersist`, not inside the else.
   Shared lets (tappedPermanentsForCost, pendingLifePaymentForCost, recordedAddedMana,
   persistedStackItemId, resolvedAbilityText, …) need a mutation bag like
   PayLifeExileCounters' ActivateCostMutationState. Copy primitives back on
   fall-through. Arrays/objects mutate in place.
3. Dead comments 2464-2501 (~2.3 KB) if still needed for ceiling.

Leaf must not import interaction.ts or the index. Typecheck server. Activation /
graveyard-cast vitest. No ts-morph.
```

## Notes from chat R2

- `CostPromptDiscardExileHand` is near 40KB — do not append.
- `isAbilityActivationProhibitedByChosenName` is still dynamically imported in the
  activate prologue (used by genericMana detect). SpecialLand static-imports it.
- otherParse is sequential setup, not `tryHandle` boolean-only. Same for trailing persist.
- Parent helpers already live in `interactionActivateBattlefieldAbilityHelpers.ts`;
  genericMana leaves should import `persistAbilityActivatedTriggerPushes` from there
  rather than taking it as an extra arg.
- Server `tsc` has pre-existing rules-engine errors in other chats' extract files;
  interaction-handlers extracts typecheck clean against those.
