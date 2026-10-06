/**
 * Jace, Multiverse Architect -3 (issues #5 / #6):
 * - "another target planeswalker or creature you control": Jace and opponents' creatures are not legal targets.
 * - exiling one Shark token exiles only that token, not every same-named token.
 * - reveal-until offers only the revealed cards, with the first creature/planeswalker as the only pick,
 *   which goes to the battlefield while the rest go to the bottom.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const JACE_TEXT = "At the beginning of combat on each opponent's turn, they may pay {2}. If they don't, creatures they control can't attack Jaces you control this turn.\n+1: Draw two cards, then put a card from your hand on the bottom of your library.\n\u22123: Exile another target planeswalker or creature you control. Reveal cards from the top of your library until you reveal a creature or planeswalker card. Put that card onto the battlefield and the rest on the bottom of your library in a random order.\nJace, Multiverse Architect can be your commander.";
const noopIo = () => ({ to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } }) as any;
const token = (id: string, name: string, pt: number) => ({
  id, controller: 'p1', owner: 'p1', tapped: false, counters: {}, isToken: true, basePower: pt, baseToughness: pt,
  card: { id, name, type_line: `Token Creature \u2014 ${name}`, oracle_text: 'Flying', power: String(pt), toughness: String(pt), keywords: ['Flying'] },
});

describe('Jace, Multiverse Architect -3', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(noopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  afterEach(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
  });

  for (const mode of ['1', '0']) {
    it(`targets only other permanents you control, exiles one token, reveals until a creature (primary=${mode})`, async () => {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = mode;
      const gameId = `jace_minus3_${mode}`;
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      await deleteGame(gameId);
      createGameIfNotExists(gameId, 'commander', 40);
      const game: any = ensureGame(gameId);
      const s = game.state;
      s.players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }, { id: 'p2', name: 'P2', spectator: false, life: 40 }];
      s.life = { p1: 40, p2: 40 };
      s.phase = 'precombatMain'; s.step = 'MAIN1'; s.turnPlayer = 'p1'; s.priority = 'p1'; s.turnNumber = 5;
      s.battlefield = [
        { id: 'jace', controller: 'p1', owner: 'p1', tapped: false, counters: { loyalty: 5 }, loyalty: 5,
          card: { id: 'jace_card', name: 'Jace, Multiverse Architect', type_line: 'Legendary Planeswalker \u2014 Jace', oracle_text: JACE_TEXT, loyalty: '4' } },
        token('shark_a', 'Shark', 2), token('shark_b', 'Shark', 2), token('spirit_a', 'Spirit', 1),
        { id: 'opp_bear', controller: 'p2', owner: 'p2', tapped: false, counters: {},
          card: { id: 'ob', name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2' } },
      ];
      const library = [
        { id: 'lib_0', name: 'Lib Sorcery 0', type_line: 'Sorcery', zone: 'library' },
        { id: 'lib_1', name: 'Lib Land 1', type_line: 'Land', zone: 'library' },
        { id: 'lib_2', name: 'Bear Cub', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2', zone: 'library' },
        { id: 'lib_3', name: 'Lib Sorcery 3', type_line: 'Sorcery', zone: 'library' },
      ];
      const emptyZones = { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
      s.zones = { p1: { ...emptyZones, library, libraryCount: library.length }, p2: { ...emptyZones, library: [], libraryCount: 0 } };
      game.libraries = new Map([['p1', library.map((card) => ({ ...card }))], ['p2', []]]);
      s.stack = [];

      const handlers: Record<string, Function> = {};
      const errors: any[] = [];
      const socket: any = {
        data: { playerId: 'p1', spectator: false, gameId }, rooms: new Set([gameId]),
        on: (event: string, fn: Function) => { handlers[event] = fn; },
        emit: (event: string, payload: any) => { if (event === 'error') errors.push(payload); },
      };
      const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s0', socket]]) } };
      registerGameActions(io, socket); registerInteractionHandlers(io, socket); registerResolutionHandlers(io, socket);

      await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'jace', abilityId: 'pw-ability-1' });
      const targetStep: any = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step.planeswalkerAbility);
      expect(targetStep).toBeTruthy();
      expect((targetStep.validTargets || []).map((t: any) => t.id).sort()).toEqual(['shark_a', 'shark_b', 'spirit_a']);

      await handlers['submitResolutionResponse']({ gameId, stepId: String(targetStep.id), selections: ['shark_a'] });
      expect(errors).toEqual([]);
      game.resolveTopOfStack();

      expect(game.state.battlefield.map((perm: any) => perm.id)).toEqual(['jace', 'shark_b', 'spirit_a', 'opp_bear']);

      const revealStep: any = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step.type === 'library_search');
      expect(revealStep).toBeTruthy();
      expect((revealStep.availableCards || []).map((card: any) => card.id)).toEqual(['lib_2']);
      expect((revealStep.nonSelectableCards || []).map((card: any) => card.id).sort()).toEqual(['lib_0', 'lib_1']);

      await handlers['submitResolutionResponse']({ gameId, stepId: String(revealStep.id), selections: ['lib_2'] });
      expect(errors).toEqual([]);
      expect(game.state.battlefield.some((perm: any) => perm.id === 'lib_2' || perm.card?.id === 'lib_2')).toBe(true);
      const libraryIds = (game.libraries.get('p1') || []).map((card: any) => card.id);
      expect(libraryIds[0]).toBe('lib_3');
      expect(libraryIds.slice(1).sort()).toEqual(['lib_0', 'lib_1']);
    });
  }
});