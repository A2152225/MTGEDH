#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function lines(cmd, args) {
  return spawnSync(process.execPath, [cmd, ...args], { encoding: 'utf8' })
    .stdout.trim().split('\n').filter(Boolean);
}

const start = 2248;
const end = 2742;
const decls = lines('tools/_extract_bw/list-range-decls.mjs', ['client/src/App.tsx', String(start), String(end)]);
const used = lines('tools/_extract_bw/used-bindings-fixed.mjs', ['client/src/App.tsx', String(start), String(end)]);
const declSet = new Set(decls);
const passed = used.filter((n) => !declSet.has(n));
const symbol = 'useAppPlayCombatHandlers';
const header = `// Origin parent: client/src/App.tsx
// Cluster moved: split-card / zone / join-forces handlers plus combat memos.
// Public entry symbols: ${symbol}.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import type { BattlefieldPermanent, CardFace, KnownCardRef } from "../../../shared/src";
import type { CardFaceOption } from "../components/SplitCardChoiceModal";
import { socket } from "../socket";
import { canCreatureBlockNow, isCurrentlyCreature } from "../utils/creatureUtils";
import { debugError } from "../utils/debug";

export function ${symbol}(p: Record<string, any>) {
  const {
${passed.map((n) => `    ${n},`).join('\n')}
  } = p;
`;
  const footer = `
  return {
${decls.map((n) => `    ${n},`).join('\n')}
  };
}
`;
  const replacement = `  const {
${decls.map((n) => `    ${n},`).join('\n')}
  } = ${symbol}({
${passed.map((n) => `    ${n},`).join('\n')}
  });
`;
  fs.writeFileSync('tools/_extract_bw/modalHandlersB.header.ts', header);
  fs.writeFileSync('tools/_extract_bw/modalHandlersB.footer.ts', footer);
  fs.writeFileSync('tools/_extract_bw/modalHandlersB.replacement.ts', replacement);
  console.log(`modalHandlersB: ${passed.length} deps, ${decls.length} returns`);
