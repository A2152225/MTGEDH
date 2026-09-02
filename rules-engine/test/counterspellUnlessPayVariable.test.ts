import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { resolveUnlessPaysManaCostString } from '../src/oracleIRExecutorUnlessPaysManaAmount';

function firstUnlessPaysMana(oracle: string, name: string) {
  const steps = parseOracleTextToIR(oracle, name).abilities.flatMap((ability) => ability.steps || []);
  return steps.find((step) => step.kind === 'unless_pays_mana') as
    | Extract<typeof steps[number], { kind: 'unless_pays_mana' }>
    | undefined;
}

function makeState(opts?: {
  graveyard?: number;
  hand?: number;
  artifacts?: number;
  faeries?: number;
  devotionBlue?: number;
}) {
  const graveyard = Array.from({ length: opts?.graveyard ?? 0 }, (_, index) => ({
    id: `gy-${index}`,
    name: 'Island',
  }));
  const hand = Array.from({ length: opts?.hand ?? 0 }, (_, index) => ({
    id: `hand-${index}`,
    name: 'Island',
  }));
  const battlefield: any[] = [];
  for (let index = 0; index < (opts?.artifacts ?? 0); index += 1) {
    battlefield.push({
      id: `art-${index}`,
      controller: 'p_you',
      card: { name: 'Sol Ring', type_line: 'Artifact' },
    });
  }
  for (let index = 0; index < (opts?.faeries ?? 0); index += 1) {
    battlefield.push({
      id: `fae-${index}`,
      controller: 'p_you',
      card: { name: 'Cloud of Faeries', type_line: 'Creature — Faerie' },
    });
  }
  if ((opts?.devotionBlue ?? 0) > 0) {
    battlefield.push({
      id: 'devotion',
      controller: 'p_you',
      card: {
        name: 'Thassa',
        type_line: 'Legendary Enchantment Creature — God',
        mana_cost: '{U}'.repeat(opts?.devotionBlue || 0),
      },
    });
  }
  return {
    players: [
      { id: 'p_you', seat: 0, library: [], hand, graveyard },
      { id: 'p_victim', seat: 1, library: [], hand: [], graveyard: [] },
    ],
    battlefield,
    stack: [
      {
        id: 'spell-victim',
        type: 'spell',
        controller: 'p_victim',
        owner: 'p_victim',
        card: { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' },
      },
    ],
    manaPool: {
      p_victim: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
  } as any;
}

describe('variable counterspell unless-pay taxes', () => {
  it('parses Circular Logic as unless_pays_mana scaled by graveyard count', () => {
    const step = firstUnlessPaysMana(
      'Counter target spell unless its controller pays {1} for each card in your graveyard.\nMadness {U}',
      'Circular Logic',
    );
    expect(step?.kind).toBe('unless_pays_mana');
    expect(step?.mana).toBe('{1}');
    expect(step?.manaAmountRaw).toMatch(/for each card in your graveyard/i);

    const state = makeState({ graveyard: 4 });
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: 'Circular Logic',
      targetSpellId: 'spell-victim',
    });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{4}');
  });

  it('parses Flusterstorm qualified target as unless_pays_mana {1}', () => {
    const step = firstUnlessPaysMana(
      'Counter target instant or sorcery spell unless its controller pays {1}.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)',
      'Flusterstorm',
    );
    expect(step?.kind).toBe('unless_pays_mana');
    expect(step?.mana).toBe('{1}');
    expect(step?.steps?.[0]?.kind).toBe('counter_spell');
  });

  it('parses Spell Stutter plus-additional Faerie count', () => {
    const step = firstUnlessPaysMana(
      'Counter target spell unless its controller pays {2} plus an additional {1} for each Faerie you control.',
      'Spell Stutter',
    );
    expect(step?.mana).toBe('{2}');
    expect(step?.manaAmountRaw).toMatch(/2 plus 1 for each faerie you control/i);
    const state = makeState({ faeries: 3 });
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p_you', sourceName: 'Spell Stutter', targetSpellId: 'spell-victim' });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{5}');
  });

  it('parses Override as {1} per artifact you control', () => {
    const step = firstUnlessPaysMana(
      'Counter target spell unless its controller pays {1} for each artifact you control.',
      'Override',
    );
    const state = makeState({ artifacts: 2 });
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p_you', sourceName: 'Override', targetSpellId: 'spell-victim' });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{2}');
  });

  it('parses Thassa\'s Rebuff devotion where-X', () => {
    const step = firstUnlessPaysMana(
      "Counter target spell unless its controller pays {X}, where X is your devotion to blue. (Each {U} in the mana costs of permanents you control counts toward your devotion to blue.)",
      "Thassa's Rebuff",
    );
    expect(step?.mana).toBe('{X}');
    expect(step?.whereX).toMatch(/your devotion to blue/i);
  });

  it('parses Whirlwind Denial as for-each opponent stack objects', () => {
    const step = firstUnlessPaysMana(
      'For each spell and ability your opponents control, counter it unless its controller pays {4}.',
      'Whirlwind Denial',
    );
    expect(step?.kind).toBe('unless_pays_mana');
    expect(step?.mana).toBe('{4}');
    expect(step?.forEachOpponentStackObjects).toBe(true);
    const state = makeState();
    state.stack.push({
      id: 'spell-opp2',
      type: 'spell',
      controller: 'p_victim',
      owner: 'p_victim',
      card: { id: 'shock', name: 'Shock', type_line: 'Instant' },
    });
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p_you', sourceName: 'Whirlwind Denial' });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{4}');
  });

  it('pays one Whirlwind Denial tax independently and prompts the next unpaid opponent', () => {
    const oracle = 'For each spell and ability your opponents control, counter it unless its controller pays {4}.';
    const steps = parseOracleTextToIR(oracle, 'Whirlwind Denial').abilities[0]?.steps ?? [];
    const state = makeState();
    state.players.push({ id: 'p_opp2', seat: 2, library: [], hand: [], graveyard: [] } as any);
    state.stack.push({
      id: 'spell-opp2',
      type: 'spell',
      controller: 'p_opp2',
      owner: 'p_opp2',
      card: { id: 'shock', name: 'Shock', type_line: 'Instant' },
    });
    state.manaPool.p_victim.colorless = 4;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: 'Whirlwind Denial',
      sourceId: 'whirlwind',
      targetSpellId: 'spell-victim',
      unlessPaysManaChoice: 'pay',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });
    const remainingIds = (result.state.stack || []).map((item: any) => String(item?.id || ''));
    expect(remainingIds).toContain('spell-victim');
    expect(remainingIds).toContain('spell-opp2');
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
  });

  it('does not unconditionally counter when the payer declines Circular Logic', () => {
    const oracle = 'Counter target spell unless its controller pays {1} for each card in your graveyard.';
    const steps = parseOracleTextToIR(oracle, 'Circular Logic').abilities[0]?.steps ?? [];
    const state = makeState({ graveyard: 2 });
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: 'Circular Logic',
      targetSpellId: 'spell-victim',
      unlessPaysManaChoice: 'decline',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.appliedSteps.map((step) => step.kind)).toContain('counter_spell');
    expect(result.state.stack).toEqual([]);
  });

  it('leaves the spell on the stack when Circular Logic cost is paid', () => {
    const oracle = 'Counter target spell unless its controller pays {1} for each card in your graveyard.';
    const steps = parseOracleTextToIR(oracle, 'Circular Logic').abilities[0]?.steps ?? [];
    const state = makeState({ graveyard: 1 });
    state.manaPool.p_victim.colorless = 1;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: 'Circular Logic',
      targetSpellId: 'spell-victim',
      unlessPaysManaChoice: 'pay',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['unless_pays_mana']);
    expect(result.state.stack).toHaveLength(1);
  });

  it('parses Concerted Defense plus-additional party count', () => {
    const step = firstUnlessPaysMana(
      'Counter target noncreature spell unless its controller pays {1} plus an additional {1} for each creature in your party. (Your party consists of up to one each of Cleric, Rogue, Warrior, and Wizard.)',
      'Concerted Defense',
    );
    expect(step?.manaAmountRaw).toMatch(/1 plus 1 for each creature in your party/i);
    const state = makeState();
    state.battlefield.push({
      id: 'cleric',
      controller: 'p_you',
      card: { name: 'Priest', type_line: 'Creature — Human Cleric' },
    });
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p_you', sourceName: 'Concerted Defense', targetSpellId: 'spell-victim' });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{2}');
  });

  it('parses Oppressive Will as {1} per card in hand', () => {
    const step = firstUnlessPaysMana(
      'Counter target spell unless its controller pays {1} for each card in your hand.',
      'Oppressive Will',
    );
    const state = makeState({ hand: 3 });
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p_you', sourceName: 'Oppressive Will', targetSpellId: 'spell-victim' });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{3}');
  });

  it('parses Spell Syphon as {1} per blue permanent you control', () => {
    const step = firstUnlessPaysMana(
      'Counter target spell unless its controller pays {1} for each blue permanent you control.',
      'Spell Syphon',
    );
    const state = makeState({ devotionBlue: 2 });
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p_you', sourceName: 'Spell Syphon', targetSpellId: 'spell-victim' });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{1}');
  });

  it('parses Ixidor\'s Will as {2} per Wizard on the battlefield', () => {
    const step = firstUnlessPaysMana(
      "Counter target spell unless its controller pays {2} for each Wizard on the battlefield.",
      "Ixidor's Will",
    );
    const state = makeState();
    state.battlefield.push({
      id: 'wiz',
      controller: 'p_you',
      card: { name: 'Prodigal Sorcerer', type_line: 'Creature — Human Wizard' },
    });
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p_you', sourceName: "Ixidor's Will", targetSpellId: 'spell-victim' });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{2}');
  });

  it('parses Rune Snag plus-additional named cards in graveyards', () => {
    const step = firstUnlessPaysMana(
      'Counter target spell unless its controller pays {2} plus an additional {2} for each card named Rune Snag in each graveyard.',
      'Rune Snag',
    );
    expect(step?.manaAmountRaw).toMatch(/card named (?:this permanent|rune snag) in each graveyard/i);
    const state = makeState();
    state.players[0].graveyard.push({ id: 'rs-1', name: 'Rune Snag' });
    state.players[1].graveyard.push({ id: 'rs-2', name: 'Rune Snag' });
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p_you', sourceName: 'Rune Snag', targetSpellId: 'spell-victim' });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{6}');
  });

  it('parses Protect the Negotiators as {1} per creature you control', () => {
    const step = firstUnlessPaysMana(
      'Counter target spell unless its controller pays {1} for each creature you control.',
      'Protect the Negotiators',
    );
    const state = makeState({ faeries: 2 });
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p_you', sourceName: 'Protect the Negotiators', targetSpellId: 'spell-victim' });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{2}');
  });

  it('parses Aether Spike energy paid this way', () => {
    const ir = parseOracleTextToIR(
      'Choose target spell. You get {E}{E} (two energy counters), then you may pay any amount of {E}. Counter that spell unless its controller pays {1} for each {E} paid this way.',
      'Aether Spike',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'pay_energy')).toBe(true);
    const step = steps.find((entry) => entry.kind === 'unless_pays_mana') as
      | Extract<(typeof steps)[number], { kind: 'unless_pays_mana' }>
      | undefined;
    expect(step?.manaAmountRaw).toMatch(/1 for each \{e\} paid this way/i);
    const state = makeState();
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: 'Aether Spike',
      targetSpellId: 'spell-victim',
      energyPaidThisWay: 3,
    } as any);
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{3}');
  });

  it('parses Brine Seer cards revealed this way from prior reveal', () => {
    const step = firstUnlessPaysMana(
      'Reveal any number of blue cards in your hand. Counter target spell unless its controller pays {1} for each card revealed this way.',
      'Scent of Brine',
    );
    const state = makeState();
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: 'Scent of Brine',
      targetSpellId: 'spell-victim',
      lastRevealedCards: [{ id: 'a' }, { id: 'b' }],
      lastRevealedCardCount: 2,
    } as any);
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{2}');
  });

  it('parses Rites of Refusal discarded this way', () => {
    const step = firstUnlessPaysMana(
      'Discard any number of cards. Counter target spell unless its controller pays {3} for each card discarded this way.',
      'Rites of Refusal',
    );
    const state = makeState();
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: 'Rites of Refusal',
      targetSpellId: 'spell-victim',
      lastDiscardedCards: [{ id: 'a' }, { id: 'b' }],
    } as any);
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{6}');
  });

  it('parses Swallowed by Leviathan chosen-spell unless graveyard count', () => {
    const step = firstUnlessPaysMana(
      'Choose target spell. Surveil 2, then counter the chosen spell unless its controller pays {1} for each card in your graveyard.',
      'Swallowed by Leviathan',
    );
    expect(step?.kind).toBe('unless_pays_mana');
    const state = makeState({ graveyard: 2 });
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p_you', sourceName: 'Swallowed by Leviathan', targetSpellId: 'spell-victim' });
    expect(resolveUnlessPaysManaCostString(state, step!, ctx)).toBe('{2}');
  });

  it('parses Heroism as unless_pays_mana {2}{R} for each attacking red creature', () => {
    const step = firstUnlessPaysMana(
      'For each attacking red creature, prevent all combat damage that would be dealt by that creature this turn unless its controller pays {2}{R}.',
      'Heroism',
    );
    expect(step?.kind).toBe('unless_pays_mana');
    expect(step?.mana).toBe('{2}{R}');
    expect(step?.forEachPermanentText).toMatch(/attacking red creature/i);
    expect(step?.steps?.[0]?.kind).toBe('prevent_damage');
  });

  it('prevents combat damage from an attacking red creature when Heroism tax is declined', () => {
    const oracle = 'For each attacking red creature, prevent all combat damage that would be dealt by that creature this turn unless its controller pays {2}{R}.';
    const steps = parseOracleTextToIR(oracle, 'Heroism').abilities[0]?.steps ?? [];
    const state = makeState();
    state.battlefield.push({
      id: 'goblin',
      controller: 'p_victim',
      attacking: 'p_you',
      card: { name: 'Goblin', type_line: 'Creature — Goblin', colors: ['R'] },
    });
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: 'Heroism',
      unlessPaysManaChoice: 'decline',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.appliedSteps.map((step) => step.kind)).toContain('prevent_damage');
  });
});
