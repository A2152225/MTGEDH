from pathlib import Path

# --- oracleIRParserChooseMode.ts ---
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserChooseMode.ts')
text = p.read_text(encoding='utf-8')

old_limits_type = """function resolveChooseModeLimits(headerText: string): {
  readonly minModes: number;
  readonly maxModes: number;
  readonly canRepeatModes: boolean;
  readonly rememberChosenModes: boolean;
  readonly teamworkChooseBoth?: boolean;
  readonly optional?: boolean;
  readonly distinctPlayerTargets?: boolean;
} {"""
new_limits_type = """function resolveChooseModeLimits(headerText: string): {
  readonly minModes: number;
  readonly maxModes: number;
  readonly canRepeatModes: boolean;
  readonly rememberChosenModes: boolean;
  readonly teamworkChooseBoth?: boolean;
  readonly kickerChooseBoth?: boolean;
  readonly optional?: boolean;
  readonly distinctPlayerTargets?: boolean;
} {"""
if old_limits_type not in text:
    raise SystemExit('limits type missing')
text = text.replace(old_limits_type, new_limits_type, 1)

old_detect = """  const teamworkChooseBoth = /if this spell was cast using teamwork,\\s*choose both instead/i.test(headerText);
  const optional = /^you\\s+may\\s+choose\\b/i.test(normalizedHeaderText);
  const distinctPlayerTargets = /each mode must target a different player/i.test(headerText);
  const chooseHeaderText = normalizedHeaderText.replace(/^you\\s+may\\s+/i, '');
  const chooseBothInstead = !teamworkChooseBoth && /(?:you may\\s+)?choose both instead/i.test(headerText);
  const chooseAnyNumberInstead = /(?:you may\\s+)?choose any number instead/i.test(headerText);"""

new_detect = """  const teamworkChooseBoth = /if this spell was cast using teamwork,\\s*choose both instead/i.test(headerText);
  const kickerChooseBoth = /if it was kicked,\\s*choose both instead/i.test(headerText);
  const optional = /^you\\s+may\\s+choose\\b/i.test(normalizedHeaderText);
  const distinctPlayerTargets = /each mode must target a different player/i.test(headerText);
  const chooseHeaderText = normalizedHeaderText.replace(/^you\\s+may\\s+/i, '');
  const chooseBothInstead = !teamworkChooseBoth && !kickerChooseBoth && /(?:you may\\s+)?choose both instead/i.test(headerText);
  const chooseAnyNumberInstead = /(?:you may\\s+)?choose any number instead/i.test(headerText);"""

if old_detect not in text:
    raise SystemExit('detect block missing')
text = text.replace(old_detect, new_detect, 1)

old_branch = """  } else if (oneOrBothMatch || chooseBothInstead) {
    minModes = 1;
    maxModes = 2;
  } else if (oneOrMoreMatch || chooseAnyNumberInstead) {"""
new_branch = """  } else if (oneOrBothMatch || chooseBothInstead) {
    minModes = 1;
    maxModes = 2;
  } else if (kickerChooseBoth) {
    // Unkicked: exactly one. Kicked: executor forces both via kickerChooseBoth + wasKicked.
    minModes = 1;
    maxModes = 1;
  } else if (oneOrMoreMatch || chooseAnyNumberInstead) {"""
if old_branch not in text:
    raise SystemExit('branch missing')
text = text.replace(old_branch, new_branch, 1)

old_return = """  return {
    minModes,
    maxModes,
    canRepeatModes,
    rememberChosenModes,
    ...(teamworkChooseBoth ? { teamworkChooseBoth: true } : {}),
    ...(optional ? { optional: true } : {}),
    ...(distinctPlayerTargets ? { distinctPlayerTargets: true } : {}),
  };
}"""
new_return = """  return {
    minModes,
    maxModes,
    canRepeatModes,
    rememberChosenModes,
    ...(teamworkChooseBoth ? { teamworkChooseBoth: true } : {}),
    ...(kickerChooseBoth ? { kickerChooseBoth: true } : {}),
    ...(optional ? { optional: true } : {}),
    ...(distinctPlayerTargets ? { distinctPlayerTargets: true } : {}),
  };
}"""
if old_return not in text:
    raise SystemExit('return missing')
text = text.replace(old_return, new_return, 1)

# Stamp kickerChooseBoth in tryParseChooseModeBlock / HeaderOnly destructure+spread
# There are multiple similar blocks - replace all safely
text2 = text
# destructuring additions
old_d1 = """  const {
    minModes,
    maxModes,
    canRepeatModes,
    rememberChosenModes,
    teamworkChooseBoth,
    optional,
    distinctPlayerTargets,
  } = resolveChooseModeLimits(headerText);"""
new_d1 = """  const {
    minModes,
    maxModes,
    canRepeatModes,
    rememberChosenModes,
    teamworkChooseBoth,
    kickerChooseBoth,
    optional,
    distinctPlayerTargets,
  } = resolveChooseModeLimits(headerText);"""
if old_d1 not in text2:
    raise SystemExit('destructure1 missing')
text2 = text2.replace(old_d1, new_d1, 1)

old_d2 = """  const {
    minModes,
    maxModes,
    canRepeatModes,
    rememberChosenModes,
    teamworkChooseBoth,
    optional,
    distinctPlayerTargets,
  } = resolveChooseModeLimits(normalized);"""
new_d2 = """  const {
    minModes,
    maxModes,
    canRepeatModes,
    rememberChosenModes,
    teamworkChooseBoth,
    kickerChooseBoth,
    optional,
    distinctPlayerTargets,
  } = resolveChooseModeLimits(normalized);"""
if old_d2 not in text2:
    raise SystemExit('destructure2 missing')
text2 = text2.replace(old_d2, new_d2, 1)

old_spread = """    ...(teamworkChooseBoth ? { teamworkChooseBoth: true } : {}),
    ...(optional ? { optional: true } : {}),
    ...(distinctPlayerTargets ? { distinctPlayerTargets: true } : {}),"""
new_spread = """    ...(teamworkChooseBoth ? { teamworkChooseBoth: true } : {}),
    ...(kickerChooseBoth ? { kickerChooseBoth: true } : {}),
    ...(optional ? { optional: true } : {}),
    ...(distinctPlayerTargets ? { distinctPlayerTargets: true } : {}),"""
count = text2.count(old_spread)
if count < 2:
    raise SystemExit(f'spread count {count}')
text2 = text2.replace(old_spread, new_spread)

p.write_text(text2, encoding='utf-8')
print('chooseMode parser ok, spreads', count)
