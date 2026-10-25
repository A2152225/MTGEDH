// Origin parent: client/src/App.tsx
// Cluster moved: play-socket / combat / priority / undo / AI listener effects.
// Public entry symbols: useAppPlaySocketEffects.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React from "react";
import { socket } from "../socket";
import { readableCombatError } from "../utils/restrictionReasonText";
import type { BattlefieldPermanent, ClientGameView, ManaPool, PlayerID } from "../../../shared/src";
import type { TriggerPromptData } from "../components/TriggeredAbilityModal";
import type { UndoBoundaryPreview, UndoRequestData } from "../components/UndoRequestModal";
import type { OrderingMode, ReplacementEffectItem } from "../components/ReplacementEffectOrderModal";
import { canCreatureAttackNow, isCurrentlyCreature } from "../utils/creatureUtils";
import {
  applyStashedIgnoredCardsIfMatch,
  payloadMatchesViewer,
  shouldSeedIgnoredCardsFromView,
  stashIgnoredCardsPayload,
  type IgnoredCardsUpdatedPayload,
} from "../utils/ignoredCardsSync";

type ReplacementEffectMode = "minimize" | "maximize" | "custom" | "auto";

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export type AppPlaySocketEffectDeps = {
  safeView: ClientGameView | null | undefined;
  you: PlayerID | null | undefined;
  canCreatureAttack: (perm: BattlefieldPermanent) => boolean;
  myPendingResolutionCount: number;
  activeResolutionPrompt: { stepId: string; title: string } | null;
  minimizedResolutionStep: { stepId: string; title: string } | null;
  combatPreviewAttackTargets: Record<string, string> | null;
  combatMode: "attackers" | "blockers";
  combatModalOpen: boolean;
  combatModalReadOnly: boolean;
  lastError: string | null;
  lastCombatErrorSeenRef: React.MutableRefObject<string | null>;
  hasAutoSkippedAttackers: React.MutableRefObject<string | null>;
  hasShownBlockersModal: React.MutableRefObject<string | null>;
  lastPriorityStep: React.MutableRefObject<string | null>;
  hadPriorityRef: React.MutableRefObject<boolean>;
  lastCanRespond: React.MutableRefObject<boolean | null>;
  autoPassSteps: Set<string>;
  autoPassForTurn: boolean;
  phaseNavigatorAdvancing: boolean;
  pendingTriggers: TriggerPromptData[];
  undoRequestData: UndoRequestData | null;
  connected: boolean;
  setNameInUsePayload: Setter<any>;
  setShowNameInUseModal: Setter<boolean>;
  setCombatControlMode: Setter<"attackers" | "blockers">;
  setCombatControlModalOpen: Setter<boolean>;
  setCombatModalOpen: Setter<boolean>;
  setCombatModalError: Setter<string | null>;
  setCombatModalReadOnly: Setter<boolean>;
  setCombatModalMinimized: Setter<boolean>;
  setCombatMode: Setter<"attackers" | "blockers">;
  setCombatPreviewAttackTargets: Setter<Record<string, string> | null>;
  setPriorityModalOpen: Setter<boolean>;
  setIgnoredTriggerSources: Setter<any>;
  setDeckValidation: Setter<any>;
  setIgnoredCards: Setter<any>;
  setDamageReplacementMode: Setter<any>;
  setReplacementEffectModalOpen: Setter<boolean>;
  setReplacementEffectModalData: Setter<any>;
  setManaPool: Setter<ManaPool | null>;
  setUndoRequestData: Setter<UndoRequestData | null>;
  setUndoModalOpen: Setter<boolean>;
  setAvailableUndoCount: Setter<number>;
  setUndoTurnPhaseTargets: Setter<any>;
  setSmartUndoCounts: Setter<any>;
  setAiControlEnabled: Setter<boolean>;
  setAiStrategy: Setter<string>;
};

export function useAppPlaySocketEffects(deps: AppPlaySocketEffectDeps) {
  const {
    safeView,
    you,
    canCreatureAttack,
    myPendingResolutionCount,
    activeResolutionPrompt,
    minimizedResolutionStep,
    combatPreviewAttackTargets,
    combatMode,
    combatModalOpen,
    combatModalReadOnly,
    lastError,
    lastCombatErrorSeenRef,
    hasAutoSkippedAttackers,
    hasShownBlockersModal,
    lastPriorityStep,
    hadPriorityRef,
    lastCanRespond,
    autoPassSteps,
    autoPassForTurn,
    phaseNavigatorAdvancing,
    pendingTriggers,
    undoRequestData,
    connected,
    setNameInUsePayload,
    setShowNameInUseModal,
    setCombatControlMode,
    setCombatControlModalOpen,
    setCombatModalOpen,
    setCombatModalError,
    setCombatModalReadOnly,
    setCombatModalMinimized,
    setCombatMode,
    setCombatPreviewAttackTargets,
    setPriorityModalOpen,
    setIgnoredTriggerSources,
    setDeckValidation,
    setIgnoredCards,
    setDamageReplacementMode,
    setReplacementEffectModalOpen,
    setReplacementEffectModalData,
    setManaPool,
    setUndoRequestData,
    setUndoModalOpen,
    setAvailableUndoCount,
    setUndoTurnPhaseTargets,
    setSmartUndoCounts,
    setAiControlEnabled,
    setAiStrategy,
  } = deps;
  React.useEffect(() => {
    const handler = (payload: any) => {
      setNameInUsePayload(payload);
      setShowNameInUseModal(true);
    };
    socket.on("nameInUse", handler);
    return () => {
      socket.off("nameInUse", handler);
    };
  }, []);

  // Combat phase detection - auto-open combat modal when step changes
  React.useEffect(() => {
    if (!safeView) return;
    
    const step = String((safeView as any).step || "").toLowerCase();
    const turnPlayer = safeView.turnPlayer;
    const isYourTurn = you != null && turnPlayer != null && turnPlayer === you;
    const stackLength = (safeView as any).stack?.length || 0;
    const combatControl = ((safeView as any)?.combat?.combatControl || (safeView as any)?.combatControl) as any;
    const isCombatController = !!you && !!combatControl && combatControl.controllerId === you;
    // Include combatNumber to handle multiple combat phases per turn (Aurelia, Combat Celebrant, etc.)
    const combatNumber = (safeView as any).combatNumber || 1;
    const turnId = `${safeView.turn}-${combatNumber}-${step}`; // Unique ID for this combat step
    
    // Declare attackers
    if (step === "declareattackers" || step === "declare_attackers") {
      if (isCombatController && !!combatControl?.controlsAttackers) {
        setCombatControlMode('attackers');
        setCombatControlModalOpen(true);
        setCombatModalOpen(false);
        setCombatModalError(null);
        setCombatModalReadOnly(false);
        return;
      }

      if (isYourTurn) {
        const attackersDeclaredBy: string[] = Array.isArray((safeView as any).attackersDeclaredBy)
          ? (safeView as any).attackersDeclaredBy
          : [];
        const ownedCreaturesAttacking = (safeView.battlefield || []).some(
          (p: BattlefieldPermanent) => p.controller === you && !!(p as any).attacking,
        );
        const youAlreadyDeclaredAttackers =
          !!you && attackersDeclaredBy.includes(you) && ownedCreaturesAttacking;
        const awaitingAttackCostChoice =
          myPendingResolutionCount > 0 || !!activeResolutionPrompt || !!minimizedResolutionStep;

        // Check if there are any valid creatures that can attack
        const validAttackers = (safeView.battlefield || []).filter((p: BattlefieldPermanent) => {
          if (!you) return false;
          if (p.controller !== you) return false;
          // Check if it's currently a creature (handles reconfigure/bestow)
          if (!isCurrentlyCreature(p)) return false;
          // Check if creature can attack (not tapped, no summoning sickness unless haste, no defender)
          if (p.tapped) return false;
          return canCreatureAttack(p);
        });
        
        if (validAttackers.length === 0) {
          // No valid attackers - auto-skip declare attackers
          // Only skip if stack is empty and we haven't already skipped for this step
          if (stackLength === 0 && hasAutoSkippedAttackers.current !== turnId) {
            hasAutoSkippedAttackers.current = turnId;
            socket.emit("skipDeclareAttackers", { gameId: safeView.id });
          }
          // Don't show the modal either way
          setCombatModalOpen(false);
          setCombatModalReadOnly(false);
        } else if (awaitingAttackCostChoice) {
          setCombatModalOpen(false);
          setCombatModalMinimized(false);
          setCombatModalError(null);
          setCombatModalReadOnly(false);
        } else if (youAlreadyDeclaredAttackers) {
          setCombatModalOpen(false);
          setCombatModalMinimized(false);
          setCombatModalError(null);
          setCombatModalReadOnly(false);
        } else {
          setCombatMode('attackers');
          setCombatModalReadOnly(false);
          setCombatModalOpen(true);
        }
      } else {
        const battlefield = (safeView.battlefield || []) as BattlefieldPermanent[];
        const anyPreviewTargets = !!combatPreviewAttackTargets && Object.keys(combatPreviewAttackTargets).length > 0;
        const anyAttackersDeclared = battlefield.some((p: any) => !!p?.attacking);
        const activePlayerHasCombatCreatures = battlefield.some((p: BattlefieldPermanent) => {
          if (p.controller !== turnPlayer) return false;
          if (!isCurrentlyCreature(p)) return false;
          return canCreatureAttack(p) || !!(p as any).attacking;
        });

        if (anyPreviewTargets || anyAttackersDeclared || activePlayerHasCombatCreatures) {
          setCombatMode('attackers');
          setCombatModalReadOnly(true);
          setCombatModalError(null);
          setCombatModalOpen(true);
        } else {
          setCombatModalOpen(false);
          setCombatModalError(null);
          setCombatModalReadOnly(false);
        }
      }
    }
    // Show blocker modal when you're being attacked during declare blockers step
    else if (step === "declareblockers" || step === "declare_blockers") {
      if (isCombatController && !!combatControl?.controlsBlockers) {
        setCombatControlMode('blockers');
        setCombatControlModalOpen(true);
        setCombatModalOpen(false);
        setCombatModalError(null);
        setCombatModalReadOnly(false);
        return;
      }

      // Spectators (or clients without an assigned player id) only ever get a read-only view.
      if (!you) {
        const anyAttackersDeclared = (safeView.battlefield || []).some((p: any) => !!p?.attacking);
        if (anyAttackersDeclared) {
          setCombatMode('blockers');
          setCombatModalReadOnly(true);
          setCombatModalOpen(true);
        } else {
          setCombatModalOpen(false);
          setCombatModalError(null);
          setCombatModalReadOnly(false);
        }
        return;
      }

      // Note: attackers can target either a playerId OR a permanentId (planeswalker/battle).
      // If a planeswalker/battle you control is being attacked, you are still the defending player
      // and must be prompted to declare blockers.
      const battlefield = (safeView.battlefield || []) as any[];
      const attackersTargetingYou = battlefield.filter((p: any) => {
        const target = p?.attacking;
        if (!target) return false;
        if (target === you) return true;

        // If the target is a permanent you control (planeswalker/battle), treat as defending.
        if (typeof target === 'string') {
          const targetPerm = battlefield.find((perm: any) => perm?.id === target);
          if (!targetPerm) return false;
          if (targetPerm.controller !== you) return false;
          const typeLine = String(targetPerm.card?.type_line || '').toLowerCase();
          return typeLine.includes('planeswalker') || typeLine.includes('battle');
        }

        return false;
      });

      // IMPORTANT: Do not use a purely client-side "shown once" guard here.
      // If the server rejects an illegal block (e.g. flying/shadow/menace), we must
      // allow the modal to reopen so the player can correct their blockers.
      // Use server-authoritative state: once the player is recorded in blockersDeclaredBy,
      // we stop prompting for blockers.
      const blockersDeclaredBy: string[] = Array.isArray((safeView as any).blockersDeclaredBy)
        ? (safeView as any).blockersDeclaredBy
        : [];

      const youAlreadyDeclared = blockersDeclaredBy.includes(you);
      if (attackersTargetingYou.length > 0 && !youAlreadyDeclared) {
        setCombatMode('blockers');
        setCombatModalReadOnly(false);
        setCombatModalOpen(true);
      } else if (youAlreadyDeclared && combatMode === 'blockers' && combatModalOpen) {
        // Server accepted declaration/skip; ensure the modal is closed.
        setCombatModalOpen(false);
        setCombatModalError(null);
        setCombatModalReadOnly(false);
      } else {
        // Not the defending player (or not being attacked): keep a read-only blockers view open
        // so everyone can see attackers during the blockers window.
        const anyAttackersDeclared = (safeView.battlefield || []).some((p: any) => !!p?.attacking);
        if (anyAttackersDeclared) {
          setCombatMode('blockers');
          setCombatModalReadOnly(true);
          setCombatModalOpen(true);
        } else {
          setCombatModalOpen(false);
          setCombatModalError(null);
          setCombatModalReadOnly(false);
        }
      }
    }
    else {
      setCombatControlModalOpen(false);
      setCombatModalOpen(false);
      setCombatModalMinimized(false);
      setCombatModalError(null);
      setCombatModalReadOnly(false);
      // Reset auto-skip tracker when we leave combat steps
      if (hasAutoSkippedAttackers.current) {
        hasAutoSkippedAttackers.current = null;
      }
      // Reset shown blockers modal tracker when we leave combat steps
      if (hasShownBlockersModal.current) {
        hasShownBlockersModal.current = null;
      }
    }
  }, [safeView, you, myPendingResolutionCount, activeResolutionPrompt, minimizedResolutionStep]);

  // Live attacker allocation preview from the active player (read-only viewers)
  React.useEffect(() => {
    const handler = (payload: any) => {
      const gameId = payload?.gameId;
      if (!gameId || gameId !== safeView?.id) return;

      const attackerPlayerId = payload?.attackerPlayerId;
      // Only accept preview for the current turn player
      if (!attackerPlayerId || attackerPlayerId !== safeView?.turnPlayer) return;

      const targets = payload?.targets;
      if (!targets || typeof targets !== 'object') return;

      setCombatPreviewAttackTargets(targets as Record<string, string>);
    };

    socket.on('combatPreviewAttackers', handler);
    return () => {
      socket.off('combatPreviewAttackers', handler);
    };
  }, [safeView?.id, safeView?.turnPlayer]);

  // Clear preview when leaving declare attackers
  React.useEffect(() => {
    const step = String((safeView as any)?.step || '').toLowerCase();
    if (step !== 'declareattackers' && step !== 'declare_attackers') {
      setCombatPreviewAttackTargets(null);
    }
  }, [safeView]);

  // If the server rejects an illegal combat declaration, re-open the modal and surface the message.
  React.useEffect(() => {
    if (!safeView || !you) return;
    if (!lastError) return;
    if (lastCombatErrorSeenRef.current === lastError) return;
    lastCombatErrorSeenRef.current = lastError;

    const step = String((safeView as any).step || "").toLowerCase();
    const isDeclareBlockers = step === "declareblockers" || step === "declare_blockers";
    const isDeclareAttackers = step === "declareattackers" || step === "declare_attackers";
    if (!isDeclareBlockers && !isDeclareAttackers) return;

    if (isDeclareAttackers) {
      const attackersDeclaredBy: string[] = Array.isArray((safeView as any).attackersDeclaredBy)
        ? (safeView as any).attackersDeclaredBy
        : [];
      if (!attackersDeclaredBy.includes(you)) {
        setCombatMode('attackers');
        setCombatModalError(readableCombatError(lastError));
        setCombatModalReadOnly(false);
        setCombatModalMinimized(false);
        setCombatModalOpen(true);
      }
      return;
    }

    const battlefield = (safeView.battlefield || []) as any[];
    const attackersTargetingYou = battlefield.filter((p: any) => {
      const target = p?.attacking;
      if (!target) return false;
      if (target === you) return true;

      if (typeof target === 'string') {
        const targetPerm = battlefield.find((perm: any) => perm?.id === target);
        if (!targetPerm) return false;
        if (targetPerm.controller !== you) return false;
        const typeLine = String(targetPerm.card?.type_line || '').toLowerCase();
        return typeLine.includes('planeswalker') || typeLine.includes('battle');
      }

      return false;
    });

    const blockersDeclaredBy: string[] = Array.isArray((safeView as any).blockersDeclaredBy)
      ? (safeView as any).blockersDeclaredBy
      : [];
    const youAlreadyDeclared = blockersDeclaredBy.includes(you);

    if (attackersTargetingYou.length > 0 && !youAlreadyDeclared) {
      setCombatMode('blockers');
      setCombatModalError(readableCombatError(lastError));
      setCombatModalReadOnly(false);
      setCombatModalOpen(true);
    }
  }, [lastError, safeView, you]);

  // Priority modal logic - show when you gain priority on step changes
  React.useEffect(() => {
    if (!safeView || !you) return;
    
    const step = String((safeView as any).step || "").toLowerCase();
    const phaseStr = String((safeView as any).phase || "").toUpperCase();
    const priority = (safeView as any).priority;
    const youHavePriority = priority === you;
    const stackLength = (safeView as any).stack?.length || 0;
    
    // Don't show priority modal during pre-game phase
    // Note: Using same logic as isPreGame memo (uppercase comparison)
    const isPreGamePhase = phaseStr === "" || phaseStr === "PRE_GAME";
    if (isPreGamePhase) {
      setPriorityModalOpen(false);
      return;
    }
    
    // Show priority modal when all of these conditions are met:
    // 1. You have priority
    // 2. The stack is empty (not responding to something)
    // 3. The step changed since last time we showed the modal
    // 4. We're not in a combat modal already
    // 5. Either: auto-pass is NOT enabled for this step, 
    //    OR: it's your turn and you're not using phase navigator,
    //    OR: there are pending triggers to handle
    
    // Check for pending triggers in the game state
    const hasPendingTriggers = pendingTriggers.length > 0;
    
    // Normalize step key - remove underscores and convert to lowercase for consistent comparison
    const stepKey = step.replace(/_/g, '').toLowerCase();
    const autoPassStepEnabled = autoPassSteps.has(stepKey) || autoPassSteps.has(step.toLowerCase());
    
    // Auto-pass activates when:
    // 1. Auto-pass is enabled for this step, AND
    // 2. Either: you are NOT the active player (not your turn), OR you're using phase navigator during a NON-action phase, AND
    // 3. There are no pending triggers to handle
    // 
    // IMPORTANT: The turn player should NEVER auto-pass during their own "action phases":
    // - Main Phase 1 (MAIN1) - can play lands, cast sorcery-speed spells
    // - Main Phase 2 (MAIN2) - can play lands, cast sorcery-speed spells
    // These are the phases where the turn player typically wants to take actions.
    // Even with phaseNavigatorAdvancing=true, we should stop at main phases on your turn.
    const turnPlayer = (safeView as any).turnPlayer;
    const isYourTurn = turnPlayer !== null && turnPlayer !== undefined && turnPlayer === you;
    
    // Action phases are main phases where the turn player can play lands and cast sorcery-speed spells
    // Use stepKey (normalized, lowercase, no underscores) for precise detection
    const isActionPhase = stepKey.includes('main');
    
    // Get action/response capabilities from server (preferred) or calculate from playableCards (fallback)
    // canAct: Can take sorcery-speed actions (play lands, cast sorceries, etc.)
    // canRespond: Can take instant-speed actions (cast instants, activate abilities, etc.)
    const playableCards = (safeView as any).playableCards || [];
    const canAct = (safeView as any).canAct ?? (playableCards.length > 0);
    const canRespond = (safeView as any).canRespond ?? canAct;
    
    // Check if player has creatures for combat (must be untapped and not have summoning sickness)
    const battlefield = safeView.battlefield || [];
    const playerCreatures = battlefield.filter((p: any) => {
      if (p.controller !== you) return false;
      if (!isCurrentlyCreature(p)) return false;
      if (p.tapped) return false;
      return canCreatureAttackNow(p, battlefield);
    });
    const hasCreaturesToAttack = playerCreatures.length > 0;
    
    // Combat phases detection
    const COMBAT_STEPS = ['combat', 'attack', 'block', 'damage'];
    const isCombatPhase = COMBAT_STEPS.some(phase => stepKey.includes(phase));
    
    // NOTE: Auto-pass logic has been moved to server-side (doAutoPass in util.ts)
    // The server will auto-pass after timeout if player has no actions (canAct/canRespond)
    // This ensures authoritative game state and prevents race conditions.
    //
    // Client-side auto-pass is DISABLED to prevent:
    // 1. Race conditions where client auto-passes before canAct/canRespond is calculated
    // 2. Client/server state desync
    // 3. Priority passing before user can see their options
    //
    // TODO: If we want to support user preferences for auto-pass, those should be sent
    // to the server and the server should handle auto-passing based on those preferences.
    
    // Show priority modal when you gain priority and can take instant-speed actions.
    // Suppress only during YOUR main phase when you also have sorcery-speed plays (canAct),
    // so normal land/spell turns stay uninterrupted. Opponent main phases with flash
    // use the same popup as upkeep/combat/end steps instead of only Phase Navigator.
    const blockingCombatModalOpen = combatModalOpen && !combatModalReadOnly;

    const isMainPhase = step.includes('main') || step === 'main1' || step === 'main2';
    const suppressForMainPhasePlay = isMainPhase && isYourTurn && canAct === true;

    const gainedPriority = youHavePriority && !hadPriorityRef.current;
    const stepChangedWhileYouHavePriority =
      youHavePriority && lastPriorityStep.current !== step;

    const shouldShowModal =
      !hasPendingTriggers &&
      canRespond === true &&
      !suppressForMainPhasePlay &&
      (gainedPriority || stepChangedWhileYouHavePriority);

    if (youHavePriority && stackLength === 0 && !blockingCombatModalOpen) {
      if (shouldShowModal) {
        setPriorityModalOpen(true);
      }
      if (stepChangedWhileYouHavePriority) {
        lastPriorityStep.current = step;
      }
    } else {
      setPriorityModalOpen(false);
      if (!youHavePriority) {
        lastCanRespond.current = null;
      }
    }

    hadPriorityRef.current = youHavePriority;
  }, [safeView, you, combatModalOpen, combatModalReadOnly, autoPassSteps, autoPassForTurn, phaseNavigatorAdvancing, pendingTriggers]);

  // Mulligan bottom selection prompt listener (London Mulligan)
  // (Legacy mulliganBottomPrompt removed; mulligan bottom uses Resolution Queue HAND_TO_BOTTOM)

  // Listen for batch trigger resolution summary to update auto-resolve counts
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id && payload.playerId === you) {
        // Update counts for each resolved source that we have in ignoredTriggerSources
        setIgnoredTriggerSources((prev: any) => {
          const next = new Map(prev);
          for (const source of (payload.sources || [])) {
            const existing = next.get(source.sourceKey) as any;
            if (existing) {
              // Increment count by number resolved
              next.set(source.sourceKey, {
                ...existing,
                count: existing.count + source.count,
              });
            }
          }
          return next;
        });
      }
    };
    socket.on("triggersResolved", handler);
    return () => {
      socket.off("triggersResolved", handler);
    };
  }, [safeView?.id, you]);

  // Deck validation result listener
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setDeckValidation({
          format: payload.format,
          cardCount: payload.cardCount,
          illegal: payload.illegal || [],
          warnings: payload.warnings || [],
          valid: payload.valid,
        });
      }
    };
    socket.on("deckValidationResult", handler);
    return () => {
      socket.off("deckValidationResult", handler);
    };
  }, [safeView?.id]);

  const lastIgnoredCardsPayloadRef = React.useRef<IgnoredCardsUpdatedPayload | null>(null);
  const appliedIgnoredCardsGameRef = React.useRef<string | null>(null);
  const youRef = React.useRef(you);
  const viewIdRef = React.useRef(safeView?.id);
  youRef.current = you;
  viewIdRef.current = safeView?.id;

  // Stash ignoredCardsUpdated so a join emit is not dropped before you/safeView.id exist.
  React.useEffect(() => {
    const handler = (payload: any) => {
      const stashed = stashIgnoredCardsPayload(lastIgnoredCardsPayloadRef, payload);
      if (!stashed) return;
      if (payloadMatchesViewer(stashed, viewIdRef.current, youRef.current)) {
        setIgnoredCards(stashed.ignoredCards || []);
        appliedIgnoredCardsGameRef.current = stashed.gameId ?? null;
      }
    };
    socket.on("ignoredCardsUpdated" as any, handler);
    return () => {
      socket.off("ignoredCardsUpdated" as any, handler);
    };
  }, []);

  React.useEffect(() => {
    const next = applyStashedIgnoredCardsIfMatch(lastIgnoredCardsPayloadRef, safeView?.id, you);
    if (next) {
      setIgnoredCards(next);
      appliedIgnoredCardsGameRef.current = safeView?.id ?? null;
    }
  }, [safeView?.id, you]);

  const viewIgnoredMap = (safeView as any)?.ignoredCardsForAutoPass;
  React.useEffect(() => {
    if (!safeView?.id || !you) return;
    setIgnoredCards((prev: any[]) => {
      const seeded = shouldSeedIgnoredCardsFromView({
        gameId: safeView.id,
        playerId: you,
        railEmpty: !Array.isArray(prev) || prev.length === 0,
        appliedLiveForGameId: appliedIgnoredCardsGameRef.current,
        viewMap: viewIgnoredMap?.[you],
      });
      return seeded ?? prev;
    });
  }, [safeView?.id, you, viewIgnoredMap]);

  // Drop stale ignored-card UI while disconnected; join/requestState/view seed refill.
  React.useEffect(() => {
    if (!connected) {
      lastIgnoredCardsPayloadRef.current = null;
      appliedIgnoredCardsGameRef.current = null;
      setIgnoredCards([]);
    }
  }, [connected]);

  // Replacement effect preference sync (used by PhaseNavigator)
  React.useEffect(() => {
    if (!safeView?.id || !you) return;
    socket.emit('getReplacementEffectOrder', { gameId: safeView.id, effectType: 'damage' });
  }, [safeView?.id, you]);

  React.useEffect(() => {
    const coerceDamageMode = (pref: any): ReplacementEffectMode => {
      if (pref?.mode) return pref.mode;
      // Back-compat: older server/client used a boolean toggle for damage.
      return pref?.useCustomOrder ? 'maximize' : 'minimize';
    };

    const handleResponse = (data: any) => {
      if (data?.gameId !== safeView?.id) return;
      // Server can return either a single preference or an object of preferences.
      if (data?.effectType === 'damage' && data?.preference) {
        setDamageReplacementMode(coerceDamageMode(data.preference));
        return;
      }
      if (data?.preferences?.damage) {
        setDamageReplacementMode(coerceDamageMode(data.preferences.damage));
      }
    };

    const handleUpdated = (data: any) => {
      if (data?.gameId !== safeView?.id) return;
      if (data?.effectType !== 'damage') return;
      if (data?.mode) {
        setDamageReplacementMode(data.mode);
        return;
      }
      // Back-compat
      setDamageReplacementMode(data?.useCustomOrder ? 'maximize' : 'minimize');
    };

    socket.on('replacementEffectOrderResponse', handleResponse);
    socket.on('replacementEffectOrderUpdated', handleUpdated);
    return () => {
      socket.off('replacementEffectOrderResponse', handleResponse);
      socket.off('replacementEffectOrderUpdated', handleUpdated);
    };
  }, [safeView?.id]);

  // Legacy targetSelectionRequest listener removed - target selection is Resolution Queue-only.

  // Payment required listener (for MTG-compliant spell casting: targets first, then payment)
  // Legacy paymentRequired listener removed - spell payment is handled via Resolution Queue.

  // Opening hand actions prompt is handled via Resolution Queue (opening_hand_actions).

  // Life payment request listener (for Toxic Deluge, Hatred, etc.)
  // Legacy lifePaymentRequest listener removed - now handled via Resolution Queue (life_payment).


  // Legacy MDFC face selection request listener removed - now handled via Resolution Queue (resolutionStepPrompt).

  // Legacy modalSpellRequest listener removed - now handled via Resolution Queue (mode_selection with multi-select).

  // Replacement Effect Order Request listener - allows player to override damage/life effect ordering
  React.useEffect(() => {
    const handler = (payload: {
      gameId: string;
      effectType: 'damage' | 'life_gain' | 'counters' | 'tokens';
      effects: ReplacementEffectItem[];
      baseAmount: number;
      initialMode?: OrderingMode;
      effectId?: string;
    }) => {
      if (payload.gameId === safeView?.id) {
        setReplacementEffectModalData({
          effectType: payload.effectType,
          effects: payload.effects,
          baseAmount: payload.baseAmount,
          initialMode: payload.initialMode,
          effectId: payload.effectId,
        });
        setReplacementEffectModalOpen(true);
      }
    };
    socket.on("replacementEffectOrderRequest", handler);
    return () => {
      socket.off("replacementEffectOrderRequest", handler);
    };
  }, [safeView?.id]);

  // Mana choice prompts are handled via Resolution Queue (resolutionStepPrompt).

  // Legacy additionalCostRequest listener removed - now handled via Resolution Queue (additional_cost_payment).

  // Legacy squadCostRequest listener removed - now handled via Resolution Queue (squad_cost_payment).

  // Legacy modeSelectionRequest listener removed - now handled via Resolution Queue (mode_selection).

  // Mana pool update listener - update local mana pool state when server sends updates
  React.useEffect(() => {
    const handler = (payload: {
      gameId: string;
      playerId: string;
      manaPool: {
        white: number;
        blue: number;
        black: number;
        red: number;
        green: number;
        colorless: number;
        restricted?: Array<{
          type?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
          amount: number;
          restriction: string;
          restrictedTo?: string;
          sourceId?: string;
          sourceName?: string;
        }>;
        doesNotEmpty?: boolean;
      };
      totalMana: number;
      reason?: string;
    }) => {
      // Only update if this is for the current player
      if (payload.gameId === safeView?.id && payload.playerId === you) {
        setManaPool(payload.manaPool as ManaPool);
      }
    };
    socket.on("manaPoolUpdate", handler);
    return () => {
      socket.off("manaPoolUpdate", handler);
    };
  }, [safeView?.id, you]);

  // Also sync mana pool from state when it changes (fallback for when broadcastGame includes manaPool)
  React.useEffect(() => {
    if (!safeView || !you) return;
    
    const statePool = (safeView as any).manaPool?.[you];
    if (statePool) {
      setManaPool(statePool);
    }
  }, [safeView, you]);

  // Undo request listener
  React.useEffect(() => {
    const handleUndoRequest = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setUndoRequestData({
          undoId: payload.undoId,
          requesterId: payload.requesterId,
          requesterName: payload.requesterName,
          description: payload.description,
          undoScope: payload.undoScope,
          actionsToUndo: payload.actionsToUndo,
          boundaryPreview: payload.boundaryPreview,
          expiresAt: payload.expiresAt,
          approvals: payload.approvals || {},
          playerIds: payload.playerIds || [],
          playerNames: payload.playerNames || {},
        });
        setUndoModalOpen(true);
      }
    };

    const handleUndoUpdate = (payload: any) => {
      if (payload.gameId === safeView?.id && undoRequestData?.undoId === payload.undoId) {
        setUndoRequestData(prev => prev ? {
          ...prev,
          approvals: payload.approvals || prev.approvals,
        } : null);
      }
    };

    const handleUndoCancelled = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setUndoModalOpen(false);
        setUndoRequestData(null);
      }
    };

    const handleUndoConfirmed = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setUndoModalOpen(false);
        setUndoRequestData(null);
        window.setTimeout(() => {
          socket.emit('getMyNextResolutionStep', { gameId: payload.gameId });
        }, 0);
      }
    };

    socket.on("undoRequest", handleUndoRequest);
    socket.on("undoUpdate", handleUndoUpdate);
    socket.on("undoCancelled", handleUndoCancelled);
    socket.on("undoConfirmed", handleUndoConfirmed);

    return () => {
      socket.off("undoRequest", handleUndoRequest);
      socket.off("undoUpdate", handleUndoUpdate);
      socket.off("undoCancelled", handleUndoCancelled);
      socket.off("undoConfirmed", handleUndoConfirmed);
    };
  }, [safeView?.id, undoRequestData?.undoId]);

  // Listen for undo count updates
  React.useEffect(() => {
    const handleUndoCountUpdate = (payload: { gameId: string; eventCount: number }) => {
      if (payload.gameId === safeView?.id) {
        setAvailableUndoCount(payload.eventCount);
      }
    };

    const handleUndoTurnPhaseTargetsUpdate = (payload: {
      gameId: string;
      targets?: Array<{
        turnNumber?: number;
        phase: string;
        step?: string;
        turnPlayer?: string;
        turnPlayerName?: string;
        round?: number;
        label: string;
        eventsToUndo: number;
      }>;
    }) => {
      if (payload.gameId === safeView?.id) {
        setUndoTurnPhaseTargets(Array.isArray(payload.targets) ? payload.targets : []);
      }
    };

    const handleSmartUndoCountsUpdate = (payload: { 
      gameId: string; 
      stepCount: number; 
      phaseCount: number; 
      previousPhaseCount: number;
      turnCount: number;
      semanticStepCount?: number;
      semanticPhaseCount?: number;
      previews?: {
        step?: UndoBoundaryPreview;
        phase?: UndoBoundaryPreview;
        previousPhase?: UndoBoundaryPreview;
        turn?: UndoBoundaryPreview;
      };
    }) => {
      if (payload.gameId === safeView?.id) {
        setSmartUndoCounts({
          stepCount: payload.stepCount,
          phaseCount: payload.phaseCount,
          previousPhaseCount: payload.previousPhaseCount,
          turnCount: payload.turnCount,
          semanticStepCount: payload.semanticStepCount,
          semanticPhaseCount: payload.semanticPhaseCount,
          previews: payload.previews || {},
        });
      }
    };

    socket.on("undoCountUpdate", handleUndoCountUpdate);
    socket.on("smartUndoCountsUpdate", handleSmartUndoCountsUpdate);
    socket.on("undoTurnPhaseTargetsUpdate", handleUndoTurnPhaseTargetsUpdate);

    return () => {
      socket.off("undoCountUpdate", handleUndoCountUpdate);
      socket.off("smartUndoCountsUpdate", handleSmartUndoCountsUpdate);
      socket.off("undoTurnPhaseTargetsUpdate", handleUndoTurnPhaseTargetsUpdate);
    };
  }, [safeView?.id]);

  // AI control socket event handlers
  React.useEffect(() => {
    const handleAiControlToggled = (payload: { 
      gameId: string; 
      playerId: string; 
      enabled: boolean;
      strategy?: string;
      difficulty?: number;
    }) => {
      if (payload.gameId === safeView?.id && payload.playerId === you) {
        setAiControlEnabled(payload.enabled);
        if (payload.strategy) {
          setAiStrategy(payload.strategy);
        }
      }
    };

    socket.on("aiControlToggled", handleAiControlToggled);

    return () => {
      socket.off("aiControlToggled", handleAiControlToggled);
    };
  }, [safeView?.id, you]);

}
