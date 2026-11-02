/**
 * Assimilate (trk) on a battlefield creature: after the gain_control step resolves, put a +1/+1 counter on
 * each newly controlled permanent and make it a Borg artifact creature; remember it on the source (Borg Sagas:
 * "the Borg assimilated with this Saga").
 * R32: applyAssimilateAfterMoveZone links cards assimilated from other zones (graveyard/exile/revealed) too.
 * Public entry symbols: applyAssimilateAfterGainControl, applyAssimilateAfterMoveZone.
 */
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { assimilateBattlefieldPermanents, recordAssimilatedWithSource } from './trekCountBases';

export function applyAssimilateAfterGainControl<R>(result: R, step: any, ctx: OracleIRExecutionContext): R {
  const r: any = result;
  if (!step?.assimilate || !r || r.applied !== true || !r.state) return result;
  const fromResult: string[] = Array.isArray(r.lastAntecedentBattlefieldPermanentIds) ? r.lastAntecedentBattlefieldPermanentIds : [];
  const fallback = String((ctx as any)?.targetPermanentId || (ctx as any)?.targetCreatureId || '').trim();
  const ids = (fromResult.length > 0 ? fromResult : fallback ? [fallback] : []).map(id => String(id || '').trim()).filter(Boolean);
  if (ids.length === 0) return result;
  const state = assimilateBattlefieldPermanents(r.state, ids, String((ctx as any)?.sourceId || '').trim() || undefined);
  return { ...r, state, log: [...(Array.isArray(r.log) ? r.log : []), `Assimilated ${ids.join(', ')}`] } as R;
}

export function applyAssimilateAfterMoveZone<R>(result: R, step: any, ctx: OracleIRExecutionContext): R {
  const r: any = result;
  if (!step?.battlefieldAssimilate || !r || r.applied !== true || !r.state) return result;
  const ids: string[] = (Array.isArray(r.lastMovedBattlefieldPermanentIds) ? r.lastMovedBattlefieldPermanentIds : [])
    .map((id: unknown) => String(id || '').trim()).filter(Boolean);
  if (ids.length === 0) {
    // Nothing was assimilated: report it as impossible so "If you can't, ..." (Borg Cube) can fire.
    const moved = [r.lastMovedCards, r.movedCards].some((list: any) => Array.isArray(list) && list.length > 0);
    if (moved) return result;
    return { applied: false, message: 'Skipped assimilate (no card could be assimilated): ' + String(step?.raw || ''), reason: 'impossible_action' } as any;
  }
  const sourceId = String((ctx as any)?.sourceId || '').trim() || undefined;
  const want = new Set(ids);
  const battlefield = ((r.state as any).battlefield || []).map((p: any) => {
    if (!want.has(String(p?.id || ''))) return p;
    const printedTypeLine = String(p?.card?.assimilatedPrintedTypeLine || p?.card?.type_line || '');
    return { ...p, assimilated: { printedTypeLine, ...(sourceId ? { sourceId } : {}) }, ...(sourceId ? { assimilatedBySourceId: sourceId } : {}) };
  });
  const state = recordAssimilatedWithSource({ ...(r.state as any), battlefield }, sourceId, ids);
  return { ...r, state } as R;
}
