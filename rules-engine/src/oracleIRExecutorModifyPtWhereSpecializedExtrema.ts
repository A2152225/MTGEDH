import type { BattlefieldPermanent, GameState } from '../../shared/src';

type GetCreatureSubtypeKeys = (obj: unknown) => readonly string[];
type IsAttackingObject = (obj: unknown) => boolean;
type HasExecutorClass = (obj: unknown, klass: string) => boolean;
type GetExcludedId = () => string;
type GreatestStatAmongCreatures = (
  creatures: readonly BattlefieldPermanent[],
  which: 'power' | 'toughness',
  options?: { excludedId?: string }
) => number;
type HighestManaValueAmongPermanents = (
  permanents: readonly BattlefieldPermanent[],
  options?: { excludedId?: string }
) => number;
type IsCommanderObject = (obj: unknown) => boolean;
type CollectCommandZoneObjects = () => readonly unknown[];
type GreatestManaValueAmongCards = (cards: readonly unknown[]) => number;
type TypeLineLower = (obj: unknown) => string;

export function tryEvaluateModifyPtWhereSpecializedExtrema(args: {
  state: GameState;
  raw: string;
  controlled: readonly BattlefieldPermanent[];
  opponentsControlled: readonly BattlefieldPermanent[];
  controllerId: string;
  getCreatureSubtypeKeys: GetCreatureSubtypeKeys;
  isAttackingObject: IsAttackingObject;
  hasExecutorClass: HasExecutorClass;
  getExcludedId: GetExcludedId;
  greatestStatAmongCreatures: GreatestStatAmongCreatures;
  highestManaValueAmongPermanents: HighestManaValueAmongPermanents;
  isCommanderObject: IsCommanderObject;
  collectCommandZoneObjects: CollectCommandZoneObjects;
  greatestManaValueAmongCards: GreatestManaValueAmongCards;
  typeLineLower: TypeLineLower;
}): number | null {
  const {
    state,
    raw,
    controlled,
    opponentsControlled,
    controllerId,
    getCreatureSubtypeKeys,
    isAttackingObject,
    hasExecutorClass,
    getExcludedId,
    greatestStatAmongCreatures,
    highestManaValueAmongPermanents,
    isCommanderObject,
    collectCommandZoneObjects,
    greatestManaValueAmongCards,
    typeLineLower,
  } = args;

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among ([\w]+(?:\s+[\w]+)*?)\s+(?:you control|they control|your opponents control|an opponent controls)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const subtypeRaw = String(m[2] || '').trim().toLowerCase();
      const controllerClause = String(m[0] || '').toLowerCase();
      const pool = /they control|your opponents control|an opponent controls/.test(controllerClause)
        ? opponentsControlled
        : controlled;
      const matching = (pool as any[]).filter((permanent: any) => {
        if (!hasExecutorClass(permanent, 'creature')) return false;
        const subtypes = getCreatureSubtypeKeys(permanent);
        return subtypes.some(subtype => subtype === subtypeRaw || subtypeRaw.startsWith(subtype) || subtype.startsWith(subtypeRaw.replace(/s$/, '')));
      }) as BattlefieldPermanent[];
      return greatestStatAmongCreatures(matching, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other attacking creatures$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      const attackingCreatures = (controlled as any[]).filter(permanent => isAttackingObject(permanent)) as BattlefieldPermanent[];
      return greatestStatAmongCreatures(attackingCreatures, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among tapped creatures (?:your opponents control|an opponent controls|you don['']?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const tappedCreatures = (opponentsControlled as any[]).filter(permanent => (permanent as any)?.tapped || (permanent as any)?.isTapped) as BattlefieldPermanent[];
      return greatestStatAmongCreatures(tappedCreatures, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among elementals? you control$/i);
    if (m) {
      const elementals = (controlled as any[]).filter((p: any) =>
        getCreatureSubtypeKeys(p).includes('elemental')
      ) as BattlefieldPermanent[];
      return highestManaValueAmongPermanents(elementals);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among other artifacts? you control$/i);
    if (m) {
      const excludedId = getExcludedId();
      const artifacts = (controlled as any[]).filter((p: any) => hasExecutorClass(p, 'artifact')) as BattlefieldPermanent[];
      return highestManaValueAmongPermanents(artifacts, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among (?:your |the )?commanders?$/i);
    if (m) {
      const commanders = [
        ...(controlled as any[]).filter((p: any) => isCommanderObject(p)),
        ...collectCommandZoneObjects().filter((obj: any) => {
          const ownerId = String((obj as any)?.ownerId || (obj as any)?.owner || (obj as any)?.controllerId || '').trim();
          return (!ownerId || ownerId === controllerId) && isCommanderObject(obj);
        }),
      ];
      return greatestManaValueAmongCards(commanders);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among instant(?:\s+and\s+sorcery)?\s+(?:and sorcery\s+)?spells? (?:you(?:'ve)? cast|cast) (?:from\s+.+\s+)?this turn$/i);
    if (m) {
      const spells: readonly any[] = Array.isArray((state as any)?.spellsCastThisTurn)
        ? (state as any).spellsCastThisTurn
        : [];
      const matchingSpells = spells.filter((spell: any) => {
        const spellControllerId = String((spell as any)?.controllerId || (spell as any)?.controller || '').trim();
        if (spellControllerId && spellControllerId !== controllerId) return false;
        const tl = typeLineLower(spell);
        return tl.includes('instant') || tl.includes('sorcery');
      });
      return greatestManaValueAmongCards(matchingSpells);
    }
  }

  return null;
}
