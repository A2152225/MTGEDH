// Origin parent: client/src/App.tsx
// Cluster moved: name-in-use through game-over overlays
// Public entry symbols: renderAppPlayOverlaysCombat.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import { socket } from "../socket";
import type { BattlefieldPermanent, PlayerRef } from "../../../shared/src";
import { debug } from "../utils/debug";
import { FatesealModal } from "../components/FatesealModal";
import { ClashModal } from "../components/ClashModal";
import { VoteModal } from "../components/VoteModal";
import { CastSpellModal } from "../components/CastSpellModal";
import { AssistRequestButton } from "../components/AssistRequestButton";
import { CombatSelectionModal, type AttackerSelection, type BlockerSelection } from "../components/CombatSelectionModal";
import { CombatControlModal } from "../components/CombatControlModal";
import { expandGroupedTokensForDisplay } from "../utils/expandGroupedTokens";
import { ReturnControlledPermanentChoiceModal } from "../components/ReturnControlledPermanentChoiceModal";
import { CardSelectionModal } from "../components/CardSelectionModal";
import { ProliferateModal } from "../components/ProliferateModal";
import { LifeRedistributionModal } from "../components/LifeRedistributionModal";
import { AppearanceSettingsModal } from "../components/AppearanceSettingsModal";
import { XValueSelectionModal } from "../components/XValueSelectionModal";
import { CreateGameModal } from "../components/CreateGameModal";
import { DeckManagerModal } from "../components/DeckManagerModal";
import { MoveLocalDecksModal } from "../components/MoveLocalDecksModal";
import NameInUseModal from "../components/NameInUseModal";

export function renderAppPlayOverlaysCombat(p: Record<string, any>) {
  const {
    appearanceModalOpen,
    attackingCreatures,
    battlefieldAlternateCosts,
    castSpellModalOpen,
    castSpellPaymentSources,
    clashData,
    clashModalOpen,
    combatControlEffect,
    combatControlModalOpen,
    combatControlMode,
    combatModalAttackersAvailableCreatures,
    combatModalAttackersDefenders,
    combatModalError,
    combatModalInitialAttackTargets,
    combatModalMinimized,
    combatModalOpen,
    combatModalReadOnly,
    combatMode,
    combatPreviewAttackTargets,
    combatPreviewEmitTimerRef,
    combatPreviewPendingRef,
    createGameModalOpen,
    deckBuilderInitialAction,
    deckBuilderOpen,
    defenderInfoMap,
    defenders,
    fatesealData,
    fatesealModalOpen,
    gameIdInput,
    gameOverData,
    gameOverModalOpen,
    handleAppearanceSettingsApply,
    handleCastSpellCancel,
    handleCastSpellConfirm,
    handleClashConfirm,
    handleCreateGame,
    handleDeclareAttackers,
    handleDeclareBlockers,
    handleDeclareControlledCombat,
    handleFatesealConfirm,
    handleHideawayChoiceCancel,
    handleHideawayChoiceConfirm,
    handleLifeRedistributionConfirm,
    handleProliferateConfirm,
    handleReturnControlledPermanentSelect,
    handleSkipCombat,
    handleVoteConfirm,
    hideawayChoiceData,
    hideawayChoiceModalOpen,
    imagePref,
    lifeRedistributionData,
    lifeRedistributionModalOpen,
    manaPool,
    myBlockerCreatures,
    myCreatures,
    nameInUsePayload,
    nameInput,
    authSession,
    pendingSpellXSelection,
    proliferateData,
    proliferateModalOpen,
    refreshSavedDecks,
    resolutionPromptOpen,
    returnControlledPermanentData,
    returnControlledPermanentModalOpen,
    safeView,
    savedDecks,
    setAppearanceModalOpen,
    setCombatModalMinimized,
    setCreateGameModalOpen,
    setDeckBuilderInitialAction,
    setDeckBuilderOpen,
    setFatesealData,
    setFatesealModalOpen,
    setNameInUsePayload,
    setNameInput,
    setPendingSpellXSelection,
    setShowNameInUseModal,
    showNameInUseModal,
    spellToCast,
    view,
    voteData,
    voteModalOpen,
    you,
  } = p;
  return (
    <>
      {/* Name-in-use */}
      <NameInUseModal
        open={showNameInUseModal}
        payload={nameInUsePayload}
        onClose={() => {
          setShowNameInUseModal(false);
          setNameInUsePayload(null);
        }}
        onReconnect={(fixedPlayerId: string, seatToken?: string) => {
          const gid = nameInUsePayload?.gameId || gameIdInput;
          const pname = nameInUsePayload?.playerName || nameInput;
          const token =
            seatToken ??
            sessionStorage.getItem(`mtgedh:seatToken:${gid}:${pname}`);
          // eslint-disable-next-line no-console
          console.debug("[JOIN_EMIT] reconnect click", {
            gameId: gid,
            playerName: pname,
            fixedPlayerId,
            seatToken: token,
          });
          socket.emit("joinGame", {
            gameId: gid,
            playerName: pname,
            spectator: false, // Always join as player when reconnecting
            seatToken: token || undefined,
            fixedPlayerId,
          });
          setShowNameInUseModal(false);
          setNameInUsePayload(null);
        }}
        onNewName={(newName: string) => {
          const gid = nameInUsePayload?.gameId || gameIdInput;
          setNameInput(newName);
          const token =
            sessionStorage.getItem(
              `mtgedh:seatToken:${gid}:${newName}`
            ) || undefined;
          // eslint-disable-next-line no-console
          console.debug("[JOIN_EMIT] new-name join", {
            gameId: gid,
            playerName: newName,
            seatToken: token,
          });
          socket.emit("joinGame", {
            gameId: gid,
            playerName: newName,
            spectator: false, // Always join as player when using new name
            seatToken: token,
          });
          setShowNameInUseModal(false);
          setNameInUsePayload(null);
        }}
      />

      {/* Cast Spell Payment Modal */}
      <CastSpellModal
        open={castSpellModalOpen}
        cardName={spellToCast?.cardName || ''}
        manaCost={spellToCast?.manaCost}
        typeLine={spellToCast?.typeLine}
        isActivatedAbilityPayment={spellToCast?.isActivatedAbilityPayment === true}
        castFromZone={spellToCast?.fromZone ?? 'hand'}
        oracleText={spellToCast?.oracleText}
        forcedAlternateCostId={spellToCast?.forcedAlternateCostId}
        preferredAlternateCostId={(spellToCast as any)?.preferredAlternateCostId}
        extraAlternateCosts={spellToCast?.extraAlternateCosts ?? battlefieldAlternateCosts}
        availableSources={castSpellPaymentSources}
        battlefieldPermanents={you ? ((safeView?.battlefield || []).filter((perm: any) => perm.controller === you) as BattlefieldPermanent[]) : []}
        otherCardsInHand={useMemo(() => {
          if (!safeView || !you || !spellToCast) return [];
          const zones = safeView.zones?.[you];
          const hand = zones?.hand || [];
          // Filter out the card being cast and lands
          return hand
            .filter((c: any) => c?.id !== spellToCast.cardId && c?.name && !(/\bland\b/i.test(c?.type_line || '')))
            .map((c: any) => ({
              id: c.id,
              name: c.name,
              mana_cost: c.mana_cost
            }));
        }, [safeView, you, spellToCast])}
        floatingMana={manaPool || undefined}
        title={spellToCast?.title}
        confirmLabel={spellToCast?.confirmLabel}
        manualFloatingManaSelection={spellToCast?.manualFloatingManaSelection === true}
        initialXValue={spellToCast?.xValue}
        costAdjustment={spellToCast?.costAdjustment}
        convokeOptions={spellToCast?.convokeOptions}
        sneakOptions={spellToCast?.sneakOptions}
        webSlingingOptions={(spellToCast as any)?.webSlingingOptions}
        currentStep={String((safeView as any)?.step || '')}
        onConfirm={handleCastSpellConfirm}
        onCancel={handleCastSpellCancel}
      />
      <AssistRequestButton
        key={String(spellToCast?.effectId || 'none')}
        open={castSpellModalOpen && !spellToCast?.isCommander}
        gameId={safeView?.id}
        effectId={spellToCast?.effectId}
        oracleText={spellToCast?.oracleText}
        you={you || undefined}
        players={((safeView as any)?.players || []) as Array<{ id: string; name?: string }>}
      />

      <XValueSelectionModal
        isOpen={resolutionPromptOpen(pendingSpellXSelection !== null, pendingSpellXSelection?.stepId)}
        cardName={pendingSpellXSelection?.cardName || ''}
        abilityText={pendingSpellXSelection?.description}
        minValue={pendingSpellXSelection?.minValue ?? 0}
        maxValue={pendingSpellXSelection?.maxValue ?? 20}
        xCount={pendingSpellXSelection?.xCount}
        affordableXHint={pendingSpellXSelection?.affordableXHint}
        costPerX={pendingSpellXSelection?.costPerX}
        selectionLabel={/replicate/i.test(pendingSpellXSelection?.description || '') ? 'Replicate' : undefined}
        onSelect={(xValue) => {
          if (!safeView || !pendingSpellXSelection) return;
          socket.emit('submitResolutionResponse', {
            gameId: safeView.id,
            stepId: pendingSpellXSelection.stepId,
            selections: { xValue },
            cancelled: false,
          });
          setPendingSpellXSelection(null);
        }}
        onClose={() => {
          setPendingSpellXSelection(null);
        }}
        onCancel={() => {
          if (!safeView || !pendingSpellXSelection) {
            setPendingSpellXSelection(null);
            return;
          }
          socket.emit('cancelResolutionStep', {
            gameId: safeView.id,
            stepId: pendingSpellXSelection.stepId,
          });
          setPendingSpellXSelection(null);
        }}
      />

      {/* Create Game Modal */}
      <CreateGameModal
        open={createGameModalOpen}
        onClose={() => setCreateGameModalOpen(false)}
        onCreateGame={handleCreateGame}
        savedDecks={savedDecks}
        onRefreshDecks={refreshSavedDecks}
        accountDisplayName={authSession?.user?.displayName}
      />

      {/* Standalone Deck Builder Modal */}
      <DeckManagerModal
        open={deckBuilderOpen}
        onClose={() => setDeckBuilderOpen(false)}
        onImportText={(text, name) => {
          // In standalone mode, we just close the modal
          // The deck is saved locally or to server within the modal
          setDeckBuilderOpen(false);
        }}
        gameId={safeView?.id}
        playerId={you ?? undefined}
        playerName={nameInput || undefined}
        canServer={true}
        accountUser={authSession?.user ?? null}
        wide
        initialAction={deckBuilderInitialAction}
        onInitialActionConsumed={() => setDeckBuilderInitialAction(null)}
      />

      <MoveLocalDecksModal
        open={!!authSession?.moveLocalDecksOpen && !!authSession?.user}
        onClose={() => authSession?.setMoveLocalDecksOpen(false)}
      />

      {/* Appearance Settings Modal */}
      <AppearanceSettingsModal
        open={appearanceModalOpen}
        onClose={() => setAppearanceModalOpen(false)}
        onApply={handleAppearanceSettingsApply}
      />

      {/* Combat Selection Modal */}
      <CombatSelectionModal
        open={combatModalOpen && !!safeView}
        minimized={combatModalMinimized}
        onMinimize={() => setCombatModalMinimized(true)}
        onRestore={() => setCombatModalMinimized(false)}
        mode={combatMode}
        readOnly={combatModalReadOnly}
        availableCreatures={
          combatMode === 'attackers'
            ? (combatModalReadOnly ? combatModalAttackersAvailableCreatures : myCreatures)
            : (combatModalReadOnly ? [] : myBlockerCreatures)
        }
        attackingCreatures={attackingCreatures}
        battlefield={(safeView?.battlefield || []) as BattlefieldPermanent[]}
        players={(safeView?.players || []) as PlayerRef[]}
        zones={(safeView as any)?.zones}
        defenders={combatMode === 'attackers' && combatModalReadOnly ? combatModalAttackersDefenders : defenders}
        initialAttackTargets={
          combatMode === 'attackers' && combatModalReadOnly
            ? (combatPreviewAttackTargets ?? combatModalInitialAttackTargets)
            : undefined
        }
        onAttackTargetsChange={
          combatMode === 'attackers' && !combatModalReadOnly && safeView?.id
            ? (targets) => {
                // Throttle to reduce spam while still feeling real-time.
                combatPreviewPendingRef.current = targets;
                if (combatPreviewEmitTimerRef.current) return;
                combatPreviewEmitTimerRef.current = setTimeout(() => {
                  const pending = combatPreviewPendingRef.current;
                  combatPreviewEmitTimerRef.current = null;
                  combatPreviewPendingRef.current = null;
                  if (!pending) return;
                  socket.emit('combatPreviewAttackers', { gameId: safeView.id, targets: pending });
                }, 120);
              }
            : undefined
        }
        errorMessage={combatModalError}
        isYourTurn={safeView != null && safeView.turnPlayer != null && safeView.turnPlayer === you}
        defenderInfoMap={combatMode === 'attackers' ? defenderInfoMap : undefined}
        onConfirm={(selections) => {
          if (combatMode === 'attackers') {
            handleDeclareAttackers(selections as AttackerSelection[]);
          } else {
            handleDeclareBlockers(selections as BlockerSelection[]);
          }
        }}
        onSkip={handleSkipCombat}
        // Minimize (not close) so the player can reopen during the same combat step
        onCancel={
          combatModalOpen && !combatModalReadOnly
            ? () => setCombatModalMinimized(true)
            : undefined
        }
      />

      {/* Combat Control Modal (Master Warcraft / Odric) */}
      {safeView && you && combatControlEffect && (
        <CombatControlModal
          open={combatControlModalOpen && combatControlEffect.controllerId === you}
          mode={combatControlMode}
          combatControl={combatControlEffect}
          allCreatures={expandGroupedTokensForDisplay((safeView.battlefield || []) as BattlefieldPermanent[])}
          currentAttackers={attackingCreatures as BattlefieldPermanent[]}
          defenders={combatModalAttackersDefenders as any}
          players={(safeView.players || []) as any}
          currentPlayerId={you}
          onConfirm={handleDeclareControlledCombat}
        />
      )}

      {/* Return Controlled Permanent Modal */}
      <ReturnControlledPermanentChoiceModal
        open={resolutionPromptOpen(returnControlledPermanentModalOpen, returnControlledPermanentData?.stepId)}
        sourceName={returnControlledPermanentData?.sourceName || ''}
        sourceImageUrl={returnControlledPermanentData?.imageUrl}
        optionsToChoose={(returnControlledPermanentData?.optionsToChoose || []).map((option) => {
          const permanent = ((safeView?.battlefield || []) as BattlefieldPermanent[]).find(
            (entry) => String(entry.id) === String(option.permanentId),
          );
          if (!permanent) return option;
          return { ...option, tapped: permanent.tapped === true };
        })}
        title={returnControlledPermanentData?.title}
        subtitle={returnControlledPermanentData?.subtitle}
        oracleText={returnControlledPermanentData?.oracleText}
        confirmButtonText={returnControlledPermanentData?.confirmButtonText}
        onSelectPermanent={handleReturnControlledPermanentSelect}
      />

      <CardSelectionModal
        key={`${hideawayChoiceData?.stepId || 'hideaway'}-${hideawayChoiceData?.pendingDraftCardId || 'card'}`}
        open={resolutionPromptOpen(hideawayChoiceModalOpen, hideawayChoiceData?.stepId)}
        title={hideawayChoiceData?.title || 'Hideaway'}
        subtitle={hideawayChoiceData?.subtitle}
        sourceCardName={hideawayChoiceData?.sourceName}
        sourceCardImageUrl={hideawayChoiceData?.imageUrl}
        oracleText={hideawayChoiceData?.oracleText}
        options={((hideawayChoiceData?.attachOptions || hideawayChoiceData?.cards || []) as any[]).map((card: any) => ({
          id: card.cardId || card.id,
          name: card.cardName || card.name,
          imageUrl: card.imageUrl,
          description: card.description || undefined,
        }))}
        minSelections={1}
        maxSelections={1}
        confirmButtonText={hideawayChoiceData?.confirmButtonText || 'Hide Away Selected Card'}
        canCancel={hideawayChoiceData?.mandatory === false}
        onConfirm={handleHideawayChoiceConfirm}
        onCancel={handleHideawayChoiceCancel}
      />

      {/* Proliferate Modal */}
      <ProliferateModal
        open={resolutionPromptOpen(proliferateModalOpen, proliferateData?.stepId)}
        sourceName={proliferateData?.sourceName || ''}
        imageUrl={proliferateData?.imageUrl}
        validTargets={proliferateData?.validTargets || []}
        onConfirm={handleProliferateConfirm}
      />

      <LifeRedistributionModal
        open={resolutionPromptOpen(lifeRedistributionModalOpen, lifeRedistributionData?.stepId)}
        sourceName={lifeRedistributionData?.sourceName || 'Redistribute Life Totals'}
        imageUrl={lifeRedistributionData?.imageUrl}
        players={lifeRedistributionData?.players || []}
        onConfirm={handleLifeRedistributionConfirm}
      />
      
      {/* Fateseal Modal */}
      {fatesealModalOpen && fatesealData && view && resolutionPromptOpen(true, fatesealData.stepId) && (
        <FatesealModal
          opponentName={fatesealData.opponentName}
          cards={fatesealData.cards}
          imagePref={imagePref}
          sourceName={fatesealData.sourceName}
          onCancel={() => {
            setFatesealModalOpen(false);
            setFatesealData(null);
          }}
          onConfirm={handleFatesealConfirm}
        />
      )}
      
      {/* Clash Modal */}
      {clashModalOpen && clashData && view && resolutionPromptOpen(true, clashData.stepId) && (
        <ClashModal
          revealedCard={clashData.revealedCard}
          imagePref={imagePref}
          sourceName={clashData.sourceName}
          opponentName={clashData.opponentId ? safeView?.players?.find((p: any) => p.id === clashData.opponentId)?.name : undefined}
          onConfirm={handleClashConfirm}
        />
      )}
      
      {/* Vote Modal */}
      {voteModalOpen && voteData && view && (
        <VoteModal
          open={resolutionPromptOpen(voteModalOpen, voteData?.stepId)}
          sourceName={voteData.sourceName}
          choices={voteData.choices}
          votesSubmitted={voteData.votesSubmitted}
          playerNames={useMemo(() => {
            const names: Record<string, string> = {};
            safeView?.players?.forEach((p: any) => {
              names[p.id] = p.username || p.id;
            });
            return names;
          }, [safeView?.players])}
          onConfirm={handleVoteConfirm}
        />
      )}

      {/* Game Over Overlay */}
      {gameOverModalOpen && gameOverData && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            style={{
              textAlign: 'center',
              color: gameOverData.type === 'victory' ? '#ffd700' : 
                     gameOverData.type === 'draw' ? '#60a5fa' : '#ef4444',
              transform: 'scale(1)',
              opacity: 1,
            }}
          >
            <div
              style={{
                fontSize: gameOverData.type === 'victory' ? '5rem' : '4rem',
                fontWeight: 'bold',
                textShadow: gameOverData.type === 'victory' 
                  ? '0 0 30px rgba(255, 215, 0, 0.8), 0 0 60px rgba(255, 215, 0, 0.4)'
                  : gameOverData.type === 'draw'
                  ? '0 0 30px rgba(96, 165, 250, 0.8)'
                  : '0 0 30px rgba(239, 68, 68, 0.8)',
                marginBottom: '1rem',
              }}
            >
              {gameOverData.type === 'victory' ? '🏆' : 
               gameOverData.type === 'draw' ? '🤝' : '💀'}
            </div>
            <div
              style={{
                fontSize: '3rem',
                fontWeight: 'bold',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              {gameOverData.message}
            </div>
            {gameOverData.winnerName && gameOverData.type !== 'victory' && (
              <div
                style={{
                  fontSize: '1.5rem',
                  marginTop: '1rem',
                  opacity: 0.8,
                }}
              >
                Winner: {gameOverData.winnerName}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
