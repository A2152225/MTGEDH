from pathlib import Path

# Insert evaluateUnlessSacrificesStep near applySacrificeStep in BattlefieldStepHandlers
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts')
text = p.read_text(encoding='utf-8')
marker = 'export function applySacrificeStep('
idx = text.find(marker)
if idx < 0:
    raise SystemExit('applySacrificeStep missing')

fn = '''
type UnlessSacrificesResult =
  | { readonly applied: true; readonly shouldApplyNestedSteps: boolean; readonly state?: GameState; readonly log: readonly string[] }
  | {
      readonly applied: false;
      readonly message: string;
      readonly reason: string;
      readonly options?: {
        readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
        readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
        readonly pending?: boolean;
        readonly persist?: boolean;
      };
      readonly innerStep?: OracleEffectStep;
      readonly state?: GameState;
    };

/**
 * "counter it unless you sacrifice a land" — if the player can sacrifice a matching
 * permanent they must choose; declining (or being unable) applies nested steps
 * (typically counter_spell on this spell).
 */
export function evaluateUnlessSacrificesStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_sacrifices' }>,
  ctx: OracleIRExecutionContext,
): UnlessSacrificesResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-sacrifices step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
        },
      },
    };
  }

  const sacrificerId = players[0];
  const whatText = String((step.what as any)?.text || step.what || 'a permanent').trim().toLowerCase();
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  const candidates = battlefield.filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== String(sacrificerId || '').trim()) return false;
    const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
    if (/\\bland\\b/.test(whatText)) return /\\bland\\b/.test(typeLine);
    if (/\\bcreature\\b/.test(whatText)) return /\\bcreature\\b/.test(typeLine);
    if (/\\bartifact\\b/.test(whatText)) return /\\bartifact\\b/.test(typeLine);
    if (/\\benchantment\\b/.test(whatText)) return /\\benchantment\\b/.test(typeLine);
    return true;
  });

  const explicitChoice =
    ctx.unlessSacrificesChoice === 'sacrifice' || ctx.unlessSacrificesChoice === 'decline'
      ? ctx.unlessSacrificesChoice
      : ((ctx as any).selectorContext?.unlessSacrificesChoice === 'sacrifice'
          || (ctx as any).selectorContext?.unlessSacrificesChoice === 'decline'
          ? (ctx as any).selectorContext.unlessSacrificesChoice
          : undefined);

  if (candidates.length === 0) {
    return {
      applied: true,
      shouldApplyNestedSteps: true,
      log: [`Resolved unless-sacrifices step (${sacrificerId} cannot sacrifice matching permanent): ${step.raw}`],
    };
  }

  if (explicitChoice === 'sacrifice') {
    const sacrificeStep = {
      kind: 'sacrifice',
      who: step.who,
      what: step.what,
      raw: step.raw,
    } as Extract<OracleEffectStep, { kind: 'sacrifice' }>;
    const sacrificeResult = applySacrificeStep(state, sacrificeStep, ctx);
    if ((sacrificeResult as any).applied === false) {
      return {
        applied: false,
        message: String((sacrificeResult as any).message || `Skipped unless-sacrifices sacrifice: ${step.raw}`),
        reason: String((sacrificeResult as any).reason || 'player_choice_required'),
        state: (sacrificeResult as any).state,
        options: (sacrificeResult as any).options,
        innerStep: sacrificeStep,
      };
    }
    return {
      applied: true,
      shouldApplyNestedSteps: false,
      state: (sacrificeResult as any).state ?? state,
      log: [
        ...(((sacrificeResult as any).log as string[]) || []),
        `Resolved unless-sacrifices step (${sacrificerId} sacrificed): ${step.raw}`,
      ],
    };
  }

  if (explicitChoice === 'decline') {
    return {
      applied: true,
      shouldApplyNestedSteps: true,
      log: [`Resolved unless-sacrifices step (${sacrificerId} declined to sacrifice): ${step.raw}`],
    };
  }

  return {
    applied: false,
    message: `Skipped unless-sacrifices step (player choice required): ${step.raw}`,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
      pending: true,
      metadata: {
        sacrificerId,
        candidateCount: candidates.length,
        what: whatText,
      },
    },
  };
}

'''

# Check resolvePlayers is available in this file
if 'function resolvePlayers' not in text and 'resolvePlayers' not in text[:3000]:
    # check imports
    if 'resolvePlayers' not in text:
        print('WARNING: resolvePlayers may need import')

text = text[:idx] + fn + text[idx:]
p.write_text(text, encoding='utf-8')
print('battlefield unless_sacrifices inserted')
