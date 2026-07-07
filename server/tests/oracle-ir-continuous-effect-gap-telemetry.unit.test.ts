import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getOracleIrGapTelemetrySnapshot,
  resetOracleIrGapTelemetry,
} from '../src/state/modules/oracleIrGapTelemetry.js';
import {
  resetContinuousEffectGapTelemetryForTests,
  scanBattlefieldContinuousEffectOverlayGaps,
} from '../src/state/modules/oracleIrContinuousEffectGapTelemetry.js';
import {
  resetCompiledOracleIROverlayTableForTests,
  upsertCompiledOracleIROverlaySync,
} from '../src/services/oracleIrCompiledOverlayStore.js';
import { resetLocalCardLookupForTests } from '../src/services/localCardLookup.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';

describe('oracle IR continuous effect gap telemetry (Phase 5)', () => {
  beforeEach(() => {
    resetLocalCardLookupForTests();
    resetCompiledOracleIROverlayTableForTests();
    resetOracleIrGapTelemetry();
    resetContinuousEffectGapTelemetryForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    resetOracleIrGapTelemetry();
    resetContinuousEffectGapTelemetryForTests();
    vi.restoreAllMocks();
  });

  it('records owned_but_unhandled for fallback_to_bespoke overlays on battlefield', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'gap-anthem-id',
      name: 'Gap Anthem',
      envelope: {
        card_id: 'gap-anthem-id',
        fallback_to_bespoke: true,
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'Creatures you control get +1/+1.',
          steps: [],
        }],
      },
    });

    scanBattlefieldContinuousEffectOverlayGaps({
      id: 'game-1',
      battlefield: [{
        id: 'perm-1',
        controller: 'p1',
        card: { id: 'gap-anthem-id', name: 'Gap Anthem', oracle_text: '' },
      }],
    });

    const snapshot = getOracleIrGapTelemetrySnapshot();
    expect(snapshot.byKind.owned_but_unhandled).toBe(1);
    expect(snapshot.byScopeKind['static:owned_but_unhandled']).toBe(1);
    expect(snapshot.recentEvents[0]).toMatchObject({
      kind: 'owned_but_unhandled',
      scope: 'static',
      label: 'Gap Anthem',
      reasons: ['overlay_fallback_to_bespoke'],
    });
  });

  it('records owned_but_unhandled for empty STATIC overlay abilities', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'empty-static-id',
      name: 'Empty Static',
      envelope: {
        card_id: 'empty-static-id',
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'Creatures you control get +1/+1.',
          steps: [],
        }],
      },
    });

    scanBattlefieldContinuousEffectOverlayGaps({
      battlefield: [{
        id: 'perm-1',
        controller: 'p1',
        card: { id: 'empty-static-id', name: 'Empty Static', oracle_text: '' },
      }],
    });

    expect(getOracleIrGapTelemetrySnapshot().recentEvents[0]).toMatchObject({
      scope: 'static',
      reasons: ['overlay_static_specs_empty'],
    });
  });

  it('dedupes repeated SBA scans for the same overlay gap fingerprint', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'empty-replacement-id',
      name: 'Empty Replacement',
      envelope: {
        card_id: 'empty-replacement-id',
        abilities: [{
          ability_type: 'REPLACEMENT',
          effect_text: 'If an opponent would mill, they mill twice that many instead.',
          steps: [],
        }],
      },
    });

    const state = {
      battlefield: [{
        id: 'perm-1',
        controller: 'p1',
        card: { id: 'empty-replacement-id', name: 'Empty Replacement', oracle_text: '' },
      }],
    };

    scanBattlefieldContinuousEffectOverlayGaps(state);
    scanBattlefieldContinuousEffectOverlayGaps(state);
    syncDerivedContinuousEffects(state);
    syncDerivedContinuousEffects(state);

    const snapshot = getOracleIrGapTelemetrySnapshot();
    expect(snapshot.totalEvents).toBe(1);
    expect(snapshot.recentEvents[0].scope).toBe('replacement');
  });

  it('does not record telemetry for wired STATIC overlay specs', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'wired-static-id',
      name: 'Wired Static',
      envelope: {
        card_id: 'wired-static-id',
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'Creatures you control get +1/+1.',
          steps: [],
          static_specs: [{
            id: 'creatures-plus-one',
            scope: { kind: 'creatures_you_control' },
            grant: { power: 1, toughness: 1 },
          }],
        }],
      },
    });

    syncDerivedContinuousEffects({
      battlefield: [{
        id: 'perm-1',
        controller: 'p1',
        card: { id: 'wired-static-id', name: 'Wired Static', oracle_text: '' },
      }],
    });

    expect(getOracleIrGapTelemetrySnapshot().totalEvents).toBe(0);
  });
});
