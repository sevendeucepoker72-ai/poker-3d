import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import './FriendSystem.css';

// 2026-06-18 — Phase 3a: real, durable friends backed by poker-server
// (Postgres). Replaces the sessionStorage mock. Server events:
//   emit  getFriends / sendFriendRequest{name} / acceptFriendRequest{userId}
//         / removeFriend{userId} / inviteFriendToTable{userId}
//   recv  friendsList{friends:[{userId,username,status,presence}]}
//         / friendsChanged / friendRequestSent / friendError / friendInviteSent

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

export default function FriendSystem({ onClose }) {
  const [friends, setFriends] = useState([]);
  const [addInput, setAddInput] = useState('');
  const [notice, setNotice] = useState(null);
  const [inviteSent, setInviteSent] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    const s = getSocket();
    if (s?.connected) s.emit('getFriends');
  }, []);

  useEffect(() => {
    const s = getSocket();
    if (!s) { setLoading(false); return undefined; }
    const onList = (data) => { setFriends(Array.isArray(data?.friends) ? data.friends : []); setLoading(false); };
    const onChanged = () => refresh();
    const onSent = (d) => setNotice(d?.status === 'accepted' ? 'Friend added!' : 'Request sent');
    const onErr = (d) => setNotice(d?.message || 'Something went wrong');
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
    const t = setTimeout(() => setNotice(null), 2500);
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
    const s = getSocket();
    if (s?.connected) s.emit('inviteFriendToTable', { userId });
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
            placeholder="Add friend by username..."
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={20}
          />
          <button className="friends-add-btn" onClick={handleAdd} disabled={!addInput.trim()}>Add</button>
        </div>
        {notice && <div className="friends-notice">{notice}</div>}

        <div className="friends-list">
          {loading && <div className="friends-empty">Loading…</div>}

          {!loading && incoming.length > 0 && (
            <>
              <div className="friends-section-label">Requests</div>
              {incoming.map((f) => (
                <div key={`in-${f.userId}`} className="friends-card friends-card-online">
                  <div className="friends-card-left">
                    <div className="friends-avatar">{f.username.charAt(0).toUpperCase()}</div>
                    <div className="friends-info">
                      <div className="friends-name">{f.username}</div>
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

          {sorted.map((f) => (
            <div key={f.userId} className={`friends-card friends-card-${f.presence}`}>
              <div className="friends-card-left">
                <div className="friends-avatar">
                  {f.username.charAt(0).toUpperCase()}
                  <span className="friends-status-dot" style={{ background: presenceColor(f.presence) }} />
                </div>
                <div className="friends-info">
                  <div className="friends-name">{f.username}</div>
                  <div className="friends-status" style={{ color: presenceColor(f.presence) }}>{presenceLabel(f.presence)}</div>
                </div>
              </div>
              <div className="friends-card-actions">
                {f.presence === 'online' && (
                  <button className="friends-invite-btn" onClick={() => handleInvite(f.userId)} disabled={inviteSent === f.userId}>
                    {inviteSent === f.userId ? 'Sent!' : 'Invite to Table'}
                  </button>
                )}
                {f.presence === 'in-game' && <span className="friends-ingame-label">Playing...</span>}
                <button className="friends-remove-btn" onClick={() => handleRemove(f.userId)} title="Remove friend">X</button>
              </div>
            </div>
          ))}

          {!loading && outgoing.length > 0 && (
            <>
              <div className="friends-section-label">Pending</div>
              {outgoing.map((f) => (
                <div key={`out-${f.userId}`} className="friends-card friends-card-offline">
                  <div className="friends-card-left">
                    <div className="friends-avatar">{f.username.charAt(0).toUpperCase()}</div>
                    <div className="friends-info">
                      <div className="friends-name">{f.username}</div>
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
