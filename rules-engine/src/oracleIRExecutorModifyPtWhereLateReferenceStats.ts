import type { BattlefieldPermanent, GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type PlayerLike = {
  readonly life?: number;
  readonly lifeTotal?: number;
  readonly energyCounters?: number;
  readonly energy?: number;
  readonly counters?: {
    readonly energy?: number;
  };
};

type FindPlayerById = (id: string) => PlayerLike | null;
type FindObjectByName = (name: string) => unknown | null;
type GetCounterCountOnObject = (obj: unknown, counterName: string) => number;
type GetExcludedId = () => string;
type HasExecutorClass = (obj: unknown, klass: string) => boolean;

export function tryEvaluateModifyPtWhereLateReferenceStats(args: {
  state: GameState;
  raw: string;
  battlefield: readonly BattlefieldPermanent[];
  controllerId: string;
  ctx?: OracleIRExecutionContext;
  findPlayerById: FindPlayerById;
  findObjectByName: FindObjectByName;
  getCounterCountOnObject: GetCounterCountOnObject;
  getExcludedId: GetExcludedId;
  hasExecutorClass: HasExecutorClass;
}): number | null {
  const {
    state,
    raw,
    battlefield,
    controllerId,
    ctx,
    findPlayerById,
    findObjectByName,
    getCounterCountOnObject,
    getExcludedId,
    hasExecutorClass,
  } = args;

  {
    const m = raw.match(/^x is the greatest number of artifacts? (?:an? )?opponent(?:s?) controls?$/i);
    if (m) {
      const artifactCountsByOpponent = new Map<string, number>();
      for (const permanent of battlefield as any[]) {
        const permanentControllerId = String((permanent as any)?.controller || '').trim();
        if (!permanentControllerId || permanentControllerId === controllerId) continue;
        if (!hasExecutorClass(permanent, 'artifact')) continue;
        artifactCountsByOpponent.set(
          permanentControllerId,
          (artifactCountsByOpponent.get(permanentControllerId) || 0) + 1
        );
      }

      return Array.from(artifactCountsByOpponent.values()).reduce(
        (greatest, count) => Math.max(greatest, count),
        0
      );
    }
  }

  {
    const m = raw.match(/^x is (?:the number of|the amount of) (.+?) counters? on ([a-z0-9][a-z0-9 ,'.\u2019-]{2,60})$/i);
    if (m) {
      const counterType = String(m[1] || '').trim();
      const cardName = String(m[2] || '').trim();
      const ref = findObjectByName(cardName);
      if (!ref) return null;
      return getCounterCountOnObject(ref, counterType);
    }
  }

  {
    const m = raw.match(/^x is the difference between (?:its|that creature'?s|this creature'?s) power and toughness$/i);
    if (m) {
      const refId = getExcludedId();
      if (!refId) return null;
      const target = battlefield.find((p: any) => String((p as any)?.id || '').trim() === refId) as any;
      if (!target) return null;
      const pw = Number(target?.power ?? target?.card?.power);
      const tg = Number(target?.toughness ?? target?.card?.toughness);
      if (!Number.isFinite(pw) || !Number.isFinite(tg)) return null;
      return Math.abs(pw - tg);
    }
  }

  {
    const m = raw.match(/^x is ([a-z0-9 ,.'-]+)'s loyalty$/i);
    if (m) {
      const walkerName = String(m[1] || '').trim();
      const ref = findObjectByName(walkerName) as any;
      if (!ref) return null;
      const loyalty = Number(ref?.loyalty ?? ref?.card?.loyalty ?? ref?.loyaltyCounters ?? ref?.counters?.loyalty);
      return Number.isFinite(loyalty) ? loyalty : null;
    }
  }

  {
    const m = raw.match(/^x is the difference between those players['Ã¢â‚¬â„¢] life totals?$/i);
    if (m) {
      const ids: readonly string[] = Array.isArray(ctx?.selectorContext?.eachOfThoseOpponents)
        ? (ctx?.selectorContext?.eachOfThoseOpponents || []).map(id => String(id || '').trim()).filter(Boolean)
        : [];
      if (ids.length < 2) return null;

      const lifes: number[] = [];
      for (const pid of ids.slice(0, 2)) {
        const player = findPlayerById(pid);
        if (!player) return null;
        const life = Number(player?.life ?? player?.lifeTotal ?? 0);
        if (!Number.isFinite(life)) return null;
        lifes.push(life);
      }
      if (lifes.length < 2) return null;
      return Math.abs(lifes[0] - lifes[1]);
    }
  }

  {
    const m = raw.match(/^x is the amount of \{e\} you have$/i);
    if (m) {
      const player = findPlayerById(controllerId);
      if (!player) return null;
      const energy = Number(player?.energyCounters ?? player?.energy ?? player?.counters?.energy ?? 0);
      return Number.isFinite(energy) ? energy : 0;
    }
  }

  {
    const m = raw.match(/^x is the amount of damage dealt to (it|this creature) this turn$/i);
    if (m) {
      const refId = getExcludedId();
      if (!refId) return null;
      const ref = battlefield.find((p: any) => String((p as any)?.id || '').trim() === refId) as any;
      if (!ref) return null;
      const damage = Number(ref?.damage ?? ref?.markedDamage ?? 0);
      return Number.isFinite(damage) ? Math.max(0, damage) : null;
    }
  }

  {
    const m = raw.match(/^x is the amount of damage (?:this creature|that creature|it) dealt to that player$/i);
    if (m) {
      const creatureId = getExcludedId();
      if (!creatureId) return null;

      const playerId = String(
        ctx?.selectorContext?.targetPlayerId ||
        ctx?.selectorContext?.targetOpponentId ||
        ''
      ).trim();
      if (!playerId) return null;

      const stateAny: any = state as any;
      const byPlayer = stateAny?.creaturesThatDealtDamageToPlayer;
      if (!byPlayer || typeof byPlayer !== 'object' || Array.isArray(byPlayer)) return null;

      const perPlayer = (byPlayer as Record<string, any>)[playerId];
      if (!perPlayer || typeof perPlayer !== 'object' || Array.isArray(perPlayer)) return 0;

      const totalDamage = Number(perPlayer?.[creatureId]?.totalDamage ?? 0);
      return Number.isFinite(totalDamage) ? Math.max(0, totalDamage) : null;
    }
  }

  {
    const m = raw.match(/^x is how (?:far below 0|much less than 0) its power is$/i);
    if (m) {
      const refId = getExcludedId();
      if (!refId) return null;
      const target = battlefield.find((p: any) => String((p as any)?.id || '').trim() === refId) as any;
      if (!target) return null;
      const pw = Number(target?.power ?? target?.card?.power);
      if (!Number.isFinite(pw)) return null;
      return pw < 0 ? Math.abs(pw) : 0;
    }
  }

  {
    const m =
      raw.match(/^x is a number from (\d+) to (\d+) chosen at random(?: each time)?$/i) ||
      raw.match(/^x is a number chosen at random from (\d+) to (\d+)(?: each time)?$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const a = parseInt(String(m[1] || '0'), 10);
      const b = parseInt(String(m[2] || '0'), 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
  }

  return null;
}
