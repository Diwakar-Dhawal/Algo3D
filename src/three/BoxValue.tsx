import { useState } from 'react';
import { Edges } from '@react-three/drei';
import type { Mark } from '../topics/types';
import { Label } from './Label';

export const MARK_COLOR: Record<Mark, string> = {
  idle: '#f0e9d9',
  compare: '#e3c98f',
  swap: '#d8a48d',
  sorted: '#bcc7ae',
  found: '#a8c4b6',
  active: '#c9a227',
  visited: '#d6cbb4',
  frontier: '#dcb87f',
  path: '#cbb392',
  inserted: '#b8c9a8',
  removed: '#d19a83',
};

type Props = {
  value: number | string;
  mark?: Mark;
  position?: [number, number, number];
  size?: [number, number, number];
  labelScale?: number;
  labelColor?: string;
  opacity?: number;
  rotation?: [number, number, number];
  onInspect?: () => void;
};

/** A paper-and-ink block. Hover to lift it, click to inspect. */
export function BoxValue({
  value,
  mark = 'idle',
  position = [0, 0, 0],
  size = [1.1, 1.1, 1.1],
  labelScale = 0.85,
  labelColor = '#221c14',
  opacity = 1,
  rotation = [0, 0, 0],
  onInspect,
}: Props) {
  const [hover, setHover] = useState(false);
  const base = MARK_COLOR[mark] ?? MARK_COLOR.idle;
  const lit = mark !== 'idle';

  return (
    <group position={position} rotation={rotation}>
      <mesh
        scale={hover ? 1.06 : 1}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = onInspect ? 'pointer' : 'grab';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = 'auto';
        }}
        onClick={(e) => {
          e.stopPropagation();
          onInspect?.();
        }}
      >
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={base}
          emissive={base}
          emissiveIntensity={lit ? 0.16 : 0.04}
          roughness={0.62}
          metalness={0.08}
          transparent={opacity < 1}
          opacity={opacity}
        />
        <Edges
          scale={1.001}
          threshold={15}
          color={hover ? '#8a6d3f' : lit ? '#b08d57' : '#d3c6ad'}
        />
      </mesh>
      <Label text={String(value)} color={labelColor} scale={labelScale} fixed />
    </group>
  );
}
