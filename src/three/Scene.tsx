import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei';
import { FitCanvas } from './FitCanvas';
import { useStageTheme } from '../theme/store';
import { stageColors } from './theme';

type Props = {
  camera: [number, number, number];
  children: ReactNode;
};

/** Shared stage: warm paper backdrop, soft studio light, orbit/zoom. */
export function Scene({ camera, children }: Props) {
  const theme = useStageTheme();
  const c = stageColors(theme);

  return (
    <Canvas
      dpr={[1, 2]}
      // “copy this step as an image” reads the canvas after the frame is drawn,
      // which needs the drawing buffer kept around
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ position: camera, fov: 45, near: 0.1, far: 300 }}
    >
      <FitCanvas />
      <color attach="background" args={[c.paper]} />
      <fog attach="fog" args={[c.paper, 34, 90]} />

      <ambientLight intensity={c.ambient} />
      <hemisphereLight args={[c.sky, c.ground, c.hemi]} />
      <directionalLight position={[7, 11, 10]} intensity={c.key} />
      <directionalLight position={[-9, 6, 7]} intensity={0.4} />

      <Grid
        position={[0, -4.8, 0]}
        infiniteGrid
        cellSize={1}
        cellColor={c.grid}
        sectionSize={5}
        sectionColor={c.gridSection}
        fadeDistance={40}
        fadeStrength={1.5}
      />
      <ContactShadows position={[0, -4.7, 0]} opacity={c.shadowOpacity} scale={34} blur={2.8} far={7} color={c.shadow} />

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
