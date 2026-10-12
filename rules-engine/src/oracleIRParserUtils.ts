import { parseNumberFromText } from '../../shared/src/textUtils';
import type { OracleObjectSelector, OraclePlayerSelector, OracleQuantity } from './oracleIR';
import { stripLeadingCastKeywordPrefix, stripTrailingCastKeywordSuffix } from './oracleIRParserLeadingCastKeywordPrefix';
import { tryParseQuantityEarlyReferences } from './oracleIRParserUtils-handlers/oracleIRParserUtilsQuantityEarlyReferences';

export function normalizeOracleText(text: string): string {
  return String(text || '')
    .replace(/Ã¢â‚¬Â¢|â€¢/g, '\u2022')
    .replace(/â€™/g, "'")
    .replace(/Ã¢â‚¬â€|Ã¢â‚¬â€œ|â€”|â€“/g, '-')
    .replace(/[\u2019]/g, "'")
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/Magic:\s+The Gathering Online/g, 'Magic The Gathering Online')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

export function splitIntoClauses(line: string): string[] {
  const parts: string[] = [];

  const firstPass: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) firstPass.push(trimmed);
    current = '';
  };

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    // Only double quotes delimit quoted oracle phrases (emblems, named abilities).
    // ASCII apostrophes are possessives/contractions (player's, don't) and must not
    // suppress sentence splits — otherwise "Exile … player's library. Until …"
    // collapses into one clause and generic exile swallows the impulse rider.
    if (ch === '"' && !inQuotes) {
      inQuotes = true;
      quoteChar = ch;
      current += ch;
      continue;
    }
    if (inQuotes && ch === quoteChar) {
      inQuotes = false;
      quoteChar = '';
      current += ch;
      // A quoted ability that ends its sentence (`... can't block." If X is 5 or more, ...`)
      // also ends the clause when a new If ... sentence follows (e.g. If X is N or more, ...); otherwise the
      // quoted-grant clause swallows the next sentence (White Sun's Twilight, issue #56).
      const prev = line[i - 1] ?? '';
      const next = line[i + 1] ?? '';
      if ((prev === '.' || prev === '!') && /\s/.test(next)) {
        let j = i + 1;
        while (j < line.length && /\s/.test(line[j] ?? '')) j += 1;
        if (/^If\s/.test(line.slice(j, j + 3))) {
          pushCurrent();
          i = j - 1;
        }
      }
      continue;
    }

    if (!inQuotes && (ch === '.' || ch === ';')) {
      const next = line[i + 1] ?? '';
      const afterNext = line[i + 2] ?? '';
      if (ch === '.' && next === ')' && (afterNext === '' || /\s/.test(afterNext))) {
        current += ch;
        continue;
      }
      if (next === '' || /\s/.test(next)) {
        pushCurrent();
        while (i + 1 < line.length && /\s/.test(line[i + 1] ?? '')) {
          i += 1;
        }
        continue;
      }
    }

    // A whole-clause reminder parenthetical ends its own clause. Its inner period is skipped above by
    // the ".)" guard, so without this "(You may cast a legendary sorcery only if ... .) Return all
    // legendary permanent cards ..." stays one clause and the reminder swallows the real effect.
    if (!inQuotes && ch === ')' && current.trimStart().startsWith('(')) {
      const next = line[i + 1] ?? '';
      if (next && /\s/.test(next)) {
        current += ch;
        pushCurrent();
        while (i + 1 < line.length && /\s/.test(line[i + 1] ?? '')) {
          i += 1;
        }
        continue;
      }
    }

    current += ch;
  }
  pushCurrent();

  for (const p of firstPass) {
    const bulletSplit = p
      .split(/\n\s*[\u2022]\s+/)
      .map(x => x.trim())
      .filter(Boolean);

    for (const b of bulletSplit) {
      const thenSplit = b.split(/\bthen\b/i).map(x => x.trim()).filter(Boolean);
      if (thenSplit.length === 1) {
        parts.push(b);
      } else {
        for (let idx = 0; idx < thenSplit.length; idx++) {
          const chunk = thenSplit[idx];
          if (!chunk) continue;
          parts.push(idx === 0 ? chunk : `then ${chunk}`);
        }
      }
    }
  }

  return parts
    .map(p => p.replace(/[.,;]\s*$/g, '').trim())
    .filter(Boolean);
}

export function parseQuantity(raw: string | undefined): OracleQuantity {
  if (!raw) return { kind: 'unknown' };
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown' };
  {
    const early = tryParseQuantityEarlyReferences(trimmed, parseQuantity);
    if (early) return early;
  }
  {
    const additionalCards = trimmed.match(
      /^(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten|an?)\s+)?additional\s+cards?$/i
    );
    if (additionalCards) {
      const rawCount = String(additionalCards[1] || 'an').toLowerCase();
      if (rawCount === 'an' || rawCount === 'a') return { kind: 'number', value: 1 };
      const value = parseNumberFromText(rawCount, NaN as any);
      if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'number', value };
      return { kind: 'number', value: 1 };
    }
  }
  {
    const upToCards = trimmed.match(/^up\s+to\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?$/i);
    if (upToCards) {
      const rawCount = String(upToCards[1] || '').toLowerCase();
      const value = parseNumberFromText(rawCount, NaN as any);
      if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'number', value };
    }
  }
  {
    const cardCount = trimmed.match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|x|a|an)\s+cards?$/i);
    if (cardCount) {
      const rawCount = String(cardCount[1] || '').toLowerCase();
      if (rawCount === 'x') return { kind: 'x' };
      if (rawCount === 'a' || rawCount === 'an') return { kind: 'number', value: 1 };
      const value = parseNumberFromText(rawCount, NaN as any);
      if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'number', value };
    }
  }
  {
    const nonlandMvMatch = trimmed.match(/^until (?:they|you) exile a nonland card with mana value (\d+) or less$/i);
    if (nonlandMvMatch) {
      const value = Number.parseInt(String(nonlandMvMatch[1] || '0'), 10);
      if (Number.isFinite(value)) return { kind: 'until_nonland_mana_value_lte', value };
    }
  }
  if (/^until (?:they|you) exile a nonland card with (?:that mana value|mana value x|mana value that spell'?s mana value) or less$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  {
    const creatureStatMatch = trimmed.match(
      /^until (?:they|you) exile a nonland card with mana value that creature(?:'|’)?s (power|toughness) or less$/i,
    );
    if (creatureStatMatch) {
      const stat = String(creatureStatMatch[1] || '').toLowerCase() === 'power' ? 'power' : 'toughness';
      return { kind: 'object_stat', subject: 'that_creature', stat };
    }
  }
  if (/^x$/i.test(trimmed)) return { kind: 'x' };
  if (/^x\s+cards?$/i.test(trimmed)) return { kind: 'x' };
  if (/^all$/i.test(trimmed)) return { kind: 'all' };
  if (/^(a|an)$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^\d+$/.test(trimmed)) return { kind: 'number', value: parseInt(trimmed, 10) };

  const maybe = parseNumberFromText(trimmed, NaN as any);
  if (typeof maybe === 'number' && Number.isFinite(maybe)) {
    return { kind: 'number', value: maybe };
  }

  if (/^any number of creature cards$/i.test(trimmed)) return { kind: 'any_number' };
  if (/^any number of /i.test(trimmed)) return { kind: 'any_number' };
  if (/^damage to a permanent or player(?: this turn)?, it deals double that$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^for each opponent, you$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^crew 3 you$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^cards equal to its power$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^cards?\s+equal\s+to\s+the\s+sacrificed\s+creature(?:'|’)?s\s+power$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'power' };
  }
  if (/^the same number$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the same number' };
  if (/^the greatest mana value among creatures you control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the greatest power among creature cards in your graveyard$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the greatest power among creatures sacrificed this way$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the total mana value of those cards$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the mana value of the exiled card used to craft it$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^that player's life total as the turn began$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^that many cards and each other player loses that much$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^x plus (?:\d+|one)(?:\s+cards?)?$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^(?:two|three|five) times x(?:\s+cards?)?$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^two times x$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that permanent(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_permanent', stat: 'mana_value' };
  if (/^the artifact(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_artifact', stat: 'mana_value' };
  if (/^the sacrificed permanent(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'the_sacrificed_permanent', stat: 'mana_value' };
  if (/^the sacrificed enchantment(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'the_sacrificed_enchantment', stat: 'mana_value' };
  if (/^the milled card(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'the_milled_card', stat: 'mana_value' };
  if (/^the mana value of the discarded card$/i.test(trimmed)) return { kind: 'object_stat', subject: 'the_discarded_card', stat: 'mana_value' };
  if (/^that equipment(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_equipment', stat: 'mana_value' };
  if (/^that wall(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_wall', stat: 'mana_value' };
  if (/^the mana value of target artifact or creature you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the greatest mana value among (?:permanents|artifacts|historic permanents) you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the greatest mana value among the milled cards$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the greatest mana value of a commander they own on the battlefield or in the command zone$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the greatest power among mutants you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the total mana value of (?:other spells you(?:'|')?ve cast this turn|other permanents you control|the discarded cards|those exiled cards|cards milled this way)$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the total power of (?:the sacrificed creatures|daleks that died this turn)$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^their total power$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the tapped creature(?:'|')?s power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'the_tapped_creature', stat: 'power' };
  if (/^that creature(?:'|')?s power plus its toughness$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that spell(?:'|')?s power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_spell', stat: 'power' };
  if (/^the power of the (?:chosen creature or card|creature you chose or the card you revealed|card returned this way)$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the damage dealt to you this turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the damage dealt to you this turn' };
  if (/^the damage already dealt to (?:it|that player) this turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the damage dealt, but not more/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the total life lost by all players this turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the high bid and gains control of the creature$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the highest number$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the highest number' };
  if (/^the chosen player$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the chosen player' };
  if (/^that result$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'that result' };
  if (/^that many cards plus (?:one|four) instead$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that many cards" until end of turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^(?:two|three) for each (?:color of mana spent to cast it|creature that convoked it|time it was kicked|other nontoken human you control|time you(?:'|')?ve cast your commander from the command zone this game)$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^three for each (?:creature card exiled this way|\{g\}\{g\} spent to cast it)$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^three cards for each time it was kicked$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^three times the number of creatures tapped this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^three for each creature card exiled this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^you gain \d+ life for each creature tapped this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^seven cards and your life total becomes \d+$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^x life if \{[wubrg]\} was spent to cast this spell and x life if \{[wubrg]\} was spent to cast this spell$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^x life, discards x cards, sacrifices x creatures of their choice$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^x life and mills x cards$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^x target attacking creatures become blocked$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^this card any time you could cast an instant$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^target player draws x cards and loses x life, where x is the number of creatures they control of the chosen type$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^an additional \d+$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^cards$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'cards' };
  if (/^you may$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'you may' };
  if (/^a card\.?'$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card during each opponent(?:'|')?s draw step$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card of target opponent(?:'|')?s choice$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card or sacrifice a land$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card with that name$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card at random unless you pay \{e\}\{e\}$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^all other nonland cards$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'all other nonland cards' };
  if (/^the chosen player$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the chosen player' };
  if (
    trimmed.length >= 3 &&
    /^(?:draw|damage|life|cards?|that |the |their |its |x plus|twice|three times|five times|two for|three for|for each|until|when |whenever |unless |they(?:'|')?re |they get |each |combat damage|noncombat damage|you start|you can cast|you control target|you copy|you exile|you get an emblem|you look|you lose this|you put the chosen|you return|you shuffle|you take the|target player draws|all nonland|each card|each nonland|each opponent|each player|their activated|while attached|would you like|tiered|• |flanking|an additional|cards$|you may$|the controller|the owners|their controller|this card(?:'|')?s mana value|this effect|this mana|this creature can(?:not|'t) block|this aura(?:'|')?s controller|this artifact(?:'|')?s owner|add one mana of that color unless|draw a card, mill|draw three cards, untap|two cards, draws|you and defending player|you and target opponent|it costs \{4\} less|for each spirit|for each creature, its controller|for each spell and ability|if you do, when each opponent|that creature is black|that creature(?:'|')?s controller may|would you like)/i.test(trimmed)
  ) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }

  return { kind: 'unknown', raw: trimmed };
}

export function isThatOwnerOrControllerSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:that|the) [a-z0-9][a-z0-9 -]*'s (?:controller|owner)$/i.test(s);
}

export function isThoseOpponentsSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();
  return s === 'each of those opponents' || s === 'those opponents' || s === 'all of those opponents' || s === 'all those opponents';
}

export function isThoseOpponentsPossessiveSource(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();
  return s.startsWith('each of those opponents') || s.startsWith('those opponents') || s.startsWith('all of those opponents') || s.startsWith('all those opponents');
}

export function parsePlayerSelector(raw: string | undefined): OraclePlayerSelector {
  const s = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();
  if (!s) return { kind: 'you' };

  if (/\s+each$/.test(s)) return parsePlayerSelector(s.replace(/\s+each$/, ''));
  if (s === 'you') return { kind: 'you' };
  if (s === 'the chosen player') return { kind: 'target_player' };
  if (s === 'any player') return { kind: 'any_player' };
  if (/^if\b.+,\s*you$/.test(s)) return { kind: 'you' };
  if (/^counter\s+(?:it|that\s+spell|that\s+spell\s+or\s+ability)\s+unless\s+that\s+player$/.test(s)) return { kind: 'target_player' };
  if (/^destroy\s+all\s+.+?\s+and\s+each\s+of\s+your\s+opponents$/.test(s)) return { kind: 'each_opponent' };
  if (/^dragons\s+-\s+at\s+the\s+beginning\s+of\s+your\s+upkeep,\s+each\s+opponent$/.test(s)) return { kind: 'each_opponent' };
  if (/^during\s+your\s+turn,\s+if\s+an\s+opponent\s+lost\s+life\s+this\s+turn,\s+you$/.test(s)) return { kind: 'you' };
  if (s === 'each friend') return { kind: 'each_player' };
  if (s === "each of that player's opponents") return { kind: 'each_opponent' };
  if (/^each\s+opponent\s+dealt\s+combat\s+damage\s+this\s+game\s+by\s+a\s+creature\s+named\s+this\s+permanent$/.test(s)) return { kind: 'each_opponent' };
  if (/^each\s+player\s+reveals\s+the\s+top\s+card\s+of\s+their\s+library,?$/.test(s)) return { kind: 'each_player' };
  if (/^each\s+player\s+who\s+/.test(s)) return { kind: 'each_player' };
  if (/^fearless\s+l'cie,\s+you$/.test(s)) return { kind: 'you' };
  if (/^for\s+each\s+attacking\s+.+?\s+controller$/.test(s)) return { kind: 'target_player' };
  if (/^for\s+each\s+opponent,\s+exile\s+up\s+to\s+one\s+target\s+creature\s+that\s+player\s+controls\s+and\s+that\s+player$/.test(s)) return { kind: 'target_player' };
  if (/^recover\s+.+\s+you$/.test(s)) return { kind: 'you' };
  if (/^reflect\s+.+\s+each\s+opponent$/.test(s)) return { kind: 'each_opponent' };
  if (s === 'you and that player' || s === 'you and target player') return { kind: 'you_and_target_player' };
  if (s === 'you and that opponent' || s === 'you and target opponent') return { kind: 'you_and_target_opponent' };
  if (s === 'each player') return { kind: 'each_player' };
  if (s === 'each other player') return { kind: 'each_opponent' };
  if (s === 'each opponent') return { kind: 'each_opponent' };
  if (s === 'each of your opponents') return { kind: 'each_opponent' };
  if (s === 'your opponents') return { kind: 'each_opponent' };
  if (s === 'any number of target opponents') return { kind: 'any_number_of_target_opponents' };
  if (s === 'any number of target players' || s === 'any number of target players other than that player') return { kind: 'any_number_of_target_players' };
  if (s === 'each of those players' || s === 'those players') return { kind: 'any_number_of_target_players' };
  if (isThoseOpponentsSelector(s)) return { kind: 'each_of_those_opponents' };
  if (s === 'target player') return { kind: 'target_player' };
  if (/^target\s+player\s+other\s+than\s+.+?\s+owner$/.test(s)) return { kind: 'target_player' };
  if (s === 'target opponent') return { kind: 'target_opponent' };
  if (s === 'an opponent' || s === 'the opponent' || s === 'an opponent of your choice') return { kind: 'target_opponent' };
  if (s === 'the player') return { kind: 'target_player' };
  if (s === 'the player with the most life') return { kind: 'raw', text: 'the player with the most life' };
  if (s === 'the player with the lowest life total') return { kind: 'raw', text: 'the player with the lowest life total' };
  if (/^otherwise,\s*you$/i.test(s)) return { kind: 'you' };
  if (/^until end of turn,\s*you$/i.test(s)) return { kind: 'you' };
  if (/^for each delay counter removed this way,\s*you\b/i.test(s)) return { kind: 'you' };
  if (/^for each opponent,\s*you\b/i.test(s)) return { kind: 'you' };
  if (/^body thief\s*[-—]\s*you$/i.test(s)) return { kind: 'you' };
  if (/^crew \d+ you$/i.test(s)) return { kind: 'you' };
  if (/\beach opponent$/i.test(s)) return { kind: 'each_opponent' };
  if (s === "the exiled card's owner" || s === 'the exiled cards owner') return { kind: 'raw', text: "the exiled card's owner" };
  if (s === 'that player' || s === 'he or she' || s === 'him or her' || s === 'they') return { kind: 'target_player' };
  if (s === 'their') return { kind: 'target_player' };
  if (s === 'that attacking player' || s === 'attacking player' || s === 'the attacking player') return { kind: 'target_player' };
  if (s === 'that opponent' || s === 'defending player' || s === 'the defending player') return { kind: 'target_opponent' };
  if (s === 'the high bidder') return { kind: 'high_bidder' };
  if (/^this (?:permanent|creature|artifact|enchantment|equipment|vehicle|planeswalker)(?:'|')s controller$/i.test(s)) {
    return { kind: 'source_controller' };
  }
  if (/^each player who controls the most .+$/i.test(s)) {
    const filter = s.match(/^each player who controls the most (.+)$/i)?.[1]?.trim();
    return { kind: 'each_player_who_controls_the_most', ...(filter ? { filter } : {}) };
  }
  if (/^the controller of each of those (?:artifacts|creatures|permanents|cards)$/i.test(s)) {
    return { kind: 'each_controller_of_those' };
  }
  if (s === 'enchanted player') return { kind: 'enchanted_player' };
  if (/^enchanted\s+[a-z0-9 -]+(?:'s)?\s+controller$/.test(s)) return { kind: 'target_player' };
  if (s === 'its controller') return { kind: 'controller_of_referenced_object' };
  if (s === 'its owner') return { kind: 'owner_of_referenced_object' };
  if (s === "its controller's") return { kind: 'controller_of_referenced_object' };
  if (s === "its owner's") return { kind: 'owner_of_referenced_object' };
  if (isThatOwnerOrControllerSelector(s)) {
    return /\bowner$/i.test(s)
      ? { kind: 'owner_of_referenced_object' }
      : { kind: 'controller_of_referenced_object' };
  }

  return { kind: 'unknown', raw: raw ?? '' };
}

export function parseObjectSelector(text: string | undefined): OracleObjectSelector {
  const s = String(text || '').trim();
  if (!s) return { kind: 'unknown', raw: '' };
  return { kind: 'raw', text: s };
}

export function normalizeClauseForParse(clause: string): {
  clause: string;
  sequence?: 'then';
  optional?: boolean;
} {
  let working = clause.trim();
  let sequence: 'then' | undefined;
  let optional: boolean | undefined;

  working = working.replace(/^[\u2022]\s+/, '');
  working = working.replace(/^\(\s*(\{T\}\s*:\s*.+?)\s*\)?$/i, '$1');
  working = working.replace(/^\(\s*((?:look at|reveal)\s+the\s+top\s+.+?)\s*\)?$/i, '$1');

  if (/^then\b/i.test(working)) {
    sequence = 'then';
    working = working.replace(/^then\b\s*,?\s*/i, '');
  }

  // Saga chapter lines commonly prefix the real clause with a roman numeral marker
  // like "III -", but corpus text can arrive with mojibake punctuation as well.
  // Strip the whole marker so downstream clause parsers see the action text.
  working = working.replace(/^(?:[ivxlcdm]+)\s*(?:[-?]|[^\w\s])+\s*/i, '');

  // Cost/typal keywords whose reminder period sits inside parentheses glue onto the
  // next instruction once reminders are stripped ("Delve Target player…").
  // Run before "you may" so "Convoke You may cast…" still stamps optional.
  working = stripLeadingCastKeywordPrefix(working);
  working = stripTrailingCastKeywordSuffix(working);

  if (/^you\s+may\b/i.test(working)) {
    optional = true;
    working = working.replace(/^you\s+may\b\s*/i, '');
  }

  // Broken parenthetical shards only: "... This mana lasts until end of combat.) Flashback".
  // Isolated firebending effect clauses have no leftover ')', so they parse as retain_mana.
  working = working.replace(/\s*this mana lasts until end of combat\.?\)\s*.*$/i, '');

  working = working
    .replace(/^\+\s*(?:\{[^}]+\})+\s*[-|—–]\s*/i, '')
    .replace(/^\d+\s*(?:\||[-—])\s*/i, '')
    .replace(/^\d+\+\s*\|\s*/i, '')
    .replace(/^-+\s+(?=[a-z])/i, '')
    .replace(
      /^[a-z0-9][a-z0-9\s'.,/&-]{0,80}\s+-\s+(?=(?:at|when|whenever|if|during|until|you|each|target|return|put|exile|draw|destroy|create|look|choose|search|investigate|populate|proliferate|surveil|scry|mill|discard|tap|untap|gain|lose|deal|counter|copy|cast|play|switch|double|roll|sacrifice)\b)/i,
      ''
    );

  working = working
    .replace(/^each\s+of\s+your\s+opponents\b/i, 'each opponent')
    .replace(/^each\s+of\s+the\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+of\s+your\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+your\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+opponents\b/i, 'each opponent')
    .replace(/^your\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+of\s+those\s+opponents\b/i, 'each of those opponents')
    .replace(/^all\s+those\s+opponents\b/i, 'each of those opponents')
    .replace(/^those\s+opponents\b/i, 'each of those opponents')
    .replace(/\b(?:the\s+)?defending player(?:'|[\u2019])s\b/gi, "target opponent's")
    .replace(/\bhim or her\b/gi, 'he or she');

  return {
    clause: working,
    ...(sequence ? { sequence } : {}),
    ...(optional ? { optional } : {}),
  };
}

/** Split "attach X to Y" without treating "up to" as the attachment delimiter. */
export function splitAttachClauseBody(body: string): { readonly attachmentRaw: string; readonly toRaw: string } | null {
  const trimmed = String(body || '').trim();
  if (!trimmed) return null;

  let searchFrom = trimmed.length;
  while (searchFrom > 0) {
    const idx = trimmed.toLowerCase().lastIndexOf(' to ', searchFrom);
    if (idx <= 0) return null;
    const beforeSlice = trimmed.slice(Math.max(0, idx - 3), idx).toLowerCase();
    if (beforeSlice.endsWith('up')) {
      searchFrom = idx - 1;
      continue;
    }
    const attachmentRaw = trimmed.slice(0, idx).trim();
    const toRaw = trimmed.slice(idx + 4).trim();
    if (!attachmentRaw || !toRaw) return null;
    return { attachmentRaw, toRaw };
  }

  return null;
}
