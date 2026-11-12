/**
 * Unified resolver for entering the battlefield transformed or converted.
 *
 * Rules (MagicCompRules 20261106):
 * 701.27c / 701.28c: Transforming or converting does not create a new object.
 * 701.27i: "As [this] transforms..." is applied while changing faces, not afterward.
 * 701.27j / 701.28h: A double-faced spell with its front face up that would enter
 *   transformed or converted goes to its owner's graveyard if the back face is an
 *   instant or sorcery, or if it is a copy of a DFC created with an instant or
 *   sorcery back face. This is an exception to 712.10.
 * 712.8a / 712.10: A DFC spell already on the stack with its back face up (for
 *   example, Disturb) enters with that same face up.
 * 712.11: From a zone other than the stack, a DFC enters front face up by default.
 * 712.11a: "Put onto the battlefield transformed/converted" makes a DFC enter with
 *   its back face up. A non-DFC stays in its current zone.
 * 712.11b: A DFC instructed to enter with an instant or sorcery face up stays in
 *   its current zone, or goes to the graveyard if that zone is the stack.
 * 713.1 / 713.1c: Meld cards are not double-faced cards and cannot be transformed
 *   or converted. An instruction to put one onto the battlefield transformed is
 *   ignored (it stays in its current zone).
 */

export type EnterFaceIntent = 'none' | 'transformed' | 'converted';
export type EnterFaceSourceZone = 'stack' | 'other';
export type EnterFaceOutcome = 'enter_default' | 'enter_back_face' | 'stay_in_zone' | 'graveyard';

export interface EnterTransformedOrConvertedInput {
  readonly intent: EnterFaceIntent;
  readonly sourceZone: EnterFaceSourceZone;
  readonly isDoubleFaced?: boolean;
  readonly isMeldCard?: boolean;
  readonly isMelded?: boolean;
  readonly backFaceIsInstantOrSorcery?: boolean;
  readonly representingCardBackFaceIsInstantOrSorcery?: boolean;
  readonly isCopyOfDfcCreatedWithInstantOrSorceryBackFace?: boolean;
  /** 712.8a / 712.10: the spell is already on the stack with its back face up. */
  readonly stackFaceAlreadyBack?: boolean;
}

export interface EnterTransformedOrConvertedDecision {
  readonly intent: EnterFaceIntent;
  readonly outcome: EnterFaceOutcome;
  readonly face: 'front' | 'back';
  readonly reason: string;
}

export function isInstantOrSorceryTypeLine(typeLine: unknown): boolean {
  const line = String(typeLine || '').toLowerCase();
  return /\binstant\b/.test(line) || /\bsorcery\b/.test(line);
}

function readLayout(card: any): string {
  return String(card?.layout || '').trim().toLowerCase();
}

export function isMeldCardLike(card: any): boolean {
  if (!card || typeof card !== 'object') return false;
  if (card.isMeldCard === true || card.isMelded === true) return true;
  return readLayout(card) === 'meld';
}

export function isTransformingDfcLayout(layout: string): boolean {
  const value = String(layout || '').trim().toLowerCase();
  return value === 'transform' || value === 'double_faced_token' || value === 'transforming_dfc';
}

export function isModalDfcLayout(layout: string): boolean {
  const value = String(layout || '').trim().toLowerCase();
  return value === 'modal_dfc' || value === 'modal';
}

export function isDoubleFacedCardLike(card: any): boolean {
  if (!card || typeof card !== 'object') return false;
  if (isMeldCardLike(card)) return false;
  const layout = readLayout(card);
  if (isTransformingDfcLayout(layout) || isModalDfcLayout(layout)) return true;
  if (card.isDoubleFaced === true) return true;
  return false;
}

export function getCardFace(card: any, index: 0 | 1): any | undefined {
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  return faces[index];
}

export function inspectCardForEnterFace(card: any): {
  readonly layout: string;
  readonly isTransformingDfc: boolean;
  readonly isModalDfc: boolean;
  readonly isMeldCard: boolean;
  readonly isDoubleFaced: boolean;
  readonly hasTwoFaces: boolean;
  readonly backFaceIsInstantOrSorcery: boolean;
  readonly frontFaceIsInstantOrSorcery: boolean;
  readonly backFace: any | undefined;
  readonly frontFace: any | undefined;
} {
  const layout = readLayout(card);
  const frontFace = getCardFace(card, 0);
  const backFace = getCardFace(card, 1);
  const isMeldCard = isMeldCardLike(card);
  const isTransformingDfc = isTransformingDfcLayout(layout);
  const isModalDfc = isModalDfcLayout(layout);
  return {
    layout,
    isTransformingDfc,
    isModalDfc,
    isMeldCard,
    isDoubleFaced: isDoubleFacedCardLike(card),
    hasTwoFaces: Boolean(frontFace) && Boolean(backFace),
    backFaceIsInstantOrSorcery: isInstantOrSorceryTypeLine(backFace?.type_line || backFace?.typeLine),
    frontFaceIsInstantOrSorcery: isInstantOrSorceryTypeLine(frontFace?.type_line || frontFace?.typeLine),
    backFace,
    frontFace,
  };
}

export function cardAlreadyShowsBackFace(card: any): boolean {
  if (!card || typeof card !== 'object') return false;
  if (card.transformed === true || card.currentFace === 'back') return true;
  if (Number(card.faceIndex) === 1) return true;
  if (Number(card.selectedMDFCFace) === 1) return true;
  return false;
}

export function cardIntendsToEnterTransformedOrConverted(card: any, extra?: unknown): EnterFaceIntent {
  const sources = [card, extra];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const record = source as Record<string, unknown>;
    if (record.entersConverted === true || record.entersBattlefieldConverted === true) return 'converted';
    if (
      record.transformed === true
      || record.entersTransformed === true
      || record.entersBattlefieldTransformed === true
      || record.battlefieldTransformed === true
    ) {
      return 'transformed';
    }
  }
  return 'none';
}

export function dayboundWouldEnterTransformed(card: any, dayNight: unknown): boolean {
  if (String(dayNight || '').toLowerCase() !== 'night') return false;
  const inspected = inspectCardForEnterFace(card);
  if (!inspected.isTransformingDfc && !inspected.isDoubleFaced) return false;
  const oracle = String(card?.oracle_text || card?.oracleText || inspected.frontFace?.oracle_text || '').toLowerCase();
  return oracle.includes('daybound');
}

/**
 * Resolve how a card should enter when an effect asks for transformed/converted,
 * including 701.27j / 701.28h and 712.11 / 713.1 exclusions.
 */
export function resolveEnterBattlefieldTransformedOrConverted(
  input: EnterTransformedOrConvertedInput,
): EnterTransformedOrConvertedDecision {
  const intent = input.intent;
  const isMeld = input.isMeldCard === true || input.isMelded === true;
  const isDfc = input.isDoubleFaced === true && !isMeld;
  const representingBackIsIS = input.representingCardBackFaceIsInstantOrSorcery === true
    || input.isCopyOfDfcCreatedWithInstantOrSorceryBackFace === true
    || input.backFaceIsInstantOrSorcery === true;
  const characteristicsBackIsIS = input.backFaceIsInstantOrSorcery === true;

  if (input.stackFaceAlreadyBack === true && input.sourceZone === 'stack') {
    if (representingBackIsIS && isDfc) {
      return { intent, outcome: 'graveyard', face: 'back', reason: '712.11b' };
    }
    return { intent, outcome: 'enter_back_face', face: 'back', reason: '712.10' };
  }
  if (intent === 'none') {
    return { intent, outcome: 'enter_default', face: 'front', reason: input.sourceZone === 'stack' ? '712.10' : '712.11' };
  }

  // 701.27j / 701.28h apply to a double-faced spell with its front face up.
  if (input.sourceZone === 'stack' && isDfc && input.stackFaceAlreadyBack !== true && representingBackIsIS) {
    return {
      intent,
      outcome: 'graveyard',
      face: 'back',
      reason: intent === 'converted' ? '701.28h' : '701.27j',
    };
  }

  if (isMeld || !isDfc) {
    if (input.sourceZone === 'stack') {
      // A resolving non-DFC (or meld) spell cannot enter transformed; it enters untransformed.
      return { intent, outcome: 'enter_default', face: 'front', reason: isMeld ? '713.1c' : '712.11a' };
    }
    return { intent, outcome: 'stay_in_zone', face: 'front', reason: isMeld ? '713.1c' : '712.11a' };
  }

  if (characteristicsBackIsIS || representingBackIsIS) {
    if (input.sourceZone === 'stack') {
      return {
        intent,
        outcome: 'graveyard',
        face: 'back',
        reason: intent === 'converted' ? '701.28h' : '701.27j',
      };
    }
    return { intent, outcome: 'stay_in_zone', face: 'front', reason: '712.11b' };
  }

  return { intent, outcome: 'enter_back_face', face: 'back', reason: '712.11a' };
}

export function resolveEnterFaceForCard(
  card: any,
  args: {
    readonly sourceZone: EnterFaceSourceZone;
    readonly intent?: EnterFaceIntent;
    readonly dayNight?: unknown;
    readonly extra?: unknown;
    readonly representingCard?: any;
    readonly stackFaceAlreadyBack?: boolean;
  },
): EnterTransformedOrConvertedDecision {
  const inspected = inspectCardForEnterFace(card);
  const representing = args.representingCard ?? card;
  const representingInspected = inspectCardForEnterFace(representing);
  let intent = args.intent ?? cardIntendsToEnterTransformedOrConverted(card, args.extra);
  if (intent === 'none' && dayboundWouldEnterTransformed(card, args.dayNight)) {
    intent = 'transformed';
  }
  const stackFaceAlreadyBack = args.stackFaceAlreadyBack ?? (
    args.sourceZone === 'stack' && cardAlreadyShowsBackFace(card)
  );
  return resolveEnterBattlefieldTransformedOrConverted({
    intent,
    sourceZone: args.sourceZone,
    isDoubleFaced: inspected.isDoubleFaced || representingInspected.isDoubleFaced,
    isMeldCard: inspected.isMeldCard || representingInspected.isMeldCard,
    backFaceIsInstantOrSorcery: inspected.backFaceIsInstantOrSorcery,
    representingCardBackFaceIsInstantOrSorcery: representingInspected.backFaceIsInstantOrSorcery,
    stackFaceAlreadyBack,
  });
}

/**
 * Copy back-face characteristics onto a card object without changing its identity.
 * Used when a permanent enters with its back face up (it does not "transform").
 */
export function applyBackFaceCharacteristicsToCard(card: any): any {
  if (!card || typeof card !== 'object') return card;
  const backFace = getCardFace(card, 1);
  if (!backFace) {
    return { ...card, transformed: true, faceIndex: 1, currentFace: 'back' };
  }
  const next: any = {
    ...card,
    ...backFace,
    id: card.id,
    layout: card.layout,
    card_faces: card.card_faces,
    transformed: true,
    faceIndex: 1,
    currentFace: 'back',
  };
  if (backFace.name) next.name = backFace.name;
  if (backFace.type_line || backFace.typeLine) next.type_line = backFace.type_line || backFace.typeLine;
  if (backFace.oracle_text || backFace.oracleText) next.oracle_text = backFace.oracle_text || backFace.oracleText;
  if (backFace.mana_cost != null || backFace.manaCost != null) {
    next.mana_cost = backFace.mana_cost ?? backFace.manaCost;
  }
  if (backFace.image_uris) next.image_uris = backFace.image_uris;
  if ('power' in backFace) next.power = backFace.power;
  if ('toughness' in backFace) next.toughness = backFace.toughness;
  if ('loyalty' in backFace) next.loyalty = backFace.loyalty;
  return next;
}

export function entersBattlefieldTransformedWithInstantOrSorceryBackFace(
  backFaceIsInstantOrSorcery: boolean,
): 'graveyard' | 'battlefield' {
  const decision = resolveEnterBattlefieldTransformedOrConverted({
    intent: 'transformed',
    sourceZone: 'stack',
    isDoubleFaced: true,
    backFaceIsInstantOrSorcery,
  });
  return decision.outcome === 'graveyard' ? 'graveyard' : 'battlefield';
}

export function entersBattlefieldConvertedWithInstantOrSorceryBackFace(
  backFaceIsInstantOrSorcery: boolean,
): 'graveyard' | 'battlefield' {
  const decision = resolveEnterBattlefieldTransformedOrConverted({
    intent: 'converted',
    sourceZone: 'stack',
    isDoubleFaced: true,
    backFaceIsInstantOrSorcery,
  });
  return decision.outcome === 'graveyard' ? 'graveyard' : 'battlefield';
}
