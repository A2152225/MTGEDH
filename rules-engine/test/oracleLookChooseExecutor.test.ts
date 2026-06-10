import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import {
  parseMoveZoneAllCardsMilledThisWay,
  parseMoveZoneAllExiledWithNamedSource,
  parseMoveZoneShuffleSourceArtifactAndGraveyard,
  parseMoveZoneTypedCardsRevealedThisWay,
} from '../src/oracleIRExecutorZoneOps';
import { collectStepsFromIrText } from '../../server/scripts/executor-coverage-audit';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  dryRunOracleSteps,
  enrichAuditStateAndContextForTargets,
} from '../../server/scripts/executor-coverage-audit';

describe('look-choose executor corridors', () => {
  it('parses all cards revealed this way', () => {
    expect(
      parseMoveZoneTypedCardsRevealedThisWay({ kind: 'raw', text: 'all cards revealed this way' })
    ).toEqual({ cardType: 'any' });
  });

  it('dry-runs look-top two-of-them hand/library-bottom split', () => {
    const text =
      'Look at the top seven cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.';
    const steps = collectStepsFromIrText(text, 'Drawn from Dreams');
    const record = dryRunOracleSteps(steps, 'Drawn from Dreams', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs look-top two-of-them hand/graveyard split', () => {
    const text =
      'Look at the top three cards of your library. Put two of them into your hand and the other into your graveyard.';
    const steps = collectStepsFromIrText(text, 'Dark Bargain');
    const record = dryRunOracleSteps(steps, 'Dark Bargain', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Campfire command-zone and graveyard commanders to hand', () => {
    const text =
      'Put all commanders you own from the command zone and from your graveyard into your hand. Then shuffle your graveyard into your library.';
    const steps = collectStepsFromIrText(text, 'Campfire');
    const record = dryRunOracleSteps(steps, 'Campfire', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs hand-reveal then exile the chosen cards', () => {
    const text =
      'Target opponent reveals their hand. You choose an artifact or creature card from it, then choose an artifact or creature card from their graveyard. Exile the chosen cards.';
    const steps = collectStepsFromIrText(text, 'Dreams of Steel and Oil');
    const record = dryRunOracleSteps(steps, 'Dreams of Steel and Oil', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs look-top any-number permanents to BF and rest to hand', () => {
    const text =
      'Look at the top five cards of your library. Put any number of permanent cards from among them onto the battlefield and the rest into your hand.';
    const steps = collectStepsFromIrText(text, 'Genesis Ultimatum');
    const record = dryRunOracleSteps(steps, 'Genesis Ultimatum', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs put counter on target creature then double on that creature', () => {
    const text =
      'Put a +1/+1 counter on target creature you control, then double the number of +1/+1 counters on that creature.';
    const steps = collectStepsFromIrText(text, 'Invigorating Surge');
    const record = dryRunOracleSteps(steps, 'Invigorating Surge', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs put counter then double on creatures countered this way', () => {
    const text =
      'Put a +1/+1 counter on target creature you control, then double the number of +1/+1 counters on each creature that had a +1/+1 counter put on it this way.';
    const steps = collectStepsFromIrText(text, 'Fangs of Kalonia');
    const record = dryRunOracleSteps(steps, 'Fangs of Kalonia', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs reveal-until nonland then nonland card to hand and rest to library bottom', () => {
    const text =
      "Choose any target. Reveal cards from the top of your library until you reveal a nonland card. Explosive Revelation deals damage equal to that card's mana value to that permanent or player. Put the nonland card into your hand and the rest on the bottom of your library in any order.";
    const steps = collectStepsFromIrText(text, 'Explosive Revelation');
    const record = dryRunOracleSteps(steps, 'Explosive Revelation', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs impulse exile top then uncast cards to graveyard', () => {
    const text =
      "Exile the top X cards of your library. You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs. Then put all cards exiled this way that weren't cast into your graveyard.";
    const steps = collectStepsFromIrText(text, 'Epic Experiment');
    const record = dryRunOracleSteps(steps, 'Epic Experiment', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('parses Jaxis copy token haste quoted dies trigger without ir gaps', () => {
    const text =
      'Create a token that\'s a copy of another target creature you control. It gains haste and "When this token dies, draw a card." Sacrifice it at the beginning of the next end step. Activate only as a sorcery.';
    const steps = collectStepsFromIrText(text, 'Jaxis, the Troublemaker');
    expect(steps.map((s: any) => s.kind)).toEqual([
      'create_token',
      'grant_temporary_dies_trigger',
    ]);
    expect((steps[0] as any).grantsHaste).toBe('permanent');
    expect((steps[0] as any).atNextEndStep).toBe('sacrifice');
  });

  it('dry-runs Kefnet reveal-trigger copy corridor', () => {
    const text =
      'You may reveal the first card you draw each turn as you draw it. Whenever you reveal an instant or sorcery card this way, copy that card and you may cast the copy. That copy costs {2} less to cast.';
    const steps = collectStepsFromIrText(text, 'God-Eternal Kefnet');
    const record = dryRunOracleSteps(steps, 'God-Eternal Kefnet', [], { typeLine: 'Creature' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Sealed Fate look-top exile one and rest to library top', () => {
    const text =
      "Look at the top X cards of target opponent's library. Exile one of those cards and put the rest back on top of that player's library in any order.";
    const steps = collectStepsFromIrText(text, 'Sealed Fate');
    const record = dryRunOracleSteps(steps, 'Sealed Fate', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs domain look-top up-to-two hand and rest graveyard', () => {
    const text =
      'Domain - Look at the top X cards of your library, where X is the number of basic land types among lands you control. Put up to two of them into your hand and the rest into your graveyard. You lose 2 life.';
    const steps = collectStepsFromIrText(text, 'Shadow Prophecy');
    const record = dryRunOracleSteps(steps, 'Shadow Prophecy', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs lands-controlled look-top one-or-two to hand with kicked branch', () => {
    const text =
      'Look at the top X cards of your library, where X is the number of lands you control. Put one of those cards into your hand. If this spell was kicked, put two of those cards into your hand instead. Put the rest on the bottom of your library in a random order.';
    const steps = collectStepsFromIrText(text, 'Consult the Star Charts');
    const record = dryRunOracleSteps(steps, 'Consult the Star Charts', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs destroy it if it did not attack this turn after choose', () => {
    const text =
      "Choose target non-Wall creature the active player has controlled continuously since the beginning of the turn. That player loses 2 life and you gain 2 life. Destroy it if it didn't attack this turn.";
    const steps = collectStepsFromIrText(text, "Arcum's Whistle");
    const record = dryRunOracleSteps(steps, "Arcum's Whistle", [], { typeLine: 'Artifact' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs impulse exile top then uncast instants and sorceries to hand', () => {
    const text =
      "Exile the top X cards of your library. You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost. Then put the exiled instant and sorcery cards that weren't cast this way into your hand and the rest on the bottom of your library in a random order.";
    const steps = collectStepsFromIrText(text, 'Muse Vortex');
    const record = dryRunOracleSteps(steps, 'Muse Vortex', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs distribute counters then double on each of those creatures', () => {
    const text =
      'Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of those creatures.';
    const steps = collectStepsFromIrText(text, 'Biogenic Upgrade');
    const record = dryRunOracleSteps(steps, 'Biogenic Upgrade', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs exile any number of target creatures you control with delayed return', () => {
    const text =
      'Exile any number of target creatures you control. For each creature exiled this way, create a token that\'s a copy of that creature. At the beginning of the next end step, return those exiled cards to the battlefield under their owner\'s control.';
    const steps = collectStepsFromIrText(text, 'Eerie Interlude');
    const record = dryRunOracleSteps(steps, 'Eerie Interlude', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs look-top up-to-two lands to battlefield tapped and rest library bottom', () => {
    const text =
      'Look at the top six cards of your library. Put up to two land cards from among them onto the battlefield tapped and the rest on the bottom of your library in a random order.';
    const steps = collectStepsFromIrText(text, 'Expand the Sphere');
    const record = dryRunOracleSteps(steps, 'Expand the Sphere', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs look-top exile one face down and rest library bottom', () => {
    const text =
      'Look at the top three cards of your library. Exile one face down and put the rest on the bottom of your library in any order.';
    const steps = collectStepsFromIrText(text, 'Vivien, Champion of the Wilds');
    const record = dryRunOracleSteps(steps, 'Vivien, Champion of the Wilds', [], {
      typeLine: 'Legendary Planeswalker — Vivien',
    });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Portent of Calamity rest-of-exiled-cards to hand', () => {
    const text =
      'Reveal the top X cards of your library. For each card type, you may exile a card of that type from among them. Put the rest into your graveyard. You may cast a spell from among the exiled cards without paying its mana cost if you exiled four or more cards this way. Then put the rest of the exiled cards into your hand';
    const steps = collectStepsFromIrText(text, 'Portent of Calamity');
    const record = dryRunOracleSteps(steps, 'Portent of Calamity', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Torch the Tower bargained conditional damage', () => {
    const text =
      'this permanent deals 2 damage to target creature or planeswalker. If this spell was bargained, instead it deals 3 damage to that permanent and you scry 1.';
    const steps = collectStepsFromIrText(text, 'Torch the Tower');
    const record = dryRunOracleSteps(steps, 'Torch the Tower', [], { typeLine: 'Instant' });
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.reasonCodes.unsupported_condition_clause || 0).toBe(0);
  });

  it('dry-runs Tazri tap-for-mana static rider', () => {
    const text =
      'Each creature you control has "{T}: Add one mana of any of this creature\'s colors. Spend this mana only to activate an ability of a creature. Activate only if this creature has another activated ability."';
    const steps = collectStepsFromIrText(text, 'Tazri, Stalwart Survivor');
    const record = dryRunOracleSteps(steps, 'Tazri, Stalwart Survivor', [], {
      typeLine: 'Legendary Creature — Human Cleric',
    });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Clockwork Droid exert unblockable rider', () => {
    const text =
      "You may exert this creature as it attacks. When you do, it can't be blocked this turn and you scry 1.";
    const steps = collectStepsFromIrText(text, 'Clockwork Droid');
    const record = dryRunOracleSteps(steps, 'Clockwork Droid', [], { typeLine: 'Artifact Creature — Droid' });
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.reasonCodes.no_deterministic_target || 0).toBe(0);
  });

  it('dry-runs Thunderous Debut bargained revealed cards to battlefield', () => {
    const text =
      'Look at the top twenty cards of your library. You may reveal up to two creature cards from among them. If this spell was bargained, put the revealed cards onto the battlefield. Otherwise, put the revealed cards into your hand. Then shuffle';
    const steps = collectStepsFromIrText(text, 'Thunderous Debut');
    const record = dryRunOracleSteps(steps, 'Thunderous Debut', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Viewpoint Synchronization two lands to BF and one to hand', () => {
    const text =
      'Search your library for up to three basic land cards and reveal them. Put two of them onto the battlefield tapped and the other into your hand, then shuffle.';
    const steps = collectStepsFromIrText(text, 'Viewpoint Synchronization');
    const record = dryRunOracleSteps(steps, 'Viewpoint Synchronization', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Saheeli Directive reveal rest to graveyard', () => {
    const text =
      "Reveal the top X cards of your library. You may put any number of artifact cards with mana value X or less from among them onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield into your graveyard";
    const steps = collectStepsFromIrText(text, "Saheeli's Directive");
    const record = dryRunOracleSteps(steps, "Saheeli's Directive", [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Arcum Dagsson sacrifice artifact creature', () => {
    const text =
      "Target artifact creature's controller sacrifices it. That player may search their library for a noncreature artifact card, put it onto the battlefield, then shuffle.";
    const steps = collectStepsFromIrText(text, 'Arcum Dagsson');
    const record = dryRunOracleSteps(steps, 'Arcum Dagsson', [], { typeLine: 'Legendary Creature — Human Artificer' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs shuffle owned permanents then reveal non-Aura permanents to battlefield', () => {
    const text =
      'Shuffle all permanents you own into your library, then reveal that many cards from the top of your library. Put all non-Aura permanent cards revealed this way onto the battlefield, then do the same for Aura cards. then put the rest on the bottom of your library in a random order';
    const steps = collectStepsFromIrText(text, 'Glimpse of Tomorrow');
    const record = dryRunOracleSteps(steps, 'Glimpse of Tomorrow', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('parses each creature card milled this way', () => {
    expect(
      parseMoveZoneAllCardsMilledThisWay({ kind: 'raw', text: 'each creature card milled this way' })
    ).toEqual({ cardType: 'creature' });
  });

  it('parses shuffle this artifact and your graveyard', () => {
    expect(
      parseMoveZoneShuffleSourceArtifactAndGraveyard({ kind: 'raw', text: 'this artifact and your graveyard' })
    ).toBe(true);
  });

  it('parses all cards exiled with named source', () => {
    expect(
      parseMoveZoneAllExiledWithNamedSource({ kind: 'raw', text: 'all cards exiled with Asmodeus' })
    ).toBe('asmodeus');
  });

  it('dry-runs Healing Technique return and life gain from mana value', () => {
    const text =
      "Return target card from your graveyard to your hand. You gain life equal to that card's mana value. Exile this permanent.";
    const steps = collectStepsFromIrText(text, 'Healing Technique');
    const record = dryRunOracleSteps(steps, 'Healing Technique', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Elixir of Immortality shuffle artifact and graveyard', () => {
    const text =
      "You gain 5 life. Shuffle this artifact and your graveyard into their owner's library.";
    const steps = collectStepsFromIrText(text, 'Elixir of Immortality');
    const record = dryRunOracleSteps(steps, 'Elixir of Immortality', [], { typeLine: 'Artifact' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Witness the End opponent hand exile', () => {
    const text = "Target opponent exiles two cards from their hand.";
    const steps = collectStepsFromIrText(text, 'Witness the End');
    const record = dryRunOracleSteps(steps, 'Witness the End', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Semester\'s End exile then each-of-them counters', () => {
    const text =
      "Exile any number of target creatures and/or planeswalkers you control. At the beginning of the next end step, return each of them to the battlefield under its owner's control. Each of them enters with an additional +1/+1 counter on it if it's a creature and an additional loyalty counter on it if it's a planeswalker.";
    const steps = collectStepsFromIrText(text, "Semester's End");
    const record = dryRunOracleSteps(steps, "Semester's End", [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Nissa all land cards from among them split', () => {
    const text =
      'Reveal the top six cards of your library. Put all land cards from among them onto the battlefield and the rest into your hand.';
    const steps = collectStepsFromIrText(text, "Nissa, Nature's Artisan");
    const record = dryRunOracleSteps(steps, "Nissa, Nature's Artisan", [], { typeLine: 'Legendary Planeswalker — Green' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Haunting Echoes opponent graveyard other than basics', () => {
    const text =
      "Exile all cards from target player's graveyard other than basic land cards. For each card exiled this way, search that player's library for all cards with the same name as that card and exile them. Then that player shuffles.";
    const steps = collectStepsFromIrText(text, 'Haunting Echoes');
    const record = dryRunOracleSteps(steps, 'Haunting Echoes', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Worldsoul\'s Rage lands from hand and graveyard', () => {
    const text =
      'This permanent deals X damage to any target. Put up to X land cards from your hand and/or graveyard onto the battlefield tapped.';
    const steps = collectStepsFromIrText(text, "Worldsoul's Rage");
    const record = dryRunOracleSteps(steps, "Worldsoul's Rage", [], { typeLine: 'Enchantment' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Ahn-Crop Crasher exert cant-block rider', () => {
    const text =
      "You may exert this creature as it attacks. When you do, target creature can't block this turn.";
    const steps = collectStepsFromIrText(text, 'Ahn-Crop Crasher');
    const record = dryRunOracleSteps(steps, 'Ahn-Crop Crasher', [], { typeLine: 'Creature — Minotaur Warrior' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Skyserpent Seeker land cards to battlefield tapped and rest to bottom', () => {
    const text =
      'Reveal the top four cards of your library. Put those land cards onto the battlefield tapped and the rest on the bottom of your library in any order.';
    const steps = collectStepsFromIrText(text, 'Skyserpent Seeker');
    const record = dryRunOracleSteps(steps, 'Skyserpent Seeker', [], { typeLine: 'Creature — Snake' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Scarab all auras attached to target permanent you own', () => {
    const text =
      "Return all Auras attached to target permanent you own to their owners' hands. Draw a card at the beginning of the next turn's upkeep.";
    const steps = collectStepsFromIrText(text, 'Scarab of the Unseen');
    const record = dryRunOracleSteps(steps, 'Scarab of the Unseen', [], { typeLine: 'Artifact' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Push the Limit Mount and Vehicle graveyard return', () => {
    const text =
      'Return all Mount and Vehicle cards from your graveyard to the battlefield. Sacrifice them at the beginning of the next end step.';
    const steps = collectStepsFromIrText(text, 'Push the Limit');
    const record = dryRunOracleSteps(steps, 'Push the Limit', [], { typeLine: 'Enchantment' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Pair o Dice Lost total MV X from graveyard', () => {
    const text =
      "Roll two six-sided dice. Return any number of cards with total mana value X or less from your graveyard to your hand, where X is the total of those results. Exile this permanent.";
    const steps = collectStepsFromIrText(text, "Pair o' Dice Lost");
    const record = dryRunOracleSteps(steps, "Pair o' Dice Lost", [], { typeLine: 'Artifact' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Push // Pull up to two creatures from single graveyard', () => {
    const text =
      'Put up to two target creature cards from a single graveyard onto the battlefield under your control. They gain haste until end of turn. Sacrifice them at the beginning of the next end step.';
    const steps = collectStepsFromIrText(text, 'Push // Pull');
    const record = dryRunOracleSteps(steps, 'Push // Pull', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Phyresis Outbreak poison-counter scaler', () => {
    const text =
      'Each opponent gets a poison counter. Then each creature your opponents control gets -1/-1 until end of turn for each poison counter its controller has.';
    const steps = collectStepsFromIrText(text, 'Phyresis Outbreak');
    const record = dryRunOracleSteps(steps, 'Phyresis Outbreak', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Power of Persuasion gain control on d20 branch', () => {
    const text =
      'Choose target creature an opponent controls, then roll a d20.\n1-9 | Return it to its owner\'s hand.\n10-19 | Its owner puts it on their choice of the top or bottom of their library.\n20 | Gain control of it until the end of your next turn.';
    const steps = collectStepsFromIrText(text, 'Power of Persuasion');
    const record = dryRunOracleSteps(steps, 'Power of Persuasion', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Shallow Grave top creature from graveyard', () => {
    const text =
      'Return the top creature card of your graveyard to the battlefield. That creature gains haste until end of turn. Exile it at the beginning of the next end step.';
    const steps = collectStepsFromIrText(text, 'Shallow Grave');
    const record = dryRunOracleSteps(steps, 'Shallow Grave', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Netherborn Altar commander to hand from command zone', () => {
    const text =
      'Put your commander into your hand from the command zone. Then you lose 3 life for each soul counter on this artifact.';
    const steps = collectStepsFromIrText(text, 'Netherborn Altar');
    const record = dryRunOracleSteps(steps, 'Netherborn Altar', [], { typeLine: 'Artifact' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Morningtide Light exile any number of target creatures', () => {
    const text =
      "Exile any number of target creatures. At the beginning of the next end step, return those cards to the battlefield tapped under their owners' control.";
    const steps = collectStepsFromIrText(text, "Morningtide's Light");
    const record = dryRunOracleSteps(steps, "Morningtide's Light", [], { typeLine: 'Enchantment' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Reckless Spite destroy two target nonblack creatures', () => {
    const text = 'Destroy two target nonblack creatures. You lose 5 life.';
    const steps = collectStepsFromIrText(text, 'Reckless Spite');
    const record = dryRunOracleSteps(steps, 'Reckless Spite', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Planar Genesis land-or-hand conditional split', () => {
    const text =
      "Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. If you don't, put a card from among them into your hand. Put the rest on the bottom of your library in a random order.";
    const steps = collectStepsFromIrText(text, 'Planar Genesis');
    const record = dryRunOracleSteps(steps, 'Planar Genesis', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Verdant Mastery search reveal and split', () => {
    const text =
      "Search your library for up to four basic land cards and reveal them. Put one of them onto the battlefield tapped under an opponent's control if the {3}{G} cost was paid. Put two of them onto the battlefield tapped under your control and the rest into your hand. Then shuffle.";
    const steps = collectStepsFromIrText(text, 'Verdant Mastery');
    const record = dryRunOracleSteps(steps, 'Verdant Mastery', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Stargaze X cards from among them hand and graveyard split', () => {
    const text =
      'Look at twice X cards from the top of your library. Put X cards from among them into your hand and the rest into your graveyard. You lose X life.';
    const steps = collectStepsFromIrText(text, 'Stargaze');
    const record = dryRunOracleSteps(steps, 'Stargaze', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Barrel Down Sokenzan sweep mountains to hand', () => {
    const text =
      "Sweep - Return any number of Mountains you control to their owner's hand. this permanent deals damage to target creature equal to twice the number of Mountains returned this way.";
    const steps = collectStepsFromIrText(text, 'Barrel Down Sokenzan');
    const record = dryRunOracleSteps(steps, 'Barrel Down Sokenzan', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Selvala Stampede those creature cards to battlefield', () => {
    const text =
      "Reveal cards from the top of your library until you reveal a creature card for each wild vote. Put those creature cards onto the battlefield, then shuffle the rest into your library. You may put a permanent card from your hand onto the battlefield for each free vote.";
    const steps = collectStepsFromIrText(text, "Selvala's Stampede");
    const record = dryRunOracleSteps(steps, "Selvala's Stampede", [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Dihada legendary among-them hand and graveyard split', () => {
    const text =
      'Reveal the top four cards of your library. Put any number of legendary cards from among them into your hand and the rest into your graveyard. Create a Treasure token for each card put into your graveyard this way.';
    const steps = collectStepsFromIrText(text, 'Dihada, Binder of Wills');
    const record = dryRunOracleSteps(steps, 'Dihada, Binder of Wills', [], { typeLine: 'Legendary Planeswalker — Dihada' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Hew the Entwood artifact and land among-them to battlefield', () => {
    const text =
      "Sacrifice any number of lands. Reveal the top X cards of your library, where X is the number of lands sacrificed this way. Choose any number of artifact and/or land cards from among them and put them onto the battlefield. Put the rest on the bottom of your library in a random order.";
    const steps = collectStepsFromIrText(text, 'Hew the Entwood');
    const record = dryRunOracleSteps(steps, 'Hew the Entwood', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Open into Wonder X target creatures unblockable grant', () => {
    const text =
      "X target creatures can't be blocked this turn. Until end of turn, those creatures gain \"Whenever this creature deals combat damage to a player, draw a card.\"";
    const steps = collectStepsFromIrText(text, 'Open into Wonder');
    const record = dryRunOracleSteps(steps, 'Open into Wonder', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Taunt from the Rampart goad then those creatures cant block', () => {
    const text =
      "Goad all creatures your opponents control. Until your next turn, those creatures can't block. (Until your next turn, those creatures attack each combat if able and attack a player other than you if able.)";
    const steps = collectStepsFromIrText(text, 'Taunt from the Rampart');
    const record = dryRunOracleSteps(steps, 'Taunt from the Rampart', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Hew the Entwood revealed/chosen split to battlefield', () => {
    const text =
      'Reveal the top X cards of your library, where X is the number of lands sacrificed this way. Choose any number of artifact and/or land cards revealed this way. Put all nonland cards chosen this way onto the battlefield, then put all land cards chosen this way onto the battlefield tapped, then put the rest on the bottom of your library in a random order.';
    const steps = collectStepsFromIrText(text, 'Hew the Entwood');
    const record = dryRunOracleSteps(steps, 'Hew the Entwood', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Plague Reaver delayed return under target opponent', () => {
    const text =
      "Choose target opponent. Return this creature to the battlefield under that player's control at the beginning of their next upkeep.";
    const steps = collectStepsFromIrText(text, 'Plague Reaver');
    const record = dryRunOracleSteps(steps, 'Plague Reaver', [], { typeLine: 'Creature — Beast' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Living Inferno power divided among target creatures', () => {
    const text =
      "This creature deals damage equal to its power divided as you choose among any number of target creatures. Each of those creatures deals damage equal to its power to this creature.";
    const steps = collectStepsFromIrText(text, 'Living Inferno');
    const record = dryRunOracleSteps(steps, 'Living Inferno', [], { typeLine: 'Creature — Elemental' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Spoils of the Vault exile other revealed cards', () => {
    const text =
      "Reveal cards from the top of your library until you reveal a card with that name, then put that card into your hand. Exile all other cards revealed this way, and you lose 1 life for each of the exiled cards.";
    const steps = collectStepsFromIrText(text, 'Spoils of the Vault');
    const record = dryRunOracleSteps(steps, 'Spoils of the Vault', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs The Elderspell destroy planeswalkers then loyalty add', () => {
    const text =
      'Destroy any number of target planeswalkers. Choose a planeswalker you control. Put two loyalty counters on it for each planeswalker destroyed this way.';
    const steps = collectStepsFromIrText(text, 'The Elderspell');
    const record = dryRunOracleSteps(steps, 'The Elderspell', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Suffer the Past exile X cards from target graveyard', () => {
    const text =
      "Exile X target cards from target player's graveyard. For each card exiled this way, that player loses 1 life and you gain 1 life.";
    const steps = collectStepsFromIrText(text, 'Suffer the Past');
    const record = dryRunOracleSteps(steps, 'Suffer the Past', [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Vincent Limit Break temporary dies trigger grant', () => {
    const text =
      'Tiered (Choose one additional cost.)\nUntil end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner\'s control" and has the chosen base power and toughness.';
    const steps = collectStepsFromIrText(text, "Vincent's Limit Break");
    const record = dryRunOracleSteps(steps, "Vincent's Limit Break", [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Chandra Legacy of Fire loyalty removal and exile', () => {
    const text =
      'Remove a loyalty counter from each of any number of permanents you control. Exile that many cards from the top of your library. You may play them this turn.';
    const steps = collectStepsFromIrText(text, 'Chandra, Legacy of Fire');
    const record = dryRunOracleSteps(steps, 'Chandra, Legacy of Fire', [], {
      typeLine: 'Legendary Planeswalker — Chandra',
    });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Showstopping Surprise turn face up', () => {
    const text = "Turn it face up if it's face down. Then it deals damage equal to its power to each other creature.";
    const steps = collectStepsFromIrText(text, 'Showstopping Surprise');
    const record = dryRunOracleSteps(steps, 'Showstopping Surprise', [], { typeLine: 'Creature — Human' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Zimone Hypothesis odd-even parity bounce', () => {
    const text =
      'You may put a +1/+1 counter on a creature. Then choose odd or even. Return each creature with power of the chosen quality to its owner\'s hand. (Zero is even.)';
    const steps = collectStepsFromIrText(text, "Zimone's Hypothesis");
    const record = dryRunOracleSteps(steps, "Zimone's Hypothesis", [], { typeLine: 'Instant' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Nuclear Fallout rad counters', () => {
    const text = 'Each creature gets twice -X/-X until end of turn. Each player gets X rad counters.';
    const steps = collectStepsFromIrText(text, 'Nuclear Fallout');
    const record = dryRunOracleSteps(steps, 'Nuclear Fallout', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Infernal Offering opponent graveyard return', () => {
    const text =
      "Choose an opponent. Return a creature card from your graveyard to the battlefield, then that player returns a creature card from their graveyard to the battlefield.";
    const steps = collectStepsFromIrText(text, 'Infernal Offering');
    const record = dryRunOracleSteps(steps, 'Infernal Offering', [], { typeLine: 'Sorcery' });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Welcome the Dead graveyard-from-hand-or-library token scaler', () => {
    const text =
      'Draw two cards, then discard a card and you lose 2 life. Create X tapped 2/2 black Zombie Druid creature tokens, where X is the number of cards that were put into your graveyard from your hand or library this turn.';
    const steps = collectStepsFromIrText(text, 'Welcome the Dead');
    const record = dryRunOracleSteps(steps, 'Welcome the Dead', [], { typeLine: 'Sorcery' });
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.reasonCodes.unknown_amount || 0).toBe(0);
  });

  it('dry-runs Selective Adaptation chosen-cards split', () => {
    const text =
      'Reveal the top seven cards of your library. Choose from among them a card with flying, a card with first strike, and so on for double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, reach, trample, and vigilance. Put one of the chosen cards onto the battlefield, the other chosen cards into your hand, and the rest into your graveyard.';
    const steps = collectStepsFromIrText(text, 'Selective Adaptation');
    const record = dryRunOracleSteps(steps, 'Selective Adaptation', [], { typeLine: 'Sorcery' });
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.reasonCodes.unsupported_selector || 0).toBe(0);
  });

  it('dry-runs Liliana Last Hope emblem zombie token scaler', () => {
    const text =
      'You get an emblem with "At the beginning of your end step, create X 2/2 black Zombie creature tokens, where X is two plus the number of Zombies you control."';
    const steps = collectStepsFromIrText(text, 'Liliana, the Last Hope');
    const record = dryRunOracleSteps(steps, 'Liliana, the Last Hope', [], {
      typeLine: 'Legendary Planeswalker — Liliana',
    });
    expect(record.status).toBe('fully_applied');
  });

  it('dry-runs Mindblaze chosen-name library count conditional', () => {
    const text =
      'Choose a nonland card name and a number greater than 0. Target player reveals their library. If that library contains exactly the chosen number of cards with the chosen name, this permanent deals 8 damage to that player. Then that player shuffles.';
    const steps = collectStepsFromIrText(text, 'Mindblaze');
    const record = dryRunOracleSteps(steps, 'Mindblaze', [], { typeLine: 'Sorcery' });
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.reasonCodes.unsupported_condition_clause || 0).toBe(0);
  });

  it('dry-runs Scrying Glass chosen-color hand count conditional', () => {
    const text =
      'Choose a number greater than 0 and a color. Target opponent reveals their hand. If that opponent reveals exactly the chosen number of cards of the chosen color, you draw a card.';
    const steps = collectStepsFromIrText(text, 'Scrying Glass');
    const record = dryRunOracleSteps(steps, 'Scrying Glass', [], { typeLine: 'Artifact' });
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.reasonCodes.unsupported_condition_clause || 0).toBe(0);
  });

  it('dry-runs Wand of Ith unless-pay land branches', () => {
    const text =
      "Target player reveals a card at random from their hand. If it's a land card, that player discards it unless they pay 1 life. If it isn't a land card, the player discards it unless they pay life equal to its mana value. Activate only during your turn.";
    const steps = collectStepsFromIrText(text, 'Wand of Ith');
    const record = dryRunOracleSteps(steps, 'Wand of Ith', [], { typeLine: 'Artifact' });
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.reasonCodes.unsupported_condition_clause || 0).toBe(0);
  });

  it('dry-runs Caesar choose-two split bullet repair', () => {
    const text =
      'you may sacrifice another creature. When you do, choose two —\n• Create two 1/1 red and white Soldier creature tokens with haste that are tapped and attacking.\n• You draw a card and you lose 1 life.\n• this permanent deals damage equal to the number of creature tokens you control to target opponent.';
    const steps = collectStepsFromIrText(text, "Caesar, Legion's Emperor");
    const record = dryRunOracleSteps(steps, "Caesar, Legion's Emperor", [], {
      typeLine: 'Legendary Creature — Human Soldier',
    });
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.reasonCodes.invalid_mode_selection || 0).toBe(0);
  });

  it('dry-runs Winter\'s Chill may-pay branches', () => {
    const text =
      "Choose X target attacking creatures. For each of those creatures, its controller may pay {1} or {2}. If that player doesn't, destroy that creature at end of combat. If that player pays only {1}, prevent all combat damage that would be dealt to and dealt by that creature this combat.";
    const steps = collectStepsFromIrText(text, "Winter's Chill");
    const record = dryRunOracleSteps(steps, "Winter's Chill", [], { typeLine: 'Enchantment' });
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.reasonCodes.unsupported_condition_clause || 0).toBe(0);
  });

  it('executes reveal-until nonland then all cards revealed this way to hand', () => {
    const text =
      "Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way into your hand.";
    const steps = collectStepsFromIrText(text, 'Treasure Hunt');
    let state = buildAuditFixtureState('Treasure Hunt', 'Sorcery');
    let ctx = buildAuditExecutionContext('Treasure Hunt');
    const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx);
    const result = applyOracleIRStepsToGameState(enriched.state, steps, enriched.ctx, {
      allowOptional: true,
    });
    expect(result.automationGaps || []).toEqual([]);
    const p1 = result.state.players?.find((p: any) => p.id === 'p1') as any;
    expect((p1?.hand || []).length).toBeGreaterThan(0);
  });
});
