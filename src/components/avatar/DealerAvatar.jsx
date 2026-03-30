import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshStandardMaterial, MathUtils } from 'three';
import { useTableStore } from '../../store/tableStore';

const DEALER_CONFIG = {
  bodyType: 'male',
  skinTone: '#E8B88A',
  hairStyle: 'slickback',
  hairColor: '#1A1A1A',
  eyeColor: '#3B2F2F',
  topStyle: 'dress_shirt',
  topColor: '#FFFFFF',
  bottomStyle: 'slacks',
  bottomColor: '#1A1A1A',
};

const DEALER_POSITION = [0, 0, -2.2];
const DEALER_ROTATION = [0, 0, 0];

// Animation states
const ANIM = {
  IDLE: 'idle',
  SHUFFLE: 'shuffle',
  DEAL: 'deal',
  FLOP: 'flop',
  TURN_RIVER: 'turnRiver',
  COLLECT: 'collect',
  PUSH_POT: 'pushPot',
};

export default function DealerAvatar() {
  const groupRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();
  const leftForearmRef = useRef();
  const rightForearmRef = useRef();
  const leftHandRef = useRef();
  const rightHandRef = useRef();
  const headRef = useRef();
  const bodyRef = useRef();
  const cardDeckRef = useRef();

  // Animation state
  const animState = useRef(ANIM.IDLE);
  const animTime = useRef(0);
  const animDuration = useRef(0);
  const prevPhase = useRef(null);
  const idleTime = useRef(Math.random() * Math.PI * 2);

  // Track game phase for triggering animations
  const gameState = useTableStore((s) => s.gameState);
  const phase = gameState?.phase || 'WaitingForPlayers';
  const handNumber = gameState?.handNumber || 0;

  // Materials
  const skinMat = useMemo(() => new MeshStandardMaterial({
    color: DEALER_CONFIG.skinTone, roughness: 0.7, metalness: 0.05,
  }), []);
  const hairMat = useMemo(() => new MeshStandardMaterial({
    color: DEALER_CONFIG.hairColor, roughness: 0.8,
  }), []);
  const shirtMat = useMemo(() => new MeshStandardMaterial({
    color: '#FFFFFF', roughness: 0.6,
  }), []);
  const vestMat = useMemo(() => new MeshStandardMaterial({
    color: '#1A1A1A', roughness: 0.5,
  }), []);
  const pantsMat = useMemo(() => new MeshStandardMaterial({
    color: '#1A1A1A', roughness: 0.6,
  }), []);
  const eyeMat = useMemo(() => new MeshStandardMaterial({
    color: '#3B2F2F', roughness: 0.3, metalness: 0.1,
  }), []);
  const cardMat = useMemo(() => new MeshStandardMaterial({
    color: '#1a3a5c', roughness: 0.4,
  }), []);
  const cardBackMat = useMemo(() => new MeshStandardMaterial({
    color: '#8B0000', roughness: 0.4,
  }), []);

  // Trigger animations on phase changes
  useEffect(() => {
    if (phase === prevPhase.current) return;

    if (phase === 'PreFlop' && (prevPhase.current === 'WaitingForPlayers' || prevPhase.current === 'HandComplete')) {
      // New hand: shuffle then deal
      animState.current = ANIM.SHUFFLE;
      animTime.current = 0;
      animDuration.current = 1.5;
    } else if (phase === 'Flop') {
      animState.current = ANIM.FLOP;
      animTime.current = 0;
      animDuration.current = 1.2;
    } else if (phase === 'Turn' || phase === 'River') {
      animState.current = ANIM.TURN_RIVER;
      animTime.current = 0;
      animDuration.current = 0.8;
    } else if (phase === 'HandComplete') {
      animState.current = ANIM.COLLECT;
      animTime.current = 0;
      animDuration.current = 1.5;
    } else if (phase === 'Showdown') {
      animState.current = ANIM.PUSH_POT;
      animTime.current = 0;
      animDuration.current = 1.0;
    }

    prevPhase.current = phase;
  }, [phase, handNumber]);

  // Animation loop
  useFrame((_, delta) => {
    idleTime.current += delta;
    animTime.current += delta;

    const t = animDuration.current > 0
      ? Math.min(animTime.current / animDuration.current, 1)
      : 0;

    // Transition to deal after shuffle
    if (animState.current === ANIM.SHUFFLE && t >= 1) {
      animState.current = ANIM.DEAL;
      animTime.current = 0;
      animDuration.current = 2.0;
    }
    // Return to idle after other animations
    if (animState.current !== ANIM.SHUFFLE && animState.current !== ANIM.IDLE && t >= 1) {
      animState.current = ANIM.IDLE;
      animTime.current = 0;
    }

    // Apply animations
    const la = leftArmRef.current;
    const ra = rightArmRef.current;
    const lf = leftForearmRef.current;
    const rf = rightForearmRef.current;
    const lh = leftHandRef.current;
    const rh = rightHandRef.current;
    const head = headRef.current;
    const deck = cardDeckRef.current;

    if (!la || !ra) return;

    switch (animState.current) {
      case ANIM.IDLE: {
        // Subtle breathing / idle sway
        const breathe = Math.sin(idleTime.current * 1.5) * 0.02;
        const sway = Math.sin(idleTime.current * 0.8) * 0.01;

        la.rotation.x = -0.1 + breathe;
        la.rotation.z = 0.15;
        ra.rotation.x = -0.1 + breathe;
        ra.rotation.z = -0.15;

        if (lf) { lf.rotation.x = -0.3; lf.rotation.z = 0; }
        if (rf) { rf.rotation.x = -0.3; rf.rotation.z = 0; }

        if (head) {
          head.rotation.y = Math.sin(idleTime.current * 0.4) * 0.05;
          head.rotation.x = sway;
        }

        if (deck) deck.visible = false;
        break;
      }

      case ANIM.SHUFFLE: {
        // Shuffle animation: hands come together, riffle motion
        const shuffleT = t;
        const cycle = Math.sin(shuffleT * Math.PI * 6) * 0.5 + 0.5; // 3 riffles

        // Bring arms forward and together
        const armForward = Math.sin(shuffleT * Math.PI) * 0.4;

        la.rotation.x = -0.5 - armForward;
        la.rotation.z = 0.3 - shuffleT * 0.25;
        ra.rotation.x = -0.5 - armForward;
        ra.rotation.z = -0.3 + shuffleT * 0.25;

        if (lf) {
          lf.rotation.x = -0.8 - cycle * 0.3;
          lf.rotation.z = -0.1;
        }
        if (rf) {
          rf.rotation.x = -0.8 - cycle * 0.3;
          rf.rotation.z = 0.1;
        }

        // Hands rotate during riffle
        if (lh) lh.rotation.z = cycle * 0.2 - 0.1;
        if (rh) rh.rotation.z = -cycle * 0.2 + 0.1;

        // Head looks down at hands
        if (head) {
          head.rotation.x = 0.15;
          head.rotation.y = 0;
        }

        // Show card deck in hands
        if (deck) {
          deck.visible = true;
          deck.position.y = -0.02 + cycle * 0.02;
          deck.rotation.y = cycle * 0.1 - 0.05;
        }
        break;
      }

      case ANIM.DEAL: {
        // Deal animation: alternating arm extends outward to "toss" cards
        const dealT = t;
        const cardIndex = Math.floor(dealT * 16); // dealing ~16 cards (8 players x 2)
        const isLeftArm = cardIndex % 2 === 0;
        const tossPhase = (dealT * 16) % 1; // 0-1 within each card toss

        // Toss motion: arm extends, flicks, returns
        const tossForward = Math.sin(tossPhase * Math.PI) * 0.35;
        const tossFlick = Math.sin(tossPhase * Math.PI * 2) * 0.15;

        if (isLeftArm) {
          la.rotation.x = -0.4 - tossForward;
          la.rotation.z = 0.1 + tossFlick;
          ra.rotation.x = -0.3;
          ra.rotation.z = -0.15;
          if (lf) lf.rotation.x = -0.6 - tossForward * 0.5;
          if (rf) rf.rotation.x = -0.4;
        } else {
          ra.rotation.x = -0.4 - tossForward;
          ra.rotation.z = -0.1 - tossFlick;
          la.rotation.x = -0.3;
          la.rotation.z = 0.15;
          if (rf) rf.rotation.x = -0.6 - tossForward * 0.5;
          if (lf) lf.rotation.x = -0.4;
        }

        // Head follows the dealing direction
        if (head) {
          const lookAngle = ((cardIndex % 9) / 8 - 0.5) * 0.6;
          head.rotation.y = MathUtils.lerp(head.rotation.y, lookAngle, 0.1);
          head.rotation.x = 0.1;
        }

        if (deck) {
          deck.visible = true;
          deck.position.y = -0.02;
        }
        break;
      }

      case ANIM.FLOP: {
        // Flop: dramatic sweep of 3 community cards
        const flopT = t;

        // Burn card motion (first 30%)
        if (flopT < 0.3) {
          const burnT = flopT / 0.3;
          ra.rotation.x = -0.3 - Math.sin(burnT * Math.PI) * 0.2;
          ra.rotation.z = -0.15;
          la.rotation.x = -0.2;
          la.rotation.z = 0.15;
          if (rf) rf.rotation.x = -0.5 - Math.sin(burnT * Math.PI) * 0.3;
        }
        // Deal 3 cards (30-100%)
        else {
          const dealT = (flopT - 0.3) / 0.7;
          const sweepAngle = Math.sin(dealT * Math.PI) * 0.5;

          ra.rotation.x = -0.5 - sweepAngle;
          ra.rotation.z = -0.15 + dealT * 0.1;
          la.rotation.x = -0.3;
          la.rotation.z = 0.2;

          if (rf) rf.rotation.x = -0.7 - sweepAngle * 0.3;
          if (rh) rh.rotation.z = -dealT * 0.15;
        }

        if (head) {
          head.rotation.x = 0.1;
          head.rotation.y = 0;
        }

        if (deck) deck.visible = true;
        break;
      }

      case ANIM.TURN_RIVER: {
        // Single card deal - quick flick
        const turnT = t;
        const flick = Math.sin(turnT * Math.PI);

        ra.rotation.x = -0.3 - flick * 0.4;
        ra.rotation.z = -0.15;
        la.rotation.x = -0.2;
        la.rotation.z = 0.15;

        if (rf) rf.rotation.x = -0.5 - flick * 0.3;
        if (rh) rh.rotation.z = -flick * 0.1;

        if (head) {
          head.rotation.x = 0.08;
          head.rotation.y = 0;
        }

        if (deck) deck.visible = true;
        break;
      }

      case ANIM.COLLECT: {
        // Collect cards: arms sweep wide inward
        const collectT = t;

        // Phase 1: arms sweep outward (0-40%)
        if (collectT < 0.4) {
          const sweepOut = collectT / 0.4;
          la.rotation.x = -0.3 - sweepOut * 0.3;
          la.rotation.z = 0.3 + sweepOut * 0.5;
          ra.rotation.x = -0.3 - sweepOut * 0.3;
          ra.rotation.z = -0.3 - sweepOut * 0.5;
          if (lf) lf.rotation.x = -0.5 - sweepOut * 0.2;
          if (rf) rf.rotation.x = -0.5 - sweepOut * 0.2;
        }
        // Phase 2: arms sweep inward to gather (40-80%)
        else if (collectT < 0.8) {
          const sweepIn = (collectT - 0.4) / 0.4;
          const eased = 1 - Math.pow(1 - sweepIn, 2);
          la.rotation.x = -0.6 + eased * 0.3;
          la.rotation.z = 0.8 - eased * 0.7;
          ra.rotation.x = -0.6 + eased * 0.3;
          ra.rotation.z = -0.8 + eased * 0.7;
          if (lf) lf.rotation.x = -0.7 + eased * 0.3;
          if (rf) rf.rotation.x = -0.7 + eased * 0.3;
        }
        // Phase 3: stack cards (80-100%)
        else {
          const stackT = (collectT - 0.8) / 0.2;
          la.rotation.x = -0.3 - (1 - stackT) * 0.1;
          la.rotation.z = 0.1;
          ra.rotation.x = -0.3 - (1 - stackT) * 0.1;
          ra.rotation.z = -0.1;
          if (lf) lf.rotation.x = -0.4;
          if (rf) rf.rotation.x = -0.4;
        }

        if (head) {
          head.rotation.x = 0.1;
          head.rotation.y = Math.sin(collectT * Math.PI * 2) * 0.1;
        }

        if (deck) deck.visible = false;
        break;
      }

      case ANIM.PUSH_POT: {
        // Push pot to winner: both arms push forward
        const pushT = t;
        const pushForward = Math.sin(pushT * Math.PI) * 0.5;

        la.rotation.x = -0.3 - pushForward;
        la.rotation.z = 0.1;
        ra.rotation.x = -0.3 - pushForward;
        ra.rotation.z = -0.1;

        if (lf) lf.rotation.x = -0.5 - pushForward * 0.3;
        if (rf) rf.rotation.x = -0.5 - pushForward * 0.3;

        if (head) {
          head.rotation.x = 0.05 + pushForward * 0.1;
          head.rotation.y = 0;
        }

        if (deck) deck.visible = false;
        break;
      }
    }
  });

  return (
    <group ref={groupRef} position={DEALER_POSITION} rotation={DEALER_ROTATION}>
      {/* Body / torso with vest */}
      <group ref={bodyRef}>
        {/* Shirt */}
        <mesh position={[0, 0.65, 0]}>
          <boxGeometry args={[0.38, 0.42, 0.2]} />
          <primitive object={shirtMat} attach="material" />
        </mesh>
        {/* Vest */}
        <mesh position={[0, 0.65, 0.001]}>
          <boxGeometry args={[0.40, 0.42, 0.21]} />
          <primitive object={vestMat} attach="material" />
        </mesh>
        {/* Vest V-neckline left */}
        <mesh position={[-0.08, 0.78, 0.112]}>
          <boxGeometry args={[0.12, 0.18, 0.005]} />
          <primitive object={vestMat} attach="material" />
        </mesh>
        {/* Vest V-neckline right */}
        <mesh position={[0.08, 0.78, 0.112]}>
          <boxGeometry args={[0.12, 0.18, 0.005]} />
          <primitive object={vestMat} attach="material" />
        </mesh>
        {/* Bow tie */}
        <mesh position={[0, 0.86, 0.115]}>
          <boxGeometry args={[0.07, 0.025, 0.015]} />
          <meshStandardMaterial color="#8B0000" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.86, 0.125]}>
          <boxGeometry args={[0.02, 0.02, 0.01]} />
          <meshStandardMaterial color="#6B0000" roughness={0.4} />
        </mesh>
      </group>

      {/* Pants */}
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.34, 0.3, 0.18]} />
        <primitive object={pantsMat} attach="material" />
      </mesh>
      {/* Left leg */}
      <mesh position={[-0.09, 0.08, 0]}>
        <boxGeometry args={[0.14, 0.35, 0.16]} />
        <primitive object={pantsMat} attach="material" />
      </mesh>
      {/* Right leg */}
      <mesh position={[0.09, 0.08, 0]}>
        <boxGeometry args={[0.14, 0.35, 0.16]} />
        <primitive object={pantsMat} attach="material" />
      </mesh>

      {/* Head */}
      <group ref={headRef} position={[0, 1.0, 0]}>
        {/* Head shape */}
        <mesh>
          <sphereGeometry args={[0.12, 16, 16]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        {/* Hair */}
        <mesh position={[0, 0.06, -0.01]}>
          <sphereGeometry args={[0.125, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <primitive object={hairMat} attach="material" />
        </mesh>
        {/* Eyes */}
        <mesh position={[-0.04, 0.02, 0.1]}>
          <sphereGeometry args={[0.015, 8, 8]} />
          <meshStandardMaterial color="#FFFFFF" />
        </mesh>
        <mesh position={[0.04, 0.02, 0.1]}>
          <sphereGeometry args={[0.015, 8, 8]} />
          <meshStandardMaterial color="#FFFFFF" />
        </mesh>
        {/* Pupils */}
        <mesh position={[-0.04, 0.02, 0.115]}>
          <sphereGeometry args={[0.008, 8, 8]} />
          <primitive object={eyeMat} attach="material" />
        </mesh>
        <mesh position={[0.04, 0.02, 0.115]}>
          <sphereGeometry args={[0.008, 8, 8]} />
          <primitive object={eyeMat} attach="material" />
        </mesh>
        {/* Nose */}
        <mesh position={[0, -0.01, 0.11]}>
          <boxGeometry args={[0.02, 0.03, 0.02]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        {/* Mouth */}
        <mesh position={[0, -0.045, 0.1]}>
          <boxGeometry args={[0.04, 0.008, 0.01]} />
          <meshStandardMaterial color="#B35A5A" roughness={0.6} />
        </mesh>
      </group>

      {/* Neck */}
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.08, 8]} />
        <primitive object={skinMat} attach="material" />
      </mesh>

      {/* LEFT ARM (shoulder -> upper arm -> forearm -> hand) */}
      <group ref={leftArmRef} position={[-0.24, 0.82, 0]}>
        {/* Upper arm (shirt sleeve) */}
        <mesh position={[0, -0.1, 0]}>
          <boxGeometry args={[0.1, 0.2, 0.1]} />
          <primitive object={shirtMat} attach="material" />
        </mesh>
        {/* Forearm */}
        <group ref={leftForearmRef} position={[0, -0.22, 0]}>
          <mesh position={[0, -0.08, 0]}>
            <boxGeometry args={[0.08, 0.18, 0.08]} />
            <primitive object={shirtMat} attach="material" />
          </mesh>
          {/* Hand */}
          <group ref={leftHandRef} position={[0, -0.2, 0.02]}>
            <mesh>
              <boxGeometry args={[0.06, 0.08, 0.04]} />
              <primitive object={skinMat} attach="material" />
            </mesh>
            {/* Fingers */}
            <mesh position={[0, -0.05, 0]}>
              <boxGeometry args={[0.055, 0.03, 0.03]} />
              <primitive object={skinMat} attach="material" />
            </mesh>
          </group>
        </group>
      </group>

      {/* RIGHT ARM */}
      <group ref={rightArmRef} position={[0.24, 0.82, 0]}>
        {/* Upper arm */}
        <mesh position={[0, -0.1, 0]}>
          <boxGeometry args={[0.1, 0.2, 0.1]} />
          <primitive object={shirtMat} attach="material" />
        </mesh>
        {/* Forearm */}
        <group ref={rightForearmRef} position={[0, -0.22, 0]}>
          <mesh position={[0, -0.08, 0]}>
            <boxGeometry args={[0.08, 0.18, 0.08]} />
            <primitive object={shirtMat} attach="material" />
          </mesh>
          {/* Hand */}
          <group ref={rightHandRef} position={[0, -0.2, 0.02]}>
            <mesh>
              <boxGeometry args={[0.06, 0.08, 0.04]} />
              <primitive object={skinMat} attach="material" />
            </mesh>
            {/* Fingers */}
            <mesh position={[0, -0.05, 0]}>
              <boxGeometry args={[0.055, 0.03, 0.03]} />
              <primitive object={skinMat} attach="material" />
            </mesh>
          </group>
        </group>
      </group>

      {/* Card deck (visible during shuffle/deal) */}
      <group ref={cardDeckRef} position={[0, 0.42, 0.25]} visible={false}>
        {/* Stack of cards */}
        {Array.from({ length: 5 }, (_, i) => (
          <mesh key={i} position={[0, i * 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <boxGeometry args={[0.06, 0.085, 0.002]} />
            <primitive object={i % 2 === 0 ? cardBackMat : cardMat} attach="material" />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export { DEALER_POSITION, DEALER_ROTATION };
