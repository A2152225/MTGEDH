from pathlib import Path
p = Path(r'D:/Git/MTGEDH/server/src/state/modules/oracleIrServerZoneSync.ts')
text = p.read_text(encoding='utf-8')

old_gate = '''  if (
    stepData.oracleIrUnlessPayChoice !== true
    && stepData.oracleIrOptionalPayManaChoice !== true
    && stepData.oracleIrOptionalMayChoice !== true
    && stepData.oracleIrUnlessDiscardsChoice !== true
  ) {
    return false;
  }'''

new_gate = '''  if (
    stepData.oracleIrUnlessPayChoice !== true
    && stepData.oracleIrOptionalPayManaChoice !== true
    && stepData.oracleIrOptionalMayChoice !== true
    && stepData.oracleIrUnlessDiscardsChoice !== true
    && stepData.oracleIrAnyPlayerMayChoice !== true
  ) {
    return false;
  }'''

if 'oracleIrAnyPlayerMayChoice !== true' not in text:
    if old_gate not in text:
        raise SystemExit('gate not found')
    text = text.replace(old_gate, new_gate, 1)
    print('gate updated')
else:
    print('gate already has anyPlayerMay')

# Add handling block before the unless pay resume sections
# Find: if (paid) { if (stepData.oracleIrUnlessPayChoice === true)
marker = '  if (paid) {\n    if (stepData.oracleIrUnlessPayChoice === true) {'
if "stepData.oracleIrAnyPlayerMayChoice === true" not in text[text.find('resolveOracleIrOptionalPaymentPromptFromResolution'):]:
    insert = '''  if (stepData.oracleIrAnyPlayerMayChoice === true) {
    let anySteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(String(stepData.oracleIrAnyPlayerMayStepsJson || '[]'));
      anySteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
    } catch {
      anySteps = [];
    }
    const declined = Array.isArray(stepData.oracleIrAnyPlayerMayDeclinedIds)
      ? [...(stepData.oracleIrAnyPlayerMayDeclinedIds as string[])]
      : [];
    const candidates = Array.isArray(stepData.oracleIrAnyPlayerMayCandidateIds)
      ? [...(stepData.oracleIrAnyPlayerMayCandidateIds as string[])]
      : [];

    if (paid) {
      // Payment already applied above for life; sacrifice/discard may need richer UX later.
      resumeOracleIrStepsFromOptionalPayment(ctx, {
        controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
        sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
        sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
        targetSpellId: String(stepData.oracleIrTargetSpellId || '').trim() || undefined,
        steps: anySteps,
        choice: 'pay',
        extraCtx: {
          anyPlayerMayChoice: 'pay',
          anyPlayerMayPayerId: playerId,
        },
      });
      return true;
    }

    declined.push(playerId);
    const remaining = candidates.filter((id) => id && !declined.includes(String(id)));
    if (remaining.length > 0) {
      // Re-queue for next APNAP candidate by resuming the wrapper with decline so far.
      resumeOracleIrStepsFromOptionalPayment(ctx, {
        controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
        sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
        sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
        targetSpellId: String(stepData.oracleIrTargetSpellId || '').trim() || undefined,
        steps: anySteps,
        choice: 'decline',
        extraCtx: {
          anyPlayerMayChoice: 'decline',
          anyPlayerMayPayerId: playerId,
          anyPlayerMayDeclinedPlayerIds: declined,
        },
      });
      return true;
    }

    resumeOracleIrStepsFromOptionalPayment(ctx, {
      controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
      sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
      sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
      targetSpellId: String(stepData.oracleIrTargetSpellId || '').trim() || undefined,
      steps: anySteps,
      choice: 'decline',
      extraCtx: {
        anyPlayerMayChoice: 'decline',
        anyPlayerMayPayerId: playerId,
        anyPlayerMayDeclinedPlayerIds: declined,
      },
    });
    return true;
  }

'''
    # Find a good insertion point - right before `if (paid) { if (stepData.oracleIrUnlessPayChoice`
    idx = text.find('  if (paid) {\n    if (stepData.oracleIrUnlessPayChoice === true) {')
    if idx < 0:
        # try alternate
        idx = text.find('if (stepData.oracleIrUnlessPayChoice === true)')
        print('alt idx', idx)
        # find preceding if (paid)
        idx = text.rfind('if (paid)', 0, idx)
        print('paid at', idx)
        # insert before this if (paid) block that handles unless
    if idx < 0:
        raise SystemExit('could not find unless pay resume block')
    text = text[:idx] + insert + text[idx:]
    print('added any_player_may resume handler')
else:
    print('resume handler present')

# Check if resumeOracleIrStepsFromOptionalPayment accepts extraCtx - may need to adapt
i = text.find('function resumeOracleIrStepsFromOptionalPayment')
print('resume fn at', i)
print(text[i:i+900] if i>=0 else 'missing')

p.write_text(text, encoding='utf-8')
