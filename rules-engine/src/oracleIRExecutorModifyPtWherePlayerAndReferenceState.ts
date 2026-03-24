import type { BattlefieldPermanent, GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type PlayerLike = {
  readonly life?: number;
  readonly speed?: number;
  readonly playerSpeed?: number;
  readonly experienceCounters?: number;
  readonly counters?: {
    readonly experience?: number;
  };
};

type SacrificedSnapshot = {
  readonly power: number;
  readonly toughness: number;
  readonly manaValue: number;
};

type FindPlayerById = (id: string) => PlayerLike | null;
type FindObjectById = (id: string) => unknown | null;
type ResolveLastSacrificedSnapshot = (kind: 'artifact' | 'creature') => SacrificedSnapshot | null;
type TypeLineLower = (obj: unknown) => string;
type GetCardManaValue = (obj: unknown) => number | null;
type HasExecutorClass = (obj: unknown, klass: string) => boolean;
type IsCommanderObject = (obj: unknown) => boolean;
type CollectCommandZoneObjects = () => readonly unknown[];
type GreatestManaValueAmongCards = (cards: readonly unknown[]) => number;
type GetHighestCommanderTaxForController = (state: GameState, controllerId: string) => number | null;

export function tryEvaluateModifyPtWherePlayerAndReferenceState(args: {
  state: GameState;
  raw: string;
  battlefield: readonly BattlefieldPermanent[];
  controllerId: string;
  targetCreatureId?: string;
  ctx?: OracleIRExecutionContext;
  findPlayerById: FindPlayerById;
  findObjectById: FindObjectById;
  resolveLastSacrificedSnapshot: ResolveLastSacrificedSnapshot;
  typeLineLower: TypeLineLower;
  getCardManaValue: GetCardManaValue;
  hasExecutorClass: HasExecutorClass;
  isCommanderObject: IsCommanderObject;
  collectCommandZoneObjects: CollectCommandZoneObjects;
  greatestManaValueAmongCards: GreatestManaValueAmongCards;
  getHighestCommanderTaxForController: GetHighestCommanderTaxForController;
}): number | null {
  const {
    state,
    raw,
    battlefield,
    controllerId,
    targetCreatureId,
    ctx,
    findPlayerById,
    findObjectById,
    resolveLastSacrificedSnapshot,
    typeLineLower,
    getCardManaValue,
    hasExecutorClass,
    isCommanderObject,
    collectCommandZoneObjects,
    greatestManaValueAmongCards,
    getHighestCommanderTaxForController,
  } = args;

  {
    const m = raw.match(/^x is the sacrificed creature'?s (power|toughness|mana value)$/i);
    if (m) {
      const snapshot = resolveLastSacrificedSnapshot('creature');
      if (snapshot) {
        const which = String(m[1] || '').toLowerCase();
        if (which === 'mana value') return snapshot.manaValue;
        return which === 'power' ? snapshot.power : snapshot.toughness;
      }

      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;

      const refCard = (ref as any)?.card || ref;
      const tl = typeLineLower(refCard);
      if (!tl.includes('creature')) return null;

      const which = String(m[1] || '').toLowerCase();
      if (which === 'mana value') {
        const mv = getCardManaValue(refCard);
        return mv === null ? null : mv;
      }

      const rawValue = which === 'power'
        ? ((refCard as any)?.power ?? (ref as any)?.power)
        : ((refCard as any)?.toughness ?? (ref as any)?.toughness);
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : null;
    }
  }

  {
    const m = raw.match(/^x is the sacrificed artifact'?s mana value$/i);
    if (m) {
      const snapshot = resolveLastSacrificedSnapshot('artifact');
      if (snapshot) return snapshot.manaValue;

      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;

      const refCard = (ref as any)?.card || ref;
      const tl = typeLineLower(refCard);
      if (!tl.includes('artifact')) return null;

      const mv = getCardManaValue(refCard);
      return mv === null ? null : mv;
    }
  }

  {
    const m = raw.match(/^x is the greatest mana value of a commander you own on the battlefield or in the command zone$/i);
    if (m) {
      const ownedBattlefieldCommanders = (battlefield as any[]).filter((p: any) => {
        const ownerId = String((p as any)?.ownerId || (p as any)?.owner || '').trim();
        return (!ownerId || ownerId === controllerId) && isCommanderObject(p);
      });
      const ownedCommandZoneCommanders = collectCommandZoneObjects().filter((obj: any) => {
        const ownerId = String((obj as any)?.ownerId || (obj as any)?.owner || '').trim();
        return (!ownerId || ownerId === controllerId) && isCommanderObject(obj);
      });
      return greatestManaValueAmongCards([
        ...ownedBattlefieldCommanders,
        ...ownedCommandZoneCommanders,
      ]);
    }
  }

  {
    const m = raw.match(/^x is your highest commander tax among your commanders$/i);
    if (m) {
      return getHighestCommanderTaxForController(state, controllerId);
    }
  }

  {
    const m = raw.match(/^x is your life total$/i);
    if (m) {
      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const life = Number(controller.life);
      return Number.isFinite(life) ? life : null;
    }
  }

  {
    const m = raw.match(/^x is your speed$/i);
    if (m) {
      const stateAny: any = state as any;
      const controller = findPlayerById(controllerId);

      const candidates: unknown[] = [
        controller?.speed,
        controller?.playerSpeed,
        stateAny?.speed?.[controllerId],
        stateAny?.playerSpeed?.[controllerId],
        stateAny?.speedByPlayer?.[controllerId],
      ];

      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.max(0, n);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of times this creature has mutated$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      const sourceObj = sourceId ? findObjectById(sourceId) : null;
      const targetObj = targetCreatureId ? findObjectById(targetCreatureId) : null;

      const isCreature = (obj: any): boolean => {
        return Boolean(obj) && hasExecutorClass(obj, 'creature');
      };

      const host =
        (isCreature(targetObj) ? targetObj : null) ||
        (isCreature(sourceObj) ? sourceObj : null);

      if (!host) return null;

      const candidates: unknown[] = [
        (host as any)?.mutationCount,
        (host as any)?.timesMutated,
        (host as any)?.mutateCount,
      ];

      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.max(0, n);
      }

      const stack = (host as any)?.mutatedStack;
      if (Array.isArray(stack)) {
        return Math.max(0, stack.length - 1);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of experience counters you have$/i);
    if (m) {
      const stateAny: any = state as any;
      const controller = findPlayerById(controllerId);

      const candidates: unknown[] = [
        controller?.experienceCounters,
        controller?.counters?.experience,
        stateAny?.experienceCounters?.[controllerId],
        stateAny?.experience?.[controllerId],
        stateAny?.playerCounters?.experience?.[controllerId],
      ];

      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.max(0, n);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the result$/i);
    if (m) {
      const stateAny: any = state as any;

      const toFinite = (value: unknown): number | null => {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };

      const perPlayer = stateAny?.lastDieRollByPlayer?.[controllerId];
      const perPlayerResult = toFinite(perPlayer?.result);
      if (perPlayerResult !== null) return Math.max(0, perPlayerResult);

      const globalLast = toFinite(stateAny?.lastDieRoll?.result);
      if (globalLast !== null) return Math.max(0, globalLast);

      const turnRollsRaw = stateAny?.dieRollsThisTurn?.[controllerId];
      const turnRolls = Array.isArray(turnRollsRaw) ? turnRollsRaw : [];
      for (let i = turnRolls.length - 1; i >= 0; i -= 1) {
        const result = toFinite((turnRolls[i] as any)?.result);
        if (result !== null) return Math.max(0, result);
      }

      return null;
    }
  }

  return null;
}
