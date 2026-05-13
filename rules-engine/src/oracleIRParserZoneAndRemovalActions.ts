import type { OracleEffectStep, OraclePlayerSelector, OracleZone } from './oracleIR';
import {
  inferZoneFromDestination,
  inferZoneFromDestinationPrefix,
  normalizeCounterName,
  splitSacrificeObjectAndCondition,
} from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

function splitMoveZoneReturnClause(clause: string): { readonly whatRaw: string; readonly toRaw: string } | null {
  const normalized = normalizeOracleText(clause);
  if (!normalized.toLowerCase().startsWith('return ')) return null;

  const body = normalized.slice('return '.length);
  const boundary = /\s+to\s+/gi;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(body)) !== null) {
    const whatRaw = body.slice(0, match.index).trim();
    const toRaw = body.slice(match.index + match[0].length).trim();
    if (!whatRaw || !toRaw) continue;
    if (inferZoneFromDestinationPrefix(toRaw) === 'unknown') continue;
    return { whatRaw, toRaw };
  }

  return null;
}

function parseBattlefieldController(to: OracleZone, toRaw: string): OraclePlayerSelector | undefined {
  if (to !== 'battlefield') return undefined;

  const normalized = normalizeOracleText(toRaw).toLowerCase();
  if (/\bunder\s+your\s+control\b/i.test(normalized)) {
    return { kind: 'you' };
  }

  if (
    /\bunder\s+its\s+owner'?s\s+control\b/i.test(normalized) ||
    /\bunder\s+their\s+owners'?[\s]+\s*control\b/i.test(normalized)
  ) {
    return { kind: 'owner_of_moved_cards' };
  }

  return undefined;
}

function parseMoveZoneBattlefieldCounters(to: OracleZone, toRaw: string): Record<string, number> | undefined {
  if (to !== 'battlefield') return undefined;

  const normalized = normalizeOracleText(toRaw).trim();
  if (!/\bwith\b/i.test(normalized) || !/\bcounters?\b/i.test(normalized)) return undefined;

  const match = normalized.match(/\bwith\s+((?:a\s+number\s+of|number\s+of|a|an|\d+|x|[a-z]+))\s+([^,.]+?)\s+counters?\s+on\s+it\b/i);
  if (!match) return undefined;
  if (/\bof your choice\b/i.test(match[0])) return undefined;

  const qty = parseQuantity(String(match[1] || '').trim());
  if (qty.kind !== 'number') return undefined;

  const amount = Math.max(0, qty.value | 0);
  if (amount <= 0) return undefined;

  const counterName = normalizeCounterName(String(match[2] || '').replace(/^\s*additional\s+/i, '').trim());
  if (!counterName) return undefined;

  return { [counterName]: amount };
}

function parseMoveZoneEntersFaceDown(to: OracleZone, toRaw: string): boolean | undefined {
  if (to !== 'battlefield') return undefined;
  const normalized = normalizeOracleText(toRaw).toLowerCase();
  return /\bface down\b/i.test(normalized) ? true : undefined;
}

function parseMoveZoneBattlefieldAttachment(to: OracleZone, toRaw: string) {
  if (to !== 'battlefield') return undefined;

  const normalized = normalizeOracleText(toRaw).trim();
  const match = normalized.match(
    /\battached to (this creature|a creature you control|that creature|that land|that permanent)\b/i
  );
  if (!match) return undefined;

  return parseObjectSelector(String(match[1] || '').trim());
}

function parseMoveZoneStep(args: {
  whatRaw: string;
  toRaw: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep {
  const { whatRaw, toRaw, rawClause, withMeta } = args;
  const unlessPaysLifeMatch = toRaw.match(/^(.+?)\s+unless\s+(.+?)\s+pays\s+(\d+)\s+life$/i);
  const baseToRaw = unlessPaysLifeMatch ? String(unlessPaysLifeMatch[1] || '').trim() : toRaw;
  const trailingConditionMatch = baseToRaw.match(/^(.+?)\s+if\s+(.+)$/i);
  const effectiveToRaw =
    trailingConditionMatch && inferZoneFromDestinationPrefix(String(trailingConditionMatch[1] || '').trim()) !== 'unknown'
      ? String(trailingConditionMatch[1] || '').trim()
      : baseToRaw;
  const trailingConditionRaw =
    trailingConditionMatch && effectiveToRaw !== baseToRaw ? String(trailingConditionMatch[2] || '').trim() : '';
  const normalizedWhatRaw = (() => {
    const normalized = normalizeOracleText(whatRaw).trim();
    if (/^this card from your graveyard$/i.test(normalized)) return 'this card';
    if (/^it from your graveyard$/i.test(normalized)) return 'it';
    return whatRaw;
  })();
  const what = parseObjectSelector(normalizedWhatRaw);
  const to = inferZoneFromDestination(effectiveToRaw);
  const battlefieldController = parseBattlefieldController(to, effectiveToRaw);
  const battlefieldAttachedTo = parseMoveZoneBattlefieldAttachment(to, effectiveToRaw);
  const entersTapped =
    to === 'battlefield' && !/\buntapped\b/i.test(effectiveToRaw) && /\btapped\b/i.test(effectiveToRaw) ? true : undefined;
  const entersFaceDown = parseMoveZoneEntersFaceDown(to, effectiveToRaw);
  const withCounters = parseMoveZoneBattlefieldCounters(to, effectiveToRaw);
  let moveStep: OracleEffectStep = withMeta({
    kind: 'move_zone',
    what,
    to,
    toRaw: effectiveToRaw,
    battlefieldController,
    battlefieldAttachedTo,
    entersTapped,
    entersFaceDown,
    withCounters,
    raw: rawClause,
  });
  if (trailingConditionRaw) {
    moveStep = withMeta({
      kind: 'conditional',
      condition: { kind: 'if', raw: trailingConditionRaw },
      steps: [moveStep],
      raw: rawClause,
    });
  }

  if (!unlessPaysLifeMatch) return moveStep;

  return withMeta({
    kind: 'unless_pays_life',
    who: parsePlayerSelector(String(unlessPaysLifeMatch[2] || '').trim()),
    amount: parseInt(String(unlessPaysLifeMatch[3] || '0'), 10) || 0,
    steps: [moveStep],
    raw: rawClause,
  });
}

export function tryParseZoneAndRemovalClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  const forEachOpponentReturnMatch = clause.match(/^for\s+each\s+opponent,\s+return\s+(.+?)\s+to\s+(.+)$/i);
  if (forEachOpponentReturnMatch) {
    return parseMoveZoneStep({
      whatRaw: String(forEachOpponentReturnMatch[1] || '').trim(),
      toRaw: String(forEachOpponentReturnMatch[2] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  const destroyMatch = clause.match(/^destroy\s+(.+)$/i);
  if (destroyMatch) {
    return withMeta({ kind: 'destroy', target: parseObjectSelector(destroyMatch[1]), raw: rawClause });
  }

  const counterUnlessPaysMatch = clause.match(/^counter\s+target\s+spell\s+unless\s+its\s+controller\s+pays\s+(\{[^}]+\})$/i);
  if (counterUnlessPaysMatch) {
    return withMeta({
      kind: 'unless_pays_mana',
      who: parsePlayerSelector('its controller'),
      mana: String(counterUnlessPaysMatch[1] || '').trim(),
      steps: [
        withMeta({ kind: 'counter_spell', target: parseObjectSelector('target spell'), raw: rawClause })
      ],
      raw: rawClause,
    });
  }

  const counterUnlessDiscardMatch = clause.match(/^counter\s+(.+?)\s+unless\s+its\s+controller\s+discards?\s+(?:a|an|one|\d+|[a-z]+)\s+cards?$/i);
  if (counterUnlessDiscardMatch && /\b(?:spell|ability|abilities)\b/i.test(String(counterUnlessDiscardMatch[1] || ''))) {
    return withMeta({
      kind: 'counter_spell',
      target: parseObjectSelector(String(counterUnlessDiscardMatch[1] || '').trim()),
      raw: rawClause,
    });
  }

  const counterUnlessVariablePaysMatch = clause.match(/^counter\s+(target\s+.+?)\s+unless\s+its\s+controller\s+pays\s+(.+)$/i);
  if (counterUnlessVariablePaysMatch && /\b(?:spell|spells|ability|abilities)\b/i.test(String(counterUnlessVariablePaysMatch[1] || ''))) {
    return withMeta({
      kind: 'counter_spell',
      target: parseObjectSelector(String(counterUnlessVariablePaysMatch[1] || '').trim()),
      raw: rawClause,
    });
  }

  const counterContextualUnlessPaysMatch = clause.match(/^counter\s+(that\s+spell\s+or\s+ability|that\s+spell|that\s+ability)\s+unless\s+its\s+controller\s+pays\s+(.+)$/i);
  if (counterContextualUnlessPaysMatch) {
    return withMeta({
      kind: 'counter_spell',
      target: parseObjectSelector(String(counterContextualUnlessPaysMatch[1] || '').trim()),
      raw: rawClause,
    });
  }

  const counterUpToStackObjectsMatch = clause.match(
    /^counter\s+(up to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+target\s+.+)$/i
  );
  if (counterUpToStackObjectsMatch && /\b(?:spell|spells|ability|abilities)\b/i.test(String(counterUpToStackObjectsMatch[1] || ''))) {
    return withMeta({
      kind: 'counter_spell',
      target: parseObjectSelector(String(counterUpToStackObjectsMatch[1] || '').trim()),
      raw: rawClause,
    });
  }

  const counterTargetedStackObjectMatch = clause.match(/^counter\s+(target\s+.+)$/i);
  if (counterTargetedStackObjectMatch && /\b(?:spell|spells|ability|abilities)\b/i.test(String(counterTargetedStackObjectMatch[1] || ''))) {
    return withMeta({
      kind: 'counter_spell',
      target: parseObjectSelector(String(counterTargetedStackObjectMatch[1] || '').trim()),
      raw: rawClause,
    });
  }

  const counterContextualStackObjectMatch = clause.match(/^counter\s+(that\s+(?:spell\s+or\s+ability|spell|ability)|it)$/i);
  if (counterContextualStackObjectMatch) {
    return withMeta({
      kind: 'counter_spell',
      target: parseObjectSelector(String(counterContextualStackObjectMatch[1] || '').trim()),
      raw: rawClause,
    });
  }

  const exileFromMatch = clause.match(/^exile\s+(.+?)\s+from\s+(.+)$/i);
  if (exileFromMatch) {
    const whatRaw = `${String(exileFromMatch[1] || '').trim()} from ${String(exileFromMatch[2] || '').trim()}`.trim();
    return withMeta({ kind: 'move_zone', what: parseObjectSelector(whatRaw), to: 'exile', toRaw: 'exile', raw: rawClause });
  }

  const subjectExilesFromHandMatch = clause.match(
    /^(target player|target opponent|that player|that opponent|an opponent|each player|each opponent)\s+exiles?\s+(.+?)\s+from\s+(?:their|his or her|your)\s+hand$/i
  );
  if (subjectExilesFromHandMatch) {
    const subject = String(subjectExilesFromHandMatch[1] || '').trim().toLowerCase();
    const ownerText = /opponent/i.test(subject)
      ? "target opponent's"
      : /^each player$/i.test(subject)
        ? "each player's"
        : /^each opponent$/i.test(subject)
          ? "each opponent's"
          : "target player's";
    return withMeta({
      kind: 'move_zone',
      what: parseObjectSelector(`${String(subjectExilesFromHandMatch[2] || '').trim()} from ${ownerText} hand`),
      to: 'exile',
      toRaw: 'exile',
      raw: rawClause,
    });
  }

  const subjectExilesFromGraveyardMatch = clause.match(
    /^(target player|target opponent|that player|that opponent|an opponent|each player|each opponent)\s+exiles?\s+(.+?)\s+from\s+(?:their|his or her|your)\s+graveyard$/i
  );
  if (subjectExilesFromGraveyardMatch) {
    const subject = String(subjectExilesFromGraveyardMatch[1] || '').trim().toLowerCase();
    const ownerText = /opponent/i.test(subject)
      ? "target opponent's"
      : /^each player$/i.test(subject)
        ? "each player's"
        : /^each opponent$/i.test(subject)
          ? "each opponent's"
          : "target player's";
    return withMeta({
      kind: 'move_zone',
      what: parseObjectSelector(`${String(subjectExilesFromGraveyardMatch[2] || '').trim()} from ${ownerText} graveyard`),
      to: 'exile',
      toRaw: 'exile',
      raw: rawClause,
    });
  }

  const chooseFromGraveyardOrHandAndExileMatch = clause.match(
    /^you\s+choose\s+(.+?)\s+from\s+that\s+player(?:'|â€™)?s\s+graveyard\s+or\s+hand\s+and\s+exile\s+it$/i
  );
  if (chooseFromGraveyardOrHandAndExileMatch) {
    return withMeta({
      kind: 'move_zone',
      what: parseObjectSelector(`${String(chooseFromGraveyardOrHandAndExileMatch[1] || '').trim()} from that player's graveyard or hand`),
      to: 'exile',
      toRaw: 'exile',
      raw: rawClause,
    });
  }

  const insteadExileMatch = clause.match(/^instead\s+exile\s+(.+)$/i);
  if (insteadExileMatch) {
    return withMeta({ kind: 'exile', target: parseObjectSelector(insteadExileMatch[1]), raw: rawClause });
  }

  const exileMatch = clause.match(/^(?:otherwise,\s*)?exile\s+(.+)$/i);
  if (exileMatch) {
    return withMeta({ kind: 'exile', target: parseObjectSelector(exileMatch[1]), raw: rawClause });
  }

  const enchantedControllerSacrificeMatch = clause.match(/^enchanted\s+[a-z0-9 -]+(?:'s)?\s+controller\s+sacrifices?\s+(.+)$/i);
  if (enchantedControllerSacrificeMatch) {
    const parsedObject = splitSacrificeObjectAndCondition(String(enchantedControllerSacrificeMatch[1] || '').trim());
    return withMeta({
      kind: 'sacrifice',
      who: { kind: 'target_player' },
      what: parseObjectSelector(parsedObject.objectText),
      ...(parsedObject.condition ? { condition: parsedObject.condition } : {}),
      raw: rawClause,
    });
  }

  const sacrificeMatch = clause.match(
    /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢]s (?:controller|owner))\s+)?sacrifices?\s+(.+)$/i
  );
  if (sacrificeMatch) {
    const parsedObject = splitSacrificeObjectAndCondition(String(sacrificeMatch[2] || '').trim());
    return withMeta({
      kind: 'sacrifice',
      who: parsePlayerSelector(sacrificeMatch[1]),
      what: parseObjectSelector(parsedObject.objectText),
      ...(parsedObject.condition ? { condition: parsedObject.condition } : {}),
      raw: rawClause,
    });
  }

  const sacrificeDefaultMatch = clause.match(/^sacrifice\s+(.+)$/i);
  if (sacrificeDefaultMatch) {
    const parsedObject = splitSacrificeObjectAndCondition(String(sacrificeDefaultMatch[1] || '').trim());
    return withMeta({
      kind: 'sacrifice',
      who: { kind: 'you' },
      what: parseObjectSelector(parsedObject.objectText),
      ...(parsedObject.condition ? { condition: parsedObject.condition } : {}),
      raw: rawClause,
    });
  }

  const returnParts = splitMoveZoneReturnClause(clause);
  if (returnParts) {
    return parseMoveZoneStep({
      whatRaw: returnParts.whatRaw,
      toRaw: returnParts.toRaw,
      rawClause,
      withMeta,
    });
  }

  {
    const addToHandMatch = clause.match(/^add\s+(it|that card|the exiled card|them|those cards)\s+to\s+your\s+hand$/i);
    if (addToHandMatch) {
      return parseMoveZoneStep({
        whatRaw: String(addToHandMatch[1] || '').trim(),
        toRaw: 'your hand',
        rawClause,
        withMeta,
      });
    }
  }

  {
    const subjectReturnMatch = clause.match(
      /^(that player|that opponent|he or she|they)\s+returns?\s+(.+?)\s+from\s+(their|his or her)\s+graveyard\s+to\s+(.+)$/i
    );
    if (subjectReturnMatch) {
      const subjectSelector = parsePlayerSelector(String(subjectReturnMatch[1] || '').trim());
      if (subjectSelector.kind === 'target_player' || subjectSelector.kind === 'target_opponent') {
        const ownerPrefix = subjectSelector.kind === 'target_opponent' ? "target opponent's" : "target player's";
        return parseMoveZoneStep({
          whatRaw: `${String(subjectReturnMatch[2] || '').trim()} from ${ownerPrefix} graveyard`,
          toRaw: String(subjectReturnMatch[4] || '').trim(),
          rawClause,
          withMeta,
        });
      }
    }
  }

  {
    const subjectPutsIntoHandMatch = clause.match(
      /^(that player|that opponent|target player|target opponent|they|its owner|its controller)\s+puts?\s+(it|that card|the exiled card|them|those cards)\s+into\s+(?:their|his or her|your)\s+hand$/i
    );
    if (subjectPutsIntoHandMatch) {
      const subject = String(subjectPutsIntoHandMatch[1] || '').trim();
      const destination = /opponent/i.test(subject) ? "target opponent's hand" : "target player's hand";
      return parseMoveZoneStep({
        whatRaw: String(subjectPutsIntoHandMatch[2] || '').trim(),
        toRaw: destination,
        rawClause,
        withMeta,
      });
    }
  }

  {
    const targetOwnerPutsOnLibraryMatch = clause.match(
      /^(.+?)'?s\s+owner\s+puts?\s+it\s+on\s+their\s+choice\s+of\s+the\s+top\s+or\s+bottom\s+of\s+their\s+library$/i
    );
    if (targetOwnerPutsOnLibraryMatch) {
      return parseMoveZoneStep({
        whatRaw: String(targetOwnerPutsOnLibraryMatch[1] || 'it').trim(),
        toRaw: "top or bottom of its owner's library",
        rawClause,
        withMeta,
      });
    }

    const ownerPutsOnLibraryMatch = clause.match(
      /^(?:(?:the\s+)?owner\s+of\s+)?(?:target\s+spell,\s+nonland\s+permanent,\s+or\s+card\s+in\s+a\s+graveyard|that card|it|its owner)\s+puts?\s+(it|that card|the exiled card)?\s*(?:on|onto)\s+the\s+(top|bottom)(?:\s+or\s+(bottom|top))?\s+of\s+(?:their|his or her|its owner's|that player's|your)\s+library$/i
    );
    if (ownerPutsOnLibraryMatch) {
      const placement = ownerPutsOnLibraryMatch[3]
        ? `${String(ownerPutsOnLibraryMatch[2] || '').trim()} or ${String(ownerPutsOnLibraryMatch[3] || '').trim()}`
        : String(ownerPutsOnLibraryMatch[2] || '').trim();
      return parseMoveZoneStep({
        whatRaw: String(ownerPutsOnLibraryMatch[1] || 'it').trim(),
        toRaw: `${placement} of its owner's library`,
        rawClause,
        withMeta,
      });
    }
  }

  const putIntoMatch = clause.match(/^(?:otherwise,\s*)?put\s+(.+?)\s+into\s+(.+)$/i);
  if (putIntoMatch) {
    return parseMoveZoneStep({
      whatRaw: String(putIntoMatch[1] || '').trim(),
      toRaw: String(putIntoMatch[2] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  const putOnLibraryMatch = clause.match(/^put\s+(.+?)\s+on\s+(.+?library)$/i);
  if (putOnLibraryMatch) {
    return parseMoveZoneStep({
      whatRaw: String(putOnLibraryMatch[1] || '').trim(),
      toRaw: String(putOnLibraryMatch[2] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  const putCardsFromHandOnLibraryMatch = clause.match(/^put\s+(.+?\s+cards?\s+from\s+your\s+hand)\s+on\s+(top\s+of\s+your\s+library)\s+in\s+any\s+order$/i);
  if (putCardsFromHandOnLibraryMatch) {
    return parseMoveZoneStep({
      whatRaw: String(putCardsFromHandOnLibraryMatch[1] || '').trim(),
      toRaw: String(putCardsFromHandOnLibraryMatch[2] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  const shuffleTargetCardsFromGraveyardMatch = clause.match(
    /^(target\s+player)\s+shuffles?\s+(up\s+to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+target\s+cards?)\s+from\s+their\s+graveyard\s+into\s+their\s+library$/i
  );
  if (shuffleTargetCardsFromGraveyardMatch) {
    return parseMoveZoneStep({
      whatRaw: `${String(shuffleTargetCardsFromGraveyardMatch[2] || '').trim()} from target player's graveyard`,
      toRaw: "target player's library",
      rawClause,
      withMeta,
    });
  }

  const ownerShufflesIntoLibraryMatch = clause.match(/^(?:its|their|his or her)\s+owner\s+shuffles?\s+(it|them|that card|those cards)\s+into\s+(?:their|his or her)\s+library$/i);
  if (ownerShufflesIntoLibraryMatch) {
    return parseMoveZoneStep({
      whatRaw: String(ownerShufflesIntoLibraryMatch[1] || 'it').trim(),
      toRaw: "its owner's library",
      rawClause,
      withMeta,
    });
  }

  const subjectOwnerShufflesIntoLibraryMatch = clause.match(/^(this\s+creature|this\s+permanent|that\s+creature|it)(?:'|â€™)?s\s+owner\s+shuffles?\s+it\s+into\s+their\s+library$/i);
  if (subjectOwnerShufflesIntoLibraryMatch) {
    return parseMoveZoneStep({
      whatRaw: String(subjectOwnerShufflesIntoLibraryMatch[1] || 'it').trim(),
      toRaw: "its owner's library",
      rawClause,
      withMeta,
    });
  }

  const targetOwnerShufflesIntoLibraryMatch = clause.match(/^(target\s+.+?)(?:'|â€™)?s\s+owner\s+shuffles?\s+it\s+into\s+their\s+library$/i);
  if (targetOwnerShufflesIntoLibraryMatch) {
    return parseMoveZoneStep({
      whatRaw: String(targetOwnerShufflesIntoLibraryMatch[1] || 'it').trim(),
      toRaw: "its owner's library",
      rawClause,
      withMeta,
    });
  }

  const revealAndShuffleIntoOwnerLibraryMatch = clause.match(/^reveal\s+(.+?)\s+and\s+shuffle\s+(it|them|that card|this permanent)\s+into\s+its\s+owner(?:'|â€™)?s\s+library$/i);
  if (revealAndShuffleIntoOwnerLibraryMatch) {
    return parseMoveZoneStep({
      whatRaw: String(revealAndShuffleIntoOwnerLibraryMatch[2] || revealAndShuffleIntoOwnerLibraryMatch[1] || 'it').trim(),
      toRaw: "its owner's library",
      rawClause,
      withMeta,
    });
  }

  const putThoseIntoGraveyardMatch = clause.match(/^(?:then\s+)?puts?\s+(those\s+cards|them)\s+into\s+(?:their|your)\s+graveyard$/i);
  if (putThoseIntoGraveyardMatch) {
    return parseMoveZoneStep({
      whatRaw: String(putThoseIntoGraveyardMatch[1] || 'those cards').trim(),
      toRaw: 'graveyard',
      rawClause,
      withMeta,
    });
  }

  const putOntoMatch = clause.match(/^put\s+(.+?)\s+onto\s+(.+)$/i);
  if (putOntoMatch) {
    return parseMoveZoneStep({
      whatRaw: String(putOntoMatch[1] || '').trim(),
      toRaw: String(putOntoMatch[2] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  const shuffleIntoMatch = clause.match(/^shuffle\s+(.+?)\s+into\s+(.+)$/i);
  if (shuffleIntoMatch) {
    return parseMoveZoneStep({
      whatRaw: String(shuffleIntoMatch[1] || '').trim(),
      toRaw: String(shuffleIntoMatch[2] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  return null;
}

export function splitConservativeExileFromLeadClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const normalized = normalizeOracleText(args.rawClause).trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^(exile\s+.+?\s+from\s+(?:a|your|their|target player's|target opponent's)\s+graveyard)(?:\s+and|,\s*then)\s+(.+)$/i
  );
  if (match) {
    const left = String(match[1] || '').trim();
    const right = String(match[2] || '').trim();
    if (!left || !right) return null;

    const parsedLeft = args.parseEffectClauseToStep(left);
    if (
      !parsedLeft ||
      parsedLeft.kind !== 'move_zone' ||
      parsedLeft.to !== 'exile'
    ) {
      return null;
    }

    const parsedRight = args.parseEffectClauseToStep(right);
    if (!parsedRight || parsedRight.kind === 'unknown') return null;

    return [left, right];
  }

  const mixedTargetMatch = normalized.match(
    /^(exile\s+.+?)\s+and\s+((?:up to one\s+)?target\s+.+?\s+from\s+a\s+graveyard)$/i
  );
  if (!mixedTargetMatch) return null;

  const left = String(mixedTargetMatch[1] || '').trim();
  const right = `exile ${String(mixedTargetMatch[2] || '').trim()}`.trim();
  if (!left || !right) return null;

  const parsedLeft = args.parseEffectClauseToStep(left);
  const parsedRight = args.parseEffectClauseToStep(right);
  if (!parsedLeft || !parsedRight || parsedLeft.kind === 'unknown' || parsedRight.kind === 'unknown') {
    return null;
  }

  return [left, right];
}
