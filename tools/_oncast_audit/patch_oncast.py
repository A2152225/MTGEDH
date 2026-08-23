from pathlib import Path

# --- 2) onCastSpellTriggerUtils.ts ---
path = Path(r"D:\Git\MTGEDH\server\src\state\modules\onCastSpellTriggerUtils.ts")
path.write_text("""import { detectCastTrigger, extractSelfCastEffectClauses } from '../../../../rules-engine/src/cards/castTriggers.js';

export type OnCastSpellTriggerDescription = { description: string; effect: string };

function toOnCastDescription(effectClause: string): OnCastSpellTriggerDescription {
  const clause = String(effectClause || '').trim();
  const description = /^when you cast this spell\\b/i.test(clause)
    ? clause
    : clause.toLowerCase().includes('take an extra turn after this one')
      ? 'Take an extra turn after this one.'
      : `When you cast this spell, ${clause}`;
  return { description, effect: description };
}

/**
 * Resolve ALL on-cast triggered ability texts for a spell being cast.
 * Prefers paragraph extraction so multi-ability cards (kicker pairs) and
 * multi-sentence \"If you do\" clauses are preserved.
 */
export function resolveOnCastSpellTriggerDescriptions(
  card: any,
): OnCastSpellTriggerDescription[] {
  const oracleText = String(card?.oracle_text || '');
  const clauses = extractSelfCastEffectClauses(oracleText);
  if (clauses.length > 0) {
    return clauses.map(toOnCastDescription);
  }

  const castTriggerInfo = detectCastTrigger(oracleText, card?.type_line);
  if (
    castTriggerInfo.hasCastTrigger
    && castTriggerInfo.triggerType === 'self_cast'
    && !castTriggerInfo.hasCascade
    && !castTriggerInfo.hasStorm
  ) {
    const effectClause = String(castTriggerInfo.effect || '').trim();
    if (!effectClause) return [];
    return [toOnCastDescription(effectClause)];
  }

  return [];
}

/**
 * Resolve the primary on-cast triggered ability text for a spell being cast from hand.
 * Oracle-driven via detectCastTrigger / extractSelfCastEffectClauses (including Emrakul extra-turn shorthand).
 */
export function resolveOnCastSpellTriggerDescription(
  card: any,
): OnCastSpellTriggerDescription | null {
  const all = resolveOnCastSpellTriggerDescriptions(card);
  return all[0] || null;
}
""", encoding="utf-8")
print("wrote onCastSpellTriggerUtils.ts")
