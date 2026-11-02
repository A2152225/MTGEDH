import { beforeAll, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { queueDiscardTriggeredAbilities } from '../src/state/modules/triggers/discard.js';

const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const PI_TEXT = 'This turn, whenever a spell or ability an opponent controls causes you to discard a card, return that card from your graveyard to your hand at the beginning of the next end step.\nWhen a spell or ability an opponent controls causes you to discard Pure Intentions, return Pure Intentions from your graveyard to your hand at the beginning of the next end step.';
const pi = () => ({ id: 'pi', name: 'Pure Intentions', type_line: 'Instant - Arcane', mana_cost: '{W}', cmc: 1, oracle_text: PI_TEXT });

function setup(gameId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const g: any = ensureGame(gameId);
  ResolutionQueueManager.removeQueue(gameId);
  g.state.players = [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }];
  g.state.battlefield = [];
  g.state.turnNumber = 3;
  g.state.zones = { p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 }, p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 } };
  g.state.stack = [{ id: 'st_pi', type: 'spell', controller: 'p1', card: pi(), targets: [] }];
  resolveTopOfStack(g);
  return g;
}
const discard = (g: any, cause: string) => {
  const card = { id: 'gb', name: 'Grizzly Bears', type_line: 'Creature - Bear', zone: 'graveyard', owner: 'p1' };
  g.state.zones.p1.graveyard.push(card); g.state.zones.p1.graveyardCount = g.state.zones.p1.graveyard.length;
  return queueDiscardTriggeredAbilities(g, 'p1', [card], { causeControllerId: cause });
};

describe('round 29 Pure Intentions spell-created discard trigger', () => {
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(io); });

  it('triggers this turn on an opponent-caused discard and schedules the return', () => {
    const g = setup('r29_pi_a');
    expect((g.state.turnScopedSpellTriggers || []).length).toBe(1);
    const queued = discard(g, 'p2');
    expect(queued).toHaveLength(1);
    expect(queued[0].effectData.discardedCardId).toBe('gb');
    resolveTopOfStack(g);
    const delayed = Object.values((g.state.delayedTriggerRegistry?.triggers) || {}) as any[];
    const inHand = g.state.zones.p1.hand.some((c: any) => c.id === 'gb');
    expect(inHand).toBe(false);
    expect(delayed.some((d: any) => /end step|end_step/i.test(String(d.timing || d.effect || '') + JSON.stringify(d)))).toBe(true);
  });

  it('ignores self-caused discards and expires at end of turn', () => {
    const g = setup('r29_pi_b');
    expect(discard(g, 'p1')).toHaveLength(0);
    g.state.turnNumber = 4;
    expect(discard(g, 'p2')).toHaveLength(0);
  });
});
