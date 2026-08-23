/**
 * Surgical patch of resolution.ts for extracted clusters + PREFIX + validation.
 */
import fs from 'node:fs';

const path = 'D:/Git/MTGEDH/server/src/socket/resolution.ts';
let src = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const originalLen = src.length;

function cutFunction(src, startPattern, nextPatterns) {
  const start = src.search(startPattern);
  if (start < 0) throw new Error('start not found: ' + startPattern);
  // Find end: next function/export at column 0-ish after start
  let end = -1;
  for (const np of nextPatterns) {
    const idx = src.slice(start + 1).search(np);
    if (idx >= 0) {
      const abs = start + 1 + idx;
      if (end < 0 || abs < end) end = abs;
    }
  }
  if (end < 0) throw new Error('end not found after ' + startPattern);
  // Include any preceding block comment immediately above
  let cutStart = start;
  const before = src.slice(0, start);
  const commentMatch = before.match(/(\n\/\*\*[\s\S]*?\*\/\s*)\n$/);
  if (commentMatch) cutStart = start - commentMatch[1].length;
  // Also trim extra blank lines left behind
  let out = src.slice(0, cutStart) + src.slice(end);
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

// --- Remove local helper defs (will import instead) ---
src = cutFunction(
  src,
  /^function createForwardingGameActionSocket\(/m,
  [/^function didQueuedSpellCastComplete\(/m],
);
src = cutFunction(
  src,
  /^async function restartPlayerCastRequest\(/m,
  [/^function validateWardManaPaymentSelection\(/m],
);
src = cutFunction(
  src,
  /^function appendCastSpellContinuationEvent\(/m,
  [/^type NormalizedCounterRemovalPayment/m, /^function normalizeCounterRemovalPaymentSelections\(/m],
);

// --- Remove response handler clusters ---
src = cutFunction(
  src,
  /^function handleProliferateResponse\(/m,
  [/^function handleLifeRedistributionResponse\(/m],
);
src = cutFunction(
  src,
  /^function handleVoteResponse\(/m,
  [/^async function handlePrisonersDilemmaChoiceResponse\(/m],
);
src = cutFunction(
  src,
  /^function handleLimDulsVaultResponse\(/m,
  [/^function handleDanceWithCalamityResponse\(/m],
);
src = cutFunction(
  src,
  /^async function handleColorChoiceResponse\(/m,
  [/^async function handleBasicLandTypeChoiceResponse\(/m, /^async function handleSuspendCastResponse\(/m],
);
// After color cut, basic/creature/card may still be there — cut each
src = cutFunction(
  src,
  /^async function handleBasicLandTypeChoiceResponse\(/m,
  [/^async function handleCreatureTypeChoiceResponse\(/m, /^async function handleSuspendCastResponse\(/m],
);
src = cutFunction(
  src,
  /^async function handleCreatureTypeChoiceResponse\(/m,
  [/^async function handleCardNameChoiceResponse\(/m, /^\/\*\*\s*\n \* Handle Card Name/m, /^async function handleSuspendCastResponse\(/m],
);
src = cutFunction(
  src,
  /^async function handleCardNameChoiceResponse\(/m,
  [/^async function handleSuspendCastResponse\(/m, /^\/\*\*\s*\n \* Handle Suspend/m],
);

// Also remove orphan comments left from color cluster header if present
src = src.replace(
  /\n\/\*\*\s*\n \* Handle creature type choice response via resolution queue\s*\n \*\/\s*\n/g,
  '\n',
);
src = src.replace(
  /\n\/\*\*\s*\n \* Handle Color Choice response[\s\S]*?\*\/\s*\n(?=async function handleSuspendCastResponse)/g,
  '\n',
);

console.log('After function cuts, delta KB', ((originalLen - src.length) / 1024).toFixed(1));
fs.writeFileSync(path + '.partial1', src, 'utf8');
console.log('wrote partial1');
