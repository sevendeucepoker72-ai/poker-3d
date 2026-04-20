import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useProgressStore } from '../../store/progressStore';
import './NotificationCenter.css';

const STORAGE_KEY = 'app_poker_notifications_read';
const MAX_STORED = 50;

function loadStoredNotifs() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY + '_list');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveStoredNotifs(list) {
  try {
    sessionStorage.setItem(STORAGE_KEY + '_list', JSON.stringify(list.slice(0, MAX_STORED)));
  } catch {}
}

function loadReadIds() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveReadIds(ids) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch {}
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

function typeIcon(type) {
  switch (type) {
    case 'achievement': return '🏆';
    case 'levelup': return '⭐';
    case 'mission': return '🎯';
    case 'reward': return '🎁';
    case 'friend': return '👤';
    case 'tournament': return '🏟';
    default: return '🔔';
  }
}

export default function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [stored, setStored] = useState(loadStoredNotifs);
  const [readIds, setReadIds] = useState(loadReadIds);
  const bellRef = useRef(null);

  const progressNotifs = useProgressStore((s) => s.notifications);

  // Convert progressStore notifications to persistent entries
  useEffect(() => {
    if (!progressNotifs.length) return;
    setStored(prev => {
      const existingIds = new Set(prev.map(n => String(n.id)));
      const newEntries = progressNotifs
        .filter(n => !existingIds.has(String(n.id)))
        .map(n => ({
          id: String(n.id),
          type: n.type || 'achievement',
          message: n.message || n.text || String(n.type),
          timestamp: n.timestamp || Date.now(),
        }));
      if (!newEntries.length) return prev;
      const updated = [...newEntries, ...prev].slice(0, MAX_STORED);
      saveStoredNotifs(updated);
      return updated;
    });
  }, [progressNotifs]);

  const unreadCount = stored.filter(n => !readIds.includes(n.id)).length;

  const markAsRead = (id) => {
    setReadIds(prev => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      saveReadIds(next);
      return next;
    });
  };

  const markAllRead = () => {
    const allIds = stored.map(n => n.id);
    setReadIds(allIds);
    saveReadIds(allIds);
  };

  const clearAll = () => {
    setStored([]);
    setReadIds([]);
    saveStoredNotifs([]);
    saveReadIds([]);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  return (
    <div className="notification-bell" ref={bellRef}>
      <button
        className="notification-bell-btn"
        onClick={() => setIsOpen(prev => !prev)}
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
      >
        🔔
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {isOpen && createPortal(
        <div className="notification-dropdown">
          <div className="notification-backdrop" onClick={() => setIsOpen(false)} />
          <div className="notification-panel">
            <div className="notification-panel-header">
              <span className="notification-panel-title">Notifications</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {unreadCount > 0 && (
                  <button className="notification-mark-all" onClick={markAllRead}>
                    Mark all read
                  </button>
                )}
                {stored.length > 0 && (
                  <button className="notification-mark-all" onClick={clearAll} style={{ color: '#666' }}>
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="notification-list">
              {stored.length === 0 ? (
                <div className="notification-empty">No notifications yet</div>
              ) : (
                stored.map(notif => {
                  const isUnread = !readIds.includes(notif.id);
                  return (
                    <div
                      key={notif.id}
                      className={`notification-item${isUnread ? ' unread' : ''}`}
                      onClick={() => markAsRead(notif.id)}
                    >
                      <div className="notification-item-icon">{typeIcon(notif.type)}</div>
                      <div className="notification-item-content">
                        <div className="notification-item-message">{notif.message}</div>
                        <div className="notification-item-time">{timeAgo(notif.timestamp)}</div>
                      </div>
                      {isUnread && <div className="notification-unread-dot" />}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
