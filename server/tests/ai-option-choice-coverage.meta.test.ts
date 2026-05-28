import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(TEST_DIR, '..');
const RESOLUTION_PATH = path.join(SERVER_DIR, 'src', 'socket', 'resolution.ts');
const AI_PATH = path.join(SERVER_DIR, 'src', 'socket', 'ai.ts');

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

function extractFunctionSource(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function uniqueMatches(source: string, pattern: RegExp): string[] {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]).filter(Boolean))].sort();
}

describe('AI option-choice coverage metadata', () => {
  it('has explicit AI routing or a documented exemption for option-choice response flags', () => {
    const resolutionSource = readSource(RESOLUTION_PATH);
    const optionChoiceHandler = extractFunctionSource(
      resolutionSource,
      'async function handleOptionChoiceResponse',
      'async function handleMutateTargetSelectionResponse',
    );
    const aiSource = readSource(AI_PATH);

    const responseFlags = uniqueMatches(optionChoiceHandler, /stepData(?:\?\.|\.)([A-Za-z0-9_]+)\s*===\s*true/g);
    const explicitAIFlags = new Set(uniqueMatches(aiSource, /step\?\.([A-Za-z0-9_]+)\s*===\s*true/g));

    const uncovered = responseFlags.filter(
      (flag) => !explicitAIFlags.has(flag) && !OPTION_CHOICE_FLAGS_WITHOUT_DIRECT_AI_BOOLEAN_CHECK.has(flag),
    );

    expect(uncovered).toEqual([]);
  });
});