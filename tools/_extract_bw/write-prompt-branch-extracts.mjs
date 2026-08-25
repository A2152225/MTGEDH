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
  return r.stdout.trim().split('\n').filter((n) => n && n !== 'payload' && n !== 'step');
}

function writePair(kind, start, end, extras) {
  const passed = usedBindings(start, end);
  const header = extras.headerIntro + `  const {
${passed.map((n) => `    ${n},`).join('\n')}
  } = p;
` + (extras.headerSeam || '');
  const footer = `}
`;
  const replacement = extras.replacementIntro + `{
${passed.map((n) => `        ${n},`).join('\n')}
      });
`;
  fs.writeFileSync(`tools/_extract_bw/${kind}.header.ts`, header);
  fs.writeFileSync(`tools/_extract_bw/${kind}.footer.ts`, footer);
  fs.writeFileSync(`tools/_extract_bw/${kind}.replacement.ts`, replacement);
  console.log(`${kind} fixtures: ${passed.length} props, start-end ${start}-${end}`);
}

writePair('promptEarly', 1523, 2104, {
  headerIntro: `// Origin parent: client/src/App.tsx
// Cluster moved: resolutionStepPrompt early branches (discard_selection through bounce land).
// Public entry symbols: handleAppResolutionStepPromptEarly.
// Leaf must not import App.tsx or App-handlers/index.ts.

import type { KnownCardRef, PaymentCostAdjustment } from "../../../shared/src";
import { buildOptionalEffectKey } from "../../../shared/src/optionalEffectKey";
import type { GraveyardCard } from "../components/GraveyardSelectionModal";
import type { KynaiosChoiceRequest } from "../components/KynaiosChoiceModal";
import type { OpponentMayPayPrompt } from "../components/OpponentMayPayModal";
import type { OptionChoiceRequest } from "../components/OptionChoiceModal";
import type { TargetOption } from "../components/TargetSelectionModal";
import type { TwoPileSplitRequest } from "../components/TwoPileSplitModal";
import { debug } from "../utils/debug";
import {
  buildGenericOptionChoiceRequestFromStep,
  buildPendingSpellXSelectionFromStep,
  isGenericNumberChoiceStep,
  isGenericOptionChoiceFallbackStep,
  isNamedGenericOptionChoiceStep,
} from "../utils/resolutionChoicePrimitives";
import { isResolutionStepMandatory } from "../utils/resolutionStepUtils";

export function handleAppResolutionStepPromptEarly(
  step: any,
  payload: { gameId: string; step: any },
  p: Record<string, any>,
) {
`,
  replacementIntro: `      handleAppResolutionStepPromptEarly(step, payload, `,
});

writePair('promptLate', 2106, 2748, {
  headerIntro: `// Origin parent: client/src/App.tsx
// Cluster moved: resolutionStepPrompt late branches (hideaway_choice through trigger_order).
// Public entry symbols: handleAppResolutionStepPromptLate.
// Leaf must not import App.tsx or App-handlers/index.ts.

import type { CastingMode } from "../components/CastingModeSelectionModal";
import type { JoinForcesRequest } from "../components/JoinForcesModal";
import type { SpellMode } from "../components/ModalSpellSelectionModal";
import type { TargetOption, TargetSelectionGroup } from "../components/TargetSelectionModal";
import type { TemptingOfferRequest } from "../components/TemptingOfferModal";
import type { TriggerPromptData } from "../components/TriggeredAbilityModal";
import { buildLibrarySearchModalStateFromStep } from "../utils/resolutionChoicePrimitives";
import { isResolutionStepMandatory } from "../utils/resolutionStepUtils";

export function handleAppResolutionStepPromptLate(
  step: any,
  payload: { gameId: string; step: any },
  p: Record<string, any>,
) {
`,
  headerSeam: `  if (false) {
    /* seam so the extracted else-if chain stays byte-identical */
  }
`,
  replacementIntro: `      handleAppResolutionStepPromptLate(step, payload, `,
});
