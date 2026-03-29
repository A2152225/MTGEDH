import type { BattlefieldPermanent, GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';
import { getCombinedPermanentText } from './permanentText';

export const MODIFY_PT_WHERE_ALIASES: Record<string, string> = {
  "x is the mana value of that spell": "x is that spell's mana value",
  "x is the spell's mana value": "x is that spell's mana value",
  "x is the mana value of this spell": "x is that spell's mana value",
  "x is this spell's mana value": "x is that spell's mana value",
  "x is the mana value of this card": "x is that card's mana value",
  "x is this card's mana value": "x is that card's mana value",
  "x is the mana value of that card": "x is that card's mana value",
  "x is the card's mana value": "x is that card's mana value",
  "x is the amount of excess damage": "x is the amount of excess damage dealt this way",
  "x is the excess damage": "x is the excess damage dealt this way",
  "x is that excess damage": "x is the excess damage dealt this way",
  "x is the amount of excess damage dealt": "x is the amount of excess damage dealt this way",
  "x is the excess damage dealt": "x is the excess damage dealt this way",
  "x is excess damage dealt": "x is the excess damage dealt this way",
  "x is the power of the exiled card": "x is that card's power",
  "x is the toughness of the exiled card": "x is that card's toughness",
  "x is the exiled card's power": "x is that card's power",
  "x is the exiled card's toughness": "x is that card's toughness",
  "x is the exiled card's mana value": "x is that card's mana value",
  "x is the power of the revealed card": "x is that card's power",
  "x is the toughness of the revealed card": "x is that card's toughness",
  "x is the revealed card's power": "x is that card's power",
  "x is the revealed card's toughness": "x is that card's toughness",
  "x is the revealed card's mana value": "x is that card's mana value",
  "x is the power of the discarded card": "x is that card's power",
  "x is the toughness of the discarded card": "x is that card's toughness",
  "x is the discarded card's mana value": "x is that card's mana value",
  "x is the tapped creature's power": "x is that creature's power",
  "x is the tapped creatureâ€™s power": "x is that creature's power",
  "x is the amount of life you have gained this turn": "x is the amount of life you gained this turn",
  "x is the amount of life you've gained this turn": "x is the amount of life you gained this turn",
  "x is the amount of life you have gained": "x is the amount of life you gained",
  "x is the amount of life you've gained": "x is the amount of life you gained",
  "x is the amount of life opponents have gained this turn": "x is the amount of life your opponents have gained this turn",
  "x is the amount of life opponents gained this turn": "x is the amount of life your opponents gained this turn",
  "x is the amount of life opponents have gained": "x is the amount of life your opponents have gained",
  "x is the amount of life opponents gained": "x is the amount of life your opponents gained",
  "x is the amount of life you have lost this turn": "x is the amount of life you lost this turn",
  "x is the amount of life you've lost this turn": "x is the amount of life you lost this turn",
  "x is the amount of life you have lost": "x is the amount of life you lost",
  "x is the amount of life you've lost": "x is the amount of life you lost",
  "x is the amount of life opponents have lost this turn": "x is the amount of life your opponents have lost this turn",
  "x is the amount of life opponents lost this turn": "x is the amount of life your opponents lost this turn",
  "x is the amount of life opponents have lost": "x is the amount of life your opponents have lost",
  "x is the amount of life opponents lost": "x is the amount of life your opponents lost",
  "x is the total amount of life your opponents have lost this turn": "x is the amount of life your opponents have lost this turn",
  "x is the total amount of life your opponents lost this turn": "x is the amount of life your opponents lost this turn",
  "x is the total amount of life your opponents have lost": "x is the amount of life your opponents have lost",
  "x is the total amount of life your opponents lost": "x is the amount of life your opponents lost",
  "x is the number of spells opponents have cast this turn": "x is the number of spells your opponents have cast this turn",
  "x is the number of spells opponents cast this turn": "x is the number of spells your opponents cast this turn",
  "x is the number of lands opponents have played this turn": "x is the number of lands your opponents have played this turn",
  "x is the number of lands opponents played this turn": "x is the number of lands your opponents played this turn",
  "x is the number of cards opponents have drawn this turn": "x is the number of cards your opponents have drawn this turn",
  "x is the number of cards opponents drew this turn": "x is the number of cards your opponents drew this turn",
  "x is the number of cards opponents have discarded this turn": "x is the number of cards your opponents have discarded this turn",
  "x is the number of cards opponents discarded this turn": "x is the number of cards your opponents discarded this turn",
  "x is the number of permanents opponents have sacrificed this turn": "x is the number of permanents your opponents have sacrificed this turn",
  "x is the number of permanents opponents sacrificed this turn": "x is the number of permanents your opponents sacrificed this turn",
  "x is the amount of mana spent to cast this creature": "x is the amount of mana spent to cast this spell",
  "x is the amount of mana spent to cast that creature": "x is the amount of mana spent to cast that spell",
  "x is the number of bobbleheads you control as you activate this ability": "x is the number of bobbleheads you control",
  "x is the number of cards in target opponent's hand": "x is the number of cards in their hand",
  "x is the number of cards in target opponentâ€™s hand": "x is the number of cards in their hand",
  "x is the number of cards in target opponent's graveyard": "x is the number of cards in their graveyard",
  "x is the number of cards in target opponentâ€™s graveyard": "x is the number of cards in their graveyard",
  "x is the number of cards in target opponent's library": "x is the number of cards in their library",
  "x is the number of cards in target opponentâ€™s library": "x is the number of cards in their library",
  "x is the number of cards in target opponent's exile": "x is the number of cards in their exile",
  "x is the number of cards in target opponentâ€™s exile": "x is the number of cards in their exile",
  "x is the number of cards in all graveyards with the same name as the spell": "x is the number of cards in all graveyards with the same name as that spell",
  "x is the number of cards in all graveyards with the same name as this spell": "x is the number of cards in all graveyards with the same name as that spell",
  "x is the mana value of the sacrificed artifact": "x is the sacrificed artifact's mana value",
  "x is the exiled creature's mana value": "x is that card's mana value",
  "x is the mana value of the exiled creature": "x is that card's mana value",
  "x is half the creature's power": "x is half that creature's power",
  "x is that artifact's mana value": "x is that card's mana value",
  "x is that enchantment's mana value": "x is that card's mana value",
  "x is that saga's mana value": "x is that card's mana value",
  "x is the mana value of that artifact": "x is that card's mana value",
  "x is the mana value of that enchantment": "x is that card's mana value",
  "x is the mana value of that creature": "x is that card's mana value",
  "x is the milled card's mana value": "x is that card's mana value",
  "x is the mana value of the milled card": "x is that card's mana value",
  "x is the mana value of the returned creature": "x is that card's mana value",
  "x is the returned creature's mana value": "x is that card's mana value",
  "x is the mana value of the permanent exiled this way": "x is that card's mana value",
  "x is the permanent exiled this way's mana value": "x is that card's mana value",
  "x is the mana value of your precious": "x is that card's mana value",
  "x is the amount of mana spent to cast her": "x is the amount of mana spent to cast this spell",
  "x is the amount of mana spent to cast it": "x is the amount of mana spent to cast this spell",
  "x is the amount of mana spent to cast jeleva": "x is the amount of mana spent to cast this spell",
  "x is his power": "x is its power",
  "x is the devoured creature's power": "x is that creature's power",
  "x is the amassed army's power": "x is that creature's power",
  "x is creature's power": "x is that creature's power",
  "x is creature's toughness": "x is that creature's toughness",
  "x is artifact's intensity": "x is this artifact's intensity",
  "x is that creature's toughness": "x is that creature's toughness",
  "x is half the creature's power, rounded down": "x is half that creature's power",
  "x is half the creature's power, rounded up": "x is half that creature's power, rounded up",
};

export function normalizeModifyPtWhereRaw(whereRaw: string): string {
  let raw = normalizeOracleText(whereRaw);
  raw = MODIFY_PT_WHERE_ALIASES[raw] || raw;
  raw = raw.replace(/[,\s]+(?:as|when)\s+.{3,80}?\b(?:resolves?|begins?\s+to\s+apply)\s*$/i, '');
  raw = raw.replace(/\s+as\s+you\s+(?:cast|activate)\s+(?:this\b.*|that\b.*)$/i, '');
  raw = raw.replace(/\s+and\s+y\s+is\b.*$/i, '');
  raw = raw.replace(/,\s+(?:then|and)\s+.+$/i, '');
  raw = MODIFY_PT_WHERE_ALIASES[raw] || raw;
  raw = raw.replace(/\bfive\b/g, '5');
  raw = raw.replace(/\bsix\b/g, '6');
  raw = raw.replace(/\bseven\b/g, '7');
  raw = raw.replace(/\beight\b/g, '8');
  raw = raw.replace(/\bnine\b/g, '9');
  raw = raw.replace(/\bten\b/g, '10');
  return raw;
}

export function isAttackingObject(obj: any): boolean {
  const attackingValue = String((obj as any)?.attacking || (obj as any)?.attackingPlayerId || (obj as any)?.defendingPlayerId || '').trim();
  if (attackingValue.length > 0) return true;
  if ((obj as any)?.isAttacking === true) return true;
  return false;
}

export function hasFlyingKeyword(obj: any): boolean {
  const combinedText = getCombinedPermanentText(obj);
  if (combinedText.includes('flying')) return true;

  const keywordValues: unknown[] = [
    ...(Array.isArray((obj as any)?.keywords) ? (obj as any).keywords : []),
    ...(Array.isArray((obj as any)?.card?.keywords) ? (obj as any).card.keywords : []),
  ];
  for (const value of keywordValues) {
    if (String(value || '').trim().toLowerCase() === 'flying') return true;
  }
  const textValues: unknown[] = [
    (obj as any)?.text,
    (obj as any)?.oracleText,
    (obj as any)?.oracle_text,
    (obj as any)?.card?.text,
    (obj as any)?.card?.oracleText,
    (obj as any)?.card?.oracle_text,
    (obj as any)?.abilities,
    (obj as any)?.card?.abilities,
  ];
  for (const value of textValues) {
    if (typeof value === 'string' && /\bflying\b/i.test(value)) return true;
  }
  return false;
}

export function getCreatureSubtypeKeys(obj: any, typeLineLower: (obj: any) => string): readonly string[] {
  const subtypeValues = (obj as any)?.subtypes || (obj as any)?.card?.subtypes;
  if (Array.isArray(subtypeValues) && subtypeValues.length > 0) {
    const normalized = subtypeValues
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    if (normalized.length > 0) return normalized;
  }

  const typeLine = typeLineLower(obj);
  if (!typeLine.includes('creature')) return [];
  const emDashIdx = typeLine.search(/[â€”\ufffd]/);
  const hyphenDashIdx = typeLine.indexOf(' - ');
  const splitIdx = emDashIdx >= 0 ? emDashIdx : hyphenDashIdx;
  if (splitIdx < 0) return [];
  const suffix = typeLine.slice(splitIdx + (emDashIdx >= 0 ? 1 : 3)).trim();
  if (!suffix) return [];
  return suffix
    .split(/\s+/)
    .map(part => part.replace(/^[^a-z0-9-]+|[^a-z0-9-]+$/g, '').trim())
    .filter(Boolean);
}

export function resolveContextPlayerFromState(state: GameState, ctx?: OracleIRExecutionContext): any | null {
  const id = String(ctx?.selectorContext?.targetPlayerId || ctx?.selectorContext?.targetOpponentId || '').trim();
  if (!id) return null;
  return (state.players || []).find((player: any) => String(player.id || '').trim() === id) || null;
}

export function findObjectByIdInState(
  state: GameState,
  battlefield: readonly BattlefieldPermanent[],
  idRaw: string
): any | null {
  const id = String(idRaw || '').trim();
  if (!id) return null;

  const inBattlefield = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === id) as any;
  if (inBattlefield) return inBattlefield;

  const stackRaw = (state as any)?.stack;
  const stackItems = Array.isArray(stackRaw)
    ? stackRaw
    : Array.isArray((stackRaw as any)?.objects)
      ? (stackRaw as any).objects
      : [];
  const inStack = stackItems.find((item: any) => String((item as any)?.id || '').trim() === id) as any;
  if (inStack) return inStack;

  const zones: readonly ('library' | 'hand' | 'graveyard' | 'exile')[] = ['library', 'hand', 'graveyard', 'exile'];
  for (const player of (state.players || []) as any[]) {
    for (const zone of zones) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      const found = cards.find((card: any) => String((card as any)?.id || '').trim() === id) as any;
      if (found) return found;
    }
  }

  return null;
}

export function findObjectByNameInState(
  state: GameState,
  battlefield: readonly BattlefieldPermanent[],
  nameRaw: string,
  ctx?: OracleIRExecutionContext
): any | null {
  const wanted = normalizeOracleText(String(nameRaw || ''));
  if (!wanted) return null;

  const getName = (obj: any): string => normalizeOracleText(String((obj as any)?.name || (obj as any)?.card?.name || ''));
  const namesMatch = (nameValue: string): boolean => {
    if (!nameValue) return false;
    if (nameValue === wanted) return true;
    if (nameValue.startsWith(`${wanted},`)) return true;
    return false;
  };

  const sourceId = String(ctx?.sourceId || '').trim();
  if (sourceId) {
    const sourceObj = findObjectByIdInState(state, battlefield, sourceId);
    if (sourceObj && namesMatch(getName(sourceObj))) return sourceObj;
  }

  for (const permanent of battlefield as any[]) {
    if (namesMatch(getName(permanent))) return permanent;
  }

  const stackRaw = (state as any)?.stack;
  const stackItems = Array.isArray(stackRaw)
    ? stackRaw
    : Array.isArray((stackRaw as any)?.objects)
      ? (stackRaw as any).objects
      : [];
  for (const stackObj of stackItems as any[]) {
    if (namesMatch(getName(stackObj))) return stackObj;
  }

  const zones: readonly ('library' | 'hand' | 'graveyard' | 'exile')[] = ['library', 'hand', 'graveyard', 'exile'];
  for (const player of (state.players || []) as any[]) {
    for (const zone of zones) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      for (const card of cards as any[]) {
        if (namesMatch(getName(card))) return card;
      }
    }
  }

  return null;
}

export function normalizeCounterName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s+counters?$/, '')
    .trim();
}

export function getCounterCountOnObject(obj: any, counterNameRaw: string): number | null {
  if (!obj) return null;
  const counterName = normalizeCounterName(counterNameRaw);
  if (!counterName) return null;

  const counters: unknown = (obj as any)?.counters;
  if (!counters) return 0;

  if (Array.isArray(counters)) {
    let total = 0;
    for (const entry of counters as any[]) {
      if (!entry) continue;
      if (typeof entry === 'string') {
        if (normalizeCounterName(entry) === counterName) total += 1;
        continue;
      }

      const keyCandidates = [entry.type, entry.kind, entry.name, entry.counter, entry.id];
      const key = keyCandidates
        .map(value => normalizeCounterName(String(value || '')))
        .find(Boolean);
      if (!key || key !== counterName) continue;

      const amount = Number(entry.count ?? entry.amount ?? entry.value ?? 1);
      total += Number.isFinite(amount) ? Math.max(0, amount) : 1;
    }
    return total;
  }

  if (typeof counters === 'object') {
    let total = 0;
    for (const [keyRaw, valueRaw] of Object.entries(counters as Record<string, unknown>)) {
      const key = normalizeCounterName(keyRaw);
      if (key !== counterName) continue;

      if (typeof valueRaw === 'number') {
        total += Number.isFinite(valueRaw) ? Math.max(0, valueRaw) : 0;
        continue;
      }

      if (valueRaw && typeof valueRaw === 'object') {
        const nested = valueRaw as Record<string, unknown>;
        const amount = Number(nested.count ?? nested.amount ?? nested.value ?? 0);
        if (Number.isFinite(amount)) total += Math.max(0, amount);
        continue;
      }

      const amount = Number(valueRaw);
      if (Number.isFinite(amount)) total += Math.max(0, amount);
    }
    return total;
  }

  return null;
}
