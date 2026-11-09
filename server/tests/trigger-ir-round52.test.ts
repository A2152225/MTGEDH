import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

describe('round 52 uncovered families', () => {
  it('state triggers: controls_none / power / tide counters / no creatures', () => {
    const noCreatures = cond('Whenever you control no creatures, draw a card.');
    expect(noCreatures?.event).toBe('controls_none');

    const thrulls = cond('When you control seven or more Thrulls, draw a card.');
    expect(thrulls?.event).toBe('controls_none');
    expect(thrulls?.controlMinimum).toBe(7);

    const noPlus = cond('When this enchantment has no +1/+1 counters on it, draw a card.');
    expect(noPlus?.event).toBe('controls_none');
    expect(noPlus?.noCounters).toBe('+1/+1');

    const power = cond("When this creature's power is 7 or greater, draw a card.");
    expect(power?.event).toBe('controls_none');
    expect(power?.powerMinimum).toBe(7);

    const tide = cond('Whenever there are four or more tide counters on this creature, draw a card.');
    expect(tide?.event).toBe('controls_none');
    expect(tide?.counterMinimum).toBe(4);
    expect(tide?.noCounters).toBe('tide');
  });

  it('plan / nth counters, emerge, craft, first combat end fire once', () => {
    const sixth = cond('When the sixth plan counter is put on this enchantment, draw a card.');
    expect(sixth?.event).toBe('counter_placed');
    expect(sixth?.placedCounter).toBe('plan');
    expect(sixth?.counterOrdinal).toBe(6);

    const tenth = cond('When the tenth +1/+1 counter is put on Shang-Chi, draw a card.', 'Shang-Chi and the Ten Rings');
    expect(tenth?.event).toBe('counter_placed');
    expect(tenth?.placedCounter).toBe('+1/+1');
    expect(tenth?.counterOrdinal).toBe(10);

    const emerge = cond('When you sacrifice this creature while casting a spell with emerge, draw a card.');
    expect(emerge?.event).toBe('sacrifices');
    expect(emerge?.whileCastingEmerge).toBe(true);

    const craft = cond("When this creature is exiled from the battlefield while you're activating a craft ability, draw a card.");
    expect(craft?.event).toBe('exiled');
    expect(craft?.whileActivatingCraft).toBe(true);

    const firstCombat = cond('At the end of the first combat phase on your turn, draw a card.');
    expect(firstCombat?.event).toBe('end_of_combat');
    expect(firstCombat?.whoseTurn).toBe('you');
    expect(firstCombat?.firstCombat).toBe(true);
  });

  it('are dealt excess / opponents control / phases in / become untapped fire once', () => {
    const excess = cond('Whenever one or more creatures your opponents control are dealt excess damage, create a Treasure token.');
    expect(excess?.event).toBe('dealt_damage');
    expect(excess?.requiresExcess).toBe(true);
    expect(excess?.alternatives?.[0]?.controller).toBe('not_you');
    const dmgSub = { id: 'c2', controllerId: 'p2', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(excess, dmgSub, src(), { excessDamage: true } as any)).toBe(true);
    expect(triggerConditionMatches(excess, dmgSub, src(), { excessDamage: false } as any)).toBe(false);

    const phases = cond('Whenever King of the Oathbreakers or another Spirit you control phases in, draw a card.', 'King of the Oathbreakers');
    expect(phases?.event).toBe('phases_in');

    const untap = cond('Whenever ~ become untapped, draw a card.');
    expect(untap?.event).toBe('becomes_untapped');
    const self = { id: 'w', controllerId: 'p1', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(untap, self, src())).toBe(true);
  });

  it('put into library/exile, sac/destroy, spend mana, activates, that-player upkeep', () => {
    expect(cond('Whenever one or more cards are put into a library from anywhere, draw a card.')?.event).toBe('put_into_library');
    expect(cond('Whenever one or more cards are put into exile, draw a card.')?.event).toBe('exiled');
    expect(cond('Whenever an artifact is sacrificed, create a Treasure token.')?.event).toBe('sacrifices');
    expect(cond('Whenever an artifact is destroyed, create a Treasure token.')?.event).toBe('dies');

    const spend = cond('When you spend this mana to cast your commander, draw a card.');
    expect(spend?.event).toBe('spell_cast');
    expect(spend?.requiresSourceMana).toBe(true);

    const act = cond('Whenever an opponent activates an ability of a creature, draw a card.');
    expect(act?.event).toBe('performs');
    expect(act?.action).toBe('activate_creature');

    const upkeep = cond("At the beginning of that player's upkeep, draw a card.");
    expect(upkeep?.event).toBe('beginning_of_upkeep');
    expect(upkeep?.whoseTurn).toBe('that_player');
  });
});
