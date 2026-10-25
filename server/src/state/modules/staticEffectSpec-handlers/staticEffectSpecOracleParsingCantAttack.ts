// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingCantAttack.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster: continuous host combat locks (Pacifism / Bound in Silence) and
// {T}-cost activation locks (Serra Bestiary). Mass Katabatic tap lock uses
// the same CANT_ACTIVATE_TAP_ABILITIES token via appendTapActivationLockAbility.
// Public entry symbols: CANT_ATTACK, CANT_BLOCK, CANT_ACTIVATE_TAP_ABILITIES,
// sentenceHasTapActivationLock, appendTapActivationLockAbility, pushCantAttackBlockSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

export const CANT_ATTACK = "can't attack";
export const CANT_BLOCK = "can't block";
/** Katabatic / Serra Bestiary: activated abilities with {T} in their costs. */
export const CANT_ACTIVATE_TAP_ABILITIES = "can't activate tap abilities";

export function sentenceHasTapActivationLock(sentence: string): boolean {
  return /activated abilities with \{T\} in (?:their|its) costs can(?:not|'t)\s+be activated/i
    .test(String(sentence || ''));
}

export function appendTapActivationLockAbility(abilities: string[], sentence: string): string[] {
  if (!sentenceHasTapActivationLock(sentence)) return abilities;
  if (!abilities.includes(CANT_ACTIVATE_TAP_ABILITIES)) {
    abilities.push(CANT_ACTIVATE_TAP_ABILITIES);
  }
  return abilities;
}

const UNTIL_EOT = /\b(?:this turn|this combat|until end of turn)\b/;
const PILLOWFORT = /\bunless\b|\bpays?\s*\{|\bcan't attack you\b/;

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

type CombatLockHost = 'enchanted' | 'equipped' | 'self';

function resolveCombatLockHost(sentence: string, perm: BattlefieldPermanent): CombatLockHost | null {
  if (/\benchanted (?:creature|permanent)\b/.test(sentence)) return 'enchanted';
  if (/\bequipped creature\b/.test(sentence)) return 'equipped';
  if (/\bthis creature\b/.test(sentence)) return 'self';
  const typeLine = typeLineOf(perm);
  if (typeLine.includes('aura') || typeLine.includes('equipment')) return null;
  return null;
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
 * Host combat locks: "Enchanted creature can't attack or block."
 * Skips until-EOT / this-turn, pillowfort unless-pay, and "can't attack you".
 * Parsed by oracle sentence, not card name. Mass Moat/Bridge/Peacekeeper
 * families are pushMassCantAttackBlockSpecs.
 */
export function pushCantAttackBlockSpecs(
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
    if (UNTIL_EOT.test(sentence)) continue;
    if (PILLOWFORT.test(sentence)) continue;

    const abilities = appendTapActivationLockAbility(sentenceCombatLockAbilities(sentence), sentence);
    if (abilities.length === 0) continue;

    const host = resolveCombatLockHost(sentence, perm);
    if (!host) continue;

    const hostPermanentId = host === 'self' ? source.sourcePermanentId : attachedTo;
    if (!hostPermanentId) continue;

    const grantKey = `${host}:${abilities.join(',')}:${hostPermanentId}`;
    if (seen.has(grantKey)) continue;
    seen.add(grantKey);

    const idSuffix = host === 'self' ? 'self-combat-lock' : `${host}-combat-lock`;
    specs.push({
      ...buildSpec(
        source,
        idSuffix,
        { kind: 'self' },
        { abilities },
      ),
      sourcePermanentId: hostPermanentId,
      scope: { kind: 'self' },
    });
  }
}
