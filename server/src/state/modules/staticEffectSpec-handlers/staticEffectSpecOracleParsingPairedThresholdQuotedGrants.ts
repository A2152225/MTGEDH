// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingPairedThresholdQuotedGrants.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: quoted ability grants gated on soulbond pairing
// ("As long as ~ is paired with another creature, each of those creatures has
// \"...\"") and threshold-style graveyard counts ("As long as there are seven
// or more cards in your graveyard, ~ has \"...\""). Granted text reaches the
// trigger detectors through getContinuousGrantedAbilitiesForPermanent.
// Public entry symbols: pushPairedAndGraveyardCountQuotedGrantSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpec.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// Soulbond P/T and keyword form: "... each of those creatures gets +1/+1 and has flying."
const PAIRED_GENERAL_RE =
  /\bas long as (?:~|this creature|[^,.]+?) is paired with another creature, (?:each of those creatures|both creatures) ((?:gets?|has|have)\b(?:"[^"]*"|[^."])*)/i;
const GRAVEYARD_RE =
  /\bas long as there are (\w+) or more cards in your graveyard, (?:~|this creature|this permanent|[^,."]+?) (?:has|gains) ((?:"[^"]+"(?:,? (?:and )?)?)+)/i;

function quotedList(raw: string): string[] {
  const out: string[] = [];
  for (const m of String(raw || '').matchAll(/"([^"]+)"/g)) {
    const text = String(m[1] || '').trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function normalize(oracle: string): string {
  return String(oracle || '').replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
}

export function pushPairedAndGraveyardCountQuotedGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = normalize(oracle);

  const partnerId = String((perm as any)?.pairedWith || '').trim();
  const general = text.match(PAIRED_GENERAL_RE);
  if (general && partnerId) {
    const tail = String(general[1] || '');
    const grant: any = {};
    const pt = tail.match(/^gets?\s+([+-]\d+)\s*\/\s*([+-]\d+)/i);
    if (pt) {
      grant.power = parseInt(pt[1], 10);
      grant.toughness = parseInt(pt[2], 10);
    }
    const abilities = [...quotedList(tail), ...parseAbilitiesFromTail(tail)];
    if (abilities.length > 0) grant.abilities = Array.from(new Set(abilities));
    if (grant.power !== undefined || grant.abilities) {
      specs.push(buildSpec(source, 'paired-grant-self', { kind: 'self' }, grant));
      specs.push({
        ...buildSpec(source, 'paired-grant-partner', { kind: 'self' }, grant),
        sourcePermanentId: partnerId,
      });
    }
  }

  const gy = text.match(GRAVEYARD_RE);
  if (gy) {
    const raw = String(gy[1] || '').toLowerCase();
    const amount = Number(raw) || NUMBER_WORDS[raw] || 0;
    const abilities = quotedList(gy[2]);
    if (amount > 0 && abilities.length > 0) {
      specs.push(
        buildSpec(source, 'graveyard-count-quoted-grant', { kind: 'self' }, { abilities }, {
          kind: 'source_controller_graveyard_at_least',
          amount,
        } as any),
      );
    }
  }
}
