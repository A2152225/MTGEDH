// server/src/state/modules/replacementBatch92DiesReplacements.ts
// B92: Firestorm Phoenix (self would-die -> owner's hand; can't play until
// that player's next turn, play revealed) and Etching of Kumano (creature
// dealt damage this turn by a source you controlled would die -> exile).
// Public: parseBatch92DiesSentence, collectBatch92DiesReplacementSpecs,
// collectBatch92DiesReplacementSpecsFromState, creatureDamagedThisTurnByControllerSource.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const SELF_DIE_HAND_RE =
  /if (this creature|~) would die, return it to its owner's hand instead/i;
const DAMAGED_BY_YOU_EXILE_RE =
  /if a creature dealt damage this turn by a source you controlled would die, exile it instead/i;

export function parseBatch92DiesSentence(oracle: string): Array<{ kind: 'self-die-hand' } | { kind: 'damaged-by-you-exile' }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ kind: 'self-die-hand' } | { kind: 'damaged-by-you-exile' }> = [];
  if (SELF_DIE_HAND_RE.test(text)) out.push({ kind: 'self-die-hand' });
  if (DAMAGED_BY_YOU_EXILE_RE.test(text)) out.push({ kind: 'damaged-by-you-exile' });
  return out;
}

export function creatureDamagedThisTurnByControllerSource(state: any, objectId: string, sourceController: string): boolean {
  const oid = String(objectId || '').trim();
  const pid = String(sourceController || '').trim();
  if (!oid || !pid) return false;
  const byController = state?.creaturesDealtDamageByControllerSourcesThisTurn?.[pid];
  if (byController && (byController[oid] === true || (Array.isArray(byController) && byController.includes(oid)))) return true;
  const map = state?.creaturesDamagedByThisCreatureThisTurn;
  if (map && typeof map === 'object') {
    const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
    for (const [damagerId, damaged] of Object.entries(map as Record<string, any>)) {
      const damager = battlefield.find((p: any) => String(p?.id || '') === String(damagerId));
      if (!damager || String(damager.controller || '') !== pid) continue;
      if (damaged && typeof damaged === 'object' && damaged[oid]) return true;
      if (Array.isArray(damaged) && damaged.includes(oid)) return true;
    }
  }
  return false;
}

export function collectBatch92DiesReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const out: ReplacementEffectSpec[] = [];
  for (const entry of parseBatch92DiesSentence(oracle)) {
    if (entry.kind === 'self-die-hand') {
      out.push({
        id: `${source.sourcePermanentId}:self-die-return-hand-instead`,
        event: 'zone-change',
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: { sourceZone: 'battlefield', destinationZone: 'graveyard', objectIsSource: true },
        instead: { redirectZone: 'hand' },
        effectId: 'self-die-return-hand-instead',
        reason: 'self_die_return_hand_instead',
        metadata: {
          cantPlayUntilOwnersNextTurn: true,
          playRevealedInHand: true,
        },
      } as ReplacementEffectSpec);
    } else {
      out.push({
        id: `${source.sourcePermanentId}:damaged-by-controller-source-die-exile`,
        event: 'zone-change',
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: {
          sourceZone: 'battlefield',
          destinationZone: 'graveyard',
          objectTypeLineIncludes: 'creature',
        },
        instead: { redirectZone: 'exile' },
        effectId: 'damaged-by-controller-source-die-exile',
        reason: 'damaged_by_controller_source_die_exile',
        metadata: { requiresDamagedThisTurnByControllerSource: true, sourceController: source.sourceController },
      } as ReplacementEffectSpec);
    }
  }
  return out;
}

function damagedObjectIdsForController(state: any, sourceController: string): string[] {
  const ids = new Set<string>();
  const pid = String(sourceController || '');
  const byController = state?.creaturesDealtDamageByControllerSourcesThisTurn?.[pid];
  if (byController && typeof byController === 'object' && !Array.isArray(byController)) {
    for (const [oid, flag] of Object.entries(byController as Record<string, unknown>)) {
      if (flag) ids.add(oid);
    }
  } else if (Array.isArray(byController)) {
    for (const oid of byController) ids.add(String(oid));
  }
  const map = state?.creaturesDamagedByThisCreatureThisTurn;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (map && typeof map === 'object') {
    for (const [damagerId, damaged] of Object.entries(map as Record<string, any>)) {
      const damager = battlefield.find((p: any) => String(p?.id || '') === String(damagerId));
      if (!damager || String(damager.controller || '') !== pid) continue;
      if (damaged && typeof damaged === 'object' && !Array.isArray(damaged)) {
        for (const [oid, flag] of Object.entries(damaged)) {
          if (flag) ids.add(oid);
        }
      } else if (Array.isArray(damaged)) {
        for (const oid of damaged) ids.add(String(oid));
      }
    }
  }
  return [...ids];
}

export function collectBatch92DiesReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    const collected = collectBatch92DiesReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String(rec.card?.name || 'Unknown').trim(),
    });
    for (const spec of collected) {
      if ((spec.metadata as any)?.requiresDamagedThisTurnByControllerSource) {
        (spec.metadata as any).damagedObjectIds = damagedObjectIdsForController(state, sourceController);
      }
      specs.push(spec);
    }
  }
  return specs;
}


/** Apply a would-die -> owner's hand redirect, tagging "can't play / play revealed" when present. */
export function applyBatch92LeaveBattlefieldToHand(ctx: any, object: any, ownerId: string, metadata?: any): boolean {
  const state = ctx?.state || ctx;
  const owner = String(ownerId || object?.owner || '').trim();
  if (!state || !owner || !object) return false;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const oid = String(object?.id || '').trim();
  const idx = battlefield.findIndex((p: any) => String(p?.id || '') === oid);
  if (idx >= 0) battlefield.splice(idx, 1);
  state.battlefield = battlefield;
  state.zones = state.zones || {};
  state.zones[owner] = state.zones[owner] || {};
  const hand: any[] = Array.isArray(state.zones[owner].hand) ? state.zones[owner].hand : [];
  const card = { ...(object?.card || object), id: oid || object?.card?.id, name: object?.card?.name || object?.name };
  if (metadata?.cantPlayUntilOwnersNextTurn === true) {
    card.cantPlayUntilOwnersNextTurn = true;
    card.playRevealedInHand = true;
    card.cantPlayUntilOwnerTurnStarts = Number(state.turn || 0);
    card.cantPlayOwnerId = owner;
  }
  hand.push(card);
  state.zones[owner].hand = hand;
  return true;
}
