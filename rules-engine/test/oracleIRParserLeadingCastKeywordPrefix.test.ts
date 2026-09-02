import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { stripLeadingCastKeywordPrefix, stripTrailingCastKeywordSuffix } from '../src/oracleIRParserLeadingCastKeywordPrefix.js';
import { normalizeClauseForParse } from '../src/oracleIRParserUtils.js';

describe('leading cast-keyword prefix strip', () => {
  it('strips Delve glued onto a sacrifice instruction', () => {
    expect(stripLeadingCastKeywordPrefix('Delve Target player sacrifices two creatures of their choice')).toBe(
      'Target player sacrifices two creatures of their choice',
    );
  });

  it('strips Suspend N—cost glued onto a shuffle instruction', () => {
    const stripped = normalizeClauseForParse(
      'Suspend 3-{R}{R} Shuffle all permanents you own into your library',
    ).clause;
    expect(stripped.toLowerCase().startsWith('shuffle all permanents')).toBe(true);
  });

  it('parses Spree multi-symbol mode costs', () => {
    expect(normalizeClauseForParse('+ {1}{U} - Counter target spell').clause.toLowerCase()).toBe(
      'counter target spell',
    );
  });

  it('clears a leftover standalone Epic keyword', () => {
    expect(stripLeadingCastKeywordPrefix('Epic')).toBe('');
  });

  it('parses Convoke glued onto prevent-all-combat after reminder stripping', () => {
    const parsed = parseOracleTextToIR(
      'Convoke Prevent all combat damage that would be dealt this turn.',
      'Pause for Reflection',
    );
    const kinds = parsed.abilities.flatMap((ability) => (ability.steps || []).map((step) => step.kind));
    expect(kinds).toContain('prevent_damage');
    expect(kinds).not.toContain('unknown');
  });

  it('parses Storm glued onto proliferate after reminder stripping', () => {
    const parsed = parseOracleTextToIR('Storm Proliferate.', 'Radstorm');
    const kinds = parsed.abilities.flatMap((ability) => (ability.steps || []).map((step) => step.kind));
    expect(kinds).toContain('proliferate');
    expect(kinds).not.toContain('unknown');
  });

  it('strips Convoke reminder plus following instruction', () => {
    const stripped = normalizeClauseForParse(
      'Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature\'s color.) Draw two cards.',
    ).clause;
    expect(stripped.toLowerCase().startsWith('draw two cards')).toBe(true);
  });

  it('strips Freerunning cost and reminder before an instruction', () => {
    expect(
      stripLeadingCastKeywordPrefix(
        'Freerunning {1}{B} (You may cast this spell for its freerunning cost if you dealt combat damage to a player this turn with an Assassin or commander.) Draw three cards',
      ).toLowerCase(),
    ).toBe('draw three cards');
  });

  it('strips Undaunted and Ascend reminders before bounce/draw', () => {
    expect(
      stripLeadingCastKeywordPrefix(
        'Undaunted (This spell costs {1} less to cast for each opponent.) Return up to two target cards from your graveyard to your hand',
      ).toLowerCase().startsWith('return up to two'),
    ).toBe(true);
    expect(
      stripLeadingCastKeywordPrefix(
        'Ascend (If you control ten or more permanents, you get the city\'s blessing for the rest of the game.) Draw two cards',
      ).toLowerCase(),
    ).toBe('draw two cards');
  });

  it('clears a leftover Cycling sacrifice cost', () => {
    expect(stripLeadingCastKeywordPrefix('Cycling—Sacrifice a land')).toBe('');
  });

  it('parses commander-storm copy after When you cast this spell', () => {
    const ir = parseOracleTextToIR(
      "When you cast this spell, copy it for each time you've cast your commander from the command zone this game. Each opponent sacrifices a creature of their choice.",
      'Skull Storm',
    );
    const kinds = ir.abilities.flatMap((ability) => (ability.steps || []).map((step) => step.kind));
    expect(kinds).toContain('copy_spell');
    expect(kinds).toContain('sacrifice');
    expect(kinds).not.toContain('unknown');
  });

  it('parses Glimpse of Tomorrow after a Suspend prefix', () => {
    const parsed = parseOracleTextToIR(
      'Suspend 3-{R}{R} Shuffle all permanents you own into your library, then reveal that many cards from the top of your library.',
      'Glimpse of Tomorrow',
    );
    const kinds = parsed.abilities.flatMap((ability) => (ability.steps || []).map((step) => step.kind));
    expect(kinds.some((kind) => kind === 'move_zone' || kind === 'reveal_top' || kind === 'shuffle')).toBe(true);
    expect(kinds).not.toContain('unknown');
  });

  it('parses Infusion dash leftovers before a pump', () => {
    expect(
      stripLeadingCastKeywordPrefix('Infusion - You may choose new targets for the copy').toLowerCase(),
    ).toBe('you may choose new targets for the copy');
    expect(
      stripTrailingCastKeywordSuffix(
        'Until end of turn, target creature gets +1/+0 and gains trample and "Whenever this creature deals combat damage to a player, draw a card." Flashback {2}{R}{G}',
      ).toLowerCase().includes('flashback'),
    ).toBe(false);
  });

  it('strips Kicker cost leftovers before a targeting instruction', () => {
    expect(
      stripLeadingCastKeywordPrefix(
        'Kicker {G} Target creature can\'t be the target of spells or abilities your opponents control this turn',
      ).toLowerCase().startsWith('target creature'),
    ).toBe(true);
  });
});
