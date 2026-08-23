/**
 * Reconstruct resolution.ts using column-0 declaration boundaries (file style).
 */
import fs from 'node:fs';

const RES = 'D:/Git/MTGEDH/server/src/socket/resolution.ts';
let src = fs.readFileSync(RES, 'utf8').replace(/\r\n/g, '\n');
const startKB = src.length / 1024;

const TOP_LEVEL_START = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|^(?:export\s+)?type\s+(\w+)\b|^(?:export\s+)?(?:const|let|class|enum)\s+(\w+)\b|^export\s+\{|^export\s+default\b/gm;

function findTopLevelRanges(src) {
  const ranges = [];
  let m;
  const re = new RegExp(TOP_LEVEL_START.source, 'gm');
  while ((m = re.exec(src)) !== null) {
    const name = m[1] || m[2] || m[3] || null;
    ranges.push({ index: m.index, name, text: m[0] });
  }
  return ranges;
}

function cutFunctionByName(src, name) {
  const ranges = findTopLevelRanges(src);
  const idx = ranges.findIndex((r) => r.name === name && /function/.test(r.text));
  if (idx < 0) {
    console.warn('NOT FOUND', name);
    return src;
  }
  let start = ranges[idx].index;
  // eat preceding JSDoc within 600 chars if immediately above
  const windowStart = Math.max(0, start - 600);
  const before = src.slice(windowStart, start);
  const jsdoc = before.match(/(\n\/\*\*[\s\S]*?\*\/\s*)$/);
  if (jsdoc) start = windowStart + jsdoc.index + 1; // keep leading newline structure

  const end = idx + 1 < ranges.length ? ranges[idx + 1].index : src.length;
  const bytes = end - start;
  console.log('cut', name, 'KB', (bytes / 1024).toFixed(1));
  return src.slice(0, start) + src.slice(end);
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
  // MANA_POOL const? skip
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
  'extractResolutionChoiceId', 'emitKeywordChoiceChat', 'appendKeywordPromptResolveEvent',
  'cloneResolutionPermanentSnapshot', 'getResolutionSourcePermanentSnapshot',
  'buildTriggeredAbilitySourceContext', 'pushExertTriggeredAbilityOntoStack',
  'matchesRequiredTypeWords', 'buildExertTriggeredGraveyardSelectionData',
  'handleRiotChoiceResponse', 'handleUnleashChoiceResponse', 'handleFabricateChoiceResponse',
  'handleTributeChoiceResponse', 'handleMentorTargetResponse', 'handleExploitChoiceResponse',
  'handleModularChoiceResponse', 'handleSoulshiftTargetResponse', 'handleHauntTargetResponse',
  'handleCommanderZoneResponse',
  'handleScryResponse', 'handleSurveilResponse',
  'handleFatesealResponse', 'handleClashResponse', 'handleBottomOrderResponse',
  'handlePonderEffectResponse', 'handleSequentialOracleIrPileSplitResponse', 'handleTwoPileSplitResponse',
  'handleModalChoiceResponse', 'handleSoldierProgramChoice',
  'handleProliferateResponse', 'handleVoteResponse', 'handleLimDulsVaultResponse',
  'handleColorChoiceResponse', 'handleBasicLandTypeChoiceResponse',
  'handleCreatureTypeChoiceResponse', 'handleCardNameChoiceResponse',
  'appendCastSpellContinuationEvent', 'createForwardingGameActionSocket', 'restartPlayerCastRequest',
];

for (const name of TO_CUT) {
  const before = src.includes('export function registerResolutionHandlers');
  src = cutFunctionByName(src, name);
  const after = src.includes('export function registerResolutionHandlers');
  if (before && !after) {
    console.error('BROKE registerResolutionHandlers at', name);
    process.exit(1);
  }
}

fs.writeFileSync(RES + '.reconstructed', src, 'utf8');
console.log('DONE KB', (src.length / 1024).toFixed(1), 'from', startKB.toFixed(1));
console.log('has register', src.includes('export function registerResolutionHandlers'));
console.log('has handleStep', src.includes('async function handleStepResponse'));
console.log('has optionChoice', src.includes('async function handleOptionChoiceResponse'));
