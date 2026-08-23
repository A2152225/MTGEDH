from pathlib import Path

# --- oracleIRExecutionTypes.ts: add wasKicked + unlessSacrificesChoice ---
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutionTypes.ts')
text = p.read_text(encoding='utf-8')

# Add to selector context area (first teamworkWasPaid around 237) and execution context (347)
# Add wasKicked near teamworkWasPaid in both places
old = "  readonly teamworkWasPaid?: boolean;"
# Count occurrences
print('teamwork count', text.count(old))
text = text.replace(
  "  readonly teamworkWasPaid?: boolean;",
  "  readonly teamworkWasPaid?: boolean;\n  /** Whether the resolving source was kicked (cast with kicker). */\n  readonly wasKicked?: boolean;",
)
# unless choice
old_ud = "  /** Choice for unless-discards wrappers when already known. */\n  readonly unlessDiscardsChoice?: 'discard' | 'decline';"
new_ud = """  /** Choice for unless-discards wrappers when already known. */
  readonly unlessDiscardsChoice?: 'discard' | 'decline';
  /** Choice for unless-sacrifices wrappers when already known. */
  readonly unlessSacrificesChoice?: 'sacrifice' | 'decline';"""
if old_ud not in text:
    raise SystemExit('unlessDiscardsChoice missing')
text = text.replace(old_ud, new_ud, 1)
p.write_text(text, encoding='utf-8')
print('execution types ok')

# --- applyChooseModeStep ---
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorChooseModeStepHandlers.ts')
text = p.read_text(encoding='utf-8')
old = """  const rawSelectedModeIds = Array.isArray(options.selectedModeIds)
    ? options.selectedModeIds
    : null;
  if (!rawSelectedModeIds) {
    return {
      kind: 'recorded_skip',
      message: `Skipped choose_mode step (needs player selection): ${(step as any).raw ?? step.kind}`,
      reason: 'player_choice_required',
      options: {
        pending: true,
        classification: 'player_choice',
      },
    };
  }

  const canRepeatModes = Boolean((step as any).canRepeatModes);
  const normalizedSelectedModeIds = rawSelectedModeIds
    .map(id => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean);
  const modeById = new Map(
    ((step as any).modes || []).map((mode: any) => [String(mode?.label || '').trim(), mode] as const)
  );"""

new = """  const modeById = new Map(
    ((step as any).modes || []).map((mode: any) => [String(mode?.label || '').trim(), mode] as const)
  );
  const allModeLabels = Array.from(modeById.keys()).filter(Boolean);
  const sourceWasKicked = ctx.wasKicked === true
    || (ctx as any).selectorContext?.wasKicked === true;
  const kickerChooseBoth = Boolean((step as any).kickerChooseBoth);
  const forceBothFromKicker = kickerChooseBoth && sourceWasKicked && allModeLabels.length > 0;

  let rawSelectedModeIds = Array.isArray(options.selectedModeIds)
    ? options.selectedModeIds
    : null;
  if (!rawSelectedModeIds && forceBothFromKicker) {
    rawSelectedModeIds = allModeLabels;
  }
  if (!rawSelectedModeIds) {
    return {
      kind: 'recorded_skip',
      message: `Skipped choose_mode step (needs player selection): ${(step as any).raw ?? step.kind}`,
      reason: 'player_choice_required',
      options: {
        pending: true,
        classification: 'player_choice',
      },
    };
  }

  const canRepeatModes = Boolean((step as any).canRepeatModes);
  const normalizedSelectedModeIds = rawSelectedModeIds
    .map(id => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean);"""

if old not in text:
    raise SystemExit('choose mode begin missing')
text = text.replace(old, new, 1)

old2 = """  const minModes = Math.max(0, Number((step as any).minModes ?? 0) || 0);
  const maxModesRaw = Number((step as any).maxModes ?? -1);
  let maxModes = Number.isFinite(maxModesRaw) && maxModesRaw >= 0 ? maxModesRaw : Infinity;
  if (Boolean((step as any).teamworkChooseBoth) && ctx.teamworkWasPaid === true) {
    const modeCount = Array.isArray((step as any).modes) ? (step as any).modes.length : 0;
    maxModes = Math.min(2, modeCount > 0 ? modeCount : 2);
  }"""
new2 = """  let minModes = Math.max(0, Number((step as any).minModes ?? 0) || 0);
  const maxModesRaw = Number((step as any).maxModes ?? -1);
  let maxModes = Number.isFinite(maxModesRaw) && maxModesRaw >= 0 ? maxModesRaw : Infinity;
  if (Boolean((step as any).teamworkChooseBoth) && ctx.teamworkWasPaid === true) {
    const modeCount = Array.isArray((step as any).modes) ? (step as any).modes.length : 0;
    maxModes = Math.min(2, modeCount > 0 ? modeCount : 2);
  }
  if (forceBothFromKicker) {
    const modeCount = allModeLabels.length;
    minModes = modeCount;
    maxModes = modeCount;
  }"""
if old2 not in text:
    raise SystemExit('minmax block missing')
text = text.replace(old2, new2, 1)
p.write_text(text, encoding='utf-8')
print('choose mode handler ok')
