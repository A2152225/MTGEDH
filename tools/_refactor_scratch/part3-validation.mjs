import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/Git/MTGEDH';
const SOCKET = path.join(ROOT, 'server/src/socket');
const resPath = path.join(SOCKET, 'resolution.ts');
const lines = fs.readFileSync(resPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

function extractBlock(startCommentLine1Based) {
  const start = startCommentLine1Based - 1;
  let i = start;
  while (i < lines.length && !/if \(step\.type === ResolutionStepType\./.test(lines[i])) i++;
  let depth = 0;
  let started = false;
  let end = i;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) { end = j; break; }
  }
  // dedent common 4 spaces from registerResolutionHandlers body
  return lines.slice(start, end + 1).map((l) => (l.startsWith('    ') ? l.slice(4) : l)).join('\n');
}

const commentLines = [6324, 6924, 6946, 7304, 7821, 7873, 7924, 7975];
const blocks = commentLines.map(extractBlock);

const mod = `/**
 * socket/resolutionRegisterPreCompleteValidationForExtractedSteps.ts
 *
 * Pre-complete selection validation for step types whose response handlers are
 * already extracted behind the resolutionHandlerDeps seam (MODAL_CHOICE, CLASH,
 * TWO_PILE_SPLIT, PONDER_EFFECT, SCRY, SURVEIL, FATESEAL, BOTTOM_ORDER).
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 */

import type { Socket } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";

export type ExtractedStepPreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
};

/**
 * Validate selections for already-extracted response step types.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateExtractedStepTypesBeforeComplete(
  args: ExtractedStepPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled } = args;

${blocks.map((b) => {
  // convert \`if (step.type === ...)\` blocks into early-return false pattern
  // Original: if (...) { ... socket.emit...; return; }
  // Inside our function, \`return;\` must become \`return false;\`
  let transformed = b.replace(/^\\s*return;\\s*$/gm, (m) => m.replace('return;', 'return false;'));
  // Wrap each if so unmatched types fall through
  return transformed;
}).join('\n\n')}

  return true;
}
`;

fs.writeFileSync(path.join(SOCKET, 'resolutionRegisterPreCompleteValidationForExtractedSteps.ts'), mod.replace(/\r\n/g, '\n'), 'utf8');
console.log('validation module KB', (fs.statSync(path.join(SOCKET, 'resolutionRegisterPreCompleteValidationForExtractedSteps.ts')).size / 1024).toFixed(1));
