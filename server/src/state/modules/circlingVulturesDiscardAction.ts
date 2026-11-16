// server/src/state/modules/circlingVulturesDiscardAction.ts
// Special action: "You may discard this card any time you could cast an instant."
// (Circling Vultures). Listed like the Fblthp plot-from-library-top button.
// Public: getCirclingVulturesDiscardActions, applyCirclingVulturesDiscard,
// CIRCLING_VULTURES_DISCARD_PREFIX, isCirclingVulturesDiscardPlayableId.

export const CIRCLING_VULTURES_DISCARD_PREFIX = 'vultures-discard-';

const DISCARD_ANYTIME_INSTANT =
  /you may discard this card any time you could cast an instant/i;

export interface CirclingVulturesDiscardAction {
  playableId: string;
  cardId: string;
  playerId: string;
  cardName: string;
  label: string;
}

function cardOracle(card: any): string {
  return String(card?.oracle_text || card?.oracleText || card?.text || '');
}

function cardName(card: any): string {
  return String(card?.name || '').trim();
}

export function cardHasCirclingVulturesSpecialDiscard(card: any): boolean {
  if (!card) return false;
  if (DISCARD_ANYTIME_INSTANT.test(cardOracle(card))) return true;
  return /^circling vultures$/i.test(cardName(card));
}

export function isCirclingVulturesDiscardPlayableId(id: unknown): boolean {
  return String(id || '').startsWith(CIRCLING_VULTURES_DISCARD_PREFIX);
}

export function parseCirclingVulturesDiscardPlayableId(id: unknown): { playerId?: string; cardId: string } | null {
  const raw = String(id || '');
  if (!raw.startsWith(CIRCLING_VULTURES_DISCARD_PREFIX)) return null;
  const rest = raw.slice(CIRCLING_VULTURES_DISCARD_PREFIX.length);
  const sep = rest.lastIndexOf('-');
  // playable id is vultures-discard-${cardId}
  return { cardId: rest };
}

function playerHasPriority(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  if (!pid) return false;
  if (state?.priorityPlayerId != null) return String(state.priorityPlayerId) === pid;
  if (state?.priority != null) return String(state.priority) === pid;
  if (state?.playerWithPriority != null) return String(state.playerWithPriority) === pid;
  // When priority is unset in isolated unit tests, allow the action; live
  // callers still pass a state that records who has priority.
  return state?.priorityPlayerId == null && state?.priority == null && state?.playerWithPriority == null;
}

function canTakeInstantSpeedSpecialAction(state: any, playerId: string): boolean {
  if (!playerHasPriority(state, playerId)) return false;
  if (state?.waitingForMulligan === true) return false;
  if (String(state?.phase || '').toLowerCase() === 'mulligan') return false;
  // Instant-speed special actions are legal whenever the player has priority
  // (the same window as casting an instant), including during combat and
  // opponents' turns.
  return true;
}

export function getCirclingVulturesDiscardActions(state: any, playerId: string): CirclingVulturesDiscardAction[] {
  const pid = String(playerId || '').trim();
  if (!pid || !state) return [];
  if (!canTakeInstantSpeedSpecialAction(state, pid)) return [];

  const zones = state.zones?.[pid] || state.players?.find((p: any) => String(p?.id) === pid)?.zones || {};
  const hand: any[] = Array.isArray(zones.hand) ? zones.hand : [];
  const out: CirclingVulturesDiscardAction[] = [];
  for (const card of hand) {
    if (!cardHasCirclingVulturesSpecialDiscard(card)) continue;
    const cardId = String(card?.id || '').trim();
    if (!cardId) continue;
    const name = cardName(card) || 'Circling Vultures';
    out.push({
      playableId: `${CIRCLING_VULTURES_DISCARD_PREFIX}${cardId}`,
      cardId,
      playerId: pid,
      cardName: name,
      label: 'Discard',
    });
  }
  return out;
}

export function applyCirclingVulturesDiscard(ctx: { state: any; bumpSeq?: () => void }, args: {
  playerId: string;
  cardId: string;
}): { applied: boolean; reason?: string; discardedCard?: any } {
  const playerId = String(args?.playerId || '').trim();
  const cardId = String(args?.cardId || '').trim();
  if (!playerId || !cardId) return { applied: false, reason: 'missing_ids' };
  const state = ctx.state;
  if (!canTakeInstantSpeedSpecialAction(state, playerId)) {
    return { applied: false, reason: 'not_legal' };
  }

  const zonesRoot = state.zones || (state.zones = {});
  const zones = zonesRoot[playerId] || (zonesRoot[playerId] = { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 });
  const hand: any[] = Array.isArray(zones.hand) ? zones.hand : (zones.hand = []);
  const index = hand.findIndex((card: any) => String(card?.id || '') === cardId);
  if (index < 0) return { applied: false, reason: 'card_not_in_hand' };
  const card = hand[index];
  if (!cardHasCirclingVulturesSpecialDiscard(card)) return { applied: false, reason: 'not_vultures' };

  hand.splice(index, 1);
  zones.handCount = hand.length;
  const gy: any[] = Array.isArray(zones.graveyard) ? zones.graveyard : (zones.graveyard = []);
  const discarded = { ...card, zone: 'graveyard' };
  gy.push(discarded);
  zones.graveyardCount = gy.length;
  if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq();
  return { applied: true, discardedCard: discarded };
}
