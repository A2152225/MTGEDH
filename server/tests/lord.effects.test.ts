/**
 * Test suite for lord effects (creatures that buff other creatures of a certain type)
 * Example: Elvish Archdruid gives other Elf creatures you control +1/+1
 */

import { describe, it, expect } from '@jest/globals';
import { calculateAllPTBonuses } from '../src/state/utils.js';

describe('Lord Effects', () => {
  it('Elvish Archdruid should give +1/+1 to other Elf creatures', () => {
    // Create a simple game state with Elvish Archdruid and another Elf
    const elvishArchdruid = {
      id: 'archdruid-1',
      controller: 'player1',
      card: {
        name: 'Elvish Archdruid',
        type_line: 'Creature — Elf Druid',
        power: '2',
        toughness: '2',
        oracle_text: 'Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.'
      }
    };

    const llanowarElves = {
      id: 'llanowar-1',
      controller: 'player1',
      card: {
        name: 'Llanowar Elves',
        type_line: 'Creature — Elf Druid',
        power: '1',
        toughness: '1',
        oracle_text: '{T}: Add {G}.'
      }
    };

    const gameState = {
      battlefield: [elvishArchdruid, llanowarElves]
    };

    // Calculate bonuses for Llanowar Elves
    const bonuses = calculateAllPTBonuses(llanowarElves, gameState);

    // Llanowar Elves should get +1/+1 from Elvish Archdruid
    expect(bonuses.power).toBe(1);
    expect(bonuses.toughness).toBe(1);
  });

  it('Elvish Archdruid should NOT buff itself', () => {
    const elvishArchdruid = {
      id: 'archdruid-1',
      controller: 'player1',
      card: {
        name: 'Elvish Archdruid',
        type_line: 'Creature — Elf Druid',
        power: '2',
        toughness: '2',
        oracle_text: 'Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.'
      }
    };

    const gameState = {
      battlefield: [elvishArchdruid]
    };

    // Calculate bonuses for Elvish Archdruid itself
    const bonuses = calculateAllPTBonuses(elvishArchdruid, gameState);

    // Should not buff itself
    expect(bonuses.power).toBe(0);
    expect(bonuses.toughness).toBe(0);
  });

  it('Multiple Elvish Archdruids should stack', () => {
    const archdruid1 = {
      id: 'archdruid-1',
      controller: 'player1',
      card: {
        name: 'Elvish Archdruid',
        type_line: 'Creature — Elf Druid',
        power: '2',
        toughness: '2',
        oracle_text: 'Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.'
      }
    };

    const archdruid2 = {
      id: 'archdruid-2',
      controller: 'player1',
      card: {
        name: 'Elvish Archdruid',
        type_line: 'Creature — Elf Druid',
        power: '2',
        toughness: '2',
        oracle_text: 'Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.'
      }
    };

    const llanowarElves = {
      id: 'llanowar-1',
      controller: 'player1',
      card: {
        name: 'Llanowar Elves',
        type_line: 'Creature — Elf Druid',
        power: '1',
        toughness: '1',
        oracle_text: '{T}: Add {G}.'
      }
    };

    const gameState = {
      battlefield: [archdruid1, archdruid2, llanowarElves]
    };

    // Calculate bonuses for Llanowar Elves
    const bonuses = calculateAllPTBonuses(llanowarElves, gameState);

    // Should get +1/+1 from each Archdruid = +2/+2
    expect(bonuses.power).toBe(2);
    expect(bonuses.toughness).toBe(2);
  });

  it('Elvish Archdruid should only buff Elves, not other creature types', () => {
    const elvishArchdruid = {
      id: 'archdruid-1',
      controller: 'player1',
      card: {
        name: 'Elvish Archdruid',
        type_line: 'Creature — Elf Druid',
        power: '2',
        toughness: '2',
        oracle_text: 'Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.'
      }
    };

    const bear = {
      id: 'bear-1',
      controller: 'player1',
      card: {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        power: '2',
        toughness: '2',
        oracle_text: ''
      }
    };

    const gameState = {
      battlefield: [elvishArchdruid, bear]
    };

    // Calculate bonuses for the Bear
    const bonuses = calculateAllPTBonuses(bear, gameState);

    // Should not get any bonus from Archdruid
    expect(bonuses.power).toBe(0);
    expect(bonuses.toughness).toBe(0);
  });

  it('Elvish Archdruid should only buff creatures you control', () => {
    const elvishArchdruid = {
      id: 'archdruid-1',
      controller: 'player1',
      card: {
        name: 'Elvish Archdruid',
        type_line: 'Creature — Elf Druid',
        power: '2',
        toughness: '2',
        oracle_text: 'Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.'
      }
    };

    const opponentElf = {
      id: 'elf-1',
      controller: 'player2',
      card: {
        name: 'Llanowar Elves',
        type_line: 'Creature — Elf Druid',
        power: '1',
        toughness: '1',
        oracle_text: '{T}: Add {G}.'
      }
    };

    const gameState = {
      battlefield: [elvishArchdruid, opponentElf]
    };

    // Calculate bonuses for opponent's Elf
    const bonuses = calculateAllPTBonuses(opponentElf, gameState);

    // Should not buff opponent's creatures
    expect(bonuses.power).toBe(0);
    expect(bonuses.toughness).toBe(0);
  });
});
