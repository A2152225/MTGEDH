import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { queueSelfETBTriggersForPermanent, triggerETBEffectsForToken } from './triggerEtbEntryEffects.js';

export function applyPermanentSquadTokenCopiesOnEntry(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    isCreature: boolean;
    basePower: number | undefined;
    baseToughness: number | undefined;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const isCreature = options.isCreature;
  const baseP = options.basePower;
  const baseT = options.baseToughness;

  // Squad: "As an additional cost to cast this spell, you may pay {cost} any number of times. 
  // When this permanent enters the battlefield, create that many tokens that are copies of it."
  try {
    const squadTimesPaid = (card as any).squadTimesPaid;
    if (squadTimesPaid && squadTimesPaid > 0 && isCreature) {
      debug(2, `[resolveTopOfStack] Squad: Creating ${squadTimesPaid} token copies of ${effectiveCard.name || 'creature'}`);
      
      for (let i = 0; i < squadTimesPaid; i++) {
        const tokenId = uid("squad_token");
        const tokenCard = {
          id: `card_${tokenId}`,
          name: effectiveCard.name || 'Token',
          type_line: effectiveCard.type_line || 'Creature',
          oracle_text: effectiveCard.oracle_text || '',
          colors: (card as any).colors || [],
          power: effectiveCard.power,
          toughness: effectiveCard.toughness,
          image_uris: effectiveCard.image_uris,
          isToken: true,
        };
        
        const tokenPermanent = {
          id: tokenId,
          controller,
          owner: controller,
          tapped: false,
          counters: {},
          basePower: baseP,
          baseToughness: baseT,
          summoningSickness: true,
          isToken: true,
          card: { ...tokenCard, zone: 'battlefield' },
        } as any;
        
        state.battlefield.push(tokenPermanent);
        
        // Trigger ETB effects for each squad token
        queueSelfETBTriggersForPermanent(ctx, tokenPermanent, controller as any);
        triggerETBEffectsForToken(ctx, tokenPermanent, controller);
        
        debug(2, `[resolveTopOfStack] Squad: Created token copy #${i + 1} of ${effectiveCard.name}`);
      }
    }
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] Failed to create squad tokens:', err);
  }
  
}
