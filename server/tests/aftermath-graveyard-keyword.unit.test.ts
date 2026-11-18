import { describe, expect, it } from 'vitest';
import { getHandCastEvaluationCards } from '../src/state/modules/can-respond-handlers/canRespondHandCastEvaluation.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond-handlers/canRespondCastableSpellCandidates.js';

const commitMemory = {
  id: 'commit-memory-1',
  name: 'Commit // Memory',
  layout: 'split',
  type_line: 'Instant // Sorcery',
  mana_cost: '{3}{U} // {4}{U}{U}',
  oracle_text: '',
  card_faces: [
    {
      name: 'Commit',
      mana_cost: '{3}{U}',
      type_line: 'Instant',
      oracle_text: 'Put target spell or nonland permanent into its owner\'s library second from the top.',
      colors: ['U'],
    },
    {
      name: 'Memory',
      mana_cost: '{4}{U}{U}',
      type_line: 'Sorcery',
      oracle_text: 'Aftermath (Cast this spell only from your graveyard. Then exile it.)\nEach player shuffles their hand and graveyard into their library, then draws seven cards.',
      colors: ['U'],
    },
  ],
};

function makeCtx(graveyardCard: any) {
  const playerId = 'p1';
  const islands = Array.from({ length: 6 }, (_, i) => ({
    id: `island_${i}`,
    controller: playerId,
    tapped: false,
    card: {
      id: `island_card_${i}`,
      name: 'Island',
      type_line: 'Basic Land — Island',
      oracle_text: '{T}: Add {U}.',
    },
  }));
  return {
    state: {
      priority: playerId,
      turnPlayer: playerId,
      phase: 'MAIN1',
      step: 'MAIN',
      stack: [],
      battlefield: islands,
      players: [{ id: playerId, life: 40 }],
      zones: {
        [playerId]: {
          hand: [],
          graveyard: [graveyardCard],
          exile: [],
          library: [],
        },
      },
      manaPool: {
        [playerId]: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      },
    },
  } as any;
}

describe('aftermath graveyard keyword', () => {
  it('evaluates each split face separately', () => {
    const faces = getHandCastEvaluationCards(commitMemory);
    expect(faces).toHaveLength(2);
    expect(faces[1].name).toBe('Memory');
    expect(faces[1].oracle_text).toMatch(/aftermath/i);
  });

  it('offers only the aftermath half as a GY cast candidate and exiles after', () => {
    const ctx = makeCtx(commitMemory);
    const candidates = getCastableSpellCandidates(ctx, 'p1', { mode: 'main' });
    const aftermath = candidates.filter((c) => c.sourceZone === 'graveyard' && c.castMethod === 'aftermath');
    expect(aftermath.length).toBeGreaterThanOrEqual(1);
    expect(aftermath.every((c) => c.castCard?.name === 'Memory')).toBe(true);
    expect(aftermath.every((c) => c.exileAfterResolution === true)).toBe(true);
    expect(aftermath.every((c) => String(c.manaCost || '').includes('{4}{U}{U}') || String(c.manaCost || '') === '{4}{U}{U}')).toBe(true);
  });
});
