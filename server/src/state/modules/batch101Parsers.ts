// server/src/state/modules/batch101Parsers.ts
// B101 oracle parsers. Public: the parse* functions exported below.

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

export function parseEssenceEnterAsCopy(oracle: string): boolean {
  return /creatures you control enter as a copy of (?:this creature|~)/i.test(normalize(oracle));
}

export function parseEsixFirstTokensCopy(oracle: string): boolean {
  return /the first time you would create one or more tokens during each of your turns, you may instead choose a creature other than .+ and create that many tokens that are copies of that creature/i.test(normalize(oracle))
    || /the first time you would create one or more tokens during each of your turns, you may instead choose a creature other than ~ and create that many tokens that are copies of that creature/i.test(normalize(oracle));
}

export function parseLandEquilibrium(oracle: string): boolean {
  return /if an opponent who controls at least as many lands as you do would put a land onto the battlefield, that player instead puts that land onto the battlefield then sacrifices a land of their choice/i.test(normalize(oracle));
}

export type RecoverCost =
  | { kind: 'pay_half_life_rounded_up' }
  | { kind: 'pay_life'; amount: number }
  | { kind: 'mana'; cost: string };

export function parseRecoverCost(oracle: string): RecoverCost | null {
  const text = normalize(oracle);
  const m = text.match(/\brecover(?:\s*[\u2014\u2013-]\s*|\s+)([^.(]+)/i);
  if (!m) return null;
  const cost = m[1].trim().replace(/\.$/, '');
  if (/pay half your life, rounded up/i.test(cost)) return { kind: 'pay_half_life_rounded_up' };
  const life = cost.match(/^pay (\d+) life$/i);
  if (life) return { kind: 'pay_life', amount: parseInt(life[1], 10) };
  if (/\{[^}]+\}/.test(cost)) return { kind: 'mana', cost: cost.replace(/\s+/g, '') };
  return { kind: 'mana', cost };
}

export function parseDarkbladeSurveilGrants(oracle: string): boolean {
  return /as long as you(?:'ve| have) surveilled this turn, (?:this creature|~|it) has deathtouch/i.test(normalize(oracle));
}

export function parsePickAxeAsAttachesChoice(oracle: string): boolean {
  return /as this equipment becomes attached to a creature, choose an exiled creature card used to craft this equipment/i.test(normalize(oracle));
}

export function parseEquippedIsCopyOfLastChosen(oracle: string): boolean {
  return /equipped creature is a copy of the last chosen card/i.test(normalize(oracle));
}

export function parseStunCountersCantBeRemovedFromOpponents(oracle: string): boolean {
  return /stun counters can't be removed from permanents your opponents control/i.test(normalize(oracle));
}

export function parseShieldPreventXCreatures(oracle: string): boolean {
  return /if a source would deal damage to equipped creature, prevent x of that damage, where x is the number of creatures you control/i.test(normalize(oracle));
}

export function parseDinosaurGraveyardHasEscape(oracle: string): boolean {
  return /each dinosaur card in your graveyard has escape/i.test(normalize(oracle));
}

export function parseCairnWandererGyKeywords(oracle: string): string[] | null {
  const text = normalize(oracle);
  if (!/as long as a creature card with flying is in a graveyard, .+ has flying/i.test(text)) return null;
  const same = text.match(/the same is true for ([^.]+)/i);
  const extras = same
    ? same[1].split(/,| and /).map((w) => w.trim().toLowerCase()).filter((w) => w && w !== 'and')
    : [];
  return ['flying', ...extras.filter((w) => w !== 'flying')];
}

export function parseOpponentVentureOncePerTurn(oracle: string): boolean {
  return /each opponent can't venture into the dungeon more than once each turn/i.test(normalize(oracle));
}

export function parseCasualtyX(oracle: string): boolean {
  return /\bcasualty\s+x\b/i.test(normalize(oracle));
}

export function parseSolvedIsCreaturePTKeywords(oracle: string): { power: number; toughness: number; types: string[]; keywords: string[] } | null {
  const text = normalize(oracle);
  const m = text.match(/solved\s*[—-]\s*this case is a (\d+)\/(\d+) ([a-z]+) creature with ([a-z]+) and ([a-z]+) in addition to its other types/i);
  if (!m) return null;
  return {
    power: parseInt(m[1], 10),
    toughness: parseInt(m[2], 10),
    types: ['Creature', m[3].charAt(0).toUpperCase() + m[3].slice(1)],
    keywords: [m[4].toLowerCase(), m[5].toLowerCase()],
  };
}

export function parseBludgeonBrawl(oracle: string): boolean {
  return /each noncreature, non-equipment artifact is an equipment with equip \{x\} and "equipped creature gets \+x\/\+0," where x is that artifact's mana value/i.test(normalize(oracle));
}

export function parseChosenPlayerHandPT(oracle: string): boolean {
  return /power and toughness are each equal to the number of cards in the chosen player's hand/i.test(normalize(oracle));
}

export function parseNonlandGraveyardMayhem(oracle: string): boolean {
  return /each nonland card in your graveyard has mayhem/i.test(normalize(oracle));
}

export function recoverCostLabel(cost: RecoverCost): string {
  if (cost.kind === 'pay_half_life_rounded_up') return 'Pay half your life, rounded up';
  if (cost.kind === 'pay_life') return `Pay ${cost.amount} life`;
  return `Pay ${cost.cost}`;
}

export function halfLifeRoundedUp(life: number): number {
  const n = Math.max(0, Math.floor(Number(life) || 0));
  return Math.ceil(n / 2);
}
