  if ((step as any)?.graveyardCastDiscardAsCost === true) {
    try {
      const stepAny = step as any;
      const controllerId = String(pid);
      const cardId = String(stepAny?.cardId || step.sourceId || '').trim();
      const abilityId = String(stepAny?.abilityId || '').trim();

      const playerZones = (game.state as any)?.zones?.[controllerId];
      const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
      const cardIndex = graveyard.findIndex((entry: any) => entry && String(entry.id) === cardId);
      if (cardIndex === -1) {
        emitToPlayer(io, controllerId, 'error', { code: 'CARD_NOT_IN_GRAVEYARD', message: 'Card not found in graveyard' });
        return;
      }

      const result = continueCastFromGraveyardAbility({
        gameId,
        game,
        io,
        playerId: controllerId,
        cardId,
        abilityId,
        discardedCardIds: discardedCardIdsForCost,
        exiledCardIdsFromHandForCost: exiledCardIdsFromHandForCost,
        targets: Array.isArray(stepAny?.targetsForCast) ? stepAny.targetsForCast : undefined,
        xValue: Number.isFinite(Number(stepAny?.xValue)) ? Math.max(0, Math.floor(Number(stepAny.xValue))) : undefined,
        emitError: (payload) => emitToPlayer(io, controllerId as any, 'error', payload),
      });

      if (result !== 'error') {
        persistQueuedMadnessPromptsForCost();
        broadcastGame(io, game, gameId);
      }
      return;
    } catch (err) {
      debugError(1, '[Resolution] Failed to resume graveyard discard-cost cast', err);
    }
  }

  // Activated-ability discard-cost flow: resume the activation after the discard is applied.
  if ((step as any)?.discardAbilityAsCost === true) {
    // Combined cost flow: discard first, then sacrifice, then resume activation.
    if ((step as any)?.discardAndSacrificeAbilityAsCost === true) {
      const stepAny = step as any;
      const controllerId = String(pid);
      const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
      const abilityId = String(stepAny?.abilityId || '').trim();
      const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
      const abilityText = String(stepAny?.abilityText || step.description || '');
      const manaCost = String(stepAny?.manaCost || '');
      const requiresTap = Boolean(stepAny?.requiresTap);

      const sacrificeType = String(stepAny?.sacrificeType || '').trim();
      const sacrificeSubtype = stepAny?.sacrificeSubtype ? String(stepAny?.sacrificeSubtype) : undefined;
      const sacrificeCount = Number(stepAny?.sacrificeCount || 1);
      const mustBeOther = Boolean(stepAny?.mustBeOther);

      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const sourcePerm = battlefield.find((p: any) => p && String(p.id) === String(permanentId));
      if (!sourcePerm) {
        emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
        return;
      }
      if (String(sourcePerm.controller || '') !== controllerId) {
        emitToPlayer(io, controllerId, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
        return;
      }
      if (requiresTap && (sourcePerm as any).tapped) {
        emitToPlayer(io, controllerId, 'error', { code: 'ALREADY_TAPPED', message: `${cardName} is already tapped` });
        return;
      }

      const matchesSacrificeRequirement = (perm: any): boolean => {
        if (!perm) return false;
        if (String(perm.controller || '') !== controllerId) return false;
        if (mustBeOther && String(perm.id) === String(permanentId)) return false;
        const tl = String(perm.card?.type_line || '').toLowerCase();

        let okType = false;
        switch (sacrificeType) {
          case 'creature':
            okType = tl.includes('creature');
            break;
          case 'artifact':
            okType = tl.includes('artifact');
            break;
          case 'enchantment':
            okType = tl.includes('enchantment');
            break;
          case 'land':
            okType = tl.includes('land');
            break;
          case 'artifact_or_creature':
            okType = tl.includes('artifact') || tl.includes('creature');
            break;
          case 'permanent':
            okType = true;
            break;
          default:
            okType = false;
        }
        if (!okType) return false;
        if (sacrificeSubtype) {
          const sub = String(sacrificeSubtype).toLowerCase();
          return tl.includes(sub);
        }
        return true;
      };

      const eligiblePermanents = battlefield.filter(matchesSacrificeRequirement);
      if (eligiblePermanents.length < sacrificeCount) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'INSUFFICIENT_SACRIFICE_TARGETS',
          message: `You don't control enough permanents to sacrifice. (Need ${sacrificeCount}, have ${eligiblePermanents.length})`,
        });
        return;
      }

      const sacrificeTargets = eligiblePermanents.map((p: any) => ({
        id: p.id,
        label: p.card?.name || 'Unknown',
        name: p.card?.name || 'Unknown',
        description: p.card?.type_line || 'Permanent',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        typeLine: p.card?.type_line || '',
        tapped: p?.tapped === true,
        isToken: p?.isToken === true || p?.card?.isToken === true,
        isCommander: p?.isCommander === true || p?.card?.isCommander === true,
        controller: p?.controller,
      }));

      const existingSacrificeStep = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find(
          (s: any) =>
            s?.type === ResolutionStepType.TARGET_SELECTION &&
            (s as any)?.sacrificeAbilityAsCost === true &&
            (s as any)?.discardAndSacrificeAbilityAsCost === true &&
            String((s as any)?.permanentId || s?.sourceId) === String(permanentId)
        );

      if (!existingSacrificeStep) {
        const lifeToPayForCost = Number(stepAny?.lifeToPayForCost || 0);

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as any,
          sourceId: permanentId,
          sourceName: cardName,
          description: `${cardName}: Sacrifice ${sacrificeCount} permanent${sacrificeCount === 1 ? '' : 's'} to activate: ${abilityText}`,
          mandatory: false,
          validTargets: sacrificeTargets,
          targetTypes: ['sacrifice_cost'],
          minTargets: sacrificeCount,
          maxTargets: sacrificeCount,
          targetDescription: `permanents you control`,

          // Custom payload consumed by handleTargetSelectionResponse
          sacrificeAbilityAsCost: true,
          discardAndSacrificeAbilityAsCost: true,
          permanentId,
          abilityId,
          cardName,
          abilityText,
          manaCost,
          requiresTap,
          sacrificeType,
          sacrificeSubtype,
          sacrificeCount,
          mustBeOther,

          // Optional deferred life payment (validated at activation time; paid after final step)
          lifeToPayForCost: Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0 ? lifeToPayForCost : undefined,

          // Carry deterministic evidence from the discard step.
          discardedCardIdsForCost: discardedCardIdsForCost.length > 0 ? discardedCardIdsForCost : undefined,
          exiledCardIdsFromHandForCost: exiledCardIdsFromHandForCost.length > 0 ? exiledCardIdsFromHandForCost : undefined,
          queuedMadnessStepsForCost: queuedMadnessSteps.length > 0
            ? queuedMadnessSteps.map((queuedStep: any) => ({ ...(queuedStep as any) }))
            : undefined,
        } as any);
      }

      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    try {
      const stepAny = step as any;
      const controllerId = String(pid);
      const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
      const abilityId = String(stepAny?.abilityId || '').trim();
      const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
      const abilityText = String(stepAny?.abilityText || step.description || '');
      const manaCost = String(stepAny?.manaCost || '');
      const requiresTap = Boolean(stepAny?.requiresTap);

      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const sourcePerm = battlefield.find((p: any) => p && String(p.id) === String(permanentId));
      if (!sourcePerm) {
        emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
        return;
      }
      if (String(sourcePerm.controller || '') !== controllerId) {
        emitToPlayer(io, controllerId, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
        return;
      }
      if (requiresTap && (sourcePerm as any).tapped) {
        emitToPlayer(io, controllerId, 'error', { code: 'ALREADY_TAPPED', message: `${cardName} is already tapped` });
        return;
      }

      // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus the discard clause.
      const remainingNonManaCostText = manaCost
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
        .replace(
          /\bdiscard\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\b/gi,
          ' '
        )
        .replace(/[\s,]+/g, ' ')
        .trim();
      if (remainingNonManaCostText.length > 0) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'UNSUPPORTED_COST',
          message: `Unsupported activation cost (${remainingNonManaCostText}).`,
        });
        return;
      }

      // Pay mana portion of the activation cost (conservative: no Phyrexian and no X).
      const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
      const manaOnly = manaSymbols
        .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
        .join('');
      if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
        emitToPlayer(io, controllerId, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${manaOnly || 'complex cost'})` });
        return;
      }

      if (manaOnly) {
        const { payAbilityManaCostFromPool } = await import('./util.js');
        const paid = payAbilityManaCostFromPool(game.state, controllerId, manaOnly, sourcePerm, '[discardAbilityAsCost]');
        if (!paid.ok) {
          emitToPlayer(io, controllerId, 'error', { code: 'INSUFFICIENT_MANA', message: (paid as any).error || 'Insufficient mana.' });
          return;
        }
      }

      // Optional deferred life payment (validated at activation time; applied now so cancel doesn't charge life)
      const lifeToPayForCost = Number(stepAny?.lifeToPayForCost || 0);
      if (lifeToPayForCost > 0) {
        const currentLife = Number((game.state as any)?.life?.[controllerId] ?? 40);
        if (!Number.isFinite(currentLife) || currentLife < lifeToPayForCost) {
          emitToPlayer(io, controllerId, 'error', {
            code: 'INSUFFICIENT_LIFE',
            message: `Need to pay ${lifeToPayForCost} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
          });
          return;
        }
        (game.state as any).life[controllerId] = currentLife - lifeToPayForCost;
      }

      const tappedPermanentsForCost: string[] = [];
      if (requiresTap && !(sourcePerm as any).tapped) {
        (sourcePerm as any).tapped = true;
        tappedPermanentsForCost.push(String(permanentId));
      }

      const targetReqs = parseTargetRequirements(abilityText, {
        gameState: game.state,
        controllerId: String(controllerId),
        sourceName: cardName,
        sourcePermanent: sourcePerm,
      });
      if (targetReqs.needsTargets) {
        const validTargets = buildActivatedAbilityValidTargets(game, controllerId, targetReqs);
        const minTargets = Number(targetReqs.minTargets ?? 1);
        const maxTargets = Number(targetReqs.maxTargets ?? minTargets);
        if (validTargets.length < minTargets) {
          emitToPlayer(io, controllerId, 'error', {
            code: 'NO_VALID_TARGETS',
            message: `${cardName}'s ability requires at least ${minTargets} target(s), but only ${validTargets.length} are available.`,
          });
          return;
        }

        const useGraveyardSelection = Array.isArray(targetReqs.targetTypes)
          && targetReqs.targetTypes.length > 0
          && targetReqs.targetTypes.every((targetType) => String(targetType || '').toLowerCase().startsWith('graveyard_'))
          && typeof targetReqs.targetTotalPowerLimit === 'number'
          && Number.isFinite(targetReqs.targetTotalPowerLimit)
          && targetReqs.targetTotalPowerLimit > 0;
        const graveyardSelectionTargetPlayerId = useGraveyardSelection
          ? (() => {
              const ownerIds = Array.from(new Set(validTargets.map((target: any) => String(target?.zoneOwnerId || target?.controller || '')).filter(Boolean)));
              return ownerIds.length === 1 ? ownerIds[0] : undefined;
            })()
          : undefined;
        const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, (useGraveyardSelection
          ? {
              type: ResolutionStepType.GRAVEYARD_SELECTION,
              playerId: controllerId as any,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: (sourcePerm as any)?.card?.image_uris?.small || (sourcePerm as any)?.card?.image_uris?.normal,
              title: cardName,
              description: `Choose ${targetReqs.targetDescription || 'target'} for ${cardName}`,
              mandatory: minTargets > 0,
              validTargets,
              targetTypes: targetReqs.targetTypes,
              minTargets,
              maxTargets,
              targetDescription: targetReqs.targetDescription || 'target',
              targetPlayerId: graveyardSelectionTargetPlayerId,
              destination: 'battlefield',
              totalPowerLimit: Number(targetReqs.targetTotalPowerLimit),
              battlefieldAbilityTargetSelection: true,
              permanentId,
              abilityId,
              cardName,
              abilityText,
              activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
              tappedPermanentsForCost,
              discardedCardIdsForCost: discardedCardIdsForCost.length > 0 ? discardedCardIdsForCost : undefined,
              exiledCardIdsFromHandForCost: exiledCardIdsFromHandForCost.length > 0 ? exiledCardIdsFromHandForCost : undefined,
              lifePaidForCost: lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
            }
          : {
              type: ResolutionStepType.TARGET_SELECTION,
              playerId: controllerId as any,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: (sourcePerm as any)?.card?.image_uris?.small || (sourcePerm as any)?.card?.image_uris?.normal,
              description: abilityText,
              mandatory: minTargets > 0,
              validTargets,
              targetTypes: targetReqs.targetTypes,
              minTargets,
              maxTargets,
              targetDescription: targetReqs.targetDescription || 'target',
              battlefieldAbilityTargetSelection: true,
              permanentId,
              abilityId,
              cardName,
              abilityText,
              activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
              tappedPermanentsForCost,
              discardedCardIdsForCost: discardedCardIdsForCost.length > 0 ? discardedCardIdsForCost : undefined,
              exiledCardIdsFromHandForCost: exiledCardIdsFromHandForCost.length > 0 ? exiledCardIdsFromHandForCost : undefined,
              lifePaidForCost: lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
            }) as any);

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
            playerId: controllerId,
            permanentId,
            abilityId: abilityId || undefined,
            cardName,
            abilityText,
            activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
            tappedPermanents: tappedPermanentsForCost.length > 0 ? tappedPermanentsForCost : undefined,
            discardedCardIds: discardedCardIdsForCost.length > 0 ? discardedCardIdsForCost : undefined,
            exiledCardIdsFromHandForCost: exiledCardIdsFromHandForCost.length > 0 ? exiledCardIdsFromHandForCost : undefined,
            lifePaidForCost: lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
            queuedResolutionStep,
          });
        } catch {
          // ignore persistence failures
        }

        persistQueuedMadnessPromptsForCost();

        if (typeof game.bumpSeq === 'function') game.bumpSeq();
        broadcastGame(io, game, gameId);
        return;
      }

      // Put the ability on the stack.
      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: controllerId,
        source: permanentId,
        sourceName: cardName,
        description: abilityText,
      } as any;

      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      fireBattlefieldAbilityActivatedTriggers(game, controllerId, permanentId, abilityText, gameId, stackItem.id, () => {
        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
            ...battlefieldAbilityStackReplayEvidence(stackItem.id),
            playerId: controllerId,
            permanentId,
            abilityId: abilityId || undefined,
            cardName,
            abilityText,
            activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || undefined,
            tappedPermanents: tappedPermanentsForCost,
            discardedCardIds: discardedCardIdsForCost.length > 0 ? discardedCardIdsForCost : undefined,
            exiledCardIdsFromHandForCost: exiledCardIdsFromHandForCost.length > 0 ? exiledCardIdsFromHandForCost : undefined,
            lifePaidForCost: lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
          });
        } catch {
          // ignore persistence failures
        }
      });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚡ ${getPlayerName(game, controllerId)} activated ${cardName}'s ability: ${abilityText}`,
        ts: Date.now(),
      });

      if (typeof game.bumpSeq === 'function') game.bumpSeq();

      persistQueuedMadnessPromptsForCost();
    } catch (err) {
      debugError(1, '[Resolution] Failed to resume discard-cost activation', err);
    }
  }

  // Activated-ability exile-from-hand-cost flow: resume the activation after the exile is applied.
  if ((step as any)?.exileFromHandAbilityAsCost === true) {
    try {
      const stepAny = step as any;
      const controllerId = String(pid);
      const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
      const abilityId = String(stepAny?.abilityId || '').trim();
      const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
      const abilityText = String(stepAny?.abilityText || step.description || '');
      const manaCost = String(stepAny?.manaCost || '');
      const requiresTap = Boolean(stepAny?.requiresTap);
      const activatedAbilityText = String(stepAny?.activatedAbilityText || '').trim();

      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const sourcePerm = battlefield.find((p: any) => p && String(p.id) === String(permanentId));
      if (!sourcePerm) {
        emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
        return;
      }
      if (String(sourcePerm.controller || '') !== controllerId) {
        emitToPlayer(io, controllerId, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
        return;
      }
      if (requiresTap && (sourcePerm as any).tapped) {
        emitToPlayer(io, controllerId, 'error', { code: 'ALREADY_TAPPED', message: `${cardName} is already tapped` });
        return;
      }

      // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus the exile-from-hand clause.
      const remainingNonManaCostText = manaCost
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
        .replace(/\bexile\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\s+from\s+your\s+hand\b/gi, ' ')
        .replace(/[\s,]+/g, ' ')
        .trim();
      if (remainingNonManaCostText.length > 0) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'UNSUPPORTED_COST',
          message: `Unsupported activation cost (${remainingNonManaCostText}).`,
        });
        return;
      }

      // Pay mana portion of the activation cost (conservative: no Phyrexian and no X).
      const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
      const manaOnly = manaSymbols
        .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
        .join('');
      if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
        emitToPlayer(io, controllerId, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${manaOnly || 'complex cost'})` });
        return;
      }

      if (manaOnly) {
        const { payAbilityManaCostFromPool } = await import('./util.js');
        const paid = payAbilityManaCostFromPool(game.state, controllerId, manaOnly, sourcePerm, '[exileFromHandAbilityAsCost]');
        if (!paid.ok) {
          emitToPlayer(io, controllerId, 'error', { code: 'INSUFFICIENT_MANA', message: (paid as any).error || 'Insufficient mana.' });
          return;
        }
      }

      // Optional deferred life payment (validated at activation time; applied now so cancel doesn't charge life)
      const lifeToPayForCost = Number(stepAny?.lifeToPayForCost || 0);
      if (lifeToPayForCost > 0) {
        const currentLife = Number((game.state as any)?.life?.[controllerId] ?? 40);
        if (!Number.isFinite(currentLife) || currentLife < lifeToPayForCost) {
          emitToPlayer(io, controllerId, 'error', {
            code: 'INSUFFICIENT_LIFE',
            message: `Need to pay ${lifeToPayForCost} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
          });
          return;
        }
        (game.state as any).life[controllerId] = currentLife - lifeToPayForCost;
      }

      const tappedPermanentsForCost: string[] = [];
      if (requiresTap && !(sourcePerm as any).tapped) {
        (sourcePerm as any).tapped = true;
        tappedPermanentsForCost.push(String(permanentId));
      }

      // Put the ability on the stack.
      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: controllerId,
        source: permanentId,
        sourceName: cardName,
        description: abilityText,
      } as any;

      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      fireBattlefieldAbilityActivatedTriggers(game, controllerId, permanentId, abilityText, gameId, stackItem.id, () => {
        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
            ...battlefieldAbilityStackReplayEvidence(stackItem.id),
            playerId: controllerId,
            permanentId,
            abilityId: abilityId || undefined,
            cardName,
            abilityText,
            tappedPermanents: tappedPermanentsForCost,
            exiledCardIdsFromHandForCost: selections,
            activatedAbilityText: activatedAbilityText || undefined,
            lifePaidForCost: lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
          });
        } catch {
          // ignore persistence failures
        }
      });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚡ ${getPlayerName(game, controllerId)} activated ${cardName}'s ability: ${abilityText}`,
        ts: Date.now(),
      });

      if (typeof game.bumpSeq === 'function') game.bumpSeq();
    } catch (err) {
      debugError(1, '[Resolution] Failed to resume exile-from-hand-cost activation', err);
    }
  }
