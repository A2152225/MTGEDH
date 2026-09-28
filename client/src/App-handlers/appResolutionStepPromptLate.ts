// Origin parent: client/src/App.tsx
// Cluster moved: resolutionStepPrompt late branches (hideaway_choice through trigger_order).
// Public entry symbols: handleAppResolutionStepPromptLate.
// Leaf must not import App.tsx or App-handlers/index.ts.

import type { CastingMode } from "../components/CastingModeSelectionModal";
import type { JoinForcesRequest } from "../components/JoinForcesModal";
import type { SpellMode } from "../components/ModalSpellSelectionModal";
import type { TargetOption, TargetSelectionGroup } from "../components/TargetSelectionModal";
import type { TemptingOfferRequest } from "../components/TemptingOfferModal";
import type { TriggerPromptData } from "../components/TriggeredAbilityModal";
import { buildLibrarySearchModalStateFromStep, readResolutionPromptCause } from "../utils/resolutionChoicePrimitives";
import { isResolutionStepMandatory } from "../utils/resolutionStepUtils";
import { resolveTargetOptionPowerToughness } from "../utils/targetOptionPowerToughness";

export function handleAppResolutionStepPromptLate(
  step: any,
  payload: { gameId: string; step: any },
  p: Record<string, any>,
) {
  const {
    confirmId,
    resolutionPlayerNames,
    safeView,
    setAdditionalCostModalData,
    setAdditionalCostModalOpen,
    setBatchExploreIndividual,
    setBatchExplorePrompt,
    setCardNameChoiceModalData,
    setCardNameChoiceModalOpen,
    setCascadeModalOpen,
    setCascadePrompt,
    setCastingModeModalData,
    setCastingModeModalOpen,
    setClashData,
    setClashModalOpen,
    setColorChoiceModalData,
    setColorChoiceModalOpen,
    setCreatureTypeModalData,
    setCreatureTypeModalOpen,
    setDanceWithCalamityCastModalOpen,
    setDanceWithCalamityCastRequest,
    setDanceWithCalamityModalOpen,
    setDanceWithCalamityRequest,
    setExplorePrompt,
    setFatesealData,
    setFatesealModalOpen,
    setHideawayChoiceData,
    setHideawayChoiceModalOpen,
    setJoinForcesContributions,
    setJoinForcesModalOpen,
    setJoinForcesRequest,
    setJoinForcesResponded,
    setLibrarySearchData,
    setLibrarySearchModalOpen,
    setLifeRedistributionData,
    setLifeRedistributionModalOpen,
    setLimDulsVaultModalOpen,
    setLimDulsVaultRequest,
    setMayAbilityModalData,
    setMayAbilityModalOpen,
    setModalSpellModalData,
    setModalSpellModalOpen,
    setOpeningHandActionsModalOpen,
    setOpeningHandActionsStepId,
    setPeek,
    setPendingTriggers,
    setPonderModalOpen,
    setPonderRequest,
    setProliferateData,
    setProliferateModalOpen,
    setResolutionPlayerChoiceModalData,
    setResolutionPlayerChoiceModalOpen,
    setSquadCostModalData,
    setSquadCostModalOpen,
    setTargetModalData,
    setTargetModalOpen,
    setTemptingOfferAcceptedBy,
    setTemptingOfferModalOpen,
    setTemptingOfferRequest,
    setTemptingOfferResponded,
    setTriggerModalOpen,
    setTriggerOrderStepId,
    setVoteData,
    setVoteModalOpen,
    you,
  } = p;
  if (false) {
    /* seam so the extracted else-if chain stays byte-identical */
  }
      else if (step.type === 'hideaway_choice') {
        const sourceName = step.sourceName || 'Hideaway';
        const cards = Array.isArray(step.hideawayCards) ? step.hideawayCards : [];
        setHideawayChoiceData({
          sourceName,
          imageUrl: step.sourceImage || step.sourceImageUrl,
          cards,
          title: `${sourceName} Hideaway`,
          subtitle: 'Choose a card to exile face down',
          oracleText: step.description || `Choose a card to exile face down with ${sourceName}.`,
          confirmButtonText: 'Hide Away Selected Card',
          mandatory: isResolutionStepMandatory(step),
          stepId: step.id,
        });
        setHideawayChoiceModalOpen(true);
      }
      else if (step.type === 'repeated_zone_draft') {
        const sourceName = step.sourceName || 'Draft';
        const rawCards = Array.isArray(step.cards)
          ? step.cards
          : (Array.isArray(step.remainingCardIds) ? step.remainingCardIds.map((id: string) => ({ id, name: id })) : []);
        const cards = rawCards.map((card: any) => ({
          cardId: String(card.cardId || card.id || '').trim(),
          cardName: String(card.cardName || card.name || card.cardId || card.id || '').trim(),
          imageUrl: card.imageUrl,
          attachOptions: Array.isArray(card.attachOptions)
            ? card.attachOptions
                .map((opt: any) => ({
                  cardId: String(opt.cardId || opt.id || '').trim(),
                  cardName: String(opt.cardName || opt.name || opt.id || '').trim(),
                  imageUrl: opt.imageUrl,
                }))
                .filter((opt: { cardId: string }) => Boolean(opt.cardId))
            : undefined,
        })).filter((card: { cardId: string }) => Boolean(card.cardId));
        setHideawayChoiceData({
          sourceName,
          imageUrl: step.sourceImage || step.sourceImageUrl,
          cards,
          title: `${sourceName}: Choose a permanent`,
          subtitle: 'Put it onto the battlefield tapped under your control',
          oracleText: step.description || 'Choose one of the remaining exiled cards.',
          confirmButtonText: 'Choose Card',
          mandatory: isResolutionStepMandatory(step),
          stepId: step.id,
        });
        setHideawayChoiceModalOpen(true);
      }

      // Handle Join Forces resolution step
      else if (step.type === 'join_forces') {
        const allPlayers = (safeView?.players || []).map((p: any) => p.id);
        const initiatorPlayer = (safeView?.players || []).find((p: any) => p.id === step.initiator);

        // Convert to JoinForcesRequest and open the modal
        const request: JoinForcesRequest = {
          id: step.id,
          gameId: payload.gameId,
          initiator: step.initiator,
          initiatorName: step.isInitiator ? 'You' : (initiatorPlayer?.name || step.initiator),
          cardName: step.cardName || step.sourceName || 'Join Forces',
          effectDescription: step.effectDescription || step.description || '',
          cardImageUrl: step.cardImageUrl || step.sourceImage,
          players: allPlayers,
          timeoutMs: step.timeoutMs || 60000,
        };
        
        // Store stepId for resolution response
        (request as any).stepId = step.id;
        (request as any).isInitiator = step.isInitiator;
        (request as any).availableMana = step.availableMana;
        
        setJoinForcesRequest(request);
        setJoinForcesContributions({});
        setJoinForcesResponded([]);
        setJoinForcesModalOpen(true);
      }
      
      // Handle Tempting Offer resolution step
      else if (step.type === 'tempting_offer') {
        const opponents = (safeView?.players || []).map((p: any) => p.id).filter((pid: any) => pid !== step.initiator);
        const initiatorPlayer = (safeView?.players || []).find((p: any) => p.id === step.initiator);

        // Convert to TemptingOfferRequest and open the modal
        const request: TemptingOfferRequest = {
          id: step.id,
          gameId: payload.gameId,
          initiator: step.initiator,
          initiatorName: step.initiator === you ? 'You' : (initiatorPlayer?.name || step.initiator),
          cardName: step.cardName || step.sourceName || 'Tempting Offer',
          effectDescription: step.effectDescription || step.description || '',
          cardImageUrl: step.cardImageUrl || step.sourceImage,
          opponents,
          timeoutMs: step.timeoutMs || 60000,
        };
        
        // Store stepId for resolution response
        (request as any).stepId = step.id;
        (request as any).isOpponent = step.isOpponent;
        
        setTemptingOfferRequest(request);
        setTemptingOfferResponded([]);
        setTemptingOfferAcceptedBy([]);
        setTemptingOfferModalOpen(true);
      }

      // Handle Player Choice resolution step (generic player selection)
      else if (step.type === 'player_choice') {
        setResolutionPlayerChoiceModalData({
          stepId: step.id,
          title: step.sourceName || 'Choose Player',
          description: step.description || '',
          source: {
            name: step.sourceName || 'Choose Player',
            imageUrl: step.sourceImage,
          },
          players: (step.players || []).map((p: any) => ({
            id: p.id,
            name: p.name || p.id,
            life: p.life ?? 0,
            libraryCount: p.libraryCount,
            isOpponent: Boolean(p.isOpponent),
            isSelf: Boolean(p.isSelf),
          })),
          opponentOnly: Boolean(step.opponentOnly),
          isOptional: Boolean(step.isOptional) || !isResolutionStepMandatory(step),
        });
        setResolutionPlayerChoiceModalOpen(true);
      }
      
      // Handle Cascade resolution step
      else if (step.type === 'cascade') {  // Uses ResolutionStepType.CASCADE on server
        setCascadePrompt({
          gameId: payload.gameId,
          effectId: step.effectId,
          playerId: step.playerId,
          sourceName: step.sourceName || 'Cascade',
          cascadeNumber: step.cascadeNumber || 1,
          totalCascades: step.totalCascades || 1,
          hitCard: step.hitCard,
          exiledCards: step.exiledCards || [],
          stepId: step.id,  // Store the step ID for resolution response
        });
        setCascadeModalOpen(true);
      }
      
      // Handle Scry resolution step
      else if (step.type === 'scry') {
        setPeek({
          mode: 'scry',
          cards: step.cards || [],
          stepId: step.id,
        });
      }
      
      // Handle Surveil resolution step
      else if (step.type === 'surveil') {
        setPeek({
          mode: 'surveil',
          cards: step.cards || [],
          stepId: step.id,
        });
      }

      // Handle Bottom Order resolution step
      else if (step.type === 'bottom_order') {
        setPeek({
          mode: 'bottom_order',
          cards: step.cards || [],
          stepId: step.id,
        });
      }
      
      // Handle Proliferate resolution step
      else if (step.type === 'proliferate') {
        setProliferateData({
          proliferateId: step.proliferateId || step.id,
          sourceName: step.sourceName || 'Proliferate',
          sourceImageUrl: step.sourceImage || step.sourceImageUrl,
          validTargets: step.availableTargets || [],
          stepId: step.id,
        });
        setProliferateModalOpen(true);
      }

      else if (step.type === 'life_redistribution') {
        setLifeRedistributionData({
          redistributionId: step.redistributionId || step.id,
          sourceName: step.sourceName || 'Redistribute Life Totals',
          imageUrl: step.sourceImage || step.sourceImageUrl,
          players: (step.players || []).map((player: any) => ({
            id: String(player.id || ''),
            name: String(player.name || player.id || 'Player'),
            life: Number(player.life ?? 0),
          })),
          stepId: step.id,
        });
        setLifeRedistributionModalOpen(true);
      }
      
      // Handle Fateseal resolution step
      else if (step.type === 'fateseal') {
        setFatesealData({
          opponentId: step.opponentId,
          opponentName: step.opponentName || 'opponent',
          cards: step.cards || [],
          stepId: step.id,
          sourceName: step.sourceName || 'Fateseal',
        });
        setFatesealModalOpen(true);
      }
      
      // Handle Clash resolution step
      else if (step.type === 'clash') {
        setClashData({
          revealedCard: step.revealedCard,
          opponentId: step.opponentId,
          stepId: step.id,
          sourceName: step.sourceName || 'Clash',
        });
        setClashModalOpen(true);
      }
      
      // Handle Vote resolution step
      else if (step.type === 'vote') {
        setVoteData({
          voteId: step.voteId || step.id,
          choices: step.choices || [],
          votesSubmitted: step.votesSubmitted || [],
          stepId: step.id,
          sourceName: step.sourceName || 'Vote',
        });
        setVoteModalOpen(true);
      }
      
      // Handle Ponder Effect resolution step
      else if (step.type === 'ponder_effect') {
        setPonderRequest({
          effectId: step.id,
          cardName: step.sourceName || 'Ponder',
          cardImageUrl: step.sourceImage,
          cards: step.cards || [],
          variant: step.variant || 'ponder',
          canShuffle: step.mayShuffleAfter !== false,
          drawAfter: step.drawAfter || false,
          pickToHand: 0,  // Will be determined by variant
          targetPlayerId: step.targetPlayerId || step.playerId,
          targetPlayerName: step.targetPlayerName,
          isOwnLibrary: step.playerId === (step.targetPlayerId || step.playerId),
          stepId: step.id,  // Store for resolution response
        });
        setPonderModalOpen(true);
      }

      else if (step.type === 'lim_duls_vault') {
        setLimDulsVaultRequest({
          cardName: step.sourceName || "Lim-Dul's Vault",
          cardImageUrl: step.sourceImage,
          cards: step.cards || [],
          currentLife: Number(step.currentLife || 0),
          totalLifePaid: Number(step.totalLifePaid || 0),
          stepId: step.id,
        });
        setLimDulsVaultModalOpen(true);
      }

      else if (step.type === 'dance_with_calamity') {
        setDanceWithCalamityRequest({
          cardName: step.sourceName || 'Dance with Calamity',
          cardImageUrl: step.sourceImage,
          exiledCards: step.exiledCards || [],
          totalManaValue: Number(step.totalManaValue || 0),
          canContinue: step.canContinue === true,
          stepId: step.id,
        });
        setDanceWithCalamityModalOpen(true);
      }

      else if (step.type === 'dance_with_calamity_cast') {
        setDanceWithCalamityCastRequest({
          cardName: step.sourceName || 'Dance with Calamity',
          cardImageUrl: step.sourceImage,
          exiledCards: step.exiledCards || [],
          spellCards: step.spellCards || [],
          totalManaValue: Number(step.totalManaValue || 0),
          stepId: step.id,
        });
        setDanceWithCalamityCastModalOpen(true);
      }
      
      // Handle Library Search resolution step
      else if (step.type === 'library_search') {
        const built = buildLibrarySearchModalStateFromStep(step as Record<string, unknown>);
        setLibrarySearchData(built);
        setLibrarySearchModalOpen(true);
      }

      // Handle Opening Hand Actions resolution step (Leylines)
      else if (step.type === 'opening_hand_actions') {
        setOpeningHandActionsStepId(step.id);
        setOpeningHandActionsModalOpen(true);
      }
      // Handle color choice via resolution queue (Throne of Eldraine, Caged Sun, etc.)
      else if (step.type === 'color_choice') {
        setColorChoiceModalData({
          stepId: step.id,
          confirmId: step.id,
          permanentId: (step as any).permanentId || step.sourceId,
          spellId: (step as any).spellId,
          cardName: (step as any).cardName || step.sourceName || 'Permanent',
          reason: (step as any).reason || step.description || 'Choose a color',
          imageUrl: step.sourceImage,
          colors: (step as any).colors || ['white', 'blue', 'black', 'red', 'green'],
          mandatory: isResolutionStepMandatory(step),
        });
        setColorChoiceModalOpen(true);
      }
      // Handle card name choice via resolution queue
      else if (step.type === 'card_name_choice') {
        setCardNameChoiceModalData({
          stepId: step.id,
          cardName: (step as any).cardName || step.sourceName || 'Permanent',
          reason: (step as any).reason || step.description || 'Choose a card name',
          imageUrl: step.sourceImage,
          mandatory: isResolutionStepMandatory(step),
          restrictionText: (step as any).restrictionText,
          candidateNames: Array.isArray((step as any).candidateNames) ? (step as any).candidateNames : undefined,
        });
        setCardNameChoiceModalOpen(true);
      }
      // Handle creature type choice via resolution queue
      else if (step.type === 'creature_type_choice') {
        setCreatureTypeModalData({
          stepId: step.id,
          permanentId: (step as any).permanentId,
          cardName: (step as any).cardName || step.sourceName,
          reason: (step as any).reason || step.description,
          mandatory: isResolutionStepMandatory(step),
          offeredCreatureTypes: Array.isArray((step as any).offeredCreatureTypes)
            ? (step as any).offeredCreatureTypes
            : undefined,
        });
        setCreatureTypeModalOpen(true);
      }
      // Handle "you may" optional effects via resolution queue option_choice metadata
      else if ((step.type === 'option_choice' || step.type === 'modal_choice') && (step as any).mayAbilityPrompt === true) {
        setMayAbilityModalData({
          stepId: step.id,
          sourceName: step.sourceName || 'Ability',
          sourceImage: step.sourceImage,
          effectText: (step as any).effectText || step.description,
          fullAbilityText: (step as any).fullAbilityText,
          effectKey: (step as any).effectKey || '',
          gameId: (safeView as any)?.id || '',
          shortcutCardName: step.sourceName || undefined,
          persistMayAutoPreference: true,
          persistTriggerShortcut: false,
          ...readResolutionPromptCause(step),
        });
        setMayAbilityModalOpen(true);
      }
      // Handle mode selection via resolution queue (modal spells / choice events)
      else if (step.type === 'mode_selection') {
        const minModes = Number(step.minModes ?? 1);
        const maxModes = Number(step.maxModes ?? 1);
        const purpose = String((step as any).modeSelectionPurpose || '');
        const pBudgetRaw = Number((step as any).pBudget);
        const pBudget = Number.isFinite(pBudgetRaw) && pBudgetRaw > 0 ? Math.floor(pBudgetRaw) : undefined;
        const canRepeatModes = Boolean((step as any).canRepeatModes || (step as any).allowDuplicates);
        const isMultiSelect =
          maxModes < 0 ||
          maxModes > 1 ||
          minModes > 1 ||
          purpose === 'modalSpell' ||
          purpose === 'spree' ||
          Boolean(pBudget);

        if (isMultiSelect) {
          const spellModes: SpellMode[] = (step.modes || []).map((m: any, idx: number) => {
            const modePCost = Number(m.pCost);
            return {
              id: String(m.id ?? `mode_${idx + 1}`),
              name: String(m.label ?? `Mode ${idx + 1}`),
              description: String(m.description ?? ''),
              ...(Number.isFinite(modePCost) && modePCost > 0 ? { pCost: Math.floor(modePCost) } : {}),
            };
          });

          setModalSpellModalData({
            cardId: step.sourceId || step.id,
            cardName: step.sourceName || 'Spell',
            description: step.description,
            imageUrl: step.sourceImage,
            modes: spellModes,
            modeCount: maxModes,
            canChooseAny: maxModes < 0 || Boolean(pBudget),
            minModes: minModes,
            isSpree: purpose === 'spree',
            ...(pBudget ? { pBudget, canRepeatModes } : {}),
            effectId: step.sourceId,
            resolutionStepId: String(step.id),
            mandatory: isResolutionStepMandatory(step),
          });
          setModalSpellModalOpen(true);
          return;
        }

        const modes: CastingMode[] = (step.modes || []).map((m: any, idx: number) => ({
          id: String(m.id ?? `mode_${idx + 1}`),
          name: String(m.label ?? `Mode ${idx + 1}`),
          description: String(m.description ?? ''),
          cost: null,
        }));

        setCastingModeModalData({
          cardId: step.sourceId || step.id,
          cardName: step.sourceName || 'Spell',
          source: step.sourceName,
          title: step.description || 'Choose a mode',
          description: 'Choose a mode before selecting targets.',
          imageUrl: step.sourceImage,
          modes,
          effectId: step.sourceId,
          resolutionStepId: step.id,
          resolutionStepMandatory: isResolutionStepMandatory(step),
        });
        setCastingModeModalOpen(true);
      }

      // Additional cost payment (discard/sacrifice) via Resolution Queue
      else if (step.type === 'additional_cost_payment') {
        setAdditionalCostModalData({
          cardId: String(step.cardId || step.sourceId || step.id),
          cardName: String(step.cardName || step.sourceName || 'Spell'),
          costType: (step.costType === 'remove_counters' ? 'remove_counters' : (step.costType === 'sacrifice' ? 'sacrifice' : 'discard')),
          amount: Number(step.amount || 0),
          title: String(step.title || step.description || 'Pay additional cost'),
          description: String(step.description || ''),
          imageUrl: step.imageUrl || step.sourceImage,
          availableCards: step.availableCards,
          availableTargets: step.availableTargets,
          availableCounters: step.availableCounters,
          effectId: step.sourceId,
          resolutionStepId: String(step.id),
          resolutionStepType: 'additional_cost_payment',
          resolutionStepMandatory: isResolutionStepMandatory(step),
        });
        setAdditionalCostModalOpen(true);
      }

      // Squad cost payment via Resolution Queue
      else if (step.type === 'squad_cost_payment') {
        setSquadCostModalData({
          cardId: String(step.cardId || step.sourceId || step.id),
          cardName: String(step.cardName || step.sourceName || 'Spell'),
          squadCost: String(step.squadCost || ''),
          imageUrl: step.imageUrl || step.sourceImage,
          effectId: step.sourceId,
          resolutionStepId: String(step.id),
          mandatory: isResolutionStepMandatory(step),
        });
        setSquadCostModalOpen(true);
      }

      // Explore (single) via Resolution Queue
      else if (step.type === 'explore_decision') {
        setBatchExploreIndividual(null);
        setExplorePrompt({
          stepId: String(step.id),
          permanentId: String(step.permanentId || step.sourceId || ''),
          permanentName: String(step.permanentName || step.sourceName || 'Creature'),
          revealedCard: step.revealedCard,
          isLand: Boolean(step.isLand),
        });
      }

      // Batch Explore via Resolution Queue
      else if (step.type === 'batch_explore_decision') {
        setBatchExploreIndividual(null);
        setBatchExplorePrompt({
          stepId: String(step.id),
          explores: step.explores || [],
        });
      }
      // Handle target selection via resolution queue (spell casting, planeswalker abilities, etc.)
      else if (step.type === 'target_selection' || step.type === 'mentor_target' || step.type === 'modular_choice' || step.type === 'exploit_choice' || step.type === 'haunt_target') {
        const selectedModeRaw = (step as any).selectedMode as { label?: string; description?: string } | undefined;
        const selectedModeUi = selectedModeRaw ? {
          name: String(selectedModeRaw.label || 'Selected mode'),
          description: String(selectedModeRaw.description || ''),
        } : undefined;

        // Convert resolution queue step to target modal format
        const rawTargets = (step.type === 'mentor_target' || step.type === 'modular_choice' || step.type === 'haunt_target')
          ? ((step as any).targets || [])
          : step.type === 'exploit_choice'
            ? ((step as any).creatures || [])
          : (step.validTargets || []);
        const battlefieldById = new Map<string, any>(
          (safeView?.battlefield || []).map((perm: any) => [String(perm.id), perm]),
        );
        const mapTargetOption = (t: any): TargetOption => {
          const perm = battlefieldById.get(String(t?.id || ''));
          const card = t.card || perm?.card;
          const controllerId = t.controller || perm?.controller;
          const ownerId = t.owner || perm?.owner;
          const imageUrl = t.imageUrl
            || t.image
            || card?.image_uris?.small
            || card?.image_uris?.normal
            || card?.card_faces?.[0]?.image_uris?.small
            || card?.card_faces?.[0]?.image_uris?.normal;
          const controllerName = t.controllerName
            || (controllerId ? resolutionPlayerNames[controllerId] : undefined)
            || controllerId;
          const ownerName = t.ownerName
            || (ownerId ? resolutionPlayerNames[ownerId] : undefined)
            || ownerId;
          return {
            id: t.id,
            type: (t.type as any)
              || (t.description === 'stack' || t.kind === 'stack' ? 'stack'
                : (t.description === 'player' || t.description === 'permanent' || t.description === 'card' ? t.description : 'permanent')),
            name: t.label || t.name || card?.name || 'Unknown',
            displayName: t.displayName,
            imageUrl,
            controller: controllerId,
            controllerName,
            typeLine: t.typeLine || card?.type_line,
            tapped: typeof t.tapped === 'boolean' ? t.tapped : (typeof perm?.tapped === 'boolean' ? perm.tapped : undefined),
            // Current P/T (counters, anthems, pumps) as shown on the battlefield, not the printed card.
            powerToughness: resolveTargetOptionPowerToughness(t, perm),
            life: t.life,
            zone: t.zone || (t.type === 'stack' || t.description === 'stack' || t.kind === 'stack' ? 'stack' : undefined),
            owner: ownerId,
            ownerName,
            card,
          };
        };
        const validTargets: TargetOption[] = rawTargets.map(mapTargetOption);

        const perOpponent = (step as any).perOpponent === true;
        const targetsPerOpponentRaw = (step as any).targetsPerOpponent as Record<string, any[]> | undefined;
        const targetsPerOpponent = targetsPerOpponentRaw
          ? Object.fromEntries(
              Object.entries(targetsPerOpponentRaw).map(([opponentId, opponentTargets]) => [
                opponentId,
                (opponentTargets || []).map(mapTargetOption),
              ]),
            )
          : undefined;
        const targetGroupingRaw = (step as any).targetGrouping;
        const targetGroups: TargetSelectionGroup[] | undefined =
          targetGroupingRaw?.groupBy === 'controller' && Array.isArray(targetGroupingRaw.groups)
            ? targetGroupingRaw.groups.map((group: any) => ({
                playerId: String(group.playerId || ''),
                label: String(group.label || group.playerId || 'Player'),
                required: group.required === true,
                minTargets: Number(group.minTargets ?? targetGroupingRaw.minTargetsPerGroup ?? 0),
                maxTargets: Number(group.maxTargets ?? targetGroupingRaw.maxTargetsPerGroup ?? 1),
                targets: (Array.isArray(group.targets) ? group.targets : []).map(mapTargetOption),
              }))
            : undefined;
        
        setTargetModalData({
          cardId: step.sourceId || '',
          source: { name: step.sourceName || 'Effect', imageUrl: step.sourceImage },
          title: step.description || `Choose target`,
          description: (selectedModeUi?.description && (!step.targetDescription || step.targetDescription === 'target')
            ? selectedModeUi.description
            : (step.targetDescription || (step.type === 'mentor_target'
              ? 'Choose an attacking creature with lesser power.'
              : step.type === 'modular_choice'
                ? 'Choose an artifact creature to receive the modular counters.'
                : step.type === 'exploit_choice'
                  ? 'Choose a creature you control to sacrifice.'
                : step.type === 'haunt_target'
                  ? 'Choose a creature to haunt.'
                : ''))),
          contextSteps: (step.oracleContext?.steps || step.spellCastContext?.oracleContext?.steps || undefined) as any,
          selectedMode: selectedModeUi,
          targets: validTargets,
          // Auras must always require exactly one host. Treat 0 as missing so a bad
          // server payload cannot lock the modal into not-allowed / unselectable hosts.
          minTargets: Array.isArray((step as any).targetTypes) && (step as any).targetTypes.includes('aura_target')
            ? Math.max(1, Number(step.minTargets ?? 1))
            : (step.minTargets ?? 1),
          maxTargets: Array.isArray((step as any).targetTypes) && (step as any).targetTypes.includes('aura_target')
            ? Math.max(1, Number(step.maxTargets ?? 1))
            : (step.maxTargets ?? 1),
          targetGroups,
          perOpponent,
          opponents: Array.isArray((step as any).opponents) ? (step as any).opponents : undefined,
          targetsPerOpponent,
          minTargetsPerOpponent: Number((step as any).minTargetsPerOpponent ?? 0),
          maxTargetsPerOpponent: Number((step as any).maxTargetsPerOpponent ?? 1),
          effectId: step.sourceId,
          stepId: step.id,  // Store step ID for resolution response
          useResolutionQueue: true,  // Flag to indicate this came from Resolution Queue
        });
        setTargetModalOpen(true);
      }

      // Handle upkeep sacrifice via resolution queue (Eldrazi Monument, Smokestack, and generic "sacrifice a creature" effects)
      else if (step.type === 'upkeep_sacrifice') {
        const creatures = (step.creatures || []) as Array<{ id: string; name: string; imageUrl?: string }>;
        const allowSourceSacrifice = (step as any).allowSourceSacrifice !== false;
        const sourceToSacrifice = (step as any).sourceToSacrifice as { id: string; name: string; imageUrl?: string } | undefined;

        const resolutionSourceChoiceId = '__SACRIFICE_SOURCE__';
        const availableTargets: Array<{ id: string; name: string; imageUrl?: string; typeLine?: string; leaveBattlefieldReplacementDestination?: 'exile'; leaveBattlefieldReplacementSourceName?: string; leaveBattlefieldReplacementLifeGain?: number }> = creatures.map(c => ({
          id: c.id,
          name: c.name,
          imageUrl: c.imageUrl,
          typeLine: 'Creature',
        }));

        if (allowSourceSacrifice && sourceToSacrifice) {
          availableTargets.push({
            id: resolutionSourceChoiceId,
            name: sourceToSacrifice.name || step.sourceName || 'Source',
            imageUrl: sourceToSacrifice.imageUrl,
            typeLine: 'Source',
          });
        }

        setAdditionalCostModalData({
          cardId: step.sourceId || step.id,
          cardName: step.sourceName || 'Sacrifice',
          costType: 'sacrifice',
          amount: 1,
          title: step.sourceName || 'Sacrifice',
          description: step.description || 'Choose a permanent to sacrifice',
          imageUrl: step.sourceImage,
          availableTargets,
          effectId: step.id,
          resolutionStepId: step.id,
          resolutionStepType: 'upkeep_sacrifice',
          resolutionStepMandatory: isResolutionStepMandatory(step),
          resolutionSourceChoiceId: allowSourceSacrifice && sourceToSacrifice ? resolutionSourceChoiceId : undefined,
        });
        setAdditionalCostModalOpen(true);
      }

      // Handle trigger ordering via resolution queue
      else if (step.type === 'trigger_order') {
        const triggers: any[] = (step.triggers || []) as any[];
        const promptTriggers: TriggerPromptData[] = triggers.map((t: any) => ({
          id: t.id,
          sourceId: t.sourceId || '',
          sourceName: t.sourceName || 'Triggered Ability',
          effect: t.effect || t.description || '',
          type: 'order',
          imageUrl: t.imageUrl,
        }));

        setTriggerOrderStepId(step.id);
        setPendingTriggers(promptTriggers);
        setTriggerModalOpen(true);
      }
}
