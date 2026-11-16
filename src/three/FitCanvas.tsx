import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

/**
 * R3F measures its container once on mount. When the surrounding grid changes
 * size during the same paint (resizable panels, changing modes, switching the
 * mobile tabs) the drawing buffer can stay at the browser default — or at the
 * zero size it had while its pane was hidden. This keeps it glued to the
 * element's real CSS size.
 */
export function FitCanvas() {
  const gl = useThree((state) => state.gl);
  const setSize = useThree((state) => state.setSize);

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;

    const sync = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      // a hidden pane measures 0×0: leave the last good buffer alone
      if (w > 0 && h > 0) setSize(w, h);
    };

    const observer = new ResizeObserver(sync);
    observer.observe(parent);
    sync();
    const timer = setTimeout(sync, 140);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [gl, setSize]);

  return null;
}
