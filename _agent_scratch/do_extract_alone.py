from pathlib import Path

handler = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandler.ts")
text = handler.read_text(encoding="utf-8")

a_start = text.find("/**\n * Check triggers that fire when a creature attacks alone.")
if a_start < 0:
  raise SystemExit("start missing")
b_end = text.find("/**\n * Check triggers that care about combat damage to players", a_start)
if b_end < 0:
  # try without exact comment
  b_end = text.find("export function checkCombatDamageToPlayerTriggers(", a_start)
  # include preceding doc comment
  doc = text.rfind("/**", a_start, b_end)
  if doc > a_start:
    b_end = doc

alone_fns = text[a_start:b_end].rstrip() + "\n"
print("alone starts with", alone_fns[:80])
print("alone ends with", alone_fns[-100:])

mod = '''/**
 * Attacks alone / attacks a player alone trigger checkers (CR 506.5 / 506.6).
 * Extracted from triggersHandler.ts to keep that file under the size budget.
 */

import type { GameState } from "../../../shared/src";
import {
  TriggerEvent,
  buildTriggerEventDataFromPayloads,
  buildResolutionEventDataFromGameState,
  type TriggerEventData,
} from "../triggeredAbilities";
import type {
  TriggerResult,
  TriggerProcessingOptions,
} from "./triggersHandler-handlers/triggersHandlerTypes.js";
import { findTriggeredAbilities } from "./triggersHandler-handlers/triggersHandlerFindTriggeredAbilities.js";
import { processTriggersAutoOracle } from "./triggersHandler.js";

''' + alone_fns

mod_path = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandlerAttacksAlone.ts")
mod_path.write_text(mod, encoding="utf-8", newline="\n")

# Remove from handler and add re-export
text2 = text[:a_start] + (
  "export {\n"
  "  checkAttacksAloneTriggers,\n"
  "  checkAttacksAPlayerAloneTriggers,\n"
  "} from './triggersHandlerAttacksAlone.js';\n\n"
) + text[b_end:]
handler.write_text(text2, encoding="utf-8", newline="\n")
print("handler size", handler.stat().st_size)
print("mod size", mod_path.stat().st_size)
