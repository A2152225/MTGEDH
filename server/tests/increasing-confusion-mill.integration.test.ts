import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { categorizeSpellWithoutPrimaryRetirement as categorizeSpell, resolveSpell, type TargetRef } from '../src/rules-engine/targeting.js';
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

  it('MILL_TARGET_PLAYER resolveSpell is deleted (P1a; hydration still computes mill count for IR/cast)', () => {
    const g = createInitialGameState('increasing_confusion_mill_x');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    const spec = categorizeSpell('Increasing Confusion', INCREASING_CONFUSION_ORACLE);
    const millFromHand = hydrateIncreasingConfusionMillCount(spec, 3, false);
    const hydrated = { ...(spec as any), millCount: millFromHand };
    expect(millFromHand).toBe(3);
    expect(resolveSpell(hydrated as any, [{ kind: 'player', id: p2 } as TargetRef], g.state as any, p1)).toEqual([]);
  });
});
