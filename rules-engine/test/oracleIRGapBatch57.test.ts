import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { lookupLocalCardByNameSync } from '../../server/src/services/localCardLookup.ts';

function collectUnknowns(value: unknown): string[] {
  const unknowns: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as { kind?: string }).kind === 'unknown') {
      unknowns.push(String((node as { raw?: string }).raw ?? ''));
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

describe('Oracle IR gap batch 57 untap actions, quoted grants, and reminders', () => {
  it('clears untap steps, nested grant fragments, and keyword reminders', () => {
    const cards = [
      'Mathas, Fiend Seeker',
      "Ninja's Blades",
      'Hold for Ransom',
      'The Ash Lizard',
      'Besmirch',
      'Fancy Footwork',
      'Teferi, Who Slows the Sunset',
      'Ioreth of the Healing House',
      'Nimbleclaw Adept',
      'Magus of the Candelabra',
      'Synod Artificer',
      'Reality Spasm',
      "Mishra's Command",
      'Weaponized Scrap',
      "Who's That Praetor?",
      'Tchotchke Elemental',
      'The Keeper of Kaldra',
      'Tidewalker',
      'Out of Time',
    ];

    for (const name of cards) {
      const card = lookupLocalCardByNameSync(name);
      expect(card?.oracle_text, name).toBeTruthy();
      expect(collectUnknowns(parseOracleTextToIR(String(card!.oracle_text), name)), name).toEqual([]);
    }
  });
});
