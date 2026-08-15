/**
 * Soulbond pairing helpers (CR 702.95).
 *
 * Pairing is stored bilaterally as `pairedWith` on battlefield permanents.
 * Creatures may pair when either enters while both are unpaired and share a controller.
 */
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { isCreatureNow } from '../creatureTypeNow.js';

function permanentOracle(permanent: any): string {
  return String(permanent?.oracle_text || permanent?.card?.oracle_text || '');
}

export function permanentHasSoulbond(permanent: any): boolean {
  if (!permanent) return false;
  if (/\bsoulbond\b/i.test(permanentOracle(permanent))) return true;
  const lists = [permanent?.keywords, permanent?.card?.keywords, permanent?.grantedKeywords, permanent?.grantedAbilities];
  for (const list of lists) {
    if (Array.isArray(list) && list.some((entry) => String(entry || '').toLowerCase() === 'soulbond')) {
      return true;
    }
  }
  return false;
}

export function getPairedPermanentId(permanent: any): string {
  return String(permanent?.pairedWith || permanent?.pairedTo || permanent?.soulbondPair || '').trim();
}

export function getPairedPermanent(state: any, permanent: any): any | null {
  const pairId = getPairedPermanentId(permanent);
  if (!pairId || !state) return null;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.find((perm: any) => String(perm?.id || '') === pairId) || null;
}

export function isUnpairedCreature(permanent: any): boolean {
  if (!permanent || !isCreatureNow(permanent)) return false;
  return !getPairedPermanentId(permanent);
}

export function getEligibleSoulbondPairTargets(
  state: any,
  sourcePermanent: any,
): any[] {
  if (!state || !sourcePermanent) return [];
  const sourceId = String(sourcePermanent.id || '').trim();
  const controller = String(sourcePermanent.controller || '').trim();
  if (!sourceId || !controller) return [];
  if (!isUnpairedCreature(sourcePermanent)) return [];

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.filter((perm: any) => {
    if (!perm || String(perm.id || '') === sourceId) return false;
    if (String(perm.controller || '') !== controller) return false;
    return isUnpairedCreature(perm);
  });
}

export function pairPermanents(state: any, aId: string, bId: string): boolean {
  if (!state || !aId || !bId || aId === bId) return false;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const a = battlefield.find((perm: any) => String(perm?.id || '') === aId);
  const b = battlefield.find((perm: any) => String(perm?.id || '') === bId);
  if (!a || !b) return false;
  if (!isUnpairedCreature(a) || !isUnpairedCreature(b)) return false;
  if (String(a.controller || '') !== String(b.controller || '')) return false;

  a.pairedWith = bId;
  b.pairedWith = aId;
  return true;
}

export function unpairPermanent(state: any, permanentOrId: any): boolean {
  if (!state) return false;
  const permanentId = typeof permanentOrId === 'string'
    ? permanentOrId
    : String(permanentOrId?.id || '').trim();
  if (!permanentId) return false;

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const permanent = battlefield.find((perm: any) => String(perm?.id || '') === permanentId)
    || (typeof permanentOrId === 'object' ? permanentOrId : null);
  if (!permanent) return false;

  const partnerId = getPairedPermanentId(permanent);
  delete permanent.pairedWith;
  delete permanent.pairedTo;
  delete permanent.soulbondPair;

  if (partnerId) {
    const partner = battlefield.find((perm: any) => String(perm?.id || '') === partnerId);
    if (partner) {
      delete partner.pairedWith;
      delete partner.pairedTo;
      delete partner.soulbondPair;
    }
  }
  return Boolean(partnerId);
}

/**
 * Clear pairing when a permanent leaves, changes controller, or stops being a creature.
 */
export function reconcileSoulbondPairing(state: any, permanent?: any): number {
  if (!state) return 0;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const byId = new Map<string, any>(
    battlefield.map((perm: any) => [String(perm?.id || ''), perm]),
  );
  let cleared = 0;

  const candidates = permanent ? [permanent] : battlefield;
  for (const perm of candidates) {
    if (!perm) continue;
    const pairId = getPairedPermanentId(perm);
    if (!pairId) continue;

    const partner = byId.get(pairId);
    const selfId = String(perm.id || '');
    const stillValid = Boolean(
      partner
      && isCreatureNow(perm)
      && isCreatureNow(partner)
      && String(perm.controller || '') === String(partner.controller || '')
      && getPairedPermanentId(partner) === selfId,
    );
    if (!stillValid) {
      if (unpairPermanent(state, perm)) cleared += 1;
    }
  }

  return cleared;
}

export function queueSoulbondPairingChoices(
  ctx: GameContext,
  enteringPermanent: any,
  enteringController: string,
): void {
  if ((ctx as any)?.isReplaying) return;
  const state = (ctx as any)?.state;
  if (!state || !enteringPermanent) return;
  if (!isCreatureNow(enteringPermanent)) return;

  const controller = String(enteringPermanent.controller || enteringController || '').trim();
  if (!controller) return;

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const enteringId = String(enteringPermanent.id || '').trim();
  if (!enteringId) return;

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return;

  // Soulbond: when either enters, you may pair (source with soulbond is the chooser).
  const choosers: any[] = [];
  if (permanentHasSoulbond(enteringPermanent) && isUnpairedCreature(enteringPermanent)) {
    choosers.push(enteringPermanent);
  }
  for (const perm of battlefield) {
    if (!perm || String(perm.id || '') === enteringId) continue;
    if (String(perm.controller || '') !== controller) continue;
    if (!permanentHasSoulbond(perm) || !isUnpairedCreature(perm)) continue;
    if (isUnpairedCreature(enteringPermanent)) {
      choosers.push(perm);
    }
  }

  const seen = new Set<string>();
  for (const chooser of choosers) {
    const chooserId = String(chooser.id || '').trim();
    if (!chooserId || seen.has(chooserId)) continue;
    seen.add(chooserId);

    const validTargets = getEligibleSoulbondPairTargets(state, chooser).map((perm: any) => ({
      id: String(perm.id),
      label: String(perm.card?.name || perm.id),
      description: String(perm.card?.type_line || 'creature'),
    }));
    if (validTargets.length === 0) continue;

    try {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        sourceId: chooserId,
        sourceName: String(chooser.card?.name || 'Soulbond'),
        description: `You may pair ${chooser.card?.name || 'this creature'} with another unpaired creature you control`,
        mandatory: false,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 0,
        maxTargets: 1,
        targetDescription: 'another unpaired creature you control',
        action: 'soulbond_pair',
        soulbondSourceId: chooserId,
      } as any);
    } catch {
      // best-effort
    }
  }
}
