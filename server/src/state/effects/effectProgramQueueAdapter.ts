import type {
  EffectProgramChoicePause,
  EffectProgramClauseRef,
} from '../../../../rules-engine/src/effectProgram.js';
import type { ChoiceResponse } from '../../../../rules-engine/src/choiceEvents.js';
import { appendEvent } from '../../db/index.js';
import {
  ResolutionQueueManager,
  type CreateResolutionStepConfig,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from '../resolution/index.js';

export interface EffectProgramQueueMetadata {
  readonly effectProgramId: string;
  readonly effectProgramFamily?: string;
  readonly effectProgramSourceId?: string;
  readonly effectProgramSourceName?: string;
  readonly effectProgramCursor: number;
  readonly effectProgramStepId: string;
  readonly effectProgramBindingKey: string;
  readonly effectProgramClause?: EffectProgramClauseRef;
}

export type EffectProgramQueueExtraConfig = Partial<CreateResolutionStepConfig> & Record<string, unknown>;

export interface EffectProgramPromptSnapshot {
  readonly playerId?: string;
  readonly sourceId?: string;
  readonly queuedResolutionStep: ResolutionStep;
  readonly effectProgram: EffectProgramQueueMetadata;
}

export interface AppendEffectProgramPromptEventOptions {
  readonly additionalPayload?: Record<string, unknown>;
  readonly appendEventFn?: (gameId: string, seq: number, type: string, payload: unknown) => unknown;
}

const EFFECT_PROGRAM_PROMPT_METADATA_FIELDS = new Set([
  'effectProgramPrompt',
  'effectProgramId',
  'effectProgramFamily',
  'effectProgramSourceId',
  'effectProgramSourceName',
  'effectProgramCursor',
  'effectProgramStepId',
  'effectProgramBindingKey',
  'effectProgramClause',
]);

export function queueEffectProgramChoice(
  gameId: string,
  pause: EffectProgramChoicePause<any>,
  extraConfig: EffectProgramQueueExtraConfig = {}
): ResolutionStep {
  const metadata = getEffectProgramQueueMetadata(pause);

  return ResolutionQueueManager.addStepFromChoiceEvent(gameId, pause.choiceEvent, {
    ...extraConfig,
    ...metadata,
    effectProgramPrompt: true,
  });
}

export function getEffectProgramQueueMetadata(
  pause: EffectProgramChoicePause<any>
): EffectProgramQueueMetadata {
  return {
    effectProgramId: pause.runtime.program.id,
    effectProgramFamily: typeof pause.runtime.program.metadata?.family === 'string'
      ? pause.runtime.program.metadata.family
      : undefined,
    effectProgramSourceId: pause.runtime.program.sourceId,
    effectProgramSourceName: pause.runtime.program.sourceName,
    effectProgramCursor: pause.runtime.cursor,
    effectProgramStepId: pause.step.id,
    effectProgramBindingKey: pause.step.bindingKey,
    effectProgramClause: pause.step.clause,
  };
}

export function readEffectProgramQueueMetadata(step: ResolutionStep): EffectProgramQueueMetadata | undefined {
  const data = step as any;
  if (data.effectProgramPrompt !== true || !data.effectProgramId || !data.effectProgramStepId) {
    return undefined;
  }

  return {
    effectProgramId: String(data.effectProgramId),
    effectProgramFamily: data.effectProgramFamily ? String(data.effectProgramFamily) : undefined,
    effectProgramSourceId: data.effectProgramSourceId ? String(data.effectProgramSourceId) : undefined,
    effectProgramSourceName: data.effectProgramSourceName ? String(data.effectProgramSourceName) : undefined,
    effectProgramCursor: Number(data.effectProgramCursor || 0),
    effectProgramStepId: String(data.effectProgramStepId),
    effectProgramBindingKey: String(data.effectProgramBindingKey || ''),
    effectProgramClause: data.effectProgramClause,
  };
}

export function buildEffectProgramPromptSnapshot(step: ResolutionStep): EffectProgramPromptSnapshot | undefined {
  const metadata = readEffectProgramQueueMetadata(step);
  if (!metadata) {
    return undefined;
  }

  return {
    ...(step.playerId ? { playerId: String(step.playerId) } : {}),
    ...(step.sourceId ? { sourceId: String(step.sourceId) } : {}),
    queuedResolutionStep: stripEffectProgramPromptMetadata(step),
    effectProgram: metadata,
  };
}

export function appendEffectProgramPromptEvent(
  game: any,
  gameId: string,
  step: ResolutionStep,
  options: AppendEffectProgramPromptEventOptions = {}
): boolean {
  if (!gameId || (game as any)?.isReplaying) {
    return false;
  }

  const snapshot = buildEffectProgramPromptSnapshot(step);
  if (!snapshot) {
    return false;
  }

  const append = options.appendEventFn || appendEvent;
  const seq = Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0);

  try {
    append(gameId, seq, 'resolveTopOfStackPrompt', {
      ...snapshot,
      ...(options.additionalPayload || {}),
    });
    return true;
  } catch {
    return false;
  }
}

export function createEffectProgramChoiceResponse(
  step: ResolutionStep,
  response: ResolutionStepResponse
): ChoiceResponse {
  const metadata = readEffectProgramQueueMetadata(step);

  return {
    eventId: step.choiceEvent?.id ?? metadata?.effectProgramStepId ?? step.id,
    playerId: response.playerId,
    selections: normalizeEffectProgramSelections(step, response.selections),
    cancelled: response.cancelled,
    timestamp: response.timestamp,
  };
}

function normalizeEffectProgramSelections(
  step: ResolutionStep,
  selections: ResolutionStepResponse['selections']
): ChoiceResponse['selections'] {
  if (typeof selections === 'number' || typeof selections === 'boolean') {
    return selections;
  }

  if (Array.isArray(selections)) {
    return selections.map(selection => normalizeEffectProgramSelectionValue(selection)).filter(Boolean);
  }

  if (typeof selections === 'string') {
    return [selections];
  }

  if (selections && typeof selections === 'object') {
    const record = selections as Record<string, any>;
    const topLibrarySelections = normalizeTopLibraryEffectProgramSelections(step, record);
    if (topLibrarySelections) {
      return topLibrarySelections;
    }

    for (const key of ['selections', 'selectedIds', 'selectedCardIds', 'selectedTargetIds', 'targets']) {
      if (Array.isArray(record[key])) {
        return record[key].map((selection: any) => String(selection));
      }
    }

    for (const key of ['selection', 'selectedId', 'selectedCardId', 'selectedTargetId', 'target']) {
      if (record[key] !== undefined && record[key] !== null) {
        return [String(record[key])];
      }
    }
  }

  return [];
}

function normalizeTopLibraryEffectProgramSelections(
  step: ResolutionStep,
  selections: Record<string, any>
): Readonly<Record<string, unknown>> | undefined {
  const stepType = String((step as any).type || '');
  if (stepType === ResolutionStepType.SCRY) {
    return {
      keepTopOrder: normalizeEffectProgramSelectionArray(selections.keepTopOrder),
      bottomOrder: normalizeEffectProgramSelectionArray(selections.bottomOrder),
    };
  }

  if (stepType === ResolutionStepType.SURVEIL) {
    return {
      keepTopOrder: normalizeEffectProgramSelectionArray(selections.keepTopOrder),
      toGraveyard: normalizeEffectProgramSelectionArray(selections.toGraveyard),
    };
  }

  if (stepType === ResolutionStepType.FATESEAL) {
    return {
      keepTopOrder: normalizeEffectProgramSelectionArray(selections.keepTopOrder),
      bottomOrder: normalizeEffectProgramSelectionArray(selections.bottomOrder),
    };
  }

  return undefined;
}

function normalizeEffectProgramSelectionArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(selection => normalizeEffectProgramSelectionValue(selection)).filter(Boolean);
}

function normalizeEffectProgramSelectionValue(selection: unknown): string {
  if (selection === undefined || selection === null) {
    return '';
  }

  if (typeof selection === 'string' || typeof selection === 'number' || typeof selection === 'boolean') {
    return String(selection);
  }

  if (typeof selection === 'object') {
    const record = selection as Record<string, unknown>;
    for (const key of ['id', 'value', 'selection', 'selectedId', 'selectedCardId', 'selectedTargetId', 'target']) {
      if (record[key] !== undefined && record[key] !== null) {
        return String(record[key]);
      }
    }
    return '';
  }

  return String(selection);
}

function stripEffectProgramPromptMetadata(step: ResolutionStep): ResolutionStep {
  const stripped: Record<string, unknown> = { ...(step as any) };
  for (const field of EFFECT_PROGRAM_PROMPT_METADATA_FIELDS) {
    delete stripped[field];
  }
  return stripped as unknown as ResolutionStep;
}
