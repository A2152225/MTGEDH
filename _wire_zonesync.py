from pathlib import Path

p = Path(r'D:/Git/MTGEDH/server/src/state/modules/oracleIrServerZoneSync.ts')
text = p.read_text(encoding='utf-8')

# Add import for nextSpellCostReduction and describeAnyPlayerMayPayment
if 'grantNextSpellCostReduction' not in text:
    lines = text.splitlines(True)
    last_import = 0
    for i, line in enumerate(lines[:120]):
        if line.startswith('import '):
            last_import = i
    lines.insert(
        last_import + 1,
        "import { grantNextSpellCostReduction } from './nextSpellCostReduction.js';\n"
        "import { describeAnyPlayerMayPayment } from '../../../../rules-engine/src/oracleIRAnyPlayerMay.js';\n",
    )
    text = ''.join(lines)
    print('imports added')

# In queueUnlessPayChoicePromptsFromOracleIRResult, add any_player_may handling
# after reading stepKind from gap
needle = "    if (stepKind === 'unless_pays_mana' && skippedStep?.kind === 'unless_pays_mana') {"
insert = '''    if (stepKind === 'any_player_may' && skippedStep?.kind === 'any_player_may') {
      const payment = (skippedStep as any).payment;
      const paymentLabel = describeAnyPlayerMayPayment(payment);
      const nextPlayerId = String(metadata.nextPlayerId || metadata.payerId || '').trim() as PlayerID;
      const candidatePlayerIds = Array.isArray(metadata.candidatePlayerIds)
        ? (metadata.candidatePlayerIds as string[]).map((id) => String(id || '').trim()).filter(Boolean)
        : [];
      const payerId = (nextPlayerId || candidatePlayerIds[0] || params.controller) as PlayerID;
      if (!payerId) continue;

      queuedKeys.add(queueKey);
      const declinedPlayerIds = Array.isArray(metadata.declinedPlayerIds)
        ? (metadata.declinedPlayerIds as string[])
        : [];

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: payerId,
        description: `${sourceName}: Any player may ${paymentLabel}. If a player does, counter this spell.`,
        mandatory: false,
        sourceId,
        sourceName,
        options: [
          { id: 'pay', label: paymentLabel[0].toUpperCase() + paymentLabel.slice(1), description: paymentLabel },
          { id: 'decline', label: 'Decline', description: 'Decline' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        optionalPaymentValidationKind:
          payment?.kind === 'life' || payment?.kind === 'half_life_rounded_up'
            ? 'life'
            : payment?.kind === 'discard'
              ? 'discard'
              : payment?.kind === 'sacrifice'
                ? 'sacrifice'
                : 'life',
        optionalPaymentLifeAmount:
          payment?.kind === 'life'
            ? payment.amount
            : undefined,
        optionalPaymentPayChoiceId: 'pay',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrAnyPlayerMayChoice: true,
        oracleIrAnyPlayerMayPaymentJson: JSON.stringify(payment || {}),
        oracleIrAnyPlayerMayStepsJson: JSON.stringify([(skippedStep as any)]),
        oracleIrAnyPlayerMayCandidateIds: candidatePlayerIds,
        oracleIrAnyPlayerMayDeclinedIds: declinedPlayerIds,
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        ...(params.irCtx?.targetSpellId || triggerItem?.triggeringStackItemId
          ? {
              oracleIrTargetSpellId: String(
                params.irCtx?.targetSpellId || triggerItem?.triggeringStackItemId || '',
              ).trim(),
            }
          : {}),
      } as any, result, params) as any);
      continue;
    }

'''

if "stepKind === 'any_player_may'" not in text:
    if needle not in text:
        raise SystemExit('unless_pays_mana needle missing in zone sync')
    text = text.replace(needle, insert + needle, 1)
    print('queued any_player_may prompts')
else:
    print('any_player_may queue present')

# Sync next spell cost reduction after IR result
# Find syncCastingModifierGrantsFromOracleIRResult call site or applyOracleIRStepsOnServer end
if 'pendingNextSpellCostReduction' not in text and 'grantNextSpellCostReduction(' not in text[text.find('function applyOracleIRStepsOnServer'):text.find('function applyOracleIRStepsOnServer')+5000] if False else True:
    pass

# Add helper call after applied steps - look for syncCastingModifierGrantsFromOracleIRResult(
idx = text.find('syncCastingModifierGrantsFromOracleIRResult(')
print('syncCastingModifier at', idx)
if idx >= 0 and 'grantNextSpellCostReduction(' not in text:
    # find a good place: after that sync call's statement
    # Add a function and call it from applyOracleIRStepsOnServer
    helper = '''
function syncNextSpellCostReductionFromOracleIRResult(
  state: any,
  controllerId: PlayerID,
  result: OracleIRExecutionResult,
  irCtx?: OracleIRExecutionContext,
): void {
  const pending = (irCtx as any)?.pendingNextSpellCostReduction;
  if (pending && Number(pending.genericAmount) > 0) {
    grantNextSpellCostReduction(state, controllerId, Number(pending.genericAmount), String(pending.sourceName || ''));
    return;
  }
  for (const step of result.appliedSteps || []) {
    if ((step as any)?.kind !== 'grant_next_spell_cost_reduction') continue;
    const per = Boolean((step as any).perCountersRemoved);
    const countersRemoved = Number((irCtx as any)?.countersRemovedThisWay ?? 0);
    const mana = String((step as any).mana || '{1}');
    const perAmount = Number.parseInt(String((mana.match(/\\{(\\d+)\\}/) || [])[1] || '1'), 10);
    const amount = per
      ? Math.max(0, countersRemoved) * (Number.isFinite(perAmount) ? perAmount : 1)
      : Number((step as any).amount || perAmount || 0);
    if (amount > 0) {
      grantNextSpellCostReduction(state, controllerId, amount, String((irCtx as any)?.sourceName || ''));
    }
  }
}

'''
    # insert helper before queueUnlessPayChoicePromptsFromOracleIRResult
    qidx = text.find('function queueUnlessPayChoicePromptsFromOracleIRResult')
    text = text[:qidx] + helper + text[qidx:]

    # call it near syncCastingModifier
    call_needle = 'syncCastingModifierGrantsFromOracleIRResult('
    # find occurrences and add after each complete statement - do one in applyOracleIRStepsOnServer
    # Search for pattern with context
    import re
    matches = list(re.finditer(r'syncCastingModifierGrantsFromOracleIRResult\([^;]+;', text))
    print('sync call count', len(matches))
    if matches:
        # patch the first few by appending sync call after
        # Safer: find applyOracleIRStepsOnServer body and add near end before return
        aidx = text.find('function applyOracleIRStepsOnServer')
        # find syncCasting inside that function
        sub = text[aidx:aidx+12000]
        m = re.search(r'syncCastingModifierGrantsFromOracleIRResult\([^;]+;', sub)
        if m:
            abs_end = aidx + m.end()
            insert_call = '\n  syncNextSpellCostReductionFromOracleIRResult(state as any, params.controller, result, params.irCtx);\n'
            # only if not already there nearby
            if 'syncNextSpellCostReductionFromOracleIRResult' not in text[abs_end:abs_end+200]:
                text = text[:abs_end] + insert_call + text[abs_end:]
                print('added syncNextSpell call')
    print('helper inserted')

p.write_text(text, encoding='utf-8')
print('zone sync patched')
