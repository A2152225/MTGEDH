import type { BattlefieldPermanent, GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type TypeLineLower = (obj: unknown) => string;
type IsAttackingObject = (obj: unknown) => boolean;
type HasFlyingKeyword = (obj: unknown) => boolean;
type HasExecutorClass = (obj: unknown, klass: string) => boolean;
type GetExcludedId = () => string;
type ParseClassList = (value: string) => readonly string[] | null;
type FindObjectById = (id: string) => unknown | null;

export function tryEvaluateModifyPtWhereMiscCounts(args: {
  state: GameState;
  raw: string;
  battlefield: readonly BattlefieldPermanent[];
  controlled: readonly BattlefieldPermanent[];
  opponentsControlled: readonly BattlefieldPermanent[];
  controllerId: string;
  ctx?: OracleIRExecutionContext;
  typeLineLower: TypeLineLower;
  isAttackingObject: IsAttackingObject;
  hasFlyingKeyword: HasFlyingKeyword;
  hasExecutorClass: HasExecutorClass;
  getExcludedId: GetExcludedId;
  parseClassList: ParseClassList;
  findObjectById: FindObjectById;
}): number | null {
  const {
    state,
    raw,
    battlefield,
    controlled,
    opponentsControlled,
    controllerId,
    ctx,
    typeLineLower,
    isAttackingObject,
    hasFlyingKeyword,
    hasExecutorClass,
    getExcludedId,
    parseClassList,
    findObjectById,
  } = args;

  {
    const m = raw.match(/^x is the number of (tapped|untapped) (.+) you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const classes = parseClassList(String(m[2] || ''));
      if (!classes) return null;
      return controlled.filter((p: any) => {
        const tapped = Boolean((p as any)?.tapped);
        if (which === 'tapped' ? !tapped : tapped) return false;
        return classes.some((klass) => hasExecutorClass(p, klass));
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of (tapped|untapped) creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      return controlled.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        const tapped = Boolean((p as any)?.tapped);
        return which === 'tapped' ? tapped : !tapped;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of other creatures you control$/i);
    if (m) {
      const excludedId = getExcludedId();
      return controlled.filter((p: any) => {
        if (excludedId && String((p as any)?.id || '').trim() === excludedId) return false;
        return hasExecutorClass(p, 'creature');
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of legendary creatures you control$/i);
    if (m) {
      return controlled.filter((p: any) => {
        const tl = typeLineLower(p);
        return tl.includes('legendary') && hasExecutorClass(p, 'creature');
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures you control with defender$/i);
    if (m) {
      return controlled.filter((p: any) => {
        const tl = typeLineLower(p);
        const keywords = String((p as any)?.keywords || (p as any)?.card?.keywords || '').toLowerCase();
        return hasExecutorClass(p, 'creature') && (tl.includes('defender') || keywords.includes('defender'));
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of permanents you control with oil counters on them$/i);
    if (m) {
      return controlled.filter((p: any) => {
        const counters = (p as any)?.counters;
        if (!counters || typeof counters !== 'object') return false;
        const entries = Object.entries(counters as Record<string, unknown>);
        for (const [key, value] of entries) {
          if (String(key || '').trim().toLowerCase() !== 'oil') continue;
          const n = Number(value);
          return Number.isFinite(n) && n > 0;
        }
        return false;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the total (power|toughness) of (other )?creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedId = isOther ? getExcludedId() : '';

      return controlled.reduce((sum: number, p: any) => {
        if (!hasExecutorClass(p, 'creature')) return sum;
        if (excludedId && String((p as any)?.id || '').trim() === excludedId) return sum;
        const n = Number(which === 'power' ? (p as any)?.power : (p as any)?.toughness);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of creatures you control with power (\d+) or greater$/i);
    if (m) {
      const threshold = Math.max(0, parseInt(String(m[1] || '0'), 10) || 0);
      return controlled.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        const n = Number((p as any)?.power);
        return Number.isFinite(n) && n >= threshold;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of differently named lands you control$/i);
    if (m) {
      const seen = new Set<string>();
      for (const p of controlled as any[]) {
        if (!hasExecutorClass(p, 'land')) continue;
        const name = String((p as any)?.name || (p as any)?.card?.name || '').trim().toLowerCase();
        if (!name) continue;
        seen.add(name);
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of (.+)$/i);
    if (m) {
      const phrase = String(m[1] || '').toLowerCase();
      const mentionsAttackingCreatures = /\bcreatures?\b/.test(phrase) && /\battacking\b/.test(phrase);
      if (mentionsAttackingCreatures && !/\bwith\s+flying\b/.test(phrase) && !/\battacking\s+you\b/.test(phrase)) {
        const isOther = /\bother\b/.test(phrase);
        const excludedId = isOther ? getExcludedId() : '';
        const useOpponents = /\b(?:your opponents control|an opponent controls|you don['Ã¢â‚¬â„¢]?t control|you do not control)\b/.test(phrase);
        const useControlled = /\byou control\b/.test(phrase);
        const pool = useOpponents ? opponentsControlled : useControlled ? controlled : battlefield;
        return pool.filter((p: any) => {
          if (excludedId && String((p as any)?.id || '').trim() === excludedId) return false;
          if (!hasExecutorClass(p, 'creature')) return false;
          return String((p as any)?.attacking || '').trim().length > 0;
        }).length;
      }
    }
  }

  {
    const m = raw.match(/^x is the number of creatures attacking you$/i);
    if (m) {
      return battlefield.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        if (!isAttackingObject(p)) return false;
        const attackedId = String((p as any)?.attacking || (p as any)?.attackingPlayerId || (p as any)?.defendingPlayerId || '').trim();
        return attackedId === controllerId;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the difference between the chosen creatures' powers$/i);
    if (m) {
      const chosenIds = Array.isArray(ctx?.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
      if (chosenIds.length < 2) return null;

      const chosenCreatures = chosenIds
        .map(id => findObjectById(id))
        .filter((obj): obj is any => Boolean(obj) && hasExecutorClass(obj, 'creature'));
      if (chosenCreatures.length < 2) return null;

      const powerValues = chosenCreatures.slice(0, 2).map(obj => Number((obj as any)?.power ?? (obj as any)?.card?.power));
      if (powerValues.some(value => !Number.isFinite(value))) return null;
      return Math.abs(Number(powerValues[0]) - Number(powerValues[1]));
    }
  }

  {
    const m = raw.match(/^x is the total (power|toughness) of (other )?attacking creatures$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedId = isOther ? getExcludedId() : '';

      return battlefield.reduce((sum: number, p: any) => {
        if (!hasExecutorClass(p, 'creature')) return sum;
        if (!isAttackingObject(p)) return sum;
        if (excludedId && String((p as any)?.id || '').trim() === excludedId) return sum;
        const n = Number(which === 'power' ? (p as any)?.power : (p as any)?.toughness);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of attacking creatures with flying$/i);
    if (m) {
      return battlefield.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        if (!isAttackingObject(p)) return false;
        return hasFlyingKeyword(p);
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of players being attacked$/i);
    if (m) {
      const playerIds = new Set((state.players || []).map((p: any) => String((p as any)?.id || '').trim()).filter(Boolean));
      const attacked = new Set<string>();
      for (const p of battlefield as any[]) {
        if (!isAttackingObject(p)) continue;
        const candidates = [
          (p as any)?.attacking,
          (p as any)?.attackingPlayerId,
          (p as any)?.defendingPlayerId,
        ];
        for (const value of candidates) {
          const id = String(value || '').trim();
          if (id && playerIds.has(id)) attacked.add(id);
        }
      }
      return attacked.size;
    }
  }

  return null;
}
