// server/src/state/planeswalker/templates/registry-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/planeswalker/templates/registry.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays templates/registry.ts.
// Leaves must not import registry.ts or this index.
// Never create templates/registry/ beside registry.ts.

// Draw / exile-top / look-at-top / discard-draw loyalty regex tables.
export { DRAW_SELF_REGEXES } from "./planeswalkerTemplateDrawExileLookRegexes.js";

// Damage / destroy / emblem / mill / targeted-pump loyalty regex tables.
export { TARGET_PLAYER_DRAWS_N_CARDS_AND_LOSES_N_LIFE_REGEX } from "./planeswalkerTemplateDamageDestroyEmblemRegexes.js";

// Creature-pump / put-from-hand / counters / mana loyalty regex tables.
export { UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_REGEX } from "./planeswalkerTemplatePumpHandCounterManaRegexes.js";

// Control / fight / library-search / named-damage loyalty regex tables.
export { UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_PT_REGEX } from "./planeswalkerTemplateControlSearchNamedDamageRegexes.js";

// Draw / exile-top / early-search loyalty matcher if-chain.
export { tryMatchPlaneswalkerTemplateDrawExileSearch } from "./planeswalkerTemplateMatchDrawExileSearch.js";

// Library-search / look / draft / perpetual loyalty matcher if-chain.
export { tryMatchPlaneswalkerTemplateLookDraftPerpetual } from "./planeswalkerTemplateMatchLookDraftPerpetual.js";

// Pump / life / create-token / mid-chain loyalty matcher if-chain.
export { tryMatchPlaneswalkerTemplatePumpLifeCreate } from "./planeswalkerTemplateMatchPumpLifeCreate.js";

// Control / fight / named-damage / late-chain loyalty matcher if-chain.
export { tryMatchPlaneswalkerTemplateControlFightNamedDamage } from "./planeswalkerTemplateMatchControlFightNamedDamage.js";
