/**
 * Crash scene diagrams.
 *
 * Every state crash form has a diagram box, and it is the part of the report a
 * jury actually looks at. It is also the part officers dread, because the tools
 * they are given are either a photograph of a hand sketch or a CAD program that
 * takes an afternoon.
 *
 * The design target is two minutes at a laptop with a trackpad, in a car, at
 * 0300. That drives everything here:
 *
 *   - **Stamps, not drawing.** Nobody sketches a car with a mouse. You place a
 *     pre-drawn vehicle and turn it.
 *   - **The units are already known.** The report has unit 1 and unit 2 with
 *     their year, make and model. The stamps come pre-labelled from them, so
 *     the diagram and the report cannot disagree about which car is which.
 *   - **Vector, not a picture.** Stored as shapes, so it re-opens editable,
 *     prints at full resolution, survives a supplement six months later, and
 *     costs a couple of kilobytes instead of a megabyte of PNG.
 *
 * Coordinates are in abstract diagram units on a fixed canvas, not feet. A
 * scene diagram is a *sketch* — it shows relative position and direction of
 * travel. Anything that has to be to scale comes from a total station and a
 * reconstruction team, and pretending otherwise in a tool like this would put
 * measurements in front of a jury that nobody measured.
 */

export type ShapeKind = 'vehicle' | 'road' | 'arrow' | 'path' | 'object' | 'label';

export interface Point {
  x: number;
  y: number;
}

export interface Shape {
  id: string;
  kind: ShapeKind;
  /** Centre of the shape, in diagram units. */
  x: number;
  y: number;
  /** Degrees clockwise. Vehicles point "up" at zero. */
  rotation: number;
  width: number;
  height: number;
  label: string;
  /** Which crash unit this stands for, when it is one. */
  unitNumber: number | null;
  /** Which of the shape kind's pictures to draw. */
  variant: string;
  /** For freehand paths — skid marks, gouges, a line of debris. */
  points: Point[];
}

export interface Diagram {
  width: number;
  height: number;
  shapes: Shape[];
  /** Which way is north, in degrees. Every crash diagram carries one. */
  northRotation: number;
  updatedAt: string;
  updatedBy: string;
}

/** The canvas every diagram is drawn on. 4:3, which fits the state form box. */
export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 900;

/** Movement snaps to this, so two vehicles line up without fiddling. */
export const GRID = 10;

export function emptyDiagram(): Diagram {
  return {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    shapes: [],
    northRotation: 0,
    updatedAt: '',
    updatedBy: '',
  };
}

export function isEmpty(diagram: Diagram | null | undefined): boolean {
  return !diagram || diagram.shapes.length === 0;
}

/* ------------------------------------------------------------------ */
/* The palette                                                         */
/* ------------------------------------------------------------------ */

export interface StampSpec {
  kind: ShapeKind;
  variant: string;
  label: string;
  width: number;
  height: number;
  /** Grouping for the toolbar. */
  group: 'units' | 'road' | 'marks' | 'scene';
}

export const STAMPS: StampSpec[] = [
  { kind: 'vehicle', variant: 'car', label: 'Car', width: 60, height: 120, group: 'units' },
  { kind: 'vehicle', variant: 'suv', label: 'SUV / pickup', width: 66, height: 136, group: 'units' },
  { kind: 'vehicle', variant: 'truck', label: 'Truck', width: 74, height: 200, group: 'units' },
  { kind: 'vehicle', variant: 'motorcycle', label: 'Motorcycle', width: 28, height: 70, group: 'units' },
  { kind: 'object', variant: 'pedestrian', label: 'Pedestrian', width: 30, height: 30, group: 'units' },
  { kind: 'object', variant: 'bicycle', label: 'Bicycle', width: 26, height: 60, group: 'units' },

  { kind: 'road', variant: 'straight', label: 'Road', width: 200, height: 400, group: 'road' },
  { kind: 'road', variant: 'centreline', label: 'Centre line', width: 8, height: 400, group: 'road' },
  { kind: 'road', variant: 'stopline', label: 'Stop line', width: 200, height: 10, group: 'road' },
  { kind: 'road', variant: 'crosswalk', label: 'Crosswalk', width: 200, height: 60, group: 'road' },

  { kind: 'arrow', variant: 'travel', label: 'Direction of travel', width: 40, height: 140, group: 'marks' },
  { kind: 'path', variant: 'skid', label: 'Skid mark', width: 0, height: 0, group: 'marks' },
  { kind: 'path', variant: 'debris', label: 'Debris / gouge', width: 0, height: 0, group: 'marks' },
  { kind: 'object', variant: 'impact', label: 'Point of impact', width: 34, height: 34, group: 'marks' },

  { kind: 'object', variant: 'sign', label: 'Sign', width: 26, height: 26, group: 'scene' },
  { kind: 'object', variant: 'signal', label: 'Traffic signal', width: 24, height: 48, group: 'scene' },
  { kind: 'object', variant: 'pole', label: 'Pole', width: 20, height: 20, group: 'scene' },
  { kind: 'object', variant: 'tree', label: 'Tree', width: 40, height: 40, group: 'scene' },
  { kind: 'object', variant: 'building', label: 'Building', width: 140, height: 100, group: 'scene' },
  { kind: 'label', variant: 'text', label: 'Text', width: 120, height: 28, group: 'scene' },
];

export const STAMP_GROUPS: { key: StampSpec['group']; label: string }[] = [
  { key: 'units', label: 'Units' },
  { key: 'road', label: 'Roadway' },
  { key: 'marks', label: 'Marks' },
  { key: 'scene', label: 'Scene' },
];

/* ------------------------------------------------------------------ */
/* Operations — all pure, all returning a new diagram                  */
/* ------------------------------------------------------------------ */

export function snap(value: number, grid = GRID): number {
  return Math.round(value / grid) * grid;
}

/** Keeps a shape's centre on the canvas, so nothing can be lost off-screen. */
export function clampToCanvas(shape: Shape, diagram: Diagram): Shape {
  return {
    ...shape,
    x: Math.max(0, Math.min(diagram.width, shape.x)),
    y: Math.max(0, Math.min(diagram.height, shape.y)),
  };
}

export function createShape(spec: StampSpec, at: Point, id: string, label = ''): Shape {
  return {
    id,
    kind: spec.kind,
    x: snap(at.x),
    y: snap(at.y),
    rotation: 0,
    width: spec.width,
    height: spec.height,
    label: label || (spec.kind === 'label' ? 'Text' : ''),
    unitNumber: null,
    variant: spec.variant,
    points: [],
  };
}

export function addShape(diagram: Diagram, shape: Shape): Diagram {
  return { ...diagram, shapes: [...diagram.shapes, shape] };
}

export function updateShape(diagram: Diagram, id: string, patch: Partial<Shape>): Diagram {
  return {
    ...diagram,
    shapes: diagram.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  };
}

export function removeShape(diagram: Diagram, id: string): Diagram {
  return { ...diagram, shapes: diagram.shapes.filter((s) => s.id !== id) };
}

/**
 * Moves a shape to the front.
 *
 * Draw order is stacking order, and the thing you just touched is almost always
 * the thing you want on top — a vehicle placed on a road should not vanish
 * under it.
 */
export function bringToFront(diagram: Diagram, id: string): Diagram {
  const shape = diagram.shapes.find((s) => s.id === id);
  if (!shape) return diagram;
  return { ...diagram, shapes: [...diagram.shapes.filter((s) => s.id !== id), shape] };
}

export function sendToBack(diagram: Diagram, id: string): Diagram {
  const shape = diagram.shapes.find((s) => s.id === id);
  if (!shape) return diagram;
  return { ...diagram, shapes: [shape, ...diagram.shapes.filter((s) => s.id !== id)] };
}

/** Duplicates a shape, offset so the copy is visibly not the original. */
export function duplicateShape(diagram: Diagram, id: string, newId: string): Diagram {
  const shape = diagram.shapes.find((s) => s.id === id);
  if (!shape) return diagram;
  return addShape(diagram, {
    ...shape,
    id: newId,
    x: snap(shape.x + GRID * 3),
    y: snap(shape.y + GRID * 3),
    points: shape.points.map((p) => ({ x: p.x + GRID * 3, y: p.y + GRID * 3 })),
  });
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

export interface UnitStamp {
  number: number;
  label: string;
  /** Best-guess stamp for the vehicle described on the report. */
  variant: string;
}

/**
 * Turns the report's units into pre-labelled stamps.
 *
 * The whole point: the officer has already told the system there is a 2011
 * Silverado and a 2018 Altima. Making them describe the same two vehicles again
 * in the diagram is both a waste and a way for the two to end up disagreeing
 * about which one is unit 1.
 */
export function unitStamps(
  units: { number: number; kind: string; year: string; make: string; model: string }[],
): UnitStamp[] {
  return units.map((unit) => {
    const described = [unit.year, unit.make, unit.model].filter(Boolean).join(' ');
    return {
      number: unit.number,
      label: `Unit ${unit.number}${described ? ` — ${described}` : ''}`,
      variant: variantForUnit(unit),
    };
  });
}

/** A reasonable picture for a described vehicle. Wrong is one click to fix. */
export function variantForUnit(unit: { kind: string; model: string; make: string }): string {
  if (unit.kind === 'pedestrian') return 'pedestrian';
  if (unit.kind === 'cyclist') return 'bicycle';
  const text = `${unit.make} ${unit.model}`.toLowerCase();
  if (/motorcycle|harley|ducati|kawasaki|yamaha/.test(text)) return 'motorcycle';
  if (/silverado|f-?150|ram|tacoma|tundra|sierra|pickup|truck/.test(text)) return 'suv';
  if (/suburban|tahoe|explorer|pilot|highlander|suv|jeep/.test(text)) return 'suv';
  if (/freightliner|peterbilt|kenworth|semi|tractor/.test(text)) return 'truck';
  return 'car';
}

export function stampFor(variant: string): StampSpec {
  return (
    STAMPS.find((s) => s.variant === variant) ??
    STAMPS.find((s) => s.variant === 'car')!
  );
}

/** Which units are not on the diagram yet. */
export function missingUnits(diagram: Diagram, unitNumbers: number[]): number[] {
  const placed = new Set(
    diagram.shapes.map((s) => s.unitNumber).filter((n): n is number => n !== null),
  );
  return unitNumbers.filter((n) => !placed.has(n));
}

/* ------------------------------------------------------------------ */
/* Freehand paths                                                      */
/* ------------------------------------------------------------------ */

/**
 * Thins a freehand path.
 *
 * A pointer emits a point every few milliseconds, which for one skid mark is
 * several hundred points of which a dozen matter. Left alone they bloat the
 * saved report, slow every later render, and make no visible difference.
 *
 * Perpendicular-distance simplification: keep a point only when dropping it
 * would visibly change the line.
 */
export function simplifyPath(points: Point[], tolerance = 2.5): Point[] {
  if (points.length < 3) return points;

  const keep: Point[] = [points[0]];
  let anchor = points[0];

  for (let i = 1; i < points.length - 1; i += 1) {
    if (distanceToSegment(points[i], anchor, points[i + 1]) > tolerance) {
      keep.push(points[i]);
      anchor = points[i];
    }
  }
  keep.push(points[points.length - 1]);
  return keep;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Centre and extent of a path, so it can be selected and moved as one thing. */
export function pathBounds(points: Point[]): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/* ------------------------------------------------------------------ */
/* Undo                                                                */
/* ------------------------------------------------------------------ */

/**
 * A bounded history of whole diagrams.
 *
 * Whole snapshots rather than inverse operations: a diagram is a few kilobytes,
 * the depth is capped, and an undo that is simply "the previous state" cannot
 * drift out of sync with the thing it is undoing.
 */
export const UNDO_DEPTH = 40;

export function pushHistory(history: Diagram[], diagram: Diagram): Diagram[] {
  return [...history, diagram].slice(-UNDO_DEPTH);
}
