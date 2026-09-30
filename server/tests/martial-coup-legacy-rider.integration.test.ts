import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { applyInstantSorceryFracturedIdentityAndFallbackRiders } from '../src/state/modules/stackResolveSpellPostCategorizeRidersUtils.js';
import '../src/state/modules/priority.js';

/**
 * The legacy (non-IR) Martial Coup rider must agree with the Oracle IR path:
 * X >= 5 destroys every OTHER creature, older tokens included, indestructible creatures survive
 * (CR 702.12), and only the Soldier tokens this same resolution just created are spared.
 */
const gameId = 'test_martial_coup_legacy_rider';
const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;
const MARTIAL_COUP_TEXT = 'Create X 1/1 white Soldier creature tokens. If X is 5 or more, destroy all other creatures.';

function creature(id: string, controller: string, oracle = '', extra: Record<string, unknown> = {}) {
  return {
    id, controller, owner: controller, tapped: false, counters: {},
    card: { id: `${id}_card`, name: id, type_line: 'Creature - Bear', power: '2', toughness: '2', oracle_text: oracle },
    ...extra,
  };
}

function runLegacyRider(xValue: number) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
  const game = ensureGame(gameId) as any;
  game.gameId = gameId;
  const state: any = game.state;
  state.players = [
    { id: p1, name: 'P1', spectator: false, life: 40 },
    { id: p2, name: 'P2', spectator: false, life: 40 },
  ];
  state.life = { [p1]: 40, [p2]: 40 };
  state.zones = {
    [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
  state.battlefield = [
    creature('my_bear', p1),
    creature('their_bear', p2),
    creature('their_indestructible', p2, 'Indestructible'),
    creature('their_equipped_indestructible', p2, '', { grantedAbilities: ['Indestructible'] }),
    { ...creature('old_soldier_token', p2), isToken: true },
    { ...creature('old_counter_token', p2), isToken: true, counters: { '+1/+1': 1 } },
  ];
  const card = { id: 'martial_coup_card', name: 'Martial Coup', type_line: 'Sorcery', mana_cost: '{X}{W}{W}', oracle_text: MARTIAL_COUP_TEXT };
  applyInstantSorceryFracturedIdentityAndFallbackRiders(game, {
    controller: p1,
    card,
    effectiveCard: card,
    item: { id: 'martial_coup_stack', type: 'spell', controller: p1, xValue, card },
    oracleText: MARTIAL_COUP_TEXT,
    oracleTextLower: MARTIAL_COUP_TEXT.toLowerCase(),
    targets: [],
    spellXValue: xValue,
    uncategorizedSpellFallbackApplied: 0,
    oracleIrSpellHandled: false,
  });
  return state;
}

describe('Martial Coup legacy (non-IR) rider', () => {
  const priorSpell = process.env.ORACLE_IR_SPELL_PRIMARY;
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({ to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } } as any);
  });
  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  });
  afterEach(async () => {
    if (priorSpell === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = priorSpell;
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  });

  it('X=5 destroys other creatures including older tokens, spares indestructible ones and the new Soldiers', () => {
    const state = runLegacyRider(5);
    const ids: string[] = state.battlefield.map((p: any) => p.id);
    expect(ids).not.toContain('my_bear');
    expect(ids).not.toContain('their_bear');
    expect(ids).not.toContain('old_soldier_token');
    expect(ids).not.toContain('old_counter_token');
    expect(ids).toContain('their_indestructible');
    expect(ids).toContain('their_equipped_indestructible');
    const soldiers = state.battlefield.filter((p: any) => p.isToken && /soldier/i.test(String(p.card?.name || p.name || '')));
    expect(soldiers).toHaveLength(5);
    expect(state.battlefield).toHaveLength(7);
  });

  it('X=4 makes four Soldiers and destroys nothing', () => {
    const state = runLegacyRider(4);
    const ids: string[] = state.battlefield.map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['my_bear', 'their_bear', 'old_soldier_token', 'old_counter_token']));
    expect(state.battlefield.filter((p: any) => p.isToken && /soldier/i.test(String(p.card?.name || p.name || '')) && !String(p.id).startsWith('old_'))).toHaveLength(4);
  });
});