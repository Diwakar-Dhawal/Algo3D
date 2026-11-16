import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei';
import { FitCanvas } from './FitCanvas';

type Props = {
  camera: [number, number, number];
  children: ReactNode;
};

const PAPER = '#f7f3ea';

/** Shared stage: warm paper backdrop, soft studio light, orbit/zoom. */
export function Scene({ camera, children }: Props) {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: camera, fov: 45, near: 0.1, far: 300 }}>
      <FitCanvas />
      <color attach="background" args={[PAPER]} />
      <fog attach="fog" args={[PAPER, 34, 90]} />

      <ambientLight intensity={0.95} />
      <hemisphereLight args={['#ffffff', '#e6dcc8', 0.7]} />
      <directionalLight position={[7, 11, 10]} intensity={1.35} />
      <directionalLight position={[-9, 6, 7]} intensity={0.4} />

      <Grid
        position={[0, -4.8, 0]}
        infiniteGrid
        cellSize={1}
        cellColor="#eae1cd"
        sectionSize={5}
        sectionColor="#ddd0b6"
        fadeDistance={40}
        fadeStrength={1.5}
      />
      <ContactShadows position={[0, -4.7, 0]} opacity={0.22} scale={34} blur={2.8} far={7} color="#8a7a5c" />

      {children}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        rotateSpeed={0.7}
        zoomSpeed={0.8}
        minDistance={4}
        maxDistance={40}
        maxPolarAngle={Math.PI * 0.92}
      />
    </Canvas>
  );
}
