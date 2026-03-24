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
    const m = raw.match(/^x is the number of opponents who control (?:(?:an?|the)\s+)?(.+)$/i);
    if (m) {
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
    const m = raw.match(/^x is the number of opponents you have$/i);
    if (m) {
      return Math.max(0, (state.players || []).filter(p => p.id !== controllerId).length);
    }
  }

  return null;
}
