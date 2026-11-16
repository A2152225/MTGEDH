// server/src/state/modules/asEntersOptionalCopyFallback.ts
// Oracle-pattern fallback for optional "you may have this enter as a copy of
// any ..." replacements (Sculpting Steel, Mirror Image, Mirrormade, Copy
// Enchantment, Waxen Shapethief, and similar). Used when Oracle IR does not
// already produce a sufficiently specific copy_permanent requirement.
// Public: parseOptionalEntersAsCopyOracle, mergeOptionalEntersAsCopyFallback.

import { normalizeOraclePatternText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

export type OptionalEntersAsCopyFallback = {
  kind: 'copy_permanent';
  mandatory: false;
  reason: string;
  copyType: string;
  copyTypes: string[];
  controllerOnly: boolean;
  enterTappedIfCopied: boolean;
};

const COPY_RE =
  /you may have (?:this (?:artifact|enchantment|creature|permanent|land)|.+?) enter(?:s)?(?:\s+tapped)? as a copy of any ([^.]+?)\./i;

function classify(raw: string): { copyType: string; copyTypes: string[]; controllerOnly: boolean; noun: string } | null {
  const text = normalizeOraclePatternText(String(raw || '')).replace(/\u2019/g, "'").toLowerCase().trim();
  if (!text) return null;
  const controllerOnly = /\byou control\b/.test(text);
  const hasArtifact = /\bartifact\b/.test(text);
  const hasEnchantment = /\benchantment\b/.test(text);
  const hasCreature = /\bcreature\b/.test(text);
  const hasLand = /\bland\b/.test(text);
  const hasPermanent = /\bpermanent\b/.test(text);
  const types: string[] = [];
  if (hasArtifact) types.push('artifact');
  if (hasEnchantment) types.push('enchantment');
  if (hasCreature) types.push('creature');
  if (hasLand) types.push('land');
  if (!types.length && hasPermanent) types.push('permanent');
  if (!types.length) return null;
  let copyType = 'permanent';
  if (types.length === 1) copyType = types[0];
  else if (types.length === 2 && types.includes('artifact') && types.includes('enchantment')) {
    copyType = 'artifact-or-enchantment';
  }
  const noun = types.length === 1 ? types[0] : types.join(' or ');
  return { copyType, copyTypes: types, controllerOnly, noun };
}

export function parseOptionalEntersAsCopyOracle(oracleText: string): OptionalEntersAsCopyFallback | null {
  const text = normalizeOraclePatternText(String(oracleText || '')).replace(/\u2019/g, "'");
  const match = text.match(COPY_RE);
  if (!match) return null;
  const classified = classify(match[1] || '');
  if (!classified) return null;
  const enterTappedIfCopied = /enter(?:s)?\s+tapped\s+as\s+a\s+copy/i.test(text);
  const scope = classified.controllerOnly ? `${classified.noun} you control` : `${classified.noun} on the battlefield`;
  return {
    kind: 'copy_permanent',
    mandatory: false,
    reason: enterTappedIfCopied
      ? `You may have this enter tapped as a copy of any ${scope}`
      : `You may have this enter as a copy of any ${scope}`,
    copyType: classified.copyType,
    copyTypes: classified.copyTypes,
    controllerOnly: classified.controllerOnly,
    enterTappedIfCopied,
  };
}

export function mergeOptionalEntersAsCopyFallback<T extends { kind?: string }>(
  oracleText: string,
  requirements: T[],
): T[] {
  const fallback = parseOptionalEntersAsCopyOracle(oracleText);
  if (!fallback) return requirements;
  const without = (requirements || []).filter((req) => req.kind !== 'copy_permanent');
  return [...without, fallback as unknown as T];
}
