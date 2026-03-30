import { useRef, useMemo, memo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { AdditiveBlending } from 'three';
import PokerTable from './PokerTable';
import SceneLighting from './SceneLighting';
import WinEffects from '../fx/WinEffects';

const DustParticles = memo(function DustParticles() {
  const count = 60;
  const meshRef = useRef();

  const particles = useMemo(() => {
    const pos = [];
    const speeds = [];
    for (let i = 0; i < count; i++) {
      pos.push(
        (Math.random() - 0.5) * 8,
        Math.random() * 4 + 0.5,
        (Math.random() - 0.5) * 8
      );
      speeds.push(
        (Math.random() - 0.5) * 0.002,
        (Math.random() - 0.5) * 0.001,
        (Math.random() - 0.5) * 0.002
      );
    }
    return { positions: new Float32Array(pos), speeds };
  }, []);

  useFrame(() => {
    if (!meshRef.current) return;
    const posAttr = meshRef.current.geometry.attributes.position;
    const arr = posAttr.array;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      arr[idx] += particles.speeds[idx];
      arr[idx + 1] += particles.speeds[idx + 1];
      arr[idx + 2] += particles.speeds[idx + 2];

      // Wrap around
      if (arr[idx] > 4) arr[idx] = -4;
      if (arr[idx] < -4) arr[idx] = 4;
      if (arr[idx + 1] > 4.5) arr[idx + 1] = 0.5;
      if (arr[idx + 1] < 0.5) arr[idx + 1] = 4.5;
      if (arr[idx + 2] > 4) arr[idx + 2] = -4;
      if (arr[idx + 2] < -4) arr[idx + 2] = 4;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={particles.positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#FFF5E0"
        size={0.015}
        transparent
        opacity={0.25}
        sizeAttenuation
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
});

const EnvironmentFloor = memo(function EnvironmentFloor() {
  return (
    <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[10, 64]} />
      <meshStandardMaterial
        color="#1e1e34"
        roughness={0.95}
        metalness={0.05}
      />
    </mesh>
  );
});

const GameScene = memo(function GameScene() {
  return (
    <Canvas shadows style={{ background: '#151528', position: 'absolute', inset: 0 }}>
      <PerspectiveCamera makeDefault position={[0, 3.5, 4]} fov={45} />
      <OrbitControls
        target={[0, 0.5, 0]}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={2}
        maxDistance={8}
        enablePan={false}
      />
      <SceneLighting />
      {/* No fog - keep scene bright and visible */}
      <EnvironmentFloor />
      <DustParticles />
      <PokerTable />
      <WinEffects />
    </Canvas>
  );
});

export default GameScene;
