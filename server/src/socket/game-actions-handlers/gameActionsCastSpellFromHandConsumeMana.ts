/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand pool consumption plus Treasure/snow
 * provenance and converge bookkeeping after mana sources are tapped (CR 601.2h).
 *
 * Public entry symbols: tryConsumeCastSpellManaFromHand.
 */
import type { PaymentItem } from "../../../../shared/src/index.js";
import { deriveCavernUncounterableForCreatureCast } from "../../state/modules/chosen-creature-type.js";
import { debug } from "../../utils/debug.js";
import {
  applyManaSpendToCreatureSpellHasteManaLowerBound,
  applyManaSpendToManaProducedByPermanentLowerBound,
  consumeManaFromPool,
  consumeManaFromPoolForPurpose,
  deriveCreatureSpellHasteFromManaSpent,
  getOrInitManaPool,
  type RestrictedManaSpendPurpose,
} from "../util";
import {
  calculateCastSpellPaymentManaDelta,
  consumeExplicitSelectedCastSpellMana,
  resolveSpellPaymentPermanentId,
} from "./gameActionsCastSpellPaymentSources.js";

export type CastSpellConsumeManaFromHandArgs = {
  game: any;
  playerId: string;
  cardInHand: any;
  payment: PaymentItem[] | undefined;
  isForceAltCostPaid: boolean;
  explicitPaymentSelected: boolean;
  selectedPaymentAvailableTotals: Record<string, number>;
  totalColored: Record<string, number>;
  totalGeneric: number;
  restrictedManaPurpose: RestrictedManaSpendPurpose;
  abortCastSpellPayment: (payload: { code: string; message: string }) => void;
  castingCreatureSpell: boolean;
  poolBeforePayment: any;
  poolBeforeSpellPayment: any;
  creatureSpellHasteLowerBoundBeforePayment: any;
  creatureSpellHasteLowerBoundBeforeSpellPayment: any;
  producedNonSnowByColor: Record<string, number>;
  producedSnowByColor: Record<string, number>;
  producedTreasureByColor: Record<string, number>;
  producedNonTreasureByColor: Record<string, number>;
};

export type CastSpellConsumeManaFromHandContinue = {
  kind: "continue";
  manaConsumption: any;
  paymentManaDelta: any;
  manaSpentTotal: number;
  gainsHasteUntilEndOfTurnFromManaSpent: boolean;
  cantBeCounteredFromCavern: boolean;
  convergeValue: number;
  manaFromTreasureSpent: true | undefined;
  manaFromTreasureSpentKnown: boolean | undefined;
  snowManaSpentByColor: Record<string, number> | undefined;
  snowManaColorsSpent: string[] | undefined;
  snowManaSpentKnown: boolean | undefined;
  snowManaSpent: boolean | undefined;
  snowManaOfSpellColorsSpentKnown: boolean | undefined;
  snowManaOfSpellColorsSpent: boolean | undefined;
};

export function tryConsumeCastSpellManaFromHand(
  args: CastSpellConsumeManaFromHandArgs,
): CastSpellConsumeManaFromHandContinue | void {
  const {
    game,
    playerId,
    cardInHand,
    payment,
    isForceAltCostPaid,
    explicitPaymentSelected,
    selectedPaymentAvailableTotals,
    totalColored,
    totalGeneric,
    restrictedManaPurpose,
    abortCastSpellPayment,
    castingCreatureSpell,
    poolBeforePayment,
    poolBeforeSpellPayment,
    creatureSpellHasteLowerBoundBeforePayment,
    creatureSpellHasteLowerBoundBeforeSpellPayment,
    producedNonSnowByColor,
    producedSnowByColor,
    producedTreasureByColor,
    producedNonTreasureByColor,
  } = args;

      // Consume mana from pool to pay for the spell
      // This uses both floating mana and newly tapped mana, leaving unspent mana for subsequent spells
      const pool = getOrInitManaPool(game.state, playerId);
      const manaConsumption = isForceAltCostPaid
        ? { consumed: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } }
        : explicitPaymentSelected
          ? (() => {
              const selectedConsumption = consumeExplicitSelectedCastSpellMana(
                pool,
                selectedPaymentAvailableTotals,
                totalColored,
                totalGeneric,
                restrictedManaPurpose,
              );
              if ('error' in selectedConsumption) {
                abortCastSpellPayment({
                  code: 'INSUFFICIENT_MANA',
                  message: selectedConsumption.error,
                });
                return null as any;
              }

              return { consumed: { ...selectedConsumption.consumed } };
            })()
          : (castingCreatureSpell
            ? consumeManaFromPoolForPurpose(pool, totalColored, totalGeneric, restrictedManaPurpose, '[castSpellFromHand]')
            : consumeManaFromPool(pool, totalColored, totalGeneric, '[castSpellFromHand]'));

      if (!manaConsumption) {
        return;
      }

      const paymentManaDelta = calculateCastSpellPaymentManaDelta(
        poolBeforePayment,
        getOrInitManaPool(game.state, playerId),
      );

      if (explicitPaymentSelected) {
        applyManaSpendToCreatureSpellHasteManaLowerBound(game.state, String(playerId), (manaConsumption as any).consumed);
      }
      applyManaSpendToManaProducedByPermanentLowerBound(game.state, String(playerId), (manaConsumption as any).consumed);

      const manaSpentTotal = Object.values(manaConsumption.consumed as Record<string, number>).reduce(
        (sum: number, value) => sum + (typeof value === 'number' ? value : 0),
        0,
      );
      const spellIsCreature = String(cardInHand?.type_line || '').toLowerCase().includes('creature');
      let gainsHasteUntilEndOfTurnFromManaSpent = false;
      let cantBeCounteredFromCavern = false;
      if (spellIsCreature) {
        gainsHasteUntilEndOfTurnFromManaSpent = deriveCreatureSpellHasteFromManaSpent(game.state, String(playerId), {
          poolBeforePayment: explicitPaymentSelected ? poolBeforeSpellPayment : poolBeforePayment,
          consumed: (manaConsumption as any).consumed,
          creatureSpellHasteLowerBoundBeforePayment: explicitPaymentSelected
            ? creatureSpellHasteLowerBoundBeforeSpellPayment
            : creatureSpellHasteLowerBoundBeforePayment,
        });
        cantBeCounteredFromCavern = deriveCavernUncounterableForCreatureCast(
          game.state,
          String(playerId),
          cardInHand,
          payment,
        );
      }
      
      // Calculate converge value (number of different mana colors spent)
      // This is used by cards like Bring to Light, Radiant Flames, etc.
      const convergeValue = Object.entries(manaConsumption.consumed as Record<string, number>)
        .filter(([color, amount]) => color !== 'colorless' && Number(amount) > 0)
        .length;
      
      if (convergeValue > 0) {
        debug(2, `[castSpellFromHand] Converge: ${convergeValue} different color(s) spent for ${cardInHand.name}`);
      }

      // Intervening-if support: "if mana from a Treasure was spent to cast it".
      // Be conservative: only record positive evidence when we can directly see a Treasure used as a payment source.
      // (Do NOT set false, because floating mana in the pool may have been produced by a Treasure earlier.)
      let manaFromTreasureSpent: true | undefined;
      let manaFromTreasureSpentKnown: boolean | undefined;
      try {
        if (Array.isArray(payment) && payment.length > 0) {
          const battlefield = (game.state.battlefield || []) as any[];
          for (const pay of payment) {
            const rawPayId = String(pay?.permanentId || '');
            const resolvedPayId =
              resolveSpellPaymentPermanentId(game, playerId, rawPayId) || rawPayId;
            const perm = battlefield.find((p: any) => p?.id === resolvedPayId && p?.controller === playerId);
            const typeLine = String(perm?.card?.type_line || '').toLowerCase();
            if (/\btreasure\b/.test(typeLine)) {
              manaFromTreasureSpent = true;
              break;
            }
          }
        }
      } catch {
        // best-effort only
      }

      // Derive replay-stable known/boolean for Treasure spend when possible.
      // - Deterministic true: treasure mana was required based on consumption and non-treasure availability.
      // - Deterministic false: all spent mana came from non-treasure production this cast, with no pre-existing pool used.
      try {
        const consumed = (manaConsumption as any)?.consumed;
        if (consumed && typeof consumed === 'object') {
          const keys: Array<'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless'> = ['white', 'blue', 'black', 'red', 'green', 'colorless'];

          if (manaSpentTotal === 0) {
            manaFromTreasureSpentKnown = true;
          } else {
            let forcedTrue = false;
            let sawInconsistent = false;

            for (const k of keys) {
              const used = Number((consumed as any)[k] || 0);
              if (used <= 0) continue;

              const pre = Number((poolBeforePayment as any)?.[k] || 0);
              const nonTreasureNew = Number((producedNonTreasureByColor as any)?.[k] || 0);
              const treasureNew = Number((producedTreasureByColor as any)?.[k] || 0);
              const requiredTreasure = Math.max(0, used - pre - nonTreasureNew);
              if (requiredTreasure > 0) {
                if (treasureNew > 0) {
                  forcedTrue = true;
                  break;
                }
                sawInconsistent = true;
              }
            }

            if (forcedTrue) {
              manaFromTreasureSpentKnown = true;
              manaFromTreasureSpent = true;
            } else if (!sawInconsistent) {
              let sawSpend = false;
              let canProveNoTreasure = true;
              for (const k of keys) {
                const used = Number((consumed as any)[k] || 0);
                if (used <= 0) continue;
                sawSpend = true;

                const pre = Number((poolBeforePayment as any)?.[k] || 0);
                if (pre > 0) {
                  canProveNoTreasure = false;
                  break;
                }
                const treasureNew = Number((producedTreasureByColor as any)?.[k] || 0);
                if (treasureNew > 0) {
                  canProveNoTreasure = false;
                  break;
                }
                const nonTreasureNew = Number((producedNonTreasureByColor as any)?.[k] || 0);
                if (nonTreasureNew < used) {
                  canProveNoTreasure = false;
                  break;
                }
              }

              if (!sawSpend) {
                manaFromTreasureSpentKnown = true;
              } else if (canProveNoTreasure) {
                manaFromTreasureSpentKnown = true;
              }
            }
          }
        }
      } catch {
        // best-effort only
      }

      // Intervening-if support: snow mana spent.
      // We can only safely assert snow mana was spent when it was *forced* based on:
      // - deterministic consumption amounts, and
      // - non-snow mana availability (existing pool + non-snow produced this cast).
      // This yields a replay-stable lower bound that never creates false negatives.
      let snowManaSpentByColor: Record<string, number> | undefined;
      let snowManaColorsSpent: string[] | undefined;
      let snowManaSpentKnown: boolean | undefined;
      let snowManaSpent: boolean | undefined;
      let snowManaOfSpellColorsSpentKnown: boolean | undefined;
      let snowManaOfSpellColorsSpent: boolean | undefined;
      try {
        const consumed = (manaConsumption as any)?.consumed;
        if (consumed && typeof consumed === 'object') {
          const byColor: Record<string, number> = {};
          const colorCodes = new Set<string>();
          const keys: Array<'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless'> = ['white', 'blue', 'black', 'red', 'green', 'colorless'];

          for (const k of keys) {
            const used = Number((consumed as any)[k] || 0);
            if (used <= 0) continue;
            const pre = Number((poolBeforePayment as any)?.[k] || 0);
            const nonSnowNew = Number((producedNonSnowByColor as any)?.[k] || 0);
            const requiredSnow = Math.max(0, used - pre - nonSnowNew);
            if (requiredSnow > 0) {
              byColor[k] = requiredSnow;
              if (k === 'white') colorCodes.add('W');
              else if (k === 'blue') colorCodes.add('U');
              else if (k === 'black') colorCodes.add('B');
              else if (k === 'red') colorCodes.add('R');
              else if (k === 'green') colorCodes.add('G');
            }
          }

          if (Object.keys(byColor).length > 0) {
            snowManaSpentByColor = byColor;
            snowManaColorsSpent = Array.from(colorCodes);
          }

          // Derive deterministic outcome for generic: "if {S} was spent to cast it" / "if snow mana was spent...".
          // We only set a boolean when we can prove it replay-stably.
          // - If our lower-bound computation proves snow was required, that's deterministically true.
          // - If no mana was spent, that's deterministically false.
          // - Otherwise, we can sometimes prove false when all spent mana was newly produced, non-snow, and
          //   there was no pre-existing floating mana for those colors.
          const lowerBoundTotal = Object.values(byColor).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
          if (lowerBoundTotal > 0) {
            snowManaSpentKnown = true;
            snowManaSpent = true;
          } else if (manaSpentTotal === 0) {
            snowManaSpentKnown = true;
            snowManaSpent = false;
          } else {
            let sawSpend = false;
            let canProveNoSnow = true;
            for (const k of keys) {
              const used = Number((consumed as any)[k] || 0);
              if (used <= 0) continue;
              sawSpend = true;

              const pre = Number((poolBeforePayment as any)?.[k] || 0);
              if (pre > 0) {
                canProveNoSnow = false;
                break;
              }

              const snowNew = Number((producedSnowByColor as any)?.[k] || 0);
              const nonSnowNew = Number((producedNonSnowByColor as any)?.[k] || 0);

              // If any snow mana was produced for a spent color, we can't deterministically prove it wasn't used.
              if (snowNew > 0) {
                canProveNoSnow = false;
                break;
              }

              // All spent mana for this key must be accounted for by non-snow produced during this cast.
              if (nonSnowNew < used) {
                canProveNoSnow = false;
                break;
              }
            }

            if (!sawSpend) {
              snowManaSpentKnown = true;
              snowManaSpent = false;
            } else if (canProveNoSnow) {
              snowManaSpentKnown = true;
              snowManaSpent = false;
            }
          }

          // Derive deterministic outcome for: "if {S} of any of that spell's colors was spent to cast it".
          // This can only be decided when snow provenance is replay-stable:
          // - the spent mana for each spell color did not come from pre-existing floating mana, and
          // - that color's newly-produced mana isn't a mix of snow and non-snow.
          const card = cardInHand as any;
          const rawColors: any[] = Array.isArray(card?.colors)
            ? card.colors
            : Array.isArray(card?.color_identity)
              ? card.color_identity
              : Array.isArray(card?.colorIdentity)
                ? card.colorIdentity
                : [];
          const spellColorCodes = new Set(
            rawColors.map((c: any) => String(c || '').toUpperCase()).filter((c: any) => ['W', 'U', 'B', 'R', 'G'].includes(c))
          );

          // Colorless spells are deterministically false for this clause.
          if (spellColorCodes.size === 0) {
            snowManaOfSpellColorsSpentKnown = true;
            snowManaOfSpellColorsSpent = false;
          } else {
            const codeToKey: Record<string, 'white' | 'blue' | 'black' | 'red' | 'green'> = {
              W: 'white',
              U: 'blue',
              B: 'black',
              R: 'red',
              G: 'green',
            };

            // If our lower-bound computation proves snow was required for any spell color, the clause is true.
            let forcedTrue = false;
            if (snowManaSpentByColor) {
              for (const code of Array.from(spellColorCodes)) {
                const k = codeToKey[code];
                const n = Number((snowManaSpentByColor as any)[k] || 0);
                if (n > 0) {
                  forcedTrue = true;
                  break;
                }
              }
            }
            if (forcedTrue) {
              snowManaOfSpellColorsSpentKnown = true;
              snowManaOfSpellColorsSpent = true;
            } else {
              let unknown = false;
              let anySnowForSpellColor = false;

              for (const code of Array.from(spellColorCodes)) {
                const k = codeToKey[code];
                const used = Number((consumed as any)[k] || 0);
                if (used <= 0) continue;

                const pre = Number((poolBeforePayment as any)?.[k] || 0);
                if (pre > 0) {
                  unknown = true;
                  continue;
                }

                const snowNew = Number((producedSnowByColor as any)?.[k] || 0);
                const nonSnowNew = Number((producedNonSnowByColor as any)?.[k] || 0);

                if (snowNew > 0 && nonSnowNew > 0) {
                  unknown = true;
                  continue;
                }
                if (snowNew > 0 && nonSnowNew <= 0) {
                  anySnowForSpellColor = true;
                  continue;
                }
                if (snowNew <= 0 && nonSnowNew > 0) {
                  // deterministically non-snow for this spell color
                  continue;
                }

                // Spent mana without any accounted production for this color.
                unknown = true;
              }

              if (!unknown) {
                snowManaOfSpellColorsSpentKnown = true;
                snowManaOfSpellColorsSpent = anySnowForSpellColor;
              }
            }
          }
        }
      } catch {
        // best-effort only
      }
      

  return {
    kind: "continue",
    manaConsumption,
    paymentManaDelta,
    manaSpentTotal,
    gainsHasteUntilEndOfTurnFromManaSpent,
    cantBeCounteredFromCavern,
    convergeValue,
    manaFromTreasureSpent,
    manaFromTreasureSpentKnown,
    snowManaSpentByColor,
    snowManaColorsSpent,
    snowManaSpentKnown,
    snowManaSpent,
    snowManaOfSpellColorsSpentKnown,
    snowManaOfSpellColorsSpent,
  };
}
