from pathlib import Path
p = Path(r'D:/Git/MTGEDH/server/src/state/effects/effectProgramResolutionService.ts')
text = p.read_text(encoding='utf-8')

if 'buildKickerChooseBothQueueExtras' not in text:
  idx = text.find('function buildTeamworkChooseBothQueueExtras')
  brace=0
  started=False
  end=None
  for i,ch in enumerate(text[idx:idx+1500]):
    if ch=='{':
      brace+=1; started=True
    elif ch=='}':
      brace-=1
      if started and brace==0:
        end=idx+i+1
        break
  insert = """

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
  text = text[:end] + insert + text[end:]

old_call = """    const teamworkExtras = buildTeamworkChooseBothQueueExtras(runResult.pendingChoice, args.oracleIrBridge);
    const queuedStep = queueEffectProgramChoice(args.gameId, runResult.pendingChoice, {
      ...(args.queueExtraConfig || {}),
      ...teamworkExtras,
    });"""
new_call = """    const teamworkExtras = buildTeamworkChooseBothQueueExtras(runResult.pendingChoice, args.oracleIrBridge);
    const kickerExtras = buildKickerChooseBothQueueExtras(runResult.pendingChoice, args.oracleIrBridge);
    const queuedStep = queueEffectProgramChoice(args.gameId, runResult.pendingChoice, {
      ...(args.queueExtraConfig || {}),
      ...teamworkExtras,
      ...kickerExtras,
    });"""
if old_call not in text:
  raise SystemExit('call site missing')
text = text.replace(old_call, new_call, 1)
p.write_text(text, encoding='utf-8')
print('epres ok')
