/**
 * Seam: Draw X where X is … + quoted token delayed exile
 * Corridor: P1 (parser IR)
 * Audits: oracle-ir-gap-audit.ts, executor:coverage (full_card if activated)
 */
import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
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

describe('Oracle IR gap batch 46 — draw where-X and quoted token exile', () => {
  it('parses standalone Draw X cards, where X is … activated clauses', () => {
    const samples = [
      ['Intelligence Bobblehead', '{T}: Draw X cards, where X is the number of Bobbleheads you control.'],
      [
        "Liliana's Standard Bearer",
        'Draw X cards, where X is the greatest power among creatures you controlled as you cast this spell.',
      ],
      [
        'Sanctum of Calm Waters',
        'Draw X cards, where X is the number of card types among cards in your graveyard.',
      ],
    ] as const;

    for (const [name, text] of samples) {
      const ir = parseOracleTextToIR(text, name);
      expect(collectUnknowns(ir), name).toEqual([]);
      const draw = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'draw') as any;
      expect(draw?.amount).toEqual({ kind: 'x' });
      expect(draw?.whereX?.raw).toBeTruthy();
    }
  });

  it('preserves shared where-X on Disciple of Freyalise gain life + draw', () => {
    const text =
      "When this creature enters, you may sacrifice another creature. If you do, you gain X life and draw X cards, where X is that creature's power.";
    const ir = parseOracleTextToIR(text, 'Disciple of Freyalise');
    expect(collectUnknowns(ir)).toEqual([]);
    const conditional = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'conditional') as any;
    expect(conditional?.steps?.map((s: any) => s.kind)).toEqual(['gain_life', 'draw']);
    for (const step of conditional.steps) {
      expect(step.whereX?.raw).toBe("that creature's power");
    }
  });

  it('splits quoted token abilities from delayed exile followups', () => {
    const text =
      'create two 1/1 blue Faerie Spy creature tokens with flying, haste, and "Whenever this token deals combat damage to a player, draw a card." Exile them at the beginning of the next end step';
    const ir = parseOracleTextToIR(text, 'Faerie Aerie');
    expect(collectUnknowns(ir)).toEqual([]);
    const create = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'create_token') as any;
    expect(create?.atNextEndStep).toBe('exile');
    expect(ir.abilities.flatMap((a) => a.steps).some((s) => s.kind === 'schedule_delayed_trigger')).toBe(false);
  });

  it('dry-runs draw-where-X clauses without parse→execute gaps', () => {
    const record = dryRunOracleSteps(
      [
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'x' },
          whereX: { kind: 'where', raw: 'the number of Bobbleheads you control' },
          raw: 'Draw X cards, where X is the number of Bobbleheads you control',
        },
      ],
      'Intelligence Bobblehead',
      false,
      {
        typeLine: 'Artifact',
        auditContext: { bobbleheadCount: 3 },
      } as any
    );
    expect(record.status).toBe('fully_applied');
  });
});
