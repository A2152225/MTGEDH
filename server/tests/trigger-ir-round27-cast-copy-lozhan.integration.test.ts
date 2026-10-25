import { beforeAll, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { processSpellCastTriggersForCast } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';

const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
function sock(playerId: string) {
  const handlers: Record<string, Function> = {};
  const socket: any = { data: { playerId, spectator: false }, rooms: new Set<string>(), on: (e: string, h: Function) => { handlers[e] = h; }, emit: () => {} };
  return { socket, handlers };
}
const STOMP_TEXT = "Damage can't be prevented this turn. Stomp deals 2 damage to any target.";
const stomp = () => ({ id: 'bg', name: 'Bonecrusher Giant // Stomp', layout: 'adventure', castAsAdventure: true, type_line: 'Creature - Giant // Instant - Adventure',
  mana_cost: '{2}{R} // {1}{R}', cmc: 3, colors: ['R'], oracle_text: STOMP_TEXT,
  card_faces: [{ name: 'Bonecrusher Giant', type_line: 'Creature - Giant', mana_cost: '{2}{R}' }, { name: 'Stomp', type_line: 'Instant - Adventure', mana_cost: '{1}{R}', oracle_text: STOMP_TEXT }] });

async function setup(gameId: string, perm: any) {
  createGameIfNotExists(gameId, 'commander', 40);
  const g: any = ensureGame(gameId);
  ResolutionQueueManager.removeQueue(gameId);
  g.state.players = [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }];
  g.state.life = { p1: 40, p2: 40 };
  g.state.commandZone = { p2: { commanderIds: ['cmdr_card'] } };
  g.state.battlefield = [perm, { id: 'cmdr', controller: 'p2', owner: 'p2', isCommander: true, card: { id: 'cmdr_card', name: 'Big Commander', type_line: 'Legendary Creature - Giant', power: '5', toughness: '5' } }];
  g.state.stack = [{ id: 'st1', type: 'spell', controller: 'p1', card: stomp(), targets: ['p2'], castAsAdventure: true }];
  processSpellCastTriggersForCast(gameId, g, io, 'p1', stomp(), 'hand' as any, 'st1');
  return g;
}

describe('round 27 cast triggers through the socket path', () => {
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(io); });

  // Copy triggers go on the stack (CR 603.3), so players can respond before the copy exists.
  it('Lucky Clover puts a copy trigger on the stack, then copies the Adventure spell without a you-may prompt', async () => {
    const g = await setup('r27_clover', { id: 'lc', controller: 'p1', owner: 'p1', card: { id: 'lcc', name: 'Lucky Clover', type_line: 'Artifact', oracle_text: 'Whenever you cast an Adventure instant or sorcery spell, copy it. You may choose new targets for the copy.' } });
    expect(g.state.stack.map((s: any) => s.type)).toEqual(['spell', 'triggered_ability']);
    expect(g.state.stack.filter((s: any) => s.isCopy)).toHaveLength(0);
    resolveTopOfStack(g);
    expect(ResolutionQueueManager.getQueue('r27_clover').steps.some((s: any) => s.type === 'option_choice' && s.retargetSpellCopy !== true)).toBe(false);
    expect(g.state.stack.some((s: any) => s.type === 'triggered_ability')).toBe(false);
    expect(g.state.stack.filter((s: any) => s.type === 'spell' && s.isCopy)).toHaveLength(1);
  });

  it('Lozhan deals damage equal to the mana value, never to a commander', async () => {
    const g = await setup('r27_lozhan', { id: 'lz', controller: 'p1', owner: 'p1', card: { id: 'lzc', name: "Lozhan, Dragons' Legacy", type_line: 'Legendary Creature - Dragon Shaman', oracle_text: "Flying\nWhenever you cast an Adventure or Dragon spell, Lozhan deals damage equal to that spell's mana value to any target that isn't a commander." } });
    resolveTopOfStack(g);
    const step: any = ResolutionQueueManager.getQueue('r27_lozhan').steps.find((s: any) => s.type === 'target_selection');
    expect(step).toBeDefined();
    const ids = (step.validTargets || []).map((t: any) => String(t.id ?? t));
    expect(ids).not.toContain('cmdr');
    const { socket, handlers } = sock('p1'); socket.rooms.add('r27_lozhan'); registerResolutionHandlers(io, socket);
    await handlers['submitResolutionResponse']({ gameId: 'r27_lozhan', stepId: String(step.id), selections: ['p2'], cancelled: false });
    for (let i = 0; i < 3 && g.state.stack.some((s: any) => s.type === 'triggered_ability'); i++) resolveTopOfStack(g);
    expect(g.state.players.find((p: any) => p.id === 'p2').life).toBe(38);
  });

  const CHANCELLOR = { id: 'ch', controller: 'p1', owner: 'p1', card: { id: 'chc', name: 'Chancellor of Tales', type_line: 'Creature - Human Advisor', oracle_text: 'Flying\nWhenever you cast an Adventure spell, you may copy it. You may choose new targets for the copy.' } };
  async function answerChancellor(gameId: string, choice: 'yes' | 'no') {
    const g = await setup(gameId, CHANCELLOR);
    expect(g.state.stack.map((s: any) => s.type)).toEqual(['spell', 'triggered_ability']);
    resolveTopOfStack(g);
    const step: any = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s.type === 'option_choice' && s.retargetSpellCopy !== true);
    expect(step).toBeDefined();
    expect((step.options || []).map((o: any) => o.id)).toEqual(expect.arrayContaining(['yes', 'no']));
    expect(g.state.stack.filter((s: any) => s.isCopy)).toHaveLength(0);
    const { socket, handlers } = sock('p1'); socket.rooms.add(gameId); registerResolutionHandlers(io, socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: String(step.id), selections: [choice], cancelled: false });
    return g;
  }

  it('Chancellor of Tales accept path asks, then copies the spell', async () => {
    const g = await answerChancellor('r27_chancellor', 'yes');
    expect(g.state.stack.some((s: any) => s.type === 'triggered_ability')).toBe(false);
    expect(g.state.stack.filter((s: any) => s.type === 'spell' && s.isCopy)).toHaveLength(1);
  });

  it('Chancellor of Tales decline path makes no copy', async () => {
    const g = await answerChancellor('r27_chancellor_no', 'no');
    expect(g.state.stack.filter((s: any) => s.isCopy)).toHaveLength(0);
    expect(g.state.stack.map((s: any) => s.id)).toEqual(['st1']);
  });
});
