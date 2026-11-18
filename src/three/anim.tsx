import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Mark } from '../topics/types';
import { BoxValue } from './BoxValue';
import { stableIds as resolveIds, type IdEntry } from './identity';
import { planMotions } from './motion';

/** A block that can appear, glide, swap, or vanish on the stage. */
export type TileSpec = {
  id: string;
  value: string | number;
  mark?: Mark;
  pos: [number, number, number];
  size?: [number, number, number];
  labelScale?: number;
  rotation?: [number, number, number];
  onInspect?: () => void;
};

/** A 3D link between two tiles, drawn from their animated positions. */
export type EdgeSpec = {
  id: string;
  a: string;
  b: string;
  arrow?: boolean;
  color?: string;
  radius?: number;
  trimA?: number;
  trimB?: number;
  soft?: boolean;
};

export type SpawnDir = 'above' | 'below' | 'left' | 'right' | 'center';

/** World-space box a hand-placed block must stay inside (e.g. clear of panels). */
export type DragBounds = { minX: number; maxX: number; minY: number; maxY: number };

const OFFSET: Record<SpawnDir, [number, number, number]> = {
  above: [0, 1.5, 0],
  below: [0, -1.5, 0],
  left: [-1.8, 0, 0],
  right: [1.8, 0, 0],
  center: [0, 0, 0],
};

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ------------------------------------------------------------------ *
 * stable ids: keeps a block's identity as values are swapped/shifted
 * ------------------------------------------------------------------ */

export { stableIds } from './identity';

export function useIdStore() {
  return useRef<Map<string, IdEntry>>(new Map());
}

/** Convenience wrapper for a single sequence of values. */
export function useStableIds(values: (string | number)[]) {
  const store = useIdStore();
  return resolveIds(store, 'values', values);
}

/* ------------------------------------------------------------------ *
 * motion
 * ------------------------------------------------------------------ */

type MotionProps = {
  id: string;
  to: [number, number, number];
  from: [number, number, number];
  arc: boolean;
  entering: boolean;
  exiting: boolean;
  delay: number;
  duration: number;
  store: MutableRefObject<Map<string, THREE.Vector3>>;
  offsets: MutableRefObject<Map<string, THREE.Vector3>>;
  bounds?: DragBounds;
  children: ReactNode;
};

const tmpTarget = new THREE.Vector3();

function Motion({ id, to, from, arc, entering, exiting, delay, duration, store, offsets, bounds, children }: MotionProps) {
  const ref = useRef<THREE.Group>(null);
  const originals = useRef(new WeakMap<THREE.Material, { transparent: boolean; depthWrite: boolean }>());
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => state.controls);
  const start = useRef(new THREE.Vector3(...from));
  const began = useRef(0);
  const key = `${from.join()}|${to.join()}|${arc}|${entering}|${exiting}`;
  const lastKey = useRef('');

  if (lastKey.current !== key) {
    lastKey.current = key;
    start.current.set(...from);
    began.current = performance.now() + delay;
  }

  /** Where the user has placed this block relative to its layout slot. */
  const offsetOf = () => {
    let offset = offsets.current.get(id);
    if (!offset) {
      offset = new THREE.Vector3();
      offsets.current.set(id, offset);
    }
    return offset;
  };

  /** hold and drag a block: it moves with the pointer, links follow. */
  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    const group = ref.current;
    if (!group) return;
    event.stopPropagation();

    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -group.position.z);
    const hit = new THREE.Vector3();
    if (!event.ray.intersectPlane(plane, hit)) return;

    const base = offsetOf().clone();
    const anchor = hit.clone();
    const raycaster = new THREE.Raycaster();
    const orbit = controls as unknown as { enabled: boolean } | null;
    if (orbit) orbit.enabled = false;
    document.body.style.cursor = 'grabbing';

    const onMove = (move: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ndc = new THREE.Vector2(
        ((move.clientX - rect.left) / rect.width) * 2 - 1,
        -((move.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      offsetOf().copy(base).add(point.sub(anchor));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (orbit) orbit.enabled = true;
      document.body.style.cursor = 'auto';
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  useFrame(() => {
    const group = ref.current;
    if (!group) return;

    const progress = duration <= 0 ? 1 : THREE.MathUtils.clamp((performance.now() - began.current) / duration, 0, 1);
    const eased = arc ? easeInOut(progress) : easeOut(progress);
    tmpTarget.set(...to);

    group.position.lerpVectors(start.current, tmpTarget, eased);

    if (arc) {
      // perpendicular lift: the block moving right rises, the one moving left sinks
      const dx = to[0] - start.current.x;
      const dy = to[1] - start.current.y;
      const length = Math.hypot(dx, dy) || 1;
      const lift = Math.min(1.25, Math.max(0.32, length * 0.26));
      const wave = Math.sin(Math.PI * progress);
      group.position.x += (-dy / length) * lift * wave;
      group.position.y += (dx / length) * lift * wave;
    }

    const offset = offsets.current.get(id);
    if (offset && offset.lengthSq() > 0) {
      // keep hand-placed blocks out of the panel column, but never fight a
      // layout slot that already sits outside those bounds
      if (bounds) {
        if (to[0] > bounds.minX && to[0] < bounds.maxX) {
          offset.x = THREE.MathUtils.clamp(offset.x, bounds.minX - to[0], bounds.maxX - to[0]);
        }
        if (to[1] > bounds.minY && to[1] < bounds.maxY) {
          offset.y = THREE.MathUtils.clamp(offset.y, bounds.minY - to[1], bounds.maxY - to[1]);
        }
      }
      group.position.add(offset);
    }

    let alpha = 1;
    if (exiting) {
      const e = easeInOut(progress);
      group.scale.setScalar(1 - 0.6 * e);
      group.position.y += 0.35 * e;
      alpha = 1 - e;
    } else if (entering) {
      const e = easeOut(progress);
      group.scale.setScalar(0.55 + 0.45 * e);
      alpha = Math.min(1, progress * 2.2);
    } else {
      group.scale.setScalar(1);
    }

    let slot = store.current.get(id);
    if (!slot) {
      slot = new THREE.Vector3();
      store.current.set(id, slot);
    }
    slot.copy(group.position);

    group.traverse((child) => {
      const material = (child as THREE.Mesh).material as THREE.Material | undefined;
      if (!material || !('opacity' in material)) return;

      let original = originals.current.get(material);
      if (!original) {
        original = { transparent: material.transparent, depthWrite: material.depthWrite };
        originals.current.set(material, original);
      }

      if (alpha < 0.999) {
        material.transparent = true;
        material.opacity = alpha;
        material.depthWrite = false;
      } else if (material.opacity !== 1) {
        material.opacity = 1;
        material.transparent = original.transparent;
        material.depthWrite = original.depthWrite;
        material.needsUpdate = true;
      }
    });
  });

  return (
    <group ref={ref} onPointerDown={onPointerDown}>
      {children}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * animated links
 * ------------------------------------------------------------------ */

const UP = new THREE.Vector3(0, 1, 0);
const vDir = new THREE.Vector3();
const vStart = new THREE.Vector3();
const vEnd = new THREE.Vector3();
const q = new THREE.Quaternion();

function Edge({ a, b, arrow, color = '#b08d57', radius = 0.028, trimA = 0, trimB = 0, soft, store }: EdgeSpec & { store: MutableRefObject<Map<string, THREE.Vector3>> }) {
  const shaft = useRef<THREE.Mesh>(null);
  const tip = useRef<THREE.Mesh>(null);
  const ink = soft ? '#c3b49a' : color;

  useFrame(() => {
    const pa = store.current.get(a);
    const pb = store.current.get(b);
    if (!pa || !pb) return;

    vDir.subVectors(pb, pa);
    const span = vDir.length();
    if (span < 0.001) return;
    vDir.normalize();

    vStart.copy(pa).addScaledVector(vDir, trimA);
    vEnd.copy(pb).addScaledVector(vDir, -trimB);
    const full = vStart.distanceTo(vEnd);
    const head = arrow ? radius * 6.5 : 0;
    const length = Math.max(0.001, full - head);

    if (shaft.current) {
      shaft.current.position.copy(vStart).addScaledVector(vDir, length / 2);
      shaft.current.quaternion.copy(q.setFromUnitVectors(UP, vDir));
      shaft.current.scale.set(1, length, 1);
      shaft.current.visible = full > 0.02;
    }
    if (tip.current) {
      tip.current.position.copy(vStart).addScaledVector(vDir, length + head / 2);
      tip.current.quaternion.copy(q.setFromUnitVectors(UP, vDir));
      tip.current.visible = full > head * 1.2;
    }
  });

  return (
    <>
      <mesh ref={shaft}>
        <cylinderGeometry args={[radius, radius, 1, 8]} />
        <meshStandardMaterial color={ink} emissive={ink} emissiveIntensity={soft ? 0.12 : 0.32} roughness={0.55} />
      </mesh>
      {arrow && (
        <mesh ref={tip}>
          <coneGeometry args={[radius * 3.1, radius * 6.5, 10]} />
          <meshStandardMaterial color={ink} emissive={ink} emissiveIntensity={0.4} roughness={0.55} />
        </mesh>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * stage
 * ------------------------------------------------------------------ */

type StageProps = {
  tiles: TileSpec[];
  edges?: EdgeSpec[];
  spawn?: SpawnDir;
  exit?: SpawnDir;
  duration?: number;
  dragBounds?: DragBounds;
  /** changing this clears every hand-placed block (e.g. a new program) */
  resetKey?: unknown;
  children?: ReactNode;
};

/**
 * Renders blocks and links with motion: new blocks drop in, swapped blocks
 * arc past each other in opposite directions, deleted blocks turn red and
 * fade away while the rest glide into their new places.
 */
export function AnimatedStage({
  tiles,
  edges = [],
  spawn = 'above',
  exit = 'above',
  duration = 480,
  dragBounds,
  resetKey,
  children,
}: StageProps) {
  const store = useRef(new Map<string, THREE.Vector3>());
  const offsets = useRef(new Map<string, THREE.Vector3>());
  const previous = useRef<Map<string, TileSpec>>(new Map());
  const [ghosts, setGhosts] = useState<TileSpec[]>([]);
  const ghostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReset = useRef(resetKey);

  // a new program starts from its own layout, not the previous hand placement
  if (lastReset.current !== resetKey) {
    lastReset.current = resetKey;
    offsets.current.clear();
  }

  const nextIds = new Set(tiles.map((tile) => tile.id));
  const before = [...previous.current.values()].map((tile) => ({ id: tile.id, pos: tile.pos }));
  const plan = planMotions(
    before,
    tiles.map((tile) => ({ id: tile.id, pos: tile.pos })),
    OFFSET[spawn]
  );
  const goneKey = plan.removed.map((entry) => entry.id).join('|');

  useEffect(() => {
    if (goneKey) {
      const dead = goneKey
        .split('|')
        .map((id) => previous.current.get(id))
        .filter((tile): tile is TileSpec => !!tile);
      setGhosts(dead);
      if (ghostTimer.current) clearTimeout(ghostTimer.current);
      ghostTimer.current = setTimeout(() => {
        setGhosts([]);
        ghostTimer.current = null;
      }, duration + 60);
    }
    previous.current = new Map(tiles.map((tile) => [tile.id, tile]));
  }, [tiles, duration, goneKey]);

  useEffect(
    () => () => {
      if (ghostTimer.current) clearTimeout(ghostTimer.current);
    },
    []
  );

  const drift = OFFSET[exit];

  return (
    <group>
      {edges
        .filter((edge) => nextIds.has(edge.a) && nextIds.has(edge.b))
        .map((edge) => (
          <Edge key={edge.id} {...edge} store={store} />
        ))}

      {tiles.map((tile, index) => {
        const motion = plan.motions.get(tile.id)!;
        return (
          <Motion
            key={tile.id}
            id={tile.id}
            to={tile.pos}
            from={motion.from}
            arc={motion.arc}
            entering={motion.entering}
            exiting={false}
            delay={motion.entering ? Math.min(160, index * 18) : 0}
            duration={motion.entering ? Math.round(duration * 0.85) : duration}
            store={store}
            offsets={offsets}
            bounds={dragBounds}
          >
            <BoxValue
              value={tile.value}
              mark={tile.mark ?? 'idle'}
              position={[0, 0, 0]}
              size={tile.size}
              labelScale={tile.labelScale}
              rotation={tile.rotation}
              onInspect={tile.onInspect}
            />
          </Motion>
        );
      })}

      {ghosts.map((tile) => (
        <Motion
          key={`ghost-${tile.id}`}
          id={tile.id}
          to={[tile.pos[0] + drift[0] * 0.35, tile.pos[1] + drift[1] * 0.35, tile.pos[2]]}
          from={tile.pos}
          arc={false}
          entering={false}
          exiting
          delay={0}
          duration={Math.round(duration * 0.9)}
          store={store}
          offsets={offsets}
        >
          <BoxValue
            value={tile.value}
            mark="removed"
            position={[0, 0, 0]}
            size={tile.size}
            labelScale={tile.labelScale}
            rotation={tile.rotation}
          />
        </Motion>
      ))}

      {children}
    </group>
  );
}
