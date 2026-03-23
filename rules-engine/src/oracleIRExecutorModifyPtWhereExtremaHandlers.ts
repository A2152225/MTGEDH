import type { BattlefieldPermanent } from '../../shared/src';
import type { ModifyPtWhereEvaluatorContext } from './oracleIRExecutorModifyPtWhereContext';

export function tryEvaluateModifyPtWhereExtrema(
  raw: string,
  context: ModifyPtWhereEvaluatorContext
): number | null {
  const {
    battlefield,
    controlled,
    opponentsControlled,
    getExcludedId,
    hasExecutorClass,
    greatestSharedCreatureSubtypeCount,
    greatestStatAmongCreatures,
    highestManaValueAmongPermanents,
    leastStatAmongCreatures,
    lowestManaValueAmongPermanents,
  } = context;

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return greatestStatAmongCreatures(battlefield, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return greatestStatAmongCreatures(battlefield, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return highestManaValueAmongPermanents(controlled, { excludedId: excludedId || undefined, excludedQualifier });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return highestManaValueAmongPermanents(opponentsControlled, { excludedId: excludedId || undefined, excludedQualifier });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return highestManaValueAmongPermanents(battlefield, { excludedId: excludedId || undefined, excludedQualifier });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among permanents on (?:the )?battlefield$/i);
    if (m) {
      return highestManaValueAmongPermanents(battlefield);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among other permanents on (?:the )?battlefield$/i);
    if (m) {
      const excludedId = getExcludedId();
      return highestManaValueAmongPermanents(battlefield, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among other permanents you control$/i);
    if (m) {
      const excludedId = getExcludedId();
      return highestManaValueAmongPermanents(controlled, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among other permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const excludedId = getExcludedId();
      return highestManaValueAmongPermanents(opponentsControlled, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among artifacts you control$/i);
    if (m) {
      const artifacts = (controlled as any[]).filter((p: any) => hasExecutorClass(p, 'artifact')) as BattlefieldPermanent[];
      return highestManaValueAmongPermanents(artifacts);
    }
  }

  {
    const m = raw.match(/^x is the greatest number of creatures you control that have a creature type in common$/i);
    if (m) {
      return greatestSharedCreatureSubtypeCount(controlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among permanents you control$/i);
    if (m) {
      return highestManaValueAmongPermanents(controlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      return highestManaValueAmongPermanents(opponentsControlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return leastStatAmongCreatures(controlled, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return leastStatAmongCreatures(opponentsControlled, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return leastStatAmongCreatures(battlefield, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among other creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return leastStatAmongCreatures(controlled, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among other creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return leastStatAmongCreatures(opponentsControlled, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among other creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return leastStatAmongCreatures(battlefield, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return leastStatAmongCreatures(controlled, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return leastStatAmongCreatures(opponentsControlled, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return leastStatAmongCreatures(battlefield, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among other permanents you control$/i);
    if (m) {
      const excludedId = getExcludedId();
      return lowestManaValueAmongPermanents(controlled, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among other permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const excludedId = getExcludedId();
      return lowestManaValueAmongPermanents(opponentsControlled, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among other permanents on (?:the )?battlefield$/i);
    if (m) {
      const excludedId = getExcludedId();
      return lowestManaValueAmongPermanents(battlefield, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return lowestManaValueAmongPermanents(controlled, { excludedId: excludedId || undefined, excludedQualifier });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return lowestManaValueAmongPermanents(opponentsControlled, { excludedId: excludedId || undefined, excludedQualifier });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return lowestManaValueAmongPermanents(battlefield, { excludedId: excludedId || undefined, excludedQualifier });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among permanents you control$/i);
    if (m) {
      return lowestManaValueAmongPermanents(controlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      return lowestManaValueAmongPermanents(opponentsControlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among permanents on (?:the )?battlefield$/i);
    if (m) {
      return lowestManaValueAmongPermanents(battlefield);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return greatestStatAmongCreatures(controlled, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return greatestStatAmongCreatures(opponentsControlled, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return greatestStatAmongCreatures(battlefield, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return greatestStatAmongCreatures(controlled, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return greatestStatAmongCreatures(opponentsControlled, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return greatestStatAmongCreatures(controlled, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return greatestStatAmongCreatures(opponentsControlled, which);
    }
  }

  return null;
}
