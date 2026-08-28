import type { BattlefieldPermanent, GameState, KnownCardRef, PlayerID } from '../../shared/src';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';
import { cardAnalyzer, CardCategory, SynergyArchetype } from './CardAnalyzer';
import type { AIPlayerConfig } from './AIEngine';
import {
  battlefieldHasManaRetention,
  evaluateAttackManaEngineReconfigureAttachValue,
  getGreatestControlledCreaturePower,
  getPlayerGreenManaInPool,
  isAttackManaRetentionEquipmentText,
  isPowerScaledGreenManaAbilityText,
  readPermanentPower,
} from './aiEngineManaPoolSupport';
import { getCombinedPermanentText } from './permanentText';
import {
  isStationPermanentTypeLine,
  readStationChargeCreatureThresholdFromOracleText,
} from './stationPermanentUtils';
import {
  abilityAllowsAnyPlayerActivation,
  textAllowsAnyPlayerActivation,
} from '../../shared/src/anyPlayerActivatedAbility';

type HasPermanentType = (perm: BattlefieldPermanent, type: string) => boolean;
type GetPrimaryArchetypes = (config: AIPlayerConfig) => readonly SynergyArchetype[];
type HasPotentialManaSink = (gameState: GameState, playerId: PlayerID) => boolean;
type GetProcessedBattlefield = (gameState: GameState) => BattlefieldPermanent[];

function readProcessedBattlefield(
  deps: { readonly getProcessedBattlefield?: GetProcessedBattlefield },
  gameState: GameState,
): BattlefieldPermanent[] {
  if (typeof deps.getProcessedBattlefield === 'function') {
    return deps.getProcessedBattlefield(gameState);
  }
  return applyStaticAbilitiesToBattlefield((gameState.battlefield || []) as BattlefieldPermanent[]);
}

function permanentOracleText(perm: BattlefieldPermanent): string {
  return String((perm.card as KnownCardRef)?.oracle_text || '');
}

function playerMayActivatePermanent(perm: BattlefieldPermanent, playerId: PlayerID): boolean {
  return String(perm.controller || '') === String(playerId)
    || textAllowsAnyPlayerActivation(permanentOracleText(perm));
}

function candidateAllowsAnyPlayerActivation(perm: BattlefieldPermanent, abilityText: string): boolean {
  return abilityAllowsAnyPlayerActivation({
    scopedAbilityText: abilityText,
    cardOracleText: permanentOracleText(perm),
  });
}

export interface ActivatedAbilityChoice {
  readonly permanent: BattlefieldPermanent;
  readonly abilityId?: string;
  readonly abilityText: string;
  readonly value: number;
}

interface AIActivatedAbilityCandidate {
  readonly abilityId: string;
  readonly abilityText: string;
  readonly effectText: string;
}

function getAIActivatedAbilityCandidates(perm: BattlefieldPermanent): AIActivatedAbilityCandidate[] {
  const card = perm.card as KnownCardRef;
  const cardId = String((card as any)?.id || perm?.id || '').trim();
  const nativeOracleText = String(card?.oracle_text || '').trim();
  const lowerOracleText = nativeOracleText.toLowerCase();
  const typeLine = String(card?.type_line || '').toLowerCase();
  const candidates: AIActivatedAbilityCandidate[] = [];

  if (!cardId || !nativeOracleText) {
    return candidates;
  }

  let genericAbilityIndex = 0;

  if (typeLine.includes('planeswalker')) {
    const loyaltyAbilityPattern = /^([+−–—-]?\d+):\s*(.+)/gm;
    let loyaltyMatch: RegExpExecArray | null;
    let loyaltyIndex = 0;
    while ((loyaltyMatch = loyaltyAbilityPattern.exec(nativeOracleText)) !== null) {
      const loyaltyCost = String(loyaltyMatch[1] || '').replace(/[−–—]/g, '-').trim();
      const effectText = String(loyaltyMatch[2] || '').trim();
      if (!effectText) continue;
      candidates.push({
        abilityId: `pw-ability-${loyaltyIndex++}`,
        abilityText: `${loyaltyCost}: ${effectText}`,
        effectText,
      });
    }
    return candidates;
  }

  const lines = nativeOracleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const activatedAbilityPattern = /^(\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*(?:Sacrifice[^:]*|Pay[^:]*|Discard[^:]*|Exile[^:]*|Remove[^:]*|Tap[^:]*|Untap[^:]*))?)\s*:\s*(.+)$/i;
  const textOnlyActivatedAbilityPattern = /^((?:Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)[^:]*?)\s*:\s*(.+)$/i;

  for (const line of lines) {
    const activatedMatch = line.match(activatedAbilityPattern);
    if (activatedMatch) {
      const costText = String(activatedMatch[1] || '').trim();
      const effectText = String(activatedMatch[2] || '').trim();
      if (!costText || !effectText) continue;
      candidates.push({
        abilityId: `${cardId}-ability-${genericAbilityIndex++}`,
        abilityText: `${costText}: ${effectText}`,
        effectText,
      });
      continue;
    }

    const textOnlyMatch = line.match(textOnlyActivatedAbilityPattern);
    if (textOnlyMatch) {
      const costText = String(textOnlyMatch[1] || '').trim();
      const effectText = String(textOnlyMatch[2] || '').trim();
      if (!costText || !effectText) continue;
      candidates.push({
        abilityId: `${cardId}-ability-${genericAbilityIndex++}`,
        abilityText: `${costText}: ${effectText}`,
        effectText,
      });
    }
  }

  const reconfigureMatch = nativeOracleText.match(/reconfigure\s*(\{[^}]+\}|\d+)/i);
  if (reconfigureMatch && typeLine.includes('equipment')) {
    const reconfigureCost = reconfigureMatch[1].startsWith('{') ? reconfigureMatch[1] : `{${reconfigureMatch[1]}}`;
    candidates.push({
      abilityId: `${cardId}-reconfigure-attach-0`,
      abilityText: `Reconfigure ${reconfigureCost} attach`,
      effectText: 'attach to target creature you control',
    });
    candidates.push({
      abilityId: `${cardId}-reconfigure-unattach-1`,
      abilityText: `Reconfigure ${reconfigureCost} unattach`,
      effectText: 'unattach this equipment',
    });
  }

  const crewMatch = nativeOracleText.match(/crew\s*(\d+)/i);
  if (crewMatch && typeLine.includes('vehicle')) {
    candidates.push({
      abilityId: `${cardId}-crew-0`,
      abilityText: `Crew ${crewMatch[1]}`,
      effectText: `crew ${crewMatch[1]}`,
    });
  }

  const stationThreshold = readStationChargeCreatureThresholdFromOracleText(nativeOracleText);
  if (isStationPermanentTypeLine(typeLine) || lowerOracleText.includes('station')) {
    candidates.push({
      abilityId: `${cardId}-station-0`,
      abilityText: stationThreshold > 0 ? `Station ${stationThreshold}` : 'Station',
      effectText: stationThreshold > 0 ? `station ${stationThreshold}` : 'station',
    });
  }

  const levelUpMatch = nativeOracleText.match(/level\s+up\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (levelUpMatch) {
    candidates.push({
      abilityId: `${cardId}-level-up-0`,
      abilityText: `Level up ${levelUpMatch[1]}`,
      effectText: 'put a level counter on this permanent',
    });
  }

  const outlastMatch = nativeOracleText.match(/outlast\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (outlastMatch) {
    candidates.push({
      abilityId: `${cardId}-outlast-0`,
      abilityText: `Outlast ${outlastMatch[1]}`,
      effectText: 'put a +1/+1 counter on this creature',
    });
  }

  const boastMatch = nativeOracleText.match(/boast\s*[—-]\s*(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*([^.]+)/i);
  if (boastMatch) {
    const effectText = String(boastMatch[2] || '').trim();
    candidates.push({
      abilityId: `${cardId}-boast-0`,
      abilityText: `Boast ${boastMatch[1]}: ${effectText}`,
      effectText,
    });
  }

  const monstrosityMatch = nativeOracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*monstrosity\s+(\d+)/i);
  if (monstrosityMatch) {
    candidates.push({
      abilityId: `${cardId}-monstrosity-0`,
      abilityText: `${monstrosityMatch[1]}: Monstrosity ${monstrosityMatch[2]}`,
      effectText: `monstrosity ${monstrosityMatch[2]}`,
    });
  }

  const adaptMatch = nativeOracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*adapt\s+(\d+)/i);
  if (adaptMatch) {
    candidates.push({
      abilityId: `${cardId}-adapt-0`,
      abilityText: `${adaptMatch[1]}: Adapt ${adaptMatch[2]}`,
      effectText: `adapt ${adaptMatch[2]}`,
    });
  }

  const fortifyMatch = nativeOracleText.match(/fortify\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (fortifyMatch && typeLine.includes('fortification')) {
    candidates.push({
      abilityId: `${cardId}-fortify-0`,
      abilityText: `Fortify ${fortifyMatch[1]}`,
      effectText: 'attach this fortification to target land you control',
    });
  }

  return candidates;
}

export function detectActivatedAbility(perm: BattlefieldPermanent): string | null {
  const parsedCandidates = getAIActivatedAbilityCandidates(perm);
  if (parsedCandidates.length > 0) {
    return parsedCandidates[0].abilityText;
  }

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

function normalizeBatteryCounterType(rawTypePhrase: string): string | null {
  let counterType = String(rawTypePhrase || '')
    .trim()
    .toLowerCase()
    .replace(/^\s*(?:a|an)\s+/i, '')
    .replace(/\s+from\b.*$/i, '')
    .replace(/\s+/g, ' ');
  if (!counterType) return null;
  if (/\+\s*1\s*\/\s*\+\s*1/i.test(counterType) || /\bplus\s*one\b/.test(counterType)) return '+1/+1';
  if (/-\s*1\s*\/\s*-\s*1/i.test(counterType) || /\bminus\s*one\b/.test(counterType)) return '-1/-1';
  const first = counterType.split(/\s+/)[0];
  return String(first || '').toLowerCase() || null;
}

function detectManaBatteryCounterLoop(oracleText: string, cardName?: string): {
  paysOut: boolean;
  counterTypes: string[];
} {
  const lines = String(oracleText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const investTypes = new Set<string>();
  const payoutTypes = new Set<string>();
  const nameLower = String(cardName || '').trim().toLowerCase();

  for (const line of lines) {
    const lower = line.toLowerCase();
    const costPart = line.split(':')[0] || '';
    const effectPart = line.split(':').slice(1).join(':');

    const putMatch = lower.match(
      /\bput\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([^\s]+(?:\s+[^\s]+)?)\s+counters?\s+on\b/i,
    );
    if (putMatch && /\{[^}]+\}/.test(costPart)) {
      const counterType = normalizeBatteryCounterType(String(putMatch[1] || ''));
      if (counterType) investTypes.add(counterType);
    }

    const removeMatch = costPart.match(
      /\bremove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([^,;:]+?)\s+counters?(?:\s+from\s+([^,;:]+))?\b/i,
    );
    if (removeMatch && /\badd\b/i.test(effectPart) && (/\bmana\b/i.test(effectPart) || /\{[wubrgc]\}/i.test(effectPart))) {
      const sourceRef = String(removeMatch[2] || '').toLowerCase();
      const refersToSource = !sourceRef
        || /\b(this|this permanent|this artifact|this creature|this land|this enchantment|it|~|source)\b/i.test(sourceRef)
        || (nameLower.length > 0 && sourceRef.includes(nameLower));
      if (!refersToSource) continue;
      const counterType = normalizeBatteryCounterType(String(removeMatch[1] || ''));
      if (counterType) payoutTypes.add(counterType);
    }
  }

  const shared = [...investTypes].filter((type) => payoutTypes.has(type));
  return {
    paysOut: payoutTypes.size > 0,
    counterTypes: shared.length > 0 ? shared : [...payoutTypes],
  };
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
    readonly getProcessedBattlefield: GetProcessedBattlefield;
  }
): number {
  let value = 0;
  const lowerText = abilityText.toLowerCase();
  // Quoted granted abilities (Herd Heirloom's combat-damage draw) are not immediate effects.
  const effectText = lowerText.replace(/"[^"]*"/g, ' ');
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
      lowerText.includes('add an amount of') ||
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
  const battlefield = readProcessedBattlefield(deps, gameState);
  const hasRetention = battlefieldHasManaRetention(battlefield, playerId);

  // Standalone mana taps are not useful as an activate-ability decision: floating mana
  // empties between steps/phases, and spell payment activates mana abilities on its own.
  // Exception: a power-scaled green tap under retention (Omnath/Upwelling) banks a large
  // persistent pool, so it must outrank a one-mana dork on this path.
  if (
    isPureManaAbility
    && !(hasRetention && isTapAbility && isPowerScaledGreenManaAbilityText(lowerText))
  ) {
    return 0;
  }

  if (effectText.includes('draw') && !effectText.includes('opponent draws')) {
    const drawMatch = effectText.match(/draw (\w+) card/);
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

  // Xantcha, Sleeper Agent: "{3}: Xantcha's controller loses 2 life and you draw a card.
  // Any player may activate this ability." Draw is already scored above; the life loss is
  // a ping on the controller. That is a real play only when someone else controls it.
  const controllerLifeLossMatch = effectText.match(/controller loses (\d+) life/)
    || effectText.match(/loses (\d+) life and you draw/);
  if (controllerLifeLossMatch) {
    const amount = Number.parseInt(controllerLifeLossMatch[1], 10) || 0;
    if (String(perm.controller || '') === String(playerId)) {
      value -= amount * 8;
    } else {
      value += amount * 6;
    }
  }

  if (
    (lowerText.includes('add {') && lowerText.includes('mana')) ||
    lowerText.includes('add an amount of') ||
    lowerText.includes('add {c}') ||
    lowerText.includes('add {w}') ||
    lowerText.includes('add {u}') ||
    lowerText.includes('add {b}') ||
    lowerText.includes('add {r}') ||
    lowerText.includes('add {g}')
  ) {
    value += 8;
  }

  if (isPowerScaledGreenManaAbilityText(lowerText) && isTapAbility) {
    const greatestPower = getGreatestControlledCreaturePower(battlefield, playerId);
    value += Math.min(50, greatestPower * 2);
    if (hasRetention) {
      value += 18;
      value += Math.min(24, getPlayerGreenManaInPool(gameState, playerId));
    }
  }

  if (lowerText.includes('reconfigure') && /\battach\b/.test(lowerText) && !lowerText.includes('unattach')) {
    value += evaluateAttackManaEngineReconfigureAttachValue(gameState, playerId, perm);
  } else if (lowerText.includes('reconfigure') && lowerText.includes('unattach')) {
    // Unattach only makes it a creature again — never the first step of a host swap (one attach moves it).
    const directAttachValue = evaluateAttackManaEngineReconfigureAttachValue(gameState, playerId, perm);
    value -= directAttachValue > 20 ? directAttachValue + 12 : 10;
  }

  if (effectText.includes('search your library')) {
    value += 12;
  }

  if (effectText.includes('create') && effectText.includes('token')) {
    value += 6;
  }

  if (effectText.includes('damage') && (effectText.includes('opponent') || effectText.includes('player'))) {
    value += 5;
  }

  if (effectText.includes('destroy') || effectText.includes('exile')) {
    value += 7;
  }

  if (effectText.includes('gain') && effectText.includes('life')) {
    value += 3;
  }

  if (lowerText.includes('+1/+1') || lowerText.includes('+2/+2')) {
    value += 4;
  }

  // Mana-battery investment: pay mana now to put counters that later unlock remove-for-mana.
  // Covers Gemstone Array, Trigon charge lines, and similar pay-now / payout-later designs.
  const battery = detectManaBatteryCounterLoop(String(card?.oracle_text || ''), String(card?.name || ''));
  const putCounterMatch = lowerText.match(
    /\bput\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([^\s]+(?:\s+[^\s]+)?)\s+counters?\s+on\b/i,
  );
  if (putCounterMatch && battery.paysOut) {
    const putCountWord = String(putCounterMatch[1] || 'one').toLowerCase();
    const putCountMap: Record<string, number> = {
      a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    const putCount = putCountMap[putCountWord] || Number.parseInt(putCountWord, 10) || 1;
    const putType = String(putCounterMatch[2] || '').toLowerCase().split(/\s+/)[0];
    const relevantTypes = battery.counterTypes.length > 0
      ? battery.counterTypes
      : ['charge', 'storage', '+1/+1'];
    const investsRelevantType = relevantTypes.some((type) => {
      if (type === '+1/+1') return /\+1/.test(putType) || putType.includes('plus');
      return putType.includes(type) || type.includes(putType);
    });

    if (investsRelevantType) {
      const currentCounters = relevantTypes.reduce((sum, type) => {
        const counters = (perm as any)?.counters || {};
        if (type === '+1/+1') return sum + Number(counters['+1/+1'] || counters.p1p1 || 0);
        return sum + Number(counters[type] || 0);
      }, 0);
      // Keep charging with spare mana while waiting on plays; slight early-boost only.
      value += 5;
      if (currentCounters <= 0) value += 4;
      else if (currentCounters < 3) value += 2;
      if (isOwnTurn && isMainPhase) value += 2;
      const manaPool = (gameState as any)?.manaPool?.[playerId] || {};
      const floatingByColor = {
        white: Number(manaPool.white || 0),
        blue: Number(manaPool.blue || 0),
        black: Number(manaPool.black || 0),
        red: Number(manaPool.red || 0),
        green: Number(manaPool.green || 0),
        colorless: Number(manaPool.colorless || 0),
      };
      const floating = Object.values(floatingByColor).reduce((sum, amount) => sum + amount, 0);
      // Spare floating mana / off-color mana should prefer stocking the battery.
      if (floating >= 2) value += 8;
      const coloredAmounts = [
        floatingByColor.white,
        floatingByColor.blue,
        floatingByColor.black,
        floatingByColor.red,
        floatingByColor.green,
      ];
      const maxColored = Math.max(0, ...coloredAmounts);
      const coloredTotal = coloredAmounts.reduce((sum, amount) => sum + amount, 0);
      if (maxColored >= 2) value += 8;
      else if (coloredTotal >= 2) value += 5;
      value += Math.min(4, putCount);
    }
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
    const isTanukiStyleReconfigureAttach =
      lowerText.includes('reconfigure')
      && /\battach\b/.test(lowerText)
      && !lowerText.includes('unattach')
      && isAttackManaRetentionEquipmentText(String(card.oracle_text || ''));
    value -= isTanukiStyleReconfigureAttach ? 0 : manaCost * 0.5;
  }

  if (lowerText.includes('opponent') && lowerText.includes('control')) {
    value -= 3;
  }

  if (lowerText.includes('each opponent') && (lowerText.includes('draw') || lowerText.includes('create'))) {
    value -= 4;
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
    if (effectText.includes('search your library') || lowerText.includes('untap') || effectText.includes('draw')) {
      value += 6;
    }
    if (isPureManaAbility && analysis.details.producesMana) {
      value += 4;
    }
  }

  if (archetypes.includes(SynergyArchetype.SPELLSLINGER)) {
    if (effectText.includes('draw')) value += 4;
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
  const battlefield = readProcessedBattlefield(deps, gameState);

  let bestAbility: ActivatedAbilityChoice | null = null;
  let bestValue = 0;

  for (const perm of battlefield) {
    const isOwnPermanent = String(perm.controller || '') === String(playerId);
    if (!playerMayActivatePermanent(perm, playerId)) continue;
    if (!canActivateAbilityNow(perm, gameState, playerId, { hasPermanentType: deps.hasPermanentType })) continue;

    const abilityCandidates = getAIActivatedAbilityCandidates(perm);
    const scoredCandidates = abilityCandidates.length > 0
      ? abilityCandidates
      : (() => {
          const fallbackAbilityText = detectActivatedAbility(perm);
          return fallbackAbilityText
            ? [{ abilityId: '', abilityText: fallbackAbilityText, effectText: fallbackAbilityText }]
            : [];
        })();

    for (const candidate of scoredCandidates) {
      if (!isOwnPermanent && !candidateAllowsAnyPlayerActivation(perm, candidate.abilityText)) {
        continue;
      }
      const value = evaluateActivatedAbilityValue(perm, candidate.abilityText, gameState, playerId, config, {
        getPrimaryArchetypes: deps.getPrimaryArchetypes,
        hasPotentialManaSink: deps.hasPotentialManaSink,
        getProcessedBattlefield: deps.getProcessedBattlefield,
      });

      if (value > bestValue) {
        bestValue = value;
        bestAbility = {
          permanent: perm,
          ...(candidate.abilityId ? { abilityId: candidate.abilityId } : {}),
          abilityText: candidate.abilityText,
          value,
        };
      }
    }
  }

  return bestAbility && bestValue > 0 ? bestAbility : null;
}
