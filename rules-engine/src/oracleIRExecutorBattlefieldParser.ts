import {
  isThatOwnerOrControllerSelector,
  isThoseOpponentsSelector,
} from './oracleIRExecutorPlayerUtils';

export type SimpleBattlefieldSelector = {
  readonly kind: 'battlefield_selector';
  readonly types: readonly SimplePermanentType[];
  readonly controllerFilter: 'any' | 'you' | 'opponents' | 'target_player';
  readonly colorsAnyOf?: readonly string[];
  readonly colorlessOnly?: boolean;
  readonly excludeSourceId?: boolean;
  readonly typeLineTermsAnyOf?: readonly string[];
  readonly tappedOnly?: boolean;
  readonly nontokenOnly?: boolean;
  readonly usesChosenCreatureType?: boolean;
  readonly tokenOnly?: boolean;
  readonly attackingOnly?: boolean;
};

const BASIC_LAND_BATTLEFIELD_TYPE_NAMES = new Set([
  'plains',
  'island',
  'swamp',
  'mountain',
  'forest',
  'wastes',
]);

export type SimplePermanentType =
  | 'permanent'
  | 'nonland_permanent'
  | 'creature'
  | 'artifact'
  | 'enchantment'
  | 'land'
  | 'planeswalker'
  | 'battle'
  | 'vehicle';

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
  let tappedOnly = false;
  let normalizedLower = lower;
  if (/^(?:a|an)\s+tapped\s+/.test(normalizedLower)) {
    tappedOnly = true;
    normalizedLower = normalizedLower.replace(/^(?:a|an)\s+tapped\s+/, '').trim();
  } else if (/^tapped\s+/.test(normalizedLower)) {
    tappedOnly = true;
    normalizedLower = normalizedLower.replace(/^tapped\s+/, '').trim();
  }
  const m = normalizedLower.match(/^(?:all|each)\s+(.+)$/i);

  let remainder = '';
  let controllerFilter: SimpleBattlefieldSelector['controllerFilter'] = 'any';

  if (m) {
    remainder = String(m[1] || '').trim();
    if (!remainder) return null;
    remainder = remainder.replace(/^of\s+/i, '').replace(/^the\s+/i, '').trim();
  } else {
    const oppPlural = remainder || normalizedLower;
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
    } else if (/^target\s+/i.test(oppPlural)) {
      remainder = oppPlural.trim();
    } else {
      if (
        /\byou control\b/i.test(oppPlural) ||
        /\bthey control\b/i.test(oppPlural) ||
        /\b(?:your opponents|opponents)\s+control\b/i.test(oppPlural) ||
        /\b(?:each opponent|an opponent)\s+controls\b/i.test(oppPlural) ||
        /\b(?:that|target)\s+opponent\s+controls\b/i.test(oppPlural) ||
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
  if (/\btarget player controls\b/i.test(remainder)) controllerFilter = 'target_player';
  if (/\bthat player controls\b/i.test(remainder)) controllerFilter = 'target_player';
  if (/\b(?:that|target)\s+opponent\s+controls\b/i.test(remainder)) controllerFilter = 'target_player';
  if (/\bthey control\b/i.test(remainder)) controllerFilter = 'target_player';
  if (/\byou\s+(?:don'?t|do not)\s+control\b/i.test(remainder)) controllerFilter = 'opponents';

  remainder = remainder
    .replace(/\byou control\b/i, '')
    .replace(/\b(?:your opponents|opponents)\s+control\b/i, '')
    .replace(/\b(?:each opponent|an opponent)\s+controls\b/i, '')
    .replace(/\btarget player controls\b/i, '')
    .replace(/\bthat player controls\b/i, '')
    .replace(/\b(?:that|target)\s+opponent\s+controls\b/i, '')
    .replace(/\bthey control\b/i, '')
    .replace(/\byou\s+(?:don'?t|do not)\s+control\b/i, '')
    .trim();

  if (!remainder) return null;
  const excludeSourceId = /^(?:another|other)\b/i.test(remainder);
  remainder = remainder.replace(/^(?:a|an|the|another|other)\s+/i, '').trim();
  remainder = remainder.replace(/^target\s+/i, '').trim();
  if (/^tapped\s+/i.test(remainder)) {
    tappedOnly = true;
    remainder = remainder.replace(/^tapped\s+/i, '').trim();
  }
  let parsedNontokenOnly = false;
  if (/^nontoken\s+/i.test(remainder)) {
    parsedNontokenOnly = true;
    remainder = remainder.replace(/^nontoken\s+/i, '').trim();
  }
  if (!remainder) return null;
  if (/\bnonland\b/.test(remainder) && !/^(?:target\s+)?nonland(?:,?\s+nontoken)?\s+permanents?\b/.test(remainder)) return null;

  if (/^nonland,?\s+nontoken\s+permanents?\b/i.test(remainder)) {
    return {
      kind: 'battlefield_selector',
      types: ['nonland_permanent'],
      controllerFilter,
      excludeSourceId,
      nontokenOnly: true,
      ...(tappedOnly ? { tappedOnly: true } : {}),
    };
  }

  if (/^nonland\s+permanents?\b/.test(remainder)) {
    return {
      kind: 'battlefield_selector',
      types: ['nonland_permanent'],
      controllerFilter,
      excludeSourceId,
      ...(parsedNontokenOnly ? { nontokenOnly: true } : {}),
      ...(tappedOnly ? { tappedOnly: true } : {}),
    };
  }

  if (/^permanents?\b/.test(remainder)) {
    return {
      kind: 'battlefield_selector',
      types: ['permanent'],
      controllerFilter,
      excludeSourceId,
      ...(parsedNontokenOnly ? { nontokenOnly: true } : {}),
      ...(tappedOnly ? { tappedOnly: true } : {}),
    };
  }

  const COLOR_WORD_TO_SYMBOL: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
  };

  let colorsAnyOf: string[] | undefined;
  let colorlessOnly = false;
  const colorlessMatch = remainder.match(/^colorless\s+(.+)$/i);
  if (colorlessMatch) {
    colorlessOnly = true;
    remainder = String(colorlessMatch[1] || '').trim();
  }
  const colorOrMatch = remainder.match(
    /^((?:white|blue|black|red|green)(?:\s+or\s+(?:white|blue|black|red|green))+)\s+(.+)$/i
  );
  if (colorOrMatch) {
    colorsAnyOf = String(colorOrMatch[1] || '')
      .split(/\s+or\s+/i)
      .map(color => COLOR_WORD_TO_SYMBOL[String(color || '').trim().toLowerCase()])
      .filter((color): color is string => Boolean(color));
    remainder = String(colorOrMatch[2] || '').trim();
  } else {
    const singleColorMatch = remainder.match(/^(white|blue|black|red|green)\s+(.+)$/i);
    if (singleColorMatch) {
      const color = COLOR_WORD_TO_SYMBOL[String(singleColorMatch[1] || '').trim().toLowerCase()];
      if (color) colorsAnyOf = [color];
      remainder = String(singleColorMatch[2] || '').trim();
    }
  }

  const cleaned = remainder.replace(/\bpermanents?\b/g, '').trim();
  if (!cleaned) return null;

  if (/^creatures of the creature type of your choice$/i.test(cleaned)) {
    return {
      kind: 'battlefield_selector',
      types: ['creature'],
      controllerFilter,
      excludeSourceId,
      usesChosenCreatureType: true,
      ...(parsedNontokenOnly ? { nontokenOnly: true } : {}),
      ...(tappedOnly ? { tappedOnly: true } : {}),
    };
  }

  if (/^creature tokens$/i.test(cleaned)) {
    return {
      kind: 'battlefield_selector',
      types: ['creature'],
      controllerFilter,
      excludeSourceId,
      tokenOnly: true,
      ...(tappedOnly ? { tappedOnly: true } : {}),
    };
  }

  if (/^attacking creatures?$/i.test(cleaned)) {
    return {
      kind: 'battlefield_selector',
      types: ['creature'],
      controllerFilter,
      excludeSourceId,
      attackingOnly: true,
      ...(parsedNontokenOnly ? { nontokenOnly: true } : {}),
      ...(tappedOnly ? { tappedOnly: true } : {}),
    };
  }

  const basicLandType = cleaned.toLowerCase().replace(/s$/, '');
  if (BASIC_LAND_BATTLEFIELD_TYPE_NAMES.has(basicLandType)) {
    return {
      kind: 'battlefield_selector',
      types: ['land'],
      typeLineTermsAnyOf: [basicLandType],
      controllerFilter,
      excludeSourceId,
      ...(parsedNontokenOnly ? { nontokenOnly: true } : {}),
      ...(tappedOnly ? { tappedOnly: true } : {}),
    };
  }

  const parts = cleaned.split(/\s*(?:,|and\/or|\band\b|\bor\b)\s*/i).filter(Boolean);
  if (parts.length === 0) return null;

  const allowed = new Set<SimplePermanentType>([
    'creature',
    'artifact',
    'enchantment',
    'land',
    'planeswalker',
    'battle',
    'vehicle',
  ]);
  const types: SimplePermanentType[] = [];
  for (const part of parts) {
    let t = part.trim().toLowerCase().replace(/^(?:a|an|the)\s+/, '');
    if (t.endsWith('s')) t = t.slice(0, -1);
    if (!allowed.has(t as SimplePermanentType)) return null;
    types.push(t as SimplePermanentType);
  }

  return {
    kind: 'battlefield_selector',
    types,
    controllerFilter,
    ...(colorsAnyOf && colorsAnyOf.length > 0 ? { colorsAnyOf } : {}),
    ...(colorlessOnly ? { colorlessOnly: true } : {}),
    excludeSourceId,
    ...(parsedNontokenOnly ? { nontokenOnly: true } : {}),
    ...(tappedOnly ? { tappedOnly: true } : {}),
  };
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
  if (/\bvehicle(s)?\b/i.test(lower)) return 'vehicle';
  if (/\bpermanent(s)?\b/i.test(lower)) return 'permanent';
  return null;
}
