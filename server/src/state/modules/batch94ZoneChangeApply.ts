// server/src/state/modules/batch94ZoneChangeApply.ts
// B94: side effects when a zone-change replacement applies — gain-N-life
// after a die-to-exile (Darkness Crystal) and "graveyard from anywhere
// becomes bottom of library" (Wheel of Sun and Moon).
// Public: applyGainLifeFromZoneChangeReplacement, parseWheelGraveyardToLibrarySentence,
// collectBatch94ZoneChangeReplacementSpecs, collectBatch94ZoneChangeReplacementSpecsFromState,
// cardWouldGoToEnchantedPlayersGraveyard.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WHEEL_RE = /if a card would be put into enchanted player's graveyard from anywhere, instead that card is revealed and put on the bottom of that player's library/i;

export function parseWheelGraveyardToLibrarySentence(oracle: string): boolean {
  return WHEEL_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

export function collectBatch94ZoneChangeReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  extras?: { enchantedPlayerId?: string },
): ReplacementEffectSpec[] {
  if (!parseWheelGraveyardToLibrarySentence(oracle)) return [];
  return [{
    id: `${source.sourcePermanentId}:graveyard-from-anywhere-to-library-bottom`,
    event: 'zone-change' as const,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { destinationZone: 'graveyard', enchantedPlayerOwnerOrController: true },
    instead: { redirectZone: 'library', libraryPosition: 'bottom', reveal: true },
    effectId: 'graveyard-from-anywhere-to-library-bottom',
    reason: 'graveyard_from_anywhere_to_library_bottom',
    metadata: { enchantedPlayerId: extras?.enchantedPlayerId || '', reveal: true, libraryPosition: 'bottom' },
  } as ReplacementEffectSpec];
}

export function collectBatch94ZoneChangeReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; attachedTo?: string; enchantedPlayerId?: string; card?: { name?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    const enchantedPlayerId = String(rec.enchantedPlayerId || rec.attachedTo || '').trim();
    specs.push(...collectBatch94ZoneChangeReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String((rec.card as any)?.name || 'Unknown').trim(),
    }, { enchantedPlayerId }));
  }
  return specs;
}

export function applyGainLifeFromZoneChangeReplacement(state: any, metadata: any): { applied: boolean; playerId?: string; amount?: number } {
  const amount = Math.max(0, Math.floor(Number(metadata?.gainLife || 0)));
  const playerId = String(metadata?.gainLifePlayerId || metadata?.sourceController || '').trim();
  if (!state || amount <= 0) return { applied: false };
  const controller = playerId || (() => {
    const srcId = String(metadata?.sourcePermanentId || '').trim();
    const perm = (Array.isArray(state.battlefield) ? state.battlefield : []).find((p: any) => String(p?.id || '') === srcId);
    return String(perm?.controller || '').trim();
  })();
  if (!controller) return { applied: false };
  state.life = state.life || {};
  const players = Array.isArray(state.players) ? state.players : [];
  const player = players.find((p: any) => String(p?.id) === controller);
  const current = Number(state.life[controller] ?? player?.life ?? 40);
  const next = current + amount;
  state.life[controller] = next;
  if (player) player.life = next;
  state.lifeGainedThisTurn = state.lifeGainedThisTurn || {};
  state.lifeGainedThisTurn[controller] = (Number(state.lifeGainedThisTurn[controller]) || 0) + amount;
  return { applied: true, playerId: controller, amount };
}

export function applyCardToLibraryBottom(state: any, card: any, playerId: string): boolean {
  const pid = String(playerId || '');
  if (!pid || !card || !state) return false;
  state.zones = state.zones || {};
  state.zones[pid] = state.zones[pid] || {};
  const library: any[] = Array.isArray(state.zones[pid].library) ? state.zones[pid].library : [];
  library.push({ ...card, zone: 'library' });
  state.zones[pid].library = library;
  state.zones[pid].libraryNeedsShuffle = false;
  return true;
}

export function applyCardToLibraryTop(state: any, card: any, playerId: string): boolean {
  const pid = String(playerId || '');
  if (!pid || !card || !state) return false;
  state.zones = state.zones || {};
  state.zones[pid] = state.zones[pid] || {};
  const library: any[] = Array.isArray(state.zones[pid].library) ? state.zones[pid].library : [];
  library.unshift({ ...card, zone: 'library' });
  state.zones[pid].library = library;
  state.zones[pid].libraryNeedsShuffle = false;
  return true;
}
