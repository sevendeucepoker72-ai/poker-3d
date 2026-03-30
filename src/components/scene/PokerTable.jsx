import { Suspense, useMemo, useRef, useState, useCallback, useEffect, memo } from 'react';
import { DoubleSide, Object3D, Color } from 'three';
import { Text, Html } from '@react-three/drei';
import { getRankInfo } from '../ui/RankBadge';
import { getPlayerTag, COLOR_TAGS } from '../ui/PlayerNotes';
import { useFrame } from '@react-three/fiber';
import AvatarModel from '../avatar/AvatarModel';
import RenderPeopleAvatar from '../avatar/RenderPeopleAvatar';
import DealerAvatar from '../avatar/DealerAvatar';
import DealerAnimationLayer from '../game/DealerAnimationLayer';
import Card3D from '../game/Card3D';
import { useGameStore, SEAT_COUNT } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { useProgressStore } from '../../store/progressStore';
import { useTimerStore } from '../../store/timerStore';
import { TABLE_THEMES } from '../ui/ThemeShop';
import { getOpponentStats } from '../../utils/opponentTracker';
import './NamePlate.css';

// ── Nameplate helpers ──────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b',
  '#10b981','#3b82f6','#ef4444','#06b6d4',
  '#84cc16','#f97316',
];
function getAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/**
 * Returns a short position label (BTN, SB, BB, UTG, MP, HJ, CO) for a given
 * seat index, given the dealer button seat and the list of occupied seat indices.
 */
function getPositionLabel(seatIndex, dealerButtonSeat, occupiedSeats) {
  if (!occupiedSeats || occupiedSeats.length < 2) return '';
  const total = SEAT_COUNT;
  const sorted = [...occupiedSeats].sort((a, b) => {
    const da = (a - dealerButtonSeat + total) % total;
    const db = (b - dealerButtonSeat + total) % total;
    return da - db;
  });
  const pos = sorted.indexOf(seatIndex);
  if (pos === -1) return '';
  const n = sorted.length;
  if (n === 2) return pos === 0 ? 'BTN/SB' : 'BB';
  const labels = ['BTN','SB','BB','UTG','UTG+1','MP','HJ','CO',''];
  // Map CO dynamically: last before BTN
  if (pos === n - 1) return 'CO';
  if (pos === n - 2 && n >= 5) return 'HJ';
  return labels[pos] ?? '';
}

/** Left-edge accent colour by position label */
function getPositionEdgeColor(label) {
  if (label === 'BTN' || label === 'BTN/SB') return '#FFD700';
  if (label === 'SB') return '#f1f5f9';
  if (label === 'BB') return '#f59e0b';
  return '#374151';
}

/** Badge CSS class by position label */
function getPositionBadgeClass(label) {
  if (label === 'BTN' || label === 'BTN/SB') return 'nameplate__badge--btn';
  if (label === 'SB') return 'nameplate__badge--sb';
  if (label === 'BB') return 'nameplate__badge--bb';
  return 'nameplate__badge--pos';
}

// 9 seats evenly distributed around the table
const SEAT_RADIUS = 1.7;
const SEAT_POSITIONS = Array.from({ length: SEAT_COUNT }, (_, i) => {
  // Counter-clockwise on screen: seat 1 = bottom-LEFT, matching standard poker table direction
  // (action flows left → counter-clockwise from player's perspective at the bottom)
  const angle = (Math.PI / 2) + (i * (2 * Math.PI / SEAT_COUNT));
  const x = Math.cos(angle) * SEAT_RADIUS;
  const z = Math.sin(angle) * SEAT_RADIUS;
  const rot = Math.atan2(-x, -z);
  return { pos: [x, 0, z], rot: [0, rot, 0] };
});

// Chip denomination colors
const CHIP_DENOMS = [
  { value: 25000, color: '#9C27B0' },  // purple
  { value: 5000, color: '#4CAF50' },   // green
  { value: 1000, color: '#212121' },    // black
  { value: 500, color: '#1565C0' },     // blue
  { value: 100, color: '#D32F2F' },     // red
  { value: 25, color: '#F5F5F5' },      // white
];

function getChipBreakdown(amount) {
  const chips = [];
  let remaining = amount;
  for (const denom of CHIP_DENOMS) {
    const count = Math.floor(remaining / denom.value);
    if (count > 0) {
      chips.push({ color: denom.color, count: Math.min(count, 5) }); // cap at 5 per stack
      remaining -= count * denom.value;
    }
  }
  if (chips.length === 0 && amount > 0) {
    chips.push({ color: '#F5F5F5', count: 1 });
  }
  return chips;
}

function formatDenomLabel(value) {
  if (value >= 25000) return '25K';
  if (value >= 5000) return '5K';
  if (value >= 1000) return '1K';
  return String(value);
}

// ── Instanced chip helpers (pure JS — no WebGL context needed) ──
const MAX_INSTANCED_CHIPS = 30;
const _dummy = new Object3D();
const _color = new Color();

/**
 * Build a flat array of chip instance descriptors from a chip breakdown.
 * offsetFn(si) returns the x-offset for stack column si.
 */
function buildChipInstances(breakdown, offsetFn) {
  const instances = [];
  breakdown.forEach((stack, si) => {
    const xOff = offsetFn(si);
    for (let ci = 0; ci < stack.count; ci++) {
      instances.push({ x: xOff, y: ci * 0.015, z: 0, color: stack.color });
    }
  });
  return instances;
}

/**
 * GPU-instanced chip stack — renders all chips in two draw calls (cylinders + edge rings).
 */
const InstancedChipStack = memo(function InstancedChipStack({ position, breakdown, denomValues, offsetFn, totalHeight, labelOffset = 0, showAmountLabel = false, amount = 0 }) {
  const chipMeshRef = useRef();
  const edgeMeshRef = useRef();

  const instances = useMemo(() => buildChipInstances(breakdown, offsetFn), [breakdown, offsetFn]);

  useEffect(() => {
    const chipMesh = chipMeshRef.current;
    const edgeMesh = edgeMeshRef.current;
    if (!chipMesh || !edgeMesh) return;

    instances.forEach(({ x, y, z, color }, i) => {
      _dummy.position.set(x, y, z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      chipMesh.setMatrixAt(i, _dummy.matrix);
      chipMesh.setColorAt(i, _color.set(color));
      edgeMesh.setMatrixAt(i, _dummy.matrix);
    });

    // Zero out unused instance slots (hide them far off-screen)
    for (let i = instances.length; i < MAX_INSTANCED_CHIPS; i++) {
      _dummy.position.set(0, -9999, 0);
      _dummy.updateMatrix();
      chipMesh.setMatrixAt(i, _dummy.matrix);
      edgeMesh.setMatrixAt(i, _dummy.matrix);
    }

    chipMesh.instanceMatrix.needsUpdate = true;
    if (chipMesh.instanceColor) chipMesh.instanceColor.needsUpdate = true;
    edgeMesh.instanceMatrix.needsUpdate = true;
  }, [instances]);

  return (
    <group position={position}>
      {/* Single draw call for all chip cylinders */}
      <instancedMesh ref={chipMeshRef} args={[undefined, undefined, MAX_INSTANCED_CHIPS]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.012, 20]} />
        <meshStandardMaterial metalness={0.3} roughness={0.35} />
      </instancedMesh>
      {/* Single draw call for all gold edge stripes */}
      <instancedMesh ref={edgeMeshRef} args={[undefined, undefined, MAX_INSTANCED_CHIPS]}>
        <torusGeometry args={[0.04, 0.003, 6, 20]} />
        <meshStandardMaterial color="#FFD700" metalness={0.5} roughness={0.3} />
      </instancedMesh>

      {/* Denomination labels (one Text per column — very few nodes) */}
      {breakdown.map((stack, si) => {
        const topY = (stack.count - 1) * 0.015 + 0.012;
        return denomValues[si] ? (
          <Text
            key={si}
            position={[offsetFn(si), topY + 0.002, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.015}
            color="#FFFFFF"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.002}
            outlineColor="#000000"
            fontWeight="bold"
          >
            {formatDenomLabel(denomValues[si])}
          </Text>
        ) : null;
      })}

      {/* Optional floating amount label (BetChipStack only) */}
      {showAmountLabel && (
        <Text
          position={[0, totalHeight + labelOffset, 0]}
          rotation={[-Math.PI / 4, 0, 0]}
          fontSize={0.04}
          color="#FFD700"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.003}
          outlineColor="#000000"
          fontWeight="bold"
        >
          {amount.toLocaleString()}
        </Text>
      )}
    </group>
  );
});

const BetChipStack = memo(function BetChipStack({ position, amount }) {
  const breakdown = useMemo(() => getChipBreakdown(amount), [amount]);
  const denomValues = useMemo(() => {
    const vals = [];
    let remaining = amount;
    for (const denom of CHIP_DENOMS) {
      const count = Math.floor(remaining / denom.value);
      if (count > 0) {
        vals.push(denom.value);
        remaining -= count * denom.value;
      }
    }
    if (vals.length === 0 && amount > 0) vals.push(25);
    return vals;
  }, [amount]);

  const offsetFn = useCallback((si) => si * 0.07, []);

  const totalHeight = useMemo(() => {
    if (!breakdown.length) return 0.04;
    const maxCount = Math.max(...breakdown.map((s) => s.count));
    return (maxCount - 1) * 0.015 + 0.012;
  }, [breakdown]);

  return (
    <InstancedChipStack
      position={position}
      breakdown={breakdown}
      denomValues={denomValues}
      offsetFn={offsetFn}
      totalHeight={totalHeight}
      labelOffset={0.04}
      showAmountLabel
      amount={amount}
    />
  );
});

const PotChipStack = memo(function PotChipStack({ position, amount }) {
  const breakdown = useMemo(() => getChipBreakdown(amount), [amount]);
  const denomValues = useMemo(() => {
    const vals = [];
    let remaining = amount;
    for (const denom of CHIP_DENOMS) {
      const count = Math.floor(remaining / denom.value);
      if (count > 0) {
        vals.push(denom.value);
        remaining -= count * denom.value;
      }
    }
    if (vals.length === 0 && amount > 0) vals.push(25);
    return vals;
  }, [amount]);

  const bLen = breakdown.length;
  const offsetFn = useCallback((si) => (si - bLen / 2) * 0.07, [bLen]);

  const totalHeight = useMemo(() => {
    if (!breakdown.length) return 0;
    const maxCount = Math.max(...breakdown.map((s) => s.count));
    return (maxCount - 1) * 0.015 + 0.012;
  }, [breakdown]);

  return (
    <InstancedChipStack
      position={position}
      breakdown={breakdown}
      denomValues={denomValues}
      offsetFn={offsetFn}
      totalHeight={totalHeight}
    />
  );
});

const ActiveSeatGlow = memo(function ActiveSeatGlow({ position }) {
  const ringRef = useRef();
  const spotRef = useRef();
  useFrame(({ clock }) => {
    // Both refs must exist before doing any work
    if (!ringRef.current && !spotRef.current) return;
    const t = clock.elapsedTime;
    const pulse = 0.4 + Math.sin(t * 3) * 0.2;
    if (ringRef.current) {
      ringRef.current.material.opacity = pulse;
    }
    if (spotRef.current) {
      const s2 = Math.sin(t * 2);
      spotRef.current.material.opacity = 0.12 + s2 * 0.06;
      spotRef.current.material.emissiveIntensity = 0.4 + s2 * 0.2;
    }
  });
  return (
    <group>
      {/* Pulsing green ring */}
      <mesh ref={ringRef} position={[position[0], 0.48, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.22, 0.28, 32]} />
        <meshStandardMaterial
          color="#4ADE80"
          transparent
          opacity={0.5}
          emissive="#4ADE80"
          emissiveIntensity={0.8}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Gold spotlight disc below the seat */}
      <mesh ref={spotRef} position={[position[0], 0.46, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.35, 32]} />
        <meshStandardMaterial
          color="#FFD700"
          transparent
          opacity={0.15}
          emissive="#FFD700"
          emissiveIntensity={0.5}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
});

const AllInGlow = memo(function AllInGlow({ position }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.material.emissiveIntensity = 0.5 + Math.sin(clock.elapsedTime * 4) * 0.5;
  });
  return (
    <mesh ref={ref} position={[position[0], 0.48, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.2, 0.25, 32]} />
      <meshStandardMaterial
        color="#EF4444"
        transparent
        opacity={0.6}
        emissive="#EF4444"
        emissiveIntensity={0.8}
        side={DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
});

const WinnerHighlight = memo(function WinnerHighlight({ position, handName, chipsWon }) {
  const glowRef = useRef();
  const textRef = useRef();

  useFrame(({ clock }) => {
    if (!glowRef.current) return;
    const pulse = 0.5 + Math.sin(clock.elapsedTime * 4) * 0.3;
    glowRef.current.material.opacity = pulse;
    glowRef.current.material.emissiveIntensity = 0.6 + Math.sin(clock.elapsedTime * 4) * 0.4;
  });

  return (
    <group>
      {/* Gold pulsing glow ring around nameplate */}
      <mesh ref={glowRef} position={[position[0], 0.48, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, 0.36, 32]} />
        <meshStandardMaterial
          color="#FFD700"
          transparent
          opacity={0.5}
          emissive="#FFD700"
          emissiveIntensity={0.8}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* WINNER text above nameplate */}
      <Text
        position={[position[0], 0.82, position[2]]}
        rotation={[-Math.PI / 4, 0, 0]}
        fontSize={0.065}
        color="#FFD700"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.004}
        outlineColor="#000000"
        fontWeight="bold"
      >
        WINNER
      </Text>

      {/* Hand name below WINNER text */}
      {handName && (
        <Text
          position={[position[0], 0.76, position[2]]}
          rotation={[-Math.PI / 4, 0, 0]}
          fontSize={0.045}
          color="#FFA500"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.003}
          outlineColor="#000000"
          fontWeight="bold"
        >
          {handName}
        </Text>
      )}

      {/* Chips won */}
      {chipsWon > 0 && (
        <Text
          position={[position[0], 0.71, position[2]]}
          rotation={[-Math.PI / 4, 0, 0]}
          fontSize={0.04}
          color="#4ADE80"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.003}
          outlineColor="#000000"
          fontWeight="bold"
        >
          +{chipsWon.toLocaleString()}
        </Text>
      )}
    </group>
  );
});

function ActionBubble({ position, action }) {
  const ref = useRef();
  const startTimeRef = useRef(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (startTimeRef.current === null) {
      startTimeRef.current = clock.elapsedTime;
    }
    const elapsed = clock.elapsedTime - startTimeRef.current;

    // Float upward slightly
    ref.current.position.y = position[1] + elapsed * 0.03;

    // Fade out after 1.5 seconds
    if (elapsed > 1.5) {
      ref.current.material.opacity = Math.max(0, 1 - (elapsed - 1.5) / 0.5);
    } else {
      ref.current.material.opacity = 1;
    }
  });

  // Pick a color based on action type
  let color = '#FFFFFF';
  if (action.startsWith('Fold')) color = '#E63946';
  else if (action.startsWith('Raise') || action.startsWith('Bet')) color = '#F59E0B';
  else if (action.startsWith('Call')) color = '#4ADE80';
  else if (action.startsWith('Check')) color = '#60A5FA';
  else if (action.startsWith('All-In') || action === 'All-In') color = '#FF6B6B';

  return (
    <Text
      ref={ref}
      position={[position[0], position[1], position[2]]}
      rotation={[-Math.PI / 4, 0, 0]}
      fontSize={0.055}
      color={color}
      anchorX="center"
      anchorY="middle"
      outlineWidth={0.004}
      outlineColor="#000000"
      fontWeight="bold"
      material-transparent={true}
    >
      {action}
    </Text>
  );
}

function ActionBubbleManager({ position, action }) {
  const [displayAction, setDisplayAction] = useState(null);
  const [key, setKey] = useState(0);
  const prevActionRef = useRef(null);

  useEffect(() => {
    if (action && action !== prevActionRef.current) {
      prevActionRef.current = action;
      setDisplayAction(action);
      setKey((k) => k + 1);
    }
  }, [action]);

  if (!displayAction) return null;

  return (
    <ActionBubble
      key={key}
      position={[position[0], 0.88, position[2]]}
      action={displayAction}
    />
  );
}

const SeatNameplate = memo(function SeatNameplate({
  seat, seatIndex, serverSeat, isFolded, isMyPlayer, isActive, isAllIn, isWinner,
  dealerButtonSeat, bigBlind, occupiedSeats, handName, onClickNameplate,
  timerLeft, timerTotal,
}) {
  const [hovered, setHovered] = useState(false);

  // Opponent VPIP/PFR stats (only shown when we have 5+ hands of data)
  const opponentStats = useMemo(() => {
    if (isMyPlayer) return null;
    const stats = getOpponentStats(serverSeat.playerName);
    if (stats.hands < 5) return null;
    return stats;
  }, [serverSeat.playerName, isMyPlayer]);

  // Private note + color tag
  const playerTag = useMemo(() => getPlayerTag(serverSeat.playerName), [serverSeat.playerName]);
  const hasNote = !!playerTag?.note;
  const colorTagInfo = playerTag?.color ? COLOR_TAGS.find((t) => t.id === playerTag.color) : null;

  // Position label, avatar colour, edge colour
  const posLabel   = getPositionLabel(seatIndex, dealerButtonSeat, occupiedSeats);
  const avatarColor = getAvatarColor(serverSeat.playerName);
  const edgeColor  = getPositionEdgeColor(posLabel);
  const badgeClass = getPositionBadgeClass(posLabel);
  const initial    = (serverSeat.playerName || '?')[0].toUpperCase();

  // AI personality display
  const AI_PERSONALITIES = {
    maniac:  { icon: '🔥', label: 'Maniac',   color: '#EF4444' },
    rock:    { icon: '🗿', label: 'Rock',     color: '#94A3B8' },
    actor:   { icon: '🎭', label: 'Actor',    color: '#A855F7' },
    gto:     { icon: '🤖', label: 'GTO Bot',  color: '#00D9FF' },
    donkey:  { icon: '🐴', label: 'Donkey',   color: '#F59E0B' },
    shark:   { icon: '🦈', label: 'Shark',    color: '#3B82F6' },
    fish:    { icon: '🐟', label: 'Fish',     color: '#22C55E' },
  };
  const personalityKey = serverSeat.aiPersonality?.toLowerCase();
  const personality = personalityKey ? AI_PERSONALITIES[personalityKey] : null;

  // Chip + BB display
  const chips  = typeof serverSeat.chipCount === 'number' ? serverSeat.chipCount : 0;
  const bbVal  = bigBlind > 0 ? Math.round(chips / bigBlind) : null;
  const chipsStr = chips.toLocaleString();
  const bbStr  = bbVal !== null ? `${bbVal}bb` : '';

  // CSS class list
  const cls = [
    'nameplate',
    isActive  ? 'nameplate--active'  : '',
    isWinner  ? 'nameplate--winner'  : '',
    isFolded  ? 'nameplate--folded'  : '',
    isMyPlayer ? 'nameplate--me'     : '',
  ].filter(Boolean).join(' ');

  return (
    <group
      position={[seat.pos[0], 0.56, seat.pos[2]]}
      onClick={(e) => {
        e.stopPropagation();
        if (onClickNameplate) onClickNameplate(serverSeat.playerName);
      }}
    >
      <Html center position={[0, 0.1, 0.01]} zIndexRange={[1, 5]} style={{ pointerEvents: 'auto' }}>
        <div className={cls} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
          {/* Winner hand label — floats above the plate */}
          {isWinner && handName && (
            <div className="nameplate__winner-hand">★ {handName}</div>
          )}

          {/* All content clipped to rounded corners */}
          <div className="nameplate__inner">
            {/* Left-edge: color tag if set, else position color */}
            <div className="nameplate__edge" style={{ background: colorTagInfo ? colorTagInfo.color : edgeColor }} />

            {/* Avatar circle + timer ring overlay */}
            <div className="nameplate__avatar-wrap">
              {timerLeft !== null && (
                <svg className={`nameplate__timer-ring${timerLeft <= 5 ? ' nameplate__timer-ring--danger' : ''}`} viewBox="0 0 36 36">
                  <circle className="nameplate__timer-bg"  cx="18" cy="18" r="16" />
                  <circle
                    className="nameplate__timer-fill"
                    cx="18" cy="18" r="16"
                    strokeDasharray={`${(timerLeft / timerTotal) * 100.5} 100.5`}
                  />
                </svg>
              )}
              <div className="nameplate__avatar" style={{ background: avatarColor }}>
                {timerLeft !== null ? (
                  <span className={`nameplate__timer-count${timerLeft <= 5 ? ' nameplate__timer-count--danger' : ''}`}>{timerLeft}</span>
                ) : initial}
              </div>
            </div>

            {/* Name + chips */}
            <div className="nameplate__content">
              <div className="nameplate__header">
                <span className="nameplate__name">{serverSeat.playerName}</span>
                {colorTagInfo && (
                  <span title={colorTagInfo.label} style={{ fontSize: '0.75rem', flexShrink: 0, lineHeight: 1 }}>
                    {colorTagInfo.emoji}
                  </span>
                )}
                {hasNote && <span className="nameplate__note-icon">📝</span>}
                {serverSeat.rank && (() => {
                  const ri = getRankInfo(serverSeat.rank);
                  return (
                    <span title={serverSeat.rank} style={{
                      fontSize: '0.65rem', lineHeight: 1,
                      marginLeft: '2px', flexShrink: 0,
                    }}>
                      {ri.icon}
                    </span>
                  );
                })()}
                {posLabel && (
                  <span className={`nameplate__badge ${badgeClass}`}>{posLabel}</span>
                )}
                {personality && (
                  <span
                    className="nameplate__personality"
                    title={`${personality.label} — AI personality`}
                    style={{ color: personality.color }}
                  >
                    {personality.icon}
                  </span>
                )}
              </div>

              <div className="nameplate__chips">
                <span className="nameplate__chips-dot">●</span>
                <span className="nameplate__chips-amount">{chipsStr}</span>
                {bbStr && <span className="nameplate__chips-bb">· {bbStr}</span>}
              </div>

              {opponentStats && opponentStats.hands >= 5 && !isFolded && (
                <div className="nameplate__hud">
                  <span className="hud-stat" style={{ color: opponentStats.vpip > 35 ? '#EF4444' : opponentStats.vpip > 22 ? '#F59E0B' : '#4ADE80' }}>V{opponentStats.vpip}</span>
                  <span className="hud-sep">/</span>
                  <span className="hud-stat" style={{ color: opponentStats.pfr < 10 ? '#EF4444' : opponentStats.pfr > 20 ? '#F59E0B' : '#4ADE80' }}>P{opponentStats.pfr}</span>
                  <span className="hud-sep">/</span>
                  <span className="hud-stat" style={{ color: opponentStats.af > 3 ? '#EF4444' : opponentStats.af > 1.5 ? '#F59E0B' : '#4ADE80' }}>{opponentStats.af}AF</span>
                </div>
              )}
            </div>
          </div>

          {/* ALL-IN badge — bottom-right corner */}
          {isAllIn && !isFolded && (
            <div className="nameplate__allin-badge">ALL IN</div>
          )}

          {/* Full HUD stats popup on hover */}
          {hovered && !isMyPlayer && opponentStats && opponentStats.hands > 0 && (
            <div className="nameplate__stats-popup">
              <div className="nsp-title">📊 {serverSeat.playerName}</div>
              <div className="nsp-row"><span className="nsp-label">Hands</span><span className="nsp-val">{opponentStats.hands}</span></div>
              <div className="nsp-row"><span className="nsp-label">VPIP</span><span className="nsp-val" style={{ color: opponentStats.vpip > 35 ? '#EF4444' : '#4ADE80' }}>{opponentStats.vpip}%</span></div>
              <div className="nsp-row"><span className="nsp-label">PFR</span><span className="nsp-val" style={{ color: opponentStats.pfr < 10 ? '#EF4444' : '#4ADE80' }}>{opponentStats.pfr}%</span></div>
              <div className="nsp-row"><span className="nsp-label">3-Bet</span><span className="nsp-val">{opponentStats.threeBet}%</span></div>
              <div className="nsp-row"><span className="nsp-label">Fold/Cbet</span><span className="nsp-val">{opponentStats.foldToCbet}%</span></div>
              <div className="nsp-row"><span className="nsp-label">AF</span><span className="nsp-val" style={{ color: opponentStats.af > 3 ? '#EF4444' : '#aaa' }}>{opponentStats.af}</span></div>
              {opponentStats.hands < 15 && <div className="nsp-note">⚠ Small sample</div>}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
});

const DealerButton3D = memo(function DealerButton3D({ position }) {
  return (
    <group position={position}>
      {/* Button body - EXTRA LARGE */}
      <mesh castShadow>
        <cylinderGeometry args={[0.18, 0.18, 0.025, 32]} />
        <meshStandardMaterial color="#FFFFFF" metalness={0.1} roughness={0.2} />
      </mesh>
      {/* Gold rim */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.18, 0.008, 8, 32]} />
        <meshStandardMaterial color="#FFD700" metalness={0.6} roughness={0.2} />
      </mesh>
      {/* "DEALER" text on top */}
      <Text
        position={[0, 0.014, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.064}
        color="#000000"
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
      >
        DEALER
      </Text>
    </group>
  );
});

// Global event for opening player notes from 3D scene
let _onOpenPlayerNotes = null;
export function setOnOpenPlayerNotes(fn) { _onOpenPlayerNotes = fn; }

export default function PokerTable() {
  const localSeats = useGameStore((s) => s.seats);
  const localDealer = useGameStore((s) => s.dealer);

  // Server game state
  const gameState = useTableStore((s) => s.gameState);
  const mySeat = useTableStore((s) => s.mySeat);

  // Shared turn timer (written by GameHUD, read here for nameplate ring)
  const timerLeft  = useTimerStore((s) => s.timerLeft);
  const timerTotal = useTimerStore((s) => s.timerTotal);

  // Theme from progress
  const progress = useProgressStore((s) => s.progress);
  const equippedThemeId = progress?.equippedTableTheme || 'classic_blue';
  const theme = TABLE_THEMES[equippedThemeId] || TABLE_THEMES.classic_blue;

  // Use server seats if available, fall back to local
  const serverSeats = gameState?.seats || [];
  const dealerButtonSeat = gameState?.dealerButtonSeat ?? localDealer.buttonSeatIndex;
  const activeSeatIndex = gameState?.activeSeatIndex ?? -1;
  const handResult = gameState?.handResult || null;
  const pot = gameState?.pot || 0;

  // Determine winners from hand result
  const winnerSeats = useMemo(() => {
    if (!handResult?.winners) return new Set();
    return new Set(handResult.winners.map((w) => w.seatIndex));
  }, [handResult]);

  // Winner info map for highlight details
  const winnerInfoMap = useMemo(() => {
    if (!handResult?.winners) return {};
    const map = {};
    for (const w of handResult.winners) {
      map[w.seatIndex] = { handName: w.handName, chipsWon: w.chipsWon };
    }
    return map;
  }, [handResult]);

  // List of occupied seat indices (for position label calculation)
  const occupiedSeats = useMemo(() => {
    return serverSeats
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s?.state === 'occupied' && !s?.eliminated)
      .map(({ i }) => i);
  }, [serverSeats]);

  // Player notes click handler
  const handleNameplateClick = useCallback((playerName) => {
    if (_onOpenPlayerNotes) _onOpenPlayerNotes(playerName);
  }, []);

  return (
    <group>
      {/* Table surface (themed felt) */}
      <mesh position={[0, 0.45, 0]} receiveShadow>
        <cylinderGeometry args={[1.4, 1.4, 0.06, 64]} />
        <meshStandardMaterial color={theme.felt} roughness={0.8} metalness={0.02} />
      </mesh>

      {/* Betting area oval line on felt */}
      <mesh position={[0, 0.481, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.85, 0.86, 64]} />
        <meshStandardMaterial
          color={theme.bettingLine}
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </mesh>

      {/* Variant name (or "AMERICAN PUB POKER") embossed on felt center */}
      <Text
        position={[0, 0.482, 0.35]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.08}
        color={theme.textColor}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.15}
      >
        {gameState?.variantName && gameState.variantName !== "Texas Hold'em"
          ? gameState.variantName.toUpperCase()
          : 'AMERICAN PUB POKER'}
      </Text>

      {/* Table rail - flat torus around edge */}
      <mesh position={[0, 0.46, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.44, 0.05, 12, 64]} />
        <meshStandardMaterial color={theme.rail} roughness={0.4} metalness={0.15} />
      </mesh>

      {/* Inner rail lip */}
      <mesh position={[0, 0.465, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.38, 0.02, 8, 64]} />
        <meshStandardMaterial color={theme.railInner} roughness={0.3} metalness={0.2} />
      </mesh>

      {/* Outer rail trim (accent) */}
      <mesh position={[0, 0.47, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.48, 0.008, 6, 64]} />
        <meshStandardMaterial color={theme.accent} metalness={0.5} roughness={0.3} />
      </mesh>

      {/* Table legs */}
      {[[-0.8, 0, -0.8], [0.8, 0, -0.8], [-0.8, 0, 0.8], [0.8, 0, 0.8]].map(
        (pos, i) => (
          <group key={i}>
            <mesh position={[pos[0], 0.22, pos[2]]} castShadow>
              <cylinderGeometry args={[0.04, 0.05, 0.44, 8]} />
              <meshStandardMaterial color="#7B5230" roughness={0.6} />
            </mesh>
            {/* Leg base */}
            <mesh position={[pos[0], 0.005, pos[2]]}>
              <cylinderGeometry args={[0.06, 0.07, 0.01, 8]} />
              <meshStandardMaterial color="#2a1a08" roughness={0.7} />
            </mesh>
          </group>
        )
      )}

      {/* 3D Dealer button */}
      {(() => {
        const btnSeat = SEAT_POSITIONS[dealerButtonSeat] || SEAT_POSITIONS[0];
        const seatX = btnSeat.pos[0];
        const seatZ = btnSeat.pos[2];
        const dist = Math.sqrt(seatX * seatX + seatZ * seatZ);
        const scale = 0.855 / dist;
        const bx = seatX * scale;
        const bz = seatZ * scale;
        return <DealerButton3D position={[bx, 0.49, bz]} />;
      })()}

      {/* Pot area indicator ring */}
      <mesh position={[0, 0.481, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.15, 0.17, 32]} />
        <meshStandardMaterial
          color="#FFD700"
          transparent
          opacity={0.15}
          emissive="#FFD700"
          emissiveIntensity={0.1}
          depthWrite={false}
        />
      </mesh>

      {/* Pot chip stack */}
      {pot > 0 && (
        <PotChipStack position={[0, 0.485, 0]} amount={pot} />
      )}

      {/* Pot amount text */}
      {gameState && pot > 0 && (
        <Text
          position={[0, 0.55, 0]}
          rotation={[-Math.PI / 4, 0, 0]}
          fontSize={0.05}
          color="#FFD700"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.003}
          outlineColor="#000000"
        >
          {pot.toLocaleString()}
        </Text>
      )}

      {/* Community card slots (placeholders) */}
      <CommunityCardSlots />

      {/* Dealer NPC */}
      <DealerAvatar />

      {/* Animated cards and chips */}
      <DealerAnimationLayer seatPositions={SEAT_POSITIONS} />

      {/* Seats and avatars */}
      {SEAT_POSITIONS.map((seat, i) => {
        const serverSeat = serverSeats[i];
        const localSeat = localSeats[i];
        const isOccupied = serverSeat?.playerName || localSeat;
        const isActive = i === activeSeatIndex;
        const isFolded = serverSeat?.folded;
        const isAllIn = serverSeat?.allIn;
        const isWinner = winnerSeats.has(i);

        return (
          <group key={i}>
            <Chair position={seat.pos} rotation={seat.rot} />

            {/* Active seat pulsing green glow ring */}
            {isActive && <ActiveSeatGlow position={seat.pos} />}

            {/* All-in red pulsing glow */}
            {isAllIn && !isFolded && !isActive && <AllInGlow position={seat.pos} />}

            {/* Winner gold pulsing highlight */}
            {isWinner && winnerInfoMap[i] && (
              <WinnerHighlight
                position={seat.pos}
                handName={winnerInfoMap[i].handName}
                chipsWon={winnerInfoMap[i].chipsWon}
              />
            )}

            {/* Action bubble floating above player */}
            {serverSeat?.playerName && serverSeat.state === 'occupied' && serverSeat.lastAction && serverSeat.lastAction !== 'None' && (
              <ActionBubbleManager
                position={seat.pos}
                action={serverSeat.lastAction}
              />
            )}

            {/* Seat nameplate (server data) */}
            {serverSeat?.playerName && serverSeat.state === 'occupied' && (
              <SeatNameplate
                seat={seat}
                seatIndex={i}
                serverSeat={serverSeat}
                isFolded={isFolded}
                isMyPlayer={i === mySeat}
                isActive={isActive}
                isAllIn={isAllIn}
                isWinner={isWinner}
                dealerButtonSeat={dealerButtonSeat}
                bigBlind={gameState?.bigBlind || 50}
                occupiedSeats={occupiedSeats}
                handName={winnerInfoMap[i]?.handName || null}
                onClickNameplate={handleNameplateClick}
                timerLeft={isActive ? timerLeft : null}
                timerTotal={isActive ? timerTotal : 30}
              />
            )}

            {/* Bet chip stack near seat */}
            {serverSeat?.currentBet > 0 && (
              <BetChipStack
                position={[seat.pos[0] * 0.6, 0.485, seat.pos[2] * 0.6]}
                amount={serverSeat.currentBet}
              />
            )}

            {/* Face-down/face-up cards for players who have cards (not the local player) */}
            {serverSeat?.hasCards && i !== mySeat && !isFolded && (() => {
              const holeCardCount = gameState?.holeCardCount || 2;
              const isStud = gameState?.isStudGame || false;
              const faceUpCards = serverSeat?.faceUpCards || [];
              const totalCards = serverSeat?.totalCardCount || holeCardCount;

              // For stud games, render face-up cards visible and face-down hidden
              if (isStud && faceUpCards.length > 0) {
                const faceDownCount = totalCards - faceUpCards.length;
                const allCards = [];
                const spacing = Math.min(0.05, 0.2 / totalCards);
                const startOffset = -(totalCards - 1) * spacing / 2;

                // Render face-down cards first
                for (let c = 0; c < faceDownCount; c++) {
                  allCards.push(
                    <Card3D
                      key={`down-${c}`}
                      faceUp={false}
                      position={[seat.pos[0] * 0.72 + startOffset + c * spacing, 0.49, seat.pos[2] * 0.72]}
                      randomTilt
                    />
                  );
                }
                // Render face-up cards
                for (let c = 0; c < faceUpCards.length; c++) {
                  allCards.push(
                    <Card3D
                      key={`up-${c}`}
                      faceUp={true}
                      card={faceUpCards[c]}
                      position={[seat.pos[0] * 0.72 + startOffset + (faceDownCount + c) * spacing, 0.49, seat.pos[2] * 0.72]}
                      randomTilt
                    />
                  );
                }
                return <group>{allCards}</group>;
              }

              // For non-stud games, render face-down cards
              const cardCount = Math.min(totalCards, holeCardCount);
              const spacing = Math.min(0.05, 0.15 / cardCount);
              const startOffset = -(cardCount - 1) * spacing / 2;
              return (
                <group>
                  {Array.from({ length: cardCount }).map((_, c) => (
                    <Card3D
                      key={c}
                      faceUp={false}
                      position={[seat.pos[0] * 0.72 + startOffset + c * spacing, 0.49, seat.pos[2] * 0.72]}
                      randomTilt
                    />
                  ))}
                </group>
              );
            })()}

            {/* Avatar rendering */}
            {localSeat && (
              localSeat.modelId ? (
                <Suspense fallback={null}>
                  <RenderPeopleAvatar
                    modelId={localSeat.modelId}
                    position={[seat.pos[0], seat.pos[1] + 0.05, seat.pos[2]]}
                    rotation={seat.rot}
                  />
                </Suspense>
              ) : (
                <AvatarModel
                  config={localSeat.avatar}
                  position={[seat.pos[0], seat.pos[1] + 0.05, seat.pos[2]]}
                  rotation={seat.rot}
                />
              )
            )}

            {/* Empty seat placeholder */}
            {!isOccupied && (
              <mesh position={[seat.pos[0], 0.55, seat.pos[2]]}>
                <boxGeometry args={[0.15, 0.005, 0.1]} />
                <meshStandardMaterial color="#1A1A2E" transparent opacity={0.4} />
              </mesh>
            )}
          </group>
        );
      })}

      {/* Floor */}
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#2a2a4a" roughness={0.85} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, 2, -5]} receiveShadow>
        <planeGeometry args={[12, 5]} />
        <meshStandardMaterial color="#2a2a50" roughness={0.9} />
      </mesh>

      {/* Side ambient walls */}
      <mesh position={[-6, 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[12, 5]} />
        <meshStandardMaterial color="#282848" roughness={0.9} />
      </mesh>
      <mesh position={[6, 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[12, 5]} />
        <meshStandardMaterial color="#282848" roughness={0.9} />
      </mesh>
    </group>
  );
}

const Chair = memo(function Chair({ position, rotation }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Seat cushion */}
      <mesh position={[0, 0.25, 0]} castShadow>
        <boxGeometry args={[0.3, 0.04, 0.3]} />
        <meshStandardMaterial color="#6B4226" roughness={0.7} />
      </mesh>
      {/* Seat cushion top (leather) */}
      <mesh position={[0, 0.275, 0]} castShadow>
        <boxGeometry args={[0.28, 0.015, 0.28]} />
        <meshStandardMaterial color="#3a2515" roughness={0.5} metalness={0.05} />
      </mesh>
      {/* Back rest */}
      <mesh position={[0, 0.42, -0.13]} castShadow>
        <boxGeometry args={[0.28, 0.32, 0.03]} />
        <meshStandardMaterial color="#6B4226" roughness={0.7} />
      </mesh>
      {/* Legs */}
      {[[-0.12, 0, -0.12], [0.12, 0, -0.12], [-0.12, 0, 0.12], [0.12, 0, 0.12]].map(
        (p, i) => (
          <mesh key={i} position={[p[0], 0.12, p[2]]}>
            <cylinderGeometry args={[0.015, 0.015, 0.25, 6]} />
            <meshStandardMaterial color="#1A1A1A" metalness={0.3} roughness={0.5} />
          </mesh>
        )
      )}
    </group>
  );
});

const ChipStack = memo(function ChipStack({ position, color, count }) {
  return (
    <group position={position}>
      {Array.from({ length: count }).map((_, i) => (
        <mesh key={i} position={[0, i * 0.012, 0]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 0.01, 16]} />
          <meshStandardMaterial color={color} metalness={0.2} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
});
export { ChipStack };

function CommunityCardSlots() {
  // No ghost placeholders — only show actual dealt community cards
  return null;
}

export { SEAT_POSITIONS };
