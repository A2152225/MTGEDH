/**
 * Outcome sweep phase core: runs one action on a sweep table (snapshot, act, settle, snapshot) and turns
 * the result into a classified phase outcome. Shared by the battlefield driver and the zone-ability phases.
 */
import { markSweepErrors, settleSweepTable, sweepErrorsSince, type SweepSettle, type SweepTable } from './sweepHarness.js';
import { diffSweepSnapshots, takeSweepSnapshot, type SweepDiff } from './sweepSnapshot.js';
import { errorFamily, isConditionalText, oracleFamily } from './sweepFamilies.js';

export type SweepClass = 'ok' | 'noop' | 'throw' | 'stuck' | 'skipped';
export type SweepPhaseKind = 'cast' | 'play' | 'etb' | 'activate' | 'death' | 'zone';

export type SweepPhaseOutcome = {
  phase: SweepPhaseKind;
  label: string;
  text: string;
  family: string;
  conditional: boolean;
  class: SweepClass;
  detail?: string;
  changes: string[];
  weak: string[];
  castPrompts: string[];
  prompts: string[];
  notes: string[];
  errors: string[];
};

export type SweepCardOutcome = {
  name: string;
  set?: string;
  typeLine: string;
  class: SweepClass;
  detail?: string;
  phases: SweepPhaseOutcome[];
  telemetry: string[];
  untestedTriggers: string[];
  ms: number;
};


export type ActionRun = {
  diff: SweepDiff;
  totalDiff: SweepDiff;
  settle: SweepSettle;
  errors: string[];
  rejected: string[];
};

export function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function runAction(
  table: SweepTable,
  action: () => unknown,
  options: { ignoreCardIds?: string[]; ignoreSigOfPermId?: string } = {},
): Promise<ActionRun> {
  const before = takeSweepSnapshot(table.game);
  const mark = markSweepErrors();
  const emittedMark = table.emitted.length;
  const thrown: string[] = [];
  try {
    await action();
  } catch (error) {
    thrown.push(errorText(error));
  }
  let settle: SweepSettle;
  try {
    settle = await settleSweepTable(table);
  } catch (error) {
    thrown.push(errorText(error));
    settle = { castPrompts: [], resolvePrompts: [], notes: [], passErrors: new Set(), passes: 0, stuck: 'settle_threw' };
  }
  const after = takeSweepSnapshot(table.game);
  const rejected = table.emitted.slice(emittedMark)
    .filter((entry) => entry.event === 'error' && !settle.passErrors.has(entry) && !table.responderRejects.has(entry))
    .map((entry) => String(entry.payload?.code || entry.payload?.message || 'error'));
  const totalDiff = diffSweepSnapshots(before, after, options);
  const diff = settle.preResolve
    ? diffSweepSnapshots(settle.preResolve, after, { ignoreCardIds: options.ignoreCardIds })
    : totalDiff;
  return { diff, totalDiff, settle, errors: [...thrown, ...sweepErrorsSince(mark)], rejected };
}

export function phase(kind: SweepPhaseKind, label: string, text: string, run?: ActionRun): SweepPhaseOutcome {
  return {
    phase: kind,
    label,
    text: text.slice(0, 300),
    family: oracleFamily(text),
    conditional: isConditionalText(text),
    class: 'skipped',
    changes: run ? run.diff.strong.slice(0, 12) : [],
    weak: run ? meaningfulWeak(run.diff.weak).slice(0, 12) : [],
    castPrompts: run ? run.settle.castPrompts.slice(0, 12) : [],
    prompts: run ? run.settle.resolvePrompts.slice(0, 12) : [],
    notes: run ? [
      ...run.settle.notes,
      ...(run.diff.weak.includes('state:oracleAutomationGaps') ? ['automation_gap_recorded'] : []),
      // Triage aid: OUTCOME_SWEEP_RAW_WEAK=1 keeps the unfiltered weak keys (calibrated noise included).
      ...(process.env.OUTCOME_SWEEP_RAW_WEAK === '1' ? [`raw_weak:${run.diff.weak.join(',')}`, `ignored:${run.diff.ignored.join(',')}`] : []),
    ] : [],
    errors: run ? run.errors.slice(0, 5) : [],
  };
}

/** throw / stuck verdicts shared by every phase; undefined when the run completed cleanly. */
export function failureVerdict(run: ActionRun): { cls: SweepClass; detail: string } | undefined {
  if (run.errors.length > 0) return { cls: 'throw', detail: errorFamily(run.errors[0]) };
  if (run.rejected.length > 0) return { cls: 'throw', detail: `rejected:${run.rejected[0]}` };
  if (run.settle.stuck) return { cls: 'stuck', detail: run.settle.stuck };
  return undefined;
}

/**
 * Weak keys that change even for a card with no effect (derived trackers recomputed on every cast or
 * activation). Filled by calibrateSweepNoise() from blank calibration cards at harness start.
 */
export const calibratedNoise = new Set<string>();

/** Recording an automation gap is the engine admitting a miss, never evidence the effect happened. */
const NEVER_EVIDENCE = new Set(['state:oracleAutomationGaps']);

export function meaningfulWeak(weak: string[]): string[] {
  return weak.filter((key) => !calibratedNoise.has(key) && !NEVER_EVIDENCE.has(key));
}

/** ok / noop from a diff: strong change or mana gain, then resolution prompts, then weak-only. */
export function changeVerdict(diff: SweepDiff, prompts: string[]): { cls: SweepClass; detail?: string } {
  if (diff.strong.length > 0 || diff.manaGain) return { cls: 'ok' };
  if (prompts.length > 0) return { cls: 'ok', detail: 'prompt_only' };
  const weak = meaningfulWeak(diff.weak);
  if (weak.length > 0) return { cls: 'ok', detail: `weak:${weak.slice(0, 3).join(',')}` };
  return { cls: 'noop', detail: 'no_state_change' };
}

export function apply(outcome: SweepPhaseOutcome, verdict: { cls: SweepClass; detail?: string }): SweepPhaseOutcome {
  outcome.class = verdict.cls;
  if (verdict.detail) outcome.detail = verdict.detail;
  return outcome;
}

