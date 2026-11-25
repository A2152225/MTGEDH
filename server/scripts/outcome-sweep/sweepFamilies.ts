/**
 * Outcome sweep oracle-pattern families and trigger detection. Pure text helpers: no engine imports.
 * Families group failures by what the ability tries to do, so shared runtime causes surface first.
 */

/** Ordered: the first match wins, so specific shapes come before broad ones. */
const FAMILY_PATTERNS: Array<[string, RegExp]> = [
  ['counter_spell', /\bcounter target\b|\bcounter (?:it|that spell)\b/],
  ['copy', /\bcop(?:y|ies)\b/],
  ['extra_turn_or_phase', /\bextra (?:turn|combat|upkeep)\b|\badditional (?:combat|turn)\b/],
  ['search_library', /\bsearch(?:es)? (?:your|their|its owner's|target (?:player|opponent)'s|that player's) library\b/],
  ['reanimate', /\breturn[^.]*\bfrom (?:your|a|their|an opponent's|its owner's) graveyard to the battlefield\b|\bput[^.]*from (?:a|your) graveyard onto the battlefield\b/],
  ['regrowth', /\breturn[^.]*\bfrom (?:your|a|their|its owner's) graveyard to (?:your|its owner's|their) hand\b/],
  ['bounce', /\breturn[^.]*\bto (?:its|their) owners?'? hands?\b/],
  ['token', /\bcreate\b[^.]*\btokens?\b|\bamass\b|\binvestigate\b/],
  ['destroy', /\bdestroy\b/],
  ['exile', /\bexile\b/],
  ['damage', /\bdeals?\b[^.]*\bdamage\b/],
  ['gain_control', /\bgain control\b|\bexchange control\b/],
  ['fight', /\bfights?\b/],
  ['draw', /\bdraws? (?:a|an|one|two|three|four|five|six|seven|x|that many|cards)\b/],
  ['discard', /\bdiscards?\b/],
  ['mill', /\bmills?\b/],
  ['scry_surveil', /\b(?:scry|surveil)\b/],
  ['proliferate', /\bproliferate\b/],
  ['counters', /\bput\b[^.]*\bcounters?\b[^.]*\bon\b|\bremove\b[^.]*\bcounters?\b/],
  ['pump', /[+-](?:\d+|x)\/[+-](?:\d+|x)\b/],
  ['life_gain', /\bgains? (?:\d+|x|that much|life)\b[^.]*\blife\b|\bgain life\b/],
  ['life_loss', /\blos(?:e|es) (?:\d+|x|that much|half)\b[^.]*\blife\b/],
  ['mana', /\badd (?:\{|one|two|three|x|an amount|mana|that much)/],
  ['sacrifice', /\bsacrifices?\b/],
  ['tap_untap', /\b(?:tap|untap)s? (?:target|up to|all|each|another|it|that|two|three|x)\b/],
  ['keyword_grant', /\bgains? (?:flying|haste|trample|vigilance|lifelink|deathtouch|indestructible|hexproof|first strike|double strike|menace|reach|protection|shroud)\b|\bhave (?:flying|haste|trample)\b/],
  ['becomes', /\bbecomes?\b/],
  ['attach', /\battach\b|\bequip\b/],
  ['look_reveal', /\blook at\b|\breveals?\b/],
  ['shuffle', /\bshuffles?\b/],
  ['prevent', /\bprevent\b/],
  ['restriction', /\bcan't\b|\bcannot\b/],
  ['choose', /\bchoose\b/],
];

export function oracleFamily(text: string): string {
  const lower = String(text || '').toLowerCase();
  for (const [family, pattern] of FAMILY_PATTERNS) if (pattern.test(lower)) return family;
  return lower.trim() ? 'other' : 'none';
}

export function isConditionalText(text: string): boolean {
  return /\bif\b|\bunless\b|\bas long as\b|\bonly if\b|\bonly during\b|\botherwise\b/i.test(String(text || ''));
}

/** Replace the card name (and its short legendary name) with "~" for pattern matching. */
export function normalizeSelfName(text: string, cardName: string): string {
  // Reminder text ("(... when this creature enters, create a token copy ...)") is not the card's own trigger.
  let out = String(text || '').replace(/\([^)]*\)/g, '');
  const names = String(cardName || '').split(' // ').flatMap((name) => [name, name.split(',')[0]])
    .map((name) => name.trim()).filter((name) => name.length >= 3).sort((a, b) => b.length - a.length);
  for (const name of names) out = out.split(name).join('~');
  return out;
}

const SELF = String.raw`(?:~|this (?:creature|artifact|enchantment|land|permanent|vehicle|equipment|aura|planeswalker|siege|battle|card|class|saga|spacecraft)|it)`;
const ETB_RE = new RegExp(String.raw`\bwhen(?:ever)? ${SELF}(?: or [^.,]+)? (?:enters|enters the battlefield)\b`, 'i');
const DIES_RE = new RegExp(String.raw`\bwhen(?:ever)? ${SELF}(?: or [^.,]+)? (?:dies|is put into (?:a|your|its owner's) graveyard from the battlefield)\b`, 'i');
const CAST_RE = /\bwhen you cast (?:this|~)\b/i;

export function etbTriggerLine(text: string, cardName: string): string | undefined {
  return normalizeSelfName(text, cardName).split('\n').find((line) => ETB_RE.test(line));
}

export function diesTriggerLine(text: string, cardName: string): string | undefined {
  return normalizeSelfName(text, cardName).split('\n').find((line) => DIES_RE.test(line));
}

export function castTriggerLine(text: string, cardName: string): string | undefined {
  return normalizeSelfName(text, cardName).split('\n').find((line) => CAST_RE.test(line));
}

const UNTESTED_TRIGGER_RES: Array<[string, RegExp]> = [
  ['turned_face_up', /\bwhen(?:ever)? [^.]*\bis turned face up\b/i],
  ['attack', /\bwhen(?:ever)? [^.]*\battacks?\b/i],
  ['block', /\bwhen(?:ever)? [^.]*\bblocks?\b/i],
  ['combat_damage', /\bwhen(?:ever)? [^.]*\bdeals? (?:combat )?damage\b/i],
  ['upkeep', /\bat the beginning of (?:your|each|each player's|the next) upkeep\b/i],
  ['end_step', /\bat the beginning of (?:your|each|the next) end step\b|\bat the beginning of the end step\b/i],
  ['other_phase', /\bat the beginning of\b/i],
  ['landfall', /\bwhen(?:ever)? a land (?:you control )?enters\b/i],
  ['spell_cast', /\bwhen(?:ever)? (?:you|a player|an opponent) casts?\b/i],
  ['other_trigger', /^\s*when(?:ever)?\b/im],
];

/** Trigger kinds in the text that the sweep does not drive (reported, not classified). */
export function untestedTriggerKinds(text: string, cardName: string): string[] {
  const out: string[] = [];
  for (const line of normalizeSelfName(text, cardName).split('\n')) {
    if (ETB_RE.test(line) || DIES_RE.test(line) || CAST_RE.test(line)) continue;
    const hit = UNTESTED_TRIGGER_RES.find(([, re]) => re.test(line));
    if (hit && !out.includes(hit[0])) out.push(hit[0]);
  }
  return out;
}

/** Abilities whose only legal targets live on the stack; the minimal board cannot satisfy them. */
export function needsStackTarget(text: string): boolean {
  return /\btarget (?:[a-z-]+ )*(?:spell|activated ability|triggered ability|ability)\b/i.test(String(text || ''))
    && !/\btarget (?:[a-z-]+ )*(?:creature|player|permanent|opponent|artifact|enchantment|land)\b/i.test(String(text || ''));
}

const UNSUPPORTED_TYPES = /\b(?:Plane|Phenomenon|Scheme|Vanguard|Conspiracy|Dungeon|Attraction|Contraption|Stickers?)\b/;

export function unsupportedCardReason(typeLine: string, layout: string | undefined): string | undefined {
  if (UNSUPPORTED_TYPES.test(String(typeLine || ''))) return `unsupported_type:${UNSUPPORTED_TYPES.exec(typeLine)?.[0]}`;
  if (['token', 'double_faced_token', 'emblem', 'art_series', 'planar', 'scheme', 'vanguard'].includes(String(layout || ''))) return `unsupported_layout:${layout}`;
  return undefined;
}

/**
 * Zone the ability can only be activated from (hand: cycling, channel, ninjutsu, ...; graveyard: unearth,
 * embalm, "exile this card from your graveyard: ..."). Undefined for battlefield abilities.
 */
const HAND_ONLY_RE = /^(?:[\w ]*cycling|channel|ninjutsu|commander ninjutsu|transmute|forecast|bloodrush|reinforce|plainswalk)\b|discard (?:this card|~)\s*[,:]|reveal (?:this card|~) from your hand|this card is in your hand/i;
const GRAVEYARD_ONLY_RE = /^(?:unearth|embalm|eternalize|scavenge|encore|renew|disturb|flashback|escape|retrace|jump-start|aftermath)\b|(?:exile|return) (?:this card|~) from your graveyard|this card is in your graveyard/i;

export function zoneOnlyAbility(fullText: string): 'hand' | 'graveyard' | undefined {
  const text = String(fullText || '').replace(/^[^—:]{1,40}—\s*/, (prefix) => (/[{]/.test(prefix) ? prefix : '')).trim();
  const costPart = text.split(':')[0];
  if (GRAVEYARD_ONLY_RE.test(text) || GRAVEYARD_ONLY_RE.test(costPart)) return 'graveyard';
  if (HAND_ONLY_RE.test(text) || HAND_ONLY_RE.test(costPart)) return 'hand';
  return undefined;
}

/** Normalizes an error line for grouping: strips ids, numbers and quoted names. */
export function errorFamily(text: string): string {
  const hookTag = /^\[hook-failure\] tag=(\S+)/.exec(String(text || ''))?.[1];
  if (hookTag) return `hook_failure:${hookTag}`;
  return String(text || '')
    .replace(/^\S+Z \[\w+\] /, '')
    .replace(/(?:sweep_|perm_|p[12]_)[\w-]+/g, '<id>')
    .replace(/"[^"]*"|'[^']*'/g, '<q>')
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}
