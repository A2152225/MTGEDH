/** Remove the Legendary supertype from a type line (Helm of the Host, etc.). */
export function stripLegendaryFromTypeLine(typeLine: string): string {
  return String(typeLine || '')
    .replace(/\bLegendary\s+/gi, '')
    .replace(/\s+Legendary\b/gi, '')
    .trim();
}

/**
 * CR 707.2: "as … enters" / "as … is turned face up" choices that set characteristics
 * are copiable values. Token copies (Helm of the Host, etc.) must inherit them rather
 * than re-choosing.
 */
export type AsEntersCopiableChoices = {
  chosenCreatureType?: string;
  chosenColor?: string;
  chosenCardName?: string;
  chosenPlayer?: string;
};

export function readAsEntersCopiableChoices(source: any): AsEntersCopiableChoices {
  if (!source || typeof source !== 'object') return {};
  const card = source.card && typeof source.card === 'object' ? source.card : null;
  const chosenCreatureType = String(source.chosenCreatureType || card?.chosenCreatureType || '').trim();
  const chosenColor = String(source.chosenColor || card?.chosenColor || '').trim();
  const chosenCardName = String(source.chosenCardName || card?.chosenCardName || '').trim();
  const chosenPlayer = String(source.chosenPlayer || card?.chosenPlayer || '').trim();
  return {
    ...(chosenCreatureType ? { chosenCreatureType } : {}),
    ...(chosenColor ? { chosenColor } : {}),
    ...(chosenCardName ? { chosenCardName } : {}),
    ...(chosenPlayer ? { chosenPlayer } : {}),
  };
}

/** Apply inherited as-enters choices onto a token permanent and its card shell. */
export function applyAsEntersCopiableChoices(target: any, choices: AsEntersCopiableChoices): void {
  if (!target || typeof target !== 'object' || !choices) return;
  const card = target.card && typeof target.card === 'object' ? target.card : null;

  if (choices.chosenCreatureType) {
    target.chosenCreatureType = choices.chosenCreatureType;
    if (card) card.chosenCreatureType = choices.chosenCreatureType;
  }
  if (choices.chosenColor) {
    target.chosenColor = choices.chosenColor;
    if (card) card.chosenColor = choices.chosenColor;
  }
  if (choices.chosenCardName) {
    target.chosenCardName = choices.chosenCardName;
    if (card) card.chosenCardName = choices.chosenCardName;
  }
  if (choices.chosenPlayer) {
    target.chosenPlayer = choices.chosenPlayer;
    if (card) card.chosenPlayer = choices.chosenPlayer;
  }
}

/** Copy as-enters choices from a source permanent/card onto a token copy. */
export function copyAsEntersCopiableChoicesFromSource(source: any, target: any): AsEntersCopiableChoices {
  const choices = readAsEntersCopiableChoices(source);
  applyAsEntersCopiableChoices(target, choices);
  return choices;
}

export function applyNonLegendaryCopyTypeLine(
  card: { type_line?: string } | null | undefined,
  permanent?: { type_line?: string; cardType?: string } | null,
): void {
  if (card && typeof card === 'object') {
    if (card.type_line) {
      card.type_line = stripLegendaryFromTypeLine(card.type_line);
    }
  }
  if (permanent && typeof permanent === 'object') {
    if (permanent.type_line) {
      permanent.type_line = stripLegendaryFromTypeLine(permanent.type_line);
    }
    if (permanent.cardType) {
      permanent.cardType = stripLegendaryFromTypeLine(permanent.cardType);
    }
  }
}
