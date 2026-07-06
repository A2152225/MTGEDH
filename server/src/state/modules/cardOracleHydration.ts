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
  return hydrateCardOracle(card, lookupPrintedCardOracle, options);
}

export function hydratePermanentCardOracleInPlace(permanent: unknown): boolean {
  if (!permanent || typeof permanent !== 'object') return false;
  const hydrated = hydratePermanentCardOracle(permanent as any, lookupPrintedCardOracle);
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
      hydrateZoneCardList((entry as Record<string, unknown>).commanderCards);
    }
  }

  if (libraries) {
    for (const library of libraries.values()) {
      hydrateZoneCardList(library);
    }
  }
}
