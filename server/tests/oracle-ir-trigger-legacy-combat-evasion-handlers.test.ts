import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacySelfCantBeBlocked,
  applyRetiredTriggerLegacySelfCantBeBlockedByLowPower,
  applyRetiredTriggerLegacySelfPreventCombatDamage,
  applyRetiredTriggerLegacyTargetCreatureCantBeBlocked,
} from '../src/state/modules/oracleIrTriggerLegacyCombatEvasionHandlers.js';

describe('oracleIrTriggerLegacyCombatEvasionHandlers', () => {
  it('grants target creatures unblockable this turn', () => {
    const state = {
      turnNumber: 3,
      battlefield: [{
        id: 'target-1',
        card: { name: 'Giant', type_line: 'Creature — Giant' },
      }],
    };

    expect(applyRetiredTriggerLegacyTargetCreatureCantBeBlocked({
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: "Up to one target creature can't be blocked this turn.",
      triggerItem: { targets: ['target-1'] },
      state,
    })).toBe(true);

    expect(state.battlefield[0].temporaryAbilities).toHaveLength(1);
    expect(state.battlefield[0].temporaryAbilities[0].ability).toBe("can't be blocked");
  });

  it('grants self unblockable and queues scry', () => {
    const state = {
      turnNumber: 2,
      battlefield: [{
        id: 'self-1',
        card: { name: 'Slippery Bogle' },
      }],
    };

    expect(applyRetiredTriggerLegacySelfCantBeBlocked({
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: "It can't be blocked this turn and you scry 1.",
      triggerItem: { source: 'self-1' },
      state,
    })).toBe(true);

    expect(state.battlefield[0].temporaryAbilities[0].ability).toBe("can't be blocked");
    expect(state.pendingScry.p1).toBe(1);
  });

  it('prevents combat damage to self this turn', () => {
    const state = {
      turnNumber: 1,
      battlefield: [{ id: 'self-1', card: { name: 'Fog Bank' } }],
    };

    expect(applyRetiredTriggerLegacySelfPreventCombatDamage({
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'Prevent all combat damage that would be dealt to this creature this turn.',
      triggerItem: { permanentId: 'self-1' },
      state,
    })).toBe(true);

    expect(state.battlefield[0].temporaryAbilities[0].ability).toContain('prevent all combat damage');
  });

  it('grants low-power evasion to self', () => {
    const state = {
      turnNumber: 1,
      battlefield: [{ id: 'self-1', card: { name: 'Krenko' } }],
    };

    expect(applyRetiredTriggerLegacySelfCantBeBlockedByLowPower({
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: "This creature can't be blocked by creatures with power 2 or less this turn.",
      triggerItem: { source: 'self-1' },
      state,
    })).toBe(true);

    expect(state.battlefield[0].temporaryAbilities[0].ability).toContain('power 2 or less');
  });
});
