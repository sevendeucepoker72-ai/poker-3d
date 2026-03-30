import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { useProgressStore } from '../../store/progressStore';
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

  const playerLevel = progress?.level || 1;

  // Career progress tracking (stored locally for now)
  const [careerProgress] = useState(() => {
    try {
      const saved = localStorage.getItem('pokerCareerProgress');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const getVenueProgress = (venueIndex) => {
    const key = `venue_${venueIndex}`;
    return careerProgress[key] || { stagesCompleted: 0, stars: [0, 0, 0] };
  };

  const isVenueUnlocked = (venueIndex) => {
    return playerLevel >= VENUES[venueIndex].level;
  };

  const handlePlay = (venueIndex, stage) => {
    if (!playerName) return;
    startCareerGame(venueIndex, stage);
    setScreen('table');
  };

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

      <div className="career-path">
        {VENUES.map((venue, vi) => {
          const unlocked = isVenueUnlocked(vi);
          const vp = getVenueProgress(vi);

          return (
            <div
              key={vi}
              className={`career-venue ${unlocked ? 'venue-unlocked' : 'venue-locked'} ${selectedVenue === vi ? 'venue-selected' : ''}`}
              style={{
                background: unlocked ? venue.bg : 'linear-gradient(135deg, #1a1a1a, #111)',
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
                          >
                            {stageCompleted ? 'Replay' : 'Play'}
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
