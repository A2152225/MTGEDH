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

describe('Oracle IR gap batch 58 rules text, fragments, and joke prune', () => {
  it('clears remaining phase-1 residual unknowns', () => {
    const cards = [
      'Need for Speed (Not the Odyssey One)',
      'Another Night in Vegas',
      'Titania, Rugged Rumbler',
      'Saffi Eriksdotter',
      'Adarkar Valkyrie',
      'Enroll in the Coalition',
      'The Snapstone Wielder',
      'Interrogation Robot',
      "Commander's Insight",
      'Thromok the Insatiable',
      'Surprise Party',
      'Exit Through the Grift Shop',
      'Segovian Sword',
      "Can't Quite Recall",
      'Cleaver Blow',
      'Power Play',
      'Form of the Approach of the Second Sun',
      'Abian, Luvion Usurper',
      'Dan, Shrewd Trader',
      'Slobad, Actually Just Fine',
      'Built Bear',
      'No-Regrets Egret',
      'Invasion Specialist',
      'Trigger Happy',
      'Taste of Paradise',
      'Blufferfish',
      'Stack of Paperwork',
      'Spuzzem Strategist',
      'Darkpact',
      'Phyrexian Seedling',
      'Devoted Mardu',
      'Avizoa',
      "Garruk's Horde",
      'Byode, Inverse Sun',
      'Tax Bolt',
      'Tax Draw',
      'Advantageous Proclamation',
      'Quest Compleated Beast',
      'Gomif, Fast Racer',
    ];

    for (const name of cards) {
      const card = lookupLocalCardByNameSync(name);
      expect(card?.oracle_text, name).toBeTruthy();
      expect(collectUnknowns(parseOracleTextToIR(String(card!.oracle_text), name)), name).toEqual([]);
    }
  });
});
