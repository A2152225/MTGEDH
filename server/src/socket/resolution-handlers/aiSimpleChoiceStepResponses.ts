/**
 * socket/resolution-handlers/aiSimpleChoiceStepResponses.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleAIResolutionStep).
 * Cluster moved: the contiguous run of AI auto-answers for one-shot choice prompts that need at most
 * the game state and a chooseAI* helper - COLOR_CHOICE, CREATURE_TYPE_CHOICE, CARD_NAME_CHOICE,
 * OPTION_CHOICE/MODAL_CHOICE, PLAYER_CHOICE, CASCADE, PONDER_EFFECT, TWO_PILE_SPLIT,
 * DEVOUR_SELECTION, PROLIFERATE, LIFE_REDISTRIBUTION, FATESEAL, CLASH, VOTE, KYNAIOS_CHOICE,
 * UPKEEP_SACRIFICE, RIOT_CHOICE and UNLEASH_CHOICE.
 * Public entry symbol: buildAiSimpleChoiceStepResponse.
 *
 * The eighteen `case` bodies became one dispatcher because they were contiguous in the parent switch
 * and each ended in a plain `break`, so the call site is a single fallthrough group of `case` labels
 * assigning `response = buildAiSimpleChoiceStepResponse(game, step);`. Heuristics and debug strings
 * are unchanged. Returns null only for a step type outside this group.
 *
 * Reads `game` but never `io` or the queue, so resolution.ts imports it directly. Must not import
 * resolution.ts.
 */

import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import {
  chooseAICardNameSelection,
  chooseAIKynaiosChoiceSelection,
  chooseAIManaColorForActivation,
  chooseAIOptionSelectionsForStep,
  chooseAIPlayerChoiceId,
  chooseAIUpkeepSacrificeSelection,
} from "../ai.js";
import { getDominantCreatureType } from "../creature-type.js";

/** AI answer for the one-shot choice prompts listed in the module header. */
export function buildAiSimpleChoiceStepResponse(
  game: any,
  step: ResolutionStep,
): ResolutionStepResponse | null {
  switch (step.type) {
    case ResolutionStepType.COLOR_CHOICE: {
      const stepData = step as any;
      const rawColors = Array.isArray(stepData.colors) ? stepData.colors : [];
      const colorCodes = rawColors
        .map((color: any) => String(color || '').trim().toUpperCase())
        .map((color: string) => {
          if (['W', 'U', 'B', 'R', 'G', 'C'].includes(color)) return color;
          const byName: Record<string, string> = {
            WHITE: 'W',
            BLUE: 'U',
            BLACK: 'B',
            RED: 'R',
            GREEN: 'G',
            COLORLESS: 'C',
          };
          return byName[color] || '';
        })
        .filter(Boolean);
      const chosenCode = chooseAIManaColorForActivation(
        game,
        step.playerId as any,
        colorCodes.length > 0 ? colorCodes : ['W', 'U', 'B', 'R', 'G'],
      );
      const codeToColorName: Record<string, string> = {
        W: 'white',
        U: 'blue',
        B: 'black',
        R: 'red',
        G: 'green',
        C: 'colorless',
      };
      const chosenColor = codeToColorName[chosenCode] || 'colorless';

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [chosenColor], // Wrap in array for type compatibility
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI color choice: chose ${chosenColor}`);
      return response;
    }

    case ResolutionStepType.CREATURE_TYPE_CHOICE: {
      const chosenType = String(getDominantCreatureType(game, String(step.playerId)) || 'Shapeshifter').trim() || 'Shapeshifter';

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [chosenType], // Wrap in array for type compatibility
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI creature type choice: chose ${chosenType}`);
      return response;
    }

    case ResolutionStepType.CARD_NAME_CHOICE: {
      const chosenName = chooseAICardNameSelection(game, step.playerId as any, step as any);

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [chosenName],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI card name choice: chose ${chosenName}`);
      return response;
    }

    case ResolutionStepType.OPTION_CHOICE:
    case ResolutionStepType.MODAL_CHOICE: {
      const optionDecision = chooseAIOptionSelectionsForStep(game, step.playerId as any, step as any);
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: optionDecision.selections,
        cancelled: optionDecision.cancelled,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI option/modal choice: selected ${JSON.stringify(optionDecision.selections)}`);
      return response;
    }

    case ResolutionStepType.PLAYER_CHOICE: {
      const selectedPlayerId = chooseAIPlayerChoiceId(game, step.playerId as any, step as any);
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: selectedPlayerId ? [selectedPlayerId] : [],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI player choice: chose ${selectedPlayerId || 'none'}`);
      return response;
    }

    case ResolutionStepType.CASCADE: {
      // AI always casts the cascade hit card if possible
      const cascadeStep = step as any;
      const hitCard = cascadeStep.hitCard;

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: !!hitCard, // Cast to boolean
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI cascade: ${hitCard ? 'casting' : 'declining'} hit card`);
      return response;
    }

    case ResolutionStepType.PONDER_EFFECT: {
      // AI keeps cards in original order (simple strategy)
      const ponderStep = step as any;
      const cards = ponderStep.cards || [];

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          newOrder: cards.map((c: any) => c.id),
          shouldShuffle: false,
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI ponder: keeping ${cards.length} cards in original order`);
      return response;
    }

    case ResolutionStepType.TWO_PILE_SPLIT: {
      const splitStep = step as any;
      const items: any[] = Array.isArray(splitStep.items) ? splitStep.items : [];
      const pileCount = Math.max(2, Math.floor(Number(splitStep.pileCount ?? 2)));

      // Simple AI: distribute items evenly among all requested piles.
      const piles = Array.from({ length: pileCount }, () => [] as string[]);
      items.forEach((it: any, idx: number) => {
        const id = String(it?.id || '');
        if (!id) return;
        piles[idx % pileCount].push(id);
      });

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          pileA: piles[0] || [],
          pileB: piles[1] || [],
          ...(pileCount > 2 ? { pileC: piles[2] || [] } : {}),
          ...(pileCount > 2 ? { piles } : {}),
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI ${pileCount}-pile split: ${piles.map((pile) => pile.length).join('/')}`);
      return response;
    }

    case ResolutionStepType.DEVOUR_SELECTION: {
      // AI doesn't sacrifice creatures for devour (conservative strategy)
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [], // Don't sacrifice anything
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI devour: not sacrificing any creatures`);
      return response;
    }

    case ResolutionStepType.PROLIFERATE: {
      // AI proliferates all beneficial targets (own creatures with +1/+1, opponents with -1/-1 or poison)
      const proliferateStep = step as any;
      const availableTargets = proliferateStep.availableTargets || [];
      const playerId = step.playerId;

      const selectedTargetIds: string[] = [];
      for (const target of availableTargets) {
        const counters = target.counters || {};
        const isOwnPermanent = !target.isPlayer && target.controller === playerId;
        const isOpponentPlayer = target.isPlayer && target.id !== playerId;

        // Proliferate own permanents with +1/+1 counters
        if (isOwnPermanent && counters['+1/+1'] > 0) {
          selectedTargetIds.push(target.id);
          continue;
        }

        // Proliferate opponent players with poison counters
        if (isOpponentPlayer && counters.poison > 0) {
          selectedTargetIds.push(target.id);
          continue;
        }

        // Proliferate opponent permanents with -1/-1 counters
        if (!target.isPlayer && target.controller !== playerId && counters['-1/-1'] > 0) {
          selectedTargetIds.push(target.id);
          continue;
        }
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: selectedTargetIds,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI proliferate: selected ${selectedTargetIds.length} targets`);
      return response;
    }

    case ResolutionStepType.LIFE_REDISTRIBUTION: {
      const redistributionStep = step as any;
      const players: any[] = Array.isArray(redistributionStep.players) ? redistributionStep.players : [];
      const lifeByPlayerId: Record<string, number> = {};
      for (const player of players) {
        const id = String(player?.id || '').trim();
        if (!id) continue;
        lifeByPlayerId[id] = Math.max(0, Math.floor(Number(player?.life ?? 0)));
      }
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: { lifeByPlayerId },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI life redistribution: keeping life totals unchanged for ${Object.keys(lifeByPlayerId).length} player(s)`);
      return response;
    }

    case ResolutionStepType.FATESEAL: {
      const fatesealStep = step as any;
      const cards = Array.isArray(fatesealStep.cards) ? fatesealStep.cards : [];

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          keepTopOrder: cards,
          bottomOrder: [],
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI fateseal: keeping ${cards.length} card(s) on top`);
      return response;
    }

    case ResolutionStepType.CLASH: {
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          putOnBottom: false,
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI clash: keeping revealed card on top`);
      return response;
    }

    case ResolutionStepType.VOTE: {
      const voteStep = step as any;
      const choices = Array.isArray(voteStep.choices) ? voteStep.choices : [];
      const choice = typeof choices[0] === 'string' ? choices[0] : 'decline';

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          choice,
          voteCount: 1,
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI vote: selected ${choice}`);
      return response;
    }

    case ResolutionStepType.KYNAIOS_CHOICE: {
      const selection = chooseAIKynaiosChoiceSelection(step as any);

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: selection,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Kynaios choice: ${selection.choice}${selection.landCardId ? `:${selection.landCardId}` : ''}`);
      return response;
    }

    case ResolutionStepType.UPKEEP_SACRIFICE: {
      const selection = chooseAIUpkeepSacrificeSelection(game, step.playerId as any, step as any);
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: selection,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI upkeep sacrifice: selected ${typeof selection === 'object' && !Array.isArray(selection) ? `${selection.type}${selection.creatureId ? `:${selection.creatureId}` : ''}` : 'none'}`);
      return response;
    }

    // =========================================================================
    // KEYWORD ABILITY CHOICE HANDLERS
    // =========================================================================

    case ResolutionStepType.RIOT_CHOICE: {
      // AI prefers haste for aggressive decks, counters for long games
      // Simple strategy: prefer counters for permanence
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: ['counter'], // Permanent +1/+1 counter
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Riot: chose +1/+1 counter`);
      return response;
    }

    case ResolutionStepType.UNLEASH_CHOICE: {
      // AI prefers the counter (bigger creature, even if can't block)
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: ['counter'], // +1/+1 counter (can't block)
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Unleash: chose +1/+1 counter`);
      return response;
    }

    default:
      return null;
  }
}
