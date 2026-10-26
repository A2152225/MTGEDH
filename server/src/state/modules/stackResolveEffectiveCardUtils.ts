import { debug } from '../../utils/debug.js';
import { getOverloadedText } from '../../../../rules-engine/src/keywordAbilities/overload.js';

function wasCastWithOverload(stackItem: any, card: any): boolean {
  const values = [
    stackItem?.alternateCostId,
    stackItem?.alternativeCost,
    card?.alternateCostId,
    card?.alternativeCost,
  ];
  return values.some((value) => String(value || '').trim().toLowerCase() === 'overload');
}

/** CR 702.96a: an overloaded spell's text replaces every "target" with "each". */
function applyOverloadTextChange(card: any, stackItem: any): any {
  if (!card || !wasCastWithOverload(stackItem, card)) return card;
  const oracleText = String(card.oracle_text || card.oracleText || '');
  if (!/\btarget\b/i.test(oracleText)) return card;
  return {
    ...card,
    oracle_text: getOverloadedText(oracleText),
  };
}

export function resolveStackItemEffectiveCard(
  stackItem: any,
  card: any,
): { effectiveCard: any; effectiveTypeLine?: string } {
  const castAsAdventure = stackItem?.castAsAdventure;
  let effectiveTypeLine = card?.type_line;
  let effectiveCard = card;

  if (card && (card as any).layout === 'adventure' && Array.isArray((card as any).card_faces)) {
    const faces = (card as any).card_faces;
    let faceIndex = 0;

    if (castAsAdventure === true && faces[1]) {
      faceIndex = 1;
    } else if (castAsAdventure === false && faces[0]) {
      faceIndex = 0;
    }

    const face = faces[faceIndex];
    if (face) {
      effectiveTypeLine = face.type_line;
      effectiveCard = {
        ...card,
        type_line: face.type_line,
        oracle_text: face.oracle_text,
        mana_cost: face.mana_cost,
        power: face.power,
        toughness: face.toughness,
        loyalty: face.loyalty,
        name: face.name || card.name,
      };
    }
  }

  if (card && (card as any).layout === 'prepare' && Array.isArray((card as any).card_faces)) {
    const faces = (card as any).card_faces;
    const frontFace = faces[0];
    if (frontFace) {
      effectiveTypeLine = frontFace.type_line || effectiveTypeLine;
      effectiveCard = {
        ...card,
        type_line: frontFace.type_line || card.type_line,
        oracle_text: frontFace.oracle_text || card.oracle_text,
        mana_cost: frontFace.mana_cost || card.mana_cost,
        power: frontFace.power || card.power,
        toughness: frontFace.toughness || card.toughness,
        loyalty: frontFace.loyalty || card.loyalty,
        name: frontFace.name || card.name,
        image_uris: frontFace.image_uris || card.image_uris,
      };
    }
  }

  if (
    card &&
    ((card as any).layout === 'transform' || (card as any).layout === 'double_faced_token') &&
    Array.isArray((card as any).card_faces)
  ) {
    const faces = (card as any).card_faces;
    const frontFace = faces[0];
    if (frontFace) {
      effectiveTypeLine = frontFace.type_line || effectiveTypeLine;
      effectiveCard = {
        ...card,
        type_line: frontFace.type_line || card.type_line,
        oracle_text: frontFace.oracle_text || card.oracle_text,
        mana_cost: frontFace.mana_cost || card.mana_cost,
        power: frontFace.power || card.power,
        toughness: frontFace.toughness || card.toughness,
        loyalty: frontFace.loyalty || card.loyalty,
        name: frontFace.name || card.name,
      };
      debug(
        2,
        `[resolveStackItemEffectiveCard] Transform DFC ${effectiveCard.name}: using front face P/T ${frontFace.power}/${frontFace.toughness}`,
      );
    }
  }

  return {
    effectiveCard: applyOverloadTextChange(effectiveCard, stackItem),
    effectiveTypeLine,
  };
}
