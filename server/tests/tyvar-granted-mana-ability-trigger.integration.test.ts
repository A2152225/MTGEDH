import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { triggerAbilityActivatedTriggers } from '../src/state/modules/triggers/ability-activated.js';
import { games } from '../src/socket/socket.js';

const noopIo = () => ({
  to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
  emit: (_event: string, _payload: any) => {},
  sockets: { sockets: new Map() },
}) as any;

const TYVAR_ORACLE = 'Whenever one or more Elves you control attack, they gain deathtouch until end of turn.\nEach creature you control has "Whenever a mana ability of this creature resolves, put a number of +1/+1 counters on it equal to the amount of mana this creature produced. This ability triggers only once each turn."';

describe('Tyvar the Bellicose: quoted granted "mana ability resolves" trigger', () => {
  const gameId = 'test_tyvar_granted_mana_trigger';
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(noopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const reset = async () => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  };
  beforeEach(reset);
  afterEach(reset);

  function setup() {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = p1;
    (game.state as any).turnNumber = 3;
    (game.state as any).battlefield = [
      { id: 'tyvar', controller: p1, owner: p1, counters: {}, card: { id: 'tyvar_c', name: 'Tyvar the Bellicose', type_line: 'Legendary Creature — Elf Warrior', oracle_text: TYVAR_ORACLE, power: '4', toughness: '4' } },
      { id: 'elf', controller: p1, owner: p1, counters: {}, tapped: true, card: { id: 'elf_c', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', oracle_text: '{T}: Add {G}.', power: '1', toughness: '1' } },
      { id: 'opp_bear', controller: p2, owner: p2, counters: {}, tapped: true, card: { id: 'bear_c', name: 'Opposing Mana Bear', type_line: 'Creature — Bear', oracle_text: '{T}: Add {G}.', power: '2', toughness: '2' } },
      { id: 'forest', controller: p1, owner: p1, counters: {}, tapped: true, card: { id: 'forest_c', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' } },
    ];
    (game.state as any).stack = [];
    return game;
  }
  const evt = (sourcePermanentId: string, activatedBy: string, extra: Record<string, unknown> = {}) => ({
    activatedBy: activatedBy as any, sourcePermanentId, isManaAbility: true, abilityText: '{T}: Add {G}.', ...extra,
  });

  it('adds counters equal to the mana produced, once each turn, only for the creature whose ability resolved', () => {
    const game = setup();
    const ctx = game as any;

    // Activation alone (before resolution) does not trigger it.
    expect(triggerAbilityActivatedTriggers(ctx, evt('elf', 'p1'))).toHaveLength(0);

    const first = triggerAbilityActivatedTriggers(ctx, evt('elf', 'p1', { manaAbilityResolved: true, manaProduced: 2 }));
    expect(first).toHaveLength(1);
    expect(first[0].permanentId).toBe('elf');
    expect(first[0].description).toMatch(/^put 2 \+1\/\+1 counters on it$/i);

    // Once each turn per creature.
    expect(triggerAbilityActivatedTriggers(ctx, evt('elf', 'p1', { manaAbilityResolved: true, manaProduced: 1 }))).toHaveLength(0);

    // Lands and opponents' creatures are not "each creature you control".
    expect(triggerAbilityActivatedTriggers(ctx, evt('forest', 'p1', { manaAbilityResolved: true, manaProduced: 1 }))).toHaveLength(0);
    expect(triggerAbilityActivatedTriggers(ctx, evt('opp_bear', 'p2', { manaAbilityResolved: true, manaProduced: 1 }))).toHaveLength(0);

    // A new turn resets it.
    (game.state as any).turnNumber = 4;
    const next = triggerAbilityActivatedTriggers(ctx, evt('elf', 'p1', { manaAbilityResolved: true, manaProduced: 1 }));
    expect(next).toHaveLength(1);
    expect(next[0].description).toMatch(/^put 1 \+1\/\+1 counters on it$/i);
  });

  it('resolves the granted trigger and puts the counters on the creature', () => {
    const game = setup();
    const out = triggerAbilityActivatedTriggers(game as any, evt('elf', 'p1', { manaAbilityResolved: true, manaProduced: 2 }));
    expect(out).toHaveLength(1);
    expect((game.state as any).stack).toHaveLength(1);
    game.resolveTopOfStack();
    const elf = (game.state as any).battlefield.find((p: any) => p.id === 'elf');
    expect(Number(elf.counters?.['+1/+1'] || 0)).toBe(2);
  });
});
