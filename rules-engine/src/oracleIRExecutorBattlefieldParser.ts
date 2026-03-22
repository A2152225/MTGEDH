import {
  isThatOwnerOrControllerSelector,
  isThoseOpponentsSelector,
} from './oracleIRExecutorPlayerUtils';

export type SimpleBattlefieldSelector = {
  readonly kind: 'battlefield_selector';
  readonly types: readonly SimplePermanentType[];
  readonly controllerFilter: 'any' | 'you' | 'opponents';
};

export type SimplePermanentType =
  | 'permanent'
  | 'nonland_permanent'
  | 'creature'
  | 'artifact'
  | 'enchantment'
  | 'land'
  | 'planeswalker'
  | 'battle';

export type DeterministicMixedDamagePlayerTarget =
  | 'you'
  | 'each_player'
  | 'each_opponent'
  | 'each_of_those_opponents'
  | 'target_player'
  | 'target_opponent';

export function parseDeterministicMixedDamageTarget(
  rawText: string
): {
  readonly players: ReadonlySet<DeterministicMixedDamagePlayerTarget>;
  readonly selectors: readonly SimpleBattlefieldSelector[];
} | null {
  const lower = String(rawText || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\.!]$/, '');

  if (!lower) return null;
  if (/\band\/or\b/i.test(lower)) return null;

  const parts = lower.split(/\s*(?:,|and)\s*/i).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return null;

  const players = new Set<DeterministicMixedDamagePlayerTarget>();
  const selectors: SimpleBattlefieldSelector[] = [];

  for (const part of parts) {
    if (part === 'you') {
      players.add('you');
      continue;
    }
    if (part === 'each player' || part === 'all players') {
      players.add('each_player');
      continue;
    }
    if (
      part === 'each opponent' ||
      part === 'all opponents' ||
      part === 'each of your opponents' ||
      part === 'all of your opponents' ||
      part === 'each of the opponents' ||
      part === 'all of the opponents' ||
      part === 'your opponents' ||
      part === 'all your opponents'
    ) {
      players.add('each_opponent');
      continue;
    }
    if (isThoseOpponentsSelector(part)) {
      players.add('each_of_those_opponents');
      continue;
    }
    if (
      part === 'that player' ||
      part === 'he or she' ||
      part === 'him or her' ||
      part === 'they' ||
      part === 'its controller' ||
      part === 'its owner' ||
      isThatOwnerOrControllerSelector(part)
    ) {
      players.add('target_player');
      continue;
    }
    if (part === 'that opponent' || part === 'defending player' || part === 'the defending player') {
      players.add('target_opponent');
      continue;
    }

    if (
      /\bor\b/i.test(part) &&
      !/^(?:each|all)\b/i.test(part) &&
      !/^(?:your\b|opponent\b|opponents\b)/i.test(part)
    ) {
      return null;
    }

    let candidate = part;
    if (
      !/^(?:each|all)\b/i.test(candidate) &&
      /^(?:creature|creatures|planeswalker|planeswalkers|battle|battles)\b/i.test(candidate)
    ) {
      candidate = `each ${candidate}`;
    }

    const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: candidate } as any);
    if (!selector) return null;

    const disallowed = selector.types.some(
      t => t === 'land' || t === 'artifact' || t === 'enchantment' || t === 'permanent' || t === 'nonland_permanent'
    );
    if (disallowed) return null;

    selectors.push(selector);
  }

  if (players.size === 0 || selectors.length === 0) return null;
  return { players, selectors };
}

export function normalizeRepeatedEachAllInList(text: string): string {
  return String(text || '')
    .replace(/\b(and|or)\s+(?:each|all)\s+/gi, '$1 ')
    .replace(/,\s*(?:each|all)\s+/gi, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSimpleBattlefieldSelector(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string }
): SimpleBattlefieldSelector | null {
  if (target.kind !== 'raw') return null;
  const text = String((target as any).text || '').trim();
  if (!text) return null;

  const lower = text.replace(/\u2019/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  const m = lower.match(/^(?:all|each)\s+(.+)$/i);

  let remainder = '';
  let controllerFilter: SimpleBattlefieldSelector['controllerFilter'] = 'any';

  if (m) {
    remainder = String(m[1] || '').trim();
    if (!remainder) return null;
    remainder = remainder.replace(/^of\s+/i, '').replace(/^the\s+/i, '').trim();
  } else {
    const oppPlural = remainder || lower;
    if (/^(?:your\s+)?opponents?'s\s+/i.test(oppPlural) || /^(?:your\s+)?opponents?'\s+/i.test(oppPlural)) {
      controllerFilter = 'opponents';
      remainder = oppPlural
        .replace(/^(?:your\s+)?opponents?'s\s+/i, '')
        .replace(/^(?:your\s+)?opponents?'\s+/i, '')
        .trim();
    } else if (/^opponent's\s+/i.test(oppPlural) || /^opponent'\s+/i.test(oppPlural)) {
      controllerFilter = 'opponents';
      remainder = oppPlural.replace(/^opponent's\s+/i, '').replace(/^opponent'\s+/i, '').trim();
    } else if (/^your\s+/i.test(oppPlural)) {
      controllerFilter = 'you';
      remainder = oppPlural.replace(/^your\s+/i, '').trim();
    } else {
      if (
        /\byou control\b/i.test(oppPlural) ||
        /\b(?:your opponents|opponents)\s+control\b/i.test(oppPlural) ||
        /\b(?:each opponent|an opponent)\s+controls\b/i.test(oppPlural) ||
        /\byou\s+(?:don'?t|do not)\s+control\b/i.test(oppPlural)
      ) {
        remainder = oppPlural.trim();
      } else {
        return null;
      }
    }

    if (!remainder) return null;
  }

  if (/^(?:your\s+)?opponents?'s\s+/i.test(remainder) || /^(?:your\s+)?opponents?'\s+/i.test(remainder)) {
    controllerFilter = 'opponents';
    remainder = remainder
      .replace(/^(?:your\s+)?opponents?'s\s+/i, '')
      .replace(/^(?:your\s+)?opponents?'\s+/i, '')
      .trim();
  }

  if (/^opponent's\s+/i.test(remainder) || /^opponent'\s+/i.test(remainder)) {
    controllerFilter = 'opponents';
    remainder = remainder.replace(/^opponent's\s+/i, '').replace(/^opponent'\s+/i, '').trim();
  }

  if (/\byou control\b/i.test(remainder)) controllerFilter = 'you';
  if (/\b(?:your opponents|opponents)\s+control\b/i.test(remainder)) controllerFilter = 'opponents';
  if (/\b(?:each opponent|an opponent)\s+controls\b/i.test(remainder)) controllerFilter = 'opponents';
  if (/\byou\s+(?:don'?t|do not)\s+control\b/i.test(remainder)) controllerFilter = 'opponents';

  remainder = remainder
    .replace(/\byou control\b/i, '')
    .replace(/\b(?:your opponents|opponents)\s+control\b/i, '')
    .replace(/\b(?:each opponent|an opponent)\s+controls\b/i, '')
    .replace(/\byou\s+(?:don'?t|do not)\s+control\b/i, '')
    .trim();

  if (!remainder) return null;
  if (/\bnonland\b/.test(remainder) && !/^nonland\s+permanents?\b/.test(remainder)) return null;

  if (/^nonland\s+permanents?\b/.test(remainder)) {
    return { kind: 'battlefield_selector', types: ['nonland_permanent'], controllerFilter };
  }

  if (/^permanents?\b/.test(remainder)) {
    return { kind: 'battlefield_selector', types: ['permanent'], controllerFilter };
  }

  const cleaned = remainder.replace(/\bpermanents?\b/g, '').trim();
  if (!cleaned) return null;

  const parts = cleaned.split(/\s*(?:,|and\/or|and|or)\s*/i).filter(Boolean);
  if (parts.length === 0) return null;

  const allowed = new Set<SimplePermanentType>([
    'creature',
    'artifact',
    'enchantment',
    'land',
    'planeswalker',
    'battle',
  ]);
  const types: SimplePermanentType[] = [];
  for (const part of parts) {
    let t = part.trim().toLowerCase();
    if (t.endsWith('s')) t = t.slice(0, -1);
    if (!allowed.has(t as SimplePermanentType)) return null;
    types.push(t as SimplePermanentType);
  }

  return { kind: 'battlefield_selector', types, controllerFilter };
}

export function parseSimplePermanentTypeFromText(text: string): SimplePermanentType | null {
  const lower = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();

  if (!lower) return null;
  if (/\bnonland\s+permanent(s)?\b/i.test(lower)) return 'nonland_permanent';
  if (/\bcreature(s)?\b/i.test(lower)) return 'creature';
  if (/\bartifact(s)?\b/i.test(lower)) return 'artifact';
  if (/\benchantment(s)?\b/i.test(lower)) return 'enchantment';
  if (/\bland(s)?\b/i.test(lower)) return 'land';
  if (/\bpermanent(s)?\b/i.test(lower)) return 'permanent';
  return null;
}
