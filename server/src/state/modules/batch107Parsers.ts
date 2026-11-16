// server/src/state/modules/batch107Parsers.ts
// B107 oracle parsers (Magnetic Web, Hawkeye, Mechanized Warfare, Winding
// Constrictor player-counters, Syr Gwyn typal equip, Lifecraft Engine, CDAs,
// Seeker, Midnight Mangler, Valgavoth, and cheap onward tails).
// Public: the parse* helpers imported by long-tail, apply, and collect modules.

export function normalizeB107Oracle(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

function n(text: string): string {
  return normalizeB107Oracle(text);
}

/** Magnetic Web: if a magnet-counter creature attacks, all magnet creatures attack if able. */
export function parseMagnetCounterAlsoAttackIfAble(oracle: string): boolean {
  return /if a creature with a magnet counter on it attacks, all creatures with magnet counters on them attack if able/i.test(n(oracle));
}

/** Hawkeye: noncombat damage from a source you control to an opponent / their permanent plus X = this source's power. */
export function parseNoncombatDamagePlusSourcePower(oracle: string): boolean {
  return /if a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, instead it deals that much damage plus [xX], where [xX] is [^.]*(?:power)/i.test(n(oracle));
}

/** Mechanized Warfare: red or artifact source you control deals damage plus N. */
export function parseRedOrArtifactSourceDamagePlusN(oracle: string): number | null {
  const m = n(oracle).match(/if a red or artifact source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus (\d+) instead/i);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

/** Winding Constrictor player line (energy / poison / experience, etc.). */
export function parseYouWouldGetCountersPlusOneEachKind(oracle: string): boolean {
  return /if you would get one or more counters, you get that many plus one of each of those kinds of counters instead/i.test(n(oracle));
}

/** Breathstealer's Crypt — parse only; the pay-or-discard fork is not marked handled here. */
export function parseDrawRevealDiscardCreatureUnlessPayLife(oracle: string): { payLife: number } | null {
  const m = n(oracle).match(/if a player would draw a card, instead they draw a card and reveal it\.? if it's a creature card, that player discards it unless they pay (\d+) life/i);
  if (!m) return null;
  return { payLife: Number(m[1]) || 0 };
}

/** Syr Gwyn: Equipment you control have equip Knight {0}. */
export function parseEquipmentYouControlHaveEquipTypalCost(oracle: string): { typal: string; cost: string } | null {
  const m = n(oracle).match(/equipment you control have equip ([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)*) (\{[^}]+\})/i);
  if (!m) return null;
  return { typal: String(m[1]).trim(), cost: String(m[2]).trim() };
}

export function parseVehicleCreaturesYouControlAreChosenType(oracle: string): boolean {
  return /vehicle creatures you control are the chosen creature type in addition/i.test(n(oracle));
}

export function parseCreaturesYouControlOfChosenTypeOtherThanThisGetPT(oracle: string): { power: number; toughness: number } | null {
  const m = n(oracle).match(/each creature you control of the chosen type other than this (?:vehicle|permanent|creature) gets ([+-]\d+)\s*\/\s*([+-]\d+)/i);
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]) };
}

export function parsePowerEqualToTappedLandsChosenPlayerControls(oracle: string): boolean {
  return /(?:~|'s)?\s*power is equal to the number of tapped lands the chosen player controls/i.test(n(oracle));
}

export function parseEnchantedCantBeBlockedExceptByArtifactAndOrColor(oracle: string): string | null {
  const m = n(oracle).match(/enchanted creature can't be blocked except by artifact creatures and\/or (white|blue|black|red|green) creatures/i);
  return m ? String(m[1]).toLowerCase() : null;
}

export function parseDuringTurnsOtherThanYoursThisIsArtifactCreature(oracle: string): boolean {
  return /during turns other than yours, this (?:vehicle|permanent|artifact) is an artifact creature/i.test(n(oracle));
}

export function parseCardYouDidntControlToOpponentsGyExileInstead(oracle: string): boolean {
  return /if a card you didn't control would be put into an opponent's graveyard from anywhere, exile it instead/i.test(n(oracle));
}

export function parseRenownedHasMenace(oracle: string): boolean {
  return /as long as (?:this creature|this permanent|~|it) is renowned, it has menace/i.test(n(oracle));
}

export function parseSlumberCounterIsLandNotCreature(oracle: string): boolean {
  return /as long as (?:this creature|this permanent|~|arixmethes) has a slumber counter on it, it's a land/i.test(n(oracle));
}

export function parseEnchantedAttackingAloneCantBeBlocked(oracle: string): boolean {
  return /as long as enchanted creature is attacking alone, it can't be blocked/i.test(n(oracle));
}

export function parseSpellsChosenNamesCantBeCastAndLandsCantBePlayed(oracle: string): boolean {
  return /spells with the chosen names can't be cast and lands with the chosen names can't be played/i.test(n(oracle));
}

export function parseAllTypalAreColorless(oracle: string): string | null {
  const m = n(oracle).match(/all ([A-Z][A-Za-z]+)s are colorless/i);
  return m ? String(m[1]) : null;
}

export function parseGetsPTAsLongAsItIsntAttackingOrBlocking(oracle: string): { power: number; toughness: number } | null {
  const m = n(oracle).match(/(?:this creature|this permanent|~|it) gets ([+-]\d+)\s*\/\s*([+-]\d+) as long as it isn't attacking or blocking/i);
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]) };
}

export function parseCounterGateUntapCreaturesDuringOthersUntap(oracle: string): { min: number; counter: string } | null {
  const m = n(oracle).match(/as long as there (?:are|is) (\w+|\d+)(?: or more)? (\w+) counters? on (?:this enchantment|this permanent|~), untap all creatures you control during each other player's untap step/i);
  if (!m) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const raw = String(m[1] || '').toLowerCase();
  const min = words[raw] ?? Math.max(0, parseInt(raw, 10) || 0);
  return min > 0 ? { min, counter: String(m[2] || '').toLowerCase() } : null;
}

export function parseHasBushidoXEqualToAttackingCreatures(oracle: string): boolean {
  return /(?:has )?bushido [xX], where [xX] is the number of attacking creatures/i.test(n(oracle));
}

export function parseOpponentsCreaturesAttackEachCombatIfAble(oracle: string): boolean {
  return /creatures your opponents control attack each combat if able/i.test(n(oracle));
}

export function parseGetsPTIfLessonInGraveyard(oracle: string): { power: number; toughness: number } | null {
  const m = n(oracle).match(/(?:this creature|this permanent|~|it) gets ([+-]\d+)\s*\/\s*([+-]\d+) as long as there(?: is|'s) a lesson card in your graveyard/i);
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]) };
}

export function parseExiledWithThisCountGetsPTAndHexproof(oracle: string): { min: number; power: number; toughness: number } | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const m = n(oracle).match(/as long as there are (\w+|\d+) or more cards exiled with (?:this creature|this permanent|~), it gets ([+-]\d+)\s*\/\s*([+-]\d+) and has hexproof/i);
  if (!m) return null;
  const raw = String(m[1] || '').toLowerCase();
  const min = words[raw] ?? Math.max(0, parseInt(raw, 10) || 0);
  return min > 0 ? { min, power: Number(m[2]), toughness: Number(m[3]) } : null;
}

export function parseCreaturesEnchantedPlayerControlsAttackEachCombatIfAble(oracle: string): boolean {
  return /creatures enchanted player controls attack each combat if able/i.test(n(oracle));
}

export function parseVehiclesYouControlGetPTAsLongAsCreature(oracle: string): { power: number; toughness: number } | null {
  const m = n(oracle).match(/each vehicle you control gets ([+-]\d+)\s*\/\s*([+-]\d+) as long as it's a creature/i);
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]) };
}

export function parseNontokenOpponentCreatureWouldDieExileWithNamedCounter(oracle: string): { counter: string; count: number } | null {
  const m = n(oracle).match(/if a nontoken creature an opponent controls would die, exile that card with an? (\w+) counters? on it instead/i);
  if (!m) return null;
  return { counter: String(m[1] || '').toLowerCase(), count: 1 };
}

export function parseYourMaximumHandSizeIsTwenty(oracle: string): boolean {
  return /your maximum hand size is twenty\b/i.test(n(oracle));
}

export function parseLandWouldEnterSacrificeEachOtherNamed(oracle: string): boolean {
  return /if this land would enter,?\s*instead sacrifice each other permanent named .+? you control,?\s*then put this land onto the battlefield/i.test(n(oracle));
}

export function parseLandsYouControlAreNNCreaturesWithKeywordStillLands(oracle: string): { power: number; toughness: number; keyword: string } | null {
  const m = n(oracle).match(/lands you control are (\d+)\s*\/\s*(\d+) creatures with (first strike|flying|vigilance|haste|trample|lifelink|deathtouch)\.?\s*they're still lands/i);
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]), keyword: String(m[3]).toLowerCase() };
}

export function parsePowerEqualToOnePlusColorCreatureCardsInChosenPlayerGy(oracle: string): { plus: number; color: string } | null {
  const m = n(oracle).match(/(?:~|'s)?\s*power is equal to (\d+) plus the number of (white|blue|black|red|green) creature cards in the chosen player's graveyard/i);
  if (!m) return null;
  return { plus: Number(m[1]), color: String(m[2]).toLowerCase() };
}

export function typalEquipGrantFragment(parsed: { typal: string; cost: string }): string {
  return `Equip ${parsed.typal} ${parsed.cost}.`;
}
