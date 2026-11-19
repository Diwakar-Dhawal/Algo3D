import { useMemo } from 'react';
import { textTexture } from './tex';
import { useStageTheme } from '../theme/store';
import { readable } from './theme';

type Props = {
  text: string;
  color?: string;
  scale?: number;
  position?: [number, number, number];
  /** text that sits on a block keeps its exact colour in both themes */
  fixed?: boolean;
};

/** Camera-facing text label drawn on top of the scene. */
export function Label({ text, color = '#eaf6ff', scale = 0.95, position = [0, 0, 0], fixed = false }: Props) {
  const theme = useStageTheme();
  const ink = fixed ? color : readable(color, theme);
  const map = useMemo(() => textTexture(text, ink), [text, ink]);
  return (
    <sprite position={position} scale={[scale, scale, 1]} renderOrder={999}>
      <spriteMaterial map={map} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
