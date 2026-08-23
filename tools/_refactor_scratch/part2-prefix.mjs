import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/Git/MTGEDH';
const SOCKET = path.join(ROOT, 'server/src/socket');
const SCRATCH = path.join(ROOT, 'tools/_refactor_scratch');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const write = (p, s) => fs.writeFileSync(p, s.replace(/\r\n/g, '\n'), 'utf8');

let body = read(path.join(SCRATCH, 'optionPrefixBody.src.txt'));
// Early-exit returns become return true for the tryHandle boolean API.
body = body.replace(/^\s*return;\s*$/gm, (m) => m.replace('return;', 'return true;'));

const prefixModule = `/**
 * socket/resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts
 *
 * Early special-case PREFIX of handleOptionChoiceResponse (~legend rule through
 * cast-revealed-from-library). Extracted behind resolutionHandlerDeps so cast
 * helpers stay injectable without blunt-cutting the four cores.
 *
 * Returns true when the response was fully handled.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../shared/src/types.js";
import { appendEvent } from "../db/index.js";
import type { GameContext } from "../state/context.js";
import { resolveLegendRuleChoice } from "../state/modules/counters_tokens.js";
import { applyMyriadTokenCopies } from "../state/modules/triggerMyriadTokenUtils.js";
import {
  applyDredgeDrawReplacementChoice,
  applyZursWeirdingOpponentChoice,
} from "../state/modules/zones.js";
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from "../state/modules/oracleIrServerZoneSync.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  createResolutionStep,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { uid } from "../state/utils.js";
import { debugWarn } from "../utils/debug.js";
import { pushWheneverYouExertTriggersOntoStack } from "./exert-triggers.js";
import { handlePlayLandRequest, requestCastSpellForSocket } from "./game-actions.js";
import { getResolutionHandlerDeps } from "./resolutionHandlerDeps.js";
import {
  buildExertTriggeredGraveyardSelectionData,
  cloneResolutionPermanentSnapshot,
  pushExertTriggeredAbilityOntoStack,
} from "./resolutionKeywordChoiceHandlers.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "./util.js";

function extractId(sel: any): string | null {
  if (typeof sel === 'string') return sel;
  if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
  if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
  return null;
}

/**
 * Attempt early special handling for OPTION_CHOICE.
 * @returns true if handled (caller should return)
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

write(path.join(SOCKET, 'resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts'), prefixModule);
console.log('PREFIX KB', (fs.statSync(path.join(SOCKET, 'resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts')).size / 1024).toFixed(1));
