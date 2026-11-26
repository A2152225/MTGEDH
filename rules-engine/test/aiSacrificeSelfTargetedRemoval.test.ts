import { describe, expect, it } from 'vitest';
import type { BattlefieldPermanent } from '../../shared/src';
import { evaluateActivatedAbilityValue } from '../src/aiEngineActivatedAbilitySupport';
import { SynergyArchetype } from '../src/CardAnalyzer';

const ABILITY = '{G}, Sacrifice this creature: Exile target noncreature artifact or noncreature enchantment.';

const deps = {
  getPrimaryArchetypes: () => [SynergyArchetype.LANDFALL] as const,
  hasPotentialManaSink: () => false,
  getProcessedBattlefield: (state: { battlefield?: BattlefieldPermanent[] }) => state.battlefield || [],
};

function perm(partial: Partial<BattlefieldPermanent> & { id: string }): BattlefieldPermanent {
  return { controller: 'p2', ...partial } as BattlefieldPermanent;
}

function state(battlefield: BattlefieldPermanent[]) {
  return {
    turnPlayer: 'p1',
    phase: 'main1',
    step: 'precombat_main',
    players: [{ id: 'p1' }, { id: 'p2' }],
    battlefield,
  } as any;
}

const mite = perm({
  id: 'mite',
  controller: 'p1',
  card: {
    id: 'mite',
    name: 'Haywire Mite',
    type_line: 'Artifact Creature — Insect',
    oracle_text: ABILITY,
  },
});

describe('sacrifice-self targeted removal', () => {
  it('does not score Haywire Mite when the only artifact is a mana rock', () => {
    const value = evaluateActivatedAbilityValue(
      mite,
      ABILITY,
      state([
        mite,
        perm({
          id: 'sol-ring',
          card: {
            id: 'sol-ring',
            name: 'Sol Ring',
            type_line: 'Artifact',
            oracle_text: '{T}: Add {C}{C}.',
          },
        }),
      ]),
      'p1',
      {} as any,
      deps,
    );
    expect(value).toBe(0);
  });

  it('scores Haywire Mite when an opponent has a value engine to exile', () => {
    const value = evaluateActivatedAbilityValue(
      mite,
      ABILITY,
      state([
        mite,
        perm({
          id: 'rhystic',
          card: {
            id: 'rhystic',
            name: 'Rhystic Study',
            type_line: 'Enchantment',
            oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
          },
        }),
      ]),
      'p1',
      {} as any,
      deps,
    );
    expect(value).toBeGreaterThan(0);
  });

  it('does not destroy your own Sol Ring', () => {
    const value = evaluateActivatedAbilityValue(
      mite,
      '{1}, {T}: Destroy target artifact.',
      state([
        mite,
        perm({
          id: 'sol-ring',
          controller: 'p1',
          card: {
            id: 'sol-ring',
            name: 'Sol Ring',
            type_line: 'Artifact',
            oracle_text: '{T}: Add {C}{C}.',
          },
        }),
      ]),
      'p1',
      {} as any,
      deps,
    );
    expect(value).toBe(0);
  });

  it('does not score Haywire Mite against an artifact creature', () => {
    const value = evaluateActivatedAbilityValue(
      mite,
      ABILITY,
      state([
        mite,
        perm({
          id: 'thopter',
          card: {
            id: 'thopter',
            name: 'Ornithopter',
            type_line: 'Artifact Creature — Thopter',
            oracle_text: 'Flying',
          },
        }),
      ]),
      'p1',
      {} as any,
      deps,
    );
    expect(value).toBe(0);
  });
});
