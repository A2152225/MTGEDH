/**
 * Batch 14: "whenever you cast" triggers see a face-down spell as a 2/2 creature spell with no
 * name, colour, mana cost or abilities (CR 708.4). The card id is kept so the triggering stack item
 * can still be found.
 */
import { buildFaceDownCardStub, getStackItemFaceDownCastKind, isFaceDownCastAlternateCostId } from './faceDownCasting.js';

export function findFaceDownCastStackItem(state: any, casterId: string, spellCard: any, stackItemId?: string): any | null {
  const stack: any[] = Array.isArray(state?.stack) ? state.stack : [];
  const byId = stackItemId ? stack.find((s: any) => s && String(s.id) === String(stackItemId)) : null;
  const item = byId || [...stack].reverse().find((s: any) =>
    s && String(s.controller || '') === String(casterId) && String(s.card?.id || '') === String(spellCard?.id || ''));
  return item && getStackItemFaceDownCastKind(item) ? item : null;
}

export function faceDownSpellCastView(state: any, casterId: string, spellCard: any, stackItemId?: string): any {
  if (!spellCard || spellCard.isFaceDownStub) return spellCard;
  const item = findFaceDownCastStackItem(state, casterId, spellCard, stackItemId);
  const kind = item ? getStackItemFaceDownCastKind(item) : (isFaceDownCastAlternateCostId(spellCard.alternateCostId) ? spellCard.alternateCostId : undefined);
  if (!kind) return spellCard;
  const stub = buildFaceDownCardStub(kind, String(spellCard.id || ''), 'stack');
  return { ...stub, id: spellCard.id, owner: spellCard.owner, faceDownSpell: true };
}