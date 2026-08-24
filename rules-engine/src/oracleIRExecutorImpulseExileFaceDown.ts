/**
 * oracleIRExecutorImpulseExileFaceDown.ts
 *
 * Face-down / examinable markers for exile_top and impulse_exile_top.
 * Origin: oracleIRExecutorExileStepHandlers.ts / oracleIRExecutorPlayerUtils.ts.
 * Entries: detectFaceDownExileFromRaw, detectFlexibleImpulseManaSpending,
 * stampFaceDownExileExamination.
 */

import type { GameState } from '../../shared/src';

export function detectFaceDownExileFromRaw(raw: string): boolean {
  return /\bface\s*down\b/i.test(String(raw || ''));
}

export function detectFlexibleImpulseManaSpending(text: string): boolean {
  const normalized = String(text || '');
  return (
    /mana\s+of\s+any\s+type\s+can\s+be\s+spent\s+to\s+cast/i.test(normalized)
    || /you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\s+of\s+any\s+(?:type|color)\s+to\s+cast/i.test(normalized)
    || /they\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\s+of\s+any\s+(?:type|color)\s+to\s+cast/i.test(normalized)
  );
}

export function stampFaceDownExileExamination(
  state: GameState,
  libraryOwnerId: string,
  exiledCards: readonly any[],
  options: {
    readonly faceDown?: boolean;
    readonly examinerId?: string;
  },
): GameState {
  if (!options.faceDown) return state;

  const ownerId = String(libraryOwnerId || '').trim();
  const examinerId = String(options.examinerId || '').trim();
  const exiledIds = new Set(
    exiledCards
      .map((card) => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
      .filter(Boolean),
  );
  if (!ownerId || exiledIds.size === 0) return state;

  const stampCard = (card: any): any => {
    const id = String(card?.id ?? card?.cardId ?? '').trim();
    if (!id || !exiledIds.has(id)) return card;
    const examinedBy = Array.isArray(card?.canBeExaminedBy)
      ? card.canBeExaminedBy.map((entry: any) => String(entry || '').trim()).filter(Boolean)
      : [];
    if (examinerId && !examinedBy.includes(examinerId)) examinedBy.push(examinerId);
    return {
      ...card,
      faceDown: true,
      ...(examinedBy.length > 0 ? { canBeExaminedBy: examinedBy } : {}),
    };
  };

  const stateAny: any = { ...(state as any) };
  if (Array.isArray(stateAny.players)) {
    stateAny.players = stateAny.players.map((player: any) => {
      if (String(player?.id || '').trim() !== ownerId) return player;
      const exile = Array.isArray(player?.exile) ? player.exile : [];
      if (exile.length === 0) return player;
      return { ...player, exile: exile.map(stampCard) };
    });
  }

  const zones = stateAny.zones && typeof stateAny.zones === 'object' ? { ...stateAny.zones } : null;
  if (zones && Array.isArray(zones[ownerId]?.exile)) {
    zones[ownerId] = {
      ...zones[ownerId],
      exile: zones[ownerId].exile.map(stampCard),
    };
    stateAny.zones = zones;
  }

  return stateAny as GameState;
}
