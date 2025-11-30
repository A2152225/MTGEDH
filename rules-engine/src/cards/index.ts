/**
 * cards/index.ts
 * 
 * Central export for all card-specific effect modules.
 */

// Fetchlands
export {
  isFetchland,
  getFetchlandConfig,
  buildFetchlandSearchCriteria,
  FETCHLAND_CONFIGS,
  type FetchlandConfig,
} from './fetchlands';

// ETB Token Creators
export {
  isETBTokenCreator,
  getETBTokenConfig,
  ETB_TOKEN_CREATORS,
  type ETBTokenConfig,
} from './etbTokenCreators';

// Triggered Ability Cards
export {
  hasSpecialTriggeredAbility,
  getTriggeredAbilityConfig,
  TRIGGERED_ABILITY_CARDS,
  type TriggeredAbilityConfig,
} from './triggeredAbilityCards';

// Cost Reduction Cards
export {
  hasCostReduction,
  getCostReductionConfig,
  applyCostReduction,
  COST_REDUCTION_CARDS,
  type CostReductionConfig,
} from './costReduction';

// Activated Ability Cards
export {
  hasSpecialActivatedAbility,
  getActivatedAbilityConfig,
  ACTIVATED_ABILITY_CARDS,
  type ActivatedAbilityConfig,
} from './activatedAbilityCards';

// Echo Cards
export {
  hasEcho,
  getEchoConfig,
  detectEchoFromText,
  ECHO_CARDS,
  type EchoConfig,
} from './echoCards';

// Additional Cost Cards
export {
  hasAdditionalCost,
  getAdditionalCostConfig,
  detectAdditionalCostFromText,
  ADDITIONAL_COST_CARDS,
  type AdditionalCostConfig,
} from './additionalCostCards';

// Search Effect Cards
export {
  hasSearchEffect,
  getSearchEffectConfig,
  parseSearchFilter,
  SEARCH_EFFECT_CARDS,
  type SearchEffectConfig,
} from './searchEffects';

// Graveyard Return Cards
export {
  hasGraveyardReturn,
  getGraveyardReturnConfig,
  GRAVEYARD_RETURN_CARDS,
  type GraveyardReturnConfig,
} from './graveyardReturnCards';

// Creature Count Cards
export {
  hasCreatureCountEffect,
  getCreatureCountEffectConfig,
  countCreaturesWithFilter,
  CREATURE_COUNT_CARDS,
  type CreatureCountEffectConfig,
} from './creatureCountCards';

// Planeswalker Cards
export {
  isSpecialPlaneswalker,
  getPlaneswalkerConfig,
  canActivatePlaneswalkerAbility,
  calculateNewLoyalty,
  PLANESWALKER_CARDS,
  type PlaneswalkerAbilityConfig,
} from './planeswalkerCards';
