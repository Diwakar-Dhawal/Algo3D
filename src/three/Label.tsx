import { useMemo } from 'react';
import { textTexture } from './tex';

type Props = {
  text: string;
  color?: string;
  scale?: number;
  position?: [number, number, number];
};

/** Camera-facing text label drawn on top of the scene. */
export function Label({ text, color = '#eaf6ff', scale = 0.95, position = [0, 0, 0] }: Props) {
  const map = useMemo(() => textTexture(text, color), [text, color]);
  return (
    <sprite position={position} scale={[scale, scale, 1]} renderOrder={999}>
      <spriteMaterial map={map} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
