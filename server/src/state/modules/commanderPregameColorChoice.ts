// server/src/state/modules/commanderPregameColorChoice.ts
// "If ~ is your commander, choose a color before the game begins. ~ is the chosen color." (Clara Oswald, The Prismatic
// Piper, Faceless One). The choice is asked once, the first time the commander enters (COLOR_CHOICE step), and is
// remembered per player/card in state.commanderPregameColors so later entries reuse it without a new prompt.
// Public entry symbols: hasCommanderPregameColorChoice, isPlayersCommander, getRememberedCommanderPregameColor,
//   applyRememberedCommanderPregameColor, rememberCommanderPregameColor.

const PREGAME_RE = /\bif .{1,60}? is your commander, choose a colou?r before the game begins\b/i;

export function hasCommanderPregameColorChoice(card: any): boolean {
  return PREGAME_RE.test(String(card?.oracle_text || '').replace(/\u2019/g, "'"));
}

export function isPlayersCommander(state: any, playerId: string, permanent: any): boolean {
  if (permanent?.isCommander === true || permanent?.card?.isCommander === true) return true;
  const ids: unknown[] = state?.commandZone?.[playerId]?.commanderIds || [];
  const cardId = String(permanent?.card?.id || '');
  return !!cardId && Array.isArray(ids) && ids.some((id) => String(id) === cardId);
}

function memoryKey(permanent: any): string {
  return String(permanent?.card?.id || permanent?.card?.name || '');
}

export function getRememberedCommanderPregameColor(state: any, playerId: string, permanent: any): string | undefined {
  const v = state?.commanderPregameColors?.[playerId]?.[memoryKey(permanent)];
  return typeof v === 'string' && v ? v : undefined;
}

/** Copies a remembered pregame colour onto the entering permanent; true when one was applied. */
export function applyRememberedCommanderPregameColor(state: any, playerId: string, permanent: any): boolean {
  const color = getRememberedCommanderPregameColor(state, playerId, permanent);
  if (!color) return false;
  permanent.chosenColor = color;
  if (permanent.card && typeof permanent.card === 'object') permanent.card.chosenColor = color;
  return true;
}

export function rememberCommanderPregameColor(state: any, permanent: any, color: string): void {
  const playerId = String(permanent?.controller || '');
  if (!state || !playerId || !color || !hasCommanderPregameColorChoice(permanent?.card)) return;
  if (!isPlayersCommander(state, playerId, permanent)) return;
  state.commanderPregameColors = state.commanderPregameColors || {};
  state.commanderPregameColors[playerId] = state.commanderPregameColors[playerId] || {};
  state.commanderPregameColors[playerId][memoryKey(permanent)] = String(color).toLowerCase();
}
