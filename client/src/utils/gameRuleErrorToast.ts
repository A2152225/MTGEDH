// client/src/utils/gameRuleErrorToast.ts
// Turns server rule-rejection errors into readable toasts (ToastHost). Combat declaration errors are
// already shown inside the combat modal (appPlaySocketEffects), so only non-combat rule codes
// (cast restrictions, activation locks, assist) and assist feedback events toast here.
// Public entry symbols: describeGameRuleError, showGameRuleErrorToast, installAssistFeedbackListeners.

import { toast } from '../components/ToastHost';
import { describeFirstTurnsRefusal } from './batch24ChoicePresentation';
import { readableCastRestriction } from './restrictionReasonText';

const RULE_ERROR_TITLES: Record<string, string> = {
  CANNOT_CAST_STATIC_RESTRICTION: "Can't cast that spell",
  CAST_PROHIBITED: "Can't cast that spell",
  CANNOT_ACTIVATE_LOCKED: "Ability can't be activated",
  CANNOT_PAY_COST: "Can't pay that cost",
  ABILITY_LOST: 'No abilities',
  NO_PENDING_CAST: "Can't request assist",
  HELPER_MUST_BE_OTHER_PLAYER: "Can't request assist",
  UNKNOWN_PLAYER: "Can't request assist",
  NO_ASSIST: "Can't request assist",
  NO_GENERIC_COST: "Can't request assist",
  NOT_FACE_DOWN: "Can't turn face up",
  NOT_CONTROLLER: "Can't turn face up",
  NO_PRIORITY: "Can't turn face up",
  NO_TURN_UP_COST: "Can't turn face up",
  CANNOT_PAY_TURN_FACE_UP: "Can't turn face up",
  NO_REVEAL_CARD: "Can't turn face up",
  BAD_REVEAL_CARD: "Can't turn face up",
  CANNOT_PAY_LIFE: "Can't turn face up",
  BAD_COST_CHOICE: "Can't turn face up",
};

const ASSIST_DETAIL: Record<string, string> = {
  NO_PENDING_CAST: 'That spell is no longer waiting for payment.',
  HELPER_MUST_BE_OTHER_PLAYER: 'Choose another player to help pay.',
  UNKNOWN_PLAYER: "That player isn't in this game.",
  NO_ASSIST: "This spell doesn't have assist.",
  NO_GENERIC_COST: 'This spell has no generic mana for a helper to pay.',
  NOT_FACE_DOWN: 'That permanent is already face up.',
  NOT_CONTROLLER: 'Only its controller can turn that permanent face up.',
  NO_PRIORITY: 'You need priority to turn a permanent face up.',
  NO_TURN_UP_COST: 'That card has no cost to turn it face up.',
  CANNOT_PAY_TURN_FACE_UP: "You can't pay its turn-face-up cost right now (not enough mana, cards or permanents).",
  NO_REVEAL_CARD: "You don't have a card of the required colour in hand to reveal.",
  BAD_REVEAL_CARD: "That card can't be revealed for this cost.",
  CANNOT_PAY_LIFE: "You don't have enough life to pay that cost.",
  BAD_COST_CHOICE: "Those choices don't pay the turn-face-up cost. Pick again.",
};

/** Readable "Title: detail" text for a rule-rejection error, or null if not a rule code we toast. */
export function describeGameRuleError(payload: { code?: unknown; message?: unknown; sourceName?: unknown } | null | undefined): string | null {
  const code = String(payload?.code || '');
  const title = RULE_ERROR_TITLES[code];
  if (!title) return null;
  if (code === 'CANNOT_ACTIVATE_LOCKED') {
    const src = String(payload?.sourceName || '').trim();
    const msg = String(payload?.message || '').trim();
    const base = src ? msg.replace(` (${src}).`, '.') : msg;
    return src ? `${title} \u2014 locked by ${src}${base ? `: ${base}` : ''}` : (base ? `${title}: ${base}` : title);
  }
  const detail = ASSIST_DETAIL[code] || describeFirstTurnsRefusal(payload?.message) || readableCastRestriction(payload?.message) || String(payload?.message || '').trim();
  return detail ? `${title}: ${detail}` : title;
}

export function showGameRuleErrorToast(payload: { code?: unknown; message?: unknown; sourceName?: unknown } | null | undefined): void {
  const text = describeGameRuleError(payload);
  if (text) toast.warn(text);
}

let assistListenersInstalled = false;

/** Idempotent: toast feedback for assist refunds (server emits `assistRefunded`). */
export function installAssistFeedbackListeners(sock: { on: (ev: string, fn: (p: any) => void) => unknown }): void {
  if (assistListenersInstalled) return;
  assistListenersInstalled = true;
  sock.on('assistRefunded', (p: any) => {
    const amount = Number(p?.amount || 0);
    const card = String(p?.cardName || 'the spell');
    const helper = p?.helperName ? String(p.helperName) : 'the helper';
    if (amount > 0) toast.info(`Cast of ${card} cancelled: ${amount} assist mana returned to ${helper}.`);
  });
}
