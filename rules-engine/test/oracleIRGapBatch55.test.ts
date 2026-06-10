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

describe('Oracle IR gap batch 55 then tails, rules text, and joke pruning', () => {
  it('clears orphan Then connectors, un-set rules text, and reminder tails', () => {
    const cards = [
      'Gerrard and Hanna',
      'Life at Stake',
      'Problematic Volcano',
      'Identify the Culprit',
      'Save Point',
      'Rafi, Retro Racer',
      'Oozeavite',
      'TL;DR',
      'Form of the Mulldrifter',
      'Afterlife from the Loam',
      'The Fearsome Flock',
      'The Strixhaven-Lorwyn Rover',
      'The Faction Dragon',
      'Hard Hat Area',
      'Shadowmoor Draw Spell',
      "At Least It's a Dry Heat",
      'Monet, Sensei of the Sewers',
      'Spectra Ward',
      'Benevolent Blessing',
      'Occupation of Llanowar',
      'The Miniaturizer',
      'Snapsail Rider',
    ];

    for (const name of cards) {
      const card = lookupLocalCardByNameSync(name);
      expect(card?.oracle_text, name).toBeTruthy();
      expect(collectUnknowns(parseOracleTextToIR(String(card!.oracle_text), name)), name).toEqual([]);
    }
  });
});
