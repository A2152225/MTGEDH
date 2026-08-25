#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const start = 1425;
const end = 1704;
const r = spawnSync(process.execPath, [
  'tools/_extract_bw/used-bindings-fixed.mjs',
  'client/src/App.tsx',
  String(start),
  String(end),
], { encoding: 'utf8' });
const passed = r.stdout.trim().split('\n').filter(Boolean);

const header = `// Origin parent: client/src/App.tsx
// Cluster moved: leftover resolutionStepPrompt useEffect (preamble, early/late calls, queue listeners).
// Public entry symbols: useAppResolutionStepPromptEffects.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React from "react";
import { handleAppResolutionStepPromptEarly } from "./appResolutionStepPromptEarly";
import { handleAppResolutionStepPromptLate } from "./appResolutionStepPromptLate";
import { socket } from "../socket";
import { buildResolutionResponsePayload, matchesPromptFingerprint } from "../utils/loopShortcuts";

export function useAppResolutionStepPromptEffects(p: Record<string, any>) {
  const {
${passed.map((n) => `    ${n},`).join('\n')}
  } = p;
`;
  const footer = `}
`;
  const replacement = `  useAppResolutionStepPromptEffects({
${passed.map((n) => `    ${n},`).join('\n')}
  });
`;
  fs.writeFileSync('tools/_extract_bw/promptEffect.header.ts', header);
  fs.writeFileSync('tools/_extract_bw/promptEffect.footer.ts', footer);
  fs.writeFileSync('tools/_extract_bw/promptEffect.replacement.ts', replacement);
  console.log(`promptEffect fixtures: ${passed.length} props`);
