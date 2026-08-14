import type { BattlefieldPermanent, GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type ColorQualifiedClassSpec = {
  readonly classes: readonly string[];
  readonly requiredColor?: string;
};

type ResolveContextPlayer = () => { readonly id?: string } | null;
type ParseColorQualifiedClassSpec = (value: string) => ColorQualifiedClassSpec | null;
type CountByClasses = (
  pool: readonly BattlefieldPermanent[],
  classes: readonly string[],
  requiredColor?: string
) => number;

export function tryEvaluateModifyPtWhereControlledCounts(args: {
  state: GameState;
  controllerId: string;
  raw: string;
  battlefield: readonly BattlefieldPermanent[];
  controlled: readonly BattlefieldPermanent[];
  opponentsControlled: readonly BattlefieldPermanent[];
  ctx?: OracleIRExecutionContext;
  resolveContextPlayer: ResolveContextPlayer;
  parseColorQualifiedClassSpec: ParseColorQualifiedClassSpec;
  countByClasses: CountByClasses;
}): number | null {
  const {
    state,
    controllerId,
    raw,
    battlefield,
    controlled,
    opponentsControlled,
    ctx,
    resolveContextPlayer,
    parseColorQualifiedClassSpec,
    countByClasses,
  } = args;

  {
    const m = raw.match(/^x is the number of mounts and vehicles(?: you control)?$/i);
    if (m) {
      return countByClasses(controlled, ['mount', 'vehicle']);
    }
  }

  {
    const m = raw.match(/^x is the number of (?:opponents|players) who control more lands than you$/i);
    if (m) {
      const controllerLandCount = countByClasses(controlled, ['land']);
      const otherIds = (state.players || [])
        .map((p: any) => String((p as any)?.id || '').trim())
        .filter((pid) => pid.length > 0 && pid !== controllerId);
      let otherCount = 0;
      for (const otherId of otherIds) {
        const otherPermanents = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === otherId);
        if (countByClasses(otherPermanents, ['land']) > controllerLandCount) otherCount += 1;
      }
      return otherCount;
    }
  }

  {
    const m = raw.match(
      /^x is the difference(?:\s+between\s+the\s+number\s+of\s+lands\s+(?:that player|the chosen opponent|that opponent)\s+controls?\s+and\s+the\s+number\s+of\s+lands\s+you\s+control)?$/i,
    );
    if (m) {
      const targetOpponentId = String(
        ctx?.selectorContext?.targetOpponentId || ctx?.selectorContext?.targetPlayerId || '',
      ).trim();
      if (!targetOpponentId) return 0;
      const controllerLandCount = countByClasses(controlled, ['land']);
      const targetControlled = battlefield.filter(
        (p: any) => String((p as any)?.controller || '').trim() === targetOpponentId,
      );
      return Math.max(0, countByClasses(targetControlled, ['land']) - controllerLandCount);
    }
  }

  {
    const m = raw.match(/^x is the number of opponents who control (?:(?:an?|the)\s+)?(.+)$/i);
    if (m) {
      const tail = String(m[1] || '').trim().toLowerCase();
      if (tail === 'more lands than you') {
        const controllerLandCount = countByClasses(controlled, ['land']);
        const opponentIds = (state.players || [])
          .map((p: any) => String((p as any)?.id || '').trim())
          .filter((pid) => pid.length > 0 && pid !== controllerId);
        let opponentCount = 0;
        for (const opponentId of opponentIds) {
          const oppPermanents = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === opponentId);
          if (countByClasses(oppPermanents, ['land']) > controllerLandCount) opponentCount += 1;
        }
        return opponentCount;
      }

      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (!spec) return null;

      const opponentIds = (state.players || [])
        .map((p: any) => String((p as any)?.id || '').trim())
        .filter(pid => pid.length > 0 && pid !== controllerId);

      let opponentCount = 0;
      for (const opponentId of opponentIds) {
        const oppPermanents = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === opponentId);
        const hasMatchingPermanent = countByClasses(oppPermanents, spec.classes, spec.requiredColor) > 0;
        if (hasMatchingPermanent) opponentCount += 1;
      }

      return opponentCount;
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) you control$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        return countByClasses(controlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) your opponents control$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        return countByClasses(opponentsControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) target opponent controls$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const targetOpponentId = String(ctx?.selectorContext?.targetOpponentId || '').trim();
        if (!targetOpponentId) return null;
        const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === targetOpponentId);
        return countByClasses(targetControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) target opponents control$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const playerIdSet = new Set(
          (state.players || [])
            .map((p: any) => String((p as any)?.id || '').trim())
            .filter(Boolean),
        );
        let targetOpponentIds = Array.isArray(ctx?.selectorContext?.eachOfThoseOpponents)
          ? (ctx?.selectorContext?.eachOfThoseOpponents || [])
              .map((id) => String(id || '').trim())
              .filter(Boolean)
          : [];
        if (targetOpponentIds.length === 0 && Array.isArray(ctx?.selectorContext?.chosenObjectIds)) {
          targetOpponentIds = (ctx?.selectorContext?.chosenObjectIds || [])
            .map((id) => String(id || '').trim())
            .filter((id) => id && playerIdSet.has(id) && id !== controllerId);
        }
        if (targetOpponentIds.length === 0) {
          const singleton = String(
            ctx?.selectorContext?.targetOpponentId || ctx?.selectorContext?.targetPlayerId || '',
          ).trim();
          if (singleton && singleton !== controllerId && playerIdSet.has(singleton)) {
            targetOpponentIds = [singleton];
          }
        }
        if (targetOpponentIds.length === 0) {
          targetOpponentIds = (state.players || [])
            .map((p: any) => String((p as any)?.id || '').trim())
            .filter((pid) => pid && pid !== controllerId);
        }
        const idSet = new Set(targetOpponentIds);
        const pool = battlefield.filter((p: any) => idSet.has(String((p as any)?.controller || '').trim()));
        return countByClasses(pool, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) (?:the )?defending player controls$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const targetOpponentId = String(ctx?.selectorContext?.targetOpponentId || '').trim();
        if (!targetOpponentId) return null;
        const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === targetOpponentId);
        return countByClasses(targetControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) (?:that player controls|they control)$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const player = resolveContextPlayer();
        if (!player) return null;
        const playerId = String((player as any)?.id || '').trim();
        if (!playerId) return null;
        const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === playerId);
        return countByClasses(targetControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) (?:those opponents|all of those opponents|all those opponents|each of those opponents) control$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const ids = Array.isArray(ctx?.selectorContext?.eachOfThoseOpponents)
          ? (ctx?.selectorContext?.eachOfThoseOpponents || []).map(id => String(id || '').trim()).filter(Boolean)
          : [];
        if (ids.length === 0) return null;
        const idSet = new Set(ids);
        const pool = battlefield.filter((p: any) => idSet.has(String((p as any)?.controller || '').trim()));
        return countByClasses(pool, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of historic permanents you control$/i);
    if (m) {
      return controlled.filter((permanent: any) => {
        const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
        return /\bartifact\b/.test(typeLine) || /\blegendary\b/.test(typeLine) || /\bsaga\b/.test(typeLine);
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of equipped creatures you control$/i);
    if (m) {
      return controlled.filter((creature: any) => {
        if (!String(creature?.type_line || creature?.card?.type_line || '').toLowerCase().includes('creature')) {
          return false;
        }
        const creatureId = String(creature?.id || '').trim();
        if (!creatureId) return false;
        return controlled.some((perm: any) => {
          const typeLine = String(perm?.type_line || perm?.card?.type_line || '').toLowerCase();
          if (!/\bequipment\b/.test(typeLine)) return false;
          return String(perm?.attachedTo || '').trim() === creatureId;
        });
      }).length;
    }
  }

  {
    const m = raw.match(/^x is twice the number of blood tokens you control$/i);
    if (m) {
      const bloodTokens = controlled.filter((permanent: any) => {
        const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
        return Boolean(permanent?.isToken) && /\bblood\b/.test(typeLine);
      }).length;
      return bloodTokens * 2;
    }
  }

  {
    const m = raw.match(/^x is the number of blood tokens you control$/i);
    if (m) {
      return controlled.filter((permanent: any) => {
        const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
        return Boolean(permanent?.isToken) && /\bblood\b/.test(typeLine);
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of different kinds of counters among permanents you control$/i);
    if (m) {
      const kinds = new Set<string>();
      for (const permanent of controlled as any[]) {
        const counters = (permanent as any)?.counters || {};
        for (const [counterName, amount] of Object.entries(counters)) {
          if (Math.max(0, Number(amount) || 0) > 0) kinds.add(String(counterName || '').trim().toLowerCase());
        }
      }
      return kinds.size;
    }
  }

  {
    const m = raw.match(/^x is the number of times this creature has mutated$/i);
    if (m) {
      const sourceObj = ctx?.sourceId
        ? (controlled as any[]).find((permanent: any) => String(permanent?.id || '').trim() === String(ctx?.sourceId || '').trim())
        : null;
      if (!sourceObj) return null;
      const candidates: unknown[] = [
        (sourceObj as any)?.mutationCount,
        (sourceObj as any)?.timesMutated,
        (sourceObj as any)?.mutateCount,
        (sourceObj as any)?.mutatedTimes,
      ];
      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) return n;
      }
      const stack = (sourceObj as any)?.mutatedStack;
      if (Array.isArray(stack)) return Math.max(0, stack.length - 1);
      return Math.max(0, Number(((sourceObj as any)?.counters || {})?.mutagen) || 0);
    }
  }

  {
    const m = raw.match(/^x is the number of opponents you have$/i);
    if (m) {
      return Math.max(0, (state.players || []).filter(p => p.id !== controllerId).length);
    }
  }

  {
    const m = raw.match(/^x is the number of your opponents with four or more cards in hand$/i);
    if (m) {
      const opponentIds = (state.players || [])
        .map((p: any) => String((p as any)?.id || '').trim())
        .filter((pid) => pid.length > 0 && pid !== controllerId);
      let opponentCount = 0;
      for (const opponentId of opponentIds) {
        const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === opponentId);
        const hand = Array.isArray((player as any)?.hand) ? (player as any).hand : [];
        if (hand.length >= 4) opponentCount += 1;
      }
      return opponentCount;
    }
  }

  return null;
}
