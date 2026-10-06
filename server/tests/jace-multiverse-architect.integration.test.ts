import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { games } from '../src/socket/socket.js';

// Regression coverage for Jace, Multiverse Architect (issues #2 and #3).
const JACE_TEXT = "At the beginning of combat on each opponent's turn, they may pay {2}. If they don't, creatures they control can't attack Jaces you control this turn.\n+1: Draw two cards, then put a card from your hand on the bottom of your library.\n\u22123: Exile another target planeswalker or creature you control. Reveal cards from the top of your library until you reveal a creature or planeswalker card. Put that card onto the battlefield and the rest on the bottom of your library in a random order.\nJace, Multiverse Architect can be your commander.";
const TRIGGER_TEXT = "they may pay {2}. If they don't, creatures they control can't attack Jaces you control this turn.";
const PLUS_ONE_TEXT = 'Draw two cards, then put a card from your hand on the bottom of your library.';
const p1 = 'p1' as any;
const p2 = 'p2' as any;

function mockSocketPair(playerId: string, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (ev: string, fn: Function) => { handlers[ev] = fn; },
    emit: () => {},
  } as any;
  const io = {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    sockets: { sockets: new Map([['s_0', socket]]) },
  } as any;
  registerResolutionHandlers(io, socket);
  return handlers;
}

function setupJaceGame(gameId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game: any = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const s = game.state;
  s.players = [
    { id: p1, name: 'P1', spectator: false, life: 40 },
    { id: p2, name: 'P2', spectator: false, life: 40 },
  ];
  s.turnNumber = 5; s.phase = 'precombatMain'; s.step = 'MAIN1';
  s.turnPlayer = p1; s.activePlayer = p1; s.priority = p1;
  s.battlefield = [{
    id: 'jace', controller: p1, owner: p1, tapped: false, counters: { loyalty: 5 }, loyalty: 5,
    card: { id: 'jace_card', name: 'Jace, Multiverse Architect', type_line: 'Legendary Planeswalker \u2014 Jace', oracle_text: JACE_TEXT, loyalty: '4' },
  }];
  const library = Array.from({ length: 6 }, (_, i) => ({ id: `lib_${i}`, name: `Lib ${i}`, type_line: 'Sorcery', oracle_text: '', zone: 'library' }));
  game.libraries = new Map([[p1, library], [p2, []]]);
  s.zones = {
    [p1]: { hand: [{ id: 'h1', name: 'Hand One', type_line: 'Instant', oracle_text: '', zone: 'hand' }], handCount: 1, libraryCount: 6, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    [p2]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
  };
  return game;
}

describe('Jace, Multiverse Architect regressions', () => {
  const prevPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  const gameIds: string[] = [];

  async function reset(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => { await initDb(); });
  beforeEach(() => { gameIds.length = 0; });
  afterEach(async () => {
    if (prevPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = prevPrimary;
    for (const id of gameIds) await reset(id);
  });

  for (const mode of ['1', '0']) {
    it(`+1 draws exactly two, then asks for one hand card to put on the bottom (trigger primary=${mode})`, async () => {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = mode;
      const gameId = `jace_plus_one_${mode}`;
      gameIds.push(gameId);
      await reset(gameId);
      const game = setupJaceGame(gameId);
      game.state.stack = [{
        id: 'ability_plus_one', type: 'ability', controller: p1, source: 'jace', sourceName: 'Jace, Multiverse Architect',
        description: PLUS_ONE_TEXT, activatedAbilityText: `+1: ${PLUS_ONE_TEXT}`,
        planeswalker: { abilityIndex: 0, loyaltyCost: 1 },
      }];

      game.resolveTopOfStack();

      const hand = game.state.zones[p1].hand;
      expect(hand.map((c: any) => c.id).sort()).toEqual(['h1', 'lib_0', 'lib_1']);
      const steps = ResolutionQueueManager.getQueue(gameId)?.steps || [];
      expect(steps.some((s: any) => s.type === ResolutionStepType.LIBRARY_SEARCH)).toBe(false);
      const prompts = steps.filter((s: any) => s.moveChosenHandCardToLibraryChoice === true);
      expect(prompts).toHaveLength(1);
      const prompt: any = prompts[0];
      expect(prompt.playerId).toBe(p1);
      expect(prompt.mandatory).toBe(true);
      expect(prompt.moveChosenHandCardToLibraryPosition).toBe('bottom');
      expect(prompt.options.map((o: any) => o.id).sort()).toEqual(['h1', 'lib_0', 'lib_1']);

      const handlers = mockSocketPair(p1, gameId);
      await handlers['submitResolutionResponse']({ gameId, stepId: prompt.id, selections: 'lib_0' });

      const library = game.libraries.get(p1) || [];
      expect(library[library.length - 1]?.id).toBe('lib_0');
      expect(library).toHaveLength(5);
      expect(game.state.zones[p1].hand.map((c: any) => c.id).sort()).toEqual(['h1', 'lib_1']);
    });
  }

  it('asks the opponent whose turn it is (not Jace\'s controller) whether to pay {2}', async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 'jace_combat_tax_prompt';
    gameIds.push(gameId);
    await reset(gameId);
    const game = setupJaceGame(gameId);
    const s = game.state;
    s.turnPlayer = p2; s.activePlayer = p2; s.priority = p2; s.phase = 'combat'; s.step = 'BEGIN_COMBAT';
    s.manaPool = { [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 } };
    s.stack = [{
      id: 'jace_combat_trigger', type: 'triggered_ability', controller: p1, source: 'jace', sourceName: 'Jace, Multiverse Architect',
      description: TRIGGER_TEXT, effect: TRIGGER_TEXT, triggerType: 'begin_combat', mandatory: true, triggeringPlayer: p2,
    }];

    game.resolveTopOfStack();

    const steps = ResolutionQueueManager.getQueue(gameId)?.steps || [];
    const mayChoice: any = steps.find((step: any) => step.type === ResolutionStepType.OPTION_CHOICE && /may pay \{2\}/i.test(String(step.description || '')));
    expect(mayChoice).toBeTruthy();
    expect(mayChoice.playerId).toBe(p2);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1).some((step: any) => /may pay \{2\}/i.test(String(step.description || '')))).toBe(false);

    const completed = ResolutionQueueManager.completeStep(gameId, String(mayChoice.id), {
      stepId: String(mayChoice.id), playerId: p2, selections: ['yes'], cancelled: false, timestamp: Date.now(),
    } as any);
    expect(completed).toBeTruthy();
    resumeEffectProgramResolution({ game, gameId, step: completed!, response: completed!.response!, persistPrompt: true } as any);

    expect(game.state.manaPool[p2].colorless).toBe(1);
  });
});