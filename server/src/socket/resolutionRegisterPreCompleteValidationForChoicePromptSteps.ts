/**
 * socket/resolutionRegisterPreCompleteValidationForChoicePromptSteps.ts
 *
 * Pre-complete selection validation for the single-answer choice prompts:
 * X_VALUE_SELECTION (including the Blight X activation-cost guard), KYNAIOS_CHOICE,
 * RETURN_CONTROLLED_PERMANENT_CHOICE, HIDEAWAY_CHOICE, REPEATED_ZONE_DRAFT, DEVOUR_SELECTION,
 * UPKEEP_SACRIFICE and PLAYER_CHOICE.
 *
 * Fourth validation sibling; resolutionRegisterPreCompleteValidationForExtractedSteps.ts (~37KB)
 * and resolutionRegisterPreCompleteValidationForStepResponseClusters.ts (~34KB) are close to the
 * 40KB ceiling and resolutionRegisterPreCompleteValidationForZoneSelectionSteps.ts owns the
 * hand/zone card prompts.
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 *
 * Public entry symbol: validateChoicePromptStepsBeforeComplete (sync - none of these branches
 * awaited in the parent).
 */

import type { Socket } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";

export type ChoicePromptPreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for hand / battlefield / player lookups. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
};

/**
 * Validate selections for the choice prompts listed in the module header.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateChoicePromptStepsBeforeComplete(
  args: ChoicePromptPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled, game, pid } = args;

  // Validate X_VALUE_SELECTION selections before completing the step.
  // The handler can early-return on invalid; if we completed first we'd consume the step.
  if (step.type === ResolutionStepType.X_VALUE_SELECTION) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      let xValue: number | null = null;
      const sel: any = response.selections as any;
      if (typeof sel === 'number') xValue = sel;
      else if (typeof sel === 'string') xValue = Number(sel);
      else if (sel && typeof sel === 'object' && !Array.isArray(sel) && sel.xValue != null) xValue = Number(sel.xValue);

      xValue = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue as number)) : null;
      if (xValue == null) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid X value selection' });
        return false;
      }

      const minValue = stepAny?.minValue != null ? Number(stepAny.minValue) : undefined;
      const maxValue = stepAny?.maxValue != null ? Number(stepAny.maxValue) : undefined;
      if (Number.isFinite(minValue) && xValue < (minValue as number)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: `X must be at least ${minValue}` });
        return false;
      }
      if (Number.isFinite(maxValue) && xValue > (maxValue as number)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: `X must be at most ${maxValue}` });
        return false;
      }

      // Blight X activation cost: prevent handler early-returns from consuming the step.
      if (stepAny?.keywordBlight === true && String(stepAny?.keywordBlightStage || '') === 'ability_activation_cost_choose_x') {
        const activationId = String(stepAny?.keywordBlightActivationId || '').trim();
        if (!activationId) {
          socket.emit('error', { code: 'INVALID_STEP', message: 'Missing Blight activation id' });
          return false;
        }

        const pending = (game.state as any)?.pendingBlightAbilityActivations?.[activationId];
        if (!pending) {
          socket.emit('error', { code: 'INVALID_STEP', message: 'Pending Blight activation not found' });
          return false;
        }

        const controllerId = String(stepAny?.keywordBlightController || pid);
        const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
        const hasValidTarget = battlefield
          .filter((p: any) => p && String(p.controller || '') === controllerId)
          .some((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'));

        if (!hasValidTarget) {
          socket.emit('error', { code: 'NO_VALID_TARGETS', message: `Cannot pay Blight ${xValue} (you control no creatures).` });
          return false;
        }
      }
    }
  }

  // Validate KYNAIOS_CHOICE selections before completing the step.
  // If we complete first, invalid input would permanently consume the step and skip the choice.
  if (step.type === ResolutionStepType.KYNAIOS_CHOICE) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const raw: any = response.selections as any;
      let choice: string = 'decline';
      let landCardId: string | undefined;

      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        choice = String(raw.choice || 'decline');
        landCardId = raw.landCardId != null ? String(raw.landCardId) : undefined;
      } else if (Array.isArray(raw) && raw.length > 0) {
        choice = String(raw[0] ?? 'decline');
        landCardId = raw[1] != null ? String(raw[1]) : undefined;
      } else {
        choice = String(raw || 'decline');
      }

      const options: string[] = Array.isArray(stepAny?.landPlayOrFallbackOptions)
        ? stepAny.landPlayOrFallbackOptions.map((x: any) => String(x))
        : Array.isArray(stepAny?.options)
          ? stepAny.options.map((x: any) => String(x))
          : ['play_land', 'draw_card', 'decline'];
      if (!options.includes(choice)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid choice' });
        return false;
      }

      if (choice === 'play_land') {
        const canPlayLand = (stepAny?.landPlayOrFallbackCanPlayLand ?? stepAny?.canPlayLand) !== false;
        if (!canPlayLand) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'You cannot play a land' });
          return false;
        }

        if (!landCardId || !String(landCardId).trim()) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Missing land selection' });
          return false;
        }

        const liveHand = Array.isArray((game as any)?.state?.zones?.[pid as any]?.hand)
          ? ((game as any).state.zones[pid as any].hand as any[])
          : [];
        const liveLandIds = new Set(
          liveHand
            .filter((card: any) => card && String(card?.type_line || '').toLowerCase().includes('land'))
            .map((card: any) => String(card?.id || '').trim())
            .filter(Boolean),
        );
        if (!liveLandIds.has(String(landCardId).trim())) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected land is not in your hand' });
          return false;
        }
        const landsInHand: any[] = Array.isArray(stepAny?.landPlayOrFallbackLandsInHand)
          ? stepAny.landPlayOrFallbackLandsInHand
          : Array.isArray(stepAny?.landsInHand)
            ? stepAny.landsInHand
            : [];
        const allowed = new Set([
          ...landsInHand.map((l: any) => String(l?.id || '').trim()).filter(Boolean),
          ...liveLandIds,
        ]);
        if (!allowed.has(String(landCardId).trim())) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected land is not a valid choice' });
          return false;
        }
      }
    }
  }

  // Validate return-controlled-permanent selections before completing the step.
  // If we complete first, invalid input would permanently consume the step and skip returning a land.
  if (step.type === ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const raw: any = response.selections as any;
      let returnPermanentId = '';
      if (typeof raw === 'string') returnPermanentId = raw;
      else if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') returnPermanentId = raw[0];
      else if (raw && typeof raw === 'object' && !Array.isArray(raw)) returnPermanentId = String(raw.permanentId || raw.returnPermanentId || '');

      returnPermanentId = String(returnPermanentId || '').trim();
      if (!returnPermanentId) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'No permanent selected' });
        return false;
      }

      const optionsToChoose: any[] = Array.isArray(stepAny?.returnControlledPermanentOptions)
        ? stepAny.returnControlledPermanentOptions
        : [];
      const validIds = new Set(optionsToChoose.map((option: any) => String(option?.permanentId)).filter(Boolean));
      if (!validIds.has(returnPermanentId)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected permanent is not a valid choice' });
        return false;
      }
    }
  }

  if (step.type === ResolutionStepType.HIDEAWAY_CHOICE) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const raw: any = response.selections as any;
      let selectedCardId = '';
      if (typeof raw === 'string') selectedCardId = raw;
      else if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') selectedCardId = raw[0];
      else if (raw && typeof raw === 'object' && !Array.isArray(raw)) selectedCardId = String(raw.cardId || raw.selectedCardId || raw.id || '');

      selectedCardId = String(selectedCardId || '').trim();
      if (!selectedCardId) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'No hideaway card selected' });
        return false;
      }

      const hideawayCards: any[] = Array.isArray(stepAny?.hideawayCards) ? stepAny.hideawayCards : [];
      const validIds = new Set(
        hideawayCards
          .map((card: any) => String(card?.cardId || card?.id || '').trim())
          .filter(Boolean),
      );
      if (!validIds.has(selectedCardId)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected card is not a valid hideaway choice' });
        return false;
      }
    }
  }

  if (step.type === ResolutionStepType.REPEATED_ZONE_DRAFT) {
    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const stepAny = step as any;
      const raw: any = response.selections as any;
      let selectedCardId = '';
      if (typeof raw === 'string') selectedCardId = raw;
      else if (Array.isArray(raw) && raw.length > 0) selectedCardId = String(raw[0] || '');
      else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        selectedCardId = String(raw.cardId || raw.selectedCardId || raw.id || '');
      }
      selectedCardId = String(selectedCardId || '').trim();
      if (!selectedCardId) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'No draft card selected' });
        return false;
      }
      const remaining = Array.isArray(stepAny.remainingCardIds)
        ? stepAny.remainingCardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
        : [];
      if (!remaining.includes(selectedCardId)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected card is not in the remaining draft pool' });
        return false;
      }
    }
  }

  // Validate DEVOUR_SELECTION selections before completing the step.
  // If we complete first, invalid input would permanently consume the step and skip devour.
  if (step.type === ResolutionStepType.DEVOUR_SELECTION) {
    const stepAny = step as any;

    // Devour is a "may"-style selection (choose any number), so cancellation is treated as choosing none.
    if (!cancelled) {
      const raw: any = response.selections as any;

      const normalize = (v: any): string[] | null => {
        if (v == null) return [];
        if (typeof v === 'string') return [v];
        if (Array.isArray(v)) {
          return v
            .filter((x: any) => typeof x === 'string')
            .map((x: any) => String(x))
            .filter((x: string) => x.trim().length > 0);
        }
        return null;
      };

      const selectedIds = normalize(raw);
      if (!selectedIds) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid devour selection format' });
        return false;
      }

      const unique = Array.from(new Set(selectedIds));
      if (unique.length !== selectedIds.length) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate creature selected' });
        return false;
      }

      const availableCreatures: any[] = Array.isArray(stepAny?.availableCreatures) ? stepAny.availableCreatures : [];
      const availableIds = new Set(availableCreatures.map((c: any) => String(c?.permanentId)).filter(Boolean));
      if (selectedIds.some((id: string) => !availableIds.has(String(id)))) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected creature is not a valid choice' });
        return false;
      }
    }
  }

  // Validate UPKEEP_SACRIFICE selections before completing the step.
  // If we complete first, invalid input would permanently consume the step and skip the sacrifice.
  if (step.type === ResolutionStepType.UPKEEP_SACRIFICE) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const raw: any = response.selections as any;
      let sacrificeType: 'creature' | 'source' = 'source';
      let creatureId: string | undefined;

      if (typeof raw === 'string') {
        sacrificeType = 'creature';
        creatureId = raw;
      } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        sacrificeType = String(raw.type || 'source') === 'creature' ? 'creature' : 'source';
        creatureId = raw.creatureId != null ? String(raw.creatureId) : undefined;
      }

      const allowSourceSacrifice: boolean = stepAny?.allowSourceSacrifice !== false;
      if (sacrificeType === 'source') {
        if (!allowSourceSacrifice) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'You must sacrifice a creature' });
          return false;
        }
      } else {
        const creatures: any[] = Array.isArray(stepAny?.creatures) ? stepAny.creatures : [];
        const validIds = new Set(creatures.map((c: any) => String(c?.id)).filter(Boolean));
        const id = String(creatureId || '').trim();
        if (!id || !validIds.has(id)) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid creature selection' });
          return false;
        }
      }
    }
  }

  // Validate PLAYER_CHOICE selections before completing the step.
  // The handler can early-return on invalid/unsupported selection formats.
  if (step.type === ResolutionStepType.PLAYER_CHOICE) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const raw: any = response.selections as any;
      let selectedPlayerId = '';
      if (typeof raw === 'string') selectedPlayerId = raw;
      else if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') selectedPlayerId = raw[0];

      selectedPlayerId = String(selectedPlayerId || '').trim();
      if (!selectedPlayerId) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid player choice selection' });
        return false;
      }

      const stepPlayers: any[] = Array.isArray(stepAny.players) ? stepAny.players : [];
      const statePlayers: any[] = Array.isArray((game.state as any)?.players) ? (game.state as any).players : [];
      const candidates = stepPlayers.length > 0 ? stepPlayers : statePlayers;
      const validIds = new Set(candidates.map((p: any) => String(p?.id)).filter(Boolean));

      if (validIds.size > 0 && !validIds.has(selectedPlayerId)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected player is not a valid choice' });
        return false;
      }

      const opponentOnly = Boolean(stepAny.opponentOnly);
      if (opponentOnly && String(selectedPlayerId) === String(pid)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Must choose an opponent' });
        return false;
      }

      // If this step references a permanent, ensure it still exists.
      const permanentId = String(stepAny.permanentId || '').trim();
      if (permanentId) {
        const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
        const perm = battlefield.find((p: any) => p && String(p.id) === permanentId);
        if (!perm) {
          socket.emit('error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
          return false;
        }
      }
    }
  }

  return true;
}
