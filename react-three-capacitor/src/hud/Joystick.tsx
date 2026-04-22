import { useRef, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

const OUTER = 120;
const KNOB = 50;
const MAX_DIST = (OUTER - KNOB) / 2;

export function Joystick() {
  const outerRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const activeTouchId = useRef<number | null>(null);
  const baseCenter = useRef({ x: 0, y: 0 });
  const setJoystick = useGameStore((s) => s.setJoystickInput);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    const updateCenter = () => {
      const r = el.getBoundingClientRect();
      baseCenter.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    const moveKnob = (cx: number, cy: number) => {
      const dx = cx - baseCenter.current.x;
      const dy = cy - baseCenter.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clamped = Math.min(dist, MAX_DIST);
      const angle = Math.atan2(dy, dx);
      const kx = Math.cos(angle) * clamped;
      const ky = Math.sin(angle) * clamped;

      if (knobRef.current) {
        knobRef.current.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
      }

      const nx = dist > 0 ? dx / dist : 0;
      const ny = dist > 0 ? dy / dist : 0;
      const mag = Math.min(1, dist / MAX_DIST);
      setJoystick({ x: nx * mag, y: ny * mag });
    };

    const reset = () => {
      activeTouchId.current = null;
      if (knobRef.current) {
        knobRef.current.style.transform = 'translate(-50%, -50%)';
      }
      setJoystick({ x: 0, y: 0 });
    };

    const isEliminated = () => {
      const { playerId, playerHp } = useGameStore.getState();
      return playerId !== null && (playerHp[playerId] ?? 2) === 0;
    };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (isEliminated()) return;
      if (activeTouchId.current !== null) return;
      const t = e.changedTouches[0];
      activeTouchId.current = t.identifier;
      updateCenter();
      moveKnob(t.clientX, t.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (isEliminated()) return;
      const t = Array.from(e.changedTouches).find(
        (x) => x.identifier === activeTouchId.current,
      );
      if (t) moveKnob(t.clientX, t.clientY);
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t = Array.from(e.changedTouches).find(
        (x) => x.identifier === activeTouchId.current,
      );
      if (t) reset();
    };

    // Mouse fallback for desktop testing
    let mouseDown = false;
    const onMouseDown = (e: MouseEvent) => {
      if (isEliminated()) return;
      mouseDown = true;
      updateCenter();
      moveKnob(e.clientX, e.clientY);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (mouseDown && !isEliminated()) moveKnob(e.clientX, e.clientY);
    };
    const onMouseUp = () => {
      if (mouseDown) { mouseDown = false; reset(); }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [setJoystick]);

  return (
    <div
      ref={outerRef}
      style={{
        width: OUTER,
        height: OUTER,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.12)',
        border: '2px solid rgba(255,255,255,0.25)',
        position: 'relative',
        touchAction: 'none',
        userSelect: 'none',
        cursor: 'pointer',
      }}
    >
      <div
        ref={knobRef}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: KNOB,
          height: KNOB,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.35)',
          border: '2px solid rgba(255,255,255,0.55)',
          pointerEvents: 'none',
          transition: 'transform 0.05s ease-out',
        }}
      />
    </div>
  );
}
