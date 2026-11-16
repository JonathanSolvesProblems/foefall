import { type Enemy, knifePath, MOBS, type Puzzle, type State, type StrikeEvent, type Unit } from '../../shared/engine/rules';
import { CLASS_ICON, Glyph, MOB_ICON } from './art';

const T = 100;
const DIR_ANGLE = { N: -90, E: 0, S: 90, W: 180 } as const;

export type BoardProps = {
  puzzle: Puzzle;
  state: State;
  strikes: StrikeEvent[];
  /** Monsters the forecast says will fall. */
  doomed: ReadonlySet<string>;
  /** Heroes and lamps the forecast says will be hit. */
  danger: ReadonlySet<string>;
  selected: string | null;
  moveTiles: readonly (readonly [number, number])[];
  targetTiles: readonly (readonly [number, number])[];
  striking: boolean;
  /** During Strike: monsters that strike, and pieces their strikes hit. */
  attacking?: ReadonlySet<string> | undefined;
  hitting?: ReadonlySet<string> | undefined;
  /** After Strike: a burst on each tile where something fell. */
  bursts?: readonly { id: string; x: number; y: number; hero: boolean }[] | undefined;
  onTile?: ((x: number, y: number) => void) | undefined;
  /** A stuck player's first step: the hero to use, where it walks, and what it targets. */
  nudge?: { from: readonly [number, number]; to: readonly [number, number]; target: readonly [number, number] | null } | null | undefined;
  label: string;
};

type Placed = { unit: Unit; x: number; y: number; gone: boolean; cause?: string | undefined };

function placeAll(p: Puzzle, s: State): Placed[] {
  const all: Unit[] = [...p.heroes, ...p.enemies];
  const out: Placed[] = [];
  for (const base of all) {
    const live = s.units.find((u) => u.id === base.id);
    if (live) {
      out.push({ unit: live, x: live.x, y: live.y, gone: false });
      continue;
    }
    const f = s.fallen.find((v) => v.id === base.id);
    if (f) {
      out.push({ unit: { ...base, hp: 0 }, x: f.x, y: f.y, gone: true, cause: f.cause });
      continue;
    }
    const l = s.lost.find((v) => v.id === base.id);
    if (l) out.push({ unit: { ...base, hp: 0 }, x: l.x, y: l.y, gone: true });
  }
  return out;
}

export function Board(props: BoardProps) {
  const { puzzle, state } = props;
  const W = state.w * T;
  const H = state.h * T;
  const placed = placeAll(puzzle, state);
  const moveSet = new Set(props.moveTiles.map(([x, y]) => `${x},${y}`));
  const targetSet = new Set(props.targetTiles.map(([x, y]) => `${x},${y}`));
  const thieves = state.units.filter((u): u is Enemy => u.side === 'enemy' && u.mob === 'thief');

  const tiles = [];
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      const t = state.tiles[y * state.w + x];
      const px = x * T;
      const py = y * T;
      if (t === 'chasm') {
        tiles.push(
          <g key={`t${x},${y}`}>
            <rect x={px} y={py} width={T} height={T} fill="url(#chasm)" />
            <path
              d={`M${px + 18} ${py + 8} L${px + 40} ${py + 38} L${px + 30} ${py + 58} L${px + 58} ${py + 74} L${px + 80} ${py + 94}`}
              fill="none"
              stroke="#7a5cc0"
              strokeOpacity="0.55"
              strokeWidth="2"
            />
          </g>
        );
      } else {
        tiles.push(
          <rect
            key={`t${x},${y}`}
            x={px + 1}
            y={py + 1}
            width={T - 2}
            height={T - 2}
            rx="6"
            fill={(x + y) % 2 === 0 ? '#2b2231' : '#2f2536'}
            stroke="#3a2f44"
            strokeWidth="1.5"
          />
        );
        if (t === 'rock') {
          tiles.push(
            <g key={`r${x},${y}`}>
              <rect x={px + 12} y={py + 16} width={T - 24} height={T - 24} rx="16" fill="#1a141e" opacity="0.6" />
              <rect x={px + 10} y={py + 10} width={T - 20} height={T - 22} rx="16" fill="url(#rock)" stroke="#5f5368" strokeWidth="2" />
              <path d={`M${px + 22} ${py + 26} q 20 -8 46 0`} stroke="#8b7d93" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.6" />
            </g>
          );
        }
      }
    }
  }

  return (
    <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} role="img" aria-label={props.label} className={props.striking ? 'striking' : ''}>
      <defs>
        <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="#c8443a" fillOpacity="0.28" />
          <rect width="5" height="12" fill="#ff6a50" fillOpacity="0.55" />
        </pattern>
        <radialGradient id="chasm" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#1d1230" />
          <stop offset="100%" stopColor="#050307" />
        </radialGradient>
        <linearGradient id="rock" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a4e63" />
          <stop offset="100%" stopColor="#3a3043" />
        </linearGradient>
        <radialGradient id="lampglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffd88a" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#ffd88a" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x={-4} y={-4} width={W + 8} height={H + 8} rx="12" fill="#120d16" stroke="#8d7240" strokeWidth="3" />
      {tiles}

      {/* Where the hero may walk */}
      {props.moveTiles.map(([x, y]) => (
        <circle key={`m${x},${y}`} className="move-dot" cx={x * T + T / 2} cy={y * T + T / 2} r="11" fill="#d9b66b" opacity="0.75" />
      ))}

      {/* Struck tiles: everything a monster will hit when you press Strike */}
      {props.strikes.map((ev) =>
        ev.tiles.map(([x, y]) => (
          <rect
            key={`s${ev.attacker}${x},${y}`}
            className="strike-tile"
            x={x * T + 4}
            y={y * T + 4}
            width={T - 8}
            height={T - 8}
            rx="8"
            fill="url(#hatch)"
            stroke="#ff7a5c"
            strokeWidth="2.5"
            opacity="0.85"
          />
        ))
      )}

      {/* The thief's knife flies until it hits something */}
      {props.strikes.length > 0 &&
        thieves.map((t) => {
          const path = knifePath(state, t);
          if (path.length === 0) return null;
          const last = path[path.length - 1]!;
          return (
            <line
              key={`k${t.id}`}
              x1={t.x * T + T / 2}
              y1={t.y * T + T / 2}
              x2={last[0] * T + T / 2}
              y2={last[1] * T + T / 2}
              stroke="#ffb199"
              strokeWidth="3"
              strokeDasharray="8 8"
              opacity="0.8"
            />
          );
        })}

      {/* Lamps */}
      {state.lamps.map((l) => (
        <g key={l.id}>
          {l.lit && <circle cx={l.x * T + T / 2} cy={l.y * T + T / 2} r="48" fill="url(#lampglow)" />}
          <Glyph name="lanternFlame" cx={l.x * T + T / 2} cy={l.y * T + T / 2} size={58} fill={l.lit ? '#ffd88a' : '#958b9d'} />
          {props.danger.has(l.id) && (
            <circle className="danger-ring" cx={l.x * T + T / 2} cy={l.y * T + T / 2} r="42" fill="none" stroke="#ff6a5a" strokeWidth="5" />
          )}
        </g>
      ))}

      {/* A nudge: the hero's tile, the gold square it walks to, the path between them, and the target */}
      {props.nudge && (
        <g className="nudge" pointerEvents="none">
          <rect x={props.nudge.from[0] * T + 3} y={props.nudge.from[1] * T + 3} width={T - 6} height={T - 6} rx="10" fill="none" stroke="#f6e1a8" strokeWidth="4" strokeDasharray="10 7" />
          {(props.nudge.to[0] !== props.nudge.from[0] || props.nudge.to[1] !== props.nudge.from[1]) && (
            <>
              <line
                x1={props.nudge.from[0] * T + T / 2}
                y1={props.nudge.from[1] * T + T / 2}
                x2={props.nudge.to[0] * T + T / 2}
                y2={props.nudge.to[1] * T + T / 2}
                stroke="#f6e1a8"
                strokeWidth="4"
                strokeDasharray="6 9"
                strokeLinecap="round"
                opacity="0.85"
              />
              <rect x={props.nudge.to[0] * T + 6} y={props.nudge.to[1] * T + 6} width={T - 12} height={T - 12} rx="10" fill="#d9b66b" fillOpacity="0.35" stroke="#f6e1a8" strokeWidth="4" />
            </>
          )}
          {props.nudge.target && (
            <circle cx={props.nudge.target[0] * T + T / 2} cy={props.nudge.target[1] * T + T / 2} r="46" fill="none" stroke="#f6e1a8" strokeWidth="6" />
          )}
        </g>
      )}

      {/* Targets the selected hero can use its ability on */}
      {props.targetTiles.map(([x, y]) => (
        <circle
          key={`g${x},${y}`}
          cx={x * T + T / 2}
          cy={y * T + T / 2}
          r="47"
          fill="none"
          stroke="#f6e1a8"
          strokeWidth="3"
          strokeDasharray="9 8"
          opacity="0.8"
        />
      ))}

      {/* Pieces */}
      {placed.map(({ unit, x, y, gone }) => {
        const cx = T / 2;
        const cy = T / 2;
        const hero = unit.side === 'hero';
        const ring = hero ? '#d9b66b' : '#d1543f';
        const fill = hero ? '#f1d590' : '#efe6d2';
        const directional = unit.side === 'enemy' && MOBS[unit.mob].directional;
        return (
          <g
            key={unit.id}
            className={`token${gone ? ' gone' : ''}${props.selected === unit.id ? ' selected' : ''}${props.attacking?.has(unit.id) ? ' attacking' : ''}${props.hitting?.has(unit.id) ? ' hit' : ''}`}
            style={{ transform: `translate(${x * T}px, ${y * T}px)` }}
          >
            <g className="shaker">
            <g className="shape">
              <ellipse cx={cx} cy={cy + 34} rx="30" ry="8" fill="#000" opacity="0.35" />
              <circle className="ring" cx={cx} cy={cy} r="38" fill="#1b1420" stroke={ring} strokeWidth="5" />
              {directional && unit.side === 'enemy' && (
                <path d="M 44 -8 L 56 0 L 44 8 Z" fill={ring} transform={`translate(${cx} ${cy}) rotate(${DIR_ANGLE[unit.dir]})`} />
              )}
              <Glyph name={hero ? CLASS_ICON[unit.cls] : MOB_ICON[unit.mob]} cx={cx} cy={cy} size={50} fill={fill} />
              {unit.side === 'enemy' && unit.hp > 1 && (
                <g>
                  {Array.from({ length: unit.hp }, (_, i) => (
                    <circle key={i} cx={cx - (unit.hp - 1) * 7 + i * 14} cy={cy + 30} r="5" fill="#ff8a6a" stroke="#1b1420" strokeWidth="2" />
                  ))}
                </g>
              )}
            </g>
            </g>
            {!gone && props.doomed.has(unit.id) && (
              <g transform={`translate(${cx + 30} ${cy - 30})`}>
                <circle r="15" fill="#241a0c" stroke="#d9b66b" strokeWidth="2.5" />
                <Glyph name="crossedSwords" cx={0} cy={0} size={20} fill="#f6e1a8" />
              </g>
            )}
            {!gone && props.danger.has(unit.id) && (
              <g transform={`translate(${cx + 30} ${cy - 30})`} className="danger-ring">
                <circle r="15" fill="#3a0d0a" stroke="#ff6a5a" strokeWidth="2.5" />
                <text y="6" textAnchor="middle" fontSize="20" fontWeight="700" fill="#ff8a6a">
                  !
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Where something fell: a burst of light */}
      {(props.bursts ?? []).map((b) => (
        <g key={`b${b.id}`} transform={`translate(${b.x * T + T / 2} ${b.y * T + T / 2})`}>
          <circle className="burst" r="40" fill="none" stroke={b.hero ? '#ff6a5a' : '#ffd88a'} strokeWidth="6" />
          <circle className="burst late" r="28" fill="none" stroke={b.hero ? '#ff8a6a' : '#fff1c8'} strokeWidth="3" />
        </g>
      ))}

      {/* Tap layer */}
      {props.onTile &&
        Array.from({ length: state.w * state.h }, (_, i) => {
          const x = i % state.w;
          const y = Math.floor(i / state.w);
          const live = state.units.find((u) => u.x === x && u.y === y);
          const actionable = moveSet.has(`${x},${y}`) || targetSet.has(`${x},${y}`) || live?.side === 'hero';
          return (
            <rect
              key={`c${i}`}
              x={x * T}
              y={y * T}
              width={T}
              height={T}
              fill="transparent"
              style={{ cursor: actionable ? 'pointer' : 'default' }}
              onClick={() => props.onTile?.(x, y)}
            />
          );
        })}
    </svg>
  );
}
