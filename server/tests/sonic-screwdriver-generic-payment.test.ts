import { describe, expect, it } from 'vitest';
import { getAvailableMana, getTotalManaFromPool } from '../src/state/modules/mana-check.js';
import { tryAssembleCastSpellCostAndConvokeFromHand } from '../src/socket/game-actions-handlers/gameActionsCastSpellFromHandCostConvoke.js';

const SONIC_TEXT = "{T}: Add one mana of any color.\n{1}, {T}: Untap another target artifact.\n{2}, {T}: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)\n{3}, {T}: Target creature can't be blocked this turn.";

const playerId = 'p_7f227n2y';

function battlefield() {
  return [
    { id: 'perm_swamp_1', controller: playerId, tapped: false, card: { name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '{T}: Add {B}.' } },
    { id: 'perm_swamp_2', controller: playerId, tapped: false, card: { name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '{T}: Add {B}.' } },
    { id: 'perm_xtgx1xvv', controller: playerId, tapped: false, card: { name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.' } },
    { id: 'stack_f59sswgb', controller: playerId, tapped: false, card: { name: 'Sonic Screwdriver', type_line: 'Artifact', oracle_text: SONIC_TEXT, mana_cost: '{3}' } },
  ];
}

describe('Sonic Screwdriver generic spell payment', () => {
  it('counts the screwdriver with two swamps and a mountain as 4 mana', () => {
    const state = { battlefield: battlefield(), manaPool: {} };
    const pool = getAvailableMana(state, playerId);
    expect(getTotalManaFromPool(pool)).toBe(4);
  });

  it('pays {4} with two grouped swamps, a mountain, and native_any white', () => {
    const errors: Array<{ code?: string; message?: string }> = [];
    const game = {
      state: {
        battlefield: battlefield(),
        manaPool: {},
        players: [{ id: playerId, life: 40 }],
        life: { [playerId]: 40 },
      },
    };
    const result = tryAssembleCastSpellCostAndConvokeFromHand({
      io: {} as any,
      socket: { emit: (_event: string, payload: any) => { errors.push(payload); } } as any,
      game,
      gameId: 'game_mvobo6ks',
      playerId,
      cardInHand: {
        id: 'helm',
        name: 'Helm of the Host',
        mana_cost: '{4}',
        type_line: 'Legendary Artifact — Equipment',
        oracle_text: "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}",
      },
      alternateCostId: undefined,
      isForceAltCostRequested: false,
      overloadRequested: false,
      commandZoneManaCost: undefined,
      spellModeAdditionalCost: undefined,
      resolvedTimesKicked: undefined,
      xValue: undefined,
      payment: [
        { permanentId: 'group_perm_swamp_1', paymentSourceId: 'group_perm_swamp_1::native_b', abilityId: 'native_b', mana: 'B', producedColors: ['B'], count: 1 },
        { permanentId: 'group_perm_swamp_1', paymentSourceId: 'group_perm_swamp_1::native_b', abilityId: 'native_b', mana: 'B', producedColors: ['B'], count: 1 },
        { permanentId: 'perm_xtgx1xvv', paymentSourceId: 'perm_xtgx1xvv::native_r', abilityId: 'native_r', mana: 'R', producedColors: ['R'], count: 1 },
        { permanentId: 'stack_f59sswgb', paymentSourceId: 'stack_f59sswgb::native_any', abilityId: 'native_any', mana: 'W', count: 1 },
      ] as any,
      castSourceZone: 'hand',
      harmonizeTappedCreatureId: undefined,
      sneakReturnedCreatureId: undefined,
      webSlingingReturnedCreatureId: undefined,
      convokeTappedCreatures: undefined,
    });

    expect(errors).toEqual([]);
    expect(result?.kind).toBe('continue');
    expect((game.state as any)._lastCastPaymentFailure).toBeUndefined();
  });

  it('counts a continuous any-color tap grant the payment UI offers', () => {
    const rite = {
      id: 'rite',
      controller: playerId,
      tapped: false,
      card: {
        name: 'Cryptolith Rite',
        type_line: 'Enchantment',
        oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
      },
    };
    const bear = {
      id: 'bear',
      controller: playerId,
      tapped: false,
      summoningSickness: false,
      card: {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
    };
    const riteOnly = getTotalManaFromPool(getAvailableMana({ battlefield: [rite], manaPool: {} }, playerId));
    const withBear = getTotalManaFromPool(getAvailableMana({ battlefield: [rite, bear], manaPool: {} }, playerId));
    expect(withBear - riteOnly).toBe(1);

    const stamped = getTotalManaFromPool(getAvailableMana({
      battlefield: [{ ...bear, grantedAbilities: ['tap_for_any_color'] }],
      manaPool: {},
    }, playerId));
    expect(stamped).toBe(1);
  });

  it('remembers why a selected source was not on the battlefield', () => {
    const game = {
      state: {
        battlefield: battlefield().filter((perm) => perm.id !== 'stack_f59sswgb'),
        manaPool: {},
        players: [{ id: playerId, life: 40 }],
        life: { [playerId]: 40 },
      },
    };
    const result = tryAssembleCastSpellCostAndConvokeFromHand({
      io: {} as any,
      socket: { emit: () => undefined } as any,
      game,
      gameId: 'game_mvobo6ks',
      playerId,
      cardInHand: {
        id: 'helm',
        name: 'Helm of the Host',
        mana_cost: '{4}',
        type_line: 'Legendary Artifact — Equipment',
        oracle_text: 'Equip {5}',
      },
      alternateCostId: undefined,
      isForceAltCostRequested: false,
      overloadRequested: false,
      commandZoneManaCost: undefined,
      spellModeAdditionalCost: undefined,
      resolvedTimesKicked: undefined,
      xValue: undefined,
      payment: [
        { permanentId: 'group_perm_swamp_1', abilityId: 'native_b', mana: 'B', producedColors: ['B'], count: 1 },
        { permanentId: 'group_perm_swamp_1', abilityId: 'native_b', mana: 'B', producedColors: ['B'], count: 1 },
        { permanentId: 'perm_xtgx1xvv', abilityId: 'native_r', mana: 'R', producedColors: ['R'], count: 1 },
        { permanentId: 'stack_f59sswgb', abilityId: 'native_any', mana: 'W', count: 1 },
      ] as any,
      castSourceZone: 'hand',
      harmonizeTappedCreatureId: undefined,
      sneakReturnedCreatureId: undefined,
      webSlingingReturnedCreatureId: undefined,
      convokeTappedCreatures: undefined,
    });

    expect(result).toBeUndefined();
    expect(String((game.state as any)._lastCastPaymentFailure?.message || '')).toContain('stack_f59sswgb');
  });
});
