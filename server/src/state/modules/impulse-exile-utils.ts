import type { PlayerID } from '../../../../shared/src/index.js';
import { getPlayableUntilTurnForImpulseDuration } from '../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';

export { getPlayableUntilTurnForImpulseDuration };

export function detectFaceDownExileFromRaw(raw: string): boolean {
  return /\bface\s*down\b/i.test(String(raw || ''));
}

export function detectFlexibleImpulseManaSpending(text: string): boolean {
  const normalized = String(text || '');
  return (
    /mana\s+of\s+any\s+type\s+can\s+be\s+spent\s+to\s+cast/i.test(normalized)
    || /you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\s+of\s+any\s+(?:type|color)\s+to\s+cast/i.test(normalized)
    || /they\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\s+of\s+any\s+(?:type|color)\s+to\s+cast/i.test(normalized)
  );
}

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
