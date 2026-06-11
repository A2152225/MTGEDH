import { afterEach, describe, expect, it } from 'vitest';

import {
  isTriggerEffectOwnedByOracleIrPrimary,
  isTriggerStepKindRetiredUnderOracleIrPrimary,
  ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS,
  shouldSkipLegacyTriggerBodyHandlers,
  shouldSkipLegacyTriggerRegexHandlers,
  skipRetiredTriggerLegacyHandler,
  shouldSkipTriggerUncategorizedFallback,
} from '../src/state/modules/oracleIrTriggerLegacyRouting.js';

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

  it('skips legacy handlers for wired draw/gain-life trigger text in primary mode', () => {
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
    expect(isTriggerEffectOwnedByOracleIrPrimary("Exile all cards from target player's graveyard.", 'Test Bojuka Bog')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Sacrifice target creature.', 'Test Edict')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Counter target spell.', 'Test Counterspell')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Tap target creature.', 'Test Twiddle')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Untap target creature.', 'Test Vitalize')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put a +1/+1 counter on target creature.', 'Test Incubate')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put a +1/+1 counter on each creature you control.', 'Test Collective Growth')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put an indestructible counter on this creature.', 'Mondrak')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Untap all lands you control.', 'Bear Umbra')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put a +1/+1 counter on each other creature you control.', 'Test Growth')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put a +1/+1 counter on each creature you control with power 4 or greater.', 'Test Devotion')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Put a +1/+1 counter on each creature you control of the chosen type.', 'Kindred Discovery')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary("Create a token that's a copy of equipped creature, except it's not legendary.", 'Helm of the Host')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('Double the number of +1/+1 counters on it.', 'Aragorn')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Double the number of +1/+1 counters on it.', 'Aragorn')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Untap all lands you control.', 'Bear Umbra')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Deal 1 damage to each creature you control.', 'Test Self Sweep')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Put a +1/+1 counter on each creature you control.', 'Test Collective Growth')).toBe(true);
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
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('lose_life')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('scry')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('surveil')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('investigate')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('goad')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('proliferate')).toBe(true);
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
    expect(shouldSkipLegacyTriggerBodyHandlers('Draw two cards.', 'Mulldrifter')).toBe(true);
    expect(shouldSkipLegacyTriggerBodyHandlers('Take an extra turn after this one.', 'Time Warp')).toBe(false);
  });
});
