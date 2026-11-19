/**
 * Plane text-change: "Change the text of each sorcery spell and sorcery card
 * not on the stack by replacing 'sorcery' with 'instant.'" (Deceptive Divination).
 *
 * Cards not on the stack have their card type changed, so a sorcery in hand,
 * graveyard, exile, or library can be cast any time an instant could. A spell
 * already on the stack is excluded by the printed effect and stays a sorcery.
 *
 * Public: activePlaneReplacesSorceryWithInstant, sorceryNotOnStackCastsAsInstant.
 */

const REPLACE_SORCERY_WITH_INSTANT =
  /change the text of each sorcery spell and sorcery card not on the stack by replacing ["“”']?sorcery["“”']? with ["“”']?instant["“”']?/i;

function planeOracle(state: any): string {
  const plane = state?.activePlane || state?.currentPlane;
  if (!plane || typeof plane === 'string') return '';
  return String(plane.oracle_text || plane.oracleText || plane.text || plane.effect || '');
}

/** The face-up plane rewrites sorcery cards that are not on the stack. */
export function activePlaneReplacesSorceryWithInstant(state: any): boolean {
  return REPLACE_SORCERY_WITH_INSTANT.test(planeOracle(state));
}

/**
 * The face being cast is a sorcery card (not a creature or other permanent)
 * and the plane's text change lets it be cast at instant timing.
 */
export function sorceryNotOnStackCastsAsInstant(state: any, card: { type_line?: string; typeLine?: string } | null | undefined): boolean {
  if (!activePlaneReplacesSorceryWithInstant(state)) return false;
  const typeLine = String(card?.type_line || card?.typeLine || '');
  const face = typeLine.split('//')[0]?.split(/[—–-]/)[0]?.toLowerCase() || '';
  if (!/\bsorcery\b/.test(face)) return false;
  if (/\b(?:creature|artifact|enchantment|planeswalker|battle|land)\b/.test(face)) return false;
  return true;
}
