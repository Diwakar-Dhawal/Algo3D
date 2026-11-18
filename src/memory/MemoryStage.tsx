import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { TraceStep } from '../jvm/types';
import type { Selected } from '../topics/types';
import { buildLayout, NODE, STACK_W, type MemLayout } from './layout';
import {
  AnimatedStage,
  stableIds,
  useIdStore,
  type DragBounds,
  type EdgeSpec,
  type TileSpec,
} from '../three/anim';
import { FitCanvas } from '../three/FitCanvas';

/** right-most pixel the drawing needs */
function extentOf(layout: MemLayout): number {
  let right = 0;
  for (const node of layout.nodes) right = Math.max(right, node.x + node.size / 2);
  for (const card of layout.cards) right = Math.max(right, card.x + card.w / 2);
  for (const label of layout.labels) right = Math.max(right, label.x + label.text.length * 5.4 + 14);
  return right;
}

const CAMERA_Z = 14;

type Props = {
  step: TraceStep;
  stepIndex: number;
  onInspect: (selected: Selected) => void;
  animMs?: number;
  resetKey?: unknown;
};

/**
 * Memory view. Heap structures are real 3D nodes that animate — inserts drop
 * in, swaps arc past each other, deleted nodes flush red and fade away — and
 * the call stack is a compact text trace so every variable fits.
 */
export function MemoryStage({ step, stepIndex, onInspect, animMs, resetKey }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const idStores = useIdStore();
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    // measure the visible pane, not the (possibly wider) drawing surface
    const host = hostRef.current;
    const pane = host?.parentElement ?? host;
    if (!pane) return;
    const measure = () => setSize({ w: pane.clientWidth, h: pane.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  // phones get a narrower call-stack column so the heap keeps most of the width
  const stackW = size.w > 0 && size.w < 640 ? Math.min(152, Math.round(size.w * 0.44)) : STACK_W;

  // long chains and wide trees need more room than a phone has: widen the
  // drawing surface and let the stage scroll sideways to reach every block
  const { layout, wide } = useMemo(() => {
    let width = Math.max(320, size.w);
    let built = buildLayout(step, width, size.h, stackW);
    for (let pass = 0; pass < 3; pass++) {
      const need = Math.ceil(extentOf(built) + 16);
      // ignore a couple of stray pixels: no scrollbar for rounding noise
      if (need <= width + 8) break;
      width = Math.min(2600, need);
      built = buildLayout(step, width, size.h, stackW);
    }
    return { layout: built, wide: width };
  }, [step, size.w, size.h, stackW]);

  const ppu = size.h > 0 ? size.h / (2 * CAMERA_Z * Math.tan((45 * Math.PI) / 360)) : 40;
  const toWorld = (x: number, y: number): [number, number, number] => [
    (x - wide / 2) / ppu,
    (size.h / 2 - y) / ppu,
    0,
  ];

  // blocks may be dragged around the heap area, but not under the stack/variable
  // column where they would be covered and impossible to pick up again
  const dragBounds: DragBounds = useMemo(() => {
    const left = stackW + 22;
    const top = 100;
    return {
      minX: (left - wide / 2) / ppu,
      maxX: (wide - 16 - wide / 2) / ppu,
      maxY: (size.h / 2 - top) / ppu,
      minY: (size.h / 2 - (size.h - 16)) / ppu,
    };
  }, [wide, size.h, ppu, stackW]);

  // array/list cells get value-tracked ids so a swap or shift moves the block
  const cellIds = useMemo(() => {
    const groups = new Map<number, { at: number; label: string }[]>();
    layout.nodes.forEach((node, at) => {
      if (node.index === undefined) return;
      const list = groups.get(node.objId) ?? [];
      list.push({ at, label: node.label });
      groups.set(node.objId, list);
    });
    const map = new Map<number, string>();
    groups.forEach((entries, objId) => {
      const ids = stableIds(idStores, `obj-${objId}`, entries.map((entry) => entry.label));
      entries.forEach((entry, k) => map.set(entry.at, `cell-${objId}-${ids[k]}`));
    });
    return map;
  }, [layout]);

  // links are authored against layout node keys, but a cell's tile is keyed by
  // its value-tracked id — so translate before handing edges to the stage
  const tileIdOf = new Map<string, string>();
  layout.nodes.forEach((node, at) => {
    tileIdOf.set(node.key, cellIds.get(at) ?? node.key);
  });

  const tiles: TileSpec[] = layout.nodes.map((node, at) => {
    // each node keeps its own footprint: cells are 36px, list/tree nodes 64px
    const box = node.size / ppu;
    return {
    id: tileIdOf.get(node.key)!,
    value: node.label,
    mark: node.mark,
    pos: toWorld(node.x, node.y),
    size: [box, box, box * 0.62],
    labelScale: box * 0.6,
    rotation: [0, -0.16, 0],
    onInspect: () =>
      onInspect({
        title: node.title,
        meta: [
          ['value', node.label],
          ...(node.index !== undefined ? ([['index', String(node.index)]] as [string, string][]) : []),
          ['object', `@${node.objId}`],
          ...(node.prev ? ([['was', node.prev]] as [string, string][]) : []),
        ],
      }),
    };
  });

  const edges: EdgeSpec[] = layout.edges.map((edge) => ({
    id: edge.key,
    a: tileIdOf.get(edge.from) ?? edge.from,
    b: tileIdOf.get(edge.to) ?? edge.to,
    arrow: edge.arrow,
    soft: edge.soft,
    // cell rails stop at the box edge; chain links keep the node-sized trim
    trimA: (edge.trimA ?? (NODE / 2) * 0.94) / ppu,
    trimB: (edge.trimB ?? (NODE / 2) * 0.94) / ppu,
    radius: edge.soft ? 0.022 : 0.026,
    color: edge.soft ? '#c3b49a' : '#b08d57',
  }));

  return (
    <div className="mem-stage" ref={hostRef} style={{ width: wide || '100%' }}>
      {size.w > 0 && (
        <Canvas
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [0, 0, CAMERA_Z], fov: 45, near: 0.1, far: 200 }}
          style={{ position: 'absolute', inset: 0, touchAction: 'pan-x' }}
        >
          <FitCanvas />
          <ambientLight intensity={1.05} />
          <hemisphereLight args={['#ffffff', '#e6dcc8', 0.55]} />
          <directionalLight position={[5, 9, 12]} intensity={1.25} />
          <directionalLight position={[-6, -5, 9]} intensity={0.3} />

          <AnimatedStage
            tiles={tiles}
            edges={edges}
            spawn="below"
            exit="below"
            duration={animMs ?? 420}
            dragBounds={dragBounds}
            resetKey={resetKey}
          />

          {/* scroll to zoom; rotation stays off so blocks can be dragged */}
          <OrbitControls
            makeDefault
            enableRotate={false}
            enablePan={false}
            enableDamping
            dampingFactor={0.12}
            zoomSpeed={0.85}
            minDistance={5}
            maxDistance={30}
          />
        </Canvas>
      )}

      <div className="stack-trace" style={{ width: stackW }}>
        <div className="st-head">
          <span>call stack</span>
          <span className="st-count">{layout.frames.length}</span>
        </div>
        {layout.frames.map((frame) => (
          <div className={`st-frame ${frame.active ? 'on' : ''}`} key={frame.id}>
            <div className="st-title">
              <b>{frame.method}()</b>
              <i>{frame.line}</i>
            </div>
            {frame.vars.length === 0 ? (
              <div className="st-empty">no locals</div>
            ) : (
              frame.vars.map((variable) => (
                <div className={`st-var ${variable.changed ? 'changed' : ''}`} key={variable.name}>
                  <span className="k">{variable.name}</span>
                  <span className="v">
                    {variable.changed && variable.prev ? (
                      <>
                        <s>{variable.prev}</s> {variable.value}
                      </>
                    ) : (
                      variable.value
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        ))}
      </div>

      {size.w > 0 &&
        layout.labels.map((label) => (
          <div
            key={label.key}
            className={`mem-tag ${label.kind}`}
            style={{
              left: label.x,
              top: label.y,
              transform: label.align === 'right' ? 'translate(-100%, -50%)' : 'translate(0, -50%)',
            }}
          >
            {label.text}
          </div>
        ))}

      {size.w > 0 &&
        layout.cards.map((card) => (
          <div
            key={card.key}
            className="mem-card"
            style={{ left: card.x - card.w / 2, top: card.y - card.h / 2, width: card.w }}
          >
            <div className="mem-head">
              <span className="mem-title">{card.title}</span>
              <span className="mem-sub">{card.sub}</span>
            </div>
            {card.rows.map((row) => (
              <div className={`mem-row ${row.changed ? 'changed' : ''}`} key={row.label}>
                <span className="k">{row.label}</span>
                <span className="v">{row.value}</span>
              </div>
            ))}
          </div>
        ))}

      <div className="mem-tokens">
        {layout.tokens.map((token) => (
          <div
            key={`${stepIndex}-${token.key}`}
            className="mem-token"
            style={
              {
                left: token.x1,
                top: token.y1,
                '--dx': `${token.x2 - token.x1}px`,
                '--dy': `${token.y2 - token.y1}px`,
              } as React.CSSProperties
            }
          >
            <i />
            <span>{token.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
