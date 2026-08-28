// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: buildNameReferenceAliases.
// Public entry: buildNameReferenceAliases.

import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';

export function buildNameReferenceAliases(value: string): readonly string[] {
  const normalized = normalizeSelfReferenceText(value);
  if (!normalized) return [];

  const aliases = new Set<string>();
  aliases.add(normalized);
  for (const face of normalized.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    aliases.add(face);
    const commaHead = String(face.split(',')[0] || '').trim();
    // 3 letters covers planeswalker shorthand (Ral, Oko); 2-letter heads stay excluded.
    if (commaHead.length >= 3) aliases.add(commaHead);
  }

  return [...aliases];
}

