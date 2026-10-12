/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: deciding which spell-cast triggers a cast produces and the
 * per-turn bookkeeping around them - detecting triggers on the battlefield,
 * once-per-turn usage keys, recording the cast, the token some cast triggers
 * make, and the optional-payment choice a cast trigger can ask for.
 *
 * Public entry symbols: getSpellCastTriggersForCard, recordSpellCastThisTurn,
 * createSpellCastTriggerToken, resolveSpellCastOptionalPaymentChoice,
 * hasSpellCastTriggerTriggeredThisTurn, markSpellCastTriggerTriggeredThisTurn,
 * normalizeSpellCastSourceZone.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import {
  consumeChosenTypeFlashGrantsAfterCast,
  consumeConvokeGrantsAfterCast,
} from "../../state/modules/casting-modifiers.js";
import { createToken } from "../../state/modules/counters_tokens.js";
import { getEffectiveColors } from "../../state/modules/effectiveColors.js";
import { persistNamedSpellCastThisGame } from "../../state/modules/namedSpellsCastThisGame.js";
import { consumeNextSpellCostReductionAfterCast } from "../../state/modules/nextSpellCostReduction.js";
import { detectSpellCastTriggers, type SpellCastTrigger } from "../../state/modules/triggered-abilities";
import { spellSharesCreatureTypeWithSource } from "../../state/modules/triggers/spellCastSharedCreatureType.js";
import { spellCastTriggerIRVerdict } from "../../state/modules/triggers/triggerIRVerdict.js";
import { debugWarn } from "../../utils/debug.js";
import {
  broadcastGame,
  broadcastManaPoolUpdate,
  emitToPlayer,
  getOrInitManaPool,
  getPlayerName,
  payManaCostWithAvailableSources,
} from "../util";
import { extractCreatureTypes, type SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import { parseCastSpellPower } from "./gameActionsSpellCopyHeroicTriggers.js";

export function normalizeSpellCastSourceZone(value: unknown): SpellCastSourceZone | undefined {
  return value === 'hand' || value === 'exile' || value === 'graveyard' || value === 'library' || value === 'command'
    ? value
    : undefined;
}

/**
 * Get spell-cast triggers that should fire for a spell being cast
 * Checks battlefield for permanents with spell-cast triggered abilities
 */
export function getSpellCastTriggersForCard(game: any, casterId: string, spellCard: any, castSourceZone?: SpellCastSourceZone): SpellCastTrigger[] {
  const triggers: SpellCastTrigger[] = [];
  const battlefield = game.state?.battlefield || [];

  const matchesSpellCastTriggerCondition = (
    card: any,
    trigger: SpellCastTrigger,
    sourcePermanent?: any,
    spellSourceZone = castSourceZone,
  ): boolean => {
    if (!legacySpellCastTriggerCondition(card, trigger, sourcePermanent, spellSourceZone)) return false;
    // The legacy enum drops qualifiers ("artifact creature spell" -> creature); the printed
    // sentence's IR keeps them and can only narrow the match.
    return spellCastTriggerIRVerdict({
      trigger,
      sourcePermanent,
      spellCard: card,
      casterId,
      effectiveSpellColors: getEffectiveColors(card, game.state),
    }) !== false;
  };

  const legacySpellCastTriggerCondition = (
    card: any,
    trigger: SpellCastTrigger,
    sourcePermanent?: any,
    spellSourceZone = castSourceZone,
  ): boolean => {
    // Cycle triggers share the detector but fire on cycling, never on a spell cast.
    if (trigger.triggerEvent === 'cycle') return false;
    if (trigger.sourceZoneRequirement === 'hand' && spellSourceZone && spellSourceZone !== 'hand') {
      return false;
    }
    if (trigger.sourceZoneRequirement === 'library' && spellSourceZone !== 'library') {
      return false;
    }
    if (trigger.sourceZoneRequirement === 'exile' && spellSourceZone !== 'exile') {
      return false;
    }
    if (trigger.sourceZoneRequirement === 'graveyard' && spellSourceZone !== 'graveyard') {
      return false;
    }
    // Fail closed: an unknown cast zone is not "anywhere other than your hand".
    if (trigger.sourceZoneRequirement === 'not_hand' && (!spellSourceZone || spellSourceZone === 'hand')) {
      return false;
    }
    if (trigger.requiresSharedCreatureTypeWithSource && !spellSharesCreatureTypeWithSource(card, sourcePermanent)) {
      return false;
    }

    const spellTypeLine = String(card?.type_line || '').toLowerCase();
    const isCreatureSpell = spellTypeLine.includes('creature');
    const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');
    const isHistoricSpell = spellTypeLine.includes('artifact') || spellTypeLine.includes('legendary') || spellTypeLine.includes('saga');
    const spellColors = Array.isArray(card?.colors)
      ? card.colors
      : (Array.isArray(card?.color_identity) ? card.color_identity : []);
    const isColorlessSpell = spellColors.length === 0;

    if (trigger.minSpellPower != null) {
      if (!isCreatureSpell) return false;
      return parseCastSpellPower(card) >= Number(trigger.minSpellPower);
    }

    switch (trigger.spellCondition) {
      case 'any':
        return true;
      case 'creature':
        return isCreatureSpell;
      case 'noncreature':
        return !isCreatureSpell;
      case 'instant_sorcery':
        return isInstantOrSorcery;
      case 'colorless':
        return isColorlessSpell;
      case 'historic':
        return isHistoricSpell;
      case 'artifact_or_creature':
        return isCreatureSpell || spellTypeLine.includes('artifact');
      case 'tribal_type': {
        if (!trigger.tribalType) return false;
        const spellSubtypes = extractCreatureTypes(spellTypeLine);
        return spellSubtypes.includes(trigger.tribalType.toLowerCase()) ||
          spellTypeLine.includes(trigger.tribalType.toLowerCase());
      }
      case 'color': {
        if (!trigger.tribalType) return false;
        return spellColors.map((color) => String(color).toLowerCase()).includes(trigger.tribalType.toLowerCase());
      }
      case 'chosen_color': {
        const chosen = String(
          sourcePermanent?.chosenColor
          || sourcePermanent?.card?.chosenColor
          || '',
        ).trim().toLowerCase();
        if (!chosen) return false;
        const colorWordToSymbol: Record<string, string> = {
          white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g',
          w: 'w', u: 'u', b: 'b', r: 'r', g: 'g',
        };
        const chosenSymbol = colorWordToSymbol[chosen] || chosen;
        const effectiveSpellColors = getEffectiveColors(card, game.state).map((c) => c.toLowerCase());
        return effectiveSpellColors.includes(chosen) || effectiveSpellColors.includes(chosenSymbol);
      }
      default:
        return false;
    }
  };
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.controller !== casterId) continue; // Only controller's permanents trigger
    
    const permTriggers = detectSpellCastTriggers(permanent.card, permanent, game.state);
    
    for (const trigger of permTriggers) {
      let shouldTrigger = matchesSpellCastTriggerCondition(spellCard, trigger, permanent);

      if (shouldTrigger && trigger.firstSpellThisTurn === true) {
        const matchingSpellsCastThisTurn = (Array.isArray(game.state?.spellsCastThisTurn) ? game.state.spellsCastThisTurn : [])
          .filter((castEntry: any) => String(castEntry?.casterId || '') === String(casterId))
          .filter((castEntry: any) => {
            const castCard = castEntry?.card || castEntry;
            const castEntrySourceZone = normalizeSpellCastSourceZone(
              castEntry?.castSourceZone ?? castEntry?.fromZone ?? castCard?.castSourceZone ?? castCard?.fromZone
            );
            return matchesSpellCastTriggerCondition(castCard, trigger, permanent, castEntrySourceZone);
          })
          .length;
        shouldTrigger = matchingSpellsCastThisTurn === 1;
      }

      if (shouldTrigger && trigger.firstSpellDuringOpponentTurn === true) {
        const activePlayer = String(game.state?.activePlayer || '');
        const controllerId = String(permanent.controller || '');
        const spellsCastThisTurnByCaster = (Array.isArray(game.state?.spellsCastThisTurn) ? game.state.spellsCastThisTurn : [])
          .filter((castEntry: any) => String(castEntry?.casterId || '') === String(casterId)).length;
        shouldTrigger = activePlayer !== controllerId && spellsCastThisTurnByCaster === 1;
      }
      
      // The legacy detector can emit the same printed sentence twice under different enums
      // ("artifact creature spell" as creature and as a bogus tribal type).
      if (shouldTrigger && triggers.some((existing) => (
        existing.permanentId === trigger.permanentId
        && String(existing.description || '') !== ''
        && existing.description === trigger.description
      ))) {
        shouldTrigger = false;
      }

      if (shouldTrigger) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

function getSpellCastTriggerUsageKey(trigger: SpellCastTrigger): string {
  const effectKey = trigger.replacementEffect?.kind || trigger.effect || trigger.description;
  return `${String(trigger.permanentId || '')}:${String(effectKey || '')}`;
}

export function hasSpellCastTriggerTriggeredThisTurn(game: any, trigger: SpellCastTrigger): boolean {
  if (!trigger.oncePerTurn) return false;
  const turnNumber = Number((game.state as any)?.turnNumber ?? 0);
  const usage = ((game.state as any).spellCastTriggerUsageThisTurn || {})[getSpellCastTriggerUsageKey(trigger)];
  return usage === turnNumber;
}

export function markSpellCastTriggerTriggeredThisTurn(game: any, trigger: SpellCastTrigger): void {
  if (!trigger.oncePerTurn) return;
  const stateAny = game.state as any;
  stateAny.spellCastTriggerUsageThisTurn = stateAny.spellCastTriggerUsageThisTurn || {};
  stateAny.spellCastTriggerUsageThisTurn[getSpellCastTriggerUsageKey(trigger)] = Number(stateAny.turnNumber ?? 0);
}

export function recordSpellCastThisTurn(
  game: any,
  casterId: string,
  spellCard: any,
  castSourceZone?: SpellCastSourceZone,
): void {
  try {
    game.state.spellsCastThisTurn = game.state.spellsCastThisTurn || [];
    game.state.spellsCastThisTurn.push({
      id: spellCard?.id,
      name: spellCard?.name,
      casterId,
      ts: Date.now(),
      ...(castSourceZone ? { castSourceZone } : {}),
      card: {
        id: spellCard?.id,
        name: spellCard?.name,
        type_line: spellCard?.type_line,
        colors: spellCard?.colors,
        color_identity: spellCard?.color_identity,
        ...(castSourceZone ? { castSourceZone } : {}),
      },
    });
    persistNamedSpellCastThisGame(game.state, casterId, spellCard);
    consumeNextSpellCostReductionAfterCast(game.state as any, casterId as PlayerID);
    consumeConvokeGrantsAfterCast(game.state, casterId as PlayerID, spellCard, castSourceZone);
    consumeChosenTypeFlashGrantsAfterCast(game.state, casterId as PlayerID, spellCard);
  } catch (err) {
    debugWarn(2, '[recordSpellCastThisTurn] Failed to track spellsCastThisTurn:', err);
  }
}

export function createSpellCastTriggerToken(game: any, io: Server, gameId: string, casterId: string, trigger: SpellCastTrigger): void {
  if (!trigger.createsToken || !trigger.tokenDetails) return;

  const details = trigger.tokenDetails;
  const colorMap: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
  };
  const detailColors = 'colors' in details && Array.isArray(details.colors)
    ? details.colors
    : undefined;
  const colors = detailColors
    ? detailColors.map((color: string) => colorMap[String(color).toLowerCase()] || String(color).toUpperCase())
    : undefined;

  const createdTokenIds = createToken(
    {
      state: game.state,
      bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
      gameId,
    } as any,
    casterId as any,
    details.name,
    1,
    details.power,
    details.toughness,
    {
      colors,
      typeLine: details.types,
      abilities: Array.isArray(details.abilities) ? details.abilities : undefined,
    },
  );

  const abilitiesText = details.abilities
    ? details.abilities.map((ability: string) => ability.charAt(0).toUpperCase() + ability.slice(1)).join(', ')
    : '';
  const abilitiesDisplay = abilitiesText ? ` with ${abilitiesText}` : '';
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${trigger.cardName}: ${getPlayerName(game, casterId)} creates ${createdTokenIds.length} ${details.power}/${details.toughness} ${details.name}${abilitiesDisplay}.`,
    ts: Date.now(),
  });
}

export function resolveSpellCastOptionalPaymentChoice(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  trigger: SpellCastTrigger,
  payMana: boolean,
): void {
  const manaCost = String(trigger.optionalPaymentCost || '').trim();
  if (payMana) {
    if (manaCost) {
      const payment = payManaCostWithAvailableSources(game.state, playerId, manaCost);
      const pool = getOrInitManaPool(game.state, playerId as PlayerID);
      const validationError = payment.ok ? null : payment.error || 'Insufficient mana.';
      if (validationError) {
        emitToPlayer(io, playerId as PlayerID, 'error', {
          code: 'INSUFFICIENT_MANA',
          message: `Cannot pay ${manaCost}: ${validationError}`,
        });
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${getPlayerName(game, playerId)} couldn't pay ${manaCost} for ${trigger.cardName}'s trigger.`,
          ts: Date.now(),
        });
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        broadcastGame(io, game, gameId);
        return;
      }
      broadcastManaPoolUpdate(io, gameId, playerId as PlayerID, pool as any, `Spell-cast trigger payment for ${trigger.cardName}`, game);
    }

    createSpellCastTriggerToken(game, io, gameId, playerId, trigger);
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} paid ${manaCost} for ${trigger.cardName}'s trigger.`,
      ts: Date.now(),
    });
  } else {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} declined to pay ${manaCost} for ${trigger.cardName}'s trigger.`,
      ts: Date.now(),
    });
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
}
