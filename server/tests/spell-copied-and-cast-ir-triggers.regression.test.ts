import { describe, expect, it } from 'vitest';
import { copyStackItem } from '../src/state/modules/stack-mechanics.js';
import { queueSpellCopiedTriggers } from '../src/state/modules/triggers/spell-copied.js';
import { getSpellCastTriggersForCard } from '../src/socket/game-actions-handlers/gameActionsSpellCastTriggerDetection.js';

const MAGECRAFT = 'Magecraft \u2014 Whenever you cast or copy an instant or sorcery spell, put a +1/+1 counter on Archmage Emeritus.';
const COPY_A_SPELL = 'Whenever you copy a spell, draw a card.';

function perm(id: string, name: string, oracle: string, controller = 'p1') {
  return { id, controller, owner: controller, card: { id: id + '_c', name, type_line: 'Creature', oracle_text: oracle } };
}

function ctxWith(battlefield: any[], spell: any) {
  return {
    gameId: 'unknown',
    isReplaying: false,
    seq: { value: 0 },
    bumpSeq: () => {},
    state: {
      players: [{ id: 'p1' }, { id: 'p2' }],
      activePlayer: 'p1',
      turnPlayer: 'p1',
      battlefield,
      stack: [spell],
    },
  } as any;
}

const bolt = { id: 'spell_1', type: 'spell', controller: 'p1', card: { id: 'c1', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', colors: ['R'], cmc: 1 } };

function triggersOf(ctx: any) {
  return ctx.state.stack.filter((item: any) => item.type === 'triggered_ability');
}

describe('spell_copied trigger event', () => {
  it('fires Magecraft copy half and "whenever you copy a spell" exactly once per copy', () => {
    const ctx = ctxWith([perm('m', 'Archmage Emeritus', MAGECRAFT), perm('d', 'Copy Fan', COPY_A_SPELL)], { ...bolt, card: { ...bolt.card } });
    const result = copyStackItem(ctx, 'spell_1', 'p1');
    expect(result.success).toBe(true);
    const triggers = triggersOf(ctx);
    expect(triggers.map((t: any) => t.sourceName).sort()).toEqual(['Archmage Emeritus', 'Copy Fan']);
    expect(triggers.every((t: any) => t.triggerType === 'spell_copied')).toBe(true);
    // idempotent per copy
    expect(queueSpellCopiedTriggers(ctx, String(result.copy!.id))).toEqual([]);
    expect(triggersOf(ctx)).toHaveLength(2);
  });

  it('respects controller and spell type filters', () => {
    const creatureSpell = { ...bolt, card: { ...bolt.card, type_line: 'Creature - Elf' } };
    const ctx = ctxWith([perm('m', 'Archmage Emeritus', MAGECRAFT), perm('o', 'Opp Fan', COPY_A_SPELL, 'p2')], creatureSpell);
    copyStackItem(ctx, 'spell_1', 'p1');
    expect(triggersOf(ctx)).toHaveLength(0);
  });

  it('does not fire while replaying', () => {
    const ctx = ctxWith([perm('d', 'Copy Fan', COPY_A_SPELL)], { ...bolt });
    ctx.isReplaying = true;
    copyStackItem(ctx, 'spell_1', 'p1');
    expect(triggersOf(ctx)).toHaveLength(0);
  });
});

describe('IR-only spell-cast lines fire exactly once', () => {
  const cases: Array<[string, string, any, boolean]> = [
    ['multicolored', 'Whenever you cast a multicolored spell, draw a card.', { colors: ['R', 'G'] }, true],
    ['multicolored (mono spell)', 'Whenever you cast a multicolored spell, draw a card.', { colors: ['R'] }, false],
    ['monocolored', 'Whenever you cast a monocolored spell, draw a card.', { colors: ['R'] }, true],
    ['monocolored (colorless)', 'Whenever you cast a monocolored spell, draw a card.', { colors: [] }, false],
    ['colorless', 'Whenever you cast a colorless spell, draw a card.', { colors: [] }, true],
    ['colorless (red)', 'Whenever you cast a colorless spell, draw a card.', { colors: ['R'] }, false],
    ['mana value 5+', 'Whenever you cast a spell with mana value 5 or greater, draw a card.', { cmc: 6 }, true],
    ['mana value 5+ (cmc 2)', 'Whenever you cast a spell with mana value 5 or greater, draw a card.', { cmc: 2 }, false],
    ['kicked', 'Whenever you cast a kicked spell, draw a card.', { wasKicked: true }, true],
    ['kicked (unkicked)', 'Whenever you cast a kicked spell, draw a card.', {}, false],
  ];
  for (const [label, oracle, spellPatch, fires] of cases) {
    it(label, () => {
      const game = ctxWith([perm('s', 'Watcher', oracle)], bolt);
      const spellCard = { ...bolt.card, ...spellPatch };
      const triggers = getSpellCastTriggersForCard(game, 'p1', spellCard, 'hand');
      expect(triggers.filter((t) => t.permanentId === 's')).toHaveLength(fires ? 1 : 0);
    });
  }

  it('"whenever you copy a spell" does not fire on cast', () => {
    const game = ctxWith([perm('d', 'Copy Fan', COPY_A_SPELL)], bolt);
    expect(getSpellCastTriggersForCard(game, 'p1', bolt.card, 'hand')).toHaveLength(0);
  });

  it('Magecraft fires once on cast', () => {
    const game = ctxWith([perm('m', 'Archmage Emeritus', MAGECRAFT)], bolt);
    expect(getSpellCastTriggersForCard(game, 'p1', bolt.card, 'hand')).toHaveLength(1);
  });
});
