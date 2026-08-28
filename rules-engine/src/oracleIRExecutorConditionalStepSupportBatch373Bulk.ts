import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield, isBlockingPermanent } from './oracleIRExecutorCreatureStepUtils';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export type Batch373BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  getConditionalSubjectCard: (params: Batch373BulkParams) => any | null;
  getReferencedObject: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
  controlledCreatures: (nextState: GameState, controllerId: PlayerID) => any[];
  getGraveyardCards: (nextState: GameState, controllerId: PlayerID) => any[];
  getControllerLife: (nextState: GameState, playerId: PlayerID) => number | null;
  parseSmallNumberWord: (text: string) => number | null;
  objectHasType: (object: any, type: string) => boolean;
  objectHasKeyword: (object: any, keyword: string) => boolean;
  getPlayerHandCount: (nextState: GameState, playerId: PlayerID) => number;
  getCreaturePower: (perm: any) => number;
  getCreatureToughness: (perm: any) => number;
  movedCardsFrom: (params: Batch373BulkParams) => any[];
  isPermanentAttackingFn: (perm: any) => boolean;
};

function getPlayerIds(nextState: GameState): string[] {
  return (nextState.players || [])
    .map((p: any) => String(p?.id || '').trim())
    .filter(Boolean);
}

function getOpponentIds(nextState: GameState, controllerId: PlayerID): string[] {
  return getPlayerIds(nextState).filter((id) => id !== String(controllerId || '').trim());
}

function countControlledCreatures(nextState: GameState, playerId: string): number {
  return (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
    if (String(perm?.controller || '').trim() !== String(playerId || '').trim()) return false;
    return getExecutorTypeLineLower(perm).includes('creature');
  }).length;
}

function countBattlefieldCreatures(nextState: GameState): number {
  return (getProcessedBattlefield(nextState) as any[]).filter((perm) =>
    getExecutorTypeLineLower(perm).includes('creature')
  ).length;
}

function isColorlessPermanent(perm: any): boolean {
  const colors = getColorsFromObject(perm);
  if (colors.length === 0) return true;
  return colors.every((c) => !c);
}

function cardMatchesHistoric(card: any): boolean {
  const typeLine = getExecutorTypeLineLower(card);
  return typeLine.includes('artifact') || typeLine.includes('legendary') || typeLine.includes('saga');
}

function objectHasAnyCounters(object: any): boolean {
  const counters = (object as any)?.counters;
  if (!counters || typeof counters !== 'object') return false;
  return Object.values(counters as Record<string, unknown>).some((v) => Number(v) > 0);
}

function getCounterCount(object: any, counterName: string): number {
  const counters = (object as any)?.counters;
  if (!counters || typeof counters !== 'object') return 0;
  const target = String(counterName || '').trim().toLowerCase();
  for (const [key, value] of Object.entries(counters as Record<string, unknown>)) {
    if (String(key || '').trim().toLowerCase() !== target) continue;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function playerHasStrictlyMost(
  nextState: GameState,
  getValue: (playerId: string) => number | null
): boolean | null {
  const ids = getPlayerIds(nextState);
  if (ids.length === 0) return null;
  let sawUnknown = false;
  for (const pid of ids) {
    const value = getValue(pid);
    if (value === null) {
      sawUnknown = true;
      continue;
    }
    const isLeader = ids.every((other) => {
      if (other === pid) return true;
      const otherValue = getValue(other);
      if (otherValue === null) {
        sawUnknown = true;
        return true;
      }
      return value > otherValue;
    });
    if (isLeader) return true;
  }
  return sawUnknown ? null : false;
}

export function evaluateBatch373BulkConditionalClause(params: Batch373BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  if (normalizedRaw === "it doesn't have rampage" || normalizedRaw === 'it does not have rampage') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return !params.objectHasKeyword(ref, 'rampage');
  }

  if (normalizedRaw === 'a player has more cards in hand than each other player') {
    return playerHasStrictlyMost(nextState, (pid) => params.getPlayerHandCount(nextState, pid as PlayerID));
  }

  if (normalizedRaw === 'you have less life than an opponent') {
    const yourLife = params.getControllerLife(nextState, controllerId);
    if (yourLife === null) return null;
    const opponents = getOpponentIds(nextState, controllerId);
    if (opponents.length === 0) return false;
    return opponents.some((pid) => {
      const life = params.getControllerLife(nextState, pid as PlayerID);
      return life !== null && yourLife < life;
    });
  }

  if (normalizedRaw === 'you control fewer creatures than an opponent') {
    const youCount = countControlledCreatures(nextState, String(controllerId || '').trim());
    const opponents = getOpponentIds(nextState, controllerId);
    if (opponents.length === 0) return false;
    return opponents.some((pid) => countControlledCreatures(nextState, pid) > youCount);
  }

  if (normalizedRaw === 'that mana is spent on a dragon creature spell') {
    const flag =
      (ctx as any)?.manaSpentOnDragonCreatureSpell ??
      (ctx as any)?.lastManaSpentOnSpellType ??
      (ctx.selectorContext as any)?.manaSpentOnDragonCreatureSpell;
    if (typeof flag === 'boolean') return flag;
    const spell = (ctx as any)?.stackItem ?? params.getReferencedObject(nextState, ctx);
    const tl = getExecutorTypeLineLower(spell);
    return tl.includes('dragon') && tl.includes('creature');
  }

  if (normalizedRaw === 'there are cards exiled with it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const exiled = (source as any)?.exiledCards ?? (source as any)?.cardsExiledWithThis;
    if (Array.isArray(exiled)) return exiled.length > 0;
    const count = Number((source as any)?.exiledCardCount ?? NaN);
    return Number.isFinite(count) ? count > 0 : null;
  }

  if (normalizedRaw === 'you controlled that artifact') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return String((ref as any)?.controller || '').trim() === String(controllerId || '').trim();
  }

  if (normalizedRaw === 'it had no counters on it') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return !objectHasAnyCounters(ref);
  }

  if (normalizedRaw === "he wasn't a spirit" || normalizedRaw === 'he was not a spirit') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return !params.objectHasType(ref, 'spirit');
  }

  if (normalizedRaw === 'damage from a red source is prevented this way') {
    const flag =
      (ctx as any)?.redDamagePreventedThisWay ??
      (ctx as any)?.lastPreventedDamageSourceColor ??
      (ctx as any)?.damagePreventedFromRedSourceThisWay;
    if (flag === 'R' || flag === 'red') return true;
    if (typeof flag === 'boolean') return flag;
    return null;
  }

  if (normalizedRaw === 'a black creature with flying is attacking') {
    return (getProcessedBattlefield(nextState) as any[]).some((perm) => {
      if (!params.isPermanentAttackingFn(perm)) return false;
      const colors = getColorsFromObject(perm);
      if (!colors.includes('B')) return false;
      return params.objectHasKeyword(perm, 'flying');
    });
  }

  if (normalizedRaw === "it has mana value less than the sacrificed permanent's mana value") {
    const found = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    const sacrificed = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])[0]
      : null;
    if (!found || !sacrificed) return null;
    const foundMv = Number((found as any)?.manaValue ?? (found as any)?.cmc ?? NaN);
    const sacMv = Number((sacrificed as any)?.manaValue ?? (sacrificed as any)?.cmc ?? NaN);
    return Number.isFinite(foundMv) && Number.isFinite(sacMv) ? foundMv < sacMv : null;
  }

  if (normalizedRaw === 'this creature attacked or blocked this turn') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    if ((source as any)?.attackedThisTurn === true || (source as any)?.blockedThisTurn === true) return true;
    if ((source as any)?.attackedThisTurn === false && (source as any)?.blockedThisTurn === false) return false;
    if (params.isPermanentAttackingFn(source)) return true;
    if (isBlockingPermanent(source)) return true;
    return null;
  }

  {
    const opponentCreatureGap = normalizedRaw.match(
      /^an opponent controls at least (four|\d+|[a-z]+) more creatures than you$/i
    );
    if (opponentCreatureGap) {
      const gap = params.parseSmallNumberWord(String(opponentCreatureGap[1] || ''));
      if (gap === null) return null;
      const youCount = countControlledCreatures(nextState, String(controllerId || '').trim());
      return getOpponentIds(nextState, controllerId).some(
        (pid) => countControlledCreatures(nextState, pid) >= youCount + gap
      );
    }
  }

  if (
    normalizedRaw === 'one or more of them entered from exile or was cast from exile' ||
    normalizedRaw === 'one or more of them entered from exile or were cast from exile'
  ) {
    const moved = params.movedCardsFrom(params);
    if (moved.length === 0) return null;
    return moved.some(
      (card) =>
        String((card as any)?.enteredFromZone || (card as any)?.castFromZone || '').toLowerCase() === 'exile' ||
        (card as any)?.wasCastFromExile === true ||
        (card as any)?.enteredFromExile === true
    );
  }

  if (normalizedRaw === 'you control no other colorless creatures') {
    const sourceId = String(ctx.sourceId || '').trim();
    let others = 0;
    for (const perm of params.controlledCreatures(nextState, controllerId)) {
      const id = String((perm as any)?.id || '').trim();
      if (sourceId && id === sourceId) continue;
      if (!isColorlessPermanent(perm)) continue;
      others += 1;
    }
    return others === 0;
  }

  if (normalizedRaw === "you've cast a historic spell this turn") {
    const map = (nextState as any)?.historicSpellsCastThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v > 0;
    }
    const spells = (nextState as any)?.spellsCastThisTurn;
    if (Array.isArray(spells)) {
      return spells.some((entry: any) => {
        if (String(entry?.casterId || entry?.controller || '').trim() !== String(controllerId || '').trim()) {
          return false;
        }
        return cardMatchesHistoric(entry?.card ?? entry);
      });
    }
    return null;
  }

  if (normalizedRaw === 'it was dealt damage this turn') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    if (!ref) return null;
    if ((ref as any)?.tookDamageThisTurn === true || (ref as any)?.wasDealtDamageThisTurn === true) return true;
    if ((ref as any)?.tookDamageThisTurn === false) return false;
    const dmg = Number((ref as any)?.damageThisTurn ?? (ref as any)?.combatDamageThisTurn ?? NaN);
    return Number.isFinite(dmg) ? dmg > 0 : null;
  }

  if (normalizedRaw === 'a pirate and a vehicle attacked this combat') {
    const map = (nextState as any)?.attackersDeclaredThisCombatBySubtype;
    if (map && typeof map === 'object') {
      return Boolean((map as any).pirate && (map as any).vehicle);
    }
    let pirate = false;
    let vehicle = false;
    for (const perm of getProcessedBattlefield(nextState) as any[]) {
      if (!params.isPermanentAttackingFn(perm)) continue;
      const tl = getExecutorTypeLineLower(perm);
      if (tl.includes('pirate')) pirate = true;
      if (tl.includes('vehicle')) vehicle = true;
    }
    return pirate && vehicle;
  }

  {
    const handGapMatch = normalizedRaw.match(
      /^an opponent has at least (four|\d+|[a-z]+) more cards in hand than you$/i
    );
    if (handGapMatch) {
      const gap = params.parseSmallNumberWord(String(handGapMatch[1] || ''));
      if (gap === null) return null;
      const youHand = params.getPlayerHandCount(nextState, controllerId);
      return getOpponentIds(nextState, controllerId).some(
        (pid) => params.getPlayerHandCount(nextState, pid as PlayerID) >= youHand + gap
      );
    }
  }

  if (normalizedRaw === 'a modified creature died under your control this turn') {
    const map = (nextState as any)?.modifiedCreaturesDiedThisTurnByController;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0 : null;
    }
    return null;
  }

  {
    const creatureThresholdMatch = normalizedRaw.match(
      /^there are (thirteen|\d+|[a-z]+) or more creatures on the battlefield$/i
    );
    if (creatureThresholdMatch) {
      const threshold = params.parseSmallNumberWord(String(creatureThresholdMatch[1] || ''));
      if (threshold === null) return null;
      return countBattlefieldCreatures(nextState) >= threshold;
    }
  }

  if (normalizedRaw === 'it has unearth') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return params.objectHasKeyword(ref, 'unearth') || /\bunearth\b/i.test(String((ref as any)?.oracle_text ?? ''));
  }

  if (normalizedRaw === 'this permanent dealt damage to another creature this turn') {
    const flag = (nextState as any)?.permanentDealtDamageToCreatureThisTurn?.[String(ctx.sourceId || '').trim()];
    if (typeof flag === 'boolean') return flag;
    return Boolean((ctx as any)?.dealtDamageToAnotherCreatureThisTurn);
  }

  if (normalizedRaw === 'this creature has one or more +1/+1 counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    return getCounterCount(source, '+1/+1') >= 1;
  }

  if (normalizedRaw === 'you sacrificed a permanent this turn') {
    const map = (nextState as any)?.permanentsSacrificedThisTurnByController;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0 : null;
    }
    return null;
  }

  if (normalizedRaw === 'a player has more life than each other player') {
    return playerHasStrictlyMost(nextState, (pid) => params.getControllerLife(nextState, pid as PlayerID));
  }

  if (normalizedRaw === 'that creature is 1/1') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return params.getCreaturePower(ref) === 1 && params.getCreatureToughness(ref) === 1;
  }

  if (normalizedRaw === 'you sacrificed an angel this way') {
    const snapshots = Array.isArray((ctx as any)?.lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : [];
    return snapshots.some((entry) => params.objectHasType(entry, 'angel'));
  }

  if (
    normalizedRaw ===
      'you cast it from your hand and there are five or more other creatures on the battlefield'
  ) {
    const castFromHand = (ctx as any)?.castFromHand === true || (ctx as any)?.wasCastFromHand === true;
    const sourceId = String(ctx.sourceId || '').trim();
    let others = 0;
    for (const perm of getProcessedBattlefield(nextState) as any[]) {
      const id = String(perm?.id || '').trim();
      if (sourceId && id === sourceId) continue;
      if (!getExecutorTypeLineLower(perm).includes('creature')) continue;
      others += 1;
    }
    if (!castFromHand && (ctx as any)?.castFromHand !== false) return null;
    return others >= 5;
  }

  if (normalizedRaw === "it's at least one of the chosen colors" || normalizedRaw === 'it is at least one of the chosen colors') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    const chosen = (ctx as any)?.chosenColors ?? (ctx.selectorContext as any)?.chosenColors;
    if (!ref || !Array.isArray(chosen) || chosen.length === 0) return null;
    const colors = getColorsFromObject(ref);
    return colors.some((c) => chosen.includes(c));
  }

  if (normalizedRaw === "you haven't been dealt combat damage since your last turn") {
    const map = (nextState as any)?.combatDamageTakenSinceLastTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? !v : null;
    }
    return null;
  }

  {
    const handThresholdMatch = normalizedRaw.match(/^that player has (five|\d+|[a-z]+) or more cards in hand$/i);
    if (handThresholdMatch) {
      const threshold = params.parseSmallNumberWord(String(handThresholdMatch[1] || ''));
      if (threshold === null) return null;
      const targetId = String(
        ctx.selectorContext?.targetPlayerId ??
          ctx.selectorContext?.targetOpponentId ??
          (ctx as any).targetPlayerId ??
          ''
      ).trim();
      if (!targetId) return null;
      return params.getPlayerHandCount(nextState, targetId as PlayerID) >= threshold;
    }
  }

  if (normalizedRaw === "it wasn't blocking" || normalizedRaw === 'it was not blocking') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    if ((ref as any)?.wasBlocking === true || (ref as any)?.isBlocking === true) return false;
    if ((ref as any)?.wasBlocking === false || (ref as any)?.isBlocking === false) return true;
    return null;
  }

  {
    const attackingThresholdMatch = normalizedRaw.match(/^three or more creatures are attacking$/i);
    if (attackingThresholdMatch) {
      const attackers = (getProcessedBattlefield(nextState) as any[]).filter((perm) =>
        params.isPermanentAttackingFn(perm)
      );
      return attackers.length >= 3;
    }
  }

  if (normalizedRaw === 'target player has exactly 10 life') {
    const targetId = String(
      ctx.selectorContext?.targetPlayerId ??
        ctx.selectorContext?.targetOpponentId ??
      (ctx as any).targetPlayerId ??
        ''
    ).trim();
    if (!targetId) return null;
    const life = params.getControllerLife(nextState, targetId as PlayerID);
    return life === null ? null : life === 10;
  }

  if (normalizedRaw === 'none of them were cast or no mana was spent to cast them') {
    const noneCast = (ctx as any)?.noneWereCast === true;
    const noManaSpent = (ctx as any)?.noManaSpentToCast === true;
    if (noneCast || noManaSpent) return true;
    if ((ctx as any)?.noneWereCast === false && (ctx as any)?.noManaSpentToCast === false) return false;
    return null;
  }

  if (normalizedRaw === 'a player controls no creatures') {
    return getPlayerIds(nextState).some((pid) => countControlledCreatures(nextState, pid) === 0);
  }

  if (normalizedRaw === 'no other creatures are attacking that player') {
    const targetPlayerId = String(
      (ctx as any)?.attackedPlayerId ??
        ctx.selectorContext?.targetPlayerId ??
        ctx.selectorContext?.targetOpponentId ??
        ''
    ).trim();
    if (!targetPlayerId) return null;
    const attackers = (getProcessedBattlefield(nextState) as any[]).filter((perm) => {
      if (!params.isPermanentAttackingFn(perm)) return false;
      const attacked = String((perm as any)?.attacking ?? (perm as any)?.defendingPlayerId ?? '').trim();
      return attacked === targetPlayerId;
    });
    const sourceId = String(ctx.sourceId || '').trim();
    const others = attackers.filter((perm) => String(perm?.id || '').trim() !== sourceId);
    return others.length === 0;
  }

  return null;
}
