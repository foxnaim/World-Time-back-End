'use client';

import * as React from 'react';
import { motion, type Transition } from 'framer-motion';
import { COLORS, type ColorToken } from './tokens';
import { cn } from './cn';

export interface DialProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  progress: number;
  ticks?: number;
  highlightStart?: number;
  highlightEnd?: number;
  label?: string;
  sublabel?: string;
  indicatorColor?: ColorToken;
  hourLabels?: string[];
  indicatorTransition?: Transition;
}

const TAU = Math.PI * 2;

function polar(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function describeArc(cx: number, cy: number, r: number, startFrac: number, endFrac: number) {
  const startAngle = -Math.PI / 2 + startFrac * TAU;
  const endAngle = -Math.PI / 2 + endFrac * TAU;
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const delta = (endFrac - startFrac + 1) % 1;
  const largeArc = delta > 0.5 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export const Dial: React.FC<DialProps> = ({
  size = 520,
  progress,
  ticks = 60,
  highlightStart,
  highlightEnd,
  label,
  sublabel,
  indicatorColor = 'coral',
  hourLabels,
  indicatorTransition,
  className,
  ...rest
}) => {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 4;
  const tickOuter = outerR - 2;
  const tickInnerShort = outerR - 14;
  const tickInnerLong = outerR - 28;
  // Sit the indicator dot inside the tick band (between tickOuter = outerR-2
  // and tickInnerShort = outerR-14) so neither the dot nor its halo pokes
  // past the outer ring.
  const indicatorR = outerR - 13;

  const clamped = Math.max(0, Math.min(1, progress));
  const rotationDeg = clamped * 360;

  const tickElements = React.useMemo(() => {
    const elems: React.ReactElement[] = [];
    for (let i = 0; i < ticks; i++) {
      const frac = i / ticks;
      const angle = -Math.PI / 2 + frac * TAU;
      const isMajor = i % 5 === 0;
      const inner = isMajor ? tickInnerLong : tickInnerShort;
      const p1 = polar(cx, cy, tickOuter, angle);
      const p2 = polar(cx, cy, inner, angle);
      elems.push(
        <line
          key={i}
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke={COLORS.stone}
          strokeOpacity={isMajor ? 0.6 : 0.25}
          strokeWidth={isMajor ? 1.25 : 1}
          strokeLinecap="round"
        />,
      );
    }
    return elems;
  }, [ticks, cx, cy, tickOuter, tickInnerShort, tickInnerLong]);

  const highlightPath =
    typeof highlightStart === 'number' && typeof highlightEnd === 'number'
      ? describeArc(cx, cy, outerR - 20, highlightStart, highlightEnd)
      : null;

  const ariaLabel =
    label || sublabel
      ? [label, sublabel].filter(Boolean).join(' — ')
      : `Dial at ${(clamped * 100).toFixed(0)}%`;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn('relative inline-block select-none', className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <circle
          cx={cx}
          cy={cy}
          r={outerR}
          fill="none"
          stroke={COLORS.stone}
          strokeOpacity={0.2}
          strokeWidth={1}
        />
        <circle
          cx={cx}
          cy={cy}
          r={outerR - 36}
          fill="none"
          stroke={COLORS.stone}
          strokeOpacity={0.12}
          strokeWidth={1}
        />

        {highlightPath && (
          <path
            d={highlightPath}
            fill="none"
            stroke={COLORS.coral}
            strokeOpacity={0.2}
            strokeWidth={18}
            strokeLinecap="round"
          />
        )}

        <g>{tickElements}</g>

        {hourLabels && size >= 280 && hourLabels.slice(0, 12).map((lbl, i) => {
          if (!lbl) return null;
          const angle = -Math.PI / 2 + (i / 12) * TAU;
          const labelR = outerR - 56;
          const pos = polar(cx, cy, labelR, angle);
          const reached = clamped >= i / 12 - 0.005;
          return (
            <text
              key={i}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size >= 500 ? 9 : 7}
              fill={COLORS.stone}
              fontFamily="Inter, system-ui, sans-serif"
              letterSpacing="0.07em"
              style={{
                fillOpacity: reached ? 0.65 : 0,
                transition: 'fill-opacity 0.45s ease-out',
              }}
            >
              {lbl}
            </text>
          );
        })}

        <motion.g
          initial={false}
          animate={{ rotate: rotationDeg }}
          transition={indicatorTransition ?? { type: 'spring', stiffness: 60, damping: 18, mass: 0.8 }}
          style={{ originX: `${cx}px`, originY: `${cy}px`, transformBox: 'view-box' }}
        >
          <circle cx={cx} cy={cy - indicatorR} r={6} fill={COLORS[indicatorColor]} />
          <circle
            cx={cx}
            cy={cy - indicatorR}
            r={10}
            fill={COLORS[indicatorColor]}
            fillOpacity={0.18}
          />
        </motion.g>
      </svg>

      {(label || sublabel) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {label && (
            <span
              className="text-5xl md:text-6xl font-medium tracking-tight text-[#8E8D8A]"
              style={{ fontFamily: 'Fraunces, serif' }}
            >
              {label}
            </span>
          )}
          {sublabel && (
            <span className="mt-2 text-[10px] uppercase tracking-[0.28em] text-[#8E8D8A]/70">
              {sublabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

Dial.displayName = 'Dial';
