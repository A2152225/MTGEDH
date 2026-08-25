import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(TEST_DIR, '..');
const AI_PATH = path.join(SERVER_DIR, 'src', 'socket', 'ai.ts');
const OPTION_CHOICE_HANDLER_DIR = path.join(SERVER_DIR, 'src', 'socket', 'resolution-handlers');
const AI_HANDLER_DIR = path.join(SERVER_DIR, 'src', 'socket', 'ai-handlers');
const OPTION_CHOICE_EXTRA_FILES = [
  path.join(SERVER_DIR, 'src', 'socket', 'resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts'),
  path.join(SERVER_DIR, 'src', 'socket', 'resolutionOptionChoiceEarlySpecialsConfirmCastPaymentHandlers.ts'),
];

const OPTION_CHOICE_FLAGS_WITHOUT_DIRECT_AI_BOOLEAN_CHECK = new Set([
  'castFromExileCastWithoutPayingManaCost',
  'castFromGraveyardExileAfterResolution',
  'castFromGraveyardWithoutPayingManaCost',
  'chooseLookedAtCardsDestinationRandomizeOtherOrder',
  'echoChoice',
  'forceRequiresLifePayment',
  'playFromGraveyardExileAfterResolution',
  'playFromGraveyardWithoutPayingManaCost',
  'resumeCleanupAfterPrompt',
  'sacrificeUnlessPayChoice',
  'ventureIntoDungeon',
]);

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function readSourcesMatching(dirPath: string, filePattern: RegExp): string {
  return fs.readdirSync(dirPath)
    .filter((name) => filePattern.test(name))
    .sort()
    .map((name) => readSource(path.join(dirPath, name)))
    .join('\n');
}

function uniqueMatches(source: string, pattern: RegExp): string[] {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]).filter(Boolean))].sort();
}

describe('AI option-choice coverage metadata', () => {
  it('has explicit AI routing or a documented exemption for option-choice response flags', () => {
    const optionChoiceHandler = [
      readSourcesMatching(OPTION_CHOICE_HANDLER_DIR, /^(optionChoice|mayAbilityAndOptionalTrigger).*\.ts$/),
      ...OPTION_CHOICE_EXTRA_FILES.map((filePath) => readSource(filePath)),
    ].join('\n');
    const aiSource = [
      readSource(AI_PATH),
      readSourcesMatching(AI_HANDLER_DIR, /\.ts$/),
    ].join('\n');

    const responseFlags = uniqueMatches(optionChoiceHandler, /stepData(?:\?\.|\.)([A-Za-z0-9_]+)\s*===\s*true/g);
    const explicitAIFlags = new Set(uniqueMatches(aiSource, /step\?\.([A-Za-z0-9_]+)\s*===\s*true/g));

    const uncovered = responseFlags.filter(
      (flag) => !explicitAIFlags.has(flag) && !OPTION_CHOICE_FLAGS_WITHOUT_DIRECT_AI_BOOLEAN_CHECK.has(flag),
    );

    expect(uncovered).toEqual([]);
  });
});