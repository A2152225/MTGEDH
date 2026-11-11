/**
 * Map one oracle card to a CardAIProfile via IR steps (+ analyzer fallback).
 *
 * Origin: AI_Upgrade Phase 1 (P1-4).
 * Public entry symbols: collectSteps, mapCardToProfile, legacyRoles, emptyProfile.
 */

import type { CardAIProfile, CardAIProfileNeed, CardRole } from '../../../rules-engine/src/ai/cardProfileTypes.js';
import { CARD_ROLES } from '../../../rules-engine/src/ai/cardProfileTypes.js';
import type { OracleEffectStep } from '../../../rules-engine/src/oracleIR.js';
import type { OracleIRResult } from '../../../rules-engine/src/oracleIR.js';
import { CardCategory, type CardAnalysis } from '../../../rules-engine/src/CardAnalyzer-handlers/cardAnalyzerTypes.js';

export type OracleCardLike = {
  oracle_id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: Array<{
    name?: string;
    type_line?: string;
    oracle_text?: string;
  }>;
  legalities?: { commander?: string };
};

type ParseFn = (oracleText: string, cardName?: string) => OracleIRResult;
type AnalyzeFn = (card: any) => CardAnalysis;

const SIMPLE_ROLE: Partial<Record<string, CardRole>> = {
  add_mana: 'ramp',
  draw: 'draw',
  counter_spell: 'counterspell',
  create_token: 'token_maker',
  gain_life: 'lifegain',
  win_game: 'wincon',
  take_extra_turn: 'wincon',
  prevent_damage: 'protection',
};

const ANALYZER_ROLE: Partial<Record<CardCategory, CardRole>> = {
  [CardCategory.RAMP]: 'ramp',
  [CardCategory.DRAW]: 'draw',
  [CardCategory.TUTOR]: 'tutor',
  [CardCategory.REMOVAL]: 'removal',
  [CardCategory.BOARD_WIPE]: 'sweeper',
  [CardCategory.COUNTERSPELL]: 'counterspell',
  [CardCategory.PROTECTION]: 'protection',
  [CardCategory.TOKEN_GENERATOR]: 'token_maker',
  [CardCategory.REANIMATOR]: 'recursion',
};

const GRAVEYARD_HATE = [
  'from a graveyard',
  'from any graveyard',
  'from each graveyard',
  'from all graveyards',
  'from target player\'s graveyard',
  'from an opponent\'s graveyard',
];

function words(t: string): Set<string> {
  return new Set(t.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean));
}

export function collectSteps(steps: readonly OracleEffectStep[], out: OracleEffectStep[] = []): OracleEffectStep[] {
  for (const s of steps) {
    out.push(s);
    const anyStep = s as any;
    if (s.kind === 'conditional') {
      collectSteps(anyStep.steps || [], out);
      collectSteps(anyStep.elseSteps || [], out);
    }
    if (s.kind === 'choose_mode') {
      for (const m of anyStep.modes || []) collectSteps(m.steps || [], out);
    }
    if (typeof s.kind === 'string' && s.kind.startsWith('unless_') && Array.isArray(anyStep.steps)) {
      collectSteps(anyStep.steps, out);
    }
  }
  return out;
}

function rolesForStep(step: OracleEffectStep): CardRole[] {
  const raw = String((step as any).raw ?? '').toLowerCase();
  const w = words(raw);
  switch (step.kind) {
    case 'destroy':
    case 'exile':
    case 'gain_control':
    case 'deal_damage': {
      const massNoun = [
        'creature',
        'creatures',
        'permanent',
        'permanents',
        'nonland',
        'artifacts',
        'enchantments',
      ].some((n) => w.has(n));
      if ((w.has('each') || w.has('all')) && massNoun) return ['sweeper'];
      if (w.has('target') && !GRAVEYARD_HATE.some((p) => raw.includes(p))) return ['removal'];
      return [];
    }
    case 'search_library': {
      const criteria = (step as any).criteria;
      const wanted =
        criteria?.kind === 'raw' ? String(criteria.text || '').toLowerCase() : '';
      return wanted.includes('basic land') ? ['ramp'] : ['tutor'];
    }
    case 'move_zone': {
      const to = String((step as any).to || '');
      const from = String((step as any).from || '');
      if (
        (raw.includes('graveyard') || from === 'graveyard')
        && (to === 'hand' || to === 'battlefield')
      ) {
        return ['recursion'];
      }
      return [];
    }
    case 'grant_temporary_ability': {
      if (
        ['hexproof', 'indestructible', 'shroud'].some((k) => w.has(k))
        || raw.includes('protection from')
      ) {
        return ['protection'];
      }
      return [];
    }
    default: {
      const r = SIMPLE_ROLE[step.kind];
      return r ? [r] : [];
    }
  }
}

function needsFrom(text: string): CardAIProfileNeed[] {
  const lower = text.toLowerCase();
  const needs: CardAIProfileNeed[] = [];
  if (lower.includes('target creature')) needs.push('target_creature');
  if (lower.includes('target permanent') || lower.includes('target nonland permanent')) {
    needs.push('target_permanent');
  }
  if (
    lower.includes('target player')
    || lower.includes('target opponent')
    || lower.includes('any target')
  ) {
    needs.push('target_player');
  }
  if (lower.includes('from your graveyard') || lower.includes('card from a graveyard')) {
    needs.push('graveyard_card');
  }
  return [...new Set(needs)];
}

export function emptyProfile(card: OracleCardLike): CardAIProfile {
  return {
    oracleId: String(card.oracle_id || ''),
    name: card.name,
    roles: [],
    timing: 'sorcery_speed',
    needs: [],
    source: 'ir',
  };
}

export function mapCardToProfile(
  card: OracleCardLike,
  deps: { parse: ParseFn; analyze: AnalyzeFn },
): CardAIProfile {
  const faces =
    Array.isArray(card.card_faces) && card.card_faces.length > 0
      ? card.card_faces
      : [card];
  const roles = new Set<CardRole>();
  let sawGap = false;
  let hasText = false;

  for (const face of faces) {
    const text = face.oracle_text ?? '';
    if (text.length > 0) hasText = true;
    const ir = deps.parse(text, face.name ?? card.name);
    const steps = (ir.abilities || []).flatMap((a) => collectSteps([...(a.steps || [])]));
    if ((ir.abilities || []).length === 0 || steps.some((s) => s.kind === 'unknown' || s.kind === 'raw')) {
      sawGap = true;
    }
    for (const s of steps) {
      for (const r of rolesForStep(s)) roles.add(r);
    }
  }

  let source: CardAIProfile['source'] = 'ir';
  if (roles.size === 0 && hasText && sawGap) {
    const cats = deps.analyze({ ...card }).categories || [];
    for (const c of cats) {
      const r = ANALYZER_ROLE[c as CardCategory];
      if (r) {
        roles.add(r);
        source = 'analyzer';
      }
    }
  }

  const typeLine = card.type_line ?? faces.map((f) => f.type_line || '').join(' // ');
  if (typeLine.includes('Land')) roles.delete('ramp');

  const text = faces.map((f) => f.oracle_text ?? '').join('\n').toLowerCase();
  const timing: CardAIProfile['timing'] =
    typeLine.includes('Instant') || text.includes('flash') ? 'instant' : 'sorcery_speed';

  return {
    oracleId: String(card.oracle_id || ''),
    name: card.name,
    roles: [...roles].sort((a, b) => CARD_ROLES.indexOf(a) - CARD_ROLES.indexOf(b)),
    timing,
    needs: needsFrom(text),
    source,
  };
}

/** Substring roles mirroring calculateSpellPriority for disagreement reports only. */
export function legacyRoles(card: OracleCardLike): CardRole[] {
  const typeLine = String(card.type_line || '').toLowerCase();
  const oracleText = String(card.oracle_text || '').toLowerCase();
  const roles = new Set<CardRole>();
  if (
    typeLine.includes('artifact')
    && (oracleText.includes('add {') || oracleText.includes('add one mana') || oracleText.includes('add mana'))
  ) {
    roles.add('ramp');
  }
  if (
    typeLine.includes('creature')
    && (oracleText.includes('{t}: add') || oracleText.includes('tap: add'))
  ) {
    roles.add('ramp');
  }
  if (oracleText.includes('search your library') && oracleText.includes('land')) {
    roles.add('ramp');
  }
  if (oracleText.includes('draw') && oracleText.includes('card')) {
    roles.add('draw');
  }
  if (oracleText.includes('destroy') || oracleText.includes('exile')) {
    roles.add('removal');
  }
  return [...roles];
}
