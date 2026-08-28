/**
 * Origin: oracleIrTriggerExecution.ts / gameActionsCastSpellFromHandPersistOnCast.ts
 *
 * Cluster: bind the spell that caused a spell-cast trigger so IR can exile "it"
 * and share a card type with it (Possibility Storm family). Live persist-on-cast
 * items often omit triggeringStackItemId when card.id does not equal the request
 * cardId; resolution still has to find that player's spell on the stack.
 *
 * Public: isNonAbilityStackSpell, stackObjectIdsMatch, looksLikeSpellCastTrigger,
 * findTriggeringSpellOnStack
 */

export function isNonAbilityStackSpell(entry: any): boolean {
  const type = String(entry?.type || '').trim().toLowerCase();
  if (type === 'triggered_ability' || type === 'activated_ability' || type === 'ability') {
    return false;
  }
  if (type === 'spell') return true;
  return Boolean(entry?.card);
}

export function stackObjectIdsMatch(left: string, right: string): boolean {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const oracleA = a.split('_')[0];
  const oracleB = b.split('_')[0];
  return Boolean(oracleA && oracleA === oracleB && oracleA.length >= 8);
}

export function looksLikeSpellCastTrigger(triggerItem?: any): boolean {
  const type = String(triggerItem?.triggerType || '').toLowerCase();
  if (type.includes('cast')) return true;
  if (triggerItem?.effectData?.triggeringSpell || triggerItem?.triggeringSpell) return true;
  const text = String(triggerItem?.description || triggerItem?.effect || '');
  return /\bcast(?:s|ing)? a spell\b/i.test(text);
}

export function findTriggeringSpellOnStack(
  state: any,
  triggerItem?: any,
  extras?: {
    readonly casterId?: string;
    readonly cardId?: string;
  },
): any | null {
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  if (stack.length === 0) return null;

  const casterId = String(
    extras?.casterId
    || triggerItem?.effectData?.casterId
    || triggerItem?.triggeringPlayer
    || triggerItem?.targetPlayer
    || '',
  ).trim();
  const cardId = String(
    extras?.cardId
    || triggerItem?.effectData?.triggeringSpell?.id
    || triggerItem?.triggeringSpell?.id
    || '',
  ).trim();
  const cardName = String(
    triggerItem?.effectData?.triggeringSpell?.name
    || triggerItem?.triggeringSpell?.name
    || '',
  ).trim().toLowerCase();
  const preferredId = String(
    triggerItem?.triggeringStackItemId
    || triggerItem?.effectData?.triggeringStackItemId
    || '',
  ).trim();

  const spells = stack.filter(isNonAbilityStackSpell);
  if (spells.length === 0) return null;

  const byId = (wanted: string) => spells.find((entry) => (
    stackObjectIdsMatch(String(entry?.id || ''), wanted)
    || stackObjectIdsMatch(String(entry?.card?.id || ''), wanted)
  ));

  if (preferredId) {
    const found = byId(preferredId);
    if (found) return found;
  }
  if (cardId) {
    const found = byId(cardId);
    if (found) return found;
  }

  if (!looksLikeSpellCastTrigger(triggerItem) && !extras?.casterId && !extras?.cardId) {
    return null;
  }

  const byCaster = casterId
    ? spells.filter((entry) => String(entry?.controller || '') === casterId)
    : [];
  if (cardName && byCaster.length > 0) {
    const named = [...byCaster].reverse().find((entry) => (
      String(entry?.card?.name || entry?.name || '').trim().toLowerCase() === cardName
    ));
    if (named) return named;
  }
  if (byCaster.length > 0) return byCaster[byCaster.length - 1];
  if (!looksLikeSpellCastTrigger(triggerItem) && !extras?.casterId) return null;
  return spells[spells.length - 1];
}
