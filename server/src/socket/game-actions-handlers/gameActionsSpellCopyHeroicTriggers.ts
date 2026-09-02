/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: copying a spell that is being cast (immediate and delayed
 * copies, copy retargeting, the copy resolve event) together with the
 * cast-time trigger families that hang off the spell's targets - heroic,
 * permanent-targeted triggers, and the spell-cast untap trigger.
 *
 * Public entry symbols: cloneTriggeredSpellCopy, consumeDelayedSpellCopiesForCast,
 * resolveSpellCopyRetargetValidTargets, buildSpellCopyRetargetValidTargetsFallback,
 * appendCopyTriggeredSpellResolveEvent, persistQueuedSpellCastStepContinuation,
 * parseCastSpellPower, applySpellCastUntapTrigger, getHeroicTriggers,
 * applyHeroicTrigger, processHeroicTriggersForTargets,
 * processTargetedTriggersForSpellTargets.
 */
import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db";
import { canPlayerBeTargetedByPlayer } from "../../rules-engine/targeting";
import { updateCounters } from "../../state/modules/counters_tokens.js";
import { persistNamedSpellCastThisGame } from "../../state/modules/namedSpellsCastThisGame.js";
import type { SpellCastTrigger } from "../../state/modules/triggered-abilities";
import {
  persistTargetedTriggeredStackItems,
  triggerPermanentTargetedTriggersFromSpell,
} from "../../state/modules/triggers/targeted.js";
import { ResolutionQueueManager, ResolutionStepType, createResolutionStep } from "../../state/resolution/index.js";
import { uid } from "../../state/utils";
import { debug, debugWarn } from "../../utils/debug.js";
import { getPlayerName } from "../util";

export function persistQueuedSpellCastStepContinuation(
  gameId: string,
  game: any,
  payload: Record<string, unknown>
): void {
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'castSpellContinuation', payload);
  } catch (err) {
    debugWarn(1, '[game-actions] appendEvent(castSpellContinuation queued-step) failed:', err);
  }
}

export function parseCastSpellPower(spellCard: any): number {
  const faceIndex = Number(spellCard?.faceIndex ?? 0);
  const faces = Array.isArray(spellCard?.card_faces) ? spellCard.card_faces : [];
  const face = faces[faceIndex];
  const raw = face?.power ?? spellCard?.power;
  if (raw === undefined || raw === null) return 0;
  const parsed = parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildSpellCopyRetargetValidTargetsFallback(
  game: any,
  controllerId: string,
  submittedTargets: unknown,
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(submittedTargets) || submittedTargets.length === 0) return null;

  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  const wantsPlayerTarget = submittedTargets.some((target: any) => {
    const id = String(target?.id || '').trim();
    const kind = String(target?.kind || target?.type || '').toLowerCase();
    if (kind === 'player') return true;
    return players.some((player: any) => String(player?.id || '') === id);
  });
  if (!wantsPlayerTarget) return null;

  return players
    .filter((player: any) => canPlayerBeTargetedByPlayer(player.id, game.state, controllerId))
    .map((player: any) => ({
      id: player.id,
      kind: 'player',
      name: player.name || player.id,
      isOpponent: String(player.id || '') !== String(controllerId || ''),
    }));
}

export function resolveSpellCopyRetargetValidTargets(
  game: any,
  controllerId: string,
  copiedItem: any,
  submittedTargets?: unknown,
): any[] {
  const fromItem = Array.isArray(copiedItem?.copyRetargetValidTargets) ? copiedItem.copyRetargetValidTargets : [];
  if (fromItem.length > 0) return fromItem;

  const fallback = buildSpellCopyRetargetValidTargetsFallback(game, controllerId, submittedTargets);
  if (fallback && fallback.length > 0) {
    copiedItem.copyRetargetValidTargets = fallback;
    if (!copiedItem.copyRetargetTargetTypes) {
      copiedItem.copyRetargetTargetTypes = ['player'];
    }
    if (!Number.isFinite(Number(copiedItem.copyRetargetMinTargets))) {
      const currentTargets = Array.isArray(copiedItem?.targets) ? copiedItem.targets : [];
      copiedItem.copyRetargetMinTargets = Math.max(1, currentTargets.length || 1);
      copiedItem.copyRetargetMaxTargets = Math.max(1, currentTargets.length || 1);
    }
    if (!String(copiedItem.copyRetargetTargetDescription || '').trim()) {
      copiedItem.copyRetargetTargetDescription = 'player';
    }
    return fallback;
  }

  return [];
}

export function appendCopyTriggeredSpellResolveEvent(
  gameId: string,
  game: any,
  payload: Record<string, unknown>,
): void {
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'copyTriggeredSpellResolve', payload);
  } catch (err) {
    debugWarn(1, '[castSpellFromHand] appendEvent(copyTriggeredSpellResolve) failed:', err);
  }
}

export function cloneTriggeredSpellCopy(
  gameId: string,
  game: any,
  io: Server,
  trigger: SpellCastTrigger,
  controllerId: string,
  triggeringStackItemId?: string,
  triggeringSpellCardId?: string,
  originalStackItem?: any,
): any | null {
  const normalizedStackItemId = String(triggeringStackItemId || '').trim();
  const normalizedTriggeringSpellCardId = String(triggeringSpellCardId || '').trim();

  const stack = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
  const original = originalStackItem
    || (normalizedStackItemId
      ? stack.find((item: any) => item && String(item.id || '').trim() === normalizedStackItemId)
      : undefined)
    || (!normalizedStackItemId && normalizedTriggeringSpellCardId
      ? stack.find((item: any) => (
        item
        && String(item?.card?.id || '').trim() === normalizedTriggeringSpellCardId
      ))
      : undefined);
  if (!original) {
    return null;
  }

  const copiedFromStackItemId = String((original as any)?.id || normalizedStackItemId).trim();

  const copiedItem: any = {
    ...original,
    id: uid('copied_spell'),
    type: String((original as any).type || 'spell'),
    controller: String((original as any).controller || controllerId),
    targets: Array.isArray((original as any).targets)
      ? (original as any).targets.map((target: any) => (
          target && typeof target === 'object' && !Array.isArray(target)
            ? { ...target }
            : target
        ))
      : (original as any).targets,
    card: (original as any).card ? { ...(original as any).card } : (original as any).card,
    spell: (original as any).spell ? { ...(original as any).spell } : (original as any).spell,
    searchParams: (original as any).searchParams ? { ...(original as any).searchParams } : (original as any).searchParams,
    targetRequirements: (original as any).targetRequirements ? { ...(original as any).targetRequirements } : (original as any).targetRequirements,
    manaPayment: (original as any).manaPayment
      ? (Array.isArray((original as any).manaPayment) ? [...(original as any).manaPayment] : { ...(original as any).manaPayment })
      : (original as any).manaPayment,
    counterImmunity: (original as any).counterImmunity
      ? (Array.isArray((original as any).counterImmunity) ? [...(original as any).counterImmunity] : { ...(original as any).counterImmunity })
      : (original as any).counterImmunity,
    entersBattlefieldWithCounters: (original as any).entersBattlefieldWithCounters
      ? { ...(original as any).entersBattlefieldWithCounters }
      : (original as any).entersBattlefieldWithCounters,
    copyRetargetValidTargets: Array.isArray((original as any).copyRetargetValidTargets)
      ? (original as any).copyRetargetValidTargets.map((target: any) => (
          target && typeof target === 'object' && !Array.isArray(target)
            ? { ...target }
            : target
        ))
      : (original as any).copyRetargetValidTargets,
    copyRetargetTargetTypes: Array.isArray((original as any).copyRetargetTargetTypes)
      ? [...(original as any).copyRetargetTargetTypes]
      : (original as any).copyRetargetTargetTypes,
    copiedFromStackItemId,
    copiedBySourceName: trigger.cardName,
    isCopy: true,
  };

  stack.push(copiedItem);
  if (String(copiedItem.type || (original as any).type || '').toLowerCase() === 'spell') {
    persistNamedSpellCastThisGame(game.state, String(copiedItem.controller || controllerId).trim(), {
      name: copiedItem?.card?.name || (original as any)?.card?.name,
      id: copiedItem.id,
    });
  }

  appendCopyTriggeredSpellResolveEvent(gameId, game, {
    sourceId: String(trigger.permanentId || '').trim() || undefined,
    sourceName: String(trigger.cardName || 'Spell copy').trim() || 'Spell copy',
    controllerId: String(controllerId || '').trim() || undefined,
    triggeringStackItemId: copiedFromStackItemId,
    copiedStackItemId: String((copiedItem as any).id || '').trim() || undefined,
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${trigger.cardName} copies ${String((original as any)?.card?.name || (original as any)?.sourceName || 'that spell')}.`,
    ts: Date.now(),
  });

  const allowsRetargeting = /choose new targets for the copy\.?/i.test(`${String(trigger.description || '')} ${String(trigger.effect || '')}`);
  const currentTargets = Array.isArray((copiedItem as any).targets) ? (copiedItem as any).targets : [];
  const validTargets = resolveSpellCopyRetargetValidTargets(
    game,
    controllerId,
    copiedItem,
    currentTargets,
  );

  if (allowsRetargeting && validTargets.length > 0 && currentTargets.length > 0) {
    const queuedResolutionStep = createResolutionStep({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: controllerId as any,
      description: `${trigger.cardName}: You may choose new targets for the copy.`,
      mandatory: false,
      sourceId: String((copiedItem as any).id || '').trim() || undefined,
      sourceName: trigger.cardName,
      options: [
        { id: 'keep', label: 'Keep current targets' },
        { id: 'retarget', label: 'Choose new targets' },
      ],
      minSelections: 1,
      maxSelections: 1,
      retargetSpellCopy: true,
      retargetSpellCopyStackItemId: String((copiedItem as any).id || '').trim(),
      retargetSpellCopyValidTargets: validTargets.map((target: any) => ({ ...target })),
      retargetSpellCopyMinTargets: Number((copiedItem as any).copyRetargetMinTargets || currentTargets.length || 1),
      retargetSpellCopyMaxTargets: Number((copiedItem as any).copyRetargetMaxTargets || currentTargets.length || 1),
      retargetSpellCopyTargetDescription: String((copiedItem as any).copyRetargetTargetDescription || 'target'),
    } as any);

    persistQueuedSpellCastStepContinuation(gameId, game, {
      playerId: controllerId,
      cardId: String((original as any)?.card?.id || ''),
      queuedResolutionStep,
    });

    ResolutionQueueManager.addStep(gameId, queuedResolutionStep as any);
  }

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }

  return copiedItem;
}

function spellQualifiesForDelayedCopy(entry: any, spellCard: any, casterId: string): boolean {
  if (!entry || String(entry?.controllerId || '') !== String(casterId)) {
    return false;
  }

  const spellType = String(entry?.spellType || '').trim();
  const typeLine = String(spellCard?.type_line || '').toLowerCase();
  if (spellType === 'instant_or_sorcery') {
    return typeLine.includes('instant') || typeLine.includes('sorcery');
  }

  return false;
}

export function consumeDelayedSpellCopiesForCast(
  gameId: string,
  game: any,
  io: Server,
  casterId: string,
  spellCard: any,
  triggeringStackItemId?: string,
  originalStackItem?: any,
  delayedEntriesOverride?: any[],
): void {
  let normalizedTriggeringStackItemId = String(triggeringStackItemId || '').trim();
  if (!normalizedTriggeringStackItemId) {
    const stackArr: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
    for (let i = stackArr.length - 1; i >= 0; i--) {
      const item = stackArr[i];
      if (!item || String(item.controller || '') !== String(casterId)) continue;
      if (String(item?.card?.id || '') !== String(spellCard?.id || '')) continue;
      normalizedTriggeringStackItemId = String(item.id || '').trim();
      break;
    }
  }
  if (!normalizedTriggeringStackItemId) {
    return;
  }

  const stateAny = (game.state as any) || {};
  const delayedEntries = Array.isArray(delayedEntriesOverride)
    ? delayedEntriesOverride
    : Array.isArray((game as any).delayedSpellCopiesThisTurn)
    ? (game as any).delayedSpellCopiesThisTurn
    : Array.isArray(stateAny.delayedSpellCopiesThisTurn)
    ? stateAny.delayedSpellCopiesThisTurn
    : [];
  if (delayedEntries.length === 0) {
    return;
  }

  const matchingEntries = delayedEntries.filter((entry: any) => spellQualifiesForDelayedCopy(entry, spellCard, casterId));
  if (matchingEntries.length === 0) {
    return;
  }

  const stack = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
  const original = originalStackItem
    || stack.find((item: any) => item && String(item.id || '').trim() === normalizedTriggeringStackItemId);
  if (!original) {
    return;
  }

  const copiedFromStackItemId = String((original as any)?.id || normalizedTriggeringStackItemId).trim();
  const remainingEntries = delayedEntries.filter((entry: any) => !matchingEntries.includes(entry));
  stateAny.delayedSpellCopiesThisTurn = remainingEntries;
  (game as any).delayedSpellCopiesThisTurn = remainingEntries;

  for (const entry of matchingEntries) {
    const sourceName = String(entry?.sourceName || 'Spell copy').trim() || 'Spell copy';
    const copiedItem: any = {
      ...original,
      id: uid('copied_spell'),
      type: String((original as any).type || 'spell'),
      controller: String((original as any).controller || casterId),
      targets: Array.isArray((original as any).targets)
        ? (original as any).targets.map((target: any) => (
            target && typeof target === 'object' && !Array.isArray(target)
              ? { ...target }
              : target
          ))
        : (original as any).targets,
      card: (original as any).card ? { ...(original as any).card } : (original as any).card,
      spell: (original as any).spell ? { ...(original as any).spell } : (original as any).spell,
      searchParams: (original as any).searchParams ? { ...(original as any).searchParams } : (original as any).searchParams,
      targetRequirements: (original as any).targetRequirements ? { ...(original as any).targetRequirements } : (original as any).targetRequirements,
      manaPayment: (original as any).manaPayment
        ? (Array.isArray((original as any).manaPayment) ? [...(original as any).manaPayment] : { ...(original as any).manaPayment })
        : (original as any).manaPayment,
      counterImmunity: (original as any).counterImmunity
        ? (Array.isArray((original as any).counterImmunity) ? [...(original as any).counterImmunity] : { ...(original as any).counterImmunity })
        : (original as any).counterImmunity,
      entersBattlefieldWithCounters: (original as any).entersBattlefieldWithCounters
        ? { ...(original as any).entersBattlefieldWithCounters }
        : (original as any).entersBattlefieldWithCounters,
      copyRetargetValidTargets: Array.isArray((original as any).copyRetargetValidTargets)
        ? (original as any).copyRetargetValidTargets.map((target: any) => (
            target && typeof target === 'object' && !Array.isArray(target)
              ? { ...target }
              : target
          ))
        : (original as any).copyRetargetValidTargets,
      copyRetargetTargetTypes: Array.isArray((original as any).copyRetargetTargetTypes)
        ? [...(original as any).copyRetargetTargetTypes]
        : (original as any).copyRetargetTargetTypes,
      copiedFromStackItemId,
      copiedBySourceName: sourceName,
      isCopy: true,
    };

    stack.push(copiedItem);
    if (String(copiedItem.type || (original as any).type || '').toLowerCase() === 'spell') {
      persistNamedSpellCastThisGame(game.state, String(copiedItem.controller || casterId).trim(), {
        name: copiedItem?.card?.name || (original as any)?.card?.name,
        id: copiedItem.id,
      });
    }

    appendCopyTriggeredSpellResolveEvent(gameId, game, {
      sourceId: String(entry?.sourceId || '').trim() || undefined,
      sourceName,
      controllerId: String(casterId || '').trim() || undefined,
      triggeringStackItemId: copiedFromStackItemId,
      copiedStackItemId: String((copiedItem as any).id || '').trim() || undefined,
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName} copies ${String((original as any)?.card?.name || (original as any)?.sourceName || 'that spell')}.`,
      ts: Date.now(),
    });

    const validTargets = resolveSpellCopyRetargetValidTargets(
      game,
      casterId,
      copiedItem,
      Array.isArray((copiedItem as any).targets) ? (copiedItem as any).targets : [],
    );
    const currentTargets = Array.isArray((copiedItem as any).targets) ? (copiedItem as any).targets : [];
    if (entry?.allowRetargeting === true && validTargets.length > 0 && currentTargets.length > 0) {
      const queuedResolutionStep = createResolutionStep({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: casterId as any,
        description: `${sourceName}: You may choose new targets for the copy.`,
        mandatory: false,
        sourceId: String((copiedItem as any).id || '').trim() || undefined,
        sourceName,
        options: [
          { id: 'keep', label: 'Keep current targets' },
          { id: 'retarget', label: 'Choose new targets' },
        ],
        minSelections: 1,
        maxSelections: 1,
        retargetSpellCopy: true,
        retargetSpellCopyStackItemId: String((copiedItem as any).id || '').trim(),
        retargetSpellCopyValidTargets: validTargets.map((target: any) => ({ ...target })),
        retargetSpellCopyMinTargets: Number((copiedItem as any).copyRetargetMinTargets || currentTargets.length || 1),
        retargetSpellCopyMaxTargets: Number((copiedItem as any).copyRetargetMaxTargets || currentTargets.length || 1),
        retargetSpellCopyTargetDescription: String((copiedItem as any).copyRetargetTargetDescription || 'target'),
      } as any);

      persistQueuedSpellCastStepContinuation(gameId, game, {
        playerId: casterId,
        cardId: String((original as any)?.card?.id || ''),
        queuedResolutionStep,
      });

      ResolutionQueueManager.addStep(gameId, queuedResolutionStep as any);
    }
  }

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
}

/**
 * Apply spell-cast untap trigger effects (Jeskai Ascendancy, Paradox Engine)
 */
export function applySpellCastUntapTrigger(game: any, playerId: string): number {
  const battlefield = game.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.tapped) continue;
    if (permanent.controller !== playerId) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    
    // Untap creatures (Jeskai Ascendancy pattern)
    if (typeLine.includes('creature')) {
      permanent.tapped = false;
      untappedCount++;
    }
  }
  
  return untappedCount;
}

/**
 * Heroic trigger type definition
 */
interface HeroicTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effect: string;
  description: string;
}

/**
 * Get heroic triggers for creatures targeted by a spell
 * Heroic: "Whenever you cast a spell that targets this creature..."
 * 
 * @param game The game instance
 * @param casterId The player who cast the spell
 * @param targetIds The IDs of permanents targeted by the spell
 * @returns Array of heroic triggers to fire
 */
export function getHeroicTriggers(game: any, casterId: string, targetIds: string[]): HeroicTrigger[] {
  const triggers: HeroicTrigger[] = [];
  const battlefield = game.state?.battlefield || [];
  
  if (!targetIds || targetIds.length === 0) return triggers;
  
  for (const targetId of targetIds) {
    const permanent = battlefield.find((p: any) => p?.id === targetId);
    if (!permanent || !permanent.card) continue;
    
    // Heroic only triggers on creatures you control
    if (permanent.controller !== casterId) continue;
    
    const typeLine = (permanent.card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const oracleText = (permanent.card.oracle_text || '');
    const lowerOracle = oracleText.toLowerCase();
    const lowerCardName = String(permanent.card.name || '').toLowerCase();
    
    // Check for heroic pattern: "Heroic G�� Whenever you cast a spell that targets ~"
    // Must match the specific keyword ability format with em-dash or colon
    // Also check for non-keyworded heroic: "Whenever you cast a spell that targets this creature"
    const heroicKeywordMatch = /heroic\s*(?:�|�|:|-|G��)/i.test(oracleText);
    const hasTargetTrigger = lowerOracle.includes('whenever you cast a spell that targets') && 
                 (lowerOracle.includes('this creature') || lowerOracle.includes('~') || (!!lowerCardName && lowerOracle.includes(`targets ${lowerCardName}`)));
    
    if (heroicKeywordMatch || hasTargetTrigger) {
      // Extract the effect text - handle multi-sentence effects by capturing until end of ability
      let effectText = '';
      
      // Try to match heroic pattern with em-dash/colon - capture everything after the trigger condition
      // Use a more permissive pattern that captures until newline or end of text
      const heroicMatch = oracleText.match(/heroic\s*(?:�|�|:|-|G��)\s*whenever you cast a spell that targets [^,\n]+,?\s*(.+?)(?:\n|$)/i);
      if (heroicMatch) {
        effectText = heroicMatch[1].trim();
      } else {
        // Try generic pattern for non-keyworded heroic
        const escapedCardName = lowerCardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const genericMatch = oracleText.match(new RegExp(`whenever you cast a spell that targets (?:this creature|~|${escapedCardName}),?\\s*(.+?)(?:\\n|$)`, 'i'));
        if (genericMatch) {
          effectText = genericMatch[1].trim();
        }
      }
      
      if (effectText) {
        triggers.push({
          permanentId: permanent.id,
          cardName: permanent.card.name || 'Unknown',
          controllerId: permanent.controller,
          effect: effectText,
          description: `Heroic G�� Whenever you cast a spell that targets ${permanent.card.name}, ${effectText}`,
        });
      }
    }
  }
  
  return triggers;
}

/**
 * Apply heroic trigger effects
 * 
 * @param game The game instance
 * @param trigger The heroic trigger to apply
 * @param io Socket.io server instance
 * @param gameId The game ID
 */
export function applyHeroicTrigger(game: any, trigger: HeroicTrigger, io: any, gameId: string): void {
  const effectLower = trigger.effect.toLowerCase();
  const battlefield = game.state?.battlefield || [];
  
  // Find the permanent that has the heroic ability
  const permanent = battlefield.find((p: any) => p?.id === trigger.permanentId);
  if (!permanent) return;
  
  // Common heroic effects:
  
  // "+1/+1 counter" pattern (Favored Hoplite, Hero of Leina Tower, Phalanx Leader, etc.)
  if (effectLower.includes('+1/+1 counter') || effectLower.includes('put a +1/+1 counter')) {
    updateCounters(
      {
        state: game.state,
        bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
        gameId,
      } as any,
      String(permanent.id),
      { '+1/+1': 1 },
    );

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${trigger.cardName}'s Heroic triggers! Put a +1/+1 counter on ${trigger.cardName}.`,
      ts: Date.now(),
    });
    return;
  }
  
  // "draw a card" pattern (Sage of Hours, etc.)
  if (effectLower.includes('draw a card') || effectLower.includes('draw cards')) {
    if (typeof game.drawCards === 'function') {
      game.drawCards(trigger.controllerId, 1);
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${trigger.cardName}'s Heroic triggers! ${getPlayerName(game, trigger.controllerId)} draws a card.`,
        ts: Date.now(),
      });
    }
    return;
  }
  
  // "scry" pattern (Battlewise Hoplite)
  if (effectLower.includes('scry')) {
    const scryMatch = effectLower.match(/scry (\d+)/);
    const scryAmount = scryMatch ? parseInt(scryMatch[1], 10) : 1;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${trigger.cardName}'s Heroic triggers! ${getPlayerName(game, trigger.controllerId)} may scry ${scryAmount}.`,
      ts: Date.now(),
    });
    // Note: Full scry implementation requires UI interaction
    return;
  }
  
  // "gains first strike" or "gains [keyword]" until end of turn
  if (effectLower.includes('gains ') && effectLower.includes('until end of turn')) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${trigger.cardName}'s Heroic triggers! ${trigger.effect}`,
      ts: Date.now(),
    });
    // Note: Temporary keyword grants would need more complex tracking
    return;
  }
  
  // "+X/+X" or "gets +X/+X" until end of turn
  const pumpMatch = effectLower.match(/gets? \+(\d+)\/\+(\d+)/);
  if (pumpMatch) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${trigger.cardName}'s Heroic triggers! ${trigger.cardName} gets +${pumpMatch[1]}/+${pumpMatch[2]} until end of turn.`,
      ts: Date.now(),
    });
    // Note: Temporary pump effects would need end-of-turn cleanup
    return;
  }
  
  // Default: just announce the trigger
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${trigger.cardName}'s Heroic triggers! ${trigger.effect}`,
    ts: Date.now(),
  });
}

export function processHeroicTriggersForTargets(
  game: any,
  casterId: string,
  targetIds: string[],
  io: any,
  gameId: string,
): void {
  const normalizedTargetIds = Array.from(new Set(
    (Array.isArray(targetIds) ? targetIds : [])
      .map((targetId) => String(targetId || '').trim())
      .filter(Boolean),
  ));
  if (normalizedTargetIds.length === 0) {
    return;
  }

  const heroicTriggers = getHeroicTriggers(game, casterId, normalizedTargetIds);
  for (const trigger of heroicTriggers) {
    debug(2, `[processHeroicTriggersForTargets] Heroic triggered: ${trigger.cardName} - ${trigger.description}`);
    applyHeroicTrigger(game, trigger, io, gameId);
  }

  processTargetedTriggersForSpellTargets(game, casterId, normalizedTargetIds, gameId);
}

export function processTargetedTriggersForSpellTargets(
  game: any,
  casterId: string,
  targetIds: string[],
  gameId: string,
  stackItemId?: string,
): void {
  const normalizedTargetIds = Array.from(new Set(
    (Array.isArray(targetIds) ? targetIds : [])
      .map((targetId) => String(targetId || '').trim())
      .filter(Boolean),
  ));
  if (normalizedTargetIds.length === 0) return;

  const targetedTriggers = triggerPermanentTargetedTriggersFromSpell(game as any, {
    castBy: casterId as any,
    targetIds: normalizedTargetIds,
    ...(stackItemId ? { stackItemId } : {}),
  });
  persistTargetedTriggeredStackItems(gameId, game, targetedTriggers);
}
