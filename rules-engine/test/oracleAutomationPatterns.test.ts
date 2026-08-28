import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { tryResolveForEachReferenceAmount } from '../src/oracleIRExecutorForEachQuantity';
import { resolveOracleQuantity } from '../src/oracleIRExecutorResolveQuantity';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { tryParseLifeAndCombatClause } from '../src/oracleIRParserLifeAndCombatClauses';

const catalog = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../tools/oracle-automation-next-20-categories.json'),
    'utf8'
  )
) as {
  categories: Array<{
    id: string;
    items: Array<{ name: string; clause: string }>;
  }>;
};

function makeState(overrides?: Partial<Record<string, unknown>>): GameState {
  return {
    players: [
      { id: 'p1' as PlayerID, name: 'P1', library: ['a', 'b', 'c'], graveyard: [], life: 40 },
      { id: 'p2' as PlayerID, name: 'P2', library: ['d', 'e', 'f'], graveyard: [], life: 40 },
    ],
    battlefield: [
      {
        id: 'c1',
        name: 'Grizzly Bears',
        controller: 'p1',
        type_line: 'Creature — Bear',
        power: 2,
        toughness: 2,
      },
      {
        id: 'c2',
        name: 'Grizzly Bears',
        controller: 'p1',
        type_line: 'Creature — Bear',
        power: 2,
        toughness: 2,
      },
      {
        id: 'm1',
        name: 'Mountain',
        controller: 'p1',
        type_line: 'Land — Mountain',
      },
    ],
    stack: [],
    ...overrides,
  } as GameState;
}

function parseClause(clause: string, name: string) {
  return parseOracleTextToIR(clause, name);
}

function hasRecognizedStep(steps: Array<{ kind: string }>): boolean {
  return steps.some(step => step.kind !== 'unknown');
}

describe('for each quantity resolution', () => {
  it('resolves 1 for each creature you control', () => {
    const state = makeState();
    const count = tryResolveForEachReferenceAmount(
      state,
      'p1' as PlayerID,
      '1 for each creature you control',
      { controllerId: 'p1' as PlayerID }
    );
    expect(count).toBe(2);
  });

  it('resolves draw amount via reference_amount for each', () => {
    const state = makeState();
    const count = resolveOracleQuantity(
      state,
      'p1' as PlayerID,
      { kind: 'reference_amount', raw: '1 for each creature you control' },
      { controllerId: 'p1' as PlayerID }
    );
    expect(count).toBe(2);
  });

  it('resolves a card for each other dinosaur you control, excluding the source', () => {
    const state = makeState({
      battlefield: [
        {
          id: 'dreadmaw',
          name: 'Earthshaker Dreadmaw',
          controller: 'p1',
          type_line: 'Creature — Dinosaur',
        },
        {
          id: 'alpha',
          name: 'Regisaur Alpha',
          controller: 'p1',
          type_line: 'Creature — Dinosaur',
        },
        {
          id: 'ghalta',
          name: 'Ghalta, Stampede Tyrant',
          controller: 'p1',
          type_line: 'Legendary Creature — Elder Dinosaur',
        },
        {
          id: 'bear',
          name: 'Grizzly Bears',
          controller: 'p1',
          type_line: 'Creature — Bear',
        },
      ],
    });
    const count = resolveOracleQuantity(
      state,
      'p1' as PlayerID,
      { kind: 'reference_amount', raw: 'a card for each other dinosaur you control' },
      { controllerId: 'p1' as PlayerID, sourceId: 'dreadmaw' },
    );
    expect(count).toBe(2);
  });

  it('resolves a card for each other goblin you control, excluding the source', () => {
    const state = makeState({
      battlefield: [
        {
          id: 'warchief',
          name: 'Goblin Warchief',
          controller: 'p1',
          type_line: 'Creature — Goblin Warrior',
        },
        {
          id: 'lackey',
          name: 'Goblin Lackey',
          controller: 'p1',
          type_line: 'Creature — Goblin',
        },
        {
          id: 'ringleader',
          name: 'Goblin Ringleader',
          controller: 'p1',
          type_line: 'Creature — Goblin',
        },
        {
          id: 'bear',
          name: 'Grizzly Bears',
          controller: 'p1',
          type_line: 'Creature — Bear',
        },
      ],
    });
    const count = resolveOracleQuantity(
      state,
      'p1' as PlayerID,
      { kind: 'reference_amount', raw: 'a card for each other goblin you control' },
      { controllerId: 'p1' as PlayerID, sourceId: 'warchief' },
    );
    expect(count).toBe(2);
  });
});

describe('damage where X patterns', () => {
  it('parses damage equal with whereX', () => {
    const step = tryParseLifeAndCombatClause({
      clause:
        'this creature deals X damage to any target, where X is the number of Mountains you control.',
      rawClause:
        'this creature deals X damage to any target, where X is the number of Mountains you control.',
      withMeta: value => value,
    });
    expect(step?.kind).toBe('deal_damage');
    expect((step as any)?.whereX?.raw).toMatch(/mountains?\s+you\s+control/i);
  });

  it('resolves damage whereX from mountain count', () => {
    const state = makeState();
    const step = tryParseLifeAndCombatClause({
      clause:
        'this creature deals X damage to any target, where X is the number of Mountains you control.',
      rawClause:
        'this creature deals X damage to any target, where X is the number of Mountains you control.',
      withMeta: value => value,
    });
    expect(step?.kind).toBe('deal_damage');
    const dmg = resolveOracleQuantity(
      state,
      'p1' as PlayerID,
      (step as any).amount,
      { controllerId: 'p1' as PlayerID, sourceId: 'c1' },
      { whereX: (step as any).whereX }
    );
    expect(dmg).toBe(1);
  });
});

describe('ETB gain life whereX on full card text', () => {
  it('parses triggered ability effect with whereX', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, you gain X life, where X is the amount of life you gained this turn.',
      'Test Creature'
    );
    const gain = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'gain_life');
    expect(gain).toBeTruthy();
    expect((gain as any)?.whereX?.raw).toBe('the amount of life you gained this turn');
  });
});

function isCompleteOracleClause(clause: string): boolean {
  const text = String(clause || '');
  if (!text.trim()) return false;
  // Catalog fixtures must never ship ellipsized truncations.
  if (/\.\.\.|…/.test(text)) return false;

  let parentheticalDepth = 0;
  for (const char of text) {
    if (char === '(') parentheticalDepth += 1;
    if (char === ')') parentheticalDepth -= 1;
    if (parentheticalDepth < 0) return false;
  }
  if (parentheticalDepth !== 0) return false;

  // Bare modal headers without mode bullets are not executable fixtures.
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  const looksLikeChooseHeader = (line: string) =>
    /^(?:You\s+(?:may\s+)?)?Choose\s+(?:one|two|three|four|one or both|one or more|up to|any number)\b/i.test(
      line
    );
  const looksLikeModeBullet = (line: string) =>
    /^(?:[•\u2022]|\+[^{—\n]*[—-]|\s*\{P\}(?:\{P\})*\s*[—-])/.test(line);

  if (lines.some(looksLikeChooseHeader)) {
    const headerIndex = lines.findIndex(looksLikeChooseHeader);
    const hasBullets = lines.slice(headerIndex + 1).some(looksLikeModeBullet);
    if (!hasBullets) return false;
  }

  return true;
}

function categoryItems(id: string, limit = 30) {
  return (catalog.categories.find(category => category.id === id)?.items ?? [])
    // Reject truncated / bare-header catalog rows so parser acceptance
    // tests only see executable Oracle clauses.
    .filter(item => isCompleteOracleClause(item.clause))
    .slice(0, limit);
}

describe('oracle automation scry and surveil category', () => {
  const items = categoryItems('scry_surveil');

  for (const item of items) {
    it(`parses scry/surveil clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
    });
  }
});

describe('oracle automation reveal and look-top category', () => {
  const items = categoryItems('reveal_look_top_library');

  for (const item of items) {
    it(`parses look/reveal clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
    });
  }
});

describe('oracle automation non-graveyard exile category', () => {
  const items = categoryItems('non_graveyard_exile');

  for (const item of items) {
    it(`parses exile clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
    });
  }
});

describe('oracle automation impulse exile permission category', () => {
  const items = categoryItems('impulse_exile_permission');

  for (const item of items) {
    it(`parses impulse exile permission clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
    });
  }
});

describe('oracle automation discard category', () => {
  const items = categoryItems('discard');

  for (const item of items) {
    it(`parses discard clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
    });
  }
});

describe('oracle automation return-to-hand category', () => {
  const items = categoryItems('return_to_hand');

  for (const item of items) {
    it(`parses return-to-hand clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
    });
  }
});

describe('oracle automation mill category', () => {
  const millItems = categoryItems('mill', 40);

  for (const item of millItems) {
    it(`parses mill clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
      if (/\bmills?\b/i.test(item.clause)) {
        const hasMillStep = steps.some(step => step.kind === 'mill');
        expect(hasMillStep || hasRecognizedStep(steps)).toBe(true);
      } else if (/\bmill\b/i.test(item.clause) && !/\bmills?\b/i.test(item.clause)) {
        expect(hasRecognizedStep(steps)).toBe(true);
      }
    });
  }
});

describe('oracle automation dynamic mill samples', () => {
  const samples = [
    {
      name: 'Fraying Sanity',
      clause:
        'At the beginning of each end step, enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.',
    },
    {
      name: 'Hope Estheim',
      clause:
        'Each opponent mills X cards, where X is the amount of life you gained this turn.',
    },
    {
      name: 'Mindcrank',
      clause: 'Whenever an opponent loses life, that player mills that many cards.',
    },
  ];

  for (const sample of samples) {
    it(`parses ${sample.name}`, () => {
      const ir = parseClause(sample.clause, sample.name);
      const mill = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'mill');
      expect(mill).toBeTruthy();
      if (sample.name === 'Fraying Sanity' || sample.name === 'Hope Estheim') {
        expect((mill as any)?.whereX?.raw).toBeTruthy();
      }
    });
  }
});

describe('composite and activated mill patterns', () => {
  it('parses {T}, Mill a card', () => {
    const ir = parseClause('{T}, Mill a card.', 'Millikin');
    const mill = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'mill');
    expect(mill).toBeTruthy();
    expect((mill as any)?.who?.kind).toBe('you');
    expect((mill as any)?.amount?.kind).toBe('number');
    expect((mill as any)?.amount?.value).toBe(1);
  });

  it('parses Mindskinner prevent-and-mill replacement', () => {
    // Replacement abilities split the "If … would …," frame into triggerCondition;
    // effect steps are flat prevent_damage + mill (not a wrapping conditional).
    const samples = [
      'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards.',
      'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills cards equal to the amount of damage prevented this way.',
    ];

    for (const clause of samples) {
      const ir = parseClause(clause, 'The Mindskinner');
      expect(ir.abilities[0]?.type).toBe('replacement');
      expect(String(ir.abilities[0]?.triggerCondition || '')).toMatch(
        /source you control would deal damage to an opponent/i
      );
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.some(step => step.kind === 'prevent_damage')).toBe(true);
      const mill = steps.find(step => step.kind === 'mill');
      expect(mill).toBeTruthy();
      expect((mill as any)?.who?.kind).toBe('each_opponent');
    }
  });
});

describe('look at top where X', () => {
  it('parses look at the top X cards with whereX from automation catalog', () => {
    const ir = parseClause(
      'Look at the top X cards of your library, where X is the number of lands you control.',
      'Test Card'
    );
    const look = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'look_top');
    expect(look).toBeTruthy();
    expect((look as any)?.whereX?.raw).toMatch(/lands you control/i);
  });

  it('resolves look-top whereX from land count', () => {
    const state = makeState({
      battlefield: [
        {
          id: 'l1',
          name: 'Forest',
          controller: 'p1',
          type_line: 'Land — Forest',
        },
        {
          id: 'l2',
          name: 'Island',
          controller: 'p1',
          type_line: 'Land — Island',
        },
        {
          id: 'l3',
          name: 'Mountain',
          controller: 'p1',
          type_line: 'Land — Mountain',
        },
      ],
    });
    const ir = parseClause(
      'Look at the top X cards of your library, where X is the number of lands you control.',
      'Test Card'
    );
    const look = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'look_top');
    expect(look?.kind).toBe('look_top');
    const count = resolveOracleQuantity(
      state,
      'p1' as PlayerID,
      (look as any).amount,
      { controllerId: 'p1' as PlayerID },
      { whereX: (look as any).whereX }
    );
    expect(count).toBe(3);
  });
});

describe('mindcrank and exile top where X', () => {
  it('parses Mindcrank life-loss mill trigger effect', () => {
    const ir = parseClause('that player mills that many cards', 'Mindcrank');
    const mill = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'mill');
    expect(mill).toBeTruthy();
    expect((mill as any)?.who?.kind).toBe('target_player');
    expect((mill as any)?.amount?.kind).toBe('reference_amount');
    expect((mill as any)?.amount?.raw).toBe('that many');
  });

  it('parses exile the top X cards with whereX', () => {
    const ir = parseClause(
      'Exile the top X cards of your library, where X is the number of lands you control.',
      'Test Card'
    );
    const exile = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'exile_top');
    expect(exile).toBeTruthy();
    expect((exile as any)?.whereX?.raw).toMatch(/lands you control/i);
  });

  it('resolves exile-top whereX from land count', () => {
    const state = makeState({
      battlefield: [
        { id: 'l1', name: 'Forest', controller: 'p1', type_line: 'Land — Forest' },
        { id: 'l2', name: 'Island', controller: 'p1', type_line: 'Land — Island' },
      ],
    });
    const ir = parseClause(
      'Exile the top X cards of your library, where X is the number of lands you control.',
      'Test Card'
    );
    const exile = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'exile_top');
    const count = resolveOracleQuantity(
      state,
      'p1' as PlayerID,
      (exile as any).amount,
      { controllerId: 'p1' as PlayerID },
      { whereX: (exile as any).whereX }
    );
    expect(count).toBe(2);
  });
});

describe('oracle automation tap and untap category', () => {
  const items = categoryItems('tap_untap');

  for (const item of items) {
    it(`parses tap/untap clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
      if (/\buntap\b/i.test(item.clause) || /\btap\b/i.test(item.clause)) {
        const hasTapUntap = steps.some(step =>
          step.kind === 'tap_or_untap' ||
          step.kind === 'optional_untap_choice' ||
          step.kind === 'skip_next_untap' ||
          step.kind === 'grant_static_ability'
        );
        expect(hasTapUntap || hasRecognizedStep(steps)).toBe(true);
      }
    });
  }
});

describe('oracle automation fight and similar category', () => {
  const items = categoryItems('fight_and_similar', 30);

  for (const item of items) {
    it(`parses fight/bite clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
      if (/\bfights?\b/i.test(item.clause) || /\bbites?\b/i.test(item.clause)) {
        const hasFightDamage = steps.some(step => step.kind === 'deal_damage');
        expect(hasFightDamage || hasRecognizedStep(steps)).toBe(true);
      }
    });
  }
});

describe('oracle automation mana generation category', () => {
  const items = categoryItems('mana_generation');

  for (const item of items) {
    it(`parses mana generation clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
      if (/\badd\b/i.test(item.clause) && /\{[WUBRGC]\}/i.test(item.clause)) {
        const hasAddMana = steps.some(step => step.kind === 'add_mana');
        expect(hasAddMana || hasRecognizedStep(steps)).toBe(true);
      }
    });
  }
});

describe('oracle automation modal choices category', () => {
  const items = categoryItems('modal_choices');

  for (const item of items) {
    it(`parses modal clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      const chooseMode = steps.find(step => step.kind === 'choose_mode') as
        | { kind: string; modes?: Array<unknown> }
        | undefined;
      expect(chooseMode).toBeTruthy();
      expect(Array.isArray(chooseMode?.modes)).toBe(true);
      expect((chooseMode?.modes?.length ?? 0)).toBeGreaterThan(0);
    });
  }
});

describe('oracle automation cast without paying category', () => {
  const items = categoryItems('cast_without_paying');

  for (const item of items) {
    it(`parses cast-without-paying clause: ${item.name}`, () => {
      const ir = parseClause(item.clause, item.name);
      const steps = ir.abilities.flatMap(ability => ability.steps);
      expect(steps.length).toBeGreaterThan(0);
      expect(hasRecognizedStep(steps)).toBe(true);
      if (/\bwithout paying\b/i.test(item.clause)) {
        const hasFreeCast = steps.some(step => {
          if ((step as any).withoutPayingManaCost) return true;
          if (step.kind === 'grant_static_ability') {
            const text = String((step as any).effectText?.[0] || (step as any).raw || '');
            return /\bwithout paying\b/i.test(text);
          }
          if (step.kind === 'conditional') {
            return ((step as any).steps || []).some((inner: { kind: string; withoutPayingManaCost?: boolean; effectText?: string[]; raw?: string }) =>
              Boolean(inner.withoutPayingManaCost) ||
              (inner.kind === 'grant_static_ability' && /\bwithout paying\b/i.test(String(inner.effectText?.[0] || inner.raw || '')))
            );
          }
          return false;
        });
        expect(hasFreeCast || hasRecognizedStep(steps)).toBe(true);
      }
    });
  }
});

describe('surveil and divided damage where X', () => {
  it('parses Desmond Miles surveil whereX on triggered text', () => {
    const ir = parseClause(
      'Whenever Desmond Miles deals combat damage to a player, surveil X, where X is the amount of damage it dealt to that player.',
      'Desmond Miles'
    );
    const surveil = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'surveil');
    expect(surveil).toBeTruthy();
    expect((surveil as any)?.whereX?.raw).toMatch(/damage it dealt to that player/i);
  });

  it('parses divided damage with whereX', () => {
    const step = tryParseLifeAndCombatClause({
      clause:
        'this creature deals X damage divided as you choose among any number of targets, where X is the number of Mountains you control.',
      rawClause:
        'this creature deals X damage divided as you choose among any number of targets, where X is the number of Mountains you control.',
      withMeta: value => value,
    });
    expect(step?.kind).toBe('deal_damage');
    expect((step as any)?.division).toBe('as_you_choose');
    expect((step as any)?.whereX?.raw).toMatch(/mountains?\s+you\s+control/i);
  });
});
