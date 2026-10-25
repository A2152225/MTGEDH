import { describeTurnFaceUpCostComponents, parseTurnFaceUpCostComponents, type TurnFaceUpCostComponent } from './turnFaceUpCostComponents.js';
/**
 * Batch 13: Morph / Megamorph / Disguise (CR 702.37, 702.168).
 *
 * Casting face down: alternate cost ids 'morph' | 'megamorph' | 'disguise', fixed cost {3}.
 * The spell keeps its real card on the stack item (needed at resolution), but the view masks it
 * for every viewer except the caster (see faceDownViewMasking.ts). On resolution the permanent uses
 * the existing face-down representation: isFaceDown, faceDownType, faceUpCard, morphCost.
 * Disguise face-down permanents also have ward {2} (stub oracle text, read by getWardCost).
 * Turning face up is a special action (socket 'turnFaceUp', see turnFaceUpSpecialAction.ts).
 */

export type FaceDownCastKind = 'morph' | 'megamorph' | 'disguise';

export const FACE_DOWN_CAST_COST = '{3}';
export const FACE_DOWN_CAST_ALTERNATE_COST_IDS: readonly FaceDownCastKind[] = ['morph', 'megamorph', 'disguise'];
export const FACE_DOWN_DISGUISE_WARD_TEXT = 'Ward {2}';

const COLOR_WORDS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

export interface TurnFaceUpCost {
  kind: FaceDownCastKind;
  raw: string;
  manaCost?: string;
  revealColor?: string;
  revealColorWord?: string;
  lifeCost?: number;
  /** Batch 14: all parts of a (possibly mixed / non-mana) cost. */
  components?: TurnFaceUpCostComponent[];
}

export function isFaceDownCastAlternateCostId(id: unknown): id is FaceDownCastKind {
  const v = String(id || '').trim().toLowerCase();
  return v === 'morph' || v === 'megamorph' || v === 'disguise';
}

/** {3} when the alternate cost is a face-down cast, otherwise undefined. */
export function faceDownCastManaCostOverride(alternateCostId: unknown): string | undefined {
  return isFaceDownCastAlternateCostId(alternateCostId) ? FACE_DOWN_CAST_COST : undefined;
}

/** Parse the turn-face-up cost from the keyword line ("Morph {2}{U}", "Morph—Reveal a white card in your hand", "Megamorph—Pay 5 life"). */
export function parseTurnFaceUpCost(oracleText: unknown, kind: FaceDownCastKind): TurnFaceUpCost | null {
  const text = String(oracleText || '');
  if (!text) return null;
  const re = new RegExp(`(?:^|\\n)\\s*${kind}\\b\\s*(?:[\\u2014\\u2013-]\\s*)?([^\\n(]*)`, 'i');
  const m = text.match(re);
  if (!m) return null;
  const raw = String(m[1] || '').trim().replace(/\.\s*$/, '').trim();
  const components = parseTurnFaceUpCostComponents(raw);
  if (!components) return null;
  const cost: TurnFaceUpCost = { kind, raw, components };
  const manaPart = components.find((c) => c.type === 'mana') as any;
  if (manaPart) cost.manaCost = manaPart.manaCost;
  if (components.length === 1) {
    const c: any = components[0];
    if (c.type === 'reveal') { cost.revealColor = c.color; cost.revealColorWord = c.colorWord; }
    if (c.type === 'life') cost.lifeCost = c.amount;
  }
  return cost;
}

/** Face-down keywords this card can be cast with (only ones whose turn-up cost we can pay). */
export function getFaceDownCastKinds(oracleText: unknown): FaceDownCastKind[] {
  return FACE_DOWN_CAST_ALTERNATE_COST_IDS.filter((kind) => parseTurnFaceUpCost(oracleText, kind) !== null);
}

export function describeTurnFaceUpCost(cost: TurnFaceUpCost | null | undefined): string {
  if (!cost) return '';
  if (cost.components && cost.components.length) return describeTurnFaceUpCostComponents(cost.components);
  if (cost.manaCost) return cost.manaCost;
  if (cost.revealColorWord) return `Reveal a ${cost.revealColorWord} card in your hand`;
  if (typeof cost.lifeCost === 'number') return `Pay ${cost.lifeCost} life`;
  return cost.raw;
}

/** The characteristics of a face-down permanent/spell: 2/2 creature, no name, no colour, no abilities (ward {2} for disguise). */
export function buildFaceDownCardStub(kind: FaceDownCastKind | string | undefined, id: string, zone = 'battlefield'): any {
  const disguise = String(kind || '') === 'disguise';
  return {
    id: `facedown_${id}`,
    name: '',
    displayName: 'Face-down Creature',
    type_line: 'Creature',
    oracle_text: '',
    // Batch 14: disguise ward {2} is a granted keyword (see faceDownWardKeyword.ts), not text.
    keywords: disguise ? ['Ward'] : [],
    ...(disguise ? { wardCost: '{2}' } : {}),
    mana_cost: '',
    colors: [],
    color_identity: [],
    power: '2',
    toughness: '2',
    zone,
    isFaceDownStub: true,
  };
}

/** Which face-down kind (if any) a stack item was cast with. */
export function getStackItemFaceDownCastKind(item: any): FaceDownCastKind | undefined {
  if (!item) return undefined;
  const candidates = [item.faceDownCastKind, item.alternateCostId, item.card?.alternateCostId];
  for (const c of candidates) if (isFaceDownCastAlternateCostId(c)) return String(c).toLowerCase() as FaceDownCastKind;
  if (item.wasCastWithMorph === true) return 'morph';
  return undefined;
}

export interface FaceDownEntryInfo {
  wasCastFaceDown: boolean;
  kind?: FaceDownCastKind;
  morphCost?: string;
  turnFaceUpCost?: TurnFaceUpCost | null;
}

export function resolveFaceDownEntryInfo(item: any, effectiveCard: any): FaceDownEntryInfo {
  const kind = getStackItemFaceDownCastKind(item);
  if (!kind) return { wasCastFaceDown: false };
  const oracle = String(effectiveCard?.oracle_text || item?.card?.oracle_text || '');
  const turnFaceUpCost = parseTurnFaceUpCost(oracle, kind);
  const morphCost = (item?.morphCost && typeof item.morphCost === 'string')
    ? item.morphCost
    : (describeTurnFaceUpCost(turnFaceUpCost) || undefined);
  return { wasCastFaceDown: true, kind, morphCost, turnFaceUpCost };
}

export function revealCandidatesForTurnFaceUp(hand: any[], cost: TurnFaceUpCost | null | undefined): any[] {
  if (!cost?.revealColor) return [];
  const want = cost.revealColor;
  return (Array.isArray(hand) ? hand : []).filter((c: any) => {
    const colors: string[] = Array.isArray(c?.colors) ? c.colors : [];
    return colors.some((x) => String(x).toUpperCase() === want || COLOR_WORDS[String(x).toLowerCase()] === want);
  });
}