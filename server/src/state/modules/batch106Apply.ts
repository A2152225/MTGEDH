// server/src/state/modules/batch106Apply.ts
// Live apply helpers for B106: exile-with-named-counters, variable P/T and
// adjustments, afterlife grants, combat requirements, and type additions.
// Public entry symbols are the exported apply* / batch106* functions.

import { gatherCraftedMaterialCards } from './batch102CraftLinkage.js';
import { applyBatch105PowerToughnessAdjustment } from './batch105Apply.js';
import { plusOnePlusOneCounterCount } from './batch100CombatAndKeywords.js';
import { craftPermanentGrantsExiledKeyword } from './batch106CraftGrantedActivated.js';
import {
  parseWouldDieInsteadExileWithNamedCounters,
  parseGetsPlusXPowerGreatestGyCreaturePower,
  parsePowerToughnessEqualToTotalPowerOfCraftExiled,
  parsePowerToughnessEqualToColorsAmongCraftExiled,
  parsePowerToughnessEqualToTwentyMinusHighestLife,
  parsePowerToughnessEqualToNonbasicLandsChosenPlayerControls,
  parsePowerEqualToInstantAndSorceryYouOwnInExileAndGy,
  parseNonlandPermanentsYouControlAreEnchantmentsInAddition,
  parseGetsPlusOneForEachOtherSameName,
  parseCreaturesOfTypeGetPTPerCounterOnThem,
  parseCreaturesYouDontControlGetPTPerCounterOnThem,
  parseEnchantedCanAttackAsThoughItDidntHaveDefender,
  parseAllCreaturesAttackEnchantedControllerIfAble,
  parseCreaturesYouControlCantAttackExceptNamedAndArtifact,
  parseCreaturesWithNamedCountersAttackEachCombatIfAble,
  parseEnchantedCreatureGetsPTAndHasAfterlife,
} from './batch106Parsers.js';

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '');
}

function nameOf(perm: any): string {
  return String(perm?.card?.name || perm?.name || '');
}

function typeLineOf(entry: any): string {
  return String(entry?.type_line || entry?.typeLine || entry?.card?.type_line || '').toLowerCase();
}

function isCreatureCard(entry: any): boolean {
  return /\bcreature\b/i.test(typeLineOf(entry));
}

function printedPower(entry: any): number {
  const face = entry?.card && typeof entry.card === 'object' ? entry.card : entry;
  const n = Number(face?.power ?? entry?.power ?? entry?.basePower);
  return Number.isFinite(n) ? n : 0;
}

function colorCountAmong(cards: any[]): number {
  const colors = new Set<string>();
  for (const card of cards) {
    const face = card?.card && typeof card.card === 'object' ? card.card : card;
    const list = Array.isArray(face?.colors) ? face.colors : Array.isArray(face?.color_identity) ? face.color_identity : [];
    for (const c of list) {
      const letter = String(c || '').toUpperCase();
      if (/^[WUBRG]$/.test(letter)) colors.add(letter);
    }
    const cost = String(face?.mana_cost || face?.manaCost || '');
    for (const letter of cost.match(/[WUBRG]/g) || []) colors.add(letter);
  }
  return colors.size;
}

function graveyardOf(state: any, playerId: string): any[] {
  const pid = String(playerId || '');
  const zones = state?.zones?.[pid]?.graveyard;
  if (Array.isArray(zones)) return zones;
  const player = (Array.isArray(state?.players) ? state.players : []).find((p: any) => String(p?.id) === pid);
  if (Array.isArray(player?.graveyard)) return player.graveyard;
  return [];
}

function exileOf(state: any, playerId: string): any[] {
  const pid = String(playerId || '');
  const zones = state?.zones?.[pid]?.exile;
  if (Array.isArray(zones)) return zones;
  const player = (Array.isArray(state?.players) ? state.players : []).find((p: any) => String(p?.id) === pid);
  if (Array.isArray(player?.exile)) return player.exile;
  return [];
}

function greatestGyCreaturePower(state: any, playerId: string): number {
  let best = 0;
  for (const card of graveyardOf(state, playerId)) {
    const face = card?.card && typeof card.card === 'object' ? card.card : card;
    if (!isCreatureCard(face)) continue;
    best = Math.max(best, printedPower(face));
  }
  return best;
}

function highestLifeTotal(state: any): number {
  const players = Array.isArray(state?.players) ? state.players : [];
  let best = 0;
  if (state?.life && typeof state.life === 'object') {
    for (const value of Object.values(state.life as Record<string, unknown>)) {
      const n = Number(value);
      if (Number.isFinite(n)) best = Math.max(best, n);
    }
  }
  for (const player of players) {
    const n = Number(player?.life);
    if (Number.isFinite(n)) best = Math.max(best, n);
  }
  return best;
}

function chosenPlayerId(perm: any): string {
  return String(perm?.chosenPlayer || perm?.chosenPlayerId || perm?.card?.chosenPlayer || '').trim();
}

function countNonbasicLandsControlledBy(state: any, playerId: string): number {
  const pid = String(playerId || '');
  let n = 0;
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== pid) continue;
    const tl = typeLineOf(perm);
    if (!/\bland\b/.test(tl)) continue;
    if (/\bbasic\b/.test(tl)) continue;
    n += 1;
  }
  return n;
}

function isInstantOrSorcery(entry: any): boolean {
  return /\b(instant|sorcery)\b/i.test(typeLineOf(entry));
}

function countInstantSorceryOwnedInExileAndGy(state: any, playerId: string): number {
  const pid = String(playerId || '');
  let n = 0;
  for (const card of [...graveyardOf(state, pid), ...exileOf(state, pid)]) {
    const face = card?.card && typeof card.card === 'object' ? card.card : card;
    const owner = String(face?.ownerId || face?.owner || card?.ownerId || card?.owner || pid);
    if (owner && owner !== pid) continue;
    if (isInstantOrSorcery(face)) n += 1;
  }
  return n;
}

function sameName(a: any, b: any): boolean {
  const left = nameOf(a).toLowerCase();
  const right = nameOf(b).toLowerCase();
  return !!left && left === right;
}

function counterCount(perm: any, kind: string): number {
  const counters = perm?.counters || {};
  const key = String(kind || '').toLowerCase();
  if (key === '+1/+1' || key === 'p1p1') return plusOnePlusOneCounterCount(perm);
  return Math.max(0, Math.floor(Number(counters[kind] || counters[key] || 0)));
}

function attachmentsOf(perm: any, state: any): any[] {
  const id = String(perm?.id || '');
  if (!id) return [];
  return (Array.isArray(state?.battlefield) ? state.battlefield : []).filter((entry: any) => {
    const attached = String(entry?.attachedTo || entry?.enchanting || '');
    return attached === id;
  });
}

/** Stamp N named counters on the just-exiled card (Darigaaz egg counters, etc.). */
export function applyBatch106NamedCountersOnExiled(ctx: any, object: any, metadata: any): boolean {
  const named = metadata?.namedCountersOnExile;
  const count = Math.floor(Number(named?.count || 0));
  const counter = String(named?.counter || '').trim();
  if (!(count > 0) || !counter) return false;
  const state = ctx?.state || ctx;
  const owner = String(object?.owner || object?.controller || '').trim();
  const cardId = String(object?.card?.id || object?.id || '').trim();
  if (!state || !owner || !cardId) return false;
  const exile: any[] = Array.isArray(state?.zones?.[owner]?.exile) ? state.zones[owner].exile : [];
  const card = exile.find((entry: any) => String(entry?.id || entry?.card?.id || '') === cardId) || null;
  if (!card) return false;
  card.counters = { ...(card.counters || {}), [counter]: (Number(card.counters?.[counter]) || 0) + count };
  return true;
}

export function calculateBatch106VariablePT(
  card: any,
  oracleTextLower: string,
  perm: any,
  state: any,
  controllerId: string,
): { power: number; toughness: number } | undefined {
  const oracle = String(oracleTextLower || oracleOf(perm) || card?.oracle_text || '');
  if (parsePowerToughnessEqualToTotalPowerOfCraftExiled(oracle)) {
    const total = gatherCraftedMaterialCards(state, perm || { card }).reduce((sum, entry) => sum + printedPower(entry), 0);
    return { power: total, toughness: total };
  }
  if (parsePowerToughnessEqualToColorsAmongCraftExiled(oracle)) {
    const n = colorCountAmong(gatherCraftedMaterialCards(state, perm || { card }));
    return { power: n, toughness: n };
  }
  if (parsePowerToughnessEqualToTwentyMinusHighestLife(oracle)) {
    const n = 20 - highestLifeTotal(state);
    return { power: n, toughness: n };
  }
  if (parsePowerToughnessEqualToNonbasicLandsChosenPlayerControls(oracle)) {
    const n = countNonbasicLandsControlledBy(state, chosenPlayerId(perm || card) || controllerId);
    return { power: n, toughness: n };
  }
  if (parsePowerEqualToInstantAndSorceryYouOwnInExileAndGy(oracle)) {
    const n = countInstantSorceryOwnedInExileAndGy(state, controllerId);
    const toughness = Number(card?.toughness);
    return { power: n, toughness: Number.isFinite(toughness) ? toughness : n };
  }
  return undefined;
}

export function batch106PowerToughnessAdjustment(perm: any, state: any): { power: number; toughness: number } {
  let power = 0;
  let toughness = 0;
  const oracle = oracleOf(perm);
  const controller = String(perm?.controller || '');
  if (parseGetsPlusXPowerGreatestGyCreaturePower(oracle)) {
    power += greatestGyCreaturePower(state, controller);
  }
  if (parseGetsPlusOneForEachOtherSameName(oracle)) {
    const extras = (Array.isArray(state?.battlefield) ? state.battlefield : []).filter((other: any) => {
      if (!other || other === perm || other.phasedOut === true) return false;
      if (String(other.controller || '') !== controller) return false;
      if (!isCreatureCard(other)) return false;
      if (String(other.id || '') === String(perm?.id || '')) return false;
      return sameName(other, perm);
    }).length;
    power += extras;
    toughness += extras;
  }
  const typal = parseCreaturesOfTypeGetPTPerCounterOnThem(oracle);
  if (typal && typal.typeWord) {
    // typal is granted by a source; applied below when reading recipients
  }
  for (const src of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!src || src.phasedOut === true) continue;
    const typalGrant = parseCreaturesOfTypeGetPTPerCounterOnThem(oracleOf(src));
    if (typalGrant && isCreatureCard(perm) && (!typalGrant.controllerOnly || String(src.controller || '') === controller)) {
      const typ = typalGrant.typeWord;
      if (typ && new RegExp(`\\b${typ}\\b`, 'i').test(typeLineOf(perm))) {
        const n = counterCount(perm, typalGrant.counter);
        power += typalGrant.power * n;
        toughness += typalGrant.toughness * n;
      }
    }
    const oppGrant = parseCreaturesYouDontControlGetPTPerCounterOnThem(oracleOf(src));
    if (oppGrant && String(src.controller || '') !== controller && isCreatureCard(perm)) {
      const n = counterCount(perm, oppGrant.counter);
      power += oppGrant.power * n;
      toughness += oppGrant.toughness * n;
    }
  }
  return { power, toughness };
}

export function applyBatch106PowerToughnessAdjustment(
  perm: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  const after105 = applyBatch105PowerToughnessAdjustment(perm, state, power, toughness);
  const adj = batch106PowerToughnessAdjustment(perm, state);
  return { power: after105.power + adj.power, toughness: after105.toughness + adj.toughness };
}

export function batch106AdditionalTypes(perm: any, state: any): string[] {
  if (!perm || perm.phasedOut === true) return [];
  const controller = String(perm.controller || '');
  if (/\bland\b/i.test(typeLineOf(perm))) return [];
  for (const src of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!src || src.phasedOut === true) continue;
    if (String(src.controller || '') !== controller) continue;
    if (parseNonlandPermanentsYouControlAreEnchantmentsInAddition(oracleOf(src))) return ['Enchantment'];
  }
  return [];
}

export function batch106CreatureMustAttackIfAble(perm: any, state: any): boolean {
  if (!perm || !isCreatureCard(perm)) return false;
  for (const src of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!src || src.phasedOut === true) continue;
    if (parseAllCreaturesAttackEnchantedControllerIfAble(oracleOf(src))) return true;
    const named = parseCreaturesWithNamedCountersAttackEachCombatIfAble(oracleOf(src));
    if (named && counterCount(perm, named.counter) > 0) return true;
  }
  return false;
}

export function batch106RequiredAttackPlayerId(perm: any, state: any): string | null {
  for (const src of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!src || src.phasedOut === true) continue;
    if (!parseAllCreaturesAttackEnchantedControllerIfAble(oracleOf(src))) continue;
    const hostId = String(src.attachedTo || src.enchanting || '').trim();
    const host = (Array.isArray(state?.battlefield) ? state.battlefield : []).find((entry: any) => String(entry?.id || '') === hostId);
    const pid = String(host?.controller || '').trim();
    if (pid) return pid;
  }
  return null;
}

export function batch106AttackRestrictionReason(attacker: any, defendingPlayerId: string, state: any): string | null {
  if (!attacker || !isCreatureCard(attacker)) return null;
  const controller = String(attacker.controller || '');
  for (const src of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!src || src.phasedOut === true) continue;
    if (String(src.controller || '') !== controller) continue;
    if (!parseCreaturesYouControlCantAttackExceptNamedAndArtifact(oracleOf(src))) continue;
    const allowedName = nameOf(src).toLowerCase();
    const isNamed = sameName(attacker, src) || nameOf(attacker).toLowerCase() === allowedName;
    const isArtifact = /\bartifact\b/i.test(typeLineOf(attacker));
    if (!isNamed && !isArtifact) return `${nameOf(src)} prevents this creature from attacking.`;
  }
  const required = batch106RequiredAttackPlayerId(attacker, state);
  if (required && String(defendingPlayerId || '') && String(defendingPlayerId) !== required) {
    return 'This creature must attack the enchanted creature\'s controller if able.';
  }
  return null;
}

export function batch106CanAttackAsThoughItDidntHaveDefender(permanent: any, state?: any): boolean {
  const sentences = oracleOf(permanent).split(/\r?\n|(?<=\.)\s+/);
  const unconditional = sentences.some((sentence) => (
    /\bcan attack as though it (?:didn't|did not) have defender\b/i.test(sentence)
    && !/\bas long as\b/i.test(sentence)
  ));
  if (unconditional) return true;
  const board = state || { battlefield: [] };
  for (const aura of attachmentsOf(permanent, board)) {
    if (parseEnchantedCanAttackAsThoughItDidntHaveDefender(oracleOf(aura))) return true;
  }
  return false;
}

export function batch106PermanentHasCraftKeyword(permanent: any, state: any, keyword: string): boolean {
  return craftPermanentGrantsExiledKeyword(permanent, state, keyword);
}

/** Granted afterlife N from attached auras and continuous ability grants. */
export function collectGrantedAfterlifeValues(permanent: any, state?: any): number[] {
  const values: number[] = [];
  const push = (raw: string) => {
    for (const match of String(raw || '').matchAll(/\bafterlife\s+(\d+)\b/gi)) {
      const n = Number(match[1]);
      if (n > 0) values.push(n);
    }
  };
  const granted = permanent?.grantedAbilities || permanent?.grantedKeywords || [];
  if (Array.isArray(granted)) {
    for (const entry of granted) push(typeof entry === 'string' ? entry : String(entry?.text || entry?.keyword || ''));
  }
  const board = state || { battlefield: [] };
  for (const aura of attachmentsOf(permanent, board)) {
    const parsed = parseEnchantedCreatureGetsPTAndHasAfterlife(oracleOf(aura));
    if (parsed) values.push(parsed.afterlife);
    else push(oracleOf(aura));
  }
  return values;
}

export function appendGrantedAfterlifeDeathTriggers(permanent: any, controllerId: string, existing: any[], state?: any): any[] {
  const out = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(out.map((trigger) => `${trigger?.effect || ''}::${trigger?.value ?? ''}`));
  for (const value of collectGrantedAfterlifeValues(permanent, state)) {
    const key = `afterlife::${value}`;
    if (seen.has(key) || seen.has(`create_spirit_tokens::${value}`)) continue;
    seen.add(key);
    out.push({
      source: {
        permanentId: String(permanent?.id || ''),
        cardName: nameOf(permanent) || 'Permanent',
        controllerId: String(controllerId || ''),
      },
      effect: 'afterlife',
      triggerType: 'dies',
      mandatory: true,
      requiresChoice: false,
      queueKeywordChoice: false,
      value,
    });
  }
  return out;
}
