import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(TEST_DIR, '..');

const INTERACTION_EVENT_SOURCE_PATHS = [
  path.join(SERVER_DIR, 'src', 'socket', 'game-actions.ts'),
  path.join(SERVER_DIR, 'src', 'socket', 'interaction.ts'),
  path.join(SERVER_DIR, 'src', 'socket', 'mana-handlers.ts'),
  path.join(SERVER_DIR, 'src', 'socket', 'opponent-may-pay.ts'),
  path.join(SERVER_DIR, 'src', 'socket', 'player-selection.ts'),
  path.join(SERVER_DIR, 'src', 'socket', 'resolution.ts'),
  path.join(SERVER_DIR, 'src', 'state', 'resolution', 'handlers'),
];

const REPLAY_GUARDED_EVENT_TYPES = new Set([
  'activateBattlefieldAbility',
  'activateCycling',
  'activateDoublingCube',
  'activateFetchland',
  'activateGraveyardAbility',
  'activateManaAbility',
  'activatePlaneswalkerAbility',
  'activateSacrificeDrawAbility',
  'activateTutorAbility',
  'activateUpgradeAbility',
  'addManaToPool',
  'bounceLandChoice',
  'bottomOrderResolve',
  'cardNameChoice',
  'castFromExilePromptResolve',
  'castRevealedFromLibraryResolve',
  'cascadeResolve',
  'castSpellContinuation',
  'changePermanentControl',
  'choosePileFromSplitResolve',
  'clashResolve',
  'cleanupDiscard',
  'colorChoice',
  'confirmForbiddenOrchardTarget',
  'concededPlayerCleanup',
  'confirmGraveyardTargets',
  'counterPlacementResolve',
  'counter_moved',
  'counterTargetChosen',
  'copyRetargetChoiceResolve',
  'copyTriggeredSpellResolve',
  'crewVehicle',
  'discardEffect',
  'dungeonRoomFreeCastChoiceResolve',
  'dungeonRoomPenaltyChoiceResolve',
  'dungeonRoomThroneResolve',
  'dungeonTargetCreatureResolve',
  'dungeonTargetPlayerResolve',
  'equipPermanent',
  'enlist',
  'exertChoice',
  'executeEffect',
  'fatesealResolve',
  'fight',
  'hideawayChoice',
  'joinForcesComplete',
  'joinForcesContribution',
  'keepHand',
  'kynaiosChoiceComplete',
  'kynaiosChoiceResponse',
  'librarySearchResolve',
  'limDulsVaultContinue',
  'limDulsVaultResolve',
  'danceWithCalamityContinue',
  'danceWithCalamityBeginCasting',
  'danceWithCalamitySetCastOrder',
  'danceWithCalamityAdvanceCast',
  'danceWithCalamityResolve',
  'moxDiamondChoice',
  'myriadChoice',
  'mulliganPutToBottom',
  'opponentMayPayResolve',
  'optionChoice',
  'optionalPaymentPromptResolve',
  'optionalTriggeredAbilityChoice',
  'playerChoice',
  'playerSelection',
  'playOpeningHandCards',
  'ponderEffectResolve',
  'putCardFromHandOntoBattlefield',
  'proliferateResolve',
  'removeManaFromPool',
  'removeManaPoolDoesNotEmpty',
  'retargetAbilityCopyResolve',
  'retargetSpellCopyResolve',
  'resolveTopOfStackPrompt',
  'rulesChoiceResolved',
  'revealLandChoice',
  'sacrificeUnlessPayChoice',
  'sacrificeSelectionResolve',
  'sacrificeWhenYouDoResolve',
  'scryResolve',
  'setManaPoolDoesNotEmpty',
  'setLife',
  'shockLandChoice',
  'skipOpeningHandActions',
  'skipToPhase',
  'spellBottomRevealUntilNonlandResolve',
  'surveilResolve',
  'tapPermanent',
  'temptingOfferComplete',
  'temptingOfferResponse',
  'targetSelectionWardPrompt',
  'targetSelectionTapUntapPrompt',
  'triggerOrderResponse',
  'untapPermanent',
  'wardPaymentResolve',
  'ventureChooseDungeonResolve',
  'ventureChooseRoomResolve',
  'voteSubmit',
  'exchangeTextBoxes',
  'assignTriggeredAbilityTargets',
]);

const REPLAY_GUARD_EXEMPTIONS: Record<string, string> = {
  Conceded: 'false-positive capture from payload strings like lossReason: Conceded, not an event type',
  allPlayersPassed: 'nextStep reason marker captured by the appendEvent meta regex, not a standalone persisted event type',
  adjustLife: 'non-interactive gameplay primitive; covered by direct life bookkeeping tests rather than prompt-resolution replay guard',
  castSpell: 'core gameplay event, not a queued interaction outcome',
  castFromGraveyardPromptResolve: 'graveyard-cast prompt resolution is currently covered by targeted integration tests like oskar-rubbish-reclaimer.integration.test.ts rather than replay-named guard files',
  concede: 'lifecycle event, not a replay-specific interaction contract',
  drawCards: 'core gameplay primitive, not a queued interaction outcome',
  exploreResolve: 'spell-resolution primitive; not currently part of the guarded interaction replay families',
  foretellCard: 'gameplay action, not a queued interaction outcome',
  suspendCard: 'gameplay action, not a queued interaction outcome',
  mill: 'core gameplay primitive, not a queued interaction outcome',
  mulligan: 'opening-hand progression primitive; the replay guard focuses on completion events instead',
  nextStep: 'turn progression primitive, not a queued interaction outcome',
  permanent_untapped: 'generic state event, not a player-choice resolution contract',
  phaseOutPermanents: 'gameplay state primitive, not a queued interaction outcome',
  playLand: 'core gameplay action, not a queued interaction outcome',
  pushTriggeredAbility: 'stack-construction primitive covered by targeted applyEvent tests, not this replay guard',
  resolvedSpellCopyChoiceResolve: 'resolved-spell copy choice bookkeeping is currently covered by targeted applyEvent/integration tests rather than replay-named guard files',
  resolvedSpellCopyResolve: 'resolved-spell copy replay bookkeeping is currently covered by targeted applyEvent/integration tests rather than replay-named guard files',
  restart: 'game lifecycle event, not a queued interaction outcome',
  sacrificePermanent: 'generic gameplay primitive, not a queued interaction outcome',
  setHouseRules: 'configuration event, not a queued interaction outcome',
  setTriggerShortcut: 'preference/configuration event, not a queued interaction outcome',
  scheduleDelayedGraveyardReturn: 'covered by targeted applyEvent tests in delayed-graveyard-return.applyEvent.test.ts rather than replay-named guard files',
  skipToPhaseCleanup: 'nextStep reason marker captured by the appendEvent meta regex, not a standalone persisted event type',
  unkeepHand: 'opening-hand progression primitive; the replay guard focuses on completion events instead',
};

function walkFiles(dirPath: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function collectPersistedInteractionEventTypes(): string[] {
  const eventTypeRegex = /appendEvent\([^\r\n]*["']([A-Za-z0-9_]+)["']/g;
  const eventTypes = new Set<string>();

  for (const sourcePath of INTERACTION_EVENT_SOURCE_PATHS) {
    const sourceFiles = fs.statSync(sourcePath).isDirectory()
      ? walkFiles(sourcePath).filter(filePath => filePath.endsWith('.ts'))
      : [sourcePath];

    for (const filePath of sourceFiles) {
      const content = readFile(filePath);
      for (const match of content.matchAll(eventTypeRegex)) {
        const eventType = String(match[1] || '').trim();
        if (eventType) {
          eventTypes.add(eventType);
        }
      }
    }
  }

  return [...eventTypes].sort();
}

function collectReplayTestFiles(): string[] {
  return walkFiles(TEST_DIR)
    .filter(filePath => filePath.endsWith('.ts'))
    .filter(filePath => path.basename(filePath).includes('replay'));
}

function findReplayCoverageFiles(eventType: string, replayTestFiles: string[]): string[] {
  const pattern = new RegExp(`(["'])${eventType}\\1|type:\\s*(["'])${eventType}\\2`);
  return replayTestFiles.filter(filePath => pattern.test(readFile(filePath)));
}

describe('interactive replay coverage guard', () => {
  it('forces every persisted interaction event to be classified as guarded or exempt', () => {
    const discoveredEventTypes = collectPersistedInteractionEventTypes();
    const classifiedEventTypes = new Set([
      ...REPLAY_GUARDED_EVENT_TYPES,
      ...Object.keys(REPLAY_GUARD_EXEMPTIONS),
    ]);

    const unclassifiedEventTypes = discoveredEventTypes.filter(eventType => !classifiedEventTypes.has(eventType));

    expect(unclassifiedEventTypes, `Unclassified persisted interaction events: ${unclassifiedEventTypes.join(', ')}`).toEqual([]);
  });

  it('requires replay-named test coverage for every guarded interaction event', () => {
    const replayTestFiles = collectReplayTestFiles();
    const missingCoverage = [...REPLAY_GUARDED_EVENT_TYPES]
      .sort()
      .map(eventType => ({ eventType, files: findReplayCoverageFiles(eventType, replayTestFiles) }))
      .filter(entry => entry.files.length === 0)
      .map(entry => entry.eventType);

    expect(missingCoverage, `Guarded interaction events missing replay coverage: ${missingCoverage.join(', ')}`).toEqual([]);
  });
});