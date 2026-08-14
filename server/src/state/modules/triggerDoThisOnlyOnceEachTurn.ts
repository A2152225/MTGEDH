/**
 * "Do this only once each turn" (Pantlaza) is not the same as
 * "This ability triggers only once each turn".
 *
 * Gatherer: declining the optional action does not consume the once-per-turn
 * limit; choosing to do it (e.g. discover) does.
 */

function sourceKey(permanentId: string, triggerType?: string): string {
  const id = String(permanentId || '').trim();
  const type = String(triggerType || '').trim();
  return type ? `${id}::${type}` : id;
}

export function oracleTextHasDoThisOnlyOnceEachTurn(oracleText: string): boolean {
  return /do this only once each turn/i.test(String(oracleText || ''));
}

export function oracleTextHasTriggersOnlyOnceEachTurn(oracleText: string): boolean {
  return /this ability triggers only once each turn/i.test(String(oracleText || ''));
}

export function hasDoThisOnlyOnceEachTurnBeenUsed(state: any, permanentId: string, triggerType?: string): boolean {
  const key = sourceKey(permanentId, triggerType);
  if (!key) return false;
  return Boolean(state?.doThisOnlyOnceEachTurnUsedThisTurn?.[key]);
}

export function markDoThisOnlyOnceEachTurnUsed(state: any, permanentId: string, triggerType?: string): void {
  const key = sourceKey(permanentId, triggerType);
  if (!state || !key) return;
  state.doThisOnlyOnceEachTurnUsedThisTurn = state.doThisOnlyOnceEachTurnUsedThisTurn || {};
  state.doThisOnlyOnceEachTurnUsedThisTurn[key] = true;
}

export function hasOncePerTurnTriggerFired(state: any, permanentId: string, triggerType?: string): boolean {
  const key = sourceKey(permanentId, triggerType);
  if (!key) return false;
  return Boolean(state?.oncePerTurnTriggersFiredThisTurn?.[key]);
}

export function markOncePerTurnTriggerFired(state: any, permanentId: string, triggerType?: string): void {
  const key = sourceKey(permanentId, triggerType);
  if (!state || !key) return;
  state.oncePerTurnTriggersFiredThisTurn = state.oncePerTurnTriggersFiredThisTurn || {};
  state.oncePerTurnTriggersFiredThisTurn[key] = true;
}

export function shouldSkipTurnLimitedEtbTrigger(state: any, trigger: any, sourcePermanentId: string): boolean {
  const id = String(sourcePermanentId || trigger?.permanentId || '').trim();
  const triggerType = String(trigger?.triggerType || '').trim();
  if (trigger?.oncePerTurn && hasOncePerTurnTriggerFired(state, id, triggerType)) return true;
  if (trigger?.doThisOnlyOnceEachTurn && hasDoThisOnlyOnceEachTurnBeenUsed(state, id, triggerType)) return true;
  return false;
}

export function recordTurnLimitedEtbTriggerQueued(state: any, trigger: any, sourcePermanentId: string): void {
  const id = String(sourcePermanentId || trigger?.permanentId || '').trim();
  const triggerType = String(trigger?.triggerType || '').trim();
  if (trigger?.oncePerTurn) {
    markOncePerTurnTriggerFired(state, id, triggerType);
  }
  // Mandatory "do this only once" is consumed when it triggers.
  // Optional "you may" is consumed only when the player accepts (see OnAccept).
  if (trigger?.doThisOnlyOnceEachTurn && trigger?.mandatory !== false) {
    markDoThisOnlyOnceEachTurnUsed(state, id, triggerType);
  }
}

export function recordDoThisOnlyOnceEachTurnOnAccept(state: any, triggerItem: any): void {
  if (!state || !triggerItem) return;
  const oracle = String(
    triggerItem?.card?.oracle_text
    || triggerItem?.sourcePermanentSnapshot?.card?.oracle_text
    || '',
  );
  const flagged = triggerItem?.doThisOnlyOnceEachTurn === true || oracleTextHasDoThisOnlyOnceEachTurn(oracle);
  if (!flagged) return;
  const id = String(triggerItem?.permanentId || triggerItem?.source || '').trim();
  markDoThisOnlyOnceEachTurnUsed(state, id, String(triggerItem?.triggerType || '').trim());
}
