import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor';
import { resolveDelayedCombatHistorySelector } from '../src/state/modules/triggers/delayedCombatHistorySelectors';

describe('round 27 Triton Tactics delayed rider', () => {
  it('taps the creatures blocked by the targets and flags them doesntUntapNextTurn', () => {
    const bf: any[] = [
      { id: 'tr', controller: 'p1', blocking: ['a1'], card: { name: 'Merfolk', type_line: 'Creature' } },
      { id: 'a1', controller: 'p2', tapped: false, blockedBy: ['tr'], card: { name: 'Bear', type_line: 'Creature' } },
      { id: 'a2', controller: 'p2', tapped: false, card: { name: 'Elk', type_line: 'Creature' } },
    ];
    const eff = "Tap each creature that was blocked by one of those creatures this turn and it doesn't untap during its controller's next untap step.";
    const sel = resolveDelayedCombatHistorySelector(eff, ['tr'], bf)!;
    expect(sel.ids).toEqual(['a1']);
    const steps = parseOracleTextToIR(sel.effect, 'Triton Tactics').abilities[0].steps;
    const r: any = applyOracleIRStepsToGameState({ players: [{ id: 'p1' }, { id: 'p2' }], battlefield: bf } as any, steps, { controllerId: 'p1', sourceName: 'Triton Tactics', lastAntecedentBattlefieldPermanentIds: sel.ids } as any);
    const byId = (id: string) => r.state.battlefield.find((p: any) => p.id === id);
    expect(byId('a1').tapped).toBe(true);
    expect(byId('a1').doesntUntapNextTurn).toBe(true);
    expect(byId('a2').doesntUntapNextTurn).toBeUndefined();
    expect(byId('tr').doesntUntapNextTurn).toBeUndefined();
  });
});
