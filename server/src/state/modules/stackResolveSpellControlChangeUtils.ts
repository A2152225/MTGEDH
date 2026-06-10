import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, parsePT } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { permanentsShareCardType, selectionRequiresSharedCardType } from '../../rules-engine/targeting.js';
import { movePermanentToHand, movePermanentToGraveyard } from './zones.js';
import { addExtraTurn } from './turn.js';
import { syncPreparedPermanentAfterControlChange } from './prepared.js';
import {
  queueSelfETBTriggersForPermanent,
  triggerETBEffectsForToken,
} from './triggerEtbPermanentEffects.js';
import { isExtraTurnSpell } from './oracleIrSpellLegacySpellShapeUtils.js';

function buildPermanentTokenCopy(
  sourcePermanent: any,
  tokenId: string,
  controller: PlayerID,
): any {
  const sourceCard = sourcePermanent?.card && typeof sourcePermanent.card === 'object'
    ? JSON.parse(JSON.stringify(sourcePermanent.card))
    : {};
  const typeLine = String(sourceCard?.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  const keywords = Array.isArray(sourceCard?.keywords)
    ? sourceCard.keywords.map((value: any) => String(value || ''))
    : [];
  const oracleText = String(sourceCard?.oracle_text || '');
  const hasHaste = keywords.some((value: string) => /\bhaste\b/i.test(value)) || /\bhaste\b/i.test(oracleText);

  return {
    id: tokenId,
    controller,
    owner: controller,
    tapped: false,
    counters: sourcePermanent?.counters ? { ...sourcePermanent.counters } : {},
    isToken: true,
    summoningSickness: isCreature && !hasHaste,
    copiedFromPermanentId: String(sourcePermanent?.id || ''),
    ...(isCreature
      ? {
          basePower: typeof sourcePermanent?.basePower === 'number'
            ? sourcePermanent.basePower
            : parsePT(sourceCard?.power),
          baseToughness: typeof sourcePermanent?.baseToughness === 'number'
            ? sourcePermanent.baseToughness
            : parsePT(sourceCard?.toughness),
        }
      : null),
    card: {
      ...sourceCard,
      id: tokenId,
      zone: 'battlefield',
    },
  } as any;
}

function replaceCreatureSubtypes(typeLine: string, newSubtype: string): string {
  const trimmedTypeLine = String(typeLine || '').trim();
  if (!trimmedTypeLine) {
    return `Creature - ${newSubtype}`;
  }

  const dashMatch = trimmedTypeLine.match(/^(.+?)(?:\s+[\u2014-]\s+.+)?$/);
  const prefix = String(dashMatch?.[1] || trimmedTypeLine).trim();
  return `${prefix} - ${newSubtype}`;
}

export function applyInstantSorceryControlChangeAndMassZoneEffects(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    item: any;
    oracleText: string;
    oracleTextLower: string;
    targets: any[];
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleText = options.oracleText;
  const oracleTextLower = options.oracleTextLower;
  const targets = options.targets;

  const selectedModeDescriptions = Array.isArray((item as any)?.selectedModeDescriptions)
    ? ((item as any).selectedModeDescriptions as any[])
        .map((mode: any) => String(mode || '').toLowerCase().trim())
        .filter(Boolean)
    : [];
  const controlChangeResolutionTexts = selectedModeDescriptions.length > 0
    ? selectedModeDescriptions
    : [oracleTextLower];
  const applyControllerChange = (permanent: any, newController: string, options?: { temporary?: boolean }) => {
    const originalController = String(permanent?.controller || '').trim();
    if (!newController || !originalController || originalController === newController) {
      return false;
    }

    permanent.controller = newController;
    syncPreparedPermanentAfterControlChange(state, permanent, originalController);

    const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
    if (typeLine.includes('creature')) {
      (permanent as any).summoningSickness = true;
    }

    if (options?.temporary) {
      recordTemporaryControlChange(String(permanent.id || ''), originalController, newController);
    }

    return true;
  };
  const grantTemporaryHaste = (permanent: any) => {
    (permanent as any).grantedAbilities = Array.isArray((permanent as any).grantedAbilities)
      ? (permanent as any).grantedAbilities
      : [];
    if (!(permanent as any).grantedAbilities.some((ability: any) => String(ability || '').toLowerCase() === 'haste')) {
      (permanent as any).grantedAbilities.push('Haste');
    }

    if (!(permanent as any).untilEndOfTurn || typeof (permanent as any).untilEndOfTurn !== 'object') {
      (permanent as any).untilEndOfTurn = {};
    }
    (permanent as any).untilEndOfTurn.grantedAbilitiesToRemove = Array.isArray((permanent as any).untilEndOfTurn.grantedAbilitiesToRemove)
      ? (permanent as any).untilEndOfTurn.grantedAbilitiesToRemove
      : [];
    if (!(permanent as any).untilEndOfTurn.grantedAbilitiesToRemove.includes('Haste')) {
      (permanent as any).untilEndOfTurn.grantedAbilitiesToRemove.push('Haste');
    }
  };
  const recordTemporaryControlChange = (permanentId: string, originalController: string, newController: string) => {
    const stateAny = state as any;
    stateAny.controlChangeEffects = Array.isArray(stateAny.controlChangeEffects) ? stateAny.controlChangeEffects : [];
    stateAny.controlChangeEffects.push({
      permanentId,
      originalController,
      newController,
      duration: 'eot',
      appliedAt: Date.now(),
    });
  };
  const hasExchangeCreaturesEffect = controlChangeResolutionTexts.some((text: string) =>
    text.includes('exchange control of all creatures') ||
    text.includes('each gain control of all creatures the other controls until end of turn')
  );
  const hasDonateTargetPermanentEffect = controlChangeResolutionTexts.some((text: string) =>
    /target (?:opponent|player) gains control of target [^.]+/i.test(text)
  );
  const hasExchangeTargetPermanentsEffect = controlChangeResolutionTexts.some((text: string) =>
    /exchange control of two target permanents/i.test(text)
    || /exchange control of target [^.]+ and target [^.]+/i.test(text)
  );
  const exchangeTargetsMustShareCardType = hasExchangeTargetPermanentsEffect
    && controlChangeResolutionTexts.some((text: string) => selectionRequiresSharedCardType(text));
  const hasTemporaryGainControlEffect = controlChangeResolutionTexts.some((text: string) =>
    text.includes('gain control of target creature') && text.includes('until end of turn')
  );
  const hasPermanentGainControlEffect = !hasTemporaryGainControlEffect && controlChangeResolutionTexts.some((text: string) =>
    text.includes('gain control of target creature')
  );

  if (hasExchangeCreaturesEffect && targets.length > 0) {
    const targetOpponentId = String(typeof targets[0] === 'string' ? targets[0] : targets[0]?.id || '').trim();
    const players = Array.isArray((state as any).players) ? (state as any).players : [];
    const isTargetOpponent = players.some((player: any) => player && String(player.id || '') === targetOpponentId)
      && targetOpponentId !== String(controller || '');

    if (isTargetOpponent) {
      const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
      const controllerId = String(controller || '');
      const exchangeCandidates = battlefield.filter((permanent: any) => {
        if (!permanent) return false;
        const typeLine = String(permanent.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) return false;
        const currentController = String(permanent.controller || '').trim();
        return currentController === controllerId || currentController === targetOpponentId;
      });

      const controllerCreatures = exchangeCandidates.filter((permanent: any) => String(permanent.controller || '').trim() === controllerId);
      const opponentCreatures = exchangeCandidates.filter((permanent: any) => String(permanent.controller || '').trim() === targetOpponentId);

      for (const permanent of exchangeCandidates) {
        permanent.tapped = false;
      }

      for (const permanent of controllerCreatures) {
        const originalController = String(permanent.controller || '').trim();
        permanent.controller = targetOpponentId;
        syncPreparedPermanentAfterControlChange(state, permanent, originalController);
        (permanent as any).summoningSickness = true;
        recordTemporaryControlChange(String(permanent.id || ''), originalController, targetOpponentId);
        grantTemporaryHaste(permanent);
      }

      for (const permanent of opponentCreatures) {
        const originalController = String(permanent.controller || '').trim();
        permanent.controller = controllerId;
        syncPreparedPermanentAfterControlChange(state, permanent, originalController);
        (permanent as any).summoningSickness = true;
        recordTemporaryControlChange(String(permanent.id || ''), originalController, controllerId);
        grantTemporaryHaste(permanent);
      }

      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: exchanged control of ${exchangeCandidates.length} creature(s) between ${controllerId} and ${targetOpponentId}`);
    }
  }

  if (hasDonateTargetPermanentEffect && targets.length > 1) {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const players = Array.isArray((state as any).players) ? (state as any).players : [];
    const targetPlayerId = targets
      .map((target: any) => String(typeof target === 'string' ? target : target?.id || '').trim())
      .find((targetId: string) => players.some((player: any) => player && String(player.id || '') === targetId));
    const targetPermanentId = targets
      .map((target: any) => String(typeof target === 'string' ? target : target?.id || '').trim())
      .find((targetId: string) => battlefield.some((permanent: any) => permanent && String(permanent.id || '') === targetId));

    if (targetPlayerId && targetPermanentId) {
      const targetPermanent = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === targetPermanentId);
      if (targetPermanent && applyControllerChange(targetPermanent, targetPlayerId, { temporary: false })) {
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${targetPermanent.card?.name || targetPermanent.id} donated to ${targetPlayerId}`);
      }
    }
  }

  if (hasExchangeTargetPermanentsEffect && targets.length > 1) {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const targetPermanentIds = targets
      .map((target: any) => String(typeof target === 'string' ? target : target?.id || '').trim())
      .filter((targetId: string) => battlefield.some((permanent: any) => permanent && String(permanent.id || '') === targetId));

    if (targetPermanentIds.length >= 2) {
      const firstPermanent = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === targetPermanentIds[0]);
      const secondPermanent = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === targetPermanentIds[1]);

      if (firstPermanent && secondPermanent) {
        if (exchangeTargetsMustShareCardType && !permanentsShareCardType([firstPermanent, secondPermanent])) {
          debug(2, `[resolveTopOfStack] ${effectiveCard.name}: skipped exchange because the selected permanents do not share a card type`);
        } else {
          const firstController = String(firstPermanent.controller || '').trim();
          const secondController = String(secondPermanent.controller || '').trim();

          if (firstController && secondController && firstController !== secondController) {
            applyControllerChange(firstPermanent, secondController, { temporary: false });
            applyControllerChange(secondPermanent, firstController, { temporary: false });
            debug(2, `[resolveTopOfStack] ${effectiveCard.name}: exchanged control of ${firstPermanent.card?.name || firstPermanent.id} and ${secondPermanent.card?.name || secondPermanent.id}`);
          }
        }
      }

    }
  }

  const isTargetedCreatureCopyTokenSpell =
    /create\s+a\s+token\s+that['']s\s+a\s+copy\s+of\s+target\s+creature\s+you\s+control/i.test(oracleTextLower)
    && !/except\s+it\s+has/i.test(oracleTextLower)
    && !/tapped\s+and\s+attacking/i.test(oracleTextLower);
  const isTargetedCreatureCopyTokenSpellWithHasteSacrifice =
    /create\s+a\s+token\s+that['']s\s+a\s+copy\s+of\s+target\s+creature\s+you\s+control,\s+except\s+it\s+has\s+haste\s+and\s+"at\s+the\s+beginning\s+of\s+the\s+end\s+step,\s+sacrifice\s+this\s+token\."/i.test(oracleTextLower);

  const isTargetedCreatureCopyTokenSpellWithFrogCopyMod =
    /create\s+a\s+token\s+that['']s\s+a\s+copy\s+of\s+target\s+non-frog\s+creature,\s+except\s+it['']s\s+a\s+1\/1\s+green\s+frog/i.test(oracleTextLower);

  if ((isTargetedCreatureCopyTokenSpell || isTargetedCreatureCopyTokenSpellWithHasteSacrifice || isTargetedCreatureCopyTokenSpellWithFrogCopyMod) && targets.length > 0) {
    const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
    const targetPerm = state.battlefield?.find((p: any) => p && String(p.id || '') === String(targetId || ''));
    const targetTypeLine = String(targetPerm?.card?.type_line || '').toLowerCase();
    const requiresControlledTarget = !isTargetedCreatureCopyTokenSpellWithFrogCopyMod;

    if (targetPerm && (!requiresControlledTarget || String(targetPerm.controller || '') === String(controller)) && targetTypeLine.includes('creature')) {
      try {
        const tokenId = uid('copy_token');
        const tokenPerm = buildPermanentTokenCopy(targetPerm, tokenId, controller as PlayerID);

        if (isTargetedCreatureCopyTokenSpellWithFrogCopyMod) {
          const updatedTypeLine = replaceCreatureSubtypes(String(tokenPerm?.card?.type_line || targetPerm?.card?.type_line || ''), 'Frog');
          tokenPerm.basePower = 1;
          tokenPerm.baseToughness = 1;
          tokenPerm.card = {
            ...(tokenPerm.card || {}),
            type_line: updatedTypeLine,
            power: '1',
            toughness: '1',
            colors: ['G'],
            color_identity: ['G'],
          };
        }

        if (isTargetedCreatureCopyTokenSpellWithHasteSacrifice) {
          (tokenPerm as any).grantedAbilities = Array.isArray((tokenPerm as any).grantedAbilities)
            ? (tokenPerm as any).grantedAbilities
            : [];
          if (!(tokenPerm as any).grantedAbilities.includes('Haste')) {
            (tokenPerm as any).grantedAbilities.push('Haste');
          }
          if (!(tokenPerm as any).grantedAbilities.includes('At the beginning of the end step, sacrifice this token.')) {
            (tokenPerm as any).grantedAbilities.push('At the beginning of the end step, sacrifice this token.');
          }
          (tokenPerm as any).summoningSickness = false;
        }

        state.battlefield = state.battlefield || [];
        state.battlefield.push(tokenPerm as any);

        if (isTargetedCreatureCopyTokenSpellWithHasteSacrifice) {
          const stateAny = state as any;
          stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
            ? stateAny.pendingSacrificeAtNextEndStep
            : [];

          const currentTurn = Number(stateAny?.turnNumber ?? stateAny?.turn ?? 0) || 0;
          const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
          const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
          const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
          const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

          stateAny.pendingSacrificeAtNextEndStep.push({
            permanentId: String(tokenPerm.id || tokenId),
            fireAtTurnNumber,
            maxManaValue: 0,
            sourceName: effectiveCard.name || 'Spell',
            createdBy: String(controller),
          });
        }

        debug(2, `[resolveTopOfStack] ${effectiveCard.name || 'Spell'} created a token copy of ${String(targetPerm.card?.name || targetId)}`);

        queueSelfETBTriggersForPermanent(ctx, tokenPerm, controller as any);
        triggerETBEffectsForToken(ctx, tokenPerm, controller);
      } catch (err) {
        debugWarn(1, `[resolveTopOfStack] ${effectiveCard.name || 'Spell'} failed to create token copy:`, err);
      }
    }
  }

  if ((hasTemporaryGainControlEffect || hasPermanentGainControlEffect) && targets.length > 0) {
    const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
    const targetPermanent = (state.battlefield || []).find((perm: any) => perm && String(perm.id || '') === String(targetId || ''));

    if (targetPermanent) {
      const typeLine = String(targetPermanent.card?.type_line || '').toLowerCase();
      if (typeLine.includes('creature')) {
        const newController = String(controller || '');
        const shouldUntap = controlChangeResolutionTexts.some((text: string) => text.includes('untap'));
        const shouldGrantHaste = controlChangeResolutionTexts.some((text: string) => text.includes('gains haste') || text.includes('gain haste'));

        applyControllerChange(targetPermanent, newController, { temporary: hasTemporaryGainControlEffect });

        if (shouldUntap) {
          targetPermanent.tapped = false;
        }

        if (shouldGrantHaste) {
          grantTemporaryHaste(targetPermanent);
        }

        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: applied ${hasTemporaryGainControlEffect ? 'temporary' : 'permanent'} control change to ${targetPermanent.card?.name || targetPermanent.id}`);
      }
    }
  }
  
  // Handle mass bounce spells (Evacuation, Cyclonic Rift overloaded, Aetherize, etc.)
  // Multiple patterns to handle different mass bounce effects:
  // - "Return all creatures to their owners' hands" (Evacuation)
  // - "Return all attacking creatures to their owner's hand" (Aetherize)
  // - "Return all nonland permanents to their owners' hands" (Coastal Breach, Cyclonic Rift overloaded)
  // - "Return all noncreature, nonland permanents to their owners' hands" (Filter Out)
  // - "Return each nonland permanent you don't control to its owner's hand" (Cyclonic Rift overloaded)
  
  const massBouncePatterns = [
    { pattern: /return all creatures to their owners'? hands?/i, filter: 'creatures' },
    { pattern: /return all attacking creatures to their owners'? hands?/i, filter: 'attacking_creatures' },
    { pattern: /return all nonland permanents to their owners'? hands?/i, filter: 'nonland_permanents' },
    { pattern: /return all noncreature,?\s*nonland permanents to their owners'? hands?/i, filter: 'noncreature_nonland' },
    { pattern: /return each nonland permanent you don't control to its owner's hand/i, filter: 'nonland_opponent_control' },
  ];
  
  let massBounceFilter: string | null = null;
  for (const { pattern, filter } of massBouncePatterns) {
    if (pattern.test(oracleText)) {
      massBounceFilter = filter;
      break;
    }
  }
  
  if (massBounceFilter) {
    const battlefield = state.battlefield || [];
    const attackers = (state as any).attackers || [];
    const attackingCreatureIds = new Set(attackers.map((a: any) => a.creatureId || a.id));
    
    // Filter permanents based on the bounce type
    const permanentsToBounce = battlefield.filter((p: any) => {
      const typeLine = (p.card?.type_line || '').toLowerCase();
      const isCreature = typeLine.includes('creature');
      const isLand = typeLine.includes('land');
      const isAttacking = attackingCreatureIds.has(p.id);
      
      switch (massBounceFilter) {
        case 'creatures':
          return isCreature;
        case 'attacking_creatures':
          return isCreature && isAttacking;
        case 'nonland_permanents':
          return !isLand;
        case 'noncreature_nonland':
          return !isCreature && !isLand;
        case 'nonland_opponent_control':
          return !isLand && p.controller !== controller;
        default:
          return false;
      }
    });
    
    debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Returning ${permanentsToBounce.length} permanents to owners' hands (filter: ${massBounceFilter})`);
    
    const permanentsToBounceIdSet = new Set(permanentsToBounce.map((p: any) => String(p?.id || '')));

    // Helper function to bounce a single permanent
    const bouncePermanent = (perm: any) => {
      const ownerId = perm.owner || perm.controller;
      const zones = state.zones || {};
      
      // Handle attached permanents (auras, equipment) - they fall off
      // Auras that are not also being bounced go to graveyard; otherwise they will be bounced by the same effect.
      const attachedAuras = battlefield.filter((p: any) => 
        p.attachedTo === perm.id && (p.card?.type_line || '').toLowerCase().includes('aura')
      );
      for (const aura of attachedAuras) {
        if (permanentsToBounceIdSet.has(String(aura?.id || ''))) {
          continue;
        }
        if (movePermanentToGraveyard(ctx, aura.id)) {
          debug(2, `[resolveTopOfStack] ${aura.card?.name || 'Aura'} fell off and went to graveyard`);
        }
      }
      
      // Equipment that are not also being bounced detach and stay on battlefield.
      const attachedEquipment = battlefield.filter((p: any) => 
        p.attachedTo === perm.id && (p.card?.type_line || '').toLowerCase().includes('equipment')
      );
      for (const equipment of attachedEquipment) {
        if (permanentsToBounceIdSet.has(String(equipment?.id || ''))) {
          continue;
        }
        delete equipment.attachedTo;
        debug(2, `[resolveTopOfStack] ${equipment.card?.name || 'Equipment'} detached`);
      }

      if (movePermanentToHand(ctx, perm.id)) {
        debug(2, `[resolveTopOfStack] ${perm.card?.name || 'Permanent'} returned to ${ownerId}'s hand`);
      }
    };
    
    // Bounce all matching permanents
    // Make a copy of the array since we'll be modifying the battlefield
    const permanentsToBounceIds = permanentsToBounce.map((p: any) => p.id);
    for (const permId of permanentsToBounceIds) {
      const perm = battlefield.find((p: any) => p.id === permId);
      if (perm) {
        bouncePermanent(perm);
      }
    }
  }
  
  // Handle extra turn spells (Time Warp, Time Walk, Temporal Mastery, etc.)
  if (isExtraTurnSpell(effectiveCard.name, oracleTextLower)) {
    // Determine who gets the extra turn
    // Most extra turn spells give the caster an extra turn
    // "Target player takes an extra turn" would need target handling
    let extraTurnPlayer = controller;
    
    // Check for "target player takes an extra turn" pattern
    if (oracleTextLower.includes('target player') && oracleTextLower.includes('extra turn')) {
      // Use target if provided
      if (targets.length > 0 && targets[0]?.kind === 'player') {
        extraTurnPlayer = targets[0].id as PlayerID;
      }
    }
    
    addExtraTurn(ctx, extraTurnPlayer, effectiveCard.name || 'Extra turn spell');
    debug(2, `[resolveTopOfStack] Extra turn granted to ${extraTurnPlayer} by ${effectiveCard.name}`);
  }
}
