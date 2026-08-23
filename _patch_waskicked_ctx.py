from pathlib import Path

# Pass wasKicked in buildTriggerIrContext
p = Path(r'D:/Git/MTGEDH/server/src/state/modules/oracleIrTriggerExecution.ts')
text = p.read_text(encoding='utf-8')
old = """  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: binding.sourcePermanentId || binding.sourceId,
      sourceName: params.sourceName,
      sourceObjectType: 'ability',
      xValue: binding.xValue,"""
new = """  const wasKicked = (params.triggerItem as any)?.wasKicked === true
    || (params.triggerItem as any)?.card?.wasKicked === true
    || (params.triggerItem as any)?.stackItem?.wasKicked === true
    || (params.triggerItem as any)?.sourceItem?.wasKicked === true;
  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: binding.sourcePermanentId || binding.sourceId,
      sourceName: params.sourceName,
      sourceObjectType: 'ability',
      xValue: binding.xValue,
      ...(wasKicked ? { wasKicked: true } : {}),"""
if old not in text:
    raise SystemExit('trigger irCtx missing')
text = text.replace(old, new, 1)
# also put on selectorContext
old2 = """      selectorContext: {
        ...(binding.chosenObjectIds ? { chosenObjectIds: binding.chosenObjectIds } : {}),
        ...(binding.targetPlayerId ? { targetPlayerId: binding.targetPlayerId } : {}),
        ...(defendingOpponentId ? { targetOpponentId: defendingOpponentId } : {}),
        ...(binding.targetSpellId ? { targetSpellId: binding.targetSpellId } : {}),
        ...(chosenCreatureType ? { chosenCreatureType } : {}),
        ...(createdTokenIds.length > 0 ? { lastAntecedentBattlefieldPermanentIds: createdTokenIds } : {}),
        ...(attachedToId ? { attachedToId } : {}),
      },"""
new2 = """      selectorContext: {
        ...(binding.chosenObjectIds ? { chosenObjectIds: binding.chosenObjectIds } : {}),
        ...(binding.targetPlayerId ? { targetPlayerId: binding.targetPlayerId } : {}),
        ...(defendingOpponentId ? { targetOpponentId: defendingOpponentId } : {}),
        ...(binding.targetSpellId ? { targetSpellId: binding.targetSpellId } : {}),
        ...(chosenCreatureType ? { chosenCreatureType } : {}),
        ...(createdTokenIds.length > 0 ? { lastAntecedentBattlefieldPermanentIds: createdTokenIds } : {}),
        ...(attachedToId ? { attachedToId } : {}),
        ...(wasKicked ? { wasKicked: true } : {}),
      },"""
if old2 not in text:
    raise SystemExit('selectorContext missing')
text = text.replace(old2, new2, 1)
p.write_text(text, encoding='utf-8')
print('trigger wasKicked ok')

# Also stamp wasKicked on spell IR path from sourceItem
p = Path(r'D:/Git/MTGEDH/server/src/state/modules/oracleIrSpellExecution.ts')
text = p.read_text(encoding='utf-8')
old = """      ...(typeof params.teamworkWasPaid === 'boolean' ? { teamworkWasPaid: params.teamworkWasPaid } : {}),
      ...(params.castFromGraveyard ? { castFromZone: 'graveyard' } : {}),"""
new = """      ...(typeof params.teamworkWasPaid === 'boolean' ? { teamworkWasPaid: params.teamworkWasPaid } : {}),
      ...((params.sourceItem as any)?.wasKicked === true || (params.card as any)?.wasKicked === true || (params.effectiveCard as any)?.wasKicked === true
        ? { wasKicked: true }
        : {}),
      ...(params.castFromGraveyard ? { castFromZone: 'graveyard' } : {}),"""
if old not in text:
    raise SystemExit('spell teamwork missing')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
print('spell wasKicked ok')
