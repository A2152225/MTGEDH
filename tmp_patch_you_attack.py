from pathlib import Path

p = Path(r"D:\Git\MTGEDH\server\src\state\modules\triggers\combat.ts")
text = p.read_text(encoding="utf-8")
changed = []

# 1) watcher set
old_set = "  'you_attack_with_commander',"
new_set = "  'you_attack',\n  'you_attack_with_commander',"
watcher_region = text.split("ATTACK_WATCHER_TRIGGER_TYPES", 1)[1].split("])", 1)[0]
if "'you_attack'," not in watcher_region:
    if old_set not in text:
        raise SystemExit("watcher set anchor missing")
    text = text.replace(old_set, new_set, 1)
    changed.append("watcher_set")
else:
    changed.append("watcher_set_skip")

# 2) plan case
old_plan = "    case 'you_attack_with_commander':\n    case 'commander_attacks': {"
new_plan = (
    "    case 'you_attack':\n"
    "      if (sourceController !== attackingPlayer || attackingCreatures.length === 0) return { kind: 'skip' };\n"
    "      return { kind: 'once' };\n"
    "    case 'you_attack_with_commander':\n"
    "    case 'commander_attacks': {"
)
plan_region = text.split("function planAttackWatcherQueue", 1)[1].split("default:", 1)[0]
if "case 'you_attack':" not in plan_region:
    if old_plan not in text:
        raise SystemExit("plan anchor missing")
    text = text.replace(old_plan, new_plan, 1)
    changed.append("plan_case")
else:
    changed.append("plan_case_skip")

# 3) detect
anchor = (
    "  // W'Kabi / similar: \"Whenever you attack with your commander, ...\"\n"
    "  const youAttackWithCommanderMatch = oracleText.match(\n"
    "    /whenever you attack with your commander,?\\s*([^.]+)/i,\n"
    "  );"
)
insert = (
    "  // Bast / similar: \"Whenever you attack, ...\" (not \"attack with ...\")\n"
    "  const youAttackMatch = oracleText.match(\n"
    "    /whenever you attack(?!\\s+with)\\b,?\\s*([^.]+)/i,\n"
    "  );\n"
    "  if (youAttackMatch && !triggers.some((t) => t.triggerType === 'you_attack')) {\n"
    "    const effectText = timingTriggerEffect(oracleText, youAttackMatch);\n"
    "    triggers.push({\n"
    "      permanentId,\n"
    "      cardName,\n"
    "      controllerId: String(permanent?.controller || ''),\n"
    "      triggerType: 'you_attack',\n"
    "      description: effectText,\n"
    "      effect: effectText,\n"
    "      mandatory: !/\\byou may\\b/i.test(effectText),\n"
    "    });\n"
    "  }\n"
    "\n"
    + anchor
)
detect_region = text.split("function detectAttackTriggers", 1)[1].split("function getAttackTriggersForCreatures", 1)[0]
if "triggerType: 'you_attack'" not in detect_region:
    if anchor not in text:
        raise SystemExit("detect anchor missing")
    text = text.replace(anchor, insert, 1)
    changed.append("detect")
else:
    changed.append("detect_skip")

p.write_text(text, encoding="utf-8")
print("OK", ",".join(changed))
