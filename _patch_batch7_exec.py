from pathlib import Path

p = Path(r'rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts')
t = p.read_text(encoding='utf-8')

# Insert generic handlers early in applyGainControlStep, after the attacking-player special case block
# or right after the raw normalization.
anchor = "export function applyGainControlStep(\n  state: GameState,\n  step: Extract<OracleEffectStep, { kind: 'gain_control' }>,\n  ctx: OracleIRExecutionContext\n): BattlefieldStepHandlerResult {\n  const raw = String(step.raw || '')\n    .replace(/\\u2019/g, \"'\")\n    .trim()\n    .toLowerCase();\n"
if anchor not in t:
    raise SystemExit('applyGainControlStep anchor missing')

insert = """export function applyGainControlStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_control' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const raw = String(step.raw || '')
    .replace(/\\u2019/g, "'")
    .trim()
    .toLowerCase();

  // Generic: gain control of target opponent during that player's next turn.
  if (
    /gain(?:s)?\\s+control\\s+of\\s+target\\s+opponent\\s+during\\s+that\\s+(?:player|opponent)['\\u2019]?s\\s+next\\s+turn/i.test(raw)
    || step.duration === 'during_that_players_next_turn'
  ) {
    const targetOpponentId = String(
      ctx.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        ctx.selectorContext?.targetPlayerId ||
        ''
    ).trim();
    const controllerId = String(ctx.controllerId || '').trim();
    if (!targetOpponentId || !controllerId) {
      return {
        applied: false,
        message: `Skipped gain-control (no target opponent for next-turn control): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const controlledPlayerNextTurn = {
      ...(((state as any).controlledPlayerNextTurn || {}) as Record<string, string>),
      [targetOpponentId]: controllerId,
    };
    return {
      applied: true,
      state: { ...(state as any), controlledPlayerNextTurn } as GameState,
      log: [`${controllerId} gains control of ${targetOpponentId} during that player's next turn`],
    };
  }

  // Generic: gain control of all creatures target player controls.
  if (/gain(?:s)?\\s+control\\s+of\\s+all\\s+creatures\\s+target\\s+player\\s+controls/i.test(raw)) {
    const targetPlayerId = String(
      ctx.targetPlayerId ||
        ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        ''
    ).trim();
    const controllerId = String(ctx.controllerId || '').trim();
    if (!targetPlayerId || !controllerId) {
      return {
        applied: false,
        message: `Skipped gain-control (no target player for bulk creature control): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const nextBattlefield = ((state.battlefield || []) as any[]).map((permanent: any) => {
      if (!permanentMatchesType(permanent, 'creature')) return permanent;
      if (String(permanent?.controller || '').trim() !== targetPlayerId) return permanent;
      if (String(permanent?.controller || '').trim() === controllerId) return permanent;
      return { ...permanent, controller: controllerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Gained control of all creatures controlled by ${targetPlayerId}`],
    };
  }
"""

if 'during that player\'s next turn' in t[t.find('export function applyGainControlStep'):t.find('export function applyGainControlStep')+1200] or 'during_that_players_next_turn' in t[t.find('export function applyGainControlStep'):t.find('export function applyGainControlStep')+800]:
    # check more carefully
    start = t.find('export function applyGainControlStep')
    if 'during_that_players_next_turn' in t[start:start+1500]:
        print('gain control next-turn already present')
    else:
        t = t.replace(anchor, insert, 1)
        print('inserted gain-control handlers')
else:
    t = t.replace(anchor, insert, 1)
    print('inserted gain-control handlers')

p.write_text(t, encoding='utf-8')
print('battlefield handlers OK')
