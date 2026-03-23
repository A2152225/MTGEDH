import type { BattlefieldPermanent } from '../../shared/src';
import { cardAnalyzer, CardCategory, SynergyArchetype } from './CardAnalyzer';
import type { AIPlayerConfig } from './AIEngine';

export function getPrimaryArchetypes(config: AIPlayerConfig): readonly SynergyArchetype[] {
  return config.deckProfile?.primaryArchetypes || [];
}

export function getCombatDeckModifiers(
  perm: BattlefieldPermanent,
  config: AIPlayerConfig
): { attackBias: number; preserveBias: number } {
  const archetypes = getPrimaryArchetypes(config);
  if (archetypes.length === 0) {
    return { attackBias: 0, preserveBias: 0 };
  }

  const analysis = cardAnalyzer.analyzeCard(perm);
  const isCommander = Boolean((perm as any).isCommander) || analysis.categories.includes(CardCategory.COMMANDER);
  const isToken = Boolean((perm as any).isToken);
  let attackBias = 0;
  let preserveBias = 0;

  for (const archetype of archetypes) {
    switch (archetype) {
      case SynergyArchetype.ARISTOCRATS:
        if (analysis.details.hasDeathTrigger) attackBias += 10;
        if (analysis.categories.includes(CardCategory.ARISTOCRAT)) attackBias += 6;
        if (analysis.categories.includes(CardCategory.SACRIFICE_OUTLET)) preserveBias += 6;
        if (isToken) attackBias += 5;
        break;
      case SynergyArchetype.TOKENS:
        if (isToken || analysis.categories.includes(CardCategory.TOKEN_GENERATOR)) attackBias += 6;
        break;
      case SynergyArchetype.VOLTRON:
        if (isCommander) {
          attackBias += 14;
        } else {
          preserveBias += 8;
          attackBias -= 3;
        }
        break;
      case SynergyArchetype.COMBO:
        if (analysis.comboPotential >= 7) preserveBias += 14;
        if (analysis.categories.includes(CardCategory.TUTOR) || analysis.categories.includes(CardCategory.DRAW)) preserveBias += 4;
        break;
      case SynergyArchetype.SPELLSLINGER:
      case SynergyArchetype.STAX:
        if (analysis.details.producesMana || analysis.details.drawsCards || analysis.details.hasActivatedAbility) {
          preserveBias += 8;
        }
        break;
      case SynergyArchetype.LANDFALL:
        if (analysis.categories.includes(CardCategory.LANDFALL)) attackBias += 5;
        if (analysis.categories.includes(CardCategory.RAMP)) preserveBias += 3;
        break;
      case SynergyArchetype.GRAVEYARD:
        if (analysis.details.hasDeathTrigger) attackBias += 5;
        if (analysis.categories.includes(CardCategory.REANIMATOR)) preserveBias += 5;
        break;
    }
  }

  return { attackBias, preserveBias };
}

export function hasPotentialManaSink(gameState: any, playerId: string): boolean {
  const player = gameState.players.find((entry: any) => entry.id === playerId) as any;
  const hand = Array.isArray(player?.hand) ? player.hand : [];
  return hand.some((card: any) => typeof card === 'object' && card && typeof card.mana_cost === 'string' && card.mana_cost.length > 0);
}
