import { initDb, createGameIfNotExists, deleteGame } from './src/db/index.js';
import GameManager from './src/GameManager.js';
import { registerGameActions } from './src/socket/game-actions.js';
import { games } from './src/socket/socket.js';
import { ensureGame } from './src/socket/util.js';
import { ResolutionQueueManager } from './src/state/resolution/index.js';

function createMockIo(emitted: any[], sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])), 
    },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: any[]) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, gameId, spectator: false },
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
  const gameId = 'appa_repro_game';
  
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).priority = 'p1';
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
  };

  (game.state as any).battlefield = [
    {
      id: 'appa_1',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'appa_card',
        name: 'Appa, Steadfast Guardian',
        type_line: 'Legendary Creature — Bison Ally',
        oracle_text: 'Flash\nFlying\nWhenever you cast a spell from exile, create a 1/1 white Ally creature token.',
      },
    },
  ];
  (game.state as any).playableFromExile = { p1: { exile_spell_1: 999 } };
  (game.state as any).zones.p1.exile = [
    {
      id: 'exile_spell_1',
      name: 'Exile Insight',
      mana_cost: '',
      manaCost: '{0}',
      type_line: 'Sorcery',
      oracle_text: 'Draw a card.',
      zone: 'exile',
    },
  ];
  (game.state as any).zones.p1.exileCount = 1;

  const emitted: any[] = [];
  const { socket, handlers } = createMockSocket('p1', gameId, emitted);
  const io = createMockIo(emitted, [socket]);
  registerGameActions(io as any, socket as any);

  await handlers['castSpellFromHand']({
    gameId: gameId,
    cardId: 'exile_spell_1',
    fromZone: 'exile',
    targets: [],
  });

  console.log('--- REPRODUCTION RESULTS ---');
  console.log('Emitted Error Codes:', emitted.filter(e => e.event === 'error').map(e => e.payload?.code || e.payload));
  console.log('Battlefield Permanent Names:', (game.state as any).battlefield.map((p: any) => p.card?.name || p.name));
  console.log('Stack items count:', (game.state as any).stack.length); console.log('Stack Card IDs:';   console.log('Stack Card IDs:', (game.state as any).stack.map((s: any) => s.card?.name || s.id)); -replace 'console.log\('Exile IDs:','console.log('Hand content:', (game.state as any).zones.p1.hand.map((c: any) => c.name)); console.log('Exile IDs:'', (game.state as any).stack.map((s: any) => s.card?.name || s.id));
  console.log('Exile IDs:', (game.state as any).zones.p1.exile.map((c: any) => c.id));
  
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
  process.exit(0);
}

runReproduction().catch(err => {
  console.error(err);
  process.exit(1);
});
