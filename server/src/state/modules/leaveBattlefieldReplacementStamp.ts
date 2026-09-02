/**
 * Origin sibling: leaveBattlefieldReplacementHint.ts / stackResolvePermanentEntryUtils.ts
 * Cluster: stamp or infer "when this dies, exile it" replacements granted by
 *   graveyard-cast permissions (Rivaz, Serra Paragon) onto entering permanents.
 * Public: inferLeaveBattlefieldExileReplacement, applyLeaveBattlefieldExileReplacementStamp
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import { sourceLeaveBattlefieldReplacementDestination, sourceLeaveBattlefieldLifeGain } from './can-respond-handlers/canRespondGraveyardSpellPermission.js';
import {
  getGraveyardPermanentTypesCastThisTurn,
  spellQualifierMatchesCard,
} from './can-respond-handlers/canRespondGraveyardPermissionMatching.js';

export interface LeaveBattlefieldExileStamp {
  leaveBattlefieldReplacementDestination: 'exile';
  leaveBattlefieldReplacementSourceName?: string;
  leaveBattlefieldReplacementLifeGain?: number;
}

function objectWasCastFromGraveyard(object: any, extra?: any): boolean {
  const sources = [object, object?.card, extra, extra?.card];
  return sources.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.castFromGraveyard === true) return true;
    if (String(entry.graveyardPermissionId || entry.graveyardPermissionSourceName || '').trim()) {
      return true;
    }
    const fromZone = String(entry.fromZone || entry.castSourceZone || '').trim().toLowerCase();
    return fromZone === 'graveyard';
  });
}

function selfOracleExilesInsteadOfLeave(oracleText: string): boolean {
  const normalized = String(oracleText || '')
    .replace(/["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\bif\s+(?:it|this\s+(?:permanent|creature|planeswalker|artifact|enchantment))\s+would\s+leave\s+the\s+battlefield,\s*exile\s+it\s+instead(?:\s+of\s+putting\s+it\s+anywhere\s+else)?\b/i.test(
    normalized,
  );
}

function alreadyStamped(object: any): boolean {
  const dest = String(
    object?.leaveBattlefieldReplacementDestination
    || object?.card?.leaveBattlefieldReplacementDestination
    || '',
  ).trim().toLowerCase();
  return dest === 'exile';
}

function sourceGrantsDiesExileToCard(source: { oracleText: string; sourceName: string }, card: any, usedPermanentTypes: Set<string>): boolean {
  if (sourceLeaveBattlefieldReplacementDestination(source.oracleText) !== 'exile') {
    return false;
  }
  const lines = String(source.oracleText || '').split(/\r?\n/);
  for (const rawLine of lines) {
    for (const match of String(rawLine || '').matchAll(/\b(?:cast|play) ([^.]+?) from your graveyard/gi)) {
      const qualifier = String(match[1] || '').trim();
      if (qualifier && spellQualifierMatchesCard(card, qualifier, usedPermanentTypes)) {
        return true;
      }
    }
  }
  return false;
}

export function inferLeaveBattlefieldExileReplacement(
  object: any,
  state: any,
  extra?: any,
): LeaveBattlefieldExileStamp | undefined {
  if (!object) return undefined;
  const card = object.card && typeof object.card === 'object' ? object.card : object;
  const oracleText = String(card?.oracle_text || card?.oracleText || object?.oracle_text || '');
  if (selfOracleExilesInsteadOfLeave(oracleText)
    || sourceLeaveBattlefieldReplacementDestination(oracleText) === 'exile') {
    return { leaveBattlefieldReplacementDestination: 'exile' };
  }

  if (alreadyStamped(object) || alreadyStamped(extra)) {
    const sourceName = String(
      object?.leaveBattlefieldReplacementSourceName
      || object?.card?.leaveBattlefieldReplacementSourceName
      || extra?.leaveBattlefieldReplacementSourceName
      || extra?.card?.leaveBattlefieldReplacementSourceName
      || '',
    ).trim();
    const lifeGain = Number(
      object?.leaveBattlefieldReplacementLifeGain
      || object?.card?.leaveBattlefieldReplacementLifeGain
      || extra?.leaveBattlefieldReplacementLifeGain
      || extra?.card?.leaveBattlefieldReplacementLifeGain
      || 0,
    );
    return {
      leaveBattlefieldReplacementDestination: 'exile',
      ...(sourceName ? { leaveBattlefieldReplacementSourceName: sourceName } : {}),
      ...(lifeGain > 0 ? { leaveBattlefieldReplacementLifeGain: lifeGain } : {}),
    };
  }

  if (!objectWasCastFromGraveyard(object, extra) || !state) return undefined;

  const controller = String(
    object?.controller || extra?.controller || extra?.playerId || '',
  ).trim() as PlayerID;
  if (!controller) return undefined;

  const usedPermanentTypes = getGraveyardPermanentTypesCastThisTurn(state, controller);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const sourcePermanent of battlefield) {
    if (String(sourcePermanent?.controller || '').trim() !== controller) continue;
    const oracleText = String(sourcePermanent?.card?.oracle_text || sourcePermanent?.card?.oracleText || '');
    if (!oracleText) continue;
    const source = {
      oracleText,
      sourceName: String(sourcePermanent?.card?.name || sourcePermanent?.name || '').trim(),
    };
    if (!sourceGrantsDiesExileToCard(source, card, usedPermanentTypes)) continue;
    const lifeGain = sourceLeaveBattlefieldLifeGain(oracleText);
    return {
      leaveBattlefieldReplacementDestination: 'exile',
      ...(source.sourceName ? { leaveBattlefieldReplacementSourceName: source.sourceName } : {}),
      ...(lifeGain ? { leaveBattlefieldReplacementLifeGain: lifeGain } : {}),
    };
  }

  return undefined;
}

export function applyLeaveBattlefieldExileReplacementStamp(
  permanent: any,
  stamp: LeaveBattlefieldExileStamp | undefined,
): void {
  if (!permanent || stamp?.leaveBattlefieldReplacementDestination !== 'exile') return;
  permanent.leaveBattlefieldReplacementDestination = 'exile';
  if (permanent.card && typeof permanent.card === 'object') {
    permanent.card.leaveBattlefieldReplacementDestination = 'exile';
  }
  const sourceName = String(stamp.leaveBattlefieldReplacementSourceName || '').trim();
  if (sourceName) {
    permanent.leaveBattlefieldReplacementSourceName = sourceName;
    if (permanent.card && typeof permanent.card === 'object') {
      permanent.card.leaveBattlefieldReplacementSourceName = sourceName;
    }
  }
  const lifeGain = Number(stamp.leaveBattlefieldReplacementLifeGain || 0);
  if (lifeGain > 0) {
    permanent.leaveBattlefieldReplacementLifeGain = lifeGain;
    if (permanent.card && typeof permanent.card === 'object') {
      permanent.card.leaveBattlefieldReplacementLifeGain = lifeGain;
    }
  }
}
