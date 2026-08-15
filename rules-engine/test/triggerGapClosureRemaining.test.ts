import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

describe('remaining trigger gap IR closures', () => {
  it('parses abbreviated finality-counter battlefield returns', () => {
    const ir = parseOracleTextToIR(
      'Return that card under your control with a finality counter on it.',
      'Meren of Clan Nel Toth',
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'move_zone') as any;
    expect(step).toBeTruthy();
    expect(step.to).toBe('battlefield');
    expect(step.withCounters?.finality).toBe(1);
  });

  it('parses optional abbreviated finality returns', () => {
    const ir = parseOracleTextToIR(
      'You may return that card under your control with a finality counter on it.',
      'Emperor of Bones',
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'move_zone') as any;
    expect(step).toBeTruthy();
    expect(step.withCounters?.finality).toBe(1);
    expect(step.optional === true || /you may/i.test(String(step.raw || ''))).toBe(true);
  });

  it('parses create copies of each nonland card among them', () => {
    const ir = parseOracleTextToIR(
      'Create copies of each nonland card among them.',
      'Arcane Savant',
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'create_token') as any;
    expect(step).toBeTruthy();
    expect(String(step.token || '').toLowerCase()).toContain('nonland');
  });

  it("parses can't be blocked except by haste restriction", () => {
    const ir = parseOracleTextToIR(
      "Target creature with haste can't be blocked this turn except by creatures with haste.",
      'Labyrinth Adversary',
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'grant_temporary_ability') as any;
    expect(step).toBeTruthy();
    expect(JSON.stringify(step.effectText || []).toLowerCase()).toContain("can't be blocked except by");
  });

  it('parses attacking creatures get +N/+N and gain keyword', () => {
    const ir = parseOracleTextToIR(
      'Attacking creatures get +1/+1 and gain trample until end of turn.',
      'Battlecry',
    );
    const steps = ir.abilities.flatMap((a) => a.steps || []);
    expect(steps.some((s) => s.kind === 'modify_pt')).toBe(true);
    expect(steps.some((s) => s.kind === 'grant_temporary_ability')).toBe(true);
  });

  it('parses Support N on ETB triggers', () => {
    const ir = parseOracleTextToIR(
      'When Expedition Raptor enters, support 2.',
      'Expedition Raptor',
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'add_counter') as any;
    expect(step).toBeTruthy();
    expect(String(step.target?.text || '')).toMatch(/up to 2 other target creatures/i);
  });

  it('parses contextual removal from combat and unblock rider', () => {
    const ir = parseOracleTextToIR(
      'Tap the creature, remove it from combat, and creatures it was blocking that had become blocked by only that creature this combat become unblocked.',
      'Imprison',
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'remove_from_combat') as any;
    expect(step).toBeTruthy();
    expect(step.unblockCreaturesBlockedOnlyByIt).toBe(true);
  });

  it('parses If-you-do attacking creatures P/T and keyword', () => {
    const ir = parseOracleTextToIR(
      'You may sacrifice a Food. If you do, attacking creatures get +1/+1 and gain trample until end of turn.',
      'Provisions Merchant',
    );
    const conditional = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional') as any;
    expect(conditional?.steps?.some((s: any) => s.kind === 'modify_pt')).toBe(true);
    expect(conditional?.steps?.some((s: any) => s.kind === 'grant_temporary_ability')).toBe(true);
  });

  it('parses discard equal to that creature toughness', () => {
    const ir = parseOracleTextToIR(
      "Discard cards equal to that creature's toughness.",
      'Vanish into Memory',
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'discard') as any;
    expect(step).toBeTruthy();
    expect(JSON.stringify(step.amount || {})).toMatch(/toughness/i);
  });

  it('parses mana in any combination of its colors', () => {
    const ir = parseOracleTextToIR(
      'Add three mana in any combination of its colors.',
      'Omnath, Locus of All',
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'add_mana') as any;
    expect(step).toBeTruthy();
    expect(step.manaOptionsScope).toBe('referenced_permanent_colors');
  });

  it('parses shuffle that pile onto library top', () => {
    const ir = parseOracleTextToIR(
      'Shuffle that pile and put it back on top of your library.',
      'Parallel Thoughts',
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'move_zone') as any;
    expect(step).toBeTruthy();
    expect(step.to).toBe('library');
    expect(step.libraryPlacement).toBe('top');
  });

  it('parses nested If-you-do untap and P/T pump', () => {
    const ir = parseOracleTextToIR(
      'You may tap an untapped creature you control. If you do, untap it and it gets +1/+1 until end of turn.',
      'Lattice-Blade Mantis',
    );
    const conditional = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional') as any;
    expect(conditional?.steps?.some((s: any) => s.kind === 'tap_or_untap' && s.mode === 'untap')).toBe(true);
    expect(conditional?.steps?.some((s: any) => s.kind === 'modify_pt')).toBe(true);
  });

  it('parses nested If-you-do Support N', () => {
    const ir = parseOracleTextToIR(
      'You may tap an untapped creature you control. If you do, support 2.',
      'Jubilant Mascot',
    );
    const conditional = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional') as any;
    expect(conditional?.steps?.some((s: any) => s.kind === 'add_counter')).toBe(true);
  });

  it('parses mill then enchanted static without absorbing where-X into mill', () => {
    const ir = parseOracleTextToIR(
      'Mill two cards. Enchanted creature gets -X/-0, where X is the number of cards in your graveyard.',
      'Fear of Death',
    );
    const mill = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'mill') as any;
    expect(mill?.amount).toEqual({ kind: 'number', value: 2 });
    const unknowns = ir.abilities.flatMap((a) => a.steps || []).filter((s) => s.kind === 'unknown');
    expect(unknowns).toEqual([]);
  });

  it('parses aura instead-as-long-as P/T rider', () => {
    const ir = parseOracleTextToIR(
      "Venture into the dungeon. Enchanted creature gets -2/-2. It gets -5/-5 instead as long as you've completed a dungeon.",
      'Precipitous Drop',
    );
    const steps = ir.abilities.flatMap((a) => a.steps || []);
    expect(steps.some((s) => s.kind === 'venture_into_dungeon')).toBe(true);
    const conditional = steps.find((s) => s.kind === 'conditional') as any;
    expect(conditional?.condition?.kind).toBe('as_long_as');
    expect(conditional?.steps?.[0]?.kind).toBe('grant_static_ability');
    expect(conditional?.steps?.[0]?.power).toBe(-5);
    expect(steps.some((s) => s.kind === 'unknown')).toBe(false);
  });

  it('parses nested draw and additional land this turn', () => {
    const ir = parseOracleTextToIR(
      'You may exile an instant or sorcery card from your graveyard. If you do, draw a card and you may play an additional land this turn.',
      'Imoen, Wise Trickster',
    );
    const conditional = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional') as any;
    expect(conditional?.steps?.some((s: any) => s.kind === 'draw' && s.amount?.value === 1)).toBe(true);
    expect(
      conditional?.steps?.some(
        (s: any) =>
          s.kind === 'grant_temporary_ability' &&
          /additional land this turn/i.test(String((s.effectText || []).join(' '))),
      ),
    ).toBe(true);
  });

  it('parses If-you-do draw and self P/T pump', () => {
    const ir = parseOracleTextToIR(
      'You may sacrifice an artifact or discard a card. If you do, draw a card and this creature gets +2/+0 until end of turn.',
      'Reckless Detective',
    );
    const steps = ir.abilities.flatMap((a) => a.steps || []);
    const conditional = steps.find((s) => s.kind === 'conditional') as any;
    expect(conditional?.condition?.raw).toBe('you do');
    expect(conditional?.steps?.some((s: any) => s.kind === 'draw' && s.amount?.value === 1)).toBe(true);
    expect(conditional?.steps?.some((s: any) => s.kind === 'modify_pt' && s.power === 2 && s.toughness === 0)).toBe(true);
    expect(steps.some((s) => s.kind === 'unknown')).toBe(false);
    expect(
      steps.some(
        (s) =>
          s.kind === 'draw' &&
          typeof (s as any).amount === 'object' &&
          (s as any).amount?.kind === 'unknown',
      ),
    ).toBe(false);
  });

  it('parses If-you-do draw and lose life compounds', () => {
    const ir = parseOracleTextToIR(
      'You may pay {1}. If you do, draw a card and each opponent loses 1 life.',
      'Oloro, Ageless Ascetic',
    );
    const conditional = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional') as any;
    expect(conditional?.steps?.some((s: any) => s.kind === 'draw')).toBe(true);
    expect(conditional?.steps?.some((s: any) => s.kind === 'lose_life')).toBe(true);
  });

  it('parses draw and blight / chaos ensues follow-ups', () => {
    const blightIr = parseOracleTextToIR('Draw a card and blight 1.', 'Sinister Gnarlbark');
    const blightSteps = blightIr.abilities.flatMap((a) => a.steps || []);
    expect(blightSteps.some((s) => s.kind === 'draw')).toBe(true);
    expect(blightSteps.some((s) => s.kind === 'blight')).toBe(true);

    const chaosIr = parseOracleTextToIR('You draw a card and chaos ensues.', 'Missy');
    const chaosSteps = chaosIr.abilities.flatMap((a) => a.steps || []);
    expect(chaosSteps.some((s) => s.kind === 'draw')).toBe(true);
    expect(chaosSteps.some((s) => s.kind === 'unknown')).toBe(false);
  });

  it('parses add that much mana of any one color', () => {
    const ir = parseOracleTextToIR(
      'Add that much mana of any one color.',
      'Photon, Mighty Marvel',
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'add_mana') as any;
    expect(step).toBeTruthy();
    expect(step.amount).toEqual({ kind: 'reference_amount', raw: 'that much' });
    expect(step.requiresChosenMana).toBe(true);
  });

  it('parses tokens enter tapped and attacking follow-up', () => {
    const ir = parseOracleTextToIR(
      'Create two 2/2 blue Elemental creature tokens. The tokens enter tapped and attacking.',
      'Living Laser',
    );
    const steps = ir.abilities.flatMap((a) => a.steps || []);
    expect(steps.some((s) => s.kind === 'create_token')).toBe(true);
    const merged = steps.find((s) => s.kind === 'create_token' && ((s as any).entersTapped || (s as any).attacking));
    const followup = steps.find(
      (s) =>
        s.kind === 'grant_static_ability' &&
        /enter tapped and attacking/i.test(String(((s as any).effectText || []).join(' '))),
    );
    expect(Boolean(merged) || Boolean(followup)).toBe(true);
    expect(steps.some((s) => s.kind === 'unknown')).toBe(false);
  });
});
