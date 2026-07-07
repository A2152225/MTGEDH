import { describe, expect, it } from 'vitest';
import {
  buildCombatDamageChatMessages,
  drainPendingCombatDamageChat,
  queueCombatDamageChat,
} from '../src/state/modules/combatDamageChat.js';

describe('combat damage chat', () => {
  it('queues and formats player combat damage with attacker breakdown', () => {
    const state: any = {
      life: { p1: 33, p2: 40 },
      players: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ],
      battlefield: [
        { id: 'a1', card: { name: 'Grizzly Bears' } },
        { id: 'a2', card: { name: 'Elf Warrior' } },
      ],
    };

    queueCombatDamageChat(state, {
      damageToPlayers: { p2: 7 },
      attackerDamageToPlayers: {
        p2: { a1: 3, a2: 4 },
      },
    });

    const pending = drainPendingCombatDamageChat(state);
    expect(pending).toHaveLength(1);

    const messages = buildCombatDamageChatMessages({ state }, pending[0]);
    expect(messages).toEqual([
      'Bob takes 7 combat damage (47 → 40) from Grizzly Bears (3), Elf Warrior (4)',
    ]);
  });

  it('prefixes first strike combat damage', () => {
    const state: any = {
      life: { p2: 35 },
      players: [{ id: 'p2', name: 'Bob' }],
      battlefield: [],
    };

    queueCombatDamageChat(state, { damageToPlayers: { p2: 5 } }, { firstStrike: true });
    const pending = drainPendingCombatDamageChat(state);
    const messages = buildCombatDamageChatMessages({ state }, pending[0]);
    expect(messages[0]).toBe('First strike: Bob takes 5 combat damage (40 → 35)');
  });

  it('queues creature deaths even without player damage', () => {
    const state: any = {
      life: { p1: 40, p2: 40 },
      players: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ],
      battlefield: [
        { id: 'b1', card: { name: 'Spirit' } },
        { id: 'a1', card: { name: 'Grizzly Bears' } },
      ],
    };

    queueCombatDamageChat(state, {
      damageToPlayers: {},
      creaturesDestroyed: ['b1', 'a1'],
    });

    const pending = drainPendingCombatDamageChat(state);
    expect(pending).toHaveLength(1);
    const messages = buildCombatDamageChatMessages({ state }, pending[0]);
    expect(messages).toEqual([
      'Spirit dies in combat',
      'Grizzly Bears dies in combat',
    ]);
  });
});
