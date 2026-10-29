import { detectCastTrigger, extractSelfCastEffectClauses } from '../../../../rules-engine/src/cards/castTriggers.js';

export type OnCastSpellTriggerDescription = { description: string; effect: string };

/** True when optionality is a pay / put-from-exile gate (not a free outer Yes/No). */
export function isOnCastReflexiveCostGateEffect(effectText: string): boolean {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (/\byou may pay\b[\s\S]*\.\s*(?:if|when)\s+you\s+do\b/i.test(text)) return true;
  if (/\byou may put\b[\s\S]*\bfrom exile into\b[\s\S]*\.\s*(?:if|when)\s+you\s+do\b/i.test(text)) return true;
  return false;
}

function toOnCastDescription(effectClause: string): OnCastSpellTriggerDescription {
  const clause = String(effectClause || '').trim();
  const bare = clause
    .replace(/^when you cast this spell\s*,?\s*/i, '')
    .replace(/\)+\s*$/g, '')
    .trim();
  const description = /^when you cast this spell\b/i.test(clause)
    ? clause
    : bare.toLowerCase().includes('take an extra turn after this one')
      ? 'Take an extra turn after this one.'
      : `When you cast this spell, ${bare}`;
  // Keep description with cast preface for UI; effect is the bare clause so
  // reflexive pay / If-you-do parsers can match without the event wrapper.
  return { description, effect: bare || description };
}

/**
 * Resolve ALL on-cast triggered ability texts for a spell being cast.
 * Prefers paragraph extraction so multi-ability cards (kicker pairs) and
 * multi-sentence "If you do" clauses are preserved.
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
