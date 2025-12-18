/**
 * ProliferateModal.tsx
 * 
 * A modal for choosing which permanents and/or players to proliferate.
 * Proliferate: Choose any number of permanents and/or players with counters,
 * then give each one additional counter of each kind.
 * 
 * Uses the generic CardSelectionModal for consistent UI.
 */

import React from 'react';
import { CardSelectionModal, type SelectionOption } from './CardSelectionModal';

export interface ProliferateTarget {
  type: 'permanent' | 'player';
  id: string;
  name: string;
  counters: Record<string, number>;
  imageUrl?: string;
}

export interface ProliferateModalProps {
  open: boolean;
  sourceName: string;
  imageUrl?: string;
  validTargets: ProliferateTarget[];
  onConfirm: (selectedIds: string[]) => void;
}

export function ProliferateModal({
  open,
  sourceName,
  imageUrl,
  validTargets,
  onConfirm,
}: ProliferateModalProps) {
  // Convert targets to selection options with counter info in description
  const options: SelectionOption[] = validTargets.map((target) => {
    // Format counter display
    const counterList = Object.entries(target.counters)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');
    
    return {
      id: target.id,
      name: target.type === 'player' ? `🧙 ${target.name}` : target.name,
      description: counterList,
      imageUrl: target.imageUrl,
    };
  });

  const handleConfirm = (selectedIds: string[]) => {
    onConfirm(selectedIds);
  };

  return (
    <CardSelectionModal
      open={open}
      title="Proliferate"
      subtitle={`Choose any number of targets with counters to proliferate (${sourceName})`}
      sourceCardImageUrl={imageUrl}
      sourceCardName={sourceName}
      oracleText="Choose any number of permanents and/or players that have a counter on them. Then give each one additional counter of each kind already there."
      options={options}
      minSelections={0}
      maxSelections={options.length}
      confirmButtonText="Proliferate Selected"
      cancelButtonText="Skip Proliferate"
      canCancel={true}
      onConfirm={handleConfirm}
      onCancel={() => onConfirm([])}
    />
  );
}

export default ProliferateModal;
