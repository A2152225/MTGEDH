import { describe, expect, it } from 'vitest';
import { parseEntersSubjectClause, parseTriggerClause, triggerConditionMatches } from '../src/triggerCondition/index.js';
import type { TriggerMatchPermanent, TriggerMatchSource } from '../src/triggerCondition/index.js';

// Third-party review of the trigger IR commits (e15d1ac9..806fddc6), findings 1, 3 and 4.
const source: TriggerMatchSource = { id: 'watcher', controllerId: 'p1' };
const obj = (typeLine: string, extra: Partial<TriggerMatchPermanent> = {}): TriggerMatchPermanent => ({
  id: 'subject', typeLine, controllerId: 'p1', ...extra,
});

describe('finding 1: mixed type/subtype OR keeps each alternative whole', () => {
  it('"a Goblin or artifact" matches a Goblin creature and a non-Goblin artifact', () => {
    const parsed = parseEntersSubjectClause('a goblin or artifact you control')!;
    expect(parsed).toBeTruthy();
    expect(parsed.alternatives[0].subject.groups).toEqual([
      { types: [], subtypes: ['goblin'] },
      { types: ['artifact'], subtypes: [] },
    ]);
    expect(triggerConditionMatches(parsed, obj('Creature - Goblin Warrior'), source)).toBe(true);
    expect(triggerConditionMatches(parsed, obj('Artifact - Equipment'), source)).toBe(true);
    expect(triggerConditionMatches(parsed, obj('Creature - Elf'), source)).toBe(false);
  });

  it('"an Elf or Wizard permanent" is Elf OR Wizard, not Elf AND Wizard', () => {
    const parsed = parseEntersSubjectClause('an elf or wizard permanent you control')!;
    expect(triggerConditionMatches(parsed, obj('Creature - Elf Druid'), source)).toBe(true);
    expect(triggerConditionMatches(parsed, obj('Creature - Human Wizard'), source)).toBe(true);
    expect(triggerConditionMatches(parsed, obj('Creature - Bear'), source)).toBe(false);
  });

  it('a trailing type noun still distributes: "an Elf or Warrior creature"', () => {
    const parsed = parseEntersSubjectClause('an elf or warrior creature you control')!;
    expect(triggerConditionMatches(parsed, obj('Creature - Elf'), source)).toBe(true);
    expect(triggerConditionMatches(parsed, obj('Kindred Artifact - Elf'), source)).toBe(false);
  });

  it('hand-built filters without groups keep the old paired behaviour', () => {
    const parsed = parseEntersSubjectClause('an artifact or creature')!;
    const legacy = {
      ...parsed,
      alternatives: parsed.alternatives.map((alt) => {
        const { groups, ...rest } = alt.subject;
        return { ...alt, subject: rest };
      }),
    };
    expect(triggerConditionMatches(legacy, obj('Artifact'), source)).toBe(true);
    expect(triggerConditionMatches(legacy, obj('Land'), source)).toBe(false);
  });
});

describe('finding 3: castFromZone fails closed', () => {
  const notHand = parseTriggerClause('Whenever you cast a spell from anywhere other than your hand, draw a card.')!;
  const exile = parseTriggerClause('Whenever you cast a spell from exile, draw a card.')!;
  it('unknown zone does not satisfy "other than your hand"', () => {
    expect(notHand.condition.castFromZone).toBe('not_hand');
    expect(triggerConditionMatches(notHand.condition, obj('Instant'), source, {})).toBe(false);
    expect(triggerConditionMatches(notHand.condition, obj('Instant'), source, { castFromZone: 'hand' })).toBe(false);
    expect(triggerConditionMatches(notHand.condition, obj('Instant'), source, { castFromZone: 'graveyard' })).toBe(true);
    expect(triggerConditionMatches(notHand.condition, obj('Creature - Elf'), source, { castFromZone: 'command' })).toBe(true);
  });
  it('unknown zone does not satisfy "from exile"', () => {
    expect(triggerConditionMatches(exile.condition, obj('Instant'), source, {})).toBe(false);
    expect(triggerConditionMatches(exile.condition, obj('Instant'), source, { castFromZone: 'exile' })).toBe(true);
  });
});

describe('finding 4: hyphenated and colour exclusions', () => {
  it('"non-black" excludes black objects by colour', () => {
    const parsed = parseTriggerClause('Whenever a non-black creature dies, draw a card.')!;
    expect(parsed.condition.alternatives[0].subject.excludedColors).toEqual(['b']);
    expect(triggerConditionMatches(parsed.condition, obj('Creature - Zombie', { colors: ['b'] }), source)).toBe(false);
    expect(triggerConditionMatches(parsed.condition, obj('Creature - Bear', { colors: ['g'] }), source)).toBe(true);
  });
  it('"nonwhite" parses instead of failing the whole clause', () => {
    const parsed = parseTriggerClause('Whenever a nonwhite creature dies, draw a card.');
    expect(parsed).toBeTruthy();
    expect(triggerConditionMatches(parsed!.condition, obj('Creature - Angel', { colors: ['w'] }), source)).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, obj('Artifact Creature - Golem'), source)).toBe(true);
  });
  it('"non-Human" still excludes Humans and changelings', () => {
    const parsed = parseTriggerClause('Whenever a non-Human creature you control dies, draw a card.')!;
    expect(triggerConditionMatches(parsed.condition, obj('Creature - Human Soldier'), source)).toBe(false);
    expect(triggerConditionMatches(parsed.condition, obj('Creature - Shapeshifter', { hasAllCreatureTypes: true }), source)).toBe(false);
    expect(triggerConditionMatches(parsed.condition, obj('Creature - Elf'), source)).toBe(true);
  });
});
describe('ability-word prefixes do not hide the trigger condition', () => {
  it('"Landfall \u2014 Whenever a land you control enters" parses like the bare clause', () => {
    const parsed = parseTriggerClause('Landfall \u2014 Whenever a nontoken land you control enters, draw a card.');
    expect(parsed?.condition.event).toBe('enters');
    expect(parsed?.effect).toBe('draw a card');
    expect(triggerConditionMatches(parsed!.condition, obj('Land', { isToken: true }), source)).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, obj('Basic Land - Forest'), source)).toBe(true);
  });
});