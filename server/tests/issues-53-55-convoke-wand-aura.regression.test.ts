import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { grantNextSpellConvoke, spellHasConvokeForCast } from '../src/state/modules/casting-modifiers.js';
import { computeSpellCastXUpperBound } from '../src/socket/game-actions-handlers/spellCastXUpperBound.js';
import { classifyAuraPolarity } from '../src/socket/ai-handlers/aiAuraPolarity.js';
import { chooseAITargetSelectionsForChoiceStep } from '../src/socket/ai.js';
import { createInitialGameState } from '../src/state/gameState.js';
import '../src/state/modules/priority.js';

const p1 = 'p1';
const p2 = 'p2';
const WHITE_X = { id: 'wave', name: 'Test White Wave', type_line: 'Sorcery', oracle_text: 'You gain X life.', mana_cost: '{X}{W}{W}', cmc: 2, colors: ['W'] };
const SECOND = { id: 'second', name: 'Test Second Spell', type_line: 'Sorcery', oracle_text: 'You gain 1 life.', mana_cost: '{1}{W}', cmc: 2, colors: ['W'] };
const soldier = (i: number) => ({ id: `sol_${i}`, controller: p1, owner: p1, tapped: false, counters: {}, isToken: true, card: { id: `solc_${i}`, name: 'Soldier', type_line: 'Token Creature - Soldier', oracle_text: '', colors: ['W'], power: '1', toughness: '1' } });

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function setupGame(gameId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game: any = ensureGame(gameId);
  const s = game.state;
  s.players = [{ id: p1, name: 'P1', spectator: false, life: 40 }, { id: p2, name: 'P2', spectator: false, life: 40 }];
  s.life = { [p1]: 40, [p2]: 40 };
  s.phase = 'precombatMain'; s.step = 'MAIN1'; s.turnPlayer = p1; s.priority = p1; s.turnNumber = 32; s.turn = 32;
  s.battlefield = [
    { id: 'medallion', controller: p1, owner: p1, tapped: false, counters: {}, card: { id: 'med_c', name: 'Pearl Medallion', type_line: 'Artifact', oracle_text: 'White spells you cast cost {1} less to cast.', mana_cost: '{2}' } },
    ...Array.from({ length: 30 }, (_, i) => soldier(i)),
  ];
  s.zones = {
    [p1]: { hand: [{ ...WHITE_X }, { ...SECOND }], handCount: 2, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    [p2]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
  };
  s.manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
  s.stack = [];
  const handlers: Record<string, Function> = {};
  const errors: any[] = [];
  const socket: any = { data: { playerId: p1, spectator: false, gameId }, rooms: new Set([gameId]), on: (e: string, f: Function) => { handlers[e] = f; }, emit: (ev: string, payload: any) => { if (ev === 'error') errors.push(payload); } };
  const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s0', socket]]) } };
  registerResolutionHandlers(io, socket);
  registerGameActions(io, socket);
  return { game, handlers, errors };
}

describe('issue #55: convoke + cost reducer + X', () => {
  const ids: string[] = [];
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({ to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } } as any);
  });
  afterEach(async () => { for (const id of ids.splice(0)) await resetGame(id); });

  it('X prompt bound counts convoke-able creatures instead of a flat 20', () => {
    const game: any = { state: { battlefield: Array.from({ length: 71 }, (_, i) => soldier(i)), manaPool: {}, convokeGrants: [] } };
    expect(computeSpellCastXUpperBound(game, p1, WHITE_X, '{X}{W}{W}', 1, 'hand')).toBe(20);
    grantNextSpellConvoke(game.state, p1 as any, 'Wand of the Worldsoul');
    expect(computeSpellCastXUpperBound(game, p1, WHITE_X, '{X}{W}{W}', 1, 'hand')).toBeGreaterThanOrEqual(69);
  });

  it('X=20 white spell under Pearl Medallion is paid entirely by 21 convoked Soldiers; the Wand grant is then gone', async () => {
    const gameId = `convoke_x_medallion_${Math.random().toString(36).slice(2, 7)}`;
    ids.push(gameId);
    await resetGame(gameId);
    const { game, handlers, errors } = setupGame(gameId);
    grantNextSpellConvoke(game.state, p1 as any, 'Wand of the Worldsoul');
    const convoke = Array.from({ length: 21 }, (_, i) => `sol_${i}`);
    await handlers['castSpellFromHand']({ gameId, cardId: 'wave', xValue: 20, convokeTappedCreatures: convoke });
    expect(errors).toEqual([]);
    expect((game.state.stack || []).some((it: any) => it?.card?.name === 'Test White Wave')).toBe(true);
    expect(game.state.battlefield.filter((p: any) => p.id.startsWith('sol_') && p.tapped)).toHaveLength(21);
    // #53: "next spell" convoke is used up.
    expect(spellHasConvokeForCast(game.state, p1 as any, SECOND, 'hand')).toBe(false);
  });
});

describe('issue #53: next-spell convoke grant is consumed on replay too', () => {
  it('applyEvent castSpell marks the grant used', () => {
    const game: any = createInitialGameState(`t_wand_${Math.random().toString(36).slice(2, 7)}`);
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.state.turnNumber = 5;
    game.state.zones[p1].hand = [{ ...SECOND }];
    grantNextSpellConvoke(game.state, p1 as any, 'Wand of the Worldsoul');
    expect(spellHasConvokeForCast(game.state, p1 as any, SECOND, 'hand')).toBe(true);
    game.applyEvent({ type: 'castSpell', playerId: p1, cardId: 'second', card: { ...SECOND }, fromZone: 'hand', targets: [] });
    expect(spellHasConvokeForCast(game.state, p1 as any, WHITE_X, 'hand')).toBe(false);
  });
});

describe('issue #54: AI aura polarity', () => {
  const BEAR_UMBRA = 'Enchant creature\nEnchanted creature gets +2/+2 and has "Whenever this creature attacks, untap all lands you control."\nUmbra armor (If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura.)';
  it('classifies buffs/umbra as beneficial and Pacifism-style as harmful', () => {
    expect(classifyAuraPolarity(BEAR_UMBRA)).toBe('beneficial');
    expect(classifyAuraPolarity('Enchant creature\nEnchanted creature can\'t attack or block.')).toBe('harmful');
    expect(classifyAuraPolarity('Enchant creature\nYou control enchanted creature.')).toBe('harmful');
    expect(classifyAuraPolarity('Enchant creature\nEnchanted creature gets -3/-3.')).toBe('harmful');
    expect(classifyAuraPolarity('Enchant creature\nEnchanted creature gets +1/+1 and has flying.\nTotem armor (If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura.)')).toBe('beneficial');
  });
  it('AI puts Bear Umbra on its own creature and Pacifism on an opponent\'s', () => {
    const game: any = createInitialGameState(`t_umbra_${Math.random().toString(36).slice(2, 7)}`);
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    const mine = { id: 'mine', controller: p1, owner: p1, tapped: false, counters: {}, card: { id: 'm', name: 'My Bear', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' } };
    const theirs = { id: 'theirs', controller: p2, owner: p2, tapped: false, counters: {}, card: { id: 't', name: 'Vaultborn Tyrant', type_line: 'Creature - Dinosaur', oracle_text: 'Trample', power: '6', toughness: '6' } };
    game.state.battlefield.push(mine, theirs);
    const step = (oracle: string, name: string) => ({
      type: 'target_selection', playerId: p1, minTargets: 1, maxTargets: 1, sourceName: name,
      validTargets: [{ id: 'theirs', type: 'permanent' }, { id: 'mine', type: 'permanent' }],
      spellCastContext: { cardName: name, oracleText: oracle, cardId: name },
    });
    expect(chooseAITargetSelectionsForChoiceStep(game, p1 as any, step(BEAR_UMBRA, 'Bear Umbra'))).toEqual(['mine']);
    expect(chooseAITargetSelectionsForChoiceStep(game, p1 as any, step("Enchant creature\nEnchanted creature can't attack or block.", 'Pacifism'))).toEqual(['theirs']);
  });
});
