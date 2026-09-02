// Origin parent: client/src/App.tsx
// Cluster moved: split-card / zone / join-forces handlers plus combat memos.
// Public entry symbols: useAppPlayCombatHandlers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import type { BattlefieldPermanent, CardFace, KnownCardRef } from "../../../shared/src";
import type { CardFaceOption } from "../components/SplitCardChoiceModal";
import { socket } from "../socket";
import { canCreatureBlockNow, isCurrentlyCreature } from "../utils/creatureUtils";
import { expandGroupedTokensForDisplay, tokenDisplayInstanceCount } from "../utils/expandGroupedTokens";
import { debugError } from "../utils/debug";
import { playerIsLegalAttackTarget } from "../../../rules-engine/src/playerInGameStatus";
import { collectAttackYouTaxPreviewForDefender } from "../utils/combatAttackTax";

export function useAppPlayCombatHandlers(p: Record<string, any>) {
  const {
    canCreatureAttack,
    joinForcesRequest,
    kynaiosChoiceRequest,
    layout,
    optionChoiceRequest,
    playLandWithPromptSync,
    requestCastSpellWithPromptSync,
    safeView,
    setCastSpellModalOpen,
    setExileModalOpen,
    setExileModalPlayerId,
    setGraveyardModalOpen,
    setGraveyardModalPlayerId,
    setJoinForcesModalOpen,
    setJoinForcesRequest,
    setKynaiosChoiceModalOpen,
    setKynaiosChoiceRequest,
    setOptionChoiceModalOpen,
    setOptionChoiceRequest,
    setSpellToCast,
    setSplitCardData,
    setSplitCardModalOpen,
    setTemptingOfferModalOpen,
    setTemptingOfferRequest,
    splitCardData,
    temptingOfferRequest,
    you,
  } = p;
  const openSplitCardChoice = React.useCallback((
    cardId: string,
    card: KnownCardRef,
    sourceZone: 'hand' | 'graveyard' | 'exile' | 'library' | 'command' = 'hand',
  ) => {
    const layout = String((card as any).layout || '');
    const cardFaces = (card as any).card_faces as CardFace[] | undefined;
    if (!cardFaces || cardFaces.length < 2) {
      return;
    }

    const oracleText = String((card as any).oracle_text || '').toLowerCase();
    const canFuse = sourceZone === 'hand' && layout === 'split' && oracleText.includes('fuse');
    const faces: CardFaceOption[] = cardFaces.map((face, idx) => ({
      id: `face_${idx}`,
      name: (face as any).name || `Face ${idx + 1}`,
      manaCost: (face as any).mana_cost ?? (face as any).manaCost,
      typeLine: (face as any).type_line ?? (face as any).typeLine,
      oracleText: (face as any).oracle_text ?? (face as any).oracleText,
      imageUrl: (face as any).image_uris?.small || (face as any).image_uris?.normal || (face as any).imageUrl,
      isDefault: layout === 'adventure' && idx === 0,
    }));

    setSplitCardData({
      cardId,
      cardName: card.name || 'Card',
      layout,
      faces,
      canFuse,
      sourceZone,
    });
    setSplitCardModalOpen(true);
  }, []);

  const handleUseTopOfLibrary = React.useCallback(() => {
    if (!safeView || !you) return;

    const libraryTop = safeView.zones?.[you]?.libraryTop as KnownCardRef | undefined;
    if (!libraryTop || !libraryTop.id) return;

    const layout = String((libraryTop as any).layout || '');
    const cardFaces = (libraryTop as any).card_faces as CardFace[] | undefined;
    const hasFaces = Array.isArray(cardFaces) && cardFaces.length >= 2;
    const needsFaceChoice = hasFaces && (
      layout === 'split'
      || layout === 'adventure'
      || layout === 'modal_dfc'
    );

    if (needsFaceChoice) {
      openSplitCardChoice(libraryTop.id, libraryTop, 'library');
      return;
    }

    const typeLine = String((libraryTop as any).type_line || (libraryTop as any).typeLine || '');
    if (/\bland\b/i.test(typeLine)) {
      playLandWithPromptSync({
        gameId: safeView.id,
        cardId: libraryTop.id,
        fromZone: 'library',
      });
      return;
    }

    requestCastSpellWithPromptSync({
      gameId: safeView.id,
      cardId: libraryTop.id,
      fromZone: 'library',
    });
  }, [openSplitCardChoice, playLandWithPromptSync, requestCastSpellWithPromptSync, safeView, you]);

  // Split/Adventure card choice handler
  const handleSplitCardChoose = (faceId: string, fused?: boolean) => {
    if (!splitCardData || !safeView || !you) return;
    const sourceZone = splitCardData.sourceZone || 'hand';
    const zones = safeView.zones?.[you];
    const sourceCards = sourceZone === 'graveyard'
      ? ((zones?.graveyard || []) as KnownCardRef[])
      : sourceZone === 'exile'
        ? ((((zones as any)?.exile) || []) as KnownCardRef[])
        : sourceZone === 'library'
          ? (zones?.libraryTop ? [zones.libraryTop as KnownCardRef] : [])
          : ((zones?.hand || []) as KnownCardRef[]);
    const card = sourceCards.find((c: any) => c?.id === splitCardData.cardId) as KnownCardRef | undefined;
    if (!card) {
      setSplitCardModalOpen(false);
      setSplitCardData(null);
      return;
    }
    
    const cardFaces = (card as any).card_faces as CardFace[] | undefined;
    
    // Close split card modal
    setSplitCardModalOpen(false);
    setSplitCardData(null);
    
    // Determine face index for MTG-compliant flow
    let faceIndex: number | undefined;
    
    if (fused && sourceZone === 'hand' && cardFaces && cardFaces.length >= 2) {
      // Fuse: special case - for now use legacy flow
      // TODO: Implement fuse handling in requestCastSpell
      const manaCost =
        (cardFaces[0]?.mana_cost || '') +
        (cardFaces[1]?.mana_cost || '');
      const displayName = `${cardFaces[0]?.name || 'Left'} // ${cardFaces[1]?.name || 'Right'}`;
      setSpellToCast({
        cardId: splitCardData.cardId,
        cardName: displayName,
        manaCost: manaCost || (card as any).mana_cost,
        title: `Cast ${displayName}`,
        manualFloatingManaSelection: true,
      });
      setCastSpellModalOpen(true);
      return;
    } else if (faceId.startsWith('face_') && cardFaces) {
      faceIndex = parseInt(faceId.replace('face_', ''), 10);
      // Validate faceIndex bounds
      if (faceIndex < 0 || faceIndex >= cardFaces.length) {
        debugError(1, `[handleSplitCardChoose] Invalid faceIndex: ${faceIndex}`);
        return;
      }
    }

    const selectedFace = typeof faceIndex === 'number' && Array.isArray(cardFaces)
      ? cardFaces[faceIndex]
      : undefined;
    const selectedFaceTypeLine = String((selectedFace as any)?.type_line ?? (selectedFace as any)?.typeLine ?? '');
    if (sourceZone === 'library' && /\bland\b/i.test(selectedFaceTypeLine)) {
      playLandWithPromptSync({
        gameId: safeView.id,
        cardId: splitCardData.cardId,
        selectedFace: faceIndex,
        fromZone: 'library',
      });
      return;
    }
    
    // Use MTG-compliant flow: request targets first if needed
    requestCastSpellWithPromptSync({
      gameId: safeView.id,
      cardId: splitCardData.cardId,
      faceIndex,
      ...(sourceZone !== 'hand' ? { fromZone: sourceZone } : {}),
    });
  };

  const handleSplitCardCancel = () => {
    setSplitCardModalOpen(false);
    setSplitCardData(null);
  };

  const handleViewGraveyard = (playerId: string) => {
    setGraveyardModalPlayerId(playerId);
    setGraveyardModalOpen(true);
  };

  const handleViewExile = (playerId: string) => {
    setExileModalPlayerId(playerId);
    setExileModalOpen(true);
  };

  const handleGraveyardAbility = (cardId: string, abilityId: string) => {
    if (!safeView?.id) return;

    if (abilityId === 'graveyard-cast') {
      socket.emit('requestCastSpell', {
        gameId: safeView.id,
        cardId,
        fromZone: 'graveyard',
      });
      return;
    }

    socket.emit('activateGraveyardAbility', {
      gameId: safeView.id,
      cardId,
      abilityId,
    });
  };

  const handleExileAbility = (cardId: string, abilityId: string, card: KnownCardRef) => {
    if (!safeView?.id) return;

    if (abilityId === 'foretell-cast') {
      socket.emit('castForetold', {
        gameId: safeView.id,
        cardId,
      });
      return;
    }

    const isLand = /\bland\b/i.test(String((card as any)?.type_line || (card as any)?.typeLine || ''));

    if (isLand) {
      playLandWithPromptSync({
        gameId: safeView.id,
        cardId,
        fromZone: 'exile',
      });
      return;
    }

    // Most "cast/play from exile" permissions are handled via the normal cast request.
    // On-adventure cards cast the permanent face (faceIndex 0).
    requestCastSpellWithPromptSync({
      gameId: safeView.id,
      cardId,
      fromZone: 'exile',
      ...((abilityId === 'adventure-creature' || abilityId === 'adventure')
        ? { faceIndex: 0 }
        : {}),
    });
  };

  // Join Forces contribution handler
  // Now uses the unified Resolution Queue system when stepId is present
  const handleJoinForcesContribute = (amount: number) => {
    if (!safeView || !joinForcesRequest) return;
    
    // Check if this is using the new resolution system (has stepId)
    const stepId = (joinForcesRequest as any).stepId;
    
    if (!stepId) return;

    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId,
      selections: { amount },
      cancelled: false,
    });
    // Close modal after responding
    setJoinForcesModalOpen(false);
    setJoinForcesRequest(null);
  };

  // Tempting Offer response handler
  // Now uses the unified Resolution Queue system when stepId is present
  const handleTemptingOfferRespond = (accept: boolean) => {
    if (!safeView || !temptingOfferRequest) return;
    
    // Check if this is using the new resolution system (has stepId)
    const stepId = (temptingOfferRequest as any).stepId;
    
    if (!stepId) return;

    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId,
      selections: { accept },
      cancelled: false,
    });
    // Close modal after responding
    setTemptingOfferModalOpen(false);
    setTemptingOfferRequest(null);
  };
  
  // Kynaios Choice response handler (Kynaios and Tiro of Meletis style)
  // Now uses the unified Resolution Queue system
  const handleKynaiosChoiceRespond = (choice: 'play_land' | 'draw_card' | 'decline', landCardId?: string) => {
    if (!safeView || !kynaiosChoiceRequest) return;
    
    // Check if this is using the new resolution system (has stepId)
    const stepId = kynaiosChoiceRequest.stepId;

    if (!stepId) return;

    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId,
      selections: { choice, landCardId },
      cancelled: false,
    });

    // Close modal after responding
    setKynaiosChoiceModalOpen(false);
    setKynaiosChoiceRequest(null);
  };

  const handleOptionChoiceRespond = (selections: string[]) => {
    if (!safeView?.id || !optionChoiceRequest) return;

    socket.emit('submitResolutionResponse', {
      gameId: safeView.id,
      stepId: optionChoiceRequest.stepId,
      selections,
      cancelled: false,
    });

    setOptionChoiceModalOpen(false);
    setOptionChoiceRequest(null);
  };

  // Expand server-grouped tokens (broadcast optimization) into individual permanent entries
  // so the combat modal can show and select each token independently. Each entry uses
  // its real permanent ID from groupedTokenIds so server-side validation succeeds.
  const expandGroupedTokens = expandGroupedTokensForDisplay;

  // Get creatures for combat modal - filter to only those that can attack
  const myCreatures = useMemo(() => {
    if (!safeView || !you) return [];
    const filtered = (safeView.battlefield || []).filter((p: BattlefieldPermanent) => {
      if (p.controller !== you) return false;
      // Check if it's currently a creature (handles reconfigure/bestow)
      if (!isCurrentlyCreature(p)) return false;
      
      // Filter out creatures that cannot attack (summoning sickness without haste, or defender)
      return canCreatureAttack(p);
    });
    return expandGroupedTokens(filtered);
  }, [safeView, you]);

  // Get creatures that can block - different rules than attacking
  // Creatures with summoning sickness CAN block
  // Creatures with defender CAN block  
  // Only tapped creatures cannot block
  const myBlockerCreatures = useMemo(() => {
    if (!safeView || !you) return [];
    const filtered = (safeView.battlefield || []).filter((p: BattlefieldPermanent) => {
      if (p.controller !== you) return false;
      // Check if it's currently a creature (handles reconfigure/bestow)
      if (!isCurrentlyCreature(p)) return false;
      // Tapped creatures cannot block
      if (p.tapped) return false;
      // All untapped creatures can block (even with summoning sickness or defender)
      return canCreatureBlockNow(p, safeView.battlefield || []);
    });
    return expandGroupedTokens(filtered);
  }, [safeView, you]);

  const attackingCreatures = useMemo(() => {
    if (!safeView) return [];
    const filtered = (safeView.battlefield || []).filter((p: any) =>
      p.attacking &&
      isCurrentlyCreature(p)
    );
    // Safety net: if emit still grouped attacking tokens as group_*, expand so
    // blocker declarations send real permanent ids the server can validate.
    return expandGroupedTokens(filtered);
  }, [safeView]);

  const defenders = useMemo(() => {
    if (!safeView || !you) return [];
    return (safeView.players || []).filter((p: any) => playerIsLegalAttackTarget(p, you));
  }, [safeView, you]);

  // Per-defender attack info: untapped creature count and attack tax per attacker.
  // Tax is oracle-parsed on the client for the assign-attackers preview (including `{W/P}`).
  const defenderInfoMap = useMemo(() => {
    if (!safeView || !you) return undefined;

    const resolveDefendingPlayerId = (defenderId: string): string => {
      const battlefield: BattlefieldPermanent[] = safeView.battlefield || [];
      const players = safeView.players || [];
      const playerIds = new Set(players.map((player: any) => String(player.id)));
      if (playerIds.has(defenderId)) return defenderId;
      const targetPerm = battlefield.find((perm) => String(perm.id) === defenderId);
      return targetPerm?.controller ? String(targetPerm.controller) : defenderId;
    };

    const result: Record<string, {
      untappedCreatureCount: number;
      attackTaxPerCreature: number;
      attackTaxPhyrexianPerCreature: Array<{ symbol: string; life: number }>;
      attackTaxCountersOnAttacker: boolean;
    }> = {};
    const battlefield: BattlefieldPermanent[] = safeView.battlefield || [];
    for (const defender of defenders) {
      const defId = String(defender.id);
      const defendingPlayerId = resolveDefendingPlayerId(defId);

      const untappedCreatureCount = battlefield.reduce((sum: number, p: BattlefieldPermanent) => {
        if (p.controller !== defendingPlayerId) return sum;
        if (p.tapped) return sum;
        const tl = ((p.card as any)?.type_line || '').toLowerCase();
        if (!/\bcreature\b/.test(tl)) return sum;
        return sum + tokenDisplayInstanceCount(p);
      }, 0);

      const tax = collectAttackYouTaxPreviewForDefender(
        battlefield,
        defendingPlayerId,
        (safeView as any)?.lastingEffects,
      );
      result[defId] = {
        untappedCreatureCount,
        attackTaxPerCreature: tax.generic,
        attackTaxPhyrexianPerCreature: tax.phyrexian,
        attackTaxCountersOnAttacker: tax.countersOnAttacker,
      };
    }
    return result;
  }, [safeView, you, defenders]);

  const combatModalAttackersAvailableCreatures = useMemo(() => {
    if (!safeView) return [];
    const turnPlayer = safeView.turnPlayer;
    if (!turnPlayer) return [];

    // For read-only viewers, show the active player's combat-relevant creatures
    // (include currently-attacking creatures even if they are tapped).
    return expandGroupedTokens((safeView.battlefield || []).filter((p: BattlefieldPermanent) => {
      if (p.controller !== turnPlayer) return false;
      if (!isCurrentlyCreature(p)) return false;
      return canCreatureAttack(p) || !!(p as any).attacking;
    }));
  }, [safeView]);

  const combatModalAttackersDefenders = useMemo(() => {
    if (!safeView) return [];
    const turnPlayer = safeView.turnPlayer;
    if (!turnPlayer) return [];
    return (safeView.players || []).filter((p: any) => playerIsLegalAttackTarget(p, turnPlayer));
  }, [safeView]);

  const combatControlEffect = useMemo(() => {
    if (!safeView) return null;
    return ((safeView as any)?.combat?.combatControl || (safeView as any)?.combatControl || null) as any;
  }, [safeView]);

  const combatModalInitialAttackTargets = useMemo(() => {
    if (!safeView) return undefined;
    const turnPlayer = safeView.turnPlayer;
    if (!turnPlayer) return undefined;

    const battlefield = (safeView.battlefield || []) as any[];
    const players = (safeView.players || []) as any[];
    const playerIds = new Set(players.map((p: any) => p.id));

    const initialTargets: Record<string, string> = {};
    for (const perm of battlefield) {
      if (!perm || perm.controller !== turnPlayer) continue;
      if (!isCurrentlyCreature(perm)) continue;

      const target = perm.attacking;
      if (!target || typeof target !== 'string') continue;

      // If targeting a player, keep as-is
      if (playerIds.has(target)) {
        initialTargets[String(perm.id)] = target;
        continue;
      }

      // If targeting a planeswalker/battle permanent, map to its controller (defending player)
      const targetPerm = battlefield.find((p: any) => p?.id === target);
      if (targetPerm?.controller) {
        initialTargets[String(perm.id)] = String(targetPerm.controller);
      }
    }

    return initialTargets;
  }, [safeView]);

  return {
    openSplitCardChoice,
    handleUseTopOfLibrary,
    handleSplitCardChoose,
    handleSplitCardCancel,
    handleViewGraveyard,
    handleViewExile,
    handleGraveyardAbility,
    handleExileAbility,
    handleJoinForcesContribute,
    handleTemptingOfferRespond,
    handleKynaiosChoiceRespond,
    handleOptionChoiceRespond,
    expandGroupedTokens,
    myCreatures,
    myBlockerCreatures,
    attackingCreatures,
    defenders,
    defenderInfoMap,
    combatModalAttackersAvailableCreatures,
    combatModalAttackersDefenders,
    combatControlEffect,
    combatModalInitialAttackTargets,
  };
}
