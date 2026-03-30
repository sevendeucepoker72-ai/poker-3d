import { memo } from 'react';

const SceneLighting = memo(function SceneLighting() {
  return (
    <>
      {/* Overhead key light */}
      <spotLight
        position={[0, 6, 0]}
        angle={1.0}
        penumbra={0.2}
        intensity={18}
        color="#FFFFFF"
        castShadow
      />

      {/* Front flood */}
      <spotLight position={[0, 5, 6]} angle={0.9} penumbra={0.3} intensity={10} color="#FFFFFF" />

      {/* Left flood */}
      <spotLight position={[-5, 5, 0]} angle={0.9} penumbra={0.3} intensity={8} color="#FFF8F0" />

      {/* Right flood */}
      <spotLight position={[5, 5, 0]} angle={0.9} penumbra={0.3} intensity={8} color="#FFF8F0" />

      {/* Back flood for dealer */}
      <spotLight position={[0, 5, -5]} angle={0.9} penumbra={0.3} intensity={8} color="#F0F0FF" />

      {/* Ambient fill — lights the whole room */}
      <ambientLight intensity={6} color="#c8d0ff" />

      {/* Table fill */}
      <pointLight position={[0, 3, 0]} intensity={4} color="#FFFFFF" distance={8} />

      {/* Room corner fills — illuminate the floor and walls */}
      <pointLight position={[ 6, 4,  6]} intensity={10} color="#d0d8ff" distance={18} />
      <pointLight position={[-6, 4,  6]} intensity={10} color="#d0d8ff" distance={18} />
      <pointLight position={[ 6, 4, -6]} intensity={10} color="#d0d8ff" distance={18} />
      <pointLight position={[-6, 4, -6]} intensity={10} color="#d0d8ff" distance={18} />

      {/* Overhead lamp (decorative) */}
      <group position={[0, 3.2, 0]}>
        <mesh>
          <coneGeometry args={[0.7, 0.35, 24, 1, true]} />
          <meshStandardMaterial color="#5C3A1A" side={2} roughness={0.7} metalness={0.3} />
        </mesh>
        <mesh position={[0, -0.08, 0]}>
          <coneGeometry args={[0.65, 0.15, 24, 1, true]} />
          <meshStandardMaterial
            color="#FFF5E0"
            emissive="#FFF5E0"
            emissiveIntensity={1}
            side={2}
            transparent
            opacity={0.6}
          />
        </mesh>
        <mesh position={[0, 0.6, 0]}>
          <cylinderGeometry args={[0.004, 0.004, 1.2, 4]} />
          <meshStandardMaterial color="#333" />
        </mesh>
        <mesh position={[0, -0.17, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.7, 0.015, 8, 32]} />
          <meshStandardMaterial color="#B8860B" metalness={0.6} roughness={0.3} />
        </mesh>
      </group>
    </>
  );
});

export default SceneLighting;
