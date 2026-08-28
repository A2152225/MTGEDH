// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: mass continuous combat locks (Moat / Ensnaring Bridge / Katabatic /
// Peacekeeper / Doomed Artisan type-you-control). Host Pacifism grants stay in
// staticEffectSpecOracleParsingCantAttack.ts.
// Public entry: pushMassCantAttackBlockSpecs.

import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpec.js';
import {
  appendTapActivationLockAbility,
  CANT_ATTACK,
  CANT_BLOCK,
} from './staticEffectSpecOracleParsingCantAttack.js';
import {
  ABILITY_WORDS,
  buildSpec,
  parseLordCreatureType,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const UNTIL_EOT = /\b(?:this turn|this combat|until end of turn)\b/;
const PILLOWFORT = /\bunless\b|\bpays?\s*\{|\bcan't attack you\b|\battack you\b/;
const HOST_LOCK = /\benchanted creature\b|\bequipped creature\b|\bthis creature\b/;
const KEYWORD_ALT = [...ABILITY_WORDS]
  .sort((left, right) => right.length - left.length)
  .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

function stripReminderText(text: string): string {
  return String(text || '').replace(/\([^)]*\)/g, ' ');
}

function splitOracleSentences(text: string): string[] {
  return stripReminderText(text)
    .split(/(?:\n+|[.!;]+)/)
    .map((sentence) => sentence.replace(/^[\s—–-]+/, '').trim())
    .filter((sentence) => sentence.length > 0);
}

function combatLockPrefix(sentence: string): string {
  return String(sentence || '').replace(/, and\b.+$/i, '').trim();
}

function sentenceCombatLockAbilities(sentence: string): string[] {
  const abilities: string[] = [];
  const cantAttack = /\bcan(?:not|'t)\s+attack\b/.test(sentence);
  const cantBlock =
    /\bcan(?:not|'t)\s+block\b/.test(sentence)
    || /\battack or block\b/.test(sentence)
    || /\battack, block\b/.test(sentence);
  if (cantAttack) abilities.push(CANT_ATTACK);
  if (cantBlock) abilities.push(CANT_BLOCK);
  return abilities;
}

/**
 * Mass combat locks: "Creatures without flying can't attack."
 * Skips until-EOT, pillowfort unless-pay / can't-attack-you, and host Pacifism text.
 */
export function pushMassCantAttackBlockSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '');
  if (!text) return;

  const seen = new Set<string>();
  for (const rawSentence of splitOracleSentences(text)) {
    if (UNTIL_EOT.test(rawSentence) || PILLOWFORT.test(rawSentence) || HOST_LOCK.test(rawSentence)) {
      continue;
    }
    const sentence = combatLockPrefix(rawSentence);
    const abilities = appendTapActivationLockAbility(
      sentenceCombatLockAbilities(sentence),
      rawSentence,
    );
    if (abilities.length === 0) continue;

    let scope: StaticEffectSpec['scope'] = { kind: 'all_creatures' };
    let condition: StaticEffectCondition | undefined;
    let idSuffix = 'mass-combat-lock';

    const withoutKeyword = sentence.match(
      new RegExp(`^creatures without (${KEYWORD_ALT}) can(?:not|'t)\\s+attack\\b`, 'i'),
    );
    const withKeyword = sentence.match(
      new RegExp(`^creatures with (${KEYWORD_ALT}) can(?:not|'t)\\s+attack\\b`, 'i'),
    );
    const powerVsHand = /^creatures with power greater than the number of cards in your hand can(?:not|'t)\s+attack\b/i
      .test(sentence);
    const typeCreaturesYouControl = sentence.match(
      /^(\w+) creatures you control can(?:not|'t)\s+attack\b/i,
    );
    const typesYouControl = sentence.match(
      /^(\w+)s you control can(?:not|'t)\s+attack\b/i,
    );
    const allCreatures = /^creatures can(?:not|'t)\s+attack(?:\s+or\s+block)?$/i.test(sentence);

    if (withoutKeyword) {
      condition = { kind: 'target_lacks_keyword', keyword: String(withoutKeyword[1]).toLowerCase() };
      idSuffix = 'mass-combat-lock-lacks-keyword';
    } else if (withKeyword) {
      condition = { kind: 'target_has_keyword', keyword: String(withKeyword[1]).toLowerCase() };
      idSuffix = 'mass-combat-lock-has-keyword';
    } else if (powerVsHand) {
      condition = { kind: 'target_power_greater_than_source_controller_hand_size' };
      idSuffix = 'mass-combat-lock-power-vs-hand';
    } else if (typeCreaturesYouControl || typesYouControl) {
      const rawType = String((typeCreaturesYouControl || typesYouControl)?.[1] || '');
      const creatureType = parseLordCreatureType(rawType);
      if (!creatureType || !isCreatureTypeWord(creatureType)) continue;
      scope = { kind: 'creatures_you_control', creatureType };
      idSuffix = 'type-you-control-combat-lock';
    } else if (allCreatures) {
      idSuffix = 'mass-combat-lock-all';
    } else {
      continue;
    }

    const grantKey = `${scope.kind}:${scope.creatureType || ''}:${condition?.kind || ''}:${condition?.keyword || ''}:${abilities.join(',')}`;
    if (seen.has(grantKey)) continue;
    seen.add(grantKey);

    specs.push(buildSpec(source, idSuffix, scope, { abilities }, condition));
  }
}
