from pathlib import Path

# --- Bug 1a: game-actions on-cast attach triggeringStackItemId ---
ga = Path(r"D:\Git\MTGEDH\server\src\socket\game-actions.ts")
text = ga.read_text(encoding="utf-8")
old = """      // Check for \"When you cast this spell\" triggers on the spell itself (Kozilek, Ulamog, etc.)
      try {
        const onCastTriggers = resolveOnCastSpellTriggerDescriptions(cardInHand);
        for (const onCastTrigger of onCastTriggers) {
"""
new = """      // Check for \"When you cast this spell\" triggers on the spell itself (Kozilek, Ulamog, etc.)
      try {
        // Capture the cast spell's stack id BEFORE pushing on-cast triggers on top of it.
        // Deferred this_spell copies (Storm suite / Hatut) need triggeringStackItemId to find the original.
        const onCastStackArr: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
        let onCastTriggeringStackItemId = '';
        for (let i = onCastStackArr.length - 1; i >= 0; i -= 1) {
          const item = onCastStackArr[i];
          if (!item) continue;
          if (String(item.type || '').trim() === 'triggered_ability') continue;
          if (String(item.controller || '') !== String(playerId)) continue;
          const itemCardId = String(item?.card?.id || '').trim();
          if (itemCardId && itemCardId === String(cardId || '').trim()) {
            onCastTriggeringStackItemId = String(item.id || '').trim();
            break;
          }
        }
        if (!onCastTriggeringStackItemId) {
          for (let i = onCastStackArr.length - 1; i >= 0; i -= 1) {
            const item = onCastStackArr[i];
            if (!item) continue;
            if (String(item.type || '').trim() === 'triggered_ability') continue;
            if (String(item.controller || '') !== String(playerId)) continue;
            if (String(item.type || '').trim() === 'spell' || item.card) {
              onCastTriggeringStackItemId = String(item.id || '').trim();
              break;
            }
          }
        }

        const onCastTriggers = resolveOnCastSpellTriggerDescriptions(cardInHand);
        for (const onCastTrigger of onCastTriggers) {
"""
if old not in text:
    raise SystemExit('game-actions on-cast block start not found')
text = text.replace(old, new, 1)

old2 = """          const triggerPayload: any = {
            id: triggerId,
            type: 'triggered_ability',
            controller: playerId,
            source: cardId,
            sourceName: cardInHand.name,
            description,
            triggerType: 'triggered_ability',
            effect: onCastTrigger.effect,
            mandatory: !isOptionalMay,
            card: {
              ...cardInHand,
              owner: cardInHand.owner || playerId,
            },
"""
new2 = """          const triggerPayload: any = {
            id: triggerId,
            type: 'triggered_ability',
            controller: playerId,
            source: cardId,
            sourceName: cardInHand.name,
            description,
            triggerType: 'triggered_ability',
            effect: onCastTrigger.effect,
            mandatory: !isOptionalMay,
            ...(onCastTriggeringStackItemId
              ? {
                  triggeringStackItemId: onCastTriggeringStackItemId,
                  effectData: { triggeringStackItemId: onCastTriggeringStackItemId },
                }
              : null),
            card: {
              ...cardInHand,
              owner: cardInHand.owner || playerId,
            },
"""
if old2 not in text:
    raise SystemExit('game-actions triggerPayload block not found')
text = text.replace(old2, new2, 1)
ga.write_text(text, encoding='utf-8')
print('patched game-actions.ts on-cast triggeringStackItemId')
