import { detectCastTrigger } from '../../../../rules-engine/src/cards/castTriggers.js';

/**
 * Resolve the on-cast triggered ability text for a spell being cast from hand.
 * Oracle-driven via detectCastTrigger (including Emrakul extra-turn shorthand).
 */
export function resolveOnCastSpellTriggerDescription(
  card: any,
): { description: string; effect: string } | null {
  const oracleText = String(card?.oracle_text || '');
  const castTriggerInfo = detectCastTrigger(oracleText, card?.type_line);

  if (
    castTriggerInfo.hasCastTrigger
    && castTriggerInfo.triggerType === 'self_cast'
    && !castTriggerInfo.hasCascade
    && !castTriggerInfo.hasStorm
  ) {
    const effectClause = String(castTriggerInfo.effect || '').trim();
    if (!effectClause) return null;

    const description = /^when you cast this spell\b/i.test(effectClause)
      ? effectClause
      : effectClause.toLowerCase().includes('take an extra turn after this one')
        ? 'Take an extra turn after this one.'
        : `When you cast this spell, ${effectClause}`;

    return { description, effect: description };
  }

  return null;
}
