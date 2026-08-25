/**
 * turn-phases-handlers/turnPhaseActivePermanentFace.ts
 * Origin parent: server/src/state/modules/triggers/turn-phases.ts
 * Cluster moved: getActivePermanentCardFace.
 * Public entry symbols: getActivePermanentCardFace.
 */

import { stripReminderParentheticals } from "../../../../../../rules-engine/src/oracleReminderText.js";

export function getActivePermanentCardFace(card: any, permanent: any): { cardName: string; oracleText: string } {
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const isTransformCard = (card?.layout === 'transform' || card?.layout === 'double_faced_token') && cardFaces.length >= 2;
  const activeFaceIndex = (permanent as any)?.transformed ? 1 : 0;
  const activeFace = isTransformCard ? cardFaces[activeFaceIndex] || cardFaces[0] : undefined;

  return {
    cardName: String(isTransformCard ? activeFace?.name || card?.name || 'Unknown' : card?.name || 'Unknown'),
    oracleText: stripReminderParentheticals(
      String(isTransformCard ? activeFace?.oracle_text || card?.oracle_text || '' : card?.oracle_text || ''),
    ),
  };
}
