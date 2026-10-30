/**
 * Batch 13: hidden information for face-down objects (CR 708.5 / 708.6).
 * Face-down permanents and face-down spells are only visible to their controller.
 * Everyone else sees the 2/2 stub only: faceUpCard / morphCost / turn-up cost are stripped.
 * The judge spectator ("spectator:judge") sees everything.
 */
import { buildFaceDownCardStub, getStackItemFaceDownCastKind, parseTurnFaceUpCost, describeTurnFaceUpCost, type FaceDownCastKind } from './faceDownCasting.js';

const HIDDEN_PERMANENT_FIELDS = ['faceUpCard', 'morphCost', 'turnFaceUpCost', 'manifestedCard', 'cloakedCard'];

function isJudge(viewer: unknown): boolean {
  return String(viewer || '') === 'spectator:judge';
}

function permanentIsFaceDown(perm: any): boolean {
  return !!perm && (
    perm.isFaceDown === true
    || perm.card?.faceDown === true
    || perm.card?.isFaceDownStub === true
  );
}

export function maskFaceDownPermanentForViewer<T extends Record<string, any>>(perm: T, viewer: unknown, revealAll = false): T {
  if (!permanentIsFaceDown(perm)) return perm;
  // Batch 14: at game end every face-down permanent is revealed (CR 708.10).
  if (revealAll) return { ...perm, revealedAtGameEnd: true };
  const viewerId = String(viewer || '');
  if (isJudge(viewerId)) return perm;
  if (viewerId && viewerId === String(perm.controller || '')) {
    const kind = String(perm.faceDownType || '') as FaceDownCastKind;
    const real = perm.faceUpCard;
    const cost = real && (kind === 'morph' || kind === 'megamorph' || kind === 'disguise')
      ? parseTurnFaceUpCost(real.oracle_text, kind)
      : null;
    return {
      ...perm,
      ...(cost ? { canTurnFaceUp: true, turnFaceUpCost: describeTurnFaceUpCost(cost), turnFaceUpCostComponents: cost.components || [] } : {}),
    };
  }
  const masked: any = { ...perm };
  for (const f of HIDDEN_PERMANENT_FIELDS) delete masked[f];
  delete masked.canTurnFaceUp;
  masked.card = buildFaceDownCardStub(perm.faceDownType, String(perm.id || ''));
  return masked;
}

export function maskFaceDownStackItemForViewer<T extends Record<string, any>>(item: T, viewer: unknown, revealAll = false): T {
  const kind = getStackItemFaceDownCastKind(item);
  if (!kind) return item;
  if (revealAll) return item;
  const viewerId = String(viewer || '');
  if (isJudge(viewerId)) return item;
  if (viewerId && viewerId === String(item.controller || '')) return { ...item, faceDownSpell: true };
  const masked: any = {
    id: item.id,
    type: item.type,
    controller: item.controller,
    owner: (item as any).owner,
    targets: (item as any).targets,
    faceDownSpell: true,
    faceDownType: kind,
    card: buildFaceDownCardStub(kind, String(item.id || ''), 'stack'),
  };
  return masked;
}