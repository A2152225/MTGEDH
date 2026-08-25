import React, { useEffect, useMemo } from "react";
import type { BattlefieldPermanent, ChatMsg, KnownCardRef } from "../../../shared/src";
import { useGameStateLog } from "../hooks/useGameStateLog";
import { useRandomDeckPicker } from "../hooks/useRandomDeckPicker";
import { socket } from "../socket";
import { toast } from "../components/ToastHost";
import { isLandTypeLine, prettyPhase, prettyStep } from "../utils/gameDisplayHelpers";
import { buildAvailableManaSourcesForPlayer } from "../utils/manaSourceBuilder";
