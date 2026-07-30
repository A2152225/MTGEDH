import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { collectCommandZoneObjects } from './oracleIRExecutorCommanderUtils';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { haveSameName } from './types/cardParts';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export type Batch371BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  getConditionalSubjectCard: (params: Batch371BulkParams) => any | null;
  getReferencedObject: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
  controlledCreatures: (nextState: GameState, controllerId: PlayerID) => any[];
  getGraveyardCards: (nextState: GameState, controllerId: PlayerID) => any[];
  getControllerLife: (nextState: GameState, controllerId: PlayerID) => number | null;
  parseSmallNumberWord: (text: string) => number | null;
  objectHasType: (object: any, type: string) => boolean;
  objectHasKeyword: (object: any, keyword: string) => boolean;
  cardMatchesChosenColor: (card: any, chosenColor: string) => boolean;
  contextualCardsFrom: (params: Batch371BulkParams) => any[];
  movedCardsFrom: (params: Batch371BulkParams) => any[];
  getCreaturePower: (perm: any) => number;
  getPlayerHandCount: (nextState: GameState, playerId: PlayerID) => number;
};

function typeLineHasSubtype(typeLine: string, subtype: string): boolean {
  const tl = String(typeLine || '').toLowerCase();
  const word = String(subtype || '').toLowerCase();
  if (!word) return false;
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(tl);
}

function countControlledSubtype(
  nextState: GameState,
  controllerId: PlayerID,
  subtypes: readonly string[]
): number {
  let count = 0;
  for (const perm of getProcessedBattlefield(nextState) as any[]) {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    const tl = getExecutorTypeLineLower(perm);
    if (subtypes.some((s) => typeLineHasSubtype(tl, s))) count += 1;
  }
  return count;
}

function permanentIsWhite(perm: any, cardMatchesChosenColor: (c: any, color: string) => boolean): boolean | null {
  if (cardMatchesChosenColor(perm, 'white')) return true;
  const colors = getColorsFromObject(perm);
  if (colors.length === 0) return null;
  return colors.includes('W');
}

function findNamedPermanentOrCommander(nextState: GameState, controllerId: PlayerID, name: string): boolean {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return false;
  for (const perm of getProcessedBattlefield(nextState) as any[]) {
    const n = String(perm?.name ?? perm?.card?.name ?? '').trim();
    if (n && haveSameName(n, name)) return true;
  }
  for (const obj of collectCommandZoneObjects(
    nextState,
    controllerId,
    (id) => findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, id),
  ) as any[]) {
    const n = String(obj?.name ?? obj?.card?.name ?? '').trim();
    if (n && haveSameName(n, name)) return true;
  }
  return false;
}

export function evaluateBatch371BulkConditionalClause(params: Batch371BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  {
    const powerThresholdMatch = normalizedRaw.match(/^that creature's power is (four|\d+|[a-z]+) or greater$/i);
    if (powerThresholdMatch) {
      const threshold = params.parseSmallNumberWord(String(powerThresholdMatch[1] || ''));
      const refId = String(
        (ctx as any)?.attackingCreatureId ??
          ctx.targetCreatureId ??
          ctx.targetPermanentId ??
          (ctx as any)?.enlistedCreatureId ??
          ''
      ).trim();
      const ref = refId
        ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, refId)
        : params.getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return null;
      return params.getCreaturePower(ref) >= threshold;
    }
  }

  if (normalizedRaw === 'a +1/+1 counter was put on a permanent under your control this turn') {
    const mapKeys = [
      'putPlusOneCounterOnPermanentThisTurn',
      'placedPlusOneCounterOnPermanentThisTurn',
      'plusOneCounterPlacedOnPermanentThisTurn',
    ];
    for (const key of mapKeys) {
      const map = (nextState as any)?.[key];
      if (map && typeof map === 'object') {
        const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
        if (typeof v === 'boolean') return v;
      }
    }
    return null;
  }

  {
    const damageMatch = normalizedRaw.match(/^you were dealt (four|\d+|[a-z]+) or more damage this turn$/i);
    if (damageMatch) {
      const threshold = params.parseSmallNumberWord(String(damageMatch[1] || ''));
      if (threshold === null) return null;
      const taken = Number(
        (nextState as any)?.damageTakenThisTurnByPlayer?.[String(controllerId || '').trim()]
      );
      return Number.isFinite(taken) ? taken >= threshold : null;
    }
  }

  if (normalizedRaw === 'all nonland permanents you control are white') {
    const yours = (getProcessedBattlefield(nextState) as any[]).filter(
      (p) => String(p?.controller || '').trim() === String(controllerId || '').trim()
    );
    const nonlands = yours.filter((p) => !getExecutorTypeLineLower(p).includes('land'));
    if (nonlands.length === 0) return true;
    let unknown = false;
    for (const perm of nonlands) {
      const isWhite = permanentIsWhite(perm, params.cardMatchesChosenColor);
      if (isWhite === false) return false;
      if (isWhite === null) unknown = true;
    }
    return unknown ? null : true;
  }

  if (normalizedRaw === "a creature entered the battlefield under an opponent's control this turn") {
    const map = (nextState as any)?.creaturesEnteredBattlefieldUnderOpponentControlThisTurn;
    if (map && typeof map === 'object') {
      return Object.entries(map as Record<string, unknown>).some(
        ([pid, v]) => pid !== String(controllerId || '').trim() && (v === true || (typeof v === 'number' && v > 0))
      );
    }
    const legacy = (nextState as any)?.opponentCreatureEnteredBattlefieldThisTurn;
    return typeof legacy === 'boolean' ? legacy : null;
  }

  if (normalizedRaw === 'edgar is in the command zone or on the battlefield') {
    return findNamedPermanentOrCommander(nextState, controllerId, 'Edgar Markov');
  }

  {
    const landCountMatch = normalizedRaw.match(/^you control (four|\d+|[a-z]+) or fewer lands$/i);
    if (landCountMatch) {
      const threshold = params.parseSmallNumberWord(String(landCountMatch[1] || ''));
      if (threshold === null) return null;
      const count = (getProcessedBattlefield(nextState) as any[]).filter(
        (p) =>
          String(p?.controller || '').trim() === String(controllerId || '').trim() &&
          getExecutorTypeLineLower(p).includes('land')
      ).length;
      return count <= threshold;
    }
  }

  if (normalizedRaw === 'it was the second spell you cast this turn') {
    const count = Number(
      (nextState as any)?.spellsCastThisTurnByPlayer?.[controllerId] ??
        (nextState as any)?.spellCastCountThisTurn?.[controllerId] ??
        ctx.spellCastCountThisTurn ??
        NaN
    );
    if (Number.isFinite(count)) return count === 2;
    const spells = (nextState as any)?.spellsCastThisTurn;
    if (Array.isArray(spells)) {
      const n = spells.filter(
        (s: any) => String(s?.casterId || s?.controller || '').trim() === String(controllerId || '').trim()
      ).length;
      return n === 2;
    }
    return null;
  }

  if (normalizedRaw === 'you control a red or green permanent') {
    return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const colors = getColorsFromObject(perm);
      return colors.includes('R') || colors.includes('G');
    });
  }

  if (normalizedRaw === 'you control three or more wolves and/or werewolves') {
    return countControlledSubtype(nextState, controllerId, ['wolf', 'werewolf']) >= 3;
  }

  if (normalizedRaw === 'you have one or fewer cards in hand') {
    return params.getPlayerHandCount(nextState, controllerId) <= 1;
  }

  {
    const powerWasMatch = normalizedRaw.match(/^its power was (three|\d+|[a-z]+) or greater$/i);
    if (powerWasMatch) {
      const threshold = params.parseSmallNumberWord(String(powerWasMatch[1] || ''));
      const moved = params.movedCardsFrom(params);
      const ref = moved[0] ?? params.getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return null;
      return params.getCreaturePower(ref) >= threshold;
    }
  }

  if (
    normalizedRaw ===
    'three or more cards were put into your graveyard from anywhere other than the battlefield this turn'
  ) {
    const count = Number(
      (nextState as any)?.cardsPutIntoGraveyardFromNonBattlefieldThisTurn?.[controllerId] ??
        (nextState as any)?.nonBattlefieldCardsPutIntoGraveyardThisTurn?.[controllerId] ??
        NaN
    );
    return Number.isFinite(count) ? count >= 3 : null;
  }

  {
    const oppGyMatch = normalizedRaw.match(/^an opponent has (eight|\d+|[a-z]+) or more cards in their graveyard$/i);
    if (oppGyMatch) {
      const threshold = params.parseSmallNumberWord(String(oppGyMatch[1] || ''));
      if (threshold === null) return null;
      return (nextState.players || []).some((player: any) => {
        const pid = String(player?.id || '').trim();
        if (!pid || pid === String(controllerId || '').trim()) return false;
        const gy = Array.isArray(player?.graveyard) ? player.graveyard.length : 0;
        return gy >= threshold;
      });
    }
  }

  if (normalizedRaw === 'the creature you control entered this turn') {
    const refId = String(
      ctx.targetCreatureId ??
        ctx.targetPermanentId ??
        ctx.selectorContext?.targetCreatureId ??
        ctx.selectorContext?.targetPermanentId ??
        ''
    ).trim();
    const ref = refId
      ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, refId)
      : params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return (
      String((ref as any)?.controller || '').trim() === String(controllerId || '').trim() &&
      Boolean((ref as any)?.enteredThisTurn)
    );
  }

  {
    const oppLandMatch = normalizedRaw.match(/^an opponent controls (seven|\d+|[a-z]+) or more lands$/i);
    if (oppLandMatch) {
      const threshold = params.parseSmallNumberWord(String(oppLandMatch[1] || ''));
      if (threshold === null) return null;
      return (nextState.players || []).some((player: any) => {
        const pid = String(player?.id || '').trim();
        if (!pid || pid === String(controllerId || '').trim()) return false;
        const lands = (getProcessedBattlefield(nextState) as any[]).filter(
          (p) => String(p?.controller || '').trim() === pid && getExecutorTypeLineLower(p).includes('land')
        ).length;
        return lands >= threshold;
      });
    }
  }

  if (normalizedRaw === 'it shares a color with that permanent') {
    const it = params.getConditionalSubjectCard(params) ?? params.getReferencedObject(nextState, ctx);
    const thatId = String(
      (ctx as any)?.thatPermanentId ??
        ctx.selectorContext?.targetPermanentId ??
        ctx.targetPermanentId ??
        ''
    ).trim();
    const that = thatId
      ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, thatId)
      : null;
    if (!it || !that) return null;
    const a = new Set(getColorsFromObject(it));
    const b = getColorsFromObject(that);
    return b.some((c) => a.has(c));
  }

  if (normalizedRaw === 'the modified creature was sacrificed') {
    const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : [];
    return snapshots.some((entry) => Boolean((entry as any)?.modified ?? (entry as any)?.isModified));
  }

  if (normalizedRaw === 'it was tapped') {
    const ref =
      params.getReferencedObject(nextState, ctx) ??
      params.movedCardsFrom(params)[0] ??
      params.getConditionalSubjectCard(params);
    if (!ref) return null;
    if ((ref as any)?.tapped === true) return true;
    if ((ref as any)?.tapped === false) return false;
    return null;
  }

  if (normalizedRaw === 'that creature was cast for its warp cost') {
    const ref = params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    const alt =
      (ref as any)?.alternateCostId ??
      (ref as any)?.alternateCostKind ??
      (ref as any)?.castWithWarp ??
      (ref as any)?.warpCostPaid;
    if (typeof alt === 'string') return alt.toLowerCase() === 'warp';
    if (typeof alt === 'boolean') return alt;
    return null;
  }

  if (normalizedRaw === "you didn't cast a spell this turn" || normalizedRaw === 'you did not cast a spell this turn') {
    const spells = (nextState as any)?.spellsCastThisTurn;
    if (Array.isArray(spells)) {
      return !spells.some(
        (s: any) => String(s?.casterId || s?.controller || '').trim() === String(controllerId || '').trim()
      );
    }
    const count = Number((nextState as any)?.spellsCastThisTurnByPlayer?.[controllerId] ?? NaN);
    return Number.isFinite(count) ? count === 0 : null;
  }

  if (normalizedRaw === 'an aura you controlled was attached to it') {
    const itId = String(ctx.targetPermanentId ?? ctx.targetCreatureId ?? '').trim();
    if (!itId) return null;
    return (getProcessedBattlefield(nextState) as any[]).some((perm) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const tl = getExecutorTypeLineLower(perm);
      if (!tl.includes('aura')) return false;
      return String((perm as any)?.attachedTo || '').trim() === itId;
    });
  }

  if (normalizedRaw === 'it has madness') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return params.objectHasKeyword(ref, 'madness') || /\bmadness\b/i.test(String((ref as any)?.oracle_text ?? ''));
  }

  if (normalizedRaw === "that spell's mana cost or that ability's activation cost contains {x}") {
    const stackItem = (ctx as any)?.stackItem ?? params.getReferencedObject(nextState, ctx);
    const cost = String(
      (stackItem as any)?.manaCost ??
        (stackItem as any)?.card?.manaCost ??
        (stackItem as any)?.activationCost ??
        ''
    );
    return /\{x\}/i.test(cost);
  }

  if (normalizedRaw === 'you control more creatures than each other player') {
    const playerIds = (nextState.players || [])
      .map((p: any) => String(p?.id || '').trim())
      .filter(Boolean);
    const youCount = params.controlledCreatures(nextState, controllerId).length;
    return playerIds.every((pid) => {
      if (pid === String(controllerId || '').trim()) return true;
      return youCount > params.controlledCreatures(nextState, pid as PlayerID).length;
    });
  }

  if (normalizedRaw === 'your opponents control no permanents with bounty counters on them') {
    for (const perm of getProcessedBattlefield(nextState) as any[]) {
      const owner = String(perm?.controller || '').trim();
      if (!owner || owner === String(controllerId || '').trim()) continue;
      const bounty = Number(((perm as any)?.counters || {}).bounty ?? 0);
      if (Number.isFinite(bounty) && bounty > 0) return false;
    }
    return true;
  }

  if (normalizedRaw === 'you control a blue or black permanent') {
    return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const colors = getColorsFromObject(perm);
      return colors.includes('U') || colors.includes('B');
    });
  }

  if (normalizedRaw === 'you control a blue or red permanent') {
    return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const colors = getColorsFromObject(perm);
      return colors.includes('U') || colors.includes('R');
    });
  }

  if (normalizedRaw === 'that creature is black or red') {
    const ref = params.getReferencedObject(nextState, ctx);
    if (!ref) return false;
    const colors = getColorsFromObject(ref);
    return colors.includes('B') || colors.includes('R');
  }

  if (normalizedRaw === 'the sacrificed permanent was a treasure') {
    const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : [];
    return snapshots.some((entry) => {
      const tl = getExecutorTypeLineLower(entry);
      return tl.includes('treasure') || tl.includes('artifact — treasure');
    });
  }

  if (normalizedRaw === 'no permanents left the battlefield this turn') {
    const map = (nextState as any)?.permanentsLeftBattlefieldThisTurn;
    if (typeof map === 'boolean') return !map;
    if (map && typeof map === 'object') {
      return !Object.values(map as Record<string, unknown>).some((v) => v === true || (typeof v === 'number' && v > 0));
    }
    return null;
  }

  return null;
}
