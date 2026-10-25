/**
 * partnerDeckValidation.ts
 *
 * Rule 702.124 / 903.3c: real partner pairing for deck validation.
 * Reads partner abilities from oracle text and checks a commander pair:
 *  - Partner + Partner (plain), Partner—[text] with the same [text] (incl. Character select)
 *  - Partner with [name] (mutual)
 *  - Friends forever + Friends forever
 *  - Choose a Background + a legendary Background enchantment
 *  - Doctor's companion + a Time Lord Doctor creature
 */
import {
  partner,
  partnerWith,
  partnerWithRequirement,
  friendsForever,
  chooseBackground,
  doctorsCompanion,
  canPartnerTogether,
  type PartnerAbility,
} from './keywordAbilities/partner';

export type PartnerCandidate = {
  readonly cardName: string;
  readonly oracleText?: string;
  readonly typeLine?: string;
};

function lines(text?: string): string[] {
  return String(text || '')
    .split(/\n+/)
    .map((l) => l.replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean);
}

export function parsePartnerAbilities(cardName: string, oracleText?: string): PartnerAbility[] {
  const out: PartnerAbility[] = [];
  for (const line of lines(oracleText)) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^partner with ([^\n(]+?)\.?$/i))) out.push(partnerWith(cardName, m[1].trim()));
    else if ((m = line.match(/^partner\s*(?:\u2014|\u2013|-|\u00e2\u20ac\u201d)\s*(.+?)\.?$/i))) out.push(partnerWithRequirement(cardName, m[1].trim().toLowerCase()));
    else if (/^partner\.?$/i.test(line)) out.push(partner(cardName));
    else if (/^friends forever\.?$/i.test(line)) out.push(friendsForever(cardName));
    else if (/^choose a background\.?$/i.test(line)) out.push(chooseBackground(cardName));
    else if (/^doctor's companion\.?$/i.test(line)) out.push(doctorsCompanion(cardName));
  }
  return out;
}

export function isBackground(c: PartnerCandidate): boolean {
  const t = String(c.typeLine || '');
  return /\blegendary\b/i.test(t) && /\benchantment\b/i.test(t) && /\bbackground\b/i.test(t);
}

export function isDoctor(c: PartnerCandidate): boolean {
  const t = String(c.typeLine || '');
  return /\blegendary\b/i.test(t) && /\bcreature\b/i.test(t) && /\btime lord\b/i.test(t) && /\bdoctor\b/i.test(t);
}

/** True when the commander has any partner-family ability or is a pairing target (Background/Doctor). */
export function candidateHasPartner(c: PartnerCandidate): boolean {
  return parsePartnerAbilities(c.cardName, c.oracleText).length > 0 || isBackground(c) || isDoctor(c);
}

function oneWay(a: PartnerCandidate, b: PartnerCandidate): boolean {
  const aAbilities = parsePartnerAbilities(a.cardName, a.oracleText);
  const bAbilities = parsePartnerAbilities(b.cardName, b.oracleText);
  for (const x of aAbilities) {
    if (x.partnerType === 'choose-background' && isBackground(b)) return true;
    if (x.partnerType === 'doctors-companion' && isDoctor(b)) return true;
    for (const y of bAbilities) if (canPartnerTogether(x, y)) return true;
  }
  return false;
}

export function validatePartnerPair(a: PartnerCandidate, b: PartnerCandidate): boolean {
  return oneWay(a, b) || oneWay(b, a);
}