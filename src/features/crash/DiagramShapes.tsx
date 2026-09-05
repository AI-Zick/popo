import { memo } from 'react';
import { grabBox, type Shape } from '@/domain/diagram';

/**
 * How each stamp is drawn.
 *
 * One component, used by the editor and by the printed report, so what the
 * officer arranged is exactly what a jury sees. Everything is plain SVG at a
 * fixed nominal size and scaled by the shape's box — no images, no fonts to
 * load, and it prints at whatever resolution the printer has.
 *
 * Deliberately schematic. A crash diagram is a sketch showing relative position
 * and direction of travel; drawing a recognisable Silverado would imply a
 * precision that nobody measured.
 */

/** Ink colours, resolved from the theme so the editor works in dark mode. */
const INK = 'var(--c-ink)';
const LINE = 'var(--c-line-strong)';
const ROAD = 'var(--c-raised)';

export const DiagramShape = memo(function DiagramShape({
  shape,
  selected,
  print,
}: {
  shape: Shape;
  selected?: boolean;
  print?: boolean;
}) {
  // On paper everything is black on white; ink colour comes from the theme
  // on screen, where the canvas may be dark.
  const stroke = print ? '#000' : INK;
  const fill = print ? '#fff' : 'var(--c-surface)';
  const soft = print ? '#e8e8e8' : ROAD;

  const body = (() => {
    switch (shape.kind) {
      case 'vehicle':
        return <VehicleBody shape={shape} stroke={stroke} fill={fill} />;
      case 'road':
        return <RoadBody shape={shape} stroke={print ? '#999' : LINE} fill={soft} />;
      case 'arrow':
        return <ArrowBody shape={shape} stroke={stroke} />;
      case 'object':
        return <ObjectBody shape={shape} stroke={stroke} fill={fill} />;
      case 'label':
        return (
          <text
            x={0}
            y={5}
            textAnchor="middle"
            fontSize={18}
            fontWeight={600}
            fill={stroke}
            style={{ userSelect: 'none' }}
          >
            {shape.label || 'Text'}
          </text>
        );
      case 'path':
        return null;
    }
  })();

  /*
    A freehand path carries absolute points, so it is drawn in canvas space
    rather than being translated and rotated like a stamp. Rotating a skid mark
    around its own centre is not a thing anybody wants.
  */
  if (shape.kind === 'path') {
    const d = shape.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');
    return (
      <g>
        {/* A thin line is a thin target. This one is invisible and wide. */}
        {!print && (
          <path d={d} fill="none" stroke="transparent" strokeWidth={28} strokeLinecap="round" />
        )}
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={shape.variant === 'skid' ? 6 : 3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={shape.variant === 'debris' ? '2 10' : undefined}
          opacity={shape.variant === 'skid' ? 0.75 : 1}
        />
        {selected && (
          <path d={d} fill="none" stroke="var(--c-accent)" strokeWidth={12} opacity={0.25} />
        )}
      </g>
    );
  }

  const grab = grabBox(shape);

  return (
    <g transform={`translate(${shape.x} ${shape.y}) rotate(${shape.rotation})`}>
      {/*
        The thing that actually takes the pointer.

        SVG hit-testing follows painted pixels, which for a diagram editor is
        the wrong rule: a centre line is eight units of stroke and a pedestrian
        is five thin lines with air between them, so both were all but
        impossible to grab — measured at 0 and 2 of 25 points across their own
        boxes. Drawn first so it sits under the art, and never in print, where
        nothing is being grabbed.
      */}
      {!print && (
        <rect
          x={-grab.width / 2}
          y={-grab.height / 2}
          width={grab.width}
          height={grab.height}
          fill="transparent"
          stroke="transparent"
          strokeWidth={0}
        />
      )}
      {selected && (
        <rect
          x={-shape.width / 2 - 8}
          y={-shape.height / 2 - 8}
          width={shape.width + 16}
          height={shape.height + 16}
          rx={6}
          fill="none"
          stroke="var(--c-accent)"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      )}
      {body}
      {/*
        The unit number rides upright regardless of how the vehicle is turned:
        a "2" rotated 180 degrees reads as a different number.
      */}
      {shape.unitNumber !== null && (
        <g transform={`rotate(${-shape.rotation})`}>
          <circle r={15} fill={print ? '#000' : 'var(--c-accent)'} />
          <text
            y={5.5}
            textAnchor="middle"
            fontSize={17}
            fontWeight={700}
            fill="#fff"
            style={{ userSelect: 'none' }}
          >
            {shape.unitNumber}
          </text>
        </g>
      )}
    </g>
  );
});

function VehicleBody({ shape, stroke, fill }: { shape: Shape; stroke: string; fill: string }) {
  const w = shape.width;
  const h = shape.height;
  const half = { w: w / 2, h: h / 2 };

  if (shape.variant === 'motorcycle') {
    return (
      <g stroke={stroke} strokeWidth={2.5} fill="none">
        <line x1={0} y1={-half.h} x2={0} y2={half.h} />
        <circle cx={0} cy={-half.h + 8} r={7} fill={fill} />
        <circle cx={0} cy={half.h - 8} r={7} fill={fill} />
        <line x1={-10} y1={-6} x2={10} y2={-6} />
      </g>
    );
  }

  return (
    <g>
      <rect
        x={-half.w}
        y={-half.h}
        width={w}
        height={h}
        rx={Math.min(12, w / 4)}
        fill={fill}
        stroke={stroke}
        strokeWidth={2.5}
      />
      {/* Windscreen at the front, so which way it faces is unambiguous. */}
      <path
        d={`M ${-half.w + 7} ${-half.h + h * 0.24} L ${half.w - 7} ${-half.h + h * 0.24} L ${half.w - 12} ${-half.h + h * 0.1} L ${-half.w + 12} ${-half.h + h * 0.1} Z`}
        fill={stroke}
        opacity={0.18}
      />
      <line
        x1={-half.w + 6}
        y1={half.h - h * 0.2}
        x2={half.w - 6}
        y2={half.h - h * 0.2}
        stroke={stroke}
        strokeWidth={2}
        opacity={0.4}
      />
      {shape.variant === 'truck' && (
        <line x1={-half.w} y1={-half.h + h * 0.34} x2={half.w} y2={-half.h + h * 0.34} stroke={stroke} strokeWidth={2.5} />
      )}
      {/* A nose mark, so direction of travel reads at a glance. */}
      <path
        d={`M ${-8} ${-half.h - 2} L 0 ${-half.h - 12} L 8 ${-half.h - 2}`}
        fill="none"
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </g>
  );
}

function RoadBody({ shape, stroke, fill }: { shape: Shape; stroke: string; fill: string }) {
  const half = { w: shape.width / 2, h: shape.height / 2 };

  if (shape.variant === 'centreline') {
    return (
      <line
        x1={0}
        y1={-half.h}
        x2={0}
        y2={half.h}
        stroke={stroke}
        strokeWidth={4}
        strokeDasharray="24 18"
      />
    );
  }
  if (shape.variant === 'stopline') {
    return <rect x={-half.w} y={-half.h} width={shape.width} height={shape.height} fill={stroke} />;
  }
  if (shape.variant === 'crosswalk') {
    const bars = 7;
    return (
      <g fill={stroke} opacity={0.7}>
        {Array.from({ length: bars }, (_, i) => (
          <rect
            key={i}
            x={-half.w + (i * shape.width) / bars + 4}
            y={-half.h}
            width={shape.width / bars - 8}
            height={shape.height}
          />
        ))}
      </g>
    );
  }
  return (
    <rect
      x={-half.w}
      y={-half.h}
      width={shape.width}
      height={shape.height}
      fill={fill}
      stroke={stroke}
      strokeWidth={2}
    />
  );
}

function ArrowBody({ shape, stroke }: { shape: Shape; stroke: string }) {
  const half = shape.height / 2;
  return (
    <g stroke={stroke} strokeWidth={4} fill="none" strokeLinecap="round">
      <line x1={0} y1={half} x2={0} y2={-half + 14} />
      <path d={`M ${-13} ${-half + 18} L 0 ${-half} L 13 ${-half + 18}`} strokeLinejoin="round" />
    </g>
  );
}

function ObjectBody({ shape, stroke, fill }: { shape: Shape; stroke: string; fill: string }) {
  const half = { w: shape.width / 2, h: shape.height / 2 };

  if (shape.variant.startsWith('sign-')) {
    return <SignFace shape={shape} stroke={stroke} fill={fill} />;
  }

  switch (shape.variant) {
    case 'pedestrian':
      return (
        <g stroke={stroke} strokeWidth={2.5} fill="none" strokeLinecap="round">
          <circle cx={0} cy={-9} r={6} fill={fill} />
          <line x1={0} y1={-3} x2={0} y2={7} />
          <line x1={-7} y1={1} x2={7} y2={1} />
          <line x1={0} y1={7} x2={-6} y2={15} />
          <line x1={0} y1={7} x2={6} y2={15} />
        </g>
      );
    case 'bicycle':
      return (
        <g stroke={stroke} strokeWidth={2.5} fill="none">
          <circle cx={0} cy={-half.h + 10} r={9} />
          <circle cx={0} cy={half.h - 10} r={9} />
          <line x1={0} y1={-half.h + 10} x2={0} y2={half.h - 10} />
        </g>
      );
    case 'impact':
      // A starburst, which is the convention on every crash form.
      return (
        <g stroke={stroke} strokeWidth={3} strokeLinecap="round">
          {[0, 45, 90, 135].map((angle) => (
            <line
              key={angle}
              x1={-half.w * Math.cos((angle * Math.PI) / 180)}
              y1={-half.h * Math.sin((angle * Math.PI) / 180)}
              x2={half.w * Math.cos((angle * Math.PI) / 180)}
              y2={half.h * Math.sin((angle * Math.PI) / 180)}
            />
          ))}
        </g>
      );
    case 'signal':
      return (
        <g>
          <rect x={-half.w} y={-half.h} width={shape.width} height={shape.height} rx={5} fill={fill} stroke={stroke} strokeWidth={2.5} />
          {[-14, 0, 14].map((cy) => (
            <circle key={cy} cx={0} cy={cy} r={5} fill={stroke} opacity={0.55} />
          ))}
        </g>
      );
    case 'sign':
      // Anything drawn before the sign set existed. Kept so old diagrams open.
      return <SignFace shape={{ ...shape, variant: 'sign-other' }} stroke={stroke} fill={fill} />;
    case 'tree':
      return (
        <g>
          <circle r={half.w} fill={fill} stroke={stroke} strokeWidth={2.5} />
          <path d={`M 0 0 L 0 ${half.h}`} stroke={stroke} strokeWidth={3} />
        </g>
      );
    case 'building':
      return (
        <rect
          x={-half.w}
          y={-half.h}
          width={shape.width}
          height={shape.height}
          fill={fill}
          stroke={stroke}
          strokeWidth={2.5}
          strokeDasharray="8 5"
        />
      );
    default:
      return <circle r={half.w} fill={fill} stroke={stroke} strokeWidth={2.5} />;
  }
}

/** The north arrow every crash diagram carries. */
export function NorthArrow({ rotation, print }: { rotation: number; print?: boolean }) {
  const stroke = print ? '#000' : 'var(--c-ink)';
  return (
    <g transform={`translate(70 70) rotate(${rotation})`} pointerEvents="none">
      <circle r={34} fill="none" stroke={stroke} strokeWidth={1.5} opacity={0.35} />
      <path d="M 0 -26 L 9 8 L 0 1 L -9 8 Z" fill={stroke} />
      <text y={-32} textAnchor="middle" fontSize={13} fontWeight={700} fill={stroke}>
        N
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Street signs                                                        */
/* ------------------------------------------------------------------ */

/**
 * Sign colours, as the manual assigns them.
 *
 * Kept in print as well as on screen. Which sign controlled an approach is
 * frequently the whole question in a crash, and the shapes carry that on their
 * own — an octagon is a stop on the fourth photocopy — but where colour
 * survives, red and yellow are read faster than any label.
 */
const SIGN = {
  red: '#c8102e',
  white: '#ffffff',
  black: '#1a1a1a',
  yellow: '#ffcd00',
  green: '#006341',
  /* Fluorescent yellow-green: school and pedestrian crossings only. */
  schoolGreen: '#c6e000',
};

/**
 * One street sign, drawn to its assigned shape.
 *
 * The shape is the meaning. Every one of these is scaled from the stamp's own
 * box so resizing works the same way it does for everything else, and the text
 * that some of them carry — a speed limit, a street name — is the shape's
 * label, so what the officer typed is what the sign says.
 */
function SignFace({ shape, stroke, fill }: { shape: Shape; stroke: string; fill: string }) {
  const w = shape.width;
  const h = shape.height;
  const hw = w / 2;
  const hh = h / 2;
  const edge = Math.max(1.5, Math.min(w, h) * 0.07);

  /** Text upright regardless of how the sign has been turned. */
  const Upright = ({ children }: { children: React.ReactNode }) => (
    <g transform={`rotate(${-shape.rotation})`}>{children}</g>
  );

  const face = (fillColour: string, strokeColour: string, d: string) => (
    <path d={d} fill={fillColour} stroke={strokeColour} strokeWidth={edge} strokeLinejoin="round" />
  );

  /** A regular polygon inscribed in the box, first vertex pointing up. */
  const polygon = (sides: number, rotate = 0) =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2 + (rotate * Math.PI) / 180;
      return `${(Math.cos(a) * hw).toFixed(2)} ${(Math.sin(a) * hh).toFixed(2)}`;
    })
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p}`)
      .join(' ') + ' Z';

  switch (shape.variant) {
    case 'sign-stop':
      return (
        <g>
          {face(SIGN.red, SIGN.white, polygon(8, 22.5))}
          {/*
            Sized to sit inside the octagon rather than across it. Bold text is
            wider per character than the usual estimate, and "STOP" hanging out
            over both edges reads as a mistake in the drawing.
          */}
          <Upright>
            <text
              y={h * 0.09}
              textAnchor="middle"
              fontSize={h * 0.25}
              fontWeight={700}
              fill={SIGN.white}
              style={{ userSelect: 'none' }}
            >
              STOP
            </text>
          </Upright>
        </g>
      );

    case 'sign-yield':
      return (
        <g>
          {/* Point down, which is the shape's whole distinguishing feature. */}
          {face(SIGN.white, SIGN.red, `M ${-hw} ${-hh} L ${hw} ${-hh} L 0 ${hh} Z`)}
          {/*
            The word sits high, where the triangle is still wide. Centred it
            overflowed the sloping sides — a yield sign with its own name
            hanging off the edge, which is worse than no word at all. The
            shape and the red border are what carry the meaning; the word is
            what survives a black-and-white photocopy.
          */}
          <Upright>
            <text
              y={-hh * 0.34}
              textAnchor="middle"
              fontSize={h * 0.19}
              fontWeight={700}
              fill={SIGN.red}
              style={{ userSelect: 'none' }}
            >
              YIELD
            </text>
          </Upright>
        </g>
      );

    case 'sign-speed':
      return (
        <g>
          <rect x={-hw} y={-hh} width={w} height={h} fill={SIGN.white} stroke={SIGN.black} strokeWidth={edge} />
          <Upright>
            <text
              y={-hh * 0.38}
              textAnchor="middle"
              fontSize={h * 0.17}
              fontWeight={700}
              fill={SIGN.black}
              style={{ userSelect: 'none' }}
            >
              SPEED
            </text>
            <text
              y={-hh * 0.08}
              textAnchor="middle"
              fontSize={h * 0.17}
              fontWeight={700}
              fill={SIGN.black}
              style={{ userSelect: 'none' }}
            >
              LIMIT
            </text>
            <text
              y={hh * 0.62}
              textAnchor="middle"
              fontSize={h * 0.42}
              fontWeight={700}
              fill={SIGN.black}
              style={{ userSelect: 'none' }}
            >
              {shape.label || '—'}
            </text>
          </Upright>
        </g>
      );

    case 'sign-doNotEnter':
      return (
        <g>
          <circle r={Math.min(hw, hh)} fill={SIGN.red} stroke={SIGN.white} strokeWidth={edge} />
          <rect
            x={-Math.min(hw, hh) * 0.62}
            y={-Math.min(hw, hh) * 0.16}
            width={Math.min(hw, hh) * 1.24}
            height={Math.min(hw, hh) * 0.32}
            fill={SIGN.white}
          />
        </g>
      );

    case 'sign-wrongWay':
      return (
        <g>
          <rect x={-hw} y={-hh} width={w} height={h} fill={SIGN.red} stroke={SIGN.white} strokeWidth={edge} />
          <Upright>
            <text
              y={-h * 0.04}
              textAnchor="middle"
              fontSize={h * 0.3}
              fontWeight={700}
              fill={SIGN.white}
              style={{ userSelect: 'none' }}
            >
              WRONG
            </text>
            <text
              y={h * 0.3}
              textAnchor="middle"
              fontSize={h * 0.3}
              fontWeight={700}
              fill={SIGN.white}
              style={{ userSelect: 'none' }}
            >
              WAY
            </text>
          </Upright>
        </g>
      );

    case 'sign-oneWay':
      return (
        <g>
          <rect x={-hw} y={-hh} width={w} height={h} fill={SIGN.black} stroke={SIGN.white} strokeWidth={edge} />
          {/* The arrow turns with the sign: which way is the whole message. */}
          <g fill={SIGN.white}>
            <rect x={-hw * 0.72} y={-h * 0.06} width={w * 0.58} height={h * 0.12} />
            <path
              d={`M ${hw * 0.16} ${-h * 0.22} L ${hw * 0.8} 0 L ${hw * 0.16} ${h * 0.22} Z`}
            />
          </g>
        </g>
      );

    case 'sign-noTurn':
      return (
        <g>
          <rect x={-hw} y={-hh} width={w} height={h} fill={SIGN.white} stroke={SIGN.black} strokeWidth={edge} />
          <circle r={Math.min(hw, hh) * 0.62} fill="none" stroke={SIGN.red} strokeWidth={edge * 1.4} />
          <line
            x1={-Math.min(hw, hh) * 0.44}
            y1={Math.min(hw, hh) * 0.44}
            x2={Math.min(hw, hh) * 0.44}
            y2={-Math.min(hw, hh) * 0.44}
            stroke={SIGN.red}
            strokeWidth={edge * 1.4}
          />
        </g>
      );

    case 'sign-warning':
      return (
        <g>
          {face(SIGN.yellow, SIGN.black, `M 0 ${-hh} L ${hw} 0 L 0 ${hh} L ${-hw} 0 Z`)}
          {shape.label && (
            <Upright>
              <text
                y={h * 0.1}
                textAnchor="middle"
                fontSize={h * 0.26}
                fontWeight={700}
                fill={SIGN.black}
                style={{ userSelect: 'none' }}
              >
                {shape.label}
              </text>
            </Upright>
          )}
        </g>
      );

    case 'sign-school':
      // The five-sided school shape, in the fluorescent yellow-green.
      return (
        <g>
          {face(
            SIGN.schoolGreen,
            SIGN.black,
            `M 0 ${-hh} L ${hw} ${-hh * 0.28} L ${hw * 0.62} ${hh} L ${-hw * 0.62} ${hh} L ${-hw} ${-hh * 0.28} Z`,
          )}
          <Upright>
            <text
              y={h * 0.16}
              textAnchor="middle"
              fontSize={h * 0.22}
              fontWeight={700}
              fill={SIGN.black}
              style={{ userSelect: 'none' }}
            >
              SCH
            </text>
          </Upright>
        </g>
      );

    case 'sign-crossing':
      return (
        <g>
          {face(
            SIGN.schoolGreen,
            SIGN.black,
            `M 0 ${-hh} L ${hw} 0 L 0 ${hh} L ${-hw} 0 Z`,
          )}
          {/* A walking figure, the way the crossing sign carries it. */}
          <g stroke={SIGN.black} strokeWidth={Math.max(1.2, h * 0.05)} fill="none" strokeLinecap="round">
            <circle cx={0} cy={-h * 0.16} r={h * 0.07} fill={SIGN.black} />
            <line x1={0} y1={-h * 0.08} x2={0} y2={h * 0.08} />
            <line x1={-h * 0.11} y1={h * 0.24} x2={0} y2={h * 0.08} />
            <line x1={0} y1={h * 0.08} x2={h * 0.11} y2={h * 0.24} />
            <line x1={-h * 0.12} y1={-h * 0.02} x2={h * 0.1} y2={h * 0.04} />
          </g>
        </g>
      );

    case 'sign-railroad':
      // The crossbuck: two boards in an X, which is unmistakable at any size.
      return (
        <g>
          <g transform="rotate(45)">
            <rect x={-hw * 0.98} y={-hh * 0.24} width={hw * 1.96} height={hh * 0.48} fill={SIGN.white} stroke={SIGN.black} strokeWidth={edge} />
          </g>
          <g transform="rotate(-45)">
            <rect x={-hw * 0.98} y={-hh * 0.24} width={hw * 1.96} height={hh * 0.48} fill={SIGN.white} stroke={SIGN.black} strokeWidth={edge} />
          </g>
        </g>
      );

    case 'sign-railroadAdvance':
      return (
        <g>
          <circle r={Math.min(hw, hh)} fill={SIGN.yellow} stroke={SIGN.black} strokeWidth={edge} />
          <Upright>
            <text
              y={h * 0.16}
              textAnchor="middle"
              fontSize={h * 0.46}
              fontWeight={700}
              fill={SIGN.black}
              style={{ userSelect: 'none' }}
            >
              RR
            </text>
          </Upright>
        </g>
      );

    case 'sign-street':
      return (
        <g>
          <rect x={-hw} y={-hh} width={w} height={h} rx={h * 0.14} fill={SIGN.green} stroke={SIGN.white} strokeWidth={edge} />
          <Upright>
            <text
              y={h * 0.2}
              textAnchor="middle"
              fontSize={h * 0.56}
              fontWeight={600}
              fill={SIGN.white}
              style={{ userSelect: 'none' }}
            >
              {shape.label || 'Street'}
            </text>
          </Upright>
        </g>
      );

    default:
      // Anything the officer would rather describe in words.
      return (
        <g>
          <rect x={-hw} y={-hh} width={w} height={h} rx={3} fill={fill} stroke={stroke} strokeWidth={edge} />
          {shape.label && (
            <Upright>
              <text
                y={h * 0.16}
                textAnchor="middle"
                fontSize={h * 0.36}
                fontWeight={600}
                fill={stroke}
                style={{ userSelect: 'none' }}
              >
                {shape.label}
              </text>
            </Upright>
          )}
        </g>
      );
  }
}
