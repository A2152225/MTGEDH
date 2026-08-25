/**
 * Origin parent: oracleIRParserStaticAbilityClauses.ts
 * Cluster moved: tryParseStaticAbilityGrantClause early permission / P/T / quoted-grant if-chain
 * Public: tryParseStaticAbilityGrantEarlyClauses
 */

import type { OracleEffectStep } from '../oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from '../oracleIRParserUtils';
import type { WithMeta } from './oracleIRParserStaticAbilityGrantParseUtils';
import { parseKeywordAbilityList, parseSignedInt } from './oracleIRParserStaticAbilityGrantParseUtils';

export function tryParseStaticAbilityGrantEarlyClauses(args: {
  normalized: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null | undefined {
  const { normalized, rawClause, withMeta } = args;
  if (/^this creature enters prepared$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: ['enters prepared'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const standaloneKeywordAbilities = parseKeywordAbilityList(normalized);
  if (
    standaloneKeywordAbilities.length > 0 &&
    standaloneKeywordAbilities.join(', ') === normalized.toLowerCase()
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      abilities: standaloneKeywordAbilities,
      duration: 'static',
      raw: rawClause,
    });
  }

  const exiledCardPermission = normalized.match(
    /^(you|that player|target player|target opponent|its controller)?\s*(?:may\s+)?(cast|play)s?\s+(the\s+exiled\s+card|that\s+card|this\s+card|it)(?:\s+from\s+exile)?(?:\s+without\s+paying\s+its\s+mana\s+cost)?(?:\s+this\s+turn)?(?:\s+if\s+.+)?$/i
  );
  if (exiledCardPermission) {
    return withMeta({
      kind: 'grant_exile_permission',
      who: parsePlayerSelector(String(exiledCardPermission[1] || 'you').trim()),
      what: parseObjectSelector(String(exiledCardPermission[3] || '').trim()),
      duration: /\bthis\s+turn\b/i.test(normalized) ? 'this_turn' : 'during_resolution',
      permission: String(exiledCardPermission[2] || '').toLowerCase().startsWith('play') ? 'play' : 'cast',
      withoutPayingManaCost: /without\s+paying\s+its\s+mana\s+cost/i.test(normalized) || undefined,
      optional: /\bmay\b/i.test(normalized) || undefined,
      raw: rawClause,
    });
  }

  const qualifiedOpponentLifeLoss = normalized.match(/^each\s+opponent\s+who\s+(.+?)\s+loses\s+(that\s+much|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life$/i);
  if (qualifiedOpponentLifeLoss) {
    const amountText = String(qualifiedOpponentLifeLoss[2] || '').trim();
    return withMeta({
      kind: 'conditional',
      condition: { kind: 'if', raw: `each opponent who ${String(qualifiedOpponentLifeLoss[1] || '').trim()}` },
      steps: [{
        kind: 'lose_life',
        who: { kind: 'each_opponent' },
        amount: parseQuantity(amountText),
        raw: `each opponent loses ${amountText} life`,
      }],
      raw: rawClause,
    } as OracleEffectStep);
  }

  const staticGenericPtMatch = normalized.match(/^(.+?\b(?:you control|opponents control|opponent controls|enchanted creature|equipped creature|this creature|this permanent|it|they))\s+gets?\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))(?:\s*,?\s*(.+))?$/i);
  if (staticGenericPtMatch) {
    const power = parseSignedInt(staticGenericPtMatch[2]);
    const toughness = parseSignedInt(staticGenericPtMatch[3]);
    const targetText = String(staticGenericPtMatch[1] || '').trim();
    const tail = String(staticGenericPtMatch[4] || '').replace(/^,\s*/, '').trim();
    const dynamicTail = /^(?:for\s+each|where\b|as\s+long\s+as\b)/i.test(tail);
    if ((power === undefined || toughness === undefined) && !dynamicTail) return null;
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      ...(dynamicTail || power === undefined || toughness === undefined
        ? { effectText: [`gets ${String(staticGenericPtMatch[2] || '').trim()}/${String(staticGenericPtMatch[3] || '').trim()} ${tail}`.trim()] }
        : { power, toughness }),
      duration: 'static',
      raw: rawClause,
    });
  }

  const parentheticalManaMatch = normalized.match(/^\(?\s*\{T\}\s*:\s*add\s+(\{[^}]+\}(?:\s+or\s+\{[^}]+\})+|\{[^}]+\}(?:\s*\{[^}]+\})*)\s*\)?$/i);
  if (parentheticalManaMatch) {
    const symbols = String(parentheticalManaMatch[1] || '').match(/\{[^}]+\}/g) || [];
    if (symbols.length > 0) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(undefined),
        mana: symbols[0],
        ...(symbols.length > 1 ? { manaOptions: symbols } : {}),
        raw: rawClause,
      });
    }
  }

  const staticLookTopMatch = normalized.match(/^you\s+may\s+look\s+at\s+the\s+top\s+(?:(a|an|\d+|x|[a-z]+)\s+cards?|card)\s+of\s+your\s+library\s+any\s+time$/i);
  if (staticLookTopMatch) {
    return withMeta({
      kind: 'look_top',
      who: { kind: 'you' },
      amount: staticLookTopMatch[1] ? parseQuantity(String(staticLookTopMatch[1] || '').trim()) : { kind: 'number', value: 1 },
      optional: true,
      raw: rawClause,
    });
  }

  const staticTopLibraryPermissionMatch = normalized.match(
    /^(?:during your turn,\s+)?(?:you may\s+)?(?:look at|cast|play)\s+.+\s+from\s+(?:the\s+)?top\s+of\s+your\s+library(?:\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?)?$/i
  );
  if (staticTopLibraryPermissionMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticCastPlayPermissionMatch = normalized.match(
    /^(?:during your turn,\s+)?you may\s+(?:cast|play)\s+.+\s+from\s+(?:your hand(?:\s+or\s+the\s+top\s+of\s+your\s+library)?|exile|outside the game)(?:\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?)?$/i
  );
  if (staticCastPlayPermissionMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticCastAsThoughFlashMatch = normalized.match(/^(?:(you|any\s+player)\s+may\s+)?cast\s+(.+?)\s+spells\s+as\s+though\s+they\s+had\s+flash$/i);
  if (staticCastAsThoughFlashMatch) {
    const casterText = String(staticCastAsThoughFlashMatch[1] || 'you').trim();
    const spellText = String(staticCastAsThoughFlashMatch[2] || '').trim();
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(`${casterText} casting ${spellText} spells`),
      effectText: ['may cast as though they had flash'],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^any\s+player\s+may\s+cast\s+spells\s+as\s+though\s+they\s+had\s+flash$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('any player casting spells'),
      effectText: ['may cast as though they had flash'],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^(?:your\s+opponents|each\s+opponent)\s+can't\s+cast\s+spells\s+during\s+your\s+turn$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('your opponents'),
      effectText: ["can't cast spells during your turn"],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^you\s+may\s+have\s+this\s+creature\s+enter\s+as\s+a\s+copy\s+of\s+any\s+creature\s+on\s+the\s+battlefield$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: ['may enter as a copy of any creature on the battlefield'],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^each\s+opponent\s+can\s+cast\s+spells\s+only\s+any\s+time\s+they\s+could\s+cast\s+a\s+sorcery$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('each opponent'),
      effectText: ['can cast spells only any time they could cast a sorcery'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticCantBeTargetsMatch = normalized.match(/^(cards\s+in\s+graveyards)\s+can't\s+be\s+the\s+targets?\s+of\s+(.+)$/i);
  if (staticCantBeTargetsMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticCantBeTargetsMatch[1] || '').trim()),
      effectText: [`can't be the targets of ${String(staticCantBeTargetsMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const castOnlyIfMatch = normalized.match(/^cast\s+this\s+spell\s+only\s+if\s+(.+)$/i);
  if (castOnlyIfMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this spell'),
      effectText: [`cast only if ${String(castOnlyIfMatch[1] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const typeCantBlockTypeMatch = normalized.match(/^(.+?)\s+can't\s+block\s+(.+)$/i);
  if (typeCantBlockTypeMatch) {
    const targetText = String(typeCantBlockTypeMatch[1] || '').trim();
    if (/^(?:it|this\s+creature)$/i.test(targetText)) return null;
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      effectText: [`can't block ${String(typeCantBlockTypeMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^(?:artifacts\s+and\s+)?creatures\s+entering\s+don't\s+cause\s+abilities\s+to\s+trigger$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(/^artifacts/i.test(normalized) ? 'artifacts and creatures entering' : 'creatures entering'),
      effectText: ["don't cause abilities to trigger"],
      duration: 'static',
      raw: rawClause,
    });
  }

  const destroyedThisWayCantRegenerateMatch = normalized.match(/^(.+?)\s+destroyed\s+this\s+way\s+can't\s+be\s+regenerated$/i);
  if (destroyedThisWayCantRegenerateMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(`${String(destroyedThisWayCantRegenerateMatch[1] || '').trim()} destroyed this way`),
      effectText: ["can't be regenerated"],
      duration: 'static',
      raw: rawClause,
    });
  }

  const quotedGrantMatch = normalized.match(/^(.+?)\s+(?:gains?|gain|has|have)\s+"([^"]+)"$/i);
  if (
    quotedGrantMatch &&
    !/\bgraveyard\b/i.test(String(quotedGrantMatch[1] || '')) &&
    !/^until\s+end\s+of\s+turn,?\s+/i.test(normalized) &&
    !(/^(?:it|they)$/i.test(String(quotedGrantMatch[1] || '').trim()) && /^sacrifice this token:\s*add\s+\{c\}/i.test(String(quotedGrantMatch[2] || '').trim()))
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(quotedGrantMatch[1] || '').trim()),
      effectText: [String(quotedGrantMatch[2] || '').trim()],
      duration: 'static',
      raw: rawClause,
    });
  }

  const quotedGrantWithReminderMatch = normalized.match(/^(.+?)\s+(?:gains?|gain|has|have)\s+"([^"]+)"\s+\(/i);
  if (quotedGrantWithReminderMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(quotedGrantWithReminderMatch[1] || '').trim()),
      effectText: [String(quotedGrantWithReminderMatch[2] || '').trim()],
      duration: 'static',
      raw: rawClause,
    });
  }

  const partialQuotedGrantMatch = normalized.match(/^(.+?)\s+have\s+deathtouch\s+and\s+"(.+)$/i);
  if (partialQuotedGrantMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(partialQuotedGrantMatch[1] || '').trim()),
      abilities: ['deathtouch'],
      effectText: [String(partialQuotedGrantMatch[2] || '').trim()],
      duration: 'static',
      raw: rawClause,
    });
  }

  const partialGenericQuotedGrantMatch = normalized.match(/^(.+?)\s+(?:has|have)\s*,?\s+"(.+)$/i);
  if (partialGenericQuotedGrantMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(partialGenericQuotedGrantMatch[1] || '').trim()),
      effectText: [String(partialGenericQuotedGrantMatch[2] || '').trim()],
      duration: 'static',
      raw: rawClause,
    });
  }
  return undefined;
}
