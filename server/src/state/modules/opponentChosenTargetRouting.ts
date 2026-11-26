/**
 * state/modules/opponentChosenTargetRouting.ts
 *
 * "target ... of an opponent's choice" for prompts the rules engine queues itself (triggered
 * abilities such as Mausoleum Turnkey and Karplusan Minotaur), plus the chooser-facing wording the
 * socket layer (socket/opponentChosenTargets.ts) shares. The ability stays its controller's; an
 * opponent picks the object.
 *
 * - One eligible opponent: the prompt goes straight to that opponent.
 * - Several opponents: the controller first answers a "which opponent chooses" TARGET_SELECTION
 *   step (opponentTargetChooserSelection); the socket layer then queues the deferred prompt.
 *
 * Routed prompts carry opponentChosenTargets / targetsChosenFor (the controller's id), so the
 * response handlers keep treating the controller as the ability's controller.
 */
import { ResolutionStepType } from '../resolution/index.js';

const OPPONENT_CHOICE_SOURCE = String.raw`\b(?:of an opponent['\u2019]s choice|chosen by an opponent|an opponent chooses)\b`;
const CHOOSER_CONTROLS_RE = /\bof an opponent['\u2019]s choice they control\b/i;

/** How many "target" words the text has, and how many of them an opponent chooses. */
export function countOpponentChosenTargetSlots(text: unknown): { choices: number; targets: number } {
  const body = String(text || '').replace(/\([^)]*\)/g, ' ');
  return {
    choices: body.match(new RegExp(OPPONENT_CHOICE_SOURCE, 'gi'))?.length || 0,
    targets: body.match(/\btarget\b/gi)?.length || 0,
  };
}

/** "target creature of an opponent's choice they control": the chooser must pick their own object. */
export function chooserMustControlTargets(text: unknown): boolean {
  return CHOOSER_CONTROLS_RE.test(String(text || ''));
}

/**
 * Prompt text is written for the ability's controller. Shown to the opponent who chooses, "you"
 * would mean the wrong player, so name the controller instead.
 */
export function rewordTargetTextForChooser(text: unknown, controllerName: string): string {
  return String(text || '')
    .replace(/\byou (?:don['\u2019]t|do not) control\b/gi, `${controllerName} doesn't control`)
    .replace(/\byou control\b/gi, `${controllerName} controls`)
    .replace(/\byour graveyard\b/gi, `${controllerName}'s graveyard`);
}

/** The step as the choosing opponent sees it. */
export function chooserFacingTargetSpec(spec: any, chooserId: string, controllerName: string): any {
  const validTargets = Array.isArray(spec?.validTargets) ? spec.validTargets : [];
  const restricted = spec?.restrictToChooserControlled === true
    ? validTargets.filter((target: any) => String(target?.controller || '') === chooserId)
    : validTargets;
  return {
    ...spec,
    playerId: chooserId,
    ...(Array.isArray(spec?.validTargets) ? { validTargets: restricted } : {}),
    description: `${rewordTargetTextForChooser(spec?.description || 'Choose targets', controllerName)} (you choose for ${controllerName})`,
    ...(spec?.targetDescription ? { targetDescription: rewordTargetTextForChooser(spec.targetDescription, controllerName) } : {}),
  };
}

function statePlayerName(state: any, playerId: string): string {
  const players: any[] = Array.isArray(state?.players) ? state.players : [];
  const player = players.find((entry: any) => entry && String(entry.id) === playerId);
  return String(player?.name || playerId);
}

function choosingOpponents(state: any, controllerId: string): string[] {
  const players: any[] = Array.isArray(state?.players) ? state.players : [];
  return players
    .filter((player: any) => player && String(player.id || '') && String(player.id) !== controllerId)
    .filter((player: any) => !player.hasLost && !player.eliminated && !player.conceded && !player.spectator && !player.isSpectator)
    .map((player: any) => String(player.id));
}

/**
 * Route a triggered ability's target prompt to the opponent who chooses it. Returns the spec
 * unchanged unless every target in `effectText` is chosen by an opponent.
 */
export function routeOpponentChosenTriggerTargetSpec(state: any, controllerId: string, effectText: unknown, spec: any): any {
  if (!spec || spec.opponentChosenTargets === true || spec.opponentTargetChooserSelection === true || spec.targetsChosenFor) return spec;
  const { choices, targets } = countOpponentChosenTargetSlots(effectText);
  if (choices === 0 || choices < targets) return spec;
  const controller = String(controllerId || spec.playerId || '');
  const opponents = choosingOpponents(state, controller);
  if (!controller || opponents.length === 0) return spec;

  const tagged = {
    ...spec,
    opponentChosenTargets: true,
    targetsChosenFor: controller,
    restrictToChooserControlled: chooserMustControlTargets(effectText),
  };
  const controllerName = statePlayerName(state, controller);
  if (opponents.length === 1) return chooserFacingTargetSpec(tagged, opponents[0], controllerName);

  return {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: controller,
    description: `Choose the opponent who chooses targets for ${String(spec.sourceName || 'this')}`,
    mandatory: true,
    sourceId: spec.sourceId,
    sourceName: spec.sourceName,
    validTargets: opponents.map((id) => ({
      id,
      label: statePlayerName(state, id),
      description: 'player',
      type: 'player',
      isOpponent: true,
    })),
    targetTypes: ['player'],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: 'an opponent',
    opponentTargetChooserSelection: true,
    opponentChooserGroup: String(spec.sourceId || ''),
    deferredOpponentTargetSteps: [tagged],
  };
}

/**
 * Prompt config queued while a triggered ability resolves: route its target prompt when the
 * trigger's own text gives the choice to an opponent.
 */
export function routeTriggerPromptConfigToChooser(ctx: any, config: any): any {
  const type = String(config?.type || '');
  const isTargetPrompt = type === ResolutionStepType.TARGET_SELECTION && config?.targetedTriggeredAbility === true;
  const isGraveyardPrompt = type === ResolutionStepType.GRAVEYARD_SELECTION;
  if (!isTargetPrompt && !isGraveyardPrompt) return config;
  const stack: any[] = Array.isArray(ctx?.state?.stack) ? ctx.state.stack : [];
  const sourceId = String(config?.sourceId || config?.effectId || '');
  const item = config?.triggerItem || stack.find((entry: any) => entry && String(entry.id || '') === sourceId);
  if (!item || String(item.type || '') !== 'triggered_ability') return config;
  if (isGraveyardPrompt && item.requiresTarget !== true) return config;
  const controllerId = String(config?.targetedTriggeredAbilityController || item.controller || config?.playerId || '');
  return routeOpponentChosenTriggerTargetSpec(ctx?.state, controllerId, item.effect || item.description || '', config);
}
