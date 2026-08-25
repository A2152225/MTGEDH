// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingLoseKeywords.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: opponent lose / as-though-didn't-have keywords
//   (Archetype of Endurance, Glaring Spotlight, Nowhere to Run, Kaya).
// Public entry symbols: pushLoseKeywordSpecs.

import type { StaticEffectScope, StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  parseAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const OPPONENT_LOSE_KEYWORD_RE =
  /(?:^|[.\n;])\s*creatures your opponents control lose ([^.]+)/gi;

const AS_THOUGH_YOU_CONTROL_RE =
  /(?:^|[.\n;])\s*creatures your opponents control(?: with [^.]+?)? can be the targets? of spells and abilities you control as though they didn'?t have ([^.]+)/gi;

const AS_THOUGH_GLOBAL_RE =
  /(?:^|[.\n;])\s*creatures your opponents control(?: with [^.]+?)? can be the targets? of spells and abilities as though they didn'?t have ([^.]+)/gi;

const AS_THOUGH_OPPONENTS_AND_SUBJECTS_RE =
  /(?:^|[.\n;])\s*your opponents and (permanents|creatures) your opponents control(?: with [^.]+?)? can be the targets? of spells and abilities you control as though they didn'?t have ([^.]+)/gi;

const WARD_ABILITIES_DONT_TRIGGER_RE =
  /ward abilities of those creatures don'?t trigger/i;

function isUntilEndOfTurnClause(raw: string): boolean {
  return /until end of turn/i.test(raw);
}

function hasWardAbilitiesDontTrigger(oracle: string): boolean {
  return WARD_ABILITIES_DONT_TRIGGER_RE.test(oracle);
}

function pushKeywordGrant(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  idSuffix: string,
  tail: string,
  scope: StaticEffectScope,
  grantKind: 'remove' | 'asThoughController' | 'asThoughAll',
  extraAbilities: readonly string[] = [],
): void {
  const abilities = parseAbilitiesFromTail(tail);
  for (const extra of extraAbilities) {
    const token = String(extra || '').trim().toLowerCase();
    if (token && !abilities.includes(token)) abilities.push(token);
  }
  if (abilities.length === 0) return;
  const grant = grantKind === 'remove'
    ? { removeAbilities: abilities }
    : grantKind === 'asThoughAll'
      ? { asThoughNoAbilities: abilities }
      : { asThoughNoAbilitiesForController: abilities };
  specs.push(buildSpec(source, idSuffix, scope, grant));
}

function sourceAlreadyHasWardAsThough(
  specs: readonly StaticEffectSpec[],
  sourcePermanentId: string,
): boolean {
  return specs.some((spec) => (
    spec.sourcePermanentId === sourcePermanentId
    && spec.scope.kind === 'opponent_creatures'
    && Array.isArray(spec.grant.asThoughNoAbilities)
    && spec.grant.asThoughNoAbilities.some((ability) => String(ability || '').trim().toLowerCase() === 'ward')
  ));
}

/**
 * Quoted from mtg_data.db (is_token = 0):
 * Archetype: "Creatures your opponents control lose hexproof and can't have or gain hexproof."
 * Spotlight: "…spells and abilities you control as though they didn't have hexproof."
 * Nowhere to Run: "…spells and abilities as though they didn't have hexproof."
 * Kaya: "Your opponents and permanents your opponents control with hexproof can be
 *   the targets of spells and abilities you control as though they didn't have hexproof."
 *
 * Until-EOT activated clauses are skipped (Arcane Lighthouse, Detection Tower).
 * Ward rider ("Ward abilities of those creatures don't trigger.") is encoded as
 * asThoughNoAbilities 'ward' on the same opponent_creatures spec (or a sibling).
 */
export function pushLoseKeywordSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '');
  if (!text) return;

  for (const match of text.matchAll(OPPONENT_LOSE_KEYWORD_RE)) {
    const clause = String(match[0] || '');
    const tail = String(match[1] || '');
    if (isUntilEndOfTurnClause(clause) || isUntilEndOfTurnClause(tail)) continue;
    pushKeywordGrant(
      specs,
      source,
      'opponent-creatures-lose-keywords',
      tail,
      { kind: 'opponent_creatures' },
      'remove',
    );
  }

  for (const match of text.matchAll(AS_THOUGH_YOU_CONTROL_RE)) {
    const clause = String(match[0] || '');
    const tail = String(match[1] || '');
    if (isUntilEndOfTurnClause(clause) || isUntilEndOfTurnClause(tail)) continue;
    pushKeywordGrant(
      specs,
      source,
      'opponent-creatures-as-though-no-keywords',
      tail,
      { kind: 'opponent_creatures' },
      'asThoughController',
    );
  }

  const wardAsThoughExtra = hasWardAbilitiesDontTrigger(text) ? ['ward'] as const : [];

  for (const match of text.matchAll(AS_THOUGH_GLOBAL_RE)) {
    const clause = String(match[0] || '');
    const tail = String(match[1] || '');
    if (isUntilEndOfTurnClause(clause) || isUntilEndOfTurnClause(tail)) continue;
    pushKeywordGrant(
      specs,
      source,
      'opponent-creatures-as-though-no-keywords-all',
      tail,
      { kind: 'opponent_creatures' },
      'asThoughAll',
      wardAsThoughExtra,
    );
  }

  for (const match of text.matchAll(AS_THOUGH_OPPONENTS_AND_SUBJECTS_RE)) {
    const clause = String(match[0] || '');
    const subject = String(match[1] || '').toLowerCase();
    const tail = String(match[2] || '');
    if (isUntilEndOfTurnClause(clause) || isUntilEndOfTurnClause(tail)) continue;
    const permanentScope: StaticEffectScope = subject === 'permanents'
      ? { kind: 'opponent_permanents' }
      : { kind: 'opponent_creatures' };
    const permanentSuffix = subject === 'permanents'
      ? 'opponent-permanents-as-though-no-keywords'
      : 'opponent-creatures-as-though-no-keywords';
    pushKeywordGrant(specs, source, permanentSuffix, tail, permanentScope, 'asThoughController');
    pushKeywordGrant(
      specs,
      source,
      'opponent-players-as-though-no-keywords',
      tail,
      { kind: 'player_opponents' },
      'asThoughController',
    );
  }

  if (hasWardAbilitiesDontTrigger(text) && !sourceAlreadyHasWardAsThough(specs, source.sourcePermanentId)) {
    specs.push(buildSpec(
      source,
      'opponent-creatures-as-though-no-ward',
      { kind: 'opponent_creatures' },
      { asThoughNoAbilities: ['ward'] },
    ));
  }
}
