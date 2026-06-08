import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function collectUnknowns(value: unknown): string[] {
  const unknowns: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as { kind?: string }).kind === 'unknown') {
      unknowns.push(String((node as { raw?: string }).raw ?? ''));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'raw' || key === 'text' || key === 'effectText') continue;
      walk(child);
    }
  };
  walk(value);
  return unknowns.filter(Boolean);
}

describe('Oracle IR gap batch 39 support (legal cards)', () => {
  it('parses nested discard and damage quantity fragments', () => {
    const mindMaggots = parseOracleTextToIR(
      'discard any number of creature cards. for each card discarded this way, put two +1/+1 counters on this creature.',
      'Mind Maggots'
    );
    const anthem = parseOracleTextToIR(
      'whenever a source you control deals damage to a permanent or player, it deals double that damage to that permanent or player instead',
      'Anthem of Rakdos'
    );

    expect(collectUnknowns(mindMaggots)).toEqual([]);
    expect(collectUnknowns(anthem)).toEqual([]);
  });

  it('clears nested quantity and residual static riders from batch 40 fixes', () => {
    const samples = [
      'draw a card. enchanted creature has protection from creatures.',
      'then discard two cards unless you discard a pirate card',
      'you gain life equal to the life you lost when it entered',
      'put the same number of each kind of counter on that creature',
      'the player with the lowest life total gains control of this creature',
      'scry 1.")',
      'you and target opponent each reveal the top card of your library. you each put the card you revealed into your hand.',
      'body thief — you may play lands and cast spells from among cards exiled with this creature',
      '5, or 6, create two 0/1 colorless eldrazi spawn creature tokens with "Sacrifice this token: Add {C}."',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });

  it('lowers broad residual trigger riders via batch 39 fallbacks', () => {
    const samples = [
      'then behold a dragon',
      'that player may sacrifice a permanent of their choice',
      'you may cast creature spells with mana value 3 or less by paying {e} rather than paying their mana costs',
      'until they exile two nonland cards with mana value 4 or less',
      'this ability triggers only if this permanent is on the battlefield or if this permanent is in your graveyard and you control a giant',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
