/**
 * socket/resolutionHandlerDeps.ts
 *
 * Injected helpers for the four tangled resolution cores:
 *   - registerResolutionHandlers
 *   - handleStepResponse
 *   - handleTargetSelectionResponse
 *   - handleOptionChoiceResponse
 *
 * SEAM STATUS (2026-08-23):
 * - Response clusters behind this seam: library-look / modal / commander-zone /
 *   vote / proliferate / lim-dul / color-type-name choices / option-choice early
 *   specials PREFIX + ConfirmCastPayment / join-forces+tempting / hideaway+zone-draft+return-permanent (split) /
 *   cascade+dance+devour+suspend+morph (+ life redistrib / prisoners dilemma).
 * - Injectable cast helpers (appendCastSpellContinuationEvent,
 *   createForwardingGameActionSocket, restartPlayerCastRequest) unlock PREFIX
 *   extraction without blunt-cutting the four cores.
 * - Remaining: large switch/validation bodies still in the four cores; more
 *   option-choice specials after ConfirmCastPayment; target-selection specialized branches;
 *   discard-trigger + activated-targeting utils extracted; discard response extracted (core + activation-resume); graveyard selection extracted (apply + post/resume); activated-ability extracted; commander-cast copies /
 *   Hatut / Storm intentionally out of scope; triggered-abilities.ts skipped.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../state/resolution/index.js";
import { handleCommanderZoneResponse } from "./resolutionCommanderZoneResponseHandlers.js";
import {
  handleBasicLandTypeChoiceResponse,
  handleCardNameChoiceResponse,
  handleColorChoiceResponse,
  handleCreatureTypeChoiceResponse,
} from "./resolutionColorTypeNameChoiceResponseHandlers.js";
import {
  handleBottomOrderResponse,
  handleClashResponse,
  handleFatesealResponse,
  handlePonderEffectResponse,
  handleTwoPileSplitResponse,
} from "./resolutionLibraryLookResponseHandlers.js";
import { handleModalChoiceResponse } from "./resolutionModalChoiceResponseHandlers.js";
import { handleScryResponse, handleSurveilResponse } from "./resolutionScrySurveilResponseHandlers.js";
import { tryHandleOptionChoiceEarlySpecialsPrefix } from "./resolutionOptionChoiceEarlySpecialsPrefixHandlers.js";
import { tryHandleOptionChoiceEarlySpecialsConfirmCastPayment } from "./resolutionOptionChoiceEarlySpecialsConfirmCastPaymentHandlers.js";
import {
  appendCastSpellContinuationEvent,
  createForwardingGameActionSocket,
  restartPlayerCastRequest,
} from "./resolutionSyntheticCastSocketUtils.js";
import {
  handleJoinForcesResponse,
  handleTemptingOfferResponse,
} from "./resolutionJoinForcesTemptingOfferResponseHandlers.js";
import {
  handleHideawayChoiceResponse,
  handleRepeatedZoneDraftResponse,
  handleReturnControlledPermanentChoiceResponse,
} from "./resolutionHideawayZoneDraftPermanentChoiceResponseHandlers.js";
import {
  handleCascadeResponse,
  handleDanceWithCalamityCastSelectionResponse,
  handleDanceWithCalamityResponse,
  handleDevourSelectionResponse,
  handleLifeRedistributionResponse,
  handleMorphTurnFaceUpResponse,
  handlePrisonersDilemmaChoiceResponse,
  handleSuspendCastResponse,
} from "./resolutionCascadeDanceDevourSuspendMorphResponseHandlers.js";
import { handleActivatedAbilityResponse } from "./resolutionActivatedAbilityResponseHandlers.js";
import { handleDiscardResponse } from "./resolutionDiscardResponseCoreHandlers.js";
import { handleGraveyardSelectionResponse } from "./resolutionGraveyardSelectionApplyHandlers.js";
import {
  handleLimDulsVaultResponse,
  handleProliferateResponse,
  handleVoteResponse,
} from "./resolutionVoteProliferateLimDulResponseHandlers.js";

export type ResolutionStepHandler = (
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
) => void | Promise<void>;

export type ResolutionHandlerDeps = {
  handleFatesealResponse: ResolutionStepHandler;
  handleClashResponse: ResolutionStepHandler;
  handleBottomOrderResponse: ResolutionStepHandler;
  handlePonderEffectResponse: ResolutionStepHandler;
  handleTwoPileSplitResponse: ResolutionStepHandler;
  handleModalChoiceResponse: ResolutionStepHandler;
  handleScryResponse: ResolutionStepHandler;
  handleSurveilResponse: ResolutionStepHandler;
  handleCommanderZoneResponse: ResolutionStepHandler;
  handleProliferateResponse: ResolutionStepHandler;
  handleVoteResponse: ResolutionStepHandler;
  handleLimDulsVaultResponse: ResolutionStepHandler;
  handleColorChoiceResponse: ResolutionStepHandler;
  handleBasicLandTypeChoiceResponse: ResolutionStepHandler;
  handleCreatureTypeChoiceResponse: ResolutionStepHandler;
  handleCardNameChoiceResponse: ResolutionStepHandler;
  handleJoinForcesResponse: ResolutionStepHandler;
  handleTemptingOfferResponse: ResolutionStepHandler;
  handleReturnControlledPermanentChoiceResponse: ResolutionStepHandler;
  handleHideawayChoiceResponse: ResolutionStepHandler;
  handleRepeatedZoneDraftResponse: ResolutionStepHandler;
  handleCascadeResponse: ResolutionStepHandler;
  handleLifeRedistributionResponse: ResolutionStepHandler;
  handlePrisonersDilemmaChoiceResponse: ResolutionStepHandler;
  handleDanceWithCalamityResponse: ResolutionStepHandler;
  handleDanceWithCalamityCastSelectionResponse: ResolutionStepHandler;
  handleDevourSelectionResponse: ResolutionStepHandler;
  handleSuspendCastResponse: ResolutionStepHandler;
  handleMorphTurnFaceUpResponse: ResolutionStepHandler;
  handleActivatedAbilityResponse: ResolutionStepHandler;
  handleDiscardResponse: ResolutionStepHandler;
  handleGraveyardSelectionResponse: ResolutionStepHandler;
  tryHandleOptionChoiceEarlySpecialsPrefix: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => Promise<boolean>;
  tryHandleOptionChoiceEarlySpecialsConfirmCastPayment: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => Promise<boolean>;
  appendCastSpellContinuationEvent: (
    gameId: string,
    game: any,
    payload: Record<string, unknown>,
  ) => void;
  createForwardingGameActionSocket: (
    io: Server,
    gameId: string,
    playerId: string,
  ) => { socket: any; handlers: Map<string, (...args: any[]) => any> };
  restartPlayerCastRequest: (
    io: Server,
    gameId: string,
    playerId: string,
    payload: {
      cardId: string;
      faceIndex?: number;
      fromZone?: 'hand' | 'exile' | 'graveyard' | 'library' | 'command';
    },
  ) => Promise<void>;
};

let activeDeps: ResolutionHandlerDeps | null = null;

export function createResolutionHandlerDeps(
  overrides: Partial<ResolutionHandlerDeps> = {},
): ResolutionHandlerDeps {
  return {
    handleFatesealResponse,
    handleClashResponse,
    handleBottomOrderResponse,
    handlePonderEffectResponse,
    handleTwoPileSplitResponse,
    handleModalChoiceResponse,
    handleScryResponse,
    handleSurveilResponse,
    handleCommanderZoneResponse,
    handleProliferateResponse,
    handleVoteResponse,
    handleLimDulsVaultResponse,
    handleColorChoiceResponse,
    handleBasicLandTypeChoiceResponse,
    handleCreatureTypeChoiceResponse,
    handleCardNameChoiceResponse,
    handleJoinForcesResponse,
    handleTemptingOfferResponse,
    handleReturnControlledPermanentChoiceResponse,
    handleHideawayChoiceResponse,
    handleRepeatedZoneDraftResponse,
    handleCascadeResponse,
    handleLifeRedistributionResponse,
    handlePrisonersDilemmaChoiceResponse,
    handleDanceWithCalamityResponse,
    handleDanceWithCalamityCastSelectionResponse,
    handleDevourSelectionResponse,
    handleSuspendCastResponse,
    handleMorphTurnFaceUpResponse,
    handleActivatedAbilityResponse,
    handleDiscardResponse,
    handleGraveyardSelectionResponse,
    tryHandleOptionChoiceEarlySpecialsPrefix,
    tryHandleOptionChoiceEarlySpecialsConfirmCastPayment,
    appendCastSpellContinuationEvent,
    createForwardingGameActionSocket,
    restartPlayerCastRequest,
    ...overrides,
  };
}

/** Active deps for the four cores; lazily creates defaults. */
export function getResolutionHandlerDeps(): ResolutionHandlerDeps {
  if (!activeDeps) activeDeps = createResolutionHandlerDeps();
  return activeDeps;
}

/** Test/override hook. Pass null to reset to lazy defaults. */
export function setResolutionHandlerDeps(deps: ResolutionHandlerDeps | null): void {
  activeDeps = deps;
}
