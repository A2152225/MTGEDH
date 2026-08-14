import { describe, expect, it } from 'vitest';
import { oracleTextGrantsOwnKeyword, parseCreatureKeywords } from '../src/state/modules/combat-mechanics.js';
import { applyAscendCitysBlessing } from '../src/state/modules/game-state-effects.js';

describe('oracleTextGrantsOwnKeyword', () => {
  it('detects keyword ability lines on the permanent', () => {
    expect(oracleTextGrantsOwnKeyword('Flying\nTrample\nWhenever ~ deals damage, draw a card.', 'trample')).toBe(true);
    expect(oracleTextGrantsOwnKeyword('Flying, trample\n{T}: Add {G}.', 'trample')).toBe(true);
  });

  it('does not grant trample from anthem text about other creatures', () => {
    expect(oracleTextGrantsOwnKeyword(
      'Other creatures you control have trample.\nWhenever a creature you control deals combat damage to a player, draw a card.',
      'trample',
    )).toBe(false);

    const keywords = parseCreatureKeywords({
      name: 'Anthem Commander',
      oracle_text: 'Other creatures you control have trample.\n{2}{G}: Target creature gets +2/+2 until end of turn.',
      keywords: [],
    });
    expect(keywords.trample).toBe(false);
  });
});

describe('applyAscendCitysBlessing', () => {
  it('grants city blessing when an Ascend permanent controller has 10+ permanents', () => {
    const playerId = 'p1';
    const battlefield = Array.from({ length: 10 }, (_, i) => ({
      id: `perm_${i}`,
      controller: playerId,
      card: i === 0
        ? { name: 'Shadowed Caravel', oracle_text: 'Ascend\nWhenever ~ attacks, ...', keywords: ['Ascend'] }
        : { name: `Permanent ${i}`, oracle_text: '', type_line: 'Artifact' },
    }));
    const ctx = {
      state: {
        players: [{ id: playerId }],
        battlefield,
        cityBlessing: {},
      },
    } as any;

    expect(applyAscendCitysBlessing(ctx)).toEqual([playerId]);
    expect(ctx.state.cityBlessing[playerId]).toBe(true);
  });

  it('does not grant without Ascend or with fewer than 10 permanents', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: Array.from({ length: 9 }, (_, i) => ({
          id: `perm_${i}`,
          controller: 'p1',
          card: { name: 'Thing', oracle_text: 'Ascend', keywords: ['Ascend'] },
        })),
        cityBlessing: {},
      },
    } as any;
    expect(applyAscendCitysBlessing(ctx)).toEqual([]);
    expect(ctx.state.cityBlessing.p1).toBeFalsy();
  });
});

describe('parseCreatureKeywords player-specific cannot-attack', () => {
  it('does not treat cannot-attack-owner as a blanket cantAttack keyword', () => {
    const keywords = parseCreatureKeywords({
      name: 'Sleeper',
      oracle_text:
        "Trample\nThis creature attacks each combat if able, can't be sacrificed, and can't attack its owner.",
      keywords: [],
      type_line: 'Legendary Creature — Human Berserker',
    });
    expect(keywords.trample).toBe(true);
    expect(keywords.cantAttack).toBe(false);
    expect(keywords.defender).toBe(false);
  });
});
