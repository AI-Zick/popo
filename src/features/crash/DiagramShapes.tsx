import { memo } from 'react';
import type { Shape } from '@/domain/diagram';

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

  return (
    <g transform={`translate(${shape.x} ${shape.y}) rotate(${shape.rotation})`}>
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
      return (
        <g>
          <path
            d={`M 0 ${-half.h} L ${half.w} 0 L 0 ${half.h} L ${-half.w} 0 Z`}
            fill={fill}
            stroke={stroke}
            strokeWidth={2.5}
          />
        </g>
      );
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
