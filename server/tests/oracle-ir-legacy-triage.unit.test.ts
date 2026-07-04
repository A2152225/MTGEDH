import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  collectLegacyHandlers,
  collectLegacyFamilies,
} from '../scripts/oracle-ir-legacy-triage.js';
import type { OracleIrGapTelemetrySnapshot } from '../src/state/modules/oracleIrGapTelemetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const forcedTriagePath = path.join(__dirname, '..', 'scripts', 'out', 'oracle-ir-legacy-triage-forced.json');

describe('oracle IR legacy triage helpers', () => {
  it('collects legacy_handler reasons from snapshot events', () => {
    const snapshot: OracleIrGapTelemetrySnapshot = {
      totalEvents: 2,
      byKind: { legacy_handled: 2 },
      byScopeKind: {},
      topLabels: [],
      recentEvents: [
        {
          kind: 'legacy_handled',
          scope: 'trigger',
          label: 'Murderous Redcap',
          reasons: [
            'legacy_family:legacy_tail',
            'legacy_handler:applyRetiredTriggerLegacyCombinedEffectsRegexBatch$you_gain_that_much_life',
          ],
          at: '2026-07-03T00:00:00.000Z',
        },
        {
          kind: 'legacy_handled',
          scope: 'spell',
          label: 'Test Shock',
          reasons: ['legacy_categorize_op:LOSE_LIFE'],
          at: '2026-07-03T00:00:00.000Z',
        },
      ],
    };

    expect([...collectLegacyHandlers(snapshot)].sort()).toEqual([
      'applyRetiredTriggerLegacyCombinedEffectsRegexBatch$you_gain_that_much_life',
    ]);
    expect([...collectLegacyFamilies(snapshot)]).toEqual(['legacy_tail']);
  });

  it('collects clause-level combined batch handlers from snapshot events', () => {
    const snapshot: OracleIrGapTelemetrySnapshot = {
      totalEvents: 1,
      byKind: { legacy_handled: 1 },
      byScopeKind: {},
      topLabels: [],
      recentEvents: [
        {
          kind: 'legacy_handled',
          scope: 'trigger',
          label: 'Soul Warden',
          reasons: [
            'legacy_family:legacy_tail',
            'legacy_handler:applyRetiredTriggerLegacyCombinedEffectsRegexBatch$you_gain_that_much_life',
          ],
          at: '2026-07-03T00:00:00.000Z',
        },
      ],
    };

    expect([...collectLegacyHandlers(snapshot)]).toEqual([
      'applyRetiredTriggerLegacyCombinedEffectsRegexBatch$you_gain_that_much_life',
    ]);
  });

  it('forced soak triage report may omit retired mana/combat batch', () => {
    if (!fs.existsSync(forcedTriagePath)) {
      return;
    }

    const report = JSON.parse(fs.readFileSync(forcedTriagePath, 'utf8')) as {
      firedLegacyHandlers?: string[];
    };

    const fired = report.firedLegacyHandlers || [];
    for (const retiredHandler of [
      'applyRetiredTriggerLegacyManaAndCombatBatch',
      'applyRetiredTriggerLegacyManaAndCombatBatch$proliferate',
      'applyRetiredTriggerLegacyManaAndCombatBatch$add_mana_to_pool',
      'applyRetiredTriggerLegacyManaAndCombatBatch$extra_combat_phase',
      'applyRetiredTriggerLegacyManaAndCombatBatch$extra_combat_phase_skip',
    ]) {
      expect(fired).not.toContain(retiredHandler);
    }
  });

  it('forced soak triage report may omit retired graveyard zone-change batch handlers', () => {
    if (!fs.existsSync(forcedTriagePath)) {
      return;
    }

    const report = JSON.parse(fs.readFileSync(forcedTriagePath, 'utf8')) as {
      firedLegacyHandlers?: string[];
    };

    const fired = report.firedLegacyHandlers || [];
    for (const retiredHandler of [
      'applyRetiredTriggerLegacyGraveyardZoneChangeBatch',
      'applyRetiredTriggerLegacyGraveyardZoneChangeBatch$destroy_target',
      'applyRetiredTriggerLegacyGraveyardZoneChangeBatch$exile_target_creature',
      'applyRetiredTriggerLegacyGraveyardZoneChangeBatch$bounce_target',
      'applyRetiredTriggerLegacyGraveyardZoneChangeBatch$exile_target_card_from_graveyard',
      'applyRetiredTriggerLegacyGraveyardZoneChangeBatch$linked_exile_until_leaves',
      'applyRetiredTriggerLegacyGraveyardZoneChangeBatch$graveyard_multi_to_battlefield',
      'applyRetiredTriggerLegacyGraveyardZoneChangeBatch$graveyard_to_battlefield',
      'applyRetiredTriggerLegacyGraveyardZoneChangeBatch$graveyard_to_hand',
      'applyRetiredTriggerLegacyGraveyardZoneChangeBatch$exile_top_of_library',
      'applyRetiredTriggerLegacyExileTargetPlayerGraveyard',
    ]) {
      expect(fired).not.toContain(retiredHandler);
    }
  });

  it('forced soak triage report still records legacy handler telemetry', () => {
    if (!fs.existsSync(forcedTriagePath)) {
      return;
    }

    const report = JSON.parse(fs.readFileSync(forcedTriagePath, 'utf8')) as {
      firedLegacyHandlers?: string[];
      legacyHandledEvents?: number;
    };

    expect(report.legacyHandledEvents).toBeGreaterThan(0);
  });
});
