import { describe, expect, it } from 'vitest';

import {
  applyOpponentDamageReplacement,
  detectPreventDamageMillReplacementForController,
  millAllOpponentsForController,
  resolveCombatDamageToOpponent,
  resolveOpponentDirectedDamage,
} from '../src/state/modules/game-state-effects.js';

function makeCtx(overrides?: {
  players?: { id: string; hasLost?: boolean }[];
  battlefield?: any[];
  libraries?: Map<string, any[]>;
}) {
  const p1 = 'p1';
  const p2 = 'p2';
  const players = overrides?.players ?? [
    { id: p1, hasLost: false },
    { id: p2, hasLost: false },
  ];
  const libraries =
    overrides?.libraries ??
    new Map<string, any[]>([
      [p1, []],
      [p2, [{ id: 'c1', name: 'Top' }, { id: 'c2', name: 'Second' }, { id: 'c3', name: 'Third' }]],
    ]);

  return {
    state: {
      players,
      zones: {
        [p1]: { library: [], graveyard: [], libraryCount: 0, graveyardCount: 0 },
        [p2]: { library: [], graveyard: [], libraryCount: 3, graveyardCount: 0 },
      },
      battlefield: overrides?.battlefield ?? [],
    },
    libraries,
  } as any;
}

describe('Mindskinner non-combat damage replacement', () => {
  const mindskinnerOracle =
    'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills cards equal to the amount of damage prevented this way.';

  it('detects Mindskinner on controller battlefield', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'ms1',
          controller: 'p1',
          card: { name: 'The Mindskinner', oracle_text: mindskinnerOracle },
        },
      ],
    });

    const detected = detectPreventDamageMillReplacementForController(ctx, 'p1', {
      nonCombatOnly: true,
    });
    expect(detected?.sourceName).toBe('The Mindskinner');
    expect(detected?.effect.preventsDamage).toBe(true);
    expect(detected?.effect.millAllOpponents).toBe(true);
  });

  it('detects unnamed prevent-and-mill oracle without card-name routing', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'ms1',
          controller: 'p1',
          card: { name: 'Generic Nightmare', oracle_text: mindskinnerOracle },
        },
      ],
    });

    const detected = detectPreventDamageMillReplacementForController(ctx, 'p1', {
      nonCombatOnly: true,
    });
    expect(detected?.sourceName).toBe('Generic Nightmare');
    expect(detected?.effect.preventsDamage).toBe(true);
    expect(detected?.effect.millAllOpponents).toBe(true);
    expect(detected?.effect.appliesToNonCombatDamage).toBe(true);
  });

  it('prevents non-combat damage to an opponent and mills each opponent', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'ms1',
          controller: 'p1',
          card: { name: 'The Mindskinner', oracle_text: mindskinnerOracle },
        },
        {
          id: 'shock1',
          controller: 'p1',
          card: { name: 'Shock', type_line: 'Instant' },
        },
      ],
    });

    const result = applyOpponentDamageReplacement(ctx, {
      sourceControllerId: 'p1',
      targetPlayerId: 'p2',
      damageAmount: 2,
      sourceCard: { name: 'Shock' },
    });

    expect(result.prevented).toBe(true);
    expect(result.damageDealt).toBe(0);
    expect(result.millAmount).toBe(2);
    expect(ctx.libraries.get('p2')?.length).toBe(1);
  });

  it('mills via shared helper for combat path', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'ms1',
          controller: 'p1',
          card: { name: 'The Mindskinner', oracle_text: mindskinnerOracle },
        },
      ],
    });

    const milled = millAllOpponentsForController(ctx, 'p1', 2);
    expect(milled).toEqual([{ opponentId: 'p2', milled: 2 }]);
    expect(ctx.libraries.get('p2')?.length).toBe(1);
  });

  it('does not apply when damage target is not an opponent', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'ms1',
          controller: 'p1',
          card: { name: 'The Mindskinner', oracle_text: mindskinnerOracle },
        },
      ],
    });

    const result = applyOpponentDamageReplacement(ctx, {
      sourceControllerId: 'p1',
      targetPlayerId: 'p1',
      damageAmount: 3,
    });

    expect(result.prevented).toBe(false);
    expect(result.damageDealt).toBe(3);
    expect(result.effectsApplied).toHaveLength(0);
  });

  it('applies damage modifiers before prevent-and-mill replacement (616.1 chain)', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'doubler',
          controller: 'p1',
          card: {
            name: 'Anonymous Marauders',
            oracle_text:
              'If a source you control would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.',
          },
        },
        {
          id: 'ms1',
          controller: 'p1',
          card: { name: 'The Mindskinner', oracle_text: mindskinnerOracle },
        },
      ],
    });

    const result = resolveOpponentDirectedDamage(ctx, {
      sourceControllerId: 'p1',
      targetPlayerId: 'p2',
      damageAmount: 2,
    });

    expect(result.preReplacementAmount).toBe(4);
    expect(result.damageDealt).toBe(0);
    expect(result.prevented).toBe(true);
    expect(result.millAmount).toBe(4);
    expect(ctx.libraries.get('p2')?.length).toBe(0);
  });

  it('applies combat damage modifiers before prevent-and-mill replacement', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'doubler',
          controller: 'p1',
          card: {
            name: 'Anonymous Marauders',
            oracle_text:
              'If a source you control would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.',
          },
        },
        {
          id: 'ms1',
          controller: 'p1',
          card: { name: 'The Mindskinner', oracle_text: mindskinnerOracle },
        },
      ],
    });

    const result = resolveCombatDamageToOpponent(ctx, {
      attackerCard: { name: 'Attacker', type_line: 'Creature' },
      attackerPermanent: { id: 'attacker_1', controller: 'p1' },
      attackerController: 'p1',
      damageAmount: 2,
      defendingPlayerId: 'p2',
    });

    expect(result.preReplacementAmount).toBe(4);
    expect(result.damageDealt).toBe(0);
    expect(result.prevented).toBe(true);
    expect(result.millAmount).toBe(4);
    expect(ctx.libraries.get('p2')?.length).toBe(0);
  });
});

describe('source-self combat damage replacement (Szadek family)', () => {
  const szadekOracle =
    'Flying\nIf this creature would deal combat damage to a player, instead put that many +1/+1 counters on it and that player mills that many cards.';

  it('replaces the source\'s combat damage with +1/+1 counters and mills only that player', () => {
    const ctx = makeCtx({
      players: [
        { id: 'p1', hasLost: false },
        { id: 'p2', hasLost: false },
        { id: 'p3', hasLost: false },
      ],
      battlefield: [
        {
          id: 'szadek_1',
          controller: 'p1',
          card: { name: 'Generic Secret Lord', oracle_text: szadekOracle },
          counters: {},
        },
      ],
      libraries: new Map<string, any[]>([
        ['p1', []],
        ['p2', [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }]],
        ['p3', [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }]],
      ]),
    });
    ctx.state.zones.p3 = { library: [], graveyard: [], libraryCount: 3, graveyardCount: 0 };

    const attacker = ctx.state.battlefield[0];
    const result = resolveCombatDamageToOpponent(ctx, {
      attackerCard: attacker.card,
      attackerPermanent: attacker,
      attackerController: 'p1',
      damageAmount: 3,
      defendingPlayerId: 'p2',
    });

    expect(result.damageDealt).toBe(0);
    expect(result.prevented).toBe(true);
    expect(result.plusOneCountersOnSource).toBe(3);
    expect(result.millTargets).toEqual(['p2']);
    expect(attacker.counters?.['+1/+1']).toBe(3);
    expect(ctx.libraries.get('p2')?.length).toBe(1);
    expect(ctx.libraries.get('p3')?.length).toBe(3);
  });

  it('does not replace combat damage from another creature you control', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'szadek_1',
          controller: 'p1',
          card: { name: 'Generic Secret Lord', oracle_text: szadekOracle },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    });

    const bear = ctx.state.battlefield[1];
    const result = resolveCombatDamageToOpponent(ctx, {
      attackerCard: bear.card,
      attackerPermanent: bear,
      attackerController: 'p1',
      damageAmount: 2,
      defendingPlayerId: 'p2',
    });

    expect(result.prevented).toBe(false);
    expect(result.damageDealt).toBe(2);
    expect(result.plusOneCountersOnSource).toBeUndefined();
    expect(ctx.libraries.get('p2')?.length).toBe(3);
  });

  it('is not detected as a controller-wide prevent-and-mill replacement', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'szadek_1',
          controller: 'p1',
          card: { name: 'Generic Secret Lord', oracle_text: szadekOracle },
        },
      ],
    });

    expect(detectPreventDamageMillReplacementForController(ctx, 'p1', { nonCombatOnly: true })).toBeNull();
    expect(detectPreventDamageMillReplacementForController(ctx, 'p1')).toBeNull();
  });
});
