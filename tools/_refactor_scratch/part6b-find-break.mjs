import fs from 'node:fs';

const RES = 'D:/Git/MTGEDH/server/src/socket/resolution.ts';
let src = fs.readFileSync(RES, 'utf8').replace(/\r\n/g, '\n');

function cutTopLevelFunction(src, name) {
  const patterns = [
    new RegExp(`\\nexport async function ${name}\\(`, 'm'),
    new RegExp(`\\nexport function ${name}\\(`, 'm'),
    new RegExp(`\\nasync function ${name}\\(`, 'm'),
    new RegExp(`\\nfunction ${name}\\(`, 'm'),
  ];
  let start = -1;
  let matchedLen = 0;
  for (const p of patterns) {
    const m = p.exec(src);
    if (m) { start = m.index + 1; matchedLen = m[0].length - 1; break; }
  }
  if (start < 0) return { src, found: false, bytes: 0 };

  const windowStart = Math.max(0, start - 800);
  const beforeWindow = src.slice(windowStart, start);
  const jsdoc = beforeWindow.match(/(\n\/\*\*[\s\S]*?\*\/\s*)$/);
  if (jsdoc) start = windowStart + jsdoc.index + 1;

  const openParen = src.indexOf('(', start);
  const openBrace = src.indexOf('{', openParen);
  let depth = 0;
  let i = openBrace;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === inStr) inStr = null;
      // template literal: track ${ } nesting roughly by ignoring braces only when inStr is `
      // Actually braces inside template are currently ignored because inStr is set - GOOD
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  let end = i;
  while (end < src.length && src[end] === '\n') end++;
  const bytes = i - start;
  return { src: src.slice(0, start) + '\n' + src.slice(end), found: true, bytes };
}

const TO_CUT = [
  'cloneCascadeZoneCard', 'cloneCascadeLibrary', 'cloneLibraryStateForEvent',
  'cloneZoneCardsForEvent', 'cloneExileStateForEvent', 'appendQueuedResolutionPromptEvent',
  'persistResolutionPaymentManaMutations', 'getResolutionManaSourceCostText', 'escapeResolutionCostRegExp',
  'resolutionManaSourceSelfSacrifices', 'resolutionPaymentActivationCostHasUnsupportedAdditionalCosts',
  'getSupportedResolutionActivationManaCost', 'cloneGameForResolutionPaymentValidation',
  'getTappedResolutionPaymentPermanentIds', 'snapshotResolutionManaPool', 'createEmptyResolutionManaTotals',
  'getResolutionPaymentProducedManaTotals', 'addResolutionManaTotals', 'consumeExplicitSelectedResolutionMana',
  'calculateResolutionManaPoolDelta',
  'upsertOneShotCastFromExilePromptPermission',
  'processPendingCascades', 'processPendingScry', 'processPendingSurveil',
  'processPendingOracleIrCompoundResume', 'processPendingProliferate', 'processPendingPonder',
  'processPendingBottomOrder', 'processPendingLimDulsVault',
  'advanceDanceWithCalamityCastSequence', 'completeDanceWithCalamityDeferredAdvance',
  'processPendingDanceWithCalamity',
  'isTrueLibrarySearchStep', 'handleLibrarySearchResponse',
  'oracleIrResumeStepIncludesDraw', 'oracleIrCompoundResumeIncludesDraw',
  'readShuffledLibraryIdsFromReplayMutations', 'oracleIrLibrarySearchResumeApplied',
  'oracleIrTopLibraryChoiceResumeApplied',
  'filterLibraryCards', 'createLibrarySearchStep',
  'putCardOntoBattlefield',
  'copyDefinedStepFields', 'getTypeSpecificFields',
];

for (const name of TO_CUT) {
  const beforeHas = src.includes('export function registerResolutionHandlers');
  const r = cutTopLevelFunction(src, name);
  src = r.src;
  const afterHas = src.includes('export function registerResolutionHandlers');
  if (beforeHas && !afterHas) {
    console.log('BROKE at', name, 'bytes', r.bytes);
    break;
  }
  console.log(name, r.found ? r.bytes : 'MISS', 'KB', (src.length/1024).toFixed(1));
}
