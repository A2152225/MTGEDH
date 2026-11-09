// server/src/socket/combat-handlers/attackCostPermanentPayment.ts
// Non-mana attack costs (Floodtide Serpent return-enchantment; Flooded Woodlands / Reclamation
// sacrifice-a-land-per-color-creature; Hollow Warrior tap-another-creature). Parse + collect + pay;
// the declare-attackers / declare-blockers paths enqueue TARGET_SELECTION that reuses TargetSelectionModal.
// Leaf: no resolution.ts import.
// Public: SELF_RETURN_ATTACK_COST_RE, COLOR_SACRIFICE_LAND_ATTACK_COST_RE,
//   collectAttackPermanentCosts, collectBlockTapCreatureCosts,
//   buildAttackCostPermanentValidTargets, buildAttackCostTapValidTargets,
//   payAttackCostPermanentSelections, describeAttackPermanentCost.

import type { GameContext } from '../../state/context.js';
import { objectHasManaColor } from '../../state/modules/effectiveColors.js';
import {
  permanentRequiresTapCreatureAttackBlockCost,
  eligibleTapCreaturesForAttackBlockCost,
} from '../../state/modules/attackBlockTapCost.js';

export type AttackPermanentCostKind = 'sacrifice' | 'return_to_hand' | 'tap';

export interface AttackPermanentCostRequirement {
  kind: AttackPermanentCostKind;
  permanentType: string;
  count: number;
  sources: string[];
  attackerIds: string[];
  /** When set, this requirement is for declare-blockers (Hollow Warrior block cost). */
  blockerIds?: string[];
}

export const SELF_RETURN_ATTACK_COST_RE =
  /can(?:not|'t)\s+attack\s+unless\s+you\s+return\s+an?\s+([a-z]+)\s+you\s+control\s+to\s+its\s+owner(?:'|'s|\u2019s)?\s+hand/i;

export const COLOR_SACRIFICE_LAND_ATTACK_COST_RE =
  /(white|blue|black|red|green)\s+creatures?\s+can(?:not|'t)\s+attack\s+unless\s+(?:their\s+controller\s+)?sacrifices\s+a\s+land(?:\s+of\s+their\s+choice)?(?:\s+for\s+each(?:\s+\1)?(?:\s+creature)?)?/i;

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '');
}

function nameOf(perm: any): string {
  return String(perm?.card?.name || perm?.name || 'an effect');
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function mergeRequirement(
  into: AttackPermanentCostRequirement[],
  next: AttackPermanentCostRequirement,
): void {
  const existing = into.find(
    (r) => r.kind === next.kind && r.permanentType === next.permanentType
      && !r.blockerIds?.length && !next.blockerIds?.length && next.kind !== 'tap',
  );
  if (!existing) {
    into.push({
      kind: next.kind,
      permanentType: next.permanentType,
      count: next.count,
      sources: [...next.sources],
      attackerIds: [...next.attackerIds],
      ...(next.blockerIds ? { blockerIds: [...next.blockerIds] } : {}),
    });
    return;
  }
  existing.count += next.count;
  for (const s of next.sources) if (!existing.sources.includes(s)) existing.sources.push(s);
  for (const id of next.attackerIds) if (!existing.attackerIds.includes(id)) existing.attackerIds.push(id);
}

/** Requirements to pay before the listed attackers can attack. */
export function collectAttackPermanentCosts(
  state: any,
  attackingPlayerId: string,
  attackers: ReadonlyArray<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>,
): AttackPermanentCostRequirement[] {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const byId = new Map(battlefield.map((p: any) => [String(p?.id || ''), p]));
  const out: AttackPermanentCostRequirement[] = [];

  for (const entry of attackers) {
    const id = String(entry?.creatureId || '').trim();
    if (!id) continue;
    const creature = byId.get(id);
    if (!creature || String((creature as any).controller || '') !== String(attackingPlayerId)) continue;
    const m = oracleOf(creature).match(SELF_RETURN_ATTACK_COST_RE);
    if (!m) continue;
    mergeRequirement(out, {
      kind: 'return_to_hand',
      permanentType: String(m[1] || 'enchantment').toLowerCase(),
      count: 1,
      sources: [nameOf(creature)],
      attackerIds: [id],
    });
  }

  // Hollow Warrior: one tap-creature cost per attacking permanent (not merged).
  for (const entry of attackers) {
    const id = String(entry?.creatureId || '').trim();
    if (!id) continue;
    const creature = byId.get(id);
    if (!creature || String((creature as any).controller || '') !== String(attackingPlayerId)) continue;
    if (!permanentRequiresTapCreatureAttackBlockCost(creature)) continue;
    out.push({
      kind: 'tap',
      permanentType: 'creature',
      count: 1,
      sources: [nameOf(creature)],
      attackerIds: [id],
    });
  }

  for (const perm of battlefield) {
    if (!perm || perm.faceDown) continue;
    const m = oracleOf(perm).match(COLOR_SACRIFICE_LAND_ATTACK_COST_RE);
    if (!m) continue;
    const colorWord = String(m[1] || '').toLowerCase();
    const sourceName = nameOf(perm);
    const matchingIds: string[] = [];
    for (const entry of attackers) {
      const id = String(entry?.creatureId || '').trim();
      const creature = byId.get(id);
      if (!creature || String((creature as any).controller || '') !== String(attackingPlayerId)) continue;
      if (!objectHasManaColor(creature as any, colorWord, state)) continue;
      matchingIds.push(id);
    }
    if (!matchingIds.length) continue;
    mergeRequirement(out, {
      kind: 'sacrifice',
      permanentType: 'land',
      count: matchingIds.length,
      sources: [sourceName],
      attackerIds: matchingIds,
    });
  }

  return out.filter((r) => r.count > 0);
}

/** Hollow Warrior block cost: one tap-creature requirement per blocking permanent. */
export function collectBlockTapCreatureCosts(
  state: any,
  blockingPlayerId: string,
  blockers: ReadonlyArray<{ blockerId: string; attackerId?: string }>,
): AttackPermanentCostRequirement[] {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const byId = new Map(battlefield.map((p: any) => [String(p?.id || ''), p]));
  const out: AttackPermanentCostRequirement[] = [];
  for (const entry of blockers) {
    const id = String(entry?.blockerId || '').trim();
    if (!id) continue;
    const creature = byId.get(id);
    if (!creature || String((creature as any).controller || '') !== String(blockingPlayerId)) continue;
    if (!permanentRequiresTapCreatureAttackBlockCost(creature)) continue;
    out.push({
      kind: 'tap',
      permanentType: 'creature',
      count: 1,
      sources: [nameOf(creature)],
      attackerIds: [],
      blockerIds: [id],
    });
  }
  return out;
}

/** Untapped non-attacking/non-blocking creatures you control, excluding declared combatants. */
export function buildAttackCostTapValidTargets(
  battlefield: readonly any[],
  controllerId: string,
  excludedIds?: ReadonlySet<string> | readonly string[],
): Array<Record<string, unknown>> {
  const excluded = excludedIds instanceof Set
    ? excludedIds
    : new Set(Array.from((excludedIds || []) as readonly string[]).map((id) => String(id)));
  const eligible = eligibleTapCreaturesForAttackBlockCost(battlefield, controllerId).filter((p: any) => {
    const id = String(p?.id || '');
    return id && !excluded.has(id);
  });
  return eligible.map((p: any) => ({
    id: String(p.id),
    name: nameOf(p),
    type: 'permanent',
    description: 'creature',
    typeLine: p?.card?.type_line || p?.type_line,
    controller: p.controller,
    owner: p.owner || p.controller,
    tapped: p.tapped === true,
    card: p.card,
    imageUrl: p?.card?.image_uris?.small || p?.card?.image_uris?.normal,
  }));
}

export function buildAttackCostPermanentValidTargets(
  battlefield: readonly any[],
  controllerId: string,
  permanentType: string,
  excludedIds?: ReadonlySet<string> | readonly string[],
): Array<Record<string, unknown>> {
  const excluded = excludedIds instanceof Set
    ? excludedIds
    : new Set(Array.from((excludedIds || []) as readonly string[]).map((id) => String(id)));
  const want = String(permanentType || '').toLowerCase();
  const out: Array<Record<string, unknown>> = [];
  for (const p of battlefield || []) {
    if (!p || p.faceDown) continue;
    if (String(p.controller || '') !== String(controllerId)) continue;
    const id = String(p.id || '');
    if (!id || excluded.has(id)) continue;
    const typeLine = typeLineOf(p);
    if (want && !typeLine.includes(want)) continue;
    out.push({
      id,
      name: nameOf(p),
      type: 'permanent',
      description: want || 'permanent',
      typeLine: p?.card?.type_line || p?.type_line,
      controller: p.controller,
      owner: p.owner || p.controller,
      tapped: p.tapped === true,
      card: p.card,
      imageUrl: p?.card?.image_uris?.small || p?.card?.image_uris?.normal,
    });
  }
  return out;
}

export function describeAttackPermanentCost(req: AttackPermanentCostRequirement, combatAction: 'attack' | 'block' = 'attack'): string {
  const noun = req.permanentType || 'permanent';
  const n = Math.max(1, Math.floor(Number(req.count) || 1));
  const article = n === 1 ? (/^[aeiou]/i.test(noun) ? 'an' : 'a') : String(n);
  const plural = n === 1 ? noun : `${noun}s`;
  let action: string;
  if (req.kind === 'tap') {
    action = `tap ${n === 1 ? 'an' : String(n)} untapped ${n === 1 ? noun : plural} you control that isn't attacking or blocking`;
  } else if (req.kind === 'return_to_hand') {
    action = `return ${article} ${n === 1 ? noun : plural} you control to its owner's hand`;
  } else {
    action = `sacrifice ${article} ${n === 1 ? noun : plural}`;
  }
  const verb = combatAction === 'block' ? 'block' : 'attack';
  const sources = req.sources.length ? ` (${req.sources.join(', ')})` : '';
  return `Pay to ${verb}${sources}: ${action}`;
}

export async function payAttackCostPermanentSelections(
  game: any,
  gameId: string,
  controllerId: string,
  kind: AttackPermanentCostKind,
  selectedIds: readonly string[],
  options?: { excludedCombatantIds?: ReadonlySet<string> | readonly string[] },
): Promise<{ ok: true; movedIds: string[]; movedNames: string[] } | { ok: false; error: string }> {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const ctx = {
    state: game.state,
    libraries: game.libraries,
    bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
    rng: game.rng,
    gameId,
  } as unknown as GameContext;
  const movedIds: string[] = [];
  const movedNames: string[] = [];
  if (kind === 'tap') {
    const excluded = options?.excludedCombatantIds instanceof Set
      ? options.excludedCombatantIds
      : new Set(Array.from((options?.excludedCombatantIds || []) as readonly string[]).map((id) => String(id)));
    const legal = new Set(
      buildAttackCostTapValidTargets(battlefield, controllerId, excluded).map((t) => String(t.id)),
    );
    for (const rawId of selectedIds) {
      const id = String(rawId || '').trim();
      if (!id) continue;
      if (!legal.has(id)) {
        return { ok: false, error: 'Chosen creature is not a legal tap cost.' };
      }
      const perm = battlefield.find((p: any) => p && String(p.id) === id);
      if (!perm || String(perm.controller || '') !== String(controllerId) || perm.tapped === true) {
        return { ok: false, error: 'Chosen creature is no longer valid to tap.' };
      }
      perm.tapped = true;
      movedIds.push(id);
      movedNames.push(nameOf(perm));
    }
    return { ok: true, movedIds, movedNames };
  }
  const zones = kind === 'return_to_hand' ? await import('../../state/modules/zones.js') : null;
  const counters = kind === 'sacrifice' ? await import('../../state/modules/counters_tokens.js') : null;
  for (const rawId of selectedIds) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    const perm = battlefield.find((p: any) => p && String(p.id) === id);
    if (!perm || String(perm.controller || '') !== String(controllerId)) {
      return { ok: false, error: 'Chosen permanent is no longer valid.' };
    }
    const nm = nameOf(perm);
    const ok = kind === 'return_to_hand'
      ? !!(zones as any).movePermanentToHand(ctx as any, id)
      : !!(counters as any).movePermanentToGraveyard(ctx, id, true);
    if (!ok) {
      return { ok: false, error: `Failed to ${kind === 'return_to_hand' ? 'return' : 'sacrifice'} ${nm}.` };
    }
    movedIds.push(id);
    movedNames.push(nm);
  }
  return { ok: true, movedIds, movedNames };
}
