import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Tooltip = { target: HTMLElement; label: string };

export default function TooltipLayer() {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const find = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
    const enter = (event: Event) => {
      const target = find(event.target);
      const label = target?.dataset.tooltip;
      if (target && label) setTooltip(current => current?.target === target && current.label === label ? current : { target, label });
    };
    const leave = (event: Event) => {
      const target = find(event.target);
      const related = event instanceof FocusEvent || event instanceof PointerEvent ? event.relatedTarget : null;
      if (target && related instanceof Node && target.contains(related)) return;
      setTooltip(current => current?.target === target ? null : current);
    };
    document.addEventListener('pointerover', enter);
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusin', enter);
    document.addEventListener('focusout', leave);
    return () => {
      document.removeEventListener('pointerover', enter);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('focusin', enter);
      document.removeEventListener('focusout', leave);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip) return;
    const place = () => {
      if (!tooltip.target.isConnected || !bubble.current) { setTooltip(null); return; }
      const anchor = tooltip.target.getBoundingClientRect();
      const box = bubble.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(window.innerWidth - box.width - 8, anchor.left + anchor.width / 2 - box.width / 2));
      const below = anchor.bottom + 6;
      const above = anchor.top - box.height - 6;
      const top = below + box.height <= window.innerHeight - 8 ? below : above >= 8 ? above : Math.max(8, Math.min(window.innerHeight - box.height - 8, below));
      setPosition({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [tooltip]);

  return tooltip ? createPortal(<div ref={bubble} className="app-tooltip" role="tooltip" style={position || { visibility: 'hidden' }}>{tooltip.label}</div>, document.body) : null;
}
