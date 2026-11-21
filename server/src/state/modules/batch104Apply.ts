// server/src/state/modules/batch104Apply.ts
// B104 live hooks: chosen-quality haste, Graxiplon/Stature/Masako block,
// Dream Leash targeting, Winter Moon is in untapStepLimits, counted P/T,
// type additions, Archon cast lock, attachment attack/block lock,
// Uncivil/Hostility damage, and Swans drawCards registration lives in
// batch103Apply. Public functions are imported by combat, targeting, and PT.

import { applyBatch102PowerToughnessAdjustment } from './batch102Apply.js';
import {
  parseChosenQualityManaValueHaste,
  parseCannotChooseUntappedPermanentAsTarget,
  parseCantBeBlockedUnlessDefenderControlsNSharingType,
  parseEnchantedArtifactCantAttackBlockOrActivate,
  parseTappedCreaturesYouControlCanBlockAsThoughUntapped,
  parseCantBeBlockedIfPowerIsNOrLess,
  parseGetsPTForEachGraveyardWithNCards,
  parseGetsPTForEachAuraYouControlAttachedToCreature,
  parseGetsPTAsLongAsOpponentControlsNonbasicLand,
  parseAllNonlandPermanentsAreLegendary,
  parseLandsYouControlAreTheChosenType,
  parsePlayersCantCastSpellsOfTheChosenType,
  parseCreaturesYouControlButDontOwnAreType,
  parseEnchantedHasBasePowerAndQuoted,
  parseCreatureWithP1P1DealsDoubleDamage,
  parseSpellYouControlDamageToOpponentPrevent,
  parseOpponentsCreaturesAreIllusionAndSacrifice,
} from './batch104Parsers.js';
import { collectBatch104ReplacementSpecsFromState } from './replacementBatch104Collect.js';
import * as batch104Parsers from './batch104Parsers.js';
import { createLongTailStaticSourceFilter, longTailStaticSources, parseExportsOf } from './longTailStaticSourceIndex.js';

const B104_SOURCES = createLongTailStaticSourceFilter('batch104', () => parseExportsOf(batch104Parsers));

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || perm?.typeLine || '');
}

function isCreature(perm: any): boolean {
  return /\bcreature\b/i.test(typeLineOf(perm));
}

function isLand(perm: any): boolean {
  return /\bland\b/i.test(typeLineOf(perm));
}

function isNonbasicLand(perm: any): boolean {
  const tl = typeLineOf(perm);
  return /\bland\b/i.test(tl) && !/\bbasic\b/i.test(tl);
}

function manaValueOf(perm: any): number {
  const card = perm?.card || perm;
  const raw = card?.mana_value ?? card?.manaValue ?? card?.cmc;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function readChosenOddEven(perm: any): 'odd' | 'even' | null {
  const raw = perm?.chosenOddEven
    ?? perm?.card?.chosenOddEven
    ?? perm?.selectorContext?.chosenOddEven
    ?? perm?.notes?.chosenOddEven;
  const n = String(raw || '').toLowerCase().trim();
  return n === 'odd' || n === 'even' ? n : null;
}

export function manaValueMatchesOddEven(mv: number, quality: 'odd' | 'even'): boolean {
  const even = Math.abs(Math.trunc(mv)) % 2 === 0;
  return quality === 'even' ? even : !even;
}

export function batch104CreatureHasChosenQualityHaste(permanent: any, battlefield: any[]): boolean {
  if (!permanent || !isCreature(permanent)) return false;
  const mv = manaValueOf(permanent);
  for (const src of battlefield || []) {
    if (!src || src.phasedOut === true) continue;
    if (!parseChosenQualityManaValueHaste(oracleOf(src))) continue;
    const quality = readChosenOddEven(src);
    if (!quality) continue;
    if (manaValueMatchesOddEven(mv, quality)) return true;
  }
  return false;
}

const CARD_TYPES = new Set([
  'artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land',
  'planeswalker', 'sorcery', 'tribal', 'legendary', 'basic', 'snow', 'world', 'token',
]);

export function creatureTypesOf(perm: any): string[] {
  const tl = typeLineOf(perm).toLowerCase();
  const dash = tl.split(/[\u2014-]/);
  const subtype = (dash.length > 1 ? dash.slice(1).join(' ') : tl).trim();
  const words = subtype.split(/[^a-z]+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (CARD_TYPES.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

export function defendingPlayerControlsNSharingCreatureType(
  battlefield: any[],
  defenderId: string,
  n: number,
): boolean {
  if (!(n > 0) || !defenderId) return false;
  const counts = new Map<string, number>();
  for (const perm of battlefield || []) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== String(defenderId)) continue;
    if (!isCreature(perm)) continue;
    for (const typ of creatureTypesOf(perm)) {
      counts.set(typ, (counts.get(typ) || 0) + 1);
      if ((counts.get(typ) || 0) >= n) return true;
    }
  }
  return false;
}

export function batch104BlockRestrictionReason(
  blocker: any,
  attacker: any,
  battlefield: any[] = [],
  blockerControllerId?: string,
  gameState?: unknown,
): string | null {
  if (!attacker) return null;
  const text = oracleOf(attacker);
  const shareN = parseCantBeBlockedUnlessDefenderControlsNSharingType(text);
  if (shareN != null) {
    const defenderId = String(blockerControllerId || blocker?.controller || '');
    if (!defendingPlayerControlsNSharingCreatureType(battlefield, defenderId, shareN)) {
      return `Can't be blocked unless the defending player controls ${shareN} or more creatures that share a creature type`;
    }
  }
  const powerCap = parseCantBeBlockedIfPowerIsNOrLess(text);
  if (powerCap != null) {
    const power = readPower(attacker, gameState);
    if (power <= powerCap) {
      return `Can't be blocked if its power is ${powerCap} or less`;
    }
  }
  if (batch104AttachmentPreventsAttackOrBlock(blocker, battlefield, 'block')) {
    return 'Enchanted artifact cannot block';
  }
  return null;
}

function readPower(perm: any, gameState?: unknown): number {
  const cached = Number(perm?.power ?? perm?.currentPower ?? perm?.card?.power);
  if (Number.isFinite(cached)) return cached;
  const printed = Number(perm?.card?.power);
  return Number.isFinite(printed) ? printed : 0;
}

export function batch104TappedCreaturesCanBlockAsThoughUntapped(
  blocker: any,
  battlefield: any[] = [],
): boolean {
  const controller = String(blocker?.controller || '');
  if (!controller) return false;
  return (battlefield || []).some((perm) =>
    perm
    && perm.phasedOut !== true
    && String(perm.controller || '') === controller
    && parseTappedCreaturesYouControlCanBlockAsThoughUntapped(oracleOf(perm)),
  );
}

export function batch104AttachmentPreventsAttackOrBlock(
  perm: any,
  battlefield: any[] = [],
  _mode?: 'attack' | 'block',
): boolean {
  const id = String(perm?.id || '');
  if (!id) return false;
  return (battlefield || []).some((aura) =>
    aura
    && String(aura.attachedTo || '') === id
    && parseEnchantedArtifactCantAttackBlockOrActivate(oracleOf(aura)),
  );
}

export function sourceCannotChooseUntappedPermanentTarget(
  sourceInfo: { oracleText?: string; card?: { oracle_text?: string; oracleText?: string } } | null | undefined,
  target: any,
): boolean {
  if (!sourceInfo) return false;
  const text = String(sourceInfo.oracleText || sourceInfo.card?.oracle_text || sourceInfo.card?.oracleText || '');
  if (!parseCannotChooseUntappedPermanentAsTarget(text)) return false;
  if (!target) return false;
  return target.tapped !== true && target.isTapped !== true;
}

function graveyardCount(state: any, playerId: string): number {
  const z = state?.zones?.[playerId]?.graveyard;
  if (Array.isArray(z)) return z.length;
  const n = Number(state?.zones?.[playerId]?.graveyardCount);
  return Number.isFinite(n) ? n : 0;
}

function playerIds(state: any): string[] {
  if (Array.isArray(state?.players) && state.players.length) {
    return state.players.map((p: any) => String(p?.id || p)).filter(Boolean);
  }
  return Object.keys(state?.zones || {});
}

function opponentHasNonbasicLand(perm: any, state: any): boolean {
  const controller = String(perm?.controller || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((p) =>
    p
    && String(p.controller || '') !== controller
    && isNonbasicLand(p),
  );
}

function auraOnCreatureCount(controllerId: string, state: any): number {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let n = 0;
  for (const aura of battlefield) {
    if (!aura || String(aura.controller || '') !== controllerId) continue;
    if (!/\baura\b/i.test(typeLineOf(aura))) continue;
    const hostId = String(aura.attachedTo || '');
    if (!hostId) continue;
    const host = battlefield.find((p: any) => String(p?.id || '') === hostId);
    if (host && isCreature(host)) n += 1;
  }
  return n;
}

export function batch104PowerToughnessAdjustment(
  perm: any,
  state: any,
): { base?: { power: number; toughness: number }; delta: { power: number; toughness: number } } {
  const delta = { power: 0, toughness: 0 };
  let base: { power: number; toughness: number } | undefined;
  if (!perm) return { delta };
  const selfText = oracleOf(perm);
  const gy = parseGetsPTForEachGraveyardWithNCards(selfText);
  if (gy) {
    let count = 0;
    for (const pid of playerIds(state)) {
      if (graveyardCount(state, pid) >= gy.cards) count += 1;
    }
    delta.power += gy.power * count;
    delta.toughness += gy.toughness * count;
  }
  const landPt = parseGetsPTAsLongAsOpponentControlsNonbasicLand(selfText);
  if (landPt && opponentHasNonbasicLand(perm, state)) {
    delta.power += landPt.power;
    delta.toughness += landPt.toughness;
  }
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const id = String(perm?.id || '');
  for (const aura of battlefield) {
    if (!aura || String(aura.attachedTo || '') !== id) continue;
    const auraText = oracleOf(aura);
    const perAura = parseGetsPTForEachAuraYouControlAttachedToCreature(auraText);
    if (perAura) {
      const n = auraOnCreatureCount(String(aura.controller || ''), state);
      delta.power += perAura.power * n;
      delta.toughness += perAura.toughness * n;
    }
    const baseQuoted = parseEnchantedHasBasePowerAndQuoted(auraText);
    if (baseQuoted) {
      const printedT = Number(perm?.card?.toughness ?? perm?.baseToughness ?? 0) || 0;
      base = { power: baseQuoted.power, toughness: printedT };
    }
  }
  return base ? { base, delta } : { delta };
}

export function applyBatch104PowerToughnessAdjustment(
  perm: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  const after102 = applyBatch102PowerToughnessAdjustment(perm, state, power, toughness);
  const adj = batch104PowerToughnessAdjustment(perm, state);
  let p = after102.power;
  let t = after102.toughness;
  if (adj.base) {
    const printedP = Number(perm?.card?.power ?? perm?.basePower ?? 0) || 0;
    const printedT = Number(perm?.card?.toughness ?? perm?.baseToughness ?? 0) || 0;
    p = p - printedP + adj.base.power;
    t = t - printedT + adj.base.toughness;
  }
  return { power: p + adj.delta.power, toughness: t + adj.delta.toughness };
}

export function batch104AdditionalTypes(perm: any, state: any): string[] {
  const out: string[] = [];
  const controller = String(perm?.controller || '');
  const owner = String(perm?.owner || perm?.card?.owner || '');
  const isOppCreature = isCreature(perm);
  for (const src of longTailStaticSources(state, B104_SOURCES, oracleOf)) {
    if (!src || src.phasedOut === true) continue;
    const text = oracleOf(src);
    const quoted = parseOpponentsCreaturesAreIllusionAndSacrifice(text);
    if (quoted && isOppCreature && String(src.controller || '') && String(src.controller || '') !== controller) {
      if (!out.includes('Illusion')) out.push('Illusion');
    }
    if (parseAllNonlandPermanentsAreLegendary(text) && !isLand(perm)) {
      if (!out.includes('Legendary')) out.push('Legendary');
    }
    if (parseLandsYouControlAreTheChosenType(text) && isLand(perm) && String(src.controller || '') === controller) {
      const chosen = String(src.chosenBasicLandType || src.card?.chosenBasicLandType || '').trim();
      if (chosen) {
        const label = chosen.charAt(0).toUpperCase() + chosen.slice(1);
        if (!out.includes(label)) out.push(label);
      }
    }
    const stolen = parseCreaturesYouControlButDontOwnAreType(text);
    if (stolen && isCreature(perm) && String(src.controller || '') === controller && owner && owner !== controller) {
      const label = stolen.charAt(0).toUpperCase() + stolen.slice(1);
      if (!out.includes(label)) out.push(label);
    }
  }
  return out;
}

function readChosenCardType(perm: any): string {
  return String(
    perm?.chosenCardType
    || perm?.card?.chosenCardType
    || perm?.chosenCreatureType
    || perm?.card?.chosenCreatureType
    || perm?.selectorContext?.chosenCreatureType
    || perm?.selectorContext?.chosenCardType
    || '',
  ).trim().toLowerCase();
}

export function batch104CastRestrictionReason(state: any, playerId: string, spell: any): string | null {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const tl = String(spell?.type_line || spell?.card?.type_line || spell?.typeLine || '').toLowerCase();
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    if (!parsePlayersCantCastSpellsOfTheChosenType(oracleOf(perm))) continue;
    const chosen = readChosenCardType(perm);
    if (!chosen) continue;
    if (new RegExp('\\b' + chosen.replace(/s$/, '') + 's?\\b').test(tl)) {
      return `${perm.card?.name || 'A permanent'} prevents casting ${chosen} spells.`;
    }
  }
  return null;
}

function findPerm(state: any, id: string): any | undefined {
  if (!id) return undefined;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.find((p: any) => String(p?.id || '') === id);
}

export function applyBatch104DamageSideEffects(
  ctx: any,
  damageAmount: number,
  damageDealer: string,
  damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
  isCombatDamage?: boolean,
  opts?: { sourceIsSpell?: boolean },
): { amount: number; modifiers: string[] } | null {
  if (!(Number(damageAmount) > 0)) return null;
  const state = ctx?.state || ctx;
  const specs = collectBatch104ReplacementSpecsFromState(state);
  if (!specs.length) return null;
  const dealer = String(damageDealer || '');
  const receiver = String(damageReceiver || '');
  const sourcePerm = findPerm(state, String(damageSourcePermanentId || ''));

  for (const spec of specs) {
    if (spec.effectId === 'p1p1-creature-deals-double') {
      if (String(spec.sourceController || '') !== dealer) continue;
      const plus = Number(sourcePerm?.counters?.['+1/+1'] || 0);
      if (!sourcePerm || !(plus > 0) || !isCreature(sourcePerm)) continue;
      return {
        amount: damageAmount * 2,
        modifiers: [`${spec.sourceName}: damage is doubled`],
      };
    }
    if (spec.effectId === 'spell-you-control-damage-to-opponent-prevent') {
      if (isCombatDamage) continue;
      if (String(spec.sourceController || '') !== dealer) continue;
      const sourceIsSpell = opts?.sourceIsSpell === true
        || ctx?.sourceIsSpell === true
        || String((ctx as any)?.damageSourceType || '').toLowerCase() === 'spell';
      if (!sourceIsSpell && sourcePerm) continue;
      if (!sourceIsSpell && !opts?.sourceIsSpell && ctx?.sourceIsSpell !== true) {
        // Allow tests / noncombat spell damage when no permanent source is supplied.
        if (sourcePerm) continue;
      }
      const opponents = playerIds(state).filter((id) => id && id !== dealer);
      if (!opponents.includes(receiver)) continue;
      return {
        amount: 0,
        modifiers: [`${spec.sourceName}: prevented ${damageAmount} damage`],
      };
    }
  }
  return null;
}
