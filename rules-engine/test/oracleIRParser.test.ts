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

  it('parses Myr Battlesphere into tap-count plus conditional buff-and-damage steps', () => {
    const text =
      'Whenever Myr Battlesphere attacks, you may tap X untapped Myr you control. If you do, Myr Battlesphere gets +X/+0 until end of turn and deals X damage to defending player.';

    const ir = parseOracleTextToIR(text, 'Myr Battlesphere');
    const steps = ir.abilities[0]?.steps as any[];

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      kind: 'tap_matching_permanents',
      who: { kind: 'you' },
      amount: { kind: 'x' },
      filter: 'Myr',
      optional: true,
    });
    expect(steps[1]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you do' },
    });
    expect(steps[1].steps).toHaveLength(2);
    expect(steps[1].steps[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'this permanent' },
      power: 1,
      toughness: 0,
      powerUsesX: true,
      condition: { kind: 'where', raw: 'x is the number of myr tapped this way' },
    });
    expect(steps[1].steps[1]).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'unknown', raw: 'the number of myr tapped this way' },
      target: { kind: 'raw', text: 'defending player' },
    });
  });

  it('parses Disturb keyword lines into graveyard-cast permission plus transformed-entry metadata', () => {
    const ir = parseOracleTextToIR('Disturb {1}{W}', 'Benevolent Geist');
    const steps = ir.abilities[0]?.steps as any[];

    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'grant_graveyard_permission',
          who: { kind: 'you' },
          permission: 'cast',
          what: { kind: 'raw', text: 'this card' },
        }),
        expect.objectContaining({
          kind: 'modify_graveyard_permissions',
          castCostRaw: '{1}{W}',
        }),
        expect.objectContaining({
          kind: 'modify_graveyard_permissions',
          entersBattlefieldTransformed: true,
        }),
      ])
    );
  });

  it("parses Autumn's Veil into turn-scoped spell protection and creature targeting protection", () => {
    const ir = parseOracleTextToIR(
      "Spells you control can't be countered by blue or black spells this turn, and creatures you control can't be the targets of blue or black spells this turn.",
      "Autumn's Veil",
    );
    const steps = ir.abilities[0]?.steps as any[];

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      kind: 'grant_future_spell_effect',
      who: { kind: 'you' },
      duration: 'this_turn',
      scope: 'all_qualifying_spells',
      counterImmunity: { counterSourceColors: ['U', 'B'] },
    });
    expect(steps[1]).toMatchObject({
      kind: 'grant_temporary_ability',
      target: { kind: 'raw', text: 'creatures you control' },
      duration: 'this_turn',
      effectText: ["can't be the targets of blue or black spells this turn"],
    });
  });

  it('parses Savage Summoning into a next-creature future spell effect bundle', () => {
    const ir = parseOracleTextToIR(
      'Flash. The next creature spell you cast this turn can be cast as though it had flash. That spell can\'t be countered. That creature enters with an additional +1/+1 counter on it.',
      'Savage Summoning',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps) as any[];
    const futureSpellStep = steps.find((step) => step.kind === 'grant_future_spell_effect');

    expect(futureSpellStep).toMatchObject({
      who: { kind: 'you' },
      duration: 'this_turn',
      scope: 'next_qualifying_spell',
      spellFilter: { cardTypes: ['creature'] },
      timingPermission: 'as_though_flash',
      counterImmunity: { unconditional: true },
      castedPermanentEntersWithCounters: { '+1/+1': 1 },
    });
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

    expect(ir.abilities).toHaveLength(2);
    expect(ir.keywords).toContain('firebending');

    const exileStep = ir.abilities[0].steps[0] as any;
    expect(exileStep.kind).toBe('move_zone');
    expect(exileStep.what).toEqual({ kind: 'raw', text: 'target card from a graveyard' });
    expect(exileStep.to).toBe('exile');

    const attackPermission = ir.abilities[1].steps[0] as any;
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

  it('prunes firebending reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Firebending 1 (Whenever this creature attacks, add {R}. This mana lasts until end of combat.)',
      'Fire Sages'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('firebending');
  });

  it('prunes nonnumeric firebending reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      "Firebending X, where X is this creature's power. (Whenever this creature attacks, add X {R}. This mana lasts until end of combat.)",
      'Fire Sages'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('firebending');
  });

  it('prunes embedded firebending reminder tail shards from token clauses', () => {
    const ir = parseOracleTextToIR(
      'Create a 2/2 red Soldier creature token with firebending 1. (Whenever a creature with firebending 1 attacks, add {R}. This mana lasts until end of combat.)',
      'Fire Nation Attacks'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0].steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'create_token',
          raw: 'Create a 2/2 red Soldier creature token with firebending 1',
        }),
      ])
    );
    expect(
      ir.abilities[0].steps.some(
        (step: any) => step.kind === 'unknown' && /this mana lasts until end of combat/i.test(String(step.raw || ''))
      )
    ).toBe(false);
  });

  it('prunes waterbend reminder shards while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Waterbend {2}: This creature gets +1/+1 until end of turn. Activate only during your turn. (While paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}.)',
      'Ruthless Waterbender'
    );

    expect(ir.keywords).toContain('waterbend');
    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'modify_pt',
        raw: 'This creature gets +1/+1 until end of turn',
      }),
    ]);
  });

  it('prunes earthbend reminder shards while keeping the core earthbend step visible', () => {
    const ir = parseOracleTextToIR(
      'When this creature dies, earthbend 2. (Target land you control becomes a 0/0 creature with haste that\'s still a land. Put two +1/+1 counters on it. When it dies or is exiled, return it to the battlefield tapped.)',
      'Earth Village Ruffians'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'unknown',
        raw: 'earthbend 2',
      }),
    ]);
  });

  it('prunes split Powerstone reminder tails after token creation', () => {
    const ir = parseOracleTextToIR(
      'Create a tapped Powerstone token. (It\'s an artifact with "{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.")',
      'Koilos Roc'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'create_token',
        token: 'Powerstone',
      }),
    ]);
  });

  it('prunes wither reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Wither (This deals damage to creatures in the form of -1/-1 counters.)',
      'Twinblade Slasher'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('wither');
  });

  it('prunes station reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 9+.)",
      'Wedgelight Rammer'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('station');
  });

  it('prunes saddle reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Saddle 3 (Tap any number of other creatures you control with total power 3 or more: This Mount becomes saddled until end of turn. Saddle only as a sorcery.)',
      'Caustic Bronco'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('saddle');
  });

  it('prunes mixed station sorcery-speed reminder shards from full card text', () => {
    const ir = parseOracleTextToIR(
      "When this Spacecraft enters, create a 2/2 colorless Robot artifact creature token.\nStation (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 9+.)\n9+ | Flying, first strike",
      'Wedgelight Rammer'
    );

    const rawSteps = ir.abilities.flatMap((ability) => ability.steps.map((step) => String(step.raw || '')));
    expect(rawSteps).not.toContain('Station only as a sorcery');
    expect(rawSteps).not.toContain('Station only as a sorcery.)');
  });

  it('prunes bushido reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Bushido 2 (Whenever this creature blocks or becomes blocked, it gets +2/+2 until end of turn.)',
      'Battle-Mad Ronin'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('bushido');
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
    expect(adaptStep.kind).toBe('conditional');
    expect(adaptStep.condition).toEqual({ kind: 'if', raw: 'there are no +1/+1 counters on it' });
    expect(adaptStep.steps).toEqual([
      expect.objectContaining({
        kind: 'add_counter',
        target: { kind: 'raw', text: 'this permanent' },
        counter: '+1/+1',
        amount: { kind: 'number', value: 2 },
      }),
    ]);

    const reanimateSteps = ir.abilities[2].steps as any[];
    expect(reanimateSteps).toHaveLength(3);

    expect(reanimateSteps[0].kind).toBe('move_zone');
    expect(reanimateSteps[0].what).toEqual({ kind: 'raw', text: 'a creature card exiled with this creature' });
    expect(reanimateSteps[0].to).toBe('battlefield');
    expect(reanimateSteps[0].battlefieldController).toEqual({ kind: 'you' });
    expect(reanimateSteps[0].withCounters).toEqual({ finality: 1 });

    expect(reanimateSteps[1]).toMatchObject({
      kind: 'grant_temporary_ability',
      raw: 'It gains haste',
    });

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
    expect(steps[1].kind).toBe('open_attraction');
    expect(steps[1].who).toEqual({ kind: 'you' });
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
    expect(steps[0].steps[1].amount).toEqual({ kind: 'reference_amount', raw: 'that much' });
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

  it('lowers self-win fragments inside parsed conditionals', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your upkeep, if you have exactly 1 life, you win the game.',
      'Near-Death Experience'
    );
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('conditional');
    expect(steps[0].condition).toEqual({ kind: 'if', raw: 'you have exactly 1 life' });
    expect(steps[0].steps).toEqual([
      expect.objectContaining({
        kind: 'win_game',
        raw: 'you win the game',
      }),
    ]);
  });

  it('parses standalone self-loss clauses into lose_game steps', () => {
    const ir = parseOracleTextToIR('You lose the game.', 'Last Chance');

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'lose_game',
        raw: 'You lose the game',
      }),
    ]);
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
    expect(steps[0].steps[1].amount).toEqual({ kind: 'reference_amount', raw: 'that much' });
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

  it('parses direct tap target clauses as fixed tap actions', () => {
    const text = 'Tap target creature.';
    const ir = parseOracleTextToIR(text);
    const tapStep = ir.abilities[0].steps.find(s => s.kind === 'tap_or_untap') as any;

    expect(tapStep).toBeTruthy();
    expect(tapStep.mode).toBe('tap');
    expect(tapStep.target).toEqual({ kind: 'raw', text: 'target creature' });
  });

  it('parses direct untap target clauses as fixed untap actions', () => {
    const text = 'Untap that creature.';
    const ir = parseOracleTextToIR(text);
    const untapStep = ir.abilities[0].steps.find(s => s.kind === 'tap_or_untap') as any;

    expect(untapStep).toBeTruthy();
    expect(untapStep.mode).toBe('untap');
    expect(untapStep.target).toEqual({ kind: 'raw', text: 'that creature' });
  });

  it("parses 'it doesn't untap during its controller's next untap step' into skip_next_untap", () => {
    const text = "Tap target creature. It doesn't untap during its controller's next untap step.";
    const ir = parseOracleTextToIR(text);

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'tap_or_untap',
        target: { kind: 'raw', text: 'target creature' },
        mode: 'tap',
        raw: 'Tap target creature',
      },
      {
        kind: 'skip_next_untap',
        target: { kind: 'raw', text: 'It' },
        raw: "It doesn't untap during its controller's next untap step",
      },
    ]);
  });

  it("parses 'that creature doesn't untap during its controller's next untap step' into skip_next_untap", () => {
    const text = "Tap target creature. That creature doesn't untap during its controller's next untap step.";
    const ir = parseOracleTextToIR(text);

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'tap_or_untap',
        target: { kind: 'raw', text: 'target creature' },
        mode: 'tap',
        raw: 'Tap target creature',
      },
      {
        kind: 'skip_next_untap',
        target: { kind: 'raw', text: 'That creature' },
        raw: "That creature doesn't untap during its controller's next untap step",
      },
    ]);
  });

  it('parses untap-all clauses as fixed untap actions', () => {
    const text = 'Untap all creatures you control.';
    const ir = parseOracleTextToIR(text);
    const untapStep = ir.abilities[0].steps.find(s => s.kind === 'tap_or_untap') as any;

    expect(untapStep).toBeTruthy();
    expect(untapStep.mode).toBe('untap');
    expect(untapStep.target).toEqual({ kind: 'raw', text: 'all creatures you control' });
  });

  it('parses enchanted-creature tap clauses as fixed tap actions', () => {
    const text = 'Tap enchanted creature.';
    const ir = parseOracleTextToIR(text);
    const tapStep = ir.abilities[0].steps.find(s => s.kind === 'tap_or_untap') as any;

    expect(tapStep).toBeTruthy();
    expect(tapStep.mode).toBe('tap');
    expect(tapStep.target).toEqual({ kind: 'raw', text: 'enchanted creature' });
  });

  it('parses add one mana of any color into an add_mana choice step', () => {
    const text = 'Add one mana of any color.';
    const ir = parseOracleTextToIR(text);
    const addMana = ir.abilities[0].steps.find(s => s.kind === 'add_mana') as any;

    expect(addMana).toBeTruthy();
    expect(addMana.mana).toBe('{W}');
    expect(addMana.manaOptions).toEqual(['{W}', '{U}', '{B}', '{R}', '{G}']);
  });

  it('parses choose-a-color plus chosen-color mana across the resulting abilities', () => {
    const text = 'Choose a color. Add one mana of the chosen color.';
    const ir = parseOracleTextToIR(text);
    const steps = ir.abilities.flatMap(ability => ability.steps);

    expect(steps).toEqual([
      {
        kind: 'choose_color',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        raw: 'Choose a color',
      },
      {
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: 'Add one mana of the chosen color',
      },
    ]);
  });

  it('parses add three mana of any one color into a chosen-color add_mana step', () => {
    const ir = parseOracleTextToIR('Add three mana of any one color.', 'Gilded Lotus');
    const addMana = ir.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'add_mana');

    expect(addMana).toEqual({
      kind: 'add_mana',
      who: { kind: 'you' },
      mana: '{W}{W}{W}',
      manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
      requiresChosenMana: true,
      raw: 'Add three mana of any one color',
    });
  });

  it('parses add two mana in any combination of colors into a multi-choice add_mana step', () => {
    const ir = parseOracleTextToIR('Add two mana in any combination of colors.', 'Test');
    const addMana = ir.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'add_mana');

    expect(addMana).toEqual({
      kind: 'add_mana',
      who: { kind: 'you' },
      mana: '{W}{W}',
      manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
      requiresChosenMana: true,
      raw: 'Add two mana in any combination of colors',
    });
  });

  it('lowers short self choose-a-color enters text into a choose_color step', () => {
    const ir = parseOracleTextToIR('As this creature enters, choose a color.', 'Diamond Knight');
    const chooseColorStep = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'choose_color');

    expect(chooseColorStep).toEqual({
      kind: 'choose_color',
      manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
      raw: 'As this creature enters, choose a color',
    });
  });

  it('expands chosen-color protection grants into choose_color plus a temporary ability grant', () => {
    const ir = parseOracleTextToIR(
      'Target creature you control gains protection from the color of your choice until end of turn.',
      'Redeem the Lost'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'choose_color',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        raw: 'Choose a color',
      },
      {
        kind: 'grant_temporary_ability',
        target: { kind: 'raw', text: 'Target creature you control' },
        duration: 'end_of_turn',
        abilities: ['protection from the chosen color'],
        raw: 'Target creature you control gains protection from the color of your choice until end of turn',
      },
    ]);
  });

  it('parses choose a creature type into a choose_creature_type step', () => {
    const ir = parseOracleTextToIR('Choose a creature type.', 'Test');
    const chooseTypeStep = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'choose_creature_type');

    expect(chooseTypeStep).toEqual({
      kind: 'choose_creature_type',
      raw: 'Choose a creature type',
    });
  });

  it('lowers self-entry choose-a-creature-type text into a choose_creature_type step', () => {
    const ir = parseOracleTextToIR('As this enchantment enters, choose a creature type.', 'Kindred Discovery');
    const chooseTypeStep = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'choose_creature_type');

    expect(chooseTypeStep).toEqual({
      kind: 'choose_creature_type',
      raw: 'As this enchantment enters, choose a creature type',
    });
  });

  it('parses choose a card name into a choose_card_name step', () => {
    const ir = parseOracleTextToIR('Choose a card name.', 'Test');
    const chooseCardNameStep = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'choose_card_name');

    expect(chooseCardNameStep).toEqual({
      kind: 'choose_card_name',
      raw: 'Choose a card name',
    });
  });

  it('lowers gift promise clauses into an optional choose_opponent step', () => {
    const ir = parseOracleTextToIR(
      'Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)',
      'Wildfire Howl'
    );

    expect(ir.keywords).toContain('gift');
    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'choose_opponent',
        optional: true,
      }),
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you do' },
      }),
    ]);
  });

  it('lowers hidden agenda name choice and prunes the reveal reminder tail', () => {
    const ir = parseOracleTextToIR(
      'Hidden agenda (Start the game with this conspiracy face down in the command zone and secretly choose a card name. You may turn this conspiracy face up any time and reveal that name.)',
      "Muzzio's Preparations"
    );

    expect(ir.keywords).toContain('hidden agenda');
    expect(ir.abilities).toEqual([
      expect.objectContaining({
        steps: [
          expect.objectContaining({ kind: 'choose_card_name' }),
        ],
      }),
    ]);

    const stepRaws = ir.abilities.flatMap(ability => ability.steps.map(step => String(step.raw || '')));
    expect(stepRaws.some(raw => /turn this conspiracy face up any time and reveal that name/i.test(raw))).toBe(false);
  });

  it('parses choose target creature into a choose_target_creature step', () => {
    const ir = parseOracleTextToIR('Choose target creature.', 'Arcbond');
    const chooseTargetStep = ir.abilities.flatMap(ability => ability.steps).find(step => step.kind === 'choose_target_creature');

    expect(chooseTargetStep).toEqual({
      kind: 'choose_target_creature',
      target: { kind: 'raw', text: 'target creature' },
      raw: 'Choose target creature',
    });
  });

  it('parses Class level bars into gain_class_level steps', () => {
    const ir = parseOracleTextToIR(
      "(Gain the next level as a sorcery to add its ability.)\nWhen Stormchaser's Talent enters, draw a card.\n{1}{U}: Level 2\nWhen this Class becomes level 2, return up to one target noncreature, nonland permanent to its owner's hand.\n{3}{U}: Level 3\nWhenever you cast an instant or sorcery spell, create a 1/1 blue and red Otter creature token with prowess.",
      "Stormchaser's Talent"
    );
    const classLevelSteps = ir.abilities
      .flatMap(ability => ability.steps)
      .filter((step: any) => step.kind === 'gain_class_level');

    expect(classLevelSteps).toEqual([
      { kind: 'gain_class_level', level: 2, raw: 'Level 2' },
      { kind: 'gain_class_level', level: 3, raw: 'Level 3' },
    ]);
  });

  it('prunes standalone cast additional-cost text while keeping the spell effect steps', () => {
    const ir = parseOracleTextToIR(
      'As an additional cost to cast this spell, sacrifice a creature. Draw two cards.',
      'Village Rites'
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps);

    expect(steps.some((step) => step.kind === 'unknown' && /additional cost to cast this spell/i.test(String((step as any).raw || '')))).toBe(false);
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
      }),
    ]);
  });

  it('parses battlefield tutors that enter tapped and shuffle', () => {
    const text = 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.';
    const ir = parseOracleTextToIR(text);

    expect(ir.abilities[0].steps).toEqual([
      {
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: 'basic land' },
        destination: 'battlefield',
        entersTapped: true,
        maxResults: 1,
        revealFound: false,
        raw: 'Search your library for a basic land card, put it onto the battlefield tapped',
      },
      {
        kind: 'shuffle_library',
        who: { kind: 'you' },
        raw: 'then shuffle',
        sequence: 'then',
      },
    ]);
  });

  it('parses plural battlefield tutors that put two lands onto the battlefield tapped and shuffle', () => {
    const text = 'Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.';
    const ir = parseOracleTextToIR(text);

    expect(ir.abilities[0].steps).toEqual([
      {
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: 'basic land' },
        destination: 'battlefield',
        entersTapped: true,
        maxResults: 2,
        revealFound: false,
        raw: 'Search your library for up to two basic land cards, put them onto the battlefield tapped',
      },
      {
        kind: 'shuffle_library',
        who: { kind: 'you' },
        raw: 'then shuffle',
        sequence: 'then',
      },
    ]);
  });

  it('parses reveal-shuffle tutors that put the found card on top of the library', () => {
    const text = 'Search your library for a Merfolk card, reveal it, then shuffle and put that card on top.';
    const ir = parseOracleTextToIR(text);

    expect(ir.abilities[0].steps).toEqual([
      {
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: 'Merfolk' },
        destination: 'top',
        revealFound: true,
        shuffle: true,
        maxResults: 1,
        raw: 'Search your library for a Merfolk card, reveal it, then shuffle and put that card on top',
      },
    ]);
  });

  it('parses non-reveal shuffle tutors that put the found card on top of the library', () => {
    const text = 'Search your library for a card, then shuffle and put that card on top.';
    const ir = parseOracleTextToIR(text);

    expect(ir.abilities[0].steps).toEqual([
      {
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: '' },
        destination: 'top',
        shuffle: true,
        maxResults: 1,
        raw: 'Search your library for a card, then shuffle and put that card on top',
      },
    ]);
  });

  it('merges may-search triggered clauses that shuffle and put the found card on top', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, you may search your library for a Merfolk card, reveal it, then shuffle and put that card on top.',
      'Merrow Harbinger'
    );

    expect(ir.abilities[0]).toEqual(
      expect.objectContaining({
        type: 'triggered',
        steps: [
          expect.objectContaining({
            kind: 'search_library',
            criteria: { kind: 'raw', text: 'Merfolk' },
            destination: 'top',
            revealFound: true,
            shuffle: true,
            optional: true,
            maxResults: 1,
          }),
        ],
      })
    );
    expect(
      ir.abilities[0]?.steps.some(
        (step: any) => step.kind === 'unknown' && String(step?.raw || '').includes('then shuffle and put that card on top')
      )
    ).toBe(false);
  });

  it('parses standalone shuffle your library clauses', () => {
    const text = 'Shuffle your library.';
    const ir = parseOracleTextToIR(text);

    expect(ir.abilities[0].steps).toEqual([
      {
        kind: 'shuffle_library',
        who: { kind: 'you' },
        raw: 'Shuffle your library',
      },
    ]);
  });

  it('parses self-shuffle into owner library clauses into move_zone steps', () => {
    const ir = parseOracleTextToIR(
      "Put X -1/-1 counters on each creature. Shuffle Black Sun's Zenith into its owner's library.",
      "Black Sun's Zenith"
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'add_counter',
        raw: 'Put X -1/-1 counters on each creature',
      }),
      expect.objectContaining({
        kind: 'move_zone',
        what: { kind: 'raw', text: 'this permanent' },
        to: 'library',
        toRaw: "its owner's library",
        raw: "Shuffle this permanent into its owner's library",
      }),
    ]);
  });

  it('prunes embedded manifest-dread reminder tails after later follow-up expansion', () => {
    const ir = parseOracleTextToIR(
      "When this Equipment enters, manifest dread, then attach this Equipment to that creature. (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)",
      'Conductive Machete'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'manifest_dread',
        raw: 'manifest dread',
      }),
      expect.objectContaining({
        kind: 'attach',
        raw: 'attach this Equipment to that creature',
      }),
    ]);
    expect(
      ir.abilities[0]?.steps.some((step: any) => /turn it face up any time/i.test(String(step?.raw || '')))
    ).toBe(false);
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

  it('parses bare investigate keyword clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Investigate.', 'Thraben Cluekeeper');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'investigate',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
      }),
    ]);
  });

  it('merges investigate followups into the same ability when split across sentences', () => {
    const ir = parseOracleTextToIR('Draw a card. Investigate.', 'Case File');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0].steps.map((step) => step.kind)).toEqual(['draw', 'investigate']);
  });

  it('parses bare populate keyword clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Populate.', 'Selesnya Orders');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'populate',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
      }),
    ]);
  });

  it('parses bare goad keyword clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Goad target creature.', 'Agitator Antenna');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'goad',
        target: { kind: 'raw', text: 'target creature' },
      }),
    ]);
  });

  it('parses bare suspect keyword clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Suspect target creature.', 'Case Cracker');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'suspect',
        target: { kind: 'raw', text: 'target creature' },
      }),
    ]);
  });

  it('parses detain target permanent into an executable step', () => {
    const ir = parseOracleTextToIR('Detain target permanent.', 'Azorius Arrester');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'detain',
        target: { kind: 'raw', text: 'target permanent' },
      }),
    ]);
  });

  it('parses bare monstrosity keyword clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Monstrosity 3.', 'Hundred-Handed One');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'monstrosity',
        target: { kind: 'raw', text: 'this permanent' },
        amount: { kind: 'number', value: 3 },
      }),
    ]);
  });

  it('parses bare endure keyword clauses into a choose-one modal step', () => {
    const ir = parseOracleTextToIR('Endure 2.', 'Wary Watchdog');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 1,
        modes: [
          expect.objectContaining({
            label: 'Put 2 +1/+1 counters on this permanent',
          }),
          expect.objectContaining({
            label: 'Create a 2/2 white Spirit creature token',
          }),
        ],
      }),
    ]);
  });

  it('parses exert attack clauses into executable exert steps', () => {
    const ir = parseOracleTextToIR('You may exert this creature as it attacks.', 'Gust Walker');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'exert',
        optional: true,
        target: { kind: 'raw', text: 'this creature' },
      }),
    ]);
  });

  it('parses standalone open an Attraction keyword lines into executable steps', () => {
    const ir = parseOracleTextToIR('Open an Attraction.', 'Scavenger Hunt');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'open_attraction',
        who: { kind: 'you' },
      }),
    ]);
  });

  it('parses roll to visit your Attractions keyword lines into executable steps', () => {
    const ir = parseOracleTextToIR('Roll to visit your Attractions.', 'Park Map');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'roll_visit_attractions',
        who: { kind: 'you' },
      }),
    ]);
  });

  it('parses take the initiative keyword lines into executable steps', () => {
    const ir = parseOracleTextToIR('Take the initiative.', 'White Plume Adventurer');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'take_initiative',
        who: { kind: 'you' },
      }),
    ]);
  });

  it('parses become the monarch clauses into executable steps', () => {
    const ir = parseOracleTextToIR('When this enchantment enters, you become the monarch.', 'Grave Venerations');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'become_monarch',
        who: { kind: 'you' },
      }),
    ]);
  });

  it('parses venture into the dungeon keyword lines into executable steps', () => {
    const ir = parseOracleTextToIR('Venture into the dungeon.', 'Triumphant Adventurer');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'venture_into_dungeon',
        who: { kind: 'you' },
      }),
    ]);
  });

  it('parses planeswalk clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Planeswalk.', 'Spatial Merging');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'planeswalk',
        who: { kind: 'you' },
      }),
    ]);
  });

  it('parses assemble contraption clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Assemble a Contraption.', 'Finders, Keepers');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'assemble',
        who: { kind: 'you' },
      }),
    ]);
  });

  it('parses regenerate clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Regenerate target artifact.', 'Welding Jar');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'regenerate',
        target: { kind: 'raw', text: 'target artifact' },
      }),
    ]);
  });

  it("merges destroy followups that say the target can't be regenerated", () => {
    const ir = parseOracleTextToIR("Destroy target creature. It can't be regenerated. Draw a card.", 'Terror Test');
    const steps = ir.abilities[0].steps as any[];

    expect(steps[0]).toMatchObject({
      kind: 'destroy',
      target: { kind: 'raw', text: 'target creature' },
      cantBeRegenerated: true,
    });
    expect(String(steps[0].raw || '')).toContain("can't be regenerated");
    expect(steps[1]).toMatchObject({
      kind: 'draw',
      amount: { kind: 'number', value: 1 },
    });
  });

  it('parses abandon this scheme clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Abandon this scheme.', 'Dark Wings Bring Your Downfall');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'abandon_scheme',
        target: { kind: 'raw', text: 'this scheme' },
      }),
    ]);
  });

  it('parses set-that-scheme-in-motion-again clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Set that scheme in motion again.', 'My Laughter Echoes');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'set_in_motion',
        target: { kind: 'raw', text: 'that scheme' },
      }),
    ]);
  });

  it('parses bare incubate keyword clauses into executable steps', () => {
    const ir = parseOracleTextToIR('Incubate 2.', 'Norns Inquisitor');

    expect(ir.abilities[0].steps).toEqual([
      expect.objectContaining({
        kind: 'create_token',
        token: 'Incubator',
        withCounters: { '+1/+1': 2 },
      }),
    ]);
  });

  it('parses Amass keyword lines into conditional token creation plus counters', () => {
    const ir = parseOracleTextToIR('Amass 2', 'Lazotep Convert');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: "you don't control an Army creature" },
        steps: [
          {
            kind: 'create_token',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            token: '0/0 black Zombie Army',
            raw: 'create a 0/0 black Zombie Army creature token',
          },
        ],
        raw: "If you don't control an Army creature, create a 0/0 black Zombie Army creature token",
      },
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 2 },
        counter: '+1/+1',
        target: { kind: 'raw', text: 'Army creature you control' },
        raw: 'Put 2 +1/+1 counters on an Army creature you control',
      },
    ]);
  });

  it('parses Amass Orcs keyword lines into counters plus subtype addition', () => {
    const ir = parseOracleTextToIR('Amass Orcs 2', 'Orc Muster');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: "you don't control an Army creature" },
        steps: [
          {
            kind: 'create_token',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            token: '0/0 black Orc Army',
            raw: 'create a 0/0 black Orc Army creature token',
          },
        ],
        raw: "If you don't control an Army creature, create a 0/0 black Orc Army creature token",
      },
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 2 },
        counter: '+1/+1',
        target: { kind: 'raw', text: 'Army creature you control' },
        raw: 'Put 2 +1/+1 counters on an Army creature you control',
      },
      {
        kind: 'add_types',
        target: { kind: 'raw', text: 'Army creature you control' },
        addTypes: ['Orc'],
        raw: "If it isn't an Orc, it becomes an Orc in addition to its other types",
      },
    ]);
  });

  it('parses reminder-bearing Amass Orcs lines into counters plus subtype addition', () => {
    const ir = parseOracleTextToIR(
      "Amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)",
      "Saruman's Trickery"
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: "you don't control an Army creature" },
        steps: [
          {
            kind: 'create_token',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            token: '0/0 black Orc Army',
            raw: 'create a 0/0 black Orc Army creature token',
          },
        ],
        raw: "If you don't control an Army creature, create a 0/0 black Orc Army creature token",
      },
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 1 },
        counter: '+1/+1',
        target: { kind: 'raw', text: 'Army creature you control' },
        raw: 'Put 1 +1/+1 counter on an Army creature you control',
      },
      {
        kind: 'add_types',
        target: { kind: 'raw', text: 'Army creature you control' },
        addTypes: ['Orc'],
        raw: "If it isn't an Orc, it becomes an Orc in addition to its other types",
      },
    ]);
  });

  it('lowers triggered amass orcs reminder lines into the canonical amass steps', () => {
    const ir = parseOracleTextToIR(
      "When this creature dies, amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)",
      'Easterling Vanguard'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: "you don't control an Army creature" },
        steps: [
          {
            kind: 'create_token',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            token: '0/0 black Orc Army',
            raw: 'create a 0/0 black Orc Army creature token',
          },
        ],
        raw: "If you don't control an Army creature, create a 0/0 black Orc Army creature token",
      },
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 1 },
        counter: '+1/+1',
        target: { kind: 'raw', text: 'Army creature you control' },
        raw: 'Put 1 +1/+1 counter on an Army creature you control',
      },
      {
        kind: 'add_types',
        target: { kind: 'raw', text: 'Army creature you control' },
        addTypes: ['Orc'],
        raw: "If it isn't an Orc, it becomes an Orc in addition to its other types",
      },
    ]);
  });

  it('prunes standalone amass subtype reminder shards from variable amass clauses', () => {
    const ir = parseOracleTextToIR(
      "Whenever you cast your second spell each turn, amass Orcs X, where X is that spell's mana value. (Put X +1/+1 counters on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)",
      'Saruman, the White Hand'
    );

    expect(
      ir.abilities.flatMap((ability) => ability.steps.map((step) => String(step.raw || '').trim()))
    ).not.toContain("It's also an Orc");
  });

  it('parses Explore keyword lines into an executable explore step', () => {
    const ir = parseOracleTextToIR('Explore', 'Jadelight Ranger');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'explore',
        target: { kind: 'raw', text: 'this creature' },
        raw: 'Explore',
      },
    ]);
  });

  it('parses subject-form explore clauses and prunes the printed reminder text', () => {
    const ir = parseOracleTextToIR(
      "When this creature enters, it explores. (Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on this creature, then put the card back or put it into your graveyard.)",
      'Merfolk Branchwalker'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'explore',
        target: { kind: 'raw', text: 'this creature' },
        raw: 'it explores',
      },
    ]);
  });

  it('parses repeated explore clauses and prunes the reminder repeat tail', () => {
    const ir = parseOracleTextToIR(
      "When this creature enters, it explores, then it explores again. (Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on this creature, then put the card back or put it into your graveyard. Then repeat this process.)",
      'Jadelight Ranger'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'explore',
        target: { kind: 'raw', text: 'this creature' },
        raw: 'it explores',
      },
      {
        kind: 'explore',
        target: { kind: 'raw', text: 'this creature' },
        sequence: 'then',
        raw: 'it explores again',
      },
    ]);
  });

  it('parses Manifest keyword lines into a face-down battlefield move', () => {
    const ir = parseOracleTextToIR('Manifest the top card of your library.', 'Whisperwood Elemental');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'the top card of your library' },
        to: 'battlefield',
        toRaw: 'battlefield face down',
        entersFaceDown: true,
        raw: 'Manifest the top card of your library',
      },
    ]);
  });

  it("parses Manifest keyword lines into a face-down battlefield move from that player's library", () => {
    const ir = parseOracleTextToIR("Manifest the top card of that player's library.", 'Thieving Amalgam');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: "the top card of that player's library" },
        to: 'battlefield',
        toRaw: 'battlefield face down',
        entersFaceDown: true,
        raw: "Manifest the top card of that player's library",
      },
    ]);
  });

  it('parses Learn keyword lines into an executable learn step', () => {
    const ir = parseOracleTextToIR('Learn', 'Professor of Symbology');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'learn',
        who: { kind: 'you' },
        raw: 'Learn',
      },
    ]);
  });

  it('parses villainous choice text into a choose-one modal step', () => {
    const ir = parseOracleTextToIR(
      'Target opponent faces a villainous choice — You draw a card, or that player loses 3 life.',
      'Choice Test'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 1,
        modes: [
          {
            label: 'You draw a card',
            raw: 'You draw a card',
            steps: [
              {
                kind: 'draw',
                who: { kind: 'you' },
                amount: { kind: 'number', value: 1 },
                raw: 'You draw a card',
              },
            ],
          },
          {
            label: 'that player loses 3 life',
            raw: 'that player loses 3 life',
            steps: [
              {
                kind: 'lose_life',
                who: { kind: 'target_player' },
                amount: { kind: 'number', value: 3 },
                raw: 'that player loses 3 life',
              },
            ],
          },
        ],
        raw: 'Target opponent faces a villainous choice - You draw a card, or that player loses 3 life',
      },
    ]);
  });

  it('parses Manifest dread keyword lines into an executable manifest-dread step', () => {
    const ir = parseOracleTextToIR('Manifest dread', 'Abhorrent Oculus');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'manifest_dread',
        who: { kind: 'you' },
        raw: 'Manifest dread',
      },
    ]);
  });

  it('parses Cloak-the-top-card keyword lines into an executable face-down move step', () => {
    const ir = parseOracleTextToIR('Cloak the top card of your library', 'Cryptic Coat');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'the top card of your library' },
        to: 'battlefield',
        toRaw: 'battlefield face down',
        entersFaceDown: true,
        faceDownWardCost: '{2}',
        raw: 'Cloak the top card of your library',
      },
    ]);
  });

  it("parses Cloak-the-top-card keyword lines into an executable face-down move step from that player's library", () => {
    const ir = parseOracleTextToIR("Cloak the top card of that player's library.", 'Etrata, Deadly Fugitive');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: "the top card of that player's library" },
        to: 'battlefield',
        toRaw: 'battlefield face down',
        entersFaceDown: true,
        faceDownWardCost: '{2}',
        raw: "Cloak the top card of that player's library",
      },
    ]);
  });

  it('prunes manifest reminder-only pseudo-steps from full reminder text', () => {
    const ir = parseOracleTextToIR(
      "Manifest the top card of your library. (To manifest a card, put it onto the battlefield face down as a 2/2 creature. Turn it face up any time for its mana cost if it's a creature card.)",
      'Soul Summons'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'the top card of your library' },
        to: 'battlefield',
        toRaw: 'battlefield face down',
        entersFaceDown: true,
        raw: 'Manifest the top card of your library',
      },
    ]);
  });

  it('prunes short manifest face-up reminder tails when the manifest move is already parsed', () => {
    const ir = parseOracleTextToIR(
      "Manifest the top card of your library. (Turn it face up any time for its mana cost if it's a creature card.)",
      'Whisperwood Elemental'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'the top card of your library' },
        to: 'battlefield',
        toRaw: 'battlefield face down',
        entersFaceDown: true,
        raw: 'Manifest the top card of your library',
      },
    ]);
  });

  it('prunes cloak reminder-only pseudo-steps from full reminder text', () => {
    const ir = parseOracleTextToIR(
      "Cloak the top card of your library. (To cloak a card, put it onto the battlefield face down as a 2/2 creature with ward {2}. Turn it face up any time for its mana cost if it's a creature card.)",
      'Cryptic Coat'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'the top card of your library' },
        to: 'battlefield',
        toRaw: 'battlefield face down',
        entersFaceDown: true,
        faceDownWardCost: '{2}',
        raw: 'Cloak the top card of your library',
      },
    ]);
  });

  it('prunes manifest dread reminder-only pseudo-steps from full reminder text', () => {
    const ir = parseOracleTextToIR(
      'Manifest dread. (Look at the top two cards of your library. Manifest one of them, then put the rest into your graveyard.)',
      'Abhorrent Oculus'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'manifest_dread',
        who: { kind: 'you' },
        raw: 'Manifest dread',
      },
    ]);
  });

  it('prunes triggered manifest dread reminder tails from inline full reminder text', () => {
    const ir = parseOracleTextToIR(
      "When this creature attacks, manifest dread. (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)",
      'Hauntwoods Shrieker'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'manifest_dread',
        who: { kind: 'you' },
        raw: 'manifest dread',
      },
    ]);
  });

  it('prunes cipher reminder-only abilities while keeping the cipher keyword', () => {
    const ir = parseOracleTextToIR(
      'Cipher (Then you may exile this card encoded on a creature you control. Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost.)',
      'Hidden Strings'
    );

    expect(ir.keywords).toContain('cipher');
    expect(ir.abilities).toEqual([]);
  });

  it('parses partner-with reminder text into a non-executable static ability without reminder steps', () => {
    const ir = parseOracleTextToIR(
      'Partner with Lore Weaver (When this creature enters the battlefield, target player may put Lore Weaver into their hand from their library, then shuffle.)',
      'Ley Weaver'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'static',
      effectText: '',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('parses top-of-library visibility text into a non-executable static ability without reminder steps', () => {
    const ir = parseOracleTextToIR('You may look at the top card of your library any time.', 'Mystic Forge');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'static',
      effectText: '',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('prunes split Map-token reminder steps from create-token abilities', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, create a Map token. (It\'s an artifact with "{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery.")',
      'Topography Tracker'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        token: 'Map',
        raw: 'create a Map token',
      },
    ]);
  });

  it('prunes no-maximum-hand-size static text as externally handled', () => {
    const ir = parseOracleTextToIR('You have no maximum hand size.', 'Reliquary Tower');

    expect(ir.abilities).toEqual([]);
  });

  it('prunes additional-land-play static text as externally handled', () => {
    const ir = parseOracleTextToIR('You may play an additional land on each of your turns.', 'Exploration');

    expect(ir.abilities).toEqual([]);
  });

  it('prunes global creature stat static text as externally handled', () => {
    const ir = parseOracleTextToIR('Creatures you control get +1/+1.', "Gaea's Anthem");

    expect(ir.abilities).toEqual([]);
  });

  it('prunes global creature keyword static text as externally handled', () => {
    const ir = parseOracleTextToIR('Creatures you control have haste.', 'Hammer of Purphoros');

    expect(ir.abilities).toEqual([]);
  });

  it('prunes opening-hand static text as externally handled', () => {
    const ir = parseOracleTextToIR(
      'If this card is in your opening hand, you may begin the game with it on the battlefield.\nYou have hexproof. (You can\'t be the target of spells or abilities your opponents control.)',
      'Leyline of Sanctity'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('hexproof');
  });

  it('prunes extort reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Defender\nExtort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)',
      'Basilica Guards'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('extort');
  });

  it('prunes squad reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Squad {2} (As an additional cost to cast this spell, you may pay {2} any number of times. When this creature enters, create that many tokens that are copies of it.)',
      'Wasteland Raider'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('squad');
  });

  it('prunes umbra armor reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Umbra armor (If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura.)',
      'Hyena Umbra'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('umbra armor');
  });

  it('prunes unleash reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      "Unleash (You may have this creature enter with a +1/+1 counter on it. It can't block as long as it has a +1/+1 counter on it.)",
      'Carnage Gladiator'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('unleash');
  });

  it('prunes riot reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Riot (This creature enters with your choice of a +1/+1 counter or haste.)',
      'Gruul Initiate'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('riot');
  });

  it('prunes ravenous reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Ravenous (This creature enters with X +1/+1 counters on it. If X is 5 or more, draw a card when it enters.)',
      'Tyranid Ravener'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('ravenous');
  });

  it('prunes bloodthirst reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Bloodthirst 1 (If an opponent was dealt damage this turn, this creature enters with a +1/+1 counter on it.)',
      'Ghor-Clan Savage'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('bloodthirst');
  });

  it('prunes graft reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Graft 2 (This creature enters with two +1/+1 counters on it. Whenever another creature enters, you may move a +1/+1 counter from this creature onto it.)',
      'Plaxcaster Frogling'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('graft');
  });

  it('prunes conspire reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Conspire (As you cast this spell, you may tap two untapped creatures you control that share a color with it. When you do, copy it and you may choose a new target for the copy.)',
      'Burn Trail'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('conspire');
  });

  it('prunes enlist reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      "Enlist (As this creature attacks, you may tap a nonattacking creature you control without summoning sickness. When you do, add its power to this creature's until end of turn.)",
      'Argivian Cavalier'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('enlist');
  });

  it('prunes standalone phasing reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Phasing (This phases in or out before you untap during each of your untap steps.)',
      'Breezekeeper'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('phasing');
  });

  it('prunes phasing reminder tails while keeping the phase-out clause', () => {
    const ir = parseOracleTextToIR(
      "All nontoken permanents of that type phase out. (While they're phased out, they're treated as though they don't exist. Each one phases in before its controller untaps during their next untap step.)",
      "Teferi's Realm"
    );

    const stepRaws = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => String(step.raw || '')));
    expect(stepRaws.some((raw) => /all nontoken permanents of that type phase out/i.test(raw))).toBe(true);
    expect(stepRaws.some((raw) => /treated as though they don't exist/i.test(raw))).toBe(false);
    expect(stepRaws.some((raw) => /phases in before its controller untaps during their next untap step/i.test(raw))).toBe(false);
  });

  it('prunes hideaway reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Hideaway 4 (When this creature enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)\nThis creature enters tapped.',
      'Watcher for Tomorrow'
    );

    const stepRaws = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => String(step.raw || '')));
    expect(stepRaws.some((raw) => /hideaway 4/i.test(raw))).toBe(false);
    expect(stepRaws.some((raw) => /put the rest on the bottom in a random order/i.test(raw))).toBe(false);
    expect(ir.keywords).toContain('hideaway');
  });

  it('prunes Junk-token reminder permission tails after token creation', () => {
    const ir = parseOracleTextToIR(
      'When this Equipment enters, create a Junk token. (It\'s an artifact with "{T}, Sacrifice this token: Exile the top card of your library. You may play that card this turn. Activate only as a sorcery.")',
      'Junk Jet'
    );

    const stepRaws = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => String(step.raw || '')));
    expect(stepRaws.some((raw) => /create a Junk token/i.test(raw))).toBe(true);
    expect(stepRaws.some((raw) => /you may play that card this turn/i.test(raw))).toBe(false);
  });

  it('parses start-your-engines reminder text into a non-executable static ability without reminder steps', () => {
    const ir = parseOracleTextToIR(
      'Start your engines! (If you have no speed, it starts at 1. It can increase once on each of your turns when an opponent loses life and decreases only if you lose life. Max speed is 4.)',
      'Road Rage'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'static',
      effectText: '',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('parses max-speed lines into non-executable static abilities without reminder steps', () => {
    const ir = parseOracleTextToIR('Max speed — This creature has menace.', 'Road Rage');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'static',
      effectText: '',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('parses Forage keyword lines into a choose-mode step', () => {
    const ir = parseOracleTextToIR('Forage', 'Camellia, the Seedmiser');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 1,
        modes: [
          {
            label: 'Exile three cards from your graveyard',
            raw: 'Exile three cards from your graveyard',
            steps: [
              {
                kind: 'move_zone',
                what: { kind: 'raw', text: 'three cards from your graveyard' },
                to: 'exile',
                toRaw: 'exile',
                raw: 'Exile three cards from your graveyard',
              },
            ],
          },
          {
            label: 'Sacrifice a Food',
            raw: 'Sacrifice a Food',
            steps: [
              {
                kind: 'sacrifice',
                who: { kind: 'you' },
                what: { kind: 'raw', text: 'a Food' },
                raw: 'Sacrifice a Food',
              },
            ],
          },
        ],
        raw: 'Forage',
      },
    ]);
  });

  it('parses clash follow-up text into clash plus if-you-win conditional steps', () => {
    const ir = parseOracleTextToIR(
      'Clash with an opponent. If you win, put a +1/+1 counter on this creature.',
      "Adder-Staff Boggart"
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'clash',
        who: { kind: 'you' },
        opponent: { kind: 'target_opponent' },
        raw: 'Clash with an opponent',
      },
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you win' },
        steps: [
          {
            kind: 'add_counter',
            amount: { kind: 'number', value: 1 },
            counter: '+1/+1',
            target: { kind: 'raw', text: 'this creature' },
            raw: 'put a +1/+1 counter on this creature',
          },
        ],
        raw: 'If you win, put a +1/+1 counter on this creature',
      },
    ]);
  });

  it('parses Connive keyword lines into draw-discard-plus-counter steps', () => {
    const ir = parseOracleTextToIR('Connive 2', 'Raffine Informant');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
        raw: 'Draw 2 cards.',
      },
      {
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
        sequence: 'then',
        raw: 'Discard 2 cards.',
      },
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'a nonland card was discarded this way' },
        steps: [
          {
            kind: 'add_counter',
            target: { kind: 'raw', text: 'this creature' },
            counter: '+1/+1',
            amount: { kind: 'x' },
            raw: 'Put X +1/+1 counters on this creature, where X is the number of nonland cards discarded this way.',
          },
        ],
        raw: 'If a nonland card was discarded this way, put X +1/+1 counters on this creature, where X is the number of nonland cards discarded this way.',
      },
    ]);
  });

  it('parses subject-form connive clauses into connive steps', () => {
    const ir = parseOracleTextToIR("When this creature enters, it connives.", "Raffine's Informant");

    expect(ir.abilities).toEqual([
      {
        type: 'triggered',
        text: 'When this creature enters, it connives.',
        triggerCondition: 'this creature enters',
        effectText: 'it connives.',
        steps: [
          {
            kind: 'connive',
            target: { kind: 'raw', text: 'this creature' },
            amount: { kind: 'number', value: 1 },
            raw: 'it connives',
          },
        ],
      },
    ]);
  });

  it('parses reference-amount add-counter clauses into add_counter steps', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature deals combat damage to a player, put that many +1/+1 counters on this creature.',
      'War Elemental'
    );

    expect(ir.abilities).toEqual([
      {
        type: 'triggered',
        text: 'Whenever this creature deals combat damage to a player, put that many +1/+1 counters on this creature.',
        triggerCondition: 'this creature deals combat damage to a player',
        effectText: 'put that many +1/+1 counters on this creature.',
        steps: [
          {
            kind: 'add_counter',
            target: { kind: 'raw', text: 'this creature' },
            counter: '+1/+1',
            amount: { kind: 'reference_amount', raw: 'that many' },
            raw: 'put that many +1/+1 counters on this creature',
          },
        ],
      },
    ]);
  });

  it('parses Discover keyword lines into impulse exile plus free-cast permission', () => {
    const ir = parseOracleTextToIR('Discover 4', 'Pantlaza');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'impulse_exile_top',
        who: { kind: 'you' },
        amount: { kind: 'unknown', raw: 'until you exile a nonland card with mana value 4 or less' },
        duration: 'during_resolution',
        permission: 'cast',
        raw:
          'Exile cards from the top of your library until you exile a nonland card with mana value 4 or less. You may cast that card without paying its mana cost. Put the remaining exiled cards on the bottom of your library in a random order.',
      },
      {
        kind: 'modify_exile_permissions',
        scope: 'last_exiled_cards',
        withoutPayingManaCost: true,
        raw: 'You may cast that card without paying its mana cost.',
      },
    ]);
  });

  it('parses triggered Discover text into the same lowered discover steps', () => {
    const ir = parseOracleTextToIR('When this creature enters the battlefield, discover 3.', 'Pantlaza');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'impulse_exile_top',
        who: { kind: 'you' },
        amount: { kind: 'unknown', raw: 'until you exile a nonland card with mana value 3 or less' },
        duration: 'during_resolution',
        permission: 'cast',
        raw:
          'Exile cards from the top of your library until you exile a nonland card with mana value 3 or less. You may cast that card without paying its mana cost. Put the remaining exiled cards on the bottom of your library in a random order.',
      },
      {
        kind: 'modify_exile_permissions',
        scope: 'last_exiled_cards',
        withoutPayingManaCost: true,
        raw: 'You may cast that card without paying its mana cost.',
      },
    ]);
  });

  it('parses full Discover reminder lines into the same lowered discover steps', () => {
    const ir = parseOracleTextToIR(
      "Discover 5 (Exile cards from the top of your library until you exile a nonland card whose mana value is less than this spell's mana value. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)",
      'Geological Appraiser'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'impulse_exile_top',
        who: { kind: 'you' },
        amount: { kind: 'unknown', raw: 'until you exile a nonland card with mana value 5 or less' },
        duration: 'during_resolution',
        permission: 'cast',
        raw:
          'Exile cards from the top of your library until you exile a nonland card with mana value 5 or less. You may cast that card without paying its mana cost. Put the remaining exiled cards on the bottom of your library in a random order.',
      },
      {
        kind: 'modify_exile_permissions',
        scope: 'last_exiled_cards',
        withoutPayingManaCost: true,
        raw: 'You may cast that card without paying its mana cost.',
      },
    ]);
  });

  it('prunes discover reminder tails from lowered discover abilities', () => {
    const ir = parseOracleTextToIR(
      '{4}{G}, {T}, Sacrifice this land: Discover 4. Activate only as a sorcery. (Exile cards from the top of your library until you exile a nonland card with mana value 4 or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)',
      'Hidden Nursery'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'impulse_exile_top',
        who: { kind: 'you' },
        amount: { kind: 'unknown', raw: 'until you exile a nonland card with mana value 4 or less' },
        duration: 'during_resolution',
        permission: 'cast',
        raw:
          'Exile cards from the top of your library until you exile a nonland card with mana value 4 or less. You may cast that card without paying its mana cost. Put the remaining exiled cards on the bottom of your library in a random order.',
      },
      {
        kind: 'modify_exile_permissions',
        scope: 'last_exiled_cards',
        withoutPayingManaCost: true,
        raw: 'You may cast that card without paying its mana cost.',
      },
    ]);
  });

  it('prunes discover reminder tails while keeping dynamic discover leads visible', () => {
    const ir = parseOracleTextToIR(
      "Discover X, where X is that spell's mana value. (Exile cards from the top of your library until you exile a nonland card with that mana value or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)",
      'Hurl into History'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'unknown',
        raw: "Discover X, where X is that spell's mana value",
      },
    ]);
  });

  it('parses standalone triggered d20 rolls into roll_die steps', () => {
    const ir = parseOracleTextToIR('When this creature enters the battlefield, roll a d20.', 'Delina, Wild Mage');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'roll_die',
        who: { kind: 'you' },
        sides: 20,
        raw: 'roll a d20',
      },
    ]);
  });

  it('parses counter-doubling text into a double_counters step', () => {
    const ir = parseOracleTextToIR(
      'For each kind of counter on target permanent, put another of that kind of counter on that permanent.',
      'Gilder Bairn'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'double_counters',
        target: { kind: 'raw', text: 'target permanent' },
        raw: 'For each kind of counter on target permanent, put another of that kind of counter on that permanent',
      },
    ]);
  });

  it('parses specific-counter doubling text into a constrained double_counters step', () => {
    const ir = parseOracleTextToIR(
      'Double the number of +1/+1 counters on target creature.',
      'Ornery Tumblewagg'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'double_counters',
        target: { kind: 'raw', text: 'target creature' },
        counter: '+1/+1',
        raw: 'Double the number of +1/+1 counters on target creature',
      },
    ]);
  });

  it('parses Support keyword lines into add_counter steps for other target creatures', () => {
    const ir = parseOracleTextToIR('Support 2', 'Shoulder to Shoulder');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 1 },
        counter: '+1/+1',
        target: { kind: 'raw', text: 'each of up to 2 other target creatures' },
        raw: 'Put a +1/+1 counter on each of up to 2 other target creatures',
      },
    ]);
  });

  it('parses triggered support clauses into add_counter steps instead of leaving support as unknown', () => {
    const ir = parseOracleTextToIR('Flying\nWhen Expedition Raptor enters, support 2.', 'Expedition Raptor');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 1 },
        counter: '+1/+1',
        target: { kind: 'raw', text: 'each of up to 2 other target creatures' },
        raw: 'Put a +1/+1 counter on each of up to 2 other target creatures',
      },
    ]);
  });

  it('parses support clauses when they lead a longer spell ability', () => {
    const ir = parseOracleTextToIR(
      'Support 2. Each creature your opponents control gets -1/-1 until end of turn for each +1/+1 counter on creatures you control.',
      "Nissa's Judgment"
    );

    expect(ir.abilities[0]?.steps[0]).toEqual({
      kind: 'add_counter',
      amount: { kind: 'number', value: 1 },
      counter: '+1/+1',
      target: { kind: 'raw', text: 'each of up to 2 other target creatures' },
      raw: 'Put a +1/+1 counter on each of up to 2 other target creatures',
    });
    expect(
      ir.abilities[0]?.steps.some((step) => step.kind === 'unknown' && /support 2/i.test(String((step as any).raw || '')))
    ).toBe(false);
  });

  it('parses Bolster keyword lines into add_counter steps for the least-toughness creature you control', () => {
    const ir = parseOracleTextToIR('Bolster 2', 'Abzan Skycaptain');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 2 },
        counter: '+1/+1',
        target: { kind: 'raw', text: 'target creature you control with the least toughness among creatures you control' },
        raw: 'Put 2 +1/+1 counters on target creature you control with the least toughness among creatures you control',
      },
    ]);
  });

  it('parses Proliferate keyword lines into proliferate steps', () => {
    const ir = parseOracleTextToIR('Proliferate', 'Experimental Augury');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'proliferate',
        raw: 'Proliferate',
      },
    ]);
  });

  it('parses during-your-turn self keyword text into a turn-gated grant wrapper', () => {
    const ir = parseOracleTextToIR('During your turn, this creature has first strike.', 'Fresh-Faced Recruit');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: "it's your turn" },
        steps: [
          {
            kind: 'grant_temporary_ability',
            target: { kind: 'raw', text: 'this creature' },
            duration: 'this_turn',
            abilities: ['first strike'],
            raw: 'During your turn, this creature has first strike',
          },
        ],
        raw: 'During your turn, this creature has first strike',
      },
    ]);
  });

  it('parses during-your-turn plural keyword grants into a turn-gated grant wrapper', () => {
    const ir = parseOracleTextToIR(
      'During your turn, creatures you control with +1/+1 counters on them have first strike.',
      'Null Group Biological Assets'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: "it's your turn" },
        steps: [
          {
            kind: 'grant_temporary_ability',
            target: { kind: 'raw', text: 'creatures you control with +1/+1 counters on them' },
            duration: 'this_turn',
            abilities: ['first strike'],
            raw: 'During your turn, creatures you control with +1/+1 counters on them have first strike',
          },
        ],
        raw: 'During your turn, creatures you control with +1/+1 counters on them have first strike',
      },
    ]);
  });

  it('prunes reveal-land ETB choice text because land-entry handling already owns it', () => {
    const ir = parseOracleTextToIR(
      "As this land enters, you may reveal a Mountain or Forest card from your hand. If you don't, this land enters tapped.\n{T}: Add {R} or {G}.",
      'Game Trail'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: '{R}',
        manaOptions: ['{R}', '{G}'],
        raw: 'Add {R} or {G}',
      },
    ]);
  });

  it('prunes reveal-land ETB choice text for pronoun enters-tapped variants too', () => {
    const ir = parseOracleTextToIR(
      "As this land enters, you may reveal an Elemental card from your hand. If you don't, it enters tapped.\n{T}: Add {R}.\n{R}, {T}: Target creature gains haste until end of turn.",
      'Flamekin Village'
    );

    expect(ir.abilities.some((ability) => ability.steps.some((step) => step.kind === 'unknown'))).toBe(false);
    expect(ir.abilities).toHaveLength(2);
  });

  it('prunes pay-life land ETB choice text for pronoun enters-tapped variants too', () => {
    const ir = parseOracleTextToIR(
      "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {G}.",
      'Turntimber, Serpentine Wood'
    );

    expect(ir.abilities).toEqual([
      expect.objectContaining({
        steps: [
          {
            kind: 'add_mana',
            who: { kind: 'you' },
            mana: '{G}',
            raw: 'Add {G}',
          },
        ],
      }),
    ]);
  });

  it('parses Investigate keyword lines into investigate steps', () => {
    const ir = parseOracleTextToIR('Investigate', 'Thraben Inspector');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'investigate',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'Investigate',
      },
    ]);
  });

  it('parses Populate keyword lines into populate steps', () => {
    const ir = parseOracleTextToIR('Populate', 'Eyes in the Skies');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'populate',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'Populate',
      },
    ]);
  });

  it('parses Scry keyword lines into scry steps', () => {
    const ir = parseOracleTextToIR('Scry 2', 'Preordain');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'scry',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
        raw: 'Scry 2',
      },
    ]);
  });

  it('parses Surveil keyword lines into surveil steps', () => {
    const ir = parseOracleTextToIR('Surveil 2', 'Disinformation Campaign');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'surveil',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
        raw: 'Surveil 2',
      },
    ]);
  });

  it('parses Fateseal keyword lines into fateseal steps', () => {
    const ir = parseOracleTextToIR('Fateseal 2', 'Spin into Myth');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'fateseal',
        who: { kind: 'you' },
        target: { kind: 'target_opponent' },
        amount: { kind: 'number', value: 2 },
        raw: 'Fateseal 2',
      },
    ]);
  });

  it('parses Time travel keyword lines into time-travel steps', () => {
    const ir = parseOracleTextToIR('Time travel', 'Time Beetle');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'time_travel',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'Time travel',
      },
    ]);
  });

  it('parses repeated Time travel keyword lines into time-travel steps', () => {
    const ir = parseOracleTextToIR('Time travel three times', 'The Tenth Doctor');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'time_travel',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 3 },
        raw: 'Time travel three times',
      },
    ]);
  });

  it('parses suspend upkeep counter removal into a structured remove-counter step', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your upkeep, if this card is suspended, remove a time counter. When the last is removed, cast it without paying its mana cost.',
      'Lotus Bloom'
    );

    const suspendAbility = ir.abilities.find(ability =>
      (ability.steps || []).some(step => step.kind === 'conditional')
    );
    const conditionalStep = suspendAbility?.steps.find(step => step.kind === 'conditional');

    expect(conditionalStep).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'this card is suspended' },
      steps: expect.arrayContaining([
        expect.objectContaining({
          kind: 'remove_counter',
          amount: { kind: 'number', value: 1 },
          counter: 'time',
          target: { kind: 'raw', text: 'it' },
          raw: 'remove a time counter',
        }),
      ]),
    });
  });

  it('parses Collect evidence keyword lines into collect-evidence steps', () => {
    const ir = parseOracleTextToIR('Collect evidence 4', 'Deadly Cover-Up');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'collect_evidence',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 4 },
        raw: 'Collect evidence 4',
      },
    ]);
  });

  it('parses collect evidence follow-up conditionals into a collect step and wrapper', () => {
    const ir = parseOracleTextToIR('Collect evidence 4. If evidence was collected, draw a card.', 'Deadly Cover-Up');

    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'collect_evidence',
        amount: { kind: 'number', value: 4 },
      },
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'evidence was collected' },
        steps: [
          {
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
          },
        ],
      },
    ]);
  });

  it('parses Mill keyword lines into mill steps', () => {
    const ir = parseOracleTextToIR('Mill 2', 'Merfolk Secretkeeper');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'mill',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
        raw: 'Mill 2 cards',
      },
    ]);
  });

  it('parses The Ring tempts you keyword lines into ring_tempts_you steps', () => {
    const ir = parseOracleTextToIR('The Ring tempts you', 'Call of the Ring');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'ring_tempts_you',
        raw: 'The Ring tempts you',
      },
    ]);
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

  it('merges Bronzehide Lion return-time Aura rewrite onto the battlefield move-zone step', () => {
    const text =
      `When Bronzehide Lion dies, return it to the battlefield. It's an Aura enchantment with enchant creature you control and "{G}{W}: Return this card to its owner's hand." and it loses all other abilities.`;
    const ir = parseOracleTextToIR(text, 'Bronzehide Lion');
    const steps = ir.abilities[0].steps;

    expect(steps).toHaveLength(1);
    const move = steps[0] as any;
    expect(move.kind).toBe('move_zone');
    expect(move.to).toBe('battlefield');
    expect(move.battlefieldAttachedTo).toEqual({ kind: 'raw', text: 'a creature you control' });
    expect(move.battlefieldSetTypeLine).toBe('Enchantment - Aura');
    expect(move.battlefieldSetOracleText).toBe(
      `Enchant creature you control\n{G}{W}: Return this card to its owner's hand.`
    );
    expect(move.battlefieldLoseAllAbilities).toBe(true);
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

  it('parses Abyssal Harvester with the graveyard this-turn qualifier intact', () => {
    const text = '{T}: Exile target creature card from a graveyard that was put there this turn.';
    const ir = parseOracleTextToIR(text, 'Abyssal Harvester');
    const steps = ir.abilities[0].steps as any[];

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'move_zone',
      to: 'exile',
      what: { kind: 'raw', text: 'target creature card from a graveyard that was put there this turn' },
    });
  });

  it('parses Urborg Scavengers as trigger exile plus counter with linked-exile static follow-ups', () => {
    const text =
      'Whenever this creature enters or attacks, exile target card from a graveyard. Put a +1/+1 counter on this creature.\nThis creature has flying as long as a card exiled with it has flying. The same is true for first strike, double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, reach, trample, and vigilance.';
    const ir = parseOracleTextToIR(text, 'Urborg Scavengers');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature enters or attacks',
    });
    expect((ir.abilities[0].steps as any[]).map(step => step.kind)).toEqual(['move_zone', 'add_counter']);
    expect((ir.abilities[1].steps as any[])[0]).toMatchObject({
      kind: 'unknown',
      raw: 'This creature has flying as long as a card exiled with it has flying',
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

  it('parses vote clauses into a vote step with parsed choices', () => {
    const text = 'Starting with you, each player votes for grace or condemnation.';
    const ir = parseOracleTextToIR(text);
    const vote = ir.abilities[0].steps.find(s => s.kind === 'vote') as any;

    expect(vote).toBeTruthy();
    expect(vote.voters).toEqual({ kind: 'each_player' });
    expect(vote.startingWith).toEqual({ kind: 'you' });
    expect(vote.choices).toEqual(['grace', 'condemnation']);
  });

  it('parses per-choice vote payoffs into scaled executable steps', () => {
    const text =
      'Starting with you, each player votes for evidence or bribery. For each evidence vote, investigate. For each bribery vote, create a Treasure token.';
    const ir = parseOracleTextToIR(text, 'Tivit, Seller of Secrets');
    const steps = ir.abilities[0].steps as any[];

    expect(steps.map(step => step.kind)).toEqual(['vote', 'investigate', 'create_token']);
    expect(steps[1]).toMatchObject({
      kind: 'investigate',
      amount: { kind: 'votes_for_choice', choice: 'evidence' },
    });
    expect(steps[2]).toMatchObject({
      kind: 'create_token',
      amount: { kind: 'votes_for_choice', choice: 'bribery' },
      token: 'Treasure',
    });
  });

  it('parses numeric per-choice vote scaling for counters and life', () => {
    const text =
      'Starting with you, each player votes for sprout or harvest. Put two +1/+1 counters on this creature for each sprout vote. You gain 3 life for each harvest vote.';
    const ir = parseOracleTextToIR(text, 'Orchard Elemental');
    const steps = ir.abilities[0].steps as any[];

    expect(steps.map(step => step.kind)).toEqual(['vote', 'add_counter', 'gain_life']);
    expect(steps[1]).toMatchObject({
      kind: 'add_counter',
      target: { kind: 'raw', text: 'this creature' },
      amount: { kind: 'votes_for_choice', choice: 'sprout', multiplier: 2 },
    });
    expect(steps[2]).toMatchObject({
      kind: 'gain_life',
      amount: { kind: 'votes_for_choice', choice: 'harvest', multiplier: 3 },
    });
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
    expect(impulse.amount).toEqual({ kind: 'reference_amount', raw: 'that many' });
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
    expect(impulse.amount).toEqual({ kind: 'reference_amount', raw: 'that many' });
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

  it('parses Infernal Reckoning life gain as an object-stat power amount', () => {
    const ir = parseOracleTextToIR('Exile target colorless creature. You gain life equal to its power.', 'Infernal Reckoning');
    const gainLife = ir.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'gain_life') as any;

    expect(gainLife).toEqual(
      expect.objectContaining({
        kind: 'gain_life',
        amount: { kind: 'object_stat', subject: 'it', stat: 'power' },
      })
    );
  });

  it('parses Sheltering Word life gain as a that-creature toughness amount', () => {
    const ir = parseOracleTextToIR(
      "Target creature you control gains hexproof until end of turn. You gain life equal to that creature's toughness.",
      'Sheltering Word'
    );
    const gainLife = ir.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'gain_life') as any;

    expect(gainLife).toEqual(
      expect.objectContaining({
        kind: 'gain_life',
        amount: { kind: 'object_stat', subject: 'that_creature', stat: 'toughness' },
      })
    );
  });

  it('parses Gray Merchant life gain as the total life lost this way', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way.',
      'Gray Merchant of Asphodel'
    );
    const gainLife = ir.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'gain_life') as any;

    expect(gainLife).toEqual(
      expect.objectContaining({
        kind: 'gain_life',
        amount: { kind: 'reference_amount', raw: 'the life lost this way' },
      })
    );
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

  it('parses split choose-one bullet blocks with choose-both riders into choose_mode', () => {
    const ir = parseOracleTextToIR(
      "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Add {R} for each card in target opponent's hand.\n• Exile the top three cards of your library. You may play them this turn.",
      "Jeska's Will"
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]?.steps).toHaveLength(1);
    expect(ir.abilities[0]?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 2,
      })
    );
    const chooseMode = ir.abilities[0]?.steps[0] as any;
    expect(chooseMode.modes).toHaveLength(2);
    expect(
      chooseMode.modes.some((mode: any) => mode.steps.some((step: any) => step.kind === 'impulse_exile_top'))
    ).toBe(true);
  });

  it('parses choose-any-number modal bullet blocks into choose_mode', () => {
    const ir = parseOracleTextToIR(
      "Choose one. If this spell was kicked, choose any number instead.\n• Return up to two target creatures to their owners' hands.\n• Scry 2, then draw two cards.\n• Target player creates an X/X blue Illusion creature token, where X is the number of cards in their hand.",
      'Inscription of Insight'
    );

    expect(ir.abilities[0]?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 3,
      })
    );
  });

  it('parses choose-both riders without explicit you-may wording into choose_mode', () => {
    const ir = parseOracleTextToIR(
      "Choose one. If there are four or more card types among cards in your graveyard, choose both instead—\n• This creature deals 4 damage to any target.\n• Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in a random order.",
      'Prophetic Titan'
    );

    expect(ir.abilities[0]?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 2,
      })
    );
  });

  it('parses prelude text followed by choose-one bullets into preserved prelude plus choose_mode output', () => {
    const ir = parseOracleTextToIR(
      'Add one mana of any color.\nChoose one—\n• Double the number of each kind of counter on target permanent.\n• Double the number of each kind of counter you have.',
      'Aetheric Amplifier'
    );

    const allSteps = ir.abilities.flatMap((ability) => ability.steps);
    expect(allSteps.some((step) => step.kind === 'add_mana')).toBe(true);
    const chooseModeStep = allSteps.find((step) => step.kind === 'choose_mode');

    expect(chooseModeStep).toEqual(
      expect.objectContaining({
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 1,
      })
    );
  });

  it('parses simple choose-one em-dash bullet blocks into choose_mode', () => {
    const ir = parseOracleTextToIR(
      'Choose one—\n• Put X charge counters on target artifact.\n• Put X +1/+1 counters on target creature.',
      'Moxite Refinery'
    );

    expect(ir.abilities[0]?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 1,
      })
    );
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

  it('parses choose-one-or-more bullet blocks into choose_mode with a flexible upper bound', () => {
    const text =
      'Choose one or more -\n' +
      '\u2022 Draw a card.\n' +
      '\u2022 Gain 3 life.\n' +
      '\u2022 Create a Treasure token.';

    const ir = parseOracleTextToIR(text, 'Modal Test');
    const chooseModeStep = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'choose_mode') as any;

    expect(chooseModeStep).toBeTruthy();
    expect(chooseModeStep.minModes).toBe(1);
    expect(chooseModeStep.maxModes).toBe(3);
    expect(chooseModeStep.modes).toHaveLength(3);
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
    expect(steps.map(s => s.kind)).toContain('counter_spell');
    expect(steps.map(s => s.kind)).toContain('impulse_exile_top');

    const impulse = steps.find(s => s.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(impulse.who).toEqual({ kind: 'target_player' });
    expect(impulse.amount).toMatchObject({ kind: 'unknown' });
    expect(String(impulse.amount.raw || '')).toContain('different name');
    expect(impulse.duration).toBe('during_resolution');
    expect(impulse.permission).toBe('cast');
  });

  it('parses simple counterspell text into a direct counter_spell step', () => {
    const ir = parseOracleTextToIR('Counter target spell.', 'Counterspell');

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'counter_spell',
          target: { kind: 'raw', text: 'target spell' },
        }),
      ])
    );
  });

  it('parses Force Spike text into an unless-pays-mana wrapper around counter_spell', () => {
    const ir = parseOracleTextToIR('Counter target spell unless its controller pays {1}.', 'Force Spike');

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unless_pays_mana',
          who: { kind: 'target_player' },
          mana: '{1}',
        }),
      ])
    );
    expect((ir.abilities[0]?.steps?.[0] as any)?.steps?.[0]).toMatchObject({
      kind: 'counter_spell',
      target: { kind: 'raw', text: 'target spell' },
    });
  });

  it('parses target opponent reveals their hand into a direct reveal_hand step', () => {
    const ir = parseOracleTextToIR('Target opponent reveals their hand.', 'Telepathy Probe');

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'reveal_hand',
          who: { kind: 'target_opponent' },
        }),
      ])
    );
  });

  it('parses that player discards that card into a targeted discard step', () => {
    const ir = parseOracleTextToIR('That player discards that card.', 'Test');

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'discard',
          who: { kind: 'target_player' },
          amount: { kind: 'number', value: 1 },
          target: { kind: 'raw', text: 'that card' },
        }),
      ])
    );
  });

  it('parses you may discard that card into an optional targeted discard step', () => {
    const ir = parseOracleTextToIR('You may discard that card.', 'Test');

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'discard',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          target: { kind: 'raw', text: 'that card' },
          optional: true,
        }),
      ])
    );
  });

  it('prunes activate-only-once restriction text from activated ability steps', () => {
    const ir = parseOracleTextToIR(
      'Sacrifice another creature: This creature gets +2/+2 until end of turn. Activate only once each turn.',
      'Sepulcher Ghoul'
    );

    expect(ir.abilities[0]).toMatchObject({
      type: 'activated',
      cost: 'Sacrifice another creature',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'modify_pt',
        target: { kind: 'raw', text: 'this creature' },
        power: 2,
        toughness: 2,
        duration: 'end_of_turn',
      }),
    ]);
  });

  it('keeps target continuation text inside activated abilities and prunes own-turn restriction steps', () => {
    const ir = parseOracleTextToIR(
      '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
      'Humble Defector'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'activated',
      cost: '{T}',
      effectText:
        'Draw two cards. Target opponent gains control of this permanent. Activate only during your turn.',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
      }),
      expect.objectContaining({
        kind: 'unknown',
        raw: 'Target opponent gains control of this permanent',
      }),
    ]);
  });

  it('prunes standalone attack-each-combat requirement abilities from Oracle IR', () => {
    const ir = parseOracleTextToIR('This creature attacks each combat if able.', 'Goblin Berserker');

    expect(ir.abilities).toEqual([]);
  });

  it('prunes standalone defending-player basic-land attack restrictions from Oracle IR', () => {
    const ir = parseOracleTextToIR(
      "This creature can't attack unless defending player controls an Island.",
      'Floodchaser'
    );

    expect(ir.abilities).toEqual([]);
  });

  it('prunes standalone blocker-limit restriction abilities from Oracle IR', () => {
    const ir = parseOracleTextToIR(
      "This creature can't be blocked by more than one creature.",
      'Charging Rhino'
    );

    expect(ir.abilities).toEqual([]);
  });

  it('prunes standalone convoke keyword lines from Oracle IR while keeping the keyword', () => {
    const ir = parseOracleTextToIR(
      'Convoke\nTarget creature gets +3/+3 until end of turn.',
      'Pack\'s Favor'
    );

    expect(ir.keywords).toContain('convoke');
    expect(ir.abilities).toEqual([
      expect.objectContaining({
        steps: [
          expect.objectContaining({
            kind: 'modify_pt',
            target: { kind: 'raw', text: 'target creature' },
            power: 3,
            toughness: 3,
            duration: 'end_of_turn',
          }),
        ],
      }),
    ]);
  });

  it('prunes standalone kicker reminder abilities while keeping the kicker keyword', () => {
    const ir = parseOracleTextToIR(
      'Kicker {4} (You may pay an additional {4} as you cast this spell.)\nTarget creature gets +4/+4 until end of turn.',
      'Kavu Primarch'
    );

    expect(ir.keywords).toContain('kicker');
    expect(ir.abilities).toEqual([
      expect.objectContaining({
        steps: [
          expect.objectContaining({
            kind: 'modify_pt',
            target: { kind: 'raw', text: 'target creature' },
            power: 4,
            toughness: 4,
            duration: 'end_of_turn',
          }),
        ],
      }),
    ]);
  });

  it('prunes standalone affinity reminder lines from Oracle IR while keeping the keyword', () => {
    const ir = parseOracleTextToIR(
      'Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)',
      'Somber Hoverguard'
    );

    expect(ir.keywords).toContain('affinity');
    expect(ir.abilities).toEqual([
      expect.objectContaining({
        type: 'static',
        effectText: '',
        steps: [],
      }),
    ]);
  });

  it('prunes standalone shroud reminder lines from Oracle IR while keeping the keyword', () => {
    const ir = parseOracleTextToIR(
      'Shroud (This creature can\'t be the target of spells or abilities.)',
      'Nimble Mongoose'
    );

    expect(ir.keywords).toContain('shroud');
    expect(ir.abilities).toEqual([
      expect.objectContaining({
        type: 'static',
        effectText: '',
        steps: [],
      }),
    ]);
  });

  it('prunes standalone protection keyword lines while keeping the protection keyword', () => {
    const ir = parseOracleTextToIR('Protection from black', 'Order of the Ebon Hand');

    expect(ir.keywords).toContain('protection');
    expect(ir.abilities).toEqual([]);
  });

  it('prunes standalone toxic reminder lines while keeping the toxic keyword', () => {
    const ir = parseOracleTextToIR(
      'Toxic 1 (Players dealt combat damage by this creature also get a poison counter.)',
      'Bloated Contaminator'
    );

    expect(ir.keywords).toContain('toxic');
    expect(ir.abilities).toEqual([]);
  });

  it('prunes standalone mixed keyword lists that include protection', () => {
    const ir = parseOracleTextToIR('Flying, protection from black', 'Crypt Angel');

    expect(ir.keywords).toEqual(expect.arrayContaining(['flying', 'protection']));
    expect(ir.abilities).toEqual([]);
  });

  it('prunes long convoke reminder text from full card text while keeping the spell effect', () => {
    const ir = parseOracleTextToIR(
      'Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature\'s color.)\nCreate X 1/1 white Soldier creature tokens with lifelink.',
      'March of the Multitudes'
    );

    expect(ir.keywords).toEqual(expect.arrayContaining(['convoke', 'lifelink']));
    expect(ir.abilities.flatMap((ability: any) => ability.steps).some((step: any) => /convoke|each creature you tap while casting/i.test(String(step?.raw || '')))).toBe(false);
    expect(ir.abilities).toEqual([
      expect.objectContaining({
        steps: [
          expect.objectContaining({
            kind: 'create_token',
            token: '1/1 white Soldier',
            amount: { kind: 'x' },
          }),
        ],
      }),
    ]);
  });

  it('folds impulse cleanup tails into the impulse step for play-this-turn effects', () => {
    const ir = parseOracleTextToIR(
      'Exile the top three cards of your library. Until end of turn, you may play those cards. Put the exiled cards on the bottom of your library in a random order.',
      'Test Card'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'impulse_exile_top',
        amount: { kind: 'number', value: 3 },
        duration: 'this_turn',
        permission: 'play',
        raw: expect.stringContaining('Put the exiled cards on the bottom of your library in a random order'),
      }),
    ]);
  });

  it('prunes standalone madness keyword reminder abilities while keeping the keyword', () => {
    const ir = parseOracleTextToIR(
      'Madness {U} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)\nDraw a card.',
      'Obsessive Search'
    );

    expect(ir.keywords).toContain('madness');
    expect(ir.abilities).toEqual([
      expect.objectContaining({
        steps: [
          expect.objectContaining({
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
          }),
        ],
      }),
    ]);
  });

  it('prunes proliferate reminder tails from proliferate keyword lines', () => {
    const ir = parseOracleTextToIR(
      'Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)\nDraw a card.',
      'Experimental Augury'
    );

    expect(ir.abilities.map((ability) => ability.steps.map((step) => step.kind))).toEqual([
      ['proliferate'],
      ['draw'],
    ]);
    expect(
      ir.abilities.some((ability: any) =>
        ability.steps.some((step: any) => /choose any number of permanents|give each another counter/i.test(String(step?.raw || '')))
      )
    ).toBe(false);
  });

  it('prunes proliferate reminder tails from inline proliferate clauses', () => {
    const ir = parseOracleTextToIR(
      'Destroy target creature, then proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
      'Spread the Sickness'
    );

    expect(ir.abilities[0]?.steps.map((step) => step.kind)).toEqual(['destroy', 'proliferate']);
    expect(ir.abilities[0]?.steps.some((step: any) => /choose any number of permanents|give each another counter/i.test(String(step?.raw || '')))).toBe(false);
  });

  it('prunes split proliferate reminder fragments even when the proliferate clause itself is still unknown', () => {
    const ir = parseOracleTextToIR(
      'If you put fewer than two lands onto the battlefield this way, proliferate a number of times equal to the difference. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
      'Expand the Sphere'
    );

    const stepRaws = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => String(step.raw || '')));
    expect(stepRaws.some((raw) => /choose any number of permanents and\/or players/i.test(raw))).toBe(false);
    expect(stepRaws.some((raw) => /then give each another counter of each kind already there/i.test(raw))).toBe(false);
    expect(stepRaws.some((raw) => /proliferate a number of times equal to the difference/i.test(raw))).toBe(true);
  });

  it('prunes standalone spell-cant-be-countered text from Oracle IR', () => {
    const ir = parseOracleTextToIR(
      "This spell can't be countered.\nDestroy target nonland permanent with mana value 3 or less.",
      'Abrupt Decay'
    );

    expect(ir.abilities.some((ability: any) => /can't be countered/i.test(String(ability?.text || '')))).toBe(false);
    expect(ir.abilities.flatMap((ability: any) => ability.steps)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'destroy',
          target: { kind: 'raw', text: 'target nonland permanent with mana value 3 or less' },
        }),
      ])
    );
  });

  it('prunes token artifact reminder text from create-token steps', () => {
    const ir = parseOracleTextToIR(
      'Create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
      'Pirate Booty'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'create_token',
        token: 'Treasure',
      }),
    ]);
  });

  it('prunes Eldrazi token mana reminder text from create-token steps', () => {
    const ir = parseOracleTextToIR(
      'When this creature dies, create a 1/1 colorless Eldrazi Scion creature token. It has "Sacrifice this token: Add {C}."',
      'Blisterpod'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'create_token',
        token: '1/1 colorless Eldrazi Scion',
      }),
    ]);
  });

  it('prunes plural Eldrazi token mana reminder text from create-token steps', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, create two 0/1 colorless Eldrazi Spawn creature tokens. They have "Sacrifice this token: Add {C}."',
      "Kozilek's Predator"
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'create_token',
        token: '0/1 colorless Eldrazi Spawn',
      }),
    ]);
  });

  it('prunes decayed reminder sacrifice tails after token creation', () => {
    const ir = parseOracleTextToIR(
      'Create a 2/2 black Zombie creature token with decayed. (It can\'t block. When it attacks, sacrifice it at end of combat.)',
      'Rotten Reunion'
    );

    const stepRaws = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => String(step.raw || '')));
    expect(stepRaws.some((raw) => /create a 2\/2 black zombie creature token with decayed/i.test(raw))).toBe(true);
    expect(stepRaws.some((raw) => /when it attacks, sacrifice it at end of combat/i.test(raw))).toBe(false);
  });

  it('prunes enchant attachment reminder tails from aura keyword lines', () => {
    const ir = parseOracleTextToIR(
      'Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)',
      'Robe of Mirrors'
    );

    const stepRaws = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => String(step.raw || '')));
    expect(stepRaws.some((raw) => /this card enters attached to that creature/i.test(raw))).toBe(false);
    expect(stepRaws.some((raw) => /enchant creature/i.test(raw))).toBe(true);
    expect(ir.keywords).toContain('enchant');
  });

  it('prunes plural artifact reminder text from create-token steps', () => {
    const ir = parseOracleTextToIR(
      'Create two Treasure tokens. (They\'re artifacts with "{T}, Sacrifice this token: Add one mana of any color.")',
      'Big Score'
    );

    expect(ir.abilities[0]?.steps.some((step: any) => /artifacts with/i.test(String(step?.raw || '')))).toBe(false);
    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'create_token',
          token: 'Treasure',
        }),
      ])
    );
  });

  it('prunes clue reminder artifact text from investigate steps', () => {
    const ir = parseOracleTextToIR(
      'Investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")',
      'Thraben Cluekeeper'
    );

    expect(ir.abilities[0]?.steps.some((step: any) => /artifact with/i.test(String(step?.raw || '')))).toBe(false);
    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'investigate',
        }),
      ])
    );
  });

  it('prunes clue reminder tails when investigate remains an unknown step', () => {
    const ir = parseOracleTextToIR(
      'Each player who controls the most creatures investigates. Then destroy all creatures. (To investigate, create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")',
      'No Witnesses'
    );

    expect(
      ir.abilities.some((ability: any) =>
        (ability?.steps || []).some((step: any) => /artifact with/i.test(String(step?.raw || '')))
      )
    ).toBe(false);
    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unknown',
          raw: 'Each player who controls the most creatures investigates',
        }),
        expect.objectContaining({
          kind: 'destroy',
        }),
      ])
    );
  });

  it('prunes split lander token reminder tails from created token abilities', () => {
    const ir = parseOracleTextToIR(
      'Create a Lander token. Then you may sacrifice an artifact. When you do, Lithobraking deals 2 damage to each creature. (A Lander token is an artifact with "{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.")',
      'Lithobraking'
    );

    expect(
      ir.abilities.some((ability: any) =>
        (ability?.steps || []).some((step: any) => {
          const raw = String(step?.raw || '');
          return /lander token is an artifact with/i.test(raw) || /then shuffle\."\)/i.test(raw);
        })
      )
    ).toBe(false);
    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'create_token',
          token: 'Lander',
        }),
      ])
    );
  });

  it('prunes full crew reminder-only abilities while keeping the crew keyword', () => {
    const ir = parseOracleTextToIR(
      'Crew 3 (Tap any number of creatures you control with total power 3 or more: This Vehicle becomes an artifact creature until end of turn.)',
      'Capenna Express'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('crew');
  });

  it('prunes bare crew keyword lines while keeping the crew keyword', () => {
    const ir = parseOracleTextToIR('Crew 2', 'Sky Skiff');

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('crew');
  });

  it('prunes split equipment-vehicle crew reminder fragments while keeping the crew keyword', () => {
    const ir = parseOracleTextToIR(
      'Crew 2 (Tap any number of creatures you control with total power 2 or more: This Vehicle becomes an artifact creature until end of turn. Creatures can\'t be attached to other permanents.)',
      'Cloudspire Skycycle'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('crew');
  });

  it('prunes full plot keyword reminder lines while keeping the plot keyword', () => {
    const ir = parseOracleTextToIR(
      "Plot {2}{R} (You may pay {2}{R} and exile this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost. Plot only as a sorcery.)",
      'Pyretic Charge'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('plot');
  });

  it('prunes full mutate keyword reminder lines while keeping the mutate keyword', () => {
    const ir = parseOracleTextToIR(
      'Mutate {2}{G} (If you cast this spell for its mutate cost, put it over or under target non-Human creature you own. They mutate into the creature on top plus all abilities from under it.)',
      'Gemrazer'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('mutate');
  });

  it('prunes live plot reminder wording while keeping the plot keyword', () => {
    const ir = parseOracleTextToIR(
      'Plot {2}{R} ({2}{R}, Exile this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost. Plot only as a sorcery.)',
      'Pyretic Charge'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('plot');
  });

  it('prunes live mutate reminder wording while keeping the mutate keyword', () => {
    const ir = parseOracleTextToIR(
      'Mutate {2}{G} (If you cast this spell for its mutate cost, put it over or under target non-Human creature you own. They mutate into the creature on top plus all abilities from under it.)',
      'Gemrazer'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('mutate');
  });

  it('prunes Choose a Background reminder text from Oracle IR', () => {
    const ir = parseOracleTextToIR(
      'Choose a Background (You can have a Background as a second commander.)',
      'Candlekeep Sage'
    );

    expect(ir.abilities).toEqual([]);
  });

  it('prunes commander-eligibility reminder text from Oracle IR', () => {
    const ir = parseOracleTextToIR(
      'Teferi, Temporal Archmage can be your commander.',
      'Teferi, Temporal Archmage'
    );

    expect(ir.abilities).toEqual([]);
  });

  it('prunes full ascend reminder lines while keeping the ascend keyword', () => {
    const ir = parseOracleTextToIR(
      "Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)",
      'Radiant Destiny'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('ascend');
  });

  it('prunes full delve reminder lines while keeping the delve keyword', () => {
    const ir = parseOracleTextToIR(
      'Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)',
      'Gurmag Angler'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('delve');
  });

  it('prunes full banding reminder lines while keeping the banding keyword', () => {
    const ir = parseOracleTextToIR(
      "Banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)",
      'Benalish Hero'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('banding');
  });

  it('prunes full splice reminder lines while keeping the splice keyword', () => {
    const ir = parseOracleTextToIR(
      "Splice onto Arcane {1}{B} (As you cast an Arcane spell, you may reveal this card from your hand and pay its splice cost. If you do, add this card's effects to that spell.)",
      "Horobi's Whisper"
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('splice');
  });

  it('prunes full warp reminder lines while keeping the warp keyword', () => {
    const ir = parseOracleTextToIR(
      'Warp {1}{U} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)',
      'Starbreach Whale'
    );

    expect(ir.abilities).toEqual([]);
    expect(ir.keywords).toContain('warp');
  });

  it('parses gain-life triggers that use reference amounts', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature deals damage, you gain that much life.',
      'Mourning Thrull'
    );

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature deals damage',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: { kind: 'reference_amount', raw: 'that much' },
      }),
    ]);
  });

  it('parses damage clauses that use reference amounts', () => {
    const ir = parseOracleTextToIR(
      'It deals that much damage to any target.',
      'Geistflame Reservoir'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'deal_damage',
        amount: { kind: 'reference_amount', raw: 'that much' },
        target: { kind: 'raw', text: 'any target' },
      }),
    ]);
  });

  it('prunes clash reminder tails while keeping the clash step', () => {
    const ir = parseOracleTextToIR(
      "Prevent all combat damage that would be dealt this turn. Clash with an opponent. If you win, creatures that player controls don't untap during the player's next untap step. (Each clashing player reveals the top card of their library, then puts that card on their choice of the top or bottom. A player wins if their card had a greater mana value.)",
      'Pollen Lullaby'
    );

    const allStepRaws = ir.abilities.flatMap((ability: any) => ability.steps.map((step: any) => String(step?.raw || '')));
    expect(allStepRaws.some((raw: string) => raw.includes('choice of the top or bottom') || raw.includes('greater mana value'))).toBe(false);
    expect(ir.abilities.flatMap((ability: any) => ability.steps)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'prevent_damage', combatOnly: true }),
        expect.objectContaining({ kind: 'clash' }),
      ])
    );
  });

  it('absorbs copy retarget tails into nested copy-spell steps', () => {
    const ir = parseOracleTextToIR(
      'Whenever you cast a multicolored instant or sorcery spell, you may pay {1}. If you do, copy that spell. You may choose new targets for the copy.',
      'Cloven Casting'
    );

    const ability = ir.abilities[0] as any;
    expect(ability.steps.some((step: any) => String(step?.raw || '') === 'You may choose new targets for the copy')).toBe(false);
    expect(ability.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'conditional',
          steps: [
            expect.objectContaining({
              kind: 'copy_spell',
              allowNewTargets: true,
            }),
          ],
        }),
      ])
    );
  });

  it('parses create-that-many token clauses as reference amounts', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature deals combat damage to a player, create that many 1/1 green Insect creature tokens.',
      'Living Hive'
    );

    const ability = ir.abilities[0] as any;
    expect(ability.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'create_token',
          amount: { kind: 'reference_amount', raw: 'that many' },
          token: '1/1 green Insect',
        }),
      ])
    );
  });

  it('parses draw-that-many clauses as reference amounts', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, shuffle the cards from your hand into your library, then draw that many cards.',
      'Whirlpool Rider'
    );

    const ability = ir.abilities[0] as any;
    expect(ability.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'draw',
          amount: { kind: 'reference_amount', raw: 'that many' },
        }),
      ])
    );
  });

  it('prunes any-player activation permission tails from parsed activated abilities', () => {
    const ir = parseOracleTextToIR(
      "{3}: Xantcha's controller loses 2 life and you draw a card. Any player may activate this ability.",
      'Xantcha, Sleeper Agent'
    );

    const ability = ir.abilities[0] as any;
    expect(ability.steps.some((step: any) => /any player may activate this ability/i.test(String(step?.raw || '')))).toBe(false);
    expect(ability.steps.map((step: any) => step.kind)).toEqual(['lose_life', 'draw']);
  });

  it('prunes standalone any-player activation permission abilities', () => {
    const ir = parseOracleTextToIR(
      'Flying, first strike\n{1}: This creature gets +1/+1 until end of turn. Any player may activate this ability.\n{1}: This creature gets -1/-1 until end of turn. Any player may activate this ability.',
      'Flailing Manticore'
    );

    expect(ir.abilities.some((ability: any) => /any player may activate this ability/i.test(String(ability?.text || '')))).toBe(false);
    expect(ir.abilities.filter((ability: any) => ability.type === 'activated').map((ability: any) => ability.steps[0]?.kind)).toEqual([
      'modify_pt',
      'modify_pt',
    ]);
  });

  it('prunes threshold activation restriction tails from parsed activated abilities', () => {
    const ir = parseOracleTextToIR(
      'Threshold - {W}, {T}, Sacrifice this land: You gain 4 life. Activate only if there are seven or more cards in your graveyard.',
      'Nomad Stadium'
    );

    const ability = ir.abilities[0] as any;
    expect(ability.steps.some((step: any) => /activate only if there are seven or more cards in your graveyard/i.test(String(step?.raw || '')))).toBe(false);
    expect(ability.steps).toEqual([
      expect.objectContaining({
        kind: 'gain_life',
        amount: { kind: 'number', value: 4 },
      }),
    ]);
    expect(ir.keywords).toContain('threshold');
  });

  it('prunes doctor\'s companion reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      "Doctor's companion (You can have two commanders if the other is the Doctor.)",
      'Ace, Fearless Rebel'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain("doctor's companion");
  });

  it('prunes evoke reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      "Evoke {2}{U} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)",
      'Mulldrifter'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('evoke');
  });

  it('prunes cascade reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      "Cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)",
      'Maelstrom Colossus'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('cascade');
  });

  it('prunes split cascade reminder shards while keeping the duplicate-cascade tail visible', () => {
    const ir = parseOracleTextToIR(
      "Cascade, cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order. Then do it again.)",
      'Call Forth the Tempest'
    );

    const stepRaws = (ir.abilities[0]?.steps || []).map((step) => String(step.raw || ''));
    expect(stepRaws.some((raw) => /you may cast it without paying its mana cost/i.test(raw))).toBe(false);
    expect(stepRaws.some((raw) => /put the exiled cards on the bottom(?: of your library)? in a random order/i.test(raw))).toBe(false);
    expect(stepRaws.some((raw) => /then do it again/i.test(raw))).toBe(true);
  });

  it('keeps non-cascade cast-without-paying clauses outside reminder cleanup', () => {
    const ir = parseOracleTextToIR(
      'Storm (When you cast this spell, copy it for each spell cast before it this turn.)\nExile an instant or sorcery card with mana value 3 or less from your graveyard at random. You may cast it without paying its mana cost. If that spell would be put into a graveyard, exile it instead.',
      'Storm of Memories'
    );

    const stepRaws = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => String(step.raw || '')));
    expect(stepRaws.some((raw) => /you may cast it without paying its mana cost/i.test(raw))).toBe(true);
  });

  it('prunes prototype reminder tails while keeping the prototype lead visible', () => {
    const ir = parseOracleTextToIR(
      "Prototype {2}{W} - 1/1 (You may cast this spell with different mana cost, color, and size. It keeps its abilities and types.)\nDouble strike\nWhen this creature enters, draw a card.",
      'Combat Thresher'
    );

    const stepRaws = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => String(step.raw || '')));
    expect(stepRaws.some((raw) => /it keeps its abilities and types/i.test(raw))).toBe(false);
    expect(stepRaws.some((raw) => /prototype\s+\{2\}\{w\}\s*-\s*1\/1/i.test(raw))).toBe(true);
    expect(stepRaws.some((raw) => /draw a card/i.test(raw))).toBe(true);
  });

  it('prunes backup reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      "Flash\nBackup 1 (When this creature enters, put a +1/+1 counter on target creature. If that's another creature, it gains the following ability until end of turn.)\nHexproof",
      'Saiba Cryptomancer'
    );

    const stepRaws = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => String(step.raw || '')));
    expect(stepRaws.some((raw) => /if that(?:'|â€™)?s another creature, it gains the following ability until end of turn/i.test(raw))).toBe(false);
    expect(stepRaws.some((raw) => /backup\s+1\s*\(when this creature enters, put a \+1\/\+1 counter on target creature/i.test(raw))).toBe(false);
    expect(ir.keywords).toContain('backup');
  });

  it('prunes cumulative upkeep reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nAs this enchantment enters, choose a color.',
      'Prismatic Circle'
    );

    const stepRaws = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => String(step.raw || '')));
    expect(stepRaws.some((raw) => /cumulative upkeep/i.test(raw))).toBe(false);
    expect(stepRaws.some((raw) => /age counter/i.test(raw))).toBe(false);
    expect(ir.keywords).toContain('cumulative upkeep');
    expect(ir.abilities.flatMap((ability) => ability.steps).some((step) => step.kind === 'choose_color')).toBe(true);
  });

  it('prunes flanking reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Flanking (Whenever a creature without flanking blocks this creature, the blocking creature gets -1/-1 until end of turn.)',
      'Suq\'Ata Lancer'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('flanking');
  });

  it('prunes overload reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Overload {1}{U} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
      'Mizzium Skin'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('overload');
  });

  it('prunes soulbond reminder abilities while retaining the keyword', () => {
    const ir = parseOracleTextToIR(
      'Soulbond (You may pair this creature with another unpaired creature when either enters. They remain paired for as long as you control both of them.)',
      'Trusted Forcemage'
    );

    expect(ir.abilities).toHaveLength(0);
    expect(ir.keywords).toContain('soulbond');
  });

  it('prunes ward-reminder spell-cant-be-countered variants from Oracle IR', () => {
    const ir = parseOracleTextToIR(
      "This spell can't be countered. (This includes by the ward ability.)\nHeated Debate deals 4 damage to target creature or planeswalker.",
      'Heated Debate'
    );

    expect(ir.abilities.flatMap((ability: any) => ability.steps).some((step: any) => /can't be countered/i.test(String(step?.raw || '')))).toBe(false);
    expect(ir.abilities.flatMap((ability: any) => ability.steps)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'deal_damage',
          amount: { kind: 'number', value: 4 },
          target: { kind: 'raw', text: 'target creature or planeswalker' },
        }),
      ])
    );
  });

  it('prunes clue and once-per-turn reminder tails from live trigger text', () => {
    const ir = parseOracleTextToIR(
      'When this enchantment enters, create a Clue token. (It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")\nWhenever you sacrifice a permanent during your turn, create a 1/1 white Ally creature token. This ability triggers only once each turn.',
      'Tolls of War'
    );

    expect(ir.abilities.flatMap((ability: any) => ability.steps).some((step: any) => /artifact with|triggers only once each turn/i.test(String(step?.raw || '')))).toBe(false);
    expect(ir.abilities.flatMap((ability: any) => ability.steps)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'create_token',
          token: 'Clue',
        }),
        expect.objectContaining({
          kind: 'create_token',
          token: '1/1 white Ally',
        }),
      ])
    );
  });

  it('prunes still-a-land reminder text from Hall of Storm Giants style activations', () => {
    const ir = parseOracleTextToIR(
      "{3}{U}{U}: Until end of turn, this land becomes a 7/7 blue Giant creature with ward {3}. It's still a land.",
      'Hall of Storm Giants'
    );

    expect(ir.abilities[0]?.steps.some((step: any) => String(step?.raw || '').includes("It's still a land"))).toBe(false);
    expect(ir.abilities[0]?.steps.length).toBeGreaterThan(0);
  });

  it('prunes trigger-only-once restriction text from triggered ability steps', () => {
    const ir = parseOracleTextToIR(
      'Whenever you sacrifice one or more other creatures, Forge Boss deals 2 damage to each opponent. This ability triggers only once each turn.',
      'Forge Boss'
    );

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'you sacrifice one or more other creatures',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'deal_damage',
        amount: { kind: 'number', value: 2 },
        target: { kind: 'raw', text: 'each opponent' },
      }),
    ]);
  });

  it('prunes do-this-only-once-each-turn restriction text from triggered ability steps', () => {
    const ir = parseOracleTextToIR(
      'Whenever you gain life, you may put that many +1/+1 counters on each creature you control. Do this only once each turn.',
      'Nykthos Paragon'
    );

    expect(ir.abilities[0]?.steps.some((step: any) => /Do this only once each turn/i.test(String(step?.raw || '')))).toBe(false);
  });

  it('prunes still-a-land reminder text from activated ability steps', () => {
    const ir = parseOracleTextToIR(
      '{T}: Target land you control becomes a 4/4 Elemental creature with haste until end of turn. It\'s still a land. Activate only as a sorcery.',
      'Llanowar Loamspeaker'
    );

    expect(ir.abilities[0]).toMatchObject({
      type: 'activated',
      cost: '{T}',
    });
    expect(ir.abilities[0]?.steps.some((step: any) => String(step?.raw || '').includes("It's still a land"))).toBe(false);
    expect(ir.abilities[0]?.steps.some((step: any) => String(step?.raw || '').includes('Activate only as a sorcery'))).toBe(false);
    expect(ir.abilities[0]?.steps.length).toBeGreaterThan(0);
  });

  it('prunes old scry 1 reminder fragments when a scry step is already parsed', () => {
    const ir = parseOracleTextToIR(
      'Scry 1. (Look at the top card of your library. You may put that card on the bottom.)',
      'Test'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'scry',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'Scry 1',
      },
    ]);
  });

  it('prunes plural scry reminder fragments when a scry step is already parsed', () => {
    const ir = parseOracleTextToIR(
      'Scry 2. (Look at the top two cards of your library, then put any number of them on the bottom of your library and the rest on top in any order.)',
      'Test'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'scry',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
        raw: 'Scry 2',
      },
    ]);
  });

  it('prunes short-form plural scry reminder fragments when a scry step is already parsed', () => {
    const ir = parseOracleTextToIR(
      'Scry 2. (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)',
      'Test'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'scry',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
        raw: 'Scry 2',
      },
    ]);
  });

  it("prunes standalone short-form scry reminder abilities from full card text", () => {
    const ir = parseOracleTextToIR(
      "When this artifact enters, scry 2, then you get {E}{E}. (You get two energy counters. To scry 2, look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)\n{2}{U}, Sacrifice this artifact: Scry 2, then you get {E}{E}.",
      "Glassblower's Puzzleknot"
    );

    expect(
      ir.abilities.some(
        (ability) =>
          ability.steps.length > 0 &&
          ability.steps.every((step: any) => step.kind === 'unknown') &&
          String(ability.text || '').includes('To scry 2')
      )
    ).toBe(false);
    expect(
      ir.abilities.some((ability) =>
        ability.steps.some((step: any) => String(step?.raw || '').includes('put any number of them on the bottom and the rest on top in any order'))
      )
    ).toBe(false);
  });

  it('prunes bestow unattached-creature reminder tails from keyword lines', () => {
    const ir = parseOracleTextToIR(
      "Bestow {3}{W} (If you cast this card for its bestow cost, it's an Aura spell with enchant creature. It becomes a creature again if it's not attached.)",
      'Test'
    );

    expect(
      ir.abilities.some((ability) =>
        ability.steps.some((step: any) => String(step?.raw || '').includes("It becomes a creature again if it's not attached"))
      )
    ).toBe(false);
  });

  it('treats short self enters-tapped artifact text as a replacement ability without unknown steps', () => {
    const ir = parseOracleTextToIR('This artifact enters tapped.', 'Moss Diamond');

    expect(ir.abilities[0]).toMatchObject({
      type: 'replacement',
      effectText: 'tapped',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('treats short self enters-tapped creature text as a replacement ability without unknown steps', () => {
    const ir = parseOracleTextToIR('This creature enters tapped.', 'Dungeon Crawler');

    expect(ir.abilities[0]).toMatchObject({
      type: 'replacement',
      effectText: 'tapped',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('treats fastland enters-tapped replacement text as a replacement ability without unknown steps', () => {
    const ir = parseOracleTextToIR(
      'This land enters tapped unless you control two or fewer other lands.',
      'Concealed Courtyard'
    );

    expect(ir.abilities[0]).toMatchObject({
      type: 'replacement',
      effectText: 'tapped unless you control two or fewer other lands',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('lowers self X enters-with-counters replacement text into an add_counter step', () => {
    const ir = parseOracleTextToIR('This creature enters with X +1/+1 counters on it.', 'Magma Pummeler');

    expect(ir.abilities[0]).toMatchObject({
      type: 'replacement',
      effectText: 'with X +1/+1 counters on it',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'add_counter',
        target: { kind: 'raw', text: 'this permanent' },
        counter: '+1/+1',
        amount: { kind: 'x' },
        raw: 'with X +1/+1 counters on it',
      },
    ]);
  });

  it('lowers self numeric enters-with-counters replacement text into an add_counter step', () => {
    const ir = parseOracleTextToIR('This artifact enters the battlefield with two charge counters on it.', 'Magistrate\'s Scepter');

    expect(ir.abilities[0]).toMatchObject({
      type: 'replacement',
      effectText: 'with two charge counters on it',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'add_counter',
        target: { kind: 'raw', text: 'this permanent' },
        counter: 'charge',
        amount: { kind: 'number', value: 2 },
        raw: 'with two charge counters on it',
      },
    ]);
  });

  it('prunes redundant infect keyword placeholder steps while preserving keyword capture', () => {
    const ir = parseOracleTextToIR('Infect', 'Glistener Elf');

    expect(ir.keywords).toContain('infect');
    expect(ir.abilities[0]).toMatchObject({
      type: 'static',
      effectText: 'Infect',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('prunes infect reminder-text placeholder steps while preserving keyword capture', () => {
    const ir = parseOracleTextToIR(
      'Infect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)',
      'Cystbearer'
    );

    expect(ir.keywords).toContain('infect');
    expect(ir.abilities[0]).toMatchObject({
      type: 'static',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it("parses target creature can't block this turn into a cant_block step", () => {
    const ir = parseOracleTextToIR("Target creature can't block this turn.", 'Falter Probe');

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'cant_block',
          target: { kind: 'raw', text: 'Target creature' },
          duration: 'end_of_turn',
        }),
      ])
    );
  });

  it("parses target creature can't attack this turn into a cant_attack step", () => {
    const ir = parseOracleTextToIR("Target creature can't attack this turn.", 'Blinding Beam');

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'cant_attack',
          target: { kind: 'raw', text: 'Target creature' },
          duration: 'end_of_turn',
        }),
      ])
    );
  });

  it("parses enchanted creature can't attack or block into static cant-attack and cant-block steps", () => {
    const ir = parseOracleTextToIR("Enchanted creature can't attack or block.", 'Pacifism');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'cant_attack',
        target: { kind: 'raw', text: 'Enchanted creature' },
        duration: 'static',
        raw: "Enchanted creature can't attack",
      },
      {
        kind: 'cant_block',
        target: { kind: 'raw', text: 'Enchanted creature' },
        duration: 'static',
        raw: "Enchanted creature can't block",
      },
    ]);
  });

  it("parses enchanted creature can't attack or block, and its activated abilities can't be activated into three static restriction steps", () => {
    const ir = parseOracleTextToIR(
      "Enchanted creature can't attack or block, and its activated abilities can't be activated.",
      "Lawmage's Binding"
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'cant_attack',
        target: { kind: 'raw', text: 'Enchanted creature' },
        duration: 'static',
        raw: "Enchanted creature can't attack",
      },
      {
        kind: 'cant_block',
        target: { kind: 'raw', text: 'Enchanted creature' },
        duration: 'static',
        raw: "Enchanted creature can't block",
      },
      {
        kind: 'cant_activate_abilities',
        target: { kind: 'raw', text: 'it' },
        duration: 'static',
        raw: "its activated abilities can't be activated",
      },
    ]);
  });

  it('parses creatures you control get +1/+1 until end of turn into a multi-creature modify_pt step', () => {
    const ir = parseOracleTextToIR('Creatures you control get +1/+1 until end of turn.', 'Glorious Charge');

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'modify_pt',
          target: { kind: 'raw', text: 'creatures you control' },
          power: 1,
          toughness: 1,
          duration: 'end_of_turn',
        }),
      ])
    );
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

  it('absorbs copy retarget tails into nested copy-spell steps', () => {
    const ir = parseOracleTextToIR(
      'Whenever you cast a multicolored instant or sorcery spell, you may pay {1}. If you do, copy that spell. You may choose new targets for the copy.',
      'Cloven Casting'
    );

    const ability = ir.abilities[0] as any;
    expect(ability.steps.some((step: any) => String(step?.raw || '') === 'You may choose new targets for the copy')).toBe(false);
    expect(ability.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'conditional',
          steps: [
            expect.objectContaining({
              kind: 'copy_spell',
              allowNewTargets: true,
            }),
          ],
        }),
      ])
    );
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

  it('parses temporary evasion text such as Bright-Palm follow-up clauses', () => {
    const text = "Double the number of +1/+1 counters on target creature. That creature can't be blocked by creatures with power 2 or less this turn.";
    const ir = parseOracleTextToIR(text, 'Bright-Palm, Soul Awakener');
    const steps = ir.abilities[0].steps;

    expect(steps[0]).toMatchObject({
      kind: 'double_counters',
      target: { kind: 'raw', text: 'target creature' },
      counter: '+1/+1',
    });
    expect(steps[1]).toMatchObject({
      kind: 'grant_temporary_ability',
      target: { kind: 'raw', text: 'That creature' },
      duration: 'this_turn',
      effectText: ["can't be blocked by creatures with power 2 or less"],
    });
  });

  it('splits combined temporary keyword and unblockable clauses', () => {
    const text = 'Target creature gains lifelink until end of turn and can\'t be blocked this turn.';
    const ir = parseOracleTextToIR(text, 'Escape Tunnel Test');
    const steps = ir.abilities[0].steps;

    expect(steps).toMatchObject([
      {
        kind: 'grant_temporary_ability',
        target: { kind: 'raw', text: 'Target creature' },
        duration: 'end_of_turn',
        abilities: ['lifelink'],
      },
      {
        kind: 'grant_temporary_ability',
        target: { kind: 'raw', text: 'Target creature' },
        duration: 'this_turn',
        effectText: ["can't be blocked"],
      },
    ]);
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

  it('parses standalone look-top informational clauses', () => {
    const ir = parseOracleTextToIR('Look at the top three cards of your library.', 'Ponder Probe');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'look_top',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 3 },
        raw: 'Look at the top three cards of your library',
      },
    ]);
  });

  it('parses optional standalone look-top informational clauses', () => {
    const ir = parseOracleTextToIR('At the beginning of your upkeep, you may look at the top card of your library.', 'Kinship Probe');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'look_top',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        optional: true,
        raw: 'you may look at the top card of your library',
      },
    ]);
  });

  it('prunes trailing top-of-library reorder clauses after look-top parsing', () => {
    const ir = parseOracleTextToIR(
      'Look at the top three cards of your library, then put them back in any order. You may shuffle.',
      'Ponder'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'look_top',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 3 },
        raw: 'Look at the top three cards of your library',
      },
      expect.objectContaining({
        kind: 'shuffle_library',
        optional: true,
      }),
    ]);
  });

  it('parses standalone reveal-top informational clauses', () => {
    const ir = parseOracleTextToIR('Reveal the top card of your library.', 'Reveal Probe');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'reveal_top',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'Reveal the top card of your library',
      },
    ]);
  });

  it('parses then-prefixed standalone reveal-top informational clauses', () => {
    const ir = parseOracleTextToIR('Then reveal the top card of your library.', 'Reveal Probe');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'reveal_top',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        sequence: 'then',
        raw: 'Then reveal the top card of your library',
      },
    ]);
  });

  it('parses each-player reveal-top informational clauses', () => {
    const ir = parseOracleTextToIR('Each player reveals the top card of their library.', 'Game Preserve');

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'reveal_top',
        who: { kind: 'each_player' },
        amount: { kind: 'number', value: 1 },
        raw: 'Each player reveals the top card of their library',
      },
    ]);
  });

  it('rewrites immediate top-card follow-up move references after look-top parsing', () => {
    const ir = parseOracleTextToIR(
      'Look at the top card of your library. You may put it into your graveyard.',
      'Look Probe'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'look_top',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'Look at the top card of your library',
      },
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'the top card of your library' },
        to: 'graveyard',
        toRaw: 'your graveyard',
        optional: true,
        raw: 'You may put it into your graveyard',
      },
    ]);
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
        amount: { kind: 'object_stat', subject: 'that_card', stat: 'mana_value' },
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
        amount: { kind: 'object_stat', subject: 'that_card', stat: 'power' },
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

  it('parses Aid the Fallen as a choose-one-or-both modal block', () => {
    const oracleText =
      'Choose one or both —\n\u2022 Return target creature card from your graveyard to your hand.\n\u2022 Return target planeswalker card from your graveyard to your hand.';

    const ir = parseOracleTextToIR(oracleText, 'Aid the Fallen');
    const step = ir.abilities[0]?.steps?.[0] as any;

    expect(step).toMatchObject({
      kind: 'choose_mode',
      minModes: 1,
      maxModes: 2,
      canRepeatModes: false,
    });
    expect(step?.modes?.map((mode: any) => mode.steps?.[0])).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        what: { kind: 'raw', text: 'target creature card from your graveyard' },
        to: 'hand',
      }),
      expect.objectContaining({
        kind: 'move_zone',
        what: { kind: 'raw', text: 'target planeswalker card from your graveyard' },
        to: 'hand',
      }),
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

  it('parses static skip-your-draw-step text into a draw-skip step', () => {
    const ir = parseOracleTextToIR(
      'Skip your draw step. Whenever you discard a card, exile that card from your graveyard.',
      'Necropotence'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
        kind: 'skip_next_draw_step',
        who: { kind: 'you' },
        raw: 'Skip your draw step',
        }),
      ])
    );
  });

  it("parses temporary no-defender attack permissions into temporary ability steps", () => {
    const ir = parseOracleTextToIR(
      "{3}: This creature can attack this turn as though it didn't have defender.",
      'Skyclave Squid'
    );

    const activated = ir.abilities.find(ability => ability.type === 'activated');
    expect(activated?.steps).toEqual([
      expect.objectContaining({
        kind: 'grant_temporary_ability',
        target: { kind: 'raw', text: 'This creature' },
        duration: 'this_turn',
        effectText: ["can attack as though it didn't have defender"],
      }),
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

    expect(ir.abilities[1]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'grant_graveyard_permission',
          who: { kind: 'you' },
          what: { kind: 'raw', text: 'this card' },
          permission: 'cast',
          duration: 'during_resolution',
          optional: true,
        }),
        expect.objectContaining({
          kind: 'modify_graveyard_permissions',
          scope: 'last_granted_graveyard_cards',
          castCostRaw: '{2}{R}',
        }),
      ])
    );
  });

  it('parses reminder-bearing flashback keyword lines like Bulk Up into graveyard cast-cost metadata', () => {
    const ir = parseOracleTextToIR(
      "Double target creature's power until end of turn. Flashback {4}{R}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
      'Bulk Up'
    );

    expect(ir.abilities[1]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'grant_graveyard_permission',
          who: { kind: 'you' },
          what: { kind: 'raw', text: 'this card' },
          permission: 'cast',
        }),
        expect.objectContaining({
          kind: 'modify_graveyard_permissions',
          scope: 'last_granted_graveyard_cards',
          castCostRaw: '{4}{R}{R}',
        }),
      ])
    );
  });

  it('parses Unearth reminder text into self-return plus delayed exile and leave-battlefield replacement', () => {
    const ir = parseOracleTextToIR(
      'Unearth {B} ({B}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)',
      'Dregscape Zombie'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(String(ir.abilities[0]?.cost || '')).toContain('{B}');
    expect(ir.abilities[0]?.steps.map(step => step.kind)).toEqual([
      'move_zone',
      'schedule_delayed_battlefield_action',
      'grant_leave_battlefield_replacement',
    ]);
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'this card' },
      to: 'battlefield',
    });
  });

  it('parses bare Unearth keyword lines without reminder text', () => {
    const ir = parseOracleTextToIR('Double strike\nUnearth {3}{R}{R}\n(Melds with Mishra, Claimed by Gix.)', 'Phyrexian Dragon Engine');

    expect(ir.abilities.find(ability => ability.cost === '{3}{R}{R}')?.steps.map(step => step.kind)).toEqual([
      'move_zone',
      'schedule_delayed_battlefield_action',
      'grant_leave_battlefield_replacement',
    ]);
  });

  it('parses Transmute keyword lines into a reusable library-search step', () => {
    const ir = parseOracleTextToIR('Transmute {1}{U}{U}', 'Muddle the Mixture');
    const transmute = ir.abilities.find(ability => String(ability.cost || '').includes('{1}{U}{U}'));

    expect(transmute).toMatchObject({
      type: 'keyword',
      cost: '{1}{U}{U}, Discard this card',
      effectText: 'Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Activate only as a sorcery.',
    });
    expect(transmute?.steps).toEqual([
      {
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'same_mana_value_as_source' },
        destination: 'hand',
        revealFound: true,
        shuffle: true,
        maxResults: 1,
        raw: 'Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle.',
      },
    ]);
  });

  it('parses Basic landcycling keyword lines into a reusable library-search step', () => {
    const ir = parseOracleTextToIR('Basic landcycling {1}{B}', 'Absorb Vis');
    const landcycling = ir.abilities.find(ability => String(ability.cost || '').includes('{1}{B}'));

    expect(landcycling).toMatchObject({
      type: 'keyword',
      cost: '{1}{B}, Discard this card',
      effectText: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
    });
    expect(landcycling?.steps).toEqual([
      expect.objectContaining({
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: 'basic land' },
        destination: 'hand',
        revealFound: true,
        shuffle: true,
        maxResults: 1,
        raw: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle',
      }),
    ]);
  });

  it('parses land-type cycling keyword lines into a subtype library-search step', () => {
    const ir = parseOracleTextToIR('Plainscycling {2}', 'Eternal Dragon');
    const typecycling = ir.abilities.find(ability => String(ability.cost || '').includes('{2}'));

    expect(typecycling).toMatchObject({
      type: 'keyword',
      cost: '{2}, Discard this card',
      effectText: 'Search your library for a Plains card, reveal it, put it into your hand, then shuffle.',
    });
    expect(typecycling?.steps).toEqual([
      expect.objectContaining({
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: 'Plains' },
        destination: 'hand',
        revealFound: true,
        shuffle: true,
        maxResults: 1,
        raw: 'Search your library for a Plains card, reveal it, put it into your hand, then shuffle',
      }),
    ]);
  });

  it('parses subtypecycling keyword lines into a typed library-search step', () => {
    const ir = parseOracleTextToIR('Wizardcycling {3}', 'Vedalken Aethermage');
    const typecycling = ir.abilities.find(ability => String(ability.cost || '').includes('{3}'));

    expect(typecycling).toMatchObject({
      type: 'keyword',
      cost: '{3}, Discard this card',
      effectText: 'Search your library for a Wizard card, reveal it, put it into your hand, then shuffle.',
    });
    expect(typecycling?.steps).toEqual([
      expect.objectContaining({
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: 'Wizard' },
        destination: 'hand',
        revealFound: true,
        shuffle: true,
        maxResults: 1,
        raw: 'Search your library for a Wizard card, reveal it, put it into your hand, then shuffle',
      }),
    ]);
  });

  it('merges optional search-to-hand plus trailing shuffle into a single search_library step', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, you may search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
      'Seedship Agrarian'
    );
    const ability = ir.abilities[0];

    expect(ability?.type).toBe('triggered');
    expect(ability?.steps).toHaveLength(1);
    expect(ability?.steps[0]).toMatchObject({
      kind: 'search_library',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: 'basic land' },
      destination: 'hand',
      revealFound: true,
      shuffle: true,
      maxResults: 1,
      optional: true,
    });
  });

  it('parses Transfigure keyword lines into a battlefield tutor step with a creature filter', () => {
    const ir = parseOracleTextToIR('Transfigure {1}{B}{B}', 'Fleshwrither');
    const transfigure = ir.abilities.find(ability => String(ability.cost || '').includes('{1}{B}{B}'));

    expect(transfigure).toMatchObject({
      type: 'keyword',
      cost: '{1}{B}{B}, Sacrifice this permanent',
      effectText:
        'Search your library for a creature card with the same mana value as this permanent, put it onto the battlefield, then shuffle. Activate only as a sorcery.',
    });
    expect(transfigure?.steps).toEqual([
      {
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'same_mana_value_as_source', requiredCardType: 'creature' },
        destination: 'battlefield',
        shuffle: true,
        maxResults: 1,
        raw: 'Search your library for a creature card with the same mana value as this permanent, put it onto the battlefield, then shuffle.',
      },
    ]);
  });

  it('parses Encore keyword lines into exile-plus-copy-token-per-opponent steps', () => {
    const ir = parseOracleTextToIR('Encore {5}{U}{U}', 'Impaler Shrike');
    const encore = ir.abilities.find(ability => String(ability.cost || '').includes('{5}{U}{U}'));

    expect(encore).toMatchObject({
      type: 'keyword',
      cost: '{5}{U}{U}, Exile this card from your graveyard',
    });
    expect(encore?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'this card' },
        to: 'exile',
        toRaw: 'exile',
        raw: 'Exile this card from your graveyard.',
      },
      {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        token: 'copy of it',
        entersTapped: true,
        attacking: 'each_opponent',
        grantsHaste: 'permanent',
        atNextEndStep: 'sacrifice',
        raw: "For each opponent, create a token that's a copy of it. Those tokens enter tapped and attacking. They gain haste. Sacrifice them at the beginning of the next end step.",
      },
    ]);
  });

  it('parses Myriad keyword lines into an attacks trigger that copies for each other opponent', () => {
    const ir = parseOracleTextToIR('Myriad', 'Warchief');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature attacks',
      effectText:
        "For each opponent other than defending player, create a token that's a copy of it. Those tokens enter tapped and attacking. Exile them at end of combat.",
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        token: 'copy of it',
        entersTapped: true,
        attacking: 'each_other_opponent',
        atEndOfCombat: 'exile',
        raw: "For each opponent other than defending player, create a token that's a copy of it. Those tokens enter tapped and attacking. Exile them at end of combat.",
      },
    ]);
  });

  it('parses Annihilator keyword lines into an attacks trigger that sacrifices permanents', () => {
    const ir = parseOracleTextToIR('Annihilator 2', 'Void Colossus');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature attacks',
      effectText: 'Defending player sacrifices 2 permanents.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'sacrifice',
        who: { kind: 'target_opponent' },
        what: { kind: 'raw', text: '2 permanents' },
      },
    ]);
  });

  it('parses Afterlife keyword lines into a dies trigger that creates Spirit tokens', () => {
    const ir = parseOracleTextToIR('Afterlife 2', 'Imperious Oligarch');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this permanent dies',
      effectText: 'Create 2 1/1 white and black Spirit creature tokens with flying.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
        token: '1/1 white and black Spirit',
        raw: 'Create 2 1/1 white and black Spirit creature tokens with flying',
      },
    ]);
  });

  it('parses Afflict keyword lines into a becomes-blocked trigger that drains the defending player', () => {
    const ir = parseOracleTextToIR('Afflict 2', 'Storm Fleet Sprinter');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature becomes blocked',
      effectText: 'Defending player loses 2 life.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'lose_life',
        who: { kind: 'target_opponent' },
        amount: { kind: 'number', value: 2 },
      },
    ]);
  });

  it('parses Renown keyword lines into a combat-damage trigger with a renowned gate and marker step', () => {
    const ir = parseOracleTextToIR('Renown 1', 'Topan Freeblade');
    const ability = ir.abilities[0];
    const steps = unwrapLeadingConditionalSteps(ability?.steps ?? []);

    expect(ability).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature deals combat damage to a player',
      interveningIf: "this creature isn't renowned",
      effectText: 'Put 1 +1/+1 counter on this creature. This creature becomes renowned.',
    });
    expect(ability?.steps?.[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: "this creature isn't renowned" },
    });
    expect(steps).toMatchObject([
      {
        kind: 'add_counter',
        target: { kind: 'raw', text: 'this creature' },
        counter: '+1/+1',
        amount: { kind: 'number', value: 1 },
      },
      {
        kind: 'become_renowned',
        target: { kind: 'raw', text: 'This creature' },
      },
    ]);
  });

  it('parses Ingest keyword lines into a combat-damage trigger that exiles from that player', () => {
    const ir = parseOracleTextToIR('Ingest', 'Benthic Infiltrator');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature deals combat damage to a player',
      effectText: 'That player exiles the top card of their library.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'exile_top',
        who: { kind: 'target_player' },
        amount: { kind: 'number', value: 1 },
      },
    ]);
  });

  it('parses Poisonous keyword lines into a combat-damage trigger that gives that player poison counters', () => {
    const ir = parseOracleTextToIR('Poisonous 3', 'Pit Scorpion');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature deals combat damage to a player',
      effectText: 'That player gets 3 poison counters.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'add_player_counter',
        who: { kind: 'target_player' },
        counter: 'poison',
        amount: { kind: 'number', value: 3 },
      },
    ]);
  });

  it('parses energy-counter shorthand clauses into add_player_counter steps', () => {
    const ir = parseOracleTextToIR('You get {E}{E} (two energy counters).', 'Test');

    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'add_player_counter',
        who: { kind: 'you' },
        counter: 'energy',
        amount: { kind: 'number', value: 2 },
      },
    ]);
  });

  it('parses Fabricate keyword lines into a self-ETB trigger with counters plus a Servo fallback', () => {
    const ir = parseOracleTextToIR('Fabricate 2', 'Glint-Sleeve Artisan');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this permanent enters the battlefield',
      effectText: "You may put 2 +1/+1 counters on it. If you don't, create 2 1/1 colorless Servo artifact creature tokens.",
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'add_counter',
        target: { kind: 'raw', text: 'it' },
        counter: '+1/+1',
        amount: { kind: 'number', value: 2 },
        optional: true,
      },
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: "you don't" },
        steps: [
          {
            kind: 'create_token',
            token: '1/1 colorless Servo artifact',
            amount: { kind: 'number', value: 2 },
          },
        ],
      },
    ]);
  });

  it('parses Storm keyword lines into a self-cast trigger that copies this spell by storm count', () => {
    const ir = parseOracleTextToIR('Storm', 'Grapeshot');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'you cast this spell',
      effectText: 'Copy this spell for each spell cast before it this turn. You may choose new targets for the copies.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'copy_spell',
        subject: 'this_spell',
        copies: { kind: 'spells_cast_before_this_turn' },
        allowNewTargets: true,
      },
    ]);
  });

  it('parses League Guildmage spell-copy activations into targeted copy_spell steps', () => {
    const ir = parseOracleTextToIR(
      '{3}{U}, {T}: Draw a card.\n{X}{R}, {T}: Copy target instant or sorcery spell you control with mana value X. You may choose new targets for the copy.',
      'League Guildmage'
    );

    const copyAbility = ir.abilities.find((ability) => ability.steps.some((step) => step.kind === 'copy_spell'));
    expect(copyAbility?.type).toBe('activated');
    expect(copyAbility?.steps).toEqual([
      expect.objectContaining({
        kind: 'copy_spell',
        subject: 'target_spell',
        target: { kind: 'raw', text: 'target instant or sorcery spell you control with mana value X' },
        allowNewTargets: true,
      }),
    ]);
  });

  it('parses bare target-spell copy lines into copy_spell steps with retarget support', () => {
    const ir = parseOracleTextToIR('Copy target spell. You may choose new targets for the copy.', 'See Double');

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'copy_spell',
        subject: 'target_spell',
        target: { kind: 'raw', text: 'target spell' },
        allowNewTargets: true,
      }),
    ]);
  });

  it('parses Melek, Izzet Paragon copy-it triggers into target_spell copy steps', () => {
    const ir = parseOracleTextToIR(
      'Play with the top card of your library revealed.\nYou may cast instant and sorcery spells from the top of your library.\nWhenever you cast an instant or sorcery spell from your library, copy it. You may choose new targets for the copy.',
      'Melek, Izzet Paragon'
    );

    const copyAbility = ir.abilities.find((ability) => ability.steps.some((step) => step.kind === 'copy_spell'));
    expect(copyAbility?.type).toBe('triggered');
    expect(copyAbility?.steps).toEqual([
      expect.objectContaining({
        kind: 'copy_spell',
        subject: 'target_spell',
        target: { kind: 'raw', text: 'it' },
        allowNewTargets: true,
      }),
    ]);
  });

  it('merges copy-ability retarget tails onto the primary unknown step', () => {
    const ir = parseOracleTextToIR(
      "Vigilance\n{1}, {T}: Copy target activated or triggered ability you control from a colorless source. You may choose new targets for the copy. (Mana abilities can't be targeted.)",
      'Abstruse Archaic'
    );

    const copyAbility = ir.abilities.find((ability) => ability.type === 'activated');
    expect(copyAbility?.steps.some((step: any) => String(step?.raw || '').trim() === 'You may choose new targets for the copy')).toBe(false);
    expect(copyAbility?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        raw: expect.stringContaining('You may choose new targets for the copy'),
      })
    );
  });

  it('merges retarget tails onto unmodeled spell-or-ability copy clauses', () => {
    const ir = parseOracleTextToIR(
      'Whenever you cast an instant or sorcery spell that targets only Bill Potts or activate an ability that targets only Bill Potts, copy that spell or ability. You may choose new targets for the copy. This ability triggers only once each turn.',
      'Bill Potts'
    );

    const copyAbility = ir.abilities.find((ability) => ability.type === 'triggered');
    expect(copyAbility?.steps.some((step: any) => String(step?.raw || '').trim() === 'You may choose new targets for the copy')).toBe(false);
    expect(copyAbility?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        raw: expect.stringContaining('You may choose new targets for the copy'),
      })
    );
  });

  it('merges retarget tails onto deferred next-spell copy clauses', () => {
    const ir = parseOracleTextToIR(
      'Whenever this creature deals combat damage to a player, copy the next instant or sorcery spell you cast this turn when you cast it. You may choose new targets for the copy.',
      'Tzaangor Shaman'
    );

    const copyAbility = ir.abilities.find((ability) => ability.type === 'triggered');
    expect(copyAbility?.steps.some((step: any) => String(step?.raw || '').trim() === 'You may choose new targets for the copy')).toBe(false);
    expect(copyAbility?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        raw: expect.stringContaining('You may choose new targets for the copy'),
      })
    );
  });

  it('merges retarget tails onto when-you-next-cast copy-that-spell clauses', () => {
    const ir = parseOracleTextToIR(
      '−2: When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.',
      'Chandra, the Firebrand'
    );

    const copyAbility = ir.abilities.find((ability) => ability.type === 'activated');
    expect(copyAbility?.steps.some((step: any) => String(step?.raw || '').trim() === 'You may choose new targets for the copy')).toBe(false);
    expect(copyAbility?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        raw: expect.stringContaining('You may choose new targets for the copy'),
      })
    );
  });

  it('merges retarget tails onto chapter-prefixed whenever-cast copy clauses', () => {
    const ir = parseOracleTextToIR(
      'III — Until end of turn, whenever you cast an instant or sorcery spell, copy it. You may choose new targets for the copy.',
      'The Mirari Conjecture'
    );

    expect(ir.abilities[0]?.steps.some((step: any) => String(step?.raw || '').trim() === 'You may choose new targets for the copy')).toBe(false);
    expect(ir.abilities[0]?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        raw: expect.stringContaining('You may choose new targets for the copy'),
      })
    );
  });

  it('merges retarget tails onto die-roll result copy clauses', () => {
    const ir = parseOracleTextToIR(
      'Whenever you cast an instant or sorcery spell with mana value 3 or greater, roll a d20. 20 | Copy that spell. You may choose new targets for the copy.',
      'Mathise, Surge Channeler'
    );

    const mergedCopyStep = ir.abilities
      .flatMap((ability) => ability.steps)
      .find((step: any) => String(step?.raw || '').includes('20 | Copy that spell'));

    expect(ir.abilities.flatMap((ability) => ability.steps).some((step: any) => String(step?.raw || '').trim() === 'You may choose new targets for the copy')).toBe(false);
    expect(mergedCopyStep).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        raw: expect.stringContaining('You may choose new targets for the copy'),
      })
    );
  });

  it('merges retarget tails onto spree copy-target clauses', () => {
    const ir = parseOracleTextToIR(
      '+ {1} — Copy target instant spell, sorcery spell, activated ability, or triggered ability. You may choose new targets for the copy.',
      'Return the Favor'
    );

    expect(ir.abilities[0]?.steps.some((step: any) => String(step?.raw || '').trim() === 'You may choose new targets for the copy')).toBe(false);
    expect(ir.abilities[0]?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        raw: expect.stringContaining('You may choose new targets for the copy'),
      })
    );
  });

  it('merges retarget tails back onto parsed copy-spell steps after then-followups', () => {
    const ir = parseOracleTextToIR(
      "Copy target instant or sorcery spell, then return it to its owner's hand. You may choose new targets for the copy.",
      "Narset's Reversal"
    );

    expect(ir.abilities[0]?.steps.some((step: any) => String(step?.raw || '').trim() === 'You may choose new targets for the copy')).toBe(false);
    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'copy_spell',
        target: { kind: 'raw', text: 'target instant or sorcery spell' },
        allowNewTargets: true,
      }),
      expect.objectContaining({
        kind: 'move_zone',
        sequence: 'then',
        what: { kind: 'raw', text: 'it' },
        to: 'hand',
      }),
    ]);
  });

  it('merges retarget tails onto replicate multi-copy clauses', () => {
    const ir = parseOracleTextToIR(
      'Replicate {1} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)',
      'Consign to Memory'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]?.steps.some((step: any) => String(step?.raw || '').trim() === 'You may choose new targets for the copies')).toBe(false);
    expect(ir.abilities[0]?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'copy_spell',
        subject: 'this_spell',
        copies: { kind: 'replicate_count' },
        allowNewTargets: true,
      })
    );
  });

  it('parses Cascade keyword lines into a self-cast trigger with a spell-mana-value exile loop', () => {
    const ir = parseOracleTextToIR('Cascade', 'Bloodbraid Elf');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'you cast this spell',
      effectText:
        "Exile cards from the top of your library until you exile a nonland card whose mana value is less than this spell's mana value. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order.",
    });
    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'impulse_exile_top',
          who: { kind: 'you' },
          amount: {
            kind: 'unknown',
            raw: "until you exile a nonland card whose mana value is less than this spell's mana value",
          },
          duration: 'during_resolution',
          permission: 'cast',
        }),
      ])
    );
    expect(ir.abilities[0]?.steps.some(step => step.kind === 'unknown')).toBe(false);
  });

  it('prunes leading flip-a-coin stubs when the win branch is already parsed', () => {
    const ir = parseOracleTextToIR(
      'Flip a coin. If you win the flip, sacrifice this artifact and draw three cards.',
      "Sorcerer's Strongbox"
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you win the flip' },
        steps: [
          expect.objectContaining({ kind: 'sacrifice' }),
          expect.objectContaining({ kind: 'draw', amount: { kind: 'number', value: 3 } }),
        ],
      }),
    ]);
    expect(ir.abilities[0]?.steps.some(step => step.kind === 'unknown')).toBe(false);
  });

  it('parses lose-the-flip damage branches into executable conditional steps', () => {
    const ir = parseOracleTextToIR(
      '{3}, {T}: Flip a coin. If you lose the flip, this artifact deals 3 damage to you.',
      'Goblin Lyre'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you lose the flip' },
        steps: [
          expect.objectContaining({
            kind: 'deal_damage',
            amount: { kind: 'number', value: 3 },
            source: { kind: 'raw', text: 'this artifact' },
            target: { kind: 'raw', text: 'you' },
          }),
        ],
      }),
    ]);
    expect(ir.abilities[0]?.steps.some(step => step.kind === 'unknown')).toBe(false);
  });

  it('prunes bare landwalk keyword lines from unknown IR steps', () => {
    const ir = parseOracleTextToIR('Swampwalk', 'Bog Wraith');

    expect(ir.keywords).toContain('swampwalk');
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('prunes landwalk reminder text from unknown IR steps', () => {
    const ir = parseOracleTextToIR(
      "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)",
      'Bog Wraith'
    );

    expect(ir.keywords).toContain('swampwalk');
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('prunes comma-separated landwalk keyword bundles from unknown IR steps', () => {
    const ir = parseOracleTextToIR(
      'Plainswalk, islandwalk, swampwalk, mountainwalk, forestwalk',
      'Staff of the Ages'
    );

    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('parses Living weapon keyword lines into a Germ token creation plus attach follow-up', () => {
    const ir = parseOracleTextToIR('Living weapon', 'Flayer Husk');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this equipment enters the battlefield',
      effectText: 'Create a 0/0 black Phyrexian Germ creature token, then attach this Equipment to it.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        token: '0/0 black Phyrexian Germ',
      },
      {
        kind: 'attach',
        attachment: { kind: 'raw', text: 'this Equipment' },
        to: { kind: 'raw', text: 'it' },
      },
    ]);
  });

  it('parses For Mirrodin! keyword lines into a Rebel token creation plus attach follow-up', () => {
    const ir = parseOracleTextToIR('For Mirrodin!', 'Hexgold Halberd');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this equipment enters the battlefield',
      effectText: 'Create a 2/2 red Rebel creature token, then attach this Equipment to it.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        token: '2/2 red Rebel',
      },
      {
        kind: 'attach',
        attachment: { kind: 'raw', text: 'this Equipment' },
        to: { kind: 'raw', text: 'it' },
      },
    ]);
  });

  it('parses job select keyword lines into a Hero token creation plus attach follow-up', () => {
    const ir = parseOracleTextToIR('Job select', 'Freelancer Class');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this equipment enters the battlefield',
      effectText: 'Create a 1/1 colorless Hero creature token, then attach this Equipment to it.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        token: '1/1 colorless Hero',
      },
      {
        kind: 'attach',
        attachment: { kind: 'raw', text: 'this Equipment' },
        to: { kind: 'raw', text: 'it' },
      },
    ]);
  });

  it('parses optional attach follow-ups with pronoun targets', () => {
    const ir = parseOracleTextToIR(
      'Whenever a creature enters, you may attach this Equipment to it.',
      'Sample Equipment'
    );

    expect(ir.abilities).toEqual([
      {
        type: 'triggered',
        text: 'Whenever a creature enters, you may attach this Equipment to it.',
        triggerCondition: 'a creature enters',
        effectText: 'you may attach this Equipment to it.',
        steps: [
          {
            kind: 'attach',
            attachment: { kind: 'raw', text: 'this Equipment' },
            to: { kind: 'raw', text: 'it' },
            optional: true,
            raw: 'you may attach this Equipment to it',
          },
        ],
      },
    ]);
  });

  it('parses Training keyword lines into an attacks trigger that adds a counter to this creature', () => {
    const ir = parseOracleTextToIR('Training', 'Hopeful Initiate');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: "this creature and at least one other creature with power greater than this creature's power attack",
      effectText: 'Put a +1/+1 counter on this creature.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'add_counter',
        target: { kind: 'raw', text: 'this creature' },
        counter: '+1/+1',
        amount: { kind: 'number', value: 1 },
      },
    ]);
  });

  it('parses Evolve keyword lines into an ETB trigger gated on larger power or toughness', () => {
    const ir = parseOracleTextToIR('Evolve', 'Cloudfin Raptor');
    const ability = ir.abilities[0];
    const steps = unwrapLeadingConditionalSteps(ability?.steps ?? []);

    expect(ability).toMatchObject({
      type: 'triggered',
      triggerCondition: 'another creature enters the battlefield under your control',
      interveningIf: "that creature's power is greater than this creature's power or that creature's toughness is greater than this creature's toughness",
      effectText: 'Put a +1/+1 counter on this creature.',
    });
    expect(ability?.steps?.[0]).toMatchObject({
      kind: 'conditional',
      condition: {
        kind: 'if',
        raw: "that creature's power is greater than this creature's power or that creature's toughness is greater than this creature's toughness",
      },
    });
    expect(steps).toMatchObject([
      {
        kind: 'add_counter',
        target: { kind: 'raw', text: 'this creature' },
        counter: '+1/+1',
        amount: { kind: 'number', value: 1 },
      },
    ]);
  });

  it('parses Exploit keyword lines into a self-ETB trigger with an optional sacrifice step', () => {
    const ir = parseOracleTextToIR('Exploit', "Sidisi's Faithful");

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this permanent enters the battlefield',
      effectText: 'You may sacrifice a creature.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'sacrifice',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'a creature' },
        optional: true,
      },
    ]);
  });

  it('parses Undying keyword lines into a dies trigger gated on missing +1/+1 counters', () => {
    const ir = parseOracleTextToIR('Undying', 'Young Wolf');
    const ability = ir.abilities[0];
    const steps = unwrapLeadingConditionalSteps(ability?.steps ?? []);

    expect(ability).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this permanent dies',
      interveningIf: 'it had no +1/+1 counters on it',
      effectText: "Return this card to the battlefield under its owner's control with a +1/+1 counter on it.",
    });
    expect(ability?.steps?.[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'it had no +1/+1 counters on it' },
    });
    expect(steps).toMatchObject([
      {
        kind: 'move_zone',
        to: 'battlefield',
        battlefieldController: { kind: 'owner_of_moved_cards' },
        withCounters: { '+1/+1': 1 },
      },
    ]);
  });

  it('parses Persist keyword lines into a dies trigger gated on missing -1/-1 counters', () => {
    const ir = parseOracleTextToIR('Persist', 'Kitchen Finks');
    const ability = ir.abilities[0];
    const steps = unwrapLeadingConditionalSteps(ability?.steps ?? []);

    expect(ability).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this permanent dies',
      interveningIf: 'it had no -1/-1 counters on it',
      effectText: "Return this card to the battlefield under its owner's control with a -1/-1 counter on it.",
    });
    expect(ability?.steps?.[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'it had no -1/-1 counters on it' },
    });
    expect(steps).toMatchObject([
      {
        kind: 'move_zone',
        to: 'battlefield',
        battlefieldController: { kind: 'owner_of_moved_cards' },
        withCounters: { '-1/-1': 1 },
      },
    ]);
  });

  it('parses Exalted keyword lines into an attacks-alone trigger that buffs the attacker', () => {
    const ir = parseOracleTextToIR('Exalted', 'Akrasan Squire');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'a creature you control attacks alone',
      effectText: 'That creature gets +1/+1 until end of turn.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'modify_pt',
        target: { kind: 'raw', text: 'that creature' },
        power: 1,
        toughness: 1,
        duration: 'end_of_turn',
        raw: 'That creature gets +1/+1 until end of turn',
      },
    ]);
  });

  it('parses Mentor keyword lines into an attacks trigger that adds a counter to a smaller attacker', () => {
    const ir = parseOracleTextToIR('Mentor', 'Fresh-Faced Recruit');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature attacks',
      effectText: "Put a +1/+1 counter on target attacking creature with power less than this creature's power.",
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 1 },
        counter: '+1/+1',
        target: { kind: 'raw', text: "target attacking creature with power less than this creature's power" },
        raw: "Put a +1/+1 counter on target attacking creature with power less than this creature's power",
      },
    ]);
  });

  it('parses Battle cry keyword lines into an attacks trigger that buffs other attackers', () => {
    const ir = parseOracleTextToIR('Battle cry', 'Signal Pest');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature attacks',
      effectText: 'Each other attacking creature gets +1/+0 until end of turn.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'modify_pt',
        target: { kind: 'raw', text: 'each other attacking creature' },
        power: 1,
        toughness: 0,
        duration: 'end_of_turn',
        raw: 'Each other attacking creature gets +1/+0 until end of turn',
      },
    ]);
  });

  it('parses Melee keyword lines into an attacks trigger that buffs itself by players attacked', () => {
    const ir = parseOracleTextToIR('Melee', 'Grenzo Havoc Raiser');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature attacks',
      effectText: 'This creature gets +X/+X until end of turn where X is the number of players being attacked.',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'modify_pt',
        target: { kind: 'raw', text: 'this creature' },
        power: 1,
        toughness: 1,
        powerUsesX: true,
        toughnessUsesX: true,
        duration: 'end_of_turn',
        condition: { kind: 'where', raw: 'X is the number of players being attacked' },
        raw: 'This creature gets +X/+X until end of turn where X is the number of players being attacked',
      },
    ]);
  });

  it('parses Dethrone keyword lines into an attacks trigger with an intervening life-lead check', () => {
    const ir = parseOracleTextToIR('Dethrone', 'Marchesa Initiate');
    const ability = ir.abilities[0];
    const steps = unwrapLeadingConditionalSteps(ability?.steps ?? []);

    expect(ability).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature attacks',
      interveningIf: 'defending player has the most life or is tied for the most life',
      effectText: 'Put a +1/+1 counter on this creature.',
    });
    expect(ability?.steps?.[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'defending player has the most life or is tied for the most life' },
    });
    expect(steps[0]).toMatchObject({
      kind: 'add_counter',
      target: { kind: 'raw', text: 'this creature' },
      counter: '+1/+1',
      amount: { kind: 'number', value: 1 },
    });
  });

  it('parses Prowess keyword lines into a noncreature-spell trigger that buffs itself', () => {
    const ir = parseOracleTextToIR('Prowess', 'Stormchaser Adept');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'you cast a noncreature spell',
      effectText: 'This creature gets +1/+1 until end of turn.',
    });
    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'modify_pt',
        target: { kind: 'raw', text: 'this creature' },
        power: 1,
        toughness: 1,
        duration: 'end_of_turn',
        raw: 'This creature gets +1/+1 until end of turn',
      },
    ]);
  });

  it('parses Mobilize keyword lines into an attacks trigger that creates defending-player tokens', () => {
    const ir = parseOracleTextToIR('Mobilize 3', 'Warhost Herald');

    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature attacks',
      effectText:
        'Create 3 1/1 red Warrior creature tokens. Those tokens enter tapped and attacking. Sacrifice them at the beginning of the next end step.',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 3 },
        token: '1/1 red Warrior creature',
        entersTapped: true,
        attacking: 'defending_player',
        atNextEndStep: 'sacrifice',
        raw: 'Create 3 1/1 red Warrior creature tokens. Those tokens enter tapped and attacking. Sacrifice them at the beginning of the next end step.',
      },
    ]);
  });

  it('preserves Mobilize token count when parsing the expanded reminder text directly', () => {
    const ir = parseOracleTextToIR(
      'Create 3 1/1 red Warrior creature tokens. Those tokens enter tapped and attacking. Sacrifice them at the beginning of the next end step.',
      'Warhost Herald'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 3 },
        token: '1/1 red Warrior creature',
        entersTapped: true,
        attacking: 'defending_player',
        atNextEndStep: 'sacrifice',
        raw: 'Create 3 1/1 red Warrior creature tokens. Those tokens enter tapped and attacking. Sacrifice them at the beginning of the next end step.',
      },
    ]);
  });

  it('parses Morph keyword lines into a turn-face-up step', () => {
    const ir = parseOracleTextToIR('Morph {3}{G}', 'Barkhide Host');

    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{3}{G}',
      effectText: 'Turn this permanent face up.',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'turn_face_up',
        target: { kind: 'raw', text: 'this permanent' },
        raw: 'Turn this permanent face up',
      },
    ]);
  });

  it('parses Disguise keyword lines into a turn-face-up step', () => {
    const ir = parseOracleTextToIR('Disguise {2}{G}', 'Sample Disguise');

    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{2}{G}',
      effectText: 'Turn this permanent face up.',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'turn_face_up',
        target: { kind: 'raw', text: 'this permanent' },
        raw: 'Turn this permanent face up',
      },
    ]);
  });

  it('prunes morph reminder-only pseudo-abilities from full reminder text', () => {
    const ir = parseOracleTextToIR(
      "Morph {3}{U} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its mana cost if it's a creature card.)",
      'Willbender'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      effectText: 'Turn this permanent face up.',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'turn_face_up',
        target: { kind: 'raw', text: 'this permanent' },
        raw: 'Turn this permanent face up',
      },
    ]);
  });

  it('prunes disguise reminder-only pseudo-abilities from full reminder text', () => {
    const ir = parseOracleTextToIR(
      'Disguise {2}{U} (You may cast this card face down for {3} as a 2/2 creature with ward {2}. Turn it face up any time for its disguise cost.)',
      'Sample Disguise'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      effectText: 'Turn this permanent face up.',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'turn_face_up',
        target: { kind: 'raw', text: 'this permanent' },
        raw: 'Turn this permanent face up',
      },
    ]);
  });

  it('prunes foretell reminder-only pseudo-abilities from full reminder text', () => {
    const ir = parseOracleTextToIR(
      'Foretell {1}{U} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)',
      'Behold the Multiverse'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{1}{U}',
      effectText: '',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('normalizes suspend reminder text into a structured keyword ability without raw reminder steps', () => {
    const ir = parseOracleTextToIR(
      "Suspend 3-{1}{U} (Rather than cast this card from your hand, pay {1}{U} and exile it with three time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, cast it without paying its mana cost. If it's a creature, it has haste.)",
      'Lotus Bloom'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '3-{1}{U}',
      effectText: '',
    });
    expect(ir.abilities[0]?.steps).toEqual([]);
  });

  it('parses Megamorph keyword lines into a turn-face-up plus counter sequence', () => {
    const ir = parseOracleTextToIR('Megamorph {4}{G}', 'Barkhide Host');

    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{4}{G}',
      effectText: 'Turn this permanent face up. Put a +1/+1 counter on it.',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'turn_face_up',
        target: { kind: 'raw', text: 'this permanent' },
        raw: 'Turn this permanent face up',
      },
      {
        kind: 'add_counter',
        target: { kind: 'raw', text: 'it' },
        counter: '+1/+1',
        amount: { kind: 'number', value: 1 },
        raw: 'Put a +1/+1 counter on it',
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

  it('parses Torrential Gearhulk into a graveyard permission plus free-cast and exile-replacement metadata', () => {
    const ir = parseOracleTextToIR(
      'When this creature enters, you may cast target instant card from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead.',
      'Torrential Gearhulk'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'grant_graveyard_permission',
        what: { kind: 'raw', text: 'target instant card' },
        permission: 'cast',
        optional: true,
      }),
      expect.objectContaining({
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        withoutPayingManaCost: true,
        exileInsteadOfGraveyard: true,
      }),
    ]);
  });

  it("parses Uro, Titan of Nature's Wrath into a sacrifice-unless-escaped conditional", () => {
    const ir = parseOracleTextToIR(
      "When Uro enters, sacrifice it unless it escaped.",
      "Uro, Titan of Nature's Wrath"
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: "it didn't escape" },
        steps: [
          expect.objectContaining({
            kind: 'sacrifice',
            what: { kind: 'raw', text: 'it' },
          }),
        ],
      }),
    ]);
  });

  it('parses Woe Strider escape text into graveyard permission plus escape-entry counters', () => {
    const ir = parseOracleTextToIR(
      'Escape-{3}{B}{B}, Exile four other cards from your graveyard. This creature escapes with two +1/+1 counters on it.',
      'Woe Strider'
    );

    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'this card' },
        permission: 'cast',
        duration: 'during_resolution',
        optional: true,
      },
      {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        additionalCost: { kind: 'exile_from_graveyard', count: 4, raw: 'Exile four other cards from your graveyard' },
      },
      {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        castedPermanentEntersWithCounters: { '+1/+1': 2 },
      },
    ]);
  });

  it('parses Quilled Greatwurm-style graveyard counter-removal costs into remove-counter metadata', () => {
    const ir = parseOracleTextToIR(
      'You may cast this card from your graveyard by removing six counters from among creatures you control in addition to paying its other costs.',
      'Quilled Greatwurm'
    );

    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'this card' },
        permission: 'cast',
        duration: 'during_resolution',
        optional: true,
      },
      {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        additionalCost: {
          kind: 'remove_counter',
          count: 6,
          filterText: 'creatures you control',
        },
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
      {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        castCost: 'mana_cost',
        additionalCost: { kind: 'exile_from_graveyard', count: 3, raw: 'exile three other cards from your graveyard' },
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
      {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        additionalCost: {
          kind: 'sacrifice',
          count: 3,
          filterText: 'creatures',
        },
      },
    ]);
  });

  it('prunes flashback reminder duplicates from full Dread Return oracle text while keeping the sacrifice cost metadata', () => {
    const ir = parseOracleTextToIR(
      'Return target creature card from your graveyard to the battlefield. Flashback-Sacrifice three creatures. (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
      'Dread Return'
    );

    expect(ir.abilities[1]?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'this card' },
        permission: 'cast',
      },
      {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        additionalCost: {
          kind: 'sacrifice',
          count: 3,
          filterText: 'creatures',
        },
      },
    ]);
    expect(ir.abilities[1]?.steps).toHaveLength(2);
  });

  it('parses turn-gated retrace grants like Six into conditional graveyard-cast permission steps', () => {
    const ir = parseOracleTextToIR(
      'During your turn, nonland permanent cards in your graveyard have retrace. (You may cast permanent cards from your graveyard by discarding a land card in addition to paying their other costs.)',
      'Six'
    );

    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: "it's your turn" },
        steps: [
          {
            kind: 'grant_graveyard_permission',
            who: { kind: 'you' },
            what: { kind: 'raw', text: 'nonland permanent' },
            permission: 'cast',
            duration: 'this_turn',
            optional: true,
          },
          {
            kind: 'modify_graveyard_permissions',
            scope: 'last_granted_graveyard_cards',
            additionalCost: {
              kind: 'discard',
              count: 1,
              filterText: 'land',
            },
          },
        ],
      },
    ]);
  });

  it('parses Gravecrawler into a Zombie-gated graveyard permission wrapper', () => {
    const ir = parseOracleTextToIR(
      'You may cast Gravecrawler from your graveyard as long as you control a Zombie.',
      'Gravecrawler'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'as_long_as', raw: 'you control a Zombie' },
        steps: [
          expect.objectContaining({
            kind: 'grant_graveyard_permission',
            what: { kind: 'raw', text: 'this permanent' },
            permission: 'cast',
            optional: true,
          }),
        ],
      }),
    ]);
  });

  it('parses Squee, the Immortal into both graveyard and exile permission steps', () => {
    const ir = parseOracleTextToIR(
      'You may cast Squee, the Immortal from your graveyard or from exile.',
      'Squee, the Immortal'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'grant_graveyard_permission',
          what: { kind: 'raw', text: 'this permanent' },
        }),
        expect.objectContaining({
          kind: 'grant_exile_permission',
          what: { kind: 'raw', text: 'this permanent' },
        }),
      ])
    );
  });

  it('parses Rebound reminder text into a self-exile free-cast permission', () => {
    const ir = parseOracleTextToIR('Rebound', 'Staggershock');

    expect(ir.abilities[0]?.type).toBe('triggered');
    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'grant_exile_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'this card' },
        permission: 'cast',
        duration: 'during_resolution',
        withoutPayingManaCost: true,
        optional: true,
      }),
    ]);
  });

  it('parses the delayed Rebound cast-from-exile sentence into a self-exile free-cast permission', () => {
    const ir = parseOracleTextToIR('You may cast this card from exile without paying its mana cost.', 'Staggershock');

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'grant_exile_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'this card' },
        permission: 'cast',
        duration: 'during_resolution',
        withoutPayingManaCost: true,
        optional: true,
      }),
    ]);
  });

  it('parses Chainer, Nightmare Adept into a this-turn creature-graveyard permission', () => {
    const ir = parseOracleTextToIR(
      'Discard a card: You may cast a creature spell from your graveyard this turn.',
      'Chainer, Nightmare Adept'
    );

    expect(ir.abilities[0]?.type).toBe('activated');
    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'grant_graveyard_permission',
        what: { kind: 'raw', text: 'a creature spell' },
        permission: 'cast',
        duration: 'this_turn',
        optional: true,
      }),
    ]);
  });

  it('parses The Indomitable into a tapped Pirates-or-Vehicles gated graveyard permission wrapper', () => {
    const ir = parseOracleTextToIR(
      'You may cast this card from your graveyard as long as you control three or more tapped Pirates and/or Vehicles.',
      'The Indomitable'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'as_long_as', raw: 'you control three or more tapped Pirates and/or Vehicles' },
        steps: [
          expect.objectContaining({
            kind: 'grant_graveyard_permission',
            what: { kind: 'raw', text: 'this card' },
            permission: 'cast',
            optional: true,
          }),
        ],
      }),
    ]);
  });

  it('parses Lurrus of the Dream-Den into a turn-gated graveyard permission wrapper', () => {
    const ir = parseOracleTextToIR(
      'Once during each of your turns, you may cast a permanent spell with mana value 2 or less from your graveyard.',
      'Lurrus of the Dream-Den'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'as_long_as', raw: "it's your turn" },
        steps: [
          expect.objectContaining({
            kind: 'grant_graveyard_permission',
            what: { kind: 'raw', text: 'a permanent spell with mana value 2 or less' },
            permission: 'cast',
            duration: 'this_turn',
            optional: true,
          }),
        ],
      }),
    ]);
  });

  it('parses Exploration Broodship into a turn-gated graveyard permission wrapper despite the extra cost tail', () => {
    const ir = parseOracleTextToIR(
      'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.',
      'Exploration Broodship'
    );

    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'conditional',
        condition: { kind: 'as_long_as', raw: "it's your turn" },
        steps: [
          {
            kind: 'grant_graveyard_permission',
            what: { kind: 'raw', text: 'a permanent spell' },
            permission: 'cast',
            duration: 'this_turn',
            optional: true,
          },
          {
            kind: 'modify_graveyard_permissions',
            scope: 'last_granted_graveyard_cards',
            additionalCost: {
              kind: 'sacrifice',
              count: 1,
              filterText: 'land',
            },
          },
        ],
      },
    ]);
  });

  it('parses Rivaz of the Claw into a turn-gated Dragon graveyard permission wrapper', () => {
    const ir = parseOracleTextToIR(
      'Once during each of your turns, you may cast a Dragon creature spell from your graveyard.',
      'Rivaz of the Claw'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'as_long_as', raw: "it's your turn" },
        steps: [
          expect.objectContaining({
            kind: 'grant_graveyard_permission',
            what: { kind: 'raw', text: 'a Dragon creature spell' },
            permission: 'cast',
            duration: 'this_turn',
            optional: true,
          }),
        ],
      }),
    ]);
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

  it('parses Psychic Rebuttal spell-mastery copy riders into conditional copy_spell steps', () => {
    const ir = parseOracleTextToIR(
      'Counter target instant or sorcery spell that targets you.\nSpell mastery — If there are two or more instant and/or sorcery cards in your graveyard, you may copy the spell countered this way. You may choose new targets for the copy.',
      'Psychic Rebuttal'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({ kind: 'counter_spell' }),
    ]);
    expect(ir.abilities[1]?.steps).toEqual([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: 'there are two or more instant and/or sorcery cards in your graveyard' },
        steps: [
          expect.objectContaining({
            kind: 'copy_spell',
            subject: 'last_moved_card',
            optional: true,
            allowNewTargets: true,
          }),
        ],
      }),
    ]);
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

  it('parses Harald look-and-choose clauses into a deterministic top-of-library selection step', () => {
    const ir = parseOracleTextToIR(
      'When Harald enters, look at the top five cards of your library. You may reveal an Elf, Warrior, or Tyvar card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.',
      'Harald, King of Skemfar'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'look_choose_from_top',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 5 },
          selectorText: 'Elf, Warrior, or Tyvar',
          destination: 'hand',
          reveal: true,
          optional: true,
        }),
      ])
    );
  });

  it('parses top-of-library exile selection plus bottom-random remainder into a deterministic step', () => {
    const ir = parseOracleTextToIR(
      'Look at the top three cards of your library. You may exile an instant or sorcery card with mana value 2 or less from among them. Put the rest on the bottom of your library in a random order.',
      'Test Card'
    );

    expect(ir.abilities[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'look_choose_from_top',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 3 },
          selectorText: 'instant or sorcery with mana value 2 or less',
          destination: 'exile',
          optional: true,
        }),
      ])
    );
  });

  it('parses look-choose-from-top to hand with bottom-any-order tail', () => {
    const ir = parseOracleTextToIR(
      'When Courageous Outrider enters the battlefield, look at the top four cards of your library. You may reveal a Human card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
      'Courageous Outrider'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'look_choose_from_top',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 4 },
        selectorText: 'Human',
        destination: 'hand',
        reveal: true,
        restOrder: 'any',
        optional: true,
        raw: 'look at the top four cards of your library. You may reveal a Human card from among them and put it into your hand. Put the rest on the bottom of your library in any order',
      },
    ]);
  });

  it('merges Owlbear Cub bottom-random tails into the preceding battlefield selection step', () => {
    const ir = parseOracleTextToIR(
      "Mama's Coming — Whenever this creature attacks a player who controls eight or more lands, look at the top eight cards of your library. You may put a creature card from among them onto the battlefield tapped and attacking that player. Put the rest on the bottom of your library in a random order.",
      'Owlbear Cub'
    );

    expect(ir.abilities[0]?.steps.map((step) => step.raw)).toEqual([
      'look at the top eight cards of your library',
      'You may put a creature card from among them onto the battlefield tapped and attacking that player. Put the rest on the bottom of your library in a random order',
    ]);
  });

  it('merges Keldon Flamesage bottom-random tails without swallowing the later free-cast followup', () => {
    const ir = parseOracleTextToIR(
      "Whenever this creature attacks, look at the top X cards of your library, where X is this creature's power. You may exile an instant or sorcery card with mana value X or less from among them. Put the rest on the bottom of your library in a random order. You may cast the exiled card without paying its mana cost.",
      'Keldon Flamesage'
    );

    expect(ir.abilities[0]?.steps.map((step) => step.raw)).toEqual([
      "look at the top X cards of your library, where X is this creature's power",
      'You may exile an instant or sorcery card with mana value X or less from among them. Put the rest on the bottom of your library in a random order',
      'You may cast the exiled card without paying its mana cost',
    ]);
  });

  it('merges Jodah bottom-random tails into the impulse-exile clause', () => {
    const ir = parseOracleTextToIR(
      'Whenever you cast a legendary spell from your hand, exile cards from the top of your library until you exile a legendary nonland card with lesser mana value. You may cast that card without paying its mana cost. Put the rest on the bottom of your library in a random order.',
      'Jodah, the Unifier'
    );

    expect(ir.abilities[0]?.steps.map((step) => step.raw)).toEqual([
      'exile cards from the top of your library until you exile a legendary nonland card with lesser mana value. You may cast that card without paying its mana cost. Put the rest on the bottom of your library in a random order',
    ]);
  });

  it('merges bottom-random tails when the look lead starts with Then', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of your upkeep, put a time counter on this permanent. Then look at the top X cards of your library, where X is the number of time counters on this permanent. You may put a nonland permanent card with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.',
      'Wilfred Mott'
    );

    expect(ir.abilities[0]?.steps.map((step) => step.raw)).toEqual([
      'put a time counter on this permanent',
      'Then look at the top X cards of your library, where X is the number of time counters on this permanent',
      'You may put a nonland permanent card with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order',
    ]);
  });

  it('merges Sunbird\'s Invocation bottom-random tails into the cast-from-revealed clause', () => {
    const ir = parseOracleTextToIR(
      "Whenever you cast a spell from your hand, reveal the top X cards of your library, where X is that spell's mana value. You may cast a spell with mana value X or less from among cards revealed this way without paying its mana cost. Put the rest on the bottom of your library in a random order.",
      "Sunbird's Invocation"
    );

    expect(ir.abilities[0]?.steps.map((step) => step.raw)).toEqual([
      "reveal the top X cards of your library, where X is that spell's mana value",
      'You may cast a spell with mana value X or less from among cards revealed this way without paying its mana cost. Put the rest on the bottom of your library in a random order',
    ]);
  });

  it('merges Forging the Anchor bottom-random tails into the reveal-and-take clause', () => {
    const ir = parseOracleTextToIR(
      'Look at the top five cards of your library. You may reveal any number of artifact cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in a random order.',
      'Forging the Anchor'
    );

    expect(ir.abilities[0]?.steps.map((step) => step.raw)).toEqual([
      'Look at the top five cards of your library',
      'You may reveal any number of artifact cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in a random order',
    ]);
  });

  it('merges bottom-random tails after parsed top-library exile choices that use one of those cards wording', () => {
    const ir = parseOracleTextToIR(
      "Nahiri's Warcrafting deals 5 damage to target creature, planeswalker, or battle. Look at the top X cards of your library, where X is the excess damage dealt this way. You may exile one of those cards. Put the rest on the bottom of your library in a random order. You may play the exiled card this turn.",
      "Nahiri's Warcrafting"
    );
    const raws = ir.abilities.flatMap((ability) => ability.steps.map((step) => step.raw));

    expect(raws).toContain('You may exile one of those cards. Put the rest on the bottom of your library in a random order');
    expect(raws).not.toContain('Put the rest on the bottom of your library in a random order');
  });

  it("merges bottom-random tails after impulse followups with intervening if-you-don't clauses", () => {
    const ir = parseOracleTextToIR(
      'Whenever enchanted creature attacks, reveal cards from the top of your library until you reveal an Aura card. You may put that card onto the battlefield. If you don\'t, put it into your hand. Put the rest on the bottom of your library in a random order.',
      "Songbirds' Blessing"
    );
    const raws = ir.abilities.flatMap((ability) => ability.steps.map((step) => step.raw));

    expect(raws).toContain("If you don't, put it into your hand. Put the rest on the bottom of your library in a random order");
    expect(raws).not.toContain('Put the rest on the bottom of your library in a random order');
  });

  it("merges Garruk's Harbinger bottom-random tails after that-many top-library leads", () => {
    const ir = parseOracleTextToIR(
      "Whenever this creature deals combat damage to a player or planeswalker, look at that many cards from the top of your library. You may reveal a creature card or Garruk planeswalker card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
      "Garruk's Harbinger"
    );
    const raws = ir.abilities.flatMap((ability) => ability.steps.map((step) => step.raw));

    expect(raws).toContain(
      'You may reveal a creature card or Garruk planeswalker card from among them and put it into your hand. Put the rest on the bottom of your library in a random order'
    );
    expect(raws).not.toContain('Put the rest on the bottom of your library in a random order');
  });

  it('merges Industrial Advancement bottom-random tails after If you do top-library leads', () => {
    const ir = parseOracleTextToIR(
      "At the beginning of your end step, you may sacrifice a creature. If you do, look at the top X cards of your library, where X is that creature's mana value. You may put a creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.",
      'Industrial Advancement'
    );
    const raws = ir.abilities.flatMap((ability) => ability.steps.map((step) => step.raw));

    expect(raws).toContain(
      'You may put a creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order'
    );
    expect(raws).not.toContain('Put the rest on the bottom of your library in a random order');
  });

  it('merges Key to the Vault bottom-random tails without swallowing the later free-cast followup', () => {
    const ir = parseOracleTextToIR(
      'Whenever equipped creature deals combat damage to a player, look at that many cards from the top of your library. You may exile a nonland card from among them. Put the rest on the bottom of your library in a random order. You may cast the exiled card without paying its mana cost.',
      'The Key to the Vault'
    );
    const raws = ir.abilities.flatMap((ability) => ability.steps.map((step) => step.raw));

    expect(raws).toContain(
      'You may exile a nonland card from among them. Put the rest on the bottom of your library in a random order'
    );
    expect(raws).toContain('You may cast the exiled card without paying its mana cost');
    expect(raws).not.toContain('Put the rest on the bottom of your library in a random order');
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

  it('parses Moira and Teshar leave-battlefield exile riders into an explicit replacement-grant step', () => {
    const oracleText =
      'Whenever you cast a historic spell, return target nonland permanent card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.';

    const ir = parseOracleTextToIR(oracleText, 'Moira and Teshar');

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

  it("parses Desdemona, Freedom's Edge as a targeted graveyard permission grant with qualifiers", () => {
    const oracleText =
      "Whenever Desdemona attacks, target creature card in your graveyard that's an artifact or that has mana value 3 or less gains escape until end of turn. The escape cost is equal to its mana cost plus exile two other cards from your graveyard. (You may cast it from your graveyard for its escape cost this turn.)";

    const ir = parseOracleTextToIR(oracleText, "Desdemona, Freedom's Edge");

    expect(ir.abilities[0]?.steps).toMatchObject([
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: {
          kind: 'raw',
          text: "target creature card that's an artifact or that has mana value 3 or less",
        },
        permission: 'cast',
        duration: 'this_turn',
        optional: true,
      },
      {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        castCost: 'mana_cost',
        additionalCost: { kind: 'exile_from_graveyard', count: 2, raw: 'exile two other cards from your graveyard' },
      },
    ]);
  });

  it('parses Gravecrawler into an as-long-as conditional graveyard permission step', () => {
    const ir = parseOracleTextToIR(
      "This creature can't block.\nYou may cast this card from your graveyard as long as you control a Zombie.",
      'Gravecrawler'
    );

    expect(ir.abilities[1]?.steps).toMatchObject([
      {
        kind: 'conditional',
        condition: { kind: 'as_long_as', raw: 'you control a Zombie' },
        steps: [
          {
            kind: 'grant_graveyard_permission',
            who: { kind: 'you' },
            what: { kind: 'raw', text: 'this card' },
            permission: 'cast',
            duration: 'during_resolution',
            optional: true,
          },
        ],
      },
    ]);
  });

  it('prunes timing-rules reminder tails once a permission step has been lowered', () => {
    const ir = parseOracleTextToIR(
      'Mayhem {B} (You may cast this card from your graveyard for {B} if you discarded it this turn. Timing rules still apply.)',
      'Swarm, Being of Bees'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'grant_graveyard_permission',
        permission: 'cast',
      }),
    ]);
    expect(
      ir.abilities[0]?.steps.some((step: any) => /timing rules still apply/i.test(String(step?.raw || '')))
    ).toBe(false);
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
        amount: { kind: 'object_stat', subject: 'it', stat: 'power' },
        source: { kind: 'raw', text: 'That card' },
        target: { kind: 'raw', text: 'this creature' },
      }),
    ]);
  });

  it('parses creature-source damage clauses with a structured source selector and power amount', () => {
    const ir = parseOracleTextToIR(
      "Target creature you control deals damage equal to its power to target creature you don't control.",
      'Hard-Hitting Question'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'deal_damage',
        amount: { kind: 'object_stat', subject: 'it', stat: 'power' },
        source: { kind: 'raw', text: 'Target creature you control' },
        target: { kind: 'raw', text: "target creature you don't control" },
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

  it('parses next-damage shields for any target', () => {
    const ir = parseOracleTextToIR(
      'Prevent the next 3 damage that would be dealt to any target this turn.',
      'Healing Salve'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'prevent_damage',
        amount: { kind: 'number', value: 3 },
        recipientTarget: { kind: 'raw', text: 'any target' },
        duration: 'this_turn',
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

  it('merges trailing copy retarget text into graveyard copy-spell replay steps', () => {
    const ir = parseOracleTextToIR(
      'Exile target instant or sorcery card from a graveyard and copy it. You may cast the copy without paying its mana cost. You may choose new targets for the copy.',
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
        allowNewTargets: true,
      }),
    ]);
  });


  it('parses Copy that card plus free-cast followup into a last_moved_card copy_spell step', () => {
    const ir = parseOracleTextToIR(
      "Exile target instant or sorcery card from an opponent's graveyard. Copy that card. You may cast the copy without paying its mana cost.",
      'Flawless Forgery'
    );

    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
        what: { kind: 'raw', text: "target instant or sorcery card from an opponent's graveyard" },
      }),
      expect.objectContaining({
        kind: 'copy_spell',
        subject: 'last_moved_card',
        optional: true,
        withoutPayingManaCost: true,
      }),
    ]);
    expect(ir.abilities[0]?.steps.some((step: any) => String(step?.raw || '').trim() === 'You may cast the copy without paying its mana cost')).toBe(false);
  });

  it('parses linked exiled-card copy clauses with if-you-do free-cast tails', () => {
    const ir = parseOracleTextToIR(
      'Imprint - When this artifact enters, you may exile an instant card with mana value 2 or less from your hand.\n{2}, {T}: You may copy the exiled card. If you do, you may cast the copy without paying its mana cost.',
      'Isochron Scepter'
    );

    const activated = ir.abilities.find((ability: any) => ability.type === 'activated');
    expect(activated?.steps).toEqual([
      expect.objectContaining({
        kind: 'copy_spell',
        subject: 'linked_exiled_cards',
        optional: true,
        withoutPayingManaCost: true,
      }),
    ]);
  });

  it("parses Wizard's Spellbook into exile, roll_die, and die-roll result branches", () => {
    const ir = parseOracleTextToIR(
      "{T}: Exile target instant or sorcery card from a graveyard. Roll a d20. Activate only as a sorcery.\n1-9 | Copy that card. You may cast the copy.\n10-19 | Copy that card. You may cast the copy by paying {1} rather than paying its mana cost.\n20 | Copy each card exiled with this artifact. You may cast any number of the copies without paying their mana costs.",
      "Wizard's Spellbook"
      );

      expect(ir.abilities).toHaveLength(1);
      expect(ir.abilities[0]?.type).toBe('activated');
      expect(ir.abilities[0]?.steps).toEqual([
        expect.objectContaining({
          kind: 'move_zone',
          to: 'exile',
          what: { kind: 'raw', text: 'target instant or sorcery card from a graveyard' },
        }),
        expect.objectContaining({
          kind: 'roll_die',
          sides: 20,
          who: { kind: 'you' },
        }),
        expect.objectContaining({
          kind: 'die_roll_results',
          sides: 20,
          who: { kind: 'you' },
          results: [
            expect.objectContaining({
              min: 1,
              max: 9,
              steps: [expect.objectContaining({ kind: 'copy_spell', subject: 'last_moved_card', castCost: 'mana_cost' })],
            }),
            expect.objectContaining({
              min: 10,
              max: 19,
              steps: [expect.objectContaining({ kind: 'copy_spell', subject: 'last_moved_card', castCost: '{1}' })],
            }),
            expect.objectContaining({
              min: 20,
              max: 20,
              steps: [expect.objectContaining({ kind: 'copy_spell', subject: 'linked_exiled_cards', withoutPayingManaCost: true })],
            }),
          ],
        }),
      ]);
    });

    it("parses flattened inline Wizard's Spellbook text into exile, roll_die, and die-roll result branches", () => {
      const ir = parseOracleTextToIR(
        "{3}{U}, {T}: Exile target instant or sorcery card from a graveyard and roll a d20. 1-9 | Copy that card. You may cast the copy. 10-19 | Copy that card. You may cast the copy by paying {1} rather than paying its mana cost. 20 | Copy each card exiled with this artifact. You may cast any number of the copies without paying their mana costs.",
        "Wizard's Spellbook"
      );

      expect(ir.abilities).toHaveLength(1);
      expect(ir.abilities[0]?.type).toBe('activated');
      expect(ir.abilities[0]?.steps).toEqual([
        expect.objectContaining({
          kind: 'move_zone',
          to: 'exile',
          what: { kind: 'raw', text: 'target instant or sorcery card from a graveyard' },
        }),
        expect.objectContaining({
          kind: 'roll_die',
          sides: 20,
          who: { kind: 'you' },
        }),
        expect.objectContaining({
          kind: 'die_roll_results',
          sides: 20,
          who: { kind: 'you' },
          results: [
            expect.objectContaining({
              min: 1,
              max: 9,
              steps: [expect.objectContaining({ kind: 'copy_spell', subject: 'last_moved_card', castCost: 'mana_cost' })],
            }),
            expect.objectContaining({
              min: 10,
              max: 19,
              steps: [expect.objectContaining({ kind: 'copy_spell', subject: 'last_moved_card', castCost: '{1}' })],
            }),
            expect.objectContaining({
              min: 20,
              max: 20,
              steps: [expect.objectContaining({ kind: 'copy_spell', subject: 'linked_exiled_cards', withoutPayingManaCost: true })],
            }),
          ],
        }),
      ]);
    });

    it("parses The Many Deeds of Belzenlok into merged move-zone plus copied chapter abilities", () => {
      const ir = parseOracleTextToIR(
        'I — Exile up to one target Saga card from a graveyard. Copy its chapter I ability.\nII — Exile up to one target Saga card from a graveyard. Copy its chapter II ability.\nIII — Exile up to one target Saga card from a graveyard. Copy its chapter III ability.',
        'The Many Deeds of Belzenlok'
      );

      expect(ir.abilities).toHaveLength(3);
      expect(ir.abilities.map((ability) => ability.steps.map((step) => step.kind))).toEqual([
        ['move_zone', 'copy_chapter_ability'],
        ['move_zone', 'copy_chapter_ability'],
        ['move_zone', 'copy_chapter_ability'],
      ]);
      expect((ir.abilities[0]?.steps[1] as any)?.chapter).toBe(1);
      expect((ir.abilities[1]?.steps[1] as any)?.chapter).toBe(2);
      expect((ir.abilities[2]?.steps[1] as any)?.chapter).toBe(3);
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

  it("parses Vincent's Limit Break as a tiered choose_mode with temporary dies and base P/T modes", () => {
    const oracleText =
      "Tiered (Choose one additional cost.)\n"
      + "Until end of turn, target creature you control gains \"When this creature dies, return it to the battlefield tapped under its owner's control\" and has the chosen base power and toughness.\n"
      + "\u2022 Galian Beast - {0} - 3/2.\n"
      + "\u2022 Death Gigas - {1} - 5/2.\n"
      + "\u2022 Hellmasker - {3} - 7/2.";

    const ir = parseOracleTextToIR(oracleText, "Vincent's Limit Break");
    const chooseModeStep = ir.abilities[0]?.steps[0] as any;

    expect(chooseModeStep.kind).toBe('choose_mode');
    expect(chooseModeStep.minModes).toBe(1);
    expect(chooseModeStep.maxModes).toBe(1);
    expect(chooseModeStep.modes.map((mode: any) => mode.label)).toEqual([
      'Galian Beast',
      'Death Gigas',
      'Hellmasker',
    ]);
    expect(chooseModeStep.modes[0]?.steps.map((step: any) => step.kind)).toEqual([
      'grant_temporary_dies_trigger',
      'set_base_pt',
    ]);
    expect(chooseModeStep.modes[1]?.steps[1]).toMatchObject({
      kind: 'set_base_pt',
      power: 5,
      toughness: 2,
      target: { kind: 'raw', text: 'target creature you control' },
    });
  });

  it('parses Grixis Sojourners as two triggered exile abilities plus cycling', () => {
    const oracleText =
      'When you cycle this card and when this creature dies, you may exile target card from a graveyard.\n'
      + 'Cycling {2}{B} ({2}{B}, Discard this card: Draw a card.)';

    const ir = parseOracleTextToIR(oracleText, 'Grixis Sojourners');

    expect(ir.abilities).toHaveLength(3);
    expect(ir.abilities[0]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'you cycle this card',
    });
    expect(ir.abilities[1]).toMatchObject({
      type: 'triggered',
      triggerCondition: 'this creature dies',
    });
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'target card from a graveyard' },
      to: 'exile',
      optional: true,
    });
    expect(ir.abilities[1]?.steps[0]).toMatchObject({
      kind: 'move_zone',
      what: { kind: 'raw', text: 'target card from a graveyard' },
      to: 'exile',
      optional: true,
    });
    expect(ir.abilities[2]).toMatchObject({
      type: 'keyword',
      cost: '{2}{B}, Discard this card',
    });
    expect(ir.abilities[2]?.steps[0]).toMatchObject({
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
    });
  });

  it('parses Equip as an attach activation instead of a dead keyword stub', () => {
    const ir = parseOracleTextToIR('Equip {2}', 'Short Sword');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{2}',
    });
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'attach',
      to: { kind: 'raw', text: 'target creature you control' },
    });
  });

  it('parses Outlast as an add-counter activation instead of a dead keyword stub', () => {
    const ir = parseOracleTextToIR('Outlast {1}{W}', 'Abzan Falconer');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{1}{W}, {T}',
    });
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'add_counter',
      target: { kind: 'raw', text: 'this creature' },
      counter: '+1/+1',
      amount: { kind: 'number', value: 1 },
    });
  });

  it('parses Level up as an add-counter activation instead of a dead keyword stub', () => {
    const ir = parseOracleTextToIR('Level up {2}', 'Student of Warfare');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{2}',
    });
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'add_counter',
      target: { kind: 'raw', text: 'this permanent' },
      counter: 'level',
      amount: { kind: 'number', value: 1 },
    });
  });

  it('parses Reinforce as an explicit discard activation instead of a dead keyword stub', () => {
    const ir = parseOracleTextToIR(
      'Reinforce 2—{1}{W} ({1}{W}, Discard this card: Put two +1/+1 counters on target creature.)',
      'Burrenton Bombardier'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{1}{W}, Discard this card',
    });
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'add_counter',
      target: { kind: 'raw', text: 'target creature' },
      counter: '+1/+1',
      amount: { kind: 'number', value: 2 },
    });
  });

  it('parses Scavenge as an exile-plus-counters activation instead of a dead keyword stub', () => {
    const ir = parseOracleTextToIR('Scavenge {4}{G}{G}', 'Deadbridge Goliath');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{4}{G}{G}, Exile this card from your graveyard',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'this card' },
        to: 'exile',
        toRaw: 'exile',
        raw: 'Exile this card from your graveyard.',
      },
      {
        kind: 'add_counter',
        target: { kind: 'raw', text: 'target creature' },
        counter: '+1/+1',
        amount: { kind: 'x' },
        raw: "Put X +1/+1 counters on target creature, where X is this card's power.",
      },
    ]);
  });

  it('parses Embalm as an exile-plus-copy-token activation instead of a dead keyword stub', () => {
    const ir = parseOracleTextToIR('Embalm {3}{W}', 'Anointer Priest');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{3}{W}, Exile this card from your graveyard',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'this card' },
        to: 'exile',
        toRaw: 'exile',
        raw: 'Exile this card from your graveyard.',
      },
      {
        kind: 'create_token',
        who: { kind: 'you' },
        token: "copy of it, except it's white, it has no mana cost, and it's a Zombie in addition to its other types",
        amount: { kind: 'number', value: 1 },
        raw: "Create a token that's a copy of it, except it's white, it has no mana cost, and it's a Zombie in addition to its other types.",
      },
    ]);
  });

  it('parses Eternalize as an exile-plus-copy-token activation instead of a dead keyword stub', () => {
    const ir = parseOracleTextToIR('Eternalize {2}{B}{B}', 'Champion of Wits');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{2}{B}{B}, Exile this card from your graveyard',
    });
    expect(ir.abilities[0]?.steps).toEqual([
      {
        kind: 'move_zone',
        what: { kind: 'raw', text: 'this card' },
        to: 'exile',
        toRaw: 'exile',
        raw: 'Exile this card from your graveyard.',
      },
      {
        kind: 'create_token',
        who: { kind: 'you' },
        token: "copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types",
        amount: { kind: 'number', value: 1 },
        raw: "Create a token that's a copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types.",
      },
    ]);
  });

  it('parses Replicate as an explicit cast-copy keyword line instead of a dead keyword stub', () => {
    const ir = parseOracleTextToIR('Replicate {1}{U}', 'Replicate Test');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{1}{U}',
      effectText:
        'As an additional cost to cast this spell, you may pay its replicate cost any number of times. When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.',
    });
    expect(ir.abilities[0]?.steps[0]).toEqual(
      expect.objectContaining({
        kind: 'copy_spell',
        subject: 'this_spell',
        copies: { kind: 'replicate_count' },
        allowNewTargets: true,
      })
    );
  });

  it('parses Fortify as an attach activation instead of a dead keyword stub', () => {
    const ir = parseOracleTextToIR('Fortify {3}', 'Darksteel Garrison');

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{3}',
    });
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'attach',
      to: { kind: 'raw', text: 'target land you control' },
    });
  });

  it('parses Channel as a discard activation with executable effect text', () => {
    const ir = parseOracleTextToIR(
      'Channel — {2}{R}, Discard this card: Draw two cards.',
      'Tormenting Voice on a Stick'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{2}{R}, Discard this card',
    });
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 2 },
    });
  });

  it('parses Exhaust as an executable mana ability instead of a dead keyword stub', () => {
    const ir = parseOracleTextToIR(
      'Exhaust — {3}: Add {R}{R}{R}. Activate only once.',
      'Turbo Charger'
    );

    expect(ir.abilities).toHaveLength(1);
    expect(ir.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{3}',
    });
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'add_mana',
      who: { kind: 'you' },
      mana: '{R}{R}{R}',
    });
  });

});
