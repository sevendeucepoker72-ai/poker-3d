import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { AdditiveBlending } from 'three';
import { useTableStore } from '../../store/tableStore';

const PARTICLE_COUNT = 80;
const CHIP_FLY_COUNT = 12;

function GoldenBurst({ active }) {
  const ref = useRef();
  const startTimeRef = useRef(0);
  const activeRef = useRef(false);

  const particles = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = [];
    const colors = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0.5;
      positions[i * 3 + 2] = 0;

      // Random upward burst velocity
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.5;
      const upSpeed = 1.5 + Math.random() * 2;
      velocities.push(
        Math.cos(angle) * speed,
        upSpeed,
        Math.sin(angle) * speed
      );

      // Gold to orange gradient
      const goldMix = Math.random();
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.7 + goldMix * 0.15;
      colors[i * 3 + 2] = goldMix * 0.2;
    }

    return { positions, velocities, colors };
  }, []);

  useEffect(() => {
    if (active && !activeRef.current) {
      activeRef.current = true;
      startTimeRef.current = 0; // will be set on first frame
      // Reset positions
      const arr = particles.positions;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        arr[i * 3] = (Math.random() - 0.5) * 0.3;
        arr[i * 3 + 1] = 0.5;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
      }
    }
    if (!active) {
      activeRef.current = false;
    }
  }, [active, particles]);

  useFrame(({ clock }) => {
    if (!activeRef.current || !ref.current) return;

    if (startTimeRef.current === 0) {
      startTimeRef.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - startTimeRef.current;
    if (elapsed > 3) {
      activeRef.current = false;
      return;
    }

    const posAttr = ref.current.geometry.attributes.position;
    const arr = posAttr.array;
    const dt = 0.016;
    const gravity = -3;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const vi = i * 3;
      arr[vi] += particles.velocities[vi] * dt;
      particles.velocities[vi + 1] += gravity * dt;
      arr[vi + 1] += particles.velocities[vi + 1] * dt;
      arr[vi + 2] += particles.velocities[vi + 2] * dt;

      // Damping
      particles.velocities[vi] *= 0.99;
      particles.velocities[vi + 2] *= 0.99;
    }

    posAttr.needsUpdate = true;

    // Fade out
    const fadeStart = 1.5;
    if (elapsed > fadeStart) {
      ref.current.material.opacity = Math.max(0, 1 - (elapsed - fadeStart) / 1.5);
    } else {
      ref.current.material.opacity = 0.9;
    }
  });

  if (!active && !activeRef.current) return null;

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={PARTICLE_COUNT}
          array={particles.positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={PARTICLE_COUNT}
          array={particles.colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        transparent
        opacity={0.9}
        vertexColors
        depthWrite={false}
        blending={AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

function FlyingChips({ active, targetPosition }) {
  const chipsRef = useRef([]);
  const [chips, setChips] = useState([]);

  useEffect(() => {
    if (active && targetPosition) {
      const newChips = [];
      for (let i = 0; i < CHIP_FLY_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const delay = i * 0.05;
        newChips.push({
          id: i,
          startPos: [
            (Math.random() - 0.5) * 0.3,
            0.5,
            (Math.random() - 0.5) * 0.3,
          ],
          endPos: [
            targetPosition[0] + Math.cos(angle) * 0.05,
            0.5,
            targetPosition[2] + Math.sin(angle) * 0.05,
          ],
          progress: -delay,
          color: ['#FFD700', '#D32F2F', '#1565C0', '#F5F5F5', '#4CAF50'][Math.floor(Math.random() * 5)],
        });
      }
      setChips(newChips);
      chipsRef.current = newChips;
    } else if (!active) {
      setChips([]);
      chipsRef.current = [];
    }
  }, [active, targetPosition]);

  useFrame(() => {
    if (chipsRef.current.length === 0) return;
    let anyActive = false;
    chipsRef.current.forEach((chip) => {
      if (chip.progress < 1) {
        chip.progress += 0.02;
        anyActive = true;
      }
    });
    if (!anyActive) return;
    // Force re-render
    setChips([...chipsRef.current]);
  });

  return (
    <group>
      {chips.map((chip) => {
        if (chip.progress < 0 || chip.progress > 1) return null;
        const t = Math.min(1, Math.max(0, chip.progress));
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const x = chip.startPos[0] + (chip.endPos[0] - chip.startPos[0]) * eased;
        const z = chip.startPos[2] + (chip.endPos[2] - chip.startPos[2]) * eased;
        const y = chip.startPos[1] + Math.sin(eased * Math.PI) * 0.5;
        return (
          <mesh key={chip.id} position={[x, y, z]}>
            <cylinderGeometry args={[0.02, 0.02, 0.008, 12]} />
            <meshStandardMaterial
              color={chip.color}
              metalness={0.3}
              roughness={0.4}
              emissive={chip.color}
              emissiveIntensity={0.2}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function WinText({ active }) {
  const ref = useRef();
  const startTimeRef = useRef(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      setVisible(true);
      startTimeRef.current = 0;
    }
  }, [active]);

  useFrame(({ clock }) => {
    if (!visible || !ref.current) return;

    if (startTimeRef.current === 0) {
      startTimeRef.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - startTimeRef.current;

    // Bounce in
    let scale;
    if (elapsed < 0.3) {
      const t = elapsed / 0.3;
      scale = t * 1.3;
    } else if (elapsed < 0.5) {
      const t = (elapsed - 0.3) / 0.2;
      scale = 1.3 - t * 0.3;
    } else if (elapsed < 2.5) {
      scale = 1.0;
    } else if (elapsed < 3.5) {
      scale = 1.0 - (elapsed - 2.5);
    } else {
      setVisible(false);
      return;
    }

    scale = Math.max(0, scale);
    ref.current.scale.set(scale, scale, scale);

    // Gentle bob
    if (elapsed > 0.5 && elapsed < 2.5) {
      ref.current.position.y = 1.5 + Math.sin(elapsed * 2) * 0.05;
    }
  });

  if (!visible) return null;

  return (
    <group ref={ref} position={[0, 1.5, 0]}>
      <Text
        fontSize={0.2}
        color="#FFD700"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.008}
        outlineColor="#8B6914"
      >
        YOU WIN!
      </Text>
      {/* Glow behind text */}
      <mesh position={[0, 0, -0.05]}>
        <planeGeometry args={[0.8, 0.3]} />
        <meshBasicMaterial
          color="#FFD700"
          transparent
          opacity={0.15}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function ScreenFlash({ active }) {
  const ref = useRef();
  const startTimeRef = useRef(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      setVisible(true);
      startTimeRef.current = 0;
    }
  }, [active]);

  useFrame(({ clock }) => {
    if (!visible || !ref.current) return;

    if (startTimeRef.current === 0) {
      startTimeRef.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - startTimeRef.current;

    if (elapsed < 0.1) {
      ref.current.material.opacity = 0.3;
    } else if (elapsed < 0.8) {
      ref.current.material.opacity = 0.3 * (1 - (elapsed - 0.1) / 0.7);
    } else {
      setVisible(false);
    }
  });

  if (!visible) return null;

  return (
    <mesh ref={ref} position={[0, 2, 2]} renderOrder={999}>
      <planeGeometry args={[20, 20]} />
      <meshBasicMaterial
        color="#FFD700"
        transparent
        opacity={0.3}
        depthTest={false}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}

function LoseEffect({ active }) {
  const ref = useRef();
  const startTimeRef = useRef(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      setVisible(true);
      startTimeRef.current = 0;
    }
  }, [active]);

  useFrame(({ clock }) => {
    if (!visible || !ref.current) return;

    if (startTimeRef.current === 0) {
      startTimeRef.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - startTimeRef.current;

    if (elapsed < 0.3) {
      ref.current.material.opacity = 0.15;
    } else if (elapsed < 1.5) {
      ref.current.material.opacity = 0.15 * (1 - (elapsed - 0.3) / 1.2);
    } else {
      setVisible(false);
    }
  });

  if (!visible) return null;

  return (
    <mesh ref={ref} position={[0, 2, 2]} renderOrder={999}>
      <planeGeometry args={[20, 20]} />
      <meshBasicMaterial
        color="#000000"
        transparent
        opacity={0.15}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

export default function WinEffects() {
  const gameState = useTableStore((s) => s.gameState);
  const mySeat = useTableStore((s) => s.mySeat);
  const [winActive, setWinActive] = useState(false);
  const [loseActive, setLoseActive] = useState(false);
  const [winnerTargetPos, setWinnerTargetPos] = useState(null);
  const prevPhaseRef = useRef(null);

  const phase = gameState?.phase;
  const handResult = gameState?.handResult;

  useEffect(() => {
    if (
      (phase === 'HandComplete' || phase === 'Showdown') &&
      prevPhaseRef.current !== phase &&
      handResult
    ) {
      const didWin = handResult.winners?.some((w) => w.seatIndex === mySeat);

      if (didWin) {
        setWinActive(true);
        // Calculate winner seat position for chip flying
        const SEAT_RADIUS = 1.7;
        const SEAT_COUNT = 9;
        if (mySeat >= 0) {
          const angle = (Math.PI / 2) - (mySeat * (2 * Math.PI / SEAT_COUNT));
          setWinnerTargetPos([
            Math.cos(angle) * SEAT_RADIUS,
            0,
            Math.sin(angle) * SEAT_RADIUS,
          ]);
        }
        setTimeout(() => setWinActive(false), 3500);
      } else {
        setLoseActive(true);
        setTimeout(() => setLoseActive(false), 2000);
      }
    }

    prevPhaseRef.current = phase;
  }, [phase, handResult, mySeat]);

  return (
    <group>
      <GoldenBurst active={winActive} />
      <FlyingChips active={winActive} targetPosition={winnerTargetPos} />
      <WinText active={winActive} />
      <ScreenFlash active={winActive} />
      <LoseEffect active={loseActive} />
    </group>
  );
}
