import { detectCastTrigger } from '../../../../rules-engine/src/cards/castTriggers.js';
import type { EldraziEffect } from './triggered-abilities.js';

/**
 * Resolve the on-cast triggered ability text for a spell being cast from hand.
 * Prefers oracle-driven detectCastTrigger; falls back to Eldrazi name table for
 * non-standard wording (e.g. Emrakul extra turn without "When you cast this spell").
 */
export function resolveOnCastSpellTriggerDescription(
  card: any,
  eldraziEffect: EldraziEffect | null,
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
      : `When you cast this spell, ${effectClause}`;

    return { description, effect: description };
  }

  if (eldraziEffect?.castTrigger) {
    const description = String(eldraziEffect.castTrigger);
    return { description, effect: description };
  }

  return null;
}
