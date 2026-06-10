/**
 * Seam: draw instead / draw-if / damage-draw-gain-life / draw+gain control
 * Corridor: P1 + T1 (trigger execute)
 * Audits: oracle-ir-gap-audit.ts, npm run executor:coverage
 */
import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { parseTriggeredAbilitiesFromText } from '../src/triggeredAbilitiesParsing';
import { dryRunOracleSteps } from '../../server/scripts/executor-coverage-audit';

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
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return unknowns.filter(Boolean);
}

function unknownAmounts(value: unknown): string[] {
  const bad: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as { kind?: string; amount?: { kind?: string; raw?: string } };
    if (record.amount?.kind === 'unknown') bad.push(String(record.amount.raw ?? record.kind ?? ''));
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return bad;
}

describe('Oracle IR gap batch 47 — draw instead, draw-if, compounds', () => {
  it('parses draw N cards instead inside conditionals', () => {
    const text = 'Draw two cards. If this spell was kicked, draw three cards instead.';
    const ir = parseOracleTextToIR(text, 'Field Research');
    expect(collectUnknowns(ir)).toEqual([]);
    expect(unknownAmounts(ir)).toEqual([]);
    const conditional = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'conditional') as any;
    expect(conditional?.steps?.[0]?.amount).toEqual({ kind: 'number', value: 3 });
  });

  it('parses draw three cards if condition as conditional draw', () => {
    const text = 'When Inga Rune-Eyes dies, draw three cards if three or more creatures died this turn.';
    const ir = parseOracleTextToIR(text, 'Inga Rune-Eyes');
    expect(collectUnknowns(ir)).toEqual([]);
    expect(unknownAmounts(ir)).toEqual([]);
    const conditional = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'conditional') as any;
    expect(conditional?.condition?.raw).toMatch(/three or more creatures died/i);
    expect(conditional?.steps?.[0]).toMatchObject({ kind: 'draw', amount: { kind: 'number', value: 3 } });
  });

  it('splits Niv-Mizzet damage, draw, and gain life with shared where-X', () => {
    const triggers = parseTriggeredAbilitiesFromText(
      'Flying, hexproof from multicolored\nWhenever Niv-Mizzet deals combat damage to a player, it deals X damage to any target, target player draws X cards, and you gain X life, where X is the number of different color pairs among permanents you control that are exactly two colors.',
      'Legendary Creature — Dragon Wizard',
    );
    const effect = triggers.find((t) => t.event === 'deals_combat_damage_to_player')?.effect ?? '';
    const ir = parseOracleTextToIR(effect, 'Niv-Mizzet, Guildpact');
    expect(collectUnknowns(ir)).toEqual([]);
    expect(unknownAmounts(ir)).toEqual([]);
    const kinds = ir.abilities.flatMap((a) => a.steps).map((s) => s.kind);
    expect(kinds).toEqual(['deal_damage', 'draw', 'gain_life']);
  });

  it('splits Coveted Jewel draw and gain control', () => {
    const text =
      "Whenever one or more creatures an opponent controls attack you and aren't blocked, that player draws three cards and gains control of this artifact. Untap it.";
    const ir = parseOracleTextToIR(text, 'Coveted Jewel');
    expect(collectUnknowns(ir)).toEqual([]);
    expect(unknownAmounts(ir)).toEqual([]);
    const steps = ir.abilities.flatMap((a) => a.steps);
    expect(steps.map((s) => s.kind)).toContain('draw');
    expect(steps.map((s) => s.kind)).toContain('gain_control');
  });

  it('dry-runs Inga and Coveted Jewel trigger effects without parse→execute gaps', () => {
    const ingaEffect = 'draw three cards if three or more creatures died this turn.';
    const ingaIr = parseOracleTextToIR(ingaEffect, 'Inga Rune-Eyes');
    const ingaSteps = ingaIr.abilities.flatMap((a) => a.steps);
    expect(dryRunOracleSteps(ingaSteps, 'Inga Rune-Eyes', []).status).toBe('fully_applied');

    const covetedEffect = 'that player draws three cards and gains control of this artifact. untap it.';
    const covetedIr = parseOracleTextToIR(covetedEffect, 'Coveted Jewel');
    const covetedSteps = covetedIr.abilities.flatMap((a) => a.steps);
    expect(dryRunOracleSteps(covetedSteps, 'Coveted Jewel', []).status).toBe('fully_applied');
  });
});
