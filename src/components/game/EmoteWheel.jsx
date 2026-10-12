import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getSocket } from '../../services/socketService';
import { useProgressStore } from '../../store/progressStore';
import { EMOTES, REACTIONS, SHOP_EMOTES, VIP_EMOTES, FREE_IDS, usableEmoteIds } from './emoteCatalog';
import './EmoteWheel.css';

export default function EmoteWheel({ disabled }) {
  const [open, setOpen] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [note, setNote] = useState(null);
  const cooldownRef = useRef(null);
  const noteRef = useRef(null);
  const progress = useProgressStore((s) => s.progress);

  // R2 (C7 / C8) — owned shop emotes and the VIP emotes join the free set.
  const usable = useMemo(() => usableEmoteIds(progress), [progress]);
  const yours = useMemo(() => SHOP_EMOTES.filter((e) => usable.has(e.id) && !FREE_IDS.has(e.id)), [usable]);
  const vip = useMemo(() => VIP_EMOTES.filter((e) => usable.has(e.id)), [usable]);

  const sendEmote = useCallback((entry) => {
    if (cooldown || !entry) return;
    const socket = getSocket();
    const event = entry.kind === 'reaction' ? 'tableReaction' : 'emote';
    const payloadKey = entry.kind === 'reaction' ? 'reactionId' : 'emoteId';
    if (socket) {
      socket.emit(event, { [payloadKey]: entry.id });
    }
    setOpen(false);
    setCooldown(true);
    cooldownRef.current = setTimeout(() => setCooldown(false), 3000);
  }, [cooldown]);

  // The server refuses an emote this account may not use (`emoteRefused`,
  // e.g. a VIP emote after the pass ran out): say so instead of nothing.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onRefused = () => {
      setNote('That emote is not unlocked.');
      clearTimeout(noteRef.current);
      noteRef.current = setTimeout(() => setNote(null), 3000);
    };
    socket.on('emoteRefused', onRefused);
    return () => socket.off('emoteRefused', onRefused);
  }, []);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
      if (noteRef.current) clearTimeout(noteRef.current);
    };
  }, []);

  const tile = (e) => (
    <button
      key={`${e.kind}-${e.id}`}
      type="button"
      className={`emote-item emote-item--tile${e.vip ? ' emote-item--vip' : ''}`}
      onClick={() => sendEmote(e)}
      aria-label={e.kind === 'reaction' ? `${e.label} (reaction to the table)` : e.label}
    >
      <span className="emote-item-icon">{e.icon}</span>
      <span className="emote-item-label">{e.label}</span>
    </button>
  );

  return (
    <>
      <button
        className="emote-trigger-btn"
        onClick={() => setOpen(!open)}
        disabled={disabled || cooldown}
        title="Send Emote"
      >
        {cooldown ? '...' : '😀 Emote'}
      </button>
      {note && <div className="emote-note" role="status">{note}</div>}

      {open && (
        <div className="emote-wheel-overlay">
          <div className="emote-wheel-backdrop" onClick={() => setOpen(false)} />
          {/* R2 — a grid panel (the 12-item ring could not hold the owned +
              VIP emotes): free emotes, table reactions, then yours + VIP. */}
          <div className="emote-panel" role="dialog" aria-label="Emotes">
            <div className="emote-panel__head">
              <span>Emotes</span>
              <button type="button" className="emote-panel__close" onClick={() => setOpen(false)} aria-label="Close emotes">{'✕'}</button>
            </div>
            <div className="emote-panel__grid">{EMOTES.map(tile)}</div>
            <div className="emote-panel__section">Reactions</div>
            <div className="emote-panel__grid">{REACTIONS.map(tile)}</div>
            {yours.length > 0 && (
              <>
                <div className="emote-panel__section">Your emotes</div>
                <div className="emote-panel__grid">{yours.map(tile)}</div>
              </>
            )}
            {vip.length > 0 && (
              <>
                <div className="emote-panel__section emote-panel__section--vip">VIP</div>
                <div className="emote-panel__grid">{vip.map(tile)}</div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
