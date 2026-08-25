import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { tryParseEachPlayerChooseThenDestroyRest } from '../src/oracleIRParserEachPlayerChooseDestroyRest';
import { tryParseMayCastFromAmong } from '../src/oracleIRParserMayCastFromAmong';
import { tryParseSecretOpponentChoiceDamage } from '../src/oracleIRParserSecretOpponentChoiceDamage';

const identity = <T,>(step: T): T => step;

describe('Phase 4 leftover choice-family parsers', () => {
  it('parses Divine Reckoning choose-then-destroy-rest from corpus oracle', () => {
    const step = tryParseEachPlayerChooseThenDestroyRest({
      clause: 'Each player chooses a creature they control. Destroy the rest.',
      rawClause: 'Each player chooses a creature they control. Destroy the rest.',
      withMeta: identity,
    });
    expect(step).toMatchObject({
      kind: 'each_player_choose_then_destroy_rest',
      keepTypes: ['creature'],
      keepCount: 1,
    });
  });

  it('parses Prisoner\'s Dilemma secret damage matrix from corpus oracle', () => {
    const text =
      "Each opponent secretly chooses silence or snitch, then the choices are revealed. If each opponent chose silence, Prisoner's Dilemma deals 4 damage to each of them. If each opponent chose snitch, Prisoner's Dilemma deals 8 damage to each of them. Otherwise, Prisoner's Dilemma deals 12 damage to each opponent who chose silence.";
    const step = tryParseSecretOpponentChoiceDamage({
      clause: text,
      rawClause: text,
      withMeta: identity,
    });
    expect(step).toMatchObject({
      kind: 'secret_opponent_choice_damage',
      choices: ['silence', 'snitch'],
      allFirstDamage: 4,
      allSecondDamage: 8,
      mixedFirstDamage: 12,
    });
  });

  it('parses mill-from-among may-cast without granting graveyard permission', () => {
    const step = tryParseMayCastFromAmong({
      clause: 'You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost.',
      rawClause: 'You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost.',
      withMeta: identity,
    });
    expect(step).toMatchObject({
      kind: 'may_cast_from_among',
      among: 'milled_this_way',
      cardTypes: ['instant', 'sorcery'],
      maxManaValue: { kind: 'x' },
    });
  });

  it('does not emit a standalone destroy for Divine Reckoning full-card IR', () => {
    const ir = parseOracleTextToIR(
      'Each player chooses a creature they control. Destroy the rest.\nFlashback {5}{W}{W} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
      'Divine Reckoning',
    );
    const kinds = ir.abilities.flatMap((ability) => ability.steps.map((step) => step.kind));
    expect(kinds).toContain('each_player_choose_then_destroy_rest');
    expect(kinds).not.toContain('destroy');
  });
});
