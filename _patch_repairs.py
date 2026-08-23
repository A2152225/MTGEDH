from pathlib import Path

# --- Postprocess repairs ---
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserPostprocess.ts')
text = p.read_text(encoding='utf-8')

# Insert repair functions before repairAbilityExecutionSteps
anchor = 'function repairAbilityExecutionSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {'
if anchor not in text:
    raise SystemExit('repairAbilityExecutionSteps missing')

repairs = r'''
/** "Target player draws N, then discards" — elided then-discard keeps that player. */
export function repairTargetPlayerDrawThenDiscardSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  if (steps.length < 2) return [...steps];
  const out: OracleEffectStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const next = steps[index + 1];
    if (
      step?.kind === 'draw'
      && next?.kind === 'discard'
      && (step.who as any)?.kind === 'target_player'
      && (next.who as any)?.kind === 'you'
      && (/^then\b/i.test(String(next.raw || '')) || next.sequence === 'then')
    ) {
      out.push(step);
      out.push({
        ...next,
        who: parsePlayerSelector('target player'),
      } as OracleEffectStep);
      index += 1;
      continue;
    }
    out.push(step);
  }
  return out;
}

/**
 * Distended Mindbender-style: reveal hand + "You choose from it A and B" grant_static
 * + discard those cards → drop the static grant and stamp dual-filter discard target.
 */
export function repairRevealHandChooseFromItDiscardSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  if (steps.length < 2) return [...steps];
  const out: OracleEffectStep[] = [];
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    const mid = steps[index + 1];
    const end = steps[index + 2];
    const chooseRaw = String((mid as any)?.raw || (mid as any)?.effectText?.[0] || '').replace(/\u2019/g, "'");
    const chooseMatch = chooseRaw.match(
      /^you choose from it (.+)$/i
    );
    if (
      step?.kind === 'reveal_hand'
      && mid?.kind === 'grant_static_ability'
      && chooseMatch
      && end?.kind === 'discard'
      && /those cards/i.test(String((end as any)?.target?.text || end.raw || ''))
    ) {
      const filterText = String(chooseMatch[1] || '').trim().replace(/\.$/, '');
      const andParts = filterText.split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
      const amountValue = Math.max(1, andParts.length || 2);
      out.push(step);
      out.push({
        ...end,
        who: (step as any).who?.kind === 'target_opponent'
          ? { kind: 'target_opponent' }
          : ((end as any).who || { kind: 'target_player' }),
        amount: { kind: 'number', value: amountValue },
        target: { kind: 'raw', text: filterText },
        raw: String(end.raw || `That player discards those cards`),
      } as OracleEffectStep);
      index += 3;
      continue;
    }
    out.push(step);
    index += 1;
  }
  return out;
}

function repairChooseModeNestedExecutionSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  return steps.map((step) => {
    if (step.kind !== 'choose_mode' || !Array.isArray((step as any).modes)) return step;
    const modes = (step as any).modes.map((mode: any) => {
      const nested = repairAbilityExecutionSteps(mode.steps || []);
      return nested === mode.steps ? mode : { ...mode, steps: nested };
    });
    return modes === (step as any).modes ? step : { ...step, modes };
  });
}

'''

# Need to avoid forward reference - repairChooseModeNested calls repairAbilityExecutionSteps
# which will call the nested repair. Better inline the chain without separate nested function calling parent.

# Simpler: update repairAbilityExecutionSteps chain and add a map over choose_mode at the end.
repairs_simple = r'''
/** "Target player draws N, then discards" — elided then-discard keeps that player. */
export function repairTargetPlayerDrawThenDiscardSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  if (steps.length < 2) return [...steps];
  const out: OracleEffectStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const next = steps[index + 1];
    if (
      step?.kind === 'draw'
      && next?.kind === 'discard'
      && (step.who as any)?.kind === 'target_player'
      && (next.who as any)?.kind === 'you'
      && (/^then\b/i.test(String(next.raw || '')) || next.sequence === 'then')
    ) {
      out.push(step);
      out.push({
        ...next,
        who: parsePlayerSelector('target player'),
      } as OracleEffectStep);
      index += 1;
      continue;
    }
    out.push(step);
  }
  return out;
}

/**
 * Distended Mindbender-style: reveal hand + "You choose from it A and B" grant_static
 * + discard those cards → drop the static grant and stamp dual-filter discard target.
 */
export function repairRevealHandChooseFromItDiscardSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  if (steps.length < 2) return [...steps];
  const out: OracleEffectStep[] = [];
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    const mid = steps[index + 1];
    const end = steps[index + 2];
    const chooseRaw = String((mid as any)?.raw || (mid as any)?.effectText?.[0] || '').replace(/\u2019/g, "'");
    const chooseMatch = chooseRaw.match(/^you choose from it (.+)$/i);
    if (
      step?.kind === 'reveal_hand'
      && mid?.kind === 'grant_static_ability'
      && chooseMatch
      && end?.kind === 'discard'
      && /those cards/i.test(String((end as any)?.target?.text || end.raw || ''))
    ) {
      const filterText = String(chooseMatch[1] || '').trim().replace(/\.$/, '');
      const andParts = filterText.split(/\s+and\s+/i).map((part: string) => part.trim()).filter(Boolean);
      const amountValue = Math.max(1, andParts.length || 2);
      out.push(step);
      out.push({
        ...end,
        who: (step as any).who?.kind === 'target_opponent'
          ? { kind: 'target_opponent' }
          : ((end as any).who || { kind: 'target_player' }),
        amount: { kind: 'number', value: amountValue },
        target: { kind: 'raw', text: filterText },
        raw: String(end.raw || 'That player discards those cards'),
      } as OracleEffectStep);
      index += 3;
      continue;
    }
    out.push(step);
    index += 1;
  }
  return out;
}

function mapChooseModeNestedRepairs(
  steps: readonly OracleEffectStep[],
  repair: (inner: readonly OracleEffectStep[]) => OracleEffectStep[],
): OracleEffectStep[] {
  return steps.map((step) => {
    if (step.kind !== 'choose_mode' || !Array.isArray((step as any).modes)) return step;
    let changed = false;
    const modes = (step as any).modes.map((mode: any) => {
      const nested = repair(mode.steps || []);
      if (nested !== mode.steps) changed = true;
      return nested === mode.steps ? mode : { ...mode, steps: nested };
    });
    return changed ? { ...step, modes } : step;
  });
}

'''

text = text.replace(anchor, repairs_simple + anchor, 1)

old_chain = """function repairAbilityExecutionSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return mergeAdjacentCreateTokenFollowupSteps(
    repairFightDamageSourceSteps(
    repairFroghemothCounterAndLifeSteps(
      repairEmblemWithNestedConditionalSteps(
        repairEventideDrawLoseLifeSteps(
          repairCompoundExileLookSteps(
            repairGraveyardChooseThenReturnSteps(
              repairCopyRetargetTailSteps(
                repairThatPlayerHandBottomThenDrawSteps(
                  repairMoveZoneSelectorSteps(steps),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
  );
}"""

new_chain = """function repairAbilityExecutionSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const repairedFlat = mergeAdjacentCreateTokenFollowupSteps(
    repairFightDamageSourceSteps(
    repairFroghemothCounterAndLifeSteps(
      repairEmblemWithNestedConditionalSteps(
        repairEventideDrawLoseLifeSteps(
          repairCompoundExileLookSteps(
            repairGraveyardChooseThenReturnSteps(
              repairCopyRetargetTailSteps(
                repairRevealHandChooseFromItDiscardSteps(
                  repairTargetPlayerDrawThenDiscardSteps(
                    repairThatPlayerHandBottomThenDrawSteps(
                      repairMoveZoneSelectorSteps(steps),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
  );
  // Choose-mode bullets are parsed in isolation; re-run draw-then-discard repair inside modes.
  return mapChooseModeNestedRepairs(repairedFlat, (inner) =>
    repairTargetPlayerDrawThenDiscardSteps(inner),
  );
}"""

if old_chain not in text:
    raise SystemExit('old chain missing')
text = text.replace(old_chain, new_chain, 1)

# Check parsePlayerSelector is available in postprocess
if 'parsePlayerSelector' not in text[:5000]:
    print('WARNING: parsePlayerSelector may need to be in scope')

p.write_text(text, encoding='utf-8')
print('postprocess repairs ok')
