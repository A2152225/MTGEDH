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

describe('Oracle IR gap batch 36 support (legal cards)', () => {
  it('parses legal-card trigger riders from batch 36 probes', () => {
    const samples = [
      'this creature crews vehicles as though its power were 2 greater',
      'the player gets another poison counter at the beginning of their next upkeep unless they pay {2} before that step',
      'until end of turn, whenever one or more gorgons and/or snakes you control deal combat damage to a player, that player loses half their life, rounded up',
      'twice that much',
      'then draw half x cards, rounded down',
      'target player can\'t cast spells until a player planeswalks',
      'this creature can block an additional creature each combat as long as you\'re the monarch',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });

  it('parses named legal-card trigger effects in card context', () => {
    const cards = [
      {
        name: 'Dragonfly Pilot',
        text: 'when dragonfly pilot enters the battlefield, this creature crews vehicles as though its power were 2 greater.',
      },
      {
        name: 'Sabertooth Cobra',
        text: 'when sabertooth cobra deals damage to a player, that player gets a poison counter. the player gets another poison counter at the beginning of their next upkeep unless they pay {2} before that step.',
      },
      {
        name: 'Icingdeath, Frost Tyrant',
        text: 'when icingdeath, frost tyrant dies, create icingdeath, frost tongue, a legendary white equipment artifact token with "equipped creature gets +2/+0," "whenever equipped creature attacks, tap target creature defending player controls," and equip {2}.',
      },
    ];
    for (const card of cards) {
      expect(collectUnknowns(parseOracleTextToIR(card.text, card.name)), card.name).toEqual([]);
    }
  });
});
