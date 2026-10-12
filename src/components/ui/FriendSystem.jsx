import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { useTableStore } from '../../store/tableStore';
import { notify } from '../../hooks/usePushNotifications';
import { profileTargetOf } from '../../utils/profileTarget';
import { inviteTableIdOf, inviteErrorText, INVITE_ERROR_TEXT } from '../../utils/tableInvite';
import './FriendSystem.css';

// The friend invite must carry the inviter's current table id so the recipient
// can actually join. R2 (APPUI-47) — only a table he is SEATED at (not one he
// watches as a spectator or a stale view). Null => nothing to invite to.
// R3 (K3-2 / CLUBS-5, contract I1) — and only a cash table, his home game or a
// club table (never a tournament, a quick game or a club challenge).
function getCurrentTableId() {
  const ts = useTableStore.getState();
  return inviteTableIdOf(ts.gameState, ts.isSpectating);
}

// R2 (APPUI-14 / addendum) — the server's friend error codes, in words.
// R3 (contract I1) — plus the invite refusals (utils/tableInvite.js).
const FRIEND_ERRORS = {
  friend_not_found: 'No player has that exact display name — check the spelling.',
  friend_name_ambiguous: 'More than one player uses that name — add them from their profile or a table instead.',
  ...INVITE_ERROR_TEXT,
};

// 2026-06-18 — Phase 3a: real, durable friends backed by poker-server
// (Postgres). Replaces the sessionStorage mock. Server events:
//   emit  getFriends / sendFriendRequest{name} / acceptFriendRequest{userId}
//         / removeFriend{userId} / inviteFriendToTable{userId}
//   recv  friendsList{friends:[{userId,publicId,username,status,presence}]}
//         / friendsChanged / friendRequestSent / friendError / friendInviteSent

/** A friend row's public name (never a non-string). */
function nameOf(f) {
  return String(f?.username ?? f?.displayName ?? 'Player');
}

function presenceColor(p) {
  switch (p) {
    case 'online': return '#27e0a0';
    case 'in-game': return '#ffd24a';
    default: return '#8298c4';
  }
}
function presenceLabel(p) {
  switch (p) {
    case 'online': return 'Online';
    case 'in-game': return 'In Game';
    default: return 'Offline';
  }
}

export default function FriendSystem({ onClose, onOpenProfile }) {
  const [friends, setFriends] = useState([]);
  const [addInput, setAddInput] = useState('');
  const [notice, setNotice] = useState(null); // { text, ok }
  const [inviteSent, setInviteSent] = useState(null);
  const [loading, setLoading] = useState(true);

  // Tracks each friend's last-known presence so we can fire a local
  // notification on an offline->online transition (hidden tab only). Seeded on
  // the first payload so already-online friends don't all fire at once.
  const prevPresenceRef = useRef(null);

  const refresh = useCallback(() => {
    const s = getSocket();
    if (s?.connected) s.emit('getFriends');
  }, []);

  useEffect(() => {
    const s = getSocket();
    if (!s) { setLoading(false); return undefined; }
    const onList = (data) => {
      const list = Array.isArray(data?.friends) ? data.friends : [];
      // Detect friends that just came online. Only after the first payload, and
      // only when the tab is backgrounded, to avoid on-screen + push spam.
      const prev = prevPresenceRef.current;
      if (prev && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        for (const f of list) {
          if (f.status !== 'accepted') continue;
          const was = prev[f.userId];
          const isOnline = f.presence === 'online' || f.presence === 'in-game';
          const wasOffline = was === undefined || was === 'offline';
          if (isOnline && wasOffline) notify.friendOnline(nameOf(f));
        }
      }
      const next = {};
      for (const f of list) { if (f.status === 'accepted') next[f.userId] = f.presence; }
      prevPresenceRef.current = next;
      setFriends(list);
      setLoading(false);
    };
    const onChanged = () => refresh();
    const onSent = (d) => setNotice({ ok: true, text: d?.status === 'accepted' ? 'Friend added!' : 'Request sent' });
    const onErr = (d) => {
      // R3 (contract I1) — a refused invite is not "Sent!".
      if (inviteErrorText(d)) setInviteSent(null);
      setNotice({ ok: false, text: inviteErrorText(d) || FRIEND_ERRORS[d?.code] || d?.message || 'Something went wrong' });
    };
    const onInvited = () => { /* handled optimistically below */ };
    s.on('friendsList', onList);
    s.on('friendsChanged', onChanged);
    s.on('friendRequestSent', onSent);
    s.on('friendError', onErr);
    s.on('friendInviteSent', onInvited);
    refresh();
    // Safety: if the socket is mid-connect, retry once shortly.
    const t = setTimeout(refresh, 600);
    return () => {
      clearTimeout(t);
      s.off('friendsList', onList);
      s.off('friendsChanged', onChanged);
      s.off('friendRequestSent', onSent);
      s.off('friendError', onErr);
      s.off('friendInviteSent', onInvited);
    };
  }, [refresh]);

  useEffect(() => {
    if (!notice) return undefined;
    // An error stays long enough to read it.
    const t = setTimeout(() => setNotice(null), notice.ok ? 2500 : 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const handleAdd = () => {
    const name = addInput.trim();
    if (!name) return;
    const s = getSocket();
    if (s?.connected) s.emit('sendFriendRequest', { name });
    setAddInput('');
  };
  const handleAccept = (userId) => { const s = getSocket(); if (s?.connected) s.emit('acceptFriendRequest', { userId }); };
  const handleRemove = (userId) => { const s = getSocket(); if (s?.connected) s.emit('removeFriend', { userId }); };
  const handleInvite = (userId) => {
    const tableId = getCurrentTableId();
    if (!tableId) { setNotice({ ok: false, text: 'Sit at a table first, then invite.' }); return; }
    const s = getSocket();
    if (s?.connected) s.emit('inviteFriendToTable', { userId, tableId });
    setInviteSent(userId);
    setTimeout(() => setInviteSent(null), 2000);
  };
  const handleKeyDown = (e) => { if (e.key === 'Enter') handleAdd(); };

  const incoming = friends.filter((f) => f.status === 'pending_in');
  const outgoing = friends.filter((f) => f.status === 'pending_out');
  const accepted = friends.filter((f) => f.status === 'accepted');
  const order = { online: 0, 'in-game': 1, offline: 2 };
  const sorted = [...accepted].sort((a, b) => (order[a.presence] ?? 3) - (order[b.presence] ?? 3));
  const onlineCount = accepted.filter((f) => f.presence === 'online' || f.presence === 'in-game').length;
  const atTable = !!getCurrentTableId();

  return createPortal(
    <div className="friends-overlay" onClick={onClose}>
      <div className="friends-panel" onClick={(e) => e.stopPropagation()}>
        <div className="friends-header">
          <div className="friends-title">Friends</div>
          <span className="friends-count">{onlineCount} / {accepted.length} online</span>
          <button className="friends-close" onClick={onClose}>Close</button>
        </div>

        <div className="friends-add-section">
          <input
            type="text"
            className="friends-add-input"
            placeholder="Add friend by exact display name..."
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={20}
          />
          <button className="friends-add-btn" onClick={handleAdd} disabled={!addInput.trim()}>Add</button>
        </div>
        {notice && <div className={`friends-notice ${notice.ok ? '' : 'friends-notice--error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</div>}

        <div className="friends-list">
          {loading && <div className="friends-empty">Loading…</div>}

          {!loading && incoming.length > 0 && (
            <>
              <div className="friends-section-label">Requests</div>
              {incoming.map((f) => (
                <div key={`in-${f.userId}`} className="friends-card friends-card-online">
                  <div className="friends-card-left">
                    <div className="friends-avatar">{nameOf(f).charAt(0).toUpperCase()}</div>
                    <div className="friends-info">
                      <div className="friends-name">{nameOf(f)}</div>
                      <div className="friends-status" style={{ color: '#ffd24a' }}>wants to be friends</div>
                    </div>
                  </div>
                  <div className="friends-card-actions">
                    <button className="friends-invite-btn" onClick={() => handleAccept(f.userId)}>Accept</button>
                    <button className="friends-remove-btn" onClick={() => handleRemove(f.userId)} title="Decline">X</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && sorted.length === 0 && incoming.length === 0 && (
            <div className="friends-empty">No friends yet. Add someone above!</div>
          )}

          {sorted.map((f) => {
            const target = onOpenProfile ? profileTargetOf(f, nameOf(f)) : null;
            return (
            <div key={f.userId} className={`friends-card friends-card-${f.presence}`}>
              <div className="friends-card-left">
                <div className="friends-avatar">
                  {nameOf(f).charAt(0).toUpperCase()}
                  <span className="friends-status-dot" style={{ background: presenceColor(f.presence) }} />
                </div>
                <div
                  className={`friends-info ${target ? 'friends-info--link' : ''}`}
                  onClick={target ? () => onOpenProfile(target) : undefined}
                  title={target ? 'View profile' : undefined}
                >
                  <div className="friends-name">{nameOf(f)}</div>
                  <div className="friends-status" style={{ color: presenceColor(f.presence) }}>{presenceLabel(f.presence)}</div>
                </div>
              </div>
              <div className="friends-card-actions">
                {f.presence === 'online' && atTable && (
                  <button
                    className="friends-invite-btn"
                    onClick={() => handleInvite(f.userId)}
                    disabled={inviteSent === f.userId}
                    title="Invite to the table you are seated at"
                  >
                    {inviteSent === f.userId ? 'Sent!' : 'Invite to Table'}
                  </button>
                )}
                {f.presence === 'in-game' && <span className="friends-ingame-label">Playing...</span>}
                <button className="friends-remove-btn" onClick={() => handleRemove(f.userId)} title="Remove friend">X</button>
              </div>
            </div>
            );
          })}

          {!loading && outgoing.length > 0 && (
            <>
              <div className="friends-section-label">Pending</div>
              {outgoing.map((f) => (
                <div key={`out-${f.userId}`} className="friends-card friends-card-offline">
                  <div className="friends-card-left">
                    <div className="friends-avatar">{nameOf(f).charAt(0).toUpperCase()}</div>
                    <div className="friends-info">
                      <div className="friends-name">{nameOf(f)}</div>
                      <div className="friends-status" style={{ color: '#8298c4' }}>Request sent</div>
                    </div>
                  </div>
                  <div className="friends-card-actions">
                    <button className="friends-remove-btn" onClick={() => handleRemove(f.userId)} title="Cancel request">X</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
