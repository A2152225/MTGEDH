from pathlib import Path
handler = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandler.ts")
text = handler.read_text(encoding="utf-8")

# Extract the two alone functions
a_start = text.find("/**\n * Check triggers that fire when a creature attacks alone.")
# maybe different comment format
if a_start < 0:
  a_start = text.find("export function checkAttacksAloneTriggers(")
  # include preceding comment
  comment = text.rfind("/**", 0, a_start)
  if comment >= 0:
    a_start = comment

b_end = text.find("export function checkCombatDamageToPlayerTriggers(", a_start)
alone_fns = text[a_start:b_end]
print("extracted chars", len(alone_fns))
print(alone_fns[:120])
print("...")
print(alone_fns[-80:])

# Determine imports needed by reading top of triggersHandler - for a focused module we'll import what we need.
# Read how TriggerEvent etc are imported in triggersHandler
head = text.split("export function checkAttacksAloneTriggers")[0]
# Keep original file without alone fns
text_wo = text[:a_start] + text[b_end:]
# Add re-exports near other exports if any, or at end of imports section - simplest: append re-export at bottom of imports area after reading
# Find a good place - after the last import
import_end = 0
for i, line in enumerate(text_wo.splitlines()):
  if line.startswith("import "):
    import_end = i
lines = text_wo.splitlines()
# Insert re-export after imports block
insert_at = 0
for i, line in enumerate(lines):
  if line.startswith("import "):
    insert_at = i + 1
  elif insert_at and line.strip() and not line.startswith("import ") and not line.startswith("}") and "from " not in line:
    # end of import section possibly mid multi-line
    pass

# Simpler approach: write new module and replace alone fns with re-export statements in handler
new_mod = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandlerAttacksAlone.ts")

# Collect needed imports from handler by grepping symbols used in alone_fns
needed = {
  "GameState": False,
  "TriggerEvent": False,
  "TriggerEventData": False,
  "TriggerProcessingOptions": False,
  "TriggerResult": False,
  "findTriggeredAbilities": False,
  "buildResolutionEventDataFromGameState": False,
  "buildTriggerEventDataFromPayloads": False,
  "processTriggersAutoOracle": False,
}
for k in list(needed):
  if k in alone_fns:
    needed[k] = True
print("needed", needed)

# Parse imports from handler
import_lines = []
for line in text.splitlines():
  if line.startswith("import ") or (import_lines and not line.startswith("export ") and ("from " in line or line.strip().startswith("}") or line.strip().startswith("{") or line.strip().startswith("'") or line.strip().endswith(",") or line.strip() == "))" or "from '" in line)):
    import_lines.append(line)
  elif import_lines and line.startswith("import "):
    import_lines.append(line)

# Manual imports for the new module based on usage
mod = '''/**
 * Attacks-alone / attacks-a-player-alone trigger checkers (CR 506.5 / 506.6).
 * Extracted from triggersHandler.ts to keep that file under the size budget.
 */

import type { GameState } from "../../../shared/src";
import { TriggerEvent, type TriggerEventData } from "../triggeredAbilitiesTypes";
import { findTriggeredAbilities } from "../triggeredAbilities";
import {
  buildResolutionEventDataFromGameState,
  buildTriggerEventDataFromPayloads,
} from "../triggeredAbilitiesEventData";
import { processTriggersAutoOracle } from "./triggersHandlerProcessAutoOracle";
import type { TriggerProcessingOptions, TriggerResult } from "./triggersHandlerTypes";

'''

# The imports above are guesses - need to verify actual paths from triggersHandler
print("---HANDLER IMPORTS (first 80 lines)---")
print("\n".join(text.splitlines()[:80]))
