import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { applyRetiredTriggerLegacyAgentOfShadowThievesAttack, applyRetiredTriggerLegacyCurseDefendingPlayer } from '../src/state/modules/oracleIrTriggerLegacyCardSpecificHandlers.js';

describe('oracleIrTriggerLegacyCardSpecificHandlers', () => {
  it('applies Agent of the Shadow Thieves attack trigger when condition is met', () => {
    const state = {
      startingLife: 40,
      life: { p1: 30, p2: 25, p3: 20 },
      players: [
        { id: 'p1' },
        { id: 'p2' },
        { id: 'p3' },
      ],
      battlefield: [{
        id: 'agent',
        counters: {},
        temporaryAbilities: [],
        card: { name: 'Agent of the Shadow Thieves' },
      }],
      endOfTurnEffects: [],
    };

    expect(applyRetiredTriggerLegacyAgentOfShadowThievesAttack({
      controller: 'p1' as PlayerID,
      desc: 'Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn.',
      triggerItem: {
        source: 'agent',
        effectData: { defendingPlayer: 'p2' },
      },
      state,
    })).toBe(true);

    expect(state.battlefield[0].counters['+1/+1']).toBe(1);
    expect(state.battlefield[0].temporaryAbilities).toContain('deathtouch');
    expect(state.endOfTurnEffects).toHaveLength(1);
  });

  it('creates a curse token enchantment on the defending player', () => {
    const state = { battlefield: [] as any[] };

    expect(applyRetiredTriggerLegacyCurseDefendingPlayer({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Curse Source',
      desc: 'curse defending player.',
      triggerItem: { defendingPlayer: 'p2' },
      state,
    })).toBe(true);

    expect(state.battlefield).toHaveLength(1);
    expect(state.battlefield[0]).toMatchObject({
      controller: 'p1',
      enchantedPlayerId: 'p2',
      isToken: true,
      card: { name: 'Curse' },
    });
    expect(String(state.battlefield[0].id)).toMatch(/^curse_token_/);
  });
});
