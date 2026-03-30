import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshStandardMaterial } from 'three';

// Procedural avatar built from primitives — replace with GLB models later
export default function AvatarModel({ config, position = [0, 0, 0], rotation = [0, 0, 0], animate = true }) {
  const groupRef = useRef();
  const idleTime = useRef(Math.random() * Math.PI * 2);

  const skinMat = useMemo(() => new MeshStandardMaterial({
    color: config.skinTone,
    roughness: 0.7,
    metalness: 0.05,
  }), [config.skinTone]);

  const hairMat = useMemo(() => new MeshStandardMaterial({
    color: config.hairColor,
    roughness: 0.8,
  }), [config.hairColor]);

  const eyeMat = useMemo(() => new MeshStandardMaterial({
    color: config.eyeColor,
    roughness: 0.3,
    metalness: 0.1,
  }), [config.eyeColor]);

  const topMat = useMemo(() => new MeshStandardMaterial({
    color: config.topColor,
    roughness: 0.6,
  }), [config.topColor]);

  const bottomMat = useMemo(() => new MeshStandardMaterial({
    color: config.bottomColor,
    roughness: 0.6,
  }), [config.bottomColor]);

  // Face shape modifiers
  const face = config.faceShape;
  const jawScale = 0.8 + face.jawWidth * 0.4;
  const noseScale = 0.6 + face.noseLength * 0.4;
  const eyeScale = 0.08 + face.eyeSize * 0.06;

  // Idle breathing animation
  useFrame((_, delta) => {
    if (!animate || !groupRef.current) return;
    idleTime.current += delta;
    groupRef.current.position.y = position[1] + Math.sin(idleTime.current * 1.5) * 0.01;
  });

  const isFemale = config.bodyType?.includes('female');
  const torsoWidth = isFemale ? 0.32 : 0.38;
  const hipWidth = isFemale ? 0.34 : 0.3;
  const shoulderY = 0.65;

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      {/* Head */}
      <group position={[0, 1.05, 0]}>
        {/* Skull */}
        <mesh material={skinMat}>
          <sphereGeometry args={[0.18, 16, 16]} />
        </mesh>

        {/* Jaw */}
        <mesh position={[0, -0.1, 0.02]} material={skinMat} scale={[jawScale, 0.7, 0.85]}>
          <boxGeometry args={[0.22, 0.12, 0.18]} />
        </mesh>

        {/* Eyes */}
        <mesh position={[-0.065, 0.02, 0.155]} material={eyeMat}>
          <sphereGeometry args={[eyeScale, 8, 8]} />
        </mesh>
        <mesh position={[0.065, 0.02, 0.155]} material={eyeMat}>
          <sphereGeometry args={[eyeScale, 8, 8]} />
        </mesh>

        {/* Pupils */}
        <mesh position={[-0.065, 0.02, 0.155 + eyeScale * 0.8]}>
          <sphereGeometry args={[eyeScale * 0.5, 6, 6]} />
          <meshStandardMaterial color="#111" />
        </mesh>
        <mesh position={[0.065, 0.02, 0.155 + eyeScale * 0.8]}>
          <sphereGeometry args={[eyeScale * 0.5, 6, 6]} />
          <meshStandardMaterial color="#111" />
        </mesh>

        {/* Nose */}
        <mesh position={[0, -0.02, 0.17]} material={skinMat} scale={[0.6, noseScale, 1]}>
          <boxGeometry args={[0.05, 0.08, 0.05]} />
        </mesh>

        {/* Mouth */}
        <mesh position={[0, -0.1, 0.155]} scale={[1, face.lipFullness * 0.5 + 0.5, 1]}>
          <boxGeometry args={[0.08, 0.02, 0.02]} />
          <meshStandardMaterial color="#B5585A" />
        </mesh>

        {/* Eyebrows */}
        <mesh position={[-0.065, 0.06 + face.browHeight * 0.04, 0.155]}>
          <boxGeometry args={[0.06, 0.012, 0.01]} />
          <meshStandardMaterial color={config.hairColor} />
        </mesh>
        <mesh position={[0.065, 0.06 + face.browHeight * 0.04, 0.155]}>
          <boxGeometry args={[0.06, 0.012, 0.01]} />
          <meshStandardMaterial color={config.hairColor} />
        </mesh>

        {/* Ears */}
        <mesh position={[-0.18, 0, 0]} material={skinMat}>
          <sphereGeometry args={[0.04, 6, 6]} />
        </mesh>
        <mesh position={[0.18, 0, 0]} material={skinMat}>
          <sphereGeometry args={[0.04, 6, 6]} />
        </mesh>

        {/* Hair */}
        <HairMesh style={config.hairStyle} material={hairMat} />
      </group>

      {/* Neck */}
      <mesh position={[0, 0.9, 0]} material={skinMat}>
        <cylinderGeometry args={[0.06, 0.07, 0.1, 8]} />
      </mesh>

      {/* Torso (clothing) */}
      <mesh position={[0, shoulderY, 0]} material={topMat}>
        <boxGeometry args={[torsoWidth, 0.4, 0.2]} />
      </mesh>

      {/* Shoulders */}
      <mesh position={[-torsoWidth / 2 - 0.05, shoulderY + 0.15, 0]} material={topMat}>
        <sphereGeometry args={[0.06, 8, 8]} />
      </mesh>
      <mesh position={[torsoWidth / 2 + 0.05, shoulderY + 0.15, 0]} material={topMat}>
        <sphereGeometry args={[0.06, 8, 8]} />
      </mesh>

      {/* Arms */}
      <mesh position={[-torsoWidth / 2 - 0.05, 0.52, 0]} material={skinMat}>
        <boxGeometry args={[0.08, 0.3, 0.08]} />
      </mesh>
      <mesh position={[torsoWidth / 2 + 0.05, 0.52, 0]} material={skinMat}>
        <boxGeometry args={[0.08, 0.3, 0.08]} />
      </mesh>

      {/* Hands */}
      <mesh position={[-torsoWidth / 2 - 0.05, 0.36, 0]} material={skinMat}>
        <sphereGeometry args={[0.04, 6, 6]} />
      </mesh>
      <mesh position={[torsoWidth / 2 + 0.05, 0.36, 0]} material={skinMat}>
        <sphereGeometry args={[0.04, 6, 6]} />
      </mesh>

      {/* Hips / Bottom */}
      <mesh position={[0, 0.38, 0]} material={bottomMat}>
        <boxGeometry args={[hipWidth, 0.15, 0.2]} />
      </mesh>

      {/* Accessory */}
      <AccessoryMesh type={config.accessory} headPosition={[0, 1.05, 0]} />
    </group>
  );
}

function HairMesh({ style, material }) {
  switch (style) {
    case 'short':
      return (
        <mesh position={[0, 0.08, -0.01]} material={material}>
          <sphereGeometry args={[0.19, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        </mesh>
      );
    case 'medium':
      return (
        <group>
          <mesh position={[0, 0.06, -0.01]} material={material}>
            <sphereGeometry args={[0.2, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
          </mesh>
          <mesh position={[0, -0.05, -0.08]} material={material}>
            <boxGeometry args={[0.35, 0.15, 0.08]} />
          </mesh>
        </group>
      );
    case 'long':
      return (
        <group>
          <mesh position={[0, 0.06, -0.01]} material={material}>
            <sphereGeometry args={[0.2, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
          </mesh>
          <mesh position={[0, -0.12, -0.08]} material={material}>
            <boxGeometry args={[0.36, 0.3, 0.08]} />
          </mesh>
        </group>
      );
    case 'buzz':
      return (
        <mesh position={[0, 0.06, 0]} material={material}>
          <sphereGeometry args={[0.185, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        </mesh>
      );
    case 'slickback':
      return (
        <group>
          <mesh position={[0, 0.08, -0.02]} material={material}>
            <sphereGeometry args={[0.19, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          </mesh>
          <mesh position={[0, 0.02, -0.13]} material={material}>
            <boxGeometry args={[0.2, 0.12, 0.08]} />
          </mesh>
        </group>
      );
    case 'ponytail':
      return (
        <group>
          <mesh position={[0, 0.06, -0.01]} material={material}>
            <sphereGeometry args={[0.2, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          </mesh>
          <mesh position={[0, -0.02, -0.2]} material={material}>
            <cylinderGeometry args={[0.04, 0.03, 0.2, 8]} />
          </mesh>
        </group>
      );
    case 'afro':
      return (
        <mesh position={[0, 0.08, 0]} material={material}>
          <sphereGeometry args={[0.26, 16, 16]} />
        </mesh>
      );
    case 'bald':
    default:
      return null;
  }
}

function AccessoryMesh({ type, headPosition }) {
  const [hx, hy, hz] = headPosition;

  switch (type) {
    case 'sunglasses':
    case 'aviators':
      return (
        <group position={[hx, hy + 0.02, hz + 0.17]}>
          {/* Frame */}
          <mesh>
            <boxGeometry args={[0.22, 0.005, 0.005]} />
            <meshStandardMaterial color="#111" metalness={0.8} />
          </mesh>
          {/* Left lens */}
          <mesh position={[-0.06, 0, 0.005]}>
            <boxGeometry args={[0.07, 0.04, 0.005]} />
            <meshStandardMaterial color="#222" metalness={0.3} roughness={0.2} />
          </mesh>
          {/* Right lens */}
          <mesh position={[0.06, 0, 0.005]}>
            <boxGeometry args={[0.07, 0.04, 0.005]} />
            <meshStandardMaterial color="#222" metalness={0.3} roughness={0.2} />
          </mesh>
        </group>
      );

    case 'cap':
      return (
        <group position={[hx, hy + 0.15, hz]}>
          <mesh>
            <cylinderGeometry args={[0.2, 0.2, 0.08, 16]} />
            <meshStandardMaterial color="#1A1A2E" />
          </mesh>
          <mesh position={[0, -0.02, 0.18]}>
            <boxGeometry args={[0.16, 0.02, 0.12]} />
            <meshStandardMaterial color="#1A1A2E" />
          </mesh>
        </group>
      );

    case 'visor':
      return (
        <group position={[hx, hy + 0.16, hz]}>
          <mesh position={[0, 0, 0.15]}>
            <boxGeometry args={[0.22, 0.02, 0.12]} />
            <meshStandardMaterial color="#228B22" />
          </mesh>
          <mesh rotation={[0, 0, 0]}>
            <torusGeometry args={[0.19, 0.01, 8, 16, Math.PI]} />
            <meshStandardMaterial color="#228B22" />
          </mesh>
        </group>
      );

    case 'gold_chain':
      return (
        <mesh position={[hx, hy - 0.28, hz + 0.1]}>
          <torusGeometry args={[0.12, 0.008, 8, 24]} />
          <meshStandardMaterial color="#FFD700" metalness={0.9} roughness={0.1} />
        </mesh>
      );

    case 'headphones':
      return (
        <group position={[hx, hy + 0.05, hz]}>
          <mesh position={[0, 0.12, 0]}>
            <torusGeometry args={[0.18, 0.015, 8, 16, Math.PI]} />
            <meshStandardMaterial color="#333" />
          </mesh>
          <mesh position={[-0.18, 0, 0]}>
            <boxGeometry args={[0.04, 0.08, 0.06]} />
            <meshStandardMaterial color="#333" />
          </mesh>
          <mesh position={[0.18, 0, 0]}>
            <boxGeometry args={[0.04, 0.08, 0.06]} />
            <meshStandardMaterial color="#333" />
          </mesh>
        </group>
      );

    case 'beanie':
      return (
        <group position={[hx, hy + 0.12, hz]}>
          <mesh>
            <sphereGeometry args={[0.2, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <meshStandardMaterial color="#8B0000" />
          </mesh>
          <mesh position={[0, -0.03, 0]}>
            <cylinderGeometry args={[0.2, 0.19, 0.06, 16]} />
            <meshStandardMaterial color="#6B0000" />
          </mesh>
        </group>
      );

    default:
      return null;
  }
}
