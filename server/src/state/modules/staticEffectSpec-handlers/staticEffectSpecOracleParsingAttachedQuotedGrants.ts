// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingAttachedQuotedGrants.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: Aura / Equipment / Fortification hosts granted a quoted ability
// (Pemmin's Aura-style "Enchanted creature has \"{T}: ...\"", Fire Whip,
// Utopia Sprawl-style land auras, "Equipped creature gets +1/+1 and has \"...\"").
// Public entry symbols: pushAttachedQuotedAbilityGrantSpecs.
//
// Only the quoted ability text is granted here. The "+N/+N" and plain keyword
// parts of the same sentence stay with the attached-host P/T / keyword reader,
// so nothing is applied twice.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpec.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const ATTACHED_QUOTED_GRANT_RE =
  /\b(?:enchanted|equipped|fortified) (?:creature|land|permanent|artifact|planeswalker)(?: gets [+-]\d+\/[+-]\d+(?:,? and)?)?(?: and)? (?:has|is an? [a-z ]+? with) ((?:[a-z, ]*?"[^"]+"(?:,? (?:and )?)?)+)/gi;

export function extractAttachedQuotedGrants(oracle: string): string[] {
  const found: string[] = [];
  for (const match of String(oracle || '').matchAll(ATTACHED_QUOTED_GRANT_RE)) {
    for (const quoted of String(match[1] || '').matchAll(/"([^"]+)"/g)) {
      const text = String(quoted[1] || '').trim();
      if (text && !found.includes(text)) found.push(text);
    }
  }
  return found;
}

export function pushAttachedQuotedAbilityGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostPermanentId = String((perm as any)?.attachedTo || '').trim();
  if (!hostPermanentId) return;
  const abilities = extractAttachedQuotedGrants(oracle);
  if (abilities.length === 0) return;
  specs.push({
    ...buildSpec(source, 'attached-quoted-ability-grant', { kind: 'self' }, { abilities }),
    sourcePermanentId: hostPermanentId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}
