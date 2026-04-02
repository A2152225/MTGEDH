import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { applyDamageToPermanentWithCounterEffects } from '../src/state/modules/counter-common-effects.js';
import { destroyPermanent } from '../src/state/modules/counters_tokens.js';

function createBaseGame(gameId: string) {
  const game = createInitialGameState(gameId);
  Object.assign(game.state as any, {
    players: [
      { id: 'p1', name: 'P1', seat: 0, spectator: false, life: 40 },
      { id: 'p2', name: 'P2', seat: 1, spectator: false, life: 40 },
    ],
    stack: [],
    battlefield: [],
    priorityPassedBy: new Set<string>(),
    zones: {
      p1: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] },
      p2: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] },
    },
  });

  return game;
}

function getPermanent(game: any, permanentId: string) {
  return ((game.state as any).battlefield || []).find((entry: any) => entry && entry.id === permanentId) as any;
}

describe('common special-counter effects', () => {
  it('exiles a creature with a finality counter instead of putting it into the graveyard when destroyed', () => {
    const game = createBaseGame('finality_destroy');
    (game.state as any).battlefield.push({
      id: 'finality_creature',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      counters: { finality: 1 },
      card: {
        id: 'finality_creature_card',
        name: 'Finality Creature',
        type_line: 'Creature - Spirit',
        oracle_text: '',
        power: '3',
        toughness: '3',
      },
    });

    const resolved = destroyPermanent(game as any, 'finality_creature', true);

    expect(resolved).toBe(true);
    expect(getPermanent(game, 'finality_creature')).toBeUndefined();
    expect(((game.state as any).zones?.p1?.graveyard || []).length).toBe(0);
    expect(((game.state as any).zones?.p1?.exile || []).some((entry: any) => entry && entry.name === 'Finality Creature')).toBe(true);
  });

  it('consumes a shield counter to prevent damage to a permanent', () => {
    const game = createBaseGame('shield_damage');
    (game.state as any).battlefield.push({
      id: 'shielded_creature',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      damageMarked: 0,
      counters: { shield: 1 },
      card: {
        id: 'shielded_creature_card',
        name: 'Shielded Creature',
        type_line: 'Creature - Knight',
        oracle_text: '',
        power: '2',
        toughness: '2',
      },
    });

    const permanent = getPermanent(game, 'shielded_creature');
    const result = applyDamageToPermanentWithCounterEffects(permanent, 4, 'damageMarked');

    expect(result).toEqual({ prevented: true, appliedAmount: 0 });
    expect(Number(permanent?.damageMarked || 0)).toBe(0);
    expect(Number(permanent?.damage || 0)).toBe(0);
    expect(Number(permanent?.markedDamage || 0)).toBe(0);
    expect(Number(permanent?.counters?.shield || 0)).toBe(0);
  });

  it('consumes a shield counter instead of destroying the permanent', () => {
    const game = createBaseGame('shield_destroy');
    (game.state as any).battlefield.push({
      id: 'shielded_destroy_target',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      counters: { shield: 1 },
      card: {
        id: 'shielded_destroy_target_card',
        name: 'Shielded Target',
        type_line: 'Creature - Soldier',
        oracle_text: '',
        power: '2',
        toughness: '2',
      },
    });

    const resolved = destroyPermanent(game as any, 'shielded_destroy_target', true);
    const permanent = getPermanent(game, 'shielded_destroy_target');

    expect(resolved).toBe(true);
    expect(permanent).toBeDefined();
    expect(Number(permanent?.counters?.shield || 0)).toBe(0);
    expect(((game.state as any).zones?.p1?.graveyard || []).length).toBe(0);
  });

  it('treats divinity-style counter grants as indestructible during SBAs', () => {
    const game = createBaseGame('divinity_indestructible');
    (game.state as any).battlefield.push(
      {
        id: 'divinity_source',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'divinity_source_card',
          name: 'Divinity Source',
          type_line: 'Legendary Creature - Spirit',
          oracle_text: 'Each creature with a divinity counter on it has indestructible.',
          power: '4',
          toughness: '4',
        },
      },
      {
        id: 'divine_creature',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        damageMarked: 2,
        counters: { divinity: 1 },
        card: {
          id: 'divine_creature_card',
          name: 'Divine Creature',
          type_line: 'Creature - Avatar',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    );

    game.runSBA();

    const permanent = getPermanent(game, 'divine_creature');
    expect(permanent).toBeDefined();
    expect(Number(permanent?.damageMarked || 0)).toBe(2);
    expect(((game.state as any).zones?.p1?.graveyard || []).length).toBe(0);
  });
});