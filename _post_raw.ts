  // Planeswalker helper: "You may discard a card. If you do, draw a card."
  const afterDiscardDrawCount = (step as any)?.afterDiscardDrawCount;
  let followupDrawCount = 0;
  if (afterDiscardDrawCount && typeof afterDiscardDrawCount === 'number' && afterDiscardDrawCount > 0) {
    if (typeof (game as any).drawCards === 'function') {
      (game as any).drawCards(pid, afterDiscardDrawCount);
    } else {
      // Fallback draw: use game.libraries if present; else zones library.
      const lib = (game as any).libraries?.get?.(pid) || zones.library || [];
      for (let i = 0; i < afterDiscardDrawCount && lib.length > 0; i++) {
        const drawn = lib.shift();
        zones.hand.push({ ...drawn, zone: 'hand' });
      }
      zones.handCount = zones.hand.length;
      zones.libraryCount = lib.length;
      if ((game as any).libraries?.set) {
        (game as any).libraries.set(pid, lib);
      }
    }
    followupDrawCount += afterDiscardDrawCount;

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} drew ${afterDiscardDrawCount} card(s).`,
      ts: Date.now(),
    });
  }

  // Planeswalker helper: discard, draw, and if a land was discarded, draw extra.
  const afterDiscardDrawCountIfDiscardedLand = (step as any)?.afterDiscardDrawCountIfDiscardedLand;
  if (
    afterDiscardDrawCountIfDiscardedLand &&
    typeof afterDiscardDrawCountIfDiscardedLand === 'number' &&
    afterDiscardDrawCountIfDiscardedLand > 0
  ) {
    const discardedALand = movedCards.some((c: any) => String(c?.type_line || '').toLowerCase().includes('land'));
    if (discardedALand) {
      if (typeof (game as any).drawCards === 'function') {
        (game as any).drawCards(pid, afterDiscardDrawCountIfDiscardedLand);
      } else {
        const lib = (game as any).libraries?.get?.(pid) || zones.library || [];
        for (let i = 0; i < afterDiscardDrawCountIfDiscardedLand && lib.length > 0; i++) {
          const drawn = lib.shift();
          zones.hand.push({ ...drawn, zone: 'hand' });
        }
        zones.handCount = zones.hand.length;
        zones.libraryCount = lib.length;
        if ((game as any).libraries?.set) {
          (game as any).libraries.set(pid, lib);
        }
      }
      followupDrawCount += afterDiscardDrawCountIfDiscardedLand;

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} drew ${afterDiscardDrawCountIfDiscardedLand} additional card(s).`,
        ts: Date.now(),
      });
    }
  }


  if ((step as any)?.reflexiveDiscardWhenYouDo === true && movedCards.length > 0) {
    const controllerId = String((step as any)?.reflexiveDiscardWhenYouDoController || pid);
    const sourceName = String((step as any)?.reflexiveDiscardWhenYouDoSourceName || step.sourceName || 'Ability');
    const sourcePermanentId = String((step as any)?.reflexiveDiscardWhenYouDoSourcePermanentId || step.sourceId || '').trim();
    const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, step as any, sourcePermanentId || undefined);
    const sourceContext = buildTriggeredAbilitySourceContext(sourcePermanentSnapshot);
    const followupText = String((step as any)?.reflexiveDiscardWhenYouDoFollowupDescription || '').trim();
    const effectText = materializeReflexiveSourceText(followupText, sourceName);
    const discardedCardIds = movedCards.map((card: any) => String(card?.id || '')).filter(Boolean);
    const discardedCards = movedCards.map((card: any) => ({
      id: String(card?.id || ''),
      name: card?.name,
      type_line: card?.type_line,
      oracle_text: card?.oracle_text,
      mana_cost: card?.mana_cost,
      cmc: card?.cmc,
    }));
    const triggerId = uid('trigger');
    const targetMetadata = inferFollowupTargetMetadata(
      game,
      controllerId,
      sourceName,
      sourcePermanentId || undefined,
      effectText,
      sourcePermanentSnapshot,
    );
    const effectData = {
      discardedCardIds,
      discardedCards,
      discardCount: discardedCardIds.length,
    };
    const stackItem: any = {
      id: triggerId,
      type: 'triggered_ability',
      controller: controllerId,
      source: sourcePermanentId || null,
      ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
      sourceName,
      description: effectText,
      effect: effectText,
      triggerType: 'reflexive_discard',
      mandatory: true,
      ...targetMetadata,
      ...sourceContext,
      effectData,
    };

    game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
    game.state.stack.push(stackItem);

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveDiscardResolve', {
        playerId: controllerId,
        sourceId: sourcePermanentId || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        cardIds: discardedCardIds,
        followupText,
        effect: effectText,
        triggerId,
        ...targetMetadata,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(reflexiveDiscardResolve) failed:', err);
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
        triggerId,
        sourceId: sourcePermanentId || null,
        ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
        sourceName,
        controllerId,
        description: effectText,
        effect: effectText,
        triggerType: 'reflexive_discard',
        mandatory: true,
        ...targetMetadata,
        ...sourceContext,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility reflexive discard) failed:', err);
    }
  }

  if (!isDiscardCostActivation && !isExileFromHandCostActivation && !isGraveyardCastDiscardActivation && !isCleanupDiscard && movedCards.length > 0) {
    queueDiscardTriggeredAbilities(game, gameId, String(pid), movedCards);
    queueDiscardTriggeredGraveyardCastAbilities(game, gameId, String(pid), movedCards);
  }

  if ((step as any)?.wardPayment === true) {
    const stepAny = step as any;
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'wardPaymentResolve', {
        playerId: pid,
        stepId: String(stepAny?.id || step.id || ''),
        sourceId: String(stepAny?.wardTriggeredBy || stepAny?.sourceId || step.sourceId || '').trim(),
        wardCost: String(stepAny?.wardCost || '').trim(),
        wardPermanentId: String(stepAny?.wardPermanentId || '').trim(),
        wardPermanentName: String(stepAny?.wardPermanentName || step.sourceName || 'Ward'),
        wardPaymentType: 'discard',
      });
    } catch {
      // ignore persistence failures for ward payment resolution
    }
  }

  // Cleanup-step integration: after the discard is applied, advance through the
  // normal cleanup/turn transition logic (clears damage, ends EOT effects, Sundial pause).
  if (String((step as any)?.oracleIrResumeStepsJson || '').trim()) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    maybeResumeOracleIRStepsAfterResolution(ctx, step);
  }

  maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);

  if (isCleanupDiscard) {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'cleanupDiscard', {
        playerId: pid,
        cardIds: movedCardsToGraveyard.map((card: any) => String(card?.id || '')).filter(Boolean),
        ...(exiledCardIdsFromHandForCost.length > 0 ? { exiledCardIds: exiledCardIdsFromHandForCost } : {}),
      });
      if (queuedMadnessSteps.length > 0) {
        appendQueuedResolutionPromptEvent(game, gameId, {
          playerId: String(pid),
          queuedResolutionSteps: queuedMadnessSteps.map((queuedStep: any) => ({ ...(queuedStep as any) })),
        });
      } else if (advanceStepPersistingEvent(io, game as any, gameId, {
        playerId: pid,
        reason: 'cleanupDiscardResolved',
      })) {
        // advanced
      }
    } catch (err) {
      debugWarn(1, `[Resolution] Failed to advance after cleanup discard:`, err);
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}
