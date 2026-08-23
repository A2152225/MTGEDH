/**
 * Assembly + patch script for resolution.ts response-cluster extraction (2026-08-22).
 * Run: node tools/_refactor_scratch/apply-resolution-extract.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/Git/MTGEDH';
const SOCKET = path.join(ROOT, 'server/src/socket');
const SCRATCH = path.join(ROOT, 'tools/_refactor_scratch');
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s.replace(/\r\n/g, '\n'), 'utf8');
const scratch = (n) => read(path.join(SCRATCH, `${n}.src.txt`)).replace(/\r\n/g, '\n');

function stripLeadingIndent(src, spaces = 0) {
  // keep as-is; scratch dumps preserve original indent from resolution.ts
  return src;
}

function toExportedFunction(src, name) {
  return src
    .replace(new RegExp(`async function ${name}\\(`, 'g'), `export async function ${name}(`)
    .replace(new RegExp(`function ${name}\\(`, 'g'), `export function ${name}(`);
}

// ---------- 1) synthetic cast socket utils ----------
const createForwarding = toExportedFunction(scratch('createForwarding').trim() + '\n', 'createForwardingGameActionSocket');
const restart = toExportedFunction(scratch('restartPlayerCast').trim() + '\n', 'restartPlayerCastRequest')
  .replace(
    'registerGameActions(io, socket as any);',
    'const { registerGameActions } = await import("./game-actions.js");\n  registerGameActions(io, socket as any);',
  );
const appendCast = toExportedFunction(scratch('appendCastCont').trim() + '\n', 'appendCastSpellContinuationEvent');

const syntheticUtils = `/**
 * socket/resolutionSyntheticCastSocketUtils.ts
 *
 * Tiny cast-continuation helpers shared by option-choice early specials and
 * color/type choice response handlers. Extracted from resolution.ts so the
 * handler deps seam can inject them without circular factory imports.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import { debugWarn } from "../utils/debug.js";
import { emitToPlayer } from "./util.js";

${appendCast}

${createForwarding}

${restart}
`;

write(path.join(SOCKET, 'resolutionSyntheticCastSocketUtils.ts'), syntheticUtils);

// ---------- 2) vote / proliferate / lim-dul ----------
const prolif = toExportedFunction(scratch('proliferate').trim() + '\n', 'handleProliferateResponse');
const vote = toExportedFunction(scratch('vote').trim() + '\n', 'handleVoteResponse');
const limdul = toExportedFunction(scratch('limdul').trim() + '\n', 'handleLimDulsVaultResponse');

const voteProlifLim = `/**
 * socket/resolutionVoteProliferateLimDulResponseHandlers.ts
 *
 * VOTE / PROLIFERATE / LIM_DULS_VAULT response handlers (CR 701.38 / 701.28 / Lim-Dul's Vault).
 * Extracted from resolution.ts and wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import { trackCountersPlacedThisTurn } from "../state/modules/counters_tokens.js";
import { maybeResumeOracleIRStepsAfterResolution } from "../state/modules/oracleIrServerZoneSync.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { debug, debugWarn } from "../utils/debug.js";
import { processPendingLimDulsVault } from "./resolutionProcessPendingHandlers.js";
import { appendGameEvent, getPlayerName } from "./util.js";

${prolif}

${vote}

${limdul}
`;

write(path.join(SOCKET, 'resolutionVoteProliferateLimDulResponseHandlers.ts'), voteProlifLim);

// ---------- 3) color / type / name ----------
let colorCluster = scratch('colorThroughCardName').trim() + '\n';
// Drop the stray "Handle creature type choice..." orphan comment before color handler if present
colorCluster = colorCluster.replace(
  /^\/\*\*\s*\n\s*\*\s*Handle creature type choice response via resolution queue\s*\n\s*\*\/\s*\n/m,
  '',
);
colorCluster = toExportedFunction(colorCluster, 'handleColorChoiceResponse');
colorCluster = toExportedFunction(colorCluster, 'handleBasicLandTypeChoiceResponse');
colorCluster = toExportedFunction(colorCluster, 'handleCreatureTypeChoiceResponse');
colorCluster = toExportedFunction(colorCluster, 'handleCardNameChoiceResponse');
// Use shared util for cast continuation
colorCluster = colorCluster.replaceAll(
  'appendCastSpellContinuationEvent(',
  'appendCastSpellContinuationEvent(',
);

const colorTypeName = `/**
 * socket/resolutionColorTypeNameChoiceResponseHandlers.ts
 *
 * COLOR_CHOICE / BASIC_LAND_TYPE_CHOICE / CREATURE_TYPE_CHOICE / CARD_NAME_CHOICE
 * response handlers. Extracted from resolution.ts; wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { debug, debugWarn } from "../utils/debug.js";
import { appendCastSpellContinuationEvent } from "./resolutionSyntheticCastSocketUtils.js";
import { emitToPlayer, getPlayerName, persistAndResolveTopOfStack } from "./util.js";

${colorCluster}
`;

write(path.join(SOCKET, 'resolutionColorTypeNameChoiceResponseHandlers.ts'), colorTypeName);

console.log('Wrote synthetic, vote/prolif/limdul, color/type/name modules');
