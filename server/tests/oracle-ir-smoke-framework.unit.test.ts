import { describe, expect, it } from 'vitest';

import {
  check,
  findStep,
  finishSoak,
  hasKind,
  hasVoteTail,
  kindsOf,
  liveSoakBaseUrl,
  liveCastRequestForCard,
  parseSmokeArgs,
  scopedOmitsOtherEffects,
  slug,
  summarizeSoaks,
  unknownRaws,
} from '../scripts/soak/oracleIrSmokeHelpers.js';

describe('oracle IR smoke framework helpers', () => {
  it('records expected vs actual checks', () => {
    expect(check('pBudget', 5, 5, true)).toEqual({ id: 'pBudget', expected: 5, actual: 5, pass: true });
    expect(check('missing', true, false, false, 'gap').note).toBe('gap');
  });

  it('walks nested IR steps for kinds / unknown / find', () => {
    const steps = [
      { kind: 'choose_mode', modes: [{ steps: [{ kind: 'draw', raw: 'Draw a card.' }] }] },
      { kind: 'unknown', raw: 'do a flip' },
    ];
    expect(kindsOf(steps)).toEqual(['choose_mode', 'unknown']);
    expect(hasKind(steps, 'draw')).toBe(true);
    expect(findStep(steps, 'draw')?.raw).toBe('Draw a card.');
    expect(unknownRaws(steps)).toEqual(['do a flip']);
  });

  it('treats non-vote follow-ons as vote tails', () => {
    expect(hasVoteTail([{ kind: 'vote' }, { kind: 'exile' }])).toBe(true);
    expect(hasVoteTail([{ kind: 'vote' }, { kind: 'grant_static_ability' }])).toBe(false);
  });

  it('isolates scoped mode effects by full line, not shared prefixes', () => {
    const scoped = 'Mill four cards. You may put up to two creature and/or land cards from among the milled cards into your hand.';
    const selected = scoped;
    const other = 'You may put up to two creature cards from your hand onto the battlefield.';
    expect(scopedOmitsOtherEffects(scoped, selected, [other])).toBe(true);
    expect(scopedOmitsOtherEffects(`${scoped}\n${other}`, selected, [other])).toBe(false);
  });

  it('slugs card names and summarizes soak results', () => {
    expect(slug("Urza's Command")).toBe('urza-s-command');
    const soak = finishSoak('demo', 'A', 'Demo', [
      { name: 'Opt', found: true, abilityTypes: [], spellStepKinds: [], allStepKinds: [], checks: [check('ok', 1, 1, true)], telemetryEvents: [], pass: true },
      { name: 'Fail', found: true, abilityTypes: [], spellStepKinds: [], allStepKinds: [], checks: [check('bad', 1, 0, false)], telemetryEvents: [], pass: false },
    ]);
    expect(soak.pass).toBe(false);
    expect(summarizeSoaks([soak])).toMatchObject({ cardsPassed: 1, cardsTotal: 2, checksPassed: 1, checksFailed: 1 });
  });

  it('parses CLI args', () => {
    const args = parseSmokeArgs(['--suite', 'edh-readiness', '--url', 'http://127.0.0.1:3001/api/oracle-ir/telemetry', '--out', 'scripts/out']);
    expect(args.suite).toBe('edh-readiness');
    expect(args.url).toContain('/api/oracle-ir/telemetry');
    expect(args.outDir).toBe('scripts/out');
    expect(parseSmokeArgs(['--list']).list).toBe(true);
    expect(parseSmokeArgs(['--live']).live).toBe(true);
    expect(parseSmokeArgs(['--suite', 'edh-readiness']).live).toBe(false);
    expect(liveSoakBaseUrl('http://127.0.0.1:3001/api/oracle-ir/telemetry')).toBe('http://127.0.0.1:3001');
  });

  it('merges soak-level and per-card live injection', () => {
    const request = liveCastRequestForCard(
      {
        playerCount: 3,
        setup: 'main',
        action: 'mill',
        millCount: 3,
        inject: [{ name: 'Island', controller: 'human' }],
        perCard: {
          'Bruvac the Grandiloquent': {
            inject: [{ name: 'Bruvac the Grandiloquent', controller: 'human' }],
            expect: { millOpponentExact: 6 },
          },
        },
      },
      'Bruvac the Grandiloquent',
    );
    expect(request.action).toBe('mill');
    expect(request.millCount).toBe(3);
    expect(request.inject.map((entry) => entry.name)).toEqual(['Island', 'Bruvac the Grandiloquent']);
    expect(request.expect?.millOpponentExact).toBe(6);
  });
});
