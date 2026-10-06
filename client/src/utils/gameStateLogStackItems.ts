// Game log wording for stack items (spells, activated abilities, triggered abilities).
// Public entry symbols: describeStackItemAdded, describeStackItemResolved, stackItemSpellName.
//
// Abilities on the stack carry no spell card (triggers) or a placeholder card named
// "<source> (ability)" (activations), so labelling every new stack item as a cast logged
// "A2 casts Permanent". Each kind now gets its own wording and the real source/card name.

import { formatCastSpellMessage, formatStackTargets } from '../../../shared/src/gameLogFormat';

type NameResolver = (playerId: string) => string;

type StackItemKind = 'spell' | 'triggered' | 'activated';

function stackItemKind(item: any): StackItemKind {
  const type = String(item?.type || '').toLowerCase();
  if (type.includes('trigger')) return 'triggered';
  if (type === 'spell' || !type) return 'spell';
  if (type.includes('ability')) return 'activated';
  return 'spell';
}

function firstName(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (text) return text;
  }
  return '';
}

/** The spell's card name (front face for multi-face cards). */
export function stackItemSpellName(item: any): string {
  const card = item?.card;
  return firstName(
    card?.name,
    Array.isArray(card?.card_faces) ? card.card_faces[0]?.name : undefined,
    item?.name,
    item?.cardName,
    item?.sourceName,
  ) || 'a spell';
}

function abilitySourceName(item: any): string {
  const placeholder = String(item?.card?.name || '').replace(/\s*\(ability\)\s*$/i, '');
  return firstName(item?.sourceName, item?.cardName, placeholder, item?.name) || 'A permanent';
}

function targetsSuffix(item: any, resolveName: NameResolver): string {
  const details = Array.isArray(item?.targetDetails) ? item.targetDetails : undefined;
  return details ? formatStackTargets(details, resolveName) : '';
}

/** Log line for an item newly put on the stack. */
export function describeStackItemAdded(item: any, resolveName: NameResolver): string {
  const controllerName = resolveName(String(item?.controller || ''));
  const kind = stackItemKind(item);
  if (kind === 'triggered') {
    return `${abilitySourceName(item)} triggers (${controllerName})${targetsSuffix(item, resolveName)}`;
  }
  if (kind === 'activated') {
    return `${controllerName} activates ${abilitySourceName(item)}${targetsSuffix(item, resolveName)}`;
  }
  return formatCastSpellMessage(controllerName, stackItemSpellName(item), item?.targetDetails, resolveName);
}

/** Log line for an item that left the stack. */
export function describeStackItemResolved(item: any): string {
  const kind = stackItemKind(item);
  if (kind === 'spell') return `${stackItemSpellName(item)} resolves`;
  return `${abilitySourceName(item)} ability resolves`;
}
