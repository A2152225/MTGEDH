/**
 * ReturnControlledPermanentChoiceModal.tsx
 *
 * A modal for choosing which controlled permanent to return when an effect asks
 * the player to move one back to their hand.
 *
 * Uses the generic CardSelectionModal for consistent UI.
 */

import React from 'react';
import { CardSelectionModal, type SelectionOption } from './CardSelectionModal';

export interface ReturnControlledPermanentOption {
  permanentId: string;
  cardName: string;
  imageUrl?: string;
}

export interface ReturnControlledPermanentChoiceModalProps {
  open: boolean;
  sourceName: string;
  sourceImageUrl?: string;
  optionsToChoose: ReturnControlledPermanentOption[];
  title?: string;
  subtitle?: string;
  oracleText?: string;
  confirmButtonText?: string;
  onSelectPermanent: (permanentId: string) => void;
}

export function ReturnControlledPermanentChoiceModal({
  open,
  sourceName,
  sourceImageUrl,
  optionsToChoose,
  title,
  subtitle,
  oracleText,
  confirmButtonText,
  onSelectPermanent,
}: ReturnControlledPermanentChoiceModalProps) {
  const options: SelectionOption[] = optionsToChoose.map((option) => ({
    id: option.permanentId,
    name: option.cardName,
    imageUrl: option.imageUrl,
  }));

  const handleConfirm = (selectedIds: string[]) => {
    if (selectedIds.length > 0) {
      onSelectPermanent(selectedIds[0]);
    }
  };

  return (
    <CardSelectionModal
      open={open}
      title={title || `${sourceName} Enters the Battlefield`}
      subtitle={subtitle || 'Choose a permanent to return to your hand'}
      sourceCardImageUrl={sourceImageUrl}
      sourceCardName={sourceName}
      oracleText={oracleText || `When ${sourceName} resolves, return a permanent you control to its owner's hand.`}
      options={options}
      minSelections={1}
      maxSelections={1}
      confirmButtonText={confirmButtonText || 'Return Selected Permanent'}
      canCancel={false}
      onConfirm={handleConfirm}
    />
  );
}

export default ReturnControlledPermanentChoiceModal;
