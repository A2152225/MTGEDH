import React, { useMemo } from "react";
import { getTextColorsForBackground } from "../utils/appearanceSettings";
import { useAppDismissResolutionStepUi } from "./appDismissResolutionStepUi";
import { useAppPlayCombatHandlers } from "./appPlayCombatHandlers";
import { useAppPlayDerivedEffects } from "./appPlayDerivedEffects";
import { useAppPlayModalHandlers } from "./appPlayModalHandlers";
import { useAppResolutionStepPromptEffects } from "./appResolutionStepPromptEffects";
