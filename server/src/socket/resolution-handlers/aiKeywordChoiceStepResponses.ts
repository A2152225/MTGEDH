/**
 * socket/resolution-handlers/aiKeywordChoiceStepResponses.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleAIResolutionStep).
 * Cluster moved: the contiguous run of AI auto-answers for keyword-ability prompts -
 * FABRICATE_CHOICE, TRIBUTE_CHOICE, EXPLOIT_CHOICE, BACKUP_CHOICE, MENTOR_TARGET, ENLIST_CHOICE,
 * EXTORT_PAYMENT, MODULAR_CHOICE, SOULSHIFT_TARGET and HAUNT_TARGET. Every one of them only reads
 * fields off the step and builds the ResolutionStepResponse; none touches `game`, `io` or the queue.
 * Public entry symbol: buildAiKeywordChoiceStepResponse.
 *
 * The ten `case` bodies became one dispatcher because they were contiguous in the parent switch and
 * each ended in a plain `break`, so the call site is a single fallthrough group of `case` labels
 * assigning `response = buildAiKeywordChoiceStepResponse(step);`. Heuristics and debug strings are
 * unchanged. Returns null only for a step type outside this group.
 *
 * Pure leaf: imported directly by resolution.ts (no io/game, so no cycle). Must not import
 * resolution.ts.
 */

import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";

/** AI answer for the keyword-ability prompts listed in the module header. */
export function buildAiKeywordChoiceStepResponse(step: ResolutionStep): ResolutionStepResponse | null {
  switch (step.type) {
    case ResolutionStepType.FABRICATE_CHOICE: {
      // AI prefers tokens for board presence (can be blocked)
      // But counters are better for single large threat
      const fabricateStep = step as any;
      const n = fabricateStep.value || 1;

      // Simple heuristic: tokens if N >= 2, counter if N == 1
      const choice = n >= 2 ? 'tokens' : 'counters';

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [choice],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Fabricate ${n}: chose ${choice}`);
      return response;
    }

    case ResolutionStepType.TRIBUTE_CHOICE: {
      // AI (as opponent) should evaluate which is worse for them
      // Simple strategy: decline tribute to avoid buffing the creature
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: ['decline'], // Trigger the bonus effect instead of buffing
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Tribute: declined (triggers bonus effect)`);
      return response;
    }

    case ResolutionStepType.EXPLOIT_CHOICE: {
      // AI exploits the weakest creature for value
      const exploitStep = step as any;
      const creatures = exploitStep.creatures || [];

      if (creatures.length > 0) {
        // Find weakest creature
        let weakest = creatures[0];
        let weakestValue = Infinity;

        for (const creature of creatures) {
          const power = parseInt(creature.power) || 0;
          const toughness = parseInt(creature.toughness) || 0;
          const value = power + toughness;
          if (value < weakestValue) {
            weakestValue = value;
            weakest = creature;
          }
        }

        const response: ResolutionStepResponse = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [weakest.id],
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Exploit: sacrificing ${weakest.name}`);
        return response;
      }

      // No creatures to exploit
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Exploit: no creatures, skipping`);
      return response;
    }

    case ResolutionStepType.BACKUP_CHOICE: {
      // AI chooses another creature to give backup to (for shared abilities)
      const backupStep = step as any;
      const targets = backupStep.targets || [];
      const sourceId = backupStep.sourceId;

      // Prefer strongest creature that isn't the source
      const validTargets = targets.filter((t: any) => t.id !== sourceId);

      if (validTargets.length > 0) {
        let strongest = validTargets[0];
        let strongestValue = 0;

        for (const target of validTargets) {
          const power = parseInt(target.power) || 0;
          const toughness = parseInt(target.toughness) || 0;
          const value = power + toughness;
          if (value > strongestValue) {
            strongestValue = value;
            strongest = target;
          }
        }

        const response: ResolutionStepResponse = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [strongest.id],
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Backup: targeting ${strongest.name}`);
        return response;
      }

      // Target self if no other creatures
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: sourceId ? [sourceId] : [],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Backup: targeting self`);
      return response;
    }

    case ResolutionStepType.MENTOR_TARGET: {
      // AI targets the creature with highest base power that's still valid
      const mentorStep = step as any;
      const targets = mentorStep.targets || [];

      if (targets.length > 0) {
        // Target creature with lowest power (most benefit from counter)
        let best = targets[0];
        let bestValue = Infinity;

        for (const target of targets) {
          const power = parseInt(target.power) || 0;
          if (power < bestValue) {
            bestValue = power;
            best = target;
          }
        }

        const response: ResolutionStepResponse = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [best.id],
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Mentor: targeting ${best.name}`);
        return response;
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Mentor: no valid targets`);
      return response;
    }

    case ResolutionStepType.ENLIST_CHOICE: {
      // AI taps creature with highest power for enlist
      const enlistStep = step as any;
      const creatures = enlistStep.creatures || [];

      if (creatures.length > 0) {
        let strongest = creatures[0];
        let strongestPower = 0;

        for (const creature of creatures) {
          const power = parseInt(creature.power) || 0;
          if (power > strongestPower) {
            strongestPower = power;
            strongest = creature;
          }
        }

        const response: ResolutionStepResponse = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [strongest.id],
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Enlist: tapping ${strongest.name} (power ${strongestPower})`);
        return response;
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Enlist: no creatures to tap`);
      return response;
    }

    case ResolutionStepType.EXTORT_PAYMENT: {
      // AI pays for extort if they have mana (simple check)
      // In practice, this should check available mana, but conservative AI skips
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: ['skip'], // Conservative: don't pay
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Extort: skipping payment (conservative)`);
      return response;
    }

    case ResolutionStepType.MODULAR_CHOICE: {
      // AI puts counters on strongest artifact creature
      const modularStep = step as any;
      const targets = modularStep.targets || [];

      if (targets.length > 0) {
        let strongest = targets[0];
        let strongestValue = 0;

        for (const target of targets) {
          const power = parseInt(target.power) || 0;
          const toughness = parseInt(target.toughness) || 0;
          if (power + toughness > strongestValue) {
            strongestValue = power + toughness;
            strongest = target;
          }
        }

        const response: ResolutionStepResponse = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [strongest.id],
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Modular: putting counters on ${strongest.name}`);
        return response;
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Modular: no artifact creatures`);
      return response;
    }

    case ResolutionStepType.SOULSHIFT_TARGET: {
      // AI returns highest CMC spirit
      const soulshiftStep = step as any;
      const spirits = soulshiftStep.spirits || [];

      if (spirits.length > 0) {
        let best = spirits[0];
        let bestCmc = 0;

        for (const spirit of spirits) {
          const cmc = spirit.cmc || 0;
          if (cmc > bestCmc) {
            bestCmc = cmc;
            best = spirit;
          }
        }

        const response: ResolutionStepResponse = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [best.id],
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Soulshift: returning ${best.name}`);
        return response;
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Soulshift: no spirits in graveyard`);
      return response;
    }

    case ResolutionStepType.HAUNT_TARGET: {
      const hauntStep = step as any;
      const hauntTargets = hauntStep.targets || [];
      if (hauntTargets.length > 0) {
        const response: ResolutionStepResponse = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [hauntTargets[0].id],
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Haunt: targeting ${hauntTargets[0].name}`);
        return response;
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Haunt: no legal creature targets`);
      return response;
    }

    default:
      return null;
  }
}
