// Origin parent: rules-engine/src/effectProgramOracleRunner.ts
// Cluster moved: hasNonEmptyChoiceOptions, inferOracleIRTargetTypes,
// buildOracleIRTargetSelectionOptions, buildOracleIRPlayerChoiceOptions,
// shouldOracleIRPlayerChoiceAllowSelf.
// Public entry symbols: hasNonEmptyChoiceOptions, inferOracleIRTargetTypes,
// buildOracleIRTargetSelectionOptions, buildOracleIRPlayerChoiceOptions,
// shouldOracleIRPlayerChoiceAllowSelf.
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import { ChoiceEventType, type ChoiceOption, type ChoiceResponse } from '../choiceEventsTypes';
import type { EffectProgramRuntime } from '../effectProgram';
import { listEligibleChooseOpponentIds } from '../oracleIRExecutorPlayerUtils';
import { normalizeChoiceResponseSelections } from './effectProgramOracleRunnerChoiceNormalize';

export function hasNonEmptyChoiceOptions(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function inferOracleIRTargetTypes(oracleStep: unknown): readonly string[] {
  const kind = String((oracleStep as any)?.kind || '');
  if (kind === 'choose_target_creature') {
    return ['creature'];
  }

  return ['object'];
}

export function buildOracleIRTargetSelectionOptions(
  state: GameState,
  controllerId: string,
  oracleStep: unknown,
  programSourceId?: string
): readonly ChoiceOption[] {
  const kind = String((oracleStep as any)?.kind || '');
  if (kind !== 'choose_target_creature') {
    return [];
  }

  const rawTargetText = String(
    (oracleStep as any)?.target?.text ||
    (oracleStep as any)?.target?.raw ||
    (oracleStep as any)?.raw ||
    ''
  ).toLowerCase();
  const requiresYouControl = /\byou control\b/.test(rawTargetText);
  const requiresOpponentControl = /\bopponents? controls?\b|\ban opponent controls\b/.test(rawTargetText);
  const requiresNotYouControl = /\byou (?:do not|don['’]t) control\b/.test(rawTargetText);
  const sourceId = String((oracleStep as any)?.sourceId || programSourceId || '').trim();

  return (((state as any).battlefield || []) as any[])
    .filter(permanent => {
      const permanentId = String(permanent?.id || '').trim();
      if (!permanentId || (sourceId && permanentId === sourceId && /\banother\b/.test(rawTargetText))) {
        return false;
      }

      const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) {
        return false;
      }

      const permanentController = String(permanent?.controller || '').trim();
      if (requiresYouControl && permanentController !== controllerId) {
        return false;
      }

      if ((requiresOpponentControl || requiresNotYouControl) && permanentController === controllerId) {
        return false;
      }

      return true;
    })
    .map(permanent => {
      const id = String(permanent?.id || '').trim();
      const name = String(permanent?.card?.name || permanent?.name || id);
      return {
        id,
        label: name,
        description: String(permanent?.card?.type_line || permanent?.type_line || 'Creature'),
      };
    });
}

export function buildOracleIRPlayerChoiceOptions(
  state: GameState,
  controllerId: string,
  oracleStep: unknown,
  options?: {
    readonly runtime?: EffectProgramRuntime<GameState>;
    readonly distinctPlayerTargets?: boolean;
  },
): readonly { id: string; name: string }[] {
  const kind = String((oracleStep as any)?.kind || '');
  const allowSelf = shouldOracleIRPlayerChoiceAllowSelf(oracleStep);
  const eligibleOpponentIds = kind === 'choose_opponent'
    ? new Set(listEligibleChooseOpponentIds(state, controllerId, String((oracleStep as any)?.raw || '')))
    : null;
  const excludedPlayerIds = new Set<string>();
  if (options?.distinctPlayerTargets && options.runtime) {
    for (const step of options.runtime.program.steps) {
      if (step.kind !== 'choice') continue;
      if (String(step.choiceRequest?.type || '') !== ChoiceEventType.PLAYER_CHOICE) continue;
      if (!Boolean((step.choiceRequest?.payload as any)?.distinctPlayerTargets)) continue;
      const response = options.runtime.bindings[step.bindingKey] as ChoiceResponse | undefined;
      if (!response || response.cancelled) continue;
      for (const selection of normalizeChoiceResponseSelections(response)) {
        const playerId = String(selection || '').trim();
        if (playerId) excludedPlayerIds.add(playerId);
      }
    }
  }
  return (state.players || [])
    .filter(player => {
      const playerId = String(player?.id || '').trim();
      if (!playerId) {
        return false;
      }

      if (excludedPlayerIds.has(playerId)) {
        return false;
      }

      if ((kind === 'choose_opponent' || !allowSelf) && playerId === controllerId) {
        return false;
      }

      if (eligibleOpponentIds && !eligibleOpponentIds.has(playerId as any)) {
        return false;
      }

      return true;
    })
    .map(player => ({
      id: String(player.id),
      name: String((player as any).name || player.id),
    }));
}

export function shouldOracleIRPlayerChoiceAllowSelf(oracleStep: unknown): boolean {
  const kind = String((oracleStep as any)?.kind || '');
  if (kind === 'choose_opponent') {
    return false;
  }
  if (kind === 'target_player') {
    return true;
  }

  const targetKind = String((oracleStep as any)?.target?.kind || '');
  if (targetKind === 'target_opponent' || targetKind === 'each_opponent') {
    return false;
  }

  const raw = String((oracleStep as any)?.raw || '').toLowerCase();
  return !/\bopponent\b/.test(raw);
}
