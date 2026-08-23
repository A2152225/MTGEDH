from pathlib import Path

path = Path(r"D:\Git\MTGEDH\server\src\state\modules\inferTriggeredAbilityTargetMetadata.ts")
text = path.read_bytes().decode("utf-8")

# 1) Add compound target type checks BEFORE simple includes('target artifact')
old_types = """    if (lower.includes('target creature or planeswalker')) targetType = 'creature or planeswalker';
    else if (/\\btarget aura or equipment\\b/.test(lower) || /\\btarget equipment or aura\\b/.test(lower)) targetType = 'aura or equipment';
    else if (lower.includes('target artifact or enchantment')) targetType = 'artifact or enchantment';
    else if (lower.includes('target noncreature artifact')) targetType = 'noncreature artifact';
    else if (/target\\s+non-[a-z0-9'-]+(?:\\s+[a-z0-9'-]+)*\\s+creature\\b/.test(lower)) targetType = 'creature';
    // "target attacking creature" / "target blocking creature" / "target attacking or blocking creature"
    // (and optional subtype words) do not contain the contiguous substring "target creature".
    else if (/\\btarget\\s+(?:attacking(?:\\s+or\\s+blocking)?|blocking)\\s+(?:[a-z0-9'-]+\\s+)*creature\\b/.test(lower)) targetType = 'creature';
    else if (lower.includes('target creature')) targetType = 'creature';
    else if (lower.includes('target player') || lower.includes('target opponent')) targetType = 'player';
    else if (lower.includes('target permanent')) targetType = 'permanent';
    else if (lower.includes('target land')) targetType = 'land';
    else if (lower.includes('target artifact')) targetType = 'artifact';
    else if (lower.includes('target enchantment')) targetType = 'enchantment';
    else if (lower.includes('target planeswalker')) targetType = 'planeswalker';
    else if (lower.includes('target battle')) targetType = 'battle';
    else if (lower.includes('target nonland')) targetType = 'nonland permanent';
    else if (lower.includes('target noncreature')) targetType = 'noncreature permanent';
    else if (lower.includes('any target')) targetType = 'any';
  }"""

new_types = """    if (lower.includes('target creature or planeswalker')) targetType = 'creature or planeswalker';
    else if (/\\btarget aura or equipment\\b/.test(lower) || /\\btarget equipment or aura\\b/.test(lower)) targetType = 'aura or equipment';
    else if (lower.includes('target artifact or enchantment')) targetType = 'artifact or enchantment';
    else if (/target artifact, enchantment, or land\\b/.test(lower) || /target artifact, land, or enchantment\\b/.test(lower) || /target enchantment, artifact, or land\\b/.test(lower)) {
      targetType = 'artifact, enchantment, or land';
    }
    else if (lower.includes('target noncreature artifact')) targetType = 'noncreature artifact';
    else if (/target\\s+non-[a-z0-9'-]+(?:\\s+[a-z0-9'-]+)*\\s+creature\\b/.test(lower)) targetType = 'creature';
    // "target attacking creature" / "target blocking creature" / "target attacking or blocking creature"
    // (and optional subtype words) do not contain the contiguous substring "target creature".
    else if (/\\btarget\\s+(?:attacking(?:\\s+or\\s+blocking)?|blocking)\\s+(?:[a-z0-9'-]+\\s+)*creature\\b/.test(lower)) targetType = 'creature';
    else if (lower.includes('target creature')) targetType = 'creature';
    else if (lower.includes('target player') || lower.includes('target opponent')) targetType = 'player';
    else if (lower.includes('target permanent')) targetType = 'permanent';
    else if (lower.includes('target land')) targetType = 'land';
    else if (lower.includes('target artifact')) targetType = 'artifact';
    else if (lower.includes('target enchantment')) targetType = 'enchantment';
    else if (lower.includes('target planeswalker')) targetType = 'planeswalker';
    else if (lower.includes('target battle')) targetType = 'battle';
    else if (lower.includes('target nonland')) targetType = 'nonland permanent';
    else if (lower.includes('target noncreature')) targetType = 'noncreature permanent';
    else if (lower.includes('any target')) targetType = 'any';

    // Non-GY "up to N target" / "N target" counts (GY branch already sets these when applicable).
    if (minTargets === undefined && maxTargets === undefined) {
      if (lower.includes('any number of target')) {
        minTargets = 0;
        maxTargets = 99;
      } else if (/\\bup to one target\\b/.test(lower)) {
        minTargets = 0;
        maxTargets = 1;
      } else if (/\\bup to two target\\b/.test(lower)) {
        minTargets = 0;
        maxTargets = 2;
      } else if (/\\bup to three target\\b/.test(lower)) {
        minTargets = 0;
        maxTargets = 3;
      } else if (/\\bup to four target\\b/.test(lower)) {
        minTargets = 0;
        maxTargets = 4;
      } else if (/\\b(?:exile|destroy|tap|untap|return)?\\s*two target\\b/.test(lower) || /\\btwo target\\b/.test(lower)) {
        minTargets = 2;
        maxTargets = 2;
      }
    }
  }"""

if old_types not in text:
    raise SystemExit("type block not found")
text = text.replace(old_types, new_types, 1)

path.write_text(text, encoding="utf-8")
print("patched inferrer compound + up-to")
