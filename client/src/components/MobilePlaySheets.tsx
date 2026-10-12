/**
 * Bottom sheets opened from the mobile action dock (hand, stack, mana, more).
 */

import React from 'react';
import type {
  CardCostAdjustment,
  CardRef,
  KnownCardRef,
  ManaPool,
  PlayerID,
  PlayerRef,
  StackItem,
  BattlefieldPermanent,
} from '../../../shared/src';
import type { AppearanceSettings } from '../utils/appearanceSettings';
import { Sheet } from './Sheet';
import { HandGallery } from './HandGallery';
import { CentralStack } from './CentralStack';
import { FloatingManaPool } from './FloatingManaPool';
import { PhaseNavigator } from './PhaseNavigator';
import { MobileMulliganActions } from './MobileMulliganActions';
import { MobileToolsHub, type MobileToolsHubProps } from './MobileToolsHub';
import type { MobilePrimaryActionMode } from '../utils/mobilePlayActions';
import { colors, fontSize, radii, spacing } from '../theme';

export type MobilePlaySheet = 'hand' | 'stack' | 'mana' | 'more' | null;

export type MobilePlaySheetsProps = MobileToolsHubProps & {
  activeSheet: MobilePlaySheet;
  onClose: () => void;
  // Hand
  handCards: CardRef[] | KnownCardRef[];
  handCount?: number;
  imagePref: 'small' | 'normal' | 'art_crop';
  playableCards?: string[];
  costAdjustments?: Record<string, CardCostAdjustment>;
  appearanceSettings?: AppearanceSettings;
  onPlayLand?: (cardId: string) => void;
  onCast?: (cardId: string) => void;
  onReorderHand?: (order: string[]) => void;
  reasonCannotPlayLand?: (card: { type_line?: string }) => string | null;
  reasonCannotCast?: (card: { type_line?: string }) => string | null;
  // Stack
  stack: StackItem[];
  battlefield?: BattlefieldPermanent[];
  players?: PlayerRef[];
  you?: PlayerID;
  priority?: PlayerID | null;
  onPassPriority?: () => void;
  onResolveAllTriggers?: () => void;
  onResolveIdenticalTriggers?: (count: number) => void;
  ignoredTriggerSources?: Map<string, { sourceName: string; count: number; effect: string; imageUrl?: string }>;
  onIgnoreTriggerSource?: (sourceId: string, sourceName: string, effect: string, imageUrl?: string) => void;
  onStopIgnoringSource?: (sourceKey: string) => void;
  // Mana
  manaPool?: ManaPool | null;
  // More / phase
  phase?: string;
  step?: string;
  turnPlayer?: PlayerID | null;
  isYourTurn?: boolean;
  hasPriority?: boolean;
  stackEmpty?: boolean;
  allPlayersReady?: boolean;
  phaseAdvanceBlockReason?: string | null;
  onAdvanceOneStep?: () => void;
  onSkipToPhase?: (targetPhase: string, targetStep?: string) => void;
  onConcede?: () => void;
  onLeaveGame?: () => void;
  primaryMode?: MobilePrimaryActionMode;
  canKeepHand?: boolean;
  canMulligan?: boolean;
  canUnkeepHand?: boolean;
  mulligansTaken?: number;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  onUnkeepHand?: () => void;
  onRandomizeStart?: () => void;
  isPreGame?: boolean;
};

export const MobilePlaySheets: React.FC<MobilePlaySheetsProps> = (props) => {
  const {
    activeSheet,
    onClose,
    handCards,
    handCount,
    imagePref,
    playableCards,
    costAdjustments,
    appearanceSettings,
    onPlayLand,
    onCast,
    onReorderHand,
    reasonCannotPlayLand,
    reasonCannotCast,
    stack,
    battlefield,
    players,
    you,
    priority,
    onPassPriority,
    onResolveAllTriggers,
    onResolveIdenticalTriggers,
    ignoredTriggerSources,
    onIgnoreTriggerSource,
    onStopIgnoringSource,
    manaPool,
    phase,
    step,
    turnPlayer,
    isYourTurn = false,
    hasPriority = false,
    stackEmpty = true,
    allPlayersReady = true,
    phaseAdvanceBlockReason,
    onAdvanceOneStep,
    onSkipToPhase,
    onConcede,
    onLeaveGame,
    primaryMode = 'play',
    canKeepHand,
    canMulligan,
    canUnkeepHand,
    mulligansTaken,
    onKeepHand,
    onMulligan,
    onUnkeepHand,
    onRandomizeStart,
    isPreGame = false,
  } = props;

  const showMulliganActions = primaryMode === 'mulligan' || primaryMode === 'unkeep';
  const mulliganControls = showMulliganActions ? (
    <MobileMulliganActions
      mode={primaryMode === 'unkeep' ? 'unkeep' : 'mulligan'}
      canKeepHand={canKeepHand}
      canMulligan={canMulligan}
      canUnkeepHand={canUnkeepHand}
      mulligansTaken={mulligansTaken}
      onKeepHand={onKeepHand}
      onMulligan={onMulligan}
      onUnkeepHand={onUnkeepHand}
      onRandomizeStart={onRandomizeStart}
      showRandomStart={isPreGame}
    />
  ) : null;

  const stackPassFooter =
    activeSheet === 'stack' && hasPriority && onPassPriority ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: fontSize.sm, color: colors.accentStrong, fontWeight: 700 }}>
          You have priority
        </div>
        <button
          type="button"
          onClick={onPassPriority}
          style={{
            width: '100%',
            minHeight: 52,
            borderRadius: radii.md,
            border: `1px solid ${colors.accentStrong}`,
            background: `linear-gradient(180deg, ${colors.accentStrong}, ${colors.accent})`,
            color: '#0b0b10',
            fontWeight: 700,
            fontSize: fontSize.lg,
            cursor: 'pointer',
          }}
        >
          Pass *
        </button>
      </div>
    ) : null;

  return (
    <>
      <Sheet
        open={activeSheet === 'hand'}
        onClose={onClose}
        title="Your Hand"
        desktopWidth={720}
        footer={mulliganControls}
      >
        <HandGallery
          cards={handCards}
          handCount={handCount}
          imagePref={imagePref}
          thumbWidth={96}
          layout="wrap7"
          enableReorder={!!onReorderHand}
          onReorder={onReorderHand}
          onPlayLand={onPlayLand}
          onCast={onCast}
          reasonCannotPlayLand={reasonCannotPlayLand}
          reasonCannotCast={reasonCannotCast}
          playableCards={playableCards}
          costAdjustments={costAdjustments}
          appearanceSettings={appearanceSettings}
        />
      </Sheet>

      <Sheet
        open={activeSheet === 'stack'}
        onClose={onClose}
        title={`Stack (${stack.length})`}
        desktopWidth={520}
        hideHeader={stack.length === 0}
        footer={stackPassFooter}
      >
        {stack.length > 0 ? (
          <div style={{ position: 'relative', minHeight: 120 }}>
            <CentralStack
              embedded
              stack={stack}
              battlefield={battlefield}
              players={players}
              you={you}
              priorityPlayer={priority ?? undefined}
              onPass={onPassPriority}
              onResolveAll={onResolveAllTriggers}
              onResolveIdentical={onResolveIdenticalTriggers}
              ignoredSources={ignoredTriggerSources}
              onIgnoreTriggerSource={onIgnoreTriggerSource}
              onStopIgnoring={onStopIgnoringSource}
            />
          </div>
        ) : (
          <div style={{ color: colors.textSecondary, fontSize: fontSize.md }}>Stack is empty.</div>
        )}
      </Sheet>

      <Sheet
        open={activeSheet === 'mana'}
        onClose={onClose}
        title="Mana Pool"
        desktopWidth={400}
      >
        {manaPool ? (
          <FloatingManaPool manaPool={manaPool} playerId={you} />
        ) : (
          <div style={{ color: colors.textSecondary, fontSize: fontSize.md }}>No floating mana.</div>
        )}
      </Sheet>

      <Sheet
        open={activeSheet === 'more'}
        onClose={onClose}
        title="Tools"
        desktopWidth={480}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {mulliganControls}
          <MobileToolsHub
            autoPassSteps={props.autoPassSteps}
            onToggleAutoPass={props.onToggleAutoPass}
            onClearAllAutoPass={props.onClearAllAutoPass}
            onSelectAllAutoPass={props.onSelectAllAutoPass}
            isSinglePlayer={props.isSinglePlayer}
            onToggleAutoPassForTurn={props.onToggleAutoPassForTurn}
            autoPassForTurnEnabled={props.autoPassForTurnEnabled}
            autoPassEmptyStackOnOpponentsTurnEnabled={props.autoPassEmptyStackOnOpponentsTurnEnabled}
            onToggleAutoPassEmptyStackOnOpponentsTurn={props.onToggleAutoPassEmptyStackOnOpponentsTurn}
            autoYesOptionalEnabled={props.autoYesOptionalEnabled}
            onToggleAutoYesOptional={props.onToggleAutoYesOptional}
            ignoredCards={props.ignoredCards}
            you={you}
            onUnignoreCard={props.onUnignoreCard}
            onClearIgnoredCards={props.onClearIgnoredCards}
            onOpenTriggerShortcuts={props.onOpenTriggerShortcuts}
            onOpenLoopShortcuts={props.onOpenLoopShortcuts}
            gameId={props.gameId}
            view={props.view}
            availableUndoCount={props.availableUndoCount}
            undoTurnPhaseTargets={props.undoTurnPhaseTargets}
            onOpenUndoMenu={props.onOpenUndoMenu}
            onRequestUndoTurnPhaseTargets={props.onRequestUndoTurnPhaseTargets}
            onUndoToTurnPhase={props.onUndoToTurnPhase}
            aiControlEnabled={props.aiControlEnabled}
            onToggleAIControl={props.onToggleAIControl}
            onRollDie={props.onRollDie}
            onFlipCoin={props.onFlipCoin}
            isSpectator={props.isSpectator}
          />
          {onAdvanceOneStep && onPassPriority && (
            <PhaseNavigator
              docked
              currentPhase={phase}
              currentStep={step}
              turnPlayer={turnPlayer ?? undefined}
              you={you}
              isYourTurn={isYourTurn}
              hasPriority={hasPriority}
              stackEmpty={stackEmpty}
              allPlayersReady={allPlayersReady}
              phaseAdvanceBlockReason={phaseAdvanceBlockReason}
              onAdvanceOneStep={onAdvanceOneStep}
              onPassPriority={onPassPriority}
              onSkipToPhase={onSkipToPhase}
            />
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
            {onConcede && (
              <button
                type="button"
                onClick={onConcede}
                style={{
                  flex: '1 1 120px',
                  minHeight: 48,
                  padding: '10px 12px',
                  borderRadius: radii.md,
                  border: `1px solid ${colors.danger}`,
                  background: 'rgba(220,38,38,0.15)',
                  color: '#fca5a5',
                  cursor: 'pointer',
                  fontSize: fontSize.sm,
                  fontWeight: 600,
                }}
              >
                Concede
              </button>
            )}
            {onLeaveGame && (
              <button
                type="button"
                onClick={onLeaveGame}
                style={{
                  flex: '1 1 120px',
                  minHeight: 48,
                  padding: '10px 12px',
                  borderRadius: radii.md,
                  border: `1px solid ${colors.border}`,
                  background: colors.surfaceTransparent,
                  color: colors.textPrimary,
                  cursor: 'pointer',
                  fontSize: fontSize.sm,
                  fontWeight: 600,
                }}
              >
                Leave Game
              </button>
            )}
          </div>
        </div>
      </Sheet>
    </>
  );
};