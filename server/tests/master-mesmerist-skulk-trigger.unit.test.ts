import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParserParseOracleTextToIR.js';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { parseTriggerEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';

const ORACLE = [
  "{T}: Target creature an opponent controls with power less than or equal to The Master's power gains skulk until end of turn. Goad it. (A creature with skulk can't be blocked by creatures with greater power.)",
  'Whenever a creature with skulk deals combat damage to one of your opponents, put a +1/+1 counter on The Master and draw a card.',
].join('\n');

const master = {
  id: 'master',
  controller: 'p1',
  card: {
    name: 'The Master, Mesmerist',
    type_line: 'Legendary Creature — Time Lord Rogue',
    oracle_text: ORACLE,
  },
};

function creature(id: string, controller: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    card: {
      name: id,
      type_line: 'Creature — Bear',
      oracle_text: oracle,
    },
    ...extra,
  };
}

function lines(attacker: any, damagedPlayerId: string) {
  return collectMatchingParsedEventLines({
    ctx: { state: { battlefield: [master, attacker], players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] } },
    oracleText: ORACLE,
    event: 'deals_combat_damage_to_player',
    subjectPermanent: attacker,
    subjectControllerId: attacker.controller,
    sourcePermanent: master,
    matchContext: {
      damagedPlayerId,
      damageRecipientPlayerId: damagedPlayerId,
    },
  });
}

describe('The Master, Mesmerist skulk combat-damage trigger', () => {
  it('matches any creature with skulk that damages an opponent, and the effect puts a counter and draws', () => {
    const parsed = parseTriggerClause(ORACLE.split('\n')[1], 'The Master, Mesmerist');
    expect(parsed?.condition.event).toBe('deals_combat_damage_to_player');
    expect(parsed?.condition.damageRecipient).toBe('opponent');
    expect(parsed?.condition.alternatives[0].controller).toBe('any');
    expect(parsed?.condition.alternatives[0].subject.keywordsWith).toEqual(['skulk']);

    const steps = parseTriggerEffectSteps(parsed!.effect, 'The Master, Mesmerist');
    expect(steps.map((step) => step.kind)).toEqual(['add_counter', 'draw']);

    const own = lines(creature('own', 'p1', 'Skulk'), 'p2');
    expect(own).toHaveLength(1);
    expect(own[0].effect).toMatch(/counter/i);
    expect(own[0].effect).toMatch(/draw/i);

    const granted = lines(creature('goaded', 'p2', '', { grantedAbilities: ['skulk'] }), 'p3');
    expect(granted).toHaveLength(1);

    expect(lines(creature('plain', 'p1', ''), 'p2')).toHaveLength(0);
    expect(lines(creature('own', 'p1', 'Skulk'), 'p1')).toHaveLength(0);
  });

  it('treats skulk granted by The Master as a keyword the creature has', () => {
    const ir = parseOracleTextToIR(ORACLE, 'The Master, Mesmerist');
    const grant = ir.abilities?.flatMap((ability) => ability.steps || []).find((step) => step.kind === 'grant_temporary_ability') as { abilities?: string[]; effectText?: string[] } | undefined;
    expect(grant?.abilities).toEqual(['skulk']);

    const stamped = lines(creature('goaded', 'p2', '', {
      temporaryEffects: [{ description: 'skulk', grantedAbilities: ['skulk'] }],
    }), 'p3');
    expect(stamped).toHaveLength(1);

    const landwalkOracle = 'Whenever a creature with landwalk deals combat damage to one of your opponents, draw a card.';
    const landwalker = creature('walker', 'p1', 'Islandwalk');
    const landwalkHits = collectMatchingParsedEventLines({
      ctx: { state: { battlefield: [landwalker], players: [{ id: 'p1' }, { id: 'p2' }] } },
      oracleText: landwalkOracle,
      event: 'deals_combat_damage_to_player',
      subjectPermanent: landwalker,
      subjectControllerId: 'p1',
      sourcePermanent: { id: 'src', controller: 'p1', card: { name: 'X', oracle_text: landwalkOracle } },
      matchContext: { damagedPlayerId: 'p2', damageRecipientPlayerId: 'p2' },
    });
    expect(landwalkHits).toHaveLength(1);
  });
});
