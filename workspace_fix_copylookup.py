from pathlib import Path

# --- Bug 1b: harden this_spell stack lookup ---
path = Path(r"D:\Git\MTGEDH\server\src\state\modules\oracleIrServerCopySpellSync.ts")
text = path.read_text(encoding="utf-8")
old = """  if (step.subject === 'this_spell') {
    const triggeringStackItemId = resolveTriggeringStackItemId(triggerItem, irCtx);
    const sourceObjectType = String(irCtx.sourceObjectType || '').trim();
    const lookupId = sourceObjectType === 'ability' && triggeringStackItemId
      ? triggeringStackItemId
      : String(irCtx.sourceId || triggeringStackItemId || '').trim();
    if (!lookupId) return null;
    return getStackItems(state?.stack).find(
      (item: any) => String(item?.id || '').trim() === lookupId,
    ) || null;
  }
"""
new = """  if (step.subject === 'this_spell') {
    const triggeringStackItemId = resolveTriggeringStackItemId(triggerItem, irCtx);
    const sourceObjectType = String(irCtx.sourceObjectType || '').trim();
    const lookupId = sourceObjectType === 'ability' && triggeringStackItemId
      ? triggeringStackItemId
      : String(irCtx.sourceId || triggeringStackItemId || '').trim();
    const stackItems = getStackItems(state?.stack);
    if (lookupId) {
      const byId = stackItems.find(
        (item: any) => String(item?.id || '').trim() === lookupId,
      );
      if (byId) return byId;
    }

    // On-cast self triggers often set sourceId to the card id (not stack id).
    // Fall back to the matching cast spell still on the stack.
    const sourceCardId = String(
      triggerItem?.card?.id
      || irCtx.sourceId
      || triggerItem?.source
      || '',
    ).trim();
    const sourceName = String(
      irCtx.sourceName
      || triggerItem?.sourceName
      || triggerItem?.card?.name
      || '',
    ).trim().toLowerCase();
    const controller = String(irCtx.controllerId || triggerItem?.controller || '').trim();
    const byCard = stackItems.find((item: any) => {
      if (String(item?.type || '').trim() === 'triggered_ability') return false;
      if (controller && String(item?.controller || '').trim() !== controller) return false;
      const itemCardId = String(item?.card?.id || '').trim();
      if (sourceCardId && itemCardId && itemCardId === sourceCardId) return true;
      if (sourceName) {
        const itemName = String(item?.card?.name || item?.name || '').trim().toLowerCase();
        if (itemName && itemName === sourceName) return true;
      }
      return false;
    });
    return byCard || null;
  }
"""
if old not in text:
    raise SystemExit('resolveDeferredCopyTargetStackItem this_spell block not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('patched oracleIrServerCopySpellSync.ts this_spell lookup')
