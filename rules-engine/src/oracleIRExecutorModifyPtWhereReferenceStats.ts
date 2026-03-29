import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type PlayerLike = {
  readonly life?: number;
};

type SacrificedSnapshot = {
  readonly power: number;
  readonly toughness: number;
  readonly manaValue: number;
  readonly colors: readonly string[];
};

type FindPlayerById = (id: string) => PlayerLike | null;
type FindObjectById = (id: string) => unknown | null;
type FindObjectByName = (name: string) => unknown | null;
type GetSourceRef = () => unknown;
type ResolveLastSacrificedSnapshot = (kind: 'artifact' | 'card' | 'creature' | 'permanent') => SacrificedSnapshot | null;
type GetCardManaValue = (obj: unknown) => number | null;
type TypeLineLower = (obj: unknown) => string;
type GetColorsFromObject = (obj: unknown) => readonly string[];
type GetColorsOfManaSpent = (obj: unknown) => number;
type GetAmountOfManaSpent = (obj: unknown) => number;
type GetAmountOfSpecificManaSymbolSpent = (obj: unknown, symbol: string) => number;
type NormalizeOracleText = (value: string) => string;
type HasExecutorClass = (obj: unknown, klass: string) => boolean;
type GetExcludedId = () => string;

export function tryEvaluateModifyPtWhereReferenceStats(args: {
  raw: string;
  battlefield: readonly BattlefieldPermanent[];
  controllerId: string;
  targetCreatureId?: string;
  ctx?: OracleIRExecutionContext;
  findPlayerById: FindPlayerById;
  findObjectById: FindObjectById;
  findObjectByName: FindObjectByName;
  getSourceRef: GetSourceRef;
  resolveLastSacrificedSnapshot: ResolveLastSacrificedSnapshot;
  getCardManaValue: GetCardManaValue;
  typeLineLower: TypeLineLower;
  getColorsFromObject: GetColorsFromObject;
  getColorsOfManaSpent: GetColorsOfManaSpent;
  getAmountOfManaSpent: GetAmountOfManaSpent;
  getAmountOfSpecificManaSymbolSpent: GetAmountOfSpecificManaSymbolSpent;
  normalizeOracleText: NormalizeOracleText;
  hasExecutorClass: HasExecutorClass;
  getExcludedId: GetExcludedId;
}): number | null {
  const {
    raw,
    battlefield,
    controllerId,
    targetCreatureId,
    ctx,
    findPlayerById,
    findObjectById,
    findObjectByName,
    getSourceRef,
    resolveLastSacrificedSnapshot,
    getCardManaValue,
    typeLineLower,
    getColorsFromObject,
    getColorsOfManaSpent,
    getAmountOfManaSpent,
    getAmountOfSpecificManaSymbolSpent,
    normalizeOracleText,
    hasExecutorClass,
    getExcludedId,
  } = args;

  {
    const m = raw.match(/^x is half your life total(?:, rounded (up|down))?$/i);
    if (m) {
      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const life = Number(controller.life);
      if (!Number.isFinite(life)) return null;
      const mode = String(m[1] || '').toLowerCase();
      if (mode === 'down') return Math.floor(life / 2);
      return Math.ceil(life / 2);
    }
  }

  {
    const m = raw.match(/^x is (?:that|this|its) creature'?s (power|toughness)$/i);
    if (m) {
      if (!targetCreatureId) return null;
      const target = battlefield.find((p: any) => p.id === targetCreatureId) as any;
      if (!target) return null;
      const which = String(m[1] || '').toLowerCase();
      const rawValue = which === 'power'
        ? (target.power ?? target.card?.power)
        : (target.toughness ?? target.card?.toughness);
      const val = Number(rawValue);
      return Number.isFinite(val) ? val : null;
    }
  }

  {
    const m = raw.match(/^x is its mana value$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      const targetId = String(targetCreatureId || '').trim();
      const refId = sourceId || targetId;
      if (!refId) return null;
      const ref = findObjectById(refId);
      if (!ref) return null;
      const mv = getCardManaValue(ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is that spell'?s mana value$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      const mv = getCardManaValue((ref as any)?.spell || (ref as any)?.card || ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is the number of colors that spell is$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getColorsFromObject((ref as any)?.spell || (ref as any)?.card || ref).length;
    }
  }

  {
    const m = raw.match(/^x is the number of colors that (creature|card|permanent) was$/i);
    if (m) {
      const subject = String(m[1] || '').toLowerCase();
      const snapshot = resolveLastSacrificedSnapshot(
        subject === 'card' ? 'card' : (subject as 'creature' | 'permanent')
      );
      if (snapshot) {
        return snapshot.colors.length;
      }

      const ref = getSourceRef();
      if (!ref) return null;

      const refCard = (ref as any)?.card || ref;
      typeLineLower(refCard);
      if (subject === 'creature' && !hasExecutorClass(ref, 'creature')) return null;
      if (subject === 'permanent') {
        const isPermanent = hasExecutorClass(ref, 'permanent');
        if (!isPermanent) return null;
      }

      return getColorsFromObject(refCard).length;
    }
  }

  {
    const m = raw.match(/^x is this spell'?s intensity$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      const n = Number((ref as any)?.intensity ?? (ref as any)?.intensityValue ?? (ref as any)?.card?.intensity ?? (ref as any)?.card?.intensityValue);
      return Number.isFinite(n) ? Math.max(0, n) : null;
    }
  }

  {
    const m = raw.match(/^x is the number of colors of mana spent to cast (?:this|that) spell$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getColorsOfManaSpent(ref);
    }
  }

  {
    const m = raw.match(/^x is the amount of mana spent to cast (?:this|that) spell$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getAmountOfManaSpent(ref);
    }
  }

  {
    const m = raw.match(/^x is the amount of \{([wubrgcs])\} spent to cast (?:this|that) spell$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getAmountOfSpecificManaSymbolSpent(ref, String(m[1] || ''));
    }
  }

  {
    const m = raw.match(
      /^x is the (?:(?:total )?amount of mana paid this way|(?:total )?amount of mana that player paid this way)$/i
    );
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getAmountOfManaSpent(ref);
    }
  }

  {
    const m = raw.match(/^x is the amount of \{([wubrgcse])\} paid this way$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getAmountOfSpecificManaSymbolSpent(ref, String(m[1] || ''));
    }
  }

  {
    const m = raw.match(/^x is the amount of generic mana in (?:that|this) spell['\u2019]?s mana cost$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      const manaCostStr = String(
        (ref as any)?.manaCost ||
        (ref as any)?.mana_cost ||
        (ref as any)?.card?.manaCost ||
        (ref as any)?.card?.mana_cost ||
        (ref as any)?.spell?.manaCost ||
        (ref as any)?.spell?.mana_cost ||
        ''
      );
      if (!manaCostStr) return 0;
      let generic = 0;
      for (const mt of manaCostStr.matchAll(/\{(\d+)\}/g)) {
        generic += Number(mt[1]);
      }
      return generic;
    }
  }

  {
    const m = raw.match(/^x is that card'?s mana value$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      const mv = getCardManaValue((ref as any)?.card || ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is (?:the )?(?:mana value of the exiled card|exiled card'?s mana value|revealed card'?s mana value|discarded card'?s mana value)$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      const mv = getCardManaValue((ref as any)?.card || ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is ([a-z0-9 ,.'-]+)'s (power|toughness|mana value|intensity)$/i);
    if (m) {
      const ownerName = String(m[1] || '').trim();
      const which = String(m[2] || '').toLowerCase();
      if (!ownerName) return null;
      const normalizedOwner = normalizeOracleText(ownerName);
      if (
        normalizedOwner === 'this' ||
        normalizedOwner === 'that' ||
        normalizedOwner === 'its' ||
        normalizedOwner === 'it' ||
        /^(?:this|that|its)\s+\w+/.test(normalizedOwner)
      ) {
        // Let dedicated pronoun/antecedent matchers handle these forms.
      } else {
        const ref = findObjectByName(ownerName);
        if (!ref) return null;
        const refCard = (ref as any)?.card || ref;

        if (which === 'intensity') {
          const intensity = Number((ref as any)?.intensity ?? (ref as any)?.intensityValue ?? (refCard as any)?.intensity ?? (refCard as any)?.intensityValue);
          return Number.isFinite(intensity) ? intensity : null;
        }

        if (which === 'mana value') {
          const mv = getCardManaValue(refCard);
          return Number.isFinite(mv as number) ? (mv as number) : null;
        }

        const rawValue = which === 'power'
          ? ((ref as any)?.power ?? (refCard as any)?.power)
          : ((ref as any)?.toughness ?? (refCard as any)?.toughness);
        const n = Number(rawValue);
        return Number.isFinite(n) ? n : null;
      }
    }
  }

  {
    const m = raw.match(/^x is (that|this|its) (creature|permanent|artifact|enchantment|planeswalker|card)'?s (power|toughness|mana value|intensity)$/i);
    if (m) {
      const refWord = String(m[1] || '').toLowerCase();
      const objectWord = String(m[2] || '').toLowerCase();
      const statWord = String(m[3] || '').toLowerCase();
      const snapshot = resolveLastSacrificedSnapshot(
        objectWord === 'card' ? 'card' : (objectWord as 'creature' | 'artifact' | 'permanent')
      );

      let refId = '';
      if (refWord === 'that' && objectWord === 'creature' && targetCreatureId) {
        refId = String(targetCreatureId);
      } else if ((refWord === 'this' || refWord === 'its') && String(ctx?.sourceId || '').trim()) {
        refId = String(ctx?.sourceId || '').trim();
      } else if (targetCreatureId) {
        refId = String(targetCreatureId);
      }

      if (!refId) {
        if (!snapshot || statWord === 'intensity') return null;
        if (statWord === 'mana value') return snapshot.manaValue;
        return statWord === 'power' ? snapshot.power : snapshot.toughness;
      }
      const target = battlefield.find((p: any) => String(p?.id || '').trim() === refId) as any;
      if (!target) {
        if (!snapshot || statWord === 'intensity') return null;
        if (statWord === 'mana value') return snapshot.manaValue;
        return statWord === 'power' ? snapshot.power : snapshot.toughness;
      }

      if (statWord === 'mana value') {
        return getCardManaValue(target?.card || target);
      }

      if (statWord === 'intensity') {
        const intensity = Number(target?.intensity ?? target?.intensityValue ?? target?.card?.intensity ?? target?.card?.intensityValue);
        return Number.isFinite(intensity) ? intensity : null;
      }

      const rawValue = statWord === 'power'
        ? (target.power ?? target.card?.power)
        : (target.toughness ?? target.card?.toughness);
      const val = Number(rawValue);
      return Number.isFinite(val) ? val : null;
    }
  }

  {
    const m = raw.match(/^x is its (power|toughness)$/i);
    if (m) {
      if (!targetCreatureId) return null;
      const target = battlefield.find((p: any) => p.id === targetCreatureId) as any;
      if (!target) return null;
      const which = String(m[1] || '').toLowerCase();
      const rawValue = which === 'power'
        ? (target.power ?? target.card?.power)
        : (target.toughness ?? target.card?.toughness);
      const val = Number(rawValue);
      return Number.isFinite(val) ? val : null;
    }
  }

  {
    const m = raw.match(/^x is the number of ([+\-\d/]+|[a-z][a-z0-9+\-/ ]*) counters on (?:this|that|it)(?: (creature|artifact|enchantment|planeswalker|permanent|card))?$/i);
    if (m) {
      const counterType = String(m[1] || '').toLowerCase().trim();
      const objectWord = String(m[2] || '').toLowerCase().trim();
      const sourceId = String(ctx?.sourceId || '').trim();
      let targetId: string | undefined;
      if (objectWord === 'creature') {
        targetId = targetCreatureId || sourceId || undefined;
      } else if (objectWord) {
        targetId = sourceId || targetCreatureId || undefined;
      } else {
        targetId = targetCreatureId || sourceId || undefined;
      }
      if (!targetId || !counterType) return null;
      const target = battlefield.find((p: any) => String(p?.id || '').trim() === targetId) as any;
      if (!target) return null;
      const counters = (target as any)?.counters;
      if (!counters || typeof counters !== 'object') return 0;
      const value = Number((counters as any)[counterType]);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of counters on (?:this|that) creature$/i);
    if (m) {
      const targetId = getExcludedId() || undefined;
      if (!targetId) return null;
      const target = battlefield.find((p: any) => p.id === targetId) as any;
      if (!target) return null;
      const counters = (target as any).counters;
      if (!counters || typeof counters !== 'object') return 0;
      return (Object.values(counters) as any[]).reduce((sum: number, v: any) => {
        const n = Number(v);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
      }, 0);
    }
  }

  return null;
}
