import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';

// "When this enchantment enters, it deals X damage to each creature."
const ORACLE = 'When this enchantment enters, it deals X damage to each creature.\nWhenever one or more creatures your opponents control die, you create a Treasure token. This ability triggers only once each turn.';

function creature(id: string, controller: string, power: string, toughness: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: id,
      type_line: 'Creature — Bear',
      power,
      toughness,
      oracle_text: '',
    },
  };
}

function cast(xValue: number) {
  const game = createInitialGameState(`spiteful_banditry_x_${xValue}`);
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
  game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
  const state: any = game.state;
  const emptyZone = () => ({
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  });
  state.zones = { [p1]: emptyZone(), [p2]: emptyZone() };
  state.life = { [p1]: 40, [p2]: 40 };
  state.battlefield = [
    creature('my_soldier', p1, '3', '3'),
    creature('their_bear', p2, '2', '2'),
    creature('their_giant', p2, '8', '8'),
    {
      id: 'their_land',
      controller: p2,
      owner: p2,
      tapped: false,
      card: { id: 'land_card', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
    },
  ];
  state.stack = [{
    id: 'spiteful_stack',
    type: 'spell',
    controller: p1,
    xValue,
    card: {
      id: 'spiteful_card',
      name: 'Spiteful Banditry',
      type_line: 'Enchantment',
      mana_cost: '{X}{R}{R}',
      oracle_text: ORACLE,
    },
  }];
  (game as any).gameId = state.id || `spiteful_banditry_x_${xValue}`;
  resolveTopOfStack(game as any);
  resolveTopOfStack(game as any);
  return state;
}

describe('Spiteful Banditry X damage', () => {
  const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  afterEach(() => {
    if (previousTriggerPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
  });

  it('X=7 deals 7 to each creature, including opponents, and destroys those with toughness 7 or less', () => {
    const state = cast(7);
    const ids = (state.battlefield || []).map((permanent: any) => permanent.id);
    const banditry = (state.battlefield || []).find((permanent: any) => permanent.card?.name === 'Spiteful Banditry');
    const giant = (state.battlefield || []).find((permanent: any) => permanent.id === 'their_giant');
    const land = (state.battlefield || []).find((permanent: any) => permanent.id === 'their_land');
    const graveyardNames = [
      ...(state.zones.p1.graveyard || []),
      ...(state.zones.p2.graveyard || []),
    ].map((card: any) => card.name);

    expect(banditry?.xValue).toBe(7);
    expect(ids).not.toContain('their_bear');
    expect(ids).not.toContain('my_soldier');
    expect(graveyardNames).toEqual(expect.arrayContaining(['their_bear', 'my_soldier']));
    expect(ids).toContain('their_giant');
    expect(Number(giant?.damageMarked || giant?.damage || 0)).toBe(7);
    expect(ids).toContain('their_land');
    expect(Number(land?.damageMarked || land?.damage || 0)).toBe(0);
    expect((state.stack || []).some((item: any) => /treasure/i.test(String(item?.effect || item?.description || '')))).toBe(true);
  });

  it('X=0 deals no damage and destroys nothing', () => {
    const state = cast(0);
    const ids = (state.battlefield || []).map((permanent: any) => permanent.id);
    expect(ids).toEqual(expect.arrayContaining(['my_soldier', 'their_bear', 'their_giant', 'their_land']));
    const giant = (state.battlefield || []).find((permanent: any) => permanent.id === 'their_giant');
    expect(Number(giant?.damageMarked || giant?.damage || 0)).toBe(0);
  });
});
