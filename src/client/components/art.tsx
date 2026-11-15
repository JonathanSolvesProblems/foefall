import type { ClassId, MobId } from '../../shared/engine/rules';
import { ICONS, type IconName } from '../icons';

export const CLASS_ICON: Record<ClassId, IconName> = {
  vanguard: 'shieldBash',
  reaver: 'battleAxe',
  gloamhunter: 'grapple',
  hexweaver: 'spellBook',
  shardcaller: 'fallingStar',
};

export const MOB_ICON: Record<MobId, IconName> = {
  wolf: 'wolfHead',
  boar: 'boar',
  thief: 'hoodedAssassin',
  acolyte: 'cultist',
};

/** A game-icons.net glyph centred at (cx, cy) with the given size, in SVG user units. */
export function Glyph(props: { name: IconName; cx: number; cy: number; size: number; fill: string; opacity?: number | undefined }) {
  const s = props.size / 512;
  return (
    <path
      d={ICONS[props.name]}
      fill={props.fill}
      opacity={props.opacity ?? 1}
      transform={`translate(${props.cx - props.size / 2} ${props.cy - props.size / 2}) scale(${s})`}
    />
  );
}

/** A standalone icon badge for HTML (hero cards, help sheet). */
export function IconBadge(props: { name: IconName; ring: string; fill: string; size?: number | undefined; dim?: boolean | undefined }) {
  const size = props.size ?? 34;
  return (
    <svg className="badge" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ opacity: props.dim ? 0.5 : 1 }}>
      <circle cx="50" cy="50" r="45" fill="#1b1420" stroke={props.ring} strokeWidth="6" />
      <Glyph name={props.name} cx={50} cy={50} size={56} fill={props.fill} />
    </svg>
  );
}

/** Vael, the broken moon: a pale disc split by one jagged crack, with fragments drifting off. Drawn in code. */
export function Moon(props: { size: number; className?: string | undefined }) {
  return (
    <svg className={props.className} width={props.size} height={props.size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="moonfill" cx="42%" cy="38%" r="65%">
          <stop offset="0%" stopColor="#fbf6e8" />
          <stop offset="70%" stopColor="#e3d9c0" />
          <stop offset="100%" stopColor="#b8ab8d" />
        </radialGradient>
        <radialGradient id="moonglow" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#f6e9c766" />
          <stop offset="100%" stopColor="#f6e9c700" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#moonglow)" />
      <circle cx="50" cy="50" r="30" fill="url(#moonfill)" />
      <circle cx="40" cy="42" r="4" fill="#c9bc9e" opacity="0.6" />
      <circle cx="58" cy="60" r="6" fill="#c9bc9e" opacity="0.5" />
      <circle cx="61" cy="38" r="2.5" fill="#c9bc9e" opacity="0.6" />
      <path d="M57 20 L51 33 L56 40 L47 52 L52 60 L44 80" fill="none" stroke="#2a1f30" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M56 40 L64 44" fill="none" stroke="#2a1f30" strokeWidth="1.4" />
      <path d="M47 52 L38 55" fill="none" stroke="#2a1f30" strokeWidth="1.2" />
      <path d="M80 26 l5 -2 l2 4 l-5 2 z" fill="#d8ccb0" />
      <path d="M86 40 l3 -1 l1 3 l-3 1 z" fill="#cfc2a5" />
      <path d="M76 16 l2 -1 l1 2 l-2 1 z" fill="#cfc2a5" />
    </svg>
  );
}
