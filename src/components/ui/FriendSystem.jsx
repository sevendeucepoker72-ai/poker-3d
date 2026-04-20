import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './FriendSystem.css';

const STORAGE_KEY = 'app_poker_friends';

const DEFAULT_FRIENDS = [
  { id: 1, name: 'AceKiller99', status: 'online', lastSeen: null },
  { id: 2, name: 'BluffQueen', status: 'in-game', lastSeen: null },
  { id: 3, name: 'RiverRat42', status: 'online', lastSeen: null },
  { id: 4, name: 'ChipStack_Pro', status: 'offline', lastSeen: '2026-03-27T14:30:00' },
  { id: 5, name: 'PocketRockets', status: 'in-game', lastSeen: null },
  { id: 6, name: 'FoldEmFiona', status: 'offline', lastSeen: '2026-03-26T22:15:00' },
];

function getStatusColor(status) {
  switch (status) {
    case 'online': return '#4ADE80';
    case 'in-game': return '#FBBF24';
    case 'offline': return '#666';
    default: return '#666';
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'online': return 'Online';
    case 'in-game': return 'In Game';
    case 'offline': return 'Offline';
    default: return 'Unknown';
  }
}

function formatLastSeen(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays}d ago`;
}

export default function FriendSystem({ onClose }) {
  const [friends, setFriends] = useState(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return DEFAULT_FRIENDS;
  });

  const [addInput, setAddInput] = useState('');
  const [inviteSent, setInviteSent] = useState(null);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(friends));
  }, [friends]);

  const handleAddFriend = () => {
    const name = addInput.trim();
    if (!name) return;
    if (friends.some((f) => f.name.toLowerCase() === name.toLowerCase())) return;

    const newFriend = {
      id: Date.now(),
      name,
      status: 'offline',
      lastSeen: new Date().toISOString(),
    };
    setFriends((prev) => [newFriend, ...prev]);
    setAddInput('');
  };

  const handleRemoveFriend = (id) => {
    setFriends((prev) => prev.filter((f) => f.id !== id));
  };

  const handleInvite = (friend) => {
    setInviteSent(friend.id);
    setTimeout(() => setInviteSent(null), 2000);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAddFriend();
  };

  const onlineFriends = friends.filter((f) => f.status === 'online');
  const inGameFriends = friends.filter((f) => f.status === 'in-game');
  const offlineFriends = friends.filter((f) => f.status === 'offline');
  const sortedFriends = [...onlineFriends, ...inGameFriends, ...offlineFriends];

  return createPortal(
    <div className="friends-overlay" onClick={onClose}>
      <div className="friends-panel" onClick={(e) => e.stopPropagation()}>
        <div className="friends-header">
          <div className="friends-title">Friends</div>
          <span className="friends-count">
            {onlineFriends.length + inGameFriends.length} / {friends.length} online
          </span>
          <button className="friends-close" onClick={onClose}>Close</button>
        </div>

        {/* Add Friend */}
        <div className="friends-add-section">
          <input
            type="text"
            className="friends-add-input"
            placeholder="Add friend by name..."
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={20}
          />
          <button
            className="friends-add-btn"
            onClick={handleAddFriend}
            disabled={!addInput.trim()}
          >
            Add
          </button>
        </div>

        {/* Friends List */}
        <div className="friends-list">
          {sortedFriends.length === 0 && (
            <div className="friends-empty">
              No friends yet. Add someone above!
            </div>
          )}
          {sortedFriends.map((friend) => (
            <div key={friend.id} className={`friends-card friends-card-${friend.status}`}>
              <div className="friends-card-left">
                <div className="friends-avatar">
                  {friend.name.charAt(0).toUpperCase()}
                  <span
                    className="friends-status-dot"
                    style={{ background: getStatusColor(friend.status) }}
                  />
                </div>
                <div className="friends-info">
                  <div className="friends-name">{friend.name}</div>
                  <div className="friends-status" style={{ color: getStatusColor(friend.status) }}>
                    {getStatusLabel(friend.status)}
                    {friend.status === 'offline' && friend.lastSeen && (
                      <span className="friends-lastseen"> - {formatLastSeen(friend.lastSeen)}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="friends-card-actions">
                {friend.status === 'online' && (
                  <button
                    className="friends-invite-btn"
                    onClick={() => handleInvite(friend)}
                    disabled={inviteSent === friend.id}
                  >
                    {inviteSent === friend.id ? 'Sent!' : 'Invite to Table'}
                  </button>
                )}
                {friend.status === 'in-game' && (
                  <span className="friends-ingame-label">Playing...</span>
                )}
                <button
                  className="friends-remove-btn"
                  onClick={() => handleRemoveFriend(friend.id)}
                  title="Remove friend"
                >
                  X
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
