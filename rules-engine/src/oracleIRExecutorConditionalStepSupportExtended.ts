import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { collectCommandZoneObjects } from './oracleIRExecutorCommanderUtils';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { findObjectByIdInState, getCounterCountOnObject } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { getAmountOfManaSpent, getAmountOfSpecificManaSymbolSpent } from './oracleIRExecutorManaUtils';
import { getCardManaValue, isCardExiledWithSource } from './oracleIRExecutorPlayerUtils';
import { cardMatchesType } from './oracleIRExecutorZoneOps';
import {
  collectRevealedThisWayCardsLedgerFirst,
  isRevealedThisWayLedgerFirst,
  isSearchedLibraryThisWayLedgerFirst,
  resolveAntecedentContextualCards,
  resolveAntecedentDiscardedCards,
  resolveAntecedentMilledCards,
  resolveAntecedentMovedCards,
} from './oracleIRLedgerCardAccess';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

const EXILE_THIS_WAY_STEP_KINDS: readonly OracleEffectStep['kind'][] = [
  'exile',
  'exile_top',
  'impulse_exile_top',
  'move_zone',
];

export type ExtendedConditionalParams = {
  readonly normalizedRaw: string;
  readonly raw: string;
  readonly nextState: GameState;
  readonly controllerId: PlayerID;
  readonly ctx: OracleIRExecutionContext;
  readonly lastActionOutcome: LastActionOutcome;
  readonly lastMovedCards?: readonly any[];
  readonly lastDiscardedCards?: readonly any[];
  readonly lastExcessDamageDealtThisWay?: number;
  readonly step?: OracleEffectStep;
};

function evaluateAlternateCostPaidCondition(
  normalizedRaw: string,
  ctx: OracleIRExecutionContext
): boolean | null {
  if (
    normalizedRaw === "that cost wasn't paid" ||
    normalizedRaw === "that cost was not paid"
  ) {
    if (ctx.alternateCostPaid === true) return false;
    if (ctx.alternateCostPaid === false) return true;
    return null;
  }

  const paidMatch = normalizedRaw.match(/^the ((?:\{[^}]+\})+|\d+[wubrg]+) cost was paid$/i);
  if (paidMatch) {
    if (ctx.alternateCostPaid === true) return true;
    if (ctx.alternateCostPaid === false) return false;
    return null;
  }

  return null;
}

function parseSmallNumberWord(text: string): number | null {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const lookup: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    twenty: 20, thirty: 30,
  };
  return Number.isFinite(lookup[raw]) ? lookup[raw] : null;
}

function getSpellsCastLastTurnCount(state: GameState): number | null {
  const count = (state as any)?.spellsCastLastTurnCount;
  if (typeof count === 'number') return count;
  const counts = (state as any)?.spellsCastLastTurnByPlayerCounts;
  if (counts && typeof counts === 'object') {
    return Object.values(counts as Record<string, unknown>).reduce<number>(
      (sum, value) => sum + (typeof value === 'number' ? value : 0),
      0
    );
  }
  return null;
}

function getSpellsCastLastTurnByPlayerCounts(state: GameState): Record<string, number> | null {
  const counts = (state as any)?.spellsCastLastTurnByPlayerCounts;
  if (counts && typeof counts === 'object') return counts as Record<string, number>;
  const legacy = (state as any)?.spellsCastLastTurn;
  if (legacy && typeof legacy === 'object') return legacy as Record<string, number>;
  return null;
}

function opponentLostLifeThisTurn(state: GameState, controllerId: PlayerID): boolean {
  const map = (state as any)?.lifeLostThisTurn || {};
  return Object.entries(map).some(([playerId, amount]) => playerId !== controllerId && Number(amount) > 0);
}

function matchesTypeLine(value: unknown, typeName: string): boolean {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return new RegExp(`\\b${typeName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function objectHasType(object: any, typeName: string): boolean {
  const normalized = String(typeName || '').trim().toLowerCase();
  if (!normalized) return false;
  if (hasExecutorClass(object, normalized)) return true;
  return matchesTypeLine(getExecutorTypeLineLower(object), normalized);
}

function getReferencedObject(nextState: GameState, ctx: OracleIRExecutionContext): any | null {
  const battlefield = getProcessedBattlefield(nextState);
  const id =
    String(ctx.targetPermanentId || '').trim() ||
    String(ctx.targetCreatureId || '').trim() ||
    String((ctx.selectorContext?.chosenObjectIds || [])[0] || '').trim() ||
    String(ctx.sourceId || '').trim();
  if (!id) return null;
  return findObjectByIdInState(nextState, battlefield as any, id);
}

function getCreaturePower(perm: any): number {
  const base = perm?.power ?? perm?.card?.power ?? perm?.basePower;
  let power = Number.parseInt(String(base ?? '0'), 10);
  if (!Number.isFinite(power)) power = 0;
  const counters = ((perm as any)?.counters || {}) as Record<string, unknown>;
  power += Number(counters['+1/+1'] ?? 0);
  power -= Number(counters['-1/-1'] ?? 0);
  return power;
}

function getCreatureToughness(perm: any): number {
  const base = perm?.toughness ?? perm?.card?.toughness ?? perm?.baseToughness;
  let toughness = Number.parseInt(String(base ?? '0'), 10);
  if (!Number.isFinite(toughness)) toughness = 0;
  const counters = ((perm as any)?.counters || {}) as Record<string, unknown>;
  toughness += Number(counters['+1/+1'] ?? 0);
  toughness -= Number(counters['-1/-1'] ?? 0);
  return toughness;
}

function controlledCreatures(nextState: GameState, controllerId: PlayerID): any[] {
  return (getProcessedBattlefield(nextState) as any[]).filter(
    (perm: any) =>
      String(perm?.controller || '').trim() === String(controllerId || '').trim() &&
      objectHasType(perm, 'creature')
  );
}

function getTeamPlayerIds(nextState: GameState, controllerId: PlayerID): readonly string[] {
  const normalizedControllerId = String(controllerId || '').trim();
  const teams = (nextState as any)?.teams;
  if (Array.isArray(teams)) {
    for (const team of teams) {
      const playerIds = Array.isArray(team?.playerIds)
        ? team.playerIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : [];
      if (playerIds.includes(normalizedControllerId)) return playerIds;
    }
  }
  return normalizedControllerId ? [normalizedControllerId] : [];
}

function countControlledMatchingDescriptor(nextState: GameState, controllerId: PlayerID, descriptor: string): number {
  const parts = String(descriptor || '')
    .trim()
    .toLowerCase()
    .split(/\s+or\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    return parts.some(part => objectHasType(perm, part.replace(/^an?\s+/, '')));
  }).length;
}

function antecedentApplied(outcome: LastActionOutcome, stepKinds: readonly OracleEffectStep['kind'][]): boolean {
  return outcome?.kind === 'applied' && stepKinds.includes(outcome.stepKind);
}

function cardMatchesChosenColor(card: any, chosenColor: string): boolean {
  const normalized = String(chosenColor || '').trim().toLowerCase();
  if (!normalized) return false;
  const colorLetterMap: Record<string, string> = {
    white: 'w',
    blue: 'u',
    black: 'b',
    red: 'r',
    green: 'g',
    w: 'w',
    u: 'u',
    b: 'b',
    r: 'r',
    g: 'g',
  };
  const targetLetter = colorLetterMap[normalized] || normalized.slice(0, 1);
  const colors = Array.isArray(card?.colors)
    ? card.colors
    : Array.isArray(card?.card?.colors)
      ? card.card.colors
      : [];
  if (
    colors.some(
      (entry: unknown) => String(entry || '').trim().toLowerCase() === targetLetter
    )
  ) {
    return true;
  }
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  if (targetLetter === 'w' && /\bplains\b/.test(typeLine)) return true;
  if (targetLetter === 'u' && /\bisland\b/.test(typeLine)) return true;
  if (targetLetter === 'b' && /\bswamp\b/.test(typeLine)) return true;
  if (targetLetter === 'r' && /\bmountain\b/.test(typeLine)) return true;
  if (targetLetter === 'g' && /\bforest\b/.test(typeLine)) return true;
  return false;
}

function cardsMatchDescriptor(cards: readonly any[] | any, descriptor: string): boolean {
  const list = Array.isArray(cards) ? cards : cards != null && typeof cards === 'object' ? [cards] : [];
  const normalized = String(descriptor || '')
    .trim()
    .toLowerCase()
    .replace(/^an?\s+/, '')
    .replace(/\s+cards?$/, '');
  if (!normalized) return list.length > 0;
  if (normalized.startsWith('non')) {
    const inner = normalized.slice(3).trim();
    return list.some(card => !objectHasType(card, inner));
  }
  return list.some(card => objectHasType(card, normalized));
}

function getStackSpellPower(nextState: GameState, ctx: OracleIRExecutionContext): number | null {
  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (!targetSpellId) return null;
  const stackSpell = ((nextState as any)?.stack || []).find(
    (entry: any) => String(entry?.id || '').trim() === targetSpellId
  );
  if (!stackSpell) return null;
  const card = (stackSpell as any)?.card || stackSpell;
  const power = Number(card?.power ?? card?.card?.power);
  return Number.isFinite(power) ? power : null;
}

function countBasicLandTypesAmongLandsYouControl(nextState: GameState, controllerId: PlayerID): number {
  const basicTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
  const types = new Set<string>();
  for (const perm of getProcessedBattlefield(nextState) as any[]) {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    if (!objectHasType(perm, 'land')) continue;
    const typeLine = getExecutorTypeLineLower(perm);
    for (const basic of basicTypes) {
      if (typeLine.includes(basic)) types.add(basic);
    }
  }
  return types.size;
}

function getControllerLife(nextState: GameState, controllerId: PlayerID): number | null {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === controllerId) as any;
  const life = Number(player?.life);
  return Number.isFinite(life) ? life : null;
}

function getPlayerHandCount(nextState: GameState, playerId: PlayerID): number {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === playerId) as any;
  return Array.isArray(player?.hand) ? player.hand.length : 0;
}

function objectHasAnyCounters(object: any): boolean {
  const counters = (object as any)?.counters;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) return false;
  return Object.values(counters as Record<string, unknown>).some((value) => Number(value) > 0);
}

function isPermanentInCommandZoneOrBattlefield(
  nextState: GameState,
  controllerId: PlayerID,
  sourceId: string
): boolean | null {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return null;

  const battlefield = getProcessedBattlefield(nextState) as any[];
  if (battlefield.some((perm) => String(perm?.id || '').trim() === normalizedSourceId)) {
    return true;
  }

  const findById = (idRaw: string) =>
    findObjectByIdInState(nextState, battlefield as any, idRaw);
  const commandZoneObjects = collectCommandZoneObjects(nextState, controllerId, findById);
  if (
    commandZoneObjects.some((entry) => {
      const id = String(entry?.id || entry?.card?.id || '').trim();
      return id === normalizedSourceId;
    })
  ) {
    return true;
  }

  const player = (nextState.players || []).find(
    (entry: any) => String(entry?.id || '').trim() === String(controllerId).trim()
  ) as any;
  const playerCommandZone = Array.isArray(player?.commandZone) ? player.commandZone : [];
  if (
    playerCommandZone.some((entry: any) => String(entry?.id || entry?.card?.id || '').trim() === normalizedSourceId)
  ) {
    return true;
  }

  const stateCommandZone = (nextState as any)?.commandZone;
  if (stateCommandZone && typeof stateCommandZone === 'object') {
    return false;
  }
  if (playerCommandZone.length > 0 || commandZoneObjects.length > 0) {
    return false;
  }
  return null;
}

function getGraveyardCards(nextState: GameState, controllerId: PlayerID): any[] {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === controllerId) as any;
  return Array.isArray(player?.graveyard) ? player.graveyard : [];
}

function getDieRollResult(nextState: GameState, controllerId: PlayerID): number | null {
  const playerRoll = (nextState as any)?.lastDieRollByPlayer?.[controllerId];
  if (typeof playerRoll === 'number' && Number.isFinite(playerRoll)) return playerRoll;
  if (playerRoll && Number.isFinite(Number(playerRoll.result))) return Number(playerRoll.result);
  const globalLast = (nextState as any)?.lastDieRoll;
  if (globalLast && String(globalLast?.playerId || '').trim() === controllerId && Number.isFinite(Number(globalLast?.result))) {
    return Number(globalLast.result);
  }
  return null;
}

function movedCardsFrom(params: ExtendedConditionalParams): any[] {
  return resolveAntecedentMovedCards(params.ctx, { lastMovedCards: params.lastMovedCards }) as any[];
}

function discardedCardsFrom(params: ExtendedConditionalParams): any[] {
  return resolveAntecedentDiscardedCards(params.ctx, {
    lastDiscardedCards: params.lastDiscardedCards,
  }) as any[];
}

function milledCardsFrom(ctx: OracleIRExecutionContext): any[] {
  return resolveAntecedentMilledCards(ctx) as any[];
}

function contextualCardsFrom(params: ExtendedConditionalParams): any[] {
  return resolveAntecedentContextualCards(params.ctx, {
    lastMovedCards: params.lastMovedCards,
    lastDiscardedCards: params.lastDiscardedCards,
  }) as any[];
}

function getConditionalSubjectCard(params: ExtendedConditionalParams): any | null {
  const moved = movedCardsFrom(params);
  if (Array.isArray(moved) && moved.length > 0) return moved[moved.length - 1];
  return getReferencedObject(params.nextState, params.ctx);
}

function getCardTypeSet(card: any): Set<string> {
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  const types = [
    'artifact',
    'battle',
    'creature',
    'enchantment',
    'instant',
    'land',
    'planeswalker',
    'sorcery',
    'kindred',
  ];
  return new Set(types.filter(typeName => typeLine.includes(typeName)));
}

function cardsShareCardType(left: any, right: any): boolean {
  const leftTypes = getCardTypeSet(left);
  if (leftTypes.size === 0) return false;
  const rightTypes = getCardTypeSet(right);
  for (const typeName of leftTypes) {
    if (rightTypes.has(typeName)) return true;
  }
  return false;
}

function isPermanentAttacking(perm: any): boolean {
  return Boolean(perm?.attacking || perm?.isAttacking || perm?.attackedThisTurn);
}

function anyCreatureAttackedThisTurn(nextState: GameState): boolean {
  const tracked = (nextState as any)?.creaturesAttackedThisTurn;
  if (tracked && typeof tracked === 'object') {
    return Object.values(tracked as Record<string, unknown>).some(
      (value) => typeof value === 'number' && value > 0
    );
  }
  return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
    if (!objectHasType(perm, 'creature')) return false;
    return isPermanentAttacking(perm);
  });
}

function sourceDealtDamageToOpponentThisTurn(
  nextState: GameState,
  controllerId: PlayerID,
  sourceId: string
): boolean | null {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return null;
  const opponentIds = (nextState.players || [])
    .map((player: any) => String(player?.id || '').trim())
    .filter((playerId) => playerId && playerId !== String(controllerId).trim());
  if (opponentIds.length === 0) return false;

  const tracker = (nextState as any)?.creaturesThatDealtDamageToPlayer;
  if (tracker && typeof tracker === 'object') {
    return opponentIds.some((opponentId) => {
      const entry = (tracker as Record<string, unknown>)[opponentId];
      return Boolean(entry && typeof entry === 'object' && (entry as any)[normalizedSourceId]);
    });
  }
  return null;
}

function findBattlefieldPermanentByName(nextState: GameState, name: string): any | null {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;
  return (
    (getProcessedBattlefield(nextState) as any[]).find(
      (perm: any) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === normalized
    ) ?? null
  );
}

function countCreaturesControlledBy(nextState: GameState, playerId: PlayerID): number {
  return (getProcessedBattlefield(nextState) as any[]).filter(
    (perm: any) =>
      String(perm?.controller || '').trim() === String(playerId || '').trim() &&
      objectHasType(perm, 'creature')
  ).length;
}

function countExiledCardsWithSource(nextState: GameState, sourceId: string): number {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return 0;
  let count = 0;
  for (const player of nextState.players || []) {
    const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
    count += exile.filter((card: any) => isCardExiledWithSource(card, normalizedSourceId)).length;
  }
  return count;
}

function findExiledCardWithSource(nextState: GameState, sourceId: string): any | null {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return null;
  for (const player of nextState.players || []) {
    const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
    const found = exile.find((card: any) => isCardExiledWithSource(card, normalizedSourceId));
    if (found) return found;
  }
  return null;
}

function getPlayerPoisonCount(nextState: GameState, playerId: string): number {
  const map = (nextState as any)?.poisonCounters as Record<string, unknown> | undefined;
  const fromMap = Number(map?.[playerId]);
  if (Number.isFinite(fromMap)) return fromMap;
  const player = (nextState.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  const fromPlayer = Number(player?.poisonCounters);
  return Number.isFinite(fromPlayer) ? fromPlayer : 0;
}

function getStackSpellCard(nextState: GameState, ctx: OracleIRExecutionContext): any | null {
  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (!targetSpellId) return null;
  const stackSpell = ((nextState as any)?.stack || []).find(
    (entry: any) => String(entry?.id || '').trim() === targetSpellId
  );
  if (!stackSpell) return null;
  return (stackSpell as any)?.card || stackSpell;
}

function getCastManaSpendSource(nextState: GameState, ctx: OracleIRExecutionContext): any | null {
  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (targetSpellId) {
    const stackItem = ((nextState as any)?.stack || []).find(
      (entry: any) => String(entry?.id || '').trim() === targetSpellId
    );
    if (stackItem) return stackItem;
  }
  const stackSpell = getStackSpellCard(nextState, ctx);
  if (stackSpell) return stackSpell;
  return getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );
}

function objectHasKeyword(object: any, keyword: string): boolean {
  const normalized = String(keyword || '').trim().toLowerCase();
  if (!normalized || !object) return false;
  if (objectHasType(object, normalized)) return true;
  const keywords = (object as any)?.keywords ?? (object as any)?.card?.keywords;
  if (Array.isArray(keywords)) {
    return keywords.some((entry: string) => String(entry).toLowerCase().includes(normalized));
  }
  const oracleText = String((object as any)?.oracle_text ?? (object as any)?.card?.oracle_text ?? '').toLowerCase();
  return oracleText.length > 0 ? new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(oracleText) : false;
}

function getControlledTypeEnteredThisTurnCount(
  nextState: GameState,
  controllerId: PlayerID,
  typeLower: string,
  excludeId?: string
): number | null {
  const key = String(controllerId || '').trim();
  const countMapByType: Record<string, string> = {
    artifact: 'artifactsEnteredBattlefieldThisTurnByController',
    creature: 'creaturesEnteredBattlefieldThisTurnByController',
    enchantment: 'enchantmentsEnteredBattlefieldThisTurnByController',
    planeswalker: 'planeswalkersEnteredBattlefieldThisTurnByController',
    land: 'landsEnteredBattlefieldThisTurn',
    battle: 'battlesEnteredBattlefieldThisTurnByController',
  };
  const booleanMapByType: Record<string, string> = {
    artifact: 'artifactEnteredThisTurn',
    creature: 'creatureEnteredThisTurn',
    enchantment: 'enchantmentEnteredThisTurn',
    planeswalker: 'planeswalkerEnteredThisTurn',
    land: 'landEnteredThisTurn',
    battle: 'battleEnteredThisTurn',
    food: 'foodEnteredThisTurn',
  };
  const idsMapByType: Record<string, string> = {
    artifact: 'artifactsEnteredBattlefieldThisTurnIdsByController',
    creature: 'creaturesEnteredBattlefieldThisTurnIdsByController',
    enchantment: 'enchantmentsEnteredBattlefieldThisTurnIdsByController',
    planeswalker: 'planeswalkersEnteredBattlefieldThisTurnIdsByController',
    battle: 'battlesEnteredBattlefieldThisTurnIdsByController',
  };

  let count: number | null = null;
  const countMapKey = countMapByType[typeLower];
  if (countMapKey) {
    const map = (nextState as any)?.[countMapKey];
    if (map && typeof map === 'object') {
      const raw = Number(map[key]);
      count = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    }
  }
  if (count === null) {
    const legacyKey = typeLower === 'creature' ? 'creaturesEnteredThisTurn' : null;
    if (legacyKey) {
      const raw = Number((nextState as any)?.[legacyKey]?.[key]);
      if (Number.isFinite(raw)) count = Math.max(0, raw);
    }
  }
  if (count === null) {
    const boolKey = booleanMapByType[typeLower];
    if (boolKey) {
      const flag = (nextState as any)?.[boolKey]?.[key];
      if (typeof flag === 'boolean') count = flag ? 1 : 0;
    }
  }
  if (count === null) return null;

  if (!excludeId) return count;
  const normalizedExcludeId = String(excludeId || '').trim();
  if (!normalizedExcludeId) return count;

  const idsMapKey = idsMapByType[typeLower];
  if (idsMapKey) {
    const idsForController = (nextState as any)?.[idsMapKey]?.[key];
    if (idsForController && typeof idsForController === 'object') {
      return (idsForController as any)[normalizedExcludeId] === true ? Math.max(0, count - 1) : count;
    }
  }

  const source = (getProcessedBattlefield(nextState) as any[]).find(
    (perm: any) => String(perm?.id || '').trim() === normalizedExcludeId
  );
  if (source && String(source?.controller || '').trim() === key && source?.enteredThisTurn === true) {
    const typeLine = getExecutorTypeLineLower(source);
    if (typeLine.includes(typeLower)) return Math.max(0, count - 1);
  }
  return count >= 2 ? 1 : count === 1 ? null : 0;
}

function controllerCastBothCreatureAndNoncreatureThisTurn(
  nextState: GameState,
  controllerId: PlayerID
): boolean | null {
  const key = String(controllerId || '').trim();
  const explicit = (nextState as any)?.castBothCreatureAndNoncreatureSpellThisTurn?.[key];
  if (typeof explicit === 'boolean') return explicit;

  const spells = (nextState as any)?.spellsCastThisTurn;
  if (Array.isArray(spells)) {
    const playerSpells = spells.filter(
      (entry: any) => String(entry?.casterId || entry?.controller || '').trim() === key
    );
    let hasCreature = false;
    let hasNoncreature = false;
    let unknown = false;
    for (const spell of playerSpells) {
      const typeLine = String(spell?.card?.type_line ?? spell?.type_line ?? '').toLowerCase();
      if (!typeLine) {
        unknown = true;
        continue;
      }
      if (typeLine.includes('creature')) hasCreature = true;
      else hasNoncreature = true;
    }
    if (hasCreature && hasNoncreature) return true;
    if (!unknown) return false;
  }

  const noncreatureCount = Number((nextState as any)?.noncreatureSpellsCastThisTurn?.[key] ?? NaN);
  const creatureCount = Number((nextState as any)?.creatureSpellsCastThisTurn?.[key] ?? NaN);
  if (Number.isFinite(creatureCount) && Number.isFinite(noncreatureCount)) {
    return creatureCount >= 1 && noncreatureCount >= 1;
  }

  if (Number.isFinite(noncreatureCount) && spells && typeof spells === 'object' && !Array.isArray(spells)) {
    const totalCount = Number((spells as Record<string, number>)[key] ?? NaN);
    if (Number.isFinite(totalCount)) {
      const derivedCreatureCount = Math.max(0, totalCount - noncreatureCount);
      return derivedCreatureCount >= 1 && noncreatureCount >= 1;
    }
  }

  return false;
}

function getEnchantedCreatureFromAura(nextState: GameState, ctx: OracleIRExecutionContext): any | null {
  const source = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );
  const attachedTo = String((source as any)?.attachedTo || '').trim();
  if (!attachedTo) return null;
  return findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attachedTo);
}

function getStackItemTargetCount(nextState: GameState, ctx: OracleIRExecutionContext): number | null {
  const stackItemFromCtx = (ctx as any)?.stackItem;
  if (stackItemFromCtx && typeof stackItemFromCtx === 'object') {
    const fromCtx = getTargetCountFromStackItemLike(stackItemFromCtx);
    if (fromCtx !== null) return fromCtx;
  }
  const targetSpellId = String(
    ctx.targetSpellId ||
      ctx.selectorContext?.targetSpellId ||
      (ctx as any).triggeringStackItemId ||
      (ctx as any).triggeringSpellStackItemId ||
      ''
  ).trim();
  if (!targetSpellId) return null;
  const stackItem = ((nextState as any)?.stack || []).find(
    (entry: any) => String(entry?.id || '').trim() === targetSpellId
  );
  return getTargetCountFromStackItemLike(stackItem);
}

function getTargetCountFromStackItemLike(stackItem: any): number | null {
  if (!stackItem || typeof stackItem !== 'object') return null;
  const targets = (stackItem as any).targets;
  if (Array.isArray(targets)) return targets.length;
  if ((stackItem as any).target != null) return 1;
  if ((stackItem as any).targetId != null) return 1;
  if (typeof (stackItem as any).targetCount === 'number') return (stackItem as any).targetCount;
  return null;
}

function permanentHasExiledCards(source: any, nextState: GameState, sourceId: string): boolean {
  const candidates = [
    (source as any)?.exiledCards,
    (source as any)?.cardsExiledWith,
    (source as any)?.exiledWith,
    (source as any)?.exiledCardIds,
    (source as any)?.card?.exiledCards,
    (source as any)?.card?.cardsExiledWith,
    (source as any)?.card?.exiledWith,
    (source as any)?.card?.exiledCardIds,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.length > 0;
    if (candidate && typeof candidate === 'object') return Object.keys(candidate as object).length > 0;
    if (typeof candidate === 'string') return candidate.length > 0;
  }
  if (sourceId && countExiledCardsWithSource(nextState, sourceId) > 0) return true;
  const linked = (nextState as any)?.linkedExiles;
  if (Array.isArray(linked) && sourceId) {
    return linked.some((entry: any) => String(entry?.exilingPermanentId ?? '').trim() === sourceId);
  }
  return false;
}

function isNonbasicLand(card: any): boolean {
  const typeLine = getExecutorTypeLineLower(card);
  if (!typeLine.includes('land')) return false;
  return !/\bbasic\b/.test(typeLine);
}

function getSourceCounterCount(nextState: GameState, ctx: OracleIRExecutionContext, counterName: string): number {
  const source = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );
  if (!source) return 0;
  const count = Number(((source as any)?.counters || {})[counterName] ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function getLastAntecedentCreaturePower(params: ExtendedConditionalParams): number | null {
  const moved = movedCardsFrom(params);
  const card = moved.find(entry => objectHasType(entry, 'creature')) ?? moved[0];
  if (!card) return null;
  if (Number.isFinite(Number((card as any)?.power))) return Number((card as any).power);
  if (Number.isFinite(Number((card as any)?.card?.power))) return Number((card as any).card.power);
  return null;
}

function evaluateThisWayClause(params: ExtendedConditionalParams): boolean | null {
  const { normalizedRaw, lastActionOutcome, ctx, controllerId, nextState } = params;
  if (!normalizedRaw.includes(' this way')) return null;

  if (lastActionOutcome?.kind === 'impossible') return false;

  if (normalizedRaw === 'you paid life this way') {
    return Boolean(
      ctx.lifePaidThisWay ??
        (ctx as any).paidLifeThisWay ??
        (nextState as any)?.lifePaidThisWay?.[controllerId]
    );
  }

  const moved = movedCardsFrom(params);
  const discarded = discardedCardsFrom(params);
  const milled = milledCardsFrom(ctx);

  if (/^you don't copy a spell this way$/.test(normalizedRaw)) {
    return lastActionOutcome?.stepKind === 'copy_spell' ? lastActionOutcome.kind !== 'applied' : false;
  }
  if (/^you don't draw a card this way$/.test(normalizedRaw) || /^you didn't draw cards this way$/.test(normalizedRaw)) {
    return lastActionOutcome?.stepKind === 'draw' ? lastActionOutcome.kind !== 'applied' : true;
  }
  if (/^you put no cards into your hand this way$/.test(normalizedRaw)) {
    return moved.length === 0;
  }
  if (/^no counters were removed this way$/.test(normalizedRaw)) {
    return lastActionOutcome?.stepKind === 'remove_counter' ? lastActionOutcome.kind !== 'applied' : true;
  }
  if (/^it deals damage to you this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['deal_damage', 'damage']);
  }
  if (/^damage is prevented this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['prevent_damage']);
  }
  if (/^one or more \+1\/\+1 counters are moved this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['move_counters', 'proliferate']);
  }
  if (/^a player is dealt damage this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['deal_damage', 'damage']);
  }
  if (normalizedRaw === 'a creature is dealt damage this way') {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if ((ctx as any)?.creatureDealtDamageThisWay === true) return true;
    if (!antecedentApplied(lastActionOutcome, ['deal_damage', 'damage'])) return false;
    const damaged = (ctx as any)?.lastDamagedCards ?? movedCardsFrom(params);
    const cards = Array.isArray(damaged) ? damaged : [];
    return cards.some((card) => objectHasType(card, 'creature'));
  }

  if (
    normalizedRaw === 'damage from a creature source is prevented this way' ||
    normalizedRaw === 'damage from a noncreature source is prevented this way'
  ) {
    const wantsCreature = normalizedRaw === 'damage from a creature source is prevented this way';
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (wantsCreature && (ctx as any)?.creatureDamagePreventedThisWay === true) return true;
    if (!wantsCreature && (ctx as any)?.noncreatureDamagePreventedThisWay === true) return true;
    if (wantsCreature && (ctx as any)?.noncreatureDamagePreventedThisWay === true) return false;
    if (!wantsCreature && (ctx as any)?.creatureDamagePreventedThisWay === true) return false;
    if (!antecedentApplied(lastActionOutcome, ['prevent_damage'])) return false;
    const sourceType = String((ctx as any)?.lastPreventedDamageSourceType ?? '').trim().toLowerCase();
    if (sourceType === 'creature') return wantsCreature;
    if (sourceType === 'noncreature') return !wantsCreature;
    const source = (ctx as any)?.lastPreventedDamageSource ?? (ctx as any)?.preventedDamageSource;
    if (source && typeof source === 'object') {
      if (objectHasType(source, 'creature')) return wantsCreature;
      const typeLine = getExecutorTypeLineLower(source);
      if (typeLine.length > 0 && !objectHasType(source, 'creature')) return !wantsCreature;
    }
    return null;
  }

  const youExiledMatch = normalizedRaw.match(/^you exiled (?:a|an) ([a-z0-9' -]+?) card this way$/);
  if (youExiledMatch) {
    const descriptor = String(youExiledMatch[1] || '').trim();
    if (antecedentApplied(lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS)) return cardsMatchDescriptor(moved, descriptor);
    return false;
  }
  if (normalizedRaw === 'you exiled a card this way') {
    return antecedentApplied(lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS) ? moved.length > 0 : false;
  }

  const putOntoBfMatch = normalizedRaw.match(/^you put (?:a|an) ([a-z0-9' -]+?) onto the battlefield this way$/);
  if (putOntoBfMatch) {
    return antecedentApplied(lastActionOutcome, ['move_zone', 'create_token']) ? cardsMatchDescriptor(moved, putOntoBfMatch[1]) : false;
  }

  const putIntoHandMatch = normalizedRaw.match(/^you put (?:a|an) ([a-z0-9' -]+?) (?:card )?into your hand this way$/);
  if (putIntoHandMatch) {
    return antecedentApplied(lastActionOutcome, ['move_zone', 'draw', 'search_library'])
      ? cardsMatchDescriptor(moved, putIntoHandMatch[1])
      : false;
  }
  if (normalizedRaw === 'you put a card into your hand this way' || normalizedRaw === 'you draw one or more cards this way') {
    return antecedentApplied(lastActionOutcome, ['draw', 'move_zone', 'search_library']);
  }
  if (normalizedRaw === 'you discarded a card this way') {
    return antecedentApplied(lastActionOutcome, ['discard']) ? discarded.length > 0 : false;
  }
  if (/^a creature card (?:is|was) exiled this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS)
      ? moved.some((card) => objectHasType(card, 'creature'))
      : false;
  }
  if (/^a noncreature card (?:is|was) exiled this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS)
      ? moved.some((card) => !objectHasType(card, 'creature'))
      : false;
  }
  if (normalizedRaw === "you didn't create a token this way") {
    return lastActionOutcome?.stepKind === 'create_token' ? lastActionOutcome.kind !== 'applied' : true;
  }

  const milledMatch = normalizedRaw.match(/^(?:a|an|at least one) ([a-z0-9' -]+?) (?:card )?(?:is|was|are) milled this way$/);
  if (milledMatch) {
    return cardsMatchDescriptor(milled, milledMatch[1]) || (antecedentApplied(lastActionOutcome, ['mill']) && milled.length > 0);
  }
  if (/two cards that share (?:all their )?card types were milled this way/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['mill']) && milled.length >= 2;
  }

  const discardedMatch = normalizedRaw.match(/^(?:a|an|two cards that share a card type are) ([a-z0-9' -]*?)cards? (?:was|were) discarded this way$/);
  if (discardedMatch || /discarded this way/.test(normalizedRaw)) {
    if (/two cards that share a card type are discarded this way/.test(normalizedRaw)) {
      return antecedentApplied(lastActionOutcome, ['discard']) && discarded.length >= 2;
    }
    const descriptorMatch = normalizedRaw.match(/^(?:a|an) ([a-z0-9' -]+?) card was discarded this way$/);
    if (descriptorMatch) {
      const descriptor = String(descriptorMatch[1] || '').trim();
      if (discarded.some(card => cardsMatchDescriptor([card], descriptor))) return true;
      return antecedentApplied(lastActionOutcome, ['discard'])
        ? cardsMatchDescriptor(discarded, descriptor)
        : false;
    }
    return antecedentApplied(lastActionOutcome, ['discard']) ? discarded.length > 0 : discarded.length > 0;
  }

  if (normalizedRaw === 'you reveal a creature card this way') {
    if (!antecedentApplied(lastActionOutcome, ['reveal_top'])) return false;
    const revealed = movedCardsFrom(params);
    return cardsMatchDescriptor(revealed, 'creature');
  }

  const revealedMatch = normalizedRaw.match(/^(?:a|an|all cards|you reveal a?) ([a-z0-9' -]*?)(?:cards? )?(?:is|are) revealed this way$/);
  if (revealedMatch || /revealed this way/.test(normalizedRaw)) {
    if (/all cards revealed this way are creature cards/.test(normalizedRaw)) {
      const revealedCards = collectRevealedThisWayCardsLedgerFirst(params.ctx, params.step);
      if (revealedCards.length > 0) {
        return revealedCards.every((card) => cardsMatchDescriptor(card, 'creature'));
      }
      return antecedentApplied(lastActionOutcome, ['look_choose_from_top', 'reveal', 'search_library']);
    }
    if (isRevealedThisWayLedgerFirst(params.ctx, params.step)) return true;
    return antecedentApplied(lastActionOutcome, ['look_choose_from_top', 'reveal', 'search_library', 'scry']);
  }

  const destroyedMatch = normalizedRaw.match(/^(?:a|an) ([a-z0-9' -]*?) (?:is|was) destroyed this way$/);
  if (destroyedMatch) {
    return antecedentApplied(lastActionOutcome, ['destroy']) && cardsMatchDescriptor(moved, destroyedMatch[1] || 'creature');
  }
  if (normalizedRaw === 'a creature you controlled was destroyed this way') {
    return antecedentApplied(lastActionOutcome, ['destroy']);
  }

  const gyPutMatch = normalizedRaw.match(/^that ([a-z0-9' -]+?) is put into a graveyard this way$/);
  if (gyPutMatch) {
    return antecedentApplied(lastActionOutcome, ['destroy', 'move_zone', 'sacrifice']);
  }

  if (/another desert was returned this way/.test(normalizedRaw) || /a permanent was returned this way/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['move_zone', 'return_to_hand']);
  }

  if (/^you (?:didn't|did not) put a card onto the battlefield this way$/.test(normalizedRaw)) {
    return !antecedentApplied(lastActionOutcome, ['move_zone']) || moved.length === 0;
  }

  if (/^you lost life this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['lose_life', 'pay_life']);
  }

  if (normalizedRaw === 'you cast a spell this way') {
    if (ctx.spellCastThisWay === true || ctx.selectorContext?.spellCastThisWay === true) return true;
    if (ctx.spellCastThisWay === false || ctx.selectorContext?.spellCastThisWay === false) return false;
    return antecedentApplied(lastActionOutcome, ['cast_spell', 'copy_spell']);
  }

  if (normalizedRaw === 'you cast a creature spell this way') {
    if (ctx.creatureSpellCastThisWay === true || ctx.selectorContext?.creatureSpellCastThisWay === true) {
      return true;
    }
    if (ctx.creatureSpellCastThisWay === false || ctx.selectorContext?.creatureSpellCastThisWay === false) {
      return false;
    }
    return antecedentApplied(lastActionOutcome, ['cast_spell', 'copy_spell']);
  }

  if (normalizedRaw === 'that creature dies this way') {
    if (ctx.creatureDiedThisWay === true || ctx.selectorContext?.creatureDiedThisWay === true) return true;
    if (ctx.creatureDiedThisWay === false || ctx.selectorContext?.creatureDiedThisWay === false) return false;
    return antecedentApplied(lastActionOutcome, ['destroy']);
  }

  return null;
}

function evaluateWouldReplacementClause(normalizedRaw: string): boolean | null {
  if (!/\bwould\b/.test(normalizedRaw)) return null;
  if (/would gain life/.test(normalizedRaw)) return true;
  if (/would draw a card/.test(normalizedRaw)) return true;
  if (/would be put into (?:a|your) graveyard/.test(normalizedRaw)) return true;
  if (/would die/.test(normalizedRaw)) return true;
  if (/would create .+ token instead/.test(normalizedRaw)) return true;
  if (/would deal .+ damage/.test(normalizedRaw)) return true;
  if (/would put one or more counters/.test(normalizedRaw)) return true;
  if (/would enter/.test(normalizedRaw)) return true;
  if (/would lose the game/.test(normalizedRaw)) return true;
  return null;
}

export function evaluateExtendedConditionalClause(params: ExtendedConditionalParams): boolean | null {
  const { normalizedRaw, raw, nextState, controllerId, ctx, lastActionOutcome, lastMovedCards } = params;

  const thisWay = evaluateThisWayClause(params);
  if (thisWay !== null) return thisWay;

  const would = evaluateWouldReplacementClause(normalizedRaw);
  if (would !== null) return would;

  if (normalizedRaw === 'any of that damage was dealt by a warrior') {
    const warriorFlag = (ctx as any)?.damageIncludedWarriorSource;
    if (typeof warriorFlag === 'boolean') return warriorFlag;
    const damageSources = (ctx as any)?.damageSourcePermanents;
    if (Array.isArray(damageSources) && damageSources.length > 0) {
      return damageSources.some((perm: any) => objectHasType(perm, 'warrior'));
    }
    const ids: string[] =
      (Array.isArray((ctx as any)?.damageSourceCreatureIds)
        ? (ctx as any).damageSourceCreatureIds
        : null) ??
      (Array.isArray((ctx as any)?.damageSourcePermanentIds)
        ? (ctx as any).damageSourcePermanentIds
        : null) ??
      (Array.isArray((ctx as any)?.damageSourceIds) ? (ctx as any).damageSourceIds : null) ??
      [];
    if (ids.length === 0) return null;
    let sawAll = true;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    for (const id of ids) {
      const perm = findObjectByIdInState(nextState, battlefield, String(id));
      if (!perm) {
        sawAll = false;
        continue;
      }
      if (objectHasType(perm, 'warrior')) return true;
    }
    return sawAll ? false : null;
  }

  if (/^this spell costs .+ less to cast if/.test(normalizedRaw)) return true;
  if (/^it'?s bargained$/.test(normalizedRaw)) return true;
  if (/^this spell was bargained$/.test(normalizedRaw)) return true;
  if (/^if you would gain life/.test(normalizedRaw)) return true;
  if (/^if this creature would be destroyed/.test(normalizedRaw)) return true;
  if (/^if damage would be dealt to this creature while it has a \+1\/\+1 counter/.test(normalizedRaw)) return true;
  if (/^if an opponent would draw/.test(normalizedRaw)) return true;
  if (/^if enchanted (?:land|creature|permanent) would be destroyed/.test(normalizedRaw)) return true;
  if (/^draw a card if an opponent has cast/.test(normalizedRaw)) return true;
  if (/^if you revealed a dragon/.test(normalizedRaw)) return true;
  if (/^if you controlled a dragon/.test(normalizedRaw)) return true;
  if (/^you revealed a dragon card or controlled a dragon as you cast this spell$/.test(normalizedRaw)) {
    const revealed =
      ctx.revealedDragonAsCast === true || ctx.selectorContext?.revealedDragonAsCast === true;
    const controlled =
      ctx.controlledDragonAsCast === true || ctx.selectorContext?.controlledDragonAsCast === true;
    if (revealed || controlled) return true;
    if (
      ctx.revealedDragonAsCast === false &&
      ctx.controlledDragonAsCast === false &&
      ctx.selectorContext?.revealedDragonAsCast === false &&
      ctx.selectorContext?.controlledDragonAsCast === false
    ) {
      return false;
    }
    return true;
  }
  if (normalizedRaw === "it isn't a mana ability" || normalizedRaw === 'it is not a mana ability') {
    const isMana =
      ctx.activatedAbilityIsManaAbility ?? ctx.selectorContext?.activatedAbilityIsManaAbility;
    if (typeof isMana === 'boolean') return !isMana;
    return true;
  }
  if (/^if that player discards/.test(normalizedRaw)) return true;
  if (/^if they can'?t$/.test(normalizedRaw)) return false;
  if (/^if this creature is a (?:warrior|spirit|zombie|vampire|angel|demon|dragon|elf|human|goblin|soldier|wizard)$/.test(normalizedRaw)) {
    return true;
  }
  {
    const thisCreatureSubtypeMatch = normalizedRaw.match(/^this creature is a ([a-z]+)$/i);
    if (thisCreatureSubtypeMatch) {
      const subtype = String(thisCreatureSubtypeMatch[1] || '').trim().toLowerCase();
      const source = getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      );
      if (!source) return null;
      return getExecutorTypeLineLower(source).includes(subtype);
    }
  }
  if (/^addendum\s*[-—]/.test(normalizedRaw) || /^if you cast this spell during your main phase/.test(normalizedRaw)) {
    return true;
  }
  if (/^you may cast this card from your graveyard as long as you control/.test(normalizedRaw)) return true;
  if (/^as long as you control a (?:black or green|green or black) permanent$/.test(normalizedRaw)) return true;
  if (/^if this creature was kicked with its .+ kicker/.test(normalizedRaw)) {
    const source = getReferencedObject(nextState, ctx);
    return Boolean((source as any)?.wasKicked ?? (source as any)?.card?.wasKicked);
  }
  if (/^adamant\s*[-—]/.test(normalizedRaw)) return true;
  if (/^if .+ was spent to cast this spell/.test(normalizedRaw)) return true;
  if (/^if at least .+ mana was spent to cast this spell/.test(normalizedRaw)) return true;
  if (/^if four or more creatures are attacking/.test(normalizedRaw)) return true;
  if (/^if an opponent has no cards in hand/.test(normalizedRaw)) return true;
  if (normalizedRaw === "it's not your turn" || normalizedRaw === 'it is not your turn') {
    const players = nextState.players || [];
    const activeIndex = Number.isInteger((nextState as any).activePlayerIndex)
      ? Number((nextState as any).activePlayerIndex)
      : 0;
    const activePlayerId = String(players[activeIndex]?.id || '').trim();
    if (!activePlayerId) return null;
    return activePlayerId !== String(controllerId).trim();
  }
  if (/^if it'?s not your turn/.test(normalizedRaw)) return true;
  if (/^if an opponent cast .+ this turn/.test(normalizedRaw)) return true;
  if (/^if an opponent had .+ enter the battlefield/.test(normalizedRaw)) return true;
  if (/^destroy it at the beginning of the next end step if it didn'?t attack/.test(normalizedRaw)) return true;
  if (/^sensational save\s*[-—]/.test(normalizedRaw)) return true;

  if (normalizedRaw === 'you pay') {
    return lastActionOutcome?.kind === 'applied' ? true : lastActionOutcome ? false : false;
  }
  if (normalizedRaw === 'you controlled that permanent') {
    return true;
  }
  if (normalizedRaw === "you can't choose an opponent this way") {
    return lastActionOutcome?.kind === 'impossible' ? true : lastActionOutcome?.kind === 'applied' ? false : false;
  }
  if (normalizedRaw === 'each opponent who didn\'t' || normalizedRaw === "each opponent who didn't") {
    if (ctx.interactivePlayerChoices === true) {
      return null;
    }
    return true;
  }
  if (normalizedRaw === 'each opponent who can\'t') {
    return true;
  }

  if (normalizedRaw === 'evidence was collected') {
    return typeof ctx.lastCollectedEvidence === 'boolean' ? ctx.lastCollectedEvidence : false;
  }
  if (normalizedRaw === 'this creature is saddled') {
    const source = getReferencedObject(nextState, ctx);
    return source ? Boolean((source as any)?.saddled ?? (source as any)?.isSaddled) : false;
  }
  if (
    normalizedRaw === "it's renowned" ||
    normalizedRaw === 'it is renowned' ||
    normalizedRaw === 'this creature is renowned'
  ) {
    const source =
      getReferencedObject(nextState, ctx) ??
      getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      );
    if (!source) return null;
    if (typeof (source as any)?.isRenowned === 'boolean') return (source as any).isRenowned;
    if (typeof (source as any)?.renowned === 'boolean') return (source as any).renowned;
    return false;
  }
  if (normalizedRaw === "this creature's spectacle cost was paid" || normalizedRaw === "this permanent's spectacle cost was paid") {
    const source = getReferencedObject(nextState, ctx);
    return source ? Boolean((source as any)?.spectacleCostPaid ?? (source as any)?.paidSpectacleCost) : false;
  }
  if (normalizedRaw === 'its surge cost was paid') {
    const readSurgePaid = (candidate: any): boolean | null => {
      if (!candidate || typeof candidate !== 'object') return null;
      const altId =
        candidate?.alternateCostId ??
        candidate?.alternativeCost ??
        candidate?.card?.alternateCostId ??
        candidate?.card?.alternativeCost;
      if (typeof altId === 'string' && altId.length > 0) {
        return String(altId).toLowerCase() === 'surge';
      }
      const raw =
        candidate?.surgeCostWasPaid ??
        candidate?.paidSurgeCost ??
        candidate?.surgePaid ??
        candidate?.castWithSurge ??
        candidate?.card?.surgeCostWasPaid ??
        candidate?.card?.paidSurgeCost ??
        candidate?.card?.surgePaid ??
        candidate?.card?.castWithSurge;
      return typeof raw === 'boolean' ? raw : null;
    };
    const source = getReferencedObject(nextState, ctx);
    const fromSource = readSurgePaid(source);
    if (typeof fromSource === 'boolean') return fromSource;
    const stackSpell = getStackSpellCard(nextState, ctx);
    const fromStack = readSurgePaid(stackSpell);
    if (typeof fromStack === 'boolean') return fromStack;
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    if (targetSpellId) {
      const stackItem = ((nextState as any)?.stack || []).find(
        (entry: any) => String(entry?.id || '').trim() === targetSpellId
      );
      const fromItem = readSurgePaid(stackItem);
      if (typeof fromItem === 'boolean') return fromItem;
    }
    if (typeof (ctx as any).surgeCostWasPaid === 'boolean') return (ctx as any).surgeCostWasPaid;
    return false;
  }
  if (normalizedRaw === 'its prowl cost was paid' || normalizedRaw === "this spell's prowl cost was paid") {
    const readProwlPaid = (candidate: any): boolean | null => {
      if (!candidate || typeof candidate !== 'object') return null;
      const altId =
        candidate?.alternateCostId ??
        candidate?.alternativeCost ??
        candidate?.card?.alternateCostId ??
        candidate?.card?.alternativeCost;
      if (typeof altId === 'string' && altId.length > 0) {
        return String(altId).toLowerCase() === 'prowl';
      }
      const raw =
        candidate?.prowlCostWasPaid ??
        candidate?.paidProwlCost ??
        candidate?.prowlPaid ??
        candidate?.castWithProwl ??
        candidate?.card?.prowlCostWasPaid ??
        candidate?.card?.paidProwlCost ??
        candidate?.card?.prowlPaid ??
        candidate?.card?.castWithProwl;
      return typeof raw === 'boolean' ? raw : null;
    };
    const source = getReferencedObject(nextState, ctx);
    const fromSource = readProwlPaid(source);
    if (typeof fromSource === 'boolean') return fromSource;
    const stackSpell = getStackSpellCard(nextState, ctx);
    const fromStack = readProwlPaid(stackSpell);
    if (typeof fromStack === 'boolean') return fromStack;
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    if (targetSpellId) {
      const stackItem = ((nextState as any)?.stack || []).find(
        (entry: any) => String(entry?.id || '').trim() === targetSpellId
      );
      const fromItem = readProwlPaid(stackItem);
      if (typeof fromItem === 'boolean') return fromItem;
    }
    if (typeof (ctx as any).prowlCostWasPaid === 'boolean') return (ctx as any).prowlCostWasPaid;
    return false;
  }
  if (normalizedRaw === 'the gift wasn\'t promised') {
    return ctx.giftPromised === true ? false : true;
  }
  if (normalizedRaw === 'they guessed right') {
    const guessCorrect = (ctx as { readonly lastGuessCorrect?: boolean }).lastGuessCorrect;
    return typeof guessCorrect === 'boolean' ? guessCorrect : false;
  }
  if (normalizedRaw === 'they lose the flip') {
    return typeof ctx.wonCoinFlip === 'boolean' ? !ctx.wonCoinFlip : false;
  }
  if (normalizedRaw === 'they match') {
    return false;
  }

  {
    const xThresholdMatch = normalizedRaw.match(/^x is (three|[a-z0-9]+) or more$/i);
    if (xThresholdMatch) {
      const threshold = parseSmallNumberWord(String(xThresholdMatch[1] || ''));
      const xValue = Number(ctx.xValue);
      if (threshold !== null && Number.isFinite(xValue)) return xValue >= threshold;
      return false;
    }
  }

  {
    const spellPowerMatch = normalizedRaw.match(/^that spell(?:'s)? power is (\d+) or greater$/i);
    if (spellPowerMatch) {
      const threshold = Number.parseInt(String(spellPowerMatch[1] || ''), 10);
      const power = getStackSpellPower(nextState, ctx);
      return Number.isFinite(threshold) && power !== null ? power >= threshold : false;
    }
  }

  {
    const permPowerMatch = normalizedRaw.match(/^this permanent(?:'s)? power is (\d+) or greater$/i);
    if (permPowerMatch) {
      const threshold = Number.parseInt(String(permPowerMatch[1] || ''), 10);
      const source = getReferencedObject(nextState, ctx);
      return source && Number.isFinite(threshold) ? getCreaturePower(source) >= threshold : false;
    }
  }
  if (normalizedRaw === 'this permanent has power 7 or greater') {
    const source = getReferencedObject(nextState, ctx);
    return source ? getCreaturePower(source) >= 7 : false;
  }

  if (normalizedRaw === 'its power is greater than each other creature\'s power') {
    const subject = getReferencedObject(nextState, ctx);
    if (!subject) return false;
    const subjectPower = getCreaturePower(subject);
    const others = (getProcessedBattlefield(nextState) as any[]).filter(
      (perm: any) => String(perm?.id || '') !== String((subject as any)?.id || '') && objectHasType(perm, 'creature')
    );
    return others.every((perm: any) => subjectPower > getCreaturePower(perm));
  }

  if (normalizedRaw === 'it has the greatest power or is tied for greatest power among creatures on the battlefield') {
    const subject = getReferencedObject(nextState, ctx);
    if (!subject) return false;
    const subjectPower = getCreaturePower(subject);
    const creatures = (getProcessedBattlefield(nextState) as any[]).filter((perm: any) => objectHasType(perm, 'creature'));
    const maxPower = Math.max(...creatures.map(getCreaturePower));
    return subjectPower >= maxPower;
  }

  if (normalizedRaw === 'you control the creature with the greatest toughness or tied for the greatest toughness') {
    const yours = controlledCreatures(nextState, controllerId);
    if (yours.length === 0) return false;
    const all = (getProcessedBattlefield(nextState) as any[]).filter((perm: any) => objectHasType(perm, 'creature'));
    const maxToughness = Math.max(...all.map(getCreatureToughness));
    return yours.some((perm: any) => getCreatureToughness(perm) >= maxToughness);
  }

  {
    const totalPowerMatch = normalizedRaw.match(/^creatures you control have total power (\d+) or greater$/i);
    if (totalPowerMatch) {
      const threshold = Number.parseInt(String(totalPowerMatch[1] || ''), 10);
      const total = controlledCreatures(nextState, controllerId).reduce((sum, perm) => sum + getCreaturePower(perm), 0);
      return Number.isFinite(threshold) ? total >= threshold : false;
    }
    const totalToughnessMatch = normalizedRaw.match(/^creatures you control have total toughness (\d+) or greater$/i);
    if (totalToughnessMatch) {
      const threshold = Number.parseInt(String(totalToughnessMatch[1] || ''), 10);
      const total = controlledCreatures(nextState, controllerId).reduce((sum, perm) => sum + getCreatureToughness(perm), 0);
      return Number.isFinite(threshold) ? total >= threshold : false;
    }
  }

  if (normalizedRaw === 'a creature died under your control this turn') {
    const byController = (nextState as any)?.creaturesDiedThisTurnByController?.[controllerId];
    return typeof byController === 'number' ? byController > 0 : Boolean((nextState as any)?.creatureDiedThisTurn);
  }
  if (normalizedRaw === 'they lost life this turn') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || '').trim();
    if (!targetId) return false;
    return Number(((nextState as any)?.lifeLostThisTurn || {})?.[targetId] || 0) > 0;
  }
  if (normalizedRaw === 'you lost life last turn') {
    const stateAny = nextState as any;
    const candidates = [
      stateAny?.lifeLostLastTurnByPlayerCounts,
      stateAny?.lifeLostLastTurnByPlayer,
      stateAny?.lifeLostLastTurn,
    ].filter((entry) => entry && typeof entry === 'object');
    for (const counts of candidates) {
      const raw = (counts as any)[controllerId];
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'number') return raw > 0;
    }
    return null;
  }
  {
    const playerLostLifeMatch = normalizedRaw.match(/^a player lost ([a-z0-9]+) or more life this turn$/i);
    if (playerLostLifeMatch) {
      const threshold = parseSmallNumberWord(String(playerLostLifeMatch[1] || '').trim());
      if (threshold === null) return null;
      const map = (nextState as any)?.lifeLostThisTurn;
      if (!map || typeof map !== 'object') return null;
      return Object.values(map as Record<string, unknown>).some(
        (value) => typeof value === 'number' && value >= threshold
      );
    }
  }
  if (normalizedRaw === 'a player other than you lost life this turn') {
    const map = (nextState as any)?.lifeLostThisTurn || {};
    return Object.entries(map).some(([playerId, amount]) => playerId !== controllerId && Number(amount) > 0);
  }
  if (
    normalizedRaw === "you've cast a spell from a graveyard or activated an ability of a card in a graveyard this turn" ||
    normalizedRaw === "you've cast another blue spell this turn" ||
    normalizedRaw === "you've cast another spell this turn" ||
    normalizedRaw === 'you cast another spell this turn'
  ) {
    return Boolean((nextState as any)?.castFromGraveyardThisTurn?.[controllerId]) ||
      Number(((nextState as any)?.spellsCastThisTurn || {})?.[controllerId] ?? ctx.spellCastCountThisTurn ?? 0) > 1;
  }
  if (
    normalizedRaw === "you've cast both a creature spell and a noncreature spell this turn" ||
    normalizedRaw === 'you cast both a creature spell and a noncreature spell this turn' ||
    normalizedRaw === 'you have cast both a creature spell and a noncreature spell this turn'
  ) {
    return controllerCastBothCreatureAndNoncreatureThisTurn(nextState, controllerId);
  }
  if (normalizedRaw === 'a food entered under your control this turn') {
    return Boolean(((nextState as any)?.foodEnteredThisTurn || {})?.[controllerId]);
  }
  {
    const enteredThisTurnMatch = normalizedRaw.match(
      /^(a|an|another) (artifact|creature|enchantment|planeswalker|land|battle) entered the battlefield under your control this turn$/i
    );
    if (enteredThisTurnMatch) {
      const article = String(enteredThisTurnMatch[1] || '').trim().toLowerCase();
      const typeLower = String(enteredThisTurnMatch[2] || '').trim().toLowerCase();
      const excludeId = article === 'another' ? String(ctx.sourceId || '').trim() : undefined;
      const count = getControlledTypeEnteredThisTurnCount(nextState, controllerId, typeLower, excludeId);
      return count === null ? null : count > 0;
    }
  }
  if (normalizedRaw === 'it entered under your control') {
    const moved = Array.isArray(lastMovedCards) && lastMovedCards.length > 0
      ? lastMovedCards
      : Array.isArray(ctx.lastMovedCards)
        ? ctx.lastMovedCards
        : [];
    if (moved.length === 0) return null;
    const movedId = String((moved[0] as any)?.id || '').trim();
    if (!movedId) return null;
    const onBattlefield = ((nextState.battlefield || []) as any[]).find(
      (perm) =>
        String((perm as any)?.id || '').trim() === movedId ||
        String((perm as any)?.card?.id || '').trim() === movedId
    );
    if (onBattlefield) {
      return String((onBattlefield as any)?.controller || '').trim() === controllerId;
    }
    const owner = String((moved[0] as any)?.owner || controllerId).trim();
    return owner === controllerId;
  }
  if (normalizedRaw === 'you had two or more creatures enter the battlefield under your control this turn') {
    const count = Number(((nextState as any)?.creaturesEnteredThisTurn || {})?.[controllerId] || 0);
    return count >= 2;
  }
  if (normalizedRaw === 'you\'ve gained 3 or more life this turn') {
    return Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0) >= 3;
  }
  if (normalizedRaw === 'this permanent has dealt 3 or more damage this turn') {
    const source = getReferencedObject(nextState, ctx);
    const dealt = Number((source as any)?.damageDealtThisTurn ?? (nextState as any)?.damageDealtThisTurnBySource?.[String((source as any)?.id || ctx.sourceId || '')]);
    return Number.isFinite(dealt) ? dealt >= 3 : false;
  }

  if (normalizedRaw === 'you have 10 or less life') {
    const life = getControllerLife(nextState, controllerId);
    return life === null ? false : life <= 10;
  }
  if (normalizedRaw === 'you have nine or more cards in hand') {
    return getPlayerHandCount(nextState, controllerId) >= 9;
  }
  {
    const handThresholdMatch = normalizedRaw.match(
      /^you have (seven|nine|ten|eight|six|five|four|three|two|one|\d+) or more cards in hand$/i
    );
    if (handThresholdMatch) {
      const threshold = parseSmallNumberWord(String(handThresholdMatch[1] || ''));
      if (threshold !== null) {
        return getPlayerHandCount(nextState, controllerId) >= threshold;
      }
    }
  }
  if (normalizedRaw === 'you have fewer than three cards in hand') {
    return getPlayerHandCount(nextState, controllerId) < 3;
  }
  {
    const handFewerMatch = normalizedRaw.match(
      /^you have fewer than (seven|nine|ten|eight|six|five|four|three|two|one|\d+) cards in hand$/i
    );
    if (handFewerMatch) {
      const threshold = parseSmallNumberWord(String(handFewerMatch[1] || ''));
      if (threshold !== null) {
        return getPlayerHandCount(nextState, controllerId) < threshold;
      }
    }
  }
  if (normalizedRaw === 'you put a counter on a creature this turn') {
    const tracked =
      (nextState as any)?.putCounterOnCreatureThisTurn?.[controllerId] ??
      (nextState as any)?.placedCounterOnCreatureThisTurn?.[controllerId] ??
      (nextState as any)?.countersPlacedOnCreaturesThisTurn?.[controllerId] ??
      (ctx as any).putCounterOnCreatureThisTurn;
    return typeof tracked === 'boolean' ? tracked : false;
  }
  if (normalizedRaw === 'your library has no cards in it') {
    const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === controllerId) as any;
    return Array.isArray(player?.library) ? player.library.length === 0 : false;
  }
  if (normalizedRaw === 'there are twenty or more cards in your graveyard') {
    return getGraveyardCards(nextState, controllerId).length >= 20;
  }

  {
    const landControlMatch = normalizedRaw.match(
      /^you control (four|five|six|seven|eight|nine|ten|\d+|zero|one|two|three|eleven|twelve) or more lands$/i
    );
    if (landControlMatch) {
      const threshold = parseSmallNumberWord(String(landControlMatch[1] || ''));
      if (threshold === null) return null;
      const landCount = (nextState.battlefield || []).filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== controllerId) return false;
        return /\bland\b/i.test(String(perm?.type_line || perm?.card?.type_line || ''));
      }).length;
      return landCount >= threshold;
    }
  }

  {
    const gyCreatureMatch = normalizedRaw.match(
      /^there are (three|four|five|six|seven|eight|nine|ten|\d+|zero|one|two) or more creature cards in your graveyard$/i
    );
    if (gyCreatureMatch) {
      const threshold = parseSmallNumberWord(String(gyCreatureMatch[1] || ''));
      if (threshold === null) return null;
      const creatureCards = getGraveyardCards(nextState, controllerId).filter((card: any) =>
        /\bcreature\b/i.test(String(card?.type_line || ''))
      );
      return creatureCards.length >= threshold;
    }
  }

  if (normalizedRaw === 'no life is lost this way') {
    const lost = Number(
      (ctx as any).lifeLostThisResolution ??
        (nextState as any).lifeLostThisResolution ??
        ((nextState as any).lifeLostThisTurn || {})?.[controllerId] ??
        -1
    );
    if (Number.isFinite(lost) && lost >= 0) return lost === 0;
    return false;
  }

  if (normalizedRaw === "you've done all four this turn") {
    const completed = Number(
      (nextState as any).modalActionsCompletedThisTurn?.[controllerId] ??
        (ctx as any).modalActionsCompletedCount ??
        0
    );
    return completed >= 4;
  }

  {
    const exchangeFailMatch = normalizedRaw.match(
      /^you don'?t or can'?t make an exchange(?:,\s*sacrifice .*)?$/i
    );
    if (exchangeFailMatch) {
      if (
        lastActionOutcome?.stepKind === 'exchange_control' &&
        lastActionOutcome?.kind === 'applied'
      ) {
        return false;
      }
      return Boolean((ctx as any).exchangeFailed);
    }
  }

  if (normalizedRaw === 'the creature deals damage to a creature this turn') {
    const sourceId = String(ctx.sourceId || '').trim();
    const dealtMap = (nextState as any)?.creatureDealtDamageToCreatureThisTurn;
    if (sourceId && typeof dealtMap?.[sourceId] === 'boolean') return dealtMap[sourceId];
    return false;
  }

  {
    const lifeCompareMatch = normalizedRaw.match(/^you have (\d+) or less life$/i);
    if (lifeCompareMatch) {
      const threshold = Number.parseInt(String(lifeCompareMatch[1] || ''), 10);
      const life = getControllerLife(nextState, controllerId);
      return life === null || !Number.isFinite(threshold) ? false : life <= threshold;
    }
  }
  if (normalizedRaw === 'your life total is greater than or equal to the last noted life total for this enchantment') {
    const life = getControllerLife(nextState, controllerId);
    const noted = Number((nextState as any)?.lastNotedLifeTotal?.[String(ctx.sourceId || 'bf-source')] ?? life);
    return life !== null && Number.isFinite(noted) ? life >= noted : false;
  }
  if (normalizedRaw === 'your life total is greater than your starting life total') {
    const life = getControllerLife(nextState, controllerId);
    const starting = Number((nextState as any)?.startingLife ?? 40);
    return life !== null ? life > starting : false;
  }
  if (normalizedRaw === 'your life total is less than or equal to half your starting life total') {
    const life = getControllerLife(nextState, controllerId);
    const starting = Number((nextState as any)?.startingLife ?? 40);
    return life !== null ? life <= starting / 2 : false;
  }

  {
    const lifeMoreThanStartingMatch = normalizedRaw.match(
      /^you have at least (\d+|fifteen|fourteen|thirteen|twelve|eleven|ten|[a-z]+) life more than your starting life total$/i
    );
    if (lifeMoreThanStartingMatch) {
      const threshold = parseSmallNumberWord(String(lifeMoreThanStartingMatch[1] || ''));
      const life = getControllerLife(nextState, controllerId);
      const starting = Number((nextState as any)?.startingLife ?? 40);
      if (life === null || threshold === null) return false;
      return life - starting >= threshold;
    }
  }

  {
    const opponentHandMatch = normalizedRaw.match(
      /^the player is your opponent and has (four|[a-z0-9]+) or more cards in hand$/
    );
    if (opponentHandMatch) {
      const threshold = parseSmallNumberWord(String(opponentHandMatch[1] || ''));
      const targetId = String(ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2').trim();
      return threshold !== null ? getPlayerHandCount(nextState, targetId as PlayerID) >= threshold : false;
    }
  }

  {
    const controlCountMatch = normalizedRaw.match(/^you control (thirty|[a-z0-9]+) or more ([a-z0-9' -]+)$/i);
    if (controlCountMatch) {
      const threshold = parseSmallNumberWord(String(controlCountMatch[1] || ''));
      const descriptor = String(controlCountMatch[2] || '').trim();
      if (threshold !== null) return countControlledMatchingDescriptor(nextState, controllerId, descriptor) >= threshold;
    }
    if (normalizedRaw === 'you control all three') {
      return countControlledMatchingDescriptor(nextState, controllerId, 'permanent') >= 3;
    }
    const exactControlMatch = normalizedRaw.match(/^you control exactly (thirteen|[a-z0-9]+) permanents$/i);
    if (exactControlMatch) {
      const threshold = parseSmallNumberWord(String(exactControlMatch[1] || ''));
      const count = (getProcessedBattlefield(nextState) as any[]).filter(
        (perm: any) => String(perm?.controller || '').trim() === controllerId
      ).length;
      return threshold !== null ? count === threshold : false;
    }
  }

  if (normalizedRaw === 'there are five basic land types among lands you control') {
    return countBasicLandTypesAmongLandsYouControl(nextState, controllerId) >= 5;
  }
  {
    const basicLandTypesMatch = normalizedRaw.match(
      /^there are (three|four|five|six|seven|eight|nine|ten|\d+|zero|one|two) or more basic land types among lands you control$/i
    );
    if (basicLandTypesMatch) {
      const threshold = parseSmallNumberWord(String(basicLandTypesMatch[1] || ''));
      if (threshold === null) return null;
      return countBasicLandTypesAmongLandsYouControl(nextState, controllerId) >= threshold;
    }
  }
  {
    const landsOrTreefolkMatch = normalizedRaw.match(
      /^you control (seven|eight|nine|ten|\d+|zero|one|two|three|four|five|six|eleven|twelve) or more lands and\/or treefolk$/i
    );
    if (landsOrTreefolkMatch) {
      const threshold = parseSmallNumberWord(String(landsOrTreefolkMatch[1] || ''));
      if (threshold === null) return null;
      const battlefield = getProcessedBattlefield(nextState) as any[];
      const count = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== controllerId) return false;
        return objectHasType(perm, 'land') || objectHasType(perm, 'treefolk');
      }).length;
      return count >= threshold;
    }
  }
  if (normalizedRaw === 'excess damage was dealt this way') {
    const excess = Number(params.lastExcessDamageDealtThisWay ?? (params.ctx as any)?.lastExcessDamageDealtThisWay ?? 0);
    return excess > 0;
  }
  if (normalizedRaw === 'that creature was dealt excess damage this turn') {
    const thatId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.targetPermanentId ||
        (ctx as any).thatCreatureId ||
        ''
    ).trim();
    if (thatId) {
      const perm = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, thatId);
      if (perm) {
        const onPerm = (perm as any)?.wasDealtExcessDamageThisTurn ?? (perm as any)?.excessDamageThisTurn;
        if (typeof onPerm === 'boolean') return onPerm;
        if (typeof onPerm === 'number') return onPerm > 0;
      }
      const map =
        (nextState as any)?.excessDamageThisTurnByCreatureId ??
        (nextState as any)?.excessDamageThisTurnByPermanentId;
      if (map && typeof map === 'object') {
        const tracked = (map as any)[thatId];
        if (typeof tracked === 'boolean') return tracked;
        if (typeof tracked === 'number') return tracked > 0;
        if (Object.prototype.hasOwnProperty.call(map, thatId)) return false;
      }
    }
    if (typeof (ctx as any)?.thatCreatureDealtExcessDamageThisTurn === 'boolean') {
      return (ctx as any).thatCreatureDealtExcessDamageThisTurn;
    }
    return null;
  }
  if (normalizedRaw === "you don't control a faerie") {
    return countControlledMatchingDescriptor(nextState, controllerId, 'faerie') === 0;
  }
  if (normalizedRaw === 'the creature you control has trample') {
    const sourceId = String(
      params.ctx.targetCreatureId ||
        params.ctx.selectorContext?.targetCreatureId ||
        params.ctx.sourceId ||
        ''
    ).trim();
    const perm = sourceId
      ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, sourceId)
      : getContextSourceObject(params.ctx, (idRaw: string) =>
          findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
        );
    if (!perm) return false;
    const keywords = String((perm as any)?.keywords || (perm as any)?.card?.keywords || '').toLowerCase();
    if (keywords.includes('trample')) return true;
    return hasExecutorClass(perm, 'trample');
  }
  if (normalizedRaw === 'a pirate was exiled this way') {
    const moved = movedCardsFrom(params);
    if (moved.length > 0) {
      return moved.some((card: any) => objectHasType(card, 'pirate'));
    }
    return antecedentApplied(params.lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS);
  }
  if (normalizedRaw === 'an opponent controls more creatures than you') {
    const yours = controlledCreatures(nextState, controllerId).length;
    const opponentIds = (nextState.players || [])
      .map((p: any) => String(p?.id || '').trim())
      .filter((id: string) => id && id !== controllerId);
    return opponentIds.some(id => controlledCreatures(nextState, id as PlayerID).length > yours);
  }
  if (normalizedRaw === 'you have the city\'s blessing') {
    return Boolean(((nextState as any)?.citysBlessing || {})?.[controllerId]);
  }

  if (
    normalizedRaw === 'this creature is still on the battlefield' ||
    normalizedRaw === 'this permanent is still on the battlefield'
  ) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    return Boolean(source);
  }

  if (normalizedRaw === 'that creature is legendary' || normalizedRaw === 'that card is legendary' || normalizedRaw === 'that spell is legendary') {
    const ref = getReferencedObject(nextState, ctx);
    return ref ? objectHasType(ref, 'legendary') : false;
  }

  {
    const wasTypeMatch = normalizedRaw.match(/^that creature was (?:a|an) ([a-z0-9' -]+)$/i);
    if (wasTypeMatch) {
      const moved = movedCardsFrom(params);
      const typeName = String(wasTypeMatch[1] || '').trim();
      return moved.length > 0
        ? moved.some(card => objectHasType(card, typeName))
        : antecedentApplied(lastActionOutcome, ['destroy', 'exile', 'exile_top', 'impulse_exile_top', 'move_zone', 'sacrifice']);
    }
  }

  {
    const isOrTypesMatch = normalizedRaw.match(/^that creature is (?:a|an) (.+)$/i);
    if (isOrTypesMatch) {
      const ref = getReferencedObject(nextState, ctx);
      if (!ref) return false;
      const types = String(isOrTypesMatch[1] || '')
        .split(/\s*,\s*|\s+or\s+/)
        .map(part => part.trim().toLowerCase())
        .filter(Boolean);
      return types.some(typeName => objectHasType(ref, typeName.replace(/^an?\s+/, '')));
    }
  }

  if (normalizedRaw === "it's a land or double-faced card" || normalizedRaw === "it's an artifact or creature card" || normalizedRaw === "it's an artifact, creature, or land card") {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref) return false;
    if (/double-faced/.test(normalizedRaw)) {
      return objectHasType(ref, 'land') || Boolean((ref as any)?.doubleFaced ?? (ref as any)?.card?.card_faces?.length);
    }
    const types = normalizedRaw.includes('artifact') ? ['artifact', 'creature', 'land'] : ['artifact', 'creature'];
    return types.some(typeName => objectHasType(ref, typeName));
  }

  {
    const typedCardMatch = normalizedRaw.match(/^it'?s an? (.+?) cards?$/i);
    if (typedCardMatch) {
      const ref = getConditionalSubjectCard(params);
      if (!ref) {
        const ownerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
        const player = (nextState.players || []).find(
          (entry: any) => String(entry?.id || '').trim() === ownerId
        ) as any;
        const library = Array.isArray(player?.library) ? player.library : [];
        const topCard = library.length > 0 ? library[library.length - 1] : null;
        if (!topCard) return false;
        const typeName = String(typedCardMatch[1] || '')
          .trim()
          .toLowerCase()
          .replace(/\s+cards?$/, '');
        return objectHasType(topCard, typeName);
      }
      const typeName = String(typedCardMatch[1] || '')
        .trim()
        .toLowerCase()
        .replace(/\s+cards?$/, '');
      return objectHasType(ref, typeName);
    }
  }

  if (normalizedRaw === 'equipped creature is a vampire') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const attachedTo = String((source as any)?.attachedTo || '').trim();
    if (!attachedTo) return false;
    const equipped = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attachedTo);
    return equipped ? objectHasType(equipped, 'vampire') : false;
  }

  {
    const enchantedPowerMatch = normalizedRaw.match(
      /^enchanted creature'?s power is (four|[a-z0-9]+) or greater$/i
    );
    if (enchantedPowerMatch) {
      const threshold = parseSmallNumberWord(String(enchantedPowerMatch[1] || ''));
      if (threshold === null) return null;
      const enchanted = getEnchantedCreatureFromAura(nextState, ctx);
      if (!enchanted) return null;
      if (!objectHasType(enchanted, 'creature')) return false;
      return getCreaturePower(enchanted) >= threshold;
    }
  }

  if (normalizedRaw === "it's equipped" || normalizedRaw === 'it is equipped') {
    const subject = getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx);
    if (!subject) return null;
    if (Boolean((subject as any)?.isEquipped)) return true;
    const attachedEquipment = (subject as any)?.attachedEquipment;
    if (Array.isArray(attachedEquipment) && attachedEquipment.length > 0) return true;
    return false;
  }

  if (normalizedRaw === 'it was enchanted or equipped') {
    const subject = getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx);
    if (!subject) return null;
    if (
      Boolean((subject as any)?.wasEnchanted) ||
      Boolean((subject as any)?.wasEquipped) ||
      Boolean((subject as any)?.isEquipped)
    ) {
      return true;
    }
    const attachedEquipment = (subject as any)?.attachedEquipment;
    if (Array.isArray(attachedEquipment) && attachedEquipment.length > 0) return true;
    const subjectId = String((subject as any)?.id || '').trim();
    if (subjectId) {
      const battlefield = getProcessedBattlefield(nextState) as any[];
      const hasAuraAttached = battlefield.some((perm: any) => {
        if (String(perm?.attachedTo || '').trim() !== subjectId) return false;
        const typeLine = getExecutorTypeLineLower(perm);
        return typeLine.includes('enchantment') || typeLine.includes('aura');
      });
      if (hasAuraAttached) return true;
    }
    if ((subject as any)?.wasEnchanted === false && (subject as any)?.wasEquipped === false) return false;
    return false;
  }

  if (normalizedRaw === "this enchantment isn't a creature" || normalizedRaw === 'this enchantment is not a creature') {
    const source = getReferencedObject(nextState, ctx);
    return source ? !objectHasType(source, 'creature') : false;
  }

  if (normalizedRaw === 'a creature card in your graveyard has flying') {
    return getGraveyardCards(nextState, controllerId).some(
      card => objectHasType(card, 'creature') && objectHasType(card, 'flying')
    );
  }

  if (
    normalizedRaw === "there's a lesson card in your graveyard" ||
    normalizedRaw === 'there is a lesson card in your graveyard'
  ) {
    return getGraveyardCards(nextState, controllerId).some((card) => objectHasType(card, 'lesson'));
  }

  if (normalizedRaw === 'it has the same name as a permanent') {
    const moved = movedCardsFrom(params);
    const referencedName = String(
      (moved[0] as any)?.name ||
        (moved[0] as any)?.card?.name ||
        ctx.referencedCardName ||
        ctx.targetCardName ||
        ctx.selectorContext?.chosenCardName ||
        (ctx as any)?.chosenCardName ||
        ''
    )
      .trim()
      .toLowerCase();
    const fallbackRef = referencedName ? null : getReferencedObject(nextState, ctx);
    const cardName =
      referencedName ||
      String((fallbackRef as any)?.name || (fallbackRef as any)?.card?.name || '')
        .trim()
        .toLowerCase();
    if (!cardName) return null;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return battlefield.some((perm: any) => {
      const permName = String(perm?.name || perm?.card?.name || '')
        .trim()
        .toLowerCase();
      return permName.length > 0 && permName === cardName;
    });
  }

  {
    const cluesSacrificedMatch = normalizedRaw.match(
      /^you sacrificed (three|[a-z0-9]+) or more clues this turn$/i
    );
    if (cluesSacrificedMatch) {
      const threshold = parseSmallNumberWord(String(cluesSacrificedMatch[1] || ''));
      if (threshold === null) return null;
      const count = Number(
        (nextState as any)?.cluesSacrificedThisTurn?.[controllerId] ??
          (nextState as any)?.sacrificedCluesThisTurn?.[controllerId] ??
          (nextState as any)?.cluesSacrificedThisTurnCount?.[controllerId] ??
          NaN
      );
      return Number.isFinite(count) ? count >= threshold : false;
    }
  }

  if (normalizedRaw === 'a creature you control has first strike' || normalizedRaw === 'a creature you control has flying') {
    const keyword = normalizedRaw.includes('first strike') ? 'first strike' : 'flying';
    return controlledCreatures(nextState, controllerId).some(
      perm =>
        objectHasType(perm, keyword) ||
        (Array.isArray((perm as any)?.keywords) && (perm as any).keywords.some((k: string) => String(k).toLowerCase().includes(keyword)))
    );
  }

  if (normalizedRaw === 'it has flying') {
    const ref = getReferencedObject(nextState, ctx);
    return ref ? objectHasType(ref, 'flying') : false;
  }

  {
    const counterOnItMatch = normalizedRaw.match(/^there are (three|[a-z0-9]+) or more ([a-z0-9' -]+) counters on (?:it|this enchantment)$/i);
    if (counterOnItMatch) {
      const threshold = parseSmallNumberWord(String(counterOnItMatch[1] || ''));
      const counterName = String(counterOnItMatch[2] || '').trim().toLowerCase();
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return false;
      const count = Number(((ref as any)?.counters || {})[counterName] ?? 0);
      return (Number.isFinite(count) ? count : 0) >= threshold;
    }
    const exactCounterMatch = normalizedRaw.match(/^it has exactly (four|[a-z0-9]+) \+1\/\+1 counters on it$/i);
    if (exactCounterMatch) {
      const expected = parseSmallNumberWord(String(exactCounterMatch[1] || ''));
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || expected === null) return false;
      const count = Number(((ref as any)?.counters || {})['+1/+1'] ?? 0);
      return count === expected;
    }
    const creatureCounterMatch = normalizedRaw.match(/^that creature has (three|[a-z0-9]+) or more \+1\/\+0 counters on it$/i);
    if (creatureCounterMatch) {
      const threshold = parseSmallNumberWord(String(creatureCounterMatch[1] || ''));
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return false;
      const count = Number(((ref as any)?.counters || {})['+1/+0'] ?? 0);
      return count >= threshold;
    }
    if (normalizedRaw === 'that creature has a +1/+1 counter on it') {
      const ref = getReferencedObject(nextState, ctx);
      if (!ref) return false;
      return Number(((ref as any)?.counters || {})['+1/+1'] ?? 0) > 0;
    }
    const thatCreaturePlusOneMatch = normalizedRaw.match(
      /^that creature has (three|[a-z0-9]+) or more \+1\/\+1 counters on it$/i
    );
    if (thatCreaturePlusOneMatch) {
      const threshold = parseSmallNumberWord(String(thatCreaturePlusOneMatch[1] || ''));
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return false;
      return Number(((ref as any)?.counters || {})['+1/+1'] ?? 0) >= threshold;
    }
    if (normalizedRaw === 'this card has no egg counters on it') {
      const ref = getReferencedObject(nextState, ctx);
      if (!ref) return false;
      return Number(((ref as any)?.counters || {}).egg ?? 0) === 0;
    }
  }

  if (normalizedRaw === 'it isn\'t that player\'s turn' || normalizedRaw === 'it is not that player\'s turn') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || '').trim();
    const turnPlayer = String((nextState as any)?.turnPlayer || '').trim();
    return targetId ? turnPlayer !== targetId : false;
  }
  if (normalizedRaw === 'it\'s your main phase' || normalizedRaw === 'it is your main phase') {
    const phase = String((nextState as any)?.phase || '').trim().toLowerCase();
    return (phase === 'main1' || phase === 'main2' || phase === 'main') &&
      String((nextState as any)?.turnPlayer || '').trim() === controllerId;
  }
  if (normalizedRaw === 'it\'s the first combat phase of the turn' || normalizedRaw === 'it is the first combat phase of the turn') {
    return Number((nextState as any)?.combatPhasesThisTurn?.[controllerId] ?? 1) <= 1;
  }

  {
    const resultExactMatch = normalizedRaw.match(/^the result is (one|[a-z0-9]+)$/i);
    if (resultExactMatch) {
      const expected = parseSmallNumberWord(String(resultExactMatch[1] || ''));
      const rolled = getDieRollResult(nextState, controllerId);
      return expected !== null && rolled !== null ? rolled === expected : false;
    }
    const rollAtLeastMatch = normalizedRaw.match(/^the roll was (\d+) or higher$/i);
    if (rollAtLeastMatch) {
      const threshold = Number.parseInt(String(rollAtLeastMatch[1] || ''), 10);
      const rolled = getDieRollResult(nextState, controllerId);
      return Number.isFinite(threshold) && rolled !== null ? rolled >= threshold : false;
    }
    if (normalizedRaw === 'both coins come up heads' || normalizedRaw === 'both coins come up tails') {
      const wantHeads = normalizedRaw.includes('heads');
      const flips = (nextState as any)?.lastCoinFlips?.[controllerId];
      if (Array.isArray(flips) && flips.length >= 2) {
        return wantHeads ? flips.every(Boolean) : flips.every((v: boolean) => !v);
      }
      return false;
    }
  }

  if (normalizedRaw === 'that spell is a lesson') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find((e: any) => String(e?.id || '') === targetSpellId);
    const typeLine = String((stackSpell as any)?.card?.type_line || (stackSpell as any)?.type_line || '').toLowerCase();
    return typeLine.includes('lesson');
  }
  if (normalizedRaw === 'that spell was all colors') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find((e: any) => String(e?.id || '') === targetSpellId);
    const colors = (stackSpell as any)?.card?.colors || (stackSpell as any)?.colors;
    return Array.isArray(colors) ? colors.length >= 5 : false;
  }

  if (normalizedRaw === 'target attacking creature token is the chosen type') {
    const chosen = String(ctx.selectorContext?.chosenCreatureType || '').trim().toLowerCase();
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const target = targetId
      ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, targetId)
      : null;
    if (!target || !chosen) return false;
    return Boolean((target as any)?.isToken) && getExecutorTypeLineLower(target).includes(chosen);
  }

  if (normalizedRaw === 'dominion gets more votes') {
    const winning = String((ctx as any).winningVoteChoice || '').trim().toLowerCase();
    return winning === 'dominion';
  }

  if (normalizedRaw === 'an opponent controls that creature') {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref) return false;
    return String((ref as any)?.controller || '').trim() !== controllerId;
  }
  if (normalizedRaw === 'that player is you') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || '').trim();
    return !targetId || targetId === controllerId;
  }

  if (normalizedRaw === "its power is less than this creature's power") {
    const ref = getReferencedObject(nextState, ctx);
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!ref || !source) return false;
    return getCreaturePower(ref) < getCreaturePower(source);
  }

  if (normalizedRaw === "they didn't attack you that turn") {
    const attackerId = String(ctx.selectorContext?.targetPlayerId || ctx.targetOpponentId || 'p2').trim();
    const attackedMap = (nextState as any)?.attackedDefendingPlayersThisCombatByPlayer as Record<string, string[]> | undefined;
    const defenders = Array.isArray(attackedMap?.[attackerId]) ? attackedMap[attackerId] : [];
    return !defenders.includes(controllerId);
  }

  if (normalizedRaw === 'a noncreature, nonland card is milled this way') {
    const milled = milledCardsFrom(ctx);
    return milled.some(
      (card: any) => !objectHasType(card, 'creature') && !objectHasType(card, 'land')
    );
  }

  if (
    normalizedRaw ===
    "that creature's power is less than or equal to the number of warriors your team controls"
  ) {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref) return false;
    const warriorCount = controlledCreatures(nextState, controllerId).filter((perm: any) =>
      getExecutorTypeLineLower(perm).includes('warrior')
    ).length;
    return getCreaturePower(ref) <= warriorCount;
  }

  if (normalizedRaw === 'the copy is a permanent spell') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find(
      (entry: any) => String(entry?.id || '').trim() === targetSpellId
    );
    const typeLine = String((stackSpell as any)?.card?.type_line || (stackSpell as any)?.type_line || '').toLowerCase();
    if (!typeLine) return false;
    return (
      typeLine.includes('creature') ||
      typeLine.includes('artifact') ||
      typeLine.includes('enchantment') ||
      typeLine.includes('planeswalker') ||
      typeLine.includes('battle') ||
      typeLine.includes('kindred')
    );
  }

  if (
    normalizedRaw ===
    'a card with the same name is in a graveyard or a nontoken permanent with the same name is on the battlefield'
  ) {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find(
      (entry: any) => String(entry?.id || '').trim() === targetSpellId
    );
    const spellName = String((stackSpell as any)?.card?.name || (stackSpell as any)?.name || ctx.sourceName || '')
      .trim()
      .toLowerCase();
    if (!spellName) return false;
    for (const player of nextState.players || []) {
      const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
      if (
        graveyard.some(
          (card: any) => String(card?.name || '').trim().toLowerCase() === spellName
        )
      ) {
        return true;
      }
    }
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return battlefield.some((perm: any) => {
      if ((perm as any)?.isToken) return false;
      const name = String((perm as any)?.name || (perm as any)?.card?.name || '')
        .trim()
        .toLowerCase();
      return name === spellName;
    });
  }

  if (normalizedRaw === "each opponent who doesn't control an elf") {
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === controllerId) return false;
      return !((nextState.battlefield || []) as any[]).some(
        perm => perm?.controller === playerId && getExecutorTypeLineLower(perm).includes('elf')
      );
    });
  }

  if (
    normalizedRaw ===
    'this permanent is your ring-bearer and the ring has tempted you two or more times this game'
  ) {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const temptCount = Number(player?.ringTemptations ?? 0);
    const sourceId = String(ctx.sourceId || '').trim();
    const ringBearerId = String(player?.ringBearerId || player?.ringBearerPermanentId || sourceId).trim();
    return ringBearerId === sourceId && temptCount >= 2;
  }

  if (/^you chose a creature other than this permanent as your ring-bearer$/i.test(normalizedRaw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const ringBearerId = String(
      ctx.chosenRingBearerId ??
        ctx.selectorContext?.chosenRingBearerId ??
        (nextState.players.find((player) => player.id === controllerId) as any)?.ringBearerId ??
        ''
    ).trim();
    if (!sourceId || !ringBearerId) return null;
    return ringBearerId !== sourceId;
  }

  if (normalizedRaw === "the result is equal to this vehicle's mana value") {
    const rolled = getDieRollResult(nextState, controllerId);
    const source = getReferencedObject(nextState, ctx);
    const mv = source ? getCardManaValue((source as any)?.card || source) : null;
    return rolled !== null && mv !== null ? rolled === mv : false;
  }

  if (normalizedRaw === 'one or more opponents had the highest result') {
    return typeof (ctx as any).opponentHadHighestRollResult === 'boolean'
      ? (ctx as any).opponentHadHighestRollResult
      : true;
  }

  if (
    normalizedRaw ===
    'each opponent who discarded a card that shares a card type with the card you discarded'
  ) {
    return discardedCardsFrom(params).length > 0;
  }

  if (normalizedRaw === 'you are one of those players') {
    return true;
  }

  if (/^you searched for a creature card that doesn't have that name$/.test(normalizedRaw)) {
    if (isSearchedLibraryThisWayLedgerFirst(params.ctx)) return true;
    if (params.ctx.searchedLibraryThisWay === true) return true;
    return antecedentApplied(lastActionOutcome, ['search_library']);
  }

  if (
    normalizedRaw ===
    'this permanent and a creature named phyrexian dragon engine are attacking, and you both own and control them'
  ) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const named = findBattlefieldPermanentByName(nextState, 'phyrexian dragon engine');
    if (!source || !named) return false;
    const controller = String(controllerId || '').trim();
    const sourceControlled =
      String((source as any)?.controller || '').trim() === controller &&
      String((source as any)?.owner || (source as any)?.controller || '').trim() === controller;
    const namedControlled =
      String((named as any)?.controller || '').trim() === controller &&
      String((named as any)?.owner || (named as any)?.controller || '').trim() === controller;
    return sourceControlled && namedControlled && isPermanentAttacking(source) && isPermanentAttacking(named);
  }

  if (normalizedRaw === 'it targets a permanent or player, and you may choose new targets for the copy') {
    const stackSpell = getStackSpellCard(nextState, ctx);
    if (!stackSpell) return true;
    const targets = (stackSpell as any)?.targets ?? (stackSpell as any)?.targetIds;
    return Array.isArray(targets) ? targets.length > 0 : true;
  }

  if (normalizedRaw === 'any of those cards shares a card type with that spell') {
    const spell = getStackSpellCard(nextState, ctx);
    const cards = contextualCardsFrom(params);
    if (!spell || cards.length === 0) return false;
    return cards.some(card => cardsShareCardType(card, spell));
  }

  if (normalizedRaw === 'it shares a card type with the exiled card') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    const exiledCard = findExiledCardWithSource(nextState, sourceId);
    if (!exiledCard) return null;
    const triggeringCard =
      getStackSpellCard(nextState, ctx) ??
      (ctx as any)?.triggeringSpellCard ??
      contextualCardsFrom(params)[0] ??
      (ctx as any)?.lastCastSpellCard;
    if (!triggeringCard) return null;
    return cardsShareCardType(triggeringCard, exiledCard);
  }

  if (normalizedRaw === "you've cycled a card named this permanent four or more times this game") {
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    const cyclesByName = (nextState as any)?.cyclesByCardName?.[controllerId] as Record<string, number> | undefined;
    const count = Number(cyclesByName?.[sourceName] ?? (nextState as any)?.cyclesThisGame?.[controllerId] ?? 0);
    return Number.isFinite(count) ? count >= 4 : false;
  }

  if (normalizedRaw === 'a player does either') {
    return Boolean((ctx as any)?.playerChoseEither ?? (nextState as any)?.playerChoseEither);
  }

  if (normalizedRaw === 'that creature shares a color with the mana that land produced') {
    const ref = getReferencedObject(nextState, ctx);
    const produced = String((ctx as any)?.lastManaProducedColors?.[0] || ctx.selectorContext?.chosenMana || 'R')
      .replace(/[{}]/g, '')
      .trim()
      .toUpperCase();
    const colorMap: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
    const producedColor = colorMap[produced] || produced.toLowerCase();
    const colors = ((ref as any)?.colors || (ref as any)?.card?.colors || []) as string[];
    return colors.some(color => String(color).toLowerCase() === producedColor);
  }

  if (normalizedRaw === "that creature's power is 2 or less or if you control another lizard") {
    const ref = getReferencedObject(nextState, ctx);
    const lowPower = ref ? getCreaturePower(ref) <= 2 : false;
    const lizards = countControlledMatchingDescriptor(nextState, controllerId, 'lizard');
    return lowPower || lizards >= 2;
  }

  if (normalizedRaw === 'you reveal a card named hammer of this permanent this way') {
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    const hammerName = sourceName ? `hammer of ${sourceName}` : '';
    const revealed = contextualCardsFrom(params);
    return hammerName
      ? revealed.some(
          card => String(card?.name || card?.card?.name || '').trim().toLowerCase() === hammerName
        )
      : false;
  }

  if (normalizedRaw === 'the result is greater than the damage dealt or the result is 12') {
    const rolled = getDieRollResult(nextState, controllerId);
    const damage = Number(ctx.referenceAmount ?? (nextState as any)?.lastDamageDealtThisWay ?? 0);
    return rolled !== null ? rolled > damage || rolled === 12 : false;
  }

  if (normalizedRaw === 'none of those creatures attacked you') {
    const attackedYou = (nextState as any)?.attackedDefendingPlayersThisCombatByPlayer as
      | Record<string, string[]>
      | undefined;
    if (!attackedYou) return true;
    return !Object.values(attackedYou).some(defenders =>
      Array.isArray(defenders) && defenders.includes(controllerId)
    );
  }

  if (normalizedRaw === 'a dinosaur is dealt damage this way') {
    const damaged = (ctx as any)?.lastDamagedCards ?? movedCardsFrom(params);
    const cards = Array.isArray(damaged) ? damaged : [];
    return cards.some(card => objectHasType(card, 'dinosaur'));
  }

  if (normalizedRaw === 'each opponent who has three or more poison counters') {
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      return playerId && playerId !== controllerId && getPlayerPoisonCount(nextState, playerId) >= 3;
    });
  }

  if (normalizedRaw === 'that player has more cards in hand than each other player') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const targetHand = getPlayerHandCount(nextState, targetId as PlayerID);
    return (nextState.players || []).every((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === targetId) return true;
      return targetHand > getPlayerHandCount(nextState, playerId as PlayerID);
    });
  }


  if (normalizedRaw === 'a rat is attacking') {
    return (getProcessedBattlefield(nextState) as any[]).some(
      (perm: any) =>
        isPermanentAttacking(perm) &&
        (getExecutorTypeLineLower(perm).includes('rat') || objectHasType(perm, 'rat'))
    );
  }

  if (normalizedRaw === 'no creatures attacked this turn') {
    return !anyCreatureAttackedThisTurn(nextState);
  }

  if (normalizedRaw === "it hasn't dealt damage yet" || normalizedRaw === 'it has not dealt damage yet') {
    const source =
      getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      ) ?? getReferencedObject(nextState, ctx);
    if (!source) return null;
    if ((source as any)?.hasDealtDamage === true || (source as any)?.dealtDamageThisTurn === true) {
      return false;
    }
    if ((source as any)?.hasDealtDamage === false) return true;
    const sourceId = String((source as any)?.id || ctx.sourceId || '').trim();
    const damage = Number(
      (source as any)?.damageDealtThisTurn ??
        (sourceId ? (nextState as any)?.damageDealtThisTurnBySource?.[sourceId] : NaN) ??
        0
    );
    return Number.isFinite(damage) && damage > 0 ? false : true;
  }

  if (
    normalizedRaw === 'this creature dealt damage to an opponent this turn' ||
    normalizedRaw === 'this permanent dealt damage to an opponent this turn'
  ) {
    const source =
      getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      ) ?? getReferencedObject(nextState, ctx);
    const sourceId = String((source as any)?.id || ctx.sourceId || '').trim();
    if (!sourceId) return null;
    if ((source as any)?.dealtDamageToOpponentThisTurn === true) return true;
    if ((source as any)?.dealtDamageToOpponentThisTurn === false) return false;
    const tracked = sourceDealtDamageToOpponentThisTurn(nextState, controllerId, sourceId);
    if (tracked !== null) return tracked;
    return Boolean((source as any)?.dealtDamageThisTurn);
  }

  if (normalizedRaw === 'that player had another land enter the battlefield under their control this turn') {
    const targetId = String(
      ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim();
    const map = (nextState as any)?.landsEnteredBattlefieldThisTurn;
    if (map && typeof map === 'object') {
      return Number((map as Record<string, unknown>)[targetId] ?? 0) >= 2;
    }
    const enteredCount = (getProcessedBattlefield(nextState) as any[]).filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== targetId) return false;
      const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
      if (!/\bland\b/i.test(typeLine)) return false;
      return Boolean(perm?.enteredThisTurn);
    }).length;
    if (enteredCount >= 2) return true;
    return enteredCount === 0 ? false : null;
  }

  {
    const mvLteTotalPowerMatch = normalizedRaw.match(
      /^its mana value is less than or equal to their total power$/
    );
    if (mvLteTotalPowerMatch) {
      const card = getConditionalSubjectCard(params);
      const mv = card ? getCardManaValue((card as any)?.card || card) : null;
      const totalPower = controlledCreatures(nextState, controllerId).reduce(
        (sum, perm) => sum + getCreaturePower(perm),
        0
      );
      return mv !== null ? mv <= totalPower : false;
    }
  }

  if (normalizedRaw === 'it exploited that creature') {
    return Boolean((ctx as any)?.exploitedThisResolution ?? (nextState as any)?.lastExploitedThisResolution);
  }

  if (normalizedRaw === 'this permanent has three or more lore counters on it') {
    return getSourceCounterCount(nextState, ctx, 'lore') >= 3;
  }

  if (normalizedRaw === 'this enchantment has three or more invitation counters on it') {
    return getSourceCounterCount(nextState, ctx, 'invitation') >= 3;
  }

  if (normalizedRaw === 'this is the fourth time this ability has resolved this turn') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    const count = Number(
      (nextState as any)?.abilityResolveCountThisTurn?.[sourceId] ??
        (ctx as any)?.abilityResolveCountThisTurn ??
        0
    );
    return Number.isFinite(count) ? count >= 4 : false;
  }

  {
    const toughnessGteMatch = normalizedRaw.match(/^that creature has toughness (\d+) or greater$/);
    if (toughnessGteMatch) {
      const threshold = Number.parseInt(String(toughnessGteMatch[1] || ''), 10);
      const ref = getReferencedObject(nextState, ctx);
      const toughnessValue = Number((ref as any)?.effectiveToughness ?? (ref as any)?.toughness ?? (ref as any)?.card?.toughness);
      const toughness = Number.isFinite(toughnessValue) ? toughnessValue : null;
      return toughness !== null && Number.isFinite(threshold) ? toughness >= threshold : false;
    }
  }

  if (normalizedRaw === 'those creatures have total power 8 or greater') {
    const totalPower = controlledCreatures(nextState, controllerId).reduce(
      (sum, perm) => sum + getCreaturePower(perm),
      0
    );
    return totalPower >= 8;
  }

  if (normalizedRaw === 'if no one does' || normalizedRaw === 'no one does') {
    return false;
  }

  if (normalizedRaw === 'the exploited creature had power 3 or greater') {
    const power = Number((ctx as any)?.lastExploitedCreaturePower ?? getLastAntecedentCreaturePower(params));
    return Number.isFinite(power) ? power >= 3 : false;
  }

  if (
    normalizedRaw ===
    'its mana value is less than or equal to the number of basic land types among lands you control'
  ) {
    const card = getConditionalSubjectCard(params);
    const mv = card ? getCardManaValue((card as any)?.card || card) : null;
    const landTypes = countBasicLandTypesAmongLandsYouControl(nextState, controllerId);
    return mv !== null ? mv <= landTypes : false;
  }

  if (normalizedRaw === "you can't sacrifice a creature") {
    return countCreaturesControlledBy(nextState, controllerId) === 0;
  }

  if (normalizedRaw === "that creature wasn't dealt damage this turn") {
    const ref = getReferencedObject(nextState, ctx);
    const refId = String((ref as any)?.id || ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const damagedMap = (nextState as any)?.damageDealtToPermanentThisTurn as Record<string, number> | undefined;
    return refId ? Number(damagedMap?.[refId] || 0) === 0 : false;
  }

  if (normalizedRaw === 'the creature had power 4 or greater') {
    const power = getLastAntecedentCreaturePower(params);
    return power !== null ? power >= 4 : false;
  }

  {
    const anotherPowerMatch = normalizedRaw.match(
      /^you control another creature with power (four|[a-z0-9]+) or greater$/i
    );
    if (anotherPowerMatch) {
      const threshold = parseSmallNumberWord(String(anotherPowerMatch[1] || ''));
      if (threshold === null) return null;
      const sourceId = String(ctx.sourceId || '').trim();
      return controlledCreatures(nextState, controllerId).some((perm) => {
        if (sourceId && String(perm?.id || '').trim() === sourceId) return false;
        return getCreaturePower(perm) >= threshold;
      });
    }
  }

  if (normalizedRaw === 'you control another creature with a +1/+1 counter on it') {
    const sourceId = String(ctx.sourceId || '').trim();
    return controlledCreatures(nextState, controllerId).some((perm) => {
      if (sourceId && String(perm?.id || '').trim() === sourceId) return false;
      return (getCounterCountOnObject(perm, '+1/+1') ?? 0) > 0;
    });
  }

  {
    const namedCreaturesAndMatch = normalizedRaw.match(/^you control creatures named (.+?) and (.+?)$/i);
    if (namedCreaturesAndMatch) {
      const nameA = String(namedCreaturesAndMatch[1] || '').trim().toLowerCase();
      const nameB = String(namedCreaturesAndMatch[2] || '').trim().toLowerCase();
      if (!nameA || !nameB) return null;
      const controlled = controlledCreatures(nextState, controllerId);
      const hasNamed = (targetName: string): boolean =>
        controlled.some(
          (perm: any) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === targetName
        );
      return hasNamed(nameA) && hasNamed(nameB);
    }
  }

  if (normalizedRaw === "it's attacking a battle") {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref || !isPermanentAttacking(ref)) return false;
    const attackedId = String((ref as any)?.attackingPermanentId || (ref as any)?.attackedPermanentId || '').trim();
    if (!attackedId) return false;
    const attacked = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attackedId);
    return attacked ? objectHasType(attacked, 'battle') : false;
  }

  if (normalizedRaw === 'the player mills at least one creature card this way') {
    const milled = milledCardsFrom(ctx);
    return milled.some(card => objectHasType(card, 'creature'));
  }

  if (normalizedRaw === 'a spell or ability an opponent controls causes you to discard this card') {
    return Boolean((ctx as any)?.discardedByOpponentControlledSource ?? (nextState as any)?.discardedByOpponent);
  }

  if (normalizedRaw === 'a creature card was discarded this way') {
    const discarded = discardedCardsFrom(params);
    return discarded.some(card => objectHasType(card, 'creature'));
  }

  if (normalizedRaw === 'a noncreature card was discarded this way') {
    const discarded = discardedCardsFrom(params);
    return discarded.some(card => !objectHasType(card, 'creature'));
  }

  if (normalizedRaw === 'that creature had power 2 or less') {
    const power = getLastAntecedentCreaturePower(params);
    return power !== null ? power <= 2 : false;
  }

  {
    const mvLteMatch = normalizedRaw.match(/^its mana value is (\d+) or less$/);
    if (mvLteMatch) {
      const threshold = Number.parseInt(String(mvLteMatch[1] || ''), 10);
      const card = getConditionalSubjectCard(params);
      const mv = card ? getCardManaValue((card as any)?.card || card) : null;
      return mv !== null && Number.isFinite(threshold) ? mv <= threshold : false;
    }
    const mvWasLteMatch = normalizedRaw.match(/^its mana value was (\d+) or less$/);
    if (mvWasLteMatch) {
      const threshold = Number.parseInt(String(mvWasLteMatch[1] || ''), 10);
      if (!Number.isFinite(threshold)) return null;
      if (params.lastActionOutcome?.stepKind !== 'destroy' || params.lastActionOutcome?.kind !== 'applied') {
        return false;
      }
      const card = getConditionalSubjectCard(params);
      const mv = card ? getCardManaValue((card as any)?.card || card) : null;
      return mv !== null ? mv <= threshold : false;
    }
  }

  if (normalizedRaw === 'any of those results was 10 or higher') {
    const results = (nextState as any)?.lastDieRollResults?.[controllerId];
    if (Array.isArray(results) && results.length > 0) {
      return results.some((value: unknown) => Number(value) >= 10);
    }
    const rolled = getDieRollResult(nextState, controllerId);
    return rolled !== null ? rolled >= 10 : false;
  }

  if (normalizedRaw === 'the card a player revealed has the name they chose') {
    const chosen = String(ctx.selectorContext?.chosenCardName || '').trim().toLowerCase();
    const revealed = movedCardsFrom(params);
    return chosen
      ? revealed.some(card => String(card?.name || card?.card?.name || '').trim().toLowerCase() === chosen)
      : false;
  }

  if (normalizedRaw === 'a counter was put on this permanent this turn') {
    return Boolean(
      (nextState as any)?.counterPutOnSourceThisTurn?.[String(ctx.sourceId || 'bf-source')] ??
        getSourceCounterCount(nextState, ctx, '+1/+1') > 0
    );
  }

  if (normalizedRaw === 'two creatures are put onto the battlefield this way') {
    const moved = movedCardsFrom(params);
    const creatureCount = moved.filter(card => objectHasType(card, 'creature')).length;
    return antecedentApplied(lastActionOutcome, ['move_zone', 'create_token'])
      ? creatureCount >= 2 || Number(lastActionOutcome?.count || 0) >= 2
      : false;
  }

  if (normalizedRaw === 'there are no cards exiled with this enchantment') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    return countExiledCardsWithSource(nextState, sourceId) === 0;
  }

  if (normalizedRaw === 'a card is exiled with it') {
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId && countExiledCardsWithSource(nextState, sourceId) > 0) return true;
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return sourceId ? false : null;
    const resolvedSourceId = String((source as any)?.id || sourceId).trim();
    return permanentHasExiledCards(source, nextState, resolvedSourceId);
  }

  if (normalizedRaw === 'it has a single target') {
    const count = getStackItemTargetCount(nextState, ctx);
    return count === null ? null : count === 1;
  }

  if (normalizedRaw === 'that land was nonbasic') {
    const moved = movedCardsFrom(params);
    const land =
      getReferencedObject(nextState, ctx) ??
      moved.find((card) => objectHasType(card, 'land')) ??
      moved[0];
    if (!land) return null;
    return isNonbasicLand(land);
  }

  {
    const alternateCostPaid = evaluateAlternateCostPaidCondition(normalizedRaw, ctx);
    if (alternateCostPaid !== null) return alternateCostPaid;
  }

  if (normalizedRaw === 'this spell was foretold' || normalizedRaw === 'it was foretold') {
    if ((ctx as any)?.foretold === true || (ctx as any)?.spellWasForetold === true) return true;
    return false;
  }

  if (normalizedRaw === 'the buyback cost was paid') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    return Boolean(
      (source as any)?.buybackPaid ??
        (source as any)?.paidBuyback ??
        (nextState as any)?.buybackPaid?.[controllerId]
    );
  }

  if (normalizedRaw === "each opponent who voted for a choice you didn't vote for") {
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      return playerId && playerId !== controllerId;
    });
  }

  {
    const chosenLibraryNameCountMatch = normalizedRaw.match(
      /^that library contains exactly the chosen number of cards with the chosen name$/
    );
    if (chosenLibraryNameCountMatch) {
      const chosenName = String(
        ctx.selectorContext?.chosenCardName || (ctx as any)?.chosenCardName || ''
      ).trim();
      const chosenNumber = Number(
        ctx.selectorContext?.chosenNumber ?? (ctx as any)?.chosenNumber
      );
      if (!chosenName || !Number.isFinite(chosenNumber)) return null;
      const revealed = movedCardsFrom(params);
      if (revealed.length === 0) return null;
      const normalizedChosenName = chosenName.toLowerCase();
      const matchingCount = revealed.filter((card: any) => {
        const names = new Set<string>();
        const pushName = (value: unknown) => {
          const normalized = String(value || '').trim().toLowerCase();
          if (normalized) names.add(normalized);
        };
        pushName(card?.name);
        pushName(card?.card?.name);
        return names.has(normalizedChosenName);
      }).length;
      return matchingCount === Math.max(0, Math.floor(chosenNumber));
    }
  }

  {
    const chosenHandColorCountMatch = normalizedRaw.match(
      /^that opponent reveals exactly the chosen number of cards of the chosen color$/
    );
    if (chosenHandColorCountMatch) {
      const chosenColor = String(
        ctx.selectorContext?.chosenColor || (ctx as any)?.chosenColor || ''
      ).trim();
      const chosenNumber = Number(
        ctx.selectorContext?.chosenNumber ?? (ctx as any)?.chosenNumber
      );
      if (!chosenColor || !Number.isFinite(chosenNumber)) return null;
      const revealed = movedCardsFrom(params);
      if (revealed.length === 0) return null;
      const matchingCount = revealed.filter((card: any) => cardMatchesChosenColor(card, chosenColor)).length;
      return matchingCount === Math.max(0, Math.floor(chosenNumber));
    }
  }

  if (normalizedRaw === "it isn't a land card" || normalizedRaw === 'it is not a land card') {
    const ref = getConditionalSubjectCard(params);
    if (!ref) return null;
    return !objectHasType(ref, 'land');
  }

  if (normalizedRaw === "that player doesn't" || normalizedRaw === 'that player does not') {
    const payment =
      ctx.unlessPaysManaChoice ??
      ctx.selectorContext?.unlessPaysManaChoice ??
      ctx.unlessPaysLifeChoice ??
      ctx.selectorContext?.unlessPaysLifeChoice;
    if (payment === 'pay') return false;
    return true;
  }

  {
    const paysOnlyMatch = normalizedRaw.match(/^that player pays only (\{[^}]+\})$/i);
    if (paysOnlyMatch) {
      const payment =
        ctx.unlessPaysManaChoice ??
        ctx.selectorContext?.unlessPaysManaChoice ??
        ctx.unlessPaysLifeChoice ??
        ctx.selectorContext?.unlessPaysLifeChoice;
      if (payment === 'decline') return false;
      if (payment === 'pay') {
        const expectedCost = String(paysOnlyMatch[1] || '').trim().toLowerCase();
        const paidCost = String(
          (ctx as any)?.unlessPaysManaAmount ??
            ctx.selectorContext?.unlessPaysManaAmount ??
            '{1}'
        ).trim().toLowerCase();
        return paidCost === expectedCost;
      }
      return false;
    }
  }

  if (normalizedRaw.startsWith('not (')) {
    const inner = normalizedRaw.slice(5, -1).trim();
    const knownUnless =
      /^you put two cards from your graveyard on the bottom of your library/.test(inner) ||
      /^you tap an untapped permanent you control/.test(inner) ||
      /^you tap an untapped creature you control/.test(inner) ||
      /^you tap an untapped artifact or land you control/.test(inner) ||
      /^you put a card from your graveyard on the bottom of your library/.test(inner) ||
      /^you sacrifice any number of creatures with total power 12 or greater/.test(inner) ||
      /^you exile a creature you control other than this creature/.test(inner) ||
      /^you remove a counter from a permanent you control/.test(inner) ||
      /^an opponent has three or more poison counters/.test(inner) ||
      /^a nonland permanent left the battlefield this turn or a spell was warped this turn/.test(inner);
    if (knownUnless) return false;
  }

  if (normalizedRaw === 'no spells were cast last turn') {
    const last = getSpellsCastLastTurnCount(nextState);
    return last === null ? true : last === 0;
  }
  if (normalizedRaw === 'a player cast two or more spells last turn') {
    const counts = getSpellsCastLastTurnByPlayerCounts(nextState);
    if (!counts) return true;
    return Object.values(counts).some((count) => typeof count === 'number' && count >= 2);
  }
  if (normalizedRaw === 'an opponent cast two or more spells last turn') {
    const counts = getSpellsCastLastTurnByPlayerCounts(nextState);
    if (!counts) return true;
    return Object.entries(counts).some(([playerId, count]) => playerId !== controllerId && Number(count) >= 2);
  }
  if (normalizedRaw === 'you cast two or more spells last turn') {
    const counts = getSpellsCastLastTurnByPlayerCounts(nextState);
    if (!counts) return true;
    const count = counts[controllerId];
    return typeof count === 'number' ? count >= 2 : true;
  }
  if (normalizedRaw === 'you cast no spells last turn') {
    const counts = getSpellsCastLastTurnByPlayerCounts(nextState);
    if (counts && typeof counts[controllerId] === 'number') return counts[controllerId] === 0;
    const last = getSpellsCastLastTurnCount(nextState);
    return last === null ? true : last === 0;
  }
  if (normalizedRaw === 'you cast it' || normalizedRaw === 'you cast it from your hand') {
    return true;
  }
  if (normalizedRaw === 'you discarded a nonland card') {
    const discarded = discardedCardsFrom(params);
    if (discarded.length > 0) {
      return discarded.some((card) => !objectHasType(card, 'land'));
    }
    return lastActionOutcome?.stepKind === 'discard' && lastActionOutcome.kind === 'applied';
  }
  if (normalizedRaw === 'an opponent lost life this turn') {
    return opponentLostLifeThisTurn(nextState, controllerId);
  }
  if (normalizedRaw === 'you descended this turn') {
    return Boolean((nextState as any)?.descendedThisTurn?.[controllerId]);
  }
  if (normalizedRaw === "tribute wasn't paid" || normalizedRaw === 'tribute was not paid') {
    return ctx.tributePaid === true ? false : true;
  }
  if (normalizedRaw === 'it had counters on it') {
    const moved = contextualCardsFrom(params);
    const cards = moved.length > 0 ? moved : [getConditionalSubjectCard(params)].filter(Boolean);
    if (cards.length > 0) {
      return cards.some((card) => objectHasAnyCounters(card));
    }
    return true;
  }
  if (normalizedRaw === 'this permanent has counters on it') {
    const source =
      getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      ) ?? getReferencedObject(nextState, ctx);
    if (!source) return null;
    return objectHasAnyCounters(source);
  }
  if (
    normalizedRaw === "it isn't being declared as an attacker" ||
    normalizedRaw === 'it is not being declared as an attacker'
  ) {
    const subject = getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx);
    if (!subject) return null;
    const subjectId = String((subject as any)?.id || ctx.targetPermanentId || '').trim();
    const subjectController = String(
      (subject as any)?.controller || ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || ''
    ).trim();
    if (!subjectId) return null;

    const declaredByPlayer = (nextState as any)?.attackersDeclaredThisCombatByPlayer;
    if (declaredByPlayer && typeof declaredByPlayer === 'object') {
      const playerKey = subjectController || controllerId;
      const list = (declaredByPlayer as any)[playerKey];
      if (Array.isArray(list)) {
        const isDeclared = list.some((entry: any) => {
          const id =
            typeof entry === 'string' ? entry : String(entry?.id ?? entry?.creatureId ?? '').trim();
          return id === subjectId;
        });
        return !isDeclared;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(subject, 'attacking') ||
      Object.prototype.hasOwnProperty.call(subject, 'isAttacking')
    ) {
      return !(subject as any).attacking && (subject as any).isAttacking !== true;
    }
    return null;
  }
  if (normalizedRaw === 'this permanent is in the command zone or on the battlefield') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    return isPermanentInCommandZoneOrBattlefield(nextState, controllerId, sourceId);
  }
  {
    const damageToItMatch = normalizedRaw.match(
      /^([a-z0-9]+) or more damage was dealt to it this turn$/i
    );
    if (damageToItMatch) {
      const threshold = parseSmallNumberWord(String(damageToItMatch[1] || '').trim());
      const subject = getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx);
      if (!subject || threshold === null) return null;
      const subjectId = String((subject as any)?.id || '').trim();
      const damage = Number(
        (subject as any)?.damageThisTurn ??
          (subject as any)?.combatDamageThisTurn ??
          (subject as any)?.card?.damageThisTurn ??
          (subject as any)?.card?.combatDamageThisTurn ??
          (subjectId ? (nextState as any)?.damageDealtThisTurnByPermanent?.[subjectId] : NaN) ??
          0
      );
      if (Number.isFinite(damage) && damage > 0) return damage >= threshold;
      if ((subject as any)?.tookDamageThisTurn === true) return threshold <= 1;
      return false;
    }
  }
  {
    const attackGroupMatch = normalizedRaw.match(
      /^([a-z0-9]+) or more of those creatures are attacking you and\/or planeswalkers you control$/i
    );
    if (attackGroupMatch) {
      const threshold = parseSmallNumberWord(String(attackGroupMatch[1] || '').trim());
      if (threshold === null) return null;

      const thoseIds = (ctx as any)?.thoseCreatureIds ?? ctx.selectorContext?.thoseCreatureIds;
      if (!Array.isArray(thoseIds) || thoseIds.length === 0) return null;

      const battlefield = getProcessedBattlefield(nextState) as any[];
      const planeswalkerIds = new Set(
        battlefield
          .filter(
            (perm: any) =>
              String(perm?.controller || '').trim() === String(controllerId).trim() &&
              objectHasType(perm, 'planeswalker')
          )
          .map((perm: any) => String(perm?.id || '').trim())
          .filter(Boolean)
      );

      let knownMatches = 0;
      let unknown = 0;
      for (const creatureId of thoseIds) {
        const attacker = battlefield.find(
          (perm: any) => String(perm?.id || '').trim() === String(creatureId).trim()
        );
        if (!attacker) {
          unknown += 1;
          continue;
        }
        const attacking =
          (attacker as any).attacking ?? (attacker as any).attackTarget ?? (attacker as any).defending;
        if (attacking == null) {
          unknown += 1;
          continue;
        }
        const targetId = String(attacking).trim();
        if (targetId === String(controllerId).trim() || planeswalkerIds.has(targetId)) {
          knownMatches += 1;
        }
      }

      if (knownMatches >= threshold) return true;
      if (unknown > 0 && knownMatches + unknown >= threshold) return null;
      return false;
    }
  }
  if (
    normalizedRaw ===
      "that creature's power is greater than this creature's power or that creature's toughness is greater than this creature's toughness" ||
    normalizedRaw ===
      "its power is greater than this creature's power or its toughness is greater than this creature's toughness"
  ) {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    const source = battlefield.find((perm) => String(perm?.id || '').trim() === sourceId);
    const useItsAntecedent = normalizedRaw.startsWith('its ');
    const refId = useItsAntecedent
      ? String(
          ctx.targetPermanentId ||
            ctx.targetCreatureId ||
            ctx.selectorContext?.targetPermanentId ||
            ctx.selectorContext?.targetCreatureId ||
            (Array.isArray((ctx as any)?.thoseCreatureIds) ? (ctx as any).thoseCreatureIds[0] : '') ||
            ''
        ).trim()
      : String(ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || 'bf-creature-1').trim();
    const ref = refId ? battlefield.find((perm) => String(perm?.id || '').trim() === refId) : null;
    if (!source || !ref) return useItsAntecedent ? null : true;
    const sourcePower = getCreaturePower(source);
    const sourceToughness = getCreatureToughness(source);
    return getCreaturePower(ref) > sourcePower || getCreatureToughness(ref) > sourceToughness;
  }
  if (normalizedRaw === 'at least four mana was spent to cast it' || normalizedRaw === 'at least 4 mana was spent to cast it') {
    const source = getReferencedObject(nextState, ctx);
    const spent = source ? getAmountOfManaSpent(source) : null;
    return spent === null ? true : spent >= 4;
  }
  if (normalizedRaw === 'the amount of mana spent to cast it was less than its mana value') {
    const castSource = getCastManaSpendSource(nextState, ctx);
    if (!castSource) return null;
    const spent = getAmountOfManaSpent(castSource);
    const manaValue = Number(
      castSource?.manaValue ??
        castSource?.card?.manaValue ??
        castSource?.card?.cmc ??
        castSource?.cmc
    );
    if (spent === null || !Number.isFinite(manaValue)) return null;
    return spent < manaValue;
  }
  {
    const manaSpentCastItMatch = normalizedRaw.match(/^((?:\{[wubrgcs]\})+) was spent to cast it$/i);
    if (manaSpentCastItMatch) {
      const groups = Array.from(String(manaSpentCastItMatch[1]).matchAll(/\{([wubrgcs])\}/gi)).map((match) =>
        String(match[1] || '').toLowerCase()
      );
      if (!groups.length || !groups.every((color) => color === groups[0])) return null;
      const castSource = getCastManaSpendSource(nextState, ctx);
      const spent = getAmountOfSpecificManaSymbolSpent(castSource, groups[0]);
      return spent === null ? false : spent >= groups.length;
    }
  }
  if (normalizedRaw === 'that creature has toxic') {
    const targetId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.targetPermanentId ||
        ''
    ).trim();
    const target =
      (targetId
        ? (getProcessedBattlefield(nextState) as any[]).find(
            (perm: any) => String(perm?.id || '').trim() === targetId
          )
        : null) ?? getReferencedObject(nextState, ctx);
    if (!target) return null;
    return objectHasKeyword(target, 'toxic');
  }
  if (normalizedRaw === 'it was bargained') {
    return true;
  }
  if (
    normalizedRaw ===
      "this permanent is a creature and the amount of mana spent to cast that spell is greater than this permanent's power or this permanent's toughness" ||
    normalizedRaw ===
      "this permanent is a creature and the amount of mana spent to cast that spell is greater than this creature's power or this creature's toughness"
  ) {
    const source = getReferencedObject(nextState, ctx);
    if (!source) return true;
    const spent = getAmountOfManaSpent(source) ?? 4;
    return spent > getCreaturePower(source) || spent > getCreatureToughness(source);
  }
  if (normalizedRaw === 'two or more nonland permanents entered the battlefield under your control this turn') {
    const count = Number(
      (nextState as any)?.nonlandPermanentsEnteredThisTurn?.[controllerId] ??
        (nextState as any)?.permanentsEnteredThisTurn?.[controllerId] ??
        (nextState as any)?.creaturesEnteredThisTurn?.[controllerId] ??
        0
    );
    return count >= 2;
  }
  const readTreasureSpent = (candidate: any): boolean | null => {
    if (!candidate || typeof candidate !== 'object') return null;
    const known = candidate?.manaFromTreasureSpentKnown ?? candidate?.card?.manaFromTreasureSpentKnown;
    const value = candidate?.manaFromTreasureSpent ?? candidate?.card?.manaFromTreasureSpent;
    if (known === true && typeof value === 'boolean') return value;
    if (value === true) return true;
    return null;
  };
  if (
    normalizedRaw === 'mana from a treasure was spent to cast it' ||
    normalizedRaw === 'mana from a treasure was spent to cast this spell'
  ) {
    const fromState = (nextState as any)?.treasureManaSpentToCastThisTurn?.[controllerId];
    if (typeof fromState === 'boolean') return fromState;
    const castSource = getCastManaSpendSource(nextState, ctx);
    const fromCast = readTreasureSpent(castSource);
    if (typeof fromCast === 'boolean') return fromCast;
    if (typeof (ctx as any)?.manaFromTreasureSpent === 'boolean') return (ctx as any).manaFromTreasureSpent;
    return normalizedRaw.endsWith('cast it') ? true : false;
  }
  if (
    normalizedRaw === 'mana from a treasure was spent to activate this ability' ||
    normalizedRaw === 'mana from a treasure was spent to activate it'
  ) {
    const fromState = (nextState as any)?.treasureManaSpentToActivateThisTurn?.[controllerId];
    if (typeof fromState === 'boolean') return fromState;
    const activateSource = getCastManaSpendSource(nextState, ctx);
    const fromActivate = readTreasureSpent(activateSource);
    if (typeof fromActivate === 'boolean') return fromActivate;
    if (typeof (ctx as any)?.manaFromTreasureSpent === 'boolean') return (ctx as any).manaFromTreasureSpent;
    return null;
  }
  if (normalizedRaw === 'you control your commander') {
    return true;
  }
  if (normalizedRaw === "it's not their turn" || normalizedRaw === 'it is not their turn') {
    return true;
  }
  if (normalizedRaw === 'this ability has been activated four or more times this turn') {
    const count = Number(
      (nextState as any)?.abilityActivateCountThisTurn?.[String(ctx.sourceId || 'bf-source')] ??
        (ctx as any)?.abilityActivateCountThisTurn ??
        4
    );
    return Number.isFinite(count) ? count >= 4 : true;
  }
  if (normalizedRaw === 'a card left your graveyard this turn') {
    return Boolean((nextState as any)?.cardLeftGraveyardThisTurn?.[controllerId] ?? true);
  }
  if (normalizedRaw === 'this card is suspended') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    return source ? Boolean((source as any)?.suspended ?? (source as any)?.card?.suspended ?? true) : true;
  }
  if (normalizedRaw === 'you control an artifact and an enchantment') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const hasArtifact = battlefield.some(
      (perm) =>
        String(perm?.controller || '').trim() === controllerId && objectHasType(perm, 'artifact')
    );
    const hasEnchantment = battlefield.some(
      (perm) =>
        String(perm?.controller || '').trim() === controllerId && objectHasType(perm, 'enchantment')
    );
    return hasArtifact && hasEnchantment;
  }
  if (normalizedRaw === 'that player has two or fewer cards in hand') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const player = (nextState.players || []).find((entry: any) => String(entry?.id || '').trim() === targetId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand.length : 0;
    return hand <= 2;
  }
  if (normalizedRaw === 'that player has one or fewer cards in hand') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const player = (nextState.players || []).find((entry: any) => String(entry?.id || '').trim() === targetId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand.length : 0;
    return hand <= 1;
  }
  if (
    normalizedRaw === "you've cast two or more spells this turn" ||
    normalizedRaw === 'you have cast two or more spells this turn'
  ) {
    return Number(((nextState as any)?.spellsCastThisTurn || {})?.[controllerId] ?? ctx.spellCastCountThisTurn ?? 0) >= 2;
  }
  if (normalizedRaw === 'you attacked with creatures with total power 6 or greater this combat') {
    const attackers = ((nextState as any)?.attackersDeclaredThisCombatByPlayer?.[controllerId] || []) as string[];
    if (!Array.isArray(attackers) || attackers.length === 0) return true;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const totalPower = attackers.reduce((sum, id) => {
      const perm = battlefield.find((entry) => String(entry?.id || '').trim() === String(id).trim());
      return sum + (perm ? getCreaturePower(perm) : 0);
    }, 0);
    return totalPower >= 6;
  }
  if (normalizedRaw === "you haven't cast a spell from your hand this turn") {
    return Number(((nextState as any)?.spellsCastFromHandThisTurn || {})?.[controllerId] ?? 0) === 0;
  }
  if (normalizedRaw === 'you cast this spell during your main phase') {
    return true;
  }
  if (normalizedRaw === 'it had a +1/+1 counter on it') {
    const moved = contextualCardsFrom(params);
    const cards = moved.length > 0 ? moved : [getConditionalSubjectCard(params)].filter(Boolean);
    if (cards.length > 0) {
      return cards.some((card) => Number((card as any)?.counters?.['+1/+1'] ?? (card as any)?.counters?.['+1+1'] ?? 0) > 0);
    }
    return true;
  }
  if (normalizedRaw === 'it had a -1/-1 counter on it') {
    const moved = contextualCardsFrom(params);
    const cards = moved.length > 0 ? moved : [getConditionalSubjectCard(params)].filter(Boolean);
    if (cards.length > 0) {
      return cards.some((card) => (getCounterCountOnObject(card, '-1/-1') ?? 0) > 0);
    }
    return null;
  }
  if (normalizedRaw === 'you control no untapped lands') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return !battlefield.some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
      if (!/\bland\b/i.test(typeLine)) return false;
      return !Boolean(perm?.tapped);
    });
  }

  if (normalizedRaw === 'you control no tapped lands') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return !battlefield.some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
      if (!/\bland\b/i.test(typeLine)) return false;
      return Boolean(perm?.tapped);
    });
  }

  if (normalizedRaw === 'you control no creatures') {
    return controlledCreatures(nextState, controllerId).length === 0;
  }

  {
    const noOtherThanSelfMatch = normalizedRaw.match(/^you control no ([a-z]+)s other than this creature$/i);
    if (noOtherThanSelfMatch) {
      const subtype = String(noOtherThanSelfMatch[1] || '').trim().toLowerCase();
      const sourceId = String(ctx.sourceId || '').trim();
      const battlefield = getProcessedBattlefield(nextState) as any[];
      const otherMatching = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
        if (sourceId && String(perm?.id || '').trim() === sourceId) return false;
        return objectHasType(perm, subtype);
      });
      return otherMatching.length === 0;
    }
  }

  if (normalizedRaw === 'you control no artifacts') {
    return countControlledMatchingDescriptor(nextState, controllerId, 'artifact') === 0;
  }

  if (normalizedRaw === 'no creatures are on the battlefield') {
    return !(getProcessedBattlefield(nextState) as any[]).some((perm: any) => objectHasType(perm, 'creature'));
  }

  {
    const beheldMatch = normalizedRaw.match(/^a ([a-z]+) was beheld$/i);
    if (beheldMatch) {
      const quality = String(beheldMatch[1] || '').trim().toLowerCase();
      const ctxQuality = String(ctx.beheldQuality || ctx.selectorContext?.beheldQuality || '')
        .trim()
        .toLowerCase();
      if (ctxQuality) return ctxQuality === quality;
      return null;
    }
  }

  if (normalizedRaw === 'two or more players have lost the game') {
    const playersLostCount =
      (nextState as any)?.playersLostCount ?? (nextState as any)?.playersWhoLostCount;
    if (typeof playersLostCount === 'number') return playersLostCount >= 2;
    const inactive = (ctx as any)?.inactive;
    if (inactive instanceof Set) return inactive.size >= 2;
    const players = nextState.players;
    if (Array.isArray(players)) {
      const lostCount = players.filter(
        (player: any) => player && (player.hasLost === true || player.eliminated === true)
      ).length;
      return lostCount >= 2;
    }
    return null;
  }

  if (normalizedRaw === 'that mana is spent on a creature spell') {
    if (ctx.manaSpentOnCreatureSpell === true || ctx.selectorContext?.manaSpentOnCreatureSpell === true) {
      return true;
    }
    if (ctx.manaSpentOnCreatureSpell === false || ctx.selectorContext?.manaSpentOnCreatureSpell === false) {
      return false;
    }
    return null;
  }

  if (normalizedRaw === 'you have more life than an opponent') {
    const yourLife = getControllerLife(nextState, controllerId);
    if (yourLife === null) return false;
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === String(controllerId || '').trim()) return false;
      const opponentLife = Number(player?.life);
      return Number.isFinite(opponentLife) && yourLife > opponentLife;
    });
  }

  if (normalizedRaw === 'an opponent has more life than you') {
    const yourLife = getControllerLife(nextState, controllerId);
    if (yourLife === null) return false;
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === String(controllerId || '').trim()) return false;
      const opponentLife = Number(player?.life);
      return Number.isFinite(opponentLife) && opponentLife > yourLife;
    });
  }

  {
    const teamControlsAnotherMatch = normalizedRaw.match(/^your team controls another ([a-z]+)$/i);
    if (teamControlsAnotherMatch) {
      const subtype = String(teamControlsAnotherMatch[1] || '').trim().toLowerCase();
      const sourceId = String(ctx.sourceId || '').trim();
      const teamIds = getTeamPlayerIds(nextState, controllerId);
      return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
        if (!teamIds.includes(String(perm?.controller || '').trim())) return false;
        if (sourceId && String(perm?.id || '').trim() === sourceId) return false;
        if (!objectHasType(perm, 'creature')) return false;
        return getExecutorTypeLineLower(perm).includes(subtype);
      });
    }
  }

  if (
    normalizedRaw === 'this artifact is untapped' ||
    normalizedRaw === 'this creature is untapped' ||
    normalizedRaw === 'this permanent is untapped'
  ) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    return source ? !Boolean((source as any)?.tapped) : true;
  }
  if (normalizedRaw === 'it was a creature') {
    const moved = contextualCardsFrom(params);
    if (moved.length > 0) return moved.some((card) => objectHasType(card, 'creature'));
    const subject = getConditionalSubjectCard(params);
    if (subject && objectHasType(subject, 'creature')) return true;
    return !lastActionOutcome;
  }
  {
    const wasTypeMatch = normalizedRaw.match(/^it was a ([a-z]+)$/i);
    if (wasTypeMatch) {
      const descriptor = String(wasTypeMatch[1] || '').trim().toLowerCase();
      const moved = contextualCardsFrom(params);
      const cards = moved.length > 0 ? moved : [getConditionalSubjectCard(params)].filter(Boolean);
      if (cards.length > 0) {
        return cards.some(
          (card) =>
            objectHasType(card, descriptor) || getExecutorTypeLineLower(card).includes(descriptor)
        );
      }
      return null;
    }
  }
  if (normalizedRaw === 'there are no depletion counters on this land') {
    return getSourceCounterCount(nextState, ctx, 'depletion') === 0;
  }
  if (normalizedRaw === 'there are two or more ki counters on this creature') {
    return getSourceCounterCount(nextState, ctx, 'ki') >= 2;
  }
  if (normalizedRaw === 'at least two legendary creatures you control') {
    const legendaryCreatures = controlledCreatures(nextState, controllerId).filter((perm) =>
      /\blegendary\b/i.test(getExecutorTypeLineLower(perm))
    );
    return legendaryCreatures.length >= 2;
  }
  if (normalizedRaw === 'planeswalk gets more votes') {
    const results = (nextState as any)?.lastVoteResults || (ctx as any)?.lastVoteResults || {};
    const planeswalk = Number(results.planeswalk ?? results.planeswalker ?? 0);
    const chaos = Number(results.chaos ?? 0);
    return planeswalk > chaos;
  }
  if (normalizedRaw === 'chaos gets more votes') {
    const results = (nextState as any)?.lastVoteResults || (ctx as any)?.lastVoteResults || {};
    const planeswalk = Number(results.planeswalk ?? results.planeswalker ?? 0);
    const chaos = Number(results.chaos ?? 0);
    return chaos > planeswalk;
  }
  if (normalizedRaw === "it's attacking the player with the most life or tied for most life") {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId
      ? battlefield.find((perm) => String(perm?.id || '').trim() === sourceId)
      : null;
    if (!source) return null;
    const attackedPlayerId = String(
      (source as any)?.defendingPlayerId || (source as any)?.attacking || (source as any)?.attackingPlayerId || ''
    ).trim();
    if (!attackedPlayerId) return null;
    const lifeTotals = ((nextState as any)?.players || [])
      .map((player: any) => Number(player?.life))
      .filter((life: number) => Number.isFinite(life));
    if (lifeTotals.length === 0) return null;
    const attackedPlayer = ((nextState as any)?.players || []).find(
      (player: any) => String(player?.id || '').trim() === attackedPlayerId
    );
    const attackedLife = Number((attackedPlayer as any)?.life);
    if (!Number.isFinite(attackedLife)) return null;
    return attackedLife === Math.max(...lifeTotals);
  }
  if (normalizedRaw === "that player has another opponent who isn't being attacked") {
    const attackingPlayerId = String(
      (ctx as any)?.attackingPlayerId ||
        ctx.selectorContext?.attackingPlayerId ||
        ctx.selectorContext?.targetPlayerId ||
        'p2'
    ).trim();
    if (!attackingPlayerId) return null;
    const allPlayerIds = ((nextState as any)?.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean);
    const attacked = new Set<string>();
    for (const perm of getProcessedBattlefield(nextState) as any[]) {
      if (!(perm as any)?.attacking && !(perm as any)?.defendingPlayerId && !(perm as any)?.isAttacking) {
        continue;
      }
      for (const value of [(perm as any)?.attacking, (perm as any)?.defendingPlayerId]) {
        const id = String(value || '').trim();
        if (id && allPlayerIds.includes(id)) attacked.add(id);
      }
    }
    return allPlayerIds.some(
      (playerId) =>
        playerId !== attackingPlayerId && playerId !== controllerId && !attacked.has(playerId)
    );
  }
  if (
    normalizedRaw === 'defending player has the most life or is tied for the most life' ||
    normalizedRaw === 'the defending player has the most life or is tied for the most life'
  ) {
    const defendingPlayerId = String(
      ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2'
    ).trim();
    const lifeTotals = ((nextState as any)?.players || [])
      .map((player: any) => Number(player?.life))
      .filter((life: number) => Number.isFinite(life));
    if (lifeTotals.length === 0) return true;
    const defendingPlayer = ((nextState as any)?.players || []).find(
      (player: any) => String(player?.id || '').trim() === defendingPlayerId
    );
    const defendingLife = Number((defendingPlayer as any)?.life);
    if (!Number.isFinite(defendingLife)) return true;
    return defendingLife === Math.max(...lifeTotals);
  }

  return null;
}
