import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { useProgressStore } from '../../store/progressStore';
import { getSocket } from '../../services/socketService';
import { reportPlayRefusal, runPlayFlow, GAME_SERVER_UNREACHABLE_TEXT } from '../../services/playRefusal';
import './CareerMode.css';

const VENUES = [
  {
    name: 'Home Game',
    level: 1,
    tagline: 'Learn the basics',
    opponents: '3 Easy AI opponents',
    reward: '1,000 chips',
    rewardExtra: null,
    icon: '🏠',
    accent: '#4ADE80',
    bg: 'linear-gradient(135deg, #1a3a1a, #0d1f0d)',
    boss: { name: 'Maniac Mike', personality: 'Maniac', icon: '😤' },
  },
  {
    name: 'Local Casino',
    level: 5,
    tagline: 'Prove yourself',
    opponents: '5 Medium AI',
    reward: '5,000 chips',
    rewardExtra: 'Card Back',
    icon: '🎰',
    accent: '#6ABAFF',
    bg: 'linear-gradient(135deg, #1a2a4e, #0d1a2d)',
    boss: { name: 'Rocky Rhodes', personality: 'Rock', icon: '🪨' },
  },
  {
    name: 'Vegas Strip',
    level: 10,
    tagline: 'Hit the big time',
    opponents: '7 Medium-Hard AI',
    reward: '15,000 chips',
    rewardExtra: 'Table Theme',
    icon: '🌆',
    accent: '#FFD700',
    bg: 'linear-gradient(135deg, #3a3a1a, #2d2d0d)',
    boss: { name: 'GTO-3000', personality: 'GTO Robot', icon: '🤖' },
  },
  {
    name: 'Monte Carlo',
    level: 20,
    tagline: 'European elegance',
    opponents: '7 Hard AI',
    reward: '50,000 chips',
    rewardExtra: 'Avatar Item',
    icon: '🏰',
    accent: '#B388FF',
    bg: 'linear-gradient(135deg, #2a1a4e, #1a0d2d)',
    boss: { name: 'Trash Talk Tony', personality: 'Trash-Talker', icon: '🗣' },
  },
  {
    name: 'Macau',
    level: 30,
    tagline: "The dragon's den",
    opponents: '9 Hard-Expert AI',
    reward: '100,000 chips',
    rewardExtra: 'Exclusive Theme',
    icon: '🐉',
    accent: '#EF4444',
    bg: 'linear-gradient(135deg, #4e1a1a, #2d0d0d)',
    boss: { name: 'The Shark', personality: 'Shark', icon: '🦈' },
  },
  {
    name: 'WSOP Main Event',
    level: 50,
    tagline: 'The ultimate test',
    opponents: '9 Expert AI',
    reward: '500,000 chips',
    rewardExtra: 'Legendary Card Back',
    icon: '🏆',
    accent: '#FFD700',
    bg: 'linear-gradient(135deg, #3a2a0a, #2d1f05)',
    boss: { name: 'The Legend', personality: 'Legend', icon: '👑' },
  },
];

const STAGES_PER_VENUE = 3;

export default function CareerMode() {
  const setScreen = useGameStore((s) => s.setScreen);
  const playerName = useGameStore((s) => s.playerName);
  const startCareerGame = useTableStore((s) => s.startCareerGame);
  const progress = useProgressStore((s) => s.progress);

  const [selectedVenue, setSelectedVenue] = useState(null);
  // 2026-10-07 — a stage start waits for the server to CONFIRM it
  // (`careerGameStarted`) before switching to the table screen. Previously
  // setScreen('table') ran right after the emit, so a refused start
  // (suspended / no account) left the player on an empty table.
  // starting: null | { venueIndex, stage }
  const [starting, setStarting] = useState(null);
  const [startError, setStartError] = useState(null);

  const playerLevel = progress?.level || 1;

  // Career progress. The SERVER is now the durable source of truth
  // (progress.careerProgress, hydrated from durableState → survives cross-device
  // + cache clear, 2026-07-07 gap-fill). localStorage is kept as an offline cache
  // and to reflect a just-won stage instantly before the next durableState sync.
  const [careerProgress] = useState(() => {
    try {
      const saved = localStorage.getItem('pokerCareerProgress')
        || sessionStorage.getItem('pokerCareerProgress'); // migrate old per-tab data
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const getVenueProgress = (venueIndex) => {
    const key = `venue_${venueIndex}`;
    const local = careerProgress[key] || { stagesCompleted: 0, stars: [0, 0, 0] };
    // Merge server-durable rows with the local cache, taking the best stars per
    // stage so progress survives a new device/cache-clear AND a just-won stage
    // (in localStorage, not yet re-synced) still shows.
    const serverRows = (progress?.careerProgress || []).filter((r) => r.venue === venueIndex);
    if (!serverRows.length) return local;
    const stars = [0, 1, 2].map((s) => {
      const row = serverRows.find((r) => r.stage === s);
      return Math.max(row?.stars || 0, local.stars?.[s] || 0);
    });
    return { stars, stagesCompleted: stars.filter((s) => s > 0).length };
  };

  const isVenueUnlocked = (venueIndex) => {
    return playerLevel >= VENUES[venueIndex].level;
  };

  // While a start is in flight: the server confirms with careerGameStarted
  // (sent after the table state), or answers on the shared 'error' event —
  // a play refusal (shown verbatim by the shared PlayRefusalNotice) or a
  // normal error such as not enough chips (shown below the header).
  useEffect(() => {
    if (!starting) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;
    const onStarted = () => {
      setStarting(null);
      setScreen('table');
    };
    const onServerError = (err) => {
      setStarting(null);
      if (reportPlayRefusal(err)) { setStartError(null); return; }
      setStartError(err?.message || 'Could not start the game — please try again.');
    };
    socket.on('careerGameStarted', onStarted);
    socket.on('error', onServerError);
    const watchdog = setTimeout(() => {
      setStarting(null);
      setStartError(GAME_SERVER_UNREACHABLE_TEXT);
    }, 10000);
    return () => {
      socket.off('careerGameStarted', onStarted);
      socket.off('error', onServerError);
      clearTimeout(watchdog);
    };
  }, [starting, setScreen]);

  // Play-refusal replay (services/playRefusal.js): a login_required on a
  // still-signed-in tab re-authenticates the socket and runs this start again
  // ONCE through the latest handlePlay, unless Career Mode has unmounted.
  const handlePlayRef = useRef(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const handlePlay = (venueIndex, stage) => {
    if (!playerName || starting) return;
    const socket = getSocket();
    if (!socket?.connected) { setStartError(GAME_SERVER_UNREACHABLE_TEXT); return; }
    setStartError(null);
    setStarting({ venueIndex, stage });
    runPlayFlow(() => {
      if (mountedRef.current && handlePlayRef.current) handlePlayRef.current(venueIndex, stage);
    }, () => startCareerGame(venueIndex, stage));
  };
  useEffect(() => { handlePlayRef.current = handlePlay; });

  return (
    <div className="career-mode">
      <div className="career-header">
        <button className="career-back" onClick={() => setScreen('lobby')}>
          Back to Lobby
        </button>
        <h1 className="career-title">Career Mode</h1>
        <div className="career-level">
          Level {playerLevel}
        </div>
      </div>

      {startError && (
        <div
          className="career-start-error"
          role="alert"
          style={{
            margin: '10px auto 0', maxWidth: 520, padding: '10px 14px', borderRadius: 10,
            background: 'rgba(12,28,72,0.92)', border: '1px solid rgba(255,210,74,0.55)',
            color: '#ffd24a', fontSize: 14, textAlign: 'center',
          }}
        >
          {startError}
        </div>
      )}

      <div className="career-path">
        {VENUES.map((venue, vi) => {
          const unlocked = isVenueUnlocked(vi);
          const vp = getVenueProgress(vi);

          return (
            <div
              key={vi}
              className={`career-venue ${unlocked ? 'venue-unlocked' : 'venue-locked'} ${selectedVenue === vi ? 'venue-selected' : ''}`}
              style={{
                background: unlocked ? venue.bg : 'linear-gradient(135deg, #0c1a44, #111)',
                borderColor: unlocked ? venue.accent : '#333',
              }}
              onClick={() => unlocked && setSelectedVenue(selectedVenue === vi ? null : vi)}
            >
              <div className="venue-main">
                <div className="venue-icon" style={{ opacity: unlocked ? 1 : 0.3 }}>
                  {unlocked ? venue.icon : '🔒'}
                </div>
                <div className="venue-info">
                  <h3 style={{ color: unlocked ? venue.accent : '#555' }}>
                    {venue.name}
                  </h3>
                  <p className="venue-tagline">{venue.tagline}</p>
                  <div className="venue-meta">
                    <span className="venue-level" style={{ color: unlocked ? venue.accent : '#555' }}>
                      Lvl {venue.level}
                    </span>
                    <span className="venue-opponents">{venue.opponents}</span>
                  </div>
                </div>
                <div className="venue-progress-ring">
                  <span className="venue-stages">
                    {vp.stagesCompleted}/{STAGES_PER_VENUE}
                  </span>
                </div>
              </div>

              {/* Expanded venue detail */}
              {selectedVenue === vi && unlocked && (
                <div className="venue-expanded">
                  <div className="venue-stages-list">
                    {[0, 1, 2].map((stage) => {
                      const stageStars = vp.stars[stage] || 0;
                      const isBoss = stage === 2;
                      const stageCompleted = stage < vp.stagesCompleted;

                      return (
                        <div key={stage} className="venue-stage">
                          <div className="stage-info">
                            <span className="stage-name">
                              {isBoss ? `Boss: ${venue.boss.icon} ${venue.boss.name}` : `Stage ${stage + 1}`}
                            </span>
                            {isBoss && (
                              <span className="stage-personality">
                                ({venue.boss.personality})
                              </span>
                            )}
                            <div className="stage-stars">
                              {[1, 2, 3].map((star) => (
                                <span
                                  key={star}
                                  className={`stage-star ${stageStars >= star ? 'star-filled' : 'star-empty'}`}
                                >
                                  &#9733;
                                </span>
                              ))}
                            </div>
                          </div>
                          <button
                            className="btn-stage-play"
                            style={{
                              background: stageCompleted
                                ? 'rgba(74, 222, 128, 0.2)'
                                : `linear-gradient(135deg, ${venue.accent}88, ${venue.accent}44)`,
                              borderColor: venue.accent,
                              color: venue.accent,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlay(vi, stage);
                            }}
                            disabled={!!starting}
                          >
                            {starting && starting.venueIndex === vi && starting.stage === stage
                              ? 'Starting…'
                              : (stageCompleted ? 'Replay' : 'Play')}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="venue-rewards">
                    <span className="reward-label">Rewards:</span>
                    <span className="reward-value" style={{ color: venue.accent }}>
                      {venue.reward}
                      {venue.rewardExtra && ` + ${venue.rewardExtra}`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Connection line between venues */}
      <div className="career-connector" />
    </div>
  );
}
