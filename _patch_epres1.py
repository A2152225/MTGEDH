from pathlib import Path
p = Path(r'D:/Git/MTGEDH/server/src/state/effects/effectProgramResolutionService.ts')
text = p.read_text(encoding='utf-8')

old = """function buildTeamworkChooseBothQueueExtras(
  pause: EffectProgramChoicePause<any>,
  oracleIrBridge?: EffectProgramOracleIrBridgeConfig,
): EffectProgramQueueExtraConfig {
  if ((oracleIrBridge?.irCtx as any)?.teamworkWasPaid !== true) {
    return {};
  }
  const payload = (pause.choiceEvent as any)?.payload || pause.step?.choiceRequest?.payload;
  const oracleStepKind = String((payload as any)?.oracleStepKind || '');
  const oracleStep = (payload as any)?.oracleStep as any;
  if (oracleStepKind !== 'choose_mode' || !oracleStep?.teamworkChooseBoth) {
    return {};
  }
  const modes = Array.isArray((payload as any)?.modes)
    ? (payload as any).modes
    : Array.isArray(oracleStep?.modes)
      ? oracleStep.modes
      : [];
  const modeCount = modes.length > 0 ? modes.length : 2;
  return {
    maxModes: Math.min(2, modeCount),
    teamworkChooseBoth: true,
    teamworkWasPaid: true,
  };
}"""

# Get exact function from file
idx = text.find('function buildTeamworkChooseBothQueueExtras')
end = text.find('\n}', idx)
# find closing of function more carefully
brace=0
started=False
for i,ch in enumerate(text[idx:idx+1200]):
  if ch=='{':
    brace+=1; started=True
  elif ch=='}':
    brace-=1
    if started and brace==0:
      end=idx+i+1
      break
fn=text[idx:end]
print('FN END', end-idx)
print(fn[-80:])

new_fn = fn + """

function buildKickerChooseBothQueueExtras(
  pause: EffectProgramChoicePause<any>,
  oracleIrBridge?: EffectProgramOracleIrBridgeConfig,
): EffectProgramQueueExtraConfig {
  if ((oracleIrBridge?.irCtx as any)?.wasKicked !== true) {
    return {};
  }
  const payload = (pause.choiceEvent as any)?.payload || pause.step?.choiceRequest?.payload;
  const oracleStepKind = String((payload as any)?.oracleStepKind || '');
  const oracleStep = (payload as any)?.oracleStep as any;
  if (oracleStepKind !== 'choose_mode' || !oracleStep?.kickerChooseBoth) {
    return {};
  }
  const modes = Array.isArray((payload as any)?.modes)
    ? (payload as any).modes
    : Array.isArray(oracleStep?.modes)
      ? oracleStep.modes
      : [];
  const modeCount = modes.length > 0 ? modes.length : 2;
  return {
    minModes: modeCount,
    maxModes: modeCount,
    kickerChooseBoth: true,
    wasKicked: true,
  };
}"""

text = text[:idx] + new_fn + text[end:]

# Update call site
old_call = 'const teamworkExtras = buildTeamworkChooseBothQueueExtras(runResult.pendingChoice, args.oracleIrBridge);'
if old_call not in text:
  # find call
  i=text.find('buildTeamworkChooseBothQueueExtras')
  print('call context', repr(text[i-80:i+200]))
  raise SystemExit('call missing')

# Find how teamworkExtras is used
i=text.find(old_call)
print(repr(text[i:i+400]))
