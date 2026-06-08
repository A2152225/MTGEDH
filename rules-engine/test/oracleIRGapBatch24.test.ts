import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { parseTriggeredAbilitiesFromText } from '../src/triggeredAbilitiesParsing';

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

describe('Oracle IR gap batch 24 support', () => {
  it('parses draw-an-additional-card quantities without unknown amount tails', () => {
    const additional = parseOracleTextToIR('that player draws an additional card', 'Well of Ideas');
    const twoAdditional = parseOracleTextToIR('At the beginning of your draw step, draw two additional cards.', 'Font of Mythos');

    expect(collectUnknowns(additional)).toEqual([]);
    expect(additional.abilities[0]?.steps[0]).toMatchObject({
      kind: 'draw',
      amount: { kind: 'number', value: 1 },
    });
    expect(collectUnknowns(twoAdditional)).toEqual([]);
    expect(twoAdditional.abilities[0]?.steps[0]).toMatchObject({
      kind: 'draw',
      amount: { kind: 'number', value: 2 },
    });
  });

  it('parses delayed next-turn upkeep draw clauses', () => {
    const delayed = parseOracleTextToIR("draw a card at the beginning of the next turn's upkeep", 'Ritual of Steel');
    expect(collectUnknowns(delayed)).toEqual([]);
    expect(delayed.abilities[0]?.steps[0]).toMatchObject({
      kind: 'schedule_delayed_trigger',
      timing: 'next_upkeep',
      effect: 'draw a card',
    });
  });

  it('parses player lose-game and keyword metadata fragments', () => {
    const phage = parseOracleTextToIR('that player loses the game', 'Phage the Untouchable');
    const seek = parseOracleTextToIR('seek a nonland card', 'Spirited Simulacrum');
    const dredge = parseOracleTextToIR('dredge 2', 'Golgari Brownscale');
    const augment = parseOracleTextToIR('augment {3}{w}', 'Humming-');

    expect(collectUnknowns(phage)).toEqual([]);
    expect(phage.abilities[0]?.steps[0]).toMatchObject({ kind: 'lose_game' });
    expect(collectUnknowns(seek)).toEqual([]);
    expect(collectUnknowns(dredge)).toEqual([]);
    expect(collectUnknowns(augment)).toEqual([]);
  });

  it('does not emit bogus station/augment keyword triggers', () => {
    const station = parseTriggeredAbilitiesFromText('Station 10+ | Flying', 'SRC', 'P1', 'Rescue Skiff');
    const augment = parseTriggeredAbilitiesFromText('Whenever this creature attacks, augment {3}{w}', 'SRC', 'P1', 'Humming-');

    expect(station).toHaveLength(0);
    expect(augment.filter((t) => /^\s*augment\s+\{/i.test(t.condition || t.triggerFilter || ''))).toHaveLength(0);
    expect(augment.some((t) => t.event === 'attacks')).toBe(true);
  });
});
