import React, { useState } from "react";
import type { BattlefieldPermanent } from "../../../shared/src";
import type { GameCreationConfig } from "../components/CreateGameModal";
import { socket } from "../socket";
import { canCreatureAttackNow } from "../utils/creatureUtils";
import { useAppLoopShortcutHandlers } from "./appLoopShortcutHandlers";
import { useAppPlaySocketEffects } from "./appPlaySocketEffects";
