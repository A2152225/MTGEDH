/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand Force of Will pitch-cost prompt,
 * flash / timing grants, and Abundant Harvest land/nonland choice (CR 601.2a-b).
 *
 * Public entry symbols: tryPromptCastSpellForceFlashFromHand.
 */
import { opponentTurnCastProhibitionReason } from "../../state/modules/batch31CastLocks.js"; // B31
import type { Socket } from "socket.io";
import { isCastingLimitedToSorceryTiming } from "../../state/modules/opponentSorceryTimingLock.js"; // B30
import type { PaymentItem, PlayerID } from "../../../../shared/src/index.js";
import { cardIsBlueForPitchCost, getForceOfWillAlternateCost } from "../../state/modules/alternate-costs.js";
import { parseEvokeExileColor, cardMatchesEvokeExileColor, EVOKE_EXILE_ALTERNATE_COST_ID } from "../../state/modules/evokeKeyword.js";
import { spellHasChosenTypeFlashGrant } from "../../state/modules/casting-modifiers.js";
import { canCastFromTop } from "../../state/modules/game-state-effects";
import { canCastWithSneakAtCurrentTiming } from "../../state/modules/sneakCastUtils.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { persistQueuedSpellCastStepContinuation } from "./gameActionsSpellCopyHeroicTriggers.js";

export type CastSpellForceFlashFromHandArgs = {
  socket: Socket;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardInHand: any;
  oracleText: string;
  typeLine: string;
  targets: any;
  payment: PaymentItem[] | undefined;
  xValue: number | undefined;
  alternateCostId: string | undefined;
  convokeTappedCreatures: string[] | undefined;
  ignoreTimingRestrictions: boolean;
  castSourceZone: string;
  zones: any;
  phaseStr: string;
};

export type CastSpellForceFlashFromHandContinue = {
  kind: "continue";
  isForceAltCostRequested: boolean;
  isInstantOrSorcery: boolean;
};

export function tryPromptCastSpellForceFlashFromHand(
  args: CastSpellForceFlashFromHandArgs,
): CastSpellForceFlashFromHandContinue | void {
  const {
    socket,
    game,
    gameId,
    playerId,
    cardId,
    cardInHand,
    oracleText,
    typeLine,
    targets,
    payment,
    xValue,
    alternateCostId,
    convokeTappedCreatures,
    ignoreTimingRestrictions,
    castSourceZone,
    zones,
    phaseStr,
  } = args;

      // =====================================================================
      // FORCE OF WILL / FORCE OF NEGATION STYLE ALTERNATE COST
      // =====================================================================
      // This alternate cost is a special interaction (exile a blue card; sometimes pay 1 life)
      // and must be handled even when skipInteractivePrompts=true (completeCastSpell path).
      // We enqueue a Resolution Queue prompt and resume the cast once the cost is paid.
      const evokeExileColor = alternateCostId === EVOKE_EXILE_ALTERNATE_COST_ID ? parseEvokeExileColor(oracleText) : null;
      if (alternateCostId === EVOKE_EXILE_ALTERNATE_COST_ID && !evokeExileColor) {
        socket.emit('error', { code: 'NO_EVOKE', message: 'This card does not have an exile-a-card evoke cost.' });
        return;
      }
      const isForceAltCostRequested = alternateCostId === 'force_of_will' || !!evokeExileColor;
      const forceAltAlreadyPaid = (cardInHand as any).forceAltCostPaid === true;
      if (isForceAltCostRequested && !forceAltAlreadyPaid) {
        const forceInfo = evokeExileColor ? { available: true, requiresLifePayment: false } : getForceOfWillAlternateCost(
          { state: game.state, bumpSeq: () => {}, rng: Math.random } as any,
          playerId as any,
          cardInHand as any
        );

        if (!forceInfo?.available) {
          socket.emit('error', {
            code: 'CANNOT_PAY_COST',
            message: `Cannot cast ${cardInHand.name} for its alternate cost.`,
          });
          return;
        }

        const handCards = Array.isArray((zones as any).hand) ? ((zones as any).hand as any[]) : [];
        const blueCards = handCards
          .filter((c: any) => c && c.id !== cardId)
          .filter((c: any) => (evokeExileColor ? cardMatchesEvokeExileColor(c, evokeExileColor.symbol) : cardIsBlueForPitchCost(c)))
          .map((c: any) => ({
            id: String(c.id),
            label: `Exile ${c.name || 'Blue card'}`,
            imageUrl: c.image_uris?.small || c.image_uris?.normal,
          }));

        if (blueCards.length === 0) {
          socket.emit('error', {
            code: 'CANNOT_PAY_COST',
            message: `Cannot cast ${cardInHand.name}: no other ${evokeExileColor ? evokeExileColor.word : 'blue'} card in hand to exile.`,
          });
          return;
        }

        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.OPTION_CHOICE && (s as any)?.forceOfWillExileChoice === true && String(s.sourceId || '') === String(cardId));

        if (!existing) {
          const forceAltCostStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: evokeExileColor
              ? `To evoke ${cardInHand.name}, exile a ${evokeExileColor.word} card from your hand.`
              : forceInfo.requiresLifePayment
              ? `To cast ${cardInHand.name} for its alternate cost, exile a blue card from your hand and pay 1 life.`
              : `To cast ${cardInHand.name} for its alternate cost, exile a blue card from your hand.`,
            mandatory: true,
            options: [
              ...blueCards,
            ],
            minSelections: 1,
            maxSelections: 1,

            forceOfWillExileChoice: true,
            ...(evokeExileColor ? { forcePitchColor: evokeExileColor.symbol, forcePitchColorWord: evokeExileColor.word } : {}),
            forceSpellCardId: cardId,
            forceSpellName: cardInHand.name,
            forceRequiresLifePayment: forceInfo.requiresLifePayment === true,
            forceLifePaymentAmount: forceInfo.requiresLifePayment === true ? 1 : 0,
            forceAlternateCostId: alternateCostId,
            // Continuation args are server-only; the Resolution handler resumes the cast directly.
            forceCastArgs: {
              cardId,
              targets,
              payment,
              xValue,
              alternateCostId,
              convokeTappedCreatures,
              // Ensure we don't re-run prompts after paying the alternate cost.
              skipInteractivePrompts: true,
              skipPriorityCheck: true,
            },
          } as any);

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            queuedResolutionStep: {
              ...(forceAltCostStep as any),
            },
          });
        }

        debug(2, `[castSpellFromHand] Queued Force-of-Will alternate-cost prompt for ${cardInHand.name}`);
        return;
      }

      let hasFlash = /\bflash\b/i.test(oracleText);
      const isInstant = typeLine.includes("instant");
      const isInstantOrSorcery = isInstant || typeLine.includes("sorcery");

      if (!hasFlash && castSourceZone === 'library') {
        const topLibraryPermission = canCastFromTop({ state: game.state } as any, playerId, cardInHand);
        if (topLibraryPermission.grantsFlash) {
          hasFlash = true;
        }
      }

      // Check for "flash grant" effects from battlefield permanents
      // Yeva, Nature's Herald: "You may cast green creature cards as though they had flash."
      // Vedalken Orrery: "You may cast spells as though they had flash."
      // Leyline of Anticipation: "You may cast spells as though they had flash."
      // Vivien, Champion of the Wilds: "You may cast creature spells as though they had flash."
      // Emergence Zone: "You may cast spells this turn as though they had flash."
      if (!hasFlash && !isInstant) {
        const battlefield = game.state?.battlefield || [];
        const cardColors = (cardInHand.colors || cardInHand.color_identity || []).map((c: string) => c.toLowerCase());
        const isGreenCard = cardColors.includes('g') || cardColors.includes('green');
        const isCreature = typeLine.includes('creature');
        
        for (const perm of battlefield) {
          if ((perm as any).controller !== playerId) continue;
          
          const permName = ((perm as any).card?.name || '').toLowerCase();
          const permOracle = ((perm as any).card?.oracle_text || '').toLowerCase();
          
          // Yeva, Nature's Herald - green creature cards have flash
          // Use exact match to avoid false positives
          if ((permName === 'yeva, nature\'s herald' || permName.startsWith('yeva, nature')) && isGreenCard && isCreature) {
            hasFlash = true;
            debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via Yeva, Nature's Herald`);
            break;
          }
          
          // Vivien, Champion of the Wilds - creature spells have flash
          if ((permName === 'vivien, champion of the wilds' || permName.startsWith('vivien, champion')) && isCreature) {
            hasFlash = true;
            debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via Vivien, Champion of the Wilds`);
            break;
          }
          
          // Vedalken Orrery, Leyline of Anticipation - all spells have flash
          if (permName === 'vedalken orrery' || permName === 'leyline of anticipation') {
            hasFlash = true;
            debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
            break;
          }
          
          // Emergence Zone (activated ability, check if active this turn)
          if (permName.includes('emergence zone') && (perm as any).flashGrantedThisTurn) {
            hasFlash = true;
            debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via Emergence Zone`);
            break;
          }
          
          // Generic detection: "cast ... as though they had flash"
          if (permOracle.includes('as though') && permOracle.includes('had flash')) {
            // Check if it applies to this card type
            if (permOracle.includes('creature') && isCreature) {
              hasFlash = true;
              debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
              break;
            }
            if (permOracle.includes('green') && isGreenCard && isCreature) {
              hasFlash = true;
              debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
              break;
            }
            if (permOracle.includes('spells') && !permOracle.includes('creature')) {
              // "You may cast spells as though they had flash" - applies to all
              hasFlash = true;
              debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
              break;
            }
          }
        }
      }

      if (!hasFlash && spellHasChosenTypeFlashGrant(game.state, playerId as PlayerID, cardInHand)) {
        hasFlash = true;
        debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via chosen-type flash grant`);
      }
      
      const isSorcerySpeed = (!isInstant && !hasFlash) || isCastingLimitedToSorceryTiming(game.state, String(playerId)); // B30 Teferi
      const b31TurnLock = opponentTurnCastProhibitionReason(game.state, String(playerId));
      if (b31TurnLock) {
        socket.emit("error", { code: "CAST_PROHIBITED", message: b31TurnLock });
        return;
      }
      const allowsSneakTiming = canCastWithSneakAtCurrentTiming(game, playerId, cardInHand);
      
      if (isSorcerySpeed && !ignoreTimingRestrictions && !allowsSneakTiming) {
        // Sorcery-speed spells can only be cast during your main phase
        // when you have priority and the stack is empty
        const stepStr = String(game.state?.step || "").toUpperCase().trim();
        const isMainPhase = phaseStr.includes("MAIN") || stepStr.includes("MAIN");
        const isYourTurn = game.state.turnPlayer === playerId;
        const stackEmpty = !game.state.stack || game.state.stack.length === 0;
        
        if (!isMainPhase) {
          socket.emit("error", {
            code: "SORCERY_TIMING",
            message: "This spell can only be cast during a main phase (it doesn't have flash).",
          });
          return;
        }
        
        if (!isYourTurn) {
          socket.emit("error", {
            code: "SORCERY_TIMING",
            message: "This spell can only be cast during your turn (it doesn't have flash).",
          });
          return;
        }
        
        if (!stackEmpty) {
          socket.emit("error", {
            code: "SORCERY_TIMING",
            message: "This spell can only be cast when the stack is empty (it doesn't have flash).",
          });
          return;
        }
      }
      
      // Check for Abundant Harvest type spells (Choose land or nonland, then reveal until finding one)
      // Pattern: "Choose land or nonland. Reveal cards from the top of your library until you reveal a card of the chosen kind."
      const abundantHarvestMatch = oracleText.match(/choose\s+land\s+or\s+nonland/i);
      const abundantChoiceSelected = (cardInHand as any).abundantChoice || (targets as any)?.abundantChoice;
      
      if (abundantHarvestMatch && !abundantChoiceSelected) {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.MODE_SELECTION && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.modeSelectionPurpose || '') === 'abundantChoice');

        if (!existing) {
          const abundantChoiceStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MODE_SELECTION,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            // Keep this short; detailed oracle text is still available via oracleContext.
            description: `Choose type for ${cardInHand.name}`,
            mandatory: true,
            modes: [
              {
                id: 'land',
                label: 'Land',
                description: 'Reveal cards until you reveal a land card, then put that card into your hand and the rest on the bottom of your library.',
              },
              {
                id: 'nonland',
                label: 'Nonland',
                description: 'Reveal cards until you reveal a nonland card, then put that card into your hand and the rest on the bottom of your library.',
              },
            ],
            minModes: 1,
            maxModes: 1,
            allowDuplicates: false,
            modeSelectionPurpose: 'abundantChoice',
            castSpellFromHandArgs: {
              cardId,
              payment,
              targets,
              xValue,
              alternateCostId,
              skipPriorityCheck: true,
              convokeTappedCreatures,
            },
          } as any);

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            queuedResolutionStep: {
              ...(abundantChoiceStep as any),
            },
          });
        }

        debug(2, `[castSpellFromHand] Queued land/nonland choice for ${cardInHand.name} (Abundant Harvest style)`);
        return; // Wait for choice selection via Resolution Queue
      }

  return {
    kind: "continue",
    isForceAltCostRequested,
    isInstantOrSorcery,
  };
}
