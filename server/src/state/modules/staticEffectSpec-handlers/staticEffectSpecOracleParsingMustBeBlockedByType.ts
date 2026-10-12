// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingMustBeBlockedByType.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: typed “must be blocked by a creature with [keyword] if able”
//   host grants (self / enchanted / equipped). Distinct from plain lure
//   `must_be_blocked_if_able`. Channel / “this turn” / raid are not statics.
// Public entry symbols: MUST_BE_BLOCKED_BY_PREFIX, typedMustBeBlockedAbility,
//   keywordFromMustBeBlockedByAbility, pushMustBeBlockedByTypeSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpec.js';
import {
  ABILITY_WORDS,
  buildSpec,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

export const MUST_BE_BLOCKED_BY_PREFIX = 'must_be_blocked_by_';

const UNTIL_EOT = /\b(?:this turn|this combat|until end of turn)\b/;
const RAID_OR_CONDITIONAL = /\b(?:if you attacked|as long as|threshold)\b/;
const CHANNEL = /\bchannel\b/;

const ABILITY_WORDS_LONGEST_FIRST = [...ABILITY_WORDS].sort((a, b) => b.length - a.length);

export function typedMustBeBlockedAbility(keyword: string): string {
  const slug = String(keyword || '').trim().toLowerCase().replace(/\s+/g, '_');
  return slug ? `${MUST_BE_BLOCKED_BY_PREFIX}${slug}` : '';
}

export function keywordFromMustBeBlockedByAbility(ability: string): string | null {
  const raw = String(ability || '').trim().toLowerCase();
  if (!raw.startsWith(MUST_BE_BLOCKED_BY_PREFIX)) return null;
  const slug = raw.slice(MUST_BE_BLOCKED_BY_PREFIX.length).trim();
  if (!slug) return null;
  return slug.replace(/_/g, ' ');
}

function stripReminderText(text: string): string {
  return String(text || '').replace(/\([^)]*\)/g, ' ');
}

function splitOracleSentences(text: string): string[] {
  return stripReminderText(text)
    .split(/(?:\n+|[.!;]+)/)
    .map((sentence) => sentence.replace(/^[\s—–-]+/, '').trim())
    .filter((sentence) => sentence.length > 0);
}

function typeLineOf(perm: BattlefieldPermanent): string {
  return String((perm as any)?.card?.type_line || (perm as any)?.type_line || '').toLowerCase();
}

function sourceIsCreature(perm: BattlefieldPermanent): boolean {
  const typeLine = typeLineOf(perm);
  return typeLine.includes('creature') || typeLine.includes('kindred') || typeLine.includes('tribal');
}

function sourceIsAttachment(perm: BattlefieldPermanent): boolean {
  const typeLine = typeLineOf(perm);
  return typeLine.includes('aura') || typeLine.includes('equipment');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordFromTypedMustBlockSentence(sentence: string): string | null {
  const lower = String(sentence || '').toLowerCase();
  // Cheap guard: this runs for every sentence of every permanent on each static recompute,
  // and building one RegExp per ability word dominated mass-token boards.
  if (!lower.includes('must be blocked by a creature with')) return null;
  for (const ability of ABILITY_WORDS_LONGEST_FIRST) {
    const pattern = new RegExp(
      `\\bmust be blocked by a creature with ${escapeRegExp(ability)} if able\\b`,
    );
    if (pattern.test(lower)) return ability;
  }
  return null;
}

type MustBlockHost = 'enchanted' | 'equipped' | 'self' | 'self_or_enchanted';

function resolveMustBlockHost(
  sentence: string,
  perm: BattlefieldPermanent,
): MustBlockHost | null {
  if (/this creature or enchanted creature/.test(sentence)) return 'self_or_enchanted';
  if (/enchanted creature/.test(sentence)) return 'enchanted';
  if (/equipped creature/.test(sentence)) return 'equipped';
  if (/this creature/.test(sentence)) return 'self';
  if (/\bit\b/.test(sentence) && /enchanted/.test(sentence)) return 'enchanted';
  if (/\bit\b/.test(sentence) && /equipped creature/.test(sentence)) return 'equipped';
  if (sourceIsAttachment(perm)) return null;
  if (sourceIsCreature(perm)) return 'self';
  return null;
}

function hostIdSuffix(host: MustBlockHost, keyword: string): string {
  const grant = `must-be-blocked-by-${keyword.replace(/\s+/g, '-')}`;
  if (host === 'enchanted') return `enchanted-${grant}`;
  if (host === 'equipped') return `equipped-${grant}`;
  if (host === 'self_or_enchanted') return `self-or-enchanted-${grant}`;
  return `self-${grant}`;
}

function pushHostAbilityGrant(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  hostPermanentId: string,
  idSuffix: string,
  ability: string,
): void {
  if (!hostPermanentId) return;
  specs.push({
    ...buildSpec(
      source,
      idSuffix,
      { kind: 'self' },
      { abilities: [ability] },
    ),
    sourcePermanentId: hostPermanentId,
    scope: { kind: 'self' },
  });
}

function pushResolvedGrant(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  attachedTo: string,
  host: MustBlockHost,
  keyword: string,
): void {
  const ability = typedMustBeBlockedAbility(keyword);
  if (!ability) return;
  const idSuffix = hostIdSuffix(host, keyword);

  if (host === 'enchanted' || host === 'equipped') {
    pushHostAbilityGrant(specs, source, attachedTo, idSuffix, ability);
    return;
  }

  if (host === 'self_or_enchanted') {
    if (attachedTo) {
      pushHostAbilityGrant(specs, source, attachedTo, idSuffix, ability);
      return;
    }
    specs.push(buildSpec(
      source,
      idSuffix,
      { kind: 'self' },
      { abilities: [ability] },
    ));
    return;
  }

  specs.push(buildSpec(
    source,
    idSuffix,
    { kind: 'self' },
    { abilities: [ability] },
  ));
}

/**
 * "[host] must be blocked by a creature with [keyword] if able".
 * Grants `must_be_blocked_by_<keyword>` on the host, not a card name.
 * Channel / "this turn" / raid / as-long-as stay unparsed.
 */
export function pushMustBeBlockedByTypeSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '');
  if (!text) return;

  const attachedTo = String((perm as any).attachedTo || '').trim();
  const seen = new Set<string>();

  for (const sentence of splitOracleSentences(text)) {
    if (CHANNEL.test(sentence)) continue;
    if (UNTIL_EOT.test(sentence)) continue;
    if (RAID_OR_CONDITIONAL.test(sentence)) continue;

    const keyword = keywordFromTypedMustBlockSentence(sentence);
    if (!keyword) continue;

    const host = resolveMustBlockHost(sentence, perm);
    if (!host) continue;

    const grantKey = `${host}:${keyword}:${attachedTo || source.sourcePermanentId}`;
    if (seen.has(grantKey)) continue;
    seen.add(grantKey);

    pushResolvedGrant(specs, source, attachedTo, host, keyword);
  }
}
