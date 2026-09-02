import type { PlayerID } from '../../../../shared/src/index.js';
import { getPlayableUntilTurnForImpulseDuration } from '../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
export {
  detectFaceDownExileFromRaw,
  detectFlexibleImpulseManaSpending,
} from '../../../../rules-engine/src/oracleIRExecutorImpulseExileFaceDown.js';

export { getPlayableUntilTurnForImpulseDuration };

export function viewerCanExamineExiledCard(
  card: any,
  viewer: PlayerID | 'spectator:judge',
): boolean {
  if (!card || typeof card !== 'object') return true;
  if (!Boolean((card as any).faceDown)) return true;
  if (viewer === 'spectator:judge') return true;

  const examinedBy = (card as any).canBeExaminedBy;
  if (Array.isArray(examinedBy) && examinedBy.some((entry: any) => String(entry || '') === String(viewer || ''))) {
    return true;
  }

  // Shared Fate-family cards stamp an explicit look list keyed to the source instance.
  // After the source leaves, that list is emptied — do not fall back to a stale canBePlayedBy.
  const requiresLinkedSource = String((card as any).playFromExileRequiresSourcePermanentId || '').trim();
  if (requiresLinkedSource && Array.isArray(examinedBy)) {
    return false;
  }

  const playedBy = (card as any).canBePlayedBy;
  if (Array.isArray(playedBy) && playedBy.some((entry: any) => String(entry || '') === String(viewer || ''))) {
    return true;
  }
  return String(playedBy || '') === String(viewer || '');
}

export function maskFaceDownExileCardForViewer(card: any, viewer: PlayerID | 'spectator:judge'): any {
  if (!card || typeof card !== 'object') return card;
  const base = { ...card } as any;
  if (!base.faceDown || viewerCanExamineExiledCard(base, viewer)) {
    base.known = true;
    return base;
  }

  return {
    id: base.id,
    zone: base.zone || 'exile',
    faceDown: true,
    known: false,
    exiledBy: base.exiledBy,
    canBeExaminedBy: base.canBeExaminedBy,
    hideawaySourcePermanentId: base.hideawaySourcePermanentId,
    playFromExileRequiresSourcePermanentId: base.playFromExileRequiresSourcePermanentId,
  };
}

function sourcePermanentGrantsExiledWithLookPlay(perm: any): boolean {
  if (!perm || perm.phasedOut === true) return false;
  const oracle = String(perm?.card?.oracle_text || perm?.card?.oracleText || '')
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase();
  return oracle.includes('cards they exiled with')
    && oracle.includes('play lands and cast spells from among those cards');
}

export function applyCurrentExiledWithSourcePlayLook(card: any, battlefield: any[]): any {
  if (!card || typeof card !== 'object') return card;
  const sourceId = String(card.playFromExileRequiresSourcePermanentId || '').trim();
  const exiler = String(card.exiledBy || '').trim();
  if (!sourceId || !exiler) return card;

  const perm = (Array.isArray(battlefield) ? battlefield : []).find(
    (entry: any) => String(entry?.id || '') === sourceId,
  );
  if (!sourcePermanentGrantsExiledWithLookPlay(perm)) {
    return {
      ...card,
      canBeExaminedBy: [],
      canBePlayedBy: undefined,
    };
  }

  return {
    ...card,
    canBeExaminedBy: [exiler],
    canBePlayedBy: exiler,
  };
}
