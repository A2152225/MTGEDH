// Origin parent: client/src/components/ManualModeControl.tsx
// Cluster: parameter form for a selected kitchen-table verb.
// Public entry symbols: ManualModeVerbForm, collectManualObjects, ManualObjectOption.

import React, { useMemo, useState } from 'react';
import type {
  ManualActionPayload,
  ManualVerbDef,
  ManualZone,
} from '../../../../shared/src/manualAction';
import { colors, fontSize, radii, spacing } from '../../theme';
import { emitManualAction, peekManualZone, type ManualAck } from './manualModeEmit';
import {
  ManualModeObjectPicker,
  ManualModePeekPiles,
  type ManualCardInfo,
} from './ManualModeCardLists';

export type ManualObjectOption = ManualCardInfo & {
  zone: string;
  ownerId?: string;
};

function cardFields(raw: any, hidden?: boolean): Pick<ManualCardInfo, 'name' | 'type_line' | 'image_uris' | 'card_faces' | 'hidden'> {
  const card = raw?.card || raw || {};
  return {
    name: hidden ? 'Hidden card' : String(card.name || raw?.name || ''),
    type_line: card.type_line || raw?.type_line,
    image_uris: hidden ? undefined : (card.image_uris || raw?.image_uris || card.card_faces?.[0]?.image_uris),
    card_faces: hidden ? undefined : (card.card_faces || raw?.card_faces),
    hidden: hidden === true,
  };
}

export function collectManualObjects(view: any, _you: string | null): ManualObjectOption[] {
  const items: ManualObjectOption[] = [];
  for (const perm of view?.battlefield || []) {
    const id = String(perm.id || '');
    if (!id) continue;
    items.push({
      id,
      label: `${perm.card?.name || id} (battlefield)`,
      zone: 'battlefield',
      ownerId: perm.controller || perm.owner,
      ...cardFields(perm),
    });
  }
  for (const item of view?.stack || []) {
    const id = String(item.id || item.card?.id || '');
    if (!id) continue;
    items.push({
      id,
      label: `${item.card?.name || item.sourceName || id} (stack)`,
      zone: 'stack',
      ownerId: item.controller || item.controllerId || item.owner,
      ...cardFields(item),
    });
  }
  for (const player of view?.players || []) {
    const pid = String(player.id || '');
    const zones = view?.zones?.[pid] || {};
    const addCards = (list: any[], zone: string) => {
      for (const card of Array.isArray(list) ? list : []) {
        const id = String(card?.id || '');
        if (!id) continue;
        const hidden = card?.known === false;
        items.push({
          id,
          label: `${hidden ? 'Hidden card' : (card.name || id)} (${zone}, ${player.name || pid})`,
          zone,
          ownerId: pid,
          ...cardFields(card, hidden),
        });
      }
    };
    addCards(zones.hand, 'hand');
    addCards(zones.graveyard, 'graveyard');
    addCards(zones.exile, 'exile');
    if (zones.libraryTop?.id) {
      items.push({
        id: String(zones.libraryTop.id),
        label: `${zones.libraryTop.name || 'Top card'} (library top, ${player.name || pid})`,
        zone: 'library',
        ownerId: pid,
        ...cardFields(zones.libraryTop),
      });
    }
    const commanders = view?.commandZone?.[pid]?.commanderCards || [];
    addCards(commanders, 'command');
  }
  return items;
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: radii.sm,
  border: `1px solid ${colors.border}`,
  background: '#111',
  color: colors.textPrimary,
  fontSize: fontSize.sm,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: fontSize.xxs,
  color: colors.textSecondary,
  marginBottom: 4,
  fontWeight: 600,
};

export function ManualModeVerbForm(props: {
  gameId: string;
  you: string;
  view: any;
  verb: ManualVerbDef;
  onResult: (ack: ManualAck) => void;
}): React.ReactElement {
  const { gameId, you, view, verb, onResult } = props;
  const players = Array.isArray(view?.players) ? view.players : [];
  const objects = useMemo(() => collectManualObjects(view, you), [view, you]);
  const [targetPlayerId, setTargetPlayerId] = useState(you);
  const [count, setCount] = useState(1);
  const [amount, setAmount] = useState(1);
  const [nth, setNth] = useState(2);
  const [tapped, setTapped] = useState(false);
  const [faceDown, setFaceDown] = useState(false);
  const [toZone, setToZone] = useState<ManualZone>((verb.params.destination?.[0] || 'hand') as ManualZone);
  const [objectIds, setObjectIds] = useState<string[]>([]);
  const [attachToId, setAttachToId] = useState('');
  const [controllerId, setControllerId] = useState(you);
  const [counterType, setCounterType] = useState('+1/+1');
  const [manaColor, setManaColor] = useState<'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless'>('colorless');
  const [tokenName, setTokenName] = useState('Soldier');
  const [tokenPower, setTokenPower] = useState(1);
  const [tokenToughness, setTokenToughness] = useState(1);
  const [searchName, setSearchName] = useState('');
  const [outcome, setOutcome] = useState<'win' | 'lose'>('lose');
  const [keepTopIds, setKeepTopIds] = useState<string[]>([]);
  const [otherIds, setOtherIds] = useState<string[]>([]);
  const [peeked, setPeeked] = useState<ManualCardInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const filteredObjects = objects.filter((item) => {
    if (!verb.params.objects) return true;
    if (verb.params.objects === 'any') return true;
    return verb.params.objects.includes(item.zone as ManualZone);
  });

  const apply = async () => {
    setBusy(true);
    const payload: Omit<ManualActionPayload, 'actorId'> = {
      verb: verb.id,
      targetPlayerId,
      count,
      amount,
      nth,
      tapped,
      faceDown,
      toZone,
      objectIds,
      attachToId: attachToId || undefined,
      controllerId: verb.params.controller ? controllerId : undefined,
      counterType: verb.params.counterType ? counterType : undefined,
      manaColor: verb.params.manaColor ? manaColor : undefined,
      tokenName: verb.params.token ? tokenName : undefined,
      tokenPower: verb.params.token ? tokenPower : undefined,
      tokenToughness: verb.params.token ? tokenToughness : undefined,
      searchName: verb.params.searchName ? searchName : undefined,
      outcome: verb.params.outcome ? outcome : undefined,
      keepTopIds: keepTopIds.length > 0 ? keepTopIds : undefined,
      bottomIds: verb.params.scry && otherIds.length > 0 ? otherIds : undefined,
      graveyardIds: verb.params.surveil && otherIds.length > 0 ? otherIds : undefined,
    };
    const ack = await emitManualAction(gameId, payload);
    if (ack.peekedCards && ack.peekedCards.length > 0) seedPeeked(ack.peekedCards);
    onResult(ack);
    setBusy(false);
  };

  const seedPeeked = (cards: ManualAck['peekedCards'] | undefined) => {
    const next = (cards || []).map((card) => ({
      id: String(card.id || ''),
      name: String(card.name || 'Card'),
      type_line: card.type_line,
      image_uris: card.image_uris,
      label: card.type_line,
    })).filter((card) => card.id);
    setPeeked(next);
    if (verb.params.scry || verb.params.surveil || verb.params.rearrange) {
      setKeepTopIds(next.map((card) => card.id));
      setOtherIds([]);
    }
  };

  const peekZone: ManualZone | 'library_top' =
    verb.id === 'look_at_hand' || verb.id === 'reveal_from_hand'
      ? 'hand'
      : verb.params.searchName
        ? 'library'
        : 'library_top';

  const peek = async () => {
    setBusy(true);
    const lookOrReveal =
      verb.id === 'look_at_hand'
      || verb.id === 'look_at_top_x'
      || verb.id === 'reveal_from_hand'
      || verb.id === 'reveal_top_x';
    const ack = lookOrReveal
      ? await emitManualAction(gameId, { verb: verb.id, targetPlayerId, count, objectIds })
      : await peekManualZone(gameId, peekZone, { playerId: targetPlayerId, count });
    seedPeeked(ack.peekedCards);
    onResult(ack);
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
      <div style={{ fontSize: fontSize.xs, color: colors.textSecondary }}>{verb.behavior}</div>
      {verb.params.player && (
        <label>
          <span style={labelStyle}>Player</span>
          <select style={fieldStyle} value={targetPlayerId} onChange={(e) => setTargetPlayerId(e.target.value)}>
            {players.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name || p.id}</option>
            ))}
          </select>
        </label>
      )}
      {verb.params.controller && (
        <label>
          <span style={labelStyle}>Controller</span>
          <select style={fieldStyle} value={controllerId} onChange={(e) => setControllerId(e.target.value)}>
            {players.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name || p.id}</option>
            ))}
          </select>
        </label>
      )}
      {verb.params.count && (
        <label>
          <span style={labelStyle}>Count</span>
          <input style={fieldStyle} type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
      )}
      {verb.params.amount && (
        <label>
          <span style={labelStyle}>Amount (negative removes)</span>
          <input style={fieldStyle} type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </label>
      )}
      {verb.params.nth && (
        <label>
          <span style={labelStyle}>N (Nth from top)</span>
          <input style={fieldStyle} type="number" min={1} value={nth} onChange={(e) => setNth(Number(e.target.value))} />
        </label>
      )}
      {verb.params.destination && (
        <label>
          <span style={labelStyle}>Destination</span>
          <select style={fieldStyle} value={toZone} onChange={(e) => setToZone(e.target.value as ManualZone)}>
            {verb.params.destination.map((zone) => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>
        </label>
      )}
      {verb.params.objects && (
        <div>
          <span style={labelStyle}>Objects (click to select)</span>
          <ManualModeObjectPicker
            cards={filteredObjects}
            selectedIds={objectIds}
            onChange={setObjectIds}
            multiple
            emptyLabel="No matching cards in view. Peek a hidden zone first if needed."
          />
        </div>
      )}
      {verb.params.attachTo && (
        <div>
          <span style={labelStyle}>Attach to</span>
          <ManualModeObjectPicker
            cards={objects.filter((item) => item.zone === 'battlefield')}
            selectedIds={attachToId ? [attachToId] : []}
            onChange={(ids) => setAttachToId(ids[0] || '')}
            multiple={false}
            emptyLabel="No battlefield permanents."
          />
        </div>
      )}
      {verb.params.counterType && (
        <label>
          <span style={labelStyle}>Counter type</span>
          <input style={fieldStyle} value={counterType} onChange={(e) => setCounterType(e.target.value)} />
        </label>
      )}
      {verb.params.manaColor && (
        <label>
          <span style={labelStyle}>Mana color</span>
          <select style={fieldStyle} value={manaColor} onChange={(e) => setManaColor(e.target.value as any)}>
            {['white', 'blue', 'black', 'red', 'green', 'colorless'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      {verb.params.token && (
        <>
          <label>
            <span style={labelStyle}>Token name</span>
            <input style={fieldStyle} value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ flex: 1 }}>
              <span style={labelStyle}>Power</span>
              <input style={fieldStyle} type="number" value={tokenPower} onChange={(e) => setTokenPower(Number(e.target.value))} />
            </label>
            <label style={{ flex: 1 }}>
              <span style={labelStyle}>Toughness</span>
              <input style={fieldStyle} type="number" value={tokenToughness} onChange={(e) => setTokenToughness(Number(e.target.value))} />
            </label>
          </div>
        </>
      )}
      {verb.params.searchName && (
        <label>
          <span style={labelStyle}>Card name contains</span>
          <input style={fieldStyle} value={searchName} onChange={(e) => setSearchName(e.target.value)} />
        </label>
      )}
      {verb.params.outcome && (
        <label>
          <span style={labelStyle}>Outcome</span>
          <select style={fieldStyle} value={outcome} onChange={(e) => setOutcome(e.target.value as 'win' | 'lose')}>
            <option value="lose">Lose</option>
            <option value="win">Win</option>
          </select>
        </label>
      )}
      {(verb.params.tapped) && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: fontSize.sm }}>
          <input type="checkbox" checked={tapped} onChange={(e) => setTapped(e.target.checked)} />
          Tapped / tap
        </label>
      )}
      {verb.params.faceDown && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: fontSize.sm }}>
          <input type="checkbox" checked={faceDown} onChange={(e) => setFaceDown(e.target.checked)} />
          Face down
        </label>
      )}
      {(verb.params.peek || verb.params.scry || verb.params.surveil || verb.params.rearrange || verb.params.searchName) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => { void peek(); }}
          style={{
            ...fieldStyle,
            cursor: 'pointer',
            background: colors.surfaceTransparent,
          }}
        >
          Peek {peekZone === 'hand' ? 'hand' : peekZone === 'library' ? 'library' : 'top'}
        </button>
      )}
      {verb.params.searchName && peeked.length > 0 && (
        <div>
          <span style={labelStyle}>Library cards (click to take)</span>
          <ManualModeObjectPicker
            cards={peeked}
            selectedIds={objectIds}
            onChange={setObjectIds}
            multiple
          />
        </div>
      )}
      {(verb.params.scry || verb.params.surveil || verb.params.rearrange) && peeked.length > 0 && (
        <ManualModePeekPiles
          cards={peeked}
          keepIds={keepTopIds}
          otherIds={verb.params.rearrange ? undefined : otherIds}
          onKeepChange={setKeepTopIds}
          onOtherChange={verb.params.rearrange ? undefined : setOtherIds}
          keepLabel={verb.params.rearrange ? 'New top-to-bottom order' : 'Keep on top (top first)'}
          otherLabel={verb.params.scry ? 'Put on bottom' : verb.params.surveil ? 'To graveyard' : undefined}
          reorderable
        />
      )}
      {(verb.params.scry || verb.params.surveil || verb.params.rearrange) && peeked.length === 0 && (
        <div style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
          Peek first, then drag cards to reorder (or use the arrows). Hover a row for the card image.
        </div>
      )}
      {verb.params.peek && peeked.length > 0 && !verb.params.scry && !verb.params.surveil && !verb.params.rearrange && !verb.params.searchName && (
        <ManualModePeekPiles
          cards={peeked}
          keepIds={peeked.map((card) => card.id)}
          onKeepChange={() => undefined}
          keepLabel="Peeked cards"
          reorderable={false}
        />
      )}
      <button
        type="button"
        disabled={busy}
        onClick={apply}
        style={{
          ...fieldStyle,
          cursor: busy ? 'wait' : 'pointer',
          background: colors.accentSoft,
          borderColor: colors.accent,
          color: colors.accentStrong,
          fontWeight: 700,
        }}
      >
        {busy ? 'Applying…' : 'Apply'}
      </button>
    </div>
  );
}
