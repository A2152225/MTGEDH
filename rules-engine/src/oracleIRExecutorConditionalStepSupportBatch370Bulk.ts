import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getAmountOfManaSpent, getColorsFromObject } from './oracleIRExecutorManaUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export type Batch370BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  getCastManaSpendSource: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
  getConditionalSubjectCard: (params: Batch370BulkParams) => any | null;
  getReferencedObject: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
  controlledCreatures: (nextState: GameState, controllerId: PlayerID) => any[];
  getGraveyardCards: (nextState: GameState, controllerId: PlayerID) => any[];
  getControllerLife: (nextState: GameState, controllerId: PlayerID) => number | null;
  parseSmallNumberWord: (text: string) => number | null;
  objectHasType: (object: any, type: string) => boolean;
  cardMatchesChosenColor: (card: any, chosenColor: string) => boolean;
  contextualCardsFrom: (params: Batch370BulkParams) => any[];
  movedCardsFrom: (params: Batch370BulkParams) => any[];
  getCreaturePower: (perm: any) => number;
  getEnchantedCreatureFromAura: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
};

function typeLineHasSubtype(typeLine: string, subtype: string): boolean {
  const tl = String(typeLine || '').toLowerCase();
  const word = String(subtype || '').toLowerCase();
  if (!word) return false;
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(tl);
}

function countControlledMatchingSubtype(
  nextState: GameState,
  controllerId: PlayerID,
  subtype: string,
  excludeId?: string
): number {
  let count = 0;
  for (const perm of getProcessedBattlefield(nextState) as any[]) {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    const id = String(perm?.id || '').trim();
    if (excludeId && id === excludeId) continue;
    if (typeLineHasSubtype(getExecutorTypeLineLower(perm), subtype)) count += 1;
  }
  return count;
}

function antecedentApplied(
  lastActionOutcome: LastActionOutcome,
  stepKinds: readonly string[]
): boolean {
  return (
    lastActionOutcome?.kind === 'applied' &&
    stepKinds.includes(String(lastActionOutcome.stepKind))
  );
}

function isColorlessPermanent(perm: any): boolean {
  const colors = getColorsFromObject(perm);
  if (colors.length === 0) return true;
  const tl = getExecutorTypeLineLower(perm);
  return tl.includes('colorless');
}

export function evaluateBatch370BulkConditionalClause(params: Batch370BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx, lastActionOutcome } = params;

  if (normalizedRaw === 'x is 5 or more, for each artifact destroyed this way') {
    const xValue = Number(ctx.xValue);
    const xOk = Number.isFinite(xValue) && xValue >= 5;
    const destroyed = antecedentApplied(lastActionOutcome, ['destroy']);
    if (!destroyed) return false;
    return xOk ? true : null;
  }

  if (normalizedRaw === 'that player attacked you during their last turn') {
    const thatPlayerId = String(
      (ctx as any)?.thatPlayerId ?? (ctx as any).targetPlayerId ?? (ctx as any).referencedPlayerId ?? ''
    ).trim();
    if (!thatPlayerId) return null;
    const map = (nextState as any)?.attackedYouLastTurnByPlayer;
    if (map && typeof map === 'object') {
      const inner = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      if (inner && typeof inner === 'object') {
        return (inner as Record<string, unknown>)[thatPlayerId] === true;
      }
    }
    return null;
  }

  if (normalizedRaw === 'you win, at the beginning of your next main phase') {
    if (typeof (ctx as any)?.lastClashWon === 'boolean') return (ctx as any).lastClashWon;
    if (typeof (ctx as any)?.clashWon === 'boolean') return (ctx as any).clashWon;
    return null;
  }

  if (normalizedRaw === 'target opponent controls more lands than you') {
    const targetId = String(
      ctx.selectorContext?.targetOpponentId ??
        ctx.selectorContext?.targetPlayerId ??
        (ctx as any)?.targetOpponentId ??
        ''
    ).trim();
    if (!targetId) return null;
    const countLands = (playerId: string) =>
      (getProcessedBattlefield(nextState) as any[]).filter(
        (perm) =>
          String(perm?.controller || '').trim() === playerId &&
          getExecutorTypeLineLower(perm).includes('land')
      ).length;
    return countLands(targetId) > countLands(String(controllerId || '').trim());
  }

  if (normalizedRaw === "you haven't completed tomb of annihilation") {
    const maps = [
      (nextState as any)?.completedDungeonNames,
      (nextState as any)?.completedDungeonsByName,
      (nextState as any)?.completedDungeonNamesMap,
    ];
    for (const map of maps) {
      if (!map || typeof map !== 'object') continue;
      const entry = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      if (Array.isArray(entry)) {
        return !entry.some((name) => String(name || '').trim().toLowerCase() === 'tomb of annihilation');
      }
      if (entry && typeof entry === 'object') {
        const tomb = (entry as Record<string, unknown>)['tomb of annihilation'];
        if (tomb === true) return false;
        if (tomb === false) return true;
      }
    }
    return true;
  }

  if (normalizedRaw === 'it enlisted a creature this combat') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    return Boolean(
      (source as any)?.enlistedThisCombat ??
        (source as any)?.enlistedCreatureThisCombat ??
        (ctx as any)?.enlistedCreatureThisCombat
    );
  }

  {
    const anotherMatch = normalizedRaw.match(/^you control another ([a-z][a-z' -]*)$/i);
    if (anotherMatch) {
      const subtype = String(anotherMatch[1] || '').trim().toLowerCase();
      const sourceId = String(ctx.sourceId || '').trim();
      if (subtype === 'colorless creature') {
        let count = 0;
        for (const perm of getProcessedBattlefield(nextState) as any[]) {
          if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) continue;
          const id = String(perm?.id || '').trim();
          if (sourceId && id === sourceId) continue;
          if (!getExecutorTypeLineLower(perm).includes('creature')) continue;
          if (isColorlessPermanent(perm)) count += 1;
        }
        return count >= 1;
      }
      return countControlledMatchingSubtype(nextState, controllerId, subtype, sourceId) >= 1;
    }
  }

  if (normalizedRaw === "it's night" || normalizedRaw === 'it is night') {
    const dayNight = String((nextState as any)?.dayNight ?? (nextState as any)?.daynight ?? '').trim().toLowerCase();
    if (dayNight === 'night') return true;
    if (dayNight === 'day') return false;
    if ((nextState as any)?.isNight === true) return true;
    if ((nextState as any)?.isNight === false) return false;
    return null;
  }

  {
    const manaFromCreaturesMatch = normalizedRaw.match(
      /^(three|\d+|[a-z]+) or more mana from creatures was spent to cast it$/i
    );
    if (manaFromCreaturesMatch) {
      const threshold = params.parseSmallNumberWord(String(manaFromCreaturesMatch[1] || ''));
      if (threshold === null) return null;
      const castSource = params.getCastManaSpendSource(nextState, ctx);
      if (!castSource) return null;
      const spent =
        Number(
          (castSource as any)?.manaFromCreaturesSpent ?? (castSource as any)?.card?.manaFromCreaturesSpent
        ) ?? NaN;
      if (Number.isFinite(spent)) return spent >= threshold;
      const convoke = (castSource as any)?.convokeTappedCreatures ?? (castSource as any)?.card?.convokeTappedCreatures;
      if (Array.isArray(convoke)) return convoke.length >= threshold;
      return null;
    }
  }

  if (
    normalizedRaw === "you've cast an instant or sorcery spell this turn" ||
    normalizedRaw === 'you have cast an instant or sorcery spell this turn'
  ) {
    const spells = (nextState as any)?.spellsCastThisTurn;
    if (!Array.isArray(spells)) return null;
    return spells.some((spell: any) => {
      const caster = String(spell?.casterId || spell?.controller || '').trim();
      if (caster !== String(controllerId || '').trim()) return false;
      if (spell?.isInstantOrSorcery === true) return true;
      const tl = getExecutorTypeLineLower(spell?.card ?? spell);
      return tl.includes('instant') || tl.includes('sorcery');
    });
  }

  if (normalizedRaw === 'its mana value is equal to 1 plus the number of soul counters on this enchantment') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    const soul = Number(((source as any)?.counters || {}).soul ?? 0);
    const expected = 1 + (Number.isFinite(soul) ? soul : 0);
    const castSource = params.getCastManaSpendSource(nextState, ctx);
    const mv = Number(
      castSource?.manaValue ??
        castSource?.cmc ??
        castSource?.card?.manaValue ??
        castSource?.card?.cmc ??
        (source as any)?.manaValue ??
        (source as any)?.cmc
    );
    return Number.isFinite(mv) ? mv === expected : null;
  }

  if (normalizedRaw === 'no mana was spent to cast that spell') {
    if (typeof ctx.noManaSpentToCast === 'boolean') return ctx.noManaSpentToCast;
    const castSource = params.getCastManaSpendSource(nextState, ctx);
    if (!castSource) return null;
    const spent = getAmountOfManaSpent(castSource);
    return spent === null ? null : spent === 0;
  }

  if (normalizedRaw === 'the sacrificed creature was suspected') {
    const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : [];
    if (snapshots.length === 0) return params.lastActionOutcome?.stepKind === 'sacrifice' ? false : null;
    return snapshots.some(
      (entry) =>
        Boolean(entry?.suspected ?? entry?.isSuspected ?? entry?.card?.suspected ?? entry?.card?.isSuspected)
    );
  }

  if (normalizedRaw === 'another human died under your control this turn') {
    const map = (nextState as any)?.creaturesDiedThisTurnByControllerSubtype;
    if (map && typeof map === 'object') {
      const entry = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      if (entry && typeof entry === 'object') {
        const count = Number((entry as Record<string, unknown>).human ?? (entry as Record<string, unknown>).Human);
        return Number.isFinite(count) && count >= 1;
      }
    }
    return null;
  }

  if (normalizedRaw === 'another creature died this turn') {
    const global = (nextState as any)?.creatureDiedThisTurn;
    if (global === true) return true;
    const map = (nextState as any)?.creaturesDiedThisTurnByController;
    if (map && typeof map === 'object') {
      let total = 0;
      for (const v of Object.values(map as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n)) total += n;
      }
      return total >= 2;
    }
    return null;
  }

  if (normalizedRaw === 'that spell targets only this creature') {
    const sourceId = String(ctx.sourceId || '').trim();
    const targetCreatureId = String(
      ctx.targetCreatureId ??
        ctx.selectorContext?.targetCreatureId ??
        ctx.selectorContext?.targetPermanentId ??
        ''
    ).trim();
    const stackItem = (ctx as any)?.stackItem ?? params.getCastManaSpendSource(nextState, ctx);
    if (!stackItem || !targetCreatureId) return null;
    const targets: string[] = Array.isArray((stackItem as any)?.targets)
      ? (stackItem as any).targets.map((t: any) => String(t ?? '').trim()).filter(Boolean)
      : (stackItem as any)?.targetId
        ? [String((stackItem as any).targetId).trim()]
        : [];
    if (targets.length !== 1) return false;
    return targets[0] === targetCreatureId || targets[0] === sourceId;
  }

  if (normalizedRaw === 'that permanent is black') {
    const ref = params.getReferencedObject(nextState, ctx);
    if (!ref) return false;
    return params.cardMatchesChosenColor(ref, 'black') || getColorsFromObject(ref).includes('B');
  }

  if (normalizedRaw === 'that creature was blue or black') {
    const moved = params.movedCardsFrom(params);
    const ref = moved[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    const colors = getColorsFromObject(ref);
    return colors.includes('U') || colors.includes('B');
  }

  if (normalizedRaw === 'you sacrificed a creature this way') {
    if (!antecedentApplied(lastActionOutcome, ['sacrifice'])) return false;
    const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : params.movedCardsFrom(params);
    return snapshots.some(
      (entry) =>
        String(entry?.controller || '').trim() === String(controllerId || '').trim() &&
        params.objectHasType(entry, 'creature')
    );
  }

  if (normalizedRaw === 'you win all the flips') {
    const flips = (nextState as any)?.lastCoinFlips?.[controllerId];
    if (!Array.isArray(flips) || flips.length === 0) return null;
    return flips.every(Boolean);
  }

  if (normalizedRaw === "it didn't die" || normalizedRaw === 'it did not die') {
    const itId = String(
      (ctx as any)?.itCreatureId ??
        (ctx as any)?.itPermanentId ??
        ctx.targetCreatureId ??
        ctx.targetPermanentId ??
        ''
    ).trim();
    if ((ctx as any)?.itDied === true || (ctx as any)?.died === true) return false;
    if ((ctx as any)?.itDied === false || (ctx as any)?.died === false) return true;
    const diedIds = (nextState as any)?.creaturesDiedThisTurnIds;
    if (Array.isArray(diedIds) && itId) return !diedIds.includes(itId);
    return null;
  }

  if (normalizedRaw === 'you return four or more nontoken permanents you control this way') {
    if (!antecedentApplied(lastActionOutcome, ['move_zone', 'return_to_hand'])) return false;
    const moved = params.movedCardsFrom(params);
    const count = moved.filter(
      (card) =>
        String(card?.controller || '').trim() === String(controllerId || '').trim() &&
        !Boolean(card?.isToken ?? card?.token ?? card?.card?.isToken)
    ).length;
    return count >= 4;
  }

  if (normalizedRaw === 'enchanted creature is untapped') {
    const enchanted = params.getEnchantedCreatureFromAura(nextState, ctx);
    if (!enchanted) return null;
    if ((enchanted as any)?.tapped === false) return true;
    if ((enchanted as any)?.tapped === true) return false;
    return null;
  }

  if (normalizedRaw === 'enchanted creature is red') {
    const enchanted = params.getEnchantedCreatureFromAura(nextState, ctx);
    if (!enchanted) return null;
    return params.cardMatchesChosenColor(enchanted, 'red') || getColorsFromObject(enchanted).includes('R');
  }

  return null;
}
