import type { BattlefieldPermanent, GameState, KnownCardRef, PlayerID } from '../../shared/src';
import { cardAnalyzer, CardCategory, SynergyArchetype } from './CardAnalyzer';
import type { AIPlayerConfig } from './AIEngine';
import { getCombinedPermanentText } from './permanentText';

type HasPermanentType = (perm: BattlefieldPermanent, type: string) => boolean;
type GetPrimaryArchetypes = (config: AIPlayerConfig) => readonly SynergyArchetype[];
type HasPotentialManaSink = (gameState: GameState, playerId: PlayerID) => boolean;
type GetProcessedBattlefield = (gameState: GameState) => BattlefieldPermanent[];

export interface ActivatedAbilityChoice {
  readonly permanent: BattlefieldPermanent;
  readonly abilityText: string;
  readonly value: number;
}

export function detectActivatedAbility(perm: BattlefieldPermanent): string | null {
  const card = perm.card as KnownCardRef;
  const oracleText = (card?.oracle_text || '').toLowerCase();

  if (!oracleText) return null;

  const activatedAbilityPattern = /\{(?:[0-9xX]+|[wubrgcWUBRGC]|[wubrgWUBRG]\/[wubrgWUBRG]|t)\}[\s,]*:/i;

  if (oracleText.includes('{t}:') || oracleText.includes('{t},')) {
    return card.oracle_text || null;
  }

  if (activatedAbilityPattern.test(oracleText)) {
    return card.oracle_text || null;
  }

  if (oracleText.includes('[+') || oracleText.includes('[-') || oracleText.includes('[0]')) {
    return card.oracle_text || null;
  }

  return null;
}

export function evaluateActivatedAbilityValue(
  perm: BattlefieldPermanent,
  abilityText: string,
  gameState: GameState,
  playerId: PlayerID,
  config: AIPlayerConfig,
  deps: {
    readonly getPrimaryArchetypes: GetPrimaryArchetypes;
    readonly hasPotentialManaSink: HasPotentialManaSink;
  }
): number {
  let value = 0;
  const lowerText = abilityText.toLowerCase();
  const card = perm.card as KnownCardRef;
  const analysis = cardAnalyzer.analyzeCard(perm);
  const archetypes = deps.getPrimaryArchetypes(config);
  const isOwnTurn = gameState.turnPlayer === playerId;
  const phase = String(gameState.phase || '').toLowerCase();
  const step = String(gameState.step || '').toLowerCase();
  const isMainPhase = phase.includes('main') || step.includes('main');
  const isPreCombat = isOwnTurn && isMainPhase && (!step || step.includes('precombat') || !step.includes('combat'));
  const isTapAbility = lowerText.includes('{t}:') || lowerText.includes('{t},');
  const isPureManaAbility =
    ((lowerText.includes('add {') && lowerText.includes('mana')) ||
      lowerText.includes('add {c}') ||
      lowerText.includes('add {w}') ||
      lowerText.includes('add {u}') ||
      lowerText.includes('add {b}') ||
      lowerText.includes('add {r}') ||
      lowerText.includes('add {g}')) &&
    !lowerText.includes('draw') &&
    !lowerText.includes('search your library') &&
    !lowerText.includes('create') &&
    !lowerText.includes('damage');

  if (lowerText.includes('draw') && !lowerText.includes('opponent draws')) {
    const drawMatch = lowerText.match(/draw (\w+) card/);
    if (drawMatch) {
      const countText = drawMatch[1];
      let drawCount = 1;
      const numericValue = parseInt(countText, 10);
      if (!isNaN(numericValue)) {
        drawCount = numericValue;
      } else {
        const numberWords: Record<string, number> = {
          a: 1,
          one: 1,
          two: 2,
          three: 3,
          four: 4,
          five: 5,
          six: 6,
          seven: 7,
          eight: 8,
          nine: 9,
          ten: 10,
        };
        drawCount = numberWords[countText] || 1;
      }
      value += drawCount * 15;
    } else {
      value += 15;
    }
  }

  if (
    (lowerText.includes('add {') && lowerText.includes('mana')) ||
    lowerText.includes('add {c}') ||
    lowerText.includes('add {w}') ||
    lowerText.includes('add {u}') ||
    lowerText.includes('add {b}') ||
    lowerText.includes('add {r}') ||
    lowerText.includes('add {g}')
  ) {
    value += 8;
  }

  if (lowerText.includes('search your library')) {
    value += 12;
  }

  if (lowerText.includes('create') && lowerText.includes('token')) {
    value += 6;
  }

  if (lowerText.includes('damage') && (lowerText.includes('opponent') || lowerText.includes('player'))) {
    value += 5;
  }

  if (lowerText.includes('destroy') || lowerText.includes('exile')) {
    value += 7;
  }

  if (lowerText.includes('gain') && lowerText.includes('life')) {
    value += 3;
  }

  if (lowerText.includes('+1/+1') || lowerText.includes('+2/+2')) {
    value += 4;
  }

  if (lowerText.includes('untap')) {
    value += 5;
  }

  if (isTapAbility) {
    value -= 1;
  }

  if (lowerText.includes('sacrifice')) {
    if (!lowerText.includes('sacrifice ~') && !lowerText.includes(`sacrifice ${card.name?.toLowerCase()}`)) {
      value -= 5;
    }
  }

  const manaCostMatch = lowerText.match(/\{([0-9]+|[wubrg])\}/g);
  if (manaCostMatch && manaCostMatch.length > 0) {
    const manaCost = manaCostMatch.filter(cost => !cost.includes('t}') && !cost.includes('t,')).length;
    value -= manaCost * 0.5;
  }

  if (lowerText.includes('opponent') && lowerText.includes('control')) {
    value -= 3;
  }

  if (lowerText.includes('each opponent') && (lowerText.includes('draw') || lowerText.includes('create'))) {
    value -= 4;
  }

  if (isPureManaAbility && !deps.hasPotentialManaSink(gameState, playerId)) {
    value -= 12;
  }

  if (isPreCombat && isTapAbility && archetypes.includes(SynergyArchetype.VOLTRON)) {
    const isCommander = Boolean((perm as any).isCommander) || analysis.categories.includes(CardCategory.COMMANDER);
    if (isCommander || analysis.categories.includes(CardCategory.CREATURE)) {
      value -= isCommander ? 25 : 10;
    }
  }

  if (archetypes.includes(SynergyArchetype.COMBO)) {
    if (analysis.comboPotential >= 7) {
      value += 8;
    }
    if (lowerText.includes('search your library') || lowerText.includes('untap') || lowerText.includes('draw')) {
      value += 6;
    }
    if (isPureManaAbility && analysis.details.producesMana) {
      value += 4;
    }
  }

  if (archetypes.includes(SynergyArchetype.SPELLSLINGER)) {
    if (lowerText.includes('draw')) value += 4;
    if (lowerText.includes('add {')) value += 2;
  }

  if (archetypes.includes(SynergyArchetype.ARISTOCRATS)) {
    if (lowerText.includes('sacrifice') && analysis.details.hasDeathTrigger) {
      value += 8;
    }
    if (lowerText.includes('create') && lowerText.includes('token')) {
      value += 3;
    }
  }

  return Math.max(0, value);
}

export function canActivateAbilityNow(
  perm: BattlefieldPermanent,
  gameState: GameState,
  playerId: PlayerID,
  deps: { readonly hasPermanentType: HasPermanentType }
): boolean {
  const oracleText = getCombinedPermanentText(perm);

  if (perm.tapped && oracleText.includes('{t}')) {
    return false;
  }

  if (perm.summoningSickness && oracleText.includes('{t}')) {
    if (deps.hasPermanentType(perm, 'creature') && !oracleText.includes('haste')) {
      return false;
    }
  }

  if (oracleText.includes("activated abilities can't be activated")) {
    return false;
  }

  if (
    oracleText.includes('activate only as a sorcery') ||
    oracleText.includes('activate this ability only any time you could cast a sorcery')
  ) {
    const phase = String(gameState.phase || '').toLowerCase();
    const isMainPhase = phase.includes('main');
    const isOwnTurn = gameState.turnPlayer === playerId;
    const stackEmpty = !gameState.stack || gameState.stack.length === 0;

    if (!isMainPhase || !isOwnTurn || !stackEmpty) {
      return false;
    }
  }

  return true;
}

export function findBestActivatedAbility(
  gameState: GameState,
  playerId: PlayerID,
  config: AIPlayerConfig,
  deps: {
    readonly getProcessedBattlefield: GetProcessedBattlefield;
    readonly hasPermanentType: HasPermanentType;
    readonly getPrimaryArchetypes: GetPrimaryArchetypes;
    readonly hasPotentialManaSink: HasPotentialManaSink;
  }
): ActivatedAbilityChoice | null {
  const battlefield = deps.getProcessedBattlefield(gameState);
  const myPermanents = battlefield.filter((perm: BattlefieldPermanent) => perm.controller === playerId);

  let bestAbility: ActivatedAbilityChoice | null = null;
  let bestValue = 0;

  for (const perm of myPermanents) {
    const abilityText = detectActivatedAbility(perm);
    if (!abilityText) continue;

    if (!canActivateAbilityNow(perm, gameState, playerId, { hasPermanentType: deps.hasPermanentType })) continue;

    const value = evaluateActivatedAbilityValue(perm, abilityText, gameState, playerId, config, {
      getPrimaryArchetypes: deps.getPrimaryArchetypes,
      hasPotentialManaSink: deps.hasPotentialManaSink,
    });

    if (value > bestValue) {
      bestValue = value;
      bestAbility = { permanent: perm, abilityText, value };
    }
  }

  return bestAbility && bestValue > 0 ? bestAbility : null;
}
