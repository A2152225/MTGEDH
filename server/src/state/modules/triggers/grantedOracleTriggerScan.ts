/**
 * Quoted "has/have '<trigger>'" grants (Kosei, Endless Whispers, Aetherspark-style)
 * plus continuous/persisted grants from the statics pipeline. IR and leftover
 * detectors scan these on the recipient, and only while the grant applies.
 * Origin: detectorGrantedOracle.ts mergeDetectorOracleWithContinuousGrants.
 * Public: grantedTriggerTextsForPermanent, oracleTextWithGrantedTriggers,
 *   withRecipientOnBattlefieldForGrantScan.
 */

import { getContinuousGrantedAbilitiesForPermanent } from '../staticEffectSpec.js';
import { persistedGrantedAbilitiesSurvivingLoss } from '../persistedGrantedAbilityLoss.js';

const TRIGGER_LIKE = /\bwhen(?:ever)?\b|\bat the /i;

function addLine(out: Set<string>, text: unknown): void {
  const line = String(text || '').trim();
  if (!line || !TRIGGER_LIKE.test(line)) return;
  out.add(line);
}

function normalizeQuotes(text: string): string {
  return String(text || '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2019/g, "'");
}

function typeLineOf(permanent: any): string {
  return String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
}

function isCreature(permanent: any): boolean {
  return /\bcreature\b/.test(typeLineOf(permanent));
}

function nameOf(permanent: any): string {
  return String(permanent?.card?.name || permanent?.name || '').trim().toLowerCase();
}

function idOf(permanent: any): string {
  return String(permanent?.id || '').trim();
}

function hasAttachment(state: any, recipient: any, kind: 'aura' | 'equipment'): boolean {
  if (kind === 'equipment' && (recipient?.equipped === true || recipient?.card?.equipped === true)) return true;
  if (kind === 'aura' && (recipient?.isEnchanted === true || recipient?.enchanted === true)) return true;
  const rid = idOf(recipient);
  if (!rid) return false;
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return bf.some((perm) => {
    if (String(perm?.attachedTo || perm?.attached_to || '') !== rid) return false;
    const tl = typeLineOf(perm);
    return kind === 'equipment' ? /\bequipment\b/.test(tl) : /\baura\b/.test(tl);
  });
}

function hasAnyCounter(permanent: any): boolean {
  const counters = permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  return Object.values(counters).some((n) => Number(n) > 0);
}

function isAttachedToCreature(permanent: any, state: any): boolean {
  if (permanent?.attachedToCreature === true) return true;
  const tid = String(permanent?.attachedTo || '').trim();
  if (!tid) return false;
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const target = bf.find((perm) => idOf(perm) === tid);
  return Boolean(target && isCreature(target));
}

function grantConditionHolds(raw: string, recipient: any, grantor: any, state: any): boolean {
  const text = String(raw || '').toLowerCase().trim();
  if (!text) return true;
  const parts = text.split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map((p) => p.trim()).filter(Boolean);
  const checks = parts.length ? parts : [text];
  return checks.every((part) => {
    if (/attached to a creature/.test(part)) return isAttachedToCreature(grantor, state) || isAttachedToCreature(recipient, state);
    if (/\benchanted\b/.test(part)) return hasAttachment(state, recipient, 'aura');
    if (/\bequipped\b/.test(part)) return hasAttachment(state, recipient, 'equipment');
    if (/has a counter/.test(part)) return hasAnyCounter(recipient);
    if (/your turn|it's your turn|it is your turn/.test(part)) {
      return String(state?.turnPlayer || state?.activePlayer || '') === String(recipient?.controller || grantor?.controller || '');
    }
    return false;
  });
}

/** A commander permanent: flagged, or listed in its owner's command-zone identity (ids, names, cards). */
function isCommanderRecipient(recipient: any, state: any): boolean {
  if (recipient?.isCommander === true || recipient?.card?.isCommander === true || recipient?.card?.commander === true) return true;
  const info = state?.commandZone?.[String(recipient?.owner || recipient?.controller || '')];
  if (!info) return false;
  const cardId = String(recipient?.card?.id || '').trim();
  const cardName = String(recipient?.card?.name || '').trim().toLowerCase();
  const sameId = (a: string, b: string) => Boolean(a && b) && (a === b || a.startsWith(b + '_') || b.startsWith(a + '_'));
  const ids: string[] = Array.isArray(info.commanderIds) ? info.commanderIds.map((v: unknown) => String(v || '').trim()) : [];
  const names: string[] = Array.isArray(info.commanderNames) ? info.commanderNames.map((v: unknown) => String(v || '').trim().toLowerCase()) : [];
  const cards: any[] = Array.isArray(info.commanderCards) ? info.commanderCards : [];
  return ids.some((id) => sameId(cardId, id))
    || Boolean(cardName && names.includes(cardName))
    || cards.some((c) => sameId(cardId, String(c?.id || '').trim()) || (cardName && String(c?.name || '').trim().toLowerCase() === cardName));
}

function recipientMatchesFilter(filter: string, recipient: any, grantor: any, state?: any): boolean {
  const text = String(filter || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return false;
  // "Commander creatures you own/control": Backgrounds, Cultist of the Absolute.
  const commanderFilter = /^(?:all )?commander creatures?(?: you (own|control))?$/.exec(text);
  if (commanderFilter) {
    if (!isCreature(recipient) || !isCommanderRecipient(recipient, state)) return false;
    const holder = commanderFilter[1] === 'control' ? recipient?.controller : recipient?.owner;
    return !commanderFilter[1] || String(holder || '') === String(grantor?.controller || '');
  }
  if (/^each creature$|^every creature$/.test(text)) return isCreature(recipient);
  if (nameOf(grantor) && (text === nameOf(grantor) || text.endsWith(nameOf(grantor)))) {
    return idOf(recipient) === idOf(grantor) || nameOf(recipient) === nameOf(grantor);
  }
  if (/^this\b|^~|^it\b/.test(text)) {
    return idOf(recipient) === idOf(grantor) || (nameOf(recipient) !== '' && nameOf(recipient) === nameOf(grantor));
  }
  const youControl = /you control/.test(text);
  if (youControl && String(recipient?.controller || '') !== String(grantor?.controller || '')) return false;
  const isOther = /^(?:all |each )?other\b/.test(text);
  if (isOther && (idOf(recipient) === idOf(grantor) || (nameOf(recipient) !== '' && nameOf(recipient) === nameOf(grantor) && idOf(recipient) === ''))) return false;
  const typeWord = text
    .replace(/^all\s+/, '')
    .replace(/^each\s+/, '')
    .replace(/^other\s+/, '')
    .replace(/\s+you control$/, '')
    .replace(/s$/, '')
    .trim();
  if (!typeWord || typeWord === 'permanent') return true;
  if (typeWord === 'creature') return isCreature(recipient);
  return typeLineOf(recipient).includes(typeWord);
}

function extractQuotedGrantsForRecipient(recipient: any, state: any): string[] {
  const out: string[] = [];
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const grantor of bf) {
    const oracle = normalizeQuotes(String(grantor?.card?.oracle_text || grantor?.oracle_text || ''));
    if (!oracle) continue;
    const eachHas = /(?:^|[.\n])\s*each (creature) has "([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = eachHas.exec(oracle))) {
      if (recipientMatchesFilter(`each ${m[1]}`, recipient, grantor)) out.push(m[2].trim());
    }
    const have = /(?:^|[.\n])\s*((?:all |each )?[^.]+?) (?:have|has) "([^"]+)"/gi;
    while ((m = have.exec(oracle))) {
      const lead = String(m[1] || '').trim();
      if (/\b(?:with|create|creates|gain|gains|token)\b/i.test(lead)) continue;
      if (/^as long as\b/i.test(lead)) continue;
      if (recipientMatchesFilter(lead, recipient, grantor, state)) out.push(m[2].trim());
    }
    // "<who> get +N/+N and have flying, "<ability>" and "<ability>"": quoted grants that do not directly follow "have".
    for (const line of oracle.split('\n')) {
      if ((line.match(/"/g) || []).length < 2) continue;
      const verb = /\b(?:have|has)\b/i.exec(line);
      if (!verb) continue;
      const quoteAt = line.indexOf('"');
      if (quoteAt < 0 || line.slice(verb.index + verb[0].length, quoteAt).trim() === '') continue; // handled by the adjacent form
      const lead = line.slice(0, verb.index).replace(/\s+gets?\s+[^"]*?(?:\s+and)?\s*$/i, '').replace(/\s+and\s*$/i, '').trim();
      if (!lead || /\b(?:with|create|creates|gain|gains|token)\b/i.test(lead) || /^as long as\b/i.test(lead)) continue;
      if (!recipientMatchesFilter(lead, recipient, grantor, state)) continue;
      const quoted = /"([^"]+)"/g;
      let q: RegExpExecArray | null;
      while ((q = quoted.exec(line.slice(verb.index)))) out.push(q[1].trim().replace(/[,.]$/, ''));
    }
    const selfAsLong = /as long as (.+), ([^,]+?) has "([^"]+)"/gi;
    while ((m = selfAsLong.exec(oracle))) {
      const who = String(m[2] || '').trim();
      const self = idOf(recipient) === idOf(grantor) || nameOf(recipient) === nameOf(grantor);
      if (!self && !recipientMatchesFilter(who, recipient, grantor)) continue;
      if (!grantConditionHolds(m[1], recipient, grantor, state)) continue;
      out.push(m[3].trim());
    }
    const attachedHas = /as long as [^.]*is attached to a creature,[^.]* has "([^"]+)"/gi;
    while ((m = attachedHas.exec(oracle))) {
      if (idOf(recipient) !== idOf(grantor)) continue;
      if (!grantConditionHolds('is attached to a creature', recipient, grantor, state)) continue;
      out.push(m[1].trim());
    }
  }
  return out;
}

export function withRecipientOnBattlefieldForGrantScan(state: any, permanent: any): any {
  if (!state || typeof state !== 'object') return state;
  const bf: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const id = idOf(permanent);
  if (!id || bf.some((perm) => idOf(perm) === id)) return state;
  return { ...state, battlefield: [...bf, permanent] };
}

export function grantedTriggerTextsForPermanent(permanent: any, gameState?: any): string[] {
  const out = new Set<string>();
  if (gameState) {
    const scanState = withRecipientOnBattlefieldForGrantScan(gameState, permanent);
    try {
      for (const line of getContinuousGrantedAbilitiesForPermanent(permanent, scanState)) addLine(out, line);
    } catch {
      // best-effort: quoted-grant fallback below still applies
    }
    try {
      const persisted = persistedGrantedAbilitiesSurvivingLoss(permanent, scanState.battlefield);
      if (Array.isArray(persisted)) for (const line of persisted) addLine(out, line);
    } catch { /* best-effort */ }
    // Skip raw grantedAbilities: those must go through persistedGrantedAbilitiesSurvivingLoss
    // (Humility timestamps). extractQuotedGrants is only a parser-miss fallback, and must
    // not re-add quotes that a lose-all-abilities effect already stripped from the continuous set.
    const loseAll = (scanState.battlefield || []).some((perm) => /lose all abilities/i.test(String(perm?.card?.oracle_text || perm?.oracle_text || '')));
    if (!loseAll) {
      for (const line of extractQuotedGrantsForRecipient(permanent, scanState)) addLine(out, line);
    }
  }
  return [...out];
}

export function oracleTextWithGrantedTriggers(printedOracle: string, permanent: any, gameState?: any): string {
  const printed = String(printedOracle || '');
  const sentences = printed.split(/\n+/).map((line) => line.trim().toLowerCase()).filter(Boolean);
  const extra = grantedTriggerTextsForPermanent(permanent, gameState)
    .filter((line) => {
      const key = String(line || '').trim().toLowerCase();
      if (!key) return false;
      // Substring matches are not enough: Kosei's quoted grant lives inside the static sentence.
      return !sentences.includes(key);
    });
  return extra.length > 0 ? `${printed}\n${extra.join('\n')}` : printed;
}
