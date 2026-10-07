import { withBattlefieldGrantedLandManaSources } from './manaSourceBattlefieldLandTypeGrants';

/**
 * Payment-row overlay for static "Lands you control have '{T}: Add one mana of any color'"
 * grants (Chromatic Lantern, Joiner Adept, and the same oracle pattern).
 *
 * Autopay / PaymentPicker only sees printed mana abilities and basic-land-type grants
 * (Urborg / Yavimaya). Without this overlay, lands stay single-color and autopay fails
 * when the Lantern would have fixed the mana.
 */

import type { BattlefieldPermanent, ManaColor } from '../../../shared/src';
import type { ManaPaymentSource } from './manaUtils';

const ANY_COLOR: readonly ManaColor[] = ['W', 'U', 'B', 'R', 'G'];

/** Oracle grants every land its controller owns "{T}: Add one mana of any color." */
export function oracleGrantsLandsAnyColorMana(oracleText: string): boolean {
  const text = String(oracleText || '').toLowerCase().replace(/[“”]/g, '"');
  if (!text) return false;
  if (!/\blands?\s+you\s+control\s+have\b/.test(text) && !/\ball\s+lands\s+have\b/.test(text)) {
    return false;
  }
  return /add\s+(?:one|a|an)\s+mana\s+of\s+any\s+(?:one\s+)?color/.test(text);
}

function controllerReceivesLandsAnyColorGrant(
  playerId: string,
  battlefield: readonly BattlefieldPermanent[],
): boolean {
  const pid = String(playerId || '').trim();
  if (!pid) return false;
  for (const permanent of battlefield) {
    if (!permanent || (permanent as any).phasedOut === true) continue;
    const controller = String((permanent as any).controller || '').trim();
    if (controller !== pid) continue;
    const oracle = String((permanent as any)?.card?.oracle_text || '');
    if (oracleGrantsLandsAnyColorMana(oracle)) return true;
  }
  return false;
}

function isLandPermanent(perm: BattlefieldPermanent): boolean {
  const typeLine = String((perm as any)?.card?.type_line || (perm as any)?.type_line || '').toLowerCase();
  return typeLine.includes('land');
}

function isSingleManaTapSource(source: ManaPaymentSource): boolean {
  if ((source.amount ?? 1) !== 1) return false;
  if (source.activationManaCost) return false;
  if (source.sacrificeCost) return false;
  if (source.consumable) return false;
  return true;
}

function syntheticAnyColorSource(perm: BattlefieldPermanent): ManaPaymentSource {
  const permanentId = String(perm.id || '');
  const name = String((perm as any)?.card?.name || 'Land');
  return {
    id: `${permanentId}::granted-any-color`,
    sourcePermanentId: permanentId,
    abilityId: 'granted-any-color',
    name,
    label: 'Add one mana of any color',
    options: [...ANY_COLOR],
  };
}

/**
 * When Chromatic Lantern / Joiner Adept (etc.) is out, every land can tap for any color.
 * Merge into a lone single-mana row, or add an alternate row when the land already has
 * several abilities (same shape as basic-land-type grants).
 */
export function withBattlefieldGrantedAnyColorLandManaSources(
  perm: BattlefieldPermanent,
  playerId: string,
  battlefield: readonly BattlefieldPermanent[],
  sources: ManaPaymentSource[],
): ManaPaymentSource[] {
  if (!isLandPermanent(perm)) return sources;
  if (!controllerReceivesLandsAnyColorGrant(playerId, battlefield)) return sources;

  const covered = new Set<ManaColor>();
  for (const source of sources) {
    for (const option of source.options || []) covered.add(option);
  }
  const missing = ANY_COLOR.filter((color) => !covered.has(color));
  if (missing.length === 0) return sources;

  if (sources.length === 0) {
    return [syntheticAnyColorSource(perm)];
  }

  if (sources.length === 1 && isSingleManaTapSource(sources[0])) {
    const existing = sources[0];
    const options = [...existing.options];
    for (const color of missing) {
      if (!options.includes(color)) options.push(color);
    }
    return [{ ...existing, options }];
  }

  return [...sources, syntheticAnyColorSource(perm)];
}
/** Apply land-type grants then static any-color mana ability grants (Lantern / Joiner Adept). */
export function withBattlefieldGrantedLandManaOverlays(
  permanent: any,
  playerId: string,
  battlefield: readonly any[] | undefined,
  sources: any[],
): any[] {
  const withLandTypes = withBattlefieldGrantedLandManaSources(permanent, battlefield as any, sources);
  return withBattlefieldGrantedAnyColorLandManaSources(permanent, playerId, battlefield as any, withLandTypes);
}
