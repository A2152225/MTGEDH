import React, { useState, useMemo } from 'react';
import { PaymentPicker } from './PaymentPicker';
import { FloatingManaPool } from './FloatingManaPool';
import type { PaymentItem, ManaColor } from '../../../shared/src';
import {
  Color,
  parseManaCost,
  computeColorsNeededByOtherCards,
  calculateSuggestedPayment,
  calculateRemainingCostAfterFloatingMana,
  getTotalManaProduction,
  type OtherCardInfo,
  type ManaPool,
} from '../utils/manaUtils';

/**
 * Represents an alternate casting cost option
 */
export interface AlternateCost {
  id: string;
  label: string;
  description?: string;
  manaCost: string;
  additionalCost?: string; // e.g., "Discard a card", "Sacrifice a creature"
  isDefault?: boolean;
}

/**
 * Parse alternate costs from card oracle text
 */
function parseAlternateCosts(oracleText: string, cardManaCost: string, cardName: string): AlternateCost[] {
  const costs: AlternateCost[] = [];
  const text = oracleText || '';
  const lowerText = text.toLowerCase();
  
  // Default cost is always first
  costs.push({
    id: 'normal',
    label: 'Normal Cost',
    manaCost: cardManaCost,
    isDefault: true,
  });
  
  // Flashback - cast from graveyard for alternate cost
  const flashbackMatch = text.match(/flashback[^(]*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (flashbackMatch) {
    costs.push({
      id: 'flashback',
      label: 'Flashback',
      description: 'Cast from graveyard',
      manaCost: flashbackMatch[1],
    });
  }
  
  // Overload - cast for alternate cost, affects all instead of target
  const overloadMatch = text.match(/overload\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (overloadMatch) {
    costs.push({
      id: 'overload',
      label: 'Overload',
      description: 'Affects all valid targets instead of one',
      manaCost: overloadMatch[1],
    });
  }
  
  // Surge - reduced cost if you or teammate cast another spell this turn
  const surgeMatch = text.match(/surge\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (surgeMatch) {
    costs.push({
      id: 'surge',
      label: 'Surge',
      description: 'If you or teammate cast another spell this turn',
      manaCost: surgeMatch[1],
    });
  }
  
  // Spectacle - alternate cost if opponent lost life this turn
  const spectacleMatch = text.match(/spectacle\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (spectacleMatch) {
    costs.push({
      id: 'spectacle',
      label: 'Spectacle',
      description: 'If an opponent lost life this turn',
      manaCost: spectacleMatch[1],
    });
  }
  
  // Mutate - cast for mutate cost
  const mutateMatch = text.match(/mutate\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (mutateMatch) {
    costs.push({
      id: 'mutate',
      label: 'Mutate',
      description: 'Merge with target creature',
      manaCost: mutateMatch[1],
    });
  }
  
  // Dash - cast for dash cost, gains haste, returns to hand at end of turn
  const dashMatch = text.match(/dash\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (dashMatch) {
    costs.push({
      id: 'dash',
      label: 'Dash',
      description: 'Gains haste, returns to hand at end of turn',
      manaCost: dashMatch[1],
    });
  }
  
  // Evoke - cast for evoke cost, then sacrifice
  const evokeMatch = text.match(/evoke\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (evokeMatch) {
    costs.push({
      id: 'evoke',
      label: 'Evoke',
      description: 'ETB triggers, then sacrifice',
      manaCost: evokeMatch[1],
      additionalCost: 'Sacrifice when it enters',
    });
  }
  
  // Madness - cast for madness cost when discarded
  const madnessMatch = text.match(/madness\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (madnessMatch) {
    costs.push({
      id: 'madness',
      label: 'Madness',
      description: 'When discarded, may cast for this cost',
      manaCost: madnessMatch[1],
    });
  }
  
  // Miracle - if first card drawn this turn
  const miracleMatch = text.match(/miracle\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (miracleMatch) {
    costs.push({
      id: 'miracle',
      label: 'Miracle',
      description: 'If first card drawn this turn',
      manaCost: miracleMatch[1],
    });
  }
  
  // Prowl - if dealt combat damage with creature of same type
  const prowlMatch = text.match(/prowl\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (prowlMatch) {
    costs.push({
      id: 'prowl',
      label: 'Prowl',
      description: 'If you dealt combat damage with creature of same type',
      manaCost: prowlMatch[1],
    });
  }
  
  // Bestow - cast as aura
  const bestowMatch = text.match(/bestow\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (bestowMatch) {
    costs.push({
      id: 'bestow',
      label: 'Bestow',
      description: 'Cast as an Aura enchanting a creature',
      manaCost: bestowMatch[1],
    });
  }
  
  // Emerge - sacrifice a creature and pay reduced cost
  const emergeMatch = text.match(/emerge\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (emergeMatch) {
    costs.push({
      id: 'emerge',
      label: 'Emerge',
      description: 'Sacrifice a creature, reduce cost by its mana value',
      manaCost: emergeMatch[1],
      additionalCost: 'Sacrifice a creature',
    });
  }
  
  // Blitz - cast for blitz cost (creatures)
  const blitzMatch = text.match(/blitz\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (blitzMatch) {
    costs.push({
      id: 'blitz',
      label: 'Blitz',
      description: 'Gains haste, "When this dies, draw a card", sacrifice at end of turn',
      manaCost: blitzMatch[1],
    });
  }
  
  // Prototype (smaller stats, cheaper cost) - Phyrexian construct cards
  const prototypeMatch = text.match(/prototype\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*[-—]\s*(\d+)\/(\d+)/i);
  if (prototypeMatch) {
    costs.push({
      id: 'prototype',
      label: 'Prototype',
      description: `Cast as ${prototypeMatch[2]}/${prototypeMatch[3]}`,
      manaCost: prototypeMatch[1],
    });
  }
  
  // Disturb - cast transformed from graveyard
  const disturbMatch = text.match(/disturb\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (disturbMatch) {
    costs.push({
      id: 'disturb',
      label: 'Disturb',
      description: 'Cast transformed from graveyard',
      manaCost: disturbMatch[1],
    });
  }
  
  // Kicker - optional additional cost
  const kickerMatch = text.match(/kicker\s*(\{[^}]+\}(?:\s*(?:and\/or|or)\s*\{[^}]+\})*)/i);
  if (kickerMatch) {
    // Calculate kicked cost (normal + kicker)
    const kickerCost = kickerMatch[1];
    costs.push({
      id: 'kicker',
      label: 'With Kicker',
      description: 'Pay additional kicker cost for enhanced effect',
      manaCost: cardManaCost + kickerCost,
      additionalCost: `Kicker: ${kickerCost}`,
    });
  }
  
  // Multikicker - can be paid multiple times
  const multikickerMatch = text.match(/multikicker\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (multikickerMatch) {
    costs.push({
      id: 'multikicker',
      label: 'With Multikicker',
      description: 'Pay any number of times for enhanced effect',
      manaCost: cardManaCost, // Base cost, multikicker added separately
      additionalCost: `Multikicker: ${multikickerMatch[1]} (pay any number of times)`,
    });
  }
  
  // Buyback - return to hand instead of graveyard
  const buybackMatch = text.match(/buyback\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (buybackMatch) {
    costs.push({
      id: 'buyback',
      label: 'With Buyback',
      description: 'Return to hand instead of graveyard',
      manaCost: cardManaCost + buybackMatch[1],
      additionalCost: `Buyback: ${buybackMatch[1]}`,
    });
  }
  
  // Entwine - choose both modes
  const entwineMatch = text.match(/entwine\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (entwineMatch) {
    costs.push({
      id: 'entwine',
      label: 'With Entwine',
      description: 'Choose all modes instead of one',
      manaCost: cardManaCost + entwineMatch[1],
      additionalCost: `Entwine: ${entwineMatch[1]}`,
    });
  }
  
  // Replicate - copy spell
  const replicateMatch = text.match(/replicate\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (replicateMatch) {
    costs.push({
      id: 'replicate',
      label: 'With Replicate',
      description: 'Pay to copy the spell',
      manaCost: cardManaCost, // Base cost, replicate added separately
      additionalCost: `Replicate: ${replicateMatch[1]} (pay any number of times)`,
    });
  }
  
  // Echo - pay again on next upkeep or sacrifice
  const echoMatch = text.match(/echo\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (echoMatch) {
    // Echo isn't an alternate casting cost, but we note it for awareness
    // The echo cost is paid on the next upkeep, not when casting
    costs[0].additionalCost = `Echo: ${echoMatch[1]} (pay on your next upkeep or sacrifice)`;
  }
  
  // Warp - cast from exile (typically through cascade or similar)
  // Note: "Warp" isn't a standard keyword, but there are effects that cast from exile
  // This handles cards like Prosper's treasure tokens or similar effects
  
  // Foretell - exile face down, cast later for foretell cost
  const foretellMatch = text.match(/foretell\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (foretellMatch) {
    costs.push({
      id: 'foretell',
      label: 'Foretell',
      description: 'Cast from exile after foretelling',
      manaCost: foretellMatch[1],
    });
  }
  
  // Suspend - exile with time counters, cast for free when last counter removed
  if (lowerText.includes('suspend')) {
    const suspendMatch = text.match(/suspend\s+(\d+)[—\-]\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (suspendMatch) {
      costs.push({
        id: 'suspend',
        label: 'Suspend',
        description: `Exile with ${suspendMatch[1]} time counters, cast free when removed`,
        manaCost: suspendMatch[2],
        additionalCost: `Wait ${suspendMatch[1]} turns`,
      });
    }
  }
  
  // Craft - exile from battlefield with other materials
  const craftMatch = text.match(/craft with\s+([^{]+)\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (craftMatch) {
    costs.push({
      id: 'craft',
      label: 'Craft',
      description: `Transform by exiling with ${craftMatch[1].trim()}`,
      manaCost: craftMatch[2],
      additionalCost: `Exile ${craftMatch[1].trim()}`,
    });
  }
  
  // Cleave - remove bracketed text for alternate cost
  const cleaveMatch = text.match(/cleave\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (cleaveMatch) {
    costs.push({
      id: 'cleave',
      label: 'Cleave',
      description: 'Cast without bracketed text',
      manaCost: cleaveMatch[1],
    });
  }
  
  // Casualty - sacrifice creature with power N or greater
  const casualtyMatch = text.match(/casualty\s+(\d+)/i);
  if (casualtyMatch) {
    costs[0].additionalCost = (costs[0].additionalCost ? costs[0].additionalCost + '; ' : '') +
      `Casualty ${casualtyMatch[1]}: Sacrifice a creature with power ${casualtyMatch[1]}+ to copy`;
  }
  
  // Offering - sacrifice creature of type, reduce cost by its mana value
  const offeringMatch = text.match(/(\w+)\s+offering/i);
  if (offeringMatch) {
    costs.push({
      id: 'offering',
      label: `${offeringMatch[1]} Offering`,
      description: `Sacrifice a ${offeringMatch[1]}, reduce cost by its mana value`,
      manaCost: cardManaCost, // Reduced by sacrificed creature's MV
      additionalCost: `Sacrifice a ${offeringMatch[1]}`,
    });
  }
  
  // Ninjutsu - return attacking unblocked creature
  const ninjutsuMatch = text.match(/ninjutsu\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (ninjutsuMatch) {
    costs.push({
      id: 'ninjutsu',
      label: 'Ninjutsu',
      description: 'Return unblocked attacker to hand, put this onto battlefield attacking',
      manaCost: ninjutsuMatch[1],
      additionalCost: 'Return an unblocked attacking creature you control to hand',
    });
  }
  
  // Commander Ninjutsu
  const cmdNinjutsuMatch = text.match(/commander ninjutsu\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (cmdNinjutsuMatch) {
    costs.push({
      id: 'commander-ninjutsu',
      label: 'Commander Ninjutsu',
      description: 'Return unblocked attacker, put commander onto battlefield attacking',
      manaCost: cmdNinjutsuMatch[1],
      additionalCost: 'Return an unblocked attacking creature you control to hand',
    });
  }
  
  // "You may pay X rather than pay this spell's mana cost" or similar
  const altCostMatch = text.match(/you may (?:pay\s+)?(\{[^}]+\}(?:\s*\{[^}]+\})*)\s+rather than pay/i);
  if (altCostMatch) {
    costs.push({
      id: 'alternate',
      label: 'Alternate Cost',
      description: 'Pay this instead of normal cost',
      manaCost: altCostMatch[1],
    });
  }
  
  // "You may cast ~ without paying its mana cost" (free cast)
  if (lowerText.includes('without paying its mana cost') || lowerText.includes('without paying the mana cost')) {
    costs.push({
      id: 'free',
      label: 'Free Cast',
      description: 'Cast without paying mana cost',
      manaCost: '{0}',
    });
  }
  
  return costs;
}

interface CastSpellModalProps {
  open: boolean;
  cardName: string;
  manaCost?: string;
  oracleText?: string;
  availableSources: Array<{ id: string; name: string; options: Color[] }>;
  otherCardsInHand?: OtherCardInfo[];
  floatingMana?: ManaPool;
  castFromZone?: 'hand' | 'graveyard' | 'exile' | 'command';
  costReduction?: {
    generic: number;
    colors: Record<string, number>;
    messages: string[];
  };
  convokeOptions?: {
    availableCreatures: Array<{
      id: string;
      name: string;
      colors: string[];
      canTapFor: string[];
    }>;
    messages: string[];
  };
  onConfirm: (payment: PaymentItem[], alternateCostId?: string, xValue?: number, convokeTappedCreatures?: string[]) => void;
  onCancel: () => void;
}

export function CastSpellModal({
  open,
  cardName,
  manaCost,
  oracleText,
  availableSources,
  otherCardsInHand = [],
  floatingMana,
  castFromZone = 'hand',
  costReduction,
  convokeOptions,
  onConfirm,
  onCancel,
}: CastSpellModalProps) {
  const [payment, setPayment] = useState<PaymentItem[]>([]);
  const [xValue, setXValue] = useState(0);
  const [selectedCostId, setSelectedCostId] = useState('normal');
  const [selectedConvokeCreatures, setSelectedConvokeCreatures] = useState<string[]>([]);

  // Parse alternate costs from oracle text
  const alternateCosts = useMemo(() => {
    let costs = parseAlternateCosts(oracleText || '', manaCost || '', cardName);
    
    // If casting from graveyard, filter to only graveyard-castable costs
    if (castFromZone === 'graveyard') {
      costs = costs.filter(c => 
        c.id === 'flashback' || 
        c.id === 'disturb' || 
        c.id === 'escape' ||
        c.id === 'unearth'
      );
      // If no graveyard costs found, show nothing (shouldn't happen if we got here)
      if (costs.length === 0) {
        costs = [{ id: 'normal', label: 'Cast from Graveyard', manaCost: manaCost || '', isDefault: true }];
      }
    }
    
    return costs;
  }, [oracleText, manaCost, cardName, castFromZone]);

  // Calculate the reduced mana cost if applicable
  const effectiveManaCost = useMemo(() => {
    if (!costReduction || !manaCost) return manaCost;
    
    // Parse the original cost
    const parsed = parseManaCost(manaCost);
    
    // Apply reductions
    let newGeneric = Math.max(0, parsed.generic - costReduction.generic);
    const newColors = { ...parsed.colors };
    
    for (const color of Object.keys(costReduction.colors)) {
      if (newColors[color as Color]) {
        const reduction = costReduction.colors[color];
        const currentColorCost = newColors[color as Color];
        if (reduction >= currentColorCost) {
          // If reduction exceeds colored cost, reduce colored to 0 and apply excess to generic
          const excess = reduction - currentColorCost;
          newColors[color as Color] = 0;
          newGeneric = Math.max(0, newGeneric - excess);
        } else {
          newColors[color as Color] = currentColorCost - reduction;
        }
      }
    }
    
    // Reconstruct mana cost string
    const parts: string[] = [];
    if (newGeneric > 0) parts.push(`{${newGeneric}}`);
    if (newColors.white) parts.push('{W}'.repeat(newColors.white));
    if (newColors.blue) parts.push('{U}'.repeat(newColors.blue));
    if (newColors.black) parts.push('{B}'.repeat(newColors.black));
    if (newColors.red) parts.push('{R}'.repeat(newColors.red));
    if (newColors.green) parts.push('{G}'.repeat(newColors.green));
    if (newColors.colorless) parts.push('{C}'.repeat(newColors.colorless));
    
    return parts.length > 0 ? parts.join('') : '{0}';
  }, [manaCost, costReduction]);

  // Get the currently selected cost
  const currentCost = useMemo(() => {
    return alternateCosts.find(c => c.id === selectedCostId) || alternateCosts[0];
  }, [alternateCosts, selectedCostId]);

  // Calculate suggested payment for auto-fill (considers floating mana)
  const suggestedPayment = useMemo(() => {
    const parsed = parseManaCost(currentCost?.manaCost || manaCost);
    // For XX costs, multiply xValue by the number of X's (xCount)
    const xMultiplier = parsed.xCount || 1;
    const cost = { colors: parsed.colors, generic: parsed.generic + Math.max(0, xValue * xMultiplier), hybrids: parsed.hybrids };
    const colorsToPreserve = computeColorsNeededByOtherCards(otherCardsInHand);
    return calculateSuggestedPayment(cost, availableSources, colorsToPreserve, floatingMana);
  }, [currentCost, manaCost, xValue, availableSources, otherCardsInHand, floatingMana]);

  // Calculate how much floating mana will be used
  const floatingManaUsage = useMemo(() => {
    if (!floatingMana) return null;
    const parsed = parseManaCost(currentCost?.manaCost || manaCost);
    // For XX costs, multiply xValue by the number of X's (xCount)
    const xMultiplier = parsed.xCount || 1;
    const cost = { colors: parsed.colors, generic: parsed.generic + Math.max(0, xValue * xMultiplier), hybrids: parsed.hybrids };
    const { usedFromPool } = calculateRemainingCostAfterFloatingMana(cost, floatingMana);
    const totalUsed = Object.values(usedFromPool).reduce((a, b) => a + b, 0);
    return totalUsed > 0 ? usedFromPool : null;
  }, [currentCost, manaCost, xValue, floatingMana]);

  if (!open) return null;

  // Helper to get mana count for a source
  // Uses getTotalManaProduction which correctly handles choice sources vs multi-mana sources:
  // - Sol Ring ['C','C'] = 2 mana (duplicates = multi-mana)
  // - Command Tower ['W','U','B','R','G'] = 1 mana (all unique = choice)
  const getManaCountForSource = (permanentId: string): number => {
    const source = availableSources.find(s => s.id === permanentId);
    if (!source) return 1;
    return getTotalManaProduction(source.options);
  };

  const handleConfirm = () => {
    // If no payment was manually selected, use the suggested payment
    let finalPayment = payment;
    if (payment.length === 0 && suggestedPayment.size > 0) {
      finalPayment = Array.from(suggestedPayment.entries()).map(([permanentId, mana]) => ({
        permanentId,
        mana,
        count: getManaCountForSource(permanentId),
      }));
    }
    onConfirm(
      finalPayment, 
      selectedCostId !== 'normal' ? selectedCostId : undefined, 
      xValue,
      selectedConvokeCreatures.length > 0 ? selectedConvokeCreatures : undefined
    );
    setPayment([]);
    setXValue(0);
    setSelectedCostId('normal');
    setSelectedConvokeCreatures([]);
  };

  const handleCancel = () => {
    onCancel();
    setPayment([]);
    setXValue(0);
    setSelectedCostId('normal');
    setSelectedConvokeCreatures([]);
  };

  // Check if there's floating mana that will be used
  const hasFloatingManaToUse = floatingManaUsage && Object.values(floatingManaUsage).some(v => v > 0);
  
  // Show alternate cost selector if there are options
  const showAlternateCosts = alternateCosts.length > 1;

  return (
    <div style={backdrop}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Cast {cardName}</h3>
          <button onClick={handleCancel} style={{ fontSize: 18, padding: '2px 8px' }}>×</button>
        </div>

        {/* Alternate Cost Selector */}
        {showAlternateCosts && (
          <div style={{ 
            marginBottom: 16, 
            padding: 12, 
            backgroundColor: 'rgba(59, 130, 246, 0.1)', 
            borderRadius: 8,
            border: '1px solid rgba(59, 130, 246, 0.3)',
          }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8, fontWeight: 600 }}>
              Choose Casting Cost:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {alternateCosts.map(cost => (
                <label
                  key={cost.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '8px 10px',
                    backgroundColor: selectedCostId === cost.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: selectedCostId === cost.id ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    name="castingCost"
                    checked={selectedCostId === cost.id}
                    onChange={() => setSelectedCostId(cost.id)}
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 500 }}>{cost.label}</span>
                      <span style={{ 
                        fontFamily: 'monospace', 
                        backgroundColor: 'rgba(0,0,0,0.3)', 
                        padding: '2px 6px', 
                        borderRadius: 4,
                        fontSize: 12,
                      }}>
                        {cost.manaCost || '{0}'}
                      </span>
                    </div>
                    {cost.description && (
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                        {cost.description}
                      </div>
                    )}
                    {cost.additionalCost && (
                      <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
                        ⚠ {cost.additionalCost}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Cost Reduction Display */}
        {costReduction && costReduction.messages.length > 0 && (
          <div style={{
            marginBottom: 12,
            padding: 10,
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderRadius: 8,
            border: '1px solid rgba(16, 185, 129, 0.3)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#10b981', marginBottom: 4 }}>
              💰 Cost Reductions:
            </div>
            {manaCost && effectiveManaCost !== manaCost && (
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{manaCost}</span>
                {' → '}
                <span style={{ fontWeight: 600, color: '#10b981' }}>{effectiveManaCost}</span>
              </div>
            )}
            <div style={{ fontSize: 11, color: '#888' }}>
              {costReduction.messages.map((msg, i) => (
                <div key={i}>• {msg}</div>
              ))}
            </div>
          </div>
        )}

        {/* Convoke Options */}
        {convokeOptions && convokeOptions.availableCreatures.length > 0 && (
          <div style={{
            marginBottom: 12,
            padding: 10,
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            borderRadius: 8,
            border: '1px solid rgba(139, 92, 246, 0.3)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8b5cf6', marginBottom: 6 }}>
              ⚡ Convoke: Tap Creatures to Help Pay
            </div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
              Each creature tapped pays for {'{1}'} or one mana of its color
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
              {convokeOptions.availableCreatures.map(creature => (
                <label
                  key={creature.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    backgroundColor: selectedConvokeCreatures.includes(creature.id) ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                    borderRadius: 4,
                    cursor: 'pointer',
                    border: selectedConvokeCreatures.includes(creature.id) ? '1px solid rgba(139, 92, 246, 0.5)' : '1px solid transparent',
                    transition: 'all 0.15s',
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedConvokeCreatures.includes(creature.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedConvokeCreatures([...selectedConvokeCreatures, creature.id]);
                      } else {
                        setSelectedConvokeCreatures(selectedConvokeCreatures.filter(id => id !== creature.id));
                      }
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 500 }}>{creature.name}</span>
                    <span style={{ color: '#888', marginLeft: 8, fontSize: 11 }}>
                      (pays: {creature.canTapFor.slice(0, 3).join(', ')}{creature.canTapFor.length > 3 ? '...' : ''})
                    </span>
                  </div>
                </label>
              ))}
            </div>
            {selectedConvokeCreatures.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#8b5cf6' }}>
                ✓ Tapping {selectedConvokeCreatures.length} creature{selectedConvokeCreatures.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}

        {/* Show floating mana pool if available */}
        {floatingMana && (
          <div style={{ marginBottom: 12 }}>
            <FloatingManaPool manaPool={floatingMana} compact />
            {hasFloatingManaToUse && (
              <div style={{ 
                marginTop: 6, 
                fontSize: 12, 
                color: '#68d391',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                ✓ Will use floating mana: {
                  Object.entries(floatingManaUsage!)
                    .filter(([_, v]) => v > 0)
                    .map(([color, amount]) => `${amount} ${color}`)
                    .join(', ')
                }
              </div>
            )}
          </div>
        )}

        <PaymentPicker
          manaCost={currentCost?.manaCost || effectiveManaCost || manaCost}
          manaCostDisplay={currentCost?.manaCost || effectiveManaCost || manaCost}
          sources={availableSources}
          chosen={payment}
          xValue={xValue}
          onChangeX={setXValue}
          onChange={setPayment}
          otherCardsInHand={otherCardsInHand}
          floatingMana={floatingMana}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={handleCancel}>Cancel</button>
          <button onClick={handleConfirm} style={{ background: '#2b6cb0', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: 6, cursor: 'pointer' }}>
            {selectedCostId !== 'normal' ? `Cast with ${currentCost?.label}` : 'Cast Spell'}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
};

const modal: React.CSSProperties = {
  background: '#1d1f21',
  border: '1px solid #444',
  borderRadius: 8,
  padding: '16px 20px',
  minWidth: 500,
  maxWidth: 700,
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 4px 20px rgba(0,0,0,0.8)',
  color: '#eee',
};
