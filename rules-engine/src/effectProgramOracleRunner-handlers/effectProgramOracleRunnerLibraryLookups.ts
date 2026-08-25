// Origin parent: rules-engine/src/effectProgramOracleRunner.ts
// Cluster moved: findFatesealTargetPlayerId, readFirstSelectionForBinding,
// normalizeSelectionIdList, getPlayerLibrary, resolveTopLibraryChoicePlayerId,
// normalizeTopLibraryPromptCard, quantityToStaticNumber.
// Public entry symbols: findFatesealTargetPlayerId, readFirstSelectionForBinding,
// normalizeSelectionIdList, getPlayerLibrary, resolveTopLibraryChoicePlayerId,
// normalizeTopLibraryPromptCard, quantityToStaticNumber.
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import { ChoiceEventType, type ChoiceResponse } from '../choiceEventsTypes';
import type { EffectProgramCommandStep, EffectProgramRuntime } from '../effectProgram';
import type { OracleEffectStep } from '../oracleIR';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import { resolvePlayers } from '../oracleIRExecutorPlayerUtils';
import {
  normalizeChoiceResponseSelection,
  normalizeChoiceResponseSelections,
} from './effectProgramOracleRunnerChoiceNormalize';

export function findFatesealTargetPlayerId(
  runtime: EffectProgramRuntime<GameState>,
  commandStep: EffectProgramCommandStep
): string | undefined {
  const fatesealBindingKey = commandStep.guard?.bindingKey;
  const fatesealChoiceStep = runtime.program.steps.find(step => (
    step.kind === 'choice' &&
    step.bindingKey === fatesealBindingKey &&
    String(step.choiceEvent?.type || step.choiceRequest?.type || '') === ChoiceEventType.FATESEAL
  ));
  const targetBindingKey = fatesealChoiceStep?.kind === 'choice'
    ? String((fatesealChoiceStep.choiceRequest?.payload as any)?.targetBindingKey || '')
    : '';
  return readFirstSelectionForBinding(runtime, targetBindingKey);
}

export function readFirstSelectionForBinding(
  runtime: EffectProgramRuntime<GameState>,
  bindingKey: string
): string | undefined {
  if (!bindingKey) {
    return undefined;
  }

  const response = runtime.bindings[bindingKey] as ChoiceResponse | undefined;
  if (!response || response.cancelled) {
    return undefined;
  }

  return normalizeChoiceResponseSelections(response)[0];
}

export function normalizeSelectionIdList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(selection => normalizeChoiceResponseSelection(selection)).filter(Boolean);
}

export function getPlayerLibrary(state: GameState, playerId: string): readonly any[] {
  const player = (state.players || []).find(candidate => String(candidate?.id || '') === playerId) as any;
  return Array.isArray(player?.library) ? player.library : [];
}

export function resolveTopLibraryChoicePlayerId(
  state: GameState,
  oracleStep: OracleEffectStep | undefined,
  ctx: OracleIRExecutionContext,
  controllerId: string
): string | undefined {
  if (!oracleStep) {
    return controllerId;
  }

  const who = (oracleStep as any)?.who;
  if (!who) {
    return controllerId;
  }

  const players = resolvePlayers(state, who, ctx);
  if (players.length === 1) {
    return String(players[0]);
  }

  return players.length === 0 ? controllerId : undefined;
}

export function normalizeTopLibraryPromptCard(card: any): Record<string, unknown> {
  return {
    id: String(card?.id || ''),
    name: String(card?.name || card?.card?.name || card?.id || 'Unknown Card'),
    type_line: card?.type_line || card?.card?.type_line,
    oracle_text: card?.oracle_text || card?.card?.oracle_text,
    imageUrl: card?.imageUrl || card?.image_uris?.normal || card?.card?.imageUrl || card?.card?.image_uris?.normal,
    mana_cost: card?.mana_cost || card?.card?.mana_cost,
    cmc: card?.cmc ?? card?.card?.cmc,
  };
}

export function quantityToStaticNumber(quantity: unknown): number | undefined {
  if ((quantity as any)?.kind === 'number' && Number.isFinite(Number((quantity as any).value))) {
    return Number((quantity as any).value);
  }

  return undefined;
}
