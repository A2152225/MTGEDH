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

  it('leaves a bare this-creature clause on the string matcher and requires flying when the phrase has it', () => {
    expect(deathTriggerClauseMatchesDyingCreature(
      ctx,
      'this creature',
      source,
      dying({ id: 'watcher' }),
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
});
