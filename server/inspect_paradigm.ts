import { initDb, createGameIfNotExists } from './src/db/index.js';
import { ensureGame } from './src/socket/util.js';
import { ResolutionQueueManager } from './src/state/resolution/index.js';
import './src/state/modules/priority.js';

function buildParadigmCard(playerId: string) {
  return {
    id: 'paradigm_card_1',
    name: 'Germination Practicum',
    mana_cost: '{3}{G}{G}',
    type_line: 'Sorcery — Lesson',
    oracle_text:
      'Put two +1/+1 counters on each creature you control.\nParadigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.)',
    owner: playerId,
    zone: 'exile',
    paradigmActive: true,
    paradigmController: playerId,
  };
}

function seedParadigmTriggerState(game: any, playerId: string) {
  const card = buildParadigmCard(playerId);
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).turnNumber = 3;
  (game.state as any).phase = 'precombat_main';
  (game.state as any).step = 'MAIN1';
  (game.state as any).battlefield = [];
  (game.state as any).stack = [
    {
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: playerId,
      source: 'paradigm_card_1',
      sourceName: 'Germination Practicum',
      description: 'You may cast a copy of Germination Practicum from exile without paying its mana cost.',
      effect: 'You may cast a copy of it from exile without paying its mana cost.',
      triggerType: 'paradigm',
      mandatory: false,
      paradigmCardId: 'paradigm_card_1',
      card: card,
    },
  ];
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [card],
      exileCount: 1,
    },
  };
}

async function run() {
  const gameId = 'inspect_paradigm_game';
  const playerId = 'p1';

  await initDb();
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('Game not found');

  seedParadigmTriggerState(game, playerId);

  console.log('--- Before resolveTopOfStack ---');
  console.log('Stack length:', (game.state as any).stack.length);
  console.log('Exile count:', (game.state as any).zones[playerId].exile.length);

  game.resolveTopOfStack();

  console.log('\n--- After resolveTopOfStack ---');
  const queue = ResolutionQueueManager.getQueue(gameId);
  console.log('Queue steps:', JSON.stringify(queue.steps, null, 2));
  console.log('Exile contents:', JSON.stringify((game.state as any).zones[playerId].exile, (key, value) => {
      if (key === 'oracle_text') return undefined; // Reduce noise
      return value;
  }, 2));
  
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});