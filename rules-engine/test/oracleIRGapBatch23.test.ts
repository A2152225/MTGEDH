import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function collectUnknowns(value: unknown): unknown[] {
  const unknowns: unknown[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as any).kind === 'unknown') unknowns.push((node as any).raw ?? node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return unknowns;
}

function collectSteps(value: unknown): any[] {
  const steps: any[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (typeof (node as any).kind === 'string') steps.push(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return steps;
}

describe('Oracle IR gap batch 23 support', () => {
  it('normalizes modal labels and reminder wrappers around graveyard zone moves', () => {
    const palace = parseOracleTextToIR(
      '\u2022 Khans \u2014 At the beginning of your upkeep, return target creature card from your graveyard to your hand.',
      'Palace Siege'
    );
    const legendarySorcery = parseOracleTextToIR(
      '(You may cast a legendary sorcery only if you control a legendary creature or planeswalker.) Return all legendary permanent cards from your graveyard to the battlefield.',
      "Primevals' Glorious Rebirth"
    );
    const flashbackGrant = parseOracleTextToIR(
      '\u2022 Each instant and sorcery card in your graveyard gains flashback until end of turn.',
      'Will of the Jeskai'
    );

    expect(collectUnknowns([palace, legendarySorcery, flashbackGrant])).toEqual([]);
    expect(palace.abilities[0]).toMatchObject({ type: 'triggered', triggerCondition: 'the beginning of your upkeep' });
    expect(palace.abilities[0]?.steps[0]).toMatchObject({ kind: 'move_zone', to: 'hand' });
    expect(legendarySorcery.abilities[0]?.steps[0]).toMatchObject({ kind: 'move_zone', to: 'battlefield' });
    expect(flashbackGrant.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_graveyard_permission',
      permission: 'cast',
      duration: 'this_turn',
    });
  });

  it('parses temporary dies-trigger grants with reminder tails and rider effects', () => {
    const roleToken = parseOracleTextToIR(
      'Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner\'s control, then create a Wicked Role token attached to it." (Enchanted creature gets +1/+1.',
      'Not Dead After All'
    );
    const treasureToken = parseOracleTextToIR(
      'Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner\'s control and you create a Treasure token." (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
      'Fake Your Own Death'
    );
    const suspect = parseOracleTextToIR(
      'Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner\'s control and suspect it." (A suspected creature has menace and can\'t block.)',
      'Presumed Dead'
    );

    expect(collectUnknowns([roleToken, treasureToken, suspect])).toEqual([]);
    expect(roleToken.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_temporary_dies_trigger',
      target: { kind: 'raw', text: 'target creature you control' },
      effect: "return it to the battlefield tapped under its owner's control, then create a Wicked Role token attached to it.",
    });
    expect(treasureToken.abilities[0]?.steps.map(step => step.kind)).toEqual(['modify_pt', 'grant_temporary_dies_trigger']);
    expect((treasureToken.abilities[0]?.steps[1] as any).effect).toBe(
      "return it to the battlefield tapped under its owner's control and you create a Treasure token."
    );
    expect(suspect.abilities[0]?.steps.map(step => step.kind)).toEqual(['modify_pt', 'grant_temporary_dies_trigger']);
    expect((suspect.abilities[0]?.steps[1] as any).effect).toBe(
      "return it to the battlefield under its owner's control and suspect it."
    );
  });

  it('parses graveyard play/cast permission variants from the offset queue', () => {
    const will = parseOracleTextToIR(
      'Until end of turn, you may play lands and cast spells from your graveyard.',
      "Gaea's Will"
    );
    const kethis = parseOracleTextToIR(
      'Exile two legendary cards from your graveyard: Until end of turn, each legendary card in your graveyard gains "You may play this card from your graveyard."',
      'Kethis, the Hidden Hand'
    );
    const mayhem = parseOracleTextToIR(
      'Mayhem (You may play this card from your graveyard if you discarded it this turn.',
      'Oscorp Industries'
    );

    expect(collectUnknowns([will, kethis, mayhem])).toEqual([]);
    expect(will.abilities[0]?.steps).toMatchObject([
      { kind: 'grant_graveyard_permission', permission: 'play', what: { kind: 'raw', text: 'lands' }, duration: 'this_turn' },
      { kind: 'grant_graveyard_permission', permission: 'cast', what: { kind: 'raw', text: 'spells' }, duration: 'this_turn' },
    ]);
    expect(kethis.abilities[0]).toMatchObject({ type: 'activated' });
    expect(kethis.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_graveyard_permission',
      permission: 'play',
      what: { kind: 'raw', text: 'legendary card' },
      duration: 'this_turn',
    });
    expect(mayhem.abilities[0]?.steps[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'as_long_as', raw: 'you discarded it this turn' },
      steps: [{ kind: 'grant_graveyard_permission', permission: 'play', what: { kind: 'raw', text: 'this card' } }],
    });
  });

  it('folds Vraska-style returned Treasure artifact rewrites into the battlefield move', () => {
    const text =
      'Deathtouch Whenever a nontoken creature an opponent controls dies, you may pay {1}. If you do, return that card to the battlefield tapped under your control. It\'s a Treasure artifact with "{T}, Sacrifice this artifact: Add one mana of any color," and it loses all other card types.';
    const ir = parseOracleTextToIR(text, 'Vraska, the Silencer');
    const move = collectSteps(ir.abilities).find(step => step.kind === 'move_zone');

    expect(collectUnknowns(ir.abilities)).toEqual([]);
    expect(move).toMatchObject({
      kind: 'move_zone',
      to: 'battlefield',
      entersTapped: true,
      battlefieldSetTypeLine: 'Artifact - Treasure',
      battlefieldSetOracleText: '{T}, Sacrifice this artifact: Add one mana of any color,',
    });
  });

  it('cleans recurring modal and reminder-only category fragments', () => {
    const modalHeader = parseOracleTextToIR('Choose one \u2014', 'Gap Probe');
    const scryReminder = parseOracleTextToIR('(Look at the top card of your library.', 'Gap Probe');
    const stormReminder = parseOracleTextToIR(
      'Storm (When you cast this spell, copy it for each spell cast before it this turn.',
      'Gap Probe'
    );
    const stormTailReminder = parseOracleTextToIR(
      '(When you cast it, copy it for each spell cast before it this turn.',
      'Gap Probe'
    );
    const copyRetargetReminder = parseOracleTextToIR('You may choose new targets for the copy.', 'Gap Probe');
    const permanentSpellCopyReminder = parseOracleTextToIR('(A copy of a permanent spell becomes a token.)', 'Gap Probe');
    const endTurnReminder = parseOracleTextToIR('(Exile all spells and abilities from the stack, including this card.', 'Gap Probe');
    const suspendReminder = parseOracleTextToIR('You may cast it without paying its mana cost.)', 'Gap Probe');
    const plotReminder = parseOracleTextToIR('Cast it as a sorcery on a later turn without paying its mana cost.', 'Gap Probe');
    const goadReminder = parseOracleTextToIR(
      '(It attacks each combat if able and attacks a player other than you if able.)',
      'Gap Probe'
    );
    const goadUntilReminder = parseOracleTextToIR(
      '(Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)',
      'Gap Probe'
    );

    const reminders = [
      modalHeader,
      scryReminder,
      stormReminder,
      stormTailReminder,
      copyRetargetReminder,
      permanentSpellCopyReminder,
      endTurnReminder,
      suspendReminder,
      plotReminder,
      goadReminder,
      goadUntilReminder,
    ];

    expect(collectUnknowns(reminders)).toEqual([]);
    expect(reminders.flatMap(ir => ir.abilities)).toEqual([]);
  });

  it('parses bullet-prefixed top-library looks and opponent-controlled attach clauses', () => {
    const topLook = parseOracleTextToIR('\u2022 Look at the top four cards of your library.', 'Gap Probe');
    const attach = parseOracleTextToIR(
      'Attach this Equipment to target creature an opponent controls.',
      'Gap Probe'
    );
    const auraAttach = parseOracleTextToIR('Attach this Aura to target creature you control.', 'Gap Probe');
    const equipmentAttach = parseOracleTextToIR('Attach target Equipment you control to this creature.', 'Gap Probe');

    expect(collectUnknowns([topLook, attach, auraAttach, equipmentAttach])).toEqual([]);
    expect(topLook.abilities[0]?.steps[0]).toMatchObject({
      kind: 'look_top',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 4 },
    });
    expect(attach.abilities[0]?.steps[0]).toMatchObject({
      kind: 'attach',
      attachment: { kind: 'raw', text: 'this Equipment' },
      to: { kind: 'raw', text: 'target creature an opponent controls' },
    });
    expect(auraAttach.abilities[0]?.steps[0]).toMatchObject({
      kind: 'attach',
      attachment: { kind: 'raw', text: 'this Aura' },
      to: { kind: 'raw', text: 'target creature you control' },
    });
    expect(equipmentAttach.abilities[0]?.steps[0]).toMatchObject({
      kind: 'attach',
      attachment: { kind: 'raw', text: 'target Equipment you control' },
      to: { kind: 'raw', text: 'this creature' },
    });
  });

  it('parses next-20 high-count control, copy, free-cast, discard, and modal fragments', () => {
    const windfall = parseOracleTextToIR(
      'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.',
      'Windfall'
    );
    const permanentControl = parseOracleTextToIR('Gain control of target artifact.', 'Memnarch');
    const temporaryControl = parseOracleTextToIR(
      'For each opponent, gain control of up to one target creature that player controls until end of turn.',
      'Molten Primordial'
    );
    const attachedControl = parseOracleTextToIR(
      'Gain control of that permanent for as long as that Aura is attached to it.',
      'Eriette, the Beguiler'
    );
    const exchange = parseOracleTextToIR(
      'Exchange control of target land you control and target land an opponent controls.',
      'Political Trickery'
    );
    const retargetCopy = parseOracleTextToIR(
      'When you do, copy this spell and you may choose a new target for the copy.)',
      'Rooftop Nuisance'
    );
    const epicCopy = parseOracleTextToIR('Copy this spell except for its epic ability.', 'Eternal Dominion');
    const copyTwice = parseOracleTextToIR('Copy that spell twice.', 'Repeated Reverberation');
    const castOrHand = parseOracleTextToIR(
      'Cast it without paying its mana cost or put it into your hand.',
      'Chimil, the Inner Sun'
    );
    const commanderFreeCast = parseOracleTextToIR(
      'If you control a commander, you may cast this spell without paying its mana cost.',
      'Fierce Guardianship'
    );
    const chooseUpToOne = parseOracleTextToIR('Choose up to one target creature.', 'Avatar\'s Wrath');

    expect(collectUnknowns([
      windfall,
      permanentControl,
      temporaryControl,
      attachedControl,
      exchange,
      retargetCopy,
      epicCopy,
      copyTwice,
      castOrHand,
      commanderFreeCast,
      chooseUpToOne,
    ])).toEqual([]);
    expect(windfall.abilities[0]?.steps[1]).toMatchObject({
      kind: 'draw',
      amount: { kind: 'reference_amount', raw: 'greatest_number_discarded_this_way' },
    });
    expect(permanentControl.abilities[0]?.steps[0]).toMatchObject({ kind: 'gain_control', duration: 'indefinite' });
    expect(temporaryControl.abilities[0]?.steps[0]).toMatchObject({ kind: 'gain_control', duration: 'until_end_of_turn' });
    expect(attachedControl.abilities[0]?.steps[0]).toMatchObject({ kind: 'gain_control', duration: 'as_long_as_attached' });
    expect(exchange.abilities[0]?.steps[0]).toMatchObject({ kind: 'exchange_control' });
    expect(retargetCopy.abilities[0]?.steps[0]).toMatchObject({ kind: 'copy_spell', allowNewTargets: true });
    expect(epicCopy.abilities[0]?.steps[0]).toMatchObject({ kind: 'copy_spell', subject: 'this_spell' });
    expect(copyTwice.abilities[0]?.steps[0]).toMatchObject({ kind: 'copy_spell', copies: { kind: 'number', value: 2 } });
    expect(castOrHand.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_exile_permission',
      withoutPayingManaCost: true,
    });
    expect(commanderFreeCast.abilities).toEqual([]);
    expect(chooseUpToOne.abilities[0]?.steps[0]).toMatchObject({ kind: 'choose_target_creature', optional: true });
  });

  it('parses second-pass next-20 repeated parser fragments', () => {
    const freeCastIt = parseOracleTextToIR('You may cast it without paying its mana cost.', 'Gap Probe');
    const playExiled = parseOracleTextToIR('You may play the exiled card this turn.', 'Gap Probe');
    const conditionalCopy = parseOracleTextToIR(
      'If the player does, they may copy this spell. They may choose new targets for the copy.',
      'Gap Probe'
    );
    const vampireLord = parseOracleTextToIR('Other Vampires you control get +1/+1.', 'Gap Probe');
    const forcedBlocks = parseOracleTextToIR('They block this turn if able.', 'Gap Probe');
    const playerMill = parseOracleTextToIR('Any number of target players each mill two cards.', 'Gap Probe');
    const exchangeTwo = parseOracleTextToIR('Exchange control of two target creatures.', 'Gap Probe');
    const returnPerOpponent = parseOracleTextToIR(
      'For each opponent, return up to one target nonland permanent that player controls to its owner\'s hand.',
      'Gap Probe'
    );
    const frogify = parseOracleTextToIR(
      'Enchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.',
      'Gap Probe'
    );
    const variableMana = parseOracleTextToIR(
      'Add X mana of any one color, where X is the number of enchantments you control.',
      'Gap Probe'
    );
    const exiledSetFreeCast = parseOracleTextToIR(
      'You may cast up to two spells from among the other cards exiled this way without paying their mana costs.',
      'Gap Probe'
    );
    const voteControl = parseOracleTextToIR(
      'For each money vote, choose a permanent owned by the voter and gain control of it.',
      'Gap Probe'
    );
    const attachManaValue = parseOracleTextToIR(
      'You may attach target Equipment you control with mana value 2 or 3 to this permanent.',
      'Gap Probe'
    );
    const bulletKeyword = parseOracleTextToIR(
      '\u2022 Creatures you control gain flying, vigilance, and double strike until end of turn.',
      'Gap Probe'
    );
    const unblockableBy = parseOracleTextToIR(
      'Until end of turn, that creature can\'t be blocked by creatures your opponents control.',
      'Gap Probe'
    );
    const staticWard = parseOracleTextToIR('Equipped creature has flying and ward {4}.', 'Gap Probe');
    const discardHalf = parseOracleTextToIR(
      'Target opponent discards half the cards in their hand, rounded down.',
      'Gap Probe'
    );

    expect(collectUnknowns([
      freeCastIt,
      playExiled,
      conditionalCopy,
      vampireLord,
      forcedBlocks,
      playerMill,
      exchangeTwo,
      returnPerOpponent,
      frogify,
      variableMana,
      exiledSetFreeCast,
      voteControl,
      attachManaValue,
      bulletKeyword,
      unblockableBy,
      staticWard,
      discardHalf,
    ])).toEqual([]);
    expect(freeCastIt.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_exile_permission',
      permission: 'cast',
      withoutPayingManaCost: true,
    });
    expect(playExiled.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_exile_permission',
      permission: 'play',
      duration: 'this_turn',
    });
    expect(conditionalCopy.abilities[0]?.steps[0]).toMatchObject({
      kind: 'conditional',
      steps: [{ kind: 'copy_spell', subject: 'this_spell', allowNewTargets: true }],
    });
    expect(vampireLord.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability', power: 1, toughness: 1 });
    expect(forcedBlocks.abilities[0]?.steps[0]).toMatchObject({ kind: 'force_block' });
    expect(playerMill.abilities[0]?.steps[0]).toMatchObject({
      kind: 'mill',
      who: { kind: 'any_number_of_target_players' },
      amount: { kind: 'number', value: 2 },
    });
    expect(exchangeTwo.abilities[0]?.steps[0]).toMatchObject({ kind: 'exchange_control' });
    expect(returnPerOpponent.abilities[0]?.steps[0]).toMatchObject({ kind: 'move_zone', to: 'hand' });
    expect(frogify.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(variableMana.abilities[0]?.steps[0]).toMatchObject({ kind: 'add_mana', mana: '{X}' });
    expect(exiledSetFreeCast.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_exile_permission',
      withoutPayingManaCost: true,
    });
    expect(voteControl.abilities[0]?.steps[0]).toMatchObject({ kind: 'gain_control', duration: 'indefinite' });
    expect(attachManaValue.abilities[0]?.steps[0]).toMatchObject({ kind: 'attach', optional: true });
    expect(bulletKeyword.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_temporary_ability',
      abilities: ['flying', 'vigilance', 'double strike'],
    });
    expect(unblockableBy.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_temporary_ability' });
    expect(staticWard.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(discardHalf.abilities[0]?.steps[0]).toMatchObject({
      kind: 'discard',
      amount: { kind: 'reference_amount', raw: 'half_hand_rounded_down' },
    });
  });

  it('parses turn, target-change, and remaining high-count combat/zone fragments', () => {
    const endTurn = parseOracleTextToIR('End the turn.', 'Sundial of the Infinite');
    const skipTurn = parseOracleTextToIR('You skip your next turn.', 'Eater of Days');
    const changeTarget = parseOracleTextToIR(
      'Change the target of target spell with a single target.',
      'Bolt Bend'
    );
    const counterContext = parseOracleTextToIR('Counter that spell.', 'Hesitation');
    const ownerShuffle = parseOracleTextToIR('Its owner shuffles it into their library.', 'Chaos Warp');
    const mustBeBlocked = parseOracleTextToIR('It must be blocked this turn if able.', 'Gap Probe');
    const doubleDamage = parseOracleTextToIR('It deals double that damage to that permanent or player.', 'Gap Probe');
    const skipUntap = parseOracleTextToIR(
      'Lands you control don\'t untap during your next untap step.',
      'Stasis'
    );
    const alternateCost = parseOracleTextToIR(
      'If you control a Plains, you may tap an untapped creature you control rather than pay this spell\'s mana cost.',
      'Bargain Probe'
    );

    expect(collectUnknowns([
      endTurn,
      skipTurn,
      changeTarget,
      counterContext,
      ownerShuffle,
      mustBeBlocked,
      doubleDamage,
      skipUntap,
      alternateCost,
    ])).toEqual([]);
    expect(endTurn.abilities[0]?.steps[0]).toMatchObject({ kind: 'end_turn' });
    expect(skipTurn.abilities[0]?.steps[0]).toMatchObject({ kind: 'skip_next_turn', who: { kind: 'you' } });
    expect(changeTarget.abilities[0]?.steps[0]).toMatchObject({ kind: 'change_target' });
    expect(counterContext.abilities[0]?.steps[0]).toMatchObject({ kind: 'counter_spell' });
    expect(ownerShuffle.abilities[0]?.steps[0]).toMatchObject({ kind: 'move_zone', to: 'library' });
    expect(mustBeBlocked.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_temporary_ability' });
    expect(doubleDamage.abilities[0]?.steps[0]).toMatchObject({ kind: 'modify_damage', targetFilter: 'that permanent or player' });
    expect(skipUntap.abilities[0]?.steps[0]).toMatchObject({ kind: 'skip_next_untap' });
    expect(alternateCost.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
  });

  it('parses follow-up high-count audit mechanics from the refreshed baseline', () => {
    const flipLoop = parseOracleTextToIR('Flip a coin until you lose a flip.', 'Okaun, Eye of Chaos');
    const costTax = parseOracleTextToIR('Noncreature spells cost {1} more to cast.', 'Thorn of Amethyst');
    const planetCounters = parseOracleTextToIR('Put charge counters equal to its power on this Planet.', 'Kavaron');
    const revealShuffle = parseOracleTextToIR(
      'Reveal this permanent and shuffle it into its owner\'s library.',
      'Darksteel Colossus'
    );
    const restrictedMana = parseOracleTextToIR('Add {C}. Spend this mana only to activate abilities.', 'Omen Hawker');
    const tapX = parseOracleTextToIR('Tap X target creatures.', 'Glimpse the Sun God');
    const tappedUnless = parseOracleTextToIR('Tapped unless you control a basic land.', 'Gap Land');
    const graveyardTail = parseOracleTextToIR('Then puts those cards into their graveyard.', 'Balustrade Spy');
    const losesDefender = parseOracleTextToIR('This creature loses defender until end of turn.', 'Gap Probe');
    const depletion = parseOracleTextToIR(
      'This land doesn\'t untap during your untap step if it has a depletion counter on it.',
      'Veldt'
    );
    const cdaPower = parseOracleTextToIR(
      'This permanent\'s power is equal to the number of artifacts you control.',
      'Bronze Guardian'
    );
    const vehicle = parseOracleTextToIR('This Vehicle becomes an artifact creature.', 'Gap Vehicle');
    const willVote = parseOracleTextToIR(
      'Will of the Planeswalkers - Starting with you, each player votes for planeswalk or chaos.',
      'Path of the Enigma'
    );
    const lifeReplacement = parseOracleTextToIR('You gain twice that much life.', 'Boon Reflection');
    const borderpostCost = parseOracleTextToIR(
      'You may pay {1} and return a basic land you control to its owner\'s hand rather than pay this spell\'s mana cost.',
      'Mistvein Borderpost'
    );

    expect(collectUnknowns([
      flipLoop,
      costTax,
      planetCounters,
      revealShuffle,
      restrictedMana,
      tapX,
      tappedUnless,
      graveyardTail,
      losesDefender,
      depletion,
      cdaPower,
      vehicle,
      willVote,
      lifeReplacement,
      borderpostCost,
    ])).toEqual([]);
    expect(flipLoop.abilities[0]?.steps[0]).toMatchObject({ kind: 'flip_coin', repeatUntil: 'lose_flip' });
    expect(costTax.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(planetCounters.abilities[0]?.steps[0]).toMatchObject({ kind: 'add_counter', counter: 'charge' });
    expect(revealShuffle.abilities[0]?.steps[0]).toMatchObject({ kind: 'move_zone', to: 'library' });
    expect(restrictedMana.abilities[0]?.steps[0]).toMatchObject({ kind: 'add_mana', spendRestriction: 'activated_ability' });
    expect(tapX.abilities[0]?.steps[0]).toMatchObject({ kind: 'tap_or_untap', mode: 'tap' });
    expect(tappedUnless.abilities).toEqual([]);
    expect(graveyardTail.abilities[0]?.steps[0]).toMatchObject({ kind: 'move_zone', to: 'graveyard' });
    expect(losesDefender.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_temporary_ability' });
    expect(depletion.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(cdaPower.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(vehicle.abilities).toEqual([]);
    expect(willVote.abilities[0]?.steps[0]).toMatchObject({ kind: 'vote', choices: ['planeswalk', 'chaos'] });
    expect(lifeReplacement.abilities[0]?.steps[0]).toMatchObject({ kind: 'gain_life' });
    expect(borderpostCost.abilities).toEqual([]);
  });

  it('parses or filters the next count-three audit cleanup cluster', () => {
    const textChange = parseOracleTextToIR(
      'Change the text of target spell or permanent by replacing all instances of one color word with another.',
      'Alter Reality'
    );
    const chooseCardType = parseOracleTextToIR('Choose a card type.', 'Blood Oath');
    const chooseLetter = parseOracleTextToIR('Choose a letter.', 'Gray Merchant of Alphabet');
    const chooseOddEven = parseOracleTextToIR('Choose odd or even.', 'Extinction Event');
    const chooseOpposingCreatures = parseOracleTextToIR(
      'Choose target creature you control and target creature an opponent controls.',
      'Grim Contest'
    );
    const chooseActiveCreature = parseOracleTextToIR(
      'Choose target non-Wall creature the active player has controlled continuously since the beginning of the turn.',
      'Norritt'
    );
    const commanderStorm = parseOracleTextToIR(
      'When you cast this spell, copy it for each time you\'ve cast your commander from the command zone this game.',
      'Empyrial Storm'
    );
    const enchantedCreatures = parseOracleTextToIR(
      'Creatures you control that are enchanted get +1/+1.',
      'Guardian\'s Magemark'
    );
    const lifelinkReminder = parseOracleTextToIR(
      'Damage dealt by it also causes you to gain that much life.)',
      'Stonehorn Chanter'
    );
    const domainCost = parseOracleTextToIR(
      'Domain - This spell costs {1} less to cast for each basic land type among lands you control.',
      'Leyline Binding'
    );
    const improviseReminder = parseOracleTextToIR(
      'Each artifact you tap after you\'re done activating mana abilities pays for {1}.)',
      'Inspiring Statuary'
    );
    const copyTargetReminder = parseOracleTextToIR(
      'Each copy targets a different one of those creatures.',
      'Zada, Hedron Grinder'
    );
    const toughnessDamage = parseOracleTextToIR(
      'Each creature you control with toughness greater than its power assigns combat damage equal to its toughness rather than its power.',
      'Ancient Lumberknot'
    );
    const sorcerySpeedOpponents = parseOracleTextToIR(
      'Each opponent can cast spells only any time they could cast a sorcery.',
      'Teferi, Time Raveler'
    );
    const balanceLands = parseOracleTextToIR(
      'Each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the fewest.',
      'Balance'
    );
    const roleReminder = parseOracleTextToIR('Enchanted creature has this permanent.', 'Lifelink');
    const oneOneReminder = parseOracleTextToIR('Enchanted creature is 1/1.)', 'Asinine Antics');
    const enchantedSwamp = parseOracleTextToIR('Enchanted land is a Swamp.', 'Evil Presence');
    const enchantedIsland = parseOracleTextToIR('Enchanted land is an Island.', 'Spreading Seas');
    const countersFromPower = parseOracleTextToIR(
      'Put a number of +1/+1 counters equal to this permanent\'s power on up to one other target creature.',
      'Szarel, Genesis Shepherd'
    );
    const equippedPump = parseOracleTextToIR('Equipped creature gets +2/+2 until end of turn.', 'Adventuring Gear');
    const artifactScaler = parseOracleTextToIR(
      'Target creature gets +1/+0 until end of turn for each artifact you control.',
      'Hunger of the Nim'
    );
    const tappedScaler = parseOracleTextToIR(
      'This creature gets +1/+1 until end of turn for each creature tapped this way.',
      'Siege Striker'
    );
    const aurochsScaler = parseOracleTextToIR(
      'It gets +1/+0 until end of turn for each other attacking Aurochs.',
      'Aurochs Herd'
    );
    const opponentTokenCopy = parseOracleTextToIR(
      'For each opponent, create a token copy that attacks that opponent this turn if able.',
      'Araumi of the Dead Tide'
    );
    const hauntReminder = parseOracleTextToIR(
      'Haunt (When this spell card is put into a graveyard after resolving, exile it haunting target creature.)',
      'Cry of Contrition'
    );
    const manifestTail = parseOracleTextToIR(
      'If it\'s a creature card, it can be turned face up any time for its mana cost.)',
      'Reality Shift'
    );
    const loseGame = parseOracleTextToIR('If you can\'t, you lose the game.', 'Forbidden Crypt');
    const investigateMany = parseOracleTextToIR('Investigate that many times.', 'Piper Wright');
    const auraForm = parseOracleTextToIR('It becomes an Aura with enchant creature.', 'Rageform');
    const activatedLock = parseOracleTextToIR(
      'Its activated abilities can\'t be activated unless they\'re mana abilities.',
      'Faith\'s Fetters'
    );
    const allLandTypes = parseOracleTextToIR(
      'Lands you control are every basic land type in addition to their other types.',
      'Prismatic Omen'
    );
    const landsUntapped = parseOracleTextToIR('Lands you control enter untapped.', 'Spelunking');
    const topCardsRevealed = parseOracleTextToIR(
      'Players play with the top card of their libraries revealed.',
      'Lantern of Insight'
    );
    const handsRevealed = parseOracleTextToIR('Players play with their hands revealed.', 'Wandering Eye');
    const loseKeywords = parseOracleTextToIR(
      'Permanents your opponents control lose hexproof and indestructible until end of turn.',
      'Shadowspear'
    );
    const preventWouldDeal = parseOracleTextToIR(
      'Prevent all combat damage target creature would deal this turn.',
      'Falling Timber'
    );
    const preventByTarget = parseOracleTextToIR(
      'Prevent all combat damage that would be dealt by target creature this turn.',
      'Subdue'
    );
    const preventToAndBy = parseOracleTextToIR(
      'Prevent all combat damage that would be dealt to and dealt by that creature this turn.',
      'Maze of Ith'
    );
    const phasingTail = parseOracleTextToIR(
      'It phases in before its controller untaps during their next untap step.)',
      'Vanishing'
    );
    const scionReminder = parseOracleTextToIR(
      'It has "Sacrifice this token: Add {C}." ({C} represents colorless mana.)',
      'Scion Summoner'
    );
    const foodReminder = parseOracleTextToIR(
      'It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")',
      'Food Token'
    );
    const lifeCostInstead = parseOracleTextToIR(
      'If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.',
      'Bolas\'s Citadel'
    );
    const doubleTokens = parseOracleTextToIR('It creates twice that many of those tokens.', 'Doubling Season');
    const additionalGreen = parseOracleTextToIR('Its controller adds an additional {G}.', 'Wild Growth');
    const opponentsActivate = parseOracleTextToIR('Only your opponents may activate this ability.', 'Soul Ransom');
    const staticPreventCombatTo = parseOracleTextToIR(
      'Prevent all combat damage that would be dealt to this creature.',
      'Everdawn Champion'
    );
    const staticPreventBy = parseOracleTextToIR(
      'Prevent all damage that would be dealt by enchanted creature.',
      'Gaseous Form'
    );
    const staticPreventTo = parseOracleTextToIR(
      'Prevent all damage that would be dealt to this creature.',
      'Cho-Manno, Revolutionary'
    );
    const protectionColors = parseOracleTextToIR('Protection from black and from red.', 'Sword of Feast and Famine');
    const bottomRandom = parseOracleTextToIR(
      'Put the rest of the cards on the bottom of your library in a random order.',
      'Cascade Probe'
    );
    const bottomAny = parseOracleTextToIR(
      'Put the revealed cards on the bottom of your library in any order.',
      'Reveal Probe'
    );

    expect(collectUnknowns([
      textChange,
      chooseCardType,
      chooseLetter,
      chooseOddEven,
      chooseOpposingCreatures,
      chooseActiveCreature,
      commanderStorm,
      enchantedCreatures,
      lifelinkReminder,
      domainCost,
      improviseReminder,
      copyTargetReminder,
      toughnessDamage,
      sorcerySpeedOpponents,
      balanceLands,
      roleReminder,
      oneOneReminder,
      enchantedSwamp,
      enchantedIsland,
      countersFromPower,
      equippedPump,
      artifactScaler,
      tappedScaler,
      aurochsScaler,
      opponentTokenCopy,
      hauntReminder,
      manifestTail,
      loseGame,
      investigateMany,
      auraForm,
      activatedLock,
      allLandTypes,
      landsUntapped,
      topCardsRevealed,
      handsRevealed,
      loseKeywords,
      preventWouldDeal,
      preventByTarget,
      preventToAndBy,
      phasingTail,
      scionReminder,
      foodReminder,
      lifeCostInstead,
      doubleTokens,
      additionalGreen,
      opponentsActivate,
      staticPreventCombatTo,
      staticPreventBy,
      staticPreventTo,
      protectionColors,
      bottomRandom,
      bottomAny,
    ])).toEqual([]);

    expect(textChange.abilities[0]?.steps[0]).toMatchObject({ kind: 'player_choice', choice: 'text_change' });
    expect(chooseCardType.abilities[0]?.steps[0]).toMatchObject({ kind: 'player_choice', choice: 'card_type' });
    expect(chooseLetter.abilities[0]?.steps[0]).toMatchObject({ kind: 'player_choice', choice: 'letter' });
    expect(chooseOddEven.abilities[0]?.steps[0]).toMatchObject({ kind: 'player_choice', choice: 'odd_even' });
    expect(chooseOpposingCreatures.abilities[0]?.steps[0]).toMatchObject({ kind: 'choose_target_creature' });
    expect(chooseActiveCreature.abilities[0]?.steps[0]).toMatchObject({ kind: 'choose_target_creature' });
    expect(commanderStorm.abilities[0]?.steps[0]).toMatchObject({ kind: 'copy_spell', subject: 'this_spell' });
    expect(enchantedCreatures.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability', power: 1, toughness: 1 });
    expect(lifelinkReminder.abilities).toEqual([]);
    expect(domainCost.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(improviseReminder.abilities).toEqual([]);
    expect(copyTargetReminder.abilities).toEqual([]);
    expect(toughnessDamage.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(sorcerySpeedOpponents.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(balanceLands.abilities[0]?.steps[0]).toMatchObject({ kind: 'player_choice', choice: 'number_of_lands' });
    expect(roleReminder.abilities).toEqual([]);
    expect(oneOneReminder.abilities).toEqual([]);
    expect(enchantedSwamp.abilities[0]?.steps[0]).toMatchObject({ kind: 'set_basic_land_type', landType: 'Swamp' });
    expect(enchantedIsland.abilities[0]?.steps[0]).toMatchObject({ kind: 'set_basic_land_type', landType: 'Island' });
    expect(countersFromPower.abilities[0]?.steps[0]).toMatchObject({ kind: 'add_counter', amount: { kind: 'object_stat' } });
    expect(equippedPump.abilities[0]?.steps[0]).toMatchObject({ kind: 'modify_pt', target: { kind: 'equipped_creature' } });
    expect(artifactScaler.abilities[0]?.steps[0]).toMatchObject({ kind: 'modify_pt', scaler: { kind: 'per_artifact_you_control' } });
    expect(tappedScaler.abilities[0]?.steps[0]).toMatchObject({ kind: 'modify_pt', scaler: { kind: 'per_creature_tapped_this_way' } });
    expect(aurochsScaler.abilities[0]?.steps[0]).toMatchObject({ kind: 'modify_pt', scaler: { kind: 'per_other_attacking_aurochs' } });
    expect(opponentTokenCopy.abilities[0]?.steps[0]).toMatchObject({ kind: 'create_token', attacking: 'each_opponent' });
    expect(hauntReminder.abilities).toEqual([]);
    expect(manifestTail.abilities).toEqual([]);
    expect(loseGame.abilities[0]?.steps[0]).toMatchObject({ kind: 'lose_game' });
    expect(investigateMany.abilities[0]?.steps[0]).toMatchObject({ kind: 'investigate', amount: { kind: 'reference_amount' } });
    expect(auraForm.abilities[0]?.steps[0]).toMatchObject({ kind: 'become_aura' });
    expect(activatedLock.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(allLandTypes.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(landsUntapped.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(topCardsRevealed.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(handsRevealed.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(loseKeywords.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_temporary_ability' });
    expect(preventWouldDeal.abilities[0]?.steps[0]).toMatchObject({ kind: 'prevent_damage', combatOnly: true });
    expect(preventByTarget.abilities[0]?.steps[0]).toMatchObject({ kind: 'prevent_damage', combatOnly: true });
    expect(preventToAndBy.abilities[0]?.steps[0]).toMatchObject({ kind: 'prevent_damage', combatOnly: true });
    expect(phasingTail.abilities).toEqual([]);
    expect(scionReminder.abilities).toEqual([]);
    expect(foodReminder.abilities).toEqual([]);
    expect(lifeCostInstead.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(doubleTokens.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(additionalGreen.abilities[0]?.steps[0]).toMatchObject({ kind: 'add_mana', mana: '{G}' });
    expect(opponentsActivate.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(staticPreventCombatTo.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(staticPreventBy.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(staticPreventTo.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(protectionColors.abilities).toEqual([]);
    expect(bottomRandom.abilities).toEqual([]);
    expect(bottomAny.abilities).toEqual([]);
  });
});