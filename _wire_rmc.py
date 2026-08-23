from pathlib import Path

# Patch applyRemoveCounterStep to track counters removed and handle counter:'any'
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts')
text = p.read_text(encoding='utf-8')

# Find where single-target removal happens and enhance 'any' / 'counter' all-kinds
# Look for removeAllCounters usage with counterName
marker = "  if (counterName.toLowerCase() === 'counter' && battlefieldTarget && !allowMultipleDeterministicTargets) {"
if "counterName.toLowerCase() === 'any'" not in text:
    insert = '''  if ((counterName.toLowerCase() === 'any' || counterName.toLowerCase() === 'all') && battlefieldTarget) {
    const counters = { ...(((battlefieldTarget as any).counters || {}) as Record<string, number>) };
    let removedTotal = 0;
    for (const [key, value] of Object.entries(counters)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) {
        removedTotal += n;
        counters[key] = 0;
      }
    }
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const idx = battlefield.findIndex((p) => String((p as any)?.id || '').trim() === String((battlefieldTarget as any).id || '').trim());
    if (idx >= 0) {
      battlefield[idx] = { ...(battlefield[idx] as any), counters } as BattlefieldPermanent;
      (ctx as any).countersRemovedThisWay = Number((ctx as any).countersRemovedThisWay || 0) + removedTotal;
      return {
        applied: true,
        state: { ...(state as any), battlefield } as GameState,
        log: [`Removed ${removedTotal} counter(s) from ${String((battlefieldTarget as any).id || 'permanent')}`],
      };
    }
  }

'''
    if marker not in text:
        raise SystemExit('counter name normalize marker missing')
    text = text.replace(marker, insert + marker, 1)
    p.write_text(text, encoding='utf-8')
    print('enhanced remove all/any counters')
else:
    print('any-counter removal already present')

# Also set countersRemovedThisWay on normal single-counter removal path
# Find "Removed" log for single target - lighter touch: patch after successful removal
# Search for removedCount assignment usage
if "(ctx as any).countersRemovedThisWay" not in text or text.count("countersRemovedThisWay") < 2:
    # add after removedCount is computed in the single-target branch
    needle = "    const removedCount = removeAllCounters ? normalizedCount : amountValue || 0;"
    if needle in text and 'countersRemovedThisWay = Number' not in text[text.find(needle):text.find(needle)+800]:
        text = text.replace(
            needle,
            needle + "\n    (ctx as any).countersRemovedThisWay = Number((ctx as any).countersRemovedThisWay || 0) + Math.max(0, removedCount);",
            1,
        )
        p.write_text(text, encoding='utf-8')
        print('added countersRemovedThisWay tracking on normal path')
    else:
        print('tracking needle missing or already patched', needle in text)
else:
    print('countersRemovedThisWay already tracked')

print('battlefield remove_counter patch done')
