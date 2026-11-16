// server/src/state/modules/batch107Apply.ts
// B107 live apply helpers: also-attack, must-attack, types, P/T, keywords,
// typal colorless, typal equip grants, chosen-name land lock, bushido X.
// Public symbols are imported from combat, layer 4, CDA, and color hooks.

import { cardsExiledWithPermanent } from './batch98CombatAndKeywords.js';
import { graveyardHasLessonCard } from './batch100CombatAndKeywords.js';
import {
  normalizeB107Oracle,
  parseAllTypalAreColorless,
  parseCreaturesEnchantedPlayerControlsAttackEachCombatIfAble,
  parseCreaturesYouControlOfChosenTypeOtherThanThisGetPT,
  parseDuringTurnsOtherThanYoursThisIsArtifactCreature,
  parseEnchantedAttackingAloneCantBeBlocked,
  parseEnchantedCantBeBlockedExceptByArtifactAndOrColor,
  parseEquipmentYouControlHaveEquipTypalCost,
  parseExiledWithThisCountGetsPTAndHexproof,
  parseGetsPTAsLongAsItIsntAttackingOrBlocking,
  parseGetsPTIfLessonInGraveyard,
  parseHasBushidoXEqualToAttackingCreatures,
  parseLandsYouControlAreNNCreaturesWithKeywordStillLands,
  parseMagnetCounterAlsoAttackIfAble,
  parseOpponentsCreaturesAttackEachCombatIfAble,
  parsePowerEqualToOnePlusColorCreatureCardsInChosenPlayerGy,
  parsePowerEqualToTappedLandsChosenPlayerControls,
  parseRenownedHasMenace,
  parseSlumberCounterIsLandNotCreature,
  parseSpellsChosenNamesCantBeCastAndLandsCantBePlayed,
  parseVehicleCreaturesYouControlAreChosenType,
  parseVehiclesYouControlGetPTAsLongAsCreature,
  parseYouWouldGetCountersPlusOneEachKind,
  typalEquipGrantFragment,
} from './batch107Parsers.js';


function cardsExiledWithForB107(perm: any, state: any): any[] {
  const direct = cardsExiledWithPermanent(perm, state);
  const id = String(perm?.id || '');
  const extra: any[] = [];
  const zones = state?.zones;
  if (id && zones && typeof zones === 'object') {
    for (const z of Object.values(zones) as any[]) {
      const exile = Array.isArray(z?.exile) ? z.exile : [];
      for (const card of exile) {
        const linked = String(card?.exiledWithSourceId || card?.exiledBy || card?.imprintedBy || card?.linkedPermanentId || '');
        if (linked && linked === id && !direct.includes(card) && !extra.includes(card)) extra.push(card);
      }
    }
  }
  return direct.concat(extra);
}

function oracleOf(perm: any): string {
  return normalizeB107Oracle(String(perm?.card?.oracle_text || perm?.oracle_text || ''));
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function colorsOf(object: any): string[] {
  const raw = Array.isArray(object?.colors) ? object.colors : object?.card?.colors;
  return Array.isArray(raw) ? raw.map((c: unknown) => String(c).toUpperCase()) : [];
}

function counterCount(perm: any, type: string): number {
  const counters = perm?.counters || perm?.card?.counters || {};
  if (typeof counters !== 'object' || !counters) return 0;
  const key = String(type || '').toLowerCase();
  for (const [name, value] of Object.entries(counters)) {
    if (String(name).toLowerCase() === key) return Math.max(0, Number(value) || 0);
  }
  return 0;
}

function battlefieldOf(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}

function chosenPlayerId(perm: any): string {
  return String(
    perm?.chosenPlayer
    || perm?.chosenPlayerId
    || perm?.chosenOpponentId
    || perm?.card?.chosenPlayer
    || perm?.card?.chosenPlayerId
    || '',
  ).trim();
}

function chosenCreatureTypeOf(perm: any): string {
  return String(perm?.chosenCreatureType || perm?.card?.chosenCreatureType || '').trim();
}

function turnPlayerOf(state: any): string {
  return String(state?.activePlayer || state?.turnPlayer || state?.currentPlayer || '').trim();
}

function hasMagnetCounter(perm: any): boolean {
  return counterCount(perm, 'magnet') > 0;
}

function isVehicle(perm: any): boolean {
  return /\bvehicle\b/.test(typeLineOf(perm));
}

function isCreatureTypeLine(perm: any): boolean {
  return /\bcreature\b/.test(typeLineOf(perm))
    || (Array.isArray(perm?.layer4AddedTypes) && perm.layer4AddedTypes.includes('Creature'))
    || perm?.isCreature === true
    || perm?.animated === true;
}

/** True when this creature must also attack because a magnet creature is already attacking. */
export function batch107MustAlsoAttackDueToMagnet(perm: any, state: any): boolean {
  if (!perm || !hasMagnetCounter(perm)) return false;
  const battlefield = battlefieldOf(state);
  if (!battlefield.some((src) => src && src.phasedOut !== true && parseMagnetCounterAlsoAttackIfAble(oracleOf(src)))) {
    return false;
  }
  const selfId = String(perm.id || '');
  return battlefield.some((other) => {
    if (!other || String(other.id || '') === selfId) return false;
    if (other.phasedOut === true) return false;
    return hasMagnetCounter(other) && (other.attacking === true || other.isAttacking === true);
  });
}

export function batch107CreatureMustAttackIfAble(perm: any, state: any): boolean {
  if (!perm) return false;
  const controller = String(perm.controller || '');
  for (const src of battlefieldOf(state)) {
    if (!src || src.phasedOut === true) continue;
    if (parseOpponentsCreaturesAttackEachCombatIfAble(oracleOf(src))) {
      if (controller && controller !== String(src.controller || '')) return true;
    }
    if (parseCreaturesEnchantedPlayerControlsAttackEachCombatIfAble(oracleOf(src))) {
      const enchanted = String(src.attachedTo || src.enchantedPlayer || src.enchantedPlayerId || '');
      if (enchanted && enchanted === controller) return true;
    }
  }
  return false;
}

export function batch107PermanentIsLandNotCreature(perm: any): boolean {
  if (!perm) return false;
  if (!parseSlumberCounterIsLandNotCreature(oracleOf(perm))) return false;
  return counterCount(perm, 'slumber') > 0;
}

export function batch107EffectiveTypeLineOverride(perm: any): string | null {
  if (!batch107PermanentIsLandNotCreature(perm)) return null;
  const base = String(perm?.card?.type_line || perm?.type_line || '');
  const withoutCreature = base
    .replace(/\bCreature\b/gi, '')
    .replace(/\s+—\s+/g, ' — ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/\bland\b/i.test(withoutCreature)) return withoutCreature;
  const [types, subtypes] = withoutCreature.split('—').map((part) => part.trim());
  const nextTypes = [types, 'Land'].filter(Boolean).join(' ');
  return subtypes ? `${nextTypes} — ${subtypes}` : nextTypes;
}

export function batch107AdditionalTypes(perm: any, state: any): string[] {
  const added: string[] = [];
  if (!perm) return added;
  if (batch107PermanentIsLandNotCreature(perm)) {
    added.push('Land');
    return added;
  }
  if (parseDuringTurnsOtherThanYoursThisIsArtifactCreature(oracleOf(perm))) {
    const controller = String(perm.controller || '');
    const turnPlayer = turnPlayerOf(state);
    if (controller && turnPlayer && turnPlayer !== controller) added.push('Creature');
  }
  if (parseLandsYouControlAreNNCreaturesWithKeywordStillLands(oracleOf(perm))) {
    // Source itself is not necessarily a land; applied below via applies-to.
  }
  for (const typ of batch107LandsYouControlAnimationTypes(perm, state)) {
    if (!added.includes(typ)) added.push(typ);
  }
  return added;
}

export function batch107LandsYouControlAnimationTypes(perm: any, state: any): string[] {
  if (!perm || !/\bland\b/.test(typeLineOf(perm))) return [];
  const controller = String(perm.controller || '');
  for (const src of battlefieldOf(state)) {
    if (!src || src.phasedOut === true) continue;
    if (String(src.controller || '') !== controller) continue;
    if (parseLandsYouControlAreNNCreaturesWithKeywordStillLands(oracleOf(src))) return ['Creature'];
  }
  return [];
}

export function batch107GrantedCreatureTypes(perm: any, state: any): string[] {
  const types: string[] = [];
  if (!perm) return types;
  const controller = String(perm.controller || '');
  const selfIsVehicleCreature = isVehicle(perm) && (isCreatureTypeLine(perm) || batch107AdditionalTypes(perm, state).includes('Creature'));
  for (const src of battlefieldOf(state)) {
    if (!src || src.phasedOut === true) continue;
    if (String(src.controller || '') !== controller) continue;
    if (!parseVehicleCreaturesYouControlAreChosenType(oracleOf(src))) continue;
    const chosen = chosenCreatureTypeOf(src);
    if (chosen && selfIsVehicleCreature && !types.some((t) => t.toLowerCase() === chosen.toLowerCase())) {
      types.push(chosen);
    }
  }
  return types;
}

export function applyBatch107PowerToughnessAdjustment(
  perm: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  let p = power;
  let t = toughness;
  if (!perm) return { power: p, toughness: t };
  const controller = String(perm.controller || '');

  const notCombat = parseGetsPTAsLongAsItIsntAttackingOrBlocking(oracleOf(perm));
  if (notCombat && perm.attacking !== true && perm.blocking !== true && !perm.isAttacking && !perm.isBlocking) {
    p += notCombat.power;
    t += notCombat.toughness;
  }

  const lesson = parseGetsPTIfLessonInGraveyard(oracleOf(perm));
  if (lesson && graveyardHasLessonCard(state, controller)) {
    p += lesson.power;
    t += lesson.toughness;
  }

  const exiled = parseExiledWithThisCountGetsPTAndHexproof(oracleOf(perm));
  if (exiled && cardsExiledWithForB107(perm, state).length >= exiled.min) {
    p += exiled.power;
    t += exiled.toughness;
  }

  for (const src of battlefieldOf(state)) {
    if (!src || src.phasedOut === true) continue;
    if (String(src.controller || '') !== controller) continue;
    const vehiclePt = parseVehiclesYouControlGetPTAsLongAsCreature(oracleOf(src));
    if (vehiclePt && isVehicle(perm) && (isCreatureTypeLine(perm) || batch107AdditionalTypes(perm, state).includes('Creature'))) {
      p += vehiclePt.power;
      t += vehiclePt.toughness;
    }
    const lord = parseCreaturesYouControlOfChosenTypeOtherThanThisGetPT(oracleOf(src));
    if (lord && String(src.id || '') !== String(perm.id || '')) {
      const chosen = chosenCreatureTypeOf(src);
      const hasType = chosen && (
        new RegExp(`\\b${chosen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(typeLineOf(perm))
        || batch107GrantedCreatureTypes(perm, state).some((typ) => typ.toLowerCase() === chosen.toLowerCase())
        || (Array.isArray(perm?.grantedCreatureTypes) && perm.grantedCreatureTypes.some((typ: unknown) => String(typ).toLowerCase() === chosen.toLowerCase()))
      );
      if (hasType) {
        p += lord.power;
        t += lord.toughness;
      }
    }
    const landsAnim = parseLandsYouControlAreNNCreaturesWithKeywordStillLands(oracleOf(src));
    if (landsAnim && /\bland\b/.test(typeLineOf(perm))) {
      p = landsAnim.power;
      t = landsAnim.toughness;
    }
  }
  return { power: p, toughness: t };
}

export function calculateBatch107VariablePT(
  card: any,
  oracleTextLower: string,
  perm: any,
  state: any,
  controllerId: string,
): { power: number; toughness: number } | undefined {
  const oracle = String(oracleTextLower || oracleOf(perm) || card?.oracle_text || '');
  const host = perm || card;
  if (parsePowerEqualToTappedLandsChosenPlayerControls(oracle)) {
    const chosen = chosenPlayerId(host);
    if (!chosen) return { power: 0, toughness: 3 };
    const n = battlefieldOf(state).filter((entry) => {
      if (!entry || entry.phasedOut === true) return false;
      if (String(entry.controller || '') !== chosen) return false;
      if (!/\bland\b/.test(typeLineOf(entry))) return false;
      return entry.tapped === true;
    }).length;
    return { power: n, toughness: 3 };
  }
  const gyCda = parsePowerEqualToOnePlusColorCreatureCardsInChosenPlayerGy(oracle);
  if (gyCda) {
    const chosen = chosenPlayerId(host) || String(controllerId || '');
    const gy: any[] = Array.isArray(state?.zones?.[chosen]?.graveyard) ? state.zones[chosen].graveyard : [];
    const colorLetter: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    const wanted = colorLetter[gyCda.color];
    const count = gy.filter((entry) => {
      const tl = String(entry?.type_line || entry?.card?.type_line || '').toLowerCase();
      if (!/\bcreature\b/.test(tl)) return false;
      const cols = colorsOf(entry);
      return wanted ? cols.includes(wanted) : false;
    }).length;
    return { power: gyCda.plus + count, toughness: 2 };
  }
  return undefined;
}

export function batch107PermanentHasKeyword(perm: any, state: any, keyword: string): boolean {
  const wanted = String(keyword || '').toLowerCase();
  if (!perm || !wanted) return false;
  if (wanted === 'menace' && parseRenownedHasMenace(oracleOf(perm)) && perm.renowned === true) return true;
  const exiled = parseExiledWithThisCountGetsPTAndHexproof(oracleOf(perm));
  if (wanted === 'hexproof' && exiled && cardsExiledWithForB107(perm, state).length >= exiled.min) return true;
  const controller = String(perm.controller || '');
  for (const src of battlefieldOf(state)) {
    if (!src || src.phasedOut === true) continue;
    if (String(src.controller || '') !== controller) continue;
    const anim = parseLandsYouControlAreNNCreaturesWithKeywordStillLands(oracleOf(src));
    if (anim && /\bland\b/.test(typeLineOf(perm)) && anim.keyword === wanted) return true;
  }
  return false;
}

export function batch107PermanentHasMenace(perm: any, state: any): boolean {
  return batch107PermanentHasKeyword(perm, state, 'menace');
}

export function readBatch107ColorSetting(state: any, object: any): { set: string[]; colorless: boolean } {
  const out = { set: [] as string[], colorless: false };
  if (!state || !object) return out;
  for (const src of battlefieldOf(state)) {
    if (!src || src.phasedOut === true) continue;
    const typal = parseAllTypalAreColorless(oracleOf(src));
    if (!typal) continue;
    const re = new RegExp(`\\b${typal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const tl = typeLineOf(object);
    const granted = batch107GrantedCreatureTypes(object, state);
    if (re.test(tl) || granted.some((typ) => re.test(typ))) {
      out.colorless = true;
      out.set = [];
      return out;
    }
  }
  return out;
}

export function batch107GrantedTypalEquipFragments(permanent: any, state: any): string[] {
  if (!permanent || !/\bequipment\b/.test(typeLineOf(permanent))) return [];
  const controller = String(permanent.controller || '');
  const parts: string[] = [];
  for (const src of battlefieldOf(state)) {
    if (!src || src.phasedOut === true) continue;
    if (String(src.controller || '') !== controller) continue;
    const parsed = parseEquipmentYouControlHaveEquipTypalCost(oracleOf(src));
    if (parsed) parts.push(typalEquipGrantFragment(parsed));
  }
  return parts;
}

export function getBatch107BushidoValue(perm: any, state: any): number | null {
  if (!perm || !parseHasBushidoXEqualToAttackingCreatures(oracleOf(perm))) return null;
  return battlefieldOf(state).filter((entry) => entry && (entry.attacking === true || entry.isAttacking === true)).length;
}

export function chosenNamesLockedByBatch107(state: any): string[] {
  const names: string[] = [];
  const push = (value: unknown) => {
    const text = String(value || '').trim();
    if (text && !names.some((existing) => existing.toLowerCase() === text.toLowerCase())) names.push(text);
  };
  for (const src of battlefieldOf(state)) {
    if (!src || src.phasedOut === true) continue;
    if (!parseSpellsChosenNamesCantBeCastAndLandsCantBePlayed(oracleOf(src))) continue;
    push(src.chosenCardName);
    const many = src.chosenCardNames || src.chosenNames;
    if (Array.isArray(many)) many.forEach(push);
  }
  return names;
}

function normalizeName(name: string): string {
  return String(name || '').trim().toLowerCase();
}

export function isSpellCastingProhibitedByBatch107ChosenNames(state: any, spellName: string): boolean {
  const target = normalizeName(spellName);
  if (!target) return false;
  return chosenNamesLockedByBatch107(state).some((name) => normalizeName(name) === target);
}

export function isLandPlayProhibitedByBatch107ChosenNames(state: any, landName: string): boolean {
  return isSpellCastingProhibitedByBatch107ChosenNames(state, landName);
}

/** Player-counter plus-one (Winding Constrictor). Used from addEnergyCounters and poison writers. */
export function applyBatch107PlayerCounterPlusOne(state: any, playerId: string, amount: number): number {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (n <= 0) return n;
  const pid = String(playerId || '');
  if (!pid) return n;
  const plus = battlefieldOf(state).some((src) => {
    if (!src || src.phasedOut === true) return false;
    if (String(src.controller || '') !== pid) return false;
    return parseYouWouldGetCountersPlusOneEachKind(oracleOf(src));
  });
  return plus ? n + 1 : n;
}


export function isAttackingAloneForBatch107(attacker: any, battlefield: readonly any[]): boolean {
  const controller = String(attacker?.controller || '');
  const attackers = (Array.isArray(battlefield) ? battlefield : []).filter((entry: any) => (
    entry && String(entry.controller || '') === controller && (entry.attacking === true || entry.isAttacking === true)
  ));
  if (attackers.length === 0) return !!(attacker?.attacking || attacker?.isAttacking);
  return attackers.length === 1 && String(attackers[0]?.id) === String(attacker?.id);
}

export function getBatch107BlockRestrictionReason(
  attacker: any,
  blocker: any,
  battlefield: readonly any[],
): string | null {
  if (!attacker || !blocker) return null;
  const attackerId = String(attacker.id || '');
  const auras = (Array.isArray(battlefield) ? battlefield : []).filter((entry: any) => (
    entry && String(entry.attachedTo || '') === attackerId
  ));
  const texts = auras.map((entry: any) => normalizeB107Oracle(String(entry?.card?.oracle_text || entry?.oracle_text || '')));
  const blockerTl = typeLineOf(blocker);
  const blockerIsArtifactCreature = /\bartifact\b/.test(blockerTl) && /\bcreature\b/.test(blockerTl);
  const colorWord: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  for (const text of texts) {
    const exceptColor = parseEnchantedCantBeBlockedExceptByArtifactAndOrColor(text);
    if (exceptColor) {
      const letter = colorWord[exceptColor];
      const colorOk = letter ? colorsOf(blocker).includes(letter) : false;
      if (!blockerIsArtifactCreature && !colorOk) {
        return `Attacker can't be blocked except by artifact creatures and/or ${exceptColor} creatures`;
      }
    }
    if (parseEnchantedAttackingAloneCantBeBlocked(text) && isAttackingAloneForBatch107(attacker, battlefield)) {
      return "Attacker can't be blocked while attacking alone";
    }
  }
  return null;
}
