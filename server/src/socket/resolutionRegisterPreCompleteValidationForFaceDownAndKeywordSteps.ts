/**
 * socket/resolutionRegisterPreCompleteValidationForFaceDownAndKeywordSteps.ts
 *
 * Pre-complete validation for the last group of steps guarded in registerResolutionHandlers:
 * SUSPEND_CAST (card still in hand, sane time counters, cost present), MORPH_TURN_FACE_UP
 * (permanent still face-down and controlled), the single-answer keyword choice steps
 * (RIOT / UNLEASH / FABRICATE / TRIBUTE / KEYWORD_CHOICE) and ACTIVATED_ABILITY, whose response
 * must carry no arbitrary selections.
 *
 * Eleventh validation sibling. ...ForExtractedSteps.ts (~37KB) and ...ForStepResponseClusters.ts
 * (~34KB) are near the 40KB ceiling, so this cluster gets its own module.
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 *
 * Public entry symbol: validateFaceDownAndKeywordStepsBeforeComplete.
 */

import type { Socket } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";

export type FaceDownAndKeywordPreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for hand / battlefield lookups. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
};

/**
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateFaceDownAndKeywordStepsBeforeComplete(
  args: FaceDownAndKeywordPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled, game, pid } = args;

  // SUSPEND_CAST: Validate that the card is still in the player's hand before consuming the step.
  // Otherwise a malicious/stale client could duplicate/exile a card that is no longer there.
  if (step.type === ResolutionStepType.SUSPEND_CAST && !cancelled) {
    const suspendStep = step as any;
    const cardId = String(suspendStep?.card?.id || '').trim();
    if (!cardId) {
      socket.emit('error', { code: 'INVALID_STEP', message: 'Suspend step missing card id' });
      return false;
    }

    const hand = (game.state as any)?.zones?.[pid as any]?.hand;
    const inHand = Array.isArray(hand) && hand.some((c: any) => String(c?.id) === cardId);
    if (!inHand) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Card is no longer in your hand' });
      return false;
    }

    const timeCounters = Number(suspendStep?.timeCounters);
    if (!Number.isFinite(timeCounters) || timeCounters < 0) {
      socket.emit('error', { code: 'INVALID_STEP', message: 'Invalid time counter count' });
      return false;
    }

    const suspendCost = String(suspendStep?.suspendCost || '').trim();
    if (!suspendCost) {
      socket.emit('error', { code: 'INVALID_STEP', message: 'Suspend step missing suspend cost' });
      return false;
    }
  }

  // MORPH_TURN_FACE_UP: Validate the permanent is still face-down and controlled by the player.
  // This prevents consuming the step on stale/illegal input.
  if (step.type === ResolutionStepType.MORPH_TURN_FACE_UP && !cancelled) {
    const morphStep = step as any;
    const permanentId = String(morphStep?.permanentId || '').trim();
    if (!permanentId) {
      socket.emit('error', { code: 'INVALID_STEP', message: 'Morph step missing permanent id' });
      return false;
    }
    if (morphStep?.canAfford === false) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'You cannot afford to turn that permanent face-up' });
      return false;
    }

    const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
    const perm = battlefield.find((p: any) => p && String(p.id) === permanentId);
    if (!perm) {
      socket.emit('error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
      return false;
    }

    const controller = String((perm as any).controllerId || (perm as any).controller || '');
    if (controller && controller !== String(pid)) {
      socket.emit('error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
      return false;
    }

    if (!(perm as any).isFaceDown) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Permanent is not face-down' });
      return false;
    }
  }

  // Validate keyword choice steps before completing the step.
  // These handlers can safely reject invalid option ids; do not consume the step on malformed/illegal input.
  if (
    (step.type === ResolutionStepType.RIOT_CHOICE ||
      step.type === ResolutionStepType.UNLEASH_CHOICE ||
      step.type === ResolutionStepType.FABRICATE_CHOICE ||
      step.type === ResolutionStepType.TRIBUTE_CHOICE ||
      step.type === ResolutionStepType.KEYWORD_CHOICE) &&
    !cancelled
  ) {
    const stepAny = step as any;
    const raw: any = response.selections as any;

    const extractSingleSelection = (v: any): string | null => {
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) {
        if (v.length !== 1) return null;
        return typeof v[0] === 'string' ? v[0] : null;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const candidate = v.optionId ?? v.choice ?? v.id ?? v.value;
        if (typeof candidate === 'string') return candidate;
      }
      return null;
    };

    const selected = String(extractSingleSelection(raw) || '').trim();
    if (!selected) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid selection format' });
      return false;
    }

    const optionsRaw: any[] = Array.isArray(stepAny?.options) ? stepAny.options : [];
    const allowedFromStep = new Set(
      optionsRaw
        .map((o: any) => {
          if (typeof o === 'string') return o;
          return String(o?.id ?? o?.value ?? '');
        })
        .map((s: any) => String(s || '').trim())
        .filter(Boolean)
    );

    const allowedFallback =
      step.type === ResolutionStepType.RIOT_CHOICE
        ? new Set(['counter', 'haste'])
        : step.type === ResolutionStepType.UNLEASH_CHOICE
          ? new Set(['counter', 'none'])
          : step.type === ResolutionStepType.FABRICATE_CHOICE
            ? new Set(['counters', 'tokens'])
            : step.type === ResolutionStepType.TRIBUTE_CHOICE
              ? new Set(['pay', 'decline'])
          : new Set<string>();

    const allowed = allowedFromStep.size > 0 ? allowedFromStep : allowedFallback;
    if (allowed.size === 0) {
      socket.emit('error', { code: 'INVALID_STEP', message: 'Keyword choice step missing options' });
      return false;
    }

    if (!allowed.has(selected)) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected option is not valid' });
      return false;
    }
  }

  // ACTIVATED_ABILITY: This step resolves a server-defined ability from the stack.
  // The response payload should not provide arbitrary selections; reject malformed input
  // so a client cannot consume the step with unexpected data.
  if (step.type === ResolutionStepType.ACTIVATED_ABILITY && !cancelled) {
    const raw: any = response.selections as any;

    const isEmptyArray = Array.isArray(raw) && raw.length === 0;
    const isEmptyObject =
      raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0;
    const isNullish = raw === null || raw === undefined;

    if (!(isEmptyArray || isEmptyObject || isNullish)) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid activated ability response' });
      return false;
    }
  }

  return true;
}
