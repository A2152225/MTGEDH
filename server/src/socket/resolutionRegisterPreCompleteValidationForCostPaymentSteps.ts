/**
 * socket/resolutionRegisterPreCompleteValidationForCostPaymentSteps.ts
 *
 * Pre-complete selection validation for the non-mana cost prompts: LIFE_PAYMENT,
 * ADDITIONAL_COST_PAYMENT (discard / sacrifice / remove_counters / reveal / behold / teamwork) and
 * SQUAD_COST_PAYMENT.
 *
 * Seventh validation sibling. ...ForExtractedSteps.ts (~37KB) and ...ForStepResponseClusters.ts
 * (~34KB) are close to the 40KB ceiling; the other siblings own zone selection, single-answer
 * choice prompts, mode/trigger steps and OPTION_CHOICE.
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 *
 * Public entry symbol: validateCostPaymentStepsBeforeComplete (sync - none of these branches
 * awaited in the parent).
 */

import type { Socket } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import type { GameContext } from "../state/context.js";
import { validateLifePayment } from "../state/utils.js";
import { getEffectivePower } from "./util.js";
import { validateCounterRemovalPaymentSelection } from "./resolution-handlers/resolutionCounterRemovalPaymentSelection.js";

export type CostPaymentPreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for life / hand / battlefield lookups. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
};

/**
 * Validate LIFE_PAYMENT / ADDITIONAL_COST_PAYMENT / SQUAD_COST_PAYMENT selections.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateCostPaymentStepsBeforeComplete(
  args: CostPaymentPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled, game, pid } = args;

  // Validate LIFE_PAYMENT before completing the step.
  // If we complete first, invalid input would consume the step while the handler errors.
  if (step.type === ResolutionStepType.LIFE_PAYMENT) {
    const stepAny = step as any;
    const cardName = String(stepAny.cardName || stepAny.sourceName || 'Spell');

    if (cancelled) {
      socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
      return false;
    }

    let lifePayment: number | null = null;
    const raw = response.selections as any;
    if (typeof raw === 'number') lifePayment = raw;
    else if (typeof raw === 'string') {
      const n = Number(raw);
      lifePayment = Number.isFinite(n) ? n : null;
    } else if (Array.isArray(raw) && raw.length > 0) {
      const n = Number(raw[0]);
      lifePayment = Number.isFinite(n) ? n : null;
    } else if (raw && typeof raw === 'object' && raw.lifePayment != null) {
      const n = Number(raw.lifePayment);
      lifePayment = Number.isFinite(n) ? n : null;
    }

    if (lifePayment == null || !Number.isInteger(lifePayment)) {
      socket.emit('error', { code: 'INVALID_LIFE_PAYMENT', message: 'Invalid life payment' });
      return false;
    }

    const minPayment = Number(stepAny.minPayment ?? 0);
    const maxPayment = Number(stepAny.maxPayment ?? Infinity);
    if (Number.isFinite(minPayment) && lifePayment < minPayment) {
      socket.emit('error', { code: 'INVALID_LIFE_PAYMENT', message: `Life payment must be at least ${minPayment}.` });
      return false;
    }
    if (Number.isFinite(maxPayment) && maxPayment !== Infinity && lifePayment > maxPayment) {
      socket.emit('error', { code: 'INVALID_LIFE_PAYMENT', message: `Life payment must be at most ${maxPayment}.` });
      return false;
    }

    const startingLife = (game.state as any)?.startingLife || 40;
    const currentLife = (game.state as any)?.life?.[pid as any] ?? startingLife;
    const validationError = validateLifePayment(Number(currentLife || 0), lifePayment, cardName, game as GameContext, pid);
    if (validationError) {
      socket.emit('error', { code: 'INVALID_LIFE_PAYMENT', message: validationError });
      return false;
    }
  }

  // Validate ADDITIONAL_COST_PAYMENT before completing the step.
  // If we complete first, invalid selections would consume the step and allow partial/incorrect cost payment.
  if (step.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT) {
    const stepAny = step as any;
    const mandatory = Boolean(stepAny.mandatory);
    const costType = String(stepAny.costType || 'discard') as 'discard' | 'sacrifice' | 'remove_counters' | 'reveal' | 'behold' | 'teamwork';
    const amount = Math.max(0, Number(stepAny.amount ?? 0));

    if (cancelled) {
      if (mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else if (costType === 'remove_counters') {
      const validation = validateCounterRemovalPaymentSelection(game, String(pid), stepAny, response.selections);
      if (validation.ok === false) {
        socket.emit('error', { code: validation.code, message: validation.message });
        return false;
      }
    } else {
      const selectedIds = (Array.isArray(response.selections) ? response.selections : [response.selections])
        .map((x: any) => String(x ?? ''))
        .filter(Boolean);

      // Optional steps can be declined (empty selection) without error.
      if (selectedIds.length === 0 && !mandatory) {
        // ok
      } else {
        const unique = Array.from(new Set(selectedIds));
        if (unique.length !== selectedIds.length) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate selection' });
          return false;
        }

        if (!Number.isFinite(amount)) {
          socket.emit('error', { code: 'INVALID_STEP', message: 'Invalid additional cost amount' });
          return false;
        }

        if (mandatory && costType !== 'teamwork' && selectedIds.length !== amount) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: `Must select exactly ${amount} item(s).` });
          return false;
        }

        if (costType === 'teamwork') {
          const minPower = Math.max(0, Number(stepAny.teamworkMinPower || 0));
          if (selectedIds.length === 0) {
            if (mandatory) {
              socket.emit('error', { code: 'INVALID_SELECTION', message: 'Must tap creatures to pay teamwork.' });
              return false;
            }
          } else {
            const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
            let totalPower = 0;
            for (const id of selectedIds) {
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(id));
              if (!permanent || String(permanent.controller || '') !== String(pid)) {
                socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected creature is not a valid teamwork choice' });
                return false;
              }
              if ((permanent as any).tapped) {
                socket.emit('error', { code: 'ALREADY_TAPPED', message: 'Selected creature is already tapped' });
                return false;
              }
              const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
              if (!typeLine.includes('creature')) {
                socket.emit('error', { code: 'INVALID_SELECTION', message: 'Teamwork can only tap creatures' });
                return false;
              }
              totalPower += getEffectivePower(permanent);
            }
            if (totalPower < minPower) {
              socket.emit('error', {
                code: 'INSUFFICIENT_POWER',
                message: `Selected creatures have total power ${totalPower}, but teamwork requires ${minPower} or more.`,
              });
              return false;
            }
          }
        } else if (costType === 'discard' || costType === 'reveal') {
          const zones = (game.state as any)?.zones?.[pid as any];
          const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
          const handIdSet = new Set(hand.map((c: any) => String(c?.id || '')).filter(Boolean));

          const availableCards: any[] = Array.isArray(stepAny.availableCards) ? stepAny.availableCards : [];
          const availableIdSet = new Set(availableCards.map((c: any) => String(c?.id || '')).filter(Boolean));
          const enforceAvailable = availableIdSet.size > 0;

          for (const id of selectedIds) {
            if (!handIdSet.has(String(id))) {
              socket.emit('error', { code: 'CARD_NOT_IN_HAND', message: 'Selected card not found in hand' });
              return false;
            }
            if (enforceAvailable && !availableIdSet.has(String(id))) {
              socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected card is not a valid choice' });
              return false;
            }
          }
        } else if (costType === 'behold') {
          const availableCards: any[] = Array.isArray(stepAny.availableCards) ? stepAny.availableCards : [];
          const availableTargets: any[] = Array.isArray(stepAny.availableTargets) ? stepAny.availableTargets : [];
          const availableIdSet = new Set([
            ...availableCards.map((c: any) => String(c?.id || '')).filter(Boolean),
            ...availableTargets.map((t: any) => String(t?.id || '')).filter(Boolean),
          ]);
          for (const id of selectedIds) {
            if (!availableIdSet.has(String(id))) {
              socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected card or creature is not a valid behold choice' });
              return false;
            }
          }
        } else {
          const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
          const controlledIdSet = new Set(
            battlefield
              .filter((p: any) => p && String(p.controller || '') === String(pid))
              .map((p: any) => String(p.id))
          );

          const availableTargets: any[] = Array.isArray(stepAny.availableTargets) ? stepAny.availableTargets : [];
          const availableIdSet = new Set(availableTargets.map((t: any) => String(t?.id || '')).filter(Boolean));
          const enforceAvailable = availableIdSet.size > 0;

          for (const id of selectedIds) {
            if (!controlledIdSet.has(String(id))) {
              socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected permanent is not a valid sacrifice' });
              return false;
            }
            if (enforceAvailable && !availableIdSet.has(String(id))) {
              socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected permanent is not a valid choice' });
              return false;
            }
          }
        }
      }
    }
  }

  // Validate SQUAD_COST_PAYMENT before completing the step.
  // If we complete first, malformed input could permanently consume the step.
  if (step.type === ResolutionStepType.SQUAD_COST_PAYMENT) {
    const stepAny = step as any;
    const mandatory = Boolean(stepAny.mandatory !== false);

    if (cancelled) {
      if (mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      let timesPaid: number | null = null;
      const raw = response.selections as any;
      if (typeof raw === 'number') timesPaid = raw;
      else if (typeof raw === 'string') {
        const n = Number(raw);
        timesPaid = Number.isFinite(n) ? n : null;
      } else if (Array.isArray(raw) && raw.length > 0) {
        const n = Number(raw[0]);
        timesPaid = Number.isFinite(n) ? n : null;
      } else if (raw && typeof raw === 'object' && raw.timesPaid != null) {
        const n = Number(raw.timesPaid);
        timesPaid = Number.isFinite(n) ? n : null;
      }

      if (timesPaid == null || !Number.isInteger(timesPaid) || timesPaid < 0) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid squad payment selection' });
        return false;
      }
    }
  }

  return true;
}
