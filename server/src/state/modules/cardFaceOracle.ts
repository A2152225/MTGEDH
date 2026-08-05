import { getEffectiveOracleText } from './effectiveOracleText.js';

export function getActivePermanentCardFace(
  card: any,
  permanent: any,
  state?: unknown,
): { cardName: string; oracleText: string; typeLine: string } {
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const isTransformCard =
    (card?.layout === 'transform' || card?.layout === 'double_faced_token') && cardFaces.length >= 2;
  const activeFaceIndex = (permanent as any)?.transformed ? 1 : 0;
  const activeFace = isTransformCard ? cardFaces[activeFaceIndex] || cardFaces[0] : undefined;

  const printedOracle = String(
    isTransformCard ? activeFace?.oracle_text || card?.oracle_text || '' : card?.oracle_text || '',
  );

  return {
    cardName: String(isTransformCard ? activeFace?.name || card?.name || 'Unknown' : card?.name || 'Unknown'),
    oracleText: state ? getEffectiveOracleText({ oracle_text: printedOracle }, state) : printedOracle,
    typeLine: String(
      isTransformCard ? activeFace?.type_line || card?.type_line || '' : card?.type_line || '',
    ),
  };
}
