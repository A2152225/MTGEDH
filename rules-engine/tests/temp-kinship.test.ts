import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR, applyOracleIRStepsToGameState } from '../src/index.js';

describe('Kinship Simulation', () => {
  it('should run positive kinship case', () => {
    const kinshipText = 'At the beginning of your upkeep, you may look at the top card of your library. If it shares a creature type with {this}, you may reveal it. If you do, each opponent loses 1 life.';
    const result = parseOracleTextToIR(kinshipText, 'Winnower Patrol');
    const ability = result.abilities[0];

    const player1 = 'p1';
    const player2 = 'p2';
    const gameState: any = {
      players: [
        {
          id: player1,
          library: [{ id: 'c2', name: 'Heritage Druid', type_line: 'Creature - Elf Druid' }],
          graveyard: [],
          hand: [],
          life: 20,
        },
        { id: player2, library: [], graveyard: [], hand: [], life: 20 },
      ],
      battlefield: [
        {
          id: 'wp-source',
          name: 'Winnower Patrol',
          controller: player1,
          ownerId: player1,
          type_line: 'Creature - Elf Warrior',
          card: { id: 'wp-card', name: 'Winnower Patrol', oracle_text: kinshipText, type_line: 'Creature - Elf Warrior' },
          power: 3,
          toughness: 2,
        },
      ],
      stack: [],
      activePlayer: player1,
      logs: [],
      automationGaps: []
    };

    const context: any = {
      sourceId: 'wp-source',
      controllerId: player1,
      targets: {}
    };

    const runResult = applyOracleIRStepsToGameState(gameState, ability.steps, context, {
      allowOptional: true,
    });
    
    const applied = (runResult as any).appliedSteps.map((s: any) => s.kind);
    const skipped = (runResult as any).skippedSteps.map((s: any) => s.kind);
    const opponent = (runResult as any).state.players.find((player: any) => player.id === player2);

    expect(applied).toEqual(['look_top', 'grant_static_ability', 'lose_life']);
    expect(skipped).toEqual([]);
    expect(opponent?.life).toBe(19);
  });
});
