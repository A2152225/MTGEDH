import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { isJoinForcesSpell, isTemptingOfferSpell } from './oracleIrSpellLegacySpellShapeUtils.js';

export function applyInstantSorceryJoinForcesAndTemptingOfferHandlers(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    item: any;
    oracleText: string;
    oracleTextLower: string;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleText = options.oracleText;
  const oracleTextLower = options.oracleTextLower;

  const cardNameLower = (effectiveCard.name || '').toLowerCase();
  debug(1, `[resolveTopOfStack] Checking if ${effectiveCard.name} is a Join Forces spell...`);
  if (isJoinForcesSpell(effectiveCard.name, oracleTextLower)) {
    // Get players from state
    const allPlayers = (state as any).players || [];
    
    // Get turn order for APNAP ordering
    const turnOrder = allPlayers.map((p: any) => p.id);
    const activePlayerId = (state as any).activePlayer || controller;
    const gameId = (ctx as any).gameId || 'unknown';
    
    // Create resolution steps for each player using APNAP ordering
    // "Starting with you" means the caster goes first, then others in turn order
    const stepConfigs = allPlayers.map((p: any) => {
      const playerId = p.id;
      const isInitiator = playerId === controller;
      
      // Calculate available mana for this player
      const battlefield = state.battlefield || [];
      const untappedLands = battlefield.filter((perm: any) => 
        perm.controller === playerId && 
        !perm.tapped &&
        (perm.card?.type_line || '').toLowerCase().includes('land')
      ).length;
      
      return {
        type: ResolutionStepType.JOIN_FORCES,
        playerId,
        description: `${effectiveCard.name}: You may pay any amount of mana to contribute to this effect`,
        mandatory: false,
        sourceId: item.id,
        sourceName: effectiveCard.name || 'Join Forces Spell',
        sourceImage: effectiveCard.image_uris?.small,
        cardName: effectiveCard.name || 'Join Forces Spell',
        effectDescription: oracleText,
        cardImageUrl: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
        initiator: controller,
        availableMana: untappedLands,
        isInitiator,
      };
    });
    
    // Skip adding resolution steps during replay to prevent infinite loops
    const isReplaying = !!(ctx as any).isReplaying;
    if (!isReplaying) {
      // Add steps with APNAP ordering, starting with the caster
      ResolutionQueueManager.addStepsWithAPNAP(
        gameId,
        stepConfigs,
        turnOrder,
        controller // Start with caster, not active player
      );

      try {
        const queue = ResolutionQueueManager.getQueue(gameId);
        const persistedSteps = queue.steps
          .filter((step: any) => step?.type === ResolutionStepType.JOIN_FORCES && String((step as any).cardName || '') === String(effectiveCard.name || 'Join Forces Spell'))
          .map((step: any) => ({
            id: String(step.id),
            type: String(step.type),
            playerId: String(step.playerId),
            description: String(step.description || ''),
            mandatory: step.mandatory !== false,
            sourceId: step.sourceId ? String(step.sourceId) : undefined,
            sourceName: step.sourceName ? String(step.sourceName) : undefined,
            sourceImage: step.sourceImage,
            cardName: step.cardName ? String(step.cardName) : undefined,
            effectDescription: step.effectDescription ? String(step.effectDescription) : undefined,
            cardImageUrl: step.cardImageUrl,
            initiator: step.initiator ? String(step.initiator) : undefined,
            availableMana: Number(step.availableMana || 0),
            isInitiator: step.isInitiator === true,
            priority: Number(step.priority || 0),
          }));

        appendEvent(gameId, Number((ctx as any).seq?.value ?? 0), 'joinForcesInitiated', {
          cardName: effectiveCard.name || 'Join Forces Spell',
          initiator: controller,
          steps: persistedSteps,
        });
      } catch (err) {
        debugWarn(1, '[resolveTopOfStack] Failed to persist joinForcesInitiated event:', err);
      }
      
      debug(1, `[resolveTopOfStack] Join Forces spell ${effectiveCard.name} created ${allPlayers.length} resolution steps for contributions`);
    } else {
      debug(2, `[resolveTopOfStack] Join Forces: skipping resolution steps during replay`);
    }
  } else {
    debug(1, `[resolveTopOfStack] ${effectiveCard.name} is NOT a Join Forces spell (name: "${cardNameLower}", has 'join forces': ${oracleTextLower.includes('join forces')})`);
  }
  
  // Handle Tempting Offer spells (Tempt with Discovery, Tempt with Glory, etc.)
  // These require each opponent to choose whether to accept the offer
  // Uses the unified ResolutionQueueManager for proper APNAP ordering
  debug(2, `[resolveTopOfStack] Checking if ${effectiveCard.name} is a Tempting Offer spell...`);
  if (isTemptingOfferSpell(effectiveCard.name, oracleTextLower)) {
    // Get players from state
    const allPlayers = (state as any).players || [];
    
    // Get opponents (non-initiator players)
    const opponents = allPlayers.filter((p: any) => p.id !== controller);
    const turnOrder = allPlayers.map((p: any) => p.id);
    const gameId = (ctx as any).gameId || 'unknown';
    
    if (opponents.length > 0) {
      // Create resolution steps for each opponent using APNAP ordering
      const stepConfigs = opponents.map((p: any) => {
        const playerId = p.id;
        
        return {
          type: ResolutionStepType.TEMPTING_OFFER,
          playerId,
          description: `${effectiveCard.name}: Do you accept the tempting offer?`,
          mandatory: false,
          sourceId: item.id,
          sourceName: effectiveCard.name || 'Tempting Offer Spell',
          sourceImage: effectiveCard.image_uris?.small,
          cardName: effectiveCard.name || 'Tempting Offer Spell',
          effectDescription: oracleText,
          cardImageUrl: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
          initiator: controller,
          isOpponent: true,
        };
      });
      
      // Skip adding resolution steps during replay to prevent infinite loops
      const isReplaying = !!(ctx as any).isReplaying;
      if (!isReplaying) {
        // Add steps with APNAP ordering
        ResolutionQueueManager.addStepsWithAPNAP(
          gameId,
          stepConfigs,
          turnOrder,
          (state as any).activePlayer || controller
        );

        try {
          const queue = ResolutionQueueManager.getQueue(gameId);
          const persistedSteps = queue.steps
            .filter((step: any) => step?.type === ResolutionStepType.TEMPTING_OFFER && String((step as any).cardName || '') === String(effectiveCard.name || 'Tempting Offer Spell'))
            .map((step: any) => ({
              id: String(step.id),
              type: String(step.type),
              playerId: String(step.playerId),
              description: String(step.description || ''),
              mandatory: step.mandatory !== false,
              sourceId: step.sourceId ? String(step.sourceId) : undefined,
              sourceName: step.sourceName ? String(step.sourceName) : undefined,
              sourceImage: step.sourceImage,
              cardName: step.cardName ? String(step.cardName) : undefined,
              effectDescription: step.effectDescription ? String(step.effectDescription) : undefined,
              cardImageUrl: step.cardImageUrl,
              initiator: step.initiator ? String(step.initiator) : undefined,
              isOpponent: step.isOpponent === true,
              priority: Number(step.priority || 0),
            }));

          appendEvent(gameId, Number((ctx as any).seq?.value ?? 0), 'temptingOfferInitiated', {
            cardName: effectiveCard.name || 'Tempting Offer Spell',
            initiator: controller,
            steps: persistedSteps,
          });
        } catch (err) {
          debugWarn(1, '[resolveTopOfStack] Failed to persist temptingOfferInitiated event:', err);
        }
        
        debug(2, `[resolveTopOfStack] Tempting Offer spell ${effectiveCard.name} created ${opponents.length} resolution steps for opponent responses`);
      } else {
        debug(2, `[resolveTopOfStack] Tempting Offer: skipping resolution steps during replay`);
      }
    } else {
      // No opponents - initiator just gets the effect once
      debug(2, `[resolveTopOfStack] Tempting Offer spell ${effectiveCard.name} has no opponents - effect resolves immediately for initiator`);
    }
  } else {
    debug(2, `[resolveTopOfStack] ${effectiveCard.name} is NOT a Tempting Offer spell`);
  }
}
