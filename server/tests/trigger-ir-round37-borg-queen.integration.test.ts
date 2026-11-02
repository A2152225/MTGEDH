import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import '../src/state/modules/priority.js';

const noopIo = { to: () => ({ emit: () => {} }), emit: () => {} } as any;
const BORG_QUEEN = 'Artifact creatures you control get +2/+0.\nWhen Borg Queen enters, assimilate target creature card from an opponent\'s graveyard. (Put it onto the battlefield under your control with a +1/+1 counter. It\'s a Borg artifact creature and loses all other creature types.)';
const zone = () => ({ hand: [], handCount: 0, graveyard: [] as any[], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 });

describe('round 37: Borg Queen assimilate targets an opponent\'s graveyard', () => {
  const gameId = 'r37_borg_queen';
  const reset = async () => { ResolutionQueueManager.removeQueue(gameId); games.delete(gameId as any); await deleteGame(gameId); };
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(noopIo); });
  beforeEach(reset);
  afterEach(reset);

  it('prompts for a creature card in an opponent\'s graveyard and assimilates the chosen card', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game: any = ensureGame(gameId);
    game.gameId = gameId;
    Object.assign(game.state, { players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }], life: { p1: 40, p2: 40 }, phase: 'main1', step: 'MAIN1', turnPlayer: 'p1', priority: 'p1', stack: [], battlefield: [], zones: { p1: zone(), p2: zone() } });
    game.libraries = new Map([['p1', []], ['p2', []]]);
    const queen = { id: 'queen', controller: 'p1', owner: 'p1', counters: {}, tapped: false, card: { id: 'queen_c', name: 'Borg Queen, Perfection Manifest', type_line: 'Legendary Artifact Creature \u2014 Borg Noble', oracle_text: BORG_QUEEN, power: '1', toughness: '4' } };
    game.state.battlefield.push(queen);
    game.state.zones.p2.graveyard.push({ id: 'opp_bear', owner: 'p2', name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: '', power: '2', toughness: '2', mana_cost: '{1}{G}' });
    game.state.zones.p2.graveyard.push({ id: 'opp_bolt', owner: 'p2', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '', mana_cost: '{R}' });
    game.state.zones.p1.graveyard.push({ id: 'my_bear', owner: 'p1', name: 'Runeclaw Bear', type_line: 'Creature \u2014 Bear', oracle_text: '', power: '2', toughness: '2', mana_cost: '{1}{G}' });
    game.state.zones.p1.graveyardCount = 1; game.state.zones.p2.graveyardCount = 2;

    queueSelfETBTriggersForPermanent(game, queen, 'p1' as any);
    const findStep = () => ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any).find((s: any) => s?.type === ResolutionStepType.GRAVEYARD_SELECTION) as any;
    if (!findStep() && game.state.stack.length) game.resolveTopOfStack();
    const step = findStep();
    expect(step).toBeDefined();
    const ids = step.validTargets.map((t: any) => String(t.id));
    expect(ids).toEqual(['opp_bear']);

    const handlers: Record<string, Function> = {};
    const socket: any = { data: { playerId: 'p1', spectator: false }, rooms: new Set([gameId]), on: (e: string, h: Function) => { handlers[e] = h; }, emit: () => {} };
    const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s0', socket]]) } };
    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);
    await handlers.submitResolutionResponse({ gameId, stepId: step.id, selections: ['opp_bear'] });
    for (let i = 0; i < 3 && game.state.stack.some((s: any) => s.type === 'triggered_ability'); i += 1) game.resolveTopOfStack();

    const bear = game.state.battlefield.find((p: any) => String(p?.card?.id || '') === 'opp_bear');
    expect(bear).toBeDefined();
    expect(bear.controller).toBe('p1');
    expect(Number(bear.counters?.['+1/+1'] || 0)).toBe(1);
    expect(game.state.zones.p2.graveyard.some((c: any) => c.id === 'opp_bear')).toBe(false);
    expect(game.state.zones.p1.graveyard.some((c: any) => c.id === 'my_bear')).toBe(true);
  });
});
