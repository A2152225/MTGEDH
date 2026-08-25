// server/src/state/planeswalker/templates/resolve-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/planeswalker/templates/resolve.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays templates/resolve.ts.
// Leaves must not import resolve.ts or this index.

// Shared shuffle + Karn restart non-Aura permanent predicate.
export { shuffleInPlace, isNonAuraPermanentCard } from "./loyaltyTemplateHelpers.js";

// Karn Liberated restart: preserve exiled non-Aura permanents, then nextTurn.
export { restartGameWithKarnExemptions } from "./loyaltyTemplateRestartGame.js";

// Manual / joke / draft / conjure / AskUrza / Davriel / sealed-booster loyalty cases.
export { tryLoyaltyTemplateManualDraft } from "./loyaltyTemplateManualDraft.js";

// Perpetual grants, reveal-until, look-at-top, return-to-hand, land-discard draw.
export { tryLoyaltyTemplatePerpetualLookReturn } from "./loyaltyTemplatePerpetualLookReturn.js";

// Discard/draw, exile-from-library play, tokens, graveyard return-all.
export { tryLoyaltyTemplateDiscardExileDraw } from "./loyaltyTemplateDiscardExileDraw.js";

// GY token-copy, untap/animate, evasion, look-at-top typed reveals.
export { tryLoyaltyTemplateGyCopyUntapLook } from "./loyaltyTemplateGyCopyUntapLook.js";

// Look-at-top typed/any-order, draw/discard, extra land, targeted discard.
export { tryLoyaltyTemplateLookDrawLifeDiscard } from "./loyaltyTemplateLookDrawLifeDiscard.js";

// Life totals, mana, damage, destroy/exile targets.
export { tryLoyaltyTemplateLifeManaDamageDestroy } from "./loyaltyTemplateLifeManaDamageDestroy.js";

// Create-token loyalty templates and related loyalty-counter-on-source.
export { tryLoyaltyTemplateCreateTokens } from "./loyaltyTemplateCreateTokens.js";

// Loyalty counters on source, mill, +1/+1 counters, menace EOT.
export { tryLoyaltyTemplateLoyaltyCountersMill } from "./loyaltyTemplateLoyaltyCountersMill.js";

// +1/+1 indestructible, fight, destroy/exile, targeted damage.
export { tryLoyaltyTemplateP1P1FightDamage } from "./loyaltyTemplateP1P1FightDamage.js";

// Sweep damage, Karn restart, library/graveyard named searches.
export { tryLoyaltyTemplateDamageRestartSearch } from "./loyaltyTemplateDamageRestartSearch.js";

// Library search, emblems, put-from-hand creatures.
export { tryLoyaltyTemplateSearchEmblemHandPut } from "./loyaltyTemplateSearchEmblemHandPut.js";

// Put from hand/GY, team pumps, tap/freeze, gain control.
export { tryLoyaltyTemplateHandPutPumpControl } from "./loyaltyTemplateHandPutPumpControl.js";

// Mass control, extra turns, GY returns, life from creature cards.
export { tryLoyaltyTemplateControlExtraTurnGy } from "./loyaltyTemplateControlExtraTurnGy.js";

// Named planeswalker damage, amass, leftover GY return.
export { tryLoyaltyTemplateNamedDamageFinale } from "./loyaltyTemplateNamedDamageFinale.js";

// Shared helpers closed over by loyalty template case families (damage, mill, mana, tokens).
export {
  addRestrictedMana,
  addUnrestrictedManaSymbols,
  applyDamageToPermanent,
  applyDamageToPlayer,
  destroyPermanents,
  discardHandCardsToGraveyard,
  exilePermanents,
  extractQuotedAbilities,
  findCreatureOnBattlefieldById,
  getControlConstraint,
  getManaValueConstraint,
  getOpponents,
  getOrInitManaPool,
  getPlayerById,
  getSourcePlaneswalkerColors,
  isCreatureOfSubtype,
  millCards,
  normalizeCardNameForCompare,
  parseTokenDescriptorToTypeLineAndColors,
  permanentHasKeyword,
  predefinedArtifactTokens,
  recordCreatureDamagedByCreatureThisTurn,
  recordCreatureDealtDamageToPlayerThisTurn,
  satisfiesManaValueConstraint,
  toAvailableCard,
  upsertPlaneswalkerPlayableFromExileGrant,
} from "./loyaltyTemplateRuntimeHelpers.js";
