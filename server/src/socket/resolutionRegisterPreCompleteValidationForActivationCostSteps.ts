/**
 * socket/resolutionRegisterPreCompleteValidationForActivationCostSteps.ts
 *
 * Pre-complete validation for the steps that are themselves part of an activated ability's cost:
 * tap-other, discard / exile-from-hand, exile-from-graveyard, remove-counters, sacrifice,
 * return-to-hand, and the Blight ability_activation_cost stage. Each one has to confirm the rest of
 * the cost (source tap requirement, mana, life) is still payable before the step is consumed;
 * otherwise the player pays part of a cost and the ability never activates.
 *
 * Tenth validation sibling. ...ForExtractedSteps.ts (~37KB) and ...ForStepResponseClusters.ts
 * (~34KB) are near the 40KB ceiling, so this cluster gets its own module.
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 *
 * Public entry symbol: validateActivationCostStepsBeforeComplete.
 */

import type { Socket } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";

export type ActivationCostPreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for mana pool / life / battlefield lookups. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
};

/**
 * Validate activation-cost mana/life before completing the step.
 * If we complete first, we could consume a cost-step and then fail due to insufficient mana,
 * leaving the game in a partial-cost state.
 * @returns false if the socket handler should abort; true to continue.
 */
export async function validateActivationCostStepsBeforeComplete(
  args: ActivationCostPreCompleteValidationArgs,
): Promise<boolean> {
  const { socket, step, response, cancelled, game, pid } = args;
  if (cancelled) return true;

  const stepAny = step as any;

  const validateManaAndLifeForActivationCost = async (controllerId: string, manaCost: string, lifeToPayForCost: number) => {
    const manaSymbols = String(manaCost || '').match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
    const manaOnly = manaSymbols
      .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
      .join('');

    if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
      socket.emit('error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${manaOnly || 'complex cost'})` });
      return false;
    }

    if (manaOnly) {
      const { getOrInitManaPool, resolveManaCostForPoolPayment, calculateTotalAvailableMana, validateManaPayment } = await import('./util.js');
      const pool = getOrInitManaPool(game.state, controllerId) as any;
      const resolved = resolveManaCostForPoolPayment(pool, manaOnly);
      if (!resolved.ok) {
        socket.emit('error', { code: 'INSUFFICIENT_MANA', message: (resolved as any).error || 'Insufficient mana.' });
        return false;
      }
      const totalAvailable = calculateTotalAvailableMana(pool, undefined);
      const validationError = validateManaPayment(totalAvailable, resolved.coloredCost, resolved.genericCost);
      if (validationError) {
        socket.emit('error', { code: 'INSUFFICIENT_MANA', message: validationError });
        return false;
      }
    }

    if (Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0) {
      const currentLife = Number((game.state as any)?.life?.[controllerId] ?? 40);
      if (!Number.isFinite(currentLife) || currentLife < lifeToPayForCost) {
        socket.emit('error', {
          code: 'INSUFFICIENT_LIFE',
          message: `Need to pay ${lifeToPayForCost} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
        });
        return false;
      }
    }

    return true;
  };

  const validateSourceTapRequirement = (controllerId: string, permanentId: string, requiresTap: boolean) => {
    if (!requiresTap) return true;
    const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
    const perm = battlefield.find((p: any) => p && String(p.id) === String(permanentId));
    if (!perm) {
      socket.emit('error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
      return false;
    }
    if (String(perm.controller || '') !== String(controllerId)) {
      socket.emit('error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
      return false;
    }
    if ((perm as any).tapped) {
      socket.emit('error', { code: 'ALREADY_TAPPED', message: 'Permanent is already tapped' });
      return false;
    }
    return true;
  };

  // TAP_OTHER as activation cost
  if (step.type === ResolutionStepType.TAP_UNTAP_TARGET && stepAny?.tapOtherAbilityAsCost === true) {
    const controllerId = String(pid);
    const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
    const requiresTap = Boolean(stepAny?.requiresTap);
    const manaCost = String(stepAny?.manaCost || '');
    const lifeToPayForCost = stepAny?.lifeToPayForCost !== undefined ? Number(stepAny.lifeToPayForCost) : 0;

    const payload = response.selections as any;
    const requestedAction = String(payload?.action || '');
    const stepAction = String(stepAny.action || 'tap');
    const action: 'tap' | 'untap' =
      stepAction === 'both'
        ? (requestedAction === 'untap' ? 'untap' : 'tap')
        : (stepAction === 'untap' ? 'untap' : 'tap');
    if (action !== 'tap') {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Activation cost requires tapping targets' });
      return false;
    }

    if (!validateSourceTapRequirement(controllerId, permanentId, requiresTap)) return false;
    const ok = await validateManaAndLifeForActivationCost(controllerId, manaCost, lifeToPayForCost);
    if (!ok) return false;
  }

  // DISCARD/EXILE_FROM_HAND as activation cost
  if (step.type === ResolutionStepType.DISCARD_SELECTION && (stepAny?.discardAbilityAsCost === true || stepAny?.exileFromHandAbilityAsCost === true)) {
    const controllerId = String(pid);
    const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
    const requiresTap = Boolean(stepAny?.requiresTap);
    const manaCost = String(stepAny?.manaCost || '');
    const lifeToPayForCost = stepAny?.lifeToPayForCost !== undefined ? Number(stepAny.lifeToPayForCost) : 0;
    if (!validateSourceTapRequirement(controllerId, permanentId, requiresTap)) return false;
    const ok = await validateManaAndLifeForActivationCost(controllerId, manaCost, lifeToPayForCost);
    if (!ok) return false;
  }

  // EXILE_FROM_GRAVEYARD as activation cost
  if (step.type === ResolutionStepType.GRAVEYARD_SELECTION && stepAny?.graveyardExileAbilityAsCost === true) {
    const controllerId = String(pid);
    const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
    const requiresTap = Boolean(stepAny?.requiresTap);
    const manaCost = String(stepAny?.manaCost || '');
    const lifeToPayForCost = stepAny?.lifeToPayForCost !== undefined ? Number(stepAny.lifeToPayForCost) : 0;
    if (!validateSourceTapRequirement(controllerId, permanentId, requiresTap)) return false;
    const ok = await validateManaAndLifeForActivationCost(controllerId, manaCost, lifeToPayForCost);
    if (!ok) return false;
  }

  // REMOVE_COUNTERS as activation cost
  if (step.type === ResolutionStepType.TARGET_SELECTION && stepAny?.removeCountersAbilityAsCost === true) {
    const controllerId = String(pid);
    const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
    const requiresTap = Boolean(stepAny?.requiresTap);
    const manaCost = String(stepAny?.manaCost || '');
    if (!validateSourceTapRequirement(controllerId, permanentId, requiresTap)) return false;
    const ok = await validateManaAndLifeForActivationCost(controllerId, manaCost, 0);
    if (!ok) return false;
  }

  // SACRIFICE as activation cost
  if (step.type === ResolutionStepType.TARGET_SELECTION && stepAny?.sacrificeAbilityAsCost === true) {
    const controllerId = String(pid);
    const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
    const requiresTap = Boolean(stepAny?.requiresTap);
    const manaCost = String(stepAny?.manaCost || '');
    const lifeToPayForCost = stepAny?.lifeToPayForCost !== undefined ? Number(stepAny.lifeToPayForCost) : 0;
    if (!validateSourceTapRequirement(controllerId, permanentId, requiresTap)) return false;
    const ok = await validateManaAndLifeForActivationCost(controllerId, manaCost, lifeToPayForCost);
    if (!ok) return false;
  }

  // RETURN_TO_HAND as activation cost
  if (step.type === ResolutionStepType.TARGET_SELECTION && stepAny?.returnToHandAbilityAsCost === true) {
    const controllerId = String(pid);
    const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
    const requiresTap = Boolean(stepAny?.requiresTap);
    const manaCost = String(stepAny?.manaCost || '');
    const lifeToPayForCost = stepAny?.lifeToPayForCost !== undefined ? Number(stepAny.lifeToPayForCost) : 0;
    if (!validateSourceTapRequirement(controllerId, permanentId, requiresTap)) return false;
    const ok = await validateManaAndLifeForActivationCost(controllerId, manaCost, lifeToPayForCost);
    if (!ok) return false;
  }

  // Blight activation-cost steps (validated against pending activation data)
  if (step.type === ResolutionStepType.TARGET_SELECTION && stepAny?.keywordBlight === true && String(stepAny?.keywordBlightStage || '') === 'ability_activation_cost') {
    const controllerId = String(stepAny?.keywordBlightController || pid);
    const activationId = String(stepAny?.keywordBlightActivationId || '').trim();
    const pending = activationId ? (game.state as any)?.pendingBlightAbilityActivations?.[activationId] : undefined;
    if (!pending) {
      socket.emit('error', { code: 'INVALID_STEP', message: 'Pending activation not found' });
      return false;
    }
    const permanentId = String(pending.permanentId || '').trim();
    const requiresTap = Boolean(pending.requiresTap);
    const manaCost = String(pending.manaCost || '');
    if (!validateSourceTapRequirement(controllerId, permanentId, requiresTap)) return false;
    const ok = await validateManaAndLifeForActivationCost(controllerId, manaCost, 0);
    if (!ok) return false;
  }

  return true;
}
