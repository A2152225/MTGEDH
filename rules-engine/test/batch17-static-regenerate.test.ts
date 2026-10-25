import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { hasStaticRegenerateInsteadOfDestroy } from '../src/staticRegenerateInsteadOfDestroy';

const p1 = 'p1' as PlayerID;
const knight = (extra: Record<string, unknown> = {}) => ({
  id: 'knight', controller: p1, owner: p1, tapped: false, markedDamage: 2, attacking: 'p2',
  card: { name: 'Knight of the Holy Nimbus', type_line: 'Creature', oracle_text: 'Flanking\nIf this creature would be destroyed, regenerate it.' },
  ...extra,
});

function destroyAll(battlefield: any[]) {
  const ir = parseOracleTextToIR('Destroy all creatures.', 'Wrath Test');
  const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'destroy');
  expect(step).toBeTruthy();
  return applyOracleIRStepsToGameState({ players: [{ id: p1 }, { id: 'p2' }], battlefield } as unknown as GameState, [step!], { controllerId: p1, sourceId: 'src' } as any, { allowOptional: true });
}

describe('Batch 17: static regenerate-instead-of-destroy inside the rules-engine', () => {
  it('detects the static text and respects "can\'t be regenerated"', () => {
    expect(hasStaticRegenerateInsteadOfDestroy(knight())).toBe(true);
    expect(hasStaticRegenerateInsteadOfDestroy(knight({ cantBeRegenerated: true }))).toBe(false);
    expect(hasStaticRegenerateInsteadOfDestroy({ card: { name: 'Bear', oracle_text: '' } })).toBe(false);
  });

  it('a resolving destroy regenerates Knight of the Holy Nimbus and destroys others', () => {
    const res = destroyAll([knight(), { id: 'bear', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature', oracle_text: '' } }]);
    const bf = ((res.state as any).battlefield || []) as any[];
    const k = bf.find((p) => p.id === 'knight');
    expect(k).toBeTruthy();
    expect(k.tapped).toBe(true);
    expect(k.markedDamage).toBe(0);
    expect(k.attacking).toBeUndefined();
    expect(bf.some((p) => p.id === 'bear')).toBe(false);
  });

  it('is destroyed when it can\'t be regenerated this turn', () => {
    const res = destroyAll([knight({ cantBeRegeneratedThisTurn: true })]);
    expect(((res.state as any).battlefield || []).some((p: any) => p.id === 'knight')).toBe(false);
  });
});