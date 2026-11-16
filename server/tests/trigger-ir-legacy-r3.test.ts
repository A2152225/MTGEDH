import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { resolveOnCastSpellTriggerDescriptions } from '../src/state/modules/onCastSpellTriggerUtils.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

function ctxOf(battlefield: any[]) {
  const state: any = {
    seq: 1, stack: [], battlefield,
    players: [{ id: 'p1' }, { id: 'p2' }], commandZone: {},
    turnPlayer: 'p1', activePlayer: 'p1', turnNumber: 3, phase: 'combat', step: 'declare_attackers',
    zones: { p1: { hand: [], graveyard: [], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } },
  };
  return { state, gameId: 'r3', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}
const perm = (id: string, controller: string, card: any, extra: any = {}) => ({
  id, controller, owner: controller, tapped: false, counters: {},
  card: { id: id + '_c', ...card }, ...extra,
});
const sourceId = (x: any) => String(x?.permanentId || x?.source?.permanentId || x?.sourceId || '');
const fromW = (list: any[]) => list.filter((x) => sourceId(x) === 'w');

describe('legacy-r3: delayed remainder and promoted families', () => {
  it('next upkeep, this-way exile/sacrifice, dies this turn, enters this turn', () => {
    const nextUp = cond('At the beginning of the next upkeep, create a token.');
    expect(nextUp?.event).toBe('beginning_of_upkeep');
    expect(nextUp?.delayedRider || nextUp?.delayedNextTurn).toBeTruthy();
    expect(nextUp?.legacyRuntimeOnly).toBeFalsy();

    const thisWay = cond('When a creature card is exiled this way, put a +1/+1 counter on target creature you control.');
    expect(thisWay?.event).toBe('exiled');
    expect(thisWay?.thisWay || thisWay?.delayedRider).toBeTruthy();
    expect(thisWay?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(thisWay, { id: 'c', controllerId: 'p1', typeLine: 'Creature', anyObject: true } as any, src(), {} as any)).toBe(false);

    const sac = cond('When you sacrifice one or more artifacts this way, draw a card.');
    expect(sac?.event).toBe('sacrifices');
    expect(sac?.delayedRider || sac?.thisWay).toBeTruthy();

    const dies = cond('Whenever a creature dies this turn, you gain 1 life.');
    expect(dies?.event).toBe('dies');
    expect(dies?.thisTurn).toBe(true);
    expect(dies?.delayedRider).toBe(true);
    expect(dies?.legacyRuntimeOnly).toBeFalsy();

    const enters = cond('Whenever a creature you control enters this turn, put a +1/+1 counter on it.');
    expect(enters?.event).toBe('enters');
    expect(enters?.thisTurn).toBe(true);
    expect(enters?.delayedRider).toBe(true);
    expect(enters?.legacyRuntimeOnly).toBeFalsy();
    expect(enters?.alternatives?.[0]?.controller).toBe('you');
  });

  it('enters or combat damage, enters and sacrifice, play land or cast, on-cast self', () => {
    const dual = cond('Whenever this creature enters or deals combat damage to a player, exile a card.', 'Aerial Extortionist');
    expect(dual?.event).toBe('enters');
    expect(dual?.pairedEvent).toBe('deals_combat_damage_to_player');
    expect(dual?.legacyRuntimeOnly).toBeFalsy();

    const sac = cond('When this artifact enters and when you sacrifice it, create a token.');
    expect(sac?.event).toBe('enters');
    expect(sac?.pairedEvent).toBe('sacrifices');

    const landOrSpell = cond('Whenever you play a land or cast a spell, create a token.');
    expect(landOrSpell?.event).toBe('plays_land');
    expect(landOrSpell?.pairedEvent).toBe('spell_cast');
    expect(landOrSpell?.legacyRuntimeOnly).toBeFalsy();

    const self = cond('When you cast this spell, draw a card.');
    expect(self?.event).toBe('cast_self');
    expect(self?.legacyRuntimeOnly).toBeFalsy();
    expect(resolveOnCastSpellTriggerDescriptions({ name: 'Ulamog', oracle_text: 'When you cast this spell, draw a card.' })).toHaveLength(1);

    const fromHand = cond('When you cast this spell from your hand, copy it.');
    expect(fromHand?.event).toBe('cast_self');
    expect(fromHand?.castFromZone).toBe('hand');
  });

  it('fires once: enters-or-combat-damage attack path does not double on attack', () => {
    const text = 'Whenever this creature enters or deals combat damage to a player, exile up to one target nonland permanent.';
    const attacker = perm('w', 'p1', { name: 'Aerial Extortionist', type_line: 'Creature', oracle_text: text, power: '2', toughness: '2' }, { attacking: 'p2' });
    const n = fromW(getAttackTriggersForCreatures(ctxOf([attacker]), [attacker], 'p1', 'p2') as any[]).length;
    // Attack declaration is not combat damage; the paired combat-damage event should not fire here.
    expect(n).toBe(0);
  });
});

describe('legacy-r3 census samples', () => {
  it('promoted leftover families are IR without legacyRuntimeOnly', () => {
    const samples: Array<[string, string]> = [
      ['At the beginning of the next upkeep, create a token.', 'beginning_of_upkeep'],
      ['When a creature card is exiled this way, put a counter on a creature.', 'exiled'],
      ['When you sacrifice one or more artifacts this way, draw a card.', 'sacrifices'],
      ['Whenever a creature dies this turn, you gain 1 life.', 'dies'],
      ['Whenever a creature you control enters this turn, put a +1/+1 counter on it.', 'enters'],
      ['Whenever this creature enters or deals combat damage to a player, draw a card.', 'enters'],
      ['When this artifact enters and when you sacrifice it, create a token.', 'enters'],
      ['Whenever you play a land or cast a spell, create a token.', 'plays_land'],
      ['When you cast this spell, draw a card.', 'cast_self'],
      ['When you cast this spell from your hand, copy it.', 'cast_self'],
    ];
    for (const [text, event] of samples) {
      const c = cond(text);
      expect(c?.event, text).toBe(event);
      expect(c?.legacyRuntimeOnly, text).toBeFalsy();
    }
  });
});
