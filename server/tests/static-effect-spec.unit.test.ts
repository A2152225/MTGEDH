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
});
