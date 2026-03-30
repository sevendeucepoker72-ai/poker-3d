import { useState } from 'react';
import { useTableStore } from '../../store/tableStore';
import { useGameStore } from '../../store/gameStore';

const MAX_TABLES = 4;

const tabBarStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: '36px',
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  padding: '0 8px',
  background: 'linear-gradient(180deg, #1a1a2e 0%, #0d0d20 100%)',
  borderBottom: '1px solid #333',
  zIndex: 700,
  overflow: 'hidden',
};

const tabStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 14px',
  borderRadius: '6px 6px 0 0',
  fontSize: '0.75rem',
  cursor: 'pointer',
  border: '1px solid transparent',
  borderBottom: 'none',
  transition: 'all 0.2s',
  whiteSpace: 'nowrap',
  color: '#888',
  background: 'rgba(255,255,255,0.03)',
};

const tabActiveStyle = {
  ...tabStyle,
  color: '#00D9FF',
  background: 'rgba(255,215,0,0.08)',
  borderColor: '#333',
};

const yourTurnBadge = {
  display: 'inline-block',
  padding: '1px 5px',
  borderRadius: '3px',
  fontSize: '0.6rem',
  fontWeight: 700,
  background: '#4ADE80',
  color: '#0a0a1a',
  animation: 'pulse 1s infinite',
};

const closeBtn = {
  marginLeft: '4px',
  background: 'none',
  border: 'none',
  color: '#666',
  cursor: 'pointer',
  fontSize: '0.8rem',
  padding: '0 2px',
};

const addTabBtn = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  borderRadius: '6px 6px 0 0',
  fontSize: '1rem',
  fontWeight: 700,
  cursor: 'pointer',
  border: '1px solid rgba(74,74,106,0.4)',
  borderBottom: 'none',
  color: '#aaaaaa',
  background: 'rgba(26,26,46,0.6)',
  transition: 'all 0.2s',
  marginLeft: '4px',
  flexShrink: 0,
};

const addTabBtnHover = {
  ...addTabBtn,
  color: '#4ADE80',
  borderColor: '#4ADE80',
  background: 'rgba(74,222,128,0.1)',
};

const addTabBtnDisabled = {
  ...addTabBtn,
  color: '#444',
  cursor: 'not-allowed',
  opacity: 0.5,
};

// Simple table picker overlay
const pickerOverlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 800,
  background: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const pickerPanelStyle = {
  background: 'linear-gradient(135deg, rgba(14,14,36,0.97), rgba(26,16,46,0.97))',
  border: '1px solid rgba(74,74,106,0.5)',
  borderRadius: '14px',
  padding: '20px 24px',
  minWidth: '300px',
  maxHeight: '400px',
  overflowY: 'auto',
  color: '#CCC',
  boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
};

export default function MultiTableTabs() {
  const activeTables = useTableStore((s) => s.activeTables);
  const currentTableId = useTableStore((s) => s.currentTableId);
  const switchActiveTable = useTableStore((s) => s.switchActiveTable);
  const leaveAdditionalTable = useTableStore((s) => s.leaveAdditionalTable);
  const joinAdditionalTable = useTableStore((s) => s.joinAdditionalTable);
  const tables = useTableStore((s) => s.tables);
  const requestTableList = useTableStore((s) => s.requestTableList);
  const playerName = useGameStore((s) => s.playerName);

  const [showPicker, setShowPicker] = useState(false);
  const [addBtnHover, setAddBtnHover] = useState(false);

  const tableCount = activeTables ? activeTables.size : 0;
  const canAddMore = tableCount < MAX_TABLES;

  const handleOpenPicker = () => {
    if (!canAddMore) return;
    requestTableList();
    setShowPicker(true);
  };

  const handleJoinTable = (tableId) => {
    joinAdditionalTable(tableId, playerName, 5000);
    setShowPicker(false);
  };

  // Always show the tab bar (even with 0-1 tables) so the + button is accessible
  return (
    <>
      <div style={tabBarStyle}>
        {activeTables && Array.from(activeTables.entries()).map(([tableId, tableData]) => {
          const isActive = tableId === currentTableId;
          const isYourTurn = tableData?.gameState?.activeSeatIndex === tableData?.gameState?.yourSeat
            && tableData?.gameState?.yourSeat >= 0;
          const tableName = tableData?.gameState?.tableName || 'Table';
          const phase = tableData?.gameState?.phase || '';

          return (
            <div
              key={tableId}
              style={isActive ? tabActiveStyle : tabStyle}
              onClick={() => switchActiveTable(tableId)}
            >
              <span>{tableName}</span>
              {phase && <span style={{ color: '#555', fontSize: '0.65rem' }}>({phase})</span>}
              {isYourTurn && !isActive && <span style={yourTurnBadge}>YOUR TURN</span>}
              {tableCount > 1 && (
                <button
                  style={closeBtn}
                  onClick={(e) => { e.stopPropagation(); leaveAdditionalTable(tableId); }}
                  title="Leave table"
                >
                  x
                </button>
              )}
            </div>
          );
        })}

        {/* Add table button */}
        <button
          style={!canAddMore ? addTabBtnDisabled : addBtnHover ? addTabBtnHover : addTabBtn}
          onMouseEnter={() => setAddBtnHover(true)}
          onMouseLeave={() => setAddBtnHover(false)}
          onClick={handleOpenPicker}
          title={canAddMore ? 'Open another table' : `Maximum ${MAX_TABLES} tables`}
          disabled={!canAddMore}
        >
          +
        </button>

        {tableCount > 0 && (
          <span style={{ marginLeft: '8px', color: '#555', fontSize: '0.65rem', flexShrink: 0 }}>
            {tableCount}/{MAX_TABLES}
          </span>
        )}
      </div>

      {/* Table picker overlay */}
      {showPicker && (
        <div style={pickerOverlayStyle} onClick={() => setShowPicker(false)}>
          <div style={pickerPanelStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#00D9FF', marginBottom: '12px', textAlign: 'center' }}>
              Join Another Table
            </div>
            {tables && tables.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {tables
                  .filter((t) => !activeTables || !activeTables.has(t.id))
                  .map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleJoinTable(t.id)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: 'rgba(30,30,60,0.6)',
                        border: '1px solid rgba(60,60,100,0.4)',
                        borderRadius: '8px',
                        color: '#CCC',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#00D9FF';
                        e.currentTarget.style.background = 'rgba(255,215,0,0.06)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(60,60,100,0.4)';
                        e.currentTarget.style.background = 'rgba(30,30,60,0.6)';
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{t.name || `Table ${t.id}`}</span>
                      <span style={{ color: '#6A8AAA', fontSize: '0.7rem' }}>
                        {t.playerCount || 0}/{t.maxPlayers || 6} players
                      </span>
                    </button>
                  ))}
                {tables.filter((t) => !activeTables || !activeTables.has(t.id)).length === 0 && (
                  <div style={{ color: '#6A6A8A', textAlign: 'center', padding: '16px', fontStyle: 'italic' }}>
                    No other tables available
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: '#6A6A8A', textAlign: 'center', padding: '16px', fontStyle: 'italic' }}>
                Loading tables...
              </div>
            )}
            <button
              onClick={() => setShowPicker(false)}
              style={{
                display: 'block',
                margin: '12px auto 0',
                padding: '6px 20px',
                border: '1px solid rgba(74,74,106,0.5)',
                borderRadius: '6px',
                background: 'rgba(26,26,46,0.6)',
                color: '#aaaaaa',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
