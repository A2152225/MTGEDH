/**
 * tokenCreation.ts
 * 
 * Comprehensive token creation system with automatic trigger detection
 * and UI prompts for player decisions.
 * 
 * Rules Reference:
 * - Rule 701.7: Create (keyword action)
 * - Rule 111: Tokens
 * - Rule 603: Triggered Abilities (for token-related triggers)
 */

import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';
import { getTokenMultiplier } from './cards/triggerCopying';
import {
  COMMON_TOKENS,
  getCommonTokenNames,
  getTokenCharacteristics,
} from './tokenCreationCatalog';
import {
  detectTokenCreationTriggers,
  detectTokenETBTriggers,
  parseTokenCreationFromText,
} from './tokenCreationDetection';
import { createTokenPermanent } from './tokenCreationPermanentFactory';
import type {
  CreatedToken,
  ETBTriggerInfo,
  TokenCharacteristics,
  TokenCreationRequest,
  TokenCreationResult,
  TokenTriggerInfo,
} from './tokenCreationTypes';

export type {
  CreatedToken,
  ETBTriggerInfo,
  TokenCharacteristics,
  TokenCreationRequest,
  TokenCreationResult,
  TokenTriggerInfo,
} from './tokenCreationTypes';
export {
  COMMON_TOKENS,
  getCommonTokenNames,
  getTokenCharacteristics,
} from './tokenCreationCatalog';
export {
  parseTokenCreationFromText,
  resolveTokenCharacteristicsFromOracleStep,
  detectTokenETBTriggers,
  detectTokenCreationTriggers,
} from './tokenCreationDetection';
export { createTokenPermanent } from './tokenCreationPermanentFactory';

/**
 * Apply battlefield token doublers and creature-token triplers.
 * Each matching permanent the controller controls multiplies the count. The new tokens
 * are not on the battlefield yet, so they do not multiply the event that creates them.
 */
export function resolveMultipliedTokenCount(
  controllerId: string,
  battlefield: readonly { controller: string; card?: { oracle_text?: string; type_line?: string } | null; oracle_text?: string; type_line?: string }[],
  baseCount: number,
  options?: { tokenIsCreature?: boolean },
): { readonly count: number; readonly multiplier: number } {
  const multiplier = getTokenMultiplier(
    controllerId,
    (battlefield || []).map(perm => ({
      controller: perm.controller,
      oracleText: (perm.card as KnownCardRef)?.oracle_text || (perm as any)?.oracle_text || '',
    })),
    { tokenIsCreature: options?.tokenIsCreature === true },
  );
  return {
    multiplier,
    count: Math.max(0, baseCount * multiplier),
  };
}

function createdTokenIsCreature(characteristics: { types?: readonly string[]; type_line?: string }): boolean {
  if ((characteristics.types || []).some((type) => String(type).toLowerCase() === 'creature')) return true;
  return /\bcreature\b/i.test(String(characteristics.type_line || ''));
}

/**
 * Create tokens with full trigger detection
 */
export function createTokens(
  request: TokenCreationRequest,
  battlefield: readonly BattlefieldPermanent[]
): TokenCreationResult {
  const tokens: CreatedToken[] = [];
  const etbTriggers: ETBTriggerInfo[] = [];
  const otherTriggers: TokenTriggerInfo[] = [];
  const log: string[] = [];
  const { count: totalCount, multiplier: tokenMultiplier } = resolveMultipliedTokenCount(
    request.controllerId,
    battlefield,
    request.count,
    { tokenIsCreature: createdTokenIsCreature(request.characteristics) },
  );

  if (tokenMultiplier > 1) {
    log.push(`Applied token multiplier x${tokenMultiplier}`);
  }

  for (let i = 0; i < totalCount; i++) {
    const token = createTokenPermanent(
      request.characteristics,
      request.controllerId,
      request.sourceId,
      request.sourceName,
      request.withCounters
    );

    const tokenETBs = detectTokenETBTriggers(token, request.controllerId);

    tokens.push({
      id: token.id,
      token,
      triggersETB: tokenETBs.length > 0,
    });

    etbTriggers.push(...tokenETBs);

    const creationTriggers = detectTokenCreationTriggers(
      battlefield,
      token.id,
      request.controllerId
    );

    otherTriggers.push(...creationTriggers);

    log.push(`Created ${request.characteristics.name} token`);
    if (request.sourceName) {
      log.push(`  (from ${request.sourceName})`);
    }
  }

  if (etbTriggers.length > 0) {
    log.push(`${etbTriggers.length} ETB trigger(s) detected`);
  }

  if (otherTriggers.length > 0) {
    log.push(`${otherTriggers.length} "token enters" trigger(s) detected`);
  }

  return {
    tokens,
    etbTriggers,
    otherTriggers,
    log,
  };
}

/**
 * Create tokens by name (using common token definitions)
 */
export function createTokensByName(
  tokenName: string,
  count: number,
  controllerId: PlayerID,
  battlefield: readonly BattlefieldPermanent[],
  sourceId?: string,
  sourceName?: string
): TokenCreationResult | null {
  const characteristics = COMMON_TOKENS[tokenName];
  if (!characteristics) {
    return null;
  }

  return createTokens({
    characteristics,
    count,
    controllerId,
    sourceId,
    sourceName,
  }, battlefield);
}

export default {
  createTokens,
  createTokensByName,
  createTokenPermanent,
  parseTokenCreationFromText,
  detectTokenETBTriggers,
  detectTokenCreationTriggers,
  getCommonTokenNames,
  getTokenCharacteristics,
  COMMON_TOKENS,
};
