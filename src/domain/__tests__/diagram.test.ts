import { describe, expect, it } from 'vitest';
import {
  addShape,
  bringToFront,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  clampToCanvas,
  createShape,
  duplicateShape,
  emptyDiagram,
  grabBox,
  GRID,
  isEmpty,
  missingUnits,
  pathBounds,
  pushHistory,
  MAX_SIZE,
  MIN_GRAB,
  MIN_SIZE,
  removeShape,
  resizeShape,
  sendToBack,
  setSize,
  SIGN_TEXT_DEFAULT,
  simplifyPath,
  SIZE_STEP,
  snap,
  stampFor,
  STAMPS,
  takesSignText,
  UNDO_DEPTH,
  unitStamps,
  updateShape,
  variantForUnit,
  type Diagram,
} from '../diagram';

const carStamp = STAMPS.find((s) => s.variant === 'car')!;

function withShapes(n: number): Diagram {
  let diagram = emptyDiagram();
  for (let i = 0; i < n; i += 1) {
    diagram = addShape(diagram, createShape(carStamp, { x: 100 * i, y: 100 }, `s${i}`));
  }
  return diagram;
}

/* ------------------------------------------------------------------ */
/* Placing and moving                                                  */
/* ------------------------------------------------------------------ */

describe('placing shapes', () => {
  it('starts empty', () => {
    expect(isEmpty(emptyDiagram())).toBe(true);
    expect(isEmpty(null)).toBe(true);
  });

  it('snaps to the grid so two vehicles line up without fiddling', () => {
    expect(snap(103)).toBe(100);
    expect(snap(106)).toBe(110);
    const shape = createShape(carStamp, { x: 103, y: 47 }, 's1');
    expect(shape.x % GRID).toBe(0);
    expect(shape.y % GRID).toBe(0);
  });

  it('takes its size from the stamp', () => {
    const shape = createShape(carStamp, { x: 0, y: 0 }, 's1');
    expect(shape.width).toBe(carStamp.width);
    expect(shape.height).toBe(carStamp.height);
  });

  it('never lets a shape be lost off the canvas', () => {
    const diagram = emptyDiagram();
    const off = { ...createShape(carStamp, { x: 0, y: 0 }, 's1'), x: -500, y: 99_999 };
    const clamped = clampToCanvas(off, diagram);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(CANVAS_HEIGHT);
    expect(CANVAS_WIDTH).toBeGreaterThan(0);
  });

  it('updates one shape and leaves the rest alone', () => {
    const diagram = updateShape(withShapes(3), 's1', { rotation: 90 });
    expect(diagram.shapes[1].rotation).toBe(90);
    expect(diagram.shapes[0].rotation).toBe(0);
  });

  it('removes a shape', () => {
    expect(removeShape(withShapes(3), 's1').shapes.map((s) => s.id)).toEqual(['s0', 's2']);
  });

  it('never mutates the diagram it was given', () => {
    const original = withShapes(2);
    const snapshot = JSON.stringify(original);
    updateShape(original, 's0', { rotation: 45 });
    removeShape(original, 's0');
    addShape(original, createShape(carStamp, { x: 0, y: 0 }, 'x'));
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

/* ------------------------------------------------------------------ */
/* Stacking                                                            */
/* ------------------------------------------------------------------ */

describe('stacking order', () => {
  it('brings a shape to the front', () => {
    // A vehicle placed on a road must not vanish under it.
    expect(bringToFront(withShapes(3), 's0').shapes.map((s) => s.id)).toEqual(['s1', 's2', 's0']);
  });

  it('sends a shape to the back', () => {
    expect(sendToBack(withShapes(3), 's2').shapes.map((s) => s.id)).toEqual(['s2', 's0', 's1']);
  });

  it('does nothing for a shape that is not there', () => {
    const diagram = withShapes(2);
    expect(bringToFront(diagram, 'nope')).toBe(diagram);
  });

  it('offsets a duplicate so it is visibly not the original', () => {
    const diagram = duplicateShape(withShapes(1), 's0', 'copy');
    const [original, copy] = diagram.shapes;
    expect(copy.id).toBe('copy');
    expect(copy.x).not.toBe(original.x);
    expect(copy.y).not.toBe(original.y);
  });
});

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

describe('units become pre-labelled stamps', () => {
  const units = [
    { number: 1, kind: 'vehicle', year: '2011', make: 'Chevrolet', model: 'Silverado' },
    { number: 2, kind: 'vehicle', year: '2018', make: 'Nissan', model: 'Altima' },
  ];

  it('labels each stamp with the vehicle already on the report', () => {
    // The officer has already described these two. Describing them again in
    // the diagram is both a waste and a way for the two to disagree.
    const stamps = unitStamps(units);
    expect(stamps[0].label).toBe('Unit 1 — 2011 Chevrolet Silverado');
    expect(stamps[1].label).toBe('Unit 2 — 2018 Nissan Altima');
  });

  it('picks a sensible picture from the make and model', () => {
    expect(variantForUnit({ kind: 'vehicle', make: 'Chevrolet', model: 'Silverado' })).toBe('suv');
    expect(variantForUnit({ kind: 'vehicle', make: 'Nissan', model: 'Altima' })).toBe('car');
    expect(variantForUnit({ kind: 'vehicle', make: 'Harley', model: 'Softail' })).toBe('motorcycle');
    expect(variantForUnit({ kind: 'vehicle', make: 'Peterbilt', model: '379' })).toBe('truck');
  });

  it('draws a pedestrian unit as a pedestrian, not a car', () => {
    expect(variantForUnit({ kind: 'pedestrian', make: '', model: '' })).toBe('pedestrian');
    expect(variantForUnit({ kind: 'cyclist', make: '', model: '' })).toBe('bicycle');
  });

  it('copes with a unit nobody has described yet', () => {
    const stamps = unitStamps([{ number: 3, kind: 'vehicle', year: '', make: '', model: '' }]);
    expect(stamps[0].label).toBe('Unit 3');
    expect(stamps[0].variant).toBe('car');
  });

  it('always resolves a stamp, even for an unknown variant', () => {
    expect(stampFor('nonsense').variant).toBe('car');
  });

  it('says which units are still not on the diagram', () => {
    let diagram = emptyDiagram();
    diagram = addShape(diagram, {
      ...createShape(carStamp, { x: 100, y: 100 }, 'u1'),
      unitNumber: 1,
    });
    expect(missingUnits(diagram, [1, 2, 3])).toEqual([2, 3]);
  });
});

/* ------------------------------------------------------------------ */
/* Freehand                                                            */
/* ------------------------------------------------------------------ */

describe('freehand paths', () => {
  it('thins the hundreds of points a pointer emits', () => {
    // One skid mark arrives as several hundred points, of which a dozen
    // matter. Left alone they bloat the report and slow every later render.
    const straight = Array.from({ length: 300 }, (_, i) => ({ x: i, y: 0 }));
    const simplified = simplifyPath(straight);
    expect(simplified.length).toBeLessThan(10);
    expect(simplified[0]).toEqual({ x: 0, y: 0 });
    expect(simplified[simplified.length - 1]).toEqual({ x: 299, y: 0 });
  });

  it('keeps the corners that make the shape', () => {
    const elbow = [
      ...Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 })),
      ...Array.from({ length: 50 }, (_, i) => ({ x: 49, y: i })),
    ];
    const simplified = simplifyPath(elbow);
    // The turn survives.
    expect(simplified.some((p) => p.x > 40 && p.y > 10)).toBe(true);
  });

  it('leaves a two-point line alone', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    expect(simplifyPath(line)).toEqual(line);
  });

  it('finds the centre and extent of a path so it can be moved as one thing', () => {
    const bounds = pathBounds([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(bounds).toEqual({ x: 50, y: 25, width: 100, height: 50 });
  });

  it('gives an empty path a harmless box', () => {
    expect(pathBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Undo                                                                */
/* ------------------------------------------------------------------ */

describe('undo history', () => {
  it('keeps snapshots in order', () => {
    const a = emptyDiagram();
    const b = withShapes(1);
    expect(pushHistory([a], b)).toEqual([a, b]);
  });

  it('is bounded, so a long session cannot grow without limit', () => {
    let history: Diagram[] = [];
    for (let i = 0; i < UNDO_DEPTH + 20; i += 1) history = pushHistory(history, withShapes(1));
    expect(history).toHaveLength(UNDO_DEPTH);
  });
});

/* ------------------------------------------------------------------ */
/* Getting hold of a shape                                             */
/* ------------------------------------------------------------------ */

describe('the area that responds to a grab', () => {
  it('is never smaller than a pointer can reliably hit', () => {
    /*
      The complaint this exists for, and it was measurable: SVG hit-testing
      follows painted pixels, so a centre line — eight units of stroke — took
      the pointer on 0 of 25 sample points across its own box, and a pedestrian
      on 2. An officer experiences that as "it will not let me move it".
    */
    const centreLine = STAMPS.find((s) => s.variant === 'centreline')!;
    const shape = createShape(centreLine, { x: 100, y: 100 }, 'line');
    expect(shape.width).toBeLessThan(MIN_GRAB);
    expect(grabBox(shape).width).toBe(MIN_GRAB);
  });

  it('does not shrink a shape that is already big enough', () => {
    // A lorry must not get a target smaller than the lorry.
    const truck = STAMPS.find((s) => s.variant === 'truck')!;
    const shape = createShape(truck, { x: 100, y: 100 }, 't');
    expect(grabBox(shape)).toEqual({ width: shape.width, height: shape.height });
  });

  it('pads each side independently, so a long thin shape keeps its length', () => {
    const centreLine = STAMPS.find((s) => s.variant === 'centreline')!;
    const shape = createShape(centreLine, { x: 100, y: 100 }, 'line');
    const box = grabBox(shape);
    expect(box.width).toBe(MIN_GRAB);
    expect(box.height).toBe(shape.height);
  });
});

/* ------------------------------------------------------------------ */
/* Resizing                                                            */
/* ------------------------------------------------------------------ */

describe('resizing a stamp', () => {
  const carAt = (width: number, height: number): Diagram => {
    const diagram = addShape(emptyDiagram(), createShape(carStamp, { x: 300, y: 300 }, 'c'));
    return updateShape(diagram, 'c', { width, height });
  };

  it('scales both sides by the same factor', () => {
    const bigger = resizeShape(carAt(60, 120), 'c', 2);
    const shape = bigger.shapes[0];
    expect(shape.width).toBe(120);
    expect(shape.height).toBe(240);
  });

  it('keeps the shape where it is', () => {
    // Scaling about the centre. A stamp that wanders while it grows is one
    // somebody has to reposition after every size change.
    const bigger = resizeShape(carAt(60, 120), 'c', 2);
    expect(bigger.shapes[0].x).toBe(300);
    expect(bigger.shapes[0].y).toBe(300);
  });

  it('will not shrink below what prints legibly', () => {
    const tiny = resizeShape(carAt(60, 120), 'c', 0.01);
    expect(Math.min(tiny.shapes[0].width, tiny.shapes[0].height)).toBeGreaterThanOrEqual(MIN_SIZE);
  });

  it('will not grow past the canvas', () => {
    const huge = resizeShape(carAt(60, 120), 'c', 100);
    expect(Math.max(huge.shapes[0].width, huge.shapes[0].height)).toBeLessThanOrEqual(MAX_SIZE);
  });

  it('keeps the proportions when a limit is reached', () => {
    /*
      The bug a naive clamp produces: each side clamped on its own, so the
      short side pins at the floor while the long side carries on and the car
      turns into a square.
    */
    const before = carAt(60, 120);
    const shrunk = resizeShape(before, 'c', 0.001);
    const shape = shrunk.shapes[0];
    expect(shape.height / shape.width).toBeCloseTo(2, 1);

    const grown = resizeShape(before, 'c', 1000);
    expect(grown.shapes[0].height / grown.shapes[0].width).toBeCloseTo(2, 1);
  });

  it('steps by a proportion, so one press is one visible change', () => {
    const once = resizeShape(carAt(60, 120), 'c', SIZE_STEP);
    expect(once.shapes[0].width).toBeGreaterThan(60);
    expect(once.shapes[0].width).toBeLessThan(120);
  });

  it('scales a freehand path about its own centre', () => {
    // A skid mark drawn too small is a real case, and a box does not fit it.
    const diagram = addShape(emptyDiagram(), {
      id: 'p',
      kind: 'path',
      variant: 'skid',
      x: 100,
      y: 100,
      width: 100,
      height: 0,
      rotation: 0,
      label: '',
      unitNumber: null,
      points: [
        { x: 50, y: 100 },
        { x: 150, y: 100 },
      ],
    });
    const bigger = resizeShape(diagram, 'p', 2);
    const points = bigger.shapes[0].points;
    // Twice as long, still centred on the same place.
    expect(points[1].x - points[0].x).toBe(200);
    expect((points[0].x + points[1].x) / 2).toBe(100);
  });

  it('takes an exact size from a handle drag, clamped the same way', () => {
    expect(setSize(carAt(60, 120), 'c', 90, 180).shapes[0]).toMatchObject({ width: 90, height: 180 });
    expect(setSize(carAt(60, 120), 'c', 1, 1).shapes[0].width).toBe(MIN_SIZE);
    expect(setSize(carAt(60, 120), 'c', 5000, 5000).shapes[0].width).toBe(MAX_SIZE);
  });

  it('leaves the diagram alone when the shape is gone', () => {
    const diagram = carAt(60, 120);
    expect(resizeShape(diagram, 'nope', 2)).toEqual(diagram);
    expect(setSize(diagram, 'nope', 10, 10)).toEqual(diagram);
  });
});

/* ------------------------------------------------------------------ */
/* Street signs                                                        */
/* ------------------------------------------------------------------ */

describe('the sign set', () => {
  const signs = STAMPS.filter((s) => s.group === 'signs');

  it('offers the signs a crash actually turns on', () => {
    /*
      Which sign controlled the approach is often the whole question — whether
      there was a stop or a yield decides who had the right of way — so "a sign
      was here" answers nothing.
    */
    const variants = signs.map((s) => s.variant);
    for (const expected of [
      'sign-stop',
      'sign-yield',
      'sign-speed',
      'sign-doNotEnter',
      'sign-oneWay',
      'sign-railroad',
      'sign-school',
      'sign-warning',
    ]) {
      expect(variants).toContain(expected);
    }
  });

  it('gives every sign a size that can be seen and grabbed', () => {
    for (const sign of signs) {
      expect(sign.width).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(sign.height).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(sign.kind).toBe('object');
    }
  });

  it('seeds the signs whose text is part of the fact', () => {
    // A speed limit sign with no number says something was there, not what.
    expect(takesSignText('sign-speed')).toBe(true);
    expect(takesSignText('sign-street')).toBe(true);
    expect(takesSignText('sign-stop')).toBe(false);

    const speed = STAMPS.find((s) => s.variant === 'sign-speed')!;
    const placed = createShape(speed, { x: 10, y: 10 }, 'sp');
    expect(placed.label).toBe(SIGN_TEXT_DEFAULT['sign-speed']);
    expect(placed.label).not.toBe('');
  });

  it('lets a placed sign keep a label the officer typed', () => {
    const street = STAMPS.find((s) => s.variant === 'sign-street')!;
    expect(createShape(street, { x: 0, y: 0 }, 's', 'Marion St').label).toBe('Marion St');
  });

  it('still resolves the old generic sign, so saved diagrams open', () => {
    // Diagrams drawn before the set existed hold variant 'sign'.
    expect(stampFor('sign').variant).toBeTruthy();
  });
});
