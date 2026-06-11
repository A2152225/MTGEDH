import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { applyMillReplacements } from './game-state-effects.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';
import { processMillTriggers } from './zones.js';
import { debug } from '../../utils/debug.js';
import { millPlayerCardsFromTrigger } from './triggerMillFromEffectUtils.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

const WORD_TO_NUMBER: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseNumberWord(word: string | undefined, defaultValue = 1): number {
  if (!word) return defaultValue;
  const lower = word.toLowerCase();
  if (WORD_TO_NUMBER[lower] !== undefined) {
    return WORD_TO_NUMBER[lower];
  }
  const num = parseInt(lower, 10);
  return Number.isNaN(num) ? defaultValue : num;
}

export interface TriggerLegacyMillParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly desc: string;
  readonly opponents: readonly any[];
  readonly state: any;
  readonly sourceName?: string;
}

export interface TriggerLegacyTargetMillParams extends TriggerLegacyMillParams {
  readonly sourceName: string;
  readonly triggerItem: any;
}

export function applyRetiredTriggerLegacyEachOpponentMills(
  params: TriggerLegacyMillParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName || '')) {
    return false;
  }

  const millOpponentsMatch = params.desc.match(/each opponent mills? (?:a card|(\d+) cards?)/i);
  if (!millOpponentsMatch) {
    return false;
  }

  const baseMillCount = millOpponentsMatch[1] ? parseInt(millOpponentsMatch[1], 10) : 1;
  debug(2, `[executeTriggerEffect] Each opponent mills ${baseMillCount} card(s)`);
  if (baseMillCount <= 0) {
    return true;
  }

  params.state.pendingMill = params.state.pendingMill || {};
  for (const opp of params.opponents) {
    const { finalCount: millCount } = applyMillReplacements(
      params.ctx,
      baseMillCount,
      String(params.controller),
      String(opp.id),
    );
    params.state.pendingMill[opp.id] = (params.state.pendingMill[opp.id] || 0) + millCount;

    const ctxLibraries = (params.ctx as any).libraries as Map<string, any[]> | undefined;
    let oppLib: any[] | undefined;
    if (ctxLibraries && typeof ctxLibraries.get === 'function') {
      oppLib = ctxLibraries.get(opp.id);
    }

    const zones = params.state.zones || {};
    const oppZones = zones[opp.id] = zones[opp.id] || {
      hand: [], handCount: 0, libraryCount: 0,
      graveyard: [], graveyardCount: 0,
    };

    if (oppLib && Array.isArray(oppLib)) {
      const milledCards: any[] = [];
      for (let i = 0; i < millCount && oppLib.length > 0; i++) {
        const milledCard = oppLib.shift();
        if (milledCard) {
          oppZones.graveyard = oppZones.graveyard || [];
          milledCard.zone = 'graveyard';
          oppZones.graveyard.push(milledCard);
          milledCards.push(milledCard);
          recordCardPutIntoGraveyardThisTurn(params.ctx, String(opp.id), milledCard, { fromBattlefield: false });
          debug(2, `[executeTriggerEffect] Milled ${milledCard.name || 'card'} from ${opp.id}'s library`);
        }
      }
      if (ctxLibraries && typeof ctxLibraries.set === 'function') {
        ctxLibraries.set(opp.id, oppLib);
      }
      oppZones.libraryCount = oppLib.length;
      oppZones.graveyardCount = (oppZones.graveyard || []).length;
      if (milledCards.length > 0) {
        try {
          processMillTriggers(params.ctx, String(opp.id), milledCards, params.controller);
        } catch {
          // best-effort
        }
      }
    } else {
      debug(2, `[executeTriggerEffect] No library found for opponent ${opp.id}`);
    }
  }

  return true;
}

export function applyRetiredTriggerLegacyThatPermanentControllerMills(
  params: TriggerLegacyTargetMillParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const thatPermanentControllerMillsMatch = params.desc.match(/that permanent's controller mills? (?:a card|([a-z]+|\d+) cards?)/i);
  if (!thatPermanentControllerMillsMatch) {
    return false;
  }

  const millCount = thatPermanentControllerMillsMatch[1]
    ? parseNumberWord(thatPermanentControllerMillsMatch[1], 1)
    : 1;
  const targetPlayerId = String(
    params.triggerItem?.effectData?.untappedPermanentController ||
    params.triggerItem?.targetPlayer ||
    params.triggerItem?.triggeringPlayer ||
    '',
  ).trim();

  if (targetPlayerId && millCount > 0) {
    millPlayerCardsFromTrigger(params.ctx, params.controller, targetPlayerId, millCount, params.sourceName);
  }

  return true;
}

export function applyRetiredTriggerLegacyTargetPlayerMills(
  params: TriggerLegacyTargetMillParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const millTargetPlayerMatch = params.desc.match(/target (?:player|opponent) mills? ([a-z]+|\d+) cards?/i);
  if (!millTargetPlayerMatch) {
    return false;
  }

  const millCount = parseNumberWord(millTargetPlayerMatch[1], 1);
  const targets = params.triggerItem?.targets || [];
  const targetPlayerId = String(targets[0] || params.opponents[0]?.id || '').trim();

  if (targetPlayerId && millCount > 0) {
    millPlayerCardsFromTrigger(params.ctx, params.controller, targetPlayerId, millCount, params.sourceName);
  }

  return true;
}
