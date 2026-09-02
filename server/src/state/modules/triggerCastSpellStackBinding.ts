/**
 * Origin: oracleIrTriggerExecution.ts / gameActionsCastSpellFromHandPersistOnCast.ts
 *
 * Cluster: bind the spell that caused a spell-cast trigger so IR can exile "it"
 * and share a card type with it (Possibility Storm family). Live persist-on-cast
 * items often omit triggeringStackItemId when card.id does not equal the request
 * cardId; resolution still has to find that player's spell on the stack.
 *
 * Public: isNonAbilityStackSpell, stackObjectIdsMatch, looksLikeSpellCastTrigger,
 * cloneTriggeringStackItemSnapshot, readTriggeringStackItemSnapshot,
 * resolveLiveOrLastKnownStackItem, findTriggeringSpellOnStack
 */

export function isNonAbilityStackSpell(entry: any): boolean {
  const type = String(entry?.type || '').trim().toLowerCase();
  if (type === 'triggered_ability' || type === 'activated_ability' || type === 'ability') {
    return false;
  }
  if (type === 'spell') return true;
  return Boolean(entry?.card);
}

function readStackItems(state: any): any[] {
  const stack = state?.stack;
  if (Array.isArray(stack)) return stack;
  if (stack && typeof stack === 'object' && Array.isArray(stack.objects)) return stack.objects;
  return [];
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

/**
 * Last-known information for a triggering spell (CR 608.2b): Hive Mind copies
 * "that spell" even after Possibility Storm has already exiled it from the stack.
 */
export function cloneTriggeringStackItemSnapshot(item: any): any | null {
  if (!item || typeof item !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(item));
  } catch {
    const card = item.card && typeof item.card === 'object' && !Array.isArray(item.card)
      ? { ...item.card }
      : item.card;
    return { ...item, card };
  }
}

export function readTriggeringStackItemSnapshot(triggerItem?: any): any | null {
  const snap = triggerItem?.effectData?.triggeringSpellStackItem
    || triggerItem?.triggeringSpellStackItem
    || triggerItem?.effectData?.stackItem
    || triggerItem?.stackItem;
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return null;
  if (!String(snap.id || snap.card?.id || '').trim()) return null;
  return snap;
}

function stubTriggeringSpellFromCardSnapshot(
  preferredId: string,
  triggerItem?: any,
  casterId?: string,
): any | null {
  const card = triggerItem?.effectData?.triggeringSpell || triggerItem?.triggeringSpell;
  if (!card || typeof card !== 'object') return null;
  return {
    id: preferredId || String(card.id || '').trim() || undefined,
    type: 'spell',
    controller: casterId || undefined,
    card,
    leftTheStack: true,
  };
}

function lastKnownBoundSpell(
  triggerItem: any | undefined,
  preferredId: string,
  casterId: string,
): any | null {
  const snapshot = readTriggeringStackItemSnapshot(triggerItem);
  if (snapshot) return snapshot;
  return stubTriggeringSpellFromCardSnapshot(preferredId, triggerItem, casterId);
}

/**
 * Prefer the live stack object; if that id already left, use the trigger's
 * last-known snapshot. Never searches for a different live spell/ability.
 */
export function resolveLiveOrLastKnownStackItem(
  state: any,
  triggerItem?: any,
  preferredId?: string,
): any | null {
  const stack = readStackItems(state);
  const wanted = String(
    preferredId
    || triggerItem?.triggeringStackItemId
    || triggerItem?.effectData?.triggeringStackItemId
    || '',
  ).trim();
  if (wanted) {
    const live = stack.find((entry: any) => (
      stackObjectIdsMatch(String(entry?.id || ''), wanted)
      || stackObjectIdsMatch(String(entry?.card?.id || ''), wanted)
    ));
    if (live) return live;
  }
  return lastKnownBoundSpell(triggerItem, wanted, String(
    triggerItem?.effectData?.casterId
    || triggerItem?.triggeringPlayer
    || '',
  ).trim());
}

export function findTriggeringSpellOnStack(
  state: any,
  triggerItem?: any,
  extras?: {
    readonly casterId?: string;
    readonly cardId?: string;
  },
): any | null {
  const stack = readStackItems(state);
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
  const hadIdentity = Boolean(preferredId || cardId || cardName || readTriggeringStackItemSnapshot(triggerItem));

  const spells = stack.filter(isNonAbilityStackSpell);
  const byId = (wanted: string) => spells.find((entry) => (
    stackObjectIdsMatch(String(entry?.id || ''), wanted)
    || stackObjectIdsMatch(String(entry?.card?.id || ''), wanted)
  ));

  if (preferredId) {
    const found = spells.length > 0 ? byId(preferredId) : undefined;
    if (found) return found;
    return lastKnownBoundSpell(triggerItem, preferredId, casterId);
  }

  if (cardId && spells.length > 0) {
    const found = byId(cardId);
    if (found) return found;
  }

  const byCaster = casterId
    ? spells.filter((entry) => String(entry?.controller || '') === casterId)
    : [];
  if (cardName && spells.length > 0) {
    const namedPool = byCaster.length > 0 ? byCaster : spells;
    const named = [...namedPool].reverse().find((entry) => (
      String(entry?.card?.name || entry?.name || '').trim().toLowerCase() === cardName
    ));
    if (named) return named;
  }

  // Identity was known but the object left the stack: last-known, never another spell.
  if (hadIdentity) {
    return lastKnownBoundSpell(triggerItem, preferredId || cardId, casterId);
  }

  if (!looksLikeSpellCastTrigger(triggerItem) && !extras?.casterId && !extras?.cardId) {
    return null;
  }

  // Zero-identity recovery (legacy persist omitted ids): unique caster spell, else topmost.
  if (byCaster.length === 1) return byCaster[0];
  if (byCaster.length > 1) return byCaster[byCaster.length - 1];
  if (spells.length === 0) return null;
  if (!looksLikeSpellCastTrigger(triggerItem) && !extras?.casterId) return null;
  return spells[spells.length - 1];
}
