/**
 * Reconstruct wired resolution.ts:
 * - Start from current (HEAD-sized) resolution.ts
 * - Remove function bodies that already live in extracted modules (brace-matched)
 * - Add imports + deps wiring + this-pass switch/PREFIX/validation updates
 */
import fs from 'node:fs';

const RES = 'D:/Git/MTGEDH/server/src/socket/resolution.ts';
let src = fs.readFileSync(RES, 'utf8').replace(/\r\n/g, '\n');
const startSize = src.length;

/** Cut one top-level function by brace matching. Optionally eat a nearby JSDoc. */
function cutTopLevelFunction(src, name) {
  const patterns = [
    new RegExp(`\\nexport async function ${name}\\(`, 'm'),
    new RegExp(`\\nexport function ${name}\\(`, 'm'),
    new RegExp(`\\nasync function ${name}\\(`, 'm'),
    new RegExp(`\\nfunction ${name}\\(`, 'm'),
  ];
  let start = -1;
  for (const p of patterns) {
    const m = p.exec(src);
    if (m) { start = m.index + 1; break; } // +1 skip leading \n so we keep one newline
  }
  if (start < 0) {
    console.warn('NOT FOUND', name);
    return src;
  }

  // Eat immediately-preceding JSDoc (within 800 chars)
  const windowStart = Math.max(0, start - 800);
  const beforeWindow = src.slice(windowStart, start);
  const jsdoc = beforeWindow.match(/(\n\/\*\*[\s\S]*?\*\/\s*)$/);
  if (jsdoc) start = windowStart + jsdoc.index + 1;

  // Find opening brace of the function
  const openParen = src.indexOf('(', start);
  const openBrace = src.indexOf('{', openParen);
  if (openBrace < 0) throw new Error('no brace for ' + name);

  let depth = 0;
  let i = openBrace;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        i++; // include closing brace
        break;
      }
    }
  }
  // also eat trailing newlines (leave one)
  let end = i;
  while (end < src.length && (src[end] === '\n' || src[end] === '\r')) end++;
  const out = src.slice(0, start) + '\n' + src.slice(end);
  console.log('cut', name, 'bytes', startSize && (i - start));
  return out;
}

// Functions already extracted to modules (prior passes + this pass)
const TO_CUT = [
  // clone utils
  'cloneCascadeZoneCard', 'cloneCascadeLibrary', 'cloneLibraryStateForEvent',
  'cloneZoneCardsForEvent', 'cloneExileStateForEvent', 'appendQueuedResolutionPromptEvent',
  // payment mana
  'persistResolutionPaymentManaMutations', 'getResolutionManaSourceCostText', 'escapeResolutionCostRegExp',
  'resolutionManaSourceSelfSacrifices', 'resolutionPaymentActivationCostHasUnsupportedAdditionalCosts',
  'getSupportedResolutionActivationManaCost', 'cloneGameForResolutionPaymentValidation',
  'getTappedResolutionPaymentPermanentIds', 'snapshotResolutionManaPool', 'createEmptyResolutionManaTotals',
  'getResolutionPaymentProducedManaTotals', 'addResolutionManaTotals', 'consumeExplicitSelectedResolutionMana',
  'calculateResolutionManaPoolDelta',
  // process pending
  'upsertOneShotCastFromExilePromptPermission',
  'processPendingCascades', 'processPendingScry', 'processPendingSurveil',
  'processPendingOracleIrCompoundResume', 'processPendingProliferate', 'processPendingPonder',
  'processPendingBottomOrder', 'processPendingLimDulsVault',
  'advanceDanceWithCalamityCastSequence', 'completeDanceWithCalamityDeferredAdvance',
  'processPendingDanceWithCalamity',
  // library search helpers
  'isTrueLibrarySearchStep', 'handleLibrarySearchResponse',
  'oracleIrResumeStepIncludesDraw', 'oracleIrCompoundResumeIncludesDraw',
  'readShuffledLibraryIdsFromReplayMutations', 'oracleIrLibrarySearchResumeApplied',
  'oracleIrTopLibraryChoiceResumeApplied',
  'filterLibraryCards', 'createLibrarySearchStep',
  'putCardOntoBattlefield',
  'copyDefinedStepFields', 'getTypeSpecificFields',
  // keyword choice
  'extractResolutionChoiceId', 'emitKeywordChoiceChat', 'appendKeywordPromptResolveEvent',
  'cloneResolutionPermanentSnapshot', 'getResolutionSourcePermanentSnapshot',
  'buildTriggeredAbilitySourceContext', 'pushExertTriggeredAbilityOntoStack',
  'matchesRequiredTypeWords', 'buildExertTriggeredGraveyardSelectionData',
  'handleRiotChoiceResponse', 'handleUnleashChoiceResponse', 'handleFabricateChoiceResponse',
  'handleTributeChoiceResponse', 'handleMentorTargetResponse', 'handleExploitChoiceResponse',
  'handleModularChoiceResponse', 'handleSoulshiftTargetResponse', 'handleHauntTargetResponse',
  // response handlers
  'handleCommanderZoneResponse',
  'handleScryResponse', 'handleSurveilResponse',
  'handleFatesealResponse', 'handleClashResponse', 'handleBottomOrderResponse',
  'handlePonderEffectResponse', 'handleSequentialOracleIrPileSplitResponse', 'handleTwoPileSplitResponse',
  'handleModalChoiceResponse', 'handleSoldierProgramChoice',
  // this pass
  'handleProliferateResponse', 'handleVoteResponse', 'handleLimDulsVaultResponse',
  'handleColorChoiceResponse', 'handleBasicLandTypeChoiceResponse',
  'handleCreatureTypeChoiceResponse', 'handleCardNameChoiceResponse',
  'appendCastSpellContinuationEvent', 'createForwardingGameActionSocket', 'restartPlayerCastRequest',
];

for (const name of TO_CUT) {
  src = cutTopLevelFunction(src, name);
}

// Also cut MANA_POOL_KEY_BY_SYMBOL / types if they moved? check payment utils - skip for now

fs.writeFileSync(RES + '.reconstructed', src, 'utf8');
console.log('result KB', (src.length / 1024).toFixed(1), 'from', (startSize / 1024).toFixed(1));
