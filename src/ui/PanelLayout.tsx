import {useEffect, useRef, useState} from 'react';
/** Pixel minima remain meaningful when the viewport or the toolbar changes size. */
export function usePanelHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(700);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const observer = new ResizeObserver(() => setHeight(host.clientHeight));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  return {ref, height};
}
