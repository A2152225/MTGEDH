/**
 * socket/resolutionRegisterPreCompleteValidationForModeAndTriggerSteps.ts
 *
 * Pre-complete selection validation for MODE_SELECTION (normal / entwine / {P} budget shapes),
 * TRIGGER_ORDER and OPENING_HAND_ACTIONS.
 *
 * Fifth validation sibling. ...ForExtractedSteps.ts (~37KB) and ...ForStepResponseClusters.ts
 * (~34KB) are close to the 40KB ceiling; ...ForZoneSelectionSteps.ts owns the hand/zone card
 * prompts and ...ForChoicePromptSteps.ts owns the single-answer choice prompts.
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 *
 * Public entry symbol: validateModeTriggerAndOpeningHandStepsBeforeComplete (sync - none of these
 * branches awaited in the parent).
 */

import type { Socket } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { isValidPBudgetSelection } from "../../../shared/src/modeSelectionPBudget.js";
import { isOpeningHandBattlefieldCard } from "./opening-hand.js";

export type ModeAndTriggerPreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for the opening-hand zone lookup. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
};

/**
 * Validate MODE_SELECTION / TRIGGER_ORDER / OPENING_HAND_ACTIONS selections.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateModeTriggerAndOpeningHandStepsBeforeComplete(
  args: ModeAndTriggerPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled, game, pid } = args;

  // Validate MODE_SELECTION selections before completing the step.
  // If we complete first, invalid input would permanently consume the step and strand the player.
  if (step.type === ResolutionStepType.MODE_SELECTION) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const minModes = Number(stepAny?.minModes ?? 0);
      const maxModesRaw = Number(stepAny?.maxModes ?? Infinity);
      const maxModes =
        Number.isFinite(maxModesRaw)
          ? (maxModesRaw < 0 ? Infinity : maxModesRaw)
          : Infinity;
      const allowDuplicates = Boolean(stepAny?.allowDuplicates || stepAny?.canRepeatModes);
      const pBudgetRaw = Number(stepAny?.pBudget);
      const pBudget = Number.isFinite(pBudgetRaw) && pBudgetRaw > 0 ? Math.floor(pBudgetRaw) : undefined;

      const extractModeId = (opt: any): string | null => {
        if (typeof opt === 'string') return opt;
        if (typeof opt === 'number' || typeof opt === 'boolean') return String(opt);
        if (opt && typeof opt === 'object') {
          const modeId = (opt as any).modeId;
          if (typeof modeId === 'string' && modeId.trim()) return modeId;
          const id = (opt as any).id;
          if (typeof id === 'string' && id.trim()) return id;
          const value = (opt as any).value;
          if (typeof value === 'string' && value.trim()) return value;
        }
        return null;
      };

      const rawModes = Array.isArray(stepAny?.modes) ? stepAny.modes : [];
      const modeIds = rawModes.map(extractModeId).filter(Boolean) as string[];
      const modeIdSet = new Set(modeIds.map(String));
      const modesForBudget = rawModes.map((mode: any, idx: number) => ({
        id: String(extractModeId(mode) || `mode_${idx + 1}`),
        pCost: Number(mode?.pCost),
      }));

      const rawSel: any = response.selections as any;
      let selectionIds: string[] | null = null;

      if (typeof rawSel === 'string' || typeof rawSel === 'number' || typeof rawSel === 'boolean') {
        selectionIds = [String(rawSel)];
      } else if (Array.isArray(rawSel)) {
        selectionIds = rawSel
          .map((s: any) => extractModeId(s))
          .filter((s: any) => typeof s === 'string' && s.trim().length > 0) as string[];
      } else if (rawSel && typeof rawSel === 'object') {
        const wrappedSelections = Array.isArray(rawSel.selectedModeIds)
          ? rawSel.selectedModeIds
          : (Array.isArray(rawSel.modeIds)
            ? rawSel.modeIds
            : (Array.isArray(rawSel.selectedIds) ? rawSel.selectedIds : null));
        if (wrappedSelections) {
          selectionIds = wrappedSelections
            .map((s: any) => extractModeId(s))
            .filter((s: any) => typeof s === 'string' && s.trim().length > 0) as string[];
        } else {
          const one = extractModeId(rawSel);
          selectionIds = one ? [one] : null;
        }
      } else {
        selectionIds = null;
      }

      if (!selectionIds) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid mode selection format' });
        return false;
      }

      const normalized = selectionIds.map((x) => String(x)).filter((x) => x.trim().length > 0);

      if (pBudget) {
        if (!isValidPBudgetSelection(normalized, modesForBudget, pBudget, {
          minModes,
          canRepeatModes: allowDuplicates,
        })) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid {P} mode budget selection' });
          return false;
        }
      } else {
        const normalMinModes = Number(stepAny?.normalMinModes ?? minModes);
        const normalMaxModesRaw = Number(stepAny?.normalMaxModes ?? maxModes);
        const normalMaxModes =
          Number.isFinite(normalMaxModesRaw)
            ? (normalMaxModesRaw < 0 ? Infinity : normalMaxModesRaw)
            : Infinity;
        const entwineCost = typeof stepAny?.entwineCost === 'string' && stepAny.entwineCost.trim().length > 0
          ? String(stepAny.entwineCost)
          : undefined;
        const allModeCount = modeIds.length;
        const withinNormalRange =
          (Number.isFinite(normalMinModes) ? normalized.length : 0) >= (Number.isFinite(normalMinModes) ? normalMinModes : 0) &&
          (Number.isFinite(normalMaxModes) ? normalized.length : 0) <= (Number.isFinite(normalMaxModes) ? normalMaxModes : Infinity);
        const isEntwinedSelection = Boolean(entwineCost) && allModeCount > 0 && normalized.length === allModeCount;

        if (entwineCost) {
          if (!withinNormalRange && !isEntwinedSelection) {
            socket.emit('error', { code: 'INVALID_SELECTION', message: 'Entwine requires the normal number of modes or all modes' });
            return false;
          }
        } else if ((Number.isFinite(minModes) ? normalized.length : 0) < (Number.isFinite(minModes) ? minModes : 0) ||
            (Number.isFinite(maxModes) ? normalized.length : 0) > (Number.isFinite(maxModes) ? maxModes : Infinity)) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid number of modes selected' });
          return false;
        }

        if (!allowDuplicates) {
          const unique = Array.from(new Set(normalized));
          if (unique.length !== normalized.length) {
            socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate mode selected' });
            return false;
          }
        }

        // If the step defines explicit modes, enforce membership.
        if (modeIds.length > 0 && normalized.some((id) => !modeIdSet.has(String(id)))) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected mode is not valid' });
          return false;
        }
      }
    }
  }

  // Validate TRIGGER_ORDER selections before completing the step.
  // If we complete first, invalid input would permanently consume the step and skip ordering.
  if (step.type === ResolutionStepType.TRIGGER_ORDER) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const rawSel: any = response.selections as any;
      if (!Array.isArray(rawSel) || !rawSel.every((s: any) => typeof s === 'string' && s.trim().length > 0)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid trigger order format' });
        return false;
      }

      const orderedIds = rawSel.map((s: string) => String(s));
      const unique = Array.from(new Set(orderedIds));
      if (unique.length !== orderedIds.length) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate trigger selected' });
        return false;
      }

      const triggers = Array.isArray(stepAny?.triggers) ? stepAny.triggers : [];
      const requireAll = stepAny?.requireAll !== false;
      const validIds = new Set(triggers.map((t: any) => String(t?.id)).filter(Boolean));

      if (validIds.size === 0) {
        socket.emit('error', { code: 'INVALID_STEP', message: 'Trigger order step has no triggers' });
        return false;
      }

      if (orderedIds.some((id: string) => !validIds.has(String(id)))) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'One or more triggers are not valid' });
        return false;
      }

      if (requireAll && orderedIds.length !== triggers.length) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Must order all triggers' });
        return false;
      }
    }
  }

  // Validate OPENING_HAND_ACTIONS selections before completing the step.
  // If we complete first, invalid input would permanently consume the step and skip opening-hand actions.
  if (step.type === ResolutionStepType.OPENING_HAND_ACTIONS) {
    if (!cancelled) {
      const rawSel: any = response.selections as any;
      if (rawSel == null) {
        // Treat missing selections as skip.
      } else if (!Array.isArray(rawSel) || !rawSel.every((s: any) => typeof s === 'string')) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid opening hand selection format' });
        return false;
      } else {
        const selectedIds = rawSel.map((x: any) => String(x)).filter((x: string) => x.length > 0);
        const unique = Array.from(new Set(selectedIds));
        if (unique.length !== selectedIds.length) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate card selected' });
          return false;
        }

        if (selectedIds.length > 0) {
          const zones = (game.state as any)?.zones?.[pid as any];
          const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
          const byId = new Map(hand.map((c: any) => [String(c?.id), c]));

          for (const id of selectedIds) {
            const card = byId.get(String(id));
            if (!card) {
              socket.emit('error', { code: 'CARD_NOT_IN_HAND', message: 'Selected card not found in hand' });
              return false;
            }
            if (!isOpeningHandBattlefieldCard(card, pid as any, game.state)) {
              socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected card cannot be put onto the battlefield from opening hand' });
              return false;
            }
          }
        }
      }
    }
  }

  return true;
}
