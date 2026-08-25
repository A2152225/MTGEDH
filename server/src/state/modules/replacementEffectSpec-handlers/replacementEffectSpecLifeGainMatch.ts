// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: overlaySpecsMatchLifeGain + matchesLifeGainSpec.
// Public entry symbols: overlaySpecsMatchLifeGain, matchesLifeGainSpec.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';

interface LifeGainMatchEvent {
  type?: 'life-gain';
  state?: unknown;
  playerId: string;
  amount?: number;
}

function readAuraEnchantedPlayerId(spec: ReplacementEffectSpec, state: unknown): string {
  const auraId = String(spec.sourcePermanentId || '').trim();
  if (!auraId || !state || typeof state !== 'object') return '';
  const battlefield = Array.isArray((state as { battlefield?: unknown }).battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  const aura = battlefield.find((perm) => {
    if (!perm || typeof perm !== 'object') return false;
    return String((perm as { id?: string }).id || '').trim() === auraId;
  }) as { attachedTo?: string; enchantedPlayerId?: string } | undefined;
  if (!aura) return '';
  return String(aura.attachedTo || aura.enchantedPlayerId || '').trim();
}

export function matchesLifeGainSpec(spec: ReplacementEffectSpec, event: LifeGainMatchEvent): boolean {
  const match = spec.match;
  if (!match) return true;

  const playerId = String(event.playerId || '');
  const sourceController = String(spec.sourceController || '');

  if (match.gainingPlayerIsOpponentOfSource === true
    && playerId === sourceController) {
    return false;
  }

  if (match.gainingPlayerIsSourceController === true
    && playerId !== sourceController) {
    return false;
  }

  if (match.gainingPlayerIsEnchantedBySource === true) {
    const enchantedId = readAuraEnchantedPlayerId(spec, event.state);
    if (!enchantedId || playerId !== enchantedId) return false;
  }

  if (typeof match.gainingPlayerLifeGte === 'number') {
    const state = event.state as { life?: Record<string, unknown>; startingLife?: number } | undefined;
    const currentLife = Number(state?.life?.[playerId] ?? state?.startingLife ?? 40);
    if (!Number.isFinite(currentLife) || currentLife < match.gainingPlayerLifeGte) {
      return false;
    }
  }

  return true;
}

export function overlaySpecsMatchLifeGain(
  spec: ReplacementEffectSpec,
  event: { playerId: string; state?: unknown; amount?: number },
): boolean {
  return matchesLifeGainSpec(spec, {
    type: 'life-gain',
    state: event.state,
    playerId: event.playerId,
    amount: event.amount ?? 1,
  });
}
