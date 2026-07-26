import { parseNumberFromText } from '../../shared/src/textUtils';
import type { OracleObjectSelector, OraclePlayerSelector, OracleQuantity } from './oracleIR';

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
  if (/^that$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'that' };
  if (/^this$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^twice that much$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^twice that many$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the excess damage dealt this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^another card$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'another card' };
  if (/^a card or pay \{2\}$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card or$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a card or' };
  if (/^a card and blight 1$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card and chaos ensues$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card and choose an opponent at random$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card and repeat this process$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card or sacrifice a permanent of their choice$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a creature card$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a creature card' };
  if (/^a land card$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a land card' };
  if (/^a card" for as long as you control this creature$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^all but 1$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that damage$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'that damage' };
  if (/^the excess$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the excess' };
  if (/^life$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'life' };
  if (/^trample$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'trample' };
  if (/^ten cards instead$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^twice x cards$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^twice the number of vehicles you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^twice the number of goblins it devoured$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^two for each creature sacrificed this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^x plus 2$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the same number$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the same number' };
  if (/^otherwise, you$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^no life instead$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^until end of turn, you$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that creature(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'mana_value' };
  if (/^the greatest power among creatures you control$/i.test(trimmed)) return { kind: 'greatest_power_among_creatures_you_control' };
  if (/^the greatest mana value among creatures sacrificed this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that many cards minus one$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a third of their life, rounded up$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^cards equal to its power$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^for each other creature you control that the spell could target$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^for each other creature you control that ability could target$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^for each other creature that spell could target$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^for each other permanent or player the spell or ability could target$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^damage equal to the number of charge counters on it to target player and that much$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^damage equal to the number of quest counters on it to up to one target creature unless that creature(?:'|')?s controller has this permanent deal that much$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^mayhem cost is equal to its mana value$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the card(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'mana_value' };
  if (/^the damage dealt to target opponent this turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that many cards and add that much \{r\}$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^another$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^any$/i.test(trimmed)) return { kind: 'any_number' };
  if (/^x\s+life\s+and\s+draw\s+x\s+cards?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'x life and draw x cards' };
  }
  if (/^x\s+life\s+and\s+you\s+gain\s+x$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^where\s+x\s+is\s+this\s+creature(?:'|')?s\s+power$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'this_creature', stat: 'power' };
  }
  if (/^this\s+permanent(?:'|')?s\s+power$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'this_permanent', stat: 'power' };
  }
  if (/^until you exile a nonland permanent card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^x cards?,?$/i.test(trimmed)) {
    return { kind: 'x' };
  }
  if (/^up to x cards?$/i.test(trimmed)) {
    return { kind: 'x' };
  }
  if (/^your speed$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'your speed' };
  }
  if (/^your highest commander tax among your commanders$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^x for each of those creatures\.?\)?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'x for each of those creatures' };
  }
  if (/^x cards plus an additional card for each time .+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/\)+$/g, '').trim() };
  }
  const cardsInsteadMatch = trimmed.match(
    /^((?:a card|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) cards?) instead$/i,
  );
  if (cardsInsteadMatch) {
    return parseQuantity(String(cardsInsteadMatch[1] || '').trim().replace(/\s+cards?$/i, ''));
  }
  if (/^two cards instead$/i.test(trimmed)) {
    return { kind: 'number', value: 2 };
  }
  if (/^a card if /i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^combat damage this turn, it deals that$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the life that player lost this turn$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the amount of life they lost this turn$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^that amount of$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^that mana value$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the result$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the power of target creature you control$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'target_creature_you_control', stat: 'power' };
  }
  if (/^twice the number of times it was kicked$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^double that$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^two cards unless you discard an instant or sorcery card or a creature card with flying$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^two cards unless (?:you|they) discard (?:an? )?.+ card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the life you lost when it entered$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the number they guessed$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a card and proliferate$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a card unless /i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the greatest mana value among equipment attached(?: to it)?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^rewards$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^excess combat$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^that much life plus 1 instead$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^damage to an opponent this turn, it deals double that$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the mana value of the sacrificed permanent$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'the_sacrificed_permanent', stat: 'mana_value' };
  }
  if (/^a card before its other effects(?:[.)"]*)?$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^a card,?$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^a card,?\s+then discard a card\.?$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^a card,?\s+lose 1 life,?\s*$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^a card and an additional card for each of .+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^that many cards, create that many tapped treasure tokens$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'that many' };
  }
  if (/^one fewer card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'one fewer card' };
  }
  if (/^five for each forest and\/or plant you control\.?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/\.$/, '') };
  }
  if (/^(?:a card|\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?\s+for\s+each\s+/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/\.$/, '') };
  }
  if (/^(\d+|x|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\s+for\s+each\s+/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/\.$/, '') };
  }
  if (/^a card\.?"?\s*(?:\(|$)/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^a card["']?\s*(?:and loses all other abilities|,?\s*" and)/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^another card at random(?: unless .+)?\.?$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^all cards from (?:your|their) hand$/i.test(trimmed)) {
    return { kind: 'number', value: 9999 };
  }
  if (/^all but the bottom (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of (?:that player's|target player's|their) library$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a card(?:\.|\.)["')]*$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^x cards at random$/i.test(trimmed)) {
    return { kind: 'x' };
  }
  if (/^an? .+ card rather than pay this spell's mana cost$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^an? .+ card and another card rather than pay this spell's mana cost$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a card["'] until end of turn$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^two cards["'] until end of turn$/i.test(trimmed)) {
    return { kind: 'number', value: 2 };
  }
  if (/^that (much|many)$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that (much|many)\s+cards?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/\s+cards?$/i, '') };
  }
  if (/^the difference$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the difference' };
  if (/^the\s+amount\s+of\s+life\s+you\s+gained\s+this\s+turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^excess$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'excess' };
  if (/^for\s+each\s+other\s+creature\s+you\s+control\s+that\s+ability\s+could\s+target$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^half\b/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^(?:her|his)\s+power$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^its\s+converted\s+mana\s+cost$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'mana_value' };
  if (/^its\s+power\s+plus\s+its\s+toughness$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^its\s+total\s+toxic\s+value$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^its\s+toughness(?:,"\s+and\s+can\s+attack\s+as\s+though\s+it\s+didn(?:'|’)t\s+have\s+defender)?$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'toughness' };
  if (/^no$/i.test(trimmed)) return { kind: 'number', value: 0 };
  if (/^or$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'or' };
  if (/^a\s+for\s+each\s+color\s+of\s+mana\s+spent\s+to\s+cast\s+it$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^an?\s+for\s+each\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^an?\s+amount\s+of\s+damage\s+equal\s+to\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a\s+number\s+of\s+cards\s+equal\s+to\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^cards?\s+equal\s+to\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^(?:\d+|a|a\s+card)\s+for\s+each\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a\s+for\s+each\s+time\s+it\s+was\s+kicked$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^1\s+for\s+each\s+creature\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^1\s+for\s+each\s+card\s+in\s+your\s+hand$/i.test(trimmed)) return { kind: 'reference_amount', raw: '1 for each card in your hand' };
  if (/^1\s+for\s+each\s+creature\s+on\s+the\s+battlefield$/i.test(trimmed)) return { kind: 'reference_amount', raw: '1 for each creature on the battlefield' };
  if (/^the number of creatures you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the number of [a-z0-9 +/'\-]+s you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the number of attacking creatures$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the number of attacking creatures' };
  if (/^the greatest power among creatures you control$/i.test(trimmed)) return { kind: 'greatest_power_among_creatures_you_control' };
  if (/^the greatest toughness among (?:other )?creatures you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+high\s+bid$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the high bid' };
  if (/^that\s+spell'?s\s+mana\s+value$/i.test(trimmed)) return { kind: 'reference_amount', raw: "that spell's mana value" };
  if (/^that\s+card(?:'|’)?s\s+mana\s+value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'mana_value' };
  if (/^that\s+card(?:'|’)?s\s+mana\s+value\s+if\s+this\s+creature\s+isn(?:'|’)?t\s+saddled$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that\s+card(?:'|’)?s\s+toughness,\s+lose\s+life\s+equal\s+to\s+its\s+power$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that\s+creature\s+card(?:'|’)?s\s+toughness$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that\s+card'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'power' };
  if (/^that\s+card'?s\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'toughness' };
  if (/^target\s+creature'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'power' };
  if (/^target\s+creature'?s\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'toughness' };
  if (/^that\s+creature'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'power' };
  if (/^that\s+creature'?s\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'toughness' };
  if (/^its\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'power' };
  if (/^its\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'toughness' };
  if (/^its\s+mana\s+value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'mana_value' };
  if (/^its\s+base\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'power' };
  if (/^its\s+base\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'toughness' };
  if (/^the\s+creature'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'source', stat: 'power' };
  if (/^the\s+sacrificed\s+creature'?s\s+power$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'power' };
  }
  if (/^the number of artifacts you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the number of artifacts you control' };
  if (/^the number of lands you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the number of lands you control' };
  if (/^the number of cards in (?:your|their) hand$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the number of [a-z0-9 +/\-]+ counters on it$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^1\s+for\s+each\s+attacking\s+creature$/i.test(trimmed)) return { kind: 'reference_amount', raw: '1 for each attacking creature' };
  if (/^that spell'?s mana value$/i.test(trimmed)) return { kind: 'reference_amount', raw: "that spell's mana value" };
  if (/^the damage prevented this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the damage prevented this way' };
  if (/^the damage dealt this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the damage dealt this way' };
  if (/^a\s+card\s+for\s+each\s+card\s+exiled\s+from\s+their\s+hand\s+this\s+way$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^for\s+each\s+basic\s+land\s+type\s+among\s+lands\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^until\s+(?:you|they)\s+exile\s+a\s+nonland\s+card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^until\s+(?:you|they)\s+exile\s+an?\s+instant\s+or\s+sorcery\s+card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^until\s+you\s+exile\s+a\s+nonland\s+card\s+whose\s+mana\s+value\s+is\s+less\s+than\s+this\s+spell(?:'|’)?s\s+mana\s+value$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the\s+number\s+of\s+cards\s+in\s+that\s+player(?:'|â€™)?s\s+hand$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: "the number of cards in that player's hand" };
  }
  if (/^the\s+number\s+of\s+mountains\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'the number of mountains you control' };
  }
  if (/^the\s+number\s+of\s+.+$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^your\s+devotion\s+to\s+[a-z]+$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+difference\s+between\s+those\s+results$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the difference between those results' };
  if (/^the\s+(?:discarded|exiled|revealed|sacrificed)\s+(?:card|artifact)(?:'|’)?s\s+(?:mana\s+value|power|toughness)$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+sacrificed\s+artifact(?:'|’)?s\s+mana\s+value$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^cards?\s+equal\s+to\s+.+?\s+mana\s+value(?:\s+from\s+.+)?$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+mana\s+value\s+of\s+the\s+card\s+revealed\s+by\s+the\s+other\s+player$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+total\s+number\s+of\s+instant\s+and\s+sorcery\s+cards\s+you\s+own\s+in\s+exile\s+and\s+in\s+your\s+graveyard$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+life\s+they\s+lost\s+this\s+turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the life they lost this turn' };
  if (/^twice\s+x$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'twice X' };
  if (/^a\s+card\s+for\s+each\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each +1/+1 counter on it' };
  }
  if (/^a\s+card\s+for\s+each\s+creature\s+you\s+control\s+with\s+power\s+4\s+or\s+greater$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each creature you control with power 4 or greater' };
  }
  if (/^a\s+card\s+for\s+each\s+Island\s+you\s+control$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a card for each Island you control' };
  if (/^a\s+for\s+each\s+creature\s+card\s+in\s+your\s+graveyard$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a for each creature card in your graveyard' };
  if (/^a\s+for\s+each\s+creature\s+that\s+died\s+this\s+turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a for each creature that died this turn' };
  if (/^a\s+card\s+for\s+each\s+creature\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each creature you control' };
  }
  if (/^a\s+card\s+for\s+each\s+color\s+among\s+permanents\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each color among permanents you control' };
  }
  if (/^a\s+number\s+equal\s+to\s+the\s+amount\s+of\s+mana\s+spent\s+to\s+cast\s+it$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'the amount of mana spent to cast it' };
  }
  if (/^(?:a\s+)?number\s+equal\s+to\s+.+$/i.test(trimmed) || /^a\s+equal\s+to\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/^a\s+equal\s+to\s+/i, 'equal to ') };
  }
  if (/^a\s+number\s+of$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a number of' };
  if (/^equal\s+to\s+that\s+card'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'power' };
  if (/^equal\s+to\s+that\s+card'?s\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'toughness' };
  if (/^equal\s+to\s+target\s+creature'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'power' };
  if (/^equal\s+to\s+target\s+creature'?s\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'toughness' };
  if (/^equal\s+to\s+.+$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the sacrificed creature'?s toughness$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'toughness' };
  }
  if (/^any number$/i.test(trimmed)) return { kind: 'any_number' };
  if (/^any number of land cards$/i.test(trimmed)) return { kind: 'any_number' };
  if (/^two cards at random$/i.test(trimmed)) return { kind: 'number', value: 2 };
  if (/^three cards at random$/i.test(trimmed)) return { kind: 'number', value: 3 };
  if (/^each$/i.test(trimmed)) return { kind: 'all' };
  if (/^a card at random$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^that many cards plus one$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'that many cards plus one' };
  if (/^card$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^a nonland card$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^this creature(?:'|')?s power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'this_creature', stat: 'power' };
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
  if (isThoseOpponentsSelector(s)) return { kind: 'each_of_those_opponents' };
  if (s === 'target player') return { kind: 'target_player' };
  if (/^target\s+player\s+other\s+than\s+.+?\s+owner$/.test(s)) return { kind: 'target_player' };
  if (s === 'target opponent') return { kind: 'target_opponent' };
  if (s === 'an opponent' || s === 'the opponent') return { kind: 'target_opponent' };
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

  if (/^you\s+may\b/i.test(working)) {
    optional = true;
    working = working.replace(/^you\s+may\b\s*/i, '');
  }

  // Saga chapter lines commonly prefix the real clause with a roman numeral marker
  // like "III -", but corpus text can arrive with mojibake punctuation as well.
  // Strip the whole marker so downstream clause parsers see the action text.
  working = working.replace(/^(?:[ivxlcdm]+)\s*(?:[-?]|[^\w\s])+\s*/i, '');

  working = working
    .replace(/^\+\s*\{[^}]+\}\s*[-|]\s*/i, '')
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
