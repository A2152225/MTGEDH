import { parseOracleTextToIR } from './src/index';
import { applyOracleIRStepsToGameState } from './src/executor';

const oracle = 'When you cast this spell, exile cards from the top of your library until you exile a nonland card whose mana value is less than this spell\'s mana value. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order.';
const parsed = parseOracleTextToIR(oracle, 'Bloodbraid Elf');
const steps = parsed.abilities[0].steps;

const gameState = {
  players: {
    p1: {
      id: 'p1',
      library: [
        { id: 'c1', name: 'Land', type: 'Land', manaValue: 0 },
        { id: 'c2', name: 'Spell 5', type: 'Instant', manaValue: 5 },
        { id: 'c3', name: 'Spell 2', type: 'Instant', manaValue: 2 },
        { id: 'c4', name: 'Bottom', type: 'Instant', manaValue: 1 }
      ],
      exile: [],
      hand: [],
      graveyard: [],
      battlefield: []
    }
  }
};

const result = applyOracleIRStepsToGameState(gameState as any, steps, { controllerId: 'p1', referenceSpellManaValue: 4 });

console.log('Applied Steps:', JSON.stringify(result.appliedSteps, null, 2));
console.log('Skipped Steps:', JSON.stringify(result.skippedSteps, null, 2));
console.log('P1 Library:', JSON.stringify(result.gameState.players.p1.library.map((c: any) => c.name)));
console.log('P1 Exile:', JSON.stringify(result.gameState.players.p1.exile.map((c: any) => c.name)));
