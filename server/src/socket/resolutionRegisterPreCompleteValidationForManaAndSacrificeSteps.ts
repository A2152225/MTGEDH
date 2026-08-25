/**
 * socket/resolutionRegisterPreCompleteValidationForManaAndSacrificeSteps.ts
 *
 * Pre-complete selection validation for MANA_PAYMENT_CHOICE (phyrexian delegation, equip/fortify
 * style activation payments, spell-cast pending guard) plus the sacrifice-flavoured prompts that
 * followed it: the tap-creatures-as-cost TARGET_SELECTION variant (Summon the School),
 * EXTORT_PAYMENT and EXPLOIT_CHOICE.
 *
 * Eighth validation sibling. ...ForExtractedSteps.ts (~37KB) and ...ForStepResponseClusters.ts
 * (~34KB) are close to the 40KB ceiling; the other siblings own zone selection, single-answer
 * choice prompts, mode/trigger steps, OPTION_CHOICE and the non-mana cost prompts.
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 *
 * Public entry symbols: validateManaPaymentChoiceStepBeforeComplete (async - call only for a
 * MANA_PAYMENT_CHOICE step, so no other step type pays for the extra microtask) and
 * validateTapCostExtortAndExploitStepsBeforeComplete (sync).
 */

import type { Socket } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import {
  buildActivatedAbilityRestrictedManaPurpose,
  type RestrictedManaSpendPurpose,
} from "./util.js";
import { extractResolutionChoiceId } from "./resolutionKeywordChoiceHandlers.js";
import { cloneGameForResolutionPaymentValidation } from "./resolutionPaymentManaUtils.js";
import {
  applySelectedManaPaymentForResolutionCost,
  extractResolutionPaymentItems,
} from "./resolution-handlers/resolutionManaPaymentApplication.js";
import { validatePhyrexianManaPaymentBeforeComplete } from "./resolutionRegisterPreCompleteValidationForStepResponseClusters.js";

export type ManaAndSacrificePreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for mana pool / battlefield / zone lookups. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
};

/**
 * Validate a MANA_PAYMENT_CHOICE step before completing it (call only for that step type).
 * If we complete first, malformed input would permanently consume the step; a failed apply would
 * leave the prompt gone, mana unchanged, and the ability unstacked.
 * @returns false if the socket handler should abort; true to continue.
 */
export async function validateManaPaymentChoiceStepBeforeComplete(
  args: ManaAndSacrificePreCompleteValidationArgs,
): Promise<boolean> {
  const { socket, step, response, cancelled, game, pid } = args;
  const stepAny = step as any;

  if (!(await validatePhyrexianManaPaymentBeforeComplete({ socket, step, response, cancelled, game, pid }))) {
    return false;
  }

  // activationPaymentChoice (Equip/fortify/etc.) must be validated BEFORE completeStep.
  // Otherwise a failed apply leaves the prompt gone, mana unchanged, and the ability unstacked.
  const needsSelectedPaymentValidation =
    !cancelled &&
    stepAny.phyrexianManaChoice !== true &&
    (
      stepAny.sacrificeUnlessPayChoice === true
      || stepAny.activationPaymentChoice === true
    );

  if (needsSelectedPaymentValidation) {
    const manaCost = String(stepAny?.manaCost || stepAny?.totalManaCost || '').trim();
    if (manaCost) {
      const validationGame = cloneGameForResolutionPaymentValidation(game, pid);
      const payment = extractResolutionPaymentItems(response.selections as any);
      const activatingPermanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
      if (
        stepAny.activationPaymentChoice === true
        && stepAny.requiresTap === true
        && activatingPermanentId
        && Array.isArray(payment)
        && payment.some((item) => String(item?.permanentId || '').trim() === activatingPermanentId)
      ) {
        socket.emit('error', {
          code: 'INVALID_PAYMENT_SOURCE',
          message: `Cannot use ${String(stepAny.cardName || step.sourceName || 'this permanent')} to pay for its own activation cost.`,
        });
        return false;
      }
      const prevalidatePurpose = stepAny.activationPaymentChoice === true
        ? (() => {
            const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
            const permanent = (Array.isArray(game.state?.battlefield) ? game.state.battlefield : [])
              .find((perm: any) => perm && String(perm.id) === permanentId);
            return permanent
              ? buildActivatedAbilityRestrictedManaPurpose(permanent)
              : ({ isActivatedAbility: true } as RestrictedManaSpendPurpose);
          })()
        : undefined;
      const applied = applySelectedManaPaymentForResolutionCost(
        validationGame,
        pid,
        manaCost,
        payment,
        prevalidatePurpose,
        { skipEventPersistence: true },
      );
      if (!applied.ok) {
        const appliedError = applied as { ok: false; code: string; message: string };
        socket.emit('error', {
          code: appliedError.code,
          message: appliedError.message,
        });
        return false;
      }
    }
  }

  // Spell-cast payment: refuse to consume the step if the pending cast was already lost
  // (reconnect / prior cancel race). Otherwise completeStep leaves the player with no
  // prompt and a card still in hand.
  if (
    !cancelled &&
    stepAny.spellPaymentRequired === true &&
    stepAny.graveyardSpellCastManaPayment !== true
  ) {
    const effectId = String(stepAny.effectId || '').trim();
    const pendingCast = effectId ? (game.state as any)?.pendingSpellCasts?.[effectId] : undefined;
    if (!pendingCast) {
      socket.emit('error', {
        code: 'PENDING_CAST_MISSING',
        message: 'Cast payment expired — request the cast again.',
      });
      return false;
    }
  }

  return true;
}

/**
 * Validate the tap-creatures-as-cost TARGET_SELECTION variant, EXTORT_PAYMENT and EXPLOIT_CHOICE.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateTapCostExtortAndExploitStepsBeforeComplete(
  args: ManaAndSacrificePreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled, game, pid } = args;

  // Tap-creatures-as-cost (Summon the School style): validate before consuming the step.
  if (
    step.type === ResolutionStepType.TARGET_SELECTION &&
    (step as any)?.tapCreaturesCost === true &&
    !cancelled
  ) {
    const stepAny = step as any;
    const cardId = String(stepAny?.cardId || step.sourceId || '').trim();
    const requiredCount = Number(stepAny?.requiredCount || 0);
    const selectionsRaw = response.selections as any;
    const selections: string[] = Array.isArray(selectionsRaw)
      ? selectionsRaw.map((x: any) => String(x)).filter(Boolean)
      : [];

    if (!cardId) {
      socket.emit('error', { code: 'INVALID_STEP', message: 'Graveyard return step is missing its card.' });
      return false;
    }
    if (!Number.isFinite(requiredCount) || requiredCount <= 0) {
      socket.emit('error', { code: 'INVALID_STEP', message: 'Invalid tap-cost requirement.' });
      return false;
    }
    if (selections.length !== requiredCount) {
      socket.emit('error', {
        code: 'INVALID_SELECTION',
        message: `Select exactly ${requiredCount} creature(s) to tap.`,
      });
      return false;
    }

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    for (const permanentId of selections) {
      const permanent = battlefield.find((p: any) => p && p.id === permanentId);
      if (!permanent || String(permanent.controller) !== String(pid)) {
        socket.emit('error', {
          code: 'INVALID_SELECTION',
          message: 'One of the selected permanents is no longer a legal tap cost.',
        });
        return false;
      }
      if ((permanent as any).tapped) {
        socket.emit('error', {
          code: 'ALREADY_TAPPED',
          message: `${permanent.card?.name || 'Creature'} is already tapped.`,
        });
        return false;
      }
    }

    const zones = (game.state as any)?.zones?.[pid as any];
    const inGraveyard = Array.isArray(zones?.graveyard)
      && zones.graveyard.some((c: any) => String(c?.id) === cardId);
    if (!inGraveyard) {
      socket.emit('error', {
        code: 'CARD_NOT_IN_GRAVEYARD',
        message: 'That card is no longer in your graveyard.',
      });
      return false;
    }
  }

  if (step.type === ResolutionStepType.EXTORT_PAYMENT && !cancelled) {
    const stepAny = step as any;
    const manaCost = String(stepAny?.manaCost || '{W/B}').trim();
    const validationGame = cloneGameForResolutionPaymentValidation(game, pid);
    const payment = extractResolutionPaymentItems(response.selections as any);
    const applied = applySelectedManaPaymentForResolutionCost(validationGame, pid, manaCost, payment, undefined, { skipEventPersistence: true });
    if (!applied.ok) {
      const appliedError = applied as { ok: false; code: string; message: string };
      socket.emit('error', {
        code: appliedError.code,
        message: appliedError.message,
      });
      return false;
    }
  }

  if (step.type === ResolutionStepType.EXPLOIT_CHOICE && !cancelled) {
    const stepAny = step as any;
    const selectedId = String(extractResolutionChoiceId(response.selections) || '').trim();
    const allowedCreatureIds = new Set(
      (Array.isArray(stepAny?.creatures) ? stepAny.creatures : [])
        .map((creature: any) => String(creature?.id || '').trim())
        .filter(Boolean)
    );
    const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
    const selectedPermanent = battlefield.find((permanent: any) => String(permanent?.id || '').trim() === selectedId) || null;
    const selectedTypeLine = String(selectedPermanent?.card?.type_line || '').toLowerCase();

    if (!selectedId || !allowedCreatureIds.has(selectedId)) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid exploit sacrifice selection' });
      return false;
    }

    if (!selectedPermanent || String(selectedPermanent?.controller || '').trim() !== pid || !selectedTypeLine.includes('creature')) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected exploit creature is no longer a legal sacrifice' });
      return false;
    }
  }

  return true;
}
