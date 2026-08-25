#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function usedBindings(start, end) {
  const r = spawnSync(process.execPath, [
    'tools/_extract_bw/used-bindings-fixed.mjs',
    'client/src/App.tsx',
    String(start),
    String(end),
  ], { encoding: 'utf8' });
  return r.stdout.trim().split('\n').filter(Boolean);
}

function writeDismiss() {
  const passed = usedBindings(1343, 1412).filter((n) => n !== 'dismissResolutionStepUi');
  const header = `// Origin parent: client/src/App.tsx
// Cluster moved: dismissResolutionStepUi callback (clears resolution-prompt modal state).
// Public entry symbols: useAppDismissResolutionStepUi.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React from "react";

export function useAppDismissResolutionStepUi(p: Record<string, any>) {
  const {
${passed.map((n) => `    ${n},`).join('\n')}
  } = p;
`;
  const footer = `
  return { dismissResolutionStepUi };
}
`;
  const replacement = `  const { dismissResolutionStepUi } = useAppDismissResolutionStepUi({
${passed.map((n) => `    ${n},`).join('\n')}
  });
`;
  fs.writeFileSync('tools/_extract_bw/dismiss.header.ts', header);
  fs.writeFileSync('tools/_extract_bw/dismiss.footer.ts', footer);
  fs.writeFileSync('tools/_extract_bw/dismiss.replacement.ts', replacement);
  console.log(`dismiss fixtures: ${passed.length} props`);
}

writeDismiss();
