export function getActivePermanentCardFace(
  card: any,
  permanent: any,
): { cardName: string; oracleText: string; typeLine: string } {
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const isTransformCard =
    (card?.layout === 'transform' || card?.layout === 'double_faced_token') && cardFaces.length >= 2;
  const activeFaceIndex = (permanent as any)?.transformed ? 1 : 0;
  const activeFace = isTransformCard ? cardFaces[activeFaceIndex] || cardFaces[0] : undefined;

  return {
    cardName: String(isTransformCard ? activeFace?.name || card?.name || 'Unknown' : card?.name || 'Unknown'),
    oracleText: String(
      isTransformCard ? activeFace?.oracle_text || card?.oracle_text || '' : card?.oracle_text || '',
    ),
    typeLine: String(
      isTransformCard ? activeFace?.type_line || card?.type_line || '' : card?.type_line || '',
    ),
  };
}
