// server/src/rules-engine/staticEffects-handlers/staticEffectsKnownCards.ts
// Origin parent: server/src/rules-engine/staticEffects.ts
// Cluster moved: KNOWN_STATIC_EFFECT_CARDS and the known-static section comments.
// Public entry symbols: KNOWN_STATIC_EFFECT_CARDS.
//
// Leftover card-name table — unused by computeContinuousEffects. Behavior now
// comes from oracle parse into StaticEffectSpec (GY+land keywords, player
// hexproof, opponent P/T polarity, tap-for-mana grants). Keep an empty export
// so existing re-exports do not break.

export const KNOWN_STATIC_EFFECT_CARDS: Record<string, {
  grantsToCreatures?: string[];
  grantsToPlayer?: string[];
  affectsOtherCreatures?: boolean;
  affectsAllCreatures?: boolean;
  affectsOpponentCreatures?: boolean;
  powerToughnessBonus?: { power: number; toughness: number };
  requiresCondition?: string;
}> = {};
