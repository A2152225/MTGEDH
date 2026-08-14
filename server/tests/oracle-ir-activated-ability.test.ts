import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';

describe('oracle IR activated ability execution', () => {
  it('parses Wizard\'s Spellbook d20 branches from activated effect text', () => {
    const effectText =
      'Exile target instant or sorcery card from a graveyard. Roll a d20.\n' +
      '1—9 | Copy that card. You may cast the copy.\n' +
      '10—19 | Copy that card. You may cast the copy without paying its mana cost.\n' +
      '20 | Copy each card exiled with Wizard\'s Spellbook. You may cast any number of the copies without paying their mana costs.';
    const ir = parseOracleTextToIR(effectText, "Wizard's Spellbook");
    const steps = ir.abilities.flatMap((ability) => ability.steps);
    expect(steps.some((step) => step.kind === 'move_zone')).toBe(true);
    expect(steps.some((step) => step.kind === 'roll_die')).toBe(true);
  });

  it('reports handled for supported activated ability steps', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }],
        battlefield: [],
        life: { p1: 40 },
        turnNumber: 1,
        pendingExileAtNextEndStep: [],
        zones: {
          p1: {
            hand: [],
            library: [],
            graveyard: [
              {
                id: 'gy1',
                name: 'Grizzly Bears',
                type_line: 'Creature — Bear',
                power: '2',
                toughness: '2',
              },
            ],
            exile: [],
          },
        },
      },
      gameId: 'test_activated_ir_handled',
      bumpSeq: () => {},
      libraries: new Map(),
    } as any;

    const oracleText =
      '{2}{B}{B}, {T}: Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.';

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Whip of Erebos',
      oracleText,
      sourcePermanentId: 'whip_1',
      targets: ['gy1'],
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThanOrEqual(4);
  });

  it('handles planeswalker loyalty effect text through IR (cost stripped)', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }],
        battlefield: [],
        life: { p1: 40 },
        turnNumber: 1,
        zones: {
          p1: { hand: [], library: [{ id: 'lib1', name: 'Island' }], graveyard: [], exile: [], libraryCount: 1 },
        },
        cardsDrawnThisTurn: {},
      },
      gameId: 'test_loyalty_ir_draw',
      bumpSeq: () => {},
      libraries: new Map([['p1', [{ id: 'lib1', name: 'Island' }]]]),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Jace, Arcane Strategist',
      oracleText: '+1: Draw a card.',
      sourcePermanentId: 'jace_1',
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect((ctx.state.zones.p1.hand || []).map((card: any) => card.id)).toContain('lib1');
  });

  it('handles planeswalker emblem loyalty through IR and syncs to state.emblems', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }],
        battlefield: [],
        life: { p1: 40 },
        turnNumber: 1,
        emblems: [],
        zones: {
          p1: { hand: [], library: [], graveyard: [], exile: [] },
        },
      },
      gameId: 'test_loyalty_ir_emblem',
      bumpSeq: () => {},
      libraries: new Map(),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Generic Planeswalker',
      oracleText: '+1: You get an emblem with "Creatures you control get +1/+1."',
      sourcePermanentId: 'pw_1',
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(Array.isArray(ctx.state.emblems)).toBe(true);
    expect(ctx.state.emblems).toHaveLength(1);
    expect(ctx.state.emblems[0].controller).toBe('p1');
    expect(String(ctx.state.emblems[0].effect || '')).toMatch(/creatures you control get \+1\/\+1/i);
  });

  it('handles skip-next-untap loyalty through IR', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }],
        battlefield: [],
        life: { p1: 40, p2: 40 },
        turnNumber: 1,
        skipNextUntapStepByPlayer: {},
        zones: {
          p1: { hand: [], library: [], graveyard: [], exile: [] },
          p2: { hand: [], library: [], graveyard: [], exile: [] },
        },
      },
      gameId: 'test_loyalty_ir_skip_untap',
      bumpSeq: () => {},
      libraries: new Map(),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Generic Planeswalker',
      oracleText: '+1: Target player skips their next untap step.',
      sourcePermanentId: 'pw_1',
      targets: ['p2'],
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(ctx.state.skipNextUntapStepByPlayer?.p2).toBe(true);
  });

  it('handles gain-control loyalty through IR', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }],
        battlefield: [{
          id: 'bear_1',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'bear_card_1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        }],
        life: { p1: 40, p2: 40 },
        turnNumber: 1,
        zones: {
          p1: { hand: [], library: [], graveyard: [], exile: [] },
          p2: { hand: [], library: [], graveyard: [], exile: [] },
        },
      },
      gameId: 'test_loyalty_ir_gain_control',
      bumpSeq: () => {},
      libraries: new Map(),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Generic Planeswalker',
      oracleText: '+1: Gain control of target creature until end of turn.',
      sourcePermanentId: 'pw_1',
      targets: ['bear_1'],
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(ctx.state.battlefield[0].controller).toBe('p1');
  });

  it('handles impulse exile-plus-play loyalty through IR', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }],
        battlefield: [],
        life: { p1: 40 },
        turnNumber: 1,
        playableFromExile: {},
        zones: {
          p1: {
            hand: [],
            library: [{ id: 'lib1', name: 'Island', type_line: 'Basic Land — Island' }],
            graveyard: [],
            exile: [],
            libraryCount: 1,
          },
        },
      },
      gameId: 'test_loyalty_ir_impulse',
      bumpSeq: () => {},
      libraries: new Map([['p1', [{ id: 'lib1', name: 'Island', type_line: 'Basic Land — Island' }]]]),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Generic Planeswalker',
      oracleText: '+1: Exile the top card of your library. You may play it this turn.',
      sourcePermanentId: 'pw_1',
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(ctx.state.zones.p1.exile.some((card: any) => card.id === 'lib1')).toBe(true);
  });

  it('handles until-next-turn loyalty P/T through IR', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }],
        battlefield: [{
          id: 'bear_1',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'bear_card_1', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        }],
        life: { p1: 40, p2: 40 },
        turnNumber: 1,
        zones: {
          p1: { hand: [], library: [], graveyard: [], exile: [] },
          p2: { hand: [], library: [], graveyard: [], exile: [] },
        },
      },
      gameId: 'test_loyalty_ir_until_next_turn_pt',
      bumpSeq: () => {},
      libraries: new Map(),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Generic Planeswalker',
      oracleText: '+1: Until your next turn, up to one target creature gets -3/-0.',
      sourcePermanentId: 'pw_1',
      targets: ['bear_1'],
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    const modifiers = ctx.state.battlefield[0].modifiers || [];
    expect(modifiers.some((mod: any) => mod.type === 'powerToughness' && mod.power === -3 && mod.duration === 'until_next_turn')).toBe(true);
  });

  it('handles until-next-turn P/T and keyword loss through IR', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }],
        battlefield: [{
          id: 'bird_1',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'bird_card_1', name: 'Storm Crow', type_line: 'Creature — Bird', oracle_text: 'Flying', power: '1', toughness: '2' },
        }],
        life: { p1: 40, p2: 40 },
        turnNumber: 1,
        zones: {
          p1: { hand: [], library: [], graveyard: [], exile: [] },
          p2: { hand: [], library: [], graveyard: [], exile: [] },
        },
      },
      gameId: 'test_loyalty_ir_until_next_turn_pt_keyword',
      bumpSeq: () => {},
      libraries: new Map(),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Generic Planeswalker',
      oracleText: '+1: Until your next turn, up to one target creature gets -2/-0 and loses flying.',
      sourcePermanentId: 'pw_1',
      targets: ['bird_1'],
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    const bird = ctx.state.battlefield[0];
    const modifiers = bird.modifiers || [];
    expect(modifiers.some((mod: any) => mod.type === 'powerToughness' && mod.power === -2 && mod.duration === 'until_next_turn')).toBe(true);
    const granted = [...(bird.grantedAbilities || []), ...(bird.temporaryEffects || []).flatMap((effect: any) => effect?.grantedAbilities || effect?.descriptions || [])]
      .map((entry: unknown) => String(entry || '').toLowerCase());
    expect(granted.some((entry: string) => /loses flying/.test(entry))).toBe(true);
  });

  it('handles until-next-turn artifact animation through IR', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }],
        battlefield: [{
          id: 'sol_1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'sol_card_1', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
        }],
        life: { p1: 40 },
        turnNumber: 1,
        zones: {
          p1: { hand: [], library: [], graveyard: [], exile: [] },
        },
      },
      gameId: 'test_loyalty_ir_until_next_turn_animate',
      bumpSeq: () => {},
      libraries: new Map(),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Generic Planeswalker',
      oracleText: '+1: Until your next turn, target artifact you control becomes a 5/5 creature in addition to its other types.',
      sourcePermanentId: 'pw_1',
      targets: ['sol_1'],
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    const typeLine = String(ctx.state.battlefield[0]?.type_line || ctx.state.battlefield[0]?.card?.type_line || '');
    expect(/creature/i.test(typeLine)).toBe(true);
  });

  it('handles perpetual P/T loyalty through IR', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }],
        battlefield: [{
          id: 'bear_1',
          controller: 'p2',
          owner: 'p2',
          card: { id: 'bear_card_1', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        }],
        life: { p1: 40, p2: 40 },
        turnNumber: 1,
        zones: {
          p1: { hand: [], library: [], graveyard: [], exile: [] },
          p2: { hand: [], library: [], graveyard: [], exile: [] },
        },
      },
      gameId: 'test_loyalty_ir_perpetual_pt',
      bumpSeq: () => {},
      libraries: new Map(),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Generic Planeswalker',
      oracleText: '+1: Target creature an opponent controls perpetually gets -3/-3.',
      sourcePermanentId: 'pw_1',
      targets: ['bear_1'],
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    const modifiers = ctx.state.battlefield[0].modifiers || [];
    expect(modifiers.some((mod: any) => mod.type === 'powerToughness' && mod.power === -3 && mod.toughness === -3)).toBe(true);
  });

  it('handles flip-coin loyalty through IR', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }],
        battlefield: [],
        life: { p1: 40 },
        turnNumber: 1,
        zones: {
          p1: { hand: [], library: [], graveyard: [], exile: [] },
        },
      },
      gameId: 'test_loyalty_ir_flip_coin',
      bumpSeq: () => {},
      libraries: new Map(),
    } as any;

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Generic Planeswalker',
      oracleText: '+1: Flip a coin.',
      sourcePermanentId: 'pw_1',
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(ctx.state.lastCoinFlip).toBeTruthy();
    expect(ctx.state.lastCoinFlip.playerId).toBe('p1');
  });
});
