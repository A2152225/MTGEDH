/**
 * socket/resolutionRegisterPreCompleteValidationForOptionChoiceSteps.ts
 *
 * Pre-complete selection validation for OPTION_CHOICE steps, in two parts:
 *  - the selection-shape checks (format, duplicates, min/max, the land-would-enter sacrifice
 *    special case, membership in the step's options);
 *  - the pay-cost prompt checks (dredge replacement, optional payment prompts, reflexive mana /
 *    fixed payments, opponent-may-pay, sacrifice-unless-pay, ward payments and the combat attack
 *    tax), which need mana/life/zone affordability and therefore await.
 *
 * Sixth validation sibling. ...ForExtractedSteps.ts (~37KB) and ...ForStepResponseClusters.ts
 * (~34KB) are close to the 40KB ceiling; the other siblings own zone selection, single-answer
 * choice prompts, and mode/trigger steps.
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 *
 * Public entry symbols: validateOptionChoiceSelectionShapeBeforeComplete (sync) and
 * validateOptionChoicePayCostPromptsBeforeComplete (async - call only for a non-cancelled
 * OPTION_CHOICE step, so no other step type pays for the extra microtask).
 */

import type { Socket } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { getMaxGenericManaAvailable, parseManaCost } from "./util.js";
import type { GameContext } from "../state/context.js";
import { validateLifePayment } from "../state/utils.js";
import {
  getOptionalPaymentValidationFailure,
  isOptionalPaymentPayChoice,
  isOptionalPaymentPromptStep,
} from "./optional-payment-prompts.js";
import {
  getAvailableReflexiveManaAmountFromPool,
  parseReflexivePaymentChoiceAmount,
} from "../state/modules/reflexive-triggers.js";
import {
  extractResolutionPaymentItems,
  validateWardManaPaymentSelection,
} from "./resolution-handlers/resolutionManaPaymentApplication.js";

export type OptionChoicePreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for mana pool / life / zone lookups. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
};

/**
 * Validate the shape of an OPTION_CHOICE selection before completing the step.
 * If we complete first, invalid input would permanently consume the step and desync choice-driven
 * flows.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateOptionChoiceSelectionShapeBeforeComplete(
  args: OptionChoicePreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled } = args;
  if (step.type !== ResolutionStepType.OPTION_CHOICE) return true;

  const stepAny = step as any;

  if (cancelled) {
    if (step.mandatory) {
      socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
      return false;
    }
    return true;
  }

  const minSelections = Number(stepAny?.minSelections ?? 0);
  const maxSelections = Number(stepAny?.maxSelections ?? Infinity);

  const extractOptionId = (opt: any): string | null => {
    if (typeof opt === 'string') return opt;
    if (opt && typeof opt === 'object') {
      const id = (opt as any).id;
      if (typeof id === 'string' && id.trim()) return id;
      const value = (opt as any).value;
      if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
  };

  const rawOptions = Array.isArray(stepAny?.options) ? stepAny.options : [];
  const optionIds = rawOptions.map(extractOptionId).filter(Boolean) as string[];
  const optionIdSet = new Set(optionIds);

  const extractSelectionId = (sel: any): string | null => {
    if (typeof sel === 'string') return sel;
    if (sel && typeof sel === 'object') {
      const optionId = (sel as any).optionId;
      if (typeof optionId === 'string' && optionId.trim()) return optionId;
      const id = (sel as any).id;
      if (typeof id === 'string' && id.trim()) return id;
      const value = (sel as any).value;
      if (typeof value === 'string' && value.trim()) return value;
      const choiceId = (sel as any).choiceId;
      if (typeof choiceId === 'string' && choiceId.trim()) return choiceId;
    }
    return null;
  };

  let selectionIds: string[] | null = null;
  const rawSel: any = response.selections as any;

  if (typeof rawSel === 'string') {
    selectionIds = [rawSel];
  } else if (Array.isArray(rawSel)) {
    selectionIds = rawSel
      .map((s: any) => extractSelectionId(s) ?? (typeof s === 'number' || typeof s === 'boolean' ? String(s) : null))
      .filter((s: any) => typeof s === 'string' && s.trim().length > 0) as string[];
  } else if (rawSel && typeof rawSel === 'object') {
    const wrappedSelections = Array.isArray(rawSel.selectedOptionIds)
      ? rawSel.selectedOptionIds
      : (Array.isArray(rawSel.optionIds)
        ? rawSel.optionIds
        : (Array.isArray(rawSel.selectedIds) ? rawSel.selectedIds : null));
    if (wrappedSelections) {
      selectionIds = wrappedSelections
        .map((s: any) => extractSelectionId(s) ?? (typeof s === 'number' || typeof s === 'boolean' ? String(s) : null))
        .filter((s: any) => typeof s === 'string' && s.trim().length > 0) as string[];
    } else {
      const one = extractSelectionId(rawSel);
      selectionIds = one ? [one] : null;
    }
  } else {
    selectionIds = null;
  }

  if (!selectionIds) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid option selection format' });
    return false;
  }

  const unique = Array.from(new Set(selectionIds));
  if (unique.length !== selectionIds.length) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate option selected' });
    return false;
  }

  if (stepAny?.landWouldEnterSacrificeChoice === true) {
    const hasDecline = selectionIds.includes('decline_land_would_enter');
    if (hasDecline && selectionIds.length > 1) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Decline must be the only selection' });
      return false;
    }
  }

  if ((Number.isFinite(minSelections) ? selectionIds.length : 0) < (Number.isFinite(minSelections) ? minSelections : 0) ||
      (Number.isFinite(maxSelections) ? selectionIds.length : 0) > (Number.isFinite(maxSelections) ? maxSelections : Infinity)) {
    if (stepAny?.landWouldEnterSacrificeChoice === true) {
      const sacrificeCount = Number(stepAny?.sacrificeCount ?? 0);
      const hasDecline = selectionIds.includes('decline_land_would_enter');
      if (hasDecline) {
        if (selectionIds.length !== 1) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Decline must be the only selection' });
          return false;
        }
      } else if (sacrificeCount > 0 && selectionIds.length !== sacrificeCount) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: `Select exactly ${sacrificeCount} land(s) to sacrifice` });
        return false;
      } else {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid number of selections' });
        return false;
      }
    } else {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid number of selections' });
      return false;
    }
  }

  // If the step defines explicit options, enforce membership.
  if (optionIds.length > 0 && selectionIds.some((id) => !optionIdSet.has(String(id)))) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected option is not valid' });
    return false;
  }

  return true;
}

/**
 * Validate OPTION_CHOICE pay-cost prompts before completing the step.
 * If we complete first, handlers may treat insufficient resources as decline/counter/sacrifice,
 * permanently consuming the step and forcing unintended outcomes.
 * @returns false if the socket handler should abort; true to continue.
 */
export async function validateOptionChoicePayCostPromptsBeforeComplete(
  args: OptionChoicePreCompleteValidationArgs,
): Promise<boolean> {
  const { socket, step, response, game, pid } = args;
  const stepAny = step as any;

  const extractChoiceId = (raw: any): string | null => {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') {
        const id = (first as any).id;
        if (typeof id === 'string' && id.trim()) return id;
      }
      return String(first);
    }
    if (raw && typeof raw === 'object') {
      const id = (raw as any).id;
      if (typeof id === 'string' && id.trim()) return id;
      const optionId = (raw as any).optionId;
      if (typeof optionId === 'string' && optionId.trim()) return optionId;
      const choiceId = (raw as any).choiceId;
      if (typeof choiceId === 'string' && choiceId.trim()) return choiceId;
    }
    return null;
  };

  const validateManaCostPayable = async (payerId: string, manaCost: string): Promise<string | null> => {
    const cost = String(manaCost || '').trim();
    if (!cost) return null;
    if (!/\{[^}]+\}/.test(cost)) return `Unsupported mana cost (${cost || 'unknown'}).`;

    try {
      const parsed = parseManaCost(cost);
      const coloredTotal = Object.values(parsed.colors || {}).reduce((sum, value) => sum + Number(value || 0), 0);
      if (coloredTotal === 0 && Number(parsed.generic || 0) > 0) {
        const totalAvailable = getMaxGenericManaAvailable(game.state, payerId);
        if (totalAvailable < Number(parsed.generic || 0)) {
          return `Insufficient mana. Missing ${Math.max(0, Number(parsed.generic || 0) - totalAvailable)} generic mana.`;
        }
        return null;
      }
    } catch {
      // Fall back to pool-only validation below.
    }

    try {
      const { getOrInitManaPool, resolveManaCostForPoolPayment } = await import('./util.js');
      const pool = getOrInitManaPool(game.state, payerId) as any;
      const resolved = resolveManaCostForPoolPayment(pool, cost);
      if (!resolved.ok) return (resolved as any).error || 'Insufficient mana.';
      return null;
    } catch {
      return 'Unable to validate mana payment.';
    }
  };

  const validateGenericAmountPayable = async (payerId: string, amount: number): Promise<string | null> => {
    const needed = Number(amount || 0);
    if (!Number.isFinite(needed) || needed <= 0) return null;
    try {
      const excludedPermanentIds = Array.isArray(stepAny?.attackers)
        ? (stepAny.attackers as any[]).map((entry: any) => String(entry?.creatureId || '')).filter(Boolean)
        : [];
      const total = getMaxGenericManaAvailable(game.state, payerId, { excludedPermanentIds });
      if (total < needed) {
        return `Insufficient mana. Missing ${Math.max(0, needed - total)} generic mana.`;
      }
      return null;
    } catch {
      return 'Unable to validate mana payment.';
    }
  };

  const choiceId = extractChoiceId(response.selections);

  if (stepAny?.dredgeDrawReplacementChoice === true && choiceId && !['draw', 'decline'].includes(String(choiceId).toLowerCase())) {
    const dredgeCardId = String(choiceId).replace(/^dredge:/i, '').trim();
    const dredgeOption = (Array.isArray(stepAny?.dredgeOptions) ? stepAny.dredgeOptions : [])
      .find((option: any) => String(option?.cardId || '').trim() === dredgeCardId);
    const dredgeAmount = Math.max(0, Math.floor(Number(dredgeOption?.dredge || 0)));
    const zones = (game.state as any)?.zones?.[pid as any];
    const graveyard = Array.isArray(zones?.graveyard) ? zones.graveyard : [];
    const library = (game as any).libraries?.get?.(pid) || [];
    if (!dredgeCardId || !dredgeOption || !graveyard.some((card: any) => String(card?.id || '') === dredgeCardId)) {
      socket.emit('error', { code: 'INVALID_DREDGE_SELECTION', message: 'Selected dredge card is no longer in your graveyard.' });
      return false;
    }
    if (dredgeAmount <= 0 || library.length < dredgeAmount) {
      socket.emit('error', { code: 'INSUFFICIENT_LIBRARY', message: `Not enough cards in library to dredge ${dredgeAmount || ''}.`.trim() });
      return false;
    }
  }

  if (isOptionalPaymentPromptStep(stepAny) && isOptionalPaymentPayChoice(stepAny, choiceId)) {
    const validationFailure = getOptionalPaymentValidationFailure(game, String(pid), stepAny, choiceId);
    if (validationFailure) {
      socket.emit('error', validationFailure);
      return false;
    }
  }

  if (stepAny?.reflexiveManaPaymentChoice === true && String(choiceId || '').toLowerCase().startsWith('pay_')) {
    const amount = parseReflexivePaymentChoiceAmount(choiceId);
    const paymentUnit = (String(stepAny?.reflexiveManaPaymentUnit || 'mana').trim() || 'mana') as any;
    const available = getAvailableReflexiveManaAmountFromPool(game.state, String(pid), paymentUnit);
    const maxTimes = Math.floor(Number(stepAny?.reflexiveManaPaymentMaxTimes || 0));
    if (maxTimes > 0 && amount > maxTimes) {
      socket.emit('error', { code: 'INVALID_CHOICE', message: `You may pay at most ${maxTimes} time(s).` });
      return false;
    }
    if (amount <= 0 || amount > available) {
      socket.emit('error', {
        code: 'INSUFFICIENT_MANA',
        message: amount <= 0
          ? 'Invalid mana payment amount.'
          : `Insufficient mana. Available: ${available}, requested: ${amount}.`,
      });
      return false;
    }
  }

  if (stepAny?.reflexiveFixedPaymentChoice === true && String(choiceId || '').toLowerCase() === 'pay') {
    const controllerId = String(stepAny?.reflexiveFixedPaymentController || pid);
    const manaCost = String(stepAny?.reflexiveFixedPaymentManaCost || '').trim();
    const lifeAmount = Math.max(0, Math.floor(Number(stepAny?.reflexiveFixedPaymentLifeAmount || 0)));
    if (manaCost) {
      const validationError = await validateManaCostPayable(controllerId, manaCost);
      if (validationError) {
        socket.emit('error', { code: 'INSUFFICIENT_MANA', message: validationError });
        return false;
      }
    }
    if (lifeAmount > 0) {
      const startingLife = Number((game.state as any)?.startingLife ?? 40);
      const currentLife = Number((game.state as any)?.life?.[controllerId] ?? startingLife);
      const lifeValidationError = validateLifePayment(currentLife, lifeAmount, String(stepAny?.sourceName || stepAny?.reflexiveFixedPaymentSourceName || 'Ability'), game as GameContext, controllerId);
      if (lifeValidationError) {
        socket.emit('error', { code: 'INSUFFICIENT_LIFE', message: lifeValidationError });
        return false;
      }
    }
  }

  // Opponent may pay prompts (Rhystic Study / Smothering Tithe / etc.)
  if (stepAny?.opponentMayPayChoice === true && choiceId === 'pay') {
    const controllerId = String(pid);
    const manaCost = String(stepAny?.manaCost || '').trim();
    const validationError = await validateManaCostPayable(controllerId, manaCost);
    if (validationError) {
      socket.emit('error', { code: 'INSUFFICIENT_MANA', message: validationError });
      return false;
    }
  }

  // Sacrifice unless you pay (e.g., Transguild Promenade)
  if (stepAny?.sacrificeUnlessPayChoice === true && choiceId === 'pay_cost') {
    const controllerId = String(pid);
    const manaCost = String(stepAny?.manaCost || '{1}').trim();
    const validationError = await validateManaCostPayable(controllerId, manaCost);
    if (validationError) {
      socket.emit('error', { code: 'INSUFFICIENT_MANA', message: validationError });
      return false;
    }
  }

  // Ward payment prompts: selecting "pay" must be affordable at submit time.
  if (stepAny?.wardPayment === true && choiceId === 'pay_ward_cost') {
    const paymentType = String(stepAny?.wardPaymentType || '').trim().toLowerCase();
    const wardCost = String(stepAny?.wardCost || '').trim();

    if (paymentType === 'mana' || (paymentType === '' && /\{[^}]+\}/.test(wardCost))) {
      const payment = extractResolutionPaymentItems(response.selections as any);
      const validation = validateWardManaPaymentSelection(game, String(pid), wardCost, payment);
      if (!validation.ok) {
        const validationError = validation as { ok: false; code: string; message: string };
        socket.emit('error', { code: validationError.code, message: validationError.message });
        return false;
      }
    }

    if (paymentType === 'life') {
      const lifeAmount = Number(stepAny?.wardLifeAmount || 0);
      if (Number.isFinite(lifeAmount) && lifeAmount > 0) {
        const startingLife = Number((game.state as any)?.startingLife ?? 40);
        const currentLife = Number((game.state as any)?.life?.[pid as any] ?? startingLife);
        if (!Number.isFinite(currentLife) || currentLife < lifeAmount) {
          socket.emit('error', { code: 'INSUFFICIENT_LIFE', message: `Not enough life to pay ${lifeAmount}.` });
          return false;
        }
      }
    }

    if (paymentType === 'discard') {
      const discardCount = Number(stepAny?.wardDiscardCount || 0);
      const zones = (game.state as any)?.zones?.[pid as any];
      const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
      if (!Number.isFinite(discardCount) || discardCount <= 0 || hand.length < discardCount) {
        socket.emit('error', {
          code: 'INSUFFICIENT_CARDS',
          message: `Not enough cards in hand to discard ${Number.isFinite(discardCount) && discardCount > 0 ? discardCount : 1}.`,
        });
        return false;
      }
    }

    if (paymentType === 'sacrifice') {
      const sacCount = Number(stepAny?.wardSacrificeCount || 0) || 0;
      const sacKind = String(stepAny?.wardSacrificeKind || '').trim().toLowerCase();
      const battlefield = (game.state?.battlefield || []) as any[];
      const eligible = battlefield
        .filter((p: any) => p && String(p.controller || '') === String(pid))
        .filter((p: any) => {
          const tl = String(p.card?.type_line || '').toLowerCase();
          if (sacKind === 'permanent') return true;
          if (sacKind === 'nonland permanent') return !tl.includes('land');
          return sacKind ? tl.includes(sacKind) : false;
        });
      if (!sacCount || sacCount <= 0 || eligible.length < sacCount) {
        socket.emit('error', { code: 'INSUFFICIENT_PERMANENTS', message: 'Not enough permanents to sacrifice to pay ward.' });
        return false;
      }
    }
  }

  // Combat attack tax prompts: confirm pay must be affordable.
  if (stepAny?.attackCostPayment === true && (
    choiceId === 'pay_attack_cost'
    || (Array.isArray(response.selections)
      && (response.selections as any[]).some((entry) => entry && typeof entry === 'object' && 'payWithLife' in entry))
  )) {
    const amount = Number(stepAny?.attackCostAmount || 0) || 0;
    const items = Array.isArray(stepAny?.attackCostPhyrexianItems) ? stepAny.attackCostPhyrexianItems : [];
    const { parseAttackCostPhyrexianChoices, canAffordAttackCostPayment } = await import(
      './combat-handlers/attackCostPhyrexianPayment.js'
    );
    const choices = parseAttackCostPhyrexianChoices(response.selections, items.length);
    if (items.length > 0 && !choices) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Missing Phyrexian attack-cost choices.' });
      return false;
    }
    const excludedPermanentIds = Array.isArray(stepAny?.attackers)
      ? (stepAny.attackers as any[]).map((entry: any) => String(entry?.creatureId || '')).filter(Boolean)
      : [];
    const afford = canAffordAttackCostPayment(game.state, String(pid), {
      generic: amount,
      items,
      excludedPermanentIds,
      choices: choices || [],
    });
    if (!afford.ok) {
      socket.emit('error', {
        code: afford.error?.toLowerCase().includes('life') ? 'INSUFFICIENT_LIFE' : 'INSUFFICIENT_MANA',
        message: afford.error || 'Insufficient mana.',
      });
      return false;
    }
  }

  // Combat block tax prompts: confirm pay must be affordable.
  if (stepAny?.blockCostPayment === true && choiceId === 'pay_block_cost') {
    const amount = Number(stepAny?.blockCostAmount || 0) || 0;
    const validationError = await validateGenericAmountPayable(String(pid), amount);
    if (validationError) {
      socket.emit('error', { code: 'INSUFFICIENT_MANA', message: validationError });
      return false;
    }
  }

  return true;
}
