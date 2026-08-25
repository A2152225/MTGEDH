// Origin parent: oracleIRExecutorConditionalStepSupportExtended.ts
// Cluster moved: local helpers evaluateAlternateCostPaidCondition through getLastAntecedentCreaturePower.
// Public entry symbols: objectHasType, getReferencedObject, movedCardsFrom,
//   getControlledTypeEnteredThisTurnCount, and the other clause helpers exported below.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ExtendedConditionalParams, LastActionOutcome } from './oracleIRExecutorConditionalStepExtendedTypes';
import { collectCommandZoneObjects } from './oracleIRExecutorCommanderUtils';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { isCardExiledWithSource } from './oracleIRExecutorPlayerUtils';
import { cardMatchesType } from './oracleIRExecutorZoneOps';
import {
  collectRevealedThisWayCardsLedgerFirst,
  resolveAntecedentContextualCards,
  resolveAntecedentDiscardedCards,
  resolveAntecedentMilledCards,
  resolveAntecedentMovedCards,
} from './oracleIRLedgerCardAccess';

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
  if (normalized === 'permanent') {
    return cardMatchesType(object, 'permanent');
  }
  if (hasExecutorClass(object, normalized)) return true;
  return matchesTypeLine(getExecutorTypeLineLower(object), normalized);
}

function getReferencedObject(nextState: GameState, ctx: OracleIRExecutionContext): any | null {
  const battlefield = getProcessedBattlefield(nextState);
  const id =
    String(ctx.targetPermanentId || '').trim() ||
    String(ctx.targetCreatureId || '').trim() ||
    String((ctx as any)?.thisCreatureId || '').trim() ||
    String((ctx as any)?.thisPermanentId || '').trim() ||
    String((ctx.selectorContext?.chosenObjectIds || [])[0] || '').trim() ||
    String(ctx.sourceId || '').trim();
  if (!id) return null;
  const onBattlefield = findObjectByIdInState(nextState, battlefield as any, id);
  if (onBattlefield) return onBattlefield;
  for (const player of nextState.players || []) {
    for (const zone of ['hand', 'graveyard', 'exile', 'library'] as const) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      const found = cards.find((card: any) => String(card?.id || '').trim() === id);
      if (found) return found;
    }
  }
  const moved = Array.isArray((ctx as any)?.lastMovedCards) ? (ctx as any).lastMovedCards : [];
  if (moved.length > 0) {
    const hit = moved.find((card: any) => String(card?.id || '').trim() === id) ?? moved[moved.length - 1];
    if (hit) return hit;
  }
  return null;
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
    return parts.some(part => {
      const term = part.replace(/^an?\s+/, '');
      if (objectHasType(perm, term)) return true;
      // "you control four or more artifacts" captures the plural noun, but type lines are singular.
      // Subtypes that already end in "s" (Pegasus, Homunculus) are matched by the check above first.
      return /s$/i.test(term) ? objectHasType(perm, term.replace(/s$/i, '')) : false;
    });
  }).length;
}

function antecedentApplied(outcome: LastActionOutcome, stepKinds: readonly string[]): boolean {
  return outcome?.kind === 'applied' && stepKinds.includes(String(outcome.stepKind));
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

function getPlayerLife(nextState: GameState, playerId: PlayerID | string): number | null {
  const normalizedId = String(playerId || '').trim();
  if (!normalizedId) return null;

  const lifeMap = (nextState as any)?.life;
  if (lifeMap && typeof lifeMap === 'object' && Number.isFinite(Number(lifeMap[normalizedId]))) {
    return Number(lifeMap[normalizedId]);
  }

  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === normalizedId) as any;
  const life = Number(player?.life ?? (nextState as any)?.startingLife);
  return Number.isFinite(life) ? life : null;
}

function getControllerLife(nextState: GameState, controllerId: PlayerID): number | null {
  return getPlayerLife(nextState, controllerId);
}

function getPlayerHandCount(nextState: GameState, playerId: PlayerID): number {
  const zones = (nextState as any)?.zones;
  const zoneHandCount = zones?.[playerId]?.handCount;
  if (typeof zoneHandCount === 'number' && Number.isFinite(zoneHandCount) && zoneHandCount >= 0) {
    return zoneHandCount;
  }

  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === playerId) as any;
  if (typeof player?.handCount === 'number' && Number.isFinite(player.handCount) && player.handCount >= 0) {
    return player.handCount;
  }

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

type MovedCardsParams = {
  readonly ctx: OracleIRExecutionContext;
  readonly lastMovedCards?: readonly any[];
};

type DiscardedCardsParams = {
  readonly ctx: OracleIRExecutionContext;
  readonly lastDiscardedCards?: readonly any[];
};

type ContextualCardsParams = MovedCardsParams & DiscardedCardsParams;

type ConditionalSubjectParams = MovedCardsParams & {
  readonly nextState: GameState;
  readonly step?: OracleEffectStep;
};

function movedCardsFrom(params: MovedCardsParams): any[] {
  return resolveAntecedentMovedCards(params.ctx, { lastMovedCards: params.lastMovedCards }) as any[];
}

function discardedCardsFrom(params: DiscardedCardsParams): any[] {
  return resolveAntecedentDiscardedCards(params.ctx, {
    lastDiscardedCards: params.lastDiscardedCards,
  }) as any[];
}

function milledCardsFrom(ctx: OracleIRExecutionContext): any[] {
  return resolveAntecedentMilledCards(ctx) as any[];
}

function contextualCardsFrom(params: ContextualCardsParams): any[] {
  return resolveAntecedentContextualCards(params.ctx, {
    lastMovedCards: params.lastMovedCards,
    lastDiscardedCards: params.lastDiscardedCards,
  }) as any[];
}

function getConditionalSubjectCard(params: ConditionalSubjectParams): any | null {
  const revealedLedger = collectRevealedThisWayCardsLedgerFirst(params.ctx, params.step);
  if (revealedLedger.length > 0) return revealedLedger[revealedLedger.length - 1];

  const revealedCtx = Array.isArray((params.ctx as any)?.lastRevealedCards)
    ? (params.ctx as any).lastRevealedCards
    : [];
  if (revealedCtx.length > 0) return revealedCtx[revealedCtx.length - 1];

  const moved = movedCardsFrom(params);
  if (Array.isArray(moved) && moved.length > 0) return moved[moved.length - 1];
  const ctx = params.ctx;
  const id =
    String((ctx as any)?.thisCreatureId || '').trim() ||
    String((ctx as any)?.thisPermanentId || '').trim() ||
    String((ctx as any)?.itCreatureId || '').trim() ||
    String(ctx.targetPermanentId || '').trim() ||
    String(ctx.targetCreatureId || '').trim() ||
    String(ctx.sourceId || '').trim();
  if (id) {
    const battlefield = getProcessedBattlefield(params.nextState) as any[];
    const onBf = findObjectByIdInState(params.nextState, battlefield, id);
    if (onBf) return onBf;
    const players = params.nextState.players || [];
    for (const player of players) {
      for (const zone of ['hand', 'graveyard', 'exile', 'library'] as const) {
        const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
        const found = cards.find((card: any) => String(card?.id || '').trim() === id);
        if (found) return found;
      }
    }
  }
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

function isPermanentModified(nextState: GameState, subject: any): boolean {
  const counters = (subject as any)?.counters;
  if (counters && typeof counters === 'object') {
    for (const value of Object.values(counters)) {
      if (typeof value === 'number' && value > 0) return true;
    }
  }
  if (Boolean((subject as any)?.isEquipped)) return true;
  const attachedEquipment = (subject as any)?.attachedEquipment;
  if (Array.isArray(attachedEquipment) && attachedEquipment.length > 0) return true;
  const subjectId = String((subject as any)?.id || '').trim();
  if (!subjectId) return false;
  const controllerId = String((subject as any)?.controller || '').trim();
  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.some((perm: any) => {
    if (String(perm?.attachedTo || '').trim() !== subjectId) return false;
    if (controllerId && String(perm?.controller || '').trim() !== controllerId) return false;
    const typeLine = getExecutorTypeLineLower(perm);
    return typeLine.includes('equipment') || typeLine.includes('enchantment') || typeLine.includes('aura');
  });
}

function noColoredManaWasSpentToCast(nextState: GameState, ctx: OracleIRExecutionContext): boolean | null {
  if ((ctx as any).noColoredManaSpentToCast === true || (ctx.selectorContext as any)?.noColoredManaSpentToCast === true) return true;
  if ((ctx as any).noColoredManaSpentToCast === false || (ctx.selectorContext as any)?.noColoredManaSpentToCast === false) {
    return false;
  }
  const castSource = getCastManaSpendSource(nextState, ctx);
  if (!castSource) return null;
  const breakdown = (castSource as any)?.manaSpentBreakdown ?? (castSource as any)?.card?.manaSpentBreakdown;
  if (breakdown && typeof breakdown === 'object') {
    const colorKeys = ['white', 'blue', 'black', 'red', 'green', 'w', 'u', 'b', 'r', 'g'];
    for (const key of colorKeys) {
      const value = Number((breakdown as Record<string, unknown>)[key]);
      if (Number.isFinite(value) && value > 0) return false;
    }
    return true;
  }
  const colorsArray =
    (castSource as any)?.manaColorsSpent ??
    (castSource as any)?.card?.manaColorsSpent ??
    (castSource as any)?.manaSpentColors ??
    (castSource as any)?.card?.manaSpentColors;
  if (Array.isArray(colorsArray)) return colorsArray.length === 0;
  return null;
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
export {
  evaluateAlternateCostPaidCondition,
  parseSmallNumberWord,
  getSpellsCastLastTurnCount,
  getSpellsCastLastTurnByPlayerCounts,
  opponentLostLifeThisTurn,
  objectHasType,
  getReferencedObject,
  getCreaturePower,
  getCreatureToughness,
  controlledCreatures,
  getTeamPlayerIds,
  countControlledMatchingDescriptor,
  antecedentApplied,
  cardMatchesChosenColor,
  cardsMatchDescriptor,
  getStackSpellPower,
  countBasicLandTypesAmongLandsYouControl,
  getPlayerLife,
  getControllerLife,
  getPlayerHandCount,
  objectHasAnyCounters,
  isPermanentInCommandZoneOrBattlefield,
  getGraveyardCards,
  getDieRollResult,
  movedCardsFrom,
  discardedCardsFrom,
  milledCardsFrom,
  contextualCardsFrom,
  getConditionalSubjectCard,
  cardsShareCardType,
  isPermanentAttacking,
  anyCreatureAttackedThisTurn,
  sourceDealtDamageToOpponentThisTurn,
  findBattlefieldPermanentByName,
  countCreaturesControlledBy,
  countExiledCardsWithSource,
  findExiledCardWithSource,
  getPlayerPoisonCount,
  getStackSpellCard,
  getCastManaSpendSource,
  isPermanentModified,
  noColoredManaWasSpentToCast,
  objectHasKeyword,
  getControlledTypeEnteredThisTurnCount,
  controllerCastBothCreatureAndNoncreatureThisTurn,
  getEnchantedCreatureFromAura,
  getStackItemTargetCount,
  permanentHasExiledCards,
  isNonbasicLand,
  getSourceCounterCount,
  getLastAntecedentCreaturePower,
};
