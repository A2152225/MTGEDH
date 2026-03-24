import type { PlayerID } from '../../shared/src';
import {
  ReplacementEffectType,
  type ParsedReplacementEffect,
} from './replacementEffectsTypes';

/**
 * Parse replacement effects from oracle text.
 */
export function parseReplacementEffectsFromText(
  oracleText: string,
  permanentId: string,
  controllerId: PlayerID,
  cardName: string
): ParsedReplacementEffect[] {
  const effects: ParsedReplacementEffect[] = [];
  const text = oracleText.toLowerCase();

  if (text.includes('enters the battlefield tapped')) {
    effects.push({
      type: ReplacementEffectType.ENTERS_TAPPED,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'enters_battlefield',
      replacement: 'enters tapped',
      isSelfReplacement: true,
    });
  }

  const counterMatch = text.match(/enters the battlefield with (\d+|a|an) ([+\-\d\/]+|\w+) counters?/i);
  if (counterMatch) {
    const count = counterMatch[1] === 'a' || counterMatch[1] === 'an' ? '1' : counterMatch[1];
    effects.push({
      type: ReplacementEffectType.ENTERS_WITH_COUNTERS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'enters_battlefield',
      replacement: `enters with ${count} ${counterMatch[2]} counters`,
      isSelfReplacement: true,
      value: `${count}:${counterMatch[2]}`,
    });
  }

  if (text.includes('if') && text.includes('would') && text.includes('die') && text.includes('instead')) {
    effects.push({
      type: ReplacementEffectType.DIES_WITH_EFFECT,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'dies',
      replacement: extractInsteadClause(text),
      isSelfReplacement: text.includes('this creature') || text.includes(cardName.toLowerCase()),
    });
  }

  if (text.includes('if') && text.includes('would') && text.includes('damage') && text.includes('instead')) {
    const redirectMatch = text.includes('to you') || text.includes('to its controller');
    effects.push({
      type: redirectMatch ? ReplacementEffectType.REDIRECT_DAMAGE : ReplacementEffectType.PREVENT_DAMAGE,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'damage',
      replacement: extractInsteadClause(text),
      isSelfReplacement: false,
    });
  }

  if (text.includes('prevent') && text.includes('damage')) {
    const damageTypeMatch = text.match(/prevent (?:all |the next )?(\d+)?\s*(?:combat )?damage/i);
    effects.push({
      type: ReplacementEffectType.PREVENT_DAMAGE,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'damage',
      replacement: 'prevent damage',
      isSelfReplacement: text.includes('to this') || text.includes('to it'),
      value: damageTypeMatch?.[1] ? parseInt(damageTypeMatch[1]) : undefined,
    });
  }

  if (text.includes('if') && text.includes('would') && text.includes('gain life') && text.includes('instead')) {
    effects.push({
      type: ReplacementEffectType.LIFE_GAIN_TO_COUNTERS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'gain_life',
      replacement: extractInsteadClause(text),
      isSelfReplacement: false,
    });
  }

  if (text.includes('if') && text.includes('would') && text.includes('draw') && text.includes('instead')) {
    effects.push({
      type: ReplacementEffectType.WOULD_DRAW_INSTEAD,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'draw',
      replacement: extractInsteadClause(text),
      isSelfReplacement: false,
    });
  }

  if (text.includes('if') && text.includes('token') && text.includes('would') && text.includes('create')) {
    effects.push({
      type: ReplacementEffectType.EXTRA_TOKENS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'create_token',
      replacement: 'create twice that many instead',
      isSelfReplacement: false,
    });
  }

  const hardenedScalesMatch = text.match(
    /if (?:one or more )?([+\-\d\/]+) counters? would be (?:put|placed) on .+?,?\s*(?:that many )?plus (?:one|1)/i
  );
  if (hardenedScalesMatch) {
    effects.push({
      type: ReplacementEffectType.MODIFIED_COUNTERS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'place_counter',
      replacement: 'place that many plus one instead',
      isSelfReplacement: false,
      value: '+1',
    });
  } else if (
    text.includes('if') &&
    text.includes('counter') &&
    text.includes('would') &&
    (text.includes('placed') || text.includes('put')) &&
    text.includes('twice')
  ) {
    effects.push({
      type: ReplacementEffectType.EXTRA_COUNTERS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'place_counter',
      replacement: 'place twice that many instead',
      isSelfReplacement: false,
    });
  }

  const conditionalETBMatch = text.match(
    /if .+? would enter the battlefield,?\s*you may\s+(.+?)\s+instead\.?\s*if you do,?\s*(.+?)\.?\s*if you don'?t,?\s*(.+?)[.]/i
  );
  if (conditionalETBMatch) {
    effects.push({
      type: ReplacementEffectType.ENTERS_CONDITIONAL,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'enters_battlefield',
      replacement: conditionalETBMatch[2]?.trim() || 'put onto battlefield',
      isSelfReplacement: true,
      requiresChoice: true,
      requiredAction: conditionalETBMatch[1]?.trim(),
      elseEffect: conditionalETBMatch[3]?.trim(),
    });
  }

  const combatDamageToMillMatch = text.match(
    /if (?:a |an )?(\w+)(?: you control)? would deal combat damage to a player,?\s*instead\s+that player mills?\s+(?:that many|(\d+))\s*cards?/i
  );
  if (combatDamageToMillMatch) {
    const creatureType = combatDamageToMillMatch[1].charAt(0).toUpperCase() + combatDamageToMillMatch[1].slice(1);
    effects.push({
      type: ReplacementEffectType.COMBAT_DAMAGE_TO_MILL,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'combat_damage_to_player',
      replacement: 'player mills cards instead',
      isSelfReplacement: false,
      appliesToTypes: [creatureType],
      value: combatDamageToMillMatch[2] || 'damage_amount',
    });
  }

  const graveyardToExilePatterns = [
    /if a card would be put into a graveyard from anywhere,?\s*exile it instead/i,
    /if a card would be put into an opponent'?s graveyard from anywhere,?\s*exile it instead/i,
    /if (?:a |one or more )?(?:cards? or tokens?) would be put into (?:a )?graveyard(?: from anywhere)?,?\s*exile (?:it|that card|them) instead/i,
  ];

  for (const pattern of graveyardToExilePatterns) {
    if (pattern.test(text)) {
      effects.push({
        type: ReplacementEffectType.GRAVEYARD_TO_EXILE,
        sourceId: permanentId,
        controllerId,
        affectedEvent: 'put_into_graveyard',
        replacement: 'exile instead',
        isSelfReplacement: false,
        condition: text.includes("opponent's") ? 'opponent_only' : undefined,
      });
      break;
    }
  }

  const exileFromLibraryMatch = text.match(
    /(?:target (?:opponent|player) )?exiles? the top (\d+|x) cards? of (?:their|his or her|your) library/i
  );
  if (exileFromLibraryMatch) {
    effects.push({
      type: ReplacementEffectType.MILL_TO_EXILE,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'mill',
      replacement: 'exile instead of mill',
      isSelfReplacement: false,
      value: exileFromLibraryMatch[1]?.toLowerCase() === 'x' ? 'X' : exileFromLibraryMatch[1],
    });
  }

  return effects;
}

function extractInsteadClause(text: string): string {
  const insteadIndex = text.indexOf('instead');
  if (insteadIndex === -1) return '';

  const afterInstead = text.slice(insteadIndex + 7);
  const periodIndex = afterInstead.indexOf('.');
  if (periodIndex === -1) return afterInstead.trim();

  return afterInstead.slice(0, periodIndex).trim();
}
