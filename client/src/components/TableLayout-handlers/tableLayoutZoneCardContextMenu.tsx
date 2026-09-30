// client/src/components/TableLayout-handlers/tableLayoutZoneCardContextMenu.tsx
import React from 'react';
import type { KnownCardRef } from '../../../../shared/src';
import { ZoneCardContextMenu } from '../ZoneCardContextMenu';
import { socket } from '../../socket';
import { dispatchZoneCardAbility } from './tableLayoutZoneAbilityDispatch';
import {
  canPlayLandFromZoneContext,
  reasonCannotPlayLandFromZoneContext,
} from './tableLayoutZonePlayLand';

export type TableLayoutZoneContextMenuState = {
  card: KnownCardRef;
  zone: 'hand' | 'graveyard' | 'exile' | 'library' | 'commander' | 'battlefield';
  x: number;
  y: number;
};

export function TableLayoutZoneCardContextMenu(props: {
  zoneContextMenu: TableLayoutZoneContextMenuState;
  gameId?: string | null;
  you?: string | null;
  playableCards?: string[] | null;
  costAdjustments?: Record<string, any> | null;
  ignoredCardsSet: Set<string>;
  setIgnoredCardsSet: React.Dispatch<React.SetStateAction<Set<string>>>;
  setZoneContextMenu: (value: TableLayoutZoneContextMenuState | null) => void;
  onPlayLandFromHand?: (cardId: string, fromZone?: 'hand' | 'graveyard' | 'exile' | 'library') => void;
  onCastFromHand?: (cardId: string) => void;
  onCastCommander?: (commanderId: string, commanderName: string, manaCost?: string, tax?: number) => void;
  /** Same App handlers the Graveyard / Exile view modals use for their ability buttons. */
  onGraveyardAbility?: (cardId: string, abilityId: string, card: KnownCardRef) => void;
  onExileAbility?: (cardId: string, abilityId: string, card: KnownCardRef) => void;
  reasonCannotPlayLand?: (card: any) => string | null;
  reasonCannotCast?: (card: any) => string | null;
}): React.ReactElement {
  const {
    zoneContextMenu,
    gameId,
    you,
    playableCards,
    costAdjustments,
    ignoredCardsSet,
    setIgnoredCardsSet,
    setZoneContextMenu,
    onPlayLandFromHand,
    onCastFromHand,
    onCastCommander,
    onGraveyardAbility,
    onExileAbility,
    reasonCannotPlayLand,
    reasonCannotCast,
  } = props;

  return (
    <ZoneCardContextMenu
      card={zoneContextMenu.card}
      zone={zoneContextMenu.zone}
      x={zoneContextMenu.x}
      y={zoneContextMenu.y}
      onClose={() => setZoneContextMenu(null)}
      onCast={(cardId) => {
        if (zoneContextMenu.zone === 'hand') {
          onCastFromHand?.(cardId);
        } else if (zoneContextMenu.zone === 'commander') {
          const cmd = zoneContextMenu.card;
          onCastCommander?.(cardId, cmd.name, cmd.mana_cost);
        }
      }}
      onPlayLand={(cardId) => {
        const zone = zoneContextMenu.zone;
        if (zone === 'hand' || zone === 'graveyard' || zone === 'exile' || zone === 'library') {
          onPlayLandFromHand?.(cardId, zone);
        }
      }}
      onDiscard={(cardId) => {
        if (gameId && zoneContextMenu.zone === 'hand') {
          socket.emit('discard', { gameId, cardId });
        }
      }}
      onActivateAbility={(cardId, abilityId) => {
        dispatchZoneCardAbility({
          zone: zoneContextMenu.zone,
          gameId,
          cardId,
          abilityId,
          card: zoneContextMenu.card,
          emit: (event, payload) => socket.emit(event as any, payload as any),
          onCastFromHand,
          onGraveyardAbility,
          onExileAbility,
        });
      }}
      onIgnoreForPlayability={(cardId, cardName, zone, imageUrl) => {
        if (gameId && you) {
          socket.emit('ignoreCardForAutoPass', {
            gameId,
            cardId,
            cardName,
            zone,
            imageUrl,
          });
          setIgnoredCardsSet(prev => new Set([...prev, cardId]));
        }
      }}
      onUnignoreForPlayability={(cardId) => {
        if (gameId) {
          socket.emit('unignoreCardForAutoPass', {
            gameId,
            cardId,
          });
          setIgnoredCardsSet(prev => {
            const next = new Set(prev);
            next.delete(cardId);
            return next;
          });
        }
      }}
      isIgnoredForPlayability={ignoredCardsSet.has(zoneContextMenu.card.id)}
      canCast={zoneContextMenu.zone === 'hand' ? !reasonCannotCast?.(zoneContextMenu.card) : true}
      canPlayLand={canPlayLandFromZoneContext({
        zone: zoneContextMenu.zone,
        cardId: zoneContextMenu.card.id,
        playableCards,
        reasonCannotPlayLand: reasonCannotPlayLand?.(zoneContextMenu.card) ?? null,
      })}
      reasonCannotCast={zoneContextMenu.zone === 'hand' ? reasonCannotCast?.(zoneContextMenu.card) : null}
      reasonCannotPlayLand={reasonCannotPlayLandFromZoneContext({
        zone: zoneContextMenu.zone,
        cardId: zoneContextMenu.card.id,
        playableCards,
        reasonCannotPlayLand: reasonCannotPlayLand?.(zoneContextMenu.card) ?? null,
      })}
      costAdjustment={costAdjustments?.[zoneContextMenu.card.id]}
    />
  );
}
