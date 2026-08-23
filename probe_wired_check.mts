import { isTriggerEffectFullyIrWired } from './server/src/state/modules/oracleIrTriggerLegacyRouting.ts';
import { collectOracleEffectSteps } from './server/src/state/modules/trigger-runtime-wiring.ts';

const mind = `target opponent reveals their hand. You choose from it a nonland card with mana value 3 or less and a card with mana value 4 or greater. That player discards those cards.`;
const vortex = `counter it unless you sacrifice a land.`;
const depth = `choose one. If it was kicked, choose both instead.
• Return target creature to its owner's hand.
• Target player draws two cards, then discards a card.`;

for (const [n,t] of [['mind',mind],['vortex',vortex],['depth',depth]] as const) {
  const steps = collectOracleEffectSteps(t, n);
  console.log('====', n, 'wired=', isTriggerEffectFullyIrWired(t, n));
  console.log(JSON.stringify(steps.map(s=>({kind:s.kind, raw:(s as any).raw?.slice?.(0,80), who:(s as any).who, target:(s as any).target})), null, 2));
}
