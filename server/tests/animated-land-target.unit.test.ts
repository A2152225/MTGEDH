import { describe, expect, it } from 'vitest';
import { hasValidTargetsForSpell } from '../src/rules-engine/target-availability.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond-handlers/canRespondCastableSpellCandidates.js';

const murder = {
  id: 'murder',
  name: 'Murder',
  type_line: 'Instant',
  mana_cost: '{1}{B}{B}',
  oracle_text: 'Destroy target creature.',
};

function stateWith(battlefield: any[], hand: any[] = []) {
  return {
    state: {
      priority: 'p1',
      turnPlayer: 'p1',
      phase: 'MAIN1',
      step: 'MAIN',
      stack: [],
      battlefield,
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      zones: { p1: { hand, graveyard: [], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } },
      manaPool: { p1: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } },
    },
  } as any;
}

describe('animated lands and identical tokens', () => {
  it('counts a land that gained creature as a creature target', () => {
    const forest = {
      id: 'forest',
      controller: 'p2',
      card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
      grantedTypes: ['Creature', 'Elemental'],
      basePower: 2,
      baseToughness: 2,
    };
    expect(hasValidTargetsForSpell(stateWith([forest]).state, 'p1', murder)).toBe(true);
  });

  it('does not count an ordinary land as a creature', () => {
    const forest = {
      id: 'forest',
      controller: 'p2',
      card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
    };
    expect(hasValidTargetsForSpell(stateWith([forest]).state, 'p1', murder)).toBe(false);
  });

  it('does not offer a printed land creature as a castable spell', () => {
    const dryad = {
      id: 'dryad',
      name: 'Dryad Arbor',
      type_line: 'Land Creature — Forest Dryad',
      mana_cost: '',
      oracle_text: '(Dryad Arbor isn\'t a spell, it\'s affected by summoning sickness.)',
    };
    const candidates = getCastableSpellCandidates(stateWith([], [dryad]), 'p1', { mode: 'main' });
    expect(candidates.some((candidate) => candidate.card?.name === 'Dryad Arbor')).toBe(false);
  });

  it('still finds Murder once the cost can be paid and a creature exists', () => {
    const bear = {
      id: 'bear',
      controller: 'p2',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const swamps = Array.from({ length: 3 }, (_, index) => ({
      id: `swamp-${index}`,
      controller: 'p1',
      tapped: false,
      card: { name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '{T}: Add {B}.' },
    }));
    const unpaid = getCastableSpellCandidates(stateWith([bear], [murder]), 'p1', { mode: 'main' });
    expect(unpaid.some((candidate) => candidate.card?.name === 'Murder')).toBe(false);
    const paid = getCastableSpellCandidates(stateWith([...swamps, bear], [murder]), 'p1', { mode: 'main' });
    expect(paid.some((candidate) => candidate.card?.name === 'Murder')).toBe(true);
  });

  it('does not walk a sorcery as an instant-speed response', () => {
    const bear = {
      id: 'bear',
      controller: 'p2',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const divination = {
      id: 'divination',
      name: 'Divination',
      type_line: 'Sorcery',
      mana_cost: '{2}{U}',
      oracle_text: 'Draw two cards.',
    };
    const swamps = Array.from({ length: 3 }, (_, index) => ({
      id: `swamp-r-${index}`,
      controller: 'p1',
      tapped: false,
      card: { name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '{T}: Add {B}.' },
    }));
    const islands = Array.from({ length: 3 }, (_, index) => ({
      id: `island-r-${index}`,
      controller: 'p1',
      tapped: false,
      card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '{T}: Add {U}.' },
    }));
    const response = getCastableSpellCandidates(
      stateWith([...swamps, ...islands, bear], [divination, murder]),
      'p1',
      { mode: 'response' },
    );
    expect(response.some((candidate) => candidate.card?.name === 'Divination')).toBe(false);
    expect(response.some((candidate) => candidate.card?.name === 'Murder')).toBe(true);
  });
});
