// server/src/state/modules/batch109Apply.ts
// B109 live apply: Common Cause, Battle Brawler, Stoic Sphinx, Serpent of
// Yawning Depths, Orcish Conscripts, Viashino Bey, Freyalise's Radiance,
// Absolute Virtue, Ojer Axonil, and Camel.
// Public entry symbols are the exported functions below.

import { permanentIsSnowNow } from './effectiveSnowSupertype.js';
import {
  parseCantAttackUnlessNOtherCreaturesAttack,
  parseCantBlockUnlessNOtherCreaturesBlock,
  parseColorSourceNoncombatDamageRaisedToPower,
  parseControlEitherColorSelfPTAndFirstStrike,
  parseHexproofIfYouHaventCastASpell,
  parseIfThisAttacksAllYouControlAttackIfAble,
  parseNonartifactCreaturesShareAColorPT,
  parsePreventDesertDamageWhileAttacking,
  parseSnowPermanentsDontUntap,
  parseTypalYouControlCantBeBlockedExceptBySameTypal,
  parseYouHaveProtectionFromEachOpponent,
  normalizeB109Oracle,
} from './batch109Parsers.js';

const COLOR_LETTER: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
};

function oracleOf(perm: any): string {
  return normalizeB109Oracle(String(perm?.card?.oracle_text || perm?.oracle_text || ''));
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function battlefieldOf(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}

function isPhased(perm: any): boolean {
  return Boolean(perm && perm.phasedOut === true);
}

function isCreatureish(perm: any): boolean {
  if (!perm || perm.notCreature === true) return false;
  if (perm.isCreature === true) return true;
  if (/\bcreature\b/.test(typeLineOf(perm))) return true;
  return Array.isArray(perm?.layer4AddedTypes) && perm.layer4AddedTypes.includes('Creature');
}

function isArtifact(perm: any): boolean {
  if (/\bartifact\b/.test(typeLineOf(perm))) return true;
  return Array.isArray(perm?.layer4AddedTypes) && perm.layer4AddedTypes.includes('Artifact');
}

function colorLetters(perm: any): string[] {
  const raw = Array.isArray(perm?.colors) ? perm.colors : perm?.card?.colors;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const text = String(entry || '').trim();
    const letter = COLOR_LETTER[text.toLowerCase()]
      || (['W', 'U', 'B', 'R', 'G'].includes(text.toUpperCase()) ? text.toUpperCase() : '');
    if (letter && !out.includes(letter)) out.push(letter);
  }
  return out;
}

function hasColor(perm: any, colorWord: string): boolean {
  const letter = COLOR_LETTER[colorWord] || String(colorWord || '').toUpperCase();
  return colorLetters(perm).includes(letter);
}

function hasCreatureType(perm: any, type: string): boolean {
  const wanted = String(type || '').toLowerCase();
  if (!wanted) return false;
  const tokens = typeLineOf(perm).split(/[^a-z0-9/-]+/).filter(Boolean);
  if (tokens.includes(wanted)) return true;
  const granted = [
    ...(Array.isArray(perm?.batch107GrantedCreatureTypes) ? perm.batch107GrantedCreatureTypes : []),
    ...(Array.isArray(perm?.batch108GrantedCreatureTypes) ? perm.batch108GrantedCreatureTypes : []),
  ];
  return granted.some((typ: unknown) => String(typ).toLowerCase() === wanted);
}

function nonartifactCreatures(battlefield: any[]): any[] {
  return battlefield.filter((perm) => perm && !isPhased(perm) && isCreatureish(perm) && !isArtifact(perm));
}

function allShareAColor(creatures: any[]): boolean {
  if (creatures.length === 0) return false;
  let shared: Set<string> | null = null;
  for (const perm of creatures) {
    const colors = colorLetters(perm);
    if (colors.length === 0) return false;
    shared = shared ? new Set(colors.filter((c) => shared!.has(c))) : new Set(colors);
    if (shared.size === 0) return false;
  }
  return true;
}

function spellsCastBy(state: any, playerId: string): any[] {
  const list = Array.isArray(state?.spellsCastThisTurn) ? state.spellsCastThisTurn : [];
  return list.filter((entry: any) => String(entry?.casterId || entry?.controller || '') === String(playerId));
}

export function playerCastASpellThisTurn(state: any, playerId: string): boolean {
  if (spellsCastBy(state, playerId).length > 0) return true;
  const player = (state?.players || []).find((entry: any) => String(entry?.id || '') === String(playerId));
  return Number(player?.spellsCastThisTurn || 0) > 0;
}

export function playerCastANoncreatureSpellThisTurn(state: any, playerId: string): boolean {
  return spellsCastBy(state, playerId).some((entry: any) => {
    const tl = String(entry?.card?.type_line || entry?.type_line || '').toLowerCase();
    return tl.length > 0 && !/\bcreature\b/.test(tl);
  });
}

export function applyBatch109PowerToughnessAdjustment(
  perm: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  let nextPower = power;
  let nextToughness = toughness;
  if (!perm || !state || !isCreatureish(perm)) return { power: nextPower, toughness: nextToughness };
  const battlefield = battlefieldOf(state);
  const share = allShareAColor(nonartifactCreatures(battlefield));
  if (share && !isArtifact(perm)) {
    for (const src of battlefield) {
      if (!src || isPhased(src)) continue;
      const buff = parseNonartifactCreaturesShareAColorPT(oracleOf(src));
      if (!buff) continue;
      nextPower += buff.power;
      nextToughness += buff.toughness;
    }
  }
  const selfBuff = parseControlEitherColorSelfPTAndFirstStrike(oracleOf(perm));
  if (selfBuff) {
    const controller = String(perm.controller || '');
    const controls = battlefield.some((other) => other && !isPhased(other) && String(other.controller || '') === controller
      && selfBuff.colors.some((color) => hasColor(other, color)));
    if (controls) {
      nextPower += selfBuff.power;
      nextToughness += selfBuff.toughness;
    }
  }
  return { power: nextPower, toughness: nextToughness };
}

export function batch109PermanentHasKeyword(perm: any, state: any, keyword: string): boolean {
  if (!perm || !state) return false;
  const needle = String(keyword || '').toLowerCase().replace(/_/g, ' ').trim();
  if (needle === 'first strike') {
    const buff = parseControlEitherColorSelfPTAndFirstStrike(oracleOf(perm));
    if (buff) {
      const controller = String(perm.controller || '');
      if (battlefieldOf(state).some((other) => other && !isPhased(other) && String(other.controller || '') === controller
        && buff.colors.some((color) => hasColor(other, color)))) return true;
    }
  }
  if (needle === 'hexproof' && parseHexproofIfYouHaventCastASpell(oracleOf(perm))) {
    if (!playerCastASpellThisTurn(state, String(perm.controller || ''))) return true;
  }
  return false;
}

export function batch109AttackSourceForcesOthers(perm: any): boolean {
  return parseIfThisAttacksAllYouControlAttackIfAble(oracleOf(perm));
}

export function batch109AttackRestrictionReason(
  creature: any,
  proposedAttackerIds: readonly string[] | undefined,
  state: any,
): string | null {
  const min = parseCantAttackUnlessNOtherCreaturesAttack(oracleOf(creature));
  if (!min) return null;
  const id = String(creature?.id || '');
  const proposed = (proposedAttackerIds || []).map((entry) => String(entry)).filter(Boolean);
  const others = proposed.length
    ? proposed.filter((entry) => entry !== id).length
    : battlefieldOf(state).filter((perm) => perm && String(perm.id || '') !== id && (perm.attacking === true || (typeof perm.attacking === 'string' && perm.attacking))).length;
  if (others >= min) return null;
  return `${String(creature?.card?.name || 'This creature')} can't attack unless at least ${min} other creatures attack`;
}

export function batch109BlockGroupRestrictionReason(
  assignments: readonly { blockerId?: string }[],
  battlefield: readonly any[],
): string | null {
  const ids = assignments.map((entry) => String(entry?.blockerId || '')).filter(Boolean);
  const unique = new Set(ids);
  for (const id of unique) {
    const blocker = battlefield.find((perm) => perm && String(perm.id || '') === id);
    const min = parseCantBlockUnlessNOtherCreaturesBlock(oracleOf(blocker));
    if (!min) continue;
    if (unique.size - 1 < min) {
      return `${String(blocker?.card?.name || 'This creature')} can't block unless at least ${min} other creatures block`;
    }
  }
  return null;
}

export function getBatch109BlockRestrictionReason(
  attacker: any,
  blocker: any,
  battlefield: readonly any[] = [],
): string | null {
  if (!attacker || !blocker) return null;
  for (const src of battlefield) {
    if (!src || isPhased(src)) continue;
    const types = parseTypalYouControlCantBeBlockedExceptBySameTypal(oracleOf(src));
    if (!types) continue;
    if (String(src.controller || '') !== String(attacker.controller || '')) continue;
    if (!types.some((type) => hasCreatureType(attacker, type))) continue;
    if (!types.some((type) => hasCreatureType(blocker, type))) {
      return `Can't be blocked except by ${types.join(', ')}`;
    }
  }
  return null;
}

export function batch109SnowUntapProhibition(battlefield: readonly any[] | undefined, permanent: any, state?: any): string | null {
  const list = Array.isArray(battlefield) ? battlefield : [];
  const view = state && typeof state === 'object' ? state : { battlefield: list };
  if (!permanentIsSnowNow(view, permanent)) return null;
  const src = list.find((perm) => perm && !isPhased(perm) && parseSnowPermanentsDontUntap(oracleOf(perm)));
  return src ? String(src?.card?.name || 'A permanent') : null;
}

export function playerHasProtectionFromEachOpponent(state: any, playerId: string): boolean {
  const id = String(playerId || '');
  if (!id) return false;
  return battlefieldOf(state).some((perm) => perm && !isPhased(perm)
    && String(perm.controller || '') === id
    && parseYouHaveProtectionFromEachOpponent(oracleOf(perm)));
}

function powerOf(perm: any): number {
  const raw = perm?.power ?? perm?.currentPower ?? perm?.basePower ?? perm?.card?.power;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function sourceColorLetters(state: any, damageSourceId: string): string[] {
  const id = String(damageSourceId || '').trim();
  if (!id) return [];
  const perm = battlefieldOf(state).find((entry) => entry && String(entry.id || '') === id);
  if (perm) return colorLetters(perm);
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  for (const item of stack) {
    if (!item) continue;
    if (String(item.id || '') !== id && String(item.card?.id || '') !== id) continue;
    return colorLetters(item.card || item);
  }
  const resolving = state?.resolvingSpellSource || state?.resolvingSpell;
  if (resolving && (String(resolving.id || '') === id || String(resolving.cardId || '') === id || String(resolving.card?.id || '') === id)) {
    return colorLetters(resolving.card || resolving);
  }
  return [];
}

function isAttacking(perm: any): boolean {
  return perm?.attacking === true || (typeof perm?.attacking === 'string' && perm.attacking.length > 0) || perm?.isAttacking === true;
}

function isDesertSource(state: any, damageSourceId: string): boolean {
  const id = String(damageSourceId || '').trim();
  const perm = battlefieldOf(state).find((entry) => entry && String(entry.id || '') === id);
  if (!perm) return false;
  const tl = typeLineOf(perm);
  const name = String(perm?.card?.name || perm?.name || '').toLowerCase();
  return /\bdesert\b/.test(tl) || /\bdesert\b/.test(name);
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((id) => String(id)) : [];
}

function bandedWith(camel: any, other: any): boolean {
  const camelId = String(camel?.id || '');
  const otherId = String(other?.id || '');
  if (!camelId || !otherId || camelId === otherId) return false;
  const camelIds = [...idList(camel?.bandedWith), ...idList(camel?.band), ...idList(camel?.bandMembers)];
  const otherIds = [...idList(other?.bandedWith), ...idList(other?.band), ...idList(other?.bandMembers)];
  return camelIds.includes(otherId) || otherIds.includes(camelId);
}

export function collectBatch109DamageAdjustments(
  state: any,
  input: {
    damageDealer: string;
    damageReceiver: string;
    damageSourcePermanentId?: string;
    isCombatDamage?: boolean;
    targetPermanentId?: string;
  },
): Array<{ type: 'floor' | 'prevent'; value?: number; source: string; controllerId?: string }> {
  const effects: Array<{ type: 'floor' | 'prevent'; value?: number; source: string; controllerId?: string }> = [];
  const dealer = String(input.damageDealer || '');
  const receiver = String(input.damageReceiver || '');
  const targetId = String(input.targetPermanentId || '').trim();
  const sourceId = String(input.damageSourcePermanentId || '').trim();
  for (const perm of battlefieldOf(state)) {
    if (!perm || isPhased(perm)) continue;
    const raised = parseColorSourceNoncombatDamageRaisedToPower(oracleOf(perm));
    if (raised && !input.isCombatDamage && !targetId && dealer && dealer === String(perm.controller || '') && receiver && receiver !== dealer) {
      const letter = COLOR_LETTER[raised.color];
      if (letter && sourceColorLetters(state, sourceId).includes(letter)) {
        const power = powerOf(perm);
        if (power > 0) {
          effects.push({
            type: 'floor',
            value: power,
            source: String(perm?.card?.name || 'Raise to power'),
            controllerId: String(perm.controller || ''),
          });
        }
      }
    }
    if (parsePreventDesertDamageWhileAttacking(oracleOf(perm)) && isAttacking(perm) && isDesertSource(state, sourceId) && targetId) {
      const target = battlefieldOf(state).find((entry) => entry && String(entry.id || '') === targetId);
      if (target && (String(target.id || '') === String(perm.id || '') || bandedWith(perm, target))) {
        effects.push({
          type: 'prevent',
          source: String(perm?.card?.name || 'Desert damage prevention'),
          controllerId: String(perm.controller || ''),
        });
      }
    }
  }
  return effects;
}

export function defenderConditionCastNoncreatureSpell(cond: string, state: any, controllerId: string): boolean {
  if (cond !== "you've cast a noncreature spell this turn") return false;
  return playerCastANoncreatureSpellThisTurn(state, controllerId);
}
