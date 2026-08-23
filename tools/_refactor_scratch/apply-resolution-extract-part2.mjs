/**
 * Part 2: option-choice early specials PREFIX + pre-complete validation for extracted steps.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/Git/MTGEDH';
const SOCKET = path.join(ROOT, 'server/src/socket');
const SCRATCH = path.join(ROOT, 'tools/_refactor_scratch');
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s.replace(/\r\n/g, '\n'), 'utf8');
const scratch = (n) => read(path.join(SCRATCH, `${n}.src.txt`)).replace(/\r\n/g, '\n');

let body = scratch('optionPrefixBody');
// body starts with `  if (stepData?.legendRuleChoice === true) {` — keep indent inside function

const prefixModule = `/**
 * socket/resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts
 *
 * Early special-case PREFIX of handleOptionChoiceResponse (legend rule, behold,
 * dredge/Zur's replacements, exert, myriad, gift, MDFC, cast-revealed, etc.).
 * Extracted behind resolutionHandlerDeps so injectable cast helpers stay swappable.
 *
 * Returns true when the response was fully handled (caller should return).
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import { resolveLegendRuleChoice } from "../state/modules/counters_tokens.js";
import {
  applyDredgeDrawReplacementChoice,
  applyZursWeirdingOpponentChoice,
} from "../state/modules/drawReplacementEffects.js";
import { applyMyriadTokenCopies } from "../state/modules/triggerMyriadTokenUtils.js";
import { triggerETBEffectsForToken } from "../state/modules/triggerEtbEntryEffects.js";
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from "../state/modules/oracleIrServerZoneSync.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import type { GameContext } from "../state/types.js";
import { uid } from "../state/utils.js";
import { debug, debugWarn } from "../utils/debug.js";
import { handleImportWipeConfirmVote } from "./deck.js";
import { pushWheneverYouExertTriggersOntoStack } from "./exert-triggers.js";
import { requestCastSpellForSocket, handlePlayLandRequest } from "./game-actions.js";
import { handleJudgeConfirmVote } from "./judge.js";
import {
  buildExertTriggeredGraveyardSelectionData,
  cloneResolutionPermanentSnapshot,
  pushExertTriggeredAbilityOntoStack,
} from "./resolutionKeywordChoiceHandlers.js";
import { getResolutionHandlerDeps } from "./resolutionHandlerDeps.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "./util.js";

function extractId(sel: any): string | null {
  if (typeof sel === 'string') return sel;
  if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
  if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
  return null;
}

/**
 * Attempt early special handling for OPTION_CHOICE.
 * @returns true if handled (including error emits that consumed the response)
 */
export async function tryHandleOptionChoiceEarlySpecialsPrefix(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;
  const deps = getResolutionHandlerDeps();
  const appendCastSpellContinuationEvent = deps.appendCastSpellContinuationEvent;
  const createForwardingGameActionSocket = deps.createForwardingGameActionSocket;
  const restartPlayerCastRequest = deps.restartPlayerCastRequest;

${body}
  return false;
}
`;

// Fix: PREFIX body had import wipe start? We cut at 26201 which may include trailing partial.
// Also remove handleImportWipe if it got included - check.
write(path.join(SOCKET, 'resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts'), prefixModule);

// Fix import path for draw replacement - verify actual module path
console.log('PREFIX module written, size KB=', (fs.statSync(path.join(SOCKET, 'resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts')).size/1024).toFixed(1));
