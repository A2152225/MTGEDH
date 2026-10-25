import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';

const cond = (text: string, name?: string) => (parseTriggerClause(text, name) as any)?.condition;

describe('round 14: paired graveyard half only from the battlefield', () => {
  const oracle = 'When this artifact enters or is put into a graveyard from the battlefield, draw a card.';
  const src = { id: 's', controller: 'p1', owner: 'p1', card: { id: 's_c', name: 'Relic', type_line: 'Artifact', oracle_text: oracle } };
  const run = (event: any, fromZone?: string) => collectMatchingParsedEventLines({
    oracleText: oracle, event, subjectPermanent: src, subjectControllerId: 'p1', sourcePermanent: src, fromZone,
  } as any).length;
  it('fires on enters and from-battlefield, not from hand', () => {
    expect(run('enters')).toBe(1);
    expect(run('put_into_graveyard', 'battlefield')).toBe(1);
    expect(run('put_into_graveyard', 'hand')).toBe(0);
    expect(run('put_into_graveyard')).toBe(0);
  });
});

describe('round 14: discard this way keeps its condition', () => {
  it('wraps the effect in a this-way conditional', () => {
    const ir: any = parseOracleTextToIR('Discard a card. When you discard a creature card this way, draw a card.', 'Test Card');
    const steps = JSON.stringify(ir);
    expect(steps).toContain('conditional');
    expect(steps).toContain('creature card was discarded this way');
  });
});

describe('round 14: leftover wordings parse', () => {
  it('printed names with commas', () => {
    expect(cond('When Malik, Grim Manipulator enters, draw a card.', 'Malik, Grim Manipulator')).toMatchObject({ event: 'enters' });
  });
  it('mapped events', () => {
    expect(cond('Whenever your commander enters or attacks, draw a card.')).toMatchObject({ event: 'enters', pairedEvent: 'attacks' });
    expect(cond('Whenever a creature with mana value 6 or greater enters, draw a card.').alternatives[0].subject.stats).toEqual([{ stat: 'mana_value', op: 'gte', value: 6 }]);
    expect(cond('Whenever a creature attacks you, draw a card.')).toMatchObject({ event: 'attacks', attackedPlayer: 'you' });
    expect(cond('When it attacks, draw a card.')).toMatchObject({ event: 'attacks' });
    expect(cond("At the beginning of the end step of enchanted creature's controller, draw a card.")).toMatchObject({ event: 'beginning_of_end_step', whoseTurn: 'enchanted_controller' });
    expect(cond('Whenever you play a land, draw a card.')).toMatchObject({ event: 'plays_land' });
  });
  it('legacy-runtime wordings', () => {
    for (const t of [
      'Whenever a creature you control explores, draw a card.',
      'Whenever you play a land or cast a spell, draw a card.',
      "At the beginning of each player's first main phase, draw a card.",
      "At the beginning of combat on each opponent's turn, draw a card.",
      'Whenever a player attacks enchanted player with one or more creatures, draw a card.',
      'When that creature leaves the battlefield this turn, draw a card.',
    ]) expect(cond(t)).toMatchObject({ legacyRuntimeOnly: true });
  });
});
