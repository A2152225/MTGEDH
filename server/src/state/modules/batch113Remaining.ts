// Leftover census lines that already have a nearby system: power-up uses,
// odd/even mana-value protection, assist on the first spell, sacrifice-a-Swamp
// and target life taxes, colored X, transform-into-a-copy, villainous choice
// repetition, and a paid die reroll.
// Public: the functions exported below.

export function normalizeBatch113(oracle: string): string {
  return String(oracle || '')
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
}

function battlefield(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}

function textOf(perm: any): string {
  return normalizeBatch113(String(perm?.card?.oracle_text || ''));
}

export function parseBatch113StaticKind(oracle: string): string | null {
  const text = normalizeBatch113(oracle);
  if (/each power-up ability of permanents you control can be activated an additional time/.test(text)) return 'power_up_extra';
  if (/has protection from each mana value of the chosen quality/.test(text)) return 'mv_quality_protection';
  if (/the first spell you cast during each of your turns has assist/.test(text)) return 'assist_grant';
  if (/spells cost an additional "sacrifice a swamp" to cast for each black mana symbol/.test(text)) return 'sacrifice_swamp_spell';
  if (/activated abilities cost an additional "sacrifice a swamp" to activate for each black mana symbol/.test(text)) return 'sacrifice_swamp_ability';
  if (/spells your opponents cast that target ~? ?cost an additional \d+ life/.test(text) || /spells your opponents cast that target (?:this creature|~) cost an additional \d+ life/.test(text)) return 'target_life_tax';
  if (/spend only colored mana on x/.test(text)) return 'colored_x';
  if (/as (?:this creature|~) transforms into .+ it becomes a copy of a creature card exiled with it/.test(text)) return 'transform_copy';
  if (/you may reveal the first card you draw each turn/.test(text)) return 'optional_first_draw_reveal';
  if (/once each turn, you may pay \{1\} to reroll/.test(text)) return 'reroll_dice';
  if (/as .+ enters, choose a player/.test(text)) return 'choose_player';
  return null;
}

export function batch113PowerUpLimit(state: any, playerId: string): number {
  const extra = battlefield(state).some((perm) => perm && String(perm.controller || '') === String(playerId)
    && /each power-up ability of permanents you control can be activated an additional time/.test(textOf(perm)));
  return extra ? 2 : 1;
}

export function batch113ManaValueProtection(permanent: any, sourceManaValue: number): boolean {
  const text = textOf(permanent);
  if (!/protection from each mana value of the chosen quality/.test(text)) return false;
  const quality = String(permanent?.chosenOddEven || permanent?.card?.chosenOddEven || '').toLowerCase();
  if (quality !== 'odd' && quality !== 'even') return false;
  const even = Math.abs(Math.trunc(Number(sourceManaValue) || 0)) % 2 === 0;
  return quality === 'even' ? even : !even;
}

export function batch113SpellHasAssist(state: any, playerId: string, card: any): boolean {
  const granted = battlefield(state).some((perm) => perm && String(perm.controller || '') === String(playerId)
    && /the first spell you cast during each of your turns has assist/.test(textOf(perm)));
  if (!granted) return false;
  const cardId = String(card?.id || '');
  const list = state?.spellsCastThisTurn;
  if (Array.isArray(list)) {
    const earlier = list.filter((entry: any) => String(entry?.casterId || entry?.playerId || '') === String(playerId)
      && String(entry?.cardId || entry?.id || '') !== cardId);
    return earlier.length === 0;
  }
  return Number(list?.[playerId] || 0) === 0;
}

export function batch113AssistDraws(state: any, playerId: string): boolean {
  return battlefield(state).some((perm) => perm && String(perm.controller || '') === String(playerId)
    && /if another player spent mana to cast it, you and that player each draw a card/.test(textOf(perm)));
}

function blackPips(cost: string): number {
  return (String(cost || '').match(/\{[^}]*b[^}]*\}/gi) || []).length;
}

export function batch113SwampSacrificeCount(state: any, playerId: string, cost: string, kind: 'spell' | 'ability'): number {
  const sentence = kind === 'spell'
    ? /spells cost an additional "sacrifice a swamp" to cast for each black mana symbol/
    : /activated abilities cost an additional "sacrifice a swamp" to activate for each black mana symbol/;
  const active = battlefield(state).some((perm) => sentence.test(textOf(perm)));
  if (!active) return 0;
  return blackPips(cost);
}

export function batch113TargetLifeTax(state: any, casterId: string, targets: unknown): number {
  const ids = new Set<string>();
  const list = Array.isArray(targets) ? targets : targets ? [targets] : [];
  for (const target of list) {
    if (typeof target === 'string') ids.add(target);
    else if (target && typeof target === 'object') {
      const id = String((target as any).id || (target as any).targetId || '');
      if (id) ids.add(id);
    }
  }
  let tax = 0;
  for (const perm of battlefield(state)) {
    if (!perm || ids.size === 0 || !ids.has(String(perm.id || ''))) continue;
    if (String(perm.controller || '') === String(casterId)) continue;
    const match = textOf(perm).match(/spells your opponents cast that target (?:this creature|~) cost an additional (\d+) life/);
    if (match) tax += Number(match[1]);
  }
  return tax;
}

export function batch113ColoredXLimit(card: any): number | null {
  const text = normalizeBatch113(String(card?.oracle_text || card?.oracleText || ''));
  if (!/spend only colored mana on x/.test(text)) return null;
  return /no more than one mana of each color/.test(text) ? 5 : null;
}

export function batch113ApplyTransformCopy(permanent: any): void {
  const card = permanent?.card;
  if (!card || !/as (?:this creature|~) transforms into .+ it becomes a copy of a creature card exiled with it/.test(normalizeBatch113(String(card.oracle_text || '')))) return;
  const exiled = [...(permanent.exiledCards || []), ...(permanent.imprinted || [])].reverse()
    .find((entry: any) => /\bcreature\b/i.test(String(entry?.type_line || '')));
  if (!exiled) return;
  const ability = String(card.oracle_text || '');
  card.oracle_text = [String(exiled.oracle_text || ''), ability].filter(Boolean).join('\n');
  card.power = '4';
  card.toughness = '4';
  const copied = String(exiled.type_line || 'Creature');
  const extras = ['Legendary', 'Zombie'].filter((word) => !new RegExp(`\\b${word}\\b`, 'i').test(copied));
  card.type_line = extras.length ? `${copied} ${extras.join(' ')}` : copied;
  card.colors = Array.from(new Set([...(exiled.colors || []), 'U', 'B']));
}

export function batch113VillainousExtra(state: any, abilityController: string, raw: string): boolean {
  if (!/villainous choice/i.test(String(raw || '')) || !/opponent/i.test(String(raw || ''))) return false;
  return battlefield(state).some((perm) => perm && String(perm.controller || '') === String(abilityController)
    && /if an opponent would face a villainous choice, they face that choice an additional time/.test(textOf(perm)));
}

export function batch113RerollText(oracle: string): boolean {
  return /once each turn, you may pay \{1\} to reroll/i.test(normalizeBatch113(oracle));
}
