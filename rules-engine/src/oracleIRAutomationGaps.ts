import type {
  GameState,
  OracleAutomationGap,
  OracleAutomationGapClassification,
} from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

const MAX_ORACLE_AUTOMATION_GAPS = 250;

export interface CreateOracleAutomationGapParams {
  readonly state: GameState;
  readonly ctx: OracleIRExecutionContext;
  readonly step: OracleEffectStep;
  readonly reasonCode: string;
  readonly message: string;
  readonly sequence: number;
  readonly classification?: OracleAutomationGapClassification;
  readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
}

export function createOracleAutomationGapRecord(
  params: CreateOracleAutomationGapParams
): OracleAutomationGap {
  const timestamp = Date.now();
  const stateAny = params.state as any;

  return {
    id: `${params.state.id}:oracle-gap:${timestamp}:${params.sequence}`,
    timestamp,
    gameId: params.state.id,
    source: 'oracle_ir',
    classification: params.classification ?? 'unsupported',
    reasonCode: params.reasonCode,
    message: params.message,
    stepKind: params.step.kind,
    raw: String((params.step as any)?.raw || params.step.kind),
    controllerId: params.ctx.controllerId,
    sourceId: params.ctx.sourceId,
    sourceName: params.ctx.sourceName,
    turnNumber: Number.isFinite(Number(stateAny?.turnNumber)) ? Number(stateAny.turnNumber) : undefined,
    phase: stateAny?.phase ? String(stateAny.phase) : undefined,
    step: stateAny?.step ? String(stateAny.step) : undefined,
    metadata: params.metadata,
  };
}

export function appendOracleAutomationGapRecords(
  state: GameState,
  records: readonly OracleAutomationGap[]
): GameState {
  if (!Array.isArray(records) || records.length === 0) {
    return state;
  }

  const existing = Array.isArray((state as any).oracleAutomationGaps)
    ? ([...(state as any).oracleAutomationGaps] as OracleAutomationGap[])
    : [];

  if (existing.length === 0) {
    return {
      ...state,
      oracleAutomationGaps: records.slice(-MAX_ORACLE_AUTOMATION_GAPS),
    };
  }

  const seen = new Set(existing.map(record => record.id));
  const merged = [...existing];
  for (const record of records) {
    if (!record?.id || seen.has(record.id)) continue;
    seen.add(record.id);
    merged.push(record);
  }

  return {
    ...state,
    oracleAutomationGaps: merged.slice(-MAX_ORACLE_AUTOMATION_GAPS),
  };
}
