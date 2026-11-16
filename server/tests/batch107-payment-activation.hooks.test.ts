import { describe, expect, it } from 'vitest';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { parseDrawRevealDiscardCreatureUnlessPayLife } from '../src/state/modules/batch107Parsers.js';
import { applyBreathstealerAfterDraw, getBreathstealerDrawRevealTax, BREATHSTEALER_PAY_OR_DISCARD_FLAG } from '../src/state/modules/breathstealersCryptDrawReveal.js';
import { tryHandleBreathstealerPayOrDiscard } from '../src/socket/resolution-handlers/breathstealerPayOrDiscardHandler.js';
import { payLifeAmount } from '../src/state/modules/batch97PayLife.js';
import { playersCannotPayLifeToCastOrActivateNonMana } from '../src/state/modules/karnsSylexPayLifeRestriction.js';
import { mayPlayCardExiledWithValgavoth, getValgavothExileCastLifeCost } from '../src/state/modules/valgavothExilePlay.js';
import { shouldUseValgavothExileLifeCost } from '../src/socket/game-actions-handlers/valgavothExileCastPayment.js';
import { mayCastDraugrIceExileCard, canPayManaCostWithSnowAsAny, draugrSnowSpendApplies, recolorSnowPoolToMeetCost } from '../src/state/modules/draugrExileSnowSpend.js';
import { cardAllowsPlayerToPlayFromExile } from '../src/state/modules/playable-from-exile.js';
import { LATE_BATCH_OTHER_SYSTEMS_B107 } from '../scripts/static-replacement-census-classify-late-batches-b107.js';

const CRYPT = "If a player would draw a card, instead they draw a card and reveal it. If it's a creature card, that player discards it unless they pay 3 life.";
const VALGAVOTH = "Flying, lifelink\nWard—Sacrifice three nonland permanents.\nIf a card you didn't control would be put into an opponent's graveyard from anywhere, exile it instead.\nDuring your turn, you may play cards exiled with Valgavoth. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.";
const DRAUGR = "If a nontoken creature an opponent controls would die, exile that card with an ice counter on it instead.\nYou may cast spells from among cards in exile your opponents own with ice counters on them, and you may spend mana from snow sources as though it were mana of any color to cast those spells.";
const SYLEX = "Karn's Sylex enters the battlefield tapped.\nPlayers can't pay life to cast spells or to activate abilities that aren't mana abilities.\n{X}, {T}, Exile Karn's Sylex: Destroy each nonland permanent with mana value X or less.";

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    card: {
      id: `${id}-card`,
      name,
      oracle_text: oracle,
      type_line: extra.type_line || 'Legendary Creature',
    },
    ...extra,
  };
}

function emptyPool() {
  return { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
}

describe("B107 Breathstealer's Crypt draw-reveal pay-or-discard", () => {
  it('parses the pay-life tax and queues a prompt only for revealed creature draws', () => {
    expect(parseDrawRevealDiscardCreatureUnlessPayLife(CRYPT)).toEqual({ payLife: 3 });
    const state = {
      battlefield: [perm('crypt', 'p1', "Breathstealer's Crypt", CRYPT, { type_line: 'Enchantment' })],
      zones: { p1: { hand: [] } },
      turnNumber: 1,
    };
    expect(getBreathstealerDrawRevealTax(state)?.payLife).toBe(3);
    const creature = { id: 'c1', name: 'Bear', type_line: 'Creature — Bear' };
    const land = { id: 'l1', name: 'Island', type_line: 'Basic Land — Island' };
    const ctx = { state, gameId: 'test_breathstealer_unit' };
    ResolutionQueueManager.removeQueue('test_breathstealer_unit');
    expect(applyBreathstealerAfterDraw(ctx, 'p1', [land, creature])).toBe(1);
    expect(creature.revealedOnDraw).toEqual(["Breathstealer's Crypt"]);
    expect(land.revealedOnDraw).toEqual(["Breathstealer's Crypt"]);
    const step = ResolutionQueueManager.getStepsForPlayer('test_breathstealer_unit', 'p1' as any)
      .find((entry: any) => entry?.[BREATHSTEALER_PAY_OR_DISCARD_FLAG] === true);
    expect(step).toBeDefined();
    expect(Number((step as any).amount)).toBe(3);
    expect(String((step as any).cardId)).toBe('c1');
    ResolutionQueueManager.removeQueue('test_breathstealer_unit');
  });

  it('pays through payLifeAmount without a Sylex ban, or discards when the player declines', async () => {
    const crypt = perm('crypt', 'p1', "Breathstealer's Crypt", CRYPT, { type_line: 'Enchantment' });
    const sylex = perm('sylex', 'p1', "Karn's Sylex", SYLEX, { type_line: 'Legendary Artifact' });
    const state: any = {
      battlefield: [crypt, sylex],
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      zones: { p1: { hand: [{ id: 'c1', name: 'Bear', type_line: 'Creature — Bear' }], graveyard: [] } },
    };
    expect(playersCannotPayLifeToCastOrActivateNonMana(state, 'p1')).toBe(true);
    expect(payLifeAmount(state, 'p1', 3).paid).toBe(true);
    expect(state.life.p1).toBe(37);

    const game: any = {
      state: {
        battlefield: [crypt],
        players: [{ id: 'p1', name: 'P1', life: 40 }],
        life: { p1: 40 },
        zones: { p1: { hand: [{ id: 'c2', name: 'Bear', type_line: 'Creature — Bear' }], graveyard: [] } },
      },
    };
    const io = { to: () => ({ emit: () => {} }), emit: () => {} } as any;
    const step = {
      id: 's1',
      [BREATHSTEALER_PAY_OR_DISCARD_FLAG]: true,
      amount: 3,
      cardId: 'c2',
      cardName: 'Bear',
      sourceName: "Breathstealer's Crypt",
    } as any;
    await tryHandleBreathstealerPayOrDiscard(io, game, 'g1', step, { playerId: 'p1', selections: ['pay'] } as any);
    expect(game.state.life.p1).toBe(37);
    expect(game.state.zones.p1.hand.some((card: any) => card.id === 'c2')).toBe(true);

    game.state.life.p1 = 40;
    await tryHandleBreathstealerPayOrDiscard(io, game, 'g1', step, { playerId: 'p1', selections: ['discard'] } as any);
    expect(game.state.zones.p1.hand.some((card: any) => card.id === 'c2')).toBe(false);
    expect((game.state.zones.p1.graveyard || []).some((card: any) => card.id === 'c2' || card.name === 'Bear')).toBe(true);
  });
});

describe('B107 Valgavoth play from exile by paying life', () => {
  it('allows playing a card exiled with Valgavoth on your turn and prices a spell at its mana value in life', () => {
    const valg = perm('valg', 'p1', 'Valgavoth, Terror Eater', VALGAVOTH);
    const spell = {
      id: 'ex1',
      name: 'Shock',
      type_line: 'Instant',
      mana_cost: '{R}',
      mana_value: 1,
      cmc: 1,
      exiledWith: 'valg',
      owner: 'p2',
    };
    const land = { id: 'ex2', name: 'Mountain', type_line: 'Basic Land — Mountain', exiledWith: 'valg', owner: 'p2' };
    const state = { turnPlayer: 'p1', turnNumber: 3, battlefield: [valg], zones: { p2: { exile: [spell, land] } } };
    expect(mayPlayCardExiledWithValgavoth(state, 'p1', spell)).toBe(true);
    expect(cardAllowsPlayerToPlayFromExile(spell, 'p1', 3, state)).toBe(true);
    expect(getValgavothExileCastLifeCost(state, 'p1', spell)).toBe(1);
    expect(shouldUseValgavothExileLifeCost(state, 'p1', spell)).toBe(1);
    expect(getValgavothExileCastLifeCost(state, 'p1', land)).toBeNull();
    expect(mayPlayCardExiledWithValgavoth({ ...state, turnPlayer: 'p2' }, 'p1', spell)).toBe(false);
  });

  it("blocks Valgavoth's life alternate via payLifeAmount when Karn's Sylex is in play", () => {
    const valg = perm('valg', 'p1', 'Valgavoth, Terror Eater', VALGAVOTH);
    const sylex = perm('sylex', 'p1', "Karn's Sylex", SYLEX, { type_line: 'Legendary Artifact' });
    const state: any = {
      turnPlayer: 'p1',
      battlefield: [valg, sylex],
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
    };
    expect(playersCannotPayLifeToCastOrActivateNonMana(state, 'p1')).toBe(true);
    expect(payLifeAmount(state, 'p1', 1, { forSpellOrNonManaAbility: true }).paid).toBe(false);
    expect(state.life.p1).toBe(40);
  });
});

describe('B107 Draugr ice-exile snow mana as any color', () => {
  it('lets you cast an opponent-owned ice-countered exile card and spend snow mana as any color', () => {
    const draugr = perm('dr', 'p1', 'Draugr Necromancer', DRAUGR, { type_line: 'Snow Creature — Zombie Cleric' });
    const card = {
      id: 'ex3',
      name: 'Counterspell',
      type_line: 'Instant',
      mana_cost: '{U}{U}',
      owner: 'p2',
      counters: { ice: 1 },
    };
    const state = { turnPlayer: 'p1', turnNumber: 4, battlefield: [draugr], zones: { p2: { exile: [card] } } };
    expect(mayCastDraugrIceExileCard(state, 'p1', card)).toBe(true);
    expect(draugrSnowSpendApplies(state, 'p1', card)).toBe(true);
    expect(cardAllowsPlayerToPlayFromExile(card, 'p1', 4, state)).toBe(true);
    expect(mayCastDraugrIceExileCard(state, 'p1', { ...card, counters: {} })).toBe(false);
    expect(mayCastDraugrIceExileCard(state, 'p1', { ...card, owner: 'p1' })).toBe(false);

    const pool = { ...emptyPool(), red: 2 };
    const snow = { ...emptyPool(), red: 2 };
    const parsed = { colors: { U: 2 }, generic: 0 };
    expect(canPayManaCostWithSnowAsAny(pool, parsed, snow)).toBe(true);
    expect(canPayManaCostWithSnowAsAny(pool, parsed, emptyPool())).toBe(false);
    expect(canPayManaCostWithSnowAsAny({ ...emptyPool(), red: 2, blue: 1 }, parsed, { ...emptyPool(), red: 1 })).toBe(true);
    expect(recolorSnowPoolToMeetCost(pool, parsed, snow)).toMatchObject({ blue: 2, red: 0 });
  });
});

describe('B107 census classify marks Breathstealer, Valgavoth, and Draugr handled', () => {
  it('lists the three live payment systems under LATE_BATCH_OTHER_SYSTEMS_B107', () => {
    const labels = LATE_BATCH_OTHER_SYSTEMS_B107.map(([label]) => label.toLowerCase());
    expect(labels.some((label) => label.includes('breathstealer'))).toBe(true);
    expect(labels.some((label) => label.includes('valgavoth'))).toBe(true);
    expect(labels.some((label) => label.includes('draugr'))).toBe(true);
    const oracles = [CRYPT, VALGAVOTH, DRAUGR];
    for (const oracle of oracles) {
      expect(LATE_BATCH_OTHER_SYSTEMS_B107.some(([, re]) => re.test(oracle))).toBe(true);
    }
  });
});
