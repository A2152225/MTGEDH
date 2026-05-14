import { createGameIfNotExists, deleteGame, getEvents, initDb } from './server/src/db/index.js';
import { registerGameActions } from './server/src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from './server/src/socket/resolution.js';
import { games } from './server/src/socket/socket.js';
import { ensureGame } from './server/src/socket/util.js';
import { ResolutionQueueManager } from './server/src/state/resolution/index.js';
import './server/src/state/modules/priority.js';

function createMockIo(emitted: any[]) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: any[]) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function runReproduction() {
  await initDb();
  initializePriorityResolutionHandler(createMockIo([]) as any);

  const gameId = 'repro_skyclave_shade';
  const turnPlayer = 'p1';

  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame failed');

  const shade = {
    id: 'shade_1',
    name: 'Skyclave Shade',
    mana_cost: '{1}{B}',
    manaCost: '{1}{B}',
    cmc: 2,
    type_line: 'Creature — Shade',
    oracle_text: 'Kicker {2}{B}\nSkyclave Shade cannot block.\nLandfall — Whenever a land enters the battlefield under your control, if Skyclave Shade is in your graveyard, you may cast it from your graveyard this turn.',
    colors: ['B'],
    rarity: 'rare',
    abilities: [
      { type: 'Static', text: 'Skyclave Shade cannot block.' },
      {
        type: 'Triggered',
        text: 'Landfall — Whenever a land enters the battlefield under your control, if Skyclave Shade is in your graveyard, you may cast it from your graveyard this turn.',
        trigger: { type: 'Landfall' },
        zone: ['graveyard']
      }
    ]
  };

  const swamp = {
    id: 'swamp_1',
    name: 'Swamp',
    type_line: 'Basic Land — Swamp',
    colors: [],
  };

  (game.state as any).turnNumber = 11;
  (game.state as any).turn = 11;
  (game.state as any).turnPlayer = turnPlayer;
  (game.state as any).activePlayer = turnPlayer;
  (game.state as any).priority = 'p1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).phase = 'precombatMain';
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).landsPlayedThisTurn = { p1: 0, p2: 0 };
  (game.state as any).manaPool = {
    p1: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 1 },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    p1: {
      hand: [swamp],
      handCount: 1,
      library: [],
      libraryCount: 0,
      graveyard: [shade],
      graveyardCount: 1,
      exile: [],
      exileCount: 0,
    },
    p2: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
  };

  (game as any).libraries = new Map([['p1', []], ['p2', []]]);

  const emitted: any[] = [];
  const io = createMockIo(emitted);
  const { socket, handlers } = createMockSocket('p1', gameId, emitted);
  registerGameActions(io as any, socket as any);
  registerResolutionHandlers(io as any, socket as any);

  console.log('--- Action: Play Swamp ---');
  await handlers['playLand']({ gameId, cardId: 'swamp_1', fromZone: 'hand' });

  const stack = (game.state as any).stack || [];
  console.log('Stack after playLand:', JSON.stringify(stack, null, 2));

  console.log('--- Action: Resolve Landfall Trigger ---');
  game.resolveTopOfStack();

  const queue = ResolutionQueueManager.getQueue(gameId);
  const optionalStep = (queue?.steps || []).find((step: any) => step?.effectProgramPrompt === true || step?.optionalTriggeredAbilityPrompt === true);
  
  if (optionalStep) {
    console.log('Queued Prompt Summary:', JSON.stringify(optionalStep, null, 2));

    console.log('--- Action: Submit YES Response ---');
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(optionalStep.id),
      selections: ['yes'],
      cancelled: false,
    });

    console.log('State.playableFromGraveyard:', JSON.stringify((game.state as any).playableFromGraveyard || {}, null, 2));

    const p1Graveyard = (game.state as any).zones?.p1?.graveyard || [];
    console.log('P1 Graveyard Cards:', JSON.stringify(p1Graveyard, null, 2));

    const updatedQueue = ResolutionQueueManager.getQueue(gameId);
    console.log('Queue steps after YES:', JSON.stringify(updatedQueue?.steps || [], null, 2));
  } else {
    console.log('No optional prompt found in queue!');
  }

  await deleteGame(gameId);
}

runReproduction().catch(console.error);

