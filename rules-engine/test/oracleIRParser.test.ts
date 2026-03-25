import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function unwrapLeadingConditionalSteps(steps: readonly any[]): readonly any[] {
  const first = steps[0];
  if (steps.length === 1 && first?.kind === 'conditional' && Array.isArray(first.steps)) {
    return first.steps;
  }
  return steps;
}

function flattenNestedSteps(steps: readonly any[]): readonly any[] {
  const out: any[] = [];
  for (const step of steps) {
    if (step?.kind === 'conditional' && Array.isArray(step.steps)) {
      out.push(...flattenNestedSteps(step.steps));
      continue;
    }
    out.push(step);
  }
  return out;
}

describe('Oracle IR Parser', () => {
  it('parses ordered draw/then-discard into IR steps', () => {
    const text = 'Draw two cards. Then discard a card.';
    const ir = parseOracleTextToIR(text);

    expect(ir.abilities.length).toBeGreaterThanOrEqual(1);
    const steps = ir.abilities[0].steps;
    expect(steps.length).toBeGreaterThanOrEqual(2);

    expect(steps[0].kind).toBe('draw');
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 2 });

    expect(steps[1].kind).toBe('discard');
    expect((steps[1] as any).amount).toEqual({ kind: 'number', value: 1 });
    expect((steps[1] as any).sequence).toBe('then');
  });
  
  it('upgrades exile-top into impulse for "cards exiled with this creature" permission', () => {
    const text =
      "Whenever you sacrifice a nontoken permanent, exile the top card of your library. During your turn, as long as you've sacrificed a nontoken permanent this turn, you may play cards exiled with this creature.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const impulse = steps.find((s) => s.kind === 'impulse_exile_top') as any;

    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('as_long_as_control_source');
  });

  it('parses Intrepid Paleontologist into a linked-exile cast-permission step with finality metadata', () => {
    const text = `{T}: Add one mana of any color.
{2}: Exile target card from a graveyard.
You may cast Dinosaur creature spells from among cards you own exiled with this creature. If you cast a spell this way, that creature enters with a finality counter on it. (If a creature with a finality counter on it would die, exile it instead.)`;

    const ir = parseOracleTextToIR(text, 'Intrepid Paleontologist');
    const permission = ir.abilities[2].steps[0] as any;

    expect(permission.kind).toBe('grant_exile_permission');
    expect(permission.who).toEqual({ kind: 'you' });
    expect(permission.what).toEqual({ kind: 'raw', text: 'Dinosaur creature spells' });
    expect(permission.permission).toBe('cast');
    expect(permission.duration).toBe('as_long_as_control_source');
    expect(permission.linkedToSource).toBe(true);
    expect(permission.ownedByWho).toBe('granted_player');
    expect(permission.castedPermanentEntersWithCounters).toEqual({ finality: 1 });
  });

  it('parses Boiling Rock Rioter into the linked-exile attack trigger shape', () => {
    const text = `Firebending 1 (Whenever this creature attacks, add {R}. This mana lasts until end of combat.)
Tap an untapped Ally you control: Exile target card from a graveyard.
Whenever this creature attacks, you may cast an Ally spell from among cards you own exiled with this creature.`;

    const ir = parseOracleTextToIR(text, 'Boiling Rock Rioter');

    expect(ir.abilities).toHaveLength(3);

    const reminder = ir.abilities[0].steps as any[];
    expect(reminder).toHaveLength(2);
    expect(reminder[0].kind).toBe('unknown');
    expect(reminder[0].raw).toBe('Firebending 1 (Whenever this creature attacks, add {R}');
    expect(reminder[1].kind).toBe('unknown');
    expect(reminder[1].raw).toBe('This mana lasts until end of combat.)');

    const exileStep = ir.abilities[1].steps[0] as any;
    expect(exileStep.kind).toBe('move_zone');
    expect(exileStep.what).toEqual({ kind: 'raw', text: 'target card from a graveyard' });
    expect(exileStep.to).toBe('exile');

    const attackPermission = ir.abilities[2].steps[0] as any;
    expect(attackPermission.kind).toBe('grant_exile_permission');
    expect(attackPermission.who).toEqual({ kind: 'you' });
    expect(attackPermission.what).toEqual({ kind: 'raw', text: 'an Ally spell' });
    expect(attackPermission.permission).toBe('cast');
    expect(attackPermission.duration).toBe('during_resolution');
    expect(attackPermission.linkedToSource).toBe(true);
    expect(attackPermission.ownedByWho).toBe('granted_player');
    expect(attackPermission.optional).toBe(true);
    expect(attackPermission.raw).toBe('you may cast an Ally spell from among cards you own exiled with this creature');
  });

  it('parses Emperor of Bones into the linked-exile reanimation shape', () => {
    const text = `At the beginning of combat on your turn, exile up to one target card from a graveyard.
{1}{B}: Adapt 2.
Whenever one or more +1/+1 counters are put on this creature, put a creature card exiled with this creature onto the battlefield under your control with a finality counter on it. It gains haste. Sacrifice it at the beginning of the next end step.`;

    const ir = parseOracleTextToIR(text, 'Emperor of Bones');

    expect(ir.abilities).toHaveLength(3);

    const exileStep = ir.abilities[0].steps[0] as any;
    expect(exileStep.kind).toBe('move_zone');
    expect(exileStep.what).toEqual({ kind: 'raw', text: 'up to one target card from a graveyard' });
    expect(exileStep.to).toBe('exile');

    const adaptStep = ir.abilities[1].steps[0] as any;
    expect(adaptStep.kind).toBe('unknown');
    expect(adaptStep.raw).toBe('Adapt 2');

    const reanimateSteps = ir.abilities[2].steps as any[];
    expect(reanimateSteps).toHaveLength(3);

    expect(reanimateSteps[0].kind).toBe('move_zone');
    expect(reanimateSteps[0].what).toEqual({ kind: 'raw', text: 'a creature card exiled with this creature' });
    expect(reanimateSteps[0].to).toBe('battlefield');
    expect(reanimateSteps[0].battlefieldController).toEqual({ kind: 'you' });
    expect(reanimateSteps[0].withCounters).toEqual({ finality: 1 });

    expect(reanimateSteps[1].kind).toBe('unknown');
    expect(reanimateSteps[1].raw).toBe('It gains haste');

    expect(reanimateSteps[2].kind).toBe('schedule_delayed_battlefield_action');
    expect(reanimateSteps[2].timing).toBe('next_end_step');
    expect(reanimateSteps[2].action).toBe('sacrifice');
  });

  it('parses The Spot, Living Portal into the linked-exile death trigger shape', () => {
    const text = `When The Spot enters, exile up to one target nonland permanent and up to one target nonland permanent card from a graveyard.
When The Spot dies, put him on the bottom of his owner's library. If you do, return the exiled cards to their owners' hands.`;

    const ir = parseOracleTextToIR(text, 'The Spot, Living Portal');

    expect(ir.abilities).toHaveLength(2);

    const etbSteps = ir.abilities[0].steps as any[];
    expect(etbSteps).toHaveLength(2);

    expect(etbSteps[0].kind).toBe('exile');
    expect(etbSteps[0].target).toEqual({ kind: 'raw', text: 'up to one target nonland permanent' });

    expect(etbSteps[1].kind).toBe('move_zone');
    expect(etbSteps[1].what).toEqual({ kind: 'raw', text: 'up to one target nonland permanent card from a graveyard' });
    expect(etbSteps[1].to).toBe('exile');

    const deathSteps = ir.abilities[1].steps as any[];
    expect(deathSteps).toHaveLength(2);

    expect(deathSteps[0].kind).toBe('move_zone');
    expect(deathSteps[0].what).toEqual({ kind: 'raw', text: 'him' });
    expect(deathSteps[0].to).toBe('library');
    expect(deathSteps[0].toRaw).toBe("the bottom of his owner's library");

    expect(deathSteps[1].kind).toBe('conditional');
    expect(deathSteps[1].condition).toEqual({ kind: 'if', raw: 'you do' });
    expect(deathSteps[1].steps).toHaveLength(1);
    expect(deathSteps[1].steps[0].kind).toBe('move_zone');
    expect(deathSteps[1].steps[0].what).toEqual({ kind: 'raw', text: 'the exiled cards' });
    expect(deathSteps[1].steps[0].to).toBe('hand');
  });

  it('parses Ardyn, the Usurper into exile plus conditional copy-token follow-up steps', () => {
    const text =
      "Starscourge — At the beginning of combat on your turn, exile up to one target creature card from a graveyard. If a card is exiled this way, create a token that's a copy of it, except it's a 1/1 black Spirit creature in addition to its other types.";

    const ir = parseOracleTextToIR(text, 'Ardyn, the Usurper');
    const steps = ir.abilities[0]?.steps as any[];

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]?.type).toBe('triggered');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'up to one target creature card from a graveyard' },
      to: 'exile',
    });
    expect(steps[1]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'a card is exiled this way' },
      steps: [
        expect.objectContaining({
          kind: 'create_token',
          token: "copy of it, except it's a 1/1 black Spirit creature in addition to its other types",
        }),
      ],
    });
  });

  it('parses Dino DNA token-copy activation into a create_token step linked to exiled cards', () => {
    const text = `Imprint — {1}, {T}: Exile target creature card from a graveyard.
{6}, {T}: Create a token that's a copy of a creature card exiled with Dino DNA, except it's a 6/6 green Dinosaur creature with trample in addition to its other types. Activate only as a sorcery.`;

    const ir = parseOracleTextToIR(text, 'Dino DNA');
    const steps = ir.abilities[1]?.steps as any[];

    expect(ir.abilities[1]?.type).toBe('activated');
    expect(steps[0]).toMatchObject({
      kind: 'create_token',
      token: "copy of a creature card exiled with this permanent, except it's a 6/6 green Dinosaur creature with trample in addition to its other types",
    });
  });

  it('parses Dimir Doppelganger into exile plus copy-permanent follow-up steps', () => {
    const text =
      '{1}{U}{B}: Exile target creature card from a graveyard. This creature becomes a copy of that card, except it has this ability.';

    const ir = parseOracleTextToIR(text, 'Dimir Doppelganger');
    const steps = ir.abilities[0]?.steps as any[];

    expect(ir.abilities[0]?.type).toBe('activated');
    expect(steps[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'target creature card from a graveyard' },
      to: 'exile',
    });
    expect(steps[1]).toMatchObject({
      kind: 'copy_permanent',
      source: { kind: 'raw', text: 'that card' },
    });
    expect(String((steps[1] as any)?.target?.text || '').toLowerCase()).toBe('this creature');
  });

  it("upgrades exile-top into impulse for Hauken's Insight-style 'Once during each of your turns' permission (corpus)", () => {
    const text =
      'At the beginning of your upkeep, exile the top card of your library face down. You may look at that card for as long as it remains exiled. Once during each of your turns, you may play a land or cast a spell from among the cards exiled with this permanent without paying its mana cost.';

    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'triggered')!;
    expect(ability).toBeTruthy();

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('as_long_as_control_source');
  });

  it('parses token creation into IR steps', () => {
    const text = 'Draw a card. Create a 1/1 white Soldier creature token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps.map(s => s.kind)).toContain('draw');
    expect(steps.map(s => s.kind)).toContain('create_token');

    const tokenStep = steps.find(s => s.kind === 'create_token') as any;
    expect(tokenStep.amount).toEqual({ kind: 'number', value: 1 });
    expect(tokenStep.token).toContain('1/1');
    expect(tokenStep.token.toLowerCase()).toContain('soldier');
  });

  it('splits sacrifice-leading conjunction clauses so deterministic self-sacrifice can execute', () => {
    const text = "Sacrifice this artifact and draw three cards.";
    const ir = parseOracleTextToIR(text, "Volrath's Motion Sensor");
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe('sacrifice');
    expect(steps[0].what).toEqual({ kind: 'raw', text: 'this artifact' });
    expect(steps[1].kind).toBe('draw');
    expect(steps[1].amount).toEqual({ kind: 'number', value: 3 });
  });

  it('preserves unsupported sacrifice follow-ups as explicit unknown steps after splitting', () => {
    const text = 'Sacrifice this enchantment and counter that spell.';
    const ir = parseOracleTextToIR(text, 'Hesitation');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe('sacrifice');
    expect(steps[1].kind).toBe('unknown');
    expect(steps[1].raw).toBe('counter that spell');
  });

  it('splits named-self sacrifice conjunctions while preserving then-sequence metadata', () => {
    const text = 'Sacrifice Scavenger Hunt, then open an Attraction.';
    const ir = parseOracleTextToIR(text, 'Scavenger Hunt');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe('sacrifice');
    expect(steps[0].what).toEqual({ kind: 'raw', text: 'this permanent' });
    expect(steps[1].kind).toBe('unknown');
    expect(steps[1].sequence).toBe('then');
    expect(steps[1].raw).toBe('then open an Attraction');
  });

  it('normalizes legendary shorthand self-references before sacrifice parsing', () => {
    const text = 'When you control seven or more Thrulls, sacrifice Endrek Sahr.';
    const ir = parseOracleTextToIR(text, 'Endrek Sahr, Master Breeder');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('sacrifice');
    expect(steps[0].what).toEqual({ kind: 'raw', text: 'this permanent' });
  });

  it('preserves condition-gated shorthand legendary self-reference conjunctions as a conditional wrapper', () => {
    const text = 'If eight or more mana was spent to cast that spell, sacrifice Tellah and it deals that much damage to each opponent.';
    const ir = parseOracleTextToIR(text, 'Tellah, Great Sage');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('conditional');
    expect(steps[0].condition).toEqual({ kind: 'if', raw: 'eight or more mana was spent to cast that spell' });
    expect(steps[0].steps).toHaveLength(2);
    expect(steps[0].steps[0].kind).toBe('sacrifice');
    expect(steps[0].steps[0].what).toEqual({ kind: 'raw', text: 'this permanent' });
    expect(steps[0].steps[1].kind).toBe('deal_damage');
    expect(steps[0].steps[1].amount).toEqual({ kind: 'unknown', raw: 'that much' });
    expect(steps[0].steps[1].target).toEqual({ kind: 'raw', text: 'each opponent' });
    expect(steps[0].steps[1].raw).toBe('it deals that much damage to each opponent');
  });

  it('parses leading conditional sacrifice conjunctions into wrapped inner steps', () => {
    const text = "If you don't, sacrifice this artifact and draw three cards.";
    const ir = parseOracleTextToIR(text, 'Sorcerer\'s Strongbox');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('conditional');
    expect(steps[0].condition).toEqual({ kind: 'if', raw: "you don't" });
    expect(steps[0].steps).toHaveLength(2);
    expect(steps[0].steps[0].kind).toBe('sacrifice');
    expect(steps[0].steps[0].what).toEqual({ kind: 'raw', text: 'this artifact' });
    expect(steps[0].steps[1].kind).toBe('draw');
    expect(steps[0].steps[1].amount).toEqual({ kind: 'number', value: 3 });
  });

  it('parses leading conditional sacrifice wrappers with comma-delimited followups', () => {
    const text = "If you can't, sacrifice it, put a +1/+1 counter on enchanted creature, and that creature gains flying.";
    const ir = parseOracleTextToIR(text, 'Cocoon');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('conditional');
    expect(steps[0].condition).toEqual({ kind: 'if', raw: "you can't" });
    expect(steps[0].steps).toHaveLength(3);
    expect(steps[0].steps[0].kind).toBe('sacrifice');
    expect(steps[0].steps[0].what).toEqual({ kind: 'raw', text: 'it' });
    expect(steps[0].steps[1].kind).toBe('add_counter');
    expect(steps[0].steps[1].counter).toBe('+1/+1');
    expect(steps[0].steps[1].target).toEqual({ kind: 'raw', text: 'enchanted creature' });
    expect(steps[0].steps[2].kind).toBe('unknown');
    expect(steps[0].steps[2].raw).toBe('that creature gains flying');
  });

  it('parses conditional sacrifice wrappers that were split by top-level then handling', () => {
    const text = "If the result is equal to this Vehicle's mana value, sacrifice this Vehicle, then it deals that much damage to any target.";
    const ir = parseOracleTextToIR(text, 'Captain Rex Nebula');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('conditional');
    expect(steps[0].condition).toEqual({ kind: 'if', raw: "the result is equal to this Vehicle's mana value" });
    expect(steps[0].steps).toHaveLength(2);
    expect(steps[0].steps[0].kind).toBe('sacrifice');
    expect(steps[0].steps[1].kind).toBe('deal_damage');
    expect(steps[0].steps[1].amount).toEqual({ kind: 'unknown', raw: 'that much' });
    expect(steps[0].steps[1].target).toEqual({ kind: 'raw', text: 'any target' });
  });

  it('splits named-self sacrifice conjunctions that continue with "it deals"', () => {
    const text = 'Sacrifice Tellah and it deals 3 damage to each opponent.';
    const ir = parseOracleTextToIR(text, 'Tellah, Great Sage');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe('sacrifice');
    expect(steps[0].what).toEqual({ kind: 'raw', text: 'this permanent' });
    expect(steps[1].kind).toBe('deal_damage');
    expect(steps[1].amount).toEqual({ kind: 'number', value: 3 });
    expect(steps[1].target).toEqual({ kind: 'raw', text: 'each opponent' });
    expect(steps[1].raw).toBe('it deals 3 damage to each opponent');
  });

  it('splits explicit self-reference sacrifice conjunctions that continue with "it deals"', () => {
    const text = 'When another creature enters, sacrifice this creature and it deals 3 damage to target player or planeswalker.';
    const ir = parseOracleTextToIR(text, 'Mogg Bombers');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe('sacrifice');
    expect(steps[0].what).toEqual({ kind: 'raw', text: 'this creature' });
    expect(steps[1].raw).toBe('it deals 3 damage to target player or planeswalker');
  });

  it('parses optional tap-or-untap target permanent clauses', () => {
    const text = 'You may tap or untap target permanent.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const tapOrUntap = steps.find(s => s.kind === 'tap_or_untap') as any;

    expect(tapOrUntap).toBeTruthy();
    expect(tapOrUntap.optional).toBe(true);
    expect(tapOrUntap.target).toEqual({ kind: 'raw', text: 'target permanent' });
  });

  it('parses multi-token creation in a single clause into multiple steps', () => {
    const text = 'Create two Treasure tokens and a Clue token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(2);
    expect(creates[0].amount).toEqual({ kind: 'number', value: 2 });
    expect(String(creates[0].token || '').toLowerCase()).toContain('treasure');
    expect(creates[1].amount).toEqual({ kind: 'number', value: 1 });
    expect(String(creates[1].token || '').toLowerCase()).toContain('clue');
  });

  it('preserves who selector for multi-token create clauses', () => {
    const text = 'Each opponent creates a Treasure token and a Food token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(2);
    expect(creates[0].who).toEqual({ kind: 'each_opponent' });
    expect(creates[1].who).toEqual({ kind: 'each_opponent' });
  });

  it('normalizes "each of your opponents" into an each_opponent selector', () => {
    const text = 'Each of your opponents draws a card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('draw');
    expect((steps[0] as any).who).toEqual({ kind: 'each_opponent' });
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 1 });
  });

  it('normalizes "your opponents" into an each_opponent selector', () => {
    const text = 'Your opponents mill a card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('mill');
    expect((steps[0] as any).who).toEqual({ kind: 'each_opponent' });
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses "each of those opponents" as contextual selector', () => {
    const text = 'Each of those opponents loses 1 life.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('lose_life');
    expect((steps[0] as any).who).toEqual({ kind: 'each_of_those_opponents' });
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses "those opponents" as contextual selector alias', () => {
    const text = 'Those opponents lose 1 life.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('lose_life');
    expect((steps[0] as any).who).toEqual({ kind: 'each_of_those_opponents' });
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses "all of those opponents" as contextual selector alias', () => {
    const text = 'All of those opponents lose 1 life.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('lose_life');
    expect((steps[0] as any).who).toEqual({ kind: 'each_of_those_opponents' });
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses "all those opponents" as contextual selector alias', () => {
    const text = 'All those opponents lose 1 life.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('lose_life');
    expect((steps[0] as any).who).toEqual({ kind: 'each_of_those_opponents' });
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses "him or her" as target_player for deterministic life loss', () => {
    const text = 'Him or her loses 1 life.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('lose_life');
    expect((steps[0] as any).who).toEqual({ kind: 'target_player' });
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses \"that creature's owner\" as target_player for deterministic draw", () => {
    const text = "That creature's owner draws a card.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('draw');
    expect((steps[0] as any).who).toEqual({ kind: 'target_player' });
    expect((steps[0] as any).amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses exile_top for each of your opponents' libraries", () => {
    const text = "Exile the top card of each of your opponents' libraries.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses exile_top for those opponents' libraries as contextual selector alias", () => {
    const text = "Exile the top card of those opponents' libraries.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses exile_top for all of those opponents' libraries as contextual selector alias", () => {
    const text = "Exile the top card of all of those opponents' libraries.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses exile_top for each opponent’s library (curly apostrophe)', () => {
    const text = 'Exile the top card of each opponent’s library.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses exile_top for each opponent's library (straight apostrophe)", () => {
    const text = "Exile the top card of each opponent's library.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses exile_top for 'put the top card of each opponent's library into exile'", () => {
    const text = "Put the top card of each opponent's library into exile.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses battlefield attachment metadata for "attached to this creature"', () => {
    const text = 'Put target Aura card from a graveyard onto the battlefield under your control attached to this creature.';
    const ir = parseOracleTextToIR(text, 'Iridescent Drake');
    const moveZone = ir.abilities[0].steps.find(step => step.kind === 'move_zone') as any;

    expect(moveZone).toBeTruthy();
    expect(moveZone.to).toBe('battlefield');
    expect(moveZone.battlefieldController).toEqual({ kind: 'you' });
    expect(moveZone.battlefieldAttachedTo).toEqual({ kind: 'raw', text: 'this creature' });
  });

  it('parses battlefield attachment metadata for "attached to a creature you control"', () => {
    const text = 'Put target Aura card from a graveyard onto the battlefield under your control attached to a creature you control.';
    const ir = parseOracleTextToIR(text, 'Nomad Mythmaker');
    const moveZone = ir.abilities[0].steps.find(step => step.kind === 'move_zone') as any;

    expect(moveZone).toBeTruthy();
    expect(moveZone.to).toBe('battlefield');
    expect(moveZone.battlefieldController).toEqual({ kind: 'you' });
    expect(moveZone.battlefieldAttachedTo).toEqual({ kind: 'raw', text: 'a creature you control' });
  });

  it('expands Necromancy-style return-and-attach wording into move_zone plus attach', () => {
    const text =
      'When this enchantment enters, if it\'s on the battlefield, it becomes an Aura with "enchant creature put onto the battlefield with Necromancy." Put target creature card from a graveyard onto the battlefield under your control and attach this enchantment to it.';
    const ir = parseOracleTextToIR(text, 'Necromancy');
    const steps = unwrapLeadingConditionalSteps(ir.abilities[0].steps as any[]);

    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe('move_zone');
    expect(steps[0].what).toEqual({ kind: 'raw', text: 'target creature card from a graveyard' });
    expect(steps[0].to).toBe('battlefield');
    expect(steps[0].battlefieldController).toEqual({ kind: 'you' });
    expect(steps[1].kind).toBe('attach');
    expect(steps[1].attachment).toEqual({ kind: 'raw', text: 'this enchantment' });
    expect(steps[1].to).toEqual({ kind: 'raw', text: 'it' });
  });

  it('expands quoted emblem creation into a create_emblem step', () => {
    const text =
      '−7: You get an emblem with "At the beginning of combat on your turn, put target creature card from a graveyard onto the battlefield under your control."';
    const ir = parseOracleTextToIR(text, 'Liliana, Waker of the Dead');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('create_emblem');
    expect(steps[0].name).toBe('Liliana, Waker of the Dead Emblem');
    expect(steps[0].abilities).toEqual([
      'At the beginning of combat on your turn, put target creature card from a graveyard onto the battlefield under your control.',
    ]);
  });

  it("merges Unnatural Restoration's proliferate rider into the same ability", () => {
    const ir = parseOracleTextToIR(
      'Return target permanent card from your graveyard to your hand. Proliferate.',
      'Unnatural Restoration'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0].steps.map((step) => step.kind)).toEqual(['move_zone', 'proliferate']);
  });

  it("merges Sam's Desperate Rescue's Ring rider into the same ability", () => {
    const ir = parseOracleTextToIR(
      'Return target creature card from your graveyard to your hand. The Ring tempts you.',
      "Sam's Desperate Rescue"
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0].steps.map((step) => step.kind)).toEqual(['move_zone', 'ring_tempts_you']);
  });

  it("parses inline proliferate keyword followups like Tezzeret's Gambit", () => {
    const ir = parseOracleTextToIR('Draw two cards, then proliferate.', "Tezzeret's Gambit");

    expect(ir.abilities[0].steps.map((step) => step.kind)).toEqual(['draw', 'proliferate']);
    expect((ir.abilities[0].steps[1] as any).sequence).toBe('then');
  });

  it('expands simple conditional token followups like Fungal Rebirth', () => {
    const ir = parseOracleTextToIR(
      'Return target permanent card from your graveyard to your hand. If a creature died this turn, create two 1/1 green Saproling creature tokens.',
      'Fungal Rebirth'
    );
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe('move_zone');
    expect(steps[1].kind).toBe('conditional');
    expect(steps[1].condition).toEqual({ kind: 'if', raw: 'a creature died this turn' });
    expect(steps[1].steps.map((step: any) => step.kind)).toEqual(['create_token']);
  });

  it('expands simple "If you do" followups after discard like Toph, Hardheaded Teacher', () => {
    const ir = parseOracleTextToIR(
      'You may discard a card. If you do, return target instant or sorcery card from your graveyard to your hand.',
      'Toph, Hardheaded Teacher'
    );
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe('discard');
    expect(steps[1].kind).toBe('conditional');
    expect(steps[1].condition).toEqual({ kind: 'if', raw: 'you do' });
    expect(steps[1].steps.map((step: any) => step.kind)).toEqual(['move_zone']);
  });

  it('parses saga chapter move-zone clauses after stripping roman numeral prefixes', () => {
    const text = 'III — Put target creature or planeswalker card from a graveyard onto the battlefield under your control.';
    const ir = parseOracleTextToIR(text, 'The Eldest Reborn');
    const moveZone = ir.abilities[0].steps.find(step => step.kind === 'move_zone') as any;

    expect(moveZone).toBeTruthy();
    expect(moveZone.what).toEqual({ kind: 'raw', text: 'target creature or planeswalker card from a graveyard' });
    expect(moveZone.to).toBe('battlefield');
    expect(moveZone.battlefieldController).toEqual({ kind: 'you' });
  });

  it('parses saga chapter land recursion clauses after stripping roman numeral prefixes', () => {
    const text = 'II — Put target land card from a graveyard onto the battlefield under your control.';
    const ir = parseOracleTextToIR(text, 'Waking the Trolls');
    const moveZone = ir.abilities[0].steps.find(step => step.kind === 'move_zone') as any;

    expect(moveZone).toBeTruthy();
    expect(moveZone.what).toEqual({ kind: 'raw', text: 'target land card from a graveyard' });
    expect(moveZone.to).toBe('battlefield');
    expect(moveZone.battlefieldController).toEqual({ kind: 'you' });
  });

  it("parses exile_top for 'each player puts the top two cards of their library into exile'", () => {
    const text = 'Each player puts the top two cards of their library into exile.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_player' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 2 });
  });

  it("parses exile_top for 'defending player exiles the top card of their library'", () => {
    const text = 'Defending player exiles the top card of their library.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'target_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("upgrades exile_top into impulse for 'that player\'s library'", () => {
    const text = "Exile the top card of that player's library. You gain 2 life. You may cast it.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('cast');
    expect(impulse.duration).toBe('during_resolution');
  });

  it('parses each-player impulse with players-may permission rider (corpus)', () => {
    const text =
      "{T}, Exile this artifact: Each player exiles the top seven cards of their library. Until your next turn, players may play cards they exiled this way, and they can't play cards from their hand. Activate only as a sorcery.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'activated')!;
    expect(ability).toBeTruthy();

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 7 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it("upgrades exile-top into impulse for 'Until your next turn, you may play those cards' (corpus: Three Wishes)", () => {
    const text =
      "Exile the top three cards of your library face down. You may look at those cards for as long as they remain exiled. Until your next turn, you may play those cards. At the beginning of your next upkeep, put any of those cards you didn't play into your graveyard.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it("upgrades exile_top into impulse when 'Choose one' intervenes (corpus)", () => {
    const text = '+2: Add {R}{R}{R}. Exile the top three cards of your library. Choose one. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'activated')!;
    expect(ability).toBeTruthy();

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it("parses Ragavan-style 'create a Treasure token and exile the top card' into create_token + impulse", () => {
    const text =
      "Whenever Ragavan deals combat damage to a player, create a Treasure token and exile the top card of that player's library. Until end of turn, you may cast that card.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps.some(s => s.kind === 'create_token')).toBe(true);

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('cast');
    expect(impulse.duration).toBe('this_turn');
  });

  it('parses comma-separated multi-token creation lists', () => {
    const text = 'Create a Treasure token, a Food token, and a Clue token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const creates = steps.filter(s => s.kind === 'create_token') as any[];

    expect(creates).toHaveLength(3);
    expect(creates.map(c => c.amount)).toEqual([
      { kind: 'number', value: 1 },
      { kind: 'number', value: 1 },
      { kind: 'number', value: 1 },
    ]);
    const tokens = creates.map(c => String(c.token || '').toLowerCase());
    expect(tokens.join(' ')).toContain('treasure');
    expect(tokens.join(' ')).toContain('food');
    expect(tokens.join(' ')).toContain('clue');
  });

  it('preserves who selector for comma-separated multi-token create clauses', () => {
    const text = 'Each opponent creates two Treasure tokens, a Clue token, and a Food token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const creates = steps.filter(s => s.kind === 'create_token') as any[];

    expect(creates).toHaveLength(3);
    expect(creates[0].who).toEqual({ kind: 'each_opponent' });
    expect(creates[1].who).toEqual({ kind: 'each_opponent' });
    expect(creates[2].who).toEqual({ kind: 'each_opponent' });
    expect(creates[0].amount).toEqual({ kind: 'number', value: 2 });
  });

  it('parses create-token enters-tapped modifier', () => {
    const text = 'Create a tapped Treasure token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.entersTapped).toBe(true);
    expect(String(create.token || '').toLowerCase()).toContain('treasure');
  });

  it('parses create-token enters-tapped when "tapped" appears after token', () => {
    const text = 'Create a Treasure token tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.entersTapped).toBe(true);
    expect(String(create.token || '').toLowerCase()).toContain('treasure');
  });

  it('parses per-segment enters-tapped in multi-token clauses', () => {
    const text = 'Create a Treasure token tapped and a Clue token.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(2);
    expect(String(creates[0].token || '').toLowerCase()).toContain('treasure');
    expect(creates[0].entersTapped).toBe(true);
    expect(String(creates[1].token || '').toLowerCase()).toContain('clue');
    expect(Boolean(creates[1].entersTapped)).toBe(false);
  });

  it('parses create-token with-counters modifier', () => {
    const text = 'Create a 1/1 white Soldier creature token with two +1/+1 counters on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
    expect(String(create.token || '').toLowerCase()).toContain('soldier');
  });

  it('parses create-token with "an additional" counter wording', () => {
    const text = 'Create a Treasure token with an additional +1/+1 counter on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ '+1/+1': 1 });
  });

  it('applies follow-up "enters tapped" clauses to the previous create-token step', () => {
    const text = 'Create a Treasure token. It enters tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(1);
    expect(creates[0].entersTapped).toBe(true);

    // The follow-up clause should not appear as an unknown step.
    const unknowns = steps.filter(s => s.kind === 'unknown') as any[];
    expect(unknowns.some(u => String(u.raw || '').toLowerCase().includes('enters tapped'))).toBe(false);
  });

  it('applies follow-up "those tokens enter tapped" to multi-token creation', () => {
    const text = 'Create a Treasure token and a Clue token. Those tokens enter tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(2);
    expect(String(creates[0].token || '').toLowerCase()).toContain('treasure');
    expect(String(creates[1].token || '').toLowerCase()).toContain('clue');
    expect(creates[0].entersTapped).toBe(true);
    expect(creates[1].entersTapped).toBe(true);
  });

  it('applies follow-up "they enter tapped" (Bloomburrow-style) to the previous create-token step(s)', () => {
    const text = 'Create two Treasure tokens. They enter tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(1);
    expect(creates[0].entersTapped).toBe(true);

    // The follow-up clause should not appear as an unknown step.
    const unknowns = steps.filter(s => s.kind === 'unknown') as any[];
    expect(unknowns.some(u => String(u.raw || '').toLowerCase().includes('they enter tapped'))).toBe(false);
  });

  it('applies follow-up "they enter tapped" to multi-token creation', () => {
    const text = 'Create a Treasure token and a Clue token. They enter tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const creates = steps.filter(s => s.kind === 'create_token') as any[];
    expect(creates).toHaveLength(2);
    expect(String(creates[0].token || '').toLowerCase()).toContain('treasure');
    expect(String(creates[1].token || '').toLowerCase()).toContain('clue');
    expect(creates[0].entersTapped).toBe(true);
    expect(creates[1].entersTapped).toBe(true);
  });

  it('applies follow-up plural "they enter with counters" wording', () => {
    const text = 'Create two Treasure tokens. They enter with two +1/+1 counters on them.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
  });

  it('supports combined plural follow-up modifiers (tapped and with counters)', () => {
    const text = 'Create two Treasure tokens. They enter tapped and with two +1/+1 counters on them.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.entersTapped).toBe(true);
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
  });

  it('supports semicolon + lowercase follow-up wording (they enter tapped)', () => {
    const text = 'Create two Treasure tokens; they enter tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.amount).toEqual({ kind: 'number', value: 2 });
    expect(create.entersTapped).toBe(true);
  });

  it('supports plural follow-up with singular counter wording (a shield counter)', () => {
    const text = 'Create two Treasure tokens. They enter with a shield counter on them.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ shield: 1 });
  });

  it('applies follow-up "enters with counters" clauses to the previous create-token step', () => {
    const text = 'Create a Treasure token. It enters with two +1/+1 counters on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
  });

  it('applies follow-up "enters with an additional" counter wording', () => {
    const text = 'Create a Treasure token. It enters with an additional +1/+1 counter on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.withCounters).toEqual({ '+1/+1': 1 });
  });

  it('supports follow-up "enter the battlefield" phrasing for tapped + counters', () => {
    const text = 'Create a Treasure token. It enters the battlefield tapped and with two +1/+1 counters on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.entersTapped).toBe(true);
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
  });

  it('supports follow-up counters then tapped order', () => {
    const text = 'Create a Treasure token. It enters with two +1/+1 counters on it and tapped.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const create = steps.find(s => s.kind === 'create_token') as any;
    expect(create).toBeTruthy();
    expect(create.entersTapped).toBe(true);
    expect(create.withCounters).toEqual({ '+1/+1': 2 });
  });

  it('parses standalone delayed next-end-step sacrifice cleanup', () => {
    const text = 'Draw a card. At the beginning of the next end step, sacrifice that creature.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({
      kind: 'schedule_delayed_battlefield_action',
      timing: 'next_end_step',
      action: 'sacrifice',
      who: { kind: 'you' },
      object: { kind: 'raw', text: 'that creature' },
    });
  });

  it('parses trailing delayed next-end-step sacrifice cleanup', () => {
    const text = 'Draw a card. Sacrifice it at the beginning of the next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({
      kind: 'schedule_delayed_battlefield_action',
      timing: 'next_end_step',
      action: 'sacrifice',
      who: { kind: 'you' },
      object: { kind: 'raw', text: 'it' },
    });
  });

  it('parses trailing delayed your-next-end-step sacrifice cleanup', () => {
    const text = 'Whenever this creature attacks, sacrifice this creature at the beginning of your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'schedule_delayed_battlefield_action',
      timing: 'your_next_end_step',
      action: 'sacrifice',
      who: { kind: 'you' },
      object: { kind: 'raw', text: 'this creature' },
    });
  });

  it('parses standalone delayed end-of-combat exile cleanup', () => {
    const text = 'Draw a card. Exile those tokens at end of combat.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({
      kind: 'schedule_delayed_battlefield_action',
      timing: 'end_of_combat',
      action: 'exile',
      object: { kind: 'raw', text: 'those tokens' },
    });
  });

  it('parses trailing delayed next-cleanup-step sacrifice cleanup', () => {
    const text = 'Sacrifice this Aura at the beginning of the next cleanup step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'schedule_delayed_battlefield_action',
      timing: 'next_cleanup_step',
      action: 'sacrifice',
      who: { kind: 'you' },
      object: { kind: 'raw', text: 'this Aura' },
    });
  });

  it('parses trailing delayed your-next-upkeep sacrifice cleanup for contextual tokens', () => {
    const text = 'Sacrifice those tokens at the beginning of your next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'schedule_delayed_battlefield_action',
      timing: 'your_next_upkeep',
      action: 'sacrifice',
      who: { kind: 'you' },
      object: { kind: 'raw', text: 'those tokens' },
    });
  });

  it('parses trailing delayed next-upkeep return triggers as scheduled deterministic effects', () => {
    const text = "Return it to the battlefield tapped under its owner's control at the beginning of your next upkeep.";
    const ir = parseOracleTextToIR(text, 'Phytotitan');
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'schedule_delayed_trigger',
      timing: 'your_next_upkeep',
      effect: "Return it to the battlefield tapped under its owner's control",
    });
  });

  it('parses trailing delayed next-end-step hand return triggers as scheduled deterministic effects', () => {
    const text = "Return it to its owner's hand at the beginning of the next end step.";
    const ir = parseOracleTextToIR(text, 'The Locust God');
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'schedule_delayed_trigger',
      timing: 'next_end_step',
      effect: "Return it to its owner's hand",
    });
  });

  it('parses trailing delayed sacrifice cleanup with a mana value condition', () => {
    const text = 'Sacrifice it at the beginning of the next end step if it has mana value 3 or less.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'schedule_delayed_battlefield_action',
      timing: 'next_end_step',
      action: 'sacrifice',
      who: { kind: 'you' },
      object: { kind: 'raw', text: 'it' },
      condition: { kind: 'mana_value_compare', comparator: 'lte', value: 3, subject: 'it' },
    });
  });

  it('parses immediate sacrifice with a zero-counter condition', () => {
    const text = 'Sacrifice this enchantment if there are no echo counters on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'sacrifice',
      who: { kind: 'you' },
      what: { kind: 'raw', text: 'this enchantment' },
      condition: { kind: 'counter_compare', counter: 'echo', comparator: 'eq', value: 0, subject: 'it' },
    });
  });

  it('parses immediate sacrifice with a counter-threshold condition', () => {
    const text = 'Then sacrifice it if it has five or more bloodstain counters on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'sacrifice',
      who: { kind: 'you' },
      what: { kind: 'raw', text: 'it' },
      condition: { kind: 'counter_compare', counter: 'bloodstain', comparator: 'gte', value: 5, subject: 'it' },
      sequence: 'then',
    });
  });

  it('parses trailing leave-the-battlefield delayed sacrifice cleanup', () => {
    const text = 'Sacrifice Stangg when that token leaves the battlefield.';
    const ir = parseOracleTextToIR(text, 'Stangg');
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'schedule_delayed_battlefield_action',
      timing: 'when_leaves_battlefield',
      action: 'sacrifice',
      object: { kind: 'raw', text: 'this permanent' },
      watch: { kind: 'raw', text: 'that token' },
    });
  });

  it('parses trailing lose-control delayed sacrifice cleanup for itself', () => {
    const text = 'Sacrifice it when you lose control of this creature.';
    const ir = parseOracleTextToIR(text, 'Krovikan Vampire');
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'schedule_delayed_battlefield_action',
      timing: 'when_control_lost',
      action: 'sacrifice',
      object: { kind: 'raw', text: 'it' },
      watch: { kind: 'raw', text: 'this creature' },
    });
  });

  it('parses trailing lose-control delayed sacrifice cleanup for a bound creature', () => {
    const text = 'Sacrifice the creature when you lose control of this creature.';
    const ir = parseOracleTextToIR(text, 'Seraph');
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'schedule_delayed_battlefield_action',
      timing: 'when_control_lost',
      action: 'sacrifice',
      object: { kind: 'raw', text: 'the creature' },
      watch: { kind: 'raw', text: 'this creature' },
    });
  });

  it('parses exile and return/move zone clauses', () => {
    const text = 'Exile target creature. Return it to the battlefield under your control at the beginning of the next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('exile');
    expect((steps[0] as any).target?.text?.toLowerCase?.() || '').toContain('target');

    const delayed = steps.find(s => s.kind === 'schedule_delayed_trigger') as any;
    expect(delayed).toBeTruthy();
    expect(delayed.timing).toBe('next_end_step');
    expect(delayed.effect).toBe('Return it to the battlefield under your control');
  });

  it('parses Headstone as exile plus a delayed next-upkeep draw trigger', () => {
    const text = 'Exile target card from a graveyard. Draw a card at the beginning of the next upkeep.';
    const ir = parseOracleTextToIR(text, 'Headstone');
    const steps = ir.abilities[0].steps;

    expect(steps.map((step: any) => step.kind)).toEqual(['move_zone', 'schedule_delayed_trigger']);

    const delayed = steps[1] as any;
    expect(delayed.timing).toBe('next_upkeep');
    expect(delayed.effect).toBe('Draw a card');
  });

  it('parses battlefield move-zone counters for corpus reanimation wording', () => {
    const text = 'Put target creature card from a graveyard onto the battlefield under your control with a corpse counter on it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const move = steps.find(s => s.kind === 'move_zone') as any;
    expect(move).toBeTruthy();
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController).toEqual({ kind: 'you' });
    expect(move.entersTapped).toBeUndefined();
    expect(move.withCounters).toEqual({ corpse: 1 });
  });

  it('merges Spell mastery reanimation counter riders onto the prior battlefield move-zone step', () => {
    const text =
      'Put target creature card from a graveyard onto the battlefield under your control. Spell mastery — If there are two or more instant and/or sorcery cards in your graveyard, that creature enters with two additional +1/+1 counters on it.';
    const ir = parseOracleTextToIR(text, 'Necromantic Summons');
    const steps = ir.abilities[0].steps;

    expect(ir.abilities).toHaveLength(1);
    expect(steps).toHaveLength(1);

    const move = steps[0] as any;
    expect(move.kind).toBe('move_zone');
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController).toEqual({ kind: 'you' });
    expect(move.withCounters).toEqual({ '+1/+1': 2 });
    expect(move.withCountersCondition).toEqual({
      kind: 'if',
      raw: 'there are two or more instant and/or sorcery cards in your graveyard',
    });
  });

  it("merges Valkyrie's Call return-time type rewrite onto the battlefield move-zone step", () => {
    const text =
      "Whenever a nontoken, non-Angel creature you control dies, return that card to the battlefield under its owner's control with a +1/+1 counter on it. It's an Angel in addition to its other types.";
    const ir = parseOracleTextToIR(text, "Valkyrie's Call");
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    const move = steps[0] as any;
    expect(move.kind).toBe('move_zone');
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldController).toEqual({ kind: 'owner_of_moved_cards' });
    expect(move.withCounters).toEqual({ '+1/+1': 1 });
    expect(move.battlefieldAddTypes).toEqual(['Angel']);
  });

  it('merges delayed return characteristic rewrites into the delayed effect text', () => {
    const text =
      "Whenever a creature you don't control dies, return it to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step. That creature is a black Zombie in addition to its other colors and types.";
    const ir = parseOracleTextToIR(text, 'Grave Betrayal');
    const delayed = ir.abilities[0].steps[0] as any;

    expect(delayed.kind).toBe('schedule_delayed_trigger');
    expect(delayed.effect).toContain('That creature is a black Zombie in addition to its other colors and types');

    const delayedIr = parseOracleTextToIR(delayed.effect, 'Grave Betrayal');
    const move = delayedIr.abilities[0].steps[0] as any;
    expect(move.kind).toBe('move_zone');
    expect(move.battlefieldAddTypes).toEqual(['Zombie']);
    expect(move.battlefieldAddColors).toEqual(['B']);
  });

  it('parses Sequence Engine as exile plus moved-card X token creation and plural counter follow-up', () => {
    const text =
      "Exile target creature card from a graveyard. Create X 2/2 black Zombie creature tokens, where X is that card's mana value. Put X +1/+1 counters on each of those Zombies.";
    const ir = parseOracleTextToIR(text, 'Sequence Engine');
    const steps = ir.abilities[0].steps as any[];

    expect(steps.map(step => step.kind)).toEqual(['move_zone', 'create_token', 'add_counter']);
    expect(steps[1]).toMatchObject({
      kind: 'create_token',
      amount: { kind: 'x' },
      token: '2/2 black Zombie',
    });
    expect(steps[2]).toMatchObject({
      kind: 'add_counter',
      amount: { kind: 'x' },
      counter: '+1/+1',
      target: { kind: 'raw', text: 'each of those Zombies' },
    });
  });

  it("merges Lim-Dul the Necromancer's conditional Zombie rewrite onto the returned creature", () => {
    const text =
      "Whenever a creature an opponent controls dies, you may pay {1}{B}. If you do, return that card to the battlefield under your control. If it's a creature, it's a Zombie in addition to its other creature types.";
    const ir = parseOracleTextToIR(text, 'Lim-Dul the Necromancer');
    const steps = ir.abilities[0].steps as any[];

    expect(steps[0].kind).toBe('pay_mana');
    expect(steps[1].kind).toBe('conditional');
    expect(steps[1].condition).toEqual({ kind: 'if', raw: 'you do' });
    expect(steps[1].steps).toHaveLength(1);
    expect(steps[1].steps[0].kind).toBe('move_zone');
    expect(steps[1].steps[0].battlefieldAddTypes).toEqual(['Zombie']);
    expect(steps[1].steps[0].battlefieldCharacteristicsCondition).toEqual({
      kind: 'if',
      raw: "it's a creature",
    });
  });

  it('parses mill clauses into IR steps', () => {
    const text = 'Each opponent mills two cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const mill = steps.find(s => s.kind === 'mill') as any;
    expect(mill).toBeTruthy();
    expect(mill.who).toEqual({ kind: 'each_opponent' });
    expect(mill.amount).toEqual({ kind: 'number', value: 2 });
  });

  it('parses Trepanation Blade reveal-until-land clause into mill unknown amount', () => {
    const text =
      'Whenever equipped creature attacks, defending player reveals cards from the top of their library until they reveal a land card. The creature gets +1/+0 until end of turn for each card revealed this way. That player puts the revealed cards into their graveyard.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'triggered')!;
    expect(ability).toBeTruthy();

    const mill = ability.steps.find(s => s.kind === 'mill') as any;
    expect(mill).toBeTruthy();
    expect(mill.who).toEqual({ kind: 'target_opponent' });
    expect(mill.amount).toEqual({ kind: 'unknown', raw: 'until they reveal a land card' });

    const pump = ability.steps.find(s => s.kind === 'modify_pt') as any;
    expect(pump).toBeTruthy();
    expect(pump.target).toEqual({ kind: 'equipped_creature' });
    expect(pump.power).toBe(1);
    expect(pump.toughness).toBe(0);
    expect(pump.duration).toBe('end_of_turn');
    expect(pump.scaler).toEqual({ kind: 'per_revealed_this_way' });
  });

  it('parses Giant Growth style target creature gets +3/+3 until end of turn into composable modify_pt', () => {
    const text = 'Target creature gets +3/+3 until end of turn.';
    const ir = parseOracleTextToIR(text, 'Giant Growth');
    const steps = ir.abilities[0].steps;

    const pump = steps.find(s => s.kind === 'modify_pt') as any;
    expect(pump).toBeTruthy();
    expect(pump.target).toEqual({ kind: 'raw', text: 'target creature' });
    expect(pump.power).toBe(3);
    expect(pump.toughness).toBe(3);
    expect(pump.duration).toBe('end_of_turn');
    expect(pump.scaler).toBeUndefined();
  });

  it('parses controller-qualified target creature text for composable modify_pt', () => {
    const text = 'Target creature you control gets +X/+0 until end of turn where X is the greatest toughness among creatures your opponents control.';
    const ir = parseOracleTextToIR(text, 'Test');
    const steps = ir.abilities[0].steps;

    const pump = steps.find(s => s.kind === 'modify_pt') as any;
    expect(pump).toBeTruthy();
    expect(pump.target).toEqual({ kind: 'raw', text: 'target creature you control' });
    expect(pump.powerUsesX).toBe(true);
    expect(pump.condition).toEqual({ kind: 'where', raw: 'X is the greatest toughness among creatures your opponents control' });
  });

  it('parses opponent-qualified target creature text for composable modify_pt', () => {
    const text = 'Target creature your opponents control gets +X/+0 until end of turn where X is the greatest power among creatures you control.';
    const ir = parseOracleTextToIR(text, 'Test');
    const steps = ir.abilities[0].steps;

    const pump = steps.find(s => s.kind === 'modify_pt') as any;
    expect(pump).toBeTruthy();
    expect(pump.target).toEqual({ kind: 'raw', text: 'target creature your opponents control' });
    expect(pump.powerUsesX).toBe(true);
    expect(pump.condition).toEqual({ kind: 'where', raw: 'X is the greatest power among creatures you control' });
  });

  it('parses singular-opponent target creature text for composable modify_pt', () => {
    const text = 'Target creature an opponent controls gets +X/+0 until end of turn where X is the greatest power among creatures you control.';
    const ir = parseOracleTextToIR(text, 'Test');
    const steps = ir.abilities[0].steps;

    const pump = steps.find(s => s.kind === 'modify_pt') as any;
    expect(pump).toBeTruthy();
    expect(pump.target).toEqual({ kind: 'raw', text: 'target creature an opponent controls' });
    expect(pump.powerUsesX).toBe(true);
    expect(pump.condition).toEqual({ kind: 'where', raw: 'X is the greatest power among creatures you control' });
  });

  it('parses unsupported for-each tails into unknown modify_pt scaler for future automation', () => {
    const text = 'Target creature gets +1/+1 until end of turn for each opponent you attacked with a creature this combat.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const pump = steps.find(s => s.kind === 'modify_pt') as any;
    expect(pump).toBeTruthy();
    expect(pump.target).toEqual({ kind: 'raw', text: 'target creature' });
    expect(pump.power).toBe(1);
    expect(pump.toughness).toBe(1);
    expect(pump.duration).toBe('end_of_turn');
    expect(pump.scaler).toEqual({ kind: 'unknown', raw: 'for each opponent you attacked with a creature this combat' });
  });

  it('parses leading if clause into a conditional modify_pt wrapper', () => {
    const text = 'If you control an artifact, target creature gets +2/+2 until end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const conditional = steps.find(s => s.kind === 'conditional') as any;
    expect(conditional).toBeTruthy();
    expect(conditional.condition).toEqual({ kind: 'if', raw: 'you control an artifact' });
    expect(conditional.steps).toEqual([
      expect.objectContaining({
        kind: 'modify_pt',
        target: { kind: 'raw', text: 'target creature' },
        power: 2,
        toughness: 2,
        duration: 'end_of_turn',
      }),
    ]);
  });

  it('parses trailing as long as clause into modify_pt condition metadata', () => {
    const text = 'Target creature gets +2/+2 until end of turn as long as you control an artifact.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const pump = steps.find(s => s.kind === 'modify_pt') as any;
    expect(pump).toBeTruthy();
    expect(pump.condition).toEqual({ kind: 'as_long_as', raw: 'you control an artifact' });
  });

  it('parses trailing where clause into modify_pt condition metadata', () => {
    const text = 'Target creature gets +2/+2 until end of turn where X is the number of artifacts you control.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const pump = steps.find(s => s.kind === 'modify_pt') as any;
    expect(pump).toBeTruthy();
    expect(pump.condition).toEqual({ kind: 'where', raw: 'X is the number of artifacts you control' });
  });

  it('parses X-based modify_pt components with where-clause definition', () => {
    const text = 'Target creature gets +X/+X until end of turn where X is the number of artifacts you control.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const pump = steps.find(s => s.kind === 'modify_pt') as any;
    expect(pump).toBeTruthy();
    expect(pump.power).toBe(1);
    expect(pump.toughness).toBe(1);
    expect(pump.powerUsesX).toBe(true);
    expect(pump.toughnessUsesX).toBe(true);
    expect(pump.condition).toEqual({ kind: 'where', raw: 'X is the number of artifacts you control' });
  });

  it('parses Undercity Informer activated reveal-until-land clause into mill unknown amount', () => {
    const text =
      '{1}, Sacrifice a creature: Target player reveals cards from the top of their library until they reveal a land card, then puts those cards into their graveyard.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'activated')!;
    expect(ability).toBeTruthy();

    const mill = ability.steps.find(s => s.kind === 'mill') as any;
    expect(mill).toBeTruthy();
    expect(mill.who).toEqual({ kind: 'target_player' });
    expect(mill.amount).toEqual({ kind: 'unknown', raw: 'until they reveal a land card' });
  });

  it('parses scry and surveil clauses into IR steps', () => {
    const text = 'Scry 2. Then surveil 1.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const scry = steps.find(s => s.kind === 'scry') as any;
    expect(scry).toBeTruthy();
    expect(scry.who).toEqual({ kind: 'you' });
    expect(scry.amount).toEqual({ kind: 'number', value: 2 });

    const surveil = steps.find(s => s.kind === 'surveil') as any;
    expect(surveil).toBeTruthy();
    expect(surveil.who).toEqual({ kind: 'you' });
    expect(surveil.amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses deterministic add mana clauses into IR steps', () => {
    const text = 'Add {R}{R}{R}.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const addMana = steps.find(s => s.kind === 'add_mana') as any;
    expect(addMana).toBeTruthy();
    expect(addMana.who).toEqual({ kind: 'you' });
    expect(addMana.mana).toBe('{R}{R}{R}');
  });

  it('parses standalone exile-top (no permission clause) into exile_top step', () => {
    const text = 'Exile the top card of your library.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const step = steps.find(s => s.kind === 'exile_top') as any;
    expect(step).toBeTruthy();
    expect(step.who).toEqual({ kind: 'you' });
    expect(step.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses standalone exile-top for each player's library", () => {
    const text = "Exile the top two cards of each player's library.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const step = steps.find(s => s.kind === 'exile_top') as any;
    expect(step).toBeTruthy();
    expect(step.who).toEqual({ kind: 'each_player' });
    expect(step.amount).toEqual({ kind: 'number', value: 2 });
  });

  it('parses exile_top from triggered ability effect text', () => {
    const text = "Whenever Etali attacks, exile the top card of each player's library.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];
    expect(ability.type).toBe('triggered');
    expect(ability.triggerCondition).toBe('Etali attacks');

    const step = ability.steps.find(s => s.kind === 'exile_top') as any;
    expect(step).toBeTruthy();
    expect(step.who).toEqual({ kind: 'each_player' });
    expect(step.amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses exile_top from replacement effect (instead pattern)', () => {
    const text = 'If you would draw a card, exile the top two cards of your library instead.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];
    expect(ability.type).toBe('replacement');

    const step = ability.steps.find(s => s.kind === 'exile_top') as any;
    expect(step).toBeTruthy();
    expect(step.who).toEqual({ kind: 'you' });
    expect(step.amount).toEqual({ kind: 'number', value: 2 });
  });

  it('parses impulse exile-top with this-turn permission', () => {
    const text = 'Exile the top card of your library. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('upgrades exile_top into impulse when permission is conditional "If you don\'t, you may play ..."', () => {
    const text = "Exile the top card of your library. If you don't, you may play that card this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('upgrades exile_top into impulse for Spark of Creativity-style conditional permission', () => {
    const text =
      "Choose target creature. Exile the top card of your library. You may have Spark of Creativity deal damage to that creature equal to the exiled card's mana value. If you don't, you may play that card until end of turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('upgrades exile_top into impulse for Synth Eradicator-style energy-or-play branch', () => {
    const text =
      'Haste\nWhenever this creature attacks, exile the top card of your library. You may get {E}{E} (two energy counters). If you don\'t, you may play that card this turn.';
    const ir = parseOracleTextToIR(text, 'Synth Eradicator');
    const ability = ir.abilities.find(a => a.type === 'triggered')!;
    expect(ability).toBeTruthy();

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('upgrades exile_top into impulse for The Great Juggernaut-style free-play rider', () => {
    const text =
      'Whenever The Great Juggernaut attacks, shuffle your library then exile the top card of your library. You may play that card without paying its mana cost this turn.';
    const ir = parseOracleTextToIR(text, 'The Great Juggernaut');
    const ability = ir.abilities.find(a => a.type === 'triggered')!;
    expect(ability).toBeTruthy();

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('upgrades exile_top into impulse for Bruse Tarl-style otherwise-cast permission', () => {
    const text =
      "Oxen you control have double strike.\nWhenever Bruse Tarl enters or attacks, exile the top card of your library. If it's a land card, create a 2/2 white Ox creature token. Otherwise, you may cast it until the end of your next turn.";
    const ir = parseOracleTextToIR(text, 'Bruse Tarl, Roving Rancher');
    const ability = ir.abilities.find(a => a.type === 'triggered')!;
    expect(ability).toBeTruthy();

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('upgrades optional exile_top into impulse and preserves optional metadata', () => {
    const text = 'You may exile the top card of your library. Until end of turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
    expect(impulse.optional).toBe(true);
  });

  it('parses impulse exile-top with until-you-exile-another duration', () => {
    const text =
      'Whenever you cast a spell with mana value 4 or greater, you may exile the top card of your library. If you do, you may play that card until you exile another card with this creature.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('until_exile_another');
    expect(impulse.optional).toBe(true);
  });

  it('parses impulse exile-top with until-you-exile-another duration (artifact variant)', () => {
    const text = '{T}, Pay {E}{E}: Exile the top card of your library. You may play it until you exile another card with this artifact.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('until_exile_another');
  });

  it('parses impulse exile-top with implicit during-resolution permission (plural them)', () => {
    const text = 'Exile the top two cards of your library. You may play them.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with color-restricted spell permission (cast red spells from among them)', () => {
    const text = 'Exile the top five cards of your library. You may cast red spells from among them this turn.';
    const ir = parseOracleTextToIR(text, 'Chandra, Dressed to Kill');
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 5 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'color', color: 'R' });
  });

  it('parses impulse exile-top with leading until-end-of-turn and plural restricted-spells permission', () => {
    const text =
      'Whenever Narset attacks, exile the top four cards of your library. Until end of turn, you may cast noncreature spells from among those cards without paying their mana costs.';
    const ir = parseOracleTextToIR(text, 'Narset, Enlightened Master');
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 4 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with next-turn duration and plural restricted-spells from among the exiled cards', () => {
    const text =
      'Exile the top two cards of your library. Until the end of your next turn, you may cast creature spells from among the exiled cards.';
    const ir = parseOracleTextToIR(text, 'Eager Flameguide');
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with "instant and sorcery spells" restriction (normalized to instant-or-sorcery)', () => {
    const text =
      'Exile the top eight cards of your library. You may cast instant and sorcery spells from among them this turn without paying their mana costs.';
    const ir = parseOracleTextToIR(text, 'Ral, Leyline Prodigy');
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 8 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with control-source duration', () => {
    const text =
      'Whenever Lightning deals combat damage to a player, exile the top card of your library. You may play that card for as long as you control Lightning.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('as_long_as_control_source');
  });

  it('parses impulse exile-top with until-end-of-combat-on-next-turn duration (Brazen Cannonade-style)', () => {
    const text =
      'Whenever a creature you control deals combat damage to a player, exile the top card of your library. Until end of combat on your next turn, you may play that card.';
    const ir = parseOracleTextToIR(text, 'Brazen Cannonade');
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('until_end_of_combat_on_next_turn');
  });

  it('parses impulse exile-top for each player with each-player permission window (Rocco, Street Chef)', () => {
    const text =
      'At the beginning of your end step, each player exiles the top card of their library. Until your next end step, each player may play the card they exiled this way.';
    const ir = parseOracleTextToIR(text, 'Rocco, Street Chef');
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('until_next_end_step');
  });

  it("parses impulse exile-from-top with 'their next turn' duration (corpus)", () => {
    const text =
      "Whenever a creature is dealt damage, its controller may exile that many cards from the top of their library. They may play those cards until the end of their next turn.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'unknown', raw: 'that many' });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('until_end_of_next_turn');
  });

  it("parses impulse exile-from-top when subject is 'its owner'", () => {
    const text =
      "Whenever a creature is dealt damage, its owner may exile that many cards from the top of their library. They may play those cards until the end of their next turn.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'unknown', raw: 'that many' });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('until_end_of_next_turn');
  });

  it("parses impulse exile-from-top when subject is 'that permanent's controller'", () => {
    const text =
      "Whenever a creature is dealt damage, that permanent's controller may exile a card from the top of their library. They may play that card this turn.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it("parses impulse exile-from-top when subject is 'that permanent's owner'", () => {
    const text =
      "Whenever a creature is dealt damage, that permanent's owner may exile a card from the top of their library. They may play that card this turn.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it("parses impulse exile-from-top when subject is 'that creature's owner'", () => {
    const text =
      "Whenever a creature is dealt damage, that creature's owner may exile a card from the top of their library. They may play that card this turn.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it("parses impulse exile-from-top when subject is 'that card's controller'", () => {
    const text =
      "Whenever a creature is dealt damage, that card's controller may exile a card from the top of their library. They may play that card this turn.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it("parses impulse exile-from-top when subject is 'that card's owner'", () => {
    const text =
      "Whenever a creature is dealt damage, that card's owner may exile a card from the top of their library. They may play that card this turn.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it("parses impulse exile-from-top when subject is 'that artifact's controller'", () => {
    const text =
      "Whenever a creature is dealt damage, that artifact's controller may exile a card from the top of their library. They may play that card this turn.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it("parses impulse exile-from-top when subject is 'defending player'", () => {
    const text =
      'Whenever a creature is dealt damage, defending player may exile a card from the top of their library. They may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it("parses impulse exile-until when subject is 'the defending player'", () => {
    const text =
      'Whenever this creature deals combat damage to a player, the defending player exiles cards from the top of their library until they exile a nonland card. You may cast that card this turn.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'unknown', raw: 'until they exile a nonland card' });
    expect(impulse.permission).toBe('cast');
    expect(impulse.duration).toBe('this_turn');
  });

  it("parses impulse exile-top from 'the defending player\'s library' source wording", () => {
    const text =
      "Exile the top card of the defending player's library. You may play that card this turn.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it("parses impulse exile-top when variable amount uses 'its owner's library' source wording", () => {
    const text =
      "Whenever a creature is dealt damage, exile that many cards from the top of its owner's library. You may play those cards this turn.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];

    expect(ability.type).toBe('triggered');
    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'unknown', raw: 'that many' });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it('parses impulse exile-top with remains-exiled duration (suffix form)', () => {
    const text = "Exile the top card of each opponent's library. You may play those cards for as long as they remain exiled.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
  });

  it('upgrades exile_top into impulse for suffix remains-exiled permission (each opponent)', () => {
    const text =
      "At the beginning of your end step, exile the top card of each opponent's library. You may play those cards for as long as they remain exiled. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'triggered')!;
    expect(ability).toBeTruthy();

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with until-end-of-turn (suffix form) permission', () => {
    const text = 'Exile the top three cards of your library. You may play those cards until end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with this-turn permission referencing the exiled card', () => {
    const text = 'Exile the top card of your library. You may play the exiled card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission is granted to "they" (target player)', () => {
    const text = 'Target player exiles the top card of their library. They may play it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-until + "this Saga remains on the battlefield" duration', () => {
    const text =
      'Exile cards from the top of your library until you exile a legendary card. You may play that card for as long as this Saga remains on the battlefield.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities.flatMap(a => a.steps);

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'unknown', raw: 'until you exile a legendary card' });
    expect(impulse.duration).toBe('as_long_as_control_source');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission is granted to "that player" (target player)', () => {
    const text = 'Target player exiles the top card of their library. That player may cast it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission is granted to "that opponent" (target opponent)', () => {
    const text = 'Target opponent exiles the top card of their library. That opponent may play it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission is granted to "its owner" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may cast it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" for "its owner" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner can cast it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission is granted to "its owner" for plural exile (target player)', () => {
    const text = 'Target player exiles the top two cards of their library. Its owner may cast them this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission references spells they exiled this way (target player)', () => {
    const text =
      'Target player exiles the top two cards of their library. Its owner may cast spells they exiled this way this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission references the spell they exiled this way (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its owner may cast the spell they exiled this way this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "until the end of this turn" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may cast it until the end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "through end of this turn" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may cast it through end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "during their next turn" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may cast it during their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "until the end of their next turn" (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its owner may cast it until the end of their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "until the end of their next turn" (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its owner can cast it until the end of their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "until the beginning of their next upkeep" (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its owner may cast it until the beginning of their next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "until your next end step" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may cast it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "until your next end step" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner can cast it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "through their next turn" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may cast it through their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "through their next turn" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner can cast it through their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "through your next upkeep" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may cast it through your next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "through your next end step" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may cast it through your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "through your next end step" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner can cast it through your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "until end of combat on their next turn" (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its owner may cast it until end of combat on their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_combat_on_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses leading "until your next turn" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next turn, its owner may cast it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses leading "until your next turn" with owner can-cast permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next turn, its owner can cast it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses leading "until your next turn" with play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next turn, its owner may play it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses leading "until your next turn" with owner can-play permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next turn, its owner can play it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "during their next turn" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may play it during their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "during their next turn" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner can play it during their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "until the end of their next turn" with owner play-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its owner may play it until the end of their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "until the end of their next turn" with owner play-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its owner can play it until the end of their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "through your next upkeep" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may play it through your next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "through your next upkeep" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner can play it through your next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "through your next end step" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may play it through your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "through your next end step" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner can play it through your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "through their next turn" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may play it through their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "through their next turn" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner can play it through their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "until the beginning of their next upkeep" with owner play-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its owner may play it until the beginning of their next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "until the beginning of their next upkeep" with owner play-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its owner can play it until the beginning of their next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "until your next end step" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner may play it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "until your next end step" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its owner can play it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses leading "until your next end step" with owner play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next end step, its owner may play it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses leading "until your next turn" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next turn, its controller may play it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses leading "until your next turn" with controller can-play permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next turn, its controller can play it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses leading "until your next end step" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next end step, its controller may play it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses leading "until your next turn" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next turn, its controller may cast it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses leading "until your next turn" with controller can-cast permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next turn, its controller can cast it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses leading "until your next end step" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next end step, its controller may cast it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "through your next end step" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may play it through your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "during their next turn" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may play it during their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "during their next turn" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can play it during their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "until the end of their next turn" with controller play-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its controller may play it until the end of their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "until the end of their next turn" with controller play-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its controller can play it until the end of their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "through your next upkeep" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may play it through your next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "through your next upkeep" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can play it through your next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "through their next turn" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may play it through their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "through their next turn" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can play it through their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "until the beginning of their next upkeep" with controller play-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its controller may play it until the beginning of their next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "until the beginning of their next upkeep" with controller play-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its controller can play it until the beginning of their next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "until your next end step" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may play it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can play it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "can" + "through your next end step" with controller play-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can play it through your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission uses "through your next upkeep" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may cast it through your next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "through your next upkeep" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can cast it through your next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "this turn" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may cast it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "until the end of this turn" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may cast it until the end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "through end of this turn" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may cast it through end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "until your next end step" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may cast it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "until your next end step" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can cast it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "through your next end step" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may cast it through your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "through your next end step" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can cast it through your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "during their next turn" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may cast it during their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "during their next turn" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can cast it during their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "through their next turn" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may cast it through their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "through their next turn" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can cast it through their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "until the end of their next turn" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller may cast it until the end of their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "until the end of their next turn" with controller cast-permission (target player)', () => {
    const text = 'Target player exiles the top card of their library. Its controller can cast it until the end of their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "until the beginning of their next upkeep" with controller cast-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its controller may cast it until the beginning of their next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "can" + "until the beginning of their next upkeep" with controller cast-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its controller can cast it until the beginning of their next upkeep.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses "until end of combat on their next turn" with controller cast-permission (target player)', () => {
    const text =
      'Target player exiles the top card of their library. Its controller may cast it until end of combat on their next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_combat_on_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission uses leading "until your next end step" (target player)', () => {
    const text = 'Target player exiles the top card of their library. Until your next end step, its owner may cast it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('cast');
  });

  it('upgrades target-opponent exile_top into impulse when deterministic text intervenes', () => {
    const text =
      'Target opponent exiles the top card of their library. You gain 2 life. Until end of turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('upgrades face-down look+exile into impulse when deterministic text intervenes', () => {
    const text =
      "Look at the top card of target opponent's library, then exile it face down. You gain 2 life. Until end of turn, you may play that card.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with cast-that-spell permission', () => {
    const text = 'Exile the top card of your library. You may cast that spell this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when the exiled card is castable with no explicit duration', () => {
    const text = 'Exile the top card of your library. You may cast that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with an inline X definition clause', () => {
    const text =
      'Exile the top X cards of your library, where X is one plus the mana value of the sacrificed artifact. You may play those cards this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'x' });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with an intervening look clause', () => {
    const text =
      'Exile the top card of your library. You may look at that card for as long as it remains exiled. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with a look-any-time clause intervening', () => {
    const text = 'Exile the top card of your library. You may look at that card any time. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with a parenthetical look-any-time reminder intervening', () => {
    const text = 'Exile the top card of your library. (You may look at it any time.) You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it("parses impulse exile-top from Breeches (AtomicCards) with contextual each_of_those_opponents selector", () => {
    const text =
      "Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with during-resolution cast-from-among (Etali-style)', () => {
    const text =
      "Whenever Etali attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities[0];
    expect(ability.type).toBe('triggered');
    expect(ability.triggerCondition).toBe('Etali attacks');

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with look + spend-mana reminders intervening', () => {
    const text =
      'Exile the top card of your library. You may look at that card any time. You may spend mana as though it were mana of any color to cast it. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with look + spend-mana + choose-one intervening', () => {
    const text =
      'Exile the top two cards of your library. You may look at those cards any time. You may spend mana as though it were mana of any color to cast them. Choose one of them. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when a deterministic clause intervenes before the permission window', () => {
    const text =
      'Exile the top card of your library. You gain life equal to that card’s mana value. Until end of turn, you may cast that card and you may spend mana as though it were mana of any color to cast it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');

    const hasInterveningClause = steps.some(s => String((s as any).raw || '').toLowerCase().includes('gain life'));
    expect(hasInterveningClause).toBe(true);
  });

  it("parses impulse exile-top for each player's library", () => {
    const text = "Exile the top card of each player's library. You may play those cards this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with mana-spend reminder suffix', () => {
    const text =
      "Exile the top card of each player's library. Until the end of your next turn, you may play those cards, and mana of any type can be spent to cast those spells.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it("parses impulse exile-top for each player's library referencing the exiled cards", () => {
    const text = "Exile the top card of each player's library. You may play the exiled cards this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it("parses impulse exile-top for each player's library referencing the exiled spells", () => {
    const text = "Exile the top card of each player's library. You may cast the exiled spells this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-top for each opponent's library", () => {
    const text = "Exile the top two cards of each opponent's library. Until end of turn, you may cast them.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-top when a target opponent exiles the top card of their library", () => {
    const text = "Target opponent exiles the top card of their library. Until end of turn, you may play that card.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with intervening "Choose one of them" clause', () => {
    const text =
      'Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "If you do," prefix and then-split choose clause', () => {
    const text = 'If you do, exile the top two cards of your library, then choose one of them. You may play that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top for target opponent library with intervening choose clause', () => {
    const text =
      "Exile the top three cards of target opponent's library. Choose one of them. Until the end of your next turn, you may play that card.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission', () => {
    const text = 'Exile the top card of your library. Until the end of your next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (missing "the")', () => {
    const text = 'Exile the top card of your library. Until end of your next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (no "your")', () => {
    const text = 'Exile the top card of your library. Until the end of next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (end of the next turn)', () => {
    const text = 'Exile the top card of your library. Until end of the next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with leading until-end-of-turn for those cards', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with leading until-the-end-of-turn for those cards', () => {
    const text = 'Exile the top two cards of your library. Until the end of turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with leading until-end-of-your-next-turn for those cards', () => {
    const text = 'Exile the top two cards of your library. Until the end of your next turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (trailing until, missing "the")', () => {
    const text = 'Exile the top card of your library. You may play that card until end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (trailing until, no "your")', () => {
    const text = 'Exile the top card of your library. You may play that card until end of next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (trailing until, can-alias, missing "the")', () => {
    const text = 'Exile the top card of your library. You can play that card until end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (trailing until, can-alias, end of the next turn)', () => {
    const text = 'Exile the top card of your library. You can play that card until end of the next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-turn permission (trailing until, end of the next turn)', () => {
    const text = 'Exile the top card of your library. You may play that card until end of the next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with until-your-next-turn permission', () => {
    const text = 'Exile the top two cards of your library. Until your next turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-end-step permission (leading)', () => {
    const text = 'Exile the top card of your library. Until your next end step, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-end-step permission (trailing)', () => {
    const text = 'Exile the top card of your library. You may play it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-end-step permission (trailing can-alias)', () => {
    const text = 'Exile the top card of your library. You can play it until your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with next-end-step permission (through trailing can-alias)', () => {
    const text = 'Exile the top card of your library. You can play it through your next end step.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top in Saga chapter lines (roman numeral prefix)', () => {
    // Real-world Saga formatting uses chapter markers like "I —".
    // Our normalizer converts em-dash to '-', so the clause becomes "I - Exile ...".
    const text =
      '(As this Saga enters and after your draw step, add a lore counter.)\n' +
      'I — Exile the top three cards of your library. Until the end of your next turn, you may play those cards.\n' +
      'II — Add one mana of any color.';

    const ir = parseOracleTextToIR(text, 'The Legend of Roku');
    const steps = ir.abilities.flatMap((a) => a.steps);
    const impulse = steps.find((s) => s.kind === 'impulse_exile_top') as any;

    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top in modal options with a named mode label (corpus-style)', () => {
    // Corpus-style modal formatting:
    // "Choose one —\n• <Mode Name> — Exile ..."
    const text =
      'Choose one —\n' +
      '• Break Their Chains — Destroy target artifact.\n' +
      "• Interrogate Them — Exile the top three cards of target opponent's library. Choose one of them. Until the end of your next turn, you may play that card, and you may spend mana as though it were mana of any color to cast it.";

    const ir = parseOracleTextToIR(text);
    const allSteps = ir.abilities.flatMap((a) => a.steps);
    // impulse_exile_top is nested inside the choose_mode step's modes
    const chooseModeStep = allSteps.find((s) => s.kind === 'choose_mode') as any;
    expect(chooseModeStep).toBeTruthy();
    const impulse = chooseModeStep.modes.flatMap((m: any) => m.steps).find((s: any) => s.kind === 'impulse_exile_top');

    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('preserves choose_mode labels that include lowercase connector words', () => {
    const text =
      'Choose up to three -\n' +
      '\u2022 Sell Contraband - You lose 1 life. Create a Treasure token.\n' +
      '\u2022 Buy Information - You lose 2 life. Draw a card.\n' +
      '\u2022 Hire a Mercenary - You lose 3 life. Create a 3/2 colorless Shapeshifter creature token with changeling.';

    const ir = parseOracleTextToIR(text);
    const chooseModeStep = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'choose_mode') as any;

    expect(chooseModeStep).toBeTruthy();
    expect(chooseModeStep.modes.map((mode: any) => mode.label)).toEqual([
      'Sell Contraband',
      'Buy Information',
      'Hire a Mercenary',
    ]);
  });

  it('parses impulse exile-top with an ability-word prefix + at-beginning wrapper (Prosper-style)', () => {
    const text =
      'Deathtouch\n' +
      'Mystic Arcanum — At the beginning of your end step, exile the top card of your library. Until the end of your next turn, you may play that card.\n' +
      'Pact Boon — Whenever you play a card from exile, create a Treasure token.';

    const ir = parseOracleTextToIR(text, 'Prosper, Tome-Bound');
    const steps = ir.abilities.flatMap((a) => a.steps);
    const impulse = steps.find((s) => s.kind === 'impulse_exile_top') as any;

    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse with variable-amount exile "cards equal to <expr>" from top of target player library (corpus)', () => {
    // Corpus example: Rakdos, the Muscle (template as of 2026-02)
    const text =
      "Whenever you sacrifice another creature, exile cards equal to its mana value from the top of target player's library. Until your next end step, you may play those cards, and mana of any type can be spent to cast those spells.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount.kind).toBe('unknown');
    expect(String(impulse.amount.raw || '')).toMatch(/cards equal to/i);
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with in-clause mana-spend reminder', () => {
    const text =
      'Exile the top card of your library. Until end of turn, you may play that card and you may spend mana as though it were mana of any color to cast it.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with cast-spells-from-among-them permission', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may cast spells from among them.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with "instant and/or sorcery" restriction (Kylox-style any-number-of)', () => {
    const text =
      'Whenever Kylox attacks, sacrifice any number of other creatures, then exile the top X cards of your library, where X is their total power. You may cast any number of instant and/or sorcery spells from among the exiled cards without paying their mana costs.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'x' });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with "cast up to N" + mana-value restriction (Collected Conjuring)', () => {
    const text =
      "Exile the top six cards of your library. You may cast up to two sorcery spells with mana value 3 or less from among them without paying their mana costs. Put the exiled cards not cast this way on the bottom of your library in a random order.";
    const ir = parseOracleTextToIR(text, 'Collected Conjuring');
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 6 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with plural mana-value restriction (Epic Experiment)', () => {
    const text =
      "Exile the top X cards of your library. You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs. Then put all cards exiled this way that weren't cast into your graveyard.";
    const ir = parseOracleTextToIR(text, 'Epic Experiment');
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'x' });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with singular mana-value restriction (Muse Vortex)', () => {
    const text =
      "Exile the top X cards of your library. You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost. Then put the exiled instant and sorcery cards that weren't cast this way into your hand and the rest on the bottom of your library in a random order.";
    const ir = parseOracleTextToIR(text, 'Muse Vortex');
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'x' });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-a-spell-from-among-those-cards until-end-of-turn permission', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may cast a spell from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-a-spell-from-among-those-cards until-end-of-your-next-turn permission', () => {
    const text =
      'Exile the top two cards of your library. Until the end of your next turn, you may cast a spell from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with play-lands-and-cast-spells-from-among-those-cards permission', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may play lands and cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with play-lands-and-cast-spells from among those cards until end of your next turn', () => {
    const text =
      'Exile the top two cards of your library. Until the end of your next turn, you may play lands and cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with trailing play-lands-and-cast-spells from among those cards until end of your next turn', () => {
    const text =
      'Exile the top two cards of your library. You may play lands and cast spells from among those cards until end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with cast-spells-from-among-those-exiled-cards permission', () => {
    const text =
      "Exile the top card of each player's library. Until end of turn, you may cast spells from among those exiled cards.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission says cast spells from among the exiled cards', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may cast spells from among the exiled cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission says cast spells from among the cards exiled this way', () => {
    const text = 'Exile the top two cards of your library. Until end of turn, you may cast spells from among the cards exiled this way.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission says cast spells from among those cards', () => {
    const text = 'Exile the top two cards of your library. Until the end of turn, you may cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when exile clause uses "that many cards from the top" wording (Dream Pillager template)', () => {
    const text =
      'Whenever this creature deals combat damage to a player, exile that many cards from the top of your library. Until end of turn, you may cast spells from among those exiled cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'unknown', raw: 'that many' });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-top for 'exiles cards from the top ... until ... You may cast that card' (corpus: Chaos Wand)", () => {
    const text =
      "{4}, {T}: Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren't cast this way on the bottom of that library in a random order.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'activated')!;
    expect(ability).toBeTruthy();

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'unknown', raw: 'until they exile an instant or sorcery card' });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-until with intervening 'then shuffles the rest' rider (corpus: Wand of Wonder)", () => {
    const text =
      '{4}, {T}: Roll a d20. Each opponent exiles cards from the top of their library until they exile an instant or sorcery card, then shuffles the rest into their library. You may cast up to X instant and/or sorcery spells from among cards exiled this way without paying their mana costs.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'activated')!;
    expect(ability).toBeTruthy();

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('instant or sorcery');
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-until + 'you may cast cards exiled this way' permission (corpus: Dream Harvest)", () => {
    const text =
      'Each opponent exiles cards from the top of their library until they have exiled cards with total mana value 5 or greater this way. Until end of turn, you may cast cards exiled this way without paying their mana costs.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('total mana value 5 or greater');
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-until when subject is 'each of those opponents'", () => {
    const text =
      'Each of those opponents exiles cards from the top of their library until they exile a nonland card. You may cast that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('nonland');
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-until when subject is 'those opponents'", () => {
    const text =
      'Those opponents exile cards from the top of their library until they exile a nonland card. You may cast that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('nonland');
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-until when subject is 'all of those opponents'", () => {
    const text =
      'All of those opponents exile cards from the top of their library until they exile a nonland card. You may cast that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('nonland');
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-until when subject is 'all those opponents'", () => {
    const text =
      'All those opponents exile cards from the top of their library until they exile a nonland card. You may cast that card this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('nonland');
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-until + 'cast that card by paying life' permission (corpus: Bismuth Mindrender)", () => {
    const text =
      "Whenever this creature deals combat damage to a player, that player exiles cards from the top of their library until they exile a nonland card. You may cast that card by paying life equal to the spell's mana value rather than paying its mana cost.";
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'triggered')!;
    expect(ability).toBeTruthy();

    const impulse = ability.steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('nonland');
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-until + third-person permission with implied subject (corpus: Tibalt's Trickery)", () => {
    const text =
      "Counter target spell. Choose 1, 2, or 3 at random. Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card with a different name than that spell. They may cast that card without paying its mana cost. Then they put the exiled cards on the bottom of their library in a random order.";
    const ir = parseOracleTextToIR(text);

    const steps = ir.abilities.flatMap(a => a.steps);
    expect(steps.map(s => s.kind)).toContain('impulse_exile_top');

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('different name');
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-until when subject is "its controller" (corpus: Transforming Flourish)', () => {
    const text =
      "Destroy target artifact or creature you don't control. If that permanent is destroyed this way, its controller exiles cards from the top of their library until they exile a nonland card, then they may cast that card without paying its mana cost.";
    const ir = parseOracleTextToIR(text);

    const steps = ir.abilities.flatMap(a => a.steps);
    expect(steps.map(s => s.kind)).toContain('impulse_exile_top');

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('nonland');
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-until when a player exiles a spell then exiles from top (corpus: Possibility Storm)", () => {
    const text =
      'Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with this enchantment on the bottom of their library in a random order.';
    const ir = parseOracleTextToIR(text);

    const steps = ir.abilities.flatMap(a => a.steps);
    expect(steps.map(s => s.kind)).toContain('impulse_exile_top');

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('shares a card type');
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it("parses impulse exile-top when exile clause uses 'its owner's library' wording (corpus: Dead Man's Chest)", () => {
    const text =
      "When enchanted creature dies, exile cards equal to its power from the top of its owner's library. You may cast spells from among those cards for as long as they remain exiled, and mana of any type can be spent to cast them.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'unknown', raw: 'cards equal to its power' });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when permission says cast spells from among those cards exiled this way', () => {
    const text =
      'Exile the top two cards of your library. Until end of turn, you may cast spells from among those cards exiled this way.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-spells-from-among-them this-turn permission', () => {
    const text = 'Exile the top two cards of your library. You may cast spells from among them this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-a-spell-from-among-them this-turn permission', () => {
    const text = 'Exile the top two cards of your library. You may cast a spell from among them this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-spells-from-among-those-exiled-cards this-turn permission', () => {
    const text =
      'Exile the top card of your library. You may cast spells from among those exiled cards this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-spells-from-among-them until end of turn permission', () => {
    const text = 'Exile the top two cards of your library. You may cast spells from among them until end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with cast-spells-from-among-those-exiled-cards until end of turn permission', () => {
    const text =
      'Exile the top card of your library. You may cast spells from among those exiled cards until the end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with in-clause spend-mana reminder after play permission', () => {
    const text =
      "Exile the top card of each player's library. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('upgrades each-player exile-top into impulse for "during each player\'s turn" exiled-with permission (corpus)', () => {
    const text =
      "When this enchantment enters and whenever an opponent loses the game, exile the top card of each player's library. During each player's turn, that player may play a land or cast a spell from among cards exiled with this enchantment, and they may spend mana as though it were mana of any color to cast that spell.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('as_long_as_control_source');
  });

  it('upgrades upkeep exile-top into impulse for "play lands and cast spells from among cards exiled with this" (corpus)', () => {
    const text =
      'At the beginning of your upkeep, exile the top card of your library. '
      + "During your turn, if an opponent lost life this turn, you may play lands and cast spells from among cards exiled with this enchantment.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities.flatMap(a => a.steps);

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('as_long_as_control_source');
  });

  it('parses impulse exile-top with each-player next-end-step permission', () => {
    const text =
      'Each player exiles the top card of their library. Until your next end step, each player may play the card they exiled this way.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_end_step');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with each-opponent subject-order clause', () => {
    const text =
      'Each opponent exiles the top two cards of their library. Until end of turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when among-clause restricts to an artifact spell (this turn)', () => {
    const text =
      'Exile the top five cards of your library. You may cast an artifact spell from among them this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 5 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause restricts to instant or sorcery (until end of next turn)', () => {
    const text =
      'Exile the top five cards of your library. Until the end of your next turn, you may cast an instant or sorcery spell from among those exiled cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 5 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with until-the-beginning-of-your-next-upkeep duration', () => {
    const text = 'Exile the top card of your library. Until the beginning of your next upkeep, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_upkeep');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with immediate cast permission and follow-up if-you-dont clause (Chandra-style)', () => {
    const text = "Exile the top card of your library. You may cast that card. If you don't, it deals 2 damage to each opponent.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with immediate cast-it permission (no explicit duration)', () => {
    const text = "Exile the top card of your library. You may cast it. If you don't, create a Treasure token.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with immediate cast-it without-paying-mana-cost permission plus trailing if restriction', () => {
    const text =
      "Exile the top card of your library. You may cast it without paying its mana cost if it's a spell with mana value 2 or less. If you don't, put it into your graveyard.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with up-to-two limit in permission clause', () => {
    const text =
      'Exile the top three cards of your library. You may play up to two of those cards until the end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with one-of limit in permission clause', () => {
    const text = 'Exile the top two cards of your library. You may play one of those cards this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with one-of limit in cast permission clause', () => {
    const text = 'Exile the top two cards of your library. You may cast one of those cards this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with "you may play them until the end of your next turn" wording', () => {
    const text = 'Exile the top card of your library. You may play them until the end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of your next turn, you may play them" wording', () => {
    const text = 'Exile the top two cards of your library. Until the end of your next turn, you may play them.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "you may play those cards this turn" wording', () => {
    const text = 'Exile the top two cards of your library. You may play those cards this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "you may play it this turn" wording', () => {
    const text = 'Exile the top card of your library. You may play it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "you may play them this turn" wording', () => {
    const text = 'Exile the top three cards of your library. You may play them this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "you may play them until end of turn" wording', () => {
    const text = 'Exile the top two cards of your library. You may play them until end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until your next turn, you may play those cards" wording', () => {
    const text = 'Exile the top card of each player\'s library. Until your next turn, you may play those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "you may cast it this turn" wording', () => {
    const text = 'Exile the top card of your library. You may cast it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with "you can cast it this turn" wording', () => {
    const text = 'Exile the top card of your library. You can cast it this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with "until the end of your next turn, you may cast that card" wording', () => {
    const text = 'Exile the top card of your library. Until the end of your next turn, you may cast that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with next-turn cast + mana-rider wording', () => {
    const text =
      'Exile the top card of your library. Until the end of your next turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top referencing cards exiled this way', () => {
    const text = 'Exile the top card of your library. You may play cards exiled this way until the end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top referencing the card exiled this way', () => {
    const text = 'Exile the top card of your library. You may play the card exiled this way until the end of your next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with a without-paying-mana-cost suffix', () => {
    const text = 'Exile the top card of your library. You may cast it this turn without paying its mana cost.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with without-paying-that-spell\'s-mana-cost suffix', () => {
    const text = "Exile the top card of your library. You may cast that spell this turn without paying that spell's mana cost.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with without-paying-that-spell’s-mana-cost suffix (curly apostrophe)', () => {
    const text = 'Exile the top card of your library. You may cast that spell this turn without paying that spell’s mana cost.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with without-paying-those-spells\'-mana-costs suffix', () => {
    const text = "Exile the top two cards of your library. You may cast those spells this turn without paying those spells' mana costs.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause says until the end of this turn', () => {
    const text = 'Exile the top two cards of your library. You may cast spells from among those cards until the end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause is leading until the end of this turn', () => {
    const text = 'Exile the top two cards of your library. Until the end of this turn, you may cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause says play lands and cast spells until the end of this turn', () => {
    const text =
      'Exile the top two cards of your library. You may play lands and cast spells from among those cards until the end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when among-clause is leading until the end of this turn for play lands and cast spells', () => {
    const text =
      'Exile the top two cards of your library. Until the end of this turn, you may play lands and cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when among-clause says cast spells through end of turn', () => {
    const text = 'Exile the top two cards of your library. You may cast spells from among those cards through end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause is leading through the end of this turn (cast spells)', () => {
    const text = 'Exile the top two cards of your library. Through the end of this turn, you may cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when among-clause says play lands and cast spells through the end of turn', () => {
    const text =
      'Exile the top two cards of your library. You may play lands and cast spells from among those cards through the end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when among-clause is leading through end of this turn (play lands and cast spells)', () => {
    const text =
      'Exile the top two cards of your library. Through end of this turn, you may play lands and cast spells from among those cards.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when permission is during your next turn', () => {
    const text = 'Exile the top card of your library. During your next turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('during_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when next-turn permission has a trailing if restriction', () => {
    const text = 'Exile the top card of your library. Until your next turn, you may cast it if it\'s an instant or sorcery spell.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_next_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top when leading remains-exiled permission has a trailing if restriction', () => {
    const text = 'Exile the top card of your library. For as long as it remains exiled, you may cast it if it\'s a creature spell.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top with remains-exiled permission', () => {
    const text = 'Exile the top card of your library. You may play that card for as long as it remains exiled.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "as long as" remains-exiled permission', () => {
    const text = 'Exile the top card of your library. You may play that card as long as it remains exiled.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top when remains-exiled permission is leading (and has a trailing if restriction)', () => {
    const text = 'Exile the top card of your library. For as long as that card remains exiled, you may play it if you control a Kavu.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of the turn" phrasing', () => {
    const text = 'Exile the top card of your library. Until the end of the turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of this turn" phrasing', () => {
    const text = 'Exile the top card of your library. Until the end of this turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of that turn" phrasing', () => {
    const text = 'Exile the top card of your library. Until the end of that turn, you may play that card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of that turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card until the end of that turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "until the end of this turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card until the end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through end of turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through end of this turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through end of next turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through end of next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through the end of turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through the end of turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through the end of this turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through the end of this turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top with "through the end of next turn" phrasing (trailing)', () => {
    const text = 'Exile the top card of your library. You may play that card through the end of next turn.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses conditional impulse (nonland cast this turn)', () => {
    const text = "Exile the top card of your library. If it's a nonland card, you may cast it this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'type', type: 'nonland' });
  });

  it('parses conditional impulse (red cast until end of next turn)', () => {
    const text = "Exile the top card of your library. If it's red, you may cast it until the end of your next turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'color', color: 'R' });
  });

  it('parses conditional impulse variant (that card is red)', () => {
    const text = "Exile the top card of your library. If that card is red, you may cast it this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'color', color: 'R' });
  });

  it('parses conditional impulse variant (the exiled card is a nonland card)', () => {
    const text = "Exile the top card of your library. If the exiled card is a nonland card, you may cast that card this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'type', type: 'nonland' });
  });

  it("parses conditional impulse plural variant (they're nonland cards)", () => {
    const text = "Exile the top two cards of your library. If they're nonland cards, you may cast them this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toEqual({ kind: 'type', type: 'nonland' });
  });

  it('parses conditional impulse with an unmodeled predicate by ignoring the condition', () => {
    const text = "Exile the top card of your library. If it's a Goblin creature card, you may cast that card until the end of your next turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('cast');
    expect(impulse.condition).toBeUndefined();
  });

  it("parses impulse with fallback permission clause prefixed by 'If you don't cast it this way'", () => {
    const text =
      "Whenever you cast your first spell during each of your turns, exile the top card of target opponent's library and create a Treasure token. Then you may cast the exiled card without paying its mana cost if it's a spell with mana value less than the number of artifacts you control. If you don't cast it this way, you may cast it this turn.";
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('this_turn');
    expect(impulse.permission).toBe('cast');
  });

  it('parses impulse exile-top inside a modal bullet list (Riku of Many Paths template)', () => {
    const text =
      'Whenever you cast a modal spell, choose up to X, where X is the number of times you chose a mode for that spell —\n• Exile the top card of your library. Until the end of your next turn, you may play it.\n• Put a +1/+1 counter on Riku. It gains trample until end of turn.\n• Create a 1/1 blue Bird creature token with flying.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'triggered')!;
    expect(ability).toBeTruthy();
    const steps = ability.steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse exile-top inside a modal bullet list for an activated ability', () => {
    const text =
      '{T}, Sacrifice an artifact: Choose one —\n• Exile the top card of your library. Until the end of your next turn, you may play that card.\n• Target creature gets +2/+0 until end of turn.';
    const ir = parseOracleTextToIR(text);
    const ability = ir.abilities.find(a => a.type === 'activated')!;
    expect(ability).toBeTruthy();

    // impulse_exile_top is nested inside the choose_mode step's modes
    const chooseModeStep = ability.steps.find(s => s.kind === 'choose_mode') as any;
    expect(chooseModeStep).toBeTruthy();
    const impulse = chooseModeStep.modes.flatMap((m: any) => m.steps).find((s: any) => s.kind === 'impulse_exile_top');
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.permission).toBe('play');
  });

  it('marks "You may" clauses as optional', () => {
    const text = 'You may draw a card.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    expect(steps[0].kind).toBe('draw');
    expect((steps[0] as any).optional).toBe(true);
  });

  it('parses face-down exile with combined look-and-play permission', () => {
    const text =
      'Exile the top card of your library face down. You may look at and play that card this turn.';

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;
    const impulse = steps.find((s) => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();

    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('this_turn');
  });

  it('parses face-down impulse with look reminder + until-your-next-turn permission (corpus)', () => {
    const text =
      "Exile the top three cards of your library face down. You may look at those cards for as long as they remain exiled. Until your next turn, you may play those cards. At the beginning of your next upkeep, put any of those cards you didn't play into your graveyard.";

    const ir = parseOracleTextToIR(text);
    const allSteps = ir.abilities.flatMap(a => a.steps);
    const impulse = allSteps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();

    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 3 });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('until_next_turn');
  });

  it('parses face-down exile with combined look-and-play remains-exiled permission', () => {
    const text =
      "Exile the top card of each opponent's library face down. You may look at and play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses target-opponent face-down impulse with remains-exiled permission', () => {
    const text =
      "Exile the top two cards of target opponent's library face down. You may look at and play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses look-then-exile face-down impulse (your library)', () => {
    const text =
      'Look at the top card of your library, then exile it face down. You may play it for as long as it remains exiled.';

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses look-then-exile face-down impulse (that player's library)", () => {
    const text =
      "Look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses look-then-exile face-down impulse (their library)", () => {
    const text =
      'Look at the top card of their library, then exile it face down. For as long as it remains exiled, you may play it.';

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses look-then-exile face-down impulse (those opponents' libraries alias)", () => {
    const text =
      "Look at the top card of those opponents' libraries, then exile those cards face down. You may play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses split-clause look-then-exile face-down impulse (those opponents' libraries alias)", () => {
    const text =
      "Look at the top card of those opponents' libraries. Then exile those cards face down. You may play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses split-clause look-top-two then exile-those-cards face-down impulse', () => {
    const text =
      "Look at the top two cards of target opponent's library. Then exile those cards face down. You may play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses split-clause look-top-two then exile-those-cards impulse (no face down)', () => {
    const text =
      "Look at the top two cards of target opponent's library. Then exile those cards. You may play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses standalone split-clause look-top-two then exile-those-cards face-down exile_top', () => {
    const text = "Look at the top two cards of target opponent's library. Then exile those cards face down.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'target_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 2 });
  });

  it('parses standalone split-clause look-top-two then exile-those-cards exile_top (no face down)', () => {
    const text = "Look at the top two cards of target opponent's library. Then exile those cards.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'target_opponent' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 2 });
  });

  it('parses combined look+exile face-down impulse (each opponent)', () => {
    const text =
      "Look at the top card of each opponent's library and exile those cards face down. You may play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses combined look+exile face-down impulse (those opponents' libraries alias)", () => {
    const text =
      "Look at the top card of those opponents' libraries and exile those cards face down. You may play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses combined look+exile impulse (no face down)', () => {
    const text =
      "Look at the top two cards of target opponent's library and exile those cards. You may play those cards for as long as they remain exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses standalone look+exile face-down exile_top (those opponents' libraries alias)", () => {
    const text = "Look at the top card of those opponents' libraries and exile those cards face down.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it("parses standalone look+exile exile_top (no face down, those opponents' libraries alias)", () => {
    const text = "Look at the top card of those opponents' libraries and exile those cards.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const exileTop = steps.find(s => s.kind === 'exile_top') as any;
    expect(exileTop).toBeTruthy();
    expect(exileTop.who).toEqual({ kind: 'each_of_those_opponents' });
    expect(exileTop.amount).toEqual({ kind: 'number', value: 1 });
  });

  it('parses combined look+exile face-down impulse (target opponent, top two)', () => {
    const text =
      "Look at the top two cards of target opponent's library and exile those cards face down. You may play those cards for as long as they remain exiled, and mana of any type can be spent to cast them.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 2 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses combined look+exile face-down impulse when look clause is prefixed by 'then' (that player's library)", () => {
    const text =
      "Create a Treasure token, then look at the top card of that player's library and exile it face down. You may cast that card for as long as it remains exiled.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('cast');
  });

  it("parses combined look+exile face-down impulse with cast + mana-rider (that player's library)", () => {
    const text =
      "Create a Treasure token, then look at the top card of that player's library and exile it face down. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('cast');
  });

  it("parses combined look+exile face-down impulse with play + mana-rider (that player's library)", () => {
    const text =
      "Look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it("parses Gonti-Night-Minister-style look-then-exile play+rider sentence", () => {
    const text =
      "Whenever one or more creatures you control deal combat damage to a player, look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.";

    const ir = parseOracleTextToIR(text);
    const allSteps = ir.abilities.flatMap(a => a.steps);

    const impulse = allSteps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses Thought-String-Analyst-style singular look+play remains-exiled mana-rider text', () => {
    const text =
      "At the beginning of your upkeep, exile the top card of target opponent's library face down. You lose life equal to its mana value. You may look at and play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.";

    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities[0].steps;

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_opponent' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.permission).toBe('play');
  });

  it('parses impulse with variable exile amount "a number of ... equal to ..." and a choose-card clause', () => {
    // Corpus example: End-Blaze Epiphany
    const oracleText =
      "Choose one. You may cast target creature spell from your hand or a graveyard this turn. If you cast it from a graveyard, it gains haste until end of turn. Return it to its owner’s hand at the beginning of the next end step."
      + "\n"
      + "Or exile the top card of your library. You may play it this turn."
      + "\n"
      + "Or exile a creature you control. When that creature dies this turn, exile a number of cards from the top of your library equal to its power, then choose a card exiled this way. Until the end of your next turn, you may play that card.";

    const ir = parseOracleTextToIR(oracleText);

    const allSteps = ir.abilities.flatMap((a) => a.steps);
    const impulse = allSteps.find((s) => s.kind === 'impulse_exile_top');
    expect(impulse).toBeTruthy();
    if (!impulse || impulse.kind !== 'impulse_exile_top') return;

    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('until_end_of_next_turn');
    expect(impulse.amount.kind).toBe('unknown');
  });

  it('parses conditional impulse permission "During any turn you attacked with a commander" (corpus)', () => {
    // Corpus example: Neriv, Crackling Vanguard
    const oracleText =
      'Flying, deathtouch\n'
      + 'When Neriv enters, create two 1/1 red Goblin creature tokens.\n'
      + 'Whenever Neriv attacks, exile a number of cards from the top of your library equal to the number of differently named tokens you control. During any turn you attacked with a commander, you may play those cards.';

    const ir = parseOracleTextToIR(oracleText, 'Neriv, Crackling Vanguard');
    const allSteps = ir.abilities.flatMap((a) => a.steps);
    const impulse = allSteps.find((s) => s.kind === 'impulse_exile_top');
    expect(impulse).toBeTruthy();
    if (!impulse || impulse.kind !== 'impulse_exile_top') return;

    expect(impulse.who).toEqual({ kind: 'you' });
    expect(impulse.permission).toBe('play');
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.amount.kind).toBe('unknown');
    expect(impulse.condition).toEqual({ kind: 'attacked_with', raw: 'a commander' });
  });

  it('parses conditional impulse permission "During any turn you attacked with a Rogue" with trigger/if-prefixed exile seed (corpus)', () => {
    // Corpus example: Robber of the Rich (oracle-cards.json is normalized to "this creature")
    const oracleText =
      'Reach, haste\n'
      + 'Whenever this creature attacks, if defending player has more cards in hand than you, exile the top card of their library. '
      + 'During any turn you attacked with a Rogue, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.';

    const ir = parseOracleTextToIR(oracleText, 'Robber of the Rich');
    const allSteps = ir.abilities.flatMap((a) => flattenNestedSteps(a.steps as any[]));
    const impulse = allSteps.find((s) => s.kind === 'impulse_exile_top');
    expect(impulse).toBeTruthy();
    if (!impulse || impulse.kind !== 'impulse_exile_top') return;

    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toEqual({ kind: 'number', value: 1 });
    expect(impulse.permission).toBe('cast');
    expect(impulse.duration).toBe('as_long_as_remains_exiled');
    expect(impulse.condition).toEqual({ kind: 'attacked_with', raw: 'a rogue' });
  });

  it('parses Veinwitch Coven payment-gated graveyard return as pay_mana plus conditional move', () => {
    const oracleText =
      'At the beginning of your end step, if you gained life this turn, you may pay {B}. If you do, return target creature card from your graveyard to your hand.';

    const ir = parseOracleTextToIR(oracleText, 'Veinwitch Coven');
    const ability = ir.abilities[0];
    const steps = unwrapLeadingConditionalSteps(ability?.steps ?? []);

    expect(ability?.interveningIf).toBe('you gained life this turn');
    expect(ir.abilities[0]?.steps?.[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you gained life this turn' },
    });
    expect(steps[0]).toMatchObject({
      kind: 'pay_mana',
      who: { kind: 'you' },
      mana: '{B}',
      optional: true,
    });
    expect(steps[1]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you do' },
    });
    expect((steps[1] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      to: 'hand',
    });
  });

  it('parses Genesis payment-gated graveyard return as pay_mana plus conditional move', () => {
    const oracleText =
      'At the beginning of your upkeep, if Genesis is in your graveyard, you may pay {2}{G}. If you do, return target creature card from your graveyard to your hand.';

    const ir = parseOracleTextToIR(oracleText, 'Genesis');
    const ability = ir.abilities[0];
    const steps = unwrapLeadingConditionalSteps(ability?.steps ?? []);

    expect(ability?.interveningIf).toBe('this permanent is in your graveyard');
    expect(ir.abilities[0]?.steps?.[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'this permanent is in your graveyard' },
    });
    expect(steps[0]).toMatchObject({
      kind: 'pay_mana',
      who: { kind: 'you' },
      mana: '{2}{G}',
      optional: true,
    });
    expect(steps[1]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you do' },
    });
    expect((steps[1] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      to: 'hand',
    });
  });

  it('parses Nim Deathmantle as pay_mana plus conditional move-and-attach sequence', () => {
    const oracleText =
      'Whenever a nontoken creature is put into your graveyard from the battlefield, you may pay {4}. If you do, return that card to the battlefield and attach Nim Deathmantle to it.';

    const ir = parseOracleTextToIR(oracleText, 'Nim Deathmantle');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps[0]).toMatchObject({
      kind: 'pay_mana',
      who: { kind: 'you' },
      mana: '{4}',
      optional: true,
    });
    expect(steps[1]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you do' },
    });
    expect((steps[1] as any)?.steps).toMatchObject([
      { kind: 'move_zone', to: 'battlefield' },
      { kind: 'attach' },
    ]);
  });

  it('parses Athreos, God of Passage as an unless-pays-life wrapper around the return step', () => {
    const oracleText =
      'Whenever another creature you own dies, return it to your hand unless target opponent pays 3 life.';

    const ir = parseOracleTextToIR(oracleText, 'Athreos, God of Passage');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'unless_pays_life',
      who: { kind: 'target_opponent' },
      amount: 3,
    });
    expect((steps[0] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      to: 'hand',
    });
  });

  it('parses Gift of Immortality as immediate return plus delayed self-reattach', () => {
    const oracleText =
      "When enchanted creature dies, return that card to the battlefield under its owner's control. Return Gift of Immortality to the battlefield attached to that creature at the beginning of the next end step.";

    const ir = parseOracleTextToIR(oracleText, 'Gift of Immortality');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toMatchObject([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'that card' },
        to: 'battlefield',
      },
      {
        kind: 'schedule_delayed_trigger',
        timing: 'next_end_step',
      },
    ]);
    expect(String((steps[1] as any)?.effect || '')).toContain('this permanent');
    expect(String((steps[1] as any)?.effect || '')).toContain('attached to that creature');
  });

  it("parses Molten Firebird as delayed return plus skip-your-next-draw-step", () => {
    const oracleText =
      'Flying\n' +
      "When this creature dies, return it to the battlefield under its owner's control at the beginning of the next end step and you skip your next draw step.\n" +
      '{4}{R}: Exile this creature.';

    const ir = parseOracleTextToIR(oracleText, 'Molten Firebird');
    const triggered = ir.abilities.find(ability => ability.triggerCondition === 'this creature dies');
    const steps = triggered?.steps ?? [];

    expect(steps).toMatchObject([
      {
        kind: 'schedule_delayed_trigger',
        timing: 'next_end_step',
      },
      {
        kind: 'skip_next_draw_step',
        who: { kind: 'you' },
      },
    ]);
    expect(String((steps[0] as any)?.effect || '')).toBe("return it to the battlefield under its owner's control");
  });

  it('parses Oathkeeper, Takeno\'s Daisho as a conditional Samurai return', () => {
    const oracleText =
      "Whenever equipped creature dies, return that card to the battlefield under your control if it's a Samurai card.";

    const ir = parseOracleTextToIR(oracleText, "Oathkeeper, Takeno's Daisho");
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: "it's a Samurai card" },
    });
    expect((steps[0] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'that card' },
      to: 'battlefield',
      battlefieldController: { kind: 'you' },
    });
  });

  it('parses Edea, Possessed Sorceress as return plus draw followup', () => {
    const oracleText =
      "Whenever a creature you control but don't own dies, return it to the battlefield under its owner's control and you draw a card.";

    const ir = parseOracleTextToIR(oracleText, 'Edea, Possessed Sorceress');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toMatchObject([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'it' },
        to: 'battlefield',
        battlefieldController: { kind: 'owner_of_moved_cards' },
      },
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
      },
    ]);
  });

  it('parses Skullwinder as return, choose_opponent, then opponent graveyard return', () => {
    const oracleText =
      'When Skullwinder enters, return target card from your graveyard to your hand, then choose an opponent. That player returns a card from their graveyard to their hand.';

    const ir = parseOracleTextToIR(oracleText, 'Skullwinder');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toMatchObject([
      { kind: 'move_zone', to: 'hand' },
      { kind: 'choose_opponent' },
      {
        kind: 'move_zone',
        to: 'hand',
        what: { kind: 'raw', text: "a card from target player's graveyard" },
      },
    ]);
  });

  it('parses Court of Ardenvale monarchy branch as optional conditional hand-to-battlefield move', () => {
    const oracleText =
      "At the beginning of your upkeep, return target permanent card from your graveyard to your hand. If you're the monarch, you may put it onto the battlefield instead.";

    const ir = parseOracleTextToIR(oracleText, 'Court of Ardenvale');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps[0]).toMatchObject({ kind: 'move_zone', to: 'hand' });
    expect(steps[1]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: "you're the monarch" },
    });
    expect((steps[1] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'it' },
      to: 'battlefield',
      optional: true,
    });
  });

  it('parses Volcanic Vision as return, damage by returned card mana value, then self-exile', () => {
    const oracleText =
      "Return target instant or sorcery card from your graveyard to your hand. Volcanic Vision deals damage equal to that card's mana value to each creature your opponents control. Exile Volcanic Vision.";

    const ir = parseOracleTextToIR(oracleText, 'Volcanic Vision');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toMatchObject([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'target instant or sorcery card from your graveyard' },
        to: 'hand',
      },
      {
        kind: 'deal_damage',
        amount: { kind: 'unknown', raw: "that card's mana value" },
        target: { kind: 'raw', text: 'each creature your opponents control' },
      },
      {
        kind: 'exile',
        target: { kind: 'raw', text: 'this permanent' },
      },
    ]);
  });

  it('parses Golbez, Crystal Collector as return plus returned-card power life-loss rider', () => {
    const oracleText =
      "At the beginning of your end step, if you control four or more artifacts, return target creature card from your graveyard to your hand. Each opponent loses life equal to that card's power.";

    const ir = parseOracleTextToIR(oracleText, 'Golbez, Crystal Collector');
    const ability = ir.abilities[0];
    const steps = unwrapLeadingConditionalSteps(ability?.steps ?? []);

    expect(ability?.interveningIf).toBe('you control four or more artifacts');
    expect(steps).toMatchObject([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'target creature card from your graveyard' },
        to: 'hand',
      },
      {
        kind: 'lose_life',
        who: { kind: 'each_opponent' },
        amount: { kind: 'unknown', raw: "that card's power" },
      },
    ]);
  });

  it('parses Peerless Recycling gift branch as a conditional second graveyard return', () => {
    const oracleText =
      'Return target permanent card from your graveyard to your hand. If the gift was promised, return another target permanent card from your graveyard to your hand.';

    const ir = parseOracleTextToIR(oracleText, 'Peerless Recycling');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'target permanent card from your graveyard' },
      to: 'hand',
    });
    expect(steps[1]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'the gift was promised' },
    });
    expect((steps[1] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'another target permanent card from your graveyard' },
      to: 'hand',
    });
  });

  it('splits Reconstruct History into differentiated up-to-one graveyard return steps plus self-exile', () => {
    const oracleText =
      'Return up to one target artifact card, up to one target enchantment card, up to one target instant card, up to one target sorcery card, and up to one target planeswalker card from your graveyard to your hand. Exile Reconstruct History.';

    const ir = parseOracleTextToIR(oracleText, 'Reconstruct History');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toMatchObject([
      { kind: 'move_zone', what: { kind: 'raw', text: 'up to one target artifact card from your graveyard' }, to: 'hand' },
      { kind: 'move_zone', what: { kind: 'raw', text: 'up to one target enchantment card from your graveyard' }, to: 'hand' },
      { kind: 'move_zone', what: { kind: 'raw', text: 'up to one target instant card from your graveyard' }, to: 'hand' },
      { kind: 'move_zone', what: { kind: 'raw', text: 'up to one target sorcery card from your graveyard' }, to: 'hand' },
      { kind: 'move_zone', what: { kind: 'raw', text: 'up to one target planeswalker card from your graveyard' }, to: 'hand' },
      { kind: 'exile', target: { kind: 'raw', text: 'this permanent' } },
    ]);
  });

  it('parses Awaken the Honored Dead discard gate as optional discard plus conditional reanimation', () => {
    const oracleText =
      'You may discard a card. When you do, return target creature card from your graveyard to the battlefield tapped.';

    const ir = parseOracleTextToIR(oracleText, 'Awaken the Honored Dead');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps[0]).toMatchObject({
      kind: 'discard',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      optional: true,
    });
    expect(steps[1]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you do' },
    });
    expect((steps[1] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'target creature card from your graveyard' },
      to: 'battlefield',
      entersTapped: true,
    });
  });

  it('preserves Grave Venerations intervening-if as a top-level conditional wrapper', () => {
    const oracleText =
      "When this enchantment enters, you become the monarch.\nAt the beginning of your end step, if you're the monarch, return up to one target creature card from your graveyard to your hand.\nWhenever a creature you control dies, each opponent loses 1 life and you gain 1 life.";

    const ir = parseOracleTextToIR(oracleText, 'Grave Venerations');
    const ability = ir.abilities.find(a => a.triggerCondition === 'the beginning of your end step');
    const steps = ability?.steps ?? [];

    expect(ability?.interveningIf).toBe("you're the monarch");
    expect(steps[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: "you're the monarch" },
    });
    expect((steps[0] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'up to one target creature card from your graveyard' },
      to: 'hand',
    });
  });

  it('preserves Aerith, Last Ancient intervening-if around its return and battlefield-upgrade branch', () => {
    const oracleText =
      'At the beginning of your end step, if you gained life this turn, return target creature card from your graveyard to your hand. If you gained 7 or more life this turn, return that card to the battlefield instead.';

    const ir = parseOracleTextToIR(oracleText, 'Aerith, Last Ancient');
    const ability = ir.abilities[0];
    const steps = ability?.steps ?? [];

    expect(ability?.interveningIf).toBe('you gained life this turn');
    expect(steps[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you gained life this turn' },
    });
    expect((steps[0] as any)?.steps).toMatchObject([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'target creature card from your graveyard' },
        to: 'hand',
      },
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you gained 7 or more life this turn' },
      },
    ]);
    expect(((steps[0] as any)?.steps?.[1] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'that card' },
      to: 'battlefield',
    });
  });

  it('parses Planewide Celebration as a repeatable choose-four modal block', () => {
    const oracleText =
      "Choose four. You may choose the same mode more than once.\n\u2022 Create a 2/2 white Citizen creature token that's all colors.\n\u2022 Return target permanent card from your graveyard to your hand.\n\u2022 Proliferate.\n\u2022 You gain 4 life.";

    const ir = parseOracleTextToIR(oracleText, 'Planewide Celebration');
    const step = ir.abilities[0]?.steps?.[0] as any;

    expect(step).toMatchObject({
      kind: 'choose_mode',
      minModes: 4,
      maxModes: 4,
      canRepeatModes: true,
    });
    expect(step?.modes?.map((mode: any) => mode.steps?.[0]?.kind)).toEqual([
      'create_token',
      'move_zone',
      'proliferate',
      'gain_life',
    ]);
  });

  it('parses Stitch Together threshold text as a conditional battlefield upgrade', () => {
    const oracleText =
      'Return target creature card from your graveyard to your hand.\nThreshold - Return that card from your graveyard to the battlefield instead if there are seven or more cards in your graveyard.';

    const ir = parseOracleTextToIR(oracleText, 'Stitch Together');
    const steps = ir.abilities.flatMap(ability => ability.steps);

    expect(steps).toMatchObject([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'target creature card from your graveyard' },
        to: 'hand',
      },
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'there are seven or more cards in your graveyard' },
      },
    ]);
    expect((steps[1] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'that card from your graveyard' },
      to: 'battlefield',
    });
  });

  it('parses Emeria Shepherd plains upgrade effect text as a conditional battlefield return', () => {
    const oracleText =
      'You may return target nonland permanent card from your graveyard to your hand. If that land is a Plains, you may return that nonland permanent card to the battlefield instead.';

    const ir = parseOracleTextToIR(oracleText, 'Emeria Shepherd');
    const steps = ir.abilities.flatMap(ability => ability.steps);

    expect(steps).toMatchObject([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'target nonland permanent card from your graveyard' },
        to: 'hand',
        optional: true,
      },
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'that land is a Plains' },
      },
    ]);
    expect((steps[1] as any)?.steps?.[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'that nonland permanent card' },
      to: 'battlefield',
      optional: true,
    });
  });

  it('parses Not Dead After All as a temporary dies trigger grant', () => {
    const oracleText =
      'Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner\'s control, then create a Wicked Role token attached to it." (Enchanted creature gets +1/+1. When this token is put into a graveyard, each opponent loses 1 life.)';

    const ir = parseOracleTextToIR(oracleText, 'Not Dead After All');
    const steps = ir.abilities.flatMap(ability => ability.steps);

    expect(steps).toMatchObject([
      {
        kind: 'grant_temporary_dies_trigger',
        target: { kind: 'raw', text: 'target creature you control' },
        duration: 'until_end_of_turn',
      },
    ]);
    expect((steps[0] as any)?.effect).toBe(
      'return it to the battlefield tapped under its owner\'s control, then create a Wicked Role token attached to it.'
    );
  });

  it('parses Infuse with Vitality as a temporary dies trigger grant plus life gain', () => {
    const oracleText =
      'Until end of turn, target creature gains deathtouch and "When this creature dies, return it to the battlefield tapped under its owner\'s control."\nYou gain 2 life.';

    const ir = parseOracleTextToIR(oracleText, 'Infuse with Vitality');
    const steps = ir.abilities.flatMap(ability => ability.steps);

    expect(steps).toMatchObject([
      {
        kind: 'grant_temporary_dies_trigger',
        target: { kind: 'raw', text: 'target creature' },
        duration: 'until_end_of_turn',
      },
      {
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
      },
    ]);
    expect((steps[0] as any)?.effect).toBe("return it to the battlefield tapped under its owner's control.");
  });

  it('parses Pain 101 as a temporary dies trigger grant despite the preceding deathtouch grant', () => {
    const oracleText =
      'Until end of turn, target creature gains deathtouch and "When this creature dies, return it to the battlefield tapped under its owner\'s control."';

    const ir = parseOracleTextToIR(oracleText, 'Pain 101');
    const steps = ir.abilities.flatMap(ability => ability.steps);

    expect(steps).toMatchObject([
      {
        kind: 'grant_temporary_dies_trigger',
        target: { kind: 'raw', text: 'target creature' },
        duration: 'until_end_of_turn',
      },
    ]);
    expect((steps[0] as any)?.effect).toBe("return it to the battlefield tapped under its owner's control.");
  });

  it('parses Verdant Rebirth as a dies trigger grant plus draw despite sharing a line', () => {
    const oracleText =
      'Until end of turn, target creature gains "When this creature dies, return it to its owner\'s hand." Draw a card.';

    const ir = parseOracleTextToIR(oracleText, 'Verdant Rebirth');
    const steps = ir.abilities.flatMap(ability => ability.steps);

    expect(steps).toMatchObject([
      {
        kind: 'grant_temporary_dies_trigger',
        target: { kind: 'raw', text: 'target creature' },
        duration: 'until_end_of_turn',
      },
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
      },
    ]);
    expect((steps[0] as any)?.effect).toBe("return it to its owner's hand.");
  });

  it('parses Flame-Wreathed Phoenix as a conditional self dies trigger grant behind haste', () => {
    const oracleText =
      'Flying, haste\nTribute 2\nWhen Flame-Wreathed Phoenix enters, if tribute wasn\'t paid, it gains haste and "When this creature dies, return it to its owner\'s hand."';

    const ir = parseOracleTextToIR(oracleText, 'Flame-Wreathed Phoenix');
    const ability = ir.abilities.find(parsedAbility => parsedAbility.triggerCondition === 'this permanent enters');
    const steps = ability?.steps ?? [];

    expect(ability?.interveningIf).toBe("tribute wasn't paid");
    expect(steps[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: "tribute wasn't paid" },
    });
    expect((steps[0] as any)?.steps?.[0]).toMatchObject({
      kind: 'grant_temporary_dies_trigger',
      target: { kind: 'raw', text: 'it' },
      duration: 'while_on_battlefield',
    });
    expect(((steps[0] as any)?.steps?.[0] as any)?.effect).toBe("return it to its owner's hand.");
  });

  it('parses Molten Firebird as a delayed return plus skip-next-draw-step trigger', () => {
    const oracleText =
      'Flying\n' +
      "When this creature dies, return it to the battlefield under its owner's control at the beginning of the next end step and you skip your next draw step.\n" +
      '{4}{R}: Exile this creature.';

    const ir = parseOracleTextToIR(oracleText, 'Molten Firebird');
    const triggered = ir.abilities.find(ability => ability.triggerCondition === 'this creature dies');
    const activated = ir.abilities.find(ability => ability.type === 'activated');

    expect(triggered?.steps).toEqual([
      {
        kind: 'schedule_delayed_trigger',
        timing: 'next_end_step',
        effect: "return it to the battlefield under its owner's control",
        raw: "return it to the battlefield under its owner's control at the beginning of the next end step",
      },
      {
        kind: 'skip_next_draw_step',
        who: { kind: 'you' },
        raw: 'you skip your next draw step',
      },
    ]);
    expect(activated?.steps).toEqual([
      {
        kind: 'exile',
        target: { kind: 'raw', text: 'this creature' },
        raw: 'Exile this creature',
      },
    ]);
  });

  it("does not misclassify Shade's Form granted quote as an activated IR ability", () => {
    const oracleText =
      'Enchant creature\n' +
      'Enchanted creature has "{B}: This creature gets +1/+1 until end of turn."\n' +
      'When enchanted creature dies, return that card to the battlefield under your control.';

    const ir = parseOracleTextToIR(oracleText, "Shade's Form");
    const abilityTypes = ir.abilities.map(ability => ability.type);
    const diesTrigger = ir.abilities.find(ability => ability.triggerCondition === 'enchanted creature dies');

    expect(abilityTypes).not.toContain('activated');
    expect(diesTrigger?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        what: { kind: 'raw', text: 'that card' },
        to: 'battlefield',
      }),
    ]);
  });

  it('parses Presumed Dead as a pump plus temporary dies trigger grant with a suspect follow-up', () => {
    const oracleText =
      'Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner\'s control and suspect it."';

    const steps = parseOracleTextToIR(oracleText, 'Presumed Dead').abilities.flatMap(ability => ability.steps);

    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'modify_pt',
          target: { kind: 'raw', text: 'target creature' },
        }),
        expect.objectContaining({
          kind: 'grant_temporary_dies_trigger',
          target: { kind: 'raw', text: 'target creature' },
          duration: 'until_end_of_turn',
        }),
      ])
    );
    expect((steps.find(step => step.kind === 'grant_temporary_dies_trigger') as any)?.effect).toBe(
      "return it to the battlefield under its owner's control and suspect it."
    );
  });

  it('parses Perigee Beckoner as a triggered pump plus temporary dies trigger grant', () => {
    const oracleText =
      'When this creature enters, until end of turn, another target creature you control gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner\'s control."';

    const ability = parseOracleTextToIR(oracleText, 'Perigee Beckoner').abilities[0];
    const steps = ability?.steps ?? [];

    expect(ability?.triggerCondition).toBe('this creature enters');
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'modify_pt',
          target: { kind: 'raw', text: 'target creature you control' },
        }),
        expect.objectContaining({
          kind: 'grant_temporary_dies_trigger',
          target: { kind: 'raw', text: 'target creature you control' },
          duration: 'until_end_of_turn',
        }),
      ])
    );
    expect((steps.find(step => step.kind === 'grant_temporary_dies_trigger') as any)?.effect).toBe(
      "return it to the battlefield tapped under its owner's control."
    );
  });

  it('parses Pharika, God of Affliction as a single activated exile-plus-owner-token ability', () => {
    const oracleText =
      '{B}{G}: Exile target creature card from a graveyard. Its owner creates a 1/1 black and green Snake enchantment creature token with deathtouch.';

    const ir = parseOracleTextToIR(oracleText, 'Pharika, God of Affliction');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'activated',
      cost: '{B}{G}',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'move_zone',
        to: 'exile',
      },
      {
        kind: 'create_token',
        who: { kind: 'owner_of_moved_cards' },
        token: '1/1 black and green Snake enchantment',
      },
    ]);
  });

  it('parses Funeral Pyre as exile followed by owner-controlled token creation in one ability', () => {
    const oracleText =
      'Exile target card from a graveyard. Its owner creates a 1/1 white Spirit creature token with flying.';

    const ir = parseOracleTextToIR(oracleText, 'Funeral Pyre');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'move_zone',
        to: 'exile',
      },
      {
        kind: 'create_token',
        who: { kind: 'owner_of_moved_cards' },
        token: '1/1 white Spirit',
      },
    ]);
  });

  it('parses Oskar, Rubbish Reclaimer as a graveyard-cast permission step', () => {
    const oracleText = 'Whenever you discard a nonland card, you may cast it from your graveyard.';

    const ir = parseOracleTextToIR(oracleText, 'Oskar, Rubbish Reclaimer');
    const ability = ir.abilities[0];

    expect(ability?.type).toBe('triggered');
    expect(ability?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'it' },
        permission: 'cast',
        duration: 'during_resolution',
        optional: true,
      },
    ]);
  });

  it('parses Skyclave Shade landfall text as a triggered graveyard-cast permission step', () => {
    const oracleText =
      "Landfall - Whenever a land you control enters, if this card is in your graveyard and it's your turn, you may cast it from your graveyard this turn.";

    const ir = parseOracleTextToIR(oracleText, 'Skyclave Shade');
    const ability = ir.abilities[0];

    expect(ability?.type).toBe('triggered');
    expect(ability?.steps).toMatchObject([
      {
        kind: 'conditional',
        condition: {
          kind: 'if',
          raw: "this card is in your graveyard and it's your turn",
        },
        steps: [
          {
            kind: 'grant_graveyard_permission',
            who: { kind: 'you' },
            what: { kind: 'raw', text: 'it' },
            permission: 'cast',
            duration: 'this_turn',
            optional: true,
          },
        ],
      },
    ]);
  });

  it('parses parenthetical escape-style graveyard permissions like Confession Dial', () => {
    const oracleText = '(You may cast it from your graveyard for its escape cost this turn.)';

    const ir = parseOracleTextToIR(oracleText, 'Confession Dial');
    const ability = ir.abilities[0];

    expect(ability?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'it' },
        permission: 'cast',
        duration: 'this_turn',
        optional: true,
      },
    ]);
  });

  it('parses flashback keyword lines like Faithless Looting into graveyard-cast permission steps', () => {
    const ir = parseOracleTextToIR('Draw two cards, then discard two cards. Flashback {2}{R}', 'Faithless Looting');

    expect(ir.abilities[1]?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'this card' },
        permission: 'cast',
        duration: 'during_resolution',
        optional: true,
      },
    ]);
  });

  it('parses full Snapcaster Mage text into a triggered graveyard permission ability', () => {
    const ir = parseOracleTextToIR(
      'Flash. When Snapcaster Mage enters, target instant or sorcery card in your graveyard gains flashback until end of turn.\nThe flashback cost is equal to its mana cost.',
      'Snapcaster Mage'
    );

    expect(ir.abilities[0]?.type).toBe('static');
    expect(ir.abilities[1]?.type).toBe('triggered');
    expect(ir.abilities[1]?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'target instant or sorcery card' },
        permission: 'cast',
        duration: 'this_turn',
        optional: true,
      },
      {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        castCost: 'mana_cost',
      },
    ]);
  });

  it('parses Past in Flames into graveyard permissions plus mana-cost flashback metadata', () => {
    const ir = parseOracleTextToIR(
      'Each instant and sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.',
      'Past in Flames'
    );

    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'instant and sorcery card' },
        permission: 'cast',
        duration: 'this_turn',
        optional: true,
      },
      {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        castCost: 'mana_cost',
      },
    ]);
  });

  it('parses static keyword grants like Underworld Breach into graveyard-cast permission steps', () => {
    const ir = parseOracleTextToIR(
      "Each nonland card in your graveyard has escape. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard.",
      'Underworld Breach'
    );

    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'nonland card' },
        permission: 'cast',
        duration: 'during_resolution',
        optional: true,
      },
    ]);
  });

  it('parses non-mana flashback keyword lines like Dread Return into graveyard-cast permission steps', () => {
    const ir = parseOracleTextToIR(
      'Return target creature card from your graveyard to the battlefield. Flashback-Sacrifice three creatures.',
      'Dread Return'
    );

    expect(ir.abilities[1]?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'this card' },
        permission: 'cast',
      },
    ]);
  });

  it('parses turn-gated retrace grants like Six into conditional graveyard-cast permission steps', () => {
    const ir = parseOracleTextToIR(
      'During your turn, nonland permanent cards in your graveyard have retrace. (You may cast permanent cards from your graveyard by discarding a land card in addition to paying their other costs.)',
      'Six'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: "it's your turn" },
          steps: expect.arrayContaining([
            expect.objectContaining({
              kind: 'grant_graveyard_permission',
              who: { kind: 'you' },
              what: { kind: 'raw', text: 'nonland permanent' },
              permission: 'cast',
              duration: 'this_turn',
              optional: true,
            }),
          ]),
        }),
      ])
    );
  });

  it("parses Sevinne's Reclamation-style graveyard copy riders into a conditional copy_spell step", () => {
    const ir = parseOracleTextToIR(
      'Return target permanent card with mana value 3 or less from your graveyard to the battlefield. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.',
      "Sevinne's Reclamation"
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'move_zone',
          what: { kind: 'raw', text: 'target permanent card with mana value 3 or less from your graveyard' },
          to: 'battlefield',
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'this spell was cast from a graveyard' },
          steps: expect.arrayContaining([
            expect.objectContaining({
              kind: 'copy_spell',
              subject: 'this_spell',
              allowNewTargets: true,
              optional: true,
            }),
          ]),
        }),
      ])
    );
  });

  it('parses Ignite the Future graveyard rider into a conditional exile-permission modifier', () => {
    const ir = parseOracleTextToIR(
      'Exile the top three cards of your library. Until the end of your next turn, you may play those cards. If this spell was cast from a graveyard, you may play cards this way without paying their mana costs.',
      'Ignite the Future'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'impulse_exile_top',
          amount: { kind: 'number', value: 3 },
          duration: 'until_end_of_next_turn',
          permission: 'play',
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'this spell was cast from a graveyard' },
          steps: expect.arrayContaining([
            expect.objectContaining({
              kind: 'modify_exile_permissions',
              scope: 'last_exiled_cards',
              withoutPayingManaCost: true,
            }),
          ]),
        }),
      ])
    );
  });

  it('parses direct look-select-top self-mill selection into a deterministic library distribution step', () => {
    const ir = parseOracleTextToIR(
      'When this creature dies, look at the top three cards of your library. Put one of them into your hand and the rest into your graveyard.',
      'Testament Bearer'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'look_select_top',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 3 },
          choose: { kind: 'number', value: 1 },
          destination: 'hand',
          restDestination: 'graveyard',
        }),
      ])
    );
  });

  it('parses Corpse Appraiser into a conditional look-select-top follow-up after the graveyard exile', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, exile up to one target creature card from a graveyard. If a card is put into exile this way, look at the top three cards of your library, then put one of those cards into your hand and the rest into your graveyard.',
      'Corpse Appraiser'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'move_zone',
          what: { kind: 'raw', text: 'up to one target creature card from a graveyard' },
          to: 'exile',
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'a card is put into exile this way' },
          steps: expect.arrayContaining([
            expect.objectContaining({
              kind: 'draw',
              who: { kind: 'you' },
              amount: { kind: 'number', value: 1 },
            }),
            expect.objectContaining({
              kind: 'mill',
              who: { kind: 'you' },
              amount: { kind: 'number', value: 2 },
            }),
          ]),
        }),
      ])
    );
  });

  it('parses Rocket-Powered Goblin Glider into an attach step behind its graveyard provenance gate', () => {
    const oracleText =
      'When this Equipment enters, if it was cast from your graveyard, attach it to target creature you control.';

    const ir = parseOracleTextToIR(oracleText, 'Rocket-Powered Goblin Glider');
    const ability = ir.abilities[0];

    expect(ability?.steps).toMatchObject([
      {
        kind: 'conditional',
        condition: {
          kind: 'if',
          raw: 'it was cast from your graveyard',
        },
        steps: [
          {
            kind: 'attach',
            attachment: { kind: 'raw', text: 'it' },
            to: { kind: 'raw', text: 'target creature you control' },
          },
        ],
      },
    ]);
  });

  it('parses leave-battlefield exile riders into an explicit replacement-grant step', () => {
    const oracleText =
      'Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.';

    const ir = parseOracleTextToIR(oracleText, 'Whip of Erebos');

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'grant_leave_battlefield_replacement',
          destination: 'exile',
          target: { kind: 'raw', text: 'it' },
        }),
      ])
    );
  });

  it('parses random graveyard returns as move_zone selectors that preserve the at-random qualifier', () => {
    const oracleText =
      'Return a creature card at random from your graveyard to the battlefield. If it would leave the battlefield, exile it instead of putting it anywhere else.';

    const ir = parseOracleTextToIR(oracleText, 'Kheru Lich Lord');

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'move_zone',
          what: { kind: 'raw', text: 'a creature card at random from your graveyard' },
          to: 'battlefield',
        }),
        expect.objectContaining({
          kind: 'grant_leave_battlefield_replacement',
          destination: 'exile',
        }),
      ])
    );
  });

  it('splits Restless Cottage style create-token-plus-graveyard-exile clauses into ordered steps', () => {
    const ir = parseOracleTextToIR(
      'Whenever this land attacks, create a Food token and exile up to one target card from a graveyard.',
      'Restless Cottage'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'create_token',
          token: 'Food',
        }),
        expect.objectContaining({
          kind: 'move_zone',
          to: 'exile',
          what: { kind: 'raw', text: 'up to one target card from a graveyard' },
        }),
      ])
    );
    expect(ir.abilities[0]?.steps.map((step: any) => step.kind)).toEqual(['create_token', 'move_zone']);
  });

  it('parses Mardu Woe-Reaper exile follow-ups into a conditional life-gain step', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature or another Warrior you control enters, you may exile target creature card from a graveyard. If you do, you gain 1 life.',
      'Mardu Woe-Reaper'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'move_zone',
          to: 'exile',
          optional: true,
          what: { kind: 'raw', text: 'target creature card from a graveyard' },
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'you do' },
          steps: [
            expect.objectContaining({
              kind: 'gain_life',
              amount: { kind: 'number', value: 1 },
            }),
          ],
        }),
      ])
    );
  });

  it('parses Diregraf Scavenger typed exiled-this-way follow-ups into conditional branches', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, exile up to one target card from a graveyard. If a creature card was exiled this way, you gain 2 life. If a land card was exiled this way, add {G}.',
      'Diregraf Scavenger'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'move_zone',
          to: 'exile',
          what: { kind: 'raw', text: 'up to one target card from a graveyard' },
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'a creature card was exiled this way' },
          steps: [
            expect.objectContaining({
              kind: 'gain_life',
              amount: { kind: 'number', value: 2 },
            }),
          ],
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'a land card was exiled this way' },
          steps: [
            expect.objectContaining({
              kind: 'add_mana',
              mana: '{G}',
            }),
          ],
        }),
      ])
    );
  });

  it('parses Corpse Appraiser exile gate into conditional draw-plus-mill follow-up', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, exile up to one target creature card from a graveyard. If a card is put into exile this way, look at the top three cards of your library, then put one of those cards into your hand and the rest into your graveyard.',
      'Corpse Appraiser'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'move_zone',
          to: 'exile',
          what: { kind: 'raw', text: 'up to one target creature card from a graveyard' },
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'a card is put into exile this way' },
          steps: [
            expect.objectContaining({
              kind: 'draw',
              who: { kind: 'you' },
              amount: { kind: 'number', value: 1 },
            }),
            expect.objectContaining({
              kind: 'mill',
              who: { kind: 'you' },
              amount: { kind: 'number', value: 2 },
            }),
          ],
        }),
      ])
    );
  });

  it('parses Klothys land and otherwise branches with mana choice support', () => {
    const ir = parseOracleTextToIR(
      'Exile target card from a graveyard. If it was a land card, add {R} or {G}. Otherwise, you gain 2 life and this permanent deals 2 damage to each opponent.',
      'Klothys, God of Destiny'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'move_zone',
          to: 'exile',
          what: { kind: 'raw', text: 'target card from a graveyard' },
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'it was a land card' },
          steps: [
            expect.objectContaining({
              kind: 'add_mana',
              manaOptions: ['{R}', '{G}'],
            }),
          ],
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'it was not a land' },
          steps: [
            expect.objectContaining({
              kind: 'gain_life',
              amount: { kind: 'number', value: 2 },
            }),
            expect.objectContaining({
              kind: 'deal_damage',
              amount: { kind: 'number', value: 2 },
              target: { kind: 'raw', text: 'each opponent' },
            }),
          ],
        }),
      ])
    );
  });

  it('parses Deathgorge Scavenger noncreature exile follow-up into a conditional self modify-pt branch', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters or attacks, you may exile target card from a graveyard. If a creature card was exiled this way, you gain 2 life. If a noncreature card was exiled this way, this creature gets +1/+1 until end of turn.',
      'Deathgorge Scavenger'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'a noncreature card was exiled this way' },
          steps: [
            expect.objectContaining({
              kind: 'modify_pt',
              target: { kind: 'raw', text: 'this creature' },
              power: 1,
              toughness: 1,
              duration: 'end_of_turn',
            }),
          ],
        }),
      ])
    );
  });

  it('splits graveyard exile plus immediate self counter clauses into ordered move-zone and add-counter steps', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature becomes tapped, exile up to one target card from a graveyard and put a +1/+1 counter on this creature.',
      'Immersturm Predator'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        what: { kind: 'raw', text: 'up to one target card from a graveyard' },
      }),
      expect.objectContaining({
        kind: 'add_counter',
        counter: '+1/+1',
        amount: { kind: 'number', value: 1 },
        target: { kind: 'raw', text: 'this creature' },
      }),
    ]);
  });

  it('parses Keen-Eyed Curator exile follow-up into a conditional add-counter branch', () => {
    const ir = parseOracleTextToIR(
      'Exile target card from a graveyard. If a creature card was exiled this way, put a +1/+1 counter on this creature.',
      'Keen-Eyed Curator'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'a creature card was exiled this way' },
          steps: [
            expect.objectContaining({
              kind: 'add_counter',
              counter: '+1/+1',
              amount: { kind: 'number', value: 1 },
              target: { kind: 'raw', text: 'this creature' },
            }),
          ],
        }),
      ])
    );
  });

  it('parses Conversion Chamber follow-up charge counter clauses into add-counter steps', () => {
    const ir = parseOracleTextToIR(
      'Exile target artifact card from a graveyard. Put a charge counter on this artifact.',
      'Conversion Chamber'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'add_counter',
          counter: 'charge',
          amount: { kind: 'number', value: 1 },
          target: { kind: 'raw', text: 'this artifact' },
        }),
      ])
    );
  });

  it('parses Lara Croft exile plus discovery-counter follow-up into ordered steps', () => {
    const ir = parseOracleTextToIR(
      'Whenever Lara Croft attacks, exile up to one target legendary artifact card or legendary land card from a graveyard and put a discovery counter on it.',
      'Lara Croft, Tomb Raider'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        what: { kind: 'raw', text: 'up to one target legendary artifact card or legendary land card from a graveyard' },
      }),
      expect.objectContaining({
        kind: 'add_counter',
        counter: 'discovery',
        amount: { kind: 'number', value: 1 },
        target: { kind: 'raw', text: 'it' },
      }),
    ]);
  });

  it('parses Lazav, Wearer of Faces exile-then-investigate into ordered steps', () => {
    const ir = parseOracleTextToIR(
      'Whenever Lazav attacks, exile target card from a graveyard, then investigate.',
      'Lazav, Wearer of Faces'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        what: { kind: 'raw', text: 'target card from a graveyard' },
      }),
      expect.objectContaining({
        kind: 'investigate',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
      }),
    ]);
  });

  it('parses Mastermind Plum type-checked Treasure follow-up into a conditional branch', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature attacks, exile up to one target card from a graveyard. If it was an artifact or land card, create a Treasure token.',
      'Mastermind Plum'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'it was an artifact or land card' },
          steps: [
            expect.objectContaining({
              kind: 'create_token',
              token: 'Treasure',
            }),
          ],
        }),
      ])
    );
  });

  it('parses Misfortune Teller multi-branch exiled-card type follow-ups', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature enters or deals combat damage to a player, exile target card from a graveyard. If it was a creature card, create a 2/2 black Zombie creature token. If it was a land card, create a Treasure token. If it was a noncreature, nonland card, you gain 3 life.',
      'Misfortune Teller'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'it was a creature card' },
          steps: [
            expect.objectContaining({
              kind: 'create_token',
              token: '2/2 black Zombie',
            }),
          ],
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'it was a land card' },
          steps: [
            expect.objectContaining({
              kind: 'create_token',
              token: 'Treasure',
            }),
          ],
        }),
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'it was a noncreature, nonland card' },
          steps: [
            expect.objectContaining({
              kind: 'gain_life',
              amount: { kind: 'number', value: 3 },
            }),
          ],
        }),
      ])
    );
  });

  it('parses Selesnya Eulogist exile-then-populate into ordered steps', () => {
    const ir = parseOracleTextToIR(
      'Exile target creature card from a graveyard, then populate.',
      'Selesnya Eulogist'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        what: { kind: 'raw', text: 'target creature card from a graveyard' },
      }),
      expect.objectContaining({
        kind: 'populate',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
      }),
    ]);
  });

  it('parses Selfless Exorcist exile plus moved-card power damage follow-up', () => {
    const ir = parseOracleTextToIR(
      '{T}: Exile target creature card from a graveyard. That card deals damage equal to its power to this creature.',
      'Selfless Exorcist'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        what: { kind: 'raw', text: 'target creature card from a graveyard' },
      }),
      expect.objectContaining({
        kind: 'deal_damage',
        amount: { kind: 'unknown', raw: 'its power' },
        target: { kind: 'raw', text: 'this creature' },
      }),
    ]);
  });

  it('parses Morbid Bloom exile-then-token-count from exiled toughness', () => {
    const ir = parseOracleTextToIR(
      "Exile target creature card from a graveyard, then create X 1/1 green Saproling creature tokens, where X is the exiled card's toughness.",
      'Morbid Bloom'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        what: { kind: 'raw', text: 'target creature card from a graveyard' },
      }),
      expect.objectContaining({
        kind: 'create_token',
        amount: { kind: 'x' },
        token: '1/1 green Saproling',
      }),
    ]);
  });

  it('parses Lara Croft, Tomb Raider exile plus discovery-counter follow-up into ordered steps', () => {
    const ir = parseOracleTextToIR(
      'Whenever Lara Croft attacks, exile up to one target legendary artifact card or legendary land card from a graveyard and put a discovery counter on it.',
      'Lara Croft, Tomb Raider'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        what: { kind: 'raw', text: 'up to one target legendary artifact card or legendary land card from a graveyard' },
      }),
      expect.objectContaining({
        kind: 'add_counter',
        counter: 'discovery',
        amount: { kind: 'number', value: 1 },
        target: { kind: 'raw', text: 'it' },
      }),
    ]);
  });

  it('parses The Animus graveyard target with a memory counter requirement', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your end step, exile up to one target legendary creature card from a graveyard with a memory counter on it.',
      'The Animus'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        what: { kind: 'raw', text: 'up to one target legendary creature card from a graveyard with a memory counter on it' },
      }),
    ]);
  });

  it('parses Mirror Golem imprint text into a triggered exile step', () => {
    const ir = parseOracleTextToIR(
      `Imprint — When this creature enters, you may exile target card from a graveyard.
This creature has protection from each of the exiled card's card types. (Artifact, battle, creature, enchantment, instant, kindred, land, planeswalker, and sorcery are card types.)`,
      'Mirror Golem'
    );

    const triggered = ir.abilities.find((ability: any) => ability.type === 'triggered');
    expect(triggered?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        optional: true,
        what: { kind: 'raw', text: 'target card from a graveyard' },
      }),
    ]);
  });

  it("parses Mourner's Shield into an activated prevent-damage step", () => {
    const ir = parseOracleTextToIR(
      `Imprint — When this artifact enters, you may exile target card from a graveyard.
{2}, {T}: Prevent all damage that would be dealt this turn by target source of your choice that shares a color with the exiled card.`,
      "Mourner's Shield"
    );

    const activated = ir.abilities.find((ability: any) => ability.type === 'activated');
    expect(activated?.steps).toEqual([
      expect.objectContaining({
        kind: 'prevent_damage',
        amount: 'all',
        duration: 'this_turn',
        sharesColorWithLinkedExiledCard: true,
      }),
    ]);
  });

  it('parses Psionic Ritual into exile plus copied-spell replay steps', () => {
    const ir = parseOracleTextToIR(
      'Exile target instant or sorcery card from a graveyard and copy it. You may cast the copy without paying its mana cost.',
      'Psionic Ritual'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        what: { kind: 'raw', text: 'target instant or sorcery card from a graveyard' },
      }),
      expect.objectContaining({
        kind: 'copy_spell',
        subject: 'last_moved_card',
        optional: true,
        withoutPayingManaCost: true,
      }),
    ]);
  });

  it('parses Ashcloud Phoenix into a face-down battlefield return step', () => {
    const ir = parseOracleTextToIR(
      'When this creature dies, return it to the battlefield face down under your control.',
      'Ashcloud Phoenix'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        what: { kind: 'raw', text: 'it' },
        to: 'battlefield',
        battlefieldController: { kind: 'you' },
        entersFaceDown: true,
      }),
    ]);
  });

  it('parses Missy into a tapped face-down battlefield return step', () => {
    const ir = parseOracleTextToIR(
      'Whenever another nonartifact creature dies, return it to the battlefield under your control face down and tapped.',
      'Missy'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        what: { kind: 'raw', text: 'it' },
        to: 'battlefield',
        battlefieldController: { kind: 'you' },
        entersFaceDown: true,
        entersTapped: true,
      }),
    ]);
  });

  it('parses Yarus into a conditional face-down return followed by a turn-face-up step', () => {
    const ir = parseOracleTextToIR(
      "Whenever a face-down creature you control dies, return it to the battlefield face down under its owner's control if it's a permanent card, then turn it face up.",
      'Yarus, Roar of the Old Gods'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: "it's a permanent card" },
        steps: [
          expect.objectContaining({
            kind: 'move_zone',
            what: { kind: 'raw', text: 'it' },
            to: 'battlefield',
            battlefieldController: { kind: 'owner_of_moved_cards' },
            entersFaceDown: true,
          }),
        ],
      }),
      expect.objectContaining({
        kind: 'turn_face_up',
        target: { kind: 'raw', text: 'it' },
      }),
    ]);
  });

});
