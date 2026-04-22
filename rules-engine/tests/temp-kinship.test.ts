import { describe, it } from 'vitest';
import { parseOracleTextToIR, applyOracleIRStepsToGameState } from '../src/index.js';

describe('Kinship Simulation', () => {
  it('should run positive kinship case', () => {
    const kinshipText = 'At the beginning of your upkeep, you may look at the top card of your library. If it shares a creature type with {this}, you may reveal it. If you do, each opponent loses 1 life.';
    const result = parseOracleTextToIR(kinshipText, 'Winnower Patrol');
    const ability = result.abilities[0];

    const player1 = 'p1';
    const player2 = 'p2';
    const gameState: any = {
      players: { 
        [player1]: { id: player1, library: ['c2'], graveyard: [], hand: [], life: 20 }, 
        [player2]: { id: player2, library: [], graveyard: [], hand: [], life: 20 } 
      },
      permanents: { 
        'p1': { id: 'p1', name: 'Winnower Patrol', controller: player1, owner: player1, types: ['Creature'], subTypes: ['Elf', 'Warrior'], power: 3, toughness: 2 } 
      },
      cards: { 
        'p1': { id: 'p1', name: 'Winnower Patrol', oracle_text: kinshipText, type_line: 'Creature — Elf Warrior' },
        'c2': { id: 'c2', name: 'Heritage Druid', type_line: 'Creature — Elf Druid', types: ['Creature'], subTypes: ['Elf', 'Druid'] }
      },
      stack: [],
      activePlayer: player1,
      logs: [],
      automationGaps: []
    };

    const context: any = {
      sourceId: 'p1',
      controllerId: player1,
      targets: {}
    };

    const runResult = applyOracleIRStepsToGameState(gameState, ability.steps, context, {
        autoApproveOptional: true,
        autoApproveModal: true
    });
    
    const applied = (runResult as any).appliedSteps.map((s: any) => s.kind);
    const skipped = (runResult as any).skippedSteps.map((s: any) => s.kind);

    console.log('Applied:', JSON.stringify(applied));
    console.log('Skipped:', JSON.stringify(skipped));
    console.log('Gaps:', (runResult as any).automationGaps.length);
    console.log('Logs:', JSON.stringify((runResult as any).log));
    console.log('Source Permanent:', JSON.stringify((runResult as any).state.permanents['p1']));
  });
});
