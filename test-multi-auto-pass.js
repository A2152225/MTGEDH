/**
 * Test multi-player auto-pass scenario
 * Tests the new requirement: "if player B passes in that scenario - it would go to 
 * player C, or move to next step/phase, if no actions can be taken"
 */

import { createInitialGameState } from './server/src/state/index.ts';
import { canRespond } from './server/src/state/modules/can-respond.ts';
import { createContext } from './server/src/state/context.ts';

console.log('Testing multi-player auto-pass priority system...\n');

// Create a game with 3 players
const game = createInitialGameState('test-game-3p');

const p1Join = game.join('socket-p1', 'Player1', false);
const p2Join = game.join('socket-p2', 'Player2', false);
const p3Join = game.join('socket-p3', 'Player3', false);

const p1Id = p1Join.playerId;
const p2Id = p2Join.playerId;
const p3Id = p3Join.playerId;

console.log(`Player 1: ${p1Id}`);
console.log(`Player 2: ${p2Id}`);
console.log(`Player 3: ${p3Id}\n`);

// Set up initial game state
game.state.turnPlayer = p1Id;
game.state.priority = p1Id;
game.state.stack = [];

// Enable auto-pass for players 1 and 2 (but not 3)
if (!game.state.autoPassPlayers) {
  game.state.autoPassPlayers = new Set();
}
game.state.autoPassPlayers.add(p1Id);
game.state.autoPassPlayers.add(p2Id);

console.log('Auto-pass enabled for Player 1 and Player 2');
console.log('Auto-pass DISABLED for Player 3\n');

// Set up battlefield with tapped lands for players 1 and 2
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
  },
  {
    id: 'land-2',
    controller: p2Id,
    tapped: true,
    card: {
      name: 'Island',
      type_line: 'Basic Land — Island',
      oracle_text: '{T}: Add {U}.',
      mana_cost: '',
    }
  },
  {
    id: 'land-3',
    controller: p3Id,
    tapped: false, // Player 3 has untapped land
    card: {
      name: 'Mountain',
      type_line: 'Basic Land — Mountain',
      oracle_text: '{T}: Add {R}.',
      mana_cost: '',
    }
  }
];

// All players have no instant-speed cards
game.state.zones = {
  [p1Id]: {
    hand: [],
    library: [],
    graveyard: [],
  },
  [p2Id]: {
    hand: [],
    library: [],
    graveyard: [],
  },
  [p3Id]: {
    hand: [],
    library: [],
    graveyard: [],
  }
};

// Something on the stack
game.state.stack = [
  {
    id: 'stack-1',
    controller: p1Id,
    card: {
      name: 'Lightning Bolt',
      type_line: 'Instant',
      mana_cost: '{R}',
      oracle_text: "Lightning Bolt deals 3 damage to any target.",
    }
  }
];

console.log('Stack: Lightning Bolt');
console.log('Player 1: Tapped Forest, empty hand');
console.log('Player 2: Tapped Island, empty hand');
console.log('Player 3: Untapped Mountain, empty hand\n');

// Test scenario: Player 1 passes priority
console.log('=== Test 1: Player 1 auto-passes to Player 2 ===');
console.log('Player 1 has priority and passes...');

const ctx = createContext('test-game-3p');
ctx.state = game.state;
ctx.inactive = new Set();
ctx.passesInRow = { value: 0 };
ctx.bumpSeq = () => {};

const canP1Respond = canRespond(ctx, p1Id);
console.log(`Can Player 1 respond? ${canP1Respond}`);

if (!canP1Respond) {
  console.log('✓ Player 1 cannot respond');
} else {
  console.log('✗ ERROR: Player 1 should not be able to respond!');
  process.exit(1);
}

const result1 = game.passPriority(p1Id);
console.log(`Priority after P1 passes: ${game.state.priority}`);

// With auto-pass enabled for both P1 and P2, it should skip through both
// and land on P3 who can respond
if (game.state.priority === p3Id) {
  console.log('✓ Priority moved directly to Player 3');
  console.log('  (auto-passed through P1 and P2 in one call!)\n');
} else {
  console.log(`✗ ERROR: Expected priority to be with Player 3, got ${game.state.priority}`);
  process.exit(1);
}

// Test scenario: Player 2 also auto-passes to Player 3
console.log('=== Test 2: Verify Player 2 was checked ===');
console.log('Player 2 should have been checked and auto-passed...');

const canP2Respond = canRespond(ctx, p2Id);
console.log(`Can Player 2 respond? ${canP2Respond}`);

if (!canP2Respond) {
  console.log('✓ Player 2 cannot respond (was correctly identified)');
  console.log('✓ Auto-pass skipped through P2 to reach P3\n');
} else {
  console.log('✗ ERROR: Player 2 should not be able to respond!');
  process.exit(1);
}

// Player 3 can respond (has untapped land with tap ability)
console.log('=== Test 3: Player 3 can respond (has untapped land) ===');
const canP3Respond = canRespond(ctx, p3Id);
console.log(`Can Player 3 respond? ${canP3Respond}`);

if (canP3Respond) {
  console.log('✓ Player 3 CAN respond (has untapped Mountain with tap ability)');
  console.log('✓ Auto-pass correctly stopped at a player who can respond\n');
} else {
  console.log('✗ ERROR: Player 3 should be able to respond (has untapped mana source)!');
  process.exit(1);
}

console.log('=== Test 4: All players pass - advance step/phase ===');

// Now test what happens when all players pass with empty stack
game.state.stack = []; // Clear stack
game.state.priority = p1Id;
game.state.priorityPassedBy = new Set();

console.log('Stack is now empty');
console.log('Player 1 passes...');
const resultEmpty1 = game.passPriority(p1Id);
console.log(`Priority: ${game.state.priority}, advanceStep: ${resultEmpty1.advanceStep}`);

console.log('Player 2 passes...');
const resultEmpty2 = game.passPriority(p2Id);
console.log(`Priority: ${game.state.priority}, advanceStep: ${resultEmpty2.advanceStep}`);

console.log('Player 3 passes...');
const resultEmpty3 = game.passPriority(p3Id);
console.log(`Priority: ${game.state.priority}, advanceStep: ${resultEmpty3.advanceStep}`);

if (resultEmpty3.advanceStep) {
  console.log('✓ All players passed with empty stack - step advances!');
} else {
  console.log('✗ ERROR: Expected advanceStep to be true after all players pass with empty stack');
  process.exit(1);
}

console.log('\n✓ All tests passed!');
console.log('\nAuto-pass correctly handles:');
console.log('1. Single player auto-passing to next player');
console.log('2. Multiple players auto-passing in sequence');
console.log('3. Stopping at a player who CAN respond');
console.log('4. Advancing step when all players pass with empty stack');
