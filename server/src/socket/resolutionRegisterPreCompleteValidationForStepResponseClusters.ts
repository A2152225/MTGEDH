/**
 * socket/resolutionRegisterPreCompleteValidationForStepResponseClusters.ts
 *
 * Pre-complete selection validation for handleStepResponse clusters extracted into
 * socket/resolution-handlers/ (EXPLORE_DECISION, BATCH_EXPLORE_DECISION, FIGHT_TARGET,
 * TAP_UNTAP_TARGET, COUNTER_MOVEMENT, COUNTER_TARGET, STATION_CREATURE_SELECTION).
 *
 * Sibling of resolutionRegisterPreCompleteValidationForExtractedSteps.ts, which is
 * at its 40KB ceiling; new step types land here instead of growing that file.
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 */

import type { Socket } from "socket.io";
import { canPermanentBeTargetedByPlayer } from "../rules-engine/targeting";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { getEffectivePower, getEffectiveToughness } from "./util.js";

export type StepResponseClusterPreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for FIGHT_TARGET / TAP_UNTAP_TARGET battlefield lookups. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
};

/**
 * Validate selections for handleStepResponse step types moved to resolution-handlers/.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateStepResponseClusterStepsBeforeComplete(
  args: StepResponseClusterPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled, game, pid } = args;

  // Validate EXPLORE_DECISION selections before completing the step.
  // Otherwise a malformed or malicious payload could consume the step and/or apply explore to the wrong permanent.
  if (step.type === ResolutionStepType.EXPLORE_DECISION) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const expectedPermanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
      if (!expectedPermanentId) {
        socket.emit('error', { code: 'INVALID_STEP', message: 'Explore step missing permanent id' });
        return false;
      }

      const raw: any = response.selections as any;
      if (raw != null) {
        if (typeof raw !== 'object' || Array.isArray(raw)) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid explore selection format' });
          return false;
        }

        const providedPermanentId = String((raw as any).permanentId || '').trim();
        if (providedPermanentId && providedPermanentId !== expectedPermanentId) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid explore permanent selection' });
          return false;
        }

        if ('toGraveyard' in raw && typeof (raw as any).toGraveyard !== 'boolean') {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid explore decision' });
          return false;
        }
      }
    }
  }

  // Validate BATCH_EXPLORE_DECISION selections before completing the step.
  // The handler assumes a decisions array; missing/invalid decisions would consume the step and skip explores.
  if (step.type === ResolutionStepType.BATCH_EXPLORE_DECISION) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const explores: any[] = Array.isArray(stepAny?.explores) ? stepAny.explores : [];
      const expectedIds = explores.map((e: any) => String(e?.permanentId || '')).filter((x: string) => x.trim().length > 0);
      if (expectedIds.length === 0 || expectedIds.length !== explores.length) {
        socket.emit('error', { code: 'INVALID_STEP', message: 'Batch explore step missing explores' });
        return false;
      }

      const raw: any = response.selections as any;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid batch explore selection format' });
        return false;
      }

      const rawDecisions: any[] | null = Array.isArray((raw as any).decisions) ? (raw as any).decisions : null;
      if (!rawDecisions) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Missing batch explore decisions' });
        return false;
      }

      if (rawDecisions.length !== expectedIds.length) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid number of batch explore decisions' });
        return false;
      }

      const normalizeDecision = (d: any): { permanentId: string; toGraveyard?: boolean } | null => {
        if (typeof d === 'string') return { permanentId: String(d).trim(), toGraveyard: false };
        if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
        const pid = String((d as any).permanentId || (d as any).id || '').trim();
        if (!pid) return null;
        if ('toGraveyard' in d && typeof (d as any).toGraveyard !== 'boolean') return null;
        return { permanentId: pid, toGraveyard: (d as any).toGraveyard };
      };

      const decisions = rawDecisions.map(normalizeDecision);
      if (decisions.some((d) => !d)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid batch explore decisions' });
        return false;
      }

      const selectedIds = (decisions as any[]).map((d: any) => String(d.permanentId));
      const unique = Array.from(new Set(selectedIds));
      if (unique.length !== selectedIds.length) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate permanent in batch explore decisions' });
        return false;
      }

      const expectedSet = new Set(expectedIds);
      if (selectedIds.some((id: string) => !expectedSet.has(String(id)))) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'One or more batch explore permanents are not valid' });
        return false;
      }
    }
  }

  // Validate FIGHT_TARGET selections before completing the step.
  // The handler emits errors and returns; if we completed first, invalid targets would consume the step.
  if (step.type === ResolutionStepType.FIGHT_TARGET) {
    const stepAny = step as any;
    const selection: any = response.selections as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const sourceId = String(step.sourceId || stepAny.sourceId || '').trim();
      const targetCreatureId = Array.isArray(selection)
        ? String(selection[0] || '')
        : (typeof selection === 'string'
            ? selection
            : String(selection?.targetCreatureId || ''));

      if (!sourceId) {
        socket.emit('error', { code: 'SOURCE_NOT_FOUND', message: 'Fight source not found' });
        return false;
      }

      if (!targetCreatureId || !String(targetCreatureId).trim()) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Must choose a target creature to fight' });
        return false;
      }

      const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
      const sourceCreature = battlefield.find((p: any) => p?.id === sourceId);
      const targetCreature = battlefield.find((p: any) => p?.id === targetCreatureId);

      if (!sourceCreature) {
        socket.emit('error', { code: 'SOURCE_NOT_FOUND', message: 'Source creature not found on battlefield' });
        return false;
      }
      if (!targetCreature) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target creature not found on battlefield' });
        return false;
      }

      const sourceTypeLine = String(sourceCreature.card?.type_line || '').toLowerCase();
      const targetTypeLine = String(targetCreature.card?.type_line || '').toLowerCase();
      if (!sourceTypeLine.includes('creature')) {
        socket.emit('error', { code: 'INVALID_SOURCE', message: 'Fight source must be a creature' });
        return false;
      }
      if (!targetTypeLine.includes('creature')) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be a creature' });
        return false;
      }

      const targetFilter = stepAny.targetFilter || {};
      const controllerFilter: 'you' | 'opponent' | 'any' = targetFilter.controller || 'any';
      const excludeSource = targetFilter.excludeSource !== false;
      if (excludeSource && String(targetCreatureId) === String(sourceId)) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be a different creature' });
        return false;
      }
      if (controllerFilter === 'you' && String(targetCreature.controller) !== String(pid)) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be a creature you control' });
        return false;
      }
      if (controllerFilter === 'opponent' && String(targetCreature.controller) === String(pid)) {
        socket.emit('error', { code: 'INVALID_TARGET', message: "Target must be a creature you don't control" });
        return false;
      }

      if (!canPermanentBeTargetedByPlayer(targetCreature as any, game.state as any, pid as any)) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target cannot be legally targeted' });
        return false;
      }
    }
  }

  // Validate TAP_UNTAP_TARGET selections before completing the step.
  // The handler may return early on invalid selections; if we completed first we'd consume the step.
  if (step.type === ResolutionStepType.TAP_UNTAP_TARGET) {
    const stepAny = step as any;
    const selectionPayload: unknown = response.selections;
    const selectionObj =
      selectionPayload && typeof selectionPayload === 'object' && !Array.isArray(selectionPayload)
        ? (selectionPayload as { targetIds?: unknown; action?: unknown })
        : undefined;

    const isTapOtherAsActivationCost = stepAny?.tapOtherAbilityAsCost === true;

    if (cancelled) {
      // Activation-cost tap flow uses cancel to abort; allow even if marked mandatory.
      if (step.mandatory && !isTapOtherAsActivationCost) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const targetIds: string[] = Array.isArray(selectionPayload)
        ? selectionPayload.map((x: any) => String(x))
        : (Array.isArray(selectionObj?.targetIds)
            ? selectionObj.targetIds.map((x: any) => String(x))
            : []);

      const stepAction = String(stepAny.action || 'tap');
      const requestedAction = String(selectionObj?.action || '');
      const action: 'tap' | 'untap' =
        stepAction === 'both'
          ? (requestedAction === 'untap' ? 'untap' : requestedAction === 'tap' ? 'tap' : 'tap')
          : (stepAction === 'untap' ? 'untap' : 'tap');

      if (stepAction === 'both' && requestedAction && requestedAction !== 'tap' && requestedAction !== 'untap') {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid tap/untap action' });
        return false;
      }

      if (isTapOtherAsActivationCost && action !== 'tap') {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Activation cost requires tapping targets' });
        return false;
      }

      const targetCount = Math.max(1, Number(stepAny.targetCount || 1));
      if (targetIds.length !== targetCount) {
        socket.emit('error', { code: 'INVALID_TARGET_COUNT', message: `Expected ${targetCount} target(s), got ${targetIds.length}` });
        return false;
      }

      const unique = new Set(targetIds);
      if (unique.size !== targetIds.length) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate target selected' });
        return false;
      }

      const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
      const targetFilter = stepAny.targetFilter || {};
      const controllerFilter: 'you' | 'opponent' | 'any' = targetFilter.controller || 'any';
      const tapStatus: 'tapped' | 'untapped' | 'any' = targetFilter.tapStatus || 'any';
      const excludeSource = targetFilter.excludeSource === true;
      const sourceId = String(step.sourceId || stepAny.sourceId || '');
      const requireAllTypes = targetFilter.requireAllTypes === true;
      const minPower = targetFilter.minPower !== undefined ? Number(targetFilter.minPower) : undefined;
      const maxPower = targetFilter.maxPower !== undefined ? Number(targetFilter.maxPower) : undefined;
      const minToughness = targetFilter.minToughness !== undefined ? Number(targetFilter.minToughness) : undefined;
      const maxToughness = targetFilter.maxToughness !== undefined ? Number(targetFilter.maxToughness) : undefined;

      for (const tid of targetIds) {
        const perm = battlefield.find((p: any) => p?.id === tid);
        if (!perm) {
          socket.emit('error', { code: 'INVALID_TARGET', message: 'Target not found on battlefield' });
          return false;
        }

        if (excludeSource && String(tid) === String(sourceId)) {
          socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be different from source' });
          return false;
        }

        if (controllerFilter === 'you' && String(perm.controller) !== String(pid)) {
          socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be a permanent you control' });
          return false;
        }
        if (controllerFilter === 'opponent' && String(perm.controller) === String(pid)) {
          socket.emit('error', { code: 'INVALID_TARGET', message: "Target must be a permanent you don't control" });
          return false;
        }

        if (tapStatus === 'tapped' && !perm.tapped) {
          socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be tapped' });
          return false;
        }
        if (tapStatus === 'untapped' && perm.tapped) {
          socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be untapped' });
          return false;
        }

        const types = Array.isArray(targetFilter.types) ? targetFilter.types : [];
        if (types.length > 0) {
          const typeLine = String(perm.card?.type_line || '').toLowerCase();
          if (requireAllTypes) {
            const matchesAll = types.every((t: any) => typeLine.includes(String(t).toLowerCase()));
            if (!matchesAll) {
              socket.emit('error', { code: 'INVALID_TARGET', message: 'Target does not match required type' });
              return false;
            }
          } else {
            const matchesAny = types.some((t: any) => typeLine.includes(String(t).toLowerCase()));
            if (!matchesAny) {
              socket.emit('error', { code: 'INVALID_TARGET', message: 'Target does not match required type' });
              return false;
            }
          }
        }

        const subtypes = Array.isArray(targetFilter.subtypes) ? targetFilter.subtypes : [];
        if (subtypes.length > 0) {
          const typeLine = String(perm.card?.type_line || '').toLowerCase();
          const matchesAllSub = subtypes.every((sub: any) => typeLine.includes(String(sub).toLowerCase()));
          if (!matchesAllSub) {
            socket.emit('error', { code: 'INVALID_TARGET', message: 'Target does not match required subtype' });
            return false;
          }
        }

        if (minPower !== undefined || maxPower !== undefined) {
          const pwr = getEffectivePower(perm);
          if ((minPower !== undefined && pwr < minPower) || (maxPower !== undefined && pwr > maxPower)) {
            socket.emit('error', { code: 'INVALID_TARGET', message: 'Target does not match required power' });
            return false;
          }
        }
        if (minToughness !== undefined || maxToughness !== undefined) {
          const tgh = getEffectiveToughness(perm);
          if ((minToughness !== undefined && tgh < minToughness) || (maxToughness !== undefined && tgh > maxToughness)) {
            socket.emit('error', { code: 'INVALID_TARGET', message: 'Target does not match required toughness' });
            return false;
          }
        }
      }
    }
  }

  // Validate COUNTER_MOVEMENT selections before completing the step.
  // The handler emits errors and returns; invalid input must not consume the step.
  if (step.type === ResolutionStepType.COUNTER_MOVEMENT) {
    const stepAny = step as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const selectionPayload: unknown = response.selections;
      if (!selectionPayload || typeof selectionPayload !== 'object' || Array.isArray(selectionPayload)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid counter movement selection' });
        return false;
      }
      const payload = selectionPayload as {
        sourcePermanentId?: unknown;
        sourceId?: unknown;
        targetPermanentId?: unknown;
        targetId?: unknown;
        counterType?: unknown;
      };

      const sourcePermanentId = String(payload?.sourcePermanentId || payload?.sourceId || '').trim();
      const targetPermanentId = String(payload?.targetPermanentId || payload?.targetId || '').trim();
      const counterType = String(payload?.counterType || '').trim();

      if (!sourcePermanentId || !targetPermanentId || !counterType) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid counter movement selection' });
        return false;
      }
      if (sourcePermanentId === targetPermanentId) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be a different permanent' });
        return false;
      }

      const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
      const sourcePerm = battlefield.find((p: any) => p?.id === sourcePermanentId);
      const targetPerm = battlefield.find((p: any) => p?.id === targetPermanentId);
      if (!sourcePerm) {
        socket.emit('error', { code: 'SOURCE_NOT_FOUND', message: 'Source permanent not found on battlefield' });
        return false;
      }
      if (!targetPerm) {
        socket.emit('error', { code: 'TARGET_NOT_FOUND', message: 'Target permanent not found on battlefield' });
        return false;
      }

      const sourceFilter = stepAny.sourceFilter || {};
      const targetFilter = stepAny.targetFilter || {};
      if (sourceFilter.controller === 'you' && String(sourcePerm.controller) !== String(pid)) {
        socket.emit('error', { code: 'INVALID_SOURCE', message: 'Source must be a permanent you control' });
        return false;
      }
      if (targetFilter.controller === 'you' && String(targetPerm.controller) !== String(pid)) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be a permanent you control' });
        return false;
      }
      if (targetFilter.excludeSource && sourcePermanentId === targetPermanentId) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be different from source' });
        return false;
      }

      const sourceCounters = (sourcePerm as any).counters || {};
      const current = Number(sourceCounters[counterType] || 0);
      if (current <= 0) {
        socket.emit('error', { code: 'NO_COUNTER', message: `Source permanent has no ${counterType} counters` });
        return false;
      }
    }
  }

  // Validate COUNTER_TARGET selections before completing the step.
  if (step.type === ResolutionStepType.COUNTER_TARGET) {
    const stepAny = step as any;
    const selection: any = response.selections as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const targetId = Array.isArray(selection)
        ? String(selection[0] || '')
        : (typeof selection === 'string' ? selection : String(selection?.targetId || ''));

      if (!targetId || !String(targetId).trim()) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Must choose a target permanent' });
        return false;
      }

      const counterType = String(stepAny.counterType || '').toLowerCase();
      if (!counterType) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Missing counter type' });
        return false;
      }

      const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
      const targetPermanent = battlefield.find((p: any) => p?.id === targetId);
      if (!targetPermanent) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target permanent not found on battlefield' });
        return false;
      }

      const targetControllerRule: 'opponent' | 'any' | 'you' = stepAny.targetController || 'any';
      if (targetControllerRule === 'you' && String(targetPermanent.controller) !== String(pid)) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target must be a permanent you control' });
        return false;
      }
      if (targetControllerRule === 'opponent' && String(targetPermanent.controller) === String(pid)) {
        socket.emit('error', { code: 'INVALID_TARGET', message: "Target must be a permanent you don't control" });
        return false;
      }

      if (!canPermanentBeTargetedByPlayer(targetPermanent as any, game.state as any, pid as any)) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Target cannot be legally targeted' });
        return false;
      }
    }
  }

  // Validate STATION_CREATURE_SELECTION selections before completing the step.
  if (step.type === ResolutionStepType.STATION_CREATURE_SELECTION) {
    const stepAny = step as any;
    const selection: any = response.selections as any;

    if (cancelled) {
      if (step.mandatory) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }
    } else {
      const creatureId = Array.isArray(selection)
        ? String(selection[0] || '')
        : (typeof selection === 'string' ? selection : String(selection?.creatureId || ''));

      if (!creatureId || !String(creatureId).trim()) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Must choose a creature to tap' });
        return false;
      }

      const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
      const stationId = String(stepAny?.tapForCountersSource?.id || stepAny?.station?.id || step.sourceId || '').trim();
      const station = battlefield.find((p: any) => p?.id === stationId);
      if (!station) {
        socket.emit('error', { code: 'STATION_NOT_FOUND', message: 'Station permanent not found' });
        return false;
      }

      const creature = battlefield.find((p: any) => p?.id === creatureId);
      if (!creature) {
        socket.emit('error', { code: 'CREATURE_NOT_FOUND', message: 'Selected creature not found' });
        return false;
      }

      if (String(creature.id) === String(stationId)) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Must tap another creature (not the station itself)' });
        return false;
      }
      if (String(creature.controller) !== String(pid)) {
        socket.emit('error', { code: 'NOT_YOUR_CREATURE', message: "You don't control this creature" });
        return false;
      }
      if (Boolean((creature as any).tapped)) {
        socket.emit('error', { code: 'CREATURE_TAPPED', message: 'This creature is already tapped' });
        return false;
      }

      const creatureTypeLine = String((creature as any).card?.type_line || '').toLowerCase();
      if (!creatureTypeLine.includes('creature')) {
        socket.emit('error', { code: 'NOT_A_CREATURE', message: 'Selected permanent is not a creature' });
        return false;
      }
    }
  }

  return true;
}

/**
 * Validate MANA_COLOR_SELECTION before completing the step.
 * If we complete first, invalid input would permanently consume the step and desync mana generation.
 *
 * Kept as its own entry point because it runs earlier in registerResolutionHandlers than
 * validateStepResponseClusterStepsBeforeComplete; merging the two would reorder validation.
 *
 * May normalize `response.selections` (single color -> distribution map).
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateManaColorSelectionBeforeComplete(
  args: StepResponseClusterPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled, game, pid } = args;

  if (step.type !== ResolutionStepType.MANA_COLOR_SELECTION) return true;

  if (cancelled) {
    socket.emit("error", { code: "STEP_MANDATORY", message: "This step is mandatory and cannot be cancelled" });
    return false;
  }

  const stepAny = step as any;
  const selectionKind = String(stepAny.selectionKind || 'any_color');
  const rawSelections = response.selections as any;

  if (selectionKind === 'distribution') {
    // Allow a single color name/code as shorthand for "put the entire amount in that color"
    // (matches AnyColorManaModal click UX when amount > 1).
    if (typeof rawSelections === 'string') {
      const poolKeyToCode: Record<string, string> = {
        white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C',
      };
      const chosenKey = String(rawSelections);
      const chosenCode = poolKeyToCode[chosenKey]
        || (['W', 'U', 'B', 'R', 'G', 'C'].includes(chosenKey.toUpperCase()) ? chosenKey.toUpperCase() : '');
      const totalAmount = Number(stepAny.totalAmount ?? stepAny.amount ?? 0);
      const availableColors: string[] = Array.isArray(stepAny.availableColors)
        ? stepAny.availableColors
        : (Array.isArray(stepAny.allowedColors) ? stepAny.allowedColors : ['W', 'U', 'B', 'R', 'G']);
      if (!chosenCode || (availableColors.length > 0 && !availableColors.includes(chosenCode))) {
        socket.emit("error", { code: "INVALID_COLOR", message: `Invalid color selection (${chosenKey})` });
        return false;
      }
      // Normalize onto the response object so handleStepResponse sees a distribution map.
      (response as any).selections = { [chosenCode]: Math.max(0, totalAmount) };
    } else if (!rawSelections || typeof rawSelections !== 'object' || Array.isArray(rawSelections)) {
      socket.emit("error", { code: "INVALID_SELECTION", message: "Invalid distribution format" });
      return false;
    }

    const distributionSelections = (response as any).selections as Record<string, unknown>;
    const totalAmount = Number(stepAny.totalAmount ?? stepAny.amount ?? 0);
    const availableColors: string[] = Array.isArray(stepAny.availableColors)
      ? stepAny.availableColors
      : (Array.isArray(stepAny.allowedColors) ? stepAny.allowedColors : ['W', 'U', 'B', 'R', 'G']);

    let totalDistributed = 0;
    for (const [color, amountRaw] of Object.entries(distributionSelections)) {
      if (!availableColors.includes(String(color))) {
        socket.emit("error", { code: "INVALID_COLOR", message: `${String(color)} is not an available color for this ability` });
        return false;
      }
      const amount = Number(amountRaw || 0);
      if (!Number.isFinite(amount) || amount < 0) {
        socket.emit("error", { code: "INVALID_DISTRIBUTION", message: `Invalid amount for ${String(color)}` });
        return false;
      }
      totalDistributed += amount;
    }

    if (totalAmount > 0 && totalDistributed !== totalAmount) {
      socket.emit("error", {
        code: "INVALID_DISTRIBUTION",
        message: `Total mana distributed (${totalDistributed}) doesn't match required amount (${totalAmount})`,
      });
      return false;
    }
  } else {
    if (typeof rawSelections !== 'string') {
      socket.emit("error", { code: "INVALID_SELECTION", message: "Invalid color selection" });
      return false;
    }

    const poolKeyToCode: Record<string, string> = {
      white: 'W',
      blue: 'U',
      black: 'B',
      red: 'R',
      green: 'G',
      colorless: 'C',
    };

    const chosenKey = String(rawSelections);
    const chosenCode = poolKeyToCode[chosenKey];
    if (!chosenCode) {
      socket.emit("error", { code: "INVALID_COLOR", message: `Invalid color selection (${chosenKey})` });
      return false;
    }

    const allowedCodes: string[] | undefined = Array.isArray(stepAny.allowedColors) ? stepAny.allowedColors : undefined;
    if (allowedCodes && allowedCodes.length > 0 && !allowedCodes.includes(chosenCode)) {
      socket.emit("error", { code: "INVALID_COLOR", message: `That color isn't allowed for this ability` });
      return false;
    }
  }

  // If this step is carrying deferred activation-cost evidence (e.g., "Pay N life"),
  // validate affordability BEFORE we complete the step.
  // Otherwise, the handler can emit INSUFFICIENT_LIFE after the step was already consumed.
  const lifeToPayForCost = Number(stepAny.lifeToPayForCost || 0);
  const manaLifeLossAmount = Number(stepAny.manaLifeLossAmount || 0);
  const totalLifeRequired =
    (Number.isFinite(lifeToPayForCost) ? Math.max(0, lifeToPayForCost) : 0) +
    (Number.isFinite(manaLifeLossAmount) ? Math.max(0, manaLifeLossAmount) : 0);
  if (totalLifeRequired > 0) {
    try {
      const stateAny = game.state as any;
      stateAny.life = stateAny.life || {};
      const cur = Number(stateAny.life?.[pid as any] ?? 40);
      if (!Number.isFinite(cur) || cur < totalLifeRequired) {
        socket.emit('error', {
          code: 'INSUFFICIENT_LIFE',
          message: `Need to pay ${totalLifeRequired} life to complete this activation.`,
        });
        return false;
      }
    } catch {
      socket.emit('error', {
        code: 'INSUFFICIENT_LIFE',
        message: `Need to pay ${totalLifeRequired} life to complete this activation.`,
      });
      return false;
    }
  }

  return true;
}

/**
 * Pre-complete validation for the Phyrexian MANA_PAYMENT_CHOICE shape handled by
 * resolution-handlers/manaPaymentChoicePhyrexianHandlers.ts.
 *
 * Completing first would permanently consume the step on malformed input, and a failure inside
 * the handler would leave the activation stuck with the prompt gone.
 *
 * @returns false if the socket handler should abort; true to continue.
 */
export async function validatePhyrexianManaPaymentBeforeComplete(
  args: StepResponseClusterPreCompleteValidationArgs,
): Promise<boolean> {
  const { socket, step, response, cancelled, game, pid } = args;

  if (step.type !== ResolutionStepType.MANA_PAYMENT_CHOICE) return true;

  const stepAny = step as any;
  if (stepAny.phyrexianManaChoice !== true || cancelled) return true;

  const rawSelections = response.selections as any;
  if (!Array.isArray(rawSelections)) {
    socket.emit("error", { code: "INVALID_SELECTION", message: "Invalid Phyrexian payment selection" });
    return false;
  }

  const phyrexianCosts: any[] = Array.isArray(stepAny.phyrexianCosts) ? stepAny.phyrexianCosts : [];
  for (const choice of rawSelections) {
    const idx = Number(choice?.index);
    if (!Number.isFinite(idx) || idx < 0 || idx >= phyrexianCosts.length) {
      socket.emit("error", { code: "INVALID_SELECTION", message: "Invalid Phyrexian payment index" });
      return false;
    }
    if (choice?.payWithLife !== undefined && typeof choice.payWithLife !== 'boolean') {
      socket.emit("error", { code: "INVALID_SELECTION", message: "Invalid Phyrexian payment selection" });
      return false;
    }
  }

  // Also validate that the chosen payment method is currently payable.
  // Without this, we could consume the step and then fail inside the handler,
  // leaving the activation stuck with the step gone.
  try {
    const parsedCost = stepAny.parsedCost;
    if (!parsedCost) {
      socket.emit('error', { code: 'MISSING_COST', message: 'Missing cost data for Phyrexian payment' });
      return false;
    }

    let totalLifeToPay = 0;
    const manaToConsume = { colors: { ...(parsedCost.colors || {}) }, generic: Number(parsedCost.generic || 0) } as any;
    for (const choice of rawSelections) {
      const idx = Number(choice?.index);
      const payWithLife = Boolean(choice?.payWithLife);
      const options = phyrexianCosts[idx];
      if (!Array.isArray(options)) continue;

      if (payWithLife) {
        const lifeOption = options.find((o: any) => typeof o === 'string' && String(o).startsWith('LIFE:'));
        if (lifeOption) {
          totalLifeToPay += Number(String(lifeOption).split(':')[1] || 2);
        } else {
          totalLifeToPay += 2;
        }
      } else {
        const colorOption = options.find((o: any) => typeof o === 'string' && !String(o).startsWith('LIFE:') && !String(o).startsWith('GENERIC:'));
        if (typeof colorOption === 'string' && colorOption.length > 0) {
          manaToConsume.colors[colorOption] = Number(manaToConsume.colors[colorOption] || 0) + 1;
        }
      }
    }

    const playerLife = Number((game.state as any)?.life?.[pid as any] ?? 40);
    if (totalLifeToPay > 0 && (!Number.isFinite(playerLife) || playerLife <= totalLifeToPay)) {
      socket.emit('error', {
        code: 'INSUFFICIENT_LIFE',
        message: `Cannot pay ${totalLifeToPay} life (you have ${Number.isFinite(playerLife) ? playerLife : 0} life - payment would be lethal)`,
      });
      return false;
    }

    const { getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment } = await import('./util.js');
    const pool = getOrInitManaPool(game.state, pid as any) as any;
    const totalAvailable = calculateTotalAvailableMana(pool, undefined);
    const validationError = validateManaPayment(totalAvailable, manaToConsume.colors, manaToConsume.generic);
    if (validationError) {
      socket.emit('error', { code: 'INSUFFICIENT_MANA', message: validationError });
      return false;
    }
  } catch {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Unable to validate Phyrexian payment' });
    return false;
  }

  return true;
}
