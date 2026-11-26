import { describe, expect, it } from 'vitest';

import { buildSpellTargetSelectionClauses } from '../src/socket/game-actions-handlers/gameActionsSpellTargetSelection.js';
import { resolveCastSpellParsedTargeting } from '../src/socket/game-actions-handlers/gameActionsCastSpellParsedTargeting.js';
import { parseTapUntapAbilityText } from '../src/socket/interaction-handlers/interactionActivateBattlefieldAbilityHelpers.js';
import { buildActivatedAbilityValidTargets } from '../src/socket/resolutionActivatedAbilityTargetingUtils.js';
import { parseTargetRequirements } from '../src/rules-engine/targeting';

function perm(id: string, controller: string, typeLine: string, extra: Record<string, unknown> = {}) {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: `${id}_c`, name: id, type_line: typeLine, oracle_text: '' }, ...extra };
}

function fakeGame(battlefield: any[] = []) {
  return { state: { battlefield, players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], stack: [], zones: {}, life: { p1: 40, p2: 40 } } };
}

const reqsOf = (text: string) => resolveCastSpellParsedTargeting({ cardName: 'X', oracleText: text }).targetReqs as any;
const clausesOf = (text: string, battlefield: any[] = []) => buildSpellTargetSelectionClauses(fakeGame(battlefield), 'p1', 'X', text);

describe('outcome-sweep round 5: non-targeting uses of "target"', () => {
  it.each([
    ['hexproof reminder', 'Target creature you control gets +2/+2 and gains hexproof until end of turn. (It can\'t be the target of spells or abilities your opponents control.)'],
    ['strive', 'Strive \u2014 This spell costs {2}{U} more to cast for each target beyond the first.\nAny number of target creatures each get +1/+1 and gain flying until end of turn.'],
    ['copy new target', 'Chain Lightning deals 3 damage to any target. Then that player or that permanent\'s controller may pay {R}{R}. If the player does, they may copy this spell and may choose a new target for that copy.'],
    ['granted quoted ability', 'Gain control of target creature until end of turn. Untap that creature. Until end of turn, it gains haste and "Whenever this creature deals damage, destroy target Equipment attached to it."'],
  ])('%s adds no extra target clause', (_label, text) => {
    expect(clausesOf(text)).toEqual([]);
  });

  it('defers colour disjunctions and unmodelled status words to the parser', () => {
    expect(reqsOf('Destroy target green or white creature.').castTargetTypeEntry).toBeUndefined();
    expect(reqsOf('Target unblocked attacking creature becomes blocked.').castTargetTypeEntry).toBeUndefined();
    expect(reqsOf('Destroy target white creature. It can\'t be regenerated.').castTargetTypeEntry).toBe('white creature');
  });

  it('keeps a ripple count off the next line\'s target count', () => {
    const reqs = reqsOf('Ripple 4 (When you cast this spell, you may reveal the top four cards of your library. You may cast spells with the same name as this spell from among those cards without paying their mana costs. Put the rest on the bottom of your library.)\nTarget player discards a card.');
    expect([reqs.minTargets, reqs.maxTargets]).toEqual([1, 1]);
  });
});

describe('outcome-sweep round 5: multi-target cast prompts', () => {
  it('splits bite spells into source and victim clauses', () => {
    const clauses = clausesOf('Target creature you control deals damage equal to its power to target creature you don\'t control.');
    expect(clauses.map((c) => c.clauseText)).toEqual(['Target creature you control', 'target creature you don\'t control']);
    expect(reqsOf('target creature you don\'t control').targetControllerConstraint).toBe('opponent');
  });

  it('splits a bite behind a kicker keyword line', () => {
    const clauses = clausesOf('Kicker\u2014Return a land you control to its owner\'s hand. (You may return a land you control to its owner\'s hand in addition to any other costs as you cast this spell.)\nTarget creature you control deals damage equal to its power to target creature an opponent controls. If this spell was kicked, the creature you control deals twice that much damage instead.');
    expect(clauses).toHaveLength(2);
  });

  it('reads "one or two" and distribute ranges as 1..N', () => {
    const common = clausesOf('One or two target creatures you control each deal damage equal to their power to target creature an opponent controls.');
    expect([common[0].minTargets, common[0].maxTargets]).toEqual([1, 2]);
    const celestus = reqsOf('Distribute three +1/+1 counters among one, two, or three target creatures you control.');
    expect([celestus.minTargets, celestus.maxTargets]).toEqual([1, 3]);
  });

  it('keeps every type of a target type list and its controller', () => {
    const reqs = reqsOf('Exile two target artifacts, creatures, and/or lands you control, then return those cards to the battlefield under your control.');
    expect(reqs.targetTypes).toEqual(['artifact', 'creature', 'land']);
    expect(reqs.targetControllerConstraint).toBe('you');
  });

  it('does not add an opponent target for "protection from each of your opponents"', () => {
    const reqs = reqsOf('Up to one target creature you control gains protection from each of your opponents until end of turn. Draw a card.');
    expect(reqs.targetTypes).toEqual(['creature']);
  });
});

describe('outcome-sweep round 5: activation targeting', () => {
  it('reads "Tap three untapped creatures you control: Tap target creature" as a tap of any creature', () => {
    const parsed = parseTapUntapAbilityText('Tap three untapped creatures you control: Tap target creature.');
    expect(parsed?.action).toBe('tap');
    expect(parsed?.controller).toBe('any');
  });

  it('offers only tapped creatures for "Destroy target tapped creature", never the {T} source', () => {
    const text = 'Destroy target tapped creature.';
    const game = fakeGame([
      perm('assassin', 'p1', 'Creature \u2014 Human Assassin', { tapped: true }),
      perm('tapped_bear', 'p2', 'Creature \u2014 Bear', { tapped: true }),
      perm('untapped_giant', 'p2', 'Creature \u2014 Giant'),
    ]);
    const ids = buildActivatedAbilityValidTargets(game, 'p1', parseTargetRequirements(text, {}), {
      sourcePermanentId: 'assassin', abilityText: text, sourceTapCost: true,
    }).map((t) => t.id);
    expect(ids).toEqual(['tapped_bear']);
  });
});
