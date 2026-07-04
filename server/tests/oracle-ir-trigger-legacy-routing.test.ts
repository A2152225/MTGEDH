import { afterEach, describe, expect, it } from 'vitest';

import {
  isTriggerEffectFullyIrWired,
  isTriggerEffectOwnedByOracleIrPrimary,
  isTriggerStepKindRetiredUnderOracleIrPrimary,
  ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS,
  shouldSkipLegacyTriggerBodyHandlers,
  shouldSkipLegacyTriggerRegexHandlers,
  skipRetiredTriggerLegacyHandler,
  shouldSkipTriggerUncategorizedFallback,
} from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { parseBareTriggerEffectFragmentSteps } from '../../rules-engine/src/oracleIRParserPostprocess.js';

describe('oracleIrTriggerLegacyRouting', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('does not skip legacy handlers when primary mode is off', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    expect(isTriggerEffectOwnedByOracleIrPrimary('Draw a card.', 'Creature')).toBe(false);
    expect(shouldSkipLegacyTriggerRegexHandlers('Draw a card.', 'Creature')).toBe(false);
  });

  it('skips legacy handlers for wired draw/gain-life trigger text in primary mode', { timeout: 15000 }, () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(isTriggerEffectOwnedByOracleIrPrimary('Draw two cards.', 'Mulldrifter')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('You gain 1 life.', 'Soul Warden')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Target player gains 3 life.', 'Healing Salve')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('You lose 2 life.', 'Shock')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Target player loses 2 life.', 'Bump')).toBe(true);
    expect(shouldSkipTriggerUncategorizedFallback('Draw a card.', 'ETB Creature')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('You gain 3 life.', 'Fountain')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Scry 1.', 'Opt')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Surveil 2.', 'Darkblade Agent')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Target player discards a card.', 'Liliana')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Target player mills three cards.', 'Glimpse')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Destroy target creature.', 'Murderous Redcap')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each opponent discards a card.', 'Liliana')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each opponent mills two cards.', 'Glimpse')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each player discards two cards.', 'Wheel')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each player mills two cards.', 'Glimpse')).toBe(true);
    expect(skipRetiredTriggerLegacyHandler('You lose 2 life.', 'Shock')).toBe(false);
    expect(skipRetiredTriggerLegacyHandler('Target player loses 2 life.', 'Bump')).toBe(false);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Create a Treasure token.', 'Smothering Tithe')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Deal 3 damage to target player.', 'Lightning Strike')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Deal 2 damage to each opponent.', 'Guttersnipe')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Deal 1 damage to each player.', 'Coalhauler Swine')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Lightning Bolt deals 3 damage to any target.', 'Lightning Bolt')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Deal 3 damage to target creature.', 'Shock')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Create a 1/1 white Soldier creature token.', 'Recruit')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Deal 1 damage to each creature.', 'Test Sweep')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Deal 1 damage to each creature you control.', 'Test Self Sweep')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Deal 1 damage to each creature your opponents control.', 'Test Opp Sweep')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Deal 1 damage to each creature and each planeswalker.', 'Test Swelter')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Deal 1 damage to each planeswalker.', 'Test PW Burn')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Destroy all creatures.', 'Test Wrath')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Destroy each creature.', 'Test Each Wrath')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Exile target creature.', 'Test Path to Exile')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Exile all creatures.', 'Test Terminus')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Exile each creature.', 'Test Each Terminus')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Exile all creatures your opponents control.', 'Test Opp Terminus')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Exile target nonland permanent.', 'Test Oblivion Ring')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary("Return target creature to its owner's hand.", 'Test Unsummon')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Exile up to one target card from a graveyard.', 'Test Scavenging Ooze')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Return target creature card from a graveyard to the battlefield.', 'Test Reanimate')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Return target instant or sorcery card from your graveyard to your hand.', 'Test Regrowth')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Exile the top card of your library.', 'Test Impulse')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Exile target creature until ~ leaves the battlefield.', 'Test Flickerwisp')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary("Exile all cards from target player's graveyard.", 'Test Bojuka Bog')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Sacrifice target creature.', 'Test Edict')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Counter target spell.', 'Test Counterspell')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Tap target creature.', 'Test Twiddle')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Untap target creature.', 'Test Vitalize')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put a +1/+1 counter on target creature.', 'Test Incubate')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put a +1/+1 counter on each creature you control.', 'Test Collective Growth')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put two +1/+1 counters on target creature.', 'Forge Room')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put an indestructible counter on this creature.', 'Mondrak')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Untap all lands you control.', 'Bear Umbra')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Untap all other creatures you control.', 'Combat Celebrant')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Untap all creatures you control.', 'Eomer')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Each player gains control of all creatures they own.', 'Test')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put a +1/+1 counter on each other creature you control.', 'Test Growth')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put a +1/+1 counter on each creature you control with power 4 or greater.', 'Test Devotion')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put a +1/+1 counter on each creature you control of the chosen type.', 'Kindred Discovery')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary("Create a token that's a copy of equipped creature, except it's not legendary.", 'Helm of the Host')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Double the number of +1/+1 counters on it.', 'Aragorn')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Double the number of +1/+1 counters on it.', 'Aragorn')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Untap all lands you control.', 'Bear Umbra')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Deal 1 damage to each creature you control.', 'Test Self Sweep')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Put a +1/+1 counter on each creature you control.', 'Test Collective Growth')).toBe(true);
    expect(isTriggerEffectFullyIrWired('Proliferate.', 'Test Source')).toBe(true);
    expect(isTriggerEffectFullyIrWired('After this combat phase, there is an additional combat phase.', 'Test Source')).toBe(true);
    expect(isTriggerEffectFullyIrWired('Add {G}{G}{G}.', 'Test Source')).toBe(true);
    expect(isTriggerEffectFullyIrWired('That player adds {U}.', 'Test Source')).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'Exile the top two cards of your library. Choose one of them. You may play that card this turn.',
      'Test Source',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.',
      'Anep, Vizier of Hazoret',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'untap all other creatures you control and after this phase, there is an additional combat phase',
      'Combat Celebrant',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'then, if you have 1,000 or more life, you lose the game.',
      'Test Source',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'double the amount of life you lose and cards you draw for the rest of the game from this ability.',
      'Test Source',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired('sacrifice this creature', 'Fling')).toBe(true);
    expect(isTriggerEffectFullyIrWired('sacrifice this creature.', 'Fling')).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'the attacking player gains control of this artifact and untaps it',
      'Test Source',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'draw cards equal to the number of opponents who were dealt combat damage this turn',
      'Moonshae Pixie',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired('untap all elves you control', 'Source')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Proliferate.', 'Test Source')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('After this combat phase, there is an additional combat phase.', 'Test Source')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Deal 3 damage to target creature an opponent controls.', 'Test Scoped Burn')).toBe(true);
    expect(skipRetiredTriggerLegacyHandler('Lightning Bolt deals 3 damage to any target.', 'Lightning Bolt')).toBe(false);
    expect(skipRetiredTriggerLegacyHandler('Deal 3 damage to target creature.', 'Shock')).toBe(false);
    expect(skipRetiredTriggerLegacyHandler('Create a Treasure token.', 'Smothering Tithe')).toBe(false);
    expect(skipRetiredTriggerLegacyHandler('Deal 2 damage to each opponent.', 'Guttersnipe')).toBe(false);
  });

  it('does not skip unknown trigger fragments', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(isTriggerEffectOwnedByOracleIrPrimary('', 'Source')).toBe(false);
    expect(shouldSkipLegacyTriggerRegexHandlers('Do something utterly non-oracular.', 'Source')).toBe(false);
  });

  it('documents retired trigger step kinds with parity coverage', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('draw')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('gain_life')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('lose_game')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('lose_life')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('scry')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('surveil')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('investigate')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('goad')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('proliferate')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('add_extra_combat')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('populate')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('create_token')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('destroy')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('exile')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('move_zone')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('grant_temporary_ability')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('grant_leave_battlefield_replacement')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('schedule_delayed_battlefield_action')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary(
      'Return a creature card at random from your graveyard to the battlefield. It gains flying, trample, and haste. Exile that card at the beginning of your next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.',
      'Kheru Lich Lord',
    )).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('counter_spell')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('tap_or_untap')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('add_counter')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('copy_permanent')).toBe(true);
    expect(isTriggerStepKindRetiredUnderOracleIrPrimary('draw')).toBe(true);
    expect(isTriggerStepKindRetiredUnderOracleIrPrimary('create_token')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Scry 1.', 'Opt')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each player scries 1.', 'Test Scry Each')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Surveil 2.', 'Discovery')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each opponent surveils 2.', 'Test Surveil Each')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Investigate.', 'Cluekeeper')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Goad target creature.', 'Disrupt Decorum')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Proliferate.', 'Atraxa')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Populate.', 'Ghired')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Tap all creatures.', 'Sleep')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Destroy all creatures target player controls.', 'Test Target Wrath')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Exile all creatures target player controls.', 'Test Target Terminus')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Target player discards a card.', 'Liliana')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each player draws a card.', 'Howling Mine')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers("That creature's controller loses 2 life.", 'Blood Seeker')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Target player draws a card.', 'Harmonize')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Target player mills three cards.', 'Glimpse')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Destroy target creature.', 'Murderous Redcap')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each opponent discards a card.', 'Liliana')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each opponent mills two cards.', 'Glimpse')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each player discards two cards.', 'Wheel')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each player mills two cards.', 'Glimpse')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Create a Treasure token.', 'Smothering Tithe')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Deal 2 damage to each opponent.', 'Guttersnipe')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Deal 1 damage to each player.', 'Coalhauler Swine')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Lightning Bolt deals 3 damage to any target.', 'Lightning Bolt')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Deal 3 damage to target creature.', 'Shock')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Create a 1/1 white Soldier creature token.', 'Recruit')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Deal 1 damage to each creature.', 'Test Sweep')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Deal 1 damage to each planeswalker.', 'Test PW Burn')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Destroy all creatures.', 'Test Wrath')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Destroy each creature.', 'Test Each Wrath')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Exile target creature.', 'Test Path to Exile')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Exile all creatures.', 'Test Terminus')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Exile each creature.', 'Test Each Terminus')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Exile all creatures your opponents control.', 'Test Opp Terminus')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Exile target nonland permanent.', 'Test Oblivion Ring')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers("Return target creature to its owner's hand.", 'Test Unsummon')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers("Exile all cards from target player's graveyard.", 'Test Bojuka Bog')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Sacrifice target creature.', 'Test Edict')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Counter target spell.', 'Test Counterspell')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Tap target creature.', 'Test Twiddle')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Untap target creature.', 'Test Vitalize')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Put a +1/+1 counter on target creature.', 'Test Incubate')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('deal_damage')).toBe(true);
    expect(isTriggerStepKindRetiredUnderOracleIrPrimary('deal_damage')).toBe(true);
    expect(isTriggerStepKindRetiredUnderOracleIrPrimary('choose_mode')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('choose_mode')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('add_extra_combat')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('take_extra_turn')).toBe(true);
    expect(shouldSkipLegacyTriggerBodyHandlers('Draw two cards.', 'Mulldrifter')).toBe(true);
    expect(isTriggerEffectFullyIrWired('Take an extra turn after this one.', 'Time Warp')).toBe(true);
    expect(shouldSkipLegacyTriggerBodyHandlers('Take an extra turn after this one.', 'Time Warp')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('You may discard a card. If you do, draw a card.', 'Rummage')).toBe(true);
    expect(shouldSkipLegacyTriggerBodyHandlers('You may discard a card. If you do, draw a card.', 'Rummage')).toBe(true);
  });

  it('isTriggerEffectFullyIrWired reports wired trigger clauses independent of primary flag', () => {
    expect(isTriggerEffectFullyIrWired('Draw two cards.', 'Mulldrifter')).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'choose a creature type. Put a +1/+1 counter on each creature you control of that type.',
      'Littjara',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      "draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.",
      'Kynaios and Tiro of Meletis',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'Choose up to three -\n\u2022 Sell Contraband - You lose 1 life. Create a Treasure token.\n\u2022 Buy Information - You lose 2 life. Draw a card.\n\u2022 Hire a Mercenary - You lose 3 life. Create a 3/2 colorless Shapeshifter creature token with changeling.',
      'Contraband Kingpin',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      "It can't be blocked this turn and you scry 1.",
      'Clockwork Droid',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'target creature gets +X/+X until end of turn, where X is the number of counters on permanents you control',
      'Hydra Trainer',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'prevent all combat damage that would be dealt to it this turn.',
      "Oketra's Avenger",
    )[0]?.kind).toBe('grant_temporary_ability');
    expect(isTriggerEffectFullyIrWired(
      'prevent all combat damage that would be dealt to it this turn.',
      "Oketra's Avenger",
    )).toBe(true);
    expect(collectOracleEffectSteps(
      "Up to one target creature can't be blocked this turn.",
      'Source',
    )[0]?.kind).toBe('grant_temporary_ability');
    expect(isTriggerEffectFullyIrWired(
      "Up to one target creature can't be blocked this turn.",
      'Source',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      "This creature can't be blocked by creatures with power 2 or less this turn.",
      'Trueheart Twins',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'it gets +1/+3 and gains lifelink until end of turn.',
      'Glory-Bound Initiate',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'creatures you control get +1/+1 until end of turn.',
      'Tah-Crop Elite',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'target creature gets +2/+2 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'creatures you control get +1/+1 until end of turn.',
      'Tah-Crop Elite',
    )[0]?.kind).toBe('modify_pt');
    expect(collectOracleEffectSteps(
      'target creature gets +2/+2 until end of turn.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'he gains flying until end of turn.',
      'Themberchaud',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'creatures you control get +1/+0 until end of turn.',
      'Resolute Survivors',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      "double target creature's power until end of turn.",
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      "double target creature's power until end of turn.",
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      "double target creature's power and toughness until end of turn.",
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'other creatures you control get +1/+1 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      "target creature can't block this turn.",
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'creatures you control get +1/+1 and gain vigilance until end of turn.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'creatures you control get +1/+1 and gain vigilance until end of turn.',
      'Generic',
    ).map((step) => step.kind)).toEqual(['modify_pt', 'grant_temporary_ability']);
    expect(isTriggerEffectFullyIrWired(
      'each creature you control gets +1/+1 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'creatures you control of the chosen type get +1/+0 and gain haste until end of turn.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'until end of turn, creatures you control get +1/+1 and gain trample.',
      'Generic',
    ).map((step) => step.kind)).toEqual(['modify_pt', 'grant_temporary_ability']);
    expect(collectOracleEffectSteps(
      "double target creature's power and toughness until end of turn.",
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(collectOracleEffectSteps(
      'other creatures you control get +1/+1 until end of turn.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(collectOracleEffectSteps(
      "target creature can't block this turn.",
      'Generic',
    )[0]?.kind).toBe('cant_block');
    expect(collectOracleEffectSteps(
      'each other creature you control gets +1/+1 until end of turn.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(collectOracleEffectSteps(
      'Those creatures get +1/+1 until end of turn.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(collectOracleEffectSteps(
      'attacking creatures you control get +1/+1 until end of turn.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(collectOracleEffectSteps(
      'the creature that attacked gets +2/+2 until end of turn.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(collectOracleEffectSteps(
      'they get +2/+2 until end of turn.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(collectOracleEffectSteps(
      'each creature gets +1/+1 until end of turn.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(collectOracleEffectSteps(
      'creatures you control get +1/+1 and have trample until end of turn.',
      'Generic',
    ).map((step) => step.kind)).toEqual(['modify_pt', 'grant_temporary_ability']);
    expect(collectOracleEffectSteps(
      'they get +X/+X until end of turn, where X is the number of creatures you control.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'creatures you control get +X/+X until end of turn, where X is the number of creatures you control.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.',
      'Generic',
    ).map((step) => step.kind)).toEqual(['grant_temporary_ability', 'modify_pt']);
    expect(isTriggerEffectFullyIrWired(
      'all creatures get -X/-0 until end of turn, where X is the number of cards in your hand.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'all attacking creatures with flanking get +1/+1 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'each creature you control gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'another target creature gets +2/+2 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'target creature you control gets +2/+2 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'creatures you control get +X/+X until end of turn, where X is the greatest power among creatures you control.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'up to one target creature gets +2/+2 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'up to one target creature gets +2/+2 until end of turn.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'unblocked attacking creatures get +1/+0 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'target creature gets +X/+X until end of turn, where X is the number of counters on permanents you control.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'until end of turn, target creature gets +2/+2 and gains flying.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'one or two target creatures get +2/+2 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'one or two target creatures get +2/+2 until end of turn.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'until end of turn, it gets +2/+2 and gains flying.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'each creature you control gets +X/+0 until end of turn, where X is the number of +1/+1 counters on it.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'target creature an opponent controls gets -X/-X until end of turn, where X is the number of cards in your hand.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'any number of target creatures each get +1/+1 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures target player controls get +1/+1 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'creatures target player controls get +1/+1 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'two target creatures get +2/+2 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'two target creatures get +2/+2 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'target creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'each attacking creature you control gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'creatures target player controls get +X/+X until end of turn, where X is the number of Mountains you control.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'creatures target player controls get +X/+X until end of turn, where X is the number of Mountains you control.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'the chosen creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'the chosen creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature blocking it gets -X/-X until end of turn, where X is the number of cards in your hand.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'each creature blocking it gets -X/-X until end of turn, where X is the number of cards in your hand.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'another target creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'target creature an opponent controls gets -X/-0 until end of turn, where X is the number of cards in your hand.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'the creature that attacked gets +X/+X until end of turn, where X is the number of Mountains you control.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'the creature that attacked gets +X/+X until end of turn, where X is the number of Mountains you control.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'that creature gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'each opponent\'s creatures get -X/-X until end of turn, where X is the number of cards in your hand.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'target creature gets +X/+X until end of turn, where X is its toughness.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control get +X/+0 until end of turn, where X is the number of cards in your hand.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'each creature you control gets +X/+X until end of turn, where X is its power.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures you control gain menace until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(isTriggerEffectFullyIrWired(
      'target creature gains hexproof until end of turn.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'they get +X/+0 until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'other creatures you control get +X/+X until end of turn, where X is the number of creatures you control.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, target creature gets +X/+X, where X is its power.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'each creature you control gets +X/+X until end of turn, where X is its toughness.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'other creatures you control gain flying until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, it gains hexproof.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, it gets +X/+X, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(collectOracleEffectSteps(
      'until end of turn, it gets +X/+X, where X is the number of +1/+1 counters on it.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'until end of turn, it gets +X/+X, where X is the number of +1/+1 counters on it.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'this creature gains lifelink until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(isTriggerEffectFullyIrWired(
      'this creature gains lifelink until end of turn.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature you control with a +1/+1 counter on it gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'each creature you control with a +1/+1 counter on it gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'that creature gains hexproof until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(collectOracleEffectSteps(
      'until end of turn, creatures you control get +X/+0, where X is the number of cards in your hand.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'creatures you control of the chosen type get +X/+X until end of turn, where X is the number of Mountains you control.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'it gets +X/+X until end of turn, where X is the number of +1/+1 counters on it.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'creatures your opponents control get -X/-X until end of turn, where X is the number of cards in your hand.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      "each creature you don't control gets -1/-1 until end of turn.",
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'each creature you control with power 4 or greater gets +1/+1 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'until end of turn, each creature you control gets +1/+1.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature with flying gets +1/+1 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      "all creatures you don't control get -1/-1 until end of turn.",
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'each creature gets +1/+1 until end of turn for each creature you control.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      "all creatures you don't control get -1/-1 until end of turn.",
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'each creature you control gets +X/+X until end of turn for each +1/+1 counter on it.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'each creature gets +X/+X until end of turn, where X is the number of creatures you control.',
      'Generic',
    )[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'noncreature spells you control cost {1} less to cast.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'until end of turn, each creature gets +1/+1 for each creature you control.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      "each opponent's creatures get +1/+1 until end of turn for each creature you control.",
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      "each opponent's creatures get +1/+1 until end of turn for each creature you control.",
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'this spell costs {1} less to cast for each creature you control.',
      'Generic',
    )[0]?.kind).toBe('grant_static_ability');
    expect(parseBareTriggerEffectFragmentSteps(
      'each other attacking creature gets +1/+0 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'other attacking creatures you control get +X/+0 until end of turn, where X is the number of counters on this permanent.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'each other creature you control with base power and toughness 1/1 gets +X/+X until end of turn, where X is the number of +1/+1 counters on this permanent.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'you may tap any number of untapped creatures you control. this creature gets +1/+1 until end of turn for each creature tapped this way.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature blocking this creature gets -0/-1 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'blocking creatures get -1/-1 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(parseBareTriggerEffectFragmentSteps(
      'nonartifact creatures get -2/-2 until end of turn.',
    )?.[0]?.kind).toBe('modify_pt');
    expect(isTriggerEffectFullyIrWired(
      'each of them gets +x/+x until end of turn, where x is this creature\'s power.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'other creatures you control get +x/+x until end of turn, where x is the number of times this creature has mutated.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'this creature gets +x/+0 until end of turn, where x is the number of attacking creatures you control.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'each creature you control gets +1/+1 until end of turn for each goblin you control.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'creatures your opponents control get -1/-1 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps('put X +1/+1 counters on it.', 'Generic')[0]?.kind).toBe('add_counter');
    expect(collectOracleEffectSteps('put X +1/+1 counters on enchanted permanent.', 'Generic')[0]?.kind).toBe('add_counter');
    expect(collectOracleEffectSteps(
      'put two +1/+1 counters on target creature.',
      'Generic',
    )[0]?.kind).toBe('add_counter');
    expect(isTriggerEffectFullyIrWired(
      'put two +1/+1 counters on target creature.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'put two +1/+1 counters on target creature. that creature becomes an angel in addition to its other types and gains flying.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'distribute X +1/+1 counters among any number of target elves.',
      'Generic',
    )[0]?.kind).toBe('add_counter');
    expect(isTriggerEffectFullyIrWired(
      'distribute X +1/+1 counters among any number of other target creatures you control.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'distribute X +1/+1 counters among it and any number of commanders.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      "put a number of +1/+1 counters equal to this permanent's power on another target creature you control.",
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps('put X +1/+1 counters on each of those permanents.', 'Generic')[0]?.kind).toBe('add_counter');
    expect(isTriggerEffectFullyIrWired(
      'creatures you control with power 4 or greater get +2/+2 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'each creature you control with a counter on it gets +1/+1 until end of turn.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'sacrifice this creature unless you pay {1} for each card in your hand.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'if you search your library this way, shuffle.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'if a graveyard has twenty or more cards in it, draw three cards instead.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'each opponent discards two cards unless they discard a nonland card.',
      'Generic',
    )).toBe(true);
    expect(parseBareTriggerEffectFragmentSteps(
      'another target creature you control gains deathtouch until end of turn.',
    )?.[0]?.kind).toBe('grant_temporary_ability');
    expect(isTriggerEffectFullyIrWired(
      'untap all other creatures you control.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'untap all creatures you control.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'each player gains control of all creatures they own.',
      'Generic',
    )).toBe(true);
    expect(collectOracleEffectSteps(
      'untap all other creatures you control.',
      'Generic',
    )[0]?.kind).toBe('tap_or_untap');
    expect(isTriggerEffectFullyIrWired(
      'Put a number of +1/+1 counters on this creature equal to your devotion to green.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'Put X +1/+1 counters on it equal to the number of artifacts you control.',
      'Generic',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'You gain life equal to the number of cards in your hand.',
      "Venser's Journal",
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired(
      'You gain 1 life for each card in your hand above 4.',
      'Ivory Tower',
    )).toBe(true);
    expect(isTriggerEffectFullyIrWired('Do something utterly non-oracular.', 'Creature')).toBe(false);
  });
});
