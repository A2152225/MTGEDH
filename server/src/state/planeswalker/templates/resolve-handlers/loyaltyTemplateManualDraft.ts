// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateManualDraft.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   FALLBACK_MANUAL_RESOLUTION .. OPEN_SEALED_KAMIGAWA_BOOSTER_PACK_AND_DRAFT_TWO
// Public entry symbols: tryLoyaltyTemplateManualDraft
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { getGameId } from "../utils.js";

export function tryLoyaltyTemplateManualDraft(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "FALLBACK_MANUAL_RESOLUTION": {
      // P4a: Under ORACLE_IR_TRIGGER_PRIMARY, orchestrators skip templates when IR owns
      // the loyalty text (tryResolveTriggerViaOracleIR / activated IR+EP). This case remains
      // only for true unknowns / joke / external-website loyalty effects.
      const gameId = getGameId(ctx);
      const sourceId = String((triggerItem as any)?.source || "");
      const description = `[Manual planeswalker resolution] ${sourceName}: ${text}`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown') {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceId,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        });
      }

      return true;
    }

    case "HEAD_TO_ASKURZA_COM_AND_CLICK_N": {
      const m = text.match(/^head to askurza\.com and click ([+-]\d+)\.?$/i);
      if (!m) return false;

      const click = String(m[1] || '').trim();
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Head to AskUrza.com and click ${click}.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "ACCEPT_ONE_OF_DAVRIELS_OFFERS_THEN_ACCEPT_ONE_OF_DAVRIELS_CONDITIONS": {
      const m = text.match(/^accept one of davriel's offers, then accept one of davriel's conditions\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Accept one of Davriel's offers, then accept one of Davriel's conditions.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "CHOOSE_LEFT_OR_RIGHT_UNTIL_YOUR_NEXT_TURN_ATTACK_NEAREST_OPPONENT": {
      const m = text.match(
        /^choose left or right\. until your next turn, each player may attack only the nearest opponent in the last chosen direction and planeswalkers controlled by that opponent\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Choose left or right, then apply the attack restriction until your next turn.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MODAL_CHOICE,
          playerId: controller,
          description,
          mandatory: true,
          sourceName,
          promptTitle: 'Choose Direction',
          promptDescription: 'Choose left or right (manual rules enforcement).',
          options: [
            { id: 'left', label: 'Left' },
            { id: 'right', label: 'Right' },
          ],
          minSelections: 1,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "CHOOSE_LEFT_OR_RIGHT_EACH_PLAYER_GAINS_CONTROL_NONLAND_PERMANENTS": {
      const m = text.match(
        /^choose left or right\. each player gains control of all nonland permanents other than [a-z0-9 ,'-]+ controlled by the next player in the chosen direction\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Choose left or right, then each player gains control of all nonland permanents (except ${sourceName}) as described.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MODAL_CHOICE,
          playerId: controller,
          description,
          mandatory: true,
          sourceName,
          promptTitle: 'Choose Direction',
          promptDescription: 'Choose left or right (manual rules enforcement).',
          options: [
            { id: 'left', label: 'Left' },
            { id: 'right', label: 'Right' },
          ],
          minSelections: 1,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "TARGET_CREATURE_AN_OPPONENT_CONTROLS_PERPETUALLY_GETS_MINUS3_MINUS3": {
      const m = text.match(/^target creature an opponent controls perpetually gets -3\/-3\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Target creature an opponent controls perpetually gets -3/-3.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "UNTAP_UP_TO_ONE_TARGET_ELF_THAT_ELF_AND_RANDOM_ELF_IN_HAND_PERPETUALLY_GET_P1P1": {
      const m = text.match(
        /^untap up to one target elf\. that elf and a random elf creature card in your hand perpetually get \+1\/\+1\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Untap up to one target Elf. That Elf and a random Elf creature card in your hand perpetually get +1/+1.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "SEEK_AN_ELF_CARD": {
      const m = text.match(/^seek an elf card\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Seek an Elf card.`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "CONJURE_A_CARD_NAMED_ONTO_THE_BATTLEFIELD": {
      const m = text.match(/^conjure a card named ([^\.]+?) onto the battlefield\.?$/i);
      if (!m) return false;

      const cardName = String(m[1] || '').trim();
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Conjure a card named ${cardName} onto the battlefield.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "CONJURE_A_CARD_NAMED_INTO_YOUR_HAND": {
      const m = text.match(/^conjure a card named ([^\.]+?) into your hand\.?$/i);
      if (!m) return false;

      const cardName = String(m[1] || '').trim();
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Conjure a card named ${cardName} into your hand.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "DRAFT_A_CARD_FROM_SPELLBOOK_AND_PUT_IT_ONTO_THE_BATTLEFIELD": {
      const m = text.match(/^draft a card from [a-z0-9 ,'-]+(?:'|’)s spellbook and put it onto the battlefield\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Draft a card from a spellbook and put it onto the battlefield.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "ADD_RR_DRAFT_A_CARD_FROM_SPELLBOOK_THEN_EXILE_YOU_MAY_CAST_IT_THIS_TURN": {
      const m = text.match(
        /^add \{r\}\{r\}\. draft a card from [a-z0-9 ,'-]+(?:'|’)s spellbook, then exile it\. until end of turn, you may cast that card\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;

      const description = `[Manual resolution] ${sourceName}: Add {R}{R}. Draft a card from a spellbook, exile it, then you may cast it this turn.`;
      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "ROLL_A_D20_SKIP_NEXT_TURN_OR_DRAW_A_CARD": {
      const m = text.match(/^roll a d20\. if you roll a 1, skip your next turn\. if you roll a 12 or higher, draw a card\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Roll a d20 (manual). On 1: skip your next turn. On 12+: draw a card.`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "OPEN_SEALED_KAMIGAWA_BOOSTER_PACK_AND_DRAFT_TWO": {
      const m = text.match(
        /^open up to one sealed kamigawa booster pack and shuffle those cards into your booster pile\. look at the top four cards of your booster pile\. put two of those cards into your hand and the rest into your graveyard\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Open a sealed Kamigawa booster pack (manual booster pile), then put two of the top four into hand and the rest into graveyard.`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }
    default:
      return undefined;
  }
}
