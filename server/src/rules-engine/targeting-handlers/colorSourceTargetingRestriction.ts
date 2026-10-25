import { getEffectiveColors } from '../../state/modules/effectiveColors.js';
import { getStackItemFaceDownCastKind } from '../../state/modules/faceDownCasting.js';
/**
 * Batch 13 (census #23): "~ can't be the target of COLOR spells or abilities from COLOR sources."
 * (Raiding Party, Mercenary Informer, Rebel Informer.) Resolves the targeting source's colours
 * from a sourceId that may be a stack item, a battlefield permanent, or a card in hand.
 */
const COLOR_WORD_TO_SYMBOL: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

export function parseColorSourceTargetingRestriction(oracleText: string): string[] {
  const text = String(oracleText || '');
  const re = /can't be the target of (white|blue|black|red|green) spells or abilities from (white|blue|black|red|green) sources/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = COLOR_WORD_TO_SYMBOL[m[1].toLowerCase()];
    const b = COLOR_WORD_TO_SYMBOL[m[2].toLowerCase()];
    if (a && !out.includes(a)) out.push(a);
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

function manaCostColors(card: any): string[] {
  const cost = String(card?.mana_cost || card?.manaCost || '');
  if (!cost) return [];
  return ['W', 'U', 'B', 'R', 'G'].filter(c => new RegExp(`\\{[^}]*${c}[^}]*\\}`).test(cost));
}

function cardColors(card: any, state?: any): string[] | null {
  if (!card) return null;
  if (card.isFaceDownStub === true) return [];
  if (Array.isArray(card.colors) || Array.isArray(card.colorAdditions)) return getEffectiveColors(card, state);
  return manaCostColors(card);
}

/** Batch 14: current colours of a permanent (colour-changing effects, face-down = colourless). */
function permanentColors(perm: any, state: any): string[] {
  if (!perm) return [];
  if (perm.isFaceDown === true) return [];
  if (Array.isArray(perm.colors) || Array.isArray(perm.card?.colors) || Array.isArray(perm.colorAdditions)) {
    return getEffectiveColors(perm, state);
  }
  const base = manaCostColors(perm.card);
  const extra = getEffectiveColors({ colors: [], id: perm.id } as any, state);
  return [...new Set([...base, ...extra])];
}

export function resolveTargetingSourceColors(state: any, sourceId?: string): string[] | null {
  if (!sourceId) return null;
  const id = String(sourceId);
  const match = (o: any) => o && (String(o.id) === id || String(o.card?.id || '') === id);
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const stackItem = (Array.isArray(state?.stack) ? state.stack : []).find(match);
  if (stackItem) {
    const isAbility = stackItem.type === 'ability' || stackItem.type === 'activated_ability' || stackItem.type === 'triggered_ability' || (!stackItem.card && stackItem.source);
    if (isAbility) {
      // Abilities use their source's current colours; last-known information if it's gone.
      const srcId = String(stackItem.source || stackItem.sourceId || stackItem.sourcePermanentId || '');
      const src = battlefield.find((p: any) => p && String(p.id) === srcId);
      if (src) return permanentColors(src, state);
      if (Array.isArray(stackItem.sourceColors)) return stackItem.sourceColors.map((c: any) => String(c).toUpperCase());
      if (stackItem.card) return cardColors(stackItem.card, state);
      return null;
    }
    if (getStackItemFaceDownCastKind(stackItem)) return [];
    if (stackItem.card) return cardColors(stackItem.card, state);
  }
  const perm = battlefield.find(match);
  if (perm) return permanentColors(perm, state);
  const zones = state?.zones || {};
  for (const pid of Object.keys(zones)) {
    const hand = Array.isArray(zones[pid]?.hand) ? zones[pid].hand : [];
    const c = hand.find((h: any) => h && String(h.id) === id);
    if (c) return cardColors(c, state);
  }
  return null;
}
/** True when the restriction on `perm` forbids a source with id `sourceId`. Unknown sources are allowed. */
export function isBlockedByColorSourceTargetingRestriction(perm: any, state: any, sourceId?: string): boolean {
  if (!perm || perm.isFaceDown === true) return false;
  const restricted = parseColorSourceTargetingRestriction(String(perm.card?.oracle_text || ''));
  if (restricted.length === 0) return false;
  const colors = resolveTargetingSourceColors(state, sourceId);
  if (!colors || colors.length === 0) return false;
  return colors.some(c => restricted.includes(c));
}