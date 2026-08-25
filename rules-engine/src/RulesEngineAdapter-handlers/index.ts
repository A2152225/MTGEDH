// rules-engine/src/RulesEngineAdapter-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/RulesEngineAdapter.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/RulesEngineAdapter.ts.
// Never create RulesEngineAdapter/ beside RulesEngineAdapter.ts.
// Leaves must not import RulesEngineAdapter.ts or this index.

// Timing context for land/spell validation (main phase, own turn, stack, priority).
export { buildTimingContext } from './adapterTimingContext';

// Top-of-library land/spell permission + source-zone card lookup.
export {
  canCastTopLibrarySpell,
  canPlayTopLibraryLand,
  findSourceZoneCard,
  getCardTypes,
} from './adapterLibrarySourceHelpers';

// Parse mana cost strings and check a simple pool.
export { canPayManaCostFromPool, parseManaCostString } from './adapterManaCostParse';

// executeAction dispatcher (validate, dispatch, SBAs, delayed dies/control-loss).
export { executeAction } from './adapterExecuteAction';

// Tap a permanent for mana.
export { tapForManaAction } from './adapterTapForManaAction';

// Helm of the Host equipped-creature token copy.
export { resolveHelmOfTheHostTrigger } from './adapterHelmOfTheHostTrigger';

// Became-monstrous trigger processing after stack resolution.
export { processBecameMonstrousTriggers } from './adapterBecameMonstrousTriggers';

// Keyword costs + resolved-spell zone moves (buyback/replicate/disturb/rebound).
export {
  addManaCostValues,
  buildTransformedCardFace,
  didPayBuyback,
  extractKeywordCostFromOracleText,
  getEffectiveBuybackManaCostInput,
  getEffectiveKeywordAdjustedManaCostInput,
  getIntrinsicGraveyardCastMetadata,
  getReplicateCount,
  manaCostsEqual,
  moveResolvedNonPermanentSpellToZone,
  moveResolvedPermanentSpellToBattlefield,
  multiplyManaCost,
  registerReboundDelayedTrigger,
  sanitizeSpellCardAfterStackExit,
  shouldPayBuyback,
  spellCardHasKeyword,
} from './adapterKeywordCostAndResolvedSpell';

// Additional-cost eligibility filters and description parsers.
export {
  cardMatchesAdditionalCostFilter,
  getEligibleCounterRemovalPermanents,
  getEligibleDiscardCards,
  getEligibleGraveyardExileCards,
  getEligibleSacrificePermanents,
  normalizeGraveyardAdditionalCostFilter,
  parseCountToken,
  parseCounterRemovalFromCostDescription,
  parseDiscardCostFromDescription,
  parseExileCostFromDescription,
  parseLifeAmountFromCostDescription,
  parseSacrificeCostFromDescription,
  parseTapCostFromDescription,
  removeCountersFromEligiblePermanents,
  totalRemovableCountersOnPermanent,
} from './adapterAdditionalCostParsers';

// Cast-spell metadata (payment record, counters, flash, immunity).
export {
  appendFlashType,
  buildCastSpellMetadata,
  deriveSelfEntryCounterMetadata,
  deriveTappedSourceCounterImmunity,
  getCastMetadataValue,
  mergeCastSpellMetadata,
  mergeEntryCounterMaps,
  normalizeColorSymbols,
  normalizeCounterImmunityMetadata,
  normalizeManaPaymentRecord,
  normalizeTypePhrase,
  typeLineContainsChosenType,
} from './adapterCastSpellMetadata';

// Targeting helpers: colors, source info, selected-target legality.
export {
  buildTargetingSourceInfo,
  evaluateSelectedTargetLegality,
  getAbilitySourceObject,
  getLegalStackTargetIds,
  getSourceTypeName,
  getStackSourceTypeName,
  getTargetingColorNames,
  isStackTargetCurrentlyLegal,
  isTargetCardPresentInState,
  validateSelectedTargetsForSource,
} from './adapterTargetingHelpers';

// Play a land from hand / exile / graveyard / library.
export { playLandAction } from './adapterPlayLandAction';

// Activate an activated ability (cost, additional costs, stack push).
export { activateAbilityAction } from './adapterActivateAbilityAction';

// State-based actions (CR 704 loop: loss, deaths, legend, auras, win).
export { checkStateBasedActions } from './adapterStateBasedActions';

// Resolve the top stack object (pop, oracle-IR effects, zone moves).
export { resolveStackTop } from './adapterResolveStackTop';

// Cast-spell action (zone consume, stack push, on-cast triggers).
export { castSpellAction } from './adapterCastSpellAction';

// Play-land / spell-cast / ability-activation validators.
export {
  validateAbilityActivation,
  validatePlayLand,
  validateSpellCast,
} from './adapterActionValidators';

// Activated-ability additional costs: discard/tap/sac/counter/exile/reveal + graveyard extras.
export {
  applyActivatedAbilityCounterRemovals,
  applyActivatedAbilityExileSelection,
  canPayActivatedAbilityAdditionalCosts,
  canPayGraveyardAdditionalCost,
  getEligibleTapPermanents,
  payActivatedAbilityAdditionalCosts,
  payGraveyardAdditionalCost,
  resolveActivatedAbilityCounterRemovals,
  resolveActivatedAbilityDiscardCards,
  resolveActivatedAbilityExileSelection,
  resolveActivatedAbilityRevealCards,
  resolveActivatedAbilitySacrificePermanents,
  resolveActivatedAbilityTapPermanents,
} from './adapterActivatedAbilityAdditionalCosts';
