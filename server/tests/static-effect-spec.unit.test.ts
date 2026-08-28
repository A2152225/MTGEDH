import { describe, expect, it } from 'vitest';

import { upsertCompiledOracleIROverlaySync } from '../src/services/oracleIrCompiledOverlayStore.js';
import { calculateAllPTBonuses } from '../src/state/utils.js';
import { parseCreatureKeywords } from '../src/state/modules/combat-mechanics.js';
import {
  applyDeclarativeStaticSpecs,
  collectStaticEffectSpecsFromState,
  compareStaticEffectSpecsForApplication,
  getContinuousGrantedAbilitiesForPermanent,
  getContinuousPTBonusForPermanent,
  getOverlayStaticPTBonusForPermanent,
  getStaticEffectSourceTimestamp,
  recomputeContinuousEffects,
  readDerivedContinuousEffects,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { computeContinuousEffects } from '../src/rules-engine/staticEffects.js';

describe('staticEffectSpec (Phase 5.3 declarative registry)', () => {
  it('collects static specs from compiled overlay STATIC abilities on battlefield', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'overlay-anthem-test-id',
      name: 'Overlay Anthem',
      envelope: {
        card_id: 'overlay-anthem-test-id',
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'Creatures you control get +1/+1.',
          steps: [],
          static_specs: [{
            id: 'creatures-plus-one',
            scope: { kind: 'creatures_you_control' },
            grant: { power: 1, toughness: 1 },
          }],
        }],
      },
    });

    const specs = collectStaticEffectSpecsFromState({
      battlefield: [{
        id: 'anthem_perm_1',
        controller: 'p1',
        card: { id: 'overlay-anthem-test-id', name: 'Overlay Anthem', oracle_text: '' },
      }],
    });

    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      id: 'anthem_perm_1:creatures-plus-one',
      scope: { kind: 'creatures_you_control' },
      grant: { power: 1, toughness: 1 },
      sourcePermanentId: 'anthem_perm_1',
      sourceController: 'p1',
      sourceName: 'Overlay Anthem',
    });
  });

  it('merges overlay static specs into continuous effect recomputation', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'overlay-lord-test-id',
      name: 'Overlay Lord',
      envelope: {
        card_id: 'overlay-lord-test-id',
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'Other Soldiers you control get +1/+1.',
          steps: [],
          static_specs: [{
            id: 'soldier-lord',
            scope: { kind: 'other_creatures_you_control', creatureType: 'soldier' },
            grant: { power: 1, toughness: 1 },
          }],
        }],
      },
    });

    const state = {
      battlefield: [
        {
          id: 'lord_perm_1',
          controller: 'p1',
          card: { id: 'overlay-lord-test-id', name: 'Overlay Lord', type_line: 'Creature — Human Soldier', oracle_text: '' },
        },
        {
          id: 'soldier_perm_1',
          controller: 'p1',
          card: { id: 'soldier_card_1', name: 'Soldier Token', type_line: 'Creature — Soldier', oracle_text: '' },
        },
        {
          id: 'goblin_perm_1',
          controller: 'p1',
          card: { id: 'goblin_card_1', name: 'Goblin', type_line: 'Creature — Goblin', oracle_text: '' },
        },
      ],
    };

    const base = computeContinuousEffects(state as any);
    expect(base.perPermanent.get('soldier_perm_1')?.pDelta || 0).toBe(0);

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('soldier_perm_1')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('goblin_perm_1')?.pDelta || 0).toBe(0);
    expect(merged.perPermanent.get('lord_perm_1')?.pDelta || 0).toBe(0);
  });

  it('applies player-level hexproof grants from overlay static specs', () => {
    const specs = collectStaticEffectSpecsFromState({
      battlefield: [{
        id: 'leyline_perm_1',
        controller: 'p1',
        card: { id: 'unused', name: 'Unused', oracle_text: '' },
      }],
    });

    const applied = applyDeclarativeStaticSpecs(
      {
        perPermanent: new Map(),
        playerHexproof: new Set(),
        playerShroud: new Set(),
        typeAdditions: new Map(),
        permanentAbilities: new Map(),
      },
      [{
        id: 'leyline_perm_1:player-hexproof',
        scope: { kind: 'player_you' },
        grant: { playerHexproof: true },
        sourceController: 'p1',
      }],
      { battlefield: [] },
    );

    expect([...applied.playerHexproof]).toEqual(['p1']);
  });

  it('caches derived continuous effects during syncDerivedContinuousEffects', () => {
    const state = {
      battlefield: [{
        id: 'anthem_perm_1',
        controller: 'p1',
        card: { id: 'overlay-anthem-test-id', name: 'Overlay Anthem', oracle_text: '' },
      }],
    };

    const derived = syncDerivedContinuousEffects(state);
    expect(derived).toBeTruthy();
    expect(readDerivedContinuousEffects(state)).toBe(derived);
  });

  it('skips derived continuous sync when battlefield is absent', () => {
    const state = { players: [{ id: 'p1' }] };
    expect(syncDerivedContinuousEffects(state)).toBeNull();
    expect(readDerivedContinuousEffects(state)).toBeNull();
  });

  it('applies overlay static P/T through calculateAllPTBonuses for combat and SBA paths', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'overlay-combat-anthem-test-id',
      name: 'Overlay Combat Anthem',
      envelope: {
        card_id: 'overlay-combat-anthem-test-id',
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'Creatures you control get +2/+2.',
          steps: [],
          static_specs: [{
            id: 'combat-anthem-plus-two',
            scope: { kind: 'creatures_you_control' },
            grant: { power: 2, toughness: 2 },
          }],
        }],
      },
    });

    const state = {
      battlefield: [
        {
          id: 'combat_anthem_perm_1',
          controller: 'p1',
          card: { id: 'overlay-combat-anthem-test-id', name: 'Overlay Combat Anthem', oracle_text: '' },
        },
        {
          id: 'creature_perm_1',
          controller: 'p1',
          card: { id: 'creature_card_1', name: 'Test Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
      ],
    };

    const overlayOnly = getOverlayStaticPTBonusForPermanent(state.battlefield[1] as any, state);
    expect(overlayOnly).toMatchObject({ power: 2, toughness: 2 });

    const allBonuses = calculateAllPTBonuses(state.battlefield[1], state);
    expect(allBonuses).toMatchObject({ power: 2, toughness: 2 });
  });

  it('applies global merfolk lord buffs through declarative oracle specs', () => {
    const state = {
      battlefield: [
        {
          id: 'lord_perm_1',
          controller: 'p1',
          card: {
            name: 'Lord of Atlantis',
            type_line: 'Creature — Merfolk',
            oracle_text: 'Other Merfolk get +1/+1 and have islandwalk.',
          },
        },
        {
          id: 'ally_merfolk',
          controller: 'p1',
          card: { name: 'Merfolk Trader', type_line: 'Creature — Merfolk' },
        },
        {
          id: 'opponent_merfolk',
          controller: 'p2',
          card: { name: 'Enemy Merfolk', type_line: 'Creature — Merfolk' },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('ally_merfolk')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('opponent_merfolk')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('lord_perm_1')?.pDelta || 0).toBe(0);
  });

  it('applies color-based global anthems through declarative oracle specs', () => {
    const state = {
      battlefield: [
        {
          id: 'crusade_perm_1',
          controller: 'p1',
          card: {
            name: 'Crusade',
            type_line: 'Enchantment',
            oracle_text: 'White creatures get +1/+1.',
          },
        },
        {
          id: 'white_creature',
          controller: 'p2',
          card: {
            name: 'Elite Vanguard',
            type_line: 'Creature — Human Soldier',
            colors: ['W'],
          },
        },
        {
          id: 'red_creature',
          controller: 'p2',
          card: {
            name: 'Goblin Guide',
            type_line: 'Creature — Goblin Scout',
            colors: ['R'],
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('white_creature')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('red_creature')?.pDelta || 0).toBe(0);
  });

  it('applies oracle soldier flying grants through declarative specs', () => {
    const state = {
      battlefield: [
        {
          id: 'lord_perm_1',
          controller: 'p1',
          card: {
            name: 'Captain of the Watch',
            type_line: 'Creature — Human Soldier',
            oracle_text: 'Other Soldier creatures you control have first strike and vigilance.',
          },
        },
        {
          id: 'soldier_perm_1',
          controller: 'p1',
          card: { name: 'Soldier', type_line: 'Creature — Soldier', oracle_text: '' },
        },
      ],
    };

    const granted = getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state);
    expect(granted).toContain('first strike');
    expect(granted).toContain('vigilance');
  });

  it("grants Archon of Sun's Grace lifelink only to Pegasus creatures", () => {
    const state = {
      battlefield: [
        {
          id: 'archon',
          controller: 'p1',
          card: {
            name: "Archon of Sun's Grace",
            type_line: 'Enchantment Creature — Archon',
            oracle_text:
              "Flying\nPegasus creatures you control have lifelink.\nWhenever an enchantment you control enters, create a 2/2 white Pegasus creature token with flying.",
          },
        },
        {
          id: 'pegasus',
          controller: 'p1',
          card: { name: 'Pegasus Token', type_line: 'Token Creature — Pegasus', oracle_text: 'Flying' },
        },
        {
          id: 'bear',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state)).toContain('lifelink');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[2] as any, state)).not.toContain('lifelink');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[0] as any, state)).not.toContain('lifelink');

    const pegasusKeywords = parseCreatureKeywords(state.battlefield[1].card, state.battlefield[1] as any, state as any);
    const bearKeywords = parseCreatureKeywords(state.battlefield[2].card, state.battlefield[2] as any, state as any);
    const archonKeywords = parseCreatureKeywords(state.battlefield[0].card, state.battlefield[0] as any, state as any);
    expect(pegasusKeywords.lifelink).toBe(true);
    expect(bearKeywords.lifelink).toBe(false);
    expect(archonKeywords.lifelink).toBe(false);
  });

  it('still grants unrestricted creatures-you-control keywords (Whip of Erebos)', () => {
    const state = {
      battlefield: [
        {
          id: 'whip',
          controller: 'p1',
          card: {
            name: 'Whip of Erebos',
            type_line: 'Legendary Enchantment Artifact',
            oracle_text: 'Creatures you control have lifelink.',
          },
        },
        {
          id: 'bear',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state)).toContain('lifelink');
    expect(parseCreatureKeywords(state.battlefield[1].card, state.battlefield[1] as any, state as any).lifelink).toBe(true);
  });

  it('parses oracle anthem specs without double-counting legacy regex', () => {
    const state = {
      battlefield: [
        {
          id: 'anthem_perm_1',
          controller: 'p1',
          card: {
            id: 'glorious_anthem',
            name: 'Glorious Anthem',
            type_line: 'Enchantment',
            oracle_text: 'Creatures you control get +1/+1.',
          },
        },
        {
          id: 'creature_perm_1',
          controller: 'p1',
          card: { id: 'bear', name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('creature_perm_1')).toMatchObject({ pDelta: 1, tDelta: 1 });
  });

  it('routes regex anthem P/T through getContinuousPTBonusForPermanent', () => {
    const state = {
      battlefield: [
        {
          id: 'anthem_perm_1',
          controller: 'p1',
          card: {
            id: 'glorious_anthem',
            name: 'Glorious Anthem',
            type_line: 'Enchantment',
            oracle_text: 'Creatures you control get +1/+1.',
          },
        },
        {
          id: 'creature_perm_1',
          controller: 'p1',
          card: { id: 'bear', name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
      ],
    };

    const continuous = getContinuousPTBonusForPermanent(state.battlefield[1] as any, state);
    expect(continuous).toMatchObject({ power: 1, toughness: 1 });

    const allBonuses = calculateAllPTBonuses(state.battlefield[1], state);
    expect(allBonuses).toMatchObject({ power: 1, toughness: 1 });
  });

  it('applies conditional token and life-threshold statics through continuous effects', () => {
    const belowThreshold = {
      startingLife: 40,
      life: { p1: 46 },
      turnPlayer: 'p2',
      battlefield: [
        {
          id: 'leyline_perm_1',
          controller: 'p1',
          card: {
            name: 'Leyline of Hope',
            oracle_text: 'If you have at least seven life more than your starting life total, creatures you control get +2/+2.',
          },
        },
        {
          id: 'virtue_perm_1',
          controller: 'p1',
          card: {
            name: 'Intangible Virtue',
            oracle_text: 'Creature tokens you control get +1/+1 and have vigilance.',
          },
        },
        {
          id: 'mite_perm_1',
          controller: 'p1',
          card: {
            name: 'Mite Overseer',
            oracle_text: 'During your turn, creature tokens you control get +1/+0 and have first strike.',
          },
        },
        {
          id: 'token_perm_1',
          controller: 'p1',
          isToken: true,
          card: { name: 'Soldier Token', type_line: 'Creature — Soldier', oracle_text: '' },
        },
        {
          id: 'bear_perm_1',
          controller: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    const tokenBelow = getContinuousPTBonusForPermanent(belowThreshold.battlefield[3] as any, belowThreshold);
    expect(tokenBelow).toMatchObject({ power: 1, toughness: 1 });
    expect(getContinuousPTBonusForPermanent(belowThreshold.battlefield[4] as any, belowThreshold)).toMatchObject({ power: 0, toughness: 0 });

    const aboveThreshold = {
      ...belowThreshold,
      life: { p1: 47 },
      turnPlayer: 'p1',
    };
    const tokenAbove = getContinuousPTBonusForPermanent(aboveThreshold.battlefield[3] as any, aboveThreshold);
    expect(tokenAbove).toMatchObject({ power: 4, toughness: 3 });
    expect(getContinuousPTBonusForPermanent(aboveThreshold.battlefield[4] as any, aboveThreshold)).toMatchObject({ power: 2, toughness: 2 });
  });

  it('applies overlay static conditions for life threshold and token-only grants', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'overlay-conditional-anthem-test-id',
      name: 'Overlay Conditional Anthem',
      envelope: {
        card_id: 'overlay-conditional-anthem-test-id',
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'If you have at least seven life more than your starting life total, creatures you control get +2/+2.',
          steps: [],
          static_specs: [{
            id: 'life-threshold-anthem',
            scope: { kind: 'creatures_you_control' },
            condition: { kind: 'controller_life_at_least_starting_plus', offset: 7 },
            grant: { power: 2, toughness: 2 },
          }],
        }],
      },
    });

    upsertCompiledOracleIROverlaySync({
      cardId: 'overlay-token-lord-test-id',
      name: 'Overlay Token Lord',
      envelope: {
        card_id: 'overlay-token-lord-test-id',
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'Creature tokens you control get +1/+1.',
          steps: [],
          static_specs: [{
            id: 'token-only-buff',
            scope: { kind: 'creatures_you_control' },
            condition: { kind: 'target_is_token' },
            grant: { power: 1, toughness: 1 },
          }],
        }],
      },
    });

    const belowThreshold = {
      startingLife: 40,
      life: { p1: 46 },
      battlefield: [
        {
          id: 'conditional_anthem_perm_1',
          controller: 'p1',
          card: { id: 'overlay-conditional-anthem-test-id', name: 'Overlay Conditional Anthem', oracle_text: '' },
        },
        {
          id: 'token_lord_perm_1',
          controller: 'p1',
          card: { id: 'overlay-token-lord-test-id', name: 'Overlay Token Lord', oracle_text: '' },
        },
        {
          id: 'token_perm_1',
          controller: 'p1',
          isToken: true,
          card: { name: 'Soldier', type_line: 'Creature — Soldier' },
        },
        {
          id: 'bear_perm_1',
          controller: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear' },
        },
      ],
    };

    expect(getContinuousPTBonusForPermanent(belowThreshold.battlefield[2] as any, belowThreshold)).toMatchObject({ power: 1, toughness: 1 });
    expect(getContinuousPTBonusForPermanent(belowThreshold.battlefield[3] as any, belowThreshold)).toMatchObject({ power: 0, toughness: 0 });

    const aboveThreshold = { ...belowThreshold, life: { p1: 47 } };
    expect(getContinuousPTBonusForPermanent(aboveThreshold.battlefield[2] as any, aboveThreshold)).toMatchObject({ power: 3, toughness: 3 });
    expect(getContinuousPTBonusForPermanent(aboveThreshold.battlefield[3] as any, aboveThreshold)).toMatchObject({ power: 2, toughness: 2 });
  });

  it('applies overlay static ability grants through parseCreatureKeywords', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'overlay-flying-lord-test-id',
      name: 'Overlay Flying Lord',
      envelope: {
        card_id: 'overlay-flying-lord-test-id',
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'Other Soldiers you control have flying.',
          steps: [],
          static_specs: [{
            id: 'soldier-flying',
            scope: { kind: 'other_creatures_you_control', creatureType: 'soldier' },
            grant: { abilities: ['flying'] },
          }],
        }],
      },
    });

    const state = {
      battlefield: [
        {
          id: 'lord_perm_1',
          controller: 'p1',
          card: { id: 'overlay-flying-lord-test-id', name: 'Overlay Flying Lord', type_line: 'Creature — Human Soldier', oracle_text: '' },
        },
        {
          id: 'soldier_perm_1',
          controller: 'p1',
          card: { id: 'soldier_card_1', name: 'Soldier', type_line: 'Creature — Soldier', oracle_text: '' },
        },
      ],
    };

    const granted = getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state);
    expect(granted).toContain('flying');

    const keywords = parseCreatureKeywords(state.battlefield[1].card, state.battlefield[1], state);
    expect(keywords.flying).toBe(true);
  });

  it('applies overlay during_source_controller_turn only on source controller turn', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'overlay-turn-buff-test-id',
      name: 'Overlay Turn Buff',
      envelope: {
        card_id: 'overlay-turn-buff-test-id',
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'Creatures you control get +1/+0 during your turn.',
          steps: [],
          static_specs: [{
            id: 'turn-creature-buff',
            scope: { kind: 'creatures_you_control' },
            condition: { kind: 'during_source_controller_turn' },
            grant: { power: 1, toughness: 0 },
          }],
        }],
      },
    });

    const state = {
      turnPlayer: 'p1',
      battlefield: [
        {
          id: 'turn_buff_source',
          controller: 'p1',
          card: { id: 'overlay-turn-buff-test-id', name: 'Overlay Turn Buff', oracle_text: '' },
        },
        {
          id: 'creature_perm_1',
          controller: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear' },
        },
      ],
    };

    expect(getContinuousPTBonusForPermanent(state.battlefield[1] as any, state)).toMatchObject({ power: 1, toughness: 0 });

    const offTurn = { ...state, turnPlayer: 'p2' };
    expect(getContinuousPTBonusForPermanent(offTurn.battlefield[1] as any, offTurn)).toMatchObject({ power: 0, toughness: 0 });
  });

  it('sorts overlay static specs by layer then battlefield timestamp', () => {
    const state = {
      battlefield: [
        { id: 'older_anthem', controller: 'p1', card: { name: 'Older Anthem' } },
        { id: 'newer_anthem', controller: 'p1', card: { name: 'Newer Anthem' } },
      ],
    };

    expect(getStaticEffectSourceTimestamp(state, 'older_anthem')).toBe(0);
    expect(getStaticEffectSourceTimestamp(state, 'newer_anthem')).toBe(1);

    const abilityGrant: import('../src/state/modules/staticEffectSpec.js').StaticEffectSpec = {
      id: 'flying',
      scope: { kind: 'creatures_you_control' },
      grant: { abilities: ['flying'] },
      sourcePermanentId: 'newer_anthem',
    };
    const ptGrant: import('../src/state/modules/staticEffectSpec.js').StaticEffectSpec = {
      id: 'plus-one',
      scope: { kind: 'creatures_you_control' },
      grant: { power: 1, toughness: 1 },
      sourcePermanentId: 'older_anthem',
    };

    expect(compareStaticEffectSpecsForApplication(abilityGrant, ptGrant, state)).toBeLessThan(0);
    expect(compareStaticEffectSpecsForApplication(ptGrant, abilityGrant, state)).toBeGreaterThan(0);

    const olderPt: import('../src/state/modules/staticEffectSpec.js').StaticEffectSpec = {
      id: 'older-pt',
      scope: { kind: 'creatures_you_control' },
      grant: { power: 1, toughness: 0 },
      sourcePermanentId: 'older_anthem',
    };
    const newerPt: import('../src/state/modules/staticEffectSpec.js').StaticEffectSpec = {
      id: 'newer-pt',
      scope: { kind: 'creatures_you_control' },
      grant: { power: 1, toughness: 0 },
      sourcePermanentId: 'newer_anthem',
    };
    expect(compareStaticEffectSpecsForApplication(olderPt, newerPt, state)).toBeLessThan(0);
  });

  it('applies chosen-color anthem buffs through computeContinuousEffects', () => {
    const state = {
      battlefield: [
        {
          id: 'caged_sun_perm',
          controller: 'p1',
          chosenColor: 'green',
          card: {
            name: 'Caged Sun',
            type_line: 'Artifact',
            oracle_text: 'As Caged Sun enters, choose a color.\nCreatures you control of the chosen color get +1/+1.',
          },
        },
        {
          id: 'green_creature',
          controller: 'p1',
          card: {
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            colors: ['G'],
            oracle_text: '{T}: Add {G}.',
          },
        },
        {
          id: 'red_creature',
          controller: 'p1',
          card: {
            name: 'Goblin Guide',
            type_line: 'Creature — Goblin Scout',
            colors: ['R'],
            oracle_text: 'Haste',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('green_creature')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('red_creature')?.pDelta || 0).toBe(0);

    const greenBonus = calculateAllPTBonuses(state.battlefield[1], state);
    const redBonus = calculateAllPTBonuses(state.battlefield[2], state);
    expect(greenBonus).toMatchObject({ power: 1, toughness: 1 });
    expect(redBonus).toMatchObject({ power: 0, toughness: 0 });
  });

  it('applies chosen-color anthem to creatures that only have mana_cost colors', () => {
    const state = {
      battlefield: [
        {
          id: 'caged_sun_perm',
          controller: 'p1',
          chosenColor: 'green',
          card: {
            name: 'Caged Sun',
            type_line: 'Artifact',
            oracle_text: 'As Caged Sun enters, choose a color.\nCreatures you control of the chosen color get +1/+1.',
          },
        },
        {
          id: 'newer_green_creature',
          controller: 'p1',
          card: {
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            mana_cost: '{G}',
            oracle_text: '{T}: Add {G}.',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('newer_green_creature')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(calculateAllPTBonuses(state.battlefield[1], state)).toMatchObject({ power: 1, toughness: 1 });
  });

  it('applies opponent chosen-type debuffs through computeContinuousEffects', () => {
    const state = {
      battlefield: [
        {
          id: 'plague_engineer_perm',
          controller: 'p1',
          chosenCreatureType: 'Human',
          card: {
            name: 'Plague Engineer',
            type_line: 'Creature — Phyrexian Carrier',
            oracle_text: 'As Plague Engineer enters, choose a creature type.\nCreatures of the chosen type your opponents control get -1/-1.',
          },
        },
        {
          id: 'opponent_human',
          controller: 'p2',
          card: {
            name: 'Elite Vanguard',
            type_line: 'Creature — Human Soldier',
            oracle_text: '',
          },
        },
        {
          id: 'opponent_elf',
          controller: 'p2',
          card: {
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            oracle_text: '',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('opponent_human')).toMatchObject({ pDelta: -1, tDelta: -1 });
    expect(merged.perPermanent.get('opponent_elf')?.pDelta || 0).toBe(0);

    const humanBonus = calculateAllPTBonuses(state.battlefield[1], state);
    expect(humanBonus).toMatchObject({ power: -1, toughness: -1 });
  });

  it('applies Death Baron compound skeleton/zombie lord buffs', () => {
    const state = {
      battlefield: [
        {
          id: 'death_baron',
          controller: 'p1',
          card: {
            name: 'Death Baron',
            type_line: 'Creature — Zombie Wizard',
            oracle_text: 'Skeletons you control and other Zombies you control get +1/+1 and have deathtouch.',
          },
        },
        {
          id: 'skeleton_ally',
          controller: 'p1',
          card: {
            name: 'Skeleton',
            type_line: 'Creature — Skeleton',
            oracle_text: '',
          },
        },
        {
          id: 'other_zombie',
          controller: 'p1',
          card: {
            name: 'Gravecrawler',
            type_line: 'Creature — Zombie',
            oracle_text: '',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('skeleton_ally')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('other_zombie')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('death_baron')?.pDelta || 0).toBe(0);
    expect(merged.perPermanent.get('skeleton_ally')?.abilities?.has('deathtouch')).toBe(true);
  });

  it('applies Flowering of the White Tree buffs only to legendary creatures', () => {
    const state = {
      battlefield: [
        {
          id: 'flowering',
          controller: 'p1',
          card: {
            name: 'Flowering of the White Tree',
            type_line: 'Legendary Enchantment',
            oracle_text: 'Legendary creatures you control get +2/+1 and have ward {1}.',
          },
        },
        {
          id: 'myrel',
          controller: 'p1',
          card: {
            name: 'Myrel, Shield of Argive',
            type_line: 'Legendary Creature — Human Soldier',
            oracle_text: '',
          },
        },
        {
          id: 'soldier_token',
          controller: 'p1',
          isToken: true,
          card: {
            name: 'Soldier',
            type_line: 'Token Creature — Soldier',
            oracle_text: '',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('myrel')).toMatchObject({ pDelta: 2, tDelta: 1 });
    expect(merged.perPermanent.get('myrel')?.abilities?.has('ward')).toBe(true);
    expect(merged.perPermanent.get('soldier_token')?.pDelta || 0).toBe(0);
    expect(merged.perPermanent.get('soldier_token')?.tDelta || 0).toBe(0);
    expect(merged.perPermanent.get('soldier_token')?.abilities?.has('ward')).toBeFalsy();
  });

  it('does not apply Elspeth emblem text from planeswalker loyalty ability without emblem', () => {
    const state = {
      battlefield: [
        {
          id: 'elspeth',
          controller: 'p1',
          card: {
            name: "Elspeth, Sun's Champion",
            type_line: 'Legendary Planeswalker — Elspeth',
            oracle_text: '+1: Create three 1/1 white Soldier creature tokens.\n−3: Destroy all creatures with power 4 or greater.\n−7: You get an emblem with "Creatures you control get +2/+2 and have flying."',
          },
        },
        {
          id: 'soldier_token',
          controller: 'p1',
          isToken: true,
          card: {
            name: 'Soldier',
            type_line: 'Token Creature — Soldier',
            oracle_text: '',
          },
        },
      ],
      emblems: [],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('soldier_token')?.pDelta || 0).toBe(0);
    expect(merged.perPermanent.get('soldier_token')?.tDelta || 0).toBe(0);
    expect(merged.perPermanent.get('soldier_token')?.abilities?.has('flying')).toBeFalsy();
  });

  it('applies Elspeth emblem static effects when emblem is present', () => {
    const state = {
      battlefield: [
        {
          id: 'elspeth',
          controller: 'p1',
          card: {
            name: "Elspeth, Sun's Champion",
            type_line: 'Legendary Planeswalker — Elspeth',
            oracle_text: '+1: Create three 1/1 white Soldier creature tokens.\n−3: Destroy all creatures with power 4 or greater.\n−7: You get an emblem with "Creatures you control get +2/+2 and have flying."',
          },
        },
        {
          id: 'soldier_token',
          controller: 'p1',
          isToken: true,
          card: {
            name: 'Soldier',
            type_line: 'Token Creature — Soldier',
            oracle_text: '',
          },
        },
      ],
      emblems: [{
        id: 'elspeth_emblem_1',
        controller: 'p1',
        name: "Elspeth, Sun's Champion Emblem",
        effect: 'Creatures you control get +2/+2 and have flying.',
      }],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('soldier_token')).toMatchObject({ pDelta: 2, tDelta: 2 });
    expect(merged.perPermanent.get('soldier_token')?.abilities?.has('flying')).toBe(true);
  });

  it('applies nonblack and non-human conditional lord buffs', () => {
    const state = {
      battlefield: [
        {
          id: 'angel_of_jubilation',
          controller: 'p1',
          card: {
            name: 'Angel of Jubilation',
            type_line: 'Creature — Angel',
            oracle_text: 'Nonblack creatures you control get +1/+1.',
          },
        },
        {
          id: 'mikaeus',
          controller: 'p1',
          card: {
            name: 'Mikaeus, the Unhallowed',
            type_line: 'Legendary Creature — Zombie Cleric',
            oracle_text: 'Non-Human creatures you control get +1/+1.',
          },
        },
        {
          id: 'white_creature',
          controller: 'p1',
          card: {
            name: 'Elite Vanguard',
            type_line: 'Creature — Human Soldier',
            colors: ['W'],
            oracle_text: '',
          },
        },
        {
          id: 'black_creature',
          controller: 'p1',
          card: {
            name: 'Vampire Lacerator',
            type_line: 'Creature — Vampire Warrior',
            colors: ['B'],
            oracle_text: '',
          },
        },
        {
          id: 'elf_creature',
          controller: 'p1',
          card: {
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            colors: ['G'],
            oracle_text: '',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('white_creature')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('black_creature')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('elf_creature')).toMatchObject({ pDelta: 2, tDelta: 2 });
  });

  it('applies Coat of Arms shared-type counting through declarative specs without legacy double-count', () => {
    const state = {
      battlefield: [
        {
          id: 'coat_of_arms',
          controller: 'p1',
          card: {
            name: 'Coat of Arms',
            type_line: 'Artifact',
            oracle_text: 'Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.',
          },
        },
        {
          id: 'soldier_one',
          controller: 'p1',
          card: {
            name: 'Soldier A',
            type_line: 'Creature — Human Soldier',
            oracle_text: '',
          },
        },
        {
          id: 'soldier_two',
          controller: 'p2',
          card: {
            name: 'Soldier B',
            type_line: 'Creature — Human Soldier',
            oracle_text: '',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('soldier_one')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('soldier_two')).toMatchObject({ pDelta: 1, tDelta: 1 });

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs.some((spec) => spec.grant.countBasis === 'other_creatures_sharing_creature_type')).toBe(true);
  });

  it('applies Coat of Arms shared-type counting', () => {
    const state = {
      battlefield: [
        {
          id: 'coat_of_arms',
          controller: 'p1',
          card: {
            name: 'Coat of Arms',
            type_line: 'Artifact',
            oracle_text: 'Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.',
          },
        },
        {
          id: 'soldier_one',
          controller: 'p1',
          card: {
            name: 'Soldier A',
            type_line: 'Creature — Human Soldier',
            oracle_text: '',
          },
        },
        {
          id: 'soldier_two',
          controller: 'p2',
          card: {
            name: 'Soldier B',
            type_line: 'Creature — Human Soldier',
            oracle_text: '',
          },
        },
        {
          id: 'goblin_one',
          controller: 'p1',
          card: {
            name: 'Goblin',
            type_line: 'Creature — Goblin',
            oracle_text: '',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('soldier_one')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('soldier_two')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('goblin_one')?.pDelta || 0).toBe(0);

    const soldierBonus = calculateAllPTBonuses(state.battlefield[1], state);
    expect(soldierBonus).toMatchObject({ power: 1, toughness: 1 });
  });

  it('applies Shalai hexproof to player, planeswalkers, and other creatures without self-buff', () => {
    const state = {
      battlefield: [
        {
          id: 'shalai_perm',
          controller: 'p1',
          card: {
            name: 'Shalai, Voice of Plenty',
            type_line: 'Legendary Creature — Human Cleric',
            oracle_text: 'Flying\nYou, planeswalkers you control, and other creatures you control have hexproof.\n{4}{G}{G}: Put a +1/+1 counter on each creature you control.',
          },
        },
        {
          id: 'other_creature',
          controller: 'p1',
          card: {
            name: 'Elite Vanguard',
            type_line: 'Creature — Human Soldier',
            oracle_text: '',
          },
        },
        {
          id: 'planeswalker_perm',
          controller: 'p1',
          card: {
            name: 'Jace, the Mind Sculptor',
            type_line: 'Legendary Planeswalker — Jace',
            oracle_text: '',
          },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'player_you' },
        grant: { playerHexproof: true },
        sourcePermanentId: 'shalai_perm',
      }),
      expect.objectContaining({
        scope: { kind: 'other_creatures_you_control' },
        grant: { abilities: ['hexproof'] },
        sourcePermanentId: 'shalai_perm',
      }),
      expect.objectContaining({
        scope: { kind: 'planeswalkers_you_control' },
        grant: { abilities: ['hexproof'] },
        sourcePermanentId: 'shalai_perm',
      }),
    ]));

    const merged = recomputeContinuousEffects(state as any);
    expect([...merged.playerHexproof]).toContain('p1');
    expect(merged.perPermanent.get('other_creature')?.abilities?.has('hexproof')).toBe(true);
    expect(merged.permanentAbilities.get('planeswalker_perm')?.has('hexproof')).toBe(true);
    expect(merged.perPermanent.get('shalai_perm')?.abilities?.has('hexproof')).toBeFalsy();
  });

  it('applies Greymond chosen abilities through declarative specs without legacy double-count', () => {
    const state = {
      battlefield: [
        {
          id: 'greymond_perm',
          controller: 'p1',
          chosenOptions: ['vigilance', 'lifelink'],
          card: {
            name: "Greymond, Avacyn's Stalwart",
            type_line: 'Legendary Creature — Human Noble',
            oracle_text: 'Other Humans you control get +2/+2 and have all abilities of your choice among first strike, vigilance, and lifelink.\nOther creatures you control get +1/+1.',
          },
        },
        {
          id: 'human_perm',
          controller: 'p1',
          card: {
            name: 'Field Marshal',
            type_line: 'Creature — Human Soldier',
            oracle_text: '',
          },
        },
        {
          id: 'elf_perm',
          controller: 'p1',
          card: {
            name: 'Paradise Druid',
            type_line: 'Creature — Elf Druid',
            oracle_text: '',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('human_perm')).toMatchObject({ pDelta: 3, tDelta: 3 });
    expect(merged.perPermanent.get('human_perm')?.abilities?.has('vigilance')).toBe(true);
    expect(merged.perPermanent.get('human_perm')?.abilities?.has('lifelink')).toBe(true);
    expect(merged.perPermanent.get('human_perm')?.abilities?.has('first strike')).toBe(false);
    expect(merged.perPermanent.get('elf_perm')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('elf_perm')?.abilities?.has('vigilance')).toBe(false);
  });

  it('grants haste from Other Dinosaurs you control have haste without buffing the source', () => {
    const state = {
      battlefield: [
        {
          id: 'regisaur_1',
          controller: 'p1',
          card: {
            name: 'Regisaur Alpha',
            type_line: 'Creature — Dinosaur',
            oracle_text: 'Other Dinosaurs you control have haste.\nWhen this creature enters, create a 3/3 green Dinosaur creature token with trample.',
          },
        },
        {
          id: 'other_dino',
          controller: 'p1',
          card: {
            name: 'Earthshaker Dreadmaw',
            type_line: 'Creature — Dinosaur',
            oracle_text: 'Trample\nWhen this creature enters, draw a card for each other Dinosaur you control.',
          },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state)).toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[0] as any, state)).not.toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[2] as any, state)).not.toContain('haste');

    const keywords = parseCreatureKeywords(state.battlefield[1].card, state.battlefield[1], state);
    expect(keywords.haste).toBe(true);
  });

  it('applies global chosen-type shroud through declarative specs', () => {
    const state = {
      battlefield: [
        {
          id: 'steely_resolve',
          controller: 'p1',
          chosenCreatureType: 'Elf',
          card: {
            name: 'Steely Resolve',
            type_line: 'Enchantment',
            oracle_text: 'As this enchantment enters, choose a creature type.\nCreatures of the chosen type have shroud. (They can\'t be the targets of spells or abilities.)',
          },
        },
        {
          id: 'ally_elf',
          controller: 'p1',
          card: { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', oracle_text: '' },
        },
        {
          id: 'opponent_elf',
          controller: 'p2',
          card: { name: 'Enemy Elf', type_line: 'Creature — Elf Warrior', oracle_text: '' },
        },
        {
          id: 'ally_goblin',
          controller: 'p1',
          card: { name: 'Goblin', type_line: 'Creature — Goblin', oracle_text: '' },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('ally_elf')?.abilities?.has('shroud')).toBe(true);
    expect(merged.perPermanent.get('opponent_elf')?.abilities?.has('shroud')).toBe(true);
    expect(merged.perPermanent.get('ally_goblin')?.abilities?.has('shroud')).toBe(false);
  });

  it('grants shroud and haste from Lightning Greaves to the equipped host', () => {
    const state = {
      battlefield: [
        {
          id: 'greaves_1',
          controller: 'p1',
          attachedTo: 'bear_1',
          card: {
            name: 'Lightning Greaves',
            type_line: 'Artifact — Equipment',
            oracle_text: 'Equipped creature has haste and shroud.\nEquip {0}',
          },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          attachedEquipment: ['greaves_1'],
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('bear_1')?.abilities?.has('shroud')).toBe(true);
    expect(merged.perPermanent.get('bear_1')?.abilities?.has('haste')).toBe(true);
    expect(merged.perPermanent.get('greaves_1')?.abilities?.has('shroud')).toBeFalsy();
  });

  it('applies controlled chosen-type anthem buffs through declarative specs', () => {
    const state = {
      battlefield: [
        {
          id: 'radiant_destiny',
          controller: 'p1',
          chosenCreatureType: 'Vampire',
          card: {
            name: 'Radiant Destiny',
            type_line: 'Enchantment',
            oracle_text: 'Ascend\nAs this enchantment enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1. As long as you have the city\'s blessing, they also have vigilance.',
          },
        },
        {
          id: 'vampire_ally',
          controller: 'p1',
          card: { name: 'Vampire', type_line: 'Creature — Vampire', oracle_text: '' },
        },
        {
          id: 'opponent_vampire',
          controller: 'p2',
          card: { name: 'Enemy Vampire', type_line: 'Creature — Vampire', oracle_text: '' },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('vampire_ally')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('opponent_vampire')?.pDelta || 0).toBe(0);
  });

  it('applies Morophon chosen-type lord buffs without legacy double-count', () => {
    const state = {
      battlefield: [
        {
          id: 'morophon',
          controller: 'p1',
          chosenCreatureType: 'Merfolk',
          card: {
            name: 'Morophon, the Boundless',
            type_line: 'Legendary Creature — Shapeshifter',
            oracle_text: 'Changeling\nAs Morophon, the Boundless enters, choose a creature type.\nOther creatures you control of the chosen type get +1/+1.',
          },
        },
        {
          id: 'merfolk_ally',
          controller: 'p1',
          card: { name: 'Merfolk', type_line: 'Creature — Merfolk', oracle_text: '' },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('merfolk_ally')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('morophon')?.pDelta || 0).toBe(0);
  });

  it('stacks Morophon copy lords and buffs changeling Morphons as Merfolk', () => {
    const morophonOracle =
      'Changeling (This card is every creature type.)\n' +
      'As Morophon enters, choose a creature type.\n' +
      'Other creatures you control of the chosen type get +1/+1.';

    const state = {
      morophonChosenType: {
        morophon_original: 'Merfolk',
        morophon_copy: 'Merfolk',
      },
      battlefield: [
        {
          id: 'morophon_original',
          controller: 'p1',
          chosenCreatureType: 'Merfolk',
          card: {
            name: 'Morophon, the Boundless',
            type_line: 'Legendary Creature — Shapeshifter',
            oracle_text: morophonOracle,
            keywords: ['Changeling'],
          },
        },
        {
          id: 'morophon_copy',
          controller: 'p1',
          isToken: true,
          isCopyToken: true,
          // Copy may only keep the choice on the card shell / state map.
          card: {
            name: 'Morophon, the Boundless',
            type_line: 'Creature — Shapeshifter',
            oracle_text: morophonOracle,
            keywords: ['Changeling'],
            chosenCreatureType: 'Merfolk',
          },
        },
        {
          id: 'merfolk_ally',
          controller: 'p1',
          card: { name: 'Merfolk', type_line: 'Creature — Merfolk', oracle_text: '' },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    // Each Morophon buffs the other (+1) and both buff the Merfolk (+2).
    expect(merged.perPermanent.get('merfolk_ally')).toMatchObject({ pDelta: 2, tDelta: 2 });
    expect(merged.perPermanent.get('morophon_original')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('morophon_copy')).toMatchObject({ pDelta: 1, tDelta: 1 });

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs.filter((spec) => String(spec.id).includes('chosen-type-other-lord'))).toHaveLength(2);
  });

  it('applies Morophon lord when chosen type is only on the state map', () => {
    const state = {
      morophonChosenType: { morophon_copy: 'Merfolk' },
      battlefield: [
        {
          id: 'morophon_copy',
          controller: 'p1',
          isToken: true,
          card: {
            name: 'Morophon, the Boundless',
            type_line: 'Creature — Shapeshifter',
            oracle_text:
              'Changeling\nAs Morophon enters, choose a creature type.\nOther creatures you control of the chosen type get +1/+1.',
          },
        },
        {
          id: 'merfolk_ally',
          controller: 'p1',
          card: { name: 'Merfolk', type_line: 'Creature — Merfolk', oracle_text: '' },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('merfolk_ally')).toMatchObject({ pDelta: 1, tDelta: 1 });
  });

  it('applies Sliver Legion per-other-sliver counting through declarative specs without legacy double-count', () => {
    const state = {
      battlefield: [
        {
          id: 'sliver_legion',
          controller: 'p1',
          card: {
            name: 'Sliver Legion',
            type_line: 'Legendary Creature — Sliver',
            oracle_text: 'All Sliver creatures get +1/+1 for each other Sliver on the battlefield.',
          },
        },
        {
          id: 'sliver_two',
          controller: 'p1',
          card: {
            name: 'Metallic Sliver',
            type_line: 'Artifact Creature — Sliver',
            oracle_text: '',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('sliver_legion')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('sliver_two')).toMatchObject({ pDelta: 1, tDelta: 1 });

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs.some((spec) => spec.grant.countBasis === 'other_creatures_matching_scope')).toBe(true);
  });

  it('applies Sliver Legion per-other-sliver counting', () => {
    const state = {
      battlefield: [
        {
          id: 'sliver_legion',
          controller: 'p1',
          card: {
            name: 'Sliver Legion',
            type_line: 'Legendary Creature — Sliver',
            oracle_text: 'All Sliver creatures get +1/+1 for each other Sliver on the battlefield.',
          },
        },
        {
          id: 'sliver_two',
          controller: 'p1',
          card: {
            name: 'Metallic Sliver',
            type_line: 'Artifact Creature — Sliver',
            oracle_text: '',
          },
        },
        {
          id: 'nonsliver',
          controller: 'p1',
          card: {
            name: 'Elite Vanguard',
            type_line: 'Creature — Human Soldier',
            oracle_text: '',
          },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('sliver_legion')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('sliver_two')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(merged.perPermanent.get('nonsliver')?.pDelta || 0).toBe(0);
  });

  it('grants haste from Anger in the graveyard when you control a Mountain', () => {
    // oracle-cards / mtg_data.db: "Haste\nAs long as this card is in your graveyard and you control a Mountain, creatures you control have haste."
    const angerOracle = 'Haste\nAs long as this card is in your graveyard and you control a Mountain, creatures you control have haste.';
    const state = {
      battlefield: [
        {
          id: 'mountain_1',
          controller: 'p1',
          card: { name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.' },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
      zones: {
        p1: {
          graveyard: [{
            id: 'anger_gy',
            name: 'Anger',
            type_line: 'Creature — Incarnation',
            oracle_text: angerOracle,
          }],
        },
      },
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'creatures_you_control' },
        grant: { abilities: ['haste'] },
        condition: { kind: 'source_in_graveyard_and_control_land_type', landType: 'mountain' },
        sourcePermanentId: 'anger_gy',
      }),
    ]));

    const withMountain = recomputeContinuousEffects(state as any);
    expect(withMountain.perPermanent.get('bear_1')?.abilities?.has('haste')).toBe(true);

    const withoutMountain = recomputeContinuousEffects({
      ...state,
      battlefield: [state.battlefield[1]],
    } as any);
    expect(withoutMountain.perPermanent.get('bear_1')?.abilities?.has('haste')).toBeFalsy();
  });

  it('does not apply battlefield soldier/dinosaur lords from the graveyard', () => {
    // Valiant Veteran / Dinosaurs on a Spaceship are battlefield statics. Scanning every
    // GY card through parseStaticEffectSpecsFromOraclePermanent used to keep those anthems
    // live after Reckless Blaze (and after a commander recast).
    const veteranOracle = 'Other Soldiers you control get +1/+1.\n{3}{W}{W}, Exile this card from your graveyard: Put a +1/+1 counter on each Soldier you control.';
    const spaceshipOracle = "Vigilance, trample\nOther Dinosaurs you control get +1/+1 and have vigilance and trample.\nSuspend 4—{3}{R}{W}\nWhenever a time counter is removed from this card while it's exiled, create a 2/2 red and white Dinosaur creature token with flying and haste.";

    const gyState = {
      battlefield: [
        {
          id: 'myrel_1',
          controller: 'p1',
          card: {
            name: 'Myrel, Shield of Argive',
            type_line: 'Legendary Creature — Human Soldier',
            oracle_text: '',
            power: '3',
            toughness: '4',
          },
        },
        {
          id: 'dino_1',
          controller: 'p2',
          card: {
            name: 'Ghalta, Primal Hunger',
            type_line: 'Legendary Creature — Dinosaur',
            oracle_text: '',
            power: '12',
            toughness: '12',
          },
        },
      ],
      zones: {
        p1: {
          graveyard: [{
            id: 'veteran_gy',
            name: 'Valiant Veteran',
            type_line: 'Creature — Kor Soldier',
            oracle_text: veteranOracle,
          }],
        },
        p2: {
          graveyard: [{
            id: 'spaceship_gy',
            name: 'Dinosaurs on a Spaceship',
            type_line: 'Creature — Dinosaur',
            oracle_text: spaceshipOracle,
          }],
        },
      },
    };

    const gySpecs = collectStaticEffectSpecsFromState(gyState);
    expect(gySpecs.some((spec) => spec.sourcePermanentId === 'veteran_gy')).toBe(false);
    expect(gySpecs.some((spec) => spec.sourcePermanentId === 'spaceship_gy')).toBe(false);

    const gyEffects = recomputeContinuousEffects(gyState as any);
    expect(gyEffects.perPermanent.get('myrel_1')?.pDelta || 0).toBe(0);
    expect(gyEffects.perPermanent.get('dino_1')?.pDelta || 0).toBe(0);
    expect(gyEffects.perPermanent.get('dino_1')?.abilities?.has('vigilance')).toBeFalsy();
    expect(gyEffects.perPermanent.get('dino_1')?.abilities?.has('trample')).toBeFalsy();

    const battlefieldState = {
      battlefield: [
        {
          id: 'veteran_bf',
          controller: 'p1',
          card: {
            name: 'Valiant Veteran',
            type_line: 'Creature — Kor Soldier',
            oracle_text: veteranOracle,
            power: '2',
            toughness: '2',
          },
        },
        gyState.battlefield[0],
        {
          id: 'spaceship_bf',
          controller: 'p2',
          card: {
            name: 'Dinosaurs on a Spaceship',
            type_line: 'Creature — Dinosaur',
            oracle_text: spaceshipOracle,
            power: '7',
            toughness: '7',
          },
        },
        gyState.battlefield[1],
      ],
    };

    const bfEffects = recomputeContinuousEffects(battlefieldState as any);
    expect(bfEffects.perPermanent.get('myrel_1')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(bfEffects.perPermanent.get('dino_1')).toMatchObject({ pDelta: 1, tDelta: 1 });
    expect(bfEffects.perPermanent.get('dino_1')?.abilities?.has('vigilance')).toBe(true);
    expect(bfEffects.perPermanent.get('dino_1')?.abilities?.has('trample')).toBe(true);
  });

  it('grants G or W to lands from Riftstone Portal only while it is in the graveyard', () => {
    const riftstoneOracle = '{T}: Add {C}.\nAs long as this card is in your graveyard, lands you control have "{T}: Add {G} or {W}."';
    const forest = {
      id: 'forest_1',
      controller: 'p1',
      card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
    };
    const gyState = {
      battlefield: [forest],
      zones: {
        p1: {
          graveyard: [{
            id: 'riftstone_gy',
            name: 'Riftstone Portal',
            type_line: 'Land',
            oracle_text: riftstoneOracle,
          }],
        },
      },
    };

    const gySpecs = collectStaticEffectSpecsFromState(gyState);
    expect(gySpecs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePermanentId: 'riftstone_gy',
        scope: { kind: 'lands_you_control' },
        grant: { abilities: expect.arrayContaining(['tap_for_green', 'tap_for_white']) },
        condition: { kind: 'source_in_graveyard' },
      }),
    ]));

    const gyEffects = recomputeContinuousEffects(gyState as any);
    expect(gyEffects.permanentAbilities.get('forest_1')?.has('tap_for_green')).toBe(true);
    expect(gyEffects.permanentAbilities.get('forest_1')?.has('tap_for_white')).toBe(true);

    const bfState = {
      battlefield: [
        {
          id: 'riftstone_bf',
          controller: 'p1',
          card: {
            name: 'Riftstone Portal',
            type_line: 'Land',
            oracle_text: riftstoneOracle,
          },
        },
        forest,
      ],
    };
    const bfEffects = recomputeContinuousEffects(bfState as any);
    expect(bfEffects.permanentAbilities.get('forest_1')?.has('tap_for_green')).toBeFalsy();
    expect(bfEffects.permanentAbilities.get('forest_1')?.has('tap_for_white')).toBeFalsy();
  });

  it('grants player hexproof from Leyline of Sanctity oracle', () => {
    // oracle-cards / mtg_data.db: "If this card is in your opening hand, you may begin the game with it on the battlefield.\nYou have hexproof. (You can't be the target of spells or abilities your opponents control.)"
    const state = {
      battlefield: [{
        id: 'leyline_1',
        controller: 'p1',
        card: {
          name: 'Leyline of Sanctity',
          type_line: 'Enchantment',
          oracle_text: 'If this card is in your opening hand, you may begin the game with it on the battlefield.\nYou have hexproof. (You can\'t be the target of spells or abilities your opponents control.)',
        },
      }],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs.some((spec) => spec.grant.playerHexproof && spec.scope.kind === 'player_you')).toBe(true);

    const merged = recomputeContinuousEffects(state as any);
    expect([...merged.playerHexproof]).toContain('p1');
  });

  it('applies Elesh Norn other-creature buff and opponent-creature debuff', () => {
    // oracle-cards / mtg_data.db: "Vigilance\nOther creatures you control get +2/+2.\nCreatures your opponents control get -2/-2."
    const state = {
      battlefield: [
        {
          id: 'elesh_1',
          controller: 'p1',
          card: {
            name: 'Elesh Norn, Grand Cenobite',
            type_line: 'Legendary Creature — Phyrexian Praetor',
            oracle_text: 'Vigilance\nOther creatures you control get +2/+2.\nCreatures your opponents control get -2/-2.',
            power: '4',
            toughness: '7',
          },
        },
        {
          id: 'ally_1',
          controller: 'p1',
          card: { name: 'Elite Vanguard', type_line: 'Creature — Human Soldier', oracle_text: '', power: '2', toughness: '1' },
        },
        {
          id: 'enemy_1',
          controller: 'p2',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' },
        },
      ],
    };

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('ally_1')).toMatchObject({ pDelta: 2, tDelta: 2 });
    expect(merged.perPermanent.get('enemy_1')).toMatchObject({ pDelta: -2, tDelta: -2 });
    expect(merged.perPermanent.get('elesh_1')?.pDelta || 0).toBe(0);
  });

  it('grants Cryptolith Rite tap-for-any-color via declarative specs', () => {
    // oracle-cards / mtg_data.db: "Creatures you control have \"{T}: Add one mana of any color.\""
    const state = {
      battlefield: [
        {
          id: 'cryptolith_1',
          controller: 'p1',
          card: {
            name: 'Cryptolith Rite',
            type_line: 'Enchantment',
            oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
          },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs.some((spec) => spec.grant.abilities?.includes('tap_for_any_color'))).toBe(true);

    const merged = recomputeContinuousEffects(state as any);
    expect(merged.perPermanent.get('bear_1')?.abilities?.has('tap_for_any_color')).toBe(true);
    expect(merged.permanentAbilities.get('cryptolith_1')?.has('tap_for_any_color')).toBeFalsy();
  });
});
