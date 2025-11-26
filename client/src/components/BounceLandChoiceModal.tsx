/**
 * BounceLandChoiceModal.tsx
 * 
 * A modal for choosing which land to return to hand when a bounce land
 * (karoo/aqueduct) enters the battlefield.
 * 
 * Uses the generic CardSelectionModal for consistent UI.
 * 
 * Used for: Azorius Chancery, Dimir Aqueduct, Simic Growth Chamber, etc.
 */

import React from 'react';
import { CardSelectionModal, type SelectionOption } from './CardSelectionModal';

export interface LandOption {
  permanentId: string;
  cardName: string;
  imageUrl?: string;
}

export interface BounceLandChoiceModalProps {
  open: boolean;
  bounceLandName: string;
  bounceLandImageUrl?: string;
  landsToChoose: LandOption[];
  onSelectLand: (permanentId: string) => void;
}

export function BounceLandChoiceModal({
  open,
  bounceLandName,
  bounceLandImageUrl,
  landsToChoose,
  onSelectLand,
}: BounceLandChoiceModalProps) {
  // Convert land options to generic selection options
  const options: SelectionOption[] = landsToChoose.map((land) => ({
    id: land.permanentId,
    name: land.cardName,
    imageUrl: land.imageUrl,
  }));

  const handleConfirm = (selectedIds: string[]) => {
    if (selectedIds.length > 0) {
      onSelectLand(selectedIds[0]);
    }
  };

  return (
    <CardSelectionModal
      open={open}
      title={`${bounceLandName} Enters the Battlefield`}
      subtitle="Choose a land to return to your hand"
      sourceCardImageUrl={bounceLandImageUrl}
      sourceCardName={bounceLandName}
      oracleText={`When ${bounceLandName} enters the battlefield, return a land you control to its owner's hand.`}
      options={options}
      minSelections={1}
      maxSelections={1}
      confirmButtonText="Return Selected Land"
      canCancel={false}
      onConfirm={handleConfirm}
    />
  );
}

export default BounceLandChoiceModal;

