/**
 * Current (effective) power/toughness reader for Oracle IR execution.
 *
 * Fight (CR 701.14a), bite and "damage equal to its power" must use the creature's
 * current power: printed/base P/T, P/T counters, anthems/lords/equipment, until-end-of-turn
 * pumps and P/T-setting effects. The server injects `ctx.resolveCurrentPowerToughness`
 * (the same computation the battlefield P/T badge uses). Dry-run / audit callers fall back to
 * the rules-engine static-ability pass (calculateEffectivePT via getProcessedBattlefield).
 *
 * Public: readCurrentPower, readCurrentToughness
 * Leaf must not import oracleIR.ts or oracleIRExecutor.ts.
 */
import type { GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  getProcessedBattlefield,
  readPermanentPower,
  readPermanentToughness,
} from './oracleIRExecutorCreatureStepUtils-handlers/oracleIRExecutorCreatureBattlefieldLookup';

function findBattlefieldPermanent(state: GameState, permanent: any): any | undefined {
  const id = String(permanent?.id || '').trim();
  if (!id) return undefined;
  return ((state?.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === id);
}

function readCurrentStat(
  state: GameState,
  permanent: any,
  ctx: OracleIRExecutionContext | undefined,
  stat: 'power' | 'toughness',
): number | null {
  if (!permanent) return null;
  const read = stat === 'power' ? readPermanentPower : readPermanentToughness;
  const onBattlefield = findBattlefieldPermanent(state, permanent);
  // Graveyard / last-known snapshots keep whatever they recorded.
  if (!onBattlefield) return read(permanent);

  const resolver = ctx?.resolveCurrentPowerToughness;
  if (typeof resolver === 'function') {
    try {
      const current = resolver(state, onBattlefield);
      const value = Number(current?.[stat]);
      if (Number.isFinite(value)) return value;
    } catch {
      // fall through to the rules-engine computation
    }
  }

  try {
    const processed = getProcessedBattlefield(state).find(
      (entry: any) => String(entry?.id || '').trim() === String(onBattlefield?.id || '').trim(),
    );
    if (processed) {
      const value = read(processed);
      if (value !== null) return value;
    }
  } catch {
    // fall through to the plain reader
  }
  return read(onBattlefield);
}

/** Current power of a permanent (battlefield: effective; otherwise recorded/printed). */
export function readCurrentPower(
  state: GameState,
  permanent: any,
  ctx?: OracleIRExecutionContext,
): number | null {
  return readCurrentStat(state, permanent, ctx, 'power');
}

/** Current toughness of a permanent (battlefield: effective; otherwise recorded/printed). */
export function readCurrentToughness(
  state: GameState,
  permanent: any,
  ctx?: OracleIRExecutionContext,
): number | null {
  return readCurrentStat(state, permanent, ctx, 'toughness');
}