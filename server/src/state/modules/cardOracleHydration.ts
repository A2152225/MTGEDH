import type { PlayerID } from '../../../../shared/src/index.js';
import type { CardOracleLookup } from '../../../../shared/src/hydrateCardOracleText.js';
import {
  hydrateCardOracle,
  hydratePermanentCardOracle,
} from '../../../../shared/src/hydrateCardOracleText.js';
import { reapplyStoredCopyTokenOverrides } from '../../../../shared/src/copyTokenOverrides.js';
import { lookupLocalCardByNameSync } from '../../services/localCardLookup.js';

const lookupPrintedCardOracle: CardOracleLookup = (name) => {
  const record = lookupLocalCardByNameSync(name);
  if (!record) return undefined;
  return {
    oracle_text: record.oracle_text,
    type_line: record.type_line,
    mana_cost: record.mana_cost,
    power: record.power,
    toughness: record.toughness,
    loyalty: record.loyalty,
    card_faces: record.card_faces,
    layout: record.layout,
    colors: record.colors,
    color_identity: record.color_identity,
  };
};

export function hydrateCardOracleInPlace(
  card: unknown,
  options?: { isToken?: boolean; isCopyToken?: boolean; copiedFromPermanentId?: string },
): boolean {
  const hydrated = hydrateCardOracle(card, lookupPrintedCardOracle, options);
  fillMissingPrintedColors(card);
  return hydrated;
}

function fillMissingPrintedColors(card: unknown): void {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return;
  const record = card as Record<string, unknown>;
  const existing = Array.isArray(record.colors) ? record.colors.filter(Boolean) : [];
  if (existing.length > 0) return;

  const name = String(record.name || '').trim();
  const lookedUp = name ? lookupLocalCardByNameSync(name)?.colors : undefined;
  if (Array.isArray(lookedUp) && lookedUp.length > 0) {
    record.colors = [...lookedUp];
    return;
  }

  const fromCost: string[] = [];
  const manaCost = String(record.mana_cost || record.manaCost || '');
  for (const match of manaCost.matchAll(/[WUBRG]/gi)) {
    const symbol = String(match[0] || '').toUpperCase();
    if (symbol && !fromCost.includes(symbol)) fromCost.push(symbol);
  }
  if (fromCost.length > 0) {
    record.colors = fromCost;
  }
}

export function hydratePermanentCardOracleInPlace(permanent: unknown): boolean {
  if (!permanent || typeof permanent !== 'object') return false;
  const hydrated = hydratePermanentCardOracle(permanent as any, lookupPrintedCardOracle);
  fillMissingPrintedColors((permanent as any)?.card);
  reapplyStoredCopyTokenOverrides(permanent);
  return hydrated;
}

export function hydrateBattlefieldOracleText(battlefield: unknown): void {
  if (!Array.isArray(battlefield)) return;
  for (const permanent of battlefield) {
    hydratePermanentCardOracleInPlace(permanent);
    reapplyStoredCopyTokenOverrides(permanent);
  }
}

function hydrateZoneCardList(cards: unknown): void {
  if (!Array.isArray(cards)) return;
  for (const card of cards) {
    hydrateCardOracleInPlace(card, {
      isToken: (card as { isToken?: boolean })?.isToken === true,
      isCopyToken: (card as { isCopyOfPrintedCard?: boolean })?.isCopyOfPrintedCard === true,
    });
  }
}

/**
 * Repair missing printed-card oracle text anywhere it can affect rules execution:
 * battlefield (triggers, static grants), stack, hidden zones, command zone, libraries.
 */
export function hydrateGameStateOracleText(
  state: unknown,
  libraries?: ReadonlyMap<PlayerID, readonly unknown[]>,
): void {
  if (!state || typeof state !== 'object') return;
  const stateAny = state as Record<string, unknown>;

  hydrateBattlefieldOracleText(stateAny.battlefield);

  const stack = stateAny.stack;
  if (Array.isArray(stack)) {
    for (const item of stack) {
      if (!item || typeof item !== 'object') continue;
      const stackItem = item as Record<string, unknown>;
      hydrateCardOracleInPlace(stackItem.card);
      const nestedCard = (stackItem.card as Record<string, unknown> | undefined)?.card;
      hydrateCardOracleInPlace(nestedCard);
    }
  }

  const zones = stateAny.zones;
  if (zones && typeof zones === 'object') {
    for (const playerZones of Object.values(zones as Record<string, unknown>)) {
      if (!playerZones || typeof playerZones !== 'object') continue;
      const z = playerZones as Record<string, unknown>;
      hydrateZoneCardList(z.hand);
      hydrateZoneCardList(z.graveyard);
      hydrateZoneCardList(z.exile);
    }
  }

  const commandZone = stateAny.commandZone;
  if (commandZone && typeof commandZone === 'object') {
    for (const entry of Object.values(commandZone as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const cz = entry as Record<string, unknown>;
      hydrateZoneCardList(cz.commanderCards);
      // Legacy shape used by some older saves / event replays.
      hydrateZoneCardList(cz.commanders);
    }
  }

  if (libraries) {
    for (const library of libraries.values()) {
      hydrateZoneCardList(library);
    }
  }
}
