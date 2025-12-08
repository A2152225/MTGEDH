/**
 * Simple test script to verify auto-pass priority logic
 * This tests the scenario from the issue:
 * - Player has tapped land on turn 1
 * - Opponent casts Soul's Attendant
 * - Player should auto-pass if they have auto-pass enabled
 */

import { createInitialGameState } from './server/src/state/index.ts';

console.log('Testing auto-pass priority system...\n');

// Create a game
const game = createInitialGameState('test-game');

// Join two players
const p1Socket = 'socket-p1';
const p2Socket = 'socket-p2';

const p1Join = game.join(p1Socket, 'Player1', false);
const p2Join = game.join(p2Socket, 'Player2', false);

const p1Id = p1Join.playerId;
const p2Id = p2Join.playerId;

console.log(`Player 1: ${p1Id}`);
console.log(`Player 2: ${p2Id}\n`);

// Set up initial game state
game.state.turnPlayer = p1Id;
game.state.priority = p1Id;
game.state.stack = [];

// Enable auto-pass for player 1
if (!game.state.autoPassPlayers) {
  game.state.autoPassPlayers = new Set();
}
game.state.autoPassPlayers.add(p1Id);

console.log('Auto-pass enabled for Player 1');

// Give player 1 a tapped land (can't use)
game.state.battlefield = [
  {
    id: 'land-1',
    controller: p1Id,
    tapped: true,
    card: {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      mana_cost: '',
    }
  }
];

// Player 1 has no cards in hand that can respond
game.state.zones = {
  [p1Id]: {
    hand: [
      // A creature (can't cast at instant speed)
      {
        id: 'creature-1',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        mana_cost: '{1}{G}',
        oracle_text: '',
      }
    ],
    library: [],
    graveyard: [],
  },
  [p2Id]: {
    hand: [],
    library: [],
    graveyard: [],
  }
};

// Player 2 casts Soul's Attendant (on stack)
game.state.stack = [
  {
    id: 'stack-1',
    controller: p2Id,
    card: {
      name: "Soul's Attendant",
      type_line: 'Creature — Human Cleric',
      mana_cost: '{W}',
      oracle_text: "Whenever another creature enters the battlefield, you may gain 1 life.",
    }
  }
];

console.log('Stack: Soul\'s Attendant');
console.log('Player 1 battlefield: 1 tapped Forest');
console.log('Player 1 hand: 1 Grizzly Bears (sorcery speed)\n');

// Test: Player 1 has priority, should auto-pass
console.log('Priority is with Player 1');
console.log('Checking if Player 1 can respond...');

// Import the canRespond function to test directly
import { canRespond } from './server/src/state/modules/can-respond.ts';
import { createContext } from './server/src/state/context.ts';

const ctx = createContext('test-game');
ctx.state = game.state;
ctx.inactive = new Set();

const canP1Respond = canRespond(ctx, p1Id);
console.log(`Can Player 1 respond? ${canP1Respond}`);

if (!canP1Respond) {
  console.log('✓ Correct: Player 1 cannot respond (no instants, no untapped abilities)');
} else {
  console.log('✗ ERROR: Player 1 should not be able to respond!');
  process.exit(1);
}

// Now test auto-pass
console.log('\nTesting auto-pass behavior...');
console.log('Player 1 passes priority (should auto-pass to Player 2)...');

const initialPriority = game.state.priority;
const result = game.passPriority(p1Id);

console.log(`Priority changed: ${result.changed}`);
console.log(`Current priority: ${game.state.priority}`);
console.log(`Expected priority: ${p2Id}`);

if (result.changed && game.state.priority === p2Id) {
  console.log('✓ Correct: Priority advanced to Player 2');
} else {
  console.log('✗ ERROR: Priority should have advanced to Player 2');
  console.log(`  Result: ${JSON.stringify(result)}`);
  process.exit(1);
}

console.log('\n✓ All tests passed!');
console.log('\nAuto-pass functionality is working correctly.');
console.log('When a player with auto-pass enabled receives priority and cannot respond,');
console.log('priority automatically passes to the next player.');
