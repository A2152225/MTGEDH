// UI42: single-select mode_selection steps reuse CastingModeModal. Activated abilities whose mode is
// chosen at resolution (Effect Program prompts) are not mid-cast, so don't say "before selecting targets".
export function getSingleModePromptDescription(step: Record<string, unknown>): string {
  const family = String(step.effectProgramFamily || '');
  if (step.effectProgramPrompt === true || family === 'activated_ability_resolution' || family === 'trigger_resolution') {
    return 'Choose a mode.';
  }
  return 'Choose a mode before selecting targets.';
}