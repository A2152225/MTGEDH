import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  getOracleIrGapTelemetrySnapshot,
  isOracleIrGapTelemetryLegacySoakEnabled,
  loadOracleIrGapTelemetrySnapshotFromAppendLog,
  recordOracleIrGapTelemetry,
  resetOracleIrGapTelemetry,
} from '../src/state/modules/oracleIrGapTelemetry.js';
import { logOracleIrAllOrNothingFailure } from '../src/state/modules/oracleIrStepWiring.js';

describe('oracle IR gap telemetry (D2)', () => {
  let savedTelemetrySnapshot: string | undefined;

  beforeEach(() => {
    savedTelemetrySnapshot = process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT;
    delete process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT;
    delete process.env.ORACLE_IR_TELEMETRY_APPEND_PATH;
    resetOracleIrGapTelemetry();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    resetOracleIrGapTelemetry();
    vi.restoreAllMocks();
    if (savedTelemetrySnapshot !== undefined) {
      process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT = savedTelemetrySnapshot;
    } else {
      delete process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT;
    }
  });

  it('records events with counters and a ring buffer snapshot', () => {
    recordOracleIrGapTelemetry({
      kind: 'owned_but_unhandled',
      scope: 'trigger',
      label: 'Test Card',
      reasons: ['ir_primary_owns_effect_but_did_not_apply'],
      effectText: 'draw a card, then discard a card.',
      gameId: 'g1',
    });
    recordOracleIrGapTelemetry({
      kind: 'owned_but_unhandled',
      scope: 'trigger',
      label: 'Test Card',
      reasons: ['ir_primary_owns_effect_but_did_not_apply'],
    });
    recordOracleIrGapTelemetry({
      kind: 'legacy_handled',
      scope: 'spell',
      label: 'Legacy Spell',
      reasons: ['legacy_categorize_op:DRAW'],
    });

    const snapshot = getOracleIrGapTelemetrySnapshot();
    expect(snapshot.totalEvents).toBe(3);
    expect(snapshot.byKind).toEqual({ owned_but_unhandled: 2, legacy_handled: 1 });
    expect(snapshot.byScopeKind).toEqual({
      'trigger:owned_but_unhandled': 2,
      'spell:legacy_handled': 1,
    });
    expect(snapshot.topLabels[0]).toEqual({
      kind: 'owned_but_unhandled',
      label: 'Test Card',
      count: 2,
    });
    expect(snapshot.recentEvents).toHaveLength(3);
    expect(snapshot.recentEvents[0].effectText).toBe('draw a card, then discard a card.');
    expect(snapshot.recentEvents[0].gameId).toBe('g1');
  });

  it('accepts a bare string for reasons and normalizes it', () => {
    recordOracleIrGapTelemetry({
      kind: 'all_or_nothing_failure',
      scope: 'trigger',
      label: 'Draw Sync Card',
      reasons: 'library did not decrease for draw effect',
    });
    const snapshot = getOracleIrGapTelemetrySnapshot();
    expect(snapshot.recentEvents[0].reasons).toEqual([
      'library did not decrease for draw effect',
    ]);
  });

  it('dedupes console output per fingerprint but keeps counting', () => {
    for (let i = 0; i < 3; i += 1) {
      recordOracleIrGapTelemetry({
        kind: 'owned_but_unhandled',
        scope: 'spell',
        label: 'Same Card',
        reasons: ['x'],
      });
    }
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(getOracleIrGapTelemetrySnapshot().totalEvents).toBe(3);
  });

  it('does not emit console output for legacy_handled triage events', () => {
    recordOracleIrGapTelemetry({
      kind: 'legacy_handled',
      scope: 'trigger',
      label: 'Quiet Card',
      reasons: ['legacy_family:legacy_body'],
    });
    expect(console.warn).not.toHaveBeenCalled();
    expect(getOracleIrGapTelemetrySnapshot().totalEvents).toBe(1);
  });

  it('logOracleIrAllOrNothingFailure records an all_or_nothing_failure event', () => {
    logOracleIrAllOrNothingFailure(
      'spell',
      'Failing Spell',
      ['no_effect_applied_or_queued'],
      { applied: 0, parsed: 2 },
    );
    const snapshot = getOracleIrGapTelemetrySnapshot();
    expect(snapshot.byScopeKind['spell:all_or_nothing_failure']).toBe(1);
    expect(snapshot.recentEvents[0].label).toBe('Failing Spell');
    expect(snapshot.recentEvents[0].stats).toEqual({ applied: 0, parsed: 2 });
  });

  it('logOracleIrAllOrNothingFailure tolerates a string reasons argument', () => {
    expect(() =>
      logOracleIrAllOrNothingFailure('trigger', 'String Reason Card', 'single reason string' as any),
    ).not.toThrow();
    const snapshot = getOracleIrGapTelemetrySnapshot();
    expect(snapshot.recentEvents[0].reasons).toEqual(['single reason string']);
  });

  it('isOracleIrGapTelemetryLegacySoakEnabled is true when env is set', () => {
    process.env.ORACLE_IR_GAP_TELEMETRY_LEGACY_SOAK = '1';
    expect(isOracleIrGapTelemetryLegacySoakEnabled()).toBe(true);
    delete process.env.ORACLE_IR_GAP_TELEMETRY_LEGACY_SOAK;
    expect(isOracleIrGapTelemetryLegacySoakEnabled()).toBe(false);
  });

  it('appends soak events to jsonl when ORACLE_IR_TELEMETRY_APPEND_PATH is set', () => {
    const appendPath = path.join(os.tmpdir(), `oracle-ir-telemetry-${process.pid}.jsonl`);
    fs.rmSync(appendPath, { force: true });
    process.env.ORACLE_IR_TELEMETRY_APPEND_PATH = appendPath;

    recordOracleIrGapTelemetry({
      kind: 'legacy_handled',
      scope: 'trigger',
      label: 'Append Card',
      reasons: ['legacy_family:legacy_tail'],
    });
    resetOracleIrGapTelemetry();

    const merged = loadOracleIrGapTelemetrySnapshotFromAppendLog(appendPath);
    expect(merged.totalEvents).toBe(1);
    expect(merged.byKind.legacy_handled).toBe(1);
    expect(merged.recentEvents[0].label).toBe('Append Card');

    delete process.env.ORACLE_IR_TELEMETRY_APPEND_PATH;
    fs.rmSync(appendPath, { force: true });
  });
});
