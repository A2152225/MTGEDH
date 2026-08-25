import { afterEach, describe, expect, it } from 'vitest';
import { tryResolveApproachOfTheSecondSunAfterEffects } from '../src/state/modules/stackResolveSpellZoneUtils.js';

// Quoted from mtg_data.db cards.text WHERE name = 'Approach of the Second Sun' AND is_token = 0.
const APPROACH_ORACLE =
  "If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put Approach of the Second Sun into its owner's library seventh from the top and you gain 7 life.";

function makeApproachFixture(options: {
  namedSpellsCastThisGame?: unknown;
} = {}) {
  const library = Array.from({ length: 10 }, (_, i) => ({ id: `lib_${i}`, name: `Filler ${i}` }));
  const card = {
    id: 'spell_1',
    name: 'Custom Second Dawn',
    type_line: 'Sorcery',
    oracle_text: APPROACH_ORACLE,
  };
  const ctx = {
    state: {
      players: [
        { id: 'p1', name: 'P1', life: 40, library, hand: [], graveyard: [] },
        { id: 'p2', name: 'P2', life: 40, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [],
      stack: [{
        id: 'spell_1',
        controller: 'p1',
        owner: 'p1',
        card,
      }],
      life: { p1: 40, p2: 40 },
      turnNumber: 3,
      zones: {
        p1: { hand: [], library, graveyard: [], exile: [] },
        p2: { hand: [], library: [], graveyard: [], exile: [] },
      },
      ...(options.namedSpellsCastThisGame !== undefined
        ? { namedSpellsCastThisGame: options.namedSpellsCastThisGame }
        : { namedSpellsCastThisGame: { p1: [] } }),
    },
    libraries: new Map([['p1', library], ['p2', []]]),
    bumpSeq: () => {},
  } as any;
  const resolveOptions = {
    controller: 'p1' as const,
    card,
    effectiveCard: card,
    oracleText: APPROACH_ORACLE,
    oracleTextLower: APPROACH_ORACLE.toLowerCase(),
    item: { id: 'spell_1', controller: 'p1', owner: 'p1', card, castFromHand: true, source: 'hand' },
  };
  return { ctx, options: resolveOptions, library };
}

describe('tryResolveApproachOfTheSecondSunAfterEffects under spell IR primary', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('no-ops under PRIMARY so it cannot set winner or insert into library', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const { ctx, options, library } = makeApproachFixture();

    expect(tryResolveApproachOfTheSecondSunAfterEffects(ctx, options)).toBe(false);
    expect(tryResolveApproachOfTheSecondSunAfterEffects(ctx, options)).toBe(false);

    expect(ctx.state.winner).toBeUndefined();
    expect(ctx.state.gameOver).toBeUndefined();
    expect(ctx.state.approachCastHistory).toBeUndefined();
    expect(library).toHaveLength(10);
    expect(library.some((entry: { name?: string }) => entry.name === 'Custom Second Dawn')).toBe(false);
    expect(ctx.state.life.p1).toBe(40);
  });

  it('PRIMARY=0 first-cast otherwise uses IR seventh-from-top + life', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    const { ctx, options } = makeApproachFixture({ namedSpellsCastThisGame: { p1: [] } });

    expect(tryResolveApproachOfTheSecondSunAfterEffects(ctx, options)).toBe(true);

    expect(ctx.state.winner).toBeUndefined();
    expect(ctx.state.gameOver).toBeUndefined();
    expect(ctx.state.approachCastHistory).toBeUndefined();
    expect(ctx.state.life.p1).toBe(47);
    const library = ctx.state.players[0].library as Array<{ id?: string; name?: string }>;
    expect(library[6]).toMatchObject({ id: 'spell_1', name: 'Custom Second Dawn' });
  });

  it('PRIMARY=0 second-cast wins via namedSpellsCastThisGame, not a card-name history table', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    const { ctx, options } = makeApproachFixture({
      namedSpellsCastThisGame: { p1: ['Custom Second Dawn'] },
    });

    expect(tryResolveApproachOfTheSecondSunAfterEffects(ctx, options)).toBe(true);

    expect(ctx.state.winner).toBe('p1');
    expect(ctx.state.gameOver).toBe(true);
  });
});
