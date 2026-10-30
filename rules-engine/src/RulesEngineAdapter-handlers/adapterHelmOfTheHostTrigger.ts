// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: resolveHelmOfTheHostTrigger.
// Public entry symbols: resolveHelmOfTheHostTrigger.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import {
  applyCopyTokenOverrides,
  parseCopyTokenOverridesFromEffect,
} from '../../../shared/src/copyTokenOverrides.js';
import { copyAsEntersCopiableChoicesFromSource } from '../../../shared/src/copyTokenUtils.js';
import { mergeOracleFieldsFromLookup } from '../../../shared/src/hydrateCardOracleText.js';
import { lookupLocalCardByNameSync } from '../../../server/src/services/localCardLookup.js';
import { resolveMultipliedTokenCount } from '../tokenCreation.js';
import type { StackObject } from '../spellCasting';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterHelmOfTheHostTriggerHost = any;

  /**
   * Resolve top object on stack
   */
export function resolveHelmOfTheHostTrigger(
    state: GameState,
    stackObject: StackObject,
    effectText: string,
    triggerMeta: StackObject['triggerMeta']
  ): { handled: boolean; state: GameState; log: string[] } {
    const normalizedEffect = String(effectText || '').toLowerCase();
    const normalizedSourceName = String(triggerMeta?.sourceName || '').toLowerCase();
    if (!normalizedEffect.includes('copy of equipped creature') || !normalizedEffect.includes("isn't legendary")) {
      return { handled: false, state, log: [] };
    }

    if (normalizedSourceName && normalizedSourceName !== 'helm of the host') {
      return { handled: false, state, log: [] };
    }

    const battlefield = [...((state.battlefield || []) as any[])];
    const sourceId = String(triggerMeta?.triggerEventDataSnapshot?.sourceId || stackObject.spellId || '').trim();
    const sourcePerm = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) as any;
    if (!sourcePerm) {
      return { handled: true, state, log: ['[oracle-ir] Helm of the Host trigger fizzles (source not found)'] };
    }

    const attachedTo = String(sourcePerm?.attachedTo || '').trim();
    if (!attachedTo) {
      return { handled: true, state, log: ['[oracle-ir] Helm of the Host trigger fizzles (not attached)'] };
    }

    const equippedCreature = battlefield.find((perm: any) => String(perm?.id || '').trim() === attachedTo) as any;
    if (!equippedCreature) {
      return { handled: true, state, log: ['[oracle-ir] Helm of the Host trigger fizzles (equipped creature missing)'] };
    }

    const originalCard = { ...(equippedCreature.card || {}) } as any;
    mergeOracleFieldsFromLookup(originalCard, (name) => {
      const record = lookupLocalCardByNameSync(name);
      if (!record) return undefined;
      return {
        oracle_text: record.oracle_text,
        type_line: record.type_line,
        mana_cost: record.mana_cost,
        power: record.power,
        toughness: record.toughness,
        loyalty: record.loyalty,
        card_faces: record.card_faces,
        layout: record.layout,
        colors: record.colors,
        color_identity: record.color_identity,
      };
    });
    const copyOverrides = parseCopyTokenOverridesFromEffect(effectText);
    const tokenCount = resolveMultipliedTokenCount(
      String(stackObject.controllerId || ''),
      battlefield,
      1,
      { tokenIsCreature: /\bcreature\b/i.test(String(originalCard.type_line || originalCard.typeLine || '')) },
    ).count;
    const tokenPermanents: any[] = [];

    for (let copyIndex = 0; copyIndex < tokenCount; copyIndex += 1) {
      const tokenId = `token-${Date.now()}-${copyIndex}-${Math.floor(Math.random() * 1000000)}`;
      const tokenCard = {
        ...originalCard,
        id: tokenId,
        isToken: true,
        isCopyOfPrintedCard: true,
      };

      const tokenPermanent = {
        id: tokenId,
        controller: stackObject.controllerId,
        owner: stackObject.controllerId,
        ownerId: stackObject.controllerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        attachedTo: undefined,
        attachments: [],
        attachedEquipment: [],
        isEquipped: false,
        modifiers: [],
        name: tokenCard.name,
        manaCost: originalCard.mana_cost ?? originalCard.manaCost,
        power: equippedCreature.power ?? originalCard.power,
        toughness: equippedCreature.toughness ?? originalCard.toughness,
        basePower: equippedCreature.basePower ?? equippedCreature.power ?? originalCard.power,
        baseToughness: equippedCreature.baseToughness ?? equippedCreature.toughness ?? originalCard.toughness,
        card: tokenCard,
        isToken: true,
        isCopyToken: true,
        copyTokenOverrides: copyOverrides,
        ...(String(equippedCreature?.id || '').trim()
          ? { copiedFromPermanentId: String(equippedCreature.id).trim() }
          : {}),
      } as any;

      applyCopyTokenOverrides(tokenCard, copyOverrides, tokenPermanent);
      tokenPermanent.oracle_text = tokenCard.oracle_text;
      tokenPermanent.type_line = tokenCard.type_line;
      tokenPermanent.cardType = tokenCard.type_line;
      // CR 707.2 — Morophon / similar as-enters choices are copiable values.
      copyAsEntersCopiableChoicesFromSource(equippedCreature, tokenPermanent);
      tokenPermanents.push(tokenPermanent);
    }

    const createdName = tokenPermanents[0]?.card?.name || equippedCreature.id;
    return {
      handled: true,
      state: {
        ...state,
        battlefield: [...battlefield, ...tokenPermanents],
      },
      log: [`[oracle-ir] Helm of the Host created ${tokenPermanents.length} token copy/copies of ${createdName}`],
    };
  }
