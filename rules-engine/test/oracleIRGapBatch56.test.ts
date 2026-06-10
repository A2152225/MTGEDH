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

describe('Oracle IR gap batch 56 then tails, fragments, and reminder pruning', () => {
  it('clears rules text, compound draw tails, threshold grants, and joke reminders', () => {
    const cards = [
      'Control Win Condition',
      'Manifest Dread',
      "Sovereign's Realm",
      'Deep Dish Pizza',
      'Pore Over the Pages',
      'Vuzzle Spaceship',
      "Mavinda, Students' Advocate",
      'Kindle the Inner Flame',
      'Guardian of the Forgotten',
      'Patrolling Peacemaker',
      'Planeswalkerificate',
      "Fluros of Myra's Marvels",
      'Irrefutable Evidence',
      'The Multiplayer Nitpickers',
      'The Weekly Princess',
      'Flavor Disaster',
      'Optimus Prime, Inspiring Leader',
      'Skullscorch',
      'Cephalid Sage',
      'Evil Boros Charm',
      'Wrath of Oko',
      'Snapsail Rider',
      'Benevolent Blessing',
    ];

    for (const name of cards) {
      const card = lookupLocalCardByNameSync(name);
      expect(card?.oracle_text, name).toBeTruthy();
      expect(collectUnknowns(parseOracleTextToIR(String(card!.oracle_text), name)), name).toEqual([]);
    }
  });
});
