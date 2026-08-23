from pathlib import Path
import re
p = Path(r'D:/Git/MTGEDH/server/src/state/modules/oracleIrServerZoneSync.ts')
text = p.read_text(encoding='utf-8')

# Replace the broken any_player_may block
start = text.find('  if (stepData.oracleIrAnyPlayerMayChoice === true) {')
if start < 0:
    raise SystemExit('block missing')
# find matching end - next "  if (paid)" at same level after our block's return true;
# Our block ends with the last "return true;\n  }\n\n" before the original if (paid)
end_marker = '  if (paid) {\n    if (stepData.oracleIrUnlessPayChoice === true) {'
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit('end marker missing')

new_block = '''  if (stepData.oracleIrAnyPlayerMayChoice === true) {
    let anySteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(String(stepData.oracleIrAnyPlayerMayStepsJson || '[]'));
      anySteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
    } catch {
      anySteps = [];
    }
    const declined = Array.isArray(stepData.oracleIrAnyPlayerMayDeclinedIds)
      ? [...(stepData.oracleIrAnyPlayerMayDeclinedIds as string[])].map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const candidates = Array.isArray(stepData.oracleIrAnyPlayerMayCandidateIds)
      ? [...(stepData.oracleIrAnyPlayerMayCandidateIds as string[])].map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    const controller = String(stepData.oracleIrControllerId || playerId).trim() as PlayerID;
    const sourceId = String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined;
    const sourceName = String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined;
    const targetSpellId = String(stepData.oracleIrTargetSpellId || '').trim() || undefined;

    if (paid) {
      resumeOracleIRRemainingStepsFromResolution(ctx, {
        controller,
        sourceId,
        sourceName,
        targetSpellId,
        steps: anySteps,
        selectorContext: {
          anyPlayerMayChoice: 'pay',
          anyPlayerMayPayerId: playerId,
        },
      });
      return true;
    }

    declined.push(String(playerId));
    resumeOracleIRRemainingStepsFromResolution(ctx, {
      controller,
      sourceId,
      sourceName,
      targetSpellId,
      steps: anySteps,
      selectorContext: {
        anyPlayerMayChoice: 'decline',
        anyPlayerMayPayerId: playerId,
        anyPlayerMayDeclinedPlayerIds: declined,
      },
    });
    return true;
  }

'''

text = text[:start] + new_block + text[end:]
p.write_text(text, encoding='utf-8')
print('fixed resume block')
# verify no bad symbol
print('bad symbol count', text.count('resumeOracleIrStepsFromOptionalPayment'))
