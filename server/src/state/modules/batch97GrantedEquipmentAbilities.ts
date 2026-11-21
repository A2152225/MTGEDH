// server/src/state/modules/batch97GrantedEquipmentAbilities.ts
// B97: generic "TYPEs you control are Equipment in addition to their other
// types and have \"Equipped creature gets +P/+T,\" equip QUALIFIER {C}, and
// equip {C}." (Gemcutter Buccaneer). Layer 4 already adds the Equipment type.
// This module supplies the granted oracle fragment (P/T + equip abilities)
// and an is-equipment check that sees layer-4 types. Public:
// parseGrantedTreasureEquipmentOracle, grantedEquipmentOracleText,
// permanentIsEquipmentNow, playerMayActivateEquipAtInstantSpeed,
// parseAttackAsThoughHasteGrant.

import { LAYER4_ADDED_TYPES_FIELD } from './layer4TypeSetting.js';
import { parseEquipAbilitiesFromOracle, type ParsedEquipAbility } from '../../../../shared/src/equipAbilities.js';
import { batch107GrantedTypalEquipFragments } from './batch107Apply.js';
import { attachWorthyDefinitionToQualifiers } from '../../../../shared/src/equipWorthy.js';
import { normalizeOraclePatternText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { createLongTailStaticSourceFilter, longTailStaticSources } from './longTailStaticSourceIndex.js';

const GRANTED_EQUIPMENT_SOURCES = createLongTailStaticSourceFilter('batch97GrantedEquipment', () => [parseGrantedTreasureEquipmentOracle]);

const GEMCUTTER_RE = /(?:((?:non[-]?[a-z]+(?:,)?\s+)+))?([a-z]+)s you control are equipment in addition to their other types and have "([^"]+)"/i;
const INSTANT_EQUIP_RE = /you may activate equip abilities any time you could cast an instant/i;
const ATTACK_AS_THOUGH_HASTE_RE = /(?:enchanted|equipped) creature can attack as though it had haste/i;

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function oracleOf(perm: any): string {
  return normalizeOraclePatternText(String(perm?.card?.oracle_text || perm?.oracle_text || '')).replace(/\u2019/g, "'");
}

/** Quoted ability text plus trailing "equip …" clauses after the quote. */
export function parseGrantedTreasureEquipmentOracle(oracle: string): { type: string; fragment: string; excludedTypeWords?: string[] } | null {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const m = text.match(GEMCUTTER_RE);
  if (!m) return null;
  const type = String(m[2] || 'treasure').toLowerCase().replace(/s$/, '');
  const excludedTypeWords = (String(m[1] || '').toLowerCase().match(/non[-]?[a-z]+/g) || [])
    .map((w) => w.replace(/^non-?/, ''))
    .filter(Boolean);
  const afterQuote = text.slice(text.indexOf(m[0]) + m[0].length);
  const trail = afterQuote.split(/\n/)[0].replace(/\s*$/, '');
  const fragment = `${String(m[3] || '').trim().replace(/[.,;]+$/, '')}. ${trail}`.replace(/\s+/g, ' ').trim();
  return { type, fragment, excludedTypeWords };
}

export function grantedEquipmentOracleText(permanent: any, state: any): string {
  if (!permanent) return '';
  const controller = String(permanent.controller || '');
  const tl = typeLineOf(permanent);
  const parts: string[] = [];
  for (const src of longTailStaticSources(state, GRANTED_EQUIPMENT_SOURCES, oracleOf)) {
    if (!src || src.phasedOut === true || String(src.controller || '') !== controller) continue;
    const parsed = parseGrantedTreasureEquipmentOracle(oracleOf(src));
    if (!parsed) continue;
    if (!new RegExp(`\\b${parsed.type}s?\\b`).test(tl)) continue;
    if ((parsed.excludedTypeWords || []).some((w) => w && new RegExp(`\\b${w}\\b`).test(tl))) continue;
    parts.push(parsed.fragment);
  }
  if (state) parts.push(...batch107GrantedTypalEquipFragments(permanent, state));
  return parts.join(' ');
}

export function permanentIsEquipmentNow(permanent: any, state?: any): boolean {
  if (!permanent) return false;
  if (/\bequipment\b/.test(typeLineOf(permanent))) return true;
  const added = permanent?.[LAYER4_ADDED_TYPES_FIELD] || permanent?.layer4AddedTypes || permanent?.grantedTypes;
  if (Array.isArray(added) && added.some((t: any) => String(t || '').toLowerCase() === 'equipment')) return true;
  if (state && grantedEquipmentOracleText(permanent, state)) return true;
  return false;
}

/** Combined printed + granted equip/host text for parsers and P/T bonuses. */
export function equipmentOracleTextWithGrants(permanent: any, state?: any): string {
  const printed = String(permanent?.card?.oracle_text || permanent?.oracle_text || '');
  const granted = state ? grantedEquipmentOracleText(permanent, state) : '';
  return [printed, granted].filter(Boolean).join('\n');
}

export function playerMayActivateEquipAtInstantSpeed(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((src: any) => {
    if (!src || src.phasedOut === true || String(src.controller || '') !== pid) return false;
    return INSTANT_EQUIP_RE.test(oracleOf(src));
  });
}

export function parseAttackAsThoughHasteGrant(oracle: string): boolean {
  return ATTACK_AS_THOUGH_HASTE_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

/** Attached aura/equipment that lets the creature attack as though it had haste. */
export function attachedLetsAttackAsThoughHaste(permanent: any, battlefield: any[]): boolean {
  if (!permanent || !Array.isArray(battlefield)) return false;
  const id = String(permanent.id || '');
  return battlefield.some((src: any) => {
    if (!src || src.phasedOut === true) return false;
    const attached = src.attachedTo === id
      || (Array.isArray(permanent.attachedEquipment) && permanent.attachedEquipment.includes(src.id))
      || (Array.isArray(permanent.attachments) && permanent.attachments.includes(src.id));
    if (!attached) return false;
    return parseAttackAsThoughHasteGrant(oracleOf(src));
  });
}

export function parseEquipAbilitiesForPermanent(permanent: any, state?: any): ParsedEquipAbility[] {
  const text = equipmentOracleTextWithGrants(permanent, state);
  return attachWorthyDefinitionToQualifiers(parseEquipAbilitiesFromOracle(text), text);
}
