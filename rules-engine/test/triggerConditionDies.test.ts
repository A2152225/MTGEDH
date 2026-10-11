import { describe, expect, it } from 'vitest';
import { parseDiesSubjectClause, triggerConditionMatches } from '../src/triggerCondition/index.js';
import type { TriggerMatchPermanent, TriggerMatchSource } from '../src/triggerCondition/index.js';

const source: TriggerMatchSource = { id: 'blood-artist', controllerId: 'p1' };

function subject(overrides: Partial<TriggerMatchPermanent> = {}): TriggerMatchPermanent {
  return {
    id: 'dying',
    typeLine: 'Creature — Human Soldier',
    controllerId: 'p1',
    ...overrides,
  };
}

describe('parseDiesSubjectClause', () => {
  it('parses controller, source, token, and OR types', () => {
    const parsed = parseDiesSubjectClause('another nontoken artifact or creature you control');
    expect(parsed).toEqual({
      event: 'dies',
      quantity: 'one',
      alternatives: [{
        controller: 'you',
        source: 'another',
        subject: {
          anyObject: false,
          typeGroups: [['artifact'], ['creature']],
          excludedWords: [],
          supertypes: [],
          token: 'nontoken',
          subtypeGroups: [[], []],
          keywordsWith: [],
          keywordsWithout: [],
        },
      }],
    });
  });

  it('parses one or more, AND types, exclusion, and an opponent', () => {
    const parsed = parseDiesSubjectClause("one or more other non-Human artifact creatures an opponent controls");
    expect(parsed).toMatchObject({
      quantity: 'one_or_more',
      alternatives: [{
        controller: 'not_you',
        source: 'another',
        subject: {
          typeGroups: [['artifact', 'creature']],
          excludedWords: ['human'],
          token: 'any',
        },
      }],
    });
  });

  it('parses legendary and you don\'t control', () => {
    const parsed = parseDiesSubjectClause("a legendary creature you don't control");
    expect(parsed?.alternatives[0]).toMatchObject({
      controller: 'not_you',
      source: 'any',
      subject: {
        typeGroups: [['creature']],
        supertypes: ['legendary'],
      },
    });
  });

  it('returns null for clauses this slice does not represent', () => {
    expect(parseDiesSubjectClause('an enchanted creature')).toBeNull();
    expect(parseDiesSubjectClause('a creature where X is 3')).toBeNull();
    expect(parseDiesSubjectClause('')).toBeNull();
  });

  it('parses subtypes, keywords, and this-or-another as two alternatives', () => {
    const goblin = parseDiesSubjectClause('another Goblin you control');
    expect(goblin?.alternatives[0]).toMatchObject({
      controller: 'you',
      source: 'another',
      subject: { subtypeGroups: [['goblin']] },
    });
    expect(triggerConditionMatches(goblin!, subject({ typeLine: 'Creature — Goblin' }), source)).toBe(true);
    expect(triggerConditionMatches(goblin!, subject({ typeLine: 'Creature — Human' }), source)).toBe(false);
    expect(triggerConditionMatches(goblin!, subject({
      typeLine: 'Creature — Shapeshifter',
      hasAllCreatureTypes: true,
    }), source)).toBe(true);

    const flying = parseDiesSubjectClause('a creature with flying');
    expect(flying?.alternatives[0].subject.keywordsWith).toEqual(['flying']);
    expect(triggerConditionMatches(flying!, subject({ keywords: ['flying'] }), source)).toBe(true);
    expect(triggerConditionMatches(flying!, subject({ keywords: [] }), source)).toBe(false);

    const either = parseDiesSubjectClause('this creature or another creature you control');
    expect(either?.alternatives.map((alternative) => alternative.source)).toEqual(['self', 'another']);
    expect(triggerConditionMatches(either!, subject({ id: 'blood-artist' }), source)).toBe(true);
    expect(triggerConditionMatches(either!, subject({ id: 'other', controllerId: 'p1' }), source)).toBe(true);
    expect(triggerConditionMatches(either!, subject({ id: 'other', controllerId: 'p2' }), source)).toBe(false);
  });

  it('parses counters, power, chosen type, and dealt damage', () => {
    const counter = parseDiesSubjectClause('a creature with a +1/+1 counter on it');
    expect(counter?.alternatives[0].subject.counters).toEqual([{ name: '+1/+1', minimum: 1 }]);
    expect(triggerConditionMatches(counter!, subject({ counters: { '+1/+1': 1 } }), source)).toBe(true);
    expect(triggerConditionMatches(counter!, subject({ counters: {} }), source)).toBe(false);

    const power = parseDiesSubjectClause('a creature with power 4 or greater');
    expect(power?.alternatives[0].subject.stats).toEqual([{ stat: 'power', op: 'gte', value: 4 }]);
    expect(triggerConditionMatches(power!, subject({ power: 4 }), source)).toBe(true);
    expect(triggerConditionMatches(power!, subject({ power: 3 }), source)).toBe(false);

    const chosen = parseDiesSubjectClause('a creature of the chosen type');
    expect(chosen?.alternatives[0].subject.chosenType).toBe(true);
    expect(triggerConditionMatches(chosen!, subject({ typeLine: 'Creature — Goblin' }), { ...source, chosenCreatureType: 'Goblin' })).toBe(true);
    expect(triggerConditionMatches(chosen!, subject({ typeLine: 'Creature — Human' }), { ...source, chosenCreatureType: 'Goblin' })).toBe(false);

    const dealt = parseDiesSubjectClause('a creature dealt damage by this creature this turn');
    expect(dealt?.alternatives[0].subject.dealtDamageBy).toBe('source');
    expect(triggerConditionMatches(dealt!, subject(), source, { dealtDamageBySource: true })).toBe(true);
    expect(triggerConditionMatches(dealt!, subject(), source, { dealtDamageBySource: false })).toBe(false);
  });
});

describe('triggerConditionMatches', () => {
  it('matches another creature you control and rejects self, opponents, and tokens', () => {
    const condition = parseDiesSubjectClause('another nontoken creature you control');
    expect(condition).not.toBeNull();
    expect(triggerConditionMatches(condition!, subject(), source)).toBe(true);
    expect(triggerConditionMatches(condition!, subject({ id: 'blood-artist' }), source)).toBe(false);
    expect(triggerConditionMatches(condition!, subject({ controllerId: 'p2' }), source)).toBe(false);
    expect(triggerConditionMatches(condition!, subject({ isToken: true }), source)).toBe(false);
    expect(triggerConditionMatches(condition!, subject({ typeLine: 'Artifact — Equipment' }), source)).toBe(false);
  });

  it('treats artifact creature as AND and artifact or creature as OR', () => {
    const and = parseDiesSubjectClause('an artifact creature');
    const or = parseDiesSubjectClause('an artifact or creature');
    const artifact = subject({ typeLine: 'Artifact — Equipment' });
    const both = subject({ typeLine: 'Artifact Creature — Thopter' });
    expect(triggerConditionMatches(and!, artifact, source)).toBe(false);
    expect(triggerConditionMatches(and!, both, source)).toBe(true);
    expect(triggerConditionMatches(or!, artifact, source)).toBe(true);
    expect(triggerConditionMatches(or!, subject(), source)).toBe(true);
  });

  it('excludes printed Humans and changelings from non-Human, and still allows a nonartifact changeling', () => {
    const nonHuman = parseDiesSubjectClause('a non-Human creature');
    expect(triggerConditionMatches(nonHuman!, subject({ typeLine: 'Creature — Human' }), source)).toBe(false);
    expect(triggerConditionMatches(nonHuman!, subject({
      typeLine: 'Creature — Shapeshifter',
      hasAllCreatureTypes: true,
    }), source)).toBe(false);
    expect(triggerConditionMatches(nonHuman!, subject({ typeLine: 'Creature — Goblin' }), source)).toBe(true);

    const nonartifact = parseDiesSubjectClause('a nonartifact creature');
    expect(triggerConditionMatches(nonartifact!, subject({
      typeLine: 'Creature — Shapeshifter',
      hasAllCreatureTypes: true,
    }), source)).toBe(true);
    expect(triggerConditionMatches(nonartifact!, subject({
      typeLine: 'Artifact Creature — Thopter',
    }), source)).toBe(false);
  });

  it('requires the supertype on the type line', () => {
    const condition = parseDiesSubjectClause('a legendary permanent an opponent controls');
    expect(triggerConditionMatches(condition!, subject({
      typeLine: 'Legendary Creature — Spirit',
      controllerId: 'p2',
    }), source)).toBe(true);
    expect(triggerConditionMatches(condition!, subject({
      typeLine: 'Creature — Spirit',
      controllerId: 'p2',
    }), source)).toBe(false);
    expect(triggerConditionMatches(condition!, subject({
      typeLine: 'Legendary Creature — Spirit',
      controllerId: 'p1',
    }), source)).toBe(false);
  });
});
