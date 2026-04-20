import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { syncToServer } from '../../services/persistenceService';

const STORAGE_KEY = 'app_poker_player_notes';

export const COLOR_TAGS = [
  { id: 'fish',   emoji: '🐟', label: 'Fish',      color: '#60D4FF', bg: 'rgba(96,212,255,0.15)' },
  { id: 'reg',    emoji: '🎯', label: 'Reg',       color: '#EAB308', bg: 'rgba(234,179,8,0.15)' },
  { id: 'shark',  emoji: '🦈', label: 'Shark',     color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
  { id: 'maniac', emoji: '🔥', label: 'Maniac',    color: '#F97316', bg: 'rgba(249,115,22,0.15)' },
  { id: 'nit',    emoji: '🐢', label: 'Nit',       color: '#A8FFD8', bg: 'rgba(168,255,216,0.1)' },
  { id: 'hero',   emoji: '⭐', label: 'Good play', color: '#4ADE80', bg: 'rgba(74,222,128,0.12)' },
];

export function getNotesFromStorage() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function getPlayerTag(playerName) {
  const notes = getNotesFromStorage();
  const entry = notes[playerName];
  if (!entry) return null;
  return typeof entry === 'object' ? entry : { note: entry, color: null };
}

function saveNotesToStorage(notes) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  syncToServer();
}

export default function PlayerNotes({ playerName, onClose }) {
  const [note, setNote] = useState('');
  const [selectedColor, setSelectedColor] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const entry = getPlayerTag(playerName);
    setNote(entry?.note || '');
    setSelectedColor(entry?.color || null);
    setSaved(false);
  }, [playerName]);

  const handleSave = useCallback(() => {
    const notes = getNotesFromStorage();
    if (note.trim() || selectedColor) {
      notes[playerName] = { note: note.trim(), color: selectedColor };
    } else {
      delete notes[playerName];
    }
    saveNotesToStorage(notes);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [playerName, note, selectedColor]);

  const handleDelete = useCallback(() => {
    const notes = getNotesFromStorage();
    delete notes[playerName];
    saveNotesToStorage(notes);
    setNote('');
    setSelectedColor(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [playerName]);

  if (!playerName) return null;

  const tagInfo = selectedColor ? COLOR_TAGS.find((t) => t.id === selectedColor) : null;

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1a4e, #0d0d2a)',
          border: `1px solid ${tagInfo ? tagInfo.color + '66' : 'rgba(255,215,0,0.3)'}`,
          borderRadius: '14px',
          padding: '24px',
          width: 360,
          maxWidth: '92vw',
          maxHeight: '90vh',     // cap height so a long note can't push the modal off-screen
          overflowY: 'auto',     // scroll inside the card instead
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>📝</span>
            <h3 style={{ margin: 0, color: '#E0E0E0', fontSize: '1rem', fontWeight: 600 }}>
              Notes: {playerName}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        {/* Color tags */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: '#8888AA', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Player Tag</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {COLOR_TAGS.map((tag) => (
              <button
                key={tag.id}
                onClick={() => setSelectedColor(selectedColor === tag.id ? null : tag.id)}
                title={tag.label}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '5px 10px', borderRadius: '6px', border: '1px solid',
                  borderColor: selectedColor === tag.id ? tag.color : 'rgba(255,255,255,0.1)',
                  background: selectedColor === tag.id ? tag.bg : 'rgba(255,255,255,0.03)',
                  color: selectedColor === tag.id ? tag.color : '#8888AA',
                  fontSize: '0.72rem', fontWeight: selectedColor === tag.id ? 700 : 400,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <span>{tag.emoji}</span>
                <span>{tag.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Write notes about this player…"
          maxLength={1000}
          style={{
            width: '100%', height: 100, maxHeight: '40vh', padding: '10px 12px',
            borderRadius: '8px', border: '1px solid rgba(42,42,74,0.6)',
            background: 'rgba(26,26,46,0.7)', color: '#E0E0E0',
            fontSize: '0.88rem', resize: 'vertical', outline: 'none',
            fontFamily: 'inherit', boxSizing: 'border-box', display: 'block',
            wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          }}
        />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 20px', borderRadius: '8px', border: 'none',
              background: 'linear-gradient(135deg, #4ADE80, #22C55E)',
              color: '#0A1A0A', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
            }}
          >
            Save
          </button>
          {(note || selectedColor) && (
            <button
              onClick={handleDelete}
              style={{
                padding: '8px 16px', borderRadius: '8px',
                border: '1px solid #E63946', background: 'transparent',
                color: '#E63946', fontSize: '0.85rem', cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
          {saved && <span style={{ color: '#4ADE80', fontSize: '0.8rem', marginLeft: 4 }}>Saved!</span>}
        </div>
      </div>
    </div>,
    document.body
  );
}
