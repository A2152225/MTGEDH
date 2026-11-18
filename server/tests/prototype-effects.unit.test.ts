import { describe, expect, it } from 'vitest';
import { parsePrototypeInfo } from '../src/state/modules/alternate-costs.js';
import { applyPrototypeOnPermanentEntry } from '../src/state/modules/prototypeEffects.js';

const ARCANE_PROXY_ORACLE =
  'Prototype {1}{U} — 2/1\nWhen this creature enters, if you cast it, look at the top two cards of your library.';

describe('prototype effects', () => {
  it('parses prototype cost and P/T', () => {
    expect(parsePrototypeInfo(ARCANE_PROXY_ORACLE)).toEqual({
      cost: '{1}{U}',
      power: 2,
      toughness: 1,
    });
  });

  it('applies prototype P/T on permanent entry when cast for prototype', () => {
    const permanent: any = {
      id: 'proxy_1',
      controller: 'p1',
      basePower: 4,
      baseToughness: 3,
      effectivePower: 4,
      effectiveToughness: 3,
      card: {
        name: 'Arcane Proxy',
        type_line: 'Artifact Creature — Wizard',
        oracle_text: ARCANE_PROXY_ORACLE,
        power: '4',
        toughness: '3',
        prototypeCostWasPaid: true,
        prototypePower: 2,
        prototypeToughness: 1,
      },
    };

    applyPrototypeOnPermanentEntry(
      { state: { battlefield: [permanent] } } as any,
      permanent,
      'p1',
      'Arcane Proxy',
      { alternateCostId: 'prototype', prototypePower: 2, prototypeToughness: 1 },
    );

    expect(permanent.wasPrototypeCast).toBe(true);
    expect(permanent.basePower).toBe(2);
    expect(permanent.baseToughness).toBe(1);
    expect(permanent.effectivePower).toBe(2);
    expect(permanent.effectiveToughness).toBe(1);
    expect(permanent.card.power).toBe('2');
    expect(permanent.card.toughness).toBe('1');
  });

  it('does not rewrite P/T when prototype was not paid', () => {
    const permanent: any = {
      id: 'proxy_2',
      controller: 'p1',
      basePower: 4,
      baseToughness: 3,
      effectivePower: 4,
      effectiveToughness: 3,
      card: {
        name: 'Arcane Proxy',
        oracle_text: ARCANE_PROXY_ORACLE,
        power: '4',
        toughness: '3',
      },
    };

    applyPrototypeOnPermanentEntry(
      { state: { battlefield: [permanent] } } as any,
      permanent,
      'p1',
      'Arcane Proxy',
      { alternateCostId: 'normal' },
    );

    expect(permanent.basePower).toBe(4);
    expect(permanent.baseToughness).toBe(3);
  });
});
