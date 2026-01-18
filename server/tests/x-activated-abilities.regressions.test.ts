import { describe, it, expect } from 'vitest';
import { createContext } from '../src/state/context.js';
import { detectXAbility, executeXAbility } from '../src/state/modules/x-activated-abilities.js';
import type { PlayerID } from '../../shared/src';

describe('X-activated abilities (regressions)', () => {
  it('Crypt Rats {X} deals X damage to each creature and each player', () => {
    const ctx = createContext('x_ability_crypt_rats');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    (ctx.state as any).players = [
      { id: p1, name: 'Player 1', seat: 0 } as any,
      { id: p2, name: 'Player 2', seat: 1 } as any,
    ];

    // Ensure life tracking exists
    (ctx.state as any).startingLife = 40;
    (ctx.state as any).life = { [p1]: 40, [p2]: 40 };

    // Ensure zones exist for completeness
    (ctx.state as any).zones[p1] = { graveyard: [], graveyardCount: 0 } as any;
    (ctx.state as any).zones[p2] = { graveyard: [], graveyardCount: 0 } as any;

    const oracle = '{X}: Crypt Rats deals X damage to each creature and each player. Spend only black mana on X.';

    const cryptRats = {
      id: 'crypt_rats_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'crypt_rats_card_1',
        name: 'Crypt Rats',
        type_line: 'Creature — Rat',
        oracle_text: oracle,
        mana_cost: '{2}{B}',
        cmc: 3,
      },
      damageMarked: 0,
    } as any;

    const otherCreature = {
      id: 'bear_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'bear_card_1',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        mana_cost: '{1}{G}',
        cmc: 2,
      },
      damageMarked: 0,
    } as any;

    const nonCreature = {
      id: 'rock_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'rock_card_1',
        name: 'Sol Ring',
        type_line: 'Artifact',
        mana_cost: '{1}',
        cmc: 1,
      },
      damageMarked: 0,
    } as any;

    (ctx.state as any).battlefield = [cryptRats, otherCreature, nonCreature];

    const info = detectXAbility(oracle, 'crypt rats');
    expect(info).toBeTruthy();
    expect(info?.pattern).toBeTruthy();

    const result = executeXAbility(ctx as any, p1, cryptRats, 3, info as any);
    expect(result.success).toBe(true);

    // Damage to creatures only
    expect((cryptRats as any).damageMarked).toBe(3);
    expect((otherCreature as any).damageMarked).toBe(3);
    expect((nonCreature as any).damageMarked).toBe(0);

    // Damage to each player
    expect((ctx.state as any).life[p1]).toBe(37);
    expect((ctx.state as any).life[p2]).toBe(37);
  });

  it('Helix Pinnacle {X} puts X tower counters on itself', () => {
    const ctx = createContext('x_ability_helix_pinnacle');

    const p1 = 'p1' as PlayerID;
    (ctx.state as any).players = [{ id: p1, name: 'Player 1', seat: 0 } as any];

    const oracle = '{X}: Put X tower counters on Helix Pinnacle.';

    const helix = {
      id: 'helix_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'helix_card_1',
        name: 'Helix Pinnacle',
        type_line: 'Enchantment',
        oracle_text: oracle,
        mana_cost: '{G}',
        cmc: 1,
      },
      counters: { tower: 1 },
    } as any;

    (ctx.state as any).battlefield = [helix];

    const info = detectXAbility(oracle, 'helix pinnacle');
    expect(info).toBeTruthy();

    const result = executeXAbility(ctx as any, p1, helix, 4, info as any);
    expect(result.success).toBe(true);

    expect((helix as any).counters?.tower).toBe(5);
  });
});
