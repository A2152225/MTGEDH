/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover ETB detector helpers and static alternatives
 * Public: isHideawayLookEffectText, isOracleIndexInsideParenthetical, ETB_STATIC_ALTERNATIVES,
 *   ENTERS_OR_EVENT_SUFFIX, isSwallowedCompoundEnterEffect, LTB_STATIC_ALTERNATIVES
 */

export function isHideawayLookEffectText(text: string): boolean {
  const t = String(text || '').toLowerCase();
  return /look at the top/.test(t) && /exile/.test(t) && /face\s*down/.test(t);
}

export function isOracleIndexInsideParenthetical(oracleText: string, index: number): boolean {
  if (typeof index !== 'number' || index < 0) return false;
  let depth = 0;
  for (let i = 0; i < index && i < oracleText.length; i++) {
    const ch = oracleText[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

/**
 * ETB pattern alternatives (static to avoid recreating on every function call)
 */
export const ETB_STATIC_ALTERNATIVES = [
  '~',
  'this creature',
  'this permanent',
  'this land',
  'this enchantment',
  'this aura',
  'this artifact',
  'this equipment',
  'this vehicle',
  'this token',
  'this planeswalker',
  'this battle',
  'this siege',
  'this class',
  'this spacecraft',
  'this case',
  'this attraction',
];

/**
 * Compound event after "enters or …". Must be consumed as timing, never as the effect
 * (Tivit / Stitcher's Supplier / Experimental Synthesizer class).
 * Longer phrases first so `dies` does not steal "a planeswalker you control dies".
 */
export const ENTERS_OR_EVENT_SUFFIX =
  '(?:deals combat damage to a player(?: or planeswalker)?|is put into a graveyard from the battlefield|becomes the target of a spell or ability an opponent controls|becomes the target of an? aura spell|enchanted creature becomes the target of an? aura spell|the creature it haunts dies|a planeswalker you control dies|another nontoken [\\w]+ you control dies|another creature dies|when it(?:\'s| is) turned face up|is turned face up|becomes monstrous|becomes tapped|leaves(?: the battlefield)?|transforms(?: into [^,]+)?|specializes(?: from [^,]+)?|attacks|dies)';

export function isSwallowedCompoundEnterEffect(effectText: string): boolean {
  return /^or\s+/i.test(String(effectText || '').trim());
}

export const LTB_STATIC_ALTERNATIVES = [
  '~',
  'this creature',
  'this permanent',
  'this land',
  'this enchantment',
  'this aura',
  'this artifact',
  'this equipment',
  'this vehicle',
  'this token',
  'this planeswalker',
  'this battle',
];
