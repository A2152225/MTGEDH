import { describe, expect, it } from 'vitest';

import { runSBA } from '../src/state/modules/counters_tokens.js';
import {
  checkEndStepWinConditions,
  checkImmediateWinConditions,
  checkUpkeepWinConditions,
  detectWinConditions,
  hasDrawWinReplacement,
  tryResolveThassasOracleWin,
} from '../src/state/modules/game-state-effects.js';

// Oracle text copied from mtg_data.db (is_token = 0).
const FELIDAR_ORACLE =
  "Vigilance (Attacking doesn't cause this creature to tap.)\nLifelink (Damage dealt by this creature also causes you to gain that much life.)\nAt the beginning of your upkeep, if you have 40 or more life, you win the game.";
const TEST_OF_ENDURANCE_ORACLE =
  'At the beginning of your upkeep, if you have 50 or more life, you win the game.';
const THASSA_ORACLE =
  'When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game. (Each {U} in the mana costs of permanents you control counts toward your devotion to blue.)';
const LAB_MAN_ORACLE =
  'If you would draw a card while your library has no cards in it, you win the game instead.';
const MAZES_END_ORACLE =
  "This land enters tapped.\n{T}: Add {C}.\n{3}, {T}, Return this land to its owner's hand: Search your library for a Gate card, put it onto the battlefield, then shuffle. If you control ten or more Gates with different names, you win the game.";
const APPROACH_ORACLE =
  "If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put Approach of the Second Sun into its owner's library seventh from the top and you gain 7 life.";
const MORTAL_COMBAT_ORACLE =
  'At the beginning of your upkeep, if twenty or more creature cards are in your graveyard, you win the game.';
const EPIC_STRUGGLE_ORACLE =
  'At the beginning of your upkeep, if you control twenty or more creatures, you win the game.';
const BIOVISIONARY_ORACLE =
  'At the beginning of the end step, if you control four or more creatures named Biovisionary, you win the game.';
const REVEL_ORACLE =
  'Whenever a creature an opponent controls dies, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")\nAt the beginning of your upkeep, if you control ten or more Treasures, you win the game.';
const SIMIC_ORACLE =
  '{1}{G}{U}: Put a +1/+1 counter on target creature you control.\nWhenever one or more +1/+1 counters are put on a creature you control, put that many growth counters on this enchantment.\nAt the beginning of your upkeep, if this enchantment has twenty or more growth counters on it, you win the game.';
const BARREN_GLORY_ORACLE =
  'At the beginning of your upkeep, if you control no permanents other than this enchantment and have no cards in hand, you win the game.';
// mtg_data.db is_token=0
const DARKSTEEL_REACTOR_ORACLE =
  'Indestructible (Effects that say "destroy" don\'t destroy this artifact.)\nAt the beginning of your upkeep, you may put a charge counter on this artifact.\nWhen this artifact has twenty or more charge counters on it, you win the game.';
const PLUS_ONE_STATE_TRIGGER_ORACLE =
  'When this creature has twenty or more +1/+1 counters on it, you win the game.';
const MAYAEL_ARIA_ORACLE =
  'At the beginning of your upkeep, put a +1/+1 counter on each creature you control if you control a creature with power 5 or greater. Then you gain 10 life if you control a creature with power 10 or greater. Then you win the game if you control a creature with power 20 or greater.';
const HAPPILY_EVER_AFTER_ORACLE =
  'When this enchantment enters, each player gains 5 life and draws a card.\nAt the beginning of your upkeep, if there are five colors among permanents you control, there are six or more card types among permanents you control and/or cards in your graveyard, and your life total is greater than or equal to your starting life total, you win the game.';
const AZOR_ELOCUTORS_ORACLE =
  'At the beginning of your upkeep, put a filibuster counter on this creature. Then if this creature has five or more filibuster counters on it, you win the game.\nWhenever a source deals damage to you, remove a filibuster counter from this creature.';
const MECHANIZED_PRODUCTION_ORACLE =
  'Enchant artifact you control\nAt the beginning of your upkeep, create a token that\'s a copy of enchanted artifact. Then if you control eight or more artifacts with the same name as one another, you win the game.';
const LILIANA_CONTRACT_ORACLE =
  'When this enchantment enters, you draw four cards and you lose 4 life.\nAt the beginning of your upkeep, if you control four or more Demons with different names, you win the game.';
const HEDRON_ALIGNMENT_ORACLE =
  'Hexproof\nAt the beginning of your upkeep, you may reveal your hand. If you do, you win the game if you own a card named Hedron Alignment in exile, in your hand, in your graveyard, and on the battlefield.\n{1}{U}: Scry 1.';

function makeCtx(partial: Record<string, unknown>) {
  return { state: partial } as any;
}

describe('oracle-pattern win conditions (no WIN_CONDITIONS name table)', () => {
  it('Felidar-style 40-life upkeep wins from oracle text on an unnamed custom card', () => {
    const ctx = makeCtx({
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      life: { p1: 40, p2: 40 },
      battlefield: [{
        id: 'life_1',
        controller: 'p1',
        card: { name: 'Custom Life Sovereign', oracle_text: FELIDAR_ORACLE, type_line: 'Creature — Cat Beast' },
      }],
    });

    const detected = detectWinConditions(ctx, 'p1');
    expect(detected.some((c) => c.type === 'upkeep')).toBe(true);
    expect(detected.every((c) => !String(c.cardName).toLowerCase().includes('felidar'))).toBe(true);
    expect(checkUpkeepWinConditions(ctx, 'p1')?.permanentId).toBe('life_1');

    ctx.state.life.p1 = 39;
    ctx.state.players[0].life = 39;
    expect(checkUpkeepWinConditions(ctx, 'p1')).toBeNull();
  });

  it('Test of Endurance 50-life template is the same generic life-threshold pattern', () => {
    const ctx = makeCtx({
      players: [{ id: 'p1', life: 50 }],
      life: { p1: 50 },
      battlefield: [{
        id: 'endurance_1',
        controller: 'p1',
        card: { name: 'Custom Endurance Test', oracle_text: TEST_OF_ENDURANCE_ORACLE, type_line: 'Enchantment' },
      }],
    });

    expect(checkUpkeepWinConditions(ctx, 'p1')?.permanentId).toBe('endurance_1');
    ctx.state.life.p1 = 49;
    ctx.state.players[0].life = 49;
    expect(checkUpkeepWinConditions(ctx, 'p1')).toBeNull();
  });

  it("Thassa ETB devotion/library win does not require the card name Thassa's Oracle", () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', life: 40 }],
        life: { p1: 40 },
        zones: { p1: { libraryCount: 1 } },
        battlefield: [{
          id: 'seer_1',
          controller: 'p1',
          card: {
            name: 'Devotion Seer',
            oracle_text: THASSA_ORACLE,
            type_line: 'Creature — Merfolk Wizard',
            mana_cost: '{U}{U}',
          },
        }],
      },
      zones: { p1: { libraryCount: 1 } },
    } as any;

    const detected = detectWinConditions(ctx, 'p1');
    expect(detected.some((c) => c.type === 'etb' && c.checkFunction(ctx, 'p1'))).toBe(true);
    expect(tryResolveThassasOracleWin(ctx, 'p1', 'Devotion Seer')).toBe(true);
    expect(ctx.state.gameOver).toBe(true);
    expect(ctx.state.winner).toBe('p1');
  });

  it("a card named Thassa's Oracle without the devotion-library clause does not win", () => {
    const ctx = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      zones: { p1: { libraryCount: 0 } },
      battlefield: [{
        id: 'fake_1',
        controller: 'p1',
        card: {
          name: "Thassa's Oracle",
          oracle_text: 'When this creature enters, draw a card.',
          type_line: 'Creature — Merfolk Wizard',
          mana_cost: '{U}{U}',
        },
      }],
    });

    expect(tryResolveThassasOracleWin(ctx, 'p1', "Thassa's Oracle")).toBe(false);
    expect(ctx.state.gameOver).toBeUndefined();
  });

  it('Laboratory Maniac is a ReplacementEffectSpec draw-win, not a detectWinConditions row', () => {
    const ctx = makeCtx({
      battlefield: [{
        id: 'lab_1',
        controller: 'p1',
        card: { name: 'Laboratory Maniac', oracle_text: LAB_MAN_ORACLE, type_line: 'Creature — Human Wizard' },
      }],
    });

    expect(detectWinConditions(ctx, 'p1')).toEqual([]);
    expect(hasDrawWinReplacement(ctx, 'p1')).toBe(true);
  });

  it("Maze's End activated Gate search is not an immediate battlefield win scan", () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'maze_1',
          controller: 'p1',
          card: { name: "Maze's End", oracle_text: MAZES_END_ORACLE, type_line: 'Land' },
        },
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `gate_${i}`,
          controller: 'p1',
          card: { name: `Gate ${i}`, type_line: 'Land — Gate' },
        })),
      ],
    });

    expect(detectWinConditions(ctx, 'p1')).toEqual([]);
  });

  it('Approach of the Second Sun spell win is not an immediate battlefield win scan', () => {
    const ctx = makeCtx({
      battlefield: [{
        id: 'approach_1',
        controller: 'p1',
        card: { name: 'Approach of the Second Sun', oracle_text: APPROACH_ORACLE, type_line: 'Sorcery' },
      }],
    });
    expect(detectWinConditions(ctx, 'p1')).toEqual([]);
  });

  it('Mortal Combat / Epic Struggle / Revel / Simic / Barren Glory match generic upkeep templates', () => {
    const creatures = Array.from({ length: 20 }, (_, i) => ({
      id: `c_${i}`,
      controller: 'p1',
      card: { name: `Creature ${i}`, type_line: 'Creature — Bear' },
    }));
    const treasures = Array.from({ length: 10 }, (_, i) => ({
      id: `t_${i}`,
      controller: 'p1',
      card: { name: 'Treasure', type_line: 'Token Artifact — Treasure' },
    }));
    const graveyard = Array.from({ length: 20 }, (_, i) => ({
      id: `g_${i}`,
      type_line: 'Creature — Zombie',
    }));

    const combat = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      zones: { p1: { graveyard, handCount: 1 } },
      battlefield: [{
        id: 'combat_1',
        controller: 'p1',
        card: { name: 'Custom Combat', oracle_text: MORTAL_COMBAT_ORACLE, type_line: 'Enchantment' },
      }],
    });
    expect(checkUpkeepWinConditions(combat, 'p1')?.permanentId).toBe('combat_1');

    const struggle = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [
        {
          id: 'struggle_1',
          controller: 'p1',
          card: { name: 'Custom Struggle', oracle_text: EPIC_STRUGGLE_ORACLE, type_line: 'Enchantment' },
        },
        ...creatures,
      ],
    });
    expect(checkUpkeepWinConditions(struggle, 'p1')?.permanentId).toBe('struggle_1');

    const revel = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [
        {
          id: 'revel_1',
          controller: 'p1',
          card: { name: 'Custom Revel', oracle_text: REVEL_ORACLE, type_line: 'Enchantment' },
        },
        ...treasures,
      ],
    });
    expect(checkUpkeepWinConditions(revel, 'p1')?.permanentId).toBe('revel_1');

    const simic = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [{
        id: 'simic_1',
        controller: 'p1',
        counters: { growth: 20 },
        card: { name: 'Custom Ascendancy', oracle_text: SIMIC_ORACLE, type_line: 'Enchantment' },
      }],
    });
    expect(checkUpkeepWinConditions(simic, 'p1')?.permanentId).toBe('simic_1');

    const barren = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      zones: { p1: { handCount: 0 } },
      battlefield: [{
        id: 'barren_1',
        controller: 'p1',
        card: { name: 'Custom Barren', oracle_text: BARREN_GLORY_ORACLE, type_line: 'Enchantment' },
      }],
    });
    expect(checkUpkeepWinConditions(barren, 'p1')?.permanentId).toBe('barren_1');
  });

  it('Biovisionary-style end-step named-copy win uses the name printed in oracle text', () => {
    const copies = Array.from({ length: 4 }, (_, i) => ({
      id: `bio_${i}`,
      controller: 'p1',
      card: { name: 'Biovisionary', oracle_text: BIOVISIONARY_ORACLE, type_line: 'Creature — Human Wizard' },
    }));
    const ctx = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: copies,
    });

    expect(checkEndStepWinConditions(ctx, 'p1')?.type).toBe('end_step');
  });

  it('does not treat an A- Alchemy name as a scanned win source', () => {
    const ctx = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [{
        id: 'alc_1',
        controller: 'p1',
        card: { name: 'A-Felidar Sovereign', oracle_text: FELIDAR_ORACLE, type_line: 'Creature — Cat Beast' },
      }],
    });

    expect(detectWinConditions(ctx, 'p1')).toEqual([]);
    expect(checkUpkeepWinConditions(ctx, 'p1')).toBeNull();
  });

  it('state-trigger N-or-more counters wins from oracle, including +1/+1', () => {
    const reactor = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [{
        id: 'reactor_1',
        controller: 'p1',
        counters: { charge: 20 },
        card: { name: 'Custom Reactor', oracle_text: DARKSTEEL_REACTOR_ORACLE, type_line: 'Artifact' },
      }],
    });
    const detected = detectWinConditions(reactor, 'p1');
    expect(detected.some((c) => c.type === 'immediate' && c.permanentId === 'reactor_1')).toBe(true);
    expect(detected.find((c) => c.permanentId === 'reactor_1')?.checkFunction(reactor, 'p1')).toBe(true);
    expect(checkUpkeepWinConditions(reactor, 'p1')).toBeNull();
    expect(checkImmediateWinConditions(reactor, 'p1')?.permanentId).toBe('reactor_1');

    reactor.state.battlefield[0].counters.charge = 19;
    expect(detected.find((c) => c.permanentId === 'reactor_1')?.checkFunction(reactor, 'p1')).toBe(false);
    expect(checkImmediateWinConditions(reactor, 'p1')).toBeNull();

    const plusOne = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [{
        id: 'plus_1',
        controller: 'p1',
        counters: { '+1/+1': 20 },
        card: { name: 'Custom Charge Beast', oracle_text: PLUS_ONE_STATE_TRIGGER_ORACLE, type_line: 'Creature — Beast' },
      }],
    });
    const plusDetected = detectWinConditions(plusOne, 'p1');
    expect(plusDetected.some((c) => c.type === 'immediate')).toBe(true);
    expect(plusDetected[0]?.checkFunction(plusOne, 'p1')).toBe(true);
    expect(checkImmediateWinConditions(plusOne, 'p1')?.type).toBe('immediate');
    plusOne.state.battlefield[0].counters['+1/+1'] = 19;
    expect(plusDetected[0]?.checkFunction(plusOne, 'p1')).toBe(false);
    expect(checkImmediateWinConditions(plusOne, 'p1')).toBeNull();
  });

  it('runSBA stamps a Darksteel-style 20-charge immediate win and ignores 19', () => {
    const makeReactorCtx = (charge: number) => ({
      libraries: new Map(),
      bumpSeq: () => {},
      state: {
        players: [{ id: 'p1', life: 40, hasLost: false }, { id: 'p2', life: 40, hasLost: false }],
        life: { p1: 40, p2: 40 },
        battlefield: [{
          id: 'reactor_sba',
          controller: 'p1',
          owner: 'p1',
          counters: { charge },
          card: { name: 'Custom Reactor', oracle_text: DARKSTEEL_REACTOR_ORACLE, type_line: 'Artifact' },
        }],
        zones: {
          p1: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
          p2: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
        },
        stack: [],
      },
    } as any);

    const winCtx = makeReactorCtx(20);
    runSBA(winCtx);
    expect(winCtx.state.winner).toBe('p1');
    expect(winCtx.state.gameOver).toBe(true);
    expect(String(winCtx.state.winReason || '')).toMatch(/charge counters|win/i);

    const shortCtx = makeReactorCtx(19);
    runSBA(shortCtx);
    expect(shortCtx.state.winner).toBeUndefined();
    expect(shortCtx.state.gameOver).toBeFalsy();
  });

  it('Mayael-style then-if wins only on the power-20 clause, not the earlier ifs', () => {
    const beater = (power: number, id: string) => ({
      id,
      controller: 'p1',
      power,
      card: { name: `Beater ${power}`, type_line: 'Creature — Beast', power: String(power) },
    });
    const aria = {
      id: 'aria_1',
      controller: 'p1',
      card: { name: 'Custom Aria', oracle_text: MAYAEL_ARIA_ORACLE, type_line: 'Enchantment' },
    };
    const low = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [aria, beater(5, 'c5'), beater(10, 'c10')],
    });
    expect(detectWinConditions(low, 'p1').some((c) => c.type === 'upkeep')).toBe(true);
    expect(checkUpkeepWinConditions(low, 'p1')).toBeNull();

    const high = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [aria, beater(20, 'c20')],
    });
    expect(checkUpkeepWinConditions(high, 'p1')?.permanentId).toBe('aria_1');
  });

  it('Happily Ever After-style compound upkeep if requires colors, card types, and starting-life floor', () => {
    const winSource = {
      id: 'happily_1',
      controller: 'p1',
      card: { name: 'Custom Ever After', oracle_text: HAPPILY_EVER_AFTER_ORACLE, type_line: 'Enchantment' },
    };
    const rainbow = {
      id: 'rainbow_1',
      controller: 'p1',
      card: {
        name: 'Rainbow Relic',
        type_line: 'Artifact',
        colors: ['W', 'U', 'B', 'R', 'G'],
        color_identity: ['W', 'U', 'B', 'R', 'G'],
      },
    };
    const extras = [
      { id: 'cr_1', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear', colors: ['G'] } },
      { id: 'land_1', controller: 'p1', card: { name: 'Forest', type_line: 'Basic Land — Forest', colors: [] } },
    ];
    const graveyard = [
      { id: 'inst_1', type_line: 'Instant' },
      { id: 'sorc_1', type_line: 'Sorcery' },
    ];
    const ready = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      startingLife: 40,
      zones: { p1: { graveyard } },
      battlefield: [winSource, rainbow, ...extras],
    });
    expect(checkUpkeepWinConditions(ready, 'p1')?.permanentId).toBe('happily_1');

    ready.state.life.p1 = 39;
    ready.state.players[0].life = 39;
    expect(checkUpkeepWinConditions(ready, 'p1')).toBeNull();
  });

  it('Azor-style then-if N counters on this wins at upkeep only when the count is met', () => {
    const ctx = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [{
        id: 'azor_1',
        controller: 'p1',
        counters: { filibuster: 5 },
        card: { name: 'Custom Orator', oracle_text: AZOR_ELOCUTORS_ORACLE, type_line: 'Creature — Human Advisor' },
      }],
    });
    expect(checkUpkeepWinConditions(ctx, 'p1')?.permanentId).toBe('azor_1');
    ctx.state.battlefield[0].counters.filibuster = 4;
    expect(checkUpkeepWinConditions(ctx, 'p1')).toBeNull();
  });

  it('Mechanized-style same-name permanents and Liliana-style different-name tribe both scan from oracle', () => {
    const widgets = Array.from({ length: 8 }, (_, i) => ({
      id: `w_${i}`,
      controller: 'p1',
      card: { name: 'Widget', type_line: 'Artifact' },
    }));
    const production = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [{
        id: 'prod_1',
        controller: 'p1',
        card: { name: 'Custom Production', oracle_text: MECHANIZED_PRODUCTION_ORACLE, type_line: 'Enchantment — Aura' },
      }, ...widgets],
    });
    expect(checkUpkeepWinConditions(production, 'p1')?.permanentId).toBe('prod_1');
    production.state.battlefield.pop();
    expect(checkUpkeepWinConditions(production, 'p1')).toBeNull();

    const demons = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, i) => ({
      id: `d_${i}`,
      controller: 'p1',
      card: { name, type_line: 'Creature — Demon' },
    }));
    const contract = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [{
        id: 'contract_1',
        controller: 'p1',
        card: { name: 'Custom Contract', oracle_text: LILIANA_CONTRACT_ORACLE, type_line: 'Enchantment' },
      }, ...demons],
    });
    expect(checkUpkeepWinConditions(contract, 'p1')?.permanentId).toBe('contract_1');

    const clones = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      battlefield: [{
        id: 'contract_2',
        controller: 'p1',
        card: { name: 'Custom Contract', oracle_text: LILIANA_CONTRACT_ORACLE, type_line: 'Enchantment' },
      }, ...Array.from({ length: 4 }, (_, i) => ({
        id: `clone_${i}`,
        controller: 'p1',
        card: { name: 'Same Demon', type_line: 'Creature — Demon' },
      }))],
    });
    expect(checkUpkeepWinConditions(clones, 'p1')).toBeNull();
  });

  it('optional may-reveal if-you-do named-copy win is not an automatic battlefield scan', () => {
    const ctx = makeCtx({
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
      zones: {
        p1: {
          hand: [{ name: 'Hedron Alignment' }],
          graveyard: [{ name: 'Hedron Alignment' }],
          exile: [{ name: 'Hedron Alignment' }],
        },
      },
      battlefield: [{
        id: 'hedron_1',
        controller: 'p1',
        card: { name: 'Custom Alignment', oracle_text: HEDRON_ALIGNMENT_ORACLE, type_line: 'Enchantment' },
      }],
    });
    expect(detectWinConditions(ctx, 'p1')).toEqual([]);
    expect(checkUpkeepWinConditions(ctx, 'p1')).toBeNull();
  });
});
