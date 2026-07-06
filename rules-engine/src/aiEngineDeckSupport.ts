import type { BattlefieldPermanent } from '../../shared/src';
import { cardAnalyzer, CardCategory, SynergyArchetype, type DeckArchetypeProfile } from './CardAnalyzer';
import { AIStrategy, type AIPlayerConfig } from './AIEngine';

function archetypeScore(profile: DeckArchetypeProfile, archetype: SynergyArchetype): number {
  return Number(profile.archetypeScores[archetype] || 0);
}

function goadPoliticsScore(profile: DeckArchetypeProfile): number {
  return Number(profile.synergyTagCounts?.goad_politics || 0);
}

function inferPoliticsStrategy(
  profile: DeckArchetypeProfile,
  controlScore: number,
  aggroScore: number,
  voltronScore: number,
): AIStrategy {
  const politicsScore = archetypeScore(profile, SynergyArchetype.POLITICS);
  const groupHugScore = archetypeScore(profile, SynergyArchetype.GROUP_HUG);
  const goadScore = goadPoliticsScore(profile);
  const removalDensity =
    Number(profile.categoryCounts?.removal || 0)
    + Number(profile.categoryCounts?.counterspell || 0)
    + Number(profile.categoryCounts?.board_wipe || 0);

  // Goad/punishment shells: sit back and let forced attacks do the work; wipes ≠ control tempo.
  if (goadScore >= 6 || (politicsScore >= 12 && goadScore >= 3)) {
    return AIStrategy.DEFENSIVE;
  }

  const goadPoliticsShell =
    politicsScore >= 10
    && voltronScore > politicsScore
    && groupHugScore < 9;

  if (goadPoliticsShell) {
    return AIStrategy.DEFENSIVE;
  }

  const kingMakerShell =
    groupHugScore >= 6
    || (politicsScore >= 15 && removalDensity >= 2)
    || controlScore >= 8
    || removalDensity >= 8;

  if (politicsScore >= 12 || groupHugScore >= 9) {
    if (kingMakerShell) {
      return AIStrategy.CONTROL;
    }
    return AIStrategy.DEFENSIVE;
  }

  if (controlScore >= aggroScore + 4) {
    return AIStrategy.CONTROL;
  }

  return AIStrategy.DEFENSIVE;
}

function tribalEngineScore(profile: DeckArchetypeProfile): number {
  return Number(profile.synergyTagCounts?.tribal_engine || 0);
}

function inferTribalStrategy(
  profile: DeckArchetypeProfile,
  controlScore: number,
  aggroScore: number,
): AIStrategy {
  const tribalScore = archetypeScore(profile, SynergyArchetype.TRIBAL);
  const tokensScore = archetypeScore(profile, SynergyArchetype.TOKENS);
  const engineScore = tribalEngineScore(profile);
  const removalDensity =
    Number(profile.categoryCounts?.removal || 0)
    + Number(profile.categoryCounts?.counterspell || 0)
    + Number(profile.categoryCounts?.board_wipe || 0);

  const tribalToolboxShell =
    engineScore >= 10
    || (tribalScore >= 15 && tokensScore >= 12);

  if (tribalToolboxShell) {
    const counterDensity = Number(profile.categoryCounts?.counterspell || 0);
    if (controlScore >= 8 || removalDensity >= 8 || counterDensity >= 2) {
      return AIStrategy.CONTROL;
    }
    return AIStrategy.DEFENSIVE;
  }

  if (tokensScore > tribalScore + 10) {
    return AIStrategy.AGGRESSIVE;
  }

  return AIStrategy.DEFENSIVE;
}

/** Infer combat temperament from deck contents; used instead of manual strategy selection. */
export function inferAIStrategyFromDeckProfile(
  profile: DeckArchetypeProfile | null | undefined,
): AIStrategy {
  if (!profile || profile.totalCards <= 0 || profile.primaryArchetypes.length === 0) {
    return AIStrategy.BASIC;
  }

  const politicsScore = archetypeScore(profile, SynergyArchetype.POLITICS);
  const voltronScore = archetypeScore(profile, SynergyArchetype.VOLTRON);
  const tribalScore = archetypeScore(profile, SynergyArchetype.TRIBAL);
  const tokensScore = archetypeScore(profile, SynergyArchetype.TOKENS);
  const engineScore = tribalEngineScore(profile);
  const goadScore = goadPoliticsScore(profile);
  const primary =
    goadScore >= 8 && politicsScore >= voltronScore * 0.4
      ? SynergyArchetype.POLITICS
      : politicsScore >= 25 && politicsScore >= voltronScore * 0.55
        ? SynergyArchetype.POLITICS
        : engineScore >= 10 && tribalScore >= 15 && tribalScore >= tokensScore * 0.65
          ? SynergyArchetype.TRIBAL
          : profile.primaryArchetypes[0];
  const comboScore = archetypeScore(profile, SynergyArchetype.COMBO);
  const controlScore =
    archetypeScore(profile, SynergyArchetype.SPELLSLINGER) + archetypeScore(profile, SynergyArchetype.STAX);
  const aggroScore =
    archetypeScore(profile, SynergyArchetype.TOKENS)
    + archetypeScore(profile, SynergyArchetype.VOLTRON)
    + archetypeScore(profile, SynergyArchetype.TRIBAL)
    + archetypeScore(profile, SynergyArchetype.LANDFALL);

  switch (primary) {
    case SynergyArchetype.COMBO:
      return AIStrategy.COMBO;
    case SynergyArchetype.STAX:
    case SynergyArchetype.SPELLSLINGER:
      return AIStrategy.CONTROL;
    case SynergyArchetype.POLITICS:
    case SynergyArchetype.GROUP_HUG:
      return inferPoliticsStrategy(profile, controlScore, aggroScore, voltronScore);
    case SynergyArchetype.ARISTOCRATS:
    case SynergyArchetype.GRAVEYARD:
    case SynergyArchetype.ENCHANTMENTS:
    case SynergyArchetype.ARTIFACTS:
      return aggroScore >= 12 ? AIStrategy.AGGRESSIVE : AIStrategy.DEFENSIVE;
    case SynergyArchetype.TOKENS:
    case SynergyArchetype.VOLTRON:
    case SynergyArchetype.LANDFALL:
      return AIStrategy.AGGRESSIVE;
    case SynergyArchetype.TRIBAL:
      return inferTribalStrategy(profile, controlScore, aggroScore);
    default:
      break;
  }

  if (comboScore >= 12 && profile.comboPairs.length >= 2) {
    return AIStrategy.COMBO;
  }
  if (controlScore >= aggroScore + 4) {
    return AIStrategy.CONTROL;
  }
  if (aggroScore >= 8) {
    return AIStrategy.AGGRESSIVE;
  }

  return AIStrategy.BASIC;
}

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
  const cardName = String((perm.card as { name?: string })?.name || '').trim();
  const oracleText = String((perm.card as { oracle_text?: string })?.oracle_text || '').toLowerCase();
  const isCommander = Boolean((perm as any).isCommander) || analysis.categories.includes(CardCategory.COMMANDER);
  const isToken = Boolean((perm as any).isToken);
  const anotherCreatureStrength = analysis.details.anotherCreatureTriggerStrength || 0;
  const goadPolitics = Number(config.deckProfile?.synergyTagCounts?.goad_politics || 0);
  const isGoadPoliticsShell =
    goadPolitics >= 6
    && (archetypes.includes(SynergyArchetype.POLITICS) || archetypes.includes(SynergyArchetype.ARISTOCRATS));
  let attackBias = 0;
  let preserveBias = 0;

  if (
    cardName &&
    config.deckProfile?.keyCards?.includes(cardName) &&
    (archetypes.includes(SynergyArchetype.ARISTOCRATS) || archetypes.includes(SynergyArchetype.TOKENS))
  ) {
    preserveBias += 10;
  }

  for (const archetype of archetypes) {
    switch (archetype) {
      case SynergyArchetype.ARISTOCRATS:
        // Payoff creatures (Zulaport, Blood Artist) belong on the board, not in combat.
        if (analysis.categories.includes(CardCategory.ARISTOCRAT)) {
          preserveBias += 12;
        } else if (analysis.details.hasDeathTrigger) {
          preserveBias += 4;
        }
        if (analysis.categories.includes(CardCategory.SACRIFICE_OUTLET)) preserveBias += 6;
        if (analysis.details.hasAnotherCreatureTrigger) {
          preserveBias += anotherCreatureStrength + 4;
        }
        if (isToken) attackBias += 2;
        break;
      case SynergyArchetype.TOKENS:
        if (isToken || analysis.categories.includes(CardCategory.TOKEN_GENERATOR)) attackBias += 3;
        // Token engines stay home; fodder attacks and dies for aristocrat payoffs.
        if (analysis.details.hasAnotherCreatureTrigger) {
          preserveBias += anotherCreatureStrength + 6;
        }
        break;
      case SynergyArchetype.VOLTRON:
        if (isGoadPoliticsShell) break;
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
      case SynergyArchetype.POLITICS:
      case SynergyArchetype.GROUP_HUG:
        if (analysis.categories.includes(CardCategory.PROTECTION)) preserveBias += 6;
        if (analysis.categories.includes(CardCategory.DRAW)) preserveBias += 3;
        if (analysis.details.producesMana) preserveBias += 2;
        // Goad commanders attack to hit power thresholds for mass goad, not commander damage.
        if (isCommander && isGoadPoliticsShell && /\bgoad\b/.test(oracleText)) {
          attackBias += 2;
        } else {
          attackBias -= 4;
        }
        break;
      case SynergyArchetype.TRIBAL:
        if (analysis.categories.includes(CardCategory.COUNTERSPELL)) preserveBias += 5;
        if (analysis.details.hasActivatedAbility) preserveBias += 5;
        if (analysis.categories.includes(CardCategory.TOKEN_GENERATOR)) preserveBias += 6;
        if (analysis.details.hasAnotherCreatureTrigger) preserveBias += 4;
        if (isToken) attackBias += 2;
        else if (analysis.categories.includes(CardCategory.TUTOR)) preserveBias += 4;
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
