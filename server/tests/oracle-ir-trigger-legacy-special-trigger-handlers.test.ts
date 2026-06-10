import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacySacrificeThisCreature,
  applyRetiredTriggerLegacyAttackingPlayerGainsControlOfArtifact,
} from '../src/state/modules/oracleIrTriggerLegacySpecialTriggerHandlers.js';
import * as countersTokens from '../src/state/modules/counters_tokens.js';
import * as prepared from '../src/state/modules/prepared.js';

describe('oracleIrTriggerLegacySpecialTriggerHandlers', () => {
  it('sacrifices the triggering creature', () => {
    const movePermanentToGraveyard = vi.spyOn(countersTokens, 'movePermanentToGraveyard').mockImplementation(() => true);

    expect(applyRetiredTriggerLegacySacrificeThisCreature({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'sacrifice this creature.',
      triggerItem: { source: 'creature-1' },
      state: {},
    })).toBe(true);

    expect(movePermanentToGraveyard).toHaveBeenCalledWith({}, 'creature-1', true);
    movePermanentToGraveyard.mockRestore();
  });

  it('transfers artifact control to the attacking player', () => {
    const syncPreparedPermanentAfterControlChange = vi.spyOn(prepared, 'syncPreparedPermanentAfterControlChange').mockImplementation(() => {});
    const perm = { id: 'artifact-1', controller: 'p1', tapped: true };

    expect(applyRetiredTriggerLegacyAttackingPlayerGainsControlOfArtifact({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'the attacking player gains control of this artifact and untaps it',
      triggerItem: { source: 'artifact-1', attackingPlayerId: 'p2' },
      state: { battlefield: [perm] },
    })).toBe(true);

    expect(perm.controller).toBe('p2');
    expect(perm.tapped).toBe(false);
    expect(syncPreparedPermanentAfterControlChange).toHaveBeenCalledTimes(1);
    syncPreparedPermanentAfterControlChange.mockRestore();
  });
});
