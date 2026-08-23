from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts')
text = p.read_text(encoding='utf-8')

marker = '''  const targets = resolveRemoveCounterTargets((state.battlefield || []) as BattlefieldPermanent[], {
    ...step,
    target: effectiveStepTarget(step) || step.target,
  } as typeof step, ctx);'''

insert_before = '''  // Mutated Cultist-style: remove all counters from a targeted player (opponent).
  {
    const effectiveTargetEarly = effectiveStepTarget(step) || step.target;
    const targetTextEarly = effectiveTargetEarly?.kind === 'raw'
      ? String((effectiveTargetEarly as any).text || '').toLowerCase()
      : '';
    const targetPlayerId = String(
      ctx.targetPlayerId
        || (ctx.selectorContext as any)?.targetPlayerId
        || (ctx.selectorContext as any)?.targetOpponentId
        || '',
    ).trim();
    const wantsPlayer = /\\bopponent\\b/.test(targetTextEarly) || /\\bplayer\\b/.test(targetTextEarly);
    if (
      wantsPlayer
      && targetPlayerId
      && (step.amount.kind === 'all' || step.amount.kind === 'any_number')
      && (String(step.counter || '').toLowerCase() === 'any'
        || String(step.counter || '').toLowerCase() === 'all'
        || String(step.counter || '').toLowerCase() === 'counter')
    ) {
      const players = Array.isArray((state as any).players) ? [...(state as any).players] : [];
      const idx = players.findIndex((pl: any) => String(pl?.id || '').trim() === targetPlayerId);
      if (idx >= 0) {
        const player = players[idx] as any;
        const counters = { ...((player.counters || {}) as Record<string, number>) };
        let removedTotal = 0;
        for (const [key, value] of Object.entries(counters)) {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) {
            removedTotal += n;
            counters[key] = 0;
          }
        }
        // Also clear common top-level counter fields if present.
        const nextPlayer = { ...player, counters };
        for (const key of ['poisonCounters', 'energyCounters', 'experienceCounters', 'radCounters']) {
          const n = Number((player as any)[key] || 0);
          if (n > 0) {
            removedTotal += n;
            (nextPlayer as any)[key] = 0;
          }
        }
        players[idx] = nextPlayer;
        (ctx as any).countersRemovedThisWay = Number((ctx as any).countersRemovedThisWay || 0) + removedTotal;
        return {
          applied: true,
          state: { ...(state as any), players } as GameState,
          log: [`Removed ${removedTotal} counter(s) from player ${targetPlayerId}`],
        };
      }
    }
  }

'''

if 'Mutated Cultist-style: remove all counters from a targeted player' not in text:
    if marker not in text:
        raise SystemExit('targets marker missing')
    text = text.replace(marker, insert_before + marker, 1)
    p.write_text(text, encoding='utf-8')
    print('added player counter removal')
else:
    print('player counter removal present')
