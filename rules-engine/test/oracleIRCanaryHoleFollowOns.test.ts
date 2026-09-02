import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { parseSimpleBattlefieldSelector } from '../src/oracleIRExecutorBattlefieldParser.js';
import {
  parseMoveZoneAllFromYourHand,
  parseMoveZoneMassBattlefieldCreatureBounce,
  parseMoveZoneSingleTargetFromYourGraveyard,
  parseMoveZoneSingleCardExiledWithIt,
  parseMoveZoneUpToTypedCardsFromAmongThem,
} from '../src/oracleIRExecutorZoneOps.js';
import { normalizeExileTargetReferenceText } from '../src/oracleIRExecutorBattlefieldExileZoneHelpers.js';

describe('generic canary-hole follow-ons', () => {
  it('splits sacrifice-it comma draw into sacrifice plus draw', () => {
    const ir = parseOracleTextToIR(
      'When the fourth plan counter is put on this enchantment, sacrifice it, draw a card, and put a +1/+1 counter on each creature you control.',
      'Political Triumph',
    );
    const kinds = ir.abilities.flatMap((ability) => ability.steps.map((step) => step.kind));
    expect(kinds).toContain('sacrifice');
    expect(kinds).toContain('draw');
    const sacrifice = ir.abilities
      .flatMap((ability) => ability.steps)
      .find((step) => step.kind === 'sacrifice') as { what?: { text?: string } } | undefined;
    expect(String(sacrifice?.what?.text || '').toLowerCase()).toBe('it');
  });

  it('parses all the cards from your hand as a mass hand selector', () => {
    expect(
      parseMoveZoneAllFromYourHand({ kind: 'raw', text: 'all the cards from your hand' }),
    ).toEqual({ cardType: 'any' });
  });

  it('parses each chosen creature as a mass bounce selector', () => {
    expect(
      parseMoveZoneMassBattlefieldCreatureBounce({ kind: 'raw', text: 'each chosen creature' }),
    ).toEqual({ chosenCreaturesOnly: true });
  });

  it('parses singular target attacking creature as attackingOnly', () => {
    expect(parseSimpleBattlefieldSelector({ kind: 'raw', text: 'target attacking creature' })).toMatchObject({
      types: ['creature'],
      attackingOnly: true,
    });
  });

  it('parses discard-all of a chosen color without an unknown amount', () => {
    const ir = parseOracleTextToIR(
      'Choose a color. Target player reveals their hand and discards all cards of that color.',
      'Persecute',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.map((step) => step.kind)).toEqual(['choose_color', 'reveal_hand', 'discard']);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.find((step) => step.kind === 'discard')).toMatchObject({
      amount: { kind: 'all' },
    });
  });

  it('parses draw unless target opponent sacrifices or pays life', () => {
    const ir = parseOracleTextToIR(
      'draw a card unless target opponent sacrifices a creature of their choice or pays 3 life.',
      'Indulgent Tormentor',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.find((step) => step.kind === 'unless_sacrifices')).toMatchObject({
      who: expect.objectContaining({ kind: 'target_opponent' }),
    });
  });

  it('parses up to one target opponent may also copy that spell', () => {
    const ir = parseOracleTextToIR(
      'up to one target opponent may also copy that spell. They may choose new targets for that copy.',
      'Parnesse, the Subtle Brush',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'copy_spell')).toBe(true);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
  });

  it('lowers additional lands this turn to a this-turn grant', () => {
    const ir = parseOracleTextToIR('You may play up to three additional lands this turn.', 'Summer Bloom');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.some((step) => step.kind === 'grant_static_ability')).toBe(true);
  });

  it('parses typed flash this turn after a Convoke leftover', () => {
    const ir = parseOracleTextToIR(
      'Convoke You may cast sorcery spells this turn as though they had flash.',
      'Complete the Circuit',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.some((step) => step.kind === 'grant_temporary_ability')).toBe(true);
  });

  it('parses the owner of target nonland permanent library placement', () => {
    const ir = parseOracleTextToIR(
      'Convoke The owner of target nonland permanent puts it into their library second from the top or on the bottom.',
      'Temporal Cleansing',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.some((step) => step.kind === 'move_zone')).toBe(true);
  });

  it('parses until-eot target creature becomes a colored type with base P/T', () => {
    const ir = parseOracleTextToIR(
      'Until end of turn, target creature becomes a white Rabbit with base power and toughness 0/1.',
      'Metamorphic Blast',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.some((step) => step.kind === 'animate_permanent')).toBe(true);
  });

  it('parses it becomes night', () => {
    const ir = parseOracleTextToIR('It becomes night.', 'Unnatural Moonrise');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.some((step) => step.kind === 'grant_static_ability')).toBe(true);
  });

  it('parses when you next cast this turn as a delayed trigger', () => {
    const ir = parseOracleTextToIR(
      'When you next cast an instant or sorcery spell this turn, copy that spell twice.',
      'Complete the Circuit',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.some((step) => step.kind === 'schedule_delayed_trigger')).toBe(true);
  });

  it('prunes leftover choose-new-targets for copies you control', () => {
    const ir = parseOracleTextToIR(
      'Tempting offer — Choose target instant or sorcery spell. Each opponent may copy that spell and may choose new targets for the copy they control. You copy that spell once plus an additional time for each opponent who copied the spell this way. You may choose new targets for the copies you control.',
      'Tempt with Mayhem',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.some((step) => step.kind === 'tempting_offer')).toBe(true);
  });

  it('parses this spell cannot be countered after a Kicker leftover', () => {
    const ir = parseOracleTextToIR(
      "Kicker {8}{R} This spell can't be countered. Urza's Rage deals 3 damage to any target.",
      "Urza's Rage",
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.some((step) => step.kind === 'grant_static_ability' || step.kind === 'deal_damage')).toBe(true);
  });

  it('parses Teamwork leftover glued onto named-source damage', () => {
    const ir = parseOracleTextToIR(
      'Teamwork 2 Helicarrier Strike deals 2 damage to target attacking or blocking creature. If this spell was cast using teamwork, it deals 4 damage to that creature instead.',
      'Helicarrier Strike',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps.some((step) => step.kind === 'conditional' || step.kind === 'deal_damage')).toBe(true);
  });

  it('strips a trailing Reinforce keyword so reminder add-counter is not a spell step', () => {
    const ir = parseOracleTextToIR(
      'Destroy target creature with flying. Reinforce 2-{2}{G} ({2}{G}, Discard this card: Put two +1/+1 counters on target creature.)',
      'Fowl Strike',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.map((step) => step.kind)).toContain('destroy');
    expect(steps.some((step) => step.kind === 'add_counter')).toBe(false);
  });

  it('normalizes Devoid off an exile target before matching', () => {
    expect(normalizeExileTargetReferenceText('Devoid Exile target nonbasic land').toLowerCase()).toBe(
      'target nonbasic land',
    );
  });

  it('parses choose-up-to-that-many modal bullets as choose_mode', () => {
    const ir = parseOracleTextToIR(
      'Choose up to that many — • Net — Target creature can\'t block this turn. • Explosive — Hawkeye deals 2 damage to target player. • Boomerang — Discard a card, then draw a card.',
      'Hawkeye, Master Marksman',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.map((step) => step.kind)).toEqual(['choose_mode']);
  });

  it('treats GY exile with time counters as a suspend rider, not a GY filter', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target nonland card from your graveyard with two time counters on it',
      }),
    ).toEqual(expect.objectContaining({ cardType: 'nonland' }));
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target nonland card from your graveyard with two time counters on it',
      })?.requiredCounter,
    ).toBeUndefined();
  });

  it('parses a random card exiled with it and up-to from among revealed cards', () => {
    expect(
      parseMoveZoneSingleCardExiledWithIt({ kind: 'raw', text: 'a card exiled with it at random' }),
    ).toBe(true);
    expect(
      parseMoveZoneUpToTypedCardsFromAmongThem({
        kind: 'raw',
        text: 'up to two creature cards from among the revealed cards',
      }),
    ).toEqual({ maxCount: 2, cardType: 'creature' });
  });
});
