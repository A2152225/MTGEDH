import { describe, expect, it } from 'vitest';
import { deathTriggerClauseMatchesDyingCreature } from '../src/state/modules/triggers/death-emission-helpers.js';

const ctx = { state: { battlefield: [] } } as any;

function dying(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dying',
    controller: 'p1',
    card: {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
    },
    ...overrides,
  };
}

const source = { id: 'watcher', controller: 'p1', card: { name: 'Blood Artist' } };

describe('deathTriggerClauseMatchesDyingCreature trigger-condition IR', () => {
  it('uses the shared matcher for a fully parsed dies subject', () => {
    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'another creature you control',
      source,
      dying(),
      'p1',
    )).toBe(true);

    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'another creature you control',
      source,
      dying({ id: 'watcher' }),
      'p1',
    )).toBe(false);

    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'a creature an opponent controls',
      source,
      dying(),
      'p1',
    )).toBe(false);

    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'a creature an opponent controls',
      source,
      dying(),
      'p2',
    )).toBe(true);
  });

  it('matches a bare this-creature dies clause only for that permanent', () => {
    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'this creature',
      source,
      dying({ id: 'watcher' }),
      'p1',
    )).toBe(true);
    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'this creature',
      source,
      dying({ id: 'other' }),
      'p1',
    )).toBe(false);

    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'a creature with flying',
      source,
      dying(),
      'p1',
    )).toBe(false);

    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'a creature with flying',
      source,
      dying({ keywords: ['flying'] }),
      'p1',
    )).toBe(true);
  });

  it('uses effective power and toughness instead of the printed numbers', () => {
    const pumped = dying({
      effectivePower: 5,
      effectiveToughness: 1,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' },
    });
    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'a creature with power 4 or greater',
      source,
      pumped,
      'p1',
    )).toBe(true);
    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'a creature with toughness 2 or greater',
      source,
      pumped,
      'p1',
    )).toBe(false);
  });
});
