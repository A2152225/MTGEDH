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
    canBePlayedBy: base.canBePlayedBy,
    canBeExaminedBy: base.canBeExaminedBy,
    hideawaySourcePermanentId: base.hideawaySourcePermanentId,
    playableUntilTurn: base.playableUntilTurn,
    spendManaAsThoughAnyType: base.spendManaAsThoughAnyType,
    castWithoutPayingManaCost: base.castWithoutPayingManaCost,
  };
}
