import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { isSingularBattlefieldTargetText } from '../src/oracleIRExecutorBattlefieldSingularTargetText';
import { resolveRevealUntilReferenceAmountForPlayer } from '../src/oracleIRExecutorPlayerUtils';

// Jace, Multiverse Architect -3 (issues #5 / #6).
const JACE_MINUS_THREE =
  'Exile another target planeswalker or creature you control. Reveal cards from the top of your library until you reveal a creature or planeswalker card. Put that card onto the battlefield and the rest on the bottom of your library in a random order.';

const token = (id: string, name: string) => ({
  id, controller: 'p1', owner: 'p1', isToken: true,
  card: { id, name, type_line: `Token Creature \u2014 ${name}`, power: '2', toughness: '2' },
});

function jaceState(library: any[]): any {
  return {
    players: [{ id: 'p1', name: 'P1', life: 40, library }, { id: 'p2', name: 'P2', life: 40 }],
    battlefield: [
      { id: 'jace', controller: 'p1', owner: 'p1', card: { id: 'jace', name: 'Jace, Multiverse Architect', type_line: 'Legendary Planeswalker \u2014 Jace' } },
      token('shark_a', 'Shark'), token('shark_b', 'Shark'), token('spirit_a', 'Spirit'),
    ],
    stack: [], zones: {}, turnPlayer: 'p1',
  };
}

describe('Jace, Multiverse Architect -3 executor', () => {
  it('treats "another target ..." as a single bound target, not a mass selector', () => {
    expect(isSingularBattlefieldTargetText('another target planeswalker or creature you control')).toBe(true);
    expect(isSingularBattlefieldTargetText('target creature')).toBe(true);
    expect(isSingularBattlefieldTargetText('another creature you control')).toBe(false);
    expect(isSingularBattlefieldTargetText('all creatures')).toBe(false);
  });

  it('reveals until the first card matching either type of "creature or planeswalker card"', () => {
    const state = jaceState([
      { id: 'l0', name: 'Sorcery', type_line: 'Sorcery' },
      { id: 'l1', name: 'Land', type_line: 'Land' },
      { id: 'l2', name: 'Walker', type_line: 'Legendary Planeswalker \u2014 Jace' },
      { id: 'l3', name: 'Bear', type_line: 'Creature \u2014 Bear' },
    ]);
    const result = resolveRevealUntilReferenceAmountForPlayer(state, 'p1' as any, {
      kind: 'reference_amount', raw: 'until you reveal a creature or planeswalker card',
    } as any);
    expect(result?.count).toBe(3);
  });

  it('exiles only the targeted token and puts the revealed creature onto the battlefield', () => {
    const steps = parseOracleTextToIR(JACE_MINUS_THREE, 'Jace, Multiverse Architect').abilities.flatMap((ability: any) => ability.steps);
    const state = jaceState([
      { id: 'l0', name: 'Sorcery', type_line: 'Sorcery' },
      { id: 'l1', name: 'Bear Cub', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2' },
      { id: 'l2', name: 'Other', type_line: 'Sorcery' },
    ]);
    const result: any = applyOracleIRStepsToGameState(state, steps as any, {
      controllerId: 'p1', sourceId: 'jace', sourceName: 'Jace, Multiverse Architect',
      targetPermanentId: 'shark_a', selectorContext: { targetPermanentId: 'shark_a' },
    } as any);

    const battlefieldIds = result.state.battlefield.map((perm: any) => String(perm.card?.id || perm.id));
    expect(battlefieldIds).not.toContain('shark_a');
    expect(battlefieldIds).toEqual(expect.arrayContaining(['jace', 'shark_b', 'spirit_a', 'l1']));
    const libraryIds = (result.state.players.find((p: any) => p.id === 'p1').library || []).map((card: any) => card.id);
    expect(libraryIds).toEqual(['l2', 'l0']);
  });
});