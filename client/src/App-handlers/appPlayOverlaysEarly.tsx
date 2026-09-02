// Origin parent: client/src/App.tsx
// Cluster moved: early play overlays (PhaseNavigator through player-choice modal).
// Public entry symbols: renderAppPlayOverlaysEarly.
// Leaf must not import App.tsx or App-handlers/index.ts.

import { socket } from "../socket";
import { CommanderSelectModal } from "../components/CommanderSelectModal";
import CommanderConfirmModal from "../components/CommanderConfirmModal";
import { ScrySurveilModal } from "../components/ScrySurveilModal";
import { ExploreModal } from "../components/ExploreModal";
import { BatchExploreModal } from "../components/BatchExploreModal";
import { OpponentMayPayModal } from "../components/OpponentMayPayModal";
import { LoopShortcutConsentModal } from "../components/LoopShortcutConsentModal";
import { TapUntapTargetModal } from "../components/TapUntapTargetModal";
import { CounterMovementModal } from "../components/CounterMovementModal";
import { StationCreatureSelectionModal } from "../components/StationCreatureSelectionModal";
import { PlayerTargetSelectionModal } from "../components/PlayerTargetSelectionModal";
import { bottomOrderIdsFromPeekConfirm } from "../utils/bottomOrderConfirm";

export function renderAppPlayOverlaysEarly(p: Record<string, any>) {
  const {
    allPlayersHaveDecks,
    allPlayersKeptHands,
    batchExploreIndividual,
    batchExplorePrompt,
    cmdModalOpen,
    cmdSuggestedGameId,
    cmdSuggestedNames,
    confirmOpen,
    confirmPayload,
    confirmVotes,
    counterMovementModalData,
    counterMovementModalOpen,
    damageReplacementEffectActiveCount,
    damageReplacementMode,
    setDamageReplacementMode,
    setReplacementEffectSettingsOpen,
    debugData,
    debugLoading,
    debugOpen,
    effectiveGameId,
    explorePrompt,
    fetchDebug,
    fightTargetModalData,
    fightTargetModalOpen,
    handleCommanderConfirm,
    imagePref,
    importedCandidates,
    loopShortcutConsentPrompt,
    opponentMayPayPrompt,
    opponentMayPayStepId,
    peek,
    phaseAdvanceBlockReason,
    priority,
    resolutionPlayerChoiceModalData,
    resolutionPlayerChoiceModalOpen,
    resolutionPlayerNames,
    resolutionPromptOpen,
    respondToConfirm,
    safeView,
    setBatchExploreIndividual,
    setBatchExplorePrompt,
    setCmdModalOpen,
    setCounterMovementModalData,
    setCounterMovementModalOpen,
    setDebugOpen,
    setExplorePrompt,
    setFightTargetModalData,
    setFightTargetModalOpen,
    setLoopShortcutConsentPrompt,
    setOpponentMayPayPrompt,
    setOpponentMayPayStepId,
    setPeek,
    setPhaseNavigatorAdvancing,
    setResolutionPlayerChoiceModalData,
    setResolutionPlayerChoiceModalOpen,
    setStationCreatureSelectionData,
    setStationCreatureSelectionOpen,
    setTapUntapTargetModalData,
    setTapUntapTargetModalOpen,
    showCommanderGallery,
    showMobileChrome,
    showUtilityRail,
    stationCreatureSelectionData,
    stationCreatureSelectionOpen,
    tapUntapTargetModalData,
    tapUntapTargetModalOpen,
    view,
    you,
  } = p;
  return (
    <>
      {/* Commander selection UI */}
      {effectiveGameId &&
        cmdModalOpen &&
        cmdSuggestedGameId === effectiveGameId &&
        (showCommanderGallery ? (
          <CommanderSelectModal
            open={cmdModalOpen}
            onClose={() => setCmdModalOpen(false)}
            deckList={importedCandidates.map((c: any) => c.name).join("\n")}
            candidates={importedCandidates}
            max={2}
            onConfirm={(names, ids) => {
              handleCommanderConfirm(names, ids);
              setCmdModalOpen(false);
            }}
          />
        ) : (
          <CommanderConfirmModal
            open={cmdModalOpen}
            gameId={effectiveGameId}
            initialNames={cmdSuggestedNames}
            onClose={() => setCmdModalOpen(false)}
            onConfirm={(names) => {
              handleCommanderConfirm(names);
              setCmdModalOpen(false);
            }}
          />
        ))}

      {/* Debug modal */}
      {debugOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
            zIndex: 6000,
          }}
        >
          <div
            style={{
              width: 900,
              maxHeight: "80vh",
              overflow: "auto",
              background: "#1e1e1e",
              color: "#fff",
              padding: 12,
              borderRadius: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <strong>Debug Output</strong>
              <div>
                <button
                  onClick={() => {
                    setDebugOpen(false);
                  }}
                >
                  Close
                </button>
                <button
                  onClick={() => fetchDebug()}
                  disabled={debugLoading}
                  style={{ marginLeft: 8 }}
                >
                  Refresh
                </button>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {debugLoading ? (
                <div>Loading...</div>
              ) : (
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 11,
                  }}
                >
                  {JSON.stringify(debugData, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import / Judge confirmation modal */}
      {confirmOpen && confirmPayload && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
            zIndex: 7000,
          }}
        >
          <div
            style={{
              width: 560,
              background: "#1e1e1e",
              color: "#fff",
              padding: 16,
              borderRadius: 8,
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              {confirmPayload.kind === "judge"
                ? "Judge request"
                : "Confirm importing deck (wipes table)"}
            </h3>
            <div
              style={{
                fontSize: 13,
                opacity: 0.9,
                marginBottom: 8,
              }}
            >
              {confirmPayload.kind === "judge" ? (
                <>
                  Player <strong>{confirmPayload.initiator}</strong> is
                  requesting to become judge (full hand visibility). All active
                  players must approve.
                </>
              ) : (
                <>
                  Player <strong>{confirmPayload.initiator}</strong> is
                  importing a deck
                  {confirmPayload.deckName
                    ? `: ${confirmPayload.deckName}`
                    : ""}
                  .
                </>
              )}
            </div>

            {confirmPayload.kind !== "judge" && (
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 8,
                }}
              >
                <div>Resolved cards: {confirmPayload.resolvedCount}</div>
                <div>Declared deck size: {confirmPayload.expectedCount}</div>
              </div>
            )}

            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Votes</div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {confirmVotes ? (
                  Object.entries(confirmVotes).map(([pid, v]) => (
                    <div
                      key={pid}
                      style={{
                        padding: 8,
                        background: "#0f0f0f",
                        borderRadius: 6,
                        minWidth: 120,
                      }}
                    >
                      <div style={{ fontSize: 12 }}>
                        {safeView?.players?.find((p: any) => p.id === pid)
                          ?.name ?? pid}
                        {pid === you ? " (you)" : ""}
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          color:
                            v === "yes"
                              ? "#8ef58e"
                              : v === "no"
                              ? "#f58e8e"
                              : "#ddd",
                        }}
                      >
                        {String(v)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div>No votes yet</div>
                )}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                onClick={() => {
                  // only dismiss locally; actual cancel must come from server
                  // to keep everyone in sync
                }}
              >
                Dismiss
              </button>
              <button
                onClick={() => respondToConfirm(false)}
                style={{ background: "#a00", color: "#fff" }}
              >
                Decline
              </button>
              <button
                onClick={() => respondToConfirm(true)}
                style={{ background: "#0a8", color: "#fff" }}
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scry/Surveil */}
      {peek && resolutionPromptOpen(true, peek.stepId) && (
        <ScrySurveilModal
          key={`${peek.mode}-${peek.stepId || 'peek'}`}
          mode={peek.mode}
          cards={peek.cards}
          imagePref={imagePref}
          onCancel={() => setPeek(null)}
          onConfirm={(res) => {
            if (!view) return;
            
            // Use the resolution queue system
            if (!peek.stepId) {
              console.error('[Scry/Surveil] Missing stepId - must use resolution queue');
              return;
            }

            const selections =
              peek.mode === "bottom_order"
                ? { bottomOrder: bottomOrderIdsFromPeekConfirm(res) }
                : peek.mode === "scry"
                  ? { keepTopOrder: res.keepTopOrder || [], bottomOrder: res.bottomOrder || [] }
                  : { keepTopOrder: res.keepTopOrder || [], toGraveyard: res.toGraveyard || [] };
            
            socket.emit("submitResolutionResponse", {
              gameId: view.id,
              stepId: peek.stepId,
              selections,
              cancelled: false,
            });
            
            setPeek(null);
          }}
        />
      )}

      {/* Explore */}
      {explorePrompt && view && resolutionPromptOpen(true, explorePrompt.stepId) && (
        <ExploreModal
          exploringCreature={{
            id: explorePrompt.permanentId,
            name: explorePrompt.permanentName,
          }}
          revealedCard={explorePrompt.revealedCard}
          isLand={explorePrompt.isLand}
          imagePref={imagePref}
          onConfirm={(result) => {
            if (!explorePrompt.stepId) {
              console.warn('[Explore] Missing stepId - must use resolution queue');
              return;
            }

            // If we're resolving a batch explore individually, accumulate decisions client-side
            // and submit them all at the end.
            if (batchExploreIndividual && batchExploreIndividual.stepId === explorePrompt.stepId) {
              const nextDecisions = [...batchExploreIndividual.decisions, {
                permanentId: explorePrompt.permanentId,
                toGraveyard: Boolean(result.toGraveyard),
              }];

              const nextIndex = batchExploreIndividual.index + 1;
              if (nextIndex < batchExploreIndividual.explores.length) {
                const nextExplore = batchExploreIndividual.explores[nextIndex];
                setBatchExploreIndividual({
                  ...batchExploreIndividual,
                  decisions: nextDecisions,
                  index: nextIndex,
                });
                setExplorePrompt({
                  stepId: batchExploreIndividual.stepId,
                  permanentId: nextExplore.permanentId,
                  permanentName: nextExplore.permanentName,
                  revealedCard: nextExplore.revealedCard,
                  isLand: nextExplore.isLand,
                });
                return;
              }

              socket.emit('submitResolutionResponse', {
                gameId: view.id,
                stepId: batchExploreIndividual.stepId,
                selections: { decisions: nextDecisions },
                cancelled: false,
              });

              setBatchExploreIndividual(null);
              setExplorePrompt(null);
              return;
            }

            // Single explore step
            socket.emit('submitResolutionResponse', {
              gameId: view.id,
              stepId: explorePrompt.stepId,
              selections: {
                permanentId: explorePrompt.permanentId,
                toGraveyard: Boolean(result.toGraveyard),
              },
              cancelled: false,
            });

            setExplorePrompt(null);
          }}
        />
      )}

      {/* Batch Explore */}
      {batchExplorePrompt && view && resolutionPromptOpen(true, batchExplorePrompt.stepId) && (
        <BatchExploreModal
          explores={batchExplorePrompt.explores}
          imagePref={imagePref}
          onResolveAll={(decisions) => {
            if (!batchExplorePrompt.stepId) {
              console.warn('[BatchExplore] Missing stepId - must use resolution queue');
              return;
            }

            socket.emit('submitResolutionResponse', {
              gameId: view.id,
              stepId: batchExplorePrompt.stepId,
              selections: { decisions },
              cancelled: false,
            });
            setBatchExplorePrompt(null);
          }}
          onResolveIndividually={() => {
            if (!batchExplorePrompt.stepId) {
              console.warn('[BatchExplore] Missing stepId - must use resolution queue');
              return;
            }

            // Resolve locally one-by-one, then submit once.
            const explores = batchExplorePrompt.explores || [];
            if (explores.length > 0) {
              setBatchExploreIndividual({
                stepId: batchExplorePrompt.stepId,
                explores,
                index: 0,
                decisions: [],
              });

              const firstExplore = explores[0];
              setExplorePrompt({
                stepId: batchExplorePrompt.stepId,
                permanentId: firstExplore.permanentId,
                permanentName: firstExplore.permanentName,
                revealedCard: firstExplore.revealedCard,
                isLand: firstExplore.isLand,
              });
            }
            setBatchExplorePrompt(null);
          }}
        />
      )}

      {/* Opponent May Pay */}
      {opponentMayPayPrompt && view && resolutionPromptOpen(true, opponentMayPayStepId) && (
        <OpponentMayPayModal
          prompt={opponentMayPayPrompt}
          onPay={() => {
            if (!opponentMayPayStepId) {
              console.warn('[opponentMayPay] Missing resolution stepId; cannot submit response.');
              return;
            }
            socket.emit('submitResolutionResponse', {
              gameId: view.id,
              stepId: opponentMayPayStepId,
              selections: 'pay',
              cancelled: false,
            });
            setOpponentMayPayPrompt(null);
            setOpponentMayPayStepId(null);
          }}
          onDecline={() => {
            if (!opponentMayPayStepId) {
              console.warn('[opponentMayPay] Missing resolution stepId; cannot submit response.');
              return;
            }
            socket.emit('submitResolutionResponse', {
              gameId: view.id,
              stepId: opponentMayPayStepId,
              selections: 'decline',
              cancelled: false,
            });
            setOpponentMayPayPrompt(null);
            setOpponentMayPayStepId(null);
          }}
          onSetShortcut={(preference) => {
            socket.emit("setOpponentMayPayShortcut", {
              gameId: view.id,
              sourceName: opponentMayPayPrompt.sourceName,
              preference,
            });
            setOpponentMayPayPrompt(null);
            setOpponentMayPayStepId(null);
          }}
        />
      )}

      <LoopShortcutConsentModal
        prompt={loopShortcutConsentPrompt}
        onAllow={() => {
          if (!loopShortcutConsentPrompt) return;
          socket.emit('respondLoopShortcut', {
            gameId: loopShortcutConsentPrompt.gameId,
            proposalId: loopShortcutConsentPrompt.proposalId,
            interrupt: false,
          });
          setLoopShortcutConsentPrompt(null);
        }}
        onInterrupt={(afterIterations) => {
          if (!loopShortcutConsentPrompt) return;
          socket.emit('respondLoopShortcut', {
            gameId: loopShortcutConsentPrompt.gameId,
            proposalId: loopShortcutConsentPrompt.proposalId,
            interrupt: true,
            afterIterations,
          });
          setLoopShortcutConsentPrompt(null);
        }}
      />

      {/* Tap/Untap Target Modal - for abilities that tap/untap targets */}
      <TapUntapTargetModal
        open={resolutionPromptOpen(tapUntapTargetModalOpen, tapUntapTargetModalData?.stepId)}
        title={tapUntapTargetModalData?.title || tapUntapTargetModalData?.sourceName || "Tap/Untap Target"}
        description={tapUntapTargetModalData?.description}
        source={{
          id: tapUntapTargetModalData?.sourceId || "",
          name: tapUntapTargetModalData?.sourceName || "",
          imageUrl: tapUntapTargetModalData?.sourceImageUrl,
        }}
        action={tapUntapTargetModalData?.action || 'untap'}
        targetFilter={tapUntapTargetModalData?.targetFilter || {}}
        targetCount={tapUntapTargetModalData?.targetCount || 1}
        availablePermanents={safeView?.battlefield || []}
        playerId={you || ""}
        playerNames={resolutionPlayerNames}
        onConfirm={(selectedPermanentIds, action) => {
          if (tapUntapTargetModalData && safeView) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: tapUntapTargetModalData.stepId,
              selections: { targetIds: selectedPermanentIds, action },
              cancelled: false,
            });
            setTapUntapTargetModalOpen(false);
            setTapUntapTargetModalData(null);
          }
        }}
        onCancel={() => {
          if (tapUntapTargetModalData && safeView) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: tapUntapTargetModalData.stepId,
            });
          }
          setTapUntapTargetModalOpen(false);
          setTapUntapTargetModalData(null);
        }}
      />

      {/* Fight Target Modal - for Brash Taunter and similar fight abilities */}
      <TapUntapTargetModal
        open={resolutionPromptOpen(fightTargetModalOpen, fightTargetModalData?.stepId)}
        title={fightTargetModalData?.title || `${fightTargetModalData?.sourceName || 'Creature'} - Fight`}
        description={fightTargetModalData?.description}
        source={{
          id: fightTargetModalData?.sourceId || "",
          name: fightTargetModalData?.sourceName || "",
          imageUrl: fightTargetModalData?.sourceImageUrl,
        }}
        action='tap' // Reuse tap UI but it's for fight selection
        targetFilter={{
          types: (fightTargetModalData?.targetFilter?.types || ['creature']) as ('creature' | 'land' | 'artifact' | 'enchantment' | 'planeswalker' | 'permanent')[],
          controller: fightTargetModalData?.targetFilter?.controller || 'any',
          tapStatus: 'any', // Fight can target tapped or untapped creatures
          excludeSource: fightTargetModalData?.targetFilter?.excludeSource !== false,
        }}
        targetCount={1}
        availablePermanents={safeView?.battlefield || []}
        playerId={you || ""}
        playerNames={resolutionPlayerNames}
        enforceActionAvailability={false}
        onConfirm={(selectedPermanentIds) => {
          if (fightTargetModalData && safeView && selectedPermanentIds.length > 0) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: fightTargetModalData.stepId,
              selections: [selectedPermanentIds[0]],
              cancelled: false,
            });
            setFightTargetModalOpen(false);
            setFightTargetModalData(null);
          }
        }}
        onCancel={() => {
          if (fightTargetModalData && safeView) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: fightTargetModalData.stepId,
            });
          }
          setFightTargetModalOpen(false);
          setFightTargetModalData(null);
        }}
      />

      {/* Counter Movement Modal - for Nesting Grounds and similar abilities */}
      <CounterMovementModal
        open={resolutionPromptOpen(counterMovementModalOpen, counterMovementModalData?.stepId)}
        title={counterMovementModalData?.title || counterMovementModalData?.sourceName || "Move Counter"}
        description={counterMovementModalData?.description}
        source={{
          id: counterMovementModalData?.sourceId || "",
          name: counterMovementModalData?.sourceName || "",
          imageUrl: counterMovementModalData?.sourceImageUrl,
        }}
        sourceFilter={counterMovementModalData?.sourceFilter}
        targetFilter={counterMovementModalData?.targetFilter}
        availablePermanents={safeView?.battlefield || []}
        playerId={you || ""}
        onConfirm={(sourcePermanentId, targetPermanentId, counterType) => {
          if (counterMovementModalData && safeView) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: counterMovementModalData.stepId,
              selections: {
                sourcePermanentId,
                targetPermanentId,
                counterType,
              },
              cancelled: false,
            });
            setCounterMovementModalOpen(false);
            setCounterMovementModalData(null);
          }
        }}
        onCancel={() => {
          if (counterMovementModalData && safeView) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: counterMovementModalData.stepId,
            });
          }
          setCounterMovementModalOpen(false);
          setCounterMovementModalData(null);
        }}
      />

      {/* Station Creature Selection Modal (Rule 702.184a) */}
      <StationCreatureSelectionModal
        open={resolutionPromptOpen(stationCreatureSelectionOpen, stationCreatureSelectionData?.stepId)}
        gameId={safeView?.id || ""}
        activationId={stationCreatureSelectionData?.stepId || ""}
        station={stationCreatureSelectionData?.station || { id: "", name: "", threshold: 0, currentCounters: 0 }}
        creatures={stationCreatureSelectionData?.creatures || []}
        title={stationCreatureSelectionData?.title || "Station"}
        description={stationCreatureSelectionData?.description || ""}
        onConfirm={(creatureId) => {
          if (stationCreatureSelectionData && safeView) {
            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: stationCreatureSelectionData.stepId,
              selections: [creatureId],
              cancelled: false,
            });
            setStationCreatureSelectionOpen(false);
            setStationCreatureSelectionData(null);
          }
        }}
        onCancel={() => {
          if (stationCreatureSelectionData && safeView) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: stationCreatureSelectionData.stepId,
            });
          }
          setStationCreatureSelectionOpen(false);
          setStationCreatureSelectionData(null);
        }}
      />

      {/* Resolution Queue Player Choice Modal */}
      <PlayerTargetSelectionModal
        open={resolutionPromptOpen(resolutionPlayerChoiceModalOpen, resolutionPlayerChoiceModalData?.stepId)}
        title={resolutionPlayerChoiceModalData?.title || 'Choose Player'}
        description={resolutionPlayerChoiceModalData?.description}
        source={{
          name: resolutionPlayerChoiceModalData?.source?.name || '',
          imageUrl: resolutionPlayerChoiceModalData?.source?.imageUrl,
        }}
        players={resolutionPlayerChoiceModalData?.players || []}
        opponentOnly={Boolean(resolutionPlayerChoiceModalData?.opponentOnly)}
        minTargets={resolutionPlayerChoiceModalData?.isOptional ? 0 : 1}
        maxTargets={1}
        onConfirm={(selectedPlayerIds) => {
          if (!safeView || !resolutionPlayerChoiceModalData) return;
          const stepId = resolutionPlayerChoiceModalData.stepId;

          if (selectedPlayerIds.length === 0) {
            if (resolutionPlayerChoiceModalData.isOptional) {
              socket.emit('cancelResolutionStep', {
                gameId: safeView.id,
                stepId,
              });
              setResolutionPlayerChoiceModalOpen(false);
              setResolutionPlayerChoiceModalData(null);
            }
            return;
          }

          socket.emit('submitResolutionResponse', {
            gameId: safeView.id,
            stepId,
            selections: selectedPlayerIds,
            cancelled: false,
          });

          setResolutionPlayerChoiceModalOpen(false);
          setResolutionPlayerChoiceModalData(null);
        }}
        onCancel={() => {
          if (!safeView || !resolutionPlayerChoiceModalData) return;
          if (!resolutionPlayerChoiceModalData.isOptional) return;

          socket.emit('cancelResolutionStep', {
            gameId: safeView.id,
            stepId: resolutionPlayerChoiceModalData.stepId,
          });

          setResolutionPlayerChoiceModalOpen(false);
          setResolutionPlayerChoiceModalData(null);
        }}
      />

    </>
  );
}
