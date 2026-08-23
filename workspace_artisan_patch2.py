from pathlib import Path

path = Path(r"D:\Git\MTGEDH\server\src\socket\game-actions.ts")
text = path.read_bytes().decode("cp1252")

old_import = (
    'import { getOpponentSpellCastTriggers, type OpponentSpellCastTriggerType, '
    'inferGenericTriggeredAbilityTargetMetadata } from "../state/modules/triggers/index.js";'
)
new_import = (
    'import { getOpponentSpellCastTriggers, type OpponentSpellCastTriggerType } '
    'from "../state/modules/triggers/index.js";'
)
if old_import not in text:
    raise SystemExit("import not found")
text = text.replace(old_import, new_import, 1)

marker = "const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(description);"
start = text.find("          const triggerLower = onCastTrigger.description.toLowerCase();")
# find the specific occurrence near the on-cast path
start = text.find("          const triggerLower = onCastTrigger.description.toLowerCase();\r\n          const description = onCastTrigger.description;\r\n          const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(description);")
if start < 0:
    raise SystemExit("start not found")
end_marker = "            } else if (triggerLower.includes('gain control of target opponent')) {\r\n              triggerPayload.action = 'gain_control_target_opponent';\r\n              triggerPayload.targetType = 'opponent';\r\n            }\r\n          }"
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit("end not found")
end = end + len(end_marker)

new_block = '''          const triggerLower = onCastTrigger.description.toLowerCase();
          const description = onCastTrigger.description;
          // Use the rich inferrer so GY return patterns (Artisan of Kozilek, etc.)
          // get targetZone/targetDestination/filter metadata, not just battlefield "creature".
          const targetMetadata = inferTriggeredAbilityTargetMetadata(description, {
            gameState: game.state,
            controllerId: String(playerId),
            sourceName: String(cardInHand?.name || ''),
          });
          const triggerId = uid('trigger');
          const isOptionalMay = /\\byou may\\b/i.test(description);

          const triggerPayload: any = {
            id: triggerId,
            type: 'triggered_ability',
            controller: playerId,
            source: cardId,
            sourceName: cardInHand.name,
            description,
            triggerType: 'triggered_ability',
            effect: onCastTrigger.effect,
            mandatory: !isOptionalMay,
            card: {
              ...cardInHand,
              owner: cardInHand.owner || playerId,
            },
          };

          // Overwrite the description for Emrakul Extra Turn to match regex anchor
          if (triggerLower.includes('extra turn after this one')) {
            triggerPayload.description = "Take an extra turn after this one.";
            triggerPayload.effect = "Take an extra turn after this one.";
          }

          // Attach inferred target metadata if it requires targeting / GY selection
          if (
            targetMetadata.requiresTarget
            || String(targetMetadata.targetZone || '').length > 0
            || String(targetMetadata.targetAction || '').length > 0
          ) {
            if (targetMetadata.requiresTarget) {
              triggerPayload.requiresTarget = true;
              triggerPayload.needsTargetSelection = true;
            }
            if (targetMetadata.targetType) triggerPayload.targetType = targetMetadata.targetType;
            if (targetMetadata.targetConstraint) triggerPayload.targetConstraint = targetMetadata.targetConstraint;
            if (targetMetadata.targetZone) triggerPayload.targetZone = targetMetadata.targetZone;
            if (targetMetadata.targetDestination) triggerPayload.targetDestination = targetMetadata.targetDestination;
            if (targetMetadata.targetGraveyardScope) triggerPayload.targetGraveyardScope = targetMetadata.targetGraveyardScope;
            if (targetMetadata.destinationUsesSelectedCardOwner === true) {
              triggerPayload.destinationUsesSelectedCardOwner = true;
            }
            if (targetMetadata.battlefieldControllerMode) {
              triggerPayload.battlefieldControllerMode = targetMetadata.battlefieldControllerMode;
            }
            if (targetMetadata.battlefieldCounters) {
              triggerPayload.battlefieldCounters = targetMetadata.battlefieldCounters;
            }
            if (targetMetadata.targetAction) triggerPayload.targetAction = targetMetadata.targetAction;
            if (Array.isArray(targetMetadata.targetFilterTypes)) {
              triggerPayload.targetFilterTypes = targetMetadata.targetFilterTypes;
            }
            if (Array.isArray(targetMetadata.targetFilterRequiredTypeWords)) {
              triggerPayload.targetFilterRequiredTypeWords = targetMetadata.targetFilterRequiredTypeWords;
            }
            if (Array.isArray(targetMetadata.targetFilterExcludeTypes)) {
              triggerPayload.targetFilterExcludeTypes = targetMetadata.targetFilterExcludeTypes;
            }
            if (targetMetadata.targetFilterPermanentOnly === true) {
              triggerPayload.targetFilterPermanentOnly = true;
            }
            if (typeof targetMetadata.targetFilterExactManaValue === 'number') {
              triggerPayload.targetFilterExactManaValue = targetMetadata.targetFilterExactManaValue;
            }
            if (typeof targetMetadata.targetFilterMinManaValue === 'number') {
              triggerPayload.targetFilterMinManaValue = targetMetadata.targetFilterMinManaValue;
            }
            if (typeof targetMetadata.targetFilterMaxManaValue === 'number') {
              triggerPayload.targetFilterMaxManaValue = targetMetadata.targetFilterMaxManaValue;
            }
            if (typeof targetMetadata.targetTotalPowerLimit === 'number') {
              triggerPayload.targetTotalPowerLimit = targetMetadata.targetTotalPowerLimit;
            }
            if (targetMetadata.targetCastWithoutPayingManaCost === true) {
              triggerPayload.targetCastWithoutPayingManaCost = true;
            }
            if (targetMetadata.targetCastIsOptional === true) {
              triggerPayload.targetCastIsOptional = true;
            }
            triggerPayload.minTargets = typeof targetMetadata.minTargets === 'number' ? targetMetadata.minTargets : 1;
            triggerPayload.maxTargets = typeof targetMetadata.maxTargets === 'number' ? targetMetadata.maxTargets : 1;

            // Map the actions to proper socket selection actions
            if (triggerLower.includes('destroy target permanent')) {
              triggerPayload.action = 'destroy_target_permanent';
            } else if (triggerLower.includes('exile two target permanents')) {
              triggerPayload.action = 'exile_target_permanent';
              triggerPayload.minTargets = 0; // up to two targeting can be blank if no targets exist
              triggerPayload.maxTargets = 2;
            } else if (triggerLower.includes('gain control of target opponent')) {
              triggerPayload.action = 'gain_control_target_opponent';
              triggerPayload.targetType = 'opponent';
            }
          }'''.replace('\n', '\r\n')

text = text[:start] + new_block + text[end:]

if "inferGenericTriggeredAbilityTargetMetadata" in text:
    raise SystemExit("generic inferrer still referenced")
if "inferTriggeredAbilityTargetMetadata(description, {" not in text:
    raise SystemExit("rich inferrer call missing")

path.write_bytes(text.encode("cp1252"))
print("patched ok, size", path.stat().st_size)
