import { describe, it, expect } from 'vitest';
import { evaluateSpellValue } from '../src/aiEngineSpellSupport';

describe('AI Fog Spell Casting Heuristics Evaluation', () => {
  const mockDeps = {
    getProcessedBattlefield: (gameState: any) => gameState.battlefield || [],
    hasPermanentType: (perm: any, type: string) => {
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      return typeLine.includes(type.toLowerCase());
    },
  };

  const fogCard = {
    name: 'Fog',
    type_line: 'Instant',
    oracle_text: 'Prevent all combat damage that would be dealt this turn.',
    cmc: 1,
  };

  it('should penalize casting Fog when there are no creatures on the battlefield at all', () => {
    const gameState = {
      turn: 3,
      battlefield: [], // empty battlefield
    };

    const value = evaluateSpellValue(fogCard, gameState, 'player1', mockDeps);
    // Base is 0; isFog logic runs: no attackers -> penalty -15
    // Net value should be negative
    expect(value).toBeLessThan(0);
  });

  it('should penalize casting Fog when creatures exist but none are attacking', () => {
    const gameState = {
      turn: 3,
      battlefield: [
        {
          id: 'creature1',
          controller: 'player2',
          attacking: undefined, // not attacking
          card: {
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
          },
        },
      ],
    };

    const value = evaluateSpellValue(fogCard, gameState, 'player1', mockDeps);
    // Grizzly Bears not attacking -> penalty -15
    expect(value).toBeLessThan(0);
  });

  it('should prioritize/highly evaluate Fog when creatures are attacking the AI player', () => {
    const gameState = {
      turn: 3,
      battlefield: [
        {
          id: 'creature1',
          controller: 'player2',
          attacking: 'player1', // Attacking the AI
          card: {
            name: 'Colossal Dreadmaw',
            type_line: 'Creature — Dinosaur',
            power: '6',
            toughness: '6',
          },
        },
      ],
    };

    const value = evaluateSpellValue(fogCard, gameState, 'player1', mockDeps);
    // Attacking me with power 6 (between 4 and 10), gives +8 bonus. Net value should be highly positive.
    expect(value).toBeGreaterThan(5);
  });

  it('should give extremepriority to Fog when lethal power is attacking the AI', () => {
    const gameState = {
      turn: 4,
      battlefield: [
        {
          id: 'creature1',
          controller: 'player2',
          attacking: 'player1', // Attacking the AI
          card: {
            name: 'Apex Altisaur',
            type_line: 'Creature — Dinosaur',
            power: '10',
            toughness: '10',
          },
        },
      ],
    };

    const value = evaluateSpellValue(fogCard, gameState, 'player1', mockDeps);
    // Attacking me with power 10, gives +12 bonus.
    expect(value).toBeGreaterThan(10);
  });

  it('treats an attack on the AI planeswalker as attacking the AI', () => {
    const gameState = {
      turn: 3,
      battlefield: [
        {
          id: 'pw1',
          controller: 'player1',
          card: { name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace' },
        },
        {
          id: 'creature1',
          controller: 'player2',
          attacking: 'pw1',
          card: {
            name: 'Colossal Dreadmaw',
            type_line: 'Creature — Dinosaur',
            power: '6',
            toughness: '6',
          },
        },
      ],
    };

    const value = evaluateSpellValue(fogCard, gameState, 'player1', mockDeps);
    expect(value).toBeGreaterThan(5);
  });
});
