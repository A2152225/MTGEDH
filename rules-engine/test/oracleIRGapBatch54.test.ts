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

describe('Oracle IR gap batch 54 rules text, tokens, and joke pruning', () => {
  it('clears un-set rules text, token creates, and compound trigger tails', () => {
    const cards = [
      'Mobile Clone',
      'Zyym, Mesmeric Lord',
      'You and Ooze Army?',
      'May the Mana Be with You',
      'Spice Rack',
      'Try-My-Deck Elemental',
      'Uh, Squen & Cragg Made a Card',
      'Lost in Memories',
      'Saga of Krark Losing His Thumb',
      'Glimpse, the Unthinkable',
      'Agoraphobic Phyrexian',
      'Groaaaaag, Hungry Monster',
      'Queue of Beetles',
      'All-You-Can-Eat Buffet',
      'Disguise Agent',
      'Falko, Showoff Pilot',
      'Merfolk Surveyor',
      'Pulse of the Hunter Maze',
    ];

    for (const name of cards) {
      const card = lookupLocalCardByNameSync(name);
      expect(card?.oracle_text, name).toBeTruthy();
      expect(collectUnknowns(parseOracleTextToIR(String(card!.oracle_text), name)), name).toEqual([]);
    }
  });
});
