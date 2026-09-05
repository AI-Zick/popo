import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Layers,
  Maximize2,
  Minimize2,
  Redo2,
  RotateCw,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  addShape,
  bringToFront,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  createShape,
  duplicateShape,
  GRID,
  pathBounds,
  pushHistory,
  removeShape,
  resizeShape,
  sendToBack,
  setSize,
  simplifyPath,
  SIZE_STEP,
  snap,
  stampFor,
  STAMP_GROUPS,
  STAMPS,
  takesSignText,
  unitStamps,
  updateShape,
  type Diagram,
  type Point,
  type Shape,
  type StampSpec,
} from '@/domain/diagram';
import type { CrashUnit } from '@/domain/crash';
import { newId } from '@/lib/id';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { DiagramShape, NorthArrow } from './DiagramShapes';

/**
 * Drawing the scene.
 *
 * Two minutes at a laptop, on a trackpad, at 0300. Everything here serves that:
 *
 *   - **Click a stamp, click the canvas.** No dragging from a palette, which is
 *     the interaction trackpads are worst at.
 *   - **Units come pre-labelled** from the report, so the diagram and the
 *     report cannot disagree about which car is unit 1.
 *   - **Dragging never touches the store.** The moving shape lives in local
 *     state until the pointer comes up, so a drag re-renders one `<g>` rather
 *     than the report, the validation panel and the inbound feed on every
 *     pointer event.
 *   - **Keyboard for everything repetitive.** R rotates, arrows nudge, Delete
 *     removes, Ctrl-Z undoes.
 */
export function DiagramEditor({
  diagram,
  units,
  readOnly,
  onChange,
}: {
  diagram: Diagram;
  units: CrashUnit[];
  readOnly?: boolean;
  onChange: (next: Diagram) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ spec: StampSpec; unitNumber: number | null } | null>(null);

  /*
    Live drag state. Kept out of the store on purpose: committing every
    pointermove would re-render the whole crash editor sixty times a second and
    write a debounced save with it.
  */
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null);
  const [drawing, setDrawing] = useState<{ variant: string; points: Point[] } | null>(null);
  const dragOffset = useRef<Point>({ x: 0, y: 0 });

  /*
    A resize in progress. Like the drag, it stays out of the store until the
    pointer lifts — and it remembers the shape's starting size so the handle
    scales from where the drag began rather than compounding every frame.
  */
  const [resizing, setResizing] = useState<{
    id: string;
    width: number;
    height: number;
  } | null>(null);
  const resizeFrom = useRef<{ width: number; height: number; distance: number }>({
    width: 0,
    height: 0,
    distance: 1,
  });

  const [history, setHistory] = useState<Diagram[]>([]);
  const [future, setFuture] = useState<Diagram[]>([]);

  const selected = diagram.shapes.find((s) => s.id === selectedId) ?? null;
  const stamps = useMemo(() => unitStamps(units), [units]);

  /** Every change goes through here, so undo is always available. */
  const commit = useCallback(
    (next: Diagram) => {
      setHistory((h) => pushHistory(h, diagram));
      setFuture([]);
      onChange(next);
    },
    [diagram, onChange],
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const previous = h[h.length - 1];
      setFuture((f) => [diagram, ...f]);
      onChange(previous);
      return h.slice(0, -1);
    });
  }, [diagram, onChange]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      setHistory((h) => pushHistory(h, diagram));
      onChange(f[0]);
      return f.slice(1);
    });
  }, [diagram, onChange]);

  /** Canvas coordinates from a pointer event, independent of on-screen size. */
  const toCanvas = useCallback((event: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }, []);

  /** Bigger or smaller by one step, about the shape's own centre. */
  const resizeBy = useCallback(
    (factor: number) => {
      if (!selectedId) return;
      commit(resizeShape(diagram, selectedId, factor));
    },
    [selectedId, diagram, commit],
  );

  /* ---- Placing ----------------------------------------------------- */

  const placeAt = (at: Point) => {
    if (!pending) return;
    const shape = createShape(pending.spec, at, newId('shp'));
    if (pending.unitNumber !== null) shape.unitNumber = pending.unitNumber;
    commit(addShape(diagram, shape));
    setSelectedId(shape.id);
    // One stamp, one placement. Staying armed is how people end up with six
    // stop lines they did not mean to place.
    setPending(null);
  };

  const onCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    const at = toCanvas(event);

    if (pending?.spec.kind === 'path') {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrawing({ variant: pending.spec.variant, points: [at] });
      return;
    }
    if (pending) {
      placeAt(at);
      return;
    }
    setSelectedId(null);
  };

  const onCanvasPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drawing) {
      const at = toCanvas(event);
      setDrawing((d) => (d ? { ...d, points: [...d.points, at] } : d));
      return;
    }
    if (resizing) {
      const at = toCanvas(event);
      const shape = diagram.shapes.find((s) => s.id === resizing.id);
      if (!shape) return;
      /*
        Scaled by how far the pointer is from the centre against how far it was
        when the drag started. Measuring from the centre rather than the
        opposite corner keeps the shape where it is while it grows, which is
        what somebody sizing a stamp next to a road actually wants.
      */
      const distance = Math.max(1, Math.hypot(at.x - shape.x, at.y - shape.y));
      const factor = distance / resizeFrom.current.distance;
      setResizing({
        id: resizing.id,
        width: Math.round(resizeFrom.current.width * factor),
        height: Math.round(resizeFrom.current.height * factor),
      });
      return;
    }
    if (dragging) {
      const at = toCanvas(event);
      setDragging({
        id: dragging.id,
        x: snap(at.x - dragOffset.current.x),
        y: snap(at.y - dragOffset.current.y),
      });
    }
  };

  const onCanvasPointerUp = () => {
    if (drawing) {
      if (drawing.points.length > 2) {
        const points = simplifyPath(drawing.points);
        const bounds = pathBounds(points);
        commit(
          addShape(diagram, {
            id: newId('shp'),
            kind: 'path',
            variant: drawing.variant,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            rotation: 0,
            label: '',
            unitNumber: null,
            points,
          }),
        );
      }
      setDrawing(null);
      setPending(null);
      return;
    }
    if (resizing) {
      // One history entry per resize, not one per pointer event.
      commit(setSize(diagram, resizing.id, resizing.width, resizing.height));
      setResizing(null);
      return;
    }
    if (dragging) {
      // One history entry per drag, not one per pointer event.
      commit(updateShape(diagram, dragging.id, { x: dragging.x, y: dragging.y }));
      setDragging(null);
    }
  };

  const onShapePointerDown = (event: React.PointerEvent, shape: Shape) => {
    if (readOnly || pending) return;
    event.stopPropagation();
    setSelectedId(shape.id);
    if (shape.kind === 'path') return; // Paths carry absolute points; move by handles instead.

    const at = toCanvas(event);
    dragOffset.current = { x: at.x - shape.x, y: at.y - shape.y };
    (event.currentTarget as Element).closest('svg')?.setPointerCapture(event.pointerId);
    setDragging({ id: shape.id, x: shape.x, y: shape.y });
  };

  const onResizePointerDown = (event: React.PointerEvent, shape: Shape) => {
    if (readOnly) return;
    event.stopPropagation();
    const at = toCanvas(event);
    resizeFrom.current = {
      width: shape.width,
      height: shape.height,
      distance: Math.max(1, Math.hypot(at.x - shape.x, at.y - shape.y)),
    };
    (event.currentTarget as Element).closest('svg')?.setPointerCapture(event.pointerId);
    setResizing({ id: shape.id, width: shape.width, height: shape.height });
  };

  /* ---- Keyboard ----------------------------------------------------- */

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Never steal a keystroke from a field the officer is typing in.
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === 'Escape') {
        setPending(null);
        setSelectedId(null);
        return;
      }
      if (!selected) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        commit(removeShape(diagram, selected.id));
        setSelectedId(null);
      } else if (e.key.toLowerCase() === 'r') {
        commit(updateShape(diagram, selected.id, { rotation: (selected.rotation + (e.shiftKey ? -15 : 15) + 360) % 360 }));
      } else if (e.key === '+' || e.key === '=' || e.key === ']') {
        e.preventDefault();
        resizeBy(SIZE_STEP);
      } else if (e.key === '-' || e.key === '_' || e.key === '[') {
        e.preventDefault();
        resizeBy(1 / SIZE_STEP);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? GRID * 5 : GRID;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        commit(updateShape(diagram, selected.id, { x: selected.x + dx, y: selected.y + dy }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, diagram, commit, undo, redo, readOnly, resizeBy]);

  /* ---- Render -------------------------------------------------------- */

  const shapes = diagram.shapes;

  return (
    <div className="flex gap-3">
      {!readOnly && (
        <div className="w-48 shrink-0 space-y-3">
          {/* Units first: they are what the officer came here to place. */}
          {stamps.length > 0 && (
            <StampGroup label="From this report">
              {stamps.map((stamp) => (
                <StampButton
                  key={stamp.number}
                  label={stamp.label}
                  active={pending?.unitNumber === stamp.number}
                  onClick={() =>
                    setPending({ spec: stampFor(stamp.variant), unitNumber: stamp.number })
                  }
                />
              ))}
            </StampGroup>
          )}

          {STAMP_GROUPS.map((group) => (
            <StampGroup key={group.key} label={group.label}>
              {STAMPS.filter((s) => s.group === group.key).map((spec) => (
                <StampButton
                  key={`${spec.kind}-${spec.variant}`}
                  label={spec.label}
                  active={pending?.spec.variant === spec.variant && pending.unitNumber === null}
                  onClick={() => setPending({ spec, unitNumber: null })}
                />
              ))}
            </StampGroup>
          ))}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {!readOnly && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={undo} disabled={history.length === 0}>
              <Undo2 size={13} aria-hidden />
              Undo
            </Button>
            <Button size="sm" onClick={redo} disabled={future.length === 0}>
              <Redo2 size={13} aria-hidden />
              Redo
            </Button>

            {selected && (
              <>
                <span className="mx-1 h-4 w-px bg-line" />
                <Button size="sm" onClick={() => resizeBy(SIZE_STEP)} title="Bigger  ( + )">
                  <Maximize2 size={13} aria-hidden />
                  Bigger
                </Button>
                <Button size="sm" onClick={() => resizeBy(1 / SIZE_STEP)} title="Smaller  ( − )">
                  <Minimize2 size={13} aria-hidden />
                  Smaller
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    commit(updateShape(diagram, selected.id, { rotation: (selected.rotation + 15) % 360 }))
                  }
                >
                  <RotateCw size={13} aria-hidden />
                  Turn
                </Button>
                <Button size="sm" onClick={() => commit(duplicateShape(diagram, selected.id, newId('shp')))}>
                  <Copy size={13} aria-hidden />
                  Copy
                </Button>
                <Button size="sm" onClick={() => commit(bringToFront(diagram, selected.id))}>
                  <Layers size={13} aria-hidden />
                  Front
                </Button>
                <Button size="sm" onClick={() => commit(sendToBack(diagram, selected.id))}>
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    commit(removeShape(diagram, selected.id));
                    setSelectedId(null);
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                  Delete
                </Button>
              </>
            )}

            <div className="flex-1" />
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              North
              <input
                type="range"
                min={0}
                max={359}
                value={diagram.northRotation}
                onChange={(e) => onChange({ ...diagram, northRotation: Number(e.target.value) })}
                className="w-24"
              />
            </label>
          </div>
        )}

        {/*
          A speed limit sign with no number and a street sign with no street
          say something was there without saying what, so the same field that
          types a text label types their faces.
        */}
        {selected && !readOnly && (selected.kind === 'label' || takesSignText(selected.variant)) && (
          <input
            autoFocus
            value={selected.label}
            onChange={(e) => onChange(updateShape(diagram, selected.id, { label: e.target.value }))}
            placeholder={
              selected.variant === 'sign-speed'
                ? 'Posted limit'
                : selected.variant === 'sign-street'
                  ? 'Street name'
                  : 'Label text'
            }
            className="mb-2 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-ink"
          />
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          className={cn(
            'w-full rounded-xl border border-line bg-surface',
            pending && 'cursor-crosshair',
            readOnly && 'pointer-events-none',
          )}
          style={{ touchAction: 'none' }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
        >
          <defs>
            <pattern id="diagram-grid" width={GRID * 4} height={GRID * 4} patternUnits="userSpaceOnUse">
              <path
                d={`M ${GRID * 4} 0 L 0 0 0 ${GRID * 4}`}
                fill="none"
                stroke="var(--c-line)"
                strokeWidth={1}
              />
            </pattern>
          </defs>
          <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#diagram-grid)" />

          {shapes.map((shape) => {
            let live = shape;
            if (dragging?.id === shape.id) live = { ...shape, x: dragging.x, y: dragging.y };
            if (resizing?.id === shape.id)
              live = { ...shape, width: resizing.width, height: resizing.height };
            return (
              <g
                key={shape.id}
                onPointerDown={(e) => onShapePointerDown(e, shape)}
                style={{ cursor: readOnly ? 'default' : 'move' }}
              >
                <DiagramShape shape={live} selected={shape.id === selectedId} />
              </g>
            );
          })}

          {/*
            The size handle, drawn last so it sits above every stamp.

            Only on the selected shape, and outside the selection outline so it
            cannot be mistaken for part of the drawing. Dragging it scales from
            the centre; the toolbar buttons and the + / − keys do the same
            thing for somebody who would rather not aim at a handle at all.
          */}
          {!readOnly && selected && selected.kind !== 'path' && (
            <SizeHandle
              shape={
                resizing?.id === selected.id
                  ? { ...selected, width: resizing.width, height: resizing.height }
                  : dragging?.id === selected.id
                    ? { ...selected, x: dragging.x, y: dragging.y }
                    : selected
              }
              onGrab={(event) => onResizePointerDown(event, selected)}
            />
          )}

          {/* The line being drawn right now, before it is committed. */}
          {drawing && (
            <path
              d={drawing.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
              fill="none"
              stroke="var(--c-accent)"
              strokeWidth={6}
              strokeLinecap="round"
            />
          )}

          <NorthArrow rotation={diagram.northRotation} />
        </svg>

        {!readOnly && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
            {pending
              ? pending.spec.kind === 'path'
                ? 'Drag on the diagram to draw the mark.'
                : 'Click on the diagram to place it.'
              : 'Pick something on the left, then click the diagram. Drag to move · corner grip or + / − to resize · R to turn · arrows to nudge · Delete to remove · Ctrl-Z to undo.'}
          </p>
        )}
      </div>
    </div>
  );
}

function StampGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function StampButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-lg border px-2 py-1.5 text-left text-[12px] transition',
        active
          ? 'border-accent bg-accent-soft text-ink'
          : 'border-line text-muted hover:border-line-strong hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}

/**
 * The corner grip that resizes a stamp.
 *
 * Deliberately large and deliberately outside the selection outline: the
 * complaint that started this work was that things were too hard to grab, and
 * a four-pixel handle would be the same mistake in a new place. The visible
 * grip is small; the invisible circle around it is not.
 */
function SizeHandle({
  shape,
  onGrab,
}: {
  shape: Shape;
  onGrab: (event: React.PointerEvent) => void;
}) {
  const x = shape.x + shape.width / 2 + 14;
  const y = shape.y + shape.height / 2 + 14;
  return (
    <g
      onPointerDown={onGrab}
      style={{ cursor: 'nwse-resize' }}
      role="button"
      aria-label="Resize"
    >
      <circle cx={x} cy={y} r={26} fill="transparent" />
      <circle cx={x} cy={y} r={9} fill="var(--c-accent)" stroke="var(--c-surface)" strokeWidth={2.5} />
      <path
        d={`M ${x - 4} ${y + 4} L ${x + 4} ${y - 4} M ${x + 1} ${y + 4} L ${x + 4} ${y + 1}`}
        stroke="#fff"
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}
