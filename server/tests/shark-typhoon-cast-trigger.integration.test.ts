import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-detection.js';
import '../src/state/modules/priority.js';

// Regression for issue #4: casting one noncreature spell with Shark Typhoon out made two
// Shark tokens (its "When you cycle this card" ability also fired) and both were P/T-less.
const SHARK_TYPHOON = "Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.\nCycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, create an X/X blue Shark creature token with flying.";
const STAFF = "When Staff of the Storyteller enters, create a 1/1 white Spirit creature token with flying.\nWhenever you create one or more tokens, put a story counter on Staff of the Storyteller.\n{W}, {T}, Remove a story counter from Staff of the Storyteller: Draw a card.";
const noopIo = () => ({ to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } }) as any;

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Shark Typhoon noncreature cast trigger', () => {
  const prevPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  const gameIds: string[] = [];

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(noopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(async () => {
    if (prevPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = prevPrimary;
    for (const id of gameIds.splice(0)) await resetGame(id);
  });

  it('recognizes the cycle ability but marks it as a cycle trigger, not a cast trigger', () => {
    const triggers = detectSpellCastTriggers({ name: 'Shark Typhoon', oracle_text: SHARK_TYPHOON }, { id: 'shark', controller: 'p1' });
    const cycle = triggers.filter((t) => /cycle this card/i.test(String(t.description || '')));
    expect(cycle).toHaveLength(1);
    expect(cycle[0].triggerEvent).toBe('cycle');
    const cast = triggers.filter((t) => /cast a noncreature spell/i.test(String(t.description || '')));
    expect(cast).toHaveLength(1);
    expect(cast[0].triggerEvent).toBeUndefined();
  });

  for (const mode of ['1', '0']) {
    it(`casting a mana value 2 artifact creates exactly one 2/2 Shark (trigger primary=${mode})`, async () => {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = mode;
      const gameId = `shark_typhoon_cast_${mode}`;
      gameIds.push(gameId);
      await resetGame(gameId);
      createGameIfNotExists(gameId, 'commander', 40);
      const game: any = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');
      const s = game.state;
      const p1 = 'p1';
      const p2 = 'p2';
      s.players = [{ id: p1, name: 'P1', spectator: false, life: 40 }, { id: p2, name: 'P2', spectator: false, life: 40 }];
      s.life = { [p1]: 40, [p2]: 40 };
      s.phase = 'precombatMain'; s.step = 'MAIN1'; s.turnPlayer = p1; s.priority = p1; s.turnNumber = 3;
      s.battlefield = [{
        id: 'shark_perm', controller: p1, owner: p1, tapped: false, counters: {},
        card: { id: 'shark_card', name: 'Shark Typhoon', type_line: 'Enchantment', oracle_text: SHARK_TYPHOON, mana_cost: '{5}{U}', cmc: 6, zone: 'battlefield' },
      }];
      s.zones = {
        [p1]: { hand: [{ id: 'staff_id', name: 'Staff of the Storyteller', type_line: 'Artifact', oracle_text: STAFF, mana_cost: '{1}{W}', cmc: 2 }], handCount: 1, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
        [p2]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      };
      s.manaPool = { [p1]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 1 } };
      s.stack = [];

      const handlers: Record<string, Function> = {};
      const socket: any = { data: { playerId: p1, spectator: false, gameId }, rooms: new Set([gameId]), on: (e: string, f: Function) => { handlers[e] = f; }, emit: () => {} };
      const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s0', socket]]) } };
      registerResolutionHandlers(io, socket);
      registerGameActions(io, socket);

      await handlers['castSpellFromHand']({ gameId, cardId: 'staff_id' });

      const sharkTriggers = (game.state.stack || []).filter((item: any) => item.type === 'triggered_ability' && item.sourceName === 'Shark Typhoon');
      expect(sharkTriggers).toHaveLength(1);
      expect(String(sharkTriggers[0].description)).toMatch(/cast a noncreature spell/i);

      game.resolveTopOfStack();

      const sharks = (game.state.battlefield || []).filter((perm: any) => perm.isToken && perm.card?.name === 'Shark');
      expect(sharks).toHaveLength(1);
      expect(Number(sharks[0].card.power)).toBe(2);
      expect(Number(sharks[0].card.toughness)).toBe(2);
      expect(sharks[0].baseToughness).toBe(2);
    });
  }
});