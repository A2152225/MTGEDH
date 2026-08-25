// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingMustBeBlocked.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: lure / must-be-blocked-if-able statics (Lure, Shinen of Life's Roar, Nemesis Mask)
//   plus leftover list / expressible-conditional sentences (Impetus goad lists,
//   Indrik "block it", Gift of the Deity color, Noble Quarry this-or-enchanted,
//   named-self "must be blocked if able").
// Public entry symbols: MUST_BE_BLOCKED_IF_ABLE, ALL_ABLE_CREATURES_MUST_BLOCK,
//   pushMustBeBlockedSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

export const MUST_BE_BLOCKED_IF_ABLE = 'must_be_blocked_if_able';
export const ALL_ABLE_CREATURES_MUST_BLOCK = 'all_able_creatures_must_block';

const COLOR_CONDITION = /(white|blue|black|red|green)/;
const ALL_ABLE_HOST = /all creatures able to block (this creature or enchanted creature|enchanted creature|equipped creature|this creature|it) do so/;
const AT_LEAST_ONE = /must be blocked if able/;
const TYPED_MUST_BE_BLOCKED_BY = /\bmust be blocked by\b/;
const UNTIL_EOT = /\b(?:this turn|this combat|until end of turn)\b/;
const AS_LONG_AS = /\bas long as\b/;

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

/**
 * Only attach conditions the static apply switch already understands.
 * Raid / "if you attacked this turn" (no extra tails) is expressible.
 * Other unknown as-long-as clauses stay unparsed.
 */
function parseExpressibleMustBlockCondition(
  sentence: string,
): StaticEffectCondition | 'unexpressible' | undefined {
  if (!AS_LONG_AS.test(sentence) && !/\bthreshold\b/.test(sentence) && !/\bif you attacked\b/.test(sentence)) {
    return undefined;
  }

  const colorMatch = sentence.match(
    new RegExp(`as long as (?:enchanted |equipped |this )?creature is ${COLOR_CONDITION.source}`),
  );
  if (colorMatch) {
    return { kind: 'target_has_mana_color', color: String(colorMatch[1] || '').toLowerCase() };
  }

  if (/as long as it(?:'s| is) your turn/.test(sentence)) {
    return { kind: 'during_source_controller_turn' };
  }

  if (/as long as .{0,80}?\b(?:is|'s) attacking\b/.test(sentence)) {
    return { kind: 'target_is_attacking' };
  }

  if (/as long as .{0,80}?\b(?:is|'s)(?: your)? ring-bearer\b/.test(sentence)) {
    return { kind: 'target_is_ring_bearer' };
  }

  if (/as long as .{0,80}?\b(?:is|'s) equipped\b/.test(sentence)) {
    return { kind: 'target_is_equipped' };
  }

  if (/\bthreshold\b/.test(sentence) || /seven or more cards in your graveyard/.test(sentence)) {
    return { kind: 'source_controller_has_threshold' };
  }

  // Raid-style “if you attacked this turn” / “if you attacked” with no extra tails.
  if (/\b(?:as long as|if) you attacked(?: this turn)?(?=\s*[,.]|$)/i.test(sentence)) {
    return { kind: 'source_controller_attacked_this_turn' };
  }

  return 'unexpressible';
}

/** Channel / until-EOT duration — not the raid condition window “attacked this turn”. */
function sentenceHasUntilEotDuration(sentence: string): boolean {
  const withoutRaidWindow = sentence.replace(
    /\b(?:as long as|if) you attacked this turn\b/gi,
    ' ',
  );
  return UNTIL_EOT.test(withoutRaidWindow);
}

function sentenceHasAllAbleGrant(sentence: string): boolean {
  return ALL_ABLE_HOST.test(sentence);
}

function sentenceHasAtLeastOneGrant(sentence: string): boolean {
  return AT_LEAST_ONE.test(sentence);
}

/** Same-sentence host keyword already in ABILITY_WORDS (Masamune / Indrik Umbra). */
function sentenceCompanionKeywordAbilities(sentence: string): string[] {
  return /\bhas first strike\b/i.test(sentence) ? ['first strike'] : [];
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

function hostIdSuffix(host: MustBlockHost, allAble: boolean): string {
  const grant = allAble ? 'all-able-must-block' : 'must-be-blocked';
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
  abilities: string[],
  condition?: StaticEffectCondition,
): void {
  if (!hostPermanentId || abilities.length === 0) return;
  specs.push({
    ...buildSpec(
      source,
      idSuffix,
      { kind: 'self' },
      { abilities },
      condition,
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
  allAble: boolean,
  condition?: StaticEffectCondition,
  companionAbilities: string[] = [],
): void {
  const ability = allAble ? ALL_ABLE_CREATURES_MUST_BLOCK : MUST_BE_BLOCKED_IF_ABLE;
  const abilities = [ability, ...companionAbilities];
  const idSuffix = hostIdSuffix(host, allAble);

  if (host === 'enchanted' || host === 'equipped') {
    pushHostAbilityGrant(specs, source, attachedTo, idSuffix, abilities, condition);
    return;
  }

  if (host === 'self_or_enchanted') {
    if (attachedTo) {
      pushHostAbilityGrant(specs, source, attachedTo, idSuffix, abilities, condition);
      return;
    }
    specs.push(buildSpec(
      source,
      idSuffix,
      { kind: 'self' },
      { abilities },
      condition,
    ));
    return;
  }

  specs.push(buildSpec(
    source,
    idSuffix,
    { kind: 'self' },
    { abilities },
    condition,
  ));
}

/**
 * All-able: "All creatures able to block [enchanted / equipped / this / it] … do so."
 * At-least-one: "[host] must be blocked if able" including list tails (+N/+N, goad).
 *
 * Same-sentence "has first strike" is included on the lure grant.
 * Parsed by oracle sentence / expressible `spec.condition`, not card name.
 * Channel / until-EOT "this turn" / typed "must be blocked by …"
 * do not grant. Raid “if you attacked this turn” is expressible.
 */
export function pushMustBeBlockedSpecs(
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
    if (sentenceHasUntilEotDuration(sentence)) continue;
    if (TYPED_MUST_BE_BLOCKED_BY.test(sentence)) continue;

    const allAble = sentenceHasAllAbleGrant(sentence);
    const atLeastOne = sentenceHasAtLeastOneGrant(sentence);
    if (!allAble && !atLeastOne) continue;

    const condition = parseExpressibleMustBlockCondition(sentence);
    if (condition === 'unexpressible') continue;

    const host = resolveMustBlockHost(sentence, perm);
    if (!host) continue;

    const grantKey = `${host}:${allAble ? 'all-able' : 'at-least-one'}:${attachedTo || source.sourcePermanentId}`;
    if (seen.has(grantKey)) continue;
    seen.add(grantKey);

    pushResolvedGrant(
      specs,
      source,
      attachedTo,
      host,
      allAble,
      condition,
      sentenceCompanionKeywordAbilities(sentence),
    );
  }
}
