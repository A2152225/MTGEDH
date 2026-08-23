/**
 * Wire imports, deps dispatch, PREFIX extraction, and pre-complete validation into resolution.ts
 */
import fs from 'node:fs';

const PATH = 'D:/Git/MTGEDH/server/src/socket/resolution.ts';
let src = fs.readFileSync(PATH, 'utf8').replace(/\r\n/g, '\n');

const IMPORT_BLOCK = `
import {
  buildTriggeredAbilitySourceContext,
  pushExertTriggeredAbilityOntoStack,
  matchesRequiredTypeWords,
  buildExertTriggeredGraveyardSelectionData,
  handleRiotChoiceResponse,
  handleUnleashChoiceResponse,
  handleFabricateChoiceResponse,
  handleTributeChoiceResponse,
  handleMentorTargetResponse,
  handleExploitChoiceResponse,
  handleModularChoiceResponse,
  handleSoulshiftTargetResponse,
  handleHauntTargetResponse,
} from "./resolutionKeywordChoiceHandlers.js";
import {
  type ResolutionPaymentItem as ExtractedResolutionPaymentItem,
  type ResolutionManaPaymentPersistOptions,
  persistResolutionPaymentManaMutations,
  resolutionManaSourceSelfSacrifices,
  resolutionPaymentActivationCostHasUnsupportedAdditionalCosts,
  getSupportedResolutionActivationManaCost,
  cloneGameForResolutionPaymentValidation,
  snapshotResolutionManaPool,
  createEmptyResolutionManaTotals,
  getResolutionPaymentProducedManaTotals,
  addResolutionManaTotals,
  consumeExplicitSelectedResolutionMana,
  calculateResolutionManaPoolDelta,
  MANA_POOL_KEY_BY_SYMBOL as EXTRACTED_MANA_POOL_KEY_BY_SYMBOL,
} from "./resolutionPaymentManaUtils.js";
import {
  cloneCascadeZoneCard,
  cloneCascadeLibrary,
  cloneLibraryStateForEvent,
  cloneZoneCardsForEvent,
  cloneExileStateForEvent,
  appendQueuedResolutionPromptEvent,
} from "./resolutionCloneQueuedPromptUtils.js";
import {
  processPendingCascades,
  processPendingScry,
  processPendingSurveil,
  processPendingOracleIrCompoundResume,
  processPendingProliferate,
  processPendingPonder,
  processPendingBottomOrder,
  processPendingLimDulsVault,
  processPendingDanceWithCalamity,
  completeDanceWithCalamityDeferredAdvance,
  advanceDanceWithCalamityCastSequence,
  upsertOneShotCastFromExilePromptPermission,
} from "./resolutionProcessPendingHandlers.js";
export {
  processPendingCascades,
  processPendingScry,
  processPendingSurveil,
  processPendingOracleIrCompoundResume,
  processPendingProliferate,
  processPendingPonder,
  processPendingBottomOrder,
  processPendingLimDulsVault,
  processPendingDanceWithCalamity,
  completeDanceWithCalamityDeferredAdvance,
} from "./resolutionProcessPendingHandlers.js";
import {
  handleLibrarySearchResponse,
  isTrueLibrarySearchStep,
} from "./resolutionLibrarySearchHandlers.js";
import {
  oracleIrTopLibraryChoiceResumeApplied,
} from "./resolutionLibrarySearchOracleIrResumeUtils.js";
import { putCardOntoBattlefield } from "./resolutionPutCardOntoBattlefieldUtils.js";
import { createLibrarySearchStep } from "./resolutionLibrarySearchStepUtils.js";
import { handleScryResponse, handleSurveilResponse } from "./resolutionScrySurveilResponseHandlers.js";
import { getResolutionHandlerDeps } from "./resolutionHandlerDeps.js";
import {
  handleBottomOrderResponse,
  handleClashResponse,
  handleFatesealResponse,
  handlePonderEffectResponse,
  handleSequentialOracleIrPileSplitResponse,
  handleTwoPileSplitResponse,
} from "./resolutionLibraryLookResponseHandlers.js";
import { handleModalChoiceResponse, handleSoldierProgramChoice } from "./resolutionModalChoiceResponseHandlers.js";
import { handleCommanderZoneResponse } from "./resolutionCommanderZoneResponseHandlers.js";
export {
  handleBottomOrderResponse,
  handleClashResponse,
  handleFatesealResponse,
  handlePonderEffectResponse,
  handleSequentialOracleIrPileSplitResponse,
  handleTwoPileSplitResponse,
} from "./resolutionLibraryLookResponseHandlers.js";
import { getTypeSpecificFields } from "./resolutionStepTypeSpecificFieldsUtils.js";
import {
  appendCastSpellContinuationEvent,
  createForwardingGameActionSocket,
  restartPlayerCastRequest,
} from "./resolutionSyntheticCastSocketUtils.js";
import { validateExtractedStepTypesBeforeComplete } from "./resolutionRegisterPreCompleteValidationForExtractedSteps.js";
`;

// Insert after pushWheneverYouExertTriggersOntoStack import
const anchor = 'import { pushWheneverYouExertTriggersOntoStack } from "./exert-triggers.js";\n';
if (!src.includes(anchor)) throw new Error('import anchor missing');
if (!src.includes('from "./resolutionHandlerDeps.js"')) {
  src = src.replace(anchor, anchor + IMPORT_BLOCK);
}

// Avoid duplicate local MANA_POOL / PaymentItem conflicting - keep locals for remaining
// inline payment code; extracted imports use aliases where needed.
// Map EXTRACTED_MANA_POOL only if local const was removed - it wasn't.

// Update handleStepResponse switch to use deps for extracted handlers
const replacements = [
  [
    `    case ResolutionStepType.SCRY:
      handleScryResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.SURVEIL:
      handleSurveilResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.BOTTOM_ORDER:
      handleBottomOrderResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.LIM_DULS_VAULT:
      handleLimDulsVaultResponse(io, game, gameId, step, response);
      break;`,
    `    case ResolutionStepType.SCRY:
      handleScryResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.SURVEIL:
      handleSurveilResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.BOTTOM_ORDER:
      getResolutionHandlerDeps().handleBottomOrderResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.LIM_DULS_VAULT:
      getResolutionHandlerDeps().handleLimDulsVaultResponse(io, game, gameId, step, response);
      break;`,
  ],
  [
    `    case ResolutionStepType.PROLIFERATE:
      handleProliferateResponse(io, game, gameId, step, response);
      break;`,
    `    case ResolutionStepType.PROLIFERATE:
      getResolutionHandlerDeps().handleProliferateResponse(io, game, gameId, step, response);
      break;`,
  ],
  [
    `    case ResolutionStepType.FATESEAL:
      handleFatesealResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.CLASH:
      handleClashResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.VOTE:
      handleVoteResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.PONDER_EFFECT:
      handlePonderEffectResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.TWO_PILE_SPLIT:
      await handleTwoPileSplitResponse(io, game, gameId, step, response);
      break;`,
    `    case ResolutionStepType.FATESEAL:
      getResolutionHandlerDeps().handleFatesealResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.CLASH:
      getResolutionHandlerDeps().handleClashResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.VOTE:
      getResolutionHandlerDeps().handleVoteResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.PONDER_EFFECT:
      getResolutionHandlerDeps().handlePonderEffectResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.TWO_PILE_SPLIT:
      await getResolutionHandlerDeps().handleTwoPileSplitResponse(io, game, gameId, step, response);
      break;`,
  ],
  [
    `    case ResolutionStepType.MODAL_CHOICE:
      await handleModalChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.COLOR_CHOICE:
      await handleColorChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.CREATURE_TYPE_CHOICE:
      await handleCreatureTypeChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.CARD_NAME_CHOICE:
      await handleCardNameChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.BASIC_LAND_TYPE_CHOICE:
      await handleBasicLandTypeChoiceResponse(io, game, gameId, step, response);
      break;`,
    `    case ResolutionStepType.MODAL_CHOICE:
      await getResolutionHandlerDeps().handleModalChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.COLOR_CHOICE:
      await getResolutionHandlerDeps().handleColorChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.CREATURE_TYPE_CHOICE:
      await getResolutionHandlerDeps().handleCreatureTypeChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.CARD_NAME_CHOICE:
      await getResolutionHandlerDeps().handleCardNameChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.BASIC_LAND_TYPE_CHOICE:
      await getResolutionHandlerDeps().handleBasicLandTypeChoiceResponse(io, game, gameId, step, response);
      break;`,
  ],
];

for (const [from, to] of replacements) {
  if (!src.includes(from)) {
    console.warn('SWITCH BLOCK NOT FOUND, trying softer replace...');
  } else {
    src = src.replace(from, to);
  }
}

fs.writeFileSync(PATH, src, 'utf8');
console.log('wired imports+switch, KB', (src.length/1024).toFixed(1));
