import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { categorizeSpell, resolveSpell, type TargetRef } from '../src/rules-engine/targeting.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';

const INCREASING_CONFUSION_ORACLE =
  'Target player mills X cards. If this spell was cast from a graveyard, that player mills twice that many cards instead.\nFlashback {X}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)';

function hydrateIncreasingConfusionMillCount(
  spec: ReturnType<typeof categorizeSpell>,
  xValue: number,
  castFromGraveyard: boolean,
): number {
  let millCount = spec?.millCountIsX ? xValue : Number(spec?.millCount ?? 0);
  if (spec?.millCountDoubleIfCastFromGraveyard && castFromGraveyard && millCount > 0) {
    millCount *= 2;
  }
  return millCount;
}

describe('Increasing Confusion', () => {
  it('parses oracle IR as target_player mill X', () => {
    const ir = parseOracleTextToIR(INCREASING_CONFUSION_ORACLE, 'Increasing Confusion');
    const steps = ir.abilities?.[0]?.steps ?? [];
    expect(steps[0]).toMatchObject({
      kind: 'mill',
      who: { kind: 'target_player' },
      amount: { kind: 'x' },
    });
  });

  it('categorizes as MILL_TARGET_PLAYER with graveyard double rider', () => {
    const spec = categorizeSpell('Increasing Confusion', INCREASING_CONFUSION_ORACLE);
    expect(spec?.op).toBe('MILL_TARGET_PLAYER');
    expect(spec?.millCountIsX).toBe(true);
    expect(spec?.millCountDoubleIfCastFromGraveyard).toBe(true);
    expect(spec?.minTargets).toBe(1);
  });

  it('mills X from hand and twice X on flashback', () => {
    const spec = categorizeSpell('Increasing Confusion', INCREASING_CONFUSION_ORACLE);
    expect(hydrateIncreasingConfusionMillCount(spec, 3, false)).toBe(3);
    expect(hydrateIncreasingConfusionMillCount(spec, 2, true)).toBe(4);
  });

  it('mills X for the chosen target when resolved with spell X', () => {
    const g = createInitialGameState('increasing_confusion_mill_x');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.importDeckResolved(p2, [
      { id: 'c1', name: 'Card 1', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c2', name: 'Card 2', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c3', name: 'Card 3', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c4', name: 'Card 4', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c5', name: 'Card 5', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c6', name: 'Card 6', type_line: 'Instant', oracle_text: '' } as any,
    ]);

    const spec = categorizeSpell('Increasing Confusion', INCREASING_CONFUSION_ORACLE);
    const millFromHand = hydrateIncreasingConfusionMillCount(spec, 3, false);
    const hydrated = { ...(spec as any), millCount: millFromHand };
    const effects = resolveSpell(hydrated as any, [{ kind: 'player', id: p2 } as TargetRef], g.state as any, p1);
    expect(effects).toEqual([{ kind: 'MillCards', playerId: p2, count: 3 }]);

    const beforeLib = g.state.zones?.[p2]?.libraryCount ?? 0;
    const beforeGy = g.state.zones?.[p2]?.graveyardCount ?? 0;

    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'increasing_confusion',
      spec: hydrated,
      chosen: [{ kind: 'player', id: p2 } as TargetRef],
    });

    expect(g.state.zones?.[p2]?.libraryCount).toBe(beforeLib - 3);
    expect(g.state.zones?.[p2]?.graveyardCount).toBe(beforeGy + 3);
  });
});
