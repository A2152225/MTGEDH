// server/src/state/modules/turn-handlers/turnStepMain1.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: the MAIN1 step-entry body from nextStep() — Paradigm
// exile copies, Saga lore, attraction visit, rad counters, precombat
// main triggers.
// Public entry symbols: runTurnStepMain1.
// nextStep remains the dispatcher. Leaf must not import turn.ts or
// turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { uid } from "../../utils.js";
import { getPrecombatMainTriggers } from "../triggered-abilities.js";
import { processSagaLoreCountersAtPrecombatMain } from "../triggerSagaLoreUtils.js";
import { processRadCountersAtPrecombatMain } from "../triggers/rad-counters.js";
import { processAttractionVisitRollAtPrecombatMain } from "../triggers/attraction-visit.js";
import { persistTurnStepTriggeredAbility } from "./turnStepTriggerPersist.js";
import { debug } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Precombat main step-entry actions from nextStep() (Rule 505.4).
 * Parent keeps the else-if dispatcher and supplies pushTriggersToStack.
 */
export function runTurnStepMain1(
  ctx: GameContext,
  turnPlayer: string,
  usePersistedTurnStepTriggers: boolean,
  pushTriggersToStack: (triggers: any[], triggerType: string, idPrefix: string) => void,
): void {
          const playerZone = (ctx as any).state?.zones?.[turnPlayer];
          if (playerZone && playerZone.exile) {
            const paradigmCards = playerZone.exile.filter((c: any) =>
              c?.paradigmActive === true &&
              String(c?.paradigmController || '') === String(turnPlayer)
            );

            for (const card of paradigmCards) {
              if (!usePersistedTurnStepTriggers) {
                const paradigmTriggerId = uid('paradigm_trigger');
                const paradigmTrigger = {
                  id: paradigmTriggerId,
                  type: 'triggered_ability',
                  controller: turnPlayer,
                  source: card.id,
                  sourceName: card.name,
                  description: `You may cast a copy of ${card.name} from exile without paying its mana cost.`,
                  triggerType: 'paradigm',
                  mandatory: false,
                  paradigmCardId: card.id,
                  card,
                };

                (ctx as any).state.stack = (ctx as any).state.stack || [];
                (ctx as any).state.stack.push(paradigmTrigger);
                persistTurnStepTriggeredAbility(ctx, paradigmTrigger, 'paradigm precombat main');

                if ((ctx as any).io && (ctx as any).gameId) {
                  (ctx as any).io.to((ctx as any).gameId).emit('chat', {
                    id: `m_${Date.now()}`,
                    gameId: (ctx as any).gameId,
                    from: 'system',
                    message: `🧠 Paradigm: ${card.name} can be copied from exile.`,
                    ts: Date.now(),
                  });
                }
              } else {
                debug(2, `${ts()} [nextStep] Replay mode using persisted paradigm trigger push for ${card.name}`);
              }

              debug(2, `${ts()} [nextStep] Paradigm: Added trigger for ${card.name} to stack`);
            }
          }

          const sagaLoreResult = processSagaLoreCountersAtPrecombatMain(ctx as any, turnPlayer);
          pushTriggersToStack(
            sagaLoreResult.chapterTriggers.map((trigger) => ({
              permanentId: trigger.permanentId,
              cardName: trigger.cardName,
              controllerId: trigger.controllerId,
              description: trigger.description,
              effect: trigger.effect,
              mandatory: trigger.mandatory,
              stackItem: {
                triggerType: 'saga_chapter',
                sagaChapter: trigger.sagaChapter,
                sagaSacrificeAfterResolve: trigger.sagaSacrificeAfterResolve,
              },
            })),
            'saga_chapter',
            'saga_chapter',
          );

          if (sagaLoreResult.chapterTriggers.length === 0) {
            processAttractionVisitRollAtPrecombatMain(ctx as any, turnPlayer);
          } else {
            (ctx as any).state._pendingAttractionVisitRollPlayer = turnPlayer;
          }

          const precombatMainTriggers = getPrecombatMainTriggers(ctx, turnPlayer);
          pushTriggersToStack(precombatMainTriggers, 'precombat_main', 'main');

          processRadCountersAtPrecombatMain(ctx as any, turnPlayer);

          debug(2, `${ts()} [nextStep] Checking precombat main triggers for ${turnPlayer}, found ${precombatMainTriggers.length} trigger(s), ${sagaLoreResult.loreCountersAdded} saga lore counter(s) added`);
}
