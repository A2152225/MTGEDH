#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const names = spawnSync(process.execPath, [
  'tools/_extract_bw/used-bindings.mjs',
  'client/src/App.tsx',
  '5643',
  '6350',
], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);

const extra = ['socket'].filter((n) => !names.includes(n));
// socket is imported in the leaf, not passed
const passed = names.filter((n) => n !== 'socket');

const header = `// Origin parent: client/src/App.tsx
// Cluster moved: early play overlays (PhaseNavigator through player-choice modal).
// Public entry symbols: renderAppPlayOverlaysEarly.
// Leaf must not import App.tsx or App-handlers/index.ts.

import { socket } from "../socket";
import { PhaseNavigator } from "../components/PhaseNavigator";
import { CommanderSelectModal } from "../components/CommanderSelectModal";
import CommanderConfirmModal from "../components/CommanderConfirmModal";
import { ScrySurveilModal } from "../components/ScrySurveilModal";
import { ExploreModal } from "../components/ExploreModal";
import { BatchExploreModal } from "../components/BatchExploreModal";
import { OpponentMayPayModal } from "../components/OpponentMayPayModal";
import { LoopShortcutConsentModal } from "../components/LoopShortcutConsentModal";
import { TapUntapTargetModal } from "../components/TapUntapTargetModal";
import { CounterMovementModal } from "../components/CounterMovementModal";
import { StationCreatureSelectionModal } from "../components/StationCreatureSelectionModal";
import { PlayerTargetSelectionModal } from "../components/PlayerTargetSelectionModal";

export function renderAppPlayOverlaysEarly(p: Record<string, any>) {
  const {
${passed.map((n) => `    ${n},`).join('\n')}
  } = p;
  return (
    <>
`;

const footer = `    </>
  );
}
`;

const replacement = `      {renderAppPlayOverlaysEarly({
${passed.map((n) => `        ${n},`).join('\n')}
      })}
`;

fs.writeFileSync('tools/_extract_bw/overlaysEarly.header.ts', header);
fs.writeFileSync('tools/_extract_bw/overlaysEarly.footer.ts', footer);
fs.writeFileSync('tools/_extract_bw/overlaysEarly.replacement.ts', replacement);
console.log(`wrote fixtures, ${passed.length} props, extra ignored: ${extra.join(',')}`);
