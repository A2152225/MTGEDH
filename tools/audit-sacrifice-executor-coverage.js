/*
 * Builds a corpus-grounded audit for sacrifice-related oracle text against the
 * current effect parser + sacrifice executor scope.
 *
 * Usage:
 *   node tools/audit-sacrifice-executor-coverage.js
 *
 * Output:
 *   tools/sacrifice-executor-coverage.json
 *   docs/sacrifice-executor-coverage.md
 */

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const oracleCardsPath = path.join(repoRoot, 'oracle-cards.json');
const atomicIndexPath = path.join(repoRoot, 'tools', 'atomic-oracle-index.json');
const atomicCardsPath = path.join(repoRoot, 'AtomicCards.json');
const outputJsonPath = path.join(repoRoot, 'tools', 'sacrifice-executor-coverage.json');
const outputMarkdownPath = path.join(repoRoot, 'docs', 'sacrifice-executor-coverage.md');
const SAMPLE_LIMIT = Math.max(1, Number.parseInt(process.env.SACRIFICE_AUDIT_SAMPLE_LIMIT || '25', 10) || 25);

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[Ã¢â‚¬â„¢â€™]/g, "'")
    .replace(/[â€œâ€]/g, '"')
    .replace(/[â€”â€“]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeObjectText(value) {
  return normalizeText(value)
    .replace(/^[,;:\s]+/, '')
    .replace(/"+$/g, '')
    .replace(/[).!?]+$/g, '')
    .trim()
    .toLowerCase();
}

function buildSelfReferenceAliases(sourceName) {
  const raw = normalizeText(sourceName);
  if (!raw) return [];

  const aliases = new Set();
  const pushAlias = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) return;
    aliases.add(normalized.toLowerCase());
  };

  pushAlias(raw);
  for (const face of raw.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    pushAlias(face);
    const commaHead = String(face.split(',')[0] || '').trim();
    if (commaHead.length >= 4) pushAlias(commaHead);
  }

  return [...aliases];
}

function normalizeSelfReferenceText(value) {
  return normalizeText(value)
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLeadingConditionSelfReferences(conditionRaw, sourceName) {
  let normalized = normalizeText(conditionRaw);
  if (!normalized) return normalized;

  for (const alias of buildSelfReferenceAliases(sourceName)) {
    if (!alias) continue;
    const escaped = escapeRegExp(alias);
    normalized = normalized
      .replace(new RegExp(`\\b${escaped}'s\\b`, 'ig'), "this permanent's")
      .replace(new RegExp(`\\b${escaped}\\b`, 'ig'), 'this permanent');
  }

  return normalizeText(normalized);
}

function parseQuantity(raw) {
  const trimmed = normalizeText(raw);
  if (!trimmed) return { kind: 'unknown' };
  if (/^x$/i.test(trimmed)) return { kind: 'x' };
  if (/^(a|an)$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^\d+$/.test(trimmed)) return { kind: 'number', value: parseInt(trimmed, 10) };

  const wordNumbers = new Map([
    ['zero', 0],
    ['one', 1],
    ['two', 2],
    ['three', 3],
    ['four', 4],
    ['five', 5],
    ['six', 6],
    ['seven', 7],
    ['eight', 8],
    ['nine', 9],
    ['ten', 10],
    ['eleven', 11],
    ['twelve', 12],
    ['thirteen', 13],
    ['fourteen', 14],
    ['fifteen', 15],
    ['sixteen', 16],
    ['seventeen', 17],
    ['eighteen', 18],
    ['nineteen', 19],
    ['twenty', 20],
  ]);

  if (wordNumbers.has(trimmed.toLowerCase())) {
    return { kind: 'number', value: wordNumbers.get(trimmed.toLowerCase()) };
  }

  return { kind: 'unknown', raw: trimmed };
}

function parseSimplePermanentTypeFromText(text) {
  const lower = normalizeObjectText(text);
  if (!lower) return null;
  if (/\bnonland\s+permanent(s)?\b/i.test(lower)) return 'nonland_permanent';
  if (/\bcreature(s)?\b/i.test(lower)) return 'creature';
  if (/\bartifact(s)?\b/i.test(lower)) return 'artifact';
  if (/\benchantment(s)?\b/i.test(lower)) return 'enchantment';
  if (/\bland(s)?\b/i.test(lower)) return 'land';
  if (/\bvehicle(s)?\b/i.test(lower)) return 'vehicle';
  if (/\bplaneswalker(s)?\b/i.test(lower)) return 'planeswalker';
  if (/\bpermanent(s)?\b/i.test(lower)) return 'permanent';
  return null;
}

function parseMixedTypes(text) {
  const parts = normalizeObjectText(text)
    .split(/\s+(?:or|and\/or)\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return null;

  const types = [];
  for (const part of parts) {
    const parsed = parseSimplePermanentTypeFromText(part);
    if (!parsed) return null;
    if (!types.includes(parsed)) types.push(parsed);
  }

  return types.length > 1 ? types : null;
}

function parseTimedCleanupReference(objectText) {
  const cleaned = normalizeObjectText(objectText);
  if (!cleaned) return null;

  const timingPatterns = [
    {
      pattern: '\\s+at\\s+the\\s+beginning\\s+of\\s+(?:the\\s+)?next\\s+end\\s+step\\)?$',
      timing: 'next_end_step',
    },
    {
      pattern: '\\s+at\\s+the\\s+beginning\\s+of\\s+your\\s+next\\s+end\\s+step\\)?$',
      timing: 'your_next_end_step',
    },
    {
      pattern: '\\s+at\\s+end\\s+of\\s+combat\\)?$',
      timing: 'end_of_combat',
    },
    {
      pattern: '\\s+at\\s+the\\s+end\\s+of\\s+combat\\)?$',
      timing: 'end_of_combat',
    },
    {
      pattern: '\\s+at\\s+end\\s+of\\s+turn\\)?$',
      timing: 'next_end_step',
    },
    {
      pattern: '\\s+at\\s+the\\s+end\\s+of\\s+turn\\)?$',
      timing: 'next_end_step',
    },
    {
      pattern: '\\s+at\\s+the\\s+beginning\\s+of\\s+(?:the\\s+)?next\\s+cleanup\\s+step\\)?$',
      timing: 'next_cleanup_step',
    },
    {
      pattern: '\\s+at\\s+the\\s+beginning\\s+of\\s+(?:the\\s+)?next\\s+upkeep\\)?$',
      timing: 'next_upkeep',
    },
    {
      pattern: '\\s+at\\s+the\\s+beginning\\s+of\\s+your\\s+next\\s+upkeep\\)?$',
      timing: 'your_next_upkeep',
    },
  ];

  for (const entry of timingPatterns) {
    const regex = new RegExp(entry.pattern, 'i');
    if (!regex.test(cleaned)) continue;
    const base = cleaned.replace(regex, '').trim();
    if (!base) return null;
    return {
      base,
      timedObjectText: cleaned,
      timing: entry.timing,
    };
  }

  return null;
}

function parseConditionalSacrificeObjectText(objectText) {
  const cleaned = normalizeObjectText(objectText);
  if (!cleaned) return null;

  let m = cleaned.match(/^(.+?)\s+if it has mana value (a|an|\d+|[a-z]+) or (less|fewer|more|greater)$/i);
  if (m) {
    const quantity = parseQuantity(m[2]);
    if (quantity.kind !== 'number') return null;
    return {
      baseObjectText: String(m[1] || '').trim(),
      condition: {
        kind: 'mana_value_compare',
        comparator: /less|fewer/i.test(String(m[3] || '')) ? 'lte' : 'gte',
        value: quantity.value,
      },
    };
  }

  m = cleaned.match(/^(.+?)\s+if it has (a|an|\d+|[a-z]+) or (less|fewer|more|greater) (.+?) counters? on it$/i);
  if (m) {
    const quantity = parseQuantity(m[2]);
    if (quantity.kind !== 'number') return null;
    return {
      baseObjectText: String(m[1] || '').trim(),
      condition: {
        kind: 'counter_compare',
        counter: String(m[4] || '').trim(),
        comparator: /less|fewer/i.test(String(m[3] || '')) ? 'lte' : 'gte',
        value: quantity.value,
      },
    };
  }

  m = cleaned.match(/^(.+?)\s+if there are no (.+?) counters? on it$/i);
  if (m) {
    return {
      baseObjectText: String(m[1] || '').trim(),
      condition: {
        kind: 'counter_compare',
        counter: String(m[2] || '').trim(),
        comparator: 'eq',
        value: 0,
      },
    };
  }

  return null;
}

function parseSacrificeWhat(objectText) {
  const sourceName = arguments.length > 1 ? arguments[1] : '';
  const cleaned = normalizeObjectText(objectText);
  if (!cleaned) return null;
  const normalizeSubtypeWord = (value) => {
    const trimmed = normalizeObjectText(value);
    if (!trimmed) return '';
    return trimmed.endsWith('s') ? trimmed.slice(0, -1) : trimmed;
  };

  if (
    /\bof (?:their|his or her|that player's|that opponent's) choice\b/i.test(cleaned) ||
    /\bchosen\b/i.test(cleaned) ||
    /\bat random\b/i.test(cleaned) ||
    /\bunless\b/i.test(cleaned) ||
    /\s+or\s+pay\b/i.test(cleaned) ||
    /\s+and\s+pay\b/i.test(cleaned) ||
    /^any number of\b/i.test(cleaned) ||
    /^one or more\b/i.test(cleaned) ||
    /^up to\b/i.test(cleaned) ||
    /^one of them\b/i.test(cleaned) ||
    /^that many\b/i.test(cleaned)
  ) {
    return { mode: 'choice_required' };
  }

  if (
    /^(?:it|this creature|this artifact|this enchantment|this aura|this equipment|this land|this planeswalker|this battle|this vehicle|this permanent|this attraction)$/i.test(
      cleaned
    )
  ) {
    return { mode: 'self' };
  }

  if (buildSelfReferenceAliases(sourceName).includes(cleaned)) {
    return { mode: 'self' };
  }

  if (/^(?:that creature|the creature)$/i.test(cleaned)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^(?:that vehicle|the vehicle)$/i.test(cleaned)) {
    return { mode: 'contextual', type: 'vehicle' };
  }

  if (/^those creatures$/i.test(cleaned)) {
    return { mode: 'contextual', type: 'creature', plural: true };
  }

  if (/^that permanent$/i.test(cleaned)) {
    return { mode: 'contextual', type: 'permanent' };
  }

  if (/^(?:that token|the token)$/i.test(cleaned)) {
    return { mode: 'contextual', type: 'permanent', tokenOnly: true };
  }

  if (/^(?:those tokens|them)$/i.test(cleaned)) {
    return { mode: 'contextual', type: 'permanent', tokenOnly: /^those tokens$/i.test(cleaned), plural: true };
  }

  if (/^(?:each\s+)?tokens?\s+created\s+with\s+it$/i.test(cleaned)) {
    return { mode: 'created_with_source', plural: true };
  }

  if (/^enchanted creature$/i.test(cleaned)) {
    return { mode: 'attached_to_source', type: 'creature', relation: 'source_is_attached_to_target' };
  }

  {
    const mAttachedNamed = cleaned.match(/^an?\s+([a-z][a-z'-]*)\s+attached\s+to\s+(.+)$/i);
    if (mAttachedNamed) {
      const subtypeOrType = String(mAttachedNamed[1] || '').trim().toLowerCase();
      const attachedToName = normalizeSelfReferenceText(String(mAttachedNamed[2] || ''));
      const attachedToSelf = /^(?:it|this creature|this artifact|this enchantment|this aura|this equipment|this land|this planeswalker|this battle|this vehicle|this permanent)$/i.test(
        attachedToName
      );
      if (subtypeOrType === 'equipment') {
        if (attachedToSelf) return { mode: 'attached_to_source', type: 'artifact', relation: 'target_is_attached_to_source', subtype: 'equipment' };
        return { mode: 'attached_to_named', type: 'artifact', subtype: 'equipment', attachedToName };
      }
      if (subtypeOrType === 'aura') {
        if (attachedToSelf) return { mode: 'attached_to_source', type: 'enchantment', relation: 'target_is_attached_to_source', subtype: 'aura' };
        return { mode: 'attached_to_named', type: 'enchantment', subtype: 'aura', attachedToName };
      }
      if (subtypeOrType === 'permanent') {
        if (attachedToSelf) return { mode: 'attached_to_source', type: 'permanent', relation: 'target_is_attached_to_source' };
        return { mode: 'attached_to_named', type: 'permanent', attachedToName };
      }
    }
  }

  {
    const mentionsOpponentControl =
      /^(?:your\s+)?opponents?['"]s?\s+/i.test(cleaned) ||
      /^opponent['"]s?\s+/i.test(cleaned) ||
      /\b(?:your opponents|opponents)\s+control\b/i.test(cleaned) ||
      /\b(?:an opponent|each opponent)\s+controls\b/i.test(cleaned) ||
      /\byou\s+(?:don't|do not)\s+control\b/i.test(cleaned);

    if (!mentionsOpponentControl && (/^your\s+/i.test(cleaned) || /\b(?:you control|under your control)\b/i.test(cleaned))) {
      const stripped = cleaned
        .replace(/^your\s+/i, '')
        .replace(/\s+you\s+control\b/gi, '')
        .replace(/\s+under\s+your\s+control\b/gi, '')
        .trim();
      const type = parseSimplePermanentTypeFromText(stripped);
      if (type) return { mode: 'all', type };
      if (/^[a-z][a-z'-]*$/i.test(stripped)) {
        return { mode: 'all', type: 'permanent', subtype: normalizeSubtypeWord(stripped) };
      }
    }
  }

  if (/^all\b/i.test(cleaned)) {
    const type = parseSimplePermanentTypeFromText(cleaned);
    if (type) return { mode: 'all', type };
    const allSubtype = cleaned.match(/^all\s+([a-z][a-z'-]*)s?\b/i);
    if (allSubtype) {
      return { mode: 'all', type: 'permanent', subtype: normalizeSubtypeWord(String(allSubtype[1] || '')) };
    }
    return null;
  }

  const anotherMatch = cleaned.match(/^another\s+(.+)$/i);
  if (anotherMatch) {
    const rest = String(anotherMatch[1] || '').trim();
    const mixedTypes = parseMixedTypes(rest);
    if (mixedTypes) {
      return { mode: 'count', count: 1, type: mixedTypes[0], types: mixedTypes, excludeSource: true };
    }

    const type = parseSimplePermanentTypeFromText(rest);
    if (type) return { mode: 'count', count: 1, type, excludeSource: true };

    const tokenSubtypeMatch = rest.match(/^([a-z][a-z'-]*)\s+tokens?$/i);
    if (tokenSubtypeMatch) {
      return {
        mode: 'count',
        count: 1,
        type: 'permanent',
        subtype: normalizeSubtypeWord(String(tokenSubtypeMatch[1] || '')),
        tokenOnly: true,
        excludeSource: true,
      };
    }

    if (/^[a-z][a-z'-]*$/i.test(rest)) {
      if (/^token$/i.test(rest)) return { mode: 'count', count: 1, type: 'permanent', tokenOnly: true, excludeSource: true };
      return { mode: 'count', count: 1, type: 'permanent', subtype: normalizeSubtypeWord(rest), excludeSource: true };
    }
  }

  const countMatch = cleaned.match(/^([a-z0-9-]+)\s+(.+)$/i);
  if (!countMatch) return null;
  const countRaw = String(countMatch[1] || '').toLowerCase();
  const rest = String(countMatch[2] || '').trim();
  const parsedCount = parseQuantity(countRaw);
  if (parsedCount.kind === 'x') return { mode: 'choice_required' };
  if (parsedCount.kind !== 'number') return null;
  const count = parsedCount.value;
  if (!Number.isFinite(count) || count <= 0) return null;

  const mixedTypes = parseMixedTypes(rest);
  if (mixedTypes) {
    return { mode: 'count', count: Math.max(1, count | 0), type: mixedTypes[0], types: mixedTypes };
  }

  const type = parseSimplePermanentTypeFromText(rest);
  if (type) {
    return { mode: 'count', count: Math.max(1, count | 0), type };
  }

  const tokenSubtypeMatch = rest.match(/^([a-z][a-z'-]*)\s+tokens?$/i);
  if (tokenSubtypeMatch) {
    return {
      mode: 'count',
      count: Math.max(1, count | 0),
      type: 'permanent',
      subtype: normalizeSubtypeWord(String(tokenSubtypeMatch[1] || '')),
      tokenOnly: true,
    };
  }

  if (/^[a-z][a-z'-]*$/i.test(rest)) {
    if (/^token$/i.test(rest)) return { mode: 'count', count: Math.max(1, count | 0), type: 'permanent', tokenOnly: true };
    return { mode: 'count', count: Math.max(1, count | 0), type: 'permanent', subtype: normalizeSubtypeWord(rest) };
  }

  return null;
}

function isExplicitSelfSacrificeReference(text) {
  return /^(?:it|this creature|this artifact|this enchantment|this aura|this equipment|this land|this planeswalker|this battle|this vehicle|this permanent|this attraction)$/i.test(
    String(text || '').trim()
  );
}

function isExplicitOrNamedSelfSacrificeReference(text, sourceName) {
  if (isExplicitSelfSacrificeReference(text)) return true;
  const normalized = normalizeObjectText(text);
  return normalized.length > 0 && buildSelfReferenceAliases(sourceName).includes(normalized);
}

function splitConservativeSacrificeLeadClause(rawClause) {
  const clause = normalizeText(rawClause);
  const sourceName = arguments.length > 1 ? arguments[1] : '';
  if (!clause || !/^sacrifice\b/i.test(clause) || /^you may\b/i.test(clause)) return null;

  if (clause.includes(',')) {
    const segments = clause.split(/\s*,\s*/).map(part => part.trim()).filter(Boolean);
    if (
      segments.length > 1 &&
      /^sacrifice\b/i.test(String(segments[0] || '')) &&
      segments.slice(1).every(part => {
        const normalizedPart = String(part || '').replace(/^and\s+/i, '').trim();
        return /^(?:open|counter|draw|create|destroy|exile|return|put|gain|lose|deal|tap|untap|mill|discard|surveil|scry|goad)\b/i.test(normalizedPart) ||
          /^(?:target|that|those|its|it|each|he|they|you)\b/i.test(normalizedPart) ||
          /^(?:enchanted player|enchanted creature|defending player|the defending player)\b/i.test(normalizedPart);
      })
    ) {
      return {
        firstClause: String(segments[0] || '').trim(),
        secondClause: String(segments[1] || '').replace(/^and\s+/i, '').trim(),
      };
    }
  }

  const candidates = [];
  const thenMatch = clause.match(/^sacrifice\s+(.+?),\s*then\s+(.+)$/i);
  if (thenMatch) {
    candidates.push({
      objectText: String(thenMatch[1] || '').trim(),
      secondRaw: `then ${String(thenMatch[2] || '').trim()}`,
    });
  }

  const andMatch = clause.match(/^sacrifice\s+(.+?)\s+and\s+(.+)$/i);
  if (andMatch) {
    candidates.push({
      objectText: String(andMatch[1] || '').trim(),
      secondRaw: String(andMatch[2] || '').trim(),
    });
  }

  for (const candidate of candidates) {
    const objectText = String(candidate.objectText || '').trim();
    const secondRaw = normalizeText(candidate.secondRaw);
    if (!objectText || !secondRaw) continue;
    if (/[,:;]/.test(objectText) || /\band\/or\b/i.test(objectText) || /\bor\b/i.test(objectText)) continue;
    if (/^it\b/i.test(secondRaw) && !isExplicitOrNamedSelfSacrificeReference(objectText, sourceName)) continue;
    if (
      !/^(?:then\s+)?(?:open|counter|draw|create|destroy|exile|return|put|gain|lose|deal|tap|untap|mill|discard|surveil|scry|goad)\b/i.test(secondRaw) &&
      !/^(?:then\s+)?(?:target|that|those|its|it|each|he|they|you)\b/i.test(secondRaw) &&
      !/^(?:then\s+)?(?:enchanted player|enchanted creature|defending player|the defending player)\b/i.test(secondRaw)
    ) {
      continue;
    }

    return {
      firstClause: `Sacrifice ${objectText}`,
      secondClause: secondRaw,
    };
  }

  return null;
}

function parseLeadingConditionalWrapper(rawClause) {
  const clause = normalizeText(rawClause);
  const match = clause.match(/^if\s+(.+?),\s*(.+)$/i);
  if (!match) return null;
  return {
    conditionRaw: normalizeText(String(match[1] || '')),
    clause: normalizeText(String(match[2] || '')),
  };
}

function isAuditSupportedLeadingConditionWrapper(conditionRaw) {
  const raw = normalizeText(conditionRaw).toLowerCase();
  if (!raw) return false;
  return (
    /^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i.test(raw) ||
    raw === 'you win the flip' ||
    raw === 'that card has the chosen name' ||
    raw === 'all five types on this permanent have counters over them' ||
    raw === "the result is equal to this vehicle's mana value" ||
    raw === "the result is equal to this permanent's mana value" ||
    /^[a-z0-9][a-z0-9' -]* gets more votes$/i.test(raw)
  );
}

function isAuditSupportedIfYouCantAntecedent(previousClause) {
  let normalized = normalizeText(previousClause);
  if (!normalized) return false;
  if (/^(?:when|whenever|if|at)\b/i.test(normalized) && normalized.includes(',')) {
    normalized = normalized.slice(normalized.indexOf(',') + 1).trim();
  }
  return (
    /\bexile\s+(?:a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:(?:[a-z-]+\s+)?cards?)\s+from\s+your\s+graveyard[.\s]*$/i.test(
      normalized
    ) ||
    /\bremove\s+(?:a|an|one)\s+.+?\s+counter\s+from\s+(?:it|this aura|this creature|this artifact|this enchantment|this permanent)[.\s]*$/i.test(
      normalized
    )
  );
}

function isAuditChoiceBoundIfYouDontAntecedent(previousClause) {
  const normalized = normalizeText(previousClause);
  if (!normalized) return false;
  if (/^(?:when|whenever|if|at)\b/i.test(normalized) && normalized.includes(',')) {
    const tail = normalized.slice(normalized.indexOf(',') + 1).trim();
    return /^you may (?:sacrifice|discard|remove)\b/i.test(tail);
  }
  return /^you may (?:sacrifice|discard|remove)\b/i.test(normalized);
}

function classifySacrificeText(clause, sourceName, previousClause, previousRelevantClause) {
  const normalized = normalizeText(clause);
  let working = normalized;
  const leadingConditionalWrapper = parseLeadingConditionalWrapper(working);
  const normalizedConditionRaw = leadingConditionalWrapper
    ? normalizeLeadingConditionSelfReferences(leadingConditionalWrapper.conditionRaw, sourceName)
    : '';
  const antecedentForIfYouCant = previousRelevantClause || previousClause;
  const choiceBoundLeadingIfYouDont =
    leadingConditionalWrapper &&
    /^(?:you don't|you do not)\b/i.test(normalizedConditionRaw) &&
    isAuditChoiceBoundIfYouDontAntecedent(previousRelevantClause || previousClause);
  const supportedLeadingConditionalWrapper =
    leadingConditionalWrapper &&
    (
      isAuditSupportedLeadingConditionWrapper(normalizedConditionRaw) ||
      (
        /^(?:you can't|you cannot)$/i.test(normalizedConditionRaw) &&
        isAuditSupportedIfYouCantAntecedent(antecedentForIfYouCant)
      )
    )
      ? leadingConditionalWrapper
      : null;
  if (!/\bsacrific(?:e|es|ed|ing)\b/i.test(normalized)) return null;

  if (/\s+-\s+/.test(working)) {
    const tail = working.split(/\s+-\s+/).slice(-1)[0];
    if (/\bsacrific(?:e|es|ed|ing)\b/i.test(tail)) {
      working = tail.trim();
    }
  }

  const loyaltyTail = working.match(/^[^:]+:\s*(.+)$/);
  if (loyaltyTail && /\bsacrific(?:e|es|ed|ing)\b/i.test(loyaltyTail[1])) {
    working = String(loyaltyTail[1] || '').trim();
  }

  if (/^(?:then|and)\s+/i.test(working)) {
    working = working.replace(/^(?:then|and)\s+/i, '').trim();
  }

  if (
    /\bdidn't sacrifice\b/i.test(normalized) ||
    /\bdid not sacrifice\b/i.test(normalized) ||
    /\bthe sacrificed\b/i.test(normalized) ||
    /\bsacrificed creature'?s\b/i.test(normalized) ||
    /\bsacrificed artifact'?s\b/i.test(normalized)
  ) {
    return {
      bucket: 'other_sacrifice_text',
      objectText: null,
      parsed: null,
      normalizedObjectText: null,
    };
  }

  const colonIndex = working.indexOf(':');
  const lower = working.toLowerCase();
  const sacrificeIndex = lower.search(/\bsacrific(?:e|es)\b/);
  const sacrificeBeforeColon = colonIndex >= 0 && sacrificeIndex >= 0 && sacrificeIndex < colonIndex;

  const isAdditionalCostOrKeyword =
    sacrificeBeforeColon ||
    /\bas an additional cost\b/i.test(working) ||
    /\brather than pay\b/i.test(working) ||
    /\bas you cast this spell\b/i.test(working) ||
    /\bsacrifice\s+after\s+[ivx]+\b/i.test(lower) ||
    /^[a-z0-9'" -]+\s*\([^)]*\bsacrific(?:e|es)\b/i.test(lower) ||
    /^(?:kicker|bargain|casualty|buyback|conspire|flashback|emerge|offering|cleave|multikicker|exploit)\b/i.test(lower) ||
    /^\([^)]*\bsacrific(?:e|es)\b/i.test(working);

  if (isAdditionalCostOrKeyword) {
    return {
      bucket: 'additional_cost_or_keyword',
      objectText: null,
      parsed: null,
      normalizedObjectText: null,
    };
  }

  if (/^(?:when|whenever|if|at)\b/i.test(working) && working.includes(',')) {
    working = working.slice(working.indexOf(',') + 1).trim();
  }

  if (supportedLeadingConditionalWrapper) {
    working = supportedLeadingConditionalWrapper.clause;
  } else if (choiceBoundLeadingIfYouDont && leadingConditionalWrapper) {
    working = leadingConditionalWrapper.clause;
  }

  const splitClause =
    !leadingConditionalWrapper || supportedLeadingConditionalWrapper || choiceBoundLeadingIfYouDont
      ? splitConservativeSacrificeLeadClause(working, sourceName)
      : null;
  if (splitClause) {
    working = splitClause.firstClause;
  }

  const subjectPattern = '(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*[\'â€™]s (?:controller|owner)|any opponent)';
  const subjectSupportedPattern = new RegExp(`^(?:${subjectPattern})$`, 'i');
  const effectMatch =
    working.match(new RegExp(`^(?:${subjectPattern}\\s+)?(?:may\\s+)?sacrific(?:e|es)\\s+(.+)$`, 'i')) ||
    working.match(/^sacrifice\s+(.+)$/i);

  if (!effectMatch) {
    return {
      bucket: 'other_sacrifice_text',
      objectText: null,
      parsed: null,
      normalizedObjectText: null,
    };
  }

  const subjectMatch = working.match(new RegExp(`^(${subjectPattern})\\s+`, 'i'));
  const subject = subjectMatch ? String(subjectMatch[1] || '').trim() : 'you';
  const subjectSupported = subjectSupportedPattern.test(subject) && !/^any opponent$/i.test(subject);
  const objectText = normalizeObjectText(String(effectMatch[effectMatch.length - 1] || '').split(':')[0] || '');
  const conditionalObject = parseConditionalSacrificeObjectText(objectText);
  const parsedObjectText = conditionalObject?.baseObjectText || objectText;

  if (/^if\b/i.test(normalized) && /\binstead$/i.test(parsedObjectText)) {
    return {
      bucket: 'other_sacrifice_text',
      objectText,
      parsed: null,
      normalizedObjectText: parsedObjectText,
    };
  }

  const timedCleanup = parseTimedCleanupReference(parsedObjectText);
  if (timedCleanup && subjectSupported) {
    const timedParsed = parseSacrificeWhat(timedCleanup.base, sourceName);
    if (!timedParsed) {
      return {
        bucket: 'delayed_cleanup_followup',
        objectText,
        parsed: null,
        normalizedObjectText: parsedObjectText,
      };
    }
    if (timedParsed.mode === 'choice_required') {
      return {
        bucket: 'choice_required',
        objectText,
        parsed: timedParsed,
        normalizedObjectText: parsedObjectText,
      };
    }
    return {
      bucket: 'deterministic_supported',
      objectText,
      parsed: timedParsed,
      normalizedObjectText: parsedObjectText,
    };
  }

  const whenLeavesCleanup = parsedObjectText.match(/^(.+?)\s+when\s+(.+?)\s+leaves\s+the\s+battlefield$/i);
  if (whenLeavesCleanup && subjectSupported) {
    const actedOn = String(whenLeavesCleanup[1] || '').trim();
    const watched = String(whenLeavesCleanup[2] || '').trim();
    const actedOnParsed = parseSacrificeWhat(actedOn, sourceName);
    const watchedParsed = parseSacrificeWhat(watched, sourceName);
    if (!actedOnParsed || !watchedParsed) {
      return {
        bucket: 'unsupported',
        objectText,
        parsed: null,
        normalizedObjectText: objectText,
      };
    }
    if (actedOnParsed.mode === 'choice_required' || watchedParsed.mode === 'choice_required') {
      return {
        bucket: 'choice_required',
        objectText,
        parsed: actedOnParsed.mode === 'choice_required' ? actedOnParsed : watchedParsed,
        normalizedObjectText: objectText,
      };
    }
    return {
      bucket: 'deterministic_supported',
      objectText,
      parsed: actedOnParsed,
      normalizedObjectText: objectText,
    };
  }

  const whenControlLostCleanup = parsedObjectText.match(/^(.+?)\s+when\s+you\s+lose\s+control\s+of\s+(.+)$/i);
  if (whenControlLostCleanup && subjectSupported) {
    const actedOn = String(whenControlLostCleanup[1] || '').trim();
    const watched = String(whenControlLostCleanup[2] || '').trim();
    const actedOnParsed = parseSacrificeWhat(actedOn, sourceName);
    const watchedParsed = parseSacrificeWhat(watched, sourceName);
    if (!actedOnParsed || !watchedParsed) {
      return {
        bucket: 'unsupported',
        objectText,
        parsed: null,
        normalizedObjectText: objectText,
      };
    }
    if (actedOnParsed.mode === 'choice_required' || watchedParsed.mode === 'choice_required') {
      return {
        bucket: 'choice_required',
        objectText,
        parsed: actedOnParsed.mode === 'choice_required' ? actedOnParsed : watchedParsed,
        normalizedObjectText: objectText,
      };
    }
    return {
      bucket: 'deterministic_supported',
      objectText,
      parsed: actedOnParsed,
      normalizedObjectText: objectText,
    };
  }

  const parsed = parseSacrificeWhat(parsedObjectText, sourceName);
  const allowChoiceRequiredAnyOpponent = /^any opponent$/i.test(subject) && parsed?.mode === 'choice_required';
  if (!parsed || (!subjectSupported && !allowChoiceRequiredAnyOpponent)) {
    return {
      bucket: 'unsupported',
      objectText,
      parsed,
      normalizedObjectText: parsedObjectText,
    };
  }

  if (parsed.mode === 'choice_required') {
    return {
      bucket: 'choice_required',
      objectText,
      parsed,
      normalizedObjectText: parsedObjectText,
    };
  }

  if (choiceBoundLeadingIfYouDont) {
    return {
      bucket: 'choice_required',
      objectText,
      parsed,
      normalizedObjectText: parsedObjectText,
    };
  }

  return {
    bucket: 'deterministic_supported',
    objectText,
    parsed,
    normalizedObjectText: parsedObjectText,
  };
}

function splitIntoClauses(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  return normalized
    .split(/\n+/)
    .flatMap(part => part.split(/(?<=[.?!])\s+/))
    .map(part => normalizeText(part))
    .filter(Boolean);
}

function isRelevantConditionalAntecedentClause(clause) {
  let normalized = normalizeText(clause);
  if (!normalized) return false;
  if (/^(?:when|whenever|if|at)\b/i.test(normalized) && normalized.includes(',')) {
    normalized = normalized.slice(normalized.indexOf(',') + 1).trim();
  }

  return (
    /^you may sacrifice\b/i.test(normalized) ||
    /\bexile\s+(?:a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:(?:[a-z-]+\s+)?cards?)\s+from\s+your\s+graveyard[.\s]*$/i.test(
      normalized
    ) ||
    /\bremove\s+(?:a|an|one)\s+.+?\s+counter\s+from\s+(?:it|this aura|this creature|this artifact|this enchantment|this permanent)[.\s]*$/i.test(
      normalized
    )
  );
}

function loadOracleCardsRows() {
  if (!fs.existsSync(oracleCardsPath)) return [];
  const raw = fs.readFileSync(oracleCardsPath, 'utf8');
  const cards = JSON.parse(raw);
  if (!Array.isArray(cards)) return [];
  return cards.map(card => ({
    source: 'oracle-cards',
    name: String(card?.name || '').trim(),
    oracleId: String(card?.oracle_id || '').trim(),
    text: String(card?.oracle_text || ''),
  }));
}

function loadAtomicRowsFromIndex() {
  if (!fs.existsSync(atomicIndexPath)) return null;
  const raw = fs.readFileSync(atomicIndexPath, 'utf8');
  const index = JSON.parse(raw);
  const byOracleId = index?.byOracleId;
  if (!byOracleId || typeof byOracleId !== 'object') return null;
  return Object.entries(byOracleId).map(([oracleId, entry]) => ({
    source: 'atomic-index',
    name: Array.isArray(entry?.names) && entry.names.length > 0 ? String(entry.names[0]) : String(oracleId),
    oracleId: String(oracleId),
    text: String(entry?.oracleText || ''),
  }));
}

function pickBestPrinting(printings) {
  if (!Array.isArray(printings) || printings.length === 0) return undefined;
  const withText = printings.find(printing => typeof printing?.text === 'string' && printing.text.trim().length > 0);
  return withText || printings[0];
}

function loadAtomicRowsFromRaw() {
  if (!fs.existsSync(atomicCardsPath)) return [];
  const raw = fs.readFileSync(atomicCardsPath, 'utf8');
  const atomic = JSON.parse(raw);
  const data = atomic?.data;
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(([name, printings]) => {
    const best = pickBestPrinting(printings);
    return {
      source: 'AtomicCards',
      name: String(name),
      oracleId: String(best?.identifiers?.scryfallOracleId || `name:${normalizeText(name).toLowerCase()}`),
      text: String(best?.text || ''),
    };
  });
}

function loadRows() {
  const oracleRows = loadOracleCardsRows();
  const atomicRows = loadAtomicRowsFromIndex() || loadAtomicRowsFromRaw();
  return [...oracleRows, ...atomicRows];
}

function pushSample(target, item) {
  if (target.length < SAMPLE_LIMIT) target.push(item);
}

function toCardSample(hit) {
  return {
    name: hit.name,
    oracleId: hit.oracleId || 'n/a',
    source: hit.source,
    clause: hit.clause,
    objectText: hit.objectText || null,
    normalizedObjectText: hit.normalizedObjectText || null,
    parsed: hit.parsed || null,
  };
}

function mapObjectCounts(countMap) {
  return [...countMap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([objectText, count]) => ({ objectText, count }));
}

function main() {
  const rows = loadRows();
  const seenClauseKeys = new Set();
  const deterministicSupported = [];
  const choiceRequired = [];
  const delayedCleanupFollowups = [];
  const unsupported = [];
  const additionalCostOrKeyword = [];
  const otherSacrificeText = [];
  const impactedSupportedCards = new Map();
  const impactedChoiceCards = new Map();
  const supportedObjectCounts = new Map();
  const choiceRequiredObjectCounts = new Map();
  const delayedCleanupObjectCounts = new Map();
  const unsupportedObjectCounts = new Map();

  let sourceRowCount = 0;
  let distinctSacrificeClauses = 0;

  for (const row of rows) {
    sourceRowCount += 1;
    const clauses = splitIntoClauses(row.text);
    let lastRelevantAntecedentClause;
    for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
      const clause = clauses[clauseIndex];
      if (isRelevantConditionalAntecedentClause(clause)) {
        lastRelevantAntecedentClause = clause;
      }
      if (!/\bsacrific(?:e|es|ed|ing)\b/i.test(clause)) continue;

      const key = `${row.oracleId}::${normalizeText(clause)}`;
      if (seenClauseKeys.has(key)) continue;
      seenClauseKeys.add(key);
      distinctSacrificeClauses += 1;

      const classified = classifySacrificeText(
        clause,
        row.name,
        clauseIndex > 0 ? clauses[clauseIndex - 1] : undefined,
        lastRelevantAntecedentClause
      );
      if (!classified) continue;

      const hit = {
        name: row.name,
        oracleId: row.oracleId,
        source: row.source,
        clause: normalizeText(clause),
        objectText: classified.objectText,
        normalizedObjectText: classified.normalizedObjectText,
        parsed: classified.parsed,
      };

      if (classified.bucket === 'deterministic_supported') {
        pushSample(deterministicSupported, toCardSample(hit));
        if (hit.normalizedObjectText) {
          supportedObjectCounts.set(hit.normalizedObjectText, (supportedObjectCounts.get(hit.normalizedObjectText) || 0) + 1);
        }
        impactedSupportedCards.set(`${row.oracleId}::${row.name}`, toCardSample(hit));
        continue;
      }

      if (classified.bucket === 'choice_required') {
        pushSample(choiceRequired, toCardSample(hit));
        if (hit.normalizedObjectText) {
          choiceRequiredObjectCounts.set(hit.normalizedObjectText, (choiceRequiredObjectCounts.get(hit.normalizedObjectText) || 0) + 1);
        }
        impactedChoiceCards.set(`${row.oracleId}::${row.name}`, toCardSample(hit));
        continue;
      }

      if (classified.bucket === 'delayed_cleanup_followup') {
        pushSample(delayedCleanupFollowups, toCardSample(hit));
        if (hit.objectText) {
          delayedCleanupObjectCounts.set(hit.objectText, (delayedCleanupObjectCounts.get(hit.objectText) || 0) + 1);
        }
        continue;
      }

      if (classified.bucket === 'unsupported') {
        pushSample(unsupported, toCardSample(hit));
        if (hit.normalizedObjectText) {
          unsupportedObjectCounts.set(hit.normalizedObjectText, (unsupportedObjectCounts.get(hit.normalizedObjectText) || 0) + 1);
        }
        continue;
      }

      if (classified.bucket === 'additional_cost_or_keyword') {
        pushSample(additionalCostOrKeyword, toCardSample(hit));
        continue;
      }

      pushSample(otherSacrificeText, toCardSample(hit));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sources: {
      oracleCardsPath: fs.existsSync(oracleCardsPath) ? oracleCardsPath : null,
      atomicIndexPath: fs.existsSync(atomicIndexPath) ? atomicIndexPath : null,
      atomicCardsPath: fs.existsSync(atomicCardsPath) ? atomicCardsPath : null,
    },
    summary: {
      sourceRowCount,
      distinctSacrificeClauses,
      deterministicSupportedCardCount: impactedSupportedCards.size,
      choiceRequiredCardCount: impactedChoiceCards.size,
      deterministicSupportedClauseSamples: deterministicSupported.length,
      choiceRequiredClauseSamples: choiceRequired.length,
      delayedCleanupClauseSamples: delayedCleanupFollowups.length,
      unsupportedClauseSamples: unsupported.length,
      additionalCostOrKeywordClauseSamples: additionalCostOrKeyword.length,
      otherSacrificeTextClauseSamples: otherSacrificeText.length,
    },
    buckets: {
      deterministicSupportedCards: [...impactedSupportedCards.values()].sort((a, b) => a.name.localeCompare(b.name)),
      deterministicSupportedSamples: deterministicSupported,
      choiceRequiredCards: [...impactedChoiceCards.values()].sort((a, b) => a.name.localeCompare(b.name)),
      choiceRequiredSamples: choiceRequired,
      delayedCleanupSamples: delayedCleanupFollowups,
      unsupportedSamples: unsupported,
      additionalCostOrKeywordSamples: additionalCostOrKeyword,
      otherSacrificeTextSamples: otherSacrificeText,
    },
    objectPhraseCounts: {
      deterministicSupported: mapObjectCounts(supportedObjectCounts),
      choiceRequired: mapObjectCounts(choiceRequiredObjectCounts),
      delayedCleanup: mapObjectCounts(delayedCleanupObjectCounts),
      unsupported: mapObjectCounts(unsupportedObjectCounts),
    },
  };

  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, JSON.stringify(report, null, 2));

  const markdown = [
    '# Sacrifice Executor Coverage Audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Distinct sacrifice-related clauses scanned: ${report.summary.distinctSacrificeClauses}`,
    `- Deterministic or context-bound supported effect cards: ${report.summary.deterministicSupportedCardCount}`,
    `- Semantically understood but choice-required effect cards: ${report.summary.choiceRequiredCardCount}`,
    `- Sample delayed cleanup follow-up clauses still needing timing-aware handling: ${report.summary.delayedCleanupClauseSamples}`,
    `- Sample unsupported sacrifice clauses: ${report.summary.unsupportedClauseSamples}`,
    `- Sample sacrifice clauses classified as additional-cost or keyword surfaces: ${report.summary.additionalCostOrKeywordClauseSamples}`,
    '',
    '## Classification Notes',
    '',
    '- `deterministicSupported`: the current parser/executor understands the selector shape and can execute it when context is bound.',
    '- `choiceRequired`: the clause is semantically understood, but safe execution still requires a player or payment choice.',
    '- `delayedCleanupFollowup`: the clause looks like a timing-qualified cleanup reference and should be handled by timing-aware delayed-trigger plumbing rather than immediate sacrifice execution.',
    '- `unsupported`: the clause still falls outside the currently understood sacrifice selector space.',
    '',
    '## Top Choice-Required Object Phrases',
    '',
    ...report.objectPhraseCounts.choiceRequired.slice(0, 20).map(item => `- \`${item.objectText}\`: ${item.count}`),
    '',
    '## Top Delayed Cleanup Object Phrases',
    '',
    ...report.objectPhraseCounts.delayedCleanup.slice(0, 20).map(item => `- \`${item.objectText}\`: ${item.count}`),
    '',
    '## Top Unsupported Object Phrases',
    '',
    ...report.objectPhraseCounts.unsupported.slice(0, 20).map(item => `- \`${item.objectText}\`: ${item.count}`),
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(outputMarkdownPath), { recursive: true });
  fs.writeFileSync(outputMarkdownPath, markdown);

  console.log(`Wrote ${outputJsonPath}`);
  console.log(`Wrote ${outputMarkdownPath}`);
  console.log(`Deterministic supported cards: ${report.summary.deterministicSupportedCardCount}`);
  console.log(`Choice-required cards: ${report.summary.choiceRequiredCardCount}`);
}

main();
