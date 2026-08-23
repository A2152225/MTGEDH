import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.ts';
import { isTriggerEffectFullyIrWired } from './server/src/state/modules/oracleIrTriggerLegacyRouting.ts';
import { collectOracleEffectSteps } from './server/src/state/modules/trigger-runtime-wiring.ts';
import { resolveCopySpellCount } from './rules-engine/src/oracleIRExecutorCopySpellSupport.ts';
import { resolveCommanderCastsFromCommandZoneThisGame } from './rules-engine/src/oracleIRExecutorCommanderCastCount.ts';
import { applyChooseModeStep } from './rules-engine/src/oracleIRExecutorChooseModeStepHandlers.ts';

const depth = `Devoid (This card has no color.)
Kicker {C} (You may pay an additional {C} as you cast this spell.)
When you cast this spell, choose one. If it was kicked, choose both instead.
• Return target creature to its owner's hand.
• Target player draws two cards, then discards a card.`;

const mind = `When you cast this spell, target opponent reveals their hand. You choose from it a nonland card with mana value 3 or less and a card with mana value 4 or greater. That player discards those cards.`;
const vortex = `When you cast this spell, counter it unless you sacrifice a land.`;

const depthIr: any = parseOracleTextToIR(depth, 'Depth Defiler');
const choose = depthIr.abilities.find((a: any) => a.steps?.some((s: any) => s.kind === 'choose_mode'))?.steps?.find((s: any) => s.kind === 'choose_mode');
console.log('DEPTH choose', JSON.stringify({
  min: choose?.minModes, max: choose?.maxModes, kickerChooseBoth: choose?.kickerChooseBoth,
  mode2: choose?.modes?.[1]?.steps?.map((s: any) => ({ kind: s.kind, who: s.who, seq: s.sequence })),
}, null, 2));

const mindSteps = collectOracleEffectSteps(mind.replace(/^when you cast this spell,\s*/i,''), 'Distended Mindbender');
console.log('MIND wired', isTriggerEffectFullyIrWired(mind.replace(/^when you cast this spell,\s*/i,''), 'Distended Mindbender'));
console.log('MIND steps', JSON.stringify(mindSteps.map((s: any) => ({ kind: s.kind, who: s.who, amount: s.amount, target: s.target, raw: String(s.raw||'').slice(0,70) })), null, 2));

const vortexBody = 'counter it unless you sacrifice a land.';
const vortexSteps = collectOracleEffectSteps(vortexBody, 'Mana Vortex');
console.log('VORTEX wired', isTriggerEffectFullyIrWired(vortexBody, 'Mana Vortex'));
console.log('VORTEX steps', JSON.stringify(vortexSteps, null, 2).slice(0,1500));

// choose mode auto both when kicked
const result = applyChooseModeStep(
  { battlefield: [], players: [] } as any,
  choose,
  { controllerId: 'p1', wasKicked: true } as any,
  {},
  (state, steps) => ({ state, log: [`nested:${steps.length}`], appliedSteps: steps, skippedSteps: [], automationGaps: [], pendingOptionalSteps: [] }),
);
console.log('KICKED choose result', result.kind, (result as any).log?.slice(0,3));
