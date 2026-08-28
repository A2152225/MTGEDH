import { describe, expect, it } from 'vitest';

import { detectCastTrigger, hasCascade } from '../../rules-engine/src/cards/castTriggers.js';
import { detectKeywords } from '../src/state/modules/keyword-detection.js';
import { getCascadeInstancesForCast } from '../src/state/modules/cascadeCastGrants.js';
import { castSpell } from '../src/state/modules/stackCastSpellUtils.js';

const WILD_MAGIC_ORACLE =
  'The first spell you cast from exile each turn has cascade. (When you cast your first spell from exile, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)';

function wildMagicPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: {
      id: `${id}_card`,
      name: 'Wild-Magic Sorcerer',
      type_line: 'Creature — Orc Shaman Sorcerer',
      mana_cost: '{3}{R}',
      oracle_text: WILD_MAGIC_ORACLE,
    },
  };
}

function createCastContext() {
  const state: any = {
    players: [{ id: 'p1', name: 'P1', hasLost: false }],
    zones: {
      p1: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    },
    battlefield: [],
    stack: [],
    phase: 'precombatMain',
    step: 'MAIN1',
    turnPlayer: 'p1',
    activePlayer: 'p1',
    priority: 'p1',
  };

  return {
    state,
    libraries: new Map<string, any[]>([['p1', []]]),
    inactive: new Set<string>(),
    passesInRow: { value: 0 },
    bumpSeq: () => undefined,
  } as any;
}

describe('Wild-Magic Sorcerer cascade grant', () => {
  it('does not treat the sorcerer as having cascade', () => {
    expect(hasCascade(WILD_MAGIC_ORACLE)).toBe(false);
    expect(detectCastTrigger(WILD_MAGIC_ORACLE, 'Creature — Orc Shaman Sorcerer').hasCascade).toBeFalsy();
    expect(detectKeywords(WILD_MAGIC_ORACLE, 'Wild-Magic Sorcerer').keywords.some((k) => k.keyword === 'cascade')).toBe(false);
  });

  it('does not queue cascade when the sorcerer is cast from hand', () => {
    const ctx = createCastContext();
    const sorcerer = {
      id: 'wms_cast',
      name: 'Wild-Magic Sorcerer',
      type_line: 'Creature — Orc Shaman Sorcerer',
      mana_cost: '{3}{R}',
      oracle_text: WILD_MAGIC_ORACLE,
    };
    ctx.state.zones.p1.hand = [sorcerer];
    ctx.state.zones.p1.handCount = 1;

    castSpell(ctx, 'p1', sorcerer);

    expect(ctx.state.stack).toHaveLength(1);
    expect(ctx.state.pendingCascade).toBeUndefined();
  });

  it('grants cascade to the first spell cast from exile, but not the second', () => {
    const ctx = createCastContext();
    ctx.state.battlefield = [wildMagicPermanent('wms_bf', 'p1')];

    const first = {
      id: 'bolt_exile_1',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      mana_cost: '{R}',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    };
    const second = {
      id: 'shock_exile_1',
      name: 'Shock',
      type_line: 'Instant',
      mana_cost: '{R}',
      oracle_text: 'Shock deals 2 damage to any target.',
    };
    ctx.state.zones.p1.exile = [first, second];
    ctx.state.zones.p1.exileCount = 2;

    castSpell(ctx, 'p1', first);
    expect(ctx.state.pendingCascade?.p1).toHaveLength(1);
    expect(ctx.state.pendingCascade.p1[0].sourceCardId).toBe('bolt_exile_1');

    castSpell(ctx, 'p1', second);
    expect(ctx.state.pendingCascade?.p1).toHaveLength(1);
  });

  it('stacks granted cascade from each Wild-Magic Sorcerer you control', () => {
    expect(getCascadeInstancesForCast(
      { battlefield: [wildMagicPermanent('wms_a', 'p1'), wildMagicPermanent('wms_b', 'p1')] },
      'p1',
      { name: 'Lightning Bolt', oracle_text: 'Lightning Bolt deals 3 damage to any target.' },
      { castSourceZone: 'exile', isFirstSpellCastFromExileThisTurn: true },
    )).toBe(2);
  });
});
