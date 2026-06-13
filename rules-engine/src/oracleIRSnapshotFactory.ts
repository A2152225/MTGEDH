import type {
  OracleIRTransitionKind,
  RuntimeObjectSnapshot,
  RuntimeObjectZone,
} from './oracleIRTransitionTypes';
import {
  createLastKnownPermanentSnapshot,
} from './oracleIRExecutorLastKnownInfo';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

let snapshotSequence = 0;

export function nextOracleIRSnapshotId(prefix = 'ir-snap'): string {
  snapshotSequence += 1;
  return `${prefix}-${snapshotSequence}`;
}

function toFinite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTypeLineParts(typeLine: string): {
  supertypes: string[];
  types: string[];
  subtypes: string[];
} {
  const normalized = String(typeLine || '').toLowerCase().trim();
  const dashParts = normalized.split(/\s+[—–-]\s+/);
  const left = dashParts[0] || '';
  const right = dashParts.slice(1).join(' ').trim();

  const leftTokens = left.split(/\s+/).filter(Boolean);
  const knownTypes = new Set([
    'artifact', 'battle', 'creature', 'enchantment', 'instant', 'land',
    'planeswalker', 'sorcery', 'kindred', 'tribal',
  ]);
  const knownSupertypes = new Set(['legendary', 'basic', 'snow', 'world']);

  const supertypes: string[] = [];
  const types: string[] = [];
  for (const token of leftTokens) {
    if (knownSupertypes.has(token) && !supertypes.includes(token)) {
      supertypes.push(token);
    } else if (knownTypes.has(token) && !types.includes(token)) {
      types.push(token);
    }
  }

  const subtypes = right
    ? right.split(/\s+/).filter(Boolean)
    : [];

  return { supertypes, types, subtypes };
}

function extractColors(card: any): readonly string[] {
  const raw = Array.isArray(card?.colors)
    ? card.colors
    : Array.isArray(card?.color_identity)
      ? card.color_identity
      : [];
  return raw.map((c: unknown) => String(c || '').trim().toUpperCase()).filter(Boolean);
}

export function snapshotObjectAtZone(args: {
  object: unknown;
  zone: RuntimeObjectZone;
  ownerId: string;
  controllerId?: string;
  affectedByStepIndex: number;
  transitionId: string;
  transitionKind: OracleIRTransitionKind;
}): RuntimeObjectSnapshot {
  const perm = args.object as any;
  const card = perm?.card ?? perm;
  const typeLine = getExecutorTypeLineLower(perm?.card ? perm : card);
  const { supertypes, types, subtypes } = parseTypeLineParts(typeLine);

  if (args.zone === 'battlefield' && perm?.id) {
    const lki = createLastKnownPermanentSnapshot(perm);
    const parsed = parseTypeLineParts(lki.typeLine);
    return {
      objectId: lki.id,
      cardInstanceId: String(card?.id || '').trim() || undefined,
      zone: args.zone,
      ownerId: args.ownerId as RuntimeObjectSnapshot['ownerId'],
      controllerId: (lki.controller ?? args.controllerId) as RuntimeObjectSnapshot['ownerId'] | undefined,
      name: lki.name,
      typeLine: lki.typeLine,
      supertypes: parsed.supertypes,
      types: parsed.types.length > 0 ? parsed.types : parsed.supertypes,
      subtypes: parsed.subtypes,
      power: lki.power,
      toughness: lki.toughness,
      manaValue: lki.manaValue,
      colors: [...lki.colors],
      isToken: Boolean(perm?.isToken ?? card?.isToken),
      isCommander: Boolean(perm?.isCommander ?? card?.isCommander),
      counters: { ...(perm?.counters ?? {}) },
      tapped: Boolean(perm?.tapped),
      faceDown: Boolean(perm?.faceDown),
      affectedByStepIndex: args.affectedByStepIndex,
      transitionId: args.transitionId,
      transitionKind: args.transitionKind,
    };
  }

  const isCreature = types.includes('creature') || typeLine.includes('creature');
  const power = isCreature ? toFinite(card?.power ?? card?.card?.power) : null;
  const toughness = isCreature ? toFinite(card?.toughness ?? card?.card?.toughness) : null;

  return {
    objectId: String(perm?.id ?? card?.id ?? nextOracleIRSnapshotId()).trim(),
    cardInstanceId: String(card?.id ?? '').trim() || undefined,
    zone: args.zone,
    ownerId: String(
      perm?.ownerId ?? perm?.owner ?? card?.ownerId ?? card?.owner ?? args.ownerId,
    ).trim() as RuntimeObjectSnapshot['ownerId'],
    controllerId: String(
      perm?.controllerId ?? perm?.controller ?? card?.controllerId ?? card?.controller ?? args.controllerId ?? args.ownerId,
    ).trim() as RuntimeObjectSnapshot['ownerId'] | undefined,
    name: String(card?.name ?? perm?.name ?? '').trim(),
    typeLine,
    supertypes,
    types,
    subtypes,
    power,
    toughness,
    manaValue: getCardManaValue(card),
    colors: extractColors(card),
    isToken: Boolean(card?.isToken ?? perm?.isToken),
    isCommander: Boolean(card?.isCommander ?? perm?.isCommander),
    counters: {},
    affectedByStepIndex: args.affectedByStepIndex,
    transitionId: args.transitionId,
    transitionKind: args.transitionKind,
  };
}

export function snapshotCardsFromZone(args: {
  cards: readonly unknown[];
  zone: RuntimeObjectZone;
  ownerId: string;
  controllerId?: string;
  affectedByStepIndex: number;
  transitionId: string;
  transitionKind: OracleIRTransitionKind;
}): RuntimeObjectSnapshot[] {
  return args.cards.map((card) => snapshotObjectAtZone({
    object: card,
    zone: args.zone,
    ownerId: args.ownerId,
    controllerId: args.controllerId,
    affectedByStepIndex: args.affectedByStepIndex,
    transitionId: args.transitionId,
    transitionKind: args.transitionKind,
  }));
}
