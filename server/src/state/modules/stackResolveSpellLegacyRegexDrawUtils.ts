import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { shuffleZoneIntoLibrary } from './zone-manipulation.js';
import { drawCards as drawCardsFromZone } from './zones.js';
import { createTreasureToken } from './oracleIrSpellLegacyArtifactTokenUtils.js';
import { shouldSkipLegacySpellRegexHandlers } from './oracleIrSpellLegacyRouting.js';

export function resolveSkipLegacySpellRegexHandlers(
  oracleIrSpellHandled: boolean,
  oracleText: string,
  spellName: string,
): boolean {
  return oracleIrSpellHandled || shouldSkipLegacySpellRegexHandlers(oracleText, spellName);
}

export function logLegacySpellRegexPrimaryMiss(
  oracleIrSpellHandled: boolean,
  spellName: string,
  oracleText: string,
): void {
  if (shouldSkipLegacySpellRegexHandlers(oracleText, spellName) && !oracleIrSpellHandled) {
    debug(
      1,
      `[resolveTopOfStack] ${spellName || 'spell'}: IR primary owns spell effect but did not apply via top gate: ${String(oracleText || '').trim()}`,
    );
  }
}

export function applyLegacySpellRegexLifeGainHandler(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    oracleTextLower: string;
    spellXValue: unknown;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const oracleTextLower = options.oracleTextLower;
  const spellXValue = options.spellXValue;

  const lifeGainMatch = oracleTextLower.match(/you gain (\d+|x) life/i);
  if (lifeGainMatch) {
    let lifeAmount = 0;
    if (lifeGainMatch[1] === 'x' && typeof spellXValue === 'number') {
      lifeAmount = spellXValue;
    } else if (/^\d+$/.test(lifeGainMatch[1])) {
      lifeAmount = parseInt(lifeGainMatch[1], 10);
    }

    if (lifeAmount > 0) {
      const currentLife = state.life?.[controller] ?? 40;
      state.life = state.life || {};
      state.life[controller] = currentLife + lifeAmount;
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} gained ${lifeAmount} life (${currentLife} -> ${state.life[controller]})`);
    }
  }
}

export function applyLegacySpellRegexDrawHandlers(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    oracleTextLower: string;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const oracleTextLower = options.oracleTextLower;

  const shuffleHandAndGraveyardWheelMatch = oracleTextLower.includes(
    'each player shuffles their hand and graveyard into their library, then draws seven cards.',
  );
  if (shuffleHandAndGraveyardWheelMatch) {
    const players = (state as any).players || [];
    for (const player of players) {
      const playerId = player?.id as PlayerID | undefined;
      if (!playerId) continue;

      shuffleZoneIntoLibrary(ctx, playerId, 'hand');
      shuffleZoneIntoLibrary(ctx, playerId, 'graveyard');

      try {
        const drawn = drawCardsFromZone(ctx, playerId, 7);
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${player.name || playerId} shuffled hand+graveyard and drew ${drawn.length} card(s)`);
      } catch (err) {
        debugWarn(1, `[resolveTopOfStack] Failed to resolve ${effectiveCard.name} for ${playerId}:`, err);
      }
    }
  }

  const eachPlayerDrawsMatch = shuffleHandAndGraveyardWheelMatch
    ? null
    : oracleTextLower.match(/each player draws?\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
  if (eachPlayerDrawsMatch) {
    const drawCountStr = eachPlayerDrawsMatch[1].toLowerCase();
    const wordToNumber: Record<string, number> = {
      a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    const drawCount = wordToNumber[drawCountStr] || parseInt(drawCountStr, 10) || 1;

    const players = (state as any).players || [];
    for (const player of players) {
      if (player && player.id) {
        try {
          const drawn = drawCardsFromZone(ctx, player.id as PlayerID, drawCount);
          debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} drew ${drawn.length} card(s)`);
        } catch (err) {
          debugWarn(1, `[resolveTopOfStack] Failed to draw cards for ${player.id}:`, err);
        }
      }
    }
  }

  const youDrawMatch = shuffleHandAndGraveyardWheelMatch
    ? null
    : oracleTextLower.match(/you draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
  const eachOtherDrawMatch = shuffleHandAndGraveyardWheelMatch
    ? null
    : oracleTextLower.match(/each other player draws?\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);

  if (youDrawMatch && !eachPlayerDrawsMatch) {
    const wordToNumber: Record<string, number> = {
      a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    const controllerDrawCount = wordToNumber[youDrawMatch[1].toLowerCase()] || parseInt(youDrawMatch[1], 10) || 1;

    try {
      const drawn = drawCardsFromZone(ctx, controller, controllerDrawCount);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Controller ${controller} drew ${drawn.length} card(s)`);
    } catch (err) {
      debugWarn(1, `[resolveTopOfStack] Failed to draw cards for controller ${controller}:`, err);
    }

    if (eachOtherDrawMatch) {
      const otherDrawCount = wordToNumber[eachOtherDrawMatch[1].toLowerCase()] || parseInt(eachOtherDrawMatch[1], 10) || 1;
      const players = (state as any).players || [];
      for (const player of players) {
        if (player && player.id && player.id !== controller) {
          try {
            const drawn = drawCardsFromZone(ctx, player.id as PlayerID, otherDrawCount);
            debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} drew ${drawn.length} card(s)`);
          } catch (err) {
            debugWarn(1, `[resolveTopOfStack] Failed to draw cards for ${player.id}:`, err);
          }
        }
      }
    }
  }

  if (!shuffleHandAndGraveyardWheelMatch && oracleTextLower.includes('each player discards') && oracleTextLower.includes('hand')
    && (oracleTextLower.includes('then draws') || oracleTextLower.includes('draws cards equal'))) {
    const players = (state as any).players || [];
    const zones = state.zones || {};
    let greatestDiscarded = 0;

    for (const player of players) {
      if (player && player.id) {
        const playerZones = zones[player.id];
        if (playerZones && Array.isArray(playerZones.hand)) {
          const handSize = playerZones.hand.length;
          greatestDiscarded = Math.max(greatestDiscarded, handSize);

          playerZones.graveyard = playerZones.graveyard || [];
          for (const handCard of playerZones.hand) {
            if (handCard && typeof handCard === 'object') {
              (playerZones.graveyard as any[]).push({ ...handCard, zone: 'graveyard' });
            }
          }
          playerZones.hand = [];
          playerZones.handCount = 0;
          playerZones.graveyardCount = (playerZones.graveyard as any[]).length;

          debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} discarded ${handSize} card(s)`);
        }
      }
    }

    for (const player of players) {
      if (player && player.id && greatestDiscarded > 0) {
        try {
          const drawn = drawCardsFromZone(ctx, player.id as PlayerID, greatestDiscarded);
          debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} drew ${drawn.length} card(s) (greatest discarded: ${greatestDiscarded})`);
        } catch (err) {
          debugWarn(1, `[resolveTopOfStack] Failed to draw cards for ${player.id}:`, err);
        }
      }
    }
  }

  const drawThenDiscardMatch = shuffleHandAndGraveyardWheelMatch
    ? null
    : oracleTextLower.match(/draw\s+(\d+|a|an|one|two|three|four|five)\s+cards?(?:\.|,)?\s*(?:then\s+)?discard\s+(\d+|a|an|one|two|three|four|five)\s+cards?/i);
  if (drawThenDiscardMatch && !oracleTextLower.includes('each player')) {
    const wordToNumber: Record<string, number> = {
      a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    };
    const drawCount = wordToNumber[drawThenDiscardMatch[1].toLowerCase()] || parseInt(drawThenDiscardMatch[1], 10) || 1;
    const discardCount = wordToNumber[drawThenDiscardMatch[2].toLowerCase()] || parseInt(drawThenDiscardMatch[2], 10) || 1;

    try {
      const drawn = drawCardsFromZone(ctx, controller, drawCount);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} drew ${drawn.length} card(s)`);

      (state as any).pendingDiscard = (state as any).pendingDiscard || {};
      (state as any).pendingDiscard[controller] = {
        count: discardCount,
        source: effectiveCard.name || 'Spell',
        reason: 'spell_effect',
      };
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} must discard ${discardCount} card(s)`);
    } catch (err) {
      debugWarn(1, `[resolveTopOfStack] Failed to process draw/discard for ${controller}:`, err);
    }
  }

  const drawAndTreasureMatch = shuffleHandAndGraveyardWheelMatch
    ? null
    : oracleTextLower.match(/draw\s+(\d+|a|an|one|two|three|four|five)\s+cards?.*(?:create|creates?)\s+(?:a|an|one|two|three|\d+)?\s*treasure\s+tokens?/i);
  debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Checking draw+treasure pattern. Match: ${!!drawAndTreasureMatch}, drawThenDiscardMatch: ${!!drawThenDiscardMatch}, eachPlayer: ${oracleTextLower.includes('each player')}`);
  if (drawAndTreasureMatch && !oracleTextLower.includes('each player') && !drawThenDiscardMatch) {
    const wordToNumber: Record<string, number> = {
      a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    };
    const drawCount = wordToNumber[drawAndTreasureMatch[1].toLowerCase()] || parseInt(drawAndTreasureMatch[1], 10) || 1;

    const treasureCountMatch = oracleTextLower.match(/create\s+(?:a|an|(\d+)|one|two|three)\s*treasure\s+tokens?/i);
    const treasureCount = treasureCountMatch && treasureCountMatch[1]
      ? parseInt(treasureCountMatch[1], 10)
      : 1;

    debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Executing draw ${drawCount} + create ${treasureCount} treasure(s)`);
    try {
      const drawn = drawCardsFromZone(ctx, controller, drawCount);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} drew ${drawn.length} card(s)`);

      for (let i = 0; i < treasureCount; i++) {
        createTreasureToken(ctx, controller);
      }
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} created ${treasureCount} Treasure token(s)`);
    } catch (err) {
      debugWarn(1, `[resolveTopOfStack] Failed to process draw/treasure for ${controller}:`, err);
    }
  }

  if (!shuffleHandAndGraveyardWheelMatch && !eachPlayerDrawsMatch && !youDrawMatch && !drawThenDiscardMatch && !drawAndTreasureMatch) {
    const simpleDrawMatch = oracleTextLower.match(/^draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?\.?$/i)
      || oracleTextLower.match(/^draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?\s*$/i);

    const altDrawMatch = !simpleDrawMatch && oracleTextLower.startsWith('draw ')
      ? oracleTextLower.match(/^draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i)
      : null;

    const matchToUse = simpleDrawMatch || altDrawMatch;

    if (matchToUse) {
      const wordToNumber: Record<string, number> = {
        a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      };
      const drawCount = wordToNumber[matchToUse[1].toLowerCase()] || parseInt(matchToUse[1], 10) || 1;

      try {
        const drawn = drawCardsFromZone(ctx, controller, drawCount);
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} drew ${drawn.length} card(s) (simple draw spell)`);
      } catch (err) {
        debugWarn(1, `[resolveTopOfStack] Failed to draw cards for ${controller}:`, err);
      }
    }
  }
}
