import { useMemo } from 'react';
import * as THREE from 'three';

type Props = {
  from: [number, number, number];
  to: [number, number, number];
  color?: string;
  radius?: number;
  head?: boolean;
  arrowStart?: number;
  arrowEnd?: number;
};

/** A link (edge / pointer arrow) between two points in 3D space. */
export function Link({ from, to, color = '#2c4a68', radius = 0.035, head = false, arrowStart = 0, arrowEnd = 0 }: Props) {
  const { mid, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const length = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize()
    );
    return { mid: a.clone().add(b).multiplyScalar(0.5), quat: q, len: length };
  }, [from, to]);

  const unit = useMemo(() => new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).normalize(), [from, to]);
  const tip = useMemo(
    () => new THREE.Vector3(...to).addScaledVector(unit, -arrowEnd).toArray() as [number, number, number],
    [to, unit, arrowEnd]
  );
  const start = useMemo(
    () => new THREE.Vector3(...from).addScaledVector(unit, arrowStart).toArray() as [number, number, number],
    [from, unit, arrowStart]
  );

  const shaftLen = Math.max(0.001, len - arrowStart - arrowEnd);
  const shaftMid = useMemo(() => {
    const a = new THREE.Vector3(...start);
    return a.addScaledVector(unit, shaftLen / 2).toArray() as [number, number, number];
  }, [start, unit, shaftLen]);

  return (
    <group>
      <mesh position={shaftMid} quaternion={quat}>
        <cylinderGeometry args={[radius, radius, shaftLen, 10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.5} />
      </mesh>
      {head && (
        <mesh position={tip} quaternion={quat}>
          <coneGeometry args={[radius * 3.2, radius * 7, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.45} roughness={0.5} />
        </mesh>
      )}
      {/* keeps the memo alive for reference point */}
      <group position={mid} />
    </group>
  );
}
