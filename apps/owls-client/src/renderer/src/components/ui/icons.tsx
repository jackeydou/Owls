// Generated from the IconMCP library (16-unit grid). Each glyph keeps the library's paths
// verbatim; createIcon applies size, color, and the library's stroke weight.
import { cn } from '@renderer/lib/utils'
import type { ComponentType, ReactNode, SVGProps } from 'react'

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  /** Rendered width and height in px. */
  size?: number
  /** Stroke width in screen px. Defaults to the IconMCP weight for the rendered size. */
  strokeWidth?: number
}

export type IconComponent = ComponentType<IconProps>

const GRID = 16

// IconMCP draws its 24px previews with a 1.25px stroke, so the line keeps that thin ratio at
// every size. Below ~19px it holds at 1px so small icons stay crisp on 1x displays.
function defaultStrokeWidth(size: number): number {
  return Math.max(1, (size * 1.25) / 24)
}

function createIcon(name: string, style: 'outline' | 'solid', glyph: ReactNode): IconComponent {
  function Icon({ size = GRID, strokeWidth, className, ...props }: IconProps) {
    const labelled = props['aria-label'] !== undefined || props['aria-labelledby'] !== undefined
    return (
      // biome-ignore lint/a11y/noSvgWithoutTitle: decorative by default (aria-hidden); callers name meaningful icons with aria-label.
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill={style === 'solid' ? 'currentColor' : 'none'}
        stroke={style === 'solid' ? 'none' : 'currentColor'}
        strokeWidth={((strokeWidth ?? defaultStrokeWidth(size)) * GRID) / size}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={labelled ? undefined : true}
        className={cn('owls-icon', className)}
        {...props}
      >
        {glyph}
      </svg>
    )
  }
  Icon.displayName = `${name}Icon`
  return Icon
}

export const AlertCircleIcon = createIcon(
  'AlertCircle',
  'outline',
  <g>
    <circle cx="8" cy="8" r="6" />
    <line x1="8" y1="5.25" x2="8" y2="8.75" />
    <circle cx="8" cy="11.15" r="0.825" fill="currentColor" stroke="none" />
  </g>
)
export const ArrowLeftIcon = createIcon(
  'ArrowLeft',
  'outline',
  <g transform="rotate(180 8 8)">
    <line x1="2.75" y1="8" x2="13.25" y2="8" />
    <path d="M8.5 3.25 L13.25 8 L8.5 12.75" />
  </g>
)
export const ArrowRightIcon = createIcon(
  'ArrowRight',
  'outline',
  <g>
    <line x1="2.75" y1="8" x2="13.25" y2="8" />
    <path d="M8.5 3.25 L13.25 8 L8.5 12.75" />
  </g>
)
export const ArrowUpIcon = createIcon(
  'ArrowUp',
  'outline',
  <g transform="rotate(-90 8 8)">
    <line x1="2.75" y1="8" x2="13.25" y2="8" />
    <path d="M8.5 3.25 L13.25 8 L8.5 12.75" />
  </g>
)
export const BoardIcon = createIcon(
  'Board',
  'outline',
  <g>
    <rect x="2" y="2.5" width="12" height="11" rx="1.75" />
    <rect x="4.5" y="5" width="3" height="3" rx="0.5" />
    <rect x="9" y="7.5" width="2.5" height="3.5" rx="0.5" />
    <path d="M7.5 6.5 H9 V7.5" />
  </g>
)
export const BrainIcon = createIcon(
  'Brain',
  'outline',
  <g>
    <path d="M8 3.5 A2.25 2.25 0 0 0 4 4.25 A2.5 2.5 0 0 0 2.75 8.5 A2.5 2.5 0 0 0 5 12.75 A2 2 0 0 0 8 13" />
    <path d="M8 3.5 A2.25 2.25 0 0 1 12 4.25 A2.5 2.5 0 0 1 13.25 8.5 A2.5 2.5 0 0 1 11 12.75 A2 2 0 0 1 8 13" />
    <line x1="8" y1="3.5" x2="8" y2="13" />
  </g>
)
export const CardPlusIcon = createIcon(
  'CardPlus',
  'outline',
  <g>
    <path d="M13.5 8.5 V4.25 C13.5 3.284 12.716 2.5 11.75 2.5 H4.25 C3.284 2.5 2.5 3.284 2.5 4.25 V11.75 C2.5 12.716 3.284 13.5 4.25 13.5 H8.5" />
    <line x1="5.25" y1="5.75" x2="10.75" y2="5.75" />
    <line x1="5.25" y1="8.5" x2="8.25" y2="8.5" />
    <line x1="12" y1="10.5" x2="12" y2="14" />
    <line x1="10.25" y1="12.25" x2="13.75" y2="12.25" />
  </g>
)
export const CardsIcon = createIcon(
  'Cards',
  'outline',
  <g>
    <rect x="2.5" y="4.5" width="9" height="9" rx="1.5" />
    <path d="M5 2.5 H12 C12.828 2.5 13.5 3.172 13.5 4 V11" />
    <line x1="4.75" y1="7.5" x2="9.25" y2="7.5" />
    <line x1="4.75" y1="10.25" x2="7.75" y2="10.25" />
  </g>
)
export const CheckIcon = createIcon(
  'Check',
  'outline',
  <g>
    <path d="M2.75 8.5 L6.25 12 L13.25 4.5" />
  </g>
)
export const ChevronDownIcon = createIcon(
  'ChevronDown',
  'outline',
  <g transform="rotate(90 8 8)">
    <path d="M5.875 3.75 L10.125 8 L5.875 12.25" />
  </g>
)
export const ChevronRightIcon = createIcon(
  'ChevronRight',
  'outline',
  <g>
    <path d="M5.875 3.75 L10.125 8 L5.875 12.25" />
  </g>
)
export const CircleCheckIcon = createIcon(
  'CircleCheck',
  'outline',
  <g>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.25 8.25 L7.25 10.25 L10.75 6.25" />
  </g>
)
export const CircleDashedIcon = createIcon(
  'CircleDashed',
  'outline',
  <g>
    <path d="M13.88 9.196 A6 6 0 0 1 13.003 11.312" />
    <path d="M11.312 13.003 A6 6 0 0 1 9.196 13.88" />
    <path d="M6.804 13.88 A6 6 0 0 1 4.688 13.003" />
    <path d="M2.997 11.312 A6 6 0 0 1 2.12 9.196" />
    <path d="M2.12 6.804 A6 6 0 0 1 2.997 4.688" />
    <path d="M4.688 2.997 A6 6 0 0 1 6.804 2.12" />
    <path d="M9.196 2.12 A6 6 0 0 1 11.312 2.997" />
    <path d="M13.003 4.688 A6 6 0 0 1 13.88 6.804" />
  </g>
)
export const CircleMinusIcon = createIcon(
  'CircleMinus',
  'outline',
  <g>
    <circle cx="8" cy="8" r="6" />
    <line x1="5.25" y1="8" x2="10.75" y2="8" />
  </g>
)
export const CircleXIcon = createIcon(
  'CircleX',
  'outline',
  <g>
    <circle cx="8" cy="8" r="6" />
    <line x1="5.75" y1="5.75" x2="10.25" y2="10.25" />
    <line x1="10.25" y1="5.75" x2="5.75" y2="10.25" />
  </g>
)
export const CopyIcon = createIcon(
  'Copy',
  'outline',
  <g>
    <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="2" />
    <path d="M3.5 10.75 L2.875 10.75 C2.53 10.75 2.25 10.47 2.25 10.125 L2.25 4.25 C2.25 3.145 3.145 2.25 4.25 2.25 L10.125 2.25 C10.47 2.25 10.75 2.53 10.75 2.875 L10.75 3.5" />
  </g>
)
export const DownloadIcon = createIcon(
  'Download',
  'outline',
  <g>
    <line x1="8" y1="2.25" x2="8" y2="9.25" />
    <path d="M4.75 6 L8 9.25 L11.25 6" />
    <path d="M2.5 10.5 L2.5 12 C2.5 12.828 3.172 13.5 4 13.5 L12 13.5 C12.828 13.5 13.5 12.828 13.5 12 L13.5 10.5" />
  </g>
)
export const EllipsisIcon = createIcon(
  'Ellipsis',
  'outline',
  <g>
    <circle cx="3.25" cy="8" r="0.825" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="0.825" fill="currentColor" stroke="none" />
    <circle cx="12.75" cy="8" r="0.825" fill="currentColor" stroke="none" />
  </g>
)
export const ExternalLinkIcon = createIcon(
  'ExternalLink',
  'outline',
  <g>
    <path d="M7 2.75 L4.75 2.75 C3.645 2.75 2.75 3.645 2.75 4.75 L2.75 11.25 C2.75 12.355 3.645 13.25 4.75 13.25 L11.25 13.25 C12.355 13.25 13.25 12.355 13.25 11.25 L13.25 9" />
    <line x1="7.5" y1="8.5" x2="13.25" y2="2.75" />
    <path d="M9.25 2.75 L13.25 2.75 L13.25 6.75" />
  </g>
)
export const FileCodeIcon = createIcon(
  'FileCode',
  'outline',
  <g>
    <path d="M5.25 2 L9 2 L12.75 5.75 L12.75 12 C12.75 13.105 11.855 14 10.75 14 L5.25 14 C4.145 14 3.25 13.105 3.25 12 L3.25 4 C3.25 2.895 4.145 2 5.25 2 Z" />
    <path d="M9 2 L9 4.75 C9 5.302 9.448 5.75 10 5.75 L12.75 5.75" />
    <path d="M6.75 7.75 L5.25 9.5 L6.75 11.25" />
    <path d="M9.25 7.75 L10.75 9.5 L9.25 11.25" />
  </g>
)
export const FolderIcon = createIcon(
  'Folder',
  'outline',
  <g>
    <path d="M4.25 3.25 L5.33 3.25 C5.914 3.25 6.469 3.505 6.849 3.948 L7.151 4.302 C7.531 4.745 8.086 5 8.67 5 L11.75 5 C12.855 5 13.75 5.895 13.75 7 L13.75 10.75 C13.75 11.855 12.855 12.75 11.75 12.75 L4.25 12.75 C3.145 12.75 2.25 11.855 2.25 10.75 L2.25 5.25 C2.25 4.145 3.145 3.25 4.25 3.25 Z" />
  </g>
)
export const FolderOpenIcon = createIcon(
  'FolderOpen',
  'outline',
  <g>
    <path d="M2.25 12.75 L2.25 5.25 C2.25 4.145 3.145 3.25 4.25 3.25 L5.33 3.25 C5.914 3.25 6.469 3.505 6.849 3.948 L7.151 4.302 C7.531 4.745 8.086 5 8.67 5 L11.25 5 C11.802 5 12.25 5.448 12.25 6 L12.25 7" />
    <path d="M5.183 7 L12.785 7 C13.489 7 13.973 7.709 13.716 8.364 L12.249 12.114 C12.099 12.498 11.729 12.75 11.317 12.75 L3.715 12.75 C3.011 12.75 2.527 12.041 2.784 11.386 L4.251 7.636 C4.401 7.252 4.771 7 5.183 7 Z" />
  </g>
)
export const FolderPlusIcon = createIcon(
  'FolderPlus',
  'outline',
  <g>
    <path d="M7.5 12.75 L4.25 12.75 C3.145 12.75 2.25 11.855 2.25 10.75 L2.25 5.25 C2.25 4.145 3.145 3.25 4.25 3.25 L5.33 3.25 C5.914 3.25 6.469 3.505 6.849 3.948 L7.151 4.302 C7.531 4.745 8.086 5 8.67 5 L12.5 5 C13.19 5 13.75 5.56 13.75 6.25 L13.75 7.5" />
    <line x1="11.75" y1="9.75" x2="11.75" y2="13.75" />
    <line x1="9.75" y1="11.75" x2="13.75" y2="11.75" />
  </g>
)
export const ForwardIcon = createIcon(
  'Forward',
  'outline',
  <g>
    <path d="M2.5 12.5 V11 A4 4 0 0 1 6.5 7 H13.25" />
    <path d="M9.75 3.5 L13.25 7 L9.75 10.5" />
  </g>
)
export const GitBranchIcon = createIcon(
  'GitBranch',
  'outline',
  <g>
    <line x1="4.75" y1="2" x2="4.75" y2="9.5" />
    <circle cx="4.75" cy="11.25" r="1.75" />
    <circle cx="11.25" cy="4.75" r="1.75" />
    <path d="M11.25 6.5 A4.75 4.75 0 0 1 6.5 11.25" />
  </g>
)
export const GitPullRequestIcon = createIcon(
  'GitPullRequest',
  'outline',
  <g>
    <circle cx="4.25" cy="4" r="1.75" />
    <circle cx="11.75" cy="12" r="1.75" />
    <line x1="4.25" y1="5.75" x2="4.25" y2="14" />
    <path d="M8 4 L9.875 4 C10.911 4 11.75 4.839 11.75 5.875 L11.75 10.25" />
    <path d="M10 2 L8 4 L10 6" />
  </g>
)
export const GlobeIcon = createIcon(
  'Globe',
  'outline',
  <g>
    <circle cx="8" cy="8" r="6" />
    <line x1="2" y1="8" x2="14" y2="8" />
    <ellipse cx="8" cy="8" rx="2.5" ry="6" />
  </g>
)
export const InfoIcon = createIcon(
  'Info',
  'outline',
  <g>
    <circle cx="8" cy="8" r="6" />
    <line x1="8" y1="7.25" x2="8" y2="11" />
    <circle cx="8" cy="4.85" r="0.825" fill="currentColor" stroke="none" />
  </g>
)
export const KeyIcon = createIcon(
  'Key',
  'outline',
  <g>
    <circle cx="5" cy="11" r="3" />
    <line x1="7.12" y1="8.88" x2="13.5" y2="2.5" />
    <line x1="11.5" y1="4.5" x2="13.25" y2="6.25" />
    <line x1="9.25" y1="6.75" x2="10.75" y2="8.25" />
  </g>
)
export const LoaderIcon = createIcon(
  'Loader',
  'outline',
  <g>
    <path d="M14 8 A6 6 0 1 1 8 2" />
  </g>
)
export const NetworkIcon = createIcon(
  'Network',
  'outline',
  <g>
    <circle cx="8" cy="8" r="1.75" />
    <circle cx="3.5" cy="3.5" r="1.5" />
    <circle cx="12.5" cy="3.5" r="1.5" />
    <circle cx="3.5" cy="12.5" r="1.5" />
    <circle cx="12.5" cy="12.5" r="1.5" />
    <line x1="6.75" y1="6.75" x2="4.56" y2="4.56" />
    <line x1="9.25" y1="6.75" x2="11.44" y2="4.56" />
    <line x1="6.75" y1="9.25" x2="4.56" y2="11.44" />
    <line x1="9.25" y1="9.25" x2="11.44" y2="11.44" />
  </g>
)
export const PaletteIcon = createIcon(
  'Palette',
  'outline',
  <g>
    <path d="M8 2 A6 6 0 0 0 8 14 C8.83 14 9.25 13.4 9.25 12.75 C9.25 12.2 8.75 11.85 8.75 11.25 C8.75 10.55 9.3 10 10 10 H11.25 A2.75 2.75 0 0 0 14 7.25 C14 4.35 11.3 2 8 2 Z" />
    <circle cx="4.5" cy="9" r="0.825" fill="currentColor" stroke="none" />
    <circle cx="5.25" cy="6" r="0.825" fill="currentColor" stroke="none" />
    <circle cx="7.75" cy="4.5" r="0.825" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="5.5" r="0.825" fill="currentColor" stroke="none" />
  </g>
)
export const PencilIcon = createIcon(
  'Pencil',
  'outline',
  <g>
    <path d="M10.957 3.457 L12.543 5.043 C12.933 5.433 12.933 6.067 12.543 6.457 L5.793 13.207 C5.605 13.395 5.351 13.5 5.086 13.5 L2.5 13.5 L2.5 10.914 C2.5 10.649 2.605 10.395 2.793 10.207 L9.543 3.457 C9.933 3.067 10.567 3.067 10.957 3.457 Z" />
    <line x1="8.75" y1="4.25" x2="11.75" y2="7.25" />
  </g>
)
export const PinIcon = createIcon(
  'Pin',
  'outline',
  <g>
    <path d="M5.726 2.25 L10.274 2.25 C10.661 2.25 10.873 2.702 10.625 3 L10 3.75 L10 6.96 C10 7.148 10.066 7.329 10.185 7.473 L11.407 8.938 C11.841 9.459 11.47 10.25 10.792 10.25 L5.208 10.25 C4.53 10.25 4.159 9.459 4.593 8.938 L5.815 7.473 C5.934 7.329 6 7.148 6 6.96 L6 3.75 L5.375 3 C5.127 2.702 5.339 2.25 5.726 2.25 Z" />
    <line x1="8" y1="10.25" x2="8" y2="14.25" />
  </g>
)
export const PinOffIcon = createIcon(
  'PinOff',
  'outline',
  <g>
    <path d="M7.327 10.25 L5.208 10.25 C4.53 10.25 4.159 9.459 4.593 8.938 L5.124 8.302 M5.36 2.981 C5.136 2.683 5.347 2.25 5.726 2.25 L10.274 2.25 C10.661 2.25 10.873 2.702 10.625 3 L10 3.75 L10 6.96 C10 7.148 10.066 7.329 10.185 7.473 L11.252 8.752" />
    <path d="M8 10.923 L8 14.25" />
    <line x1="2.75" y1="2.75" x2="13.25" y2="13.25" />
  </g>
)
export const PlusIcon = createIcon(
  'Plus',
  'outline',
  <g>
    <line x1="8" y1="2.75" x2="8" y2="13.25" />
    <line x1="2.75" y1="8" x2="13.25" y2="8" />
  </g>
)
export const RefreshIcon = createIcon(
  'Refresh',
  'outline',
  <g>
    <path d="M13.75 8 A5.75 5.75 0 1 1 8 2.25 C9.6 2.25 11.1 2.9 12.25 4 L13.75 5.5" />
    <path d="M13.75 2.25 L13.75 5.5 L10.5 5.5" />
  </g>
)
export const RotateCcwIcon = createIcon(
  'RotateCcw',
  'outline',
  <g>
    <path d="M2.25 8 A5.75 5.75 0 1 0 8 2.25 C6.4 2.25 4.9 2.9 3.75 4 L2.25 5.5" />
    <path d="M2.25 2.25 L2.25 5.5 L5.5 5.5" />
  </g>
)
export const RouteIcon = createIcon(
  'Route',
  'outline',
  <g>
    <circle cx="3.75" cy="12" r="1.75" />
    <path d="M5.5 12 H11.5 A2 2 0 0 0 11.5 8 H4.5 A2 2 0 0 1 4.5 4 H10.5" />
    <circle cx="12.25" cy="4" r="1.75" />
  </g>
)
export const ScrollTextIcon = createIcon(
  'ScrollText',
  'outline',
  <g>
    <path d="M4.5 10.5 V4 A2 2 0 0 1 6.5 2 H12 A1.75 1.75 0 0 1 12 5.5 H11.5 V12 A2 2 0 0 1 9.5 14 H4 A1.75 1.75 0 0 1 4 10.5 Z" />
    <line x1="6.75" y1="6.75" x2="9.25" y2="6.75" />
    <line x1="6.75" y1="9.5" x2="9.25" y2="9.5" />
  </g>
)
export const TagIcon = createIcon(
  'Tag',
  'outline',
  <g>
    <path d="M2.5 3.75 V7.4 C2.5 7.73 2.63 8.05 2.87 8.28 L7.97 13.38 C8.46 13.87 9.25 13.87 9.74 13.38 L13.38 9.74 C13.87 9.25 13.87 8.46 13.38 7.97 L8.28 2.87 C8.05 2.63 7.73 2.5 7.4 2.5 H3.75 C3.06 2.5 2.5 3.06 2.5 3.75 Z" />
    <circle cx="5.5" cy="5.5" r="1" />
  </g>
)
export const SearchIcon = createIcon(
  'Search',
  'outline',
  <g>
    <circle cx="7" cy="7" r="4.5" />
    <line x1="10.25" y1="10.25" x2="13.5" y2="13.5" />
  </g>
)
export const SettingsIcon = createIcon(
  'Settings',
  'outline',
  <g>
    <path d="M6.663 3.269 L6.631 2.646 C6.611 2.246 6.93 1.91 7.33 1.91 L8.67 1.91 C9.07 1.91 9.389 2.246 9.369 2.646 L9.337 3.269 C9.324 3.532 9.459 3.779 9.686 3.911 L10.698 4.495 C10.926 4.626 11.208 4.619 11.428 4.476 L11.953 4.137 C12.289 3.92 12.739 4.028 12.939 4.375 L13.609 5.535 C13.809 5.882 13.678 6.326 13.322 6.508 L12.766 6.793 C12.532 6.912 12.385 7.153 12.385 7.416 L12.385 8.584 C12.385 8.847 12.532 9.088 12.766 9.207 L13.322 9.492 C13.678 9.674 13.809 10.118 13.609 10.465 L12.939 11.625 C12.739 11.972 12.289 12.08 11.953 11.863 L11.428 11.524 C11.208 11.381 10.926 11.374 10.698 11.505 L9.686 12.089 C9.459 12.221 9.324 12.468 9.337 12.731 L9.369 13.354 C9.389 13.754 9.07 14.09 8.67 14.09 L7.33 14.09 C6.93 14.09 6.611 13.754 6.631 13.354 L6.663 12.731 C6.676 12.468 6.541 12.221 6.314 12.089 L5.302 11.505 C5.074 11.374 4.792 11.381 4.572 11.524 L4.047 11.863 C3.711 12.08 3.261 11.972 3.061 11.625 L2.391 10.465 C2.191 10.118 2.322 9.674 2.678 9.492 L3.234 9.207 C3.468 9.088 3.615 8.847 3.615 8.584 L3.615 7.416 C3.615 7.153 3.468 6.912 3.234 6.793 L2.678 6.508 C2.322 6.326 2.191 5.882 2.391 5.535 L3.061 4.375 C3.261 4.028 3.711 3.92 4.047 4.137 L4.572 4.476 C4.792 4.619 5.074 4.626 5.302 4.495 L6.314 3.911 C6.541 3.779 6.676 3.532 6.663 3.269 Z" />
    <circle cx="8" cy="8" r="2" />
  </g>
)
export const ShieldCheckIcon = createIcon(
  'ShieldCheck',
  'outline',
  <g>
    <path d="M5 2.5 L11 2.5 C12.105 2.5 13 3.395 13 4.5 L13 7.129 C13 7.374 12.955 7.617 12.867 7.847 L11.929 10.284 C11.812 10.59 11.62 10.862 11.372 11.077 L8 14 L4.628 11.077 C4.38 10.862 4.188 10.59 4.071 10.284 L3.133 7.847 C3.045 7.617 3 7.374 3 7.129 L3 4.5 C3 3.395 3.895 2.5 5 2.5 Z" />
    <path d="M5.5 7.75 L7.25 9.5 L10.5 6.25" />
  </g>
)
export const SidebarLeftIcon = createIcon(
  'SidebarLeft',
  'outline',
  <g>
    <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
    <line x1="6" y1="2.75" x2="6" y2="13.25" />
  </g>
)
export const SidebarRightIcon = createIcon(
  'SidebarRight',
  'outline',
  <g>
    <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
    <line x1="10" y1="2.75" x2="10" y2="13.25" />
  </g>
)
export const SlidersIcon = createIcon(
  'Sliders',
  'outline',
  <g>
    <line x1="2.25" y1="4.75" x2="7.75" y2="4.75" />
    <circle cx="9.75" cy="4.75" r="2" />
    <line x1="11.75" y1="4.75" x2="13.75" y2="4.75" />
    <line x1="2.25" y1="11.25" x2="4.25" y2="11.25" />
    <circle cx="6.25" cy="11.25" r="2" />
    <line x1="8.25" y1="11.25" x2="13.75" y2="11.25" />
  </g>
)
export const SparklesIcon = createIcon(
  'Sparkles',
  'outline',
  <g>
    <path d="M7 4 C7.5 7.25 8.75 8.5 12 9 C8.75 9.5 7.5 10.75 7 14 C6.5 10.75 5.25 9.5 2 9 C5.25 8.5 6.5 7.25 7 4 Z" />
    <path d="M12 1.75 C12.225 3.212 12.787 3.775 14.25 4 C12.787 4.225 12.225 4.787 12 6.25 C11.775 4.787 11.213 4.225 9.75 4 C11.213 3.775 11.775 3.212 12 1.75 Z" />
  </g>
)
export const StopIcon = createIcon(
  'Stop',
  'outline',
  <g>
    <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
  </g>
)
export const TerminalIcon = createIcon(
  'Terminal',
  'outline',
  <g>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
    <path d="M4.5 6 L6.5 8 L4.5 10" />
    <line x1="8" y1="10" x2="11" y2="10" />
  </g>
)
export const TrashIcon = createIcon(
  'Trash',
  'outline',
  <g>
    <path d="M3.5 4.25 L4.105 11.907 C4.187 12.948 5.055 13.75 6.098 13.75 L9.902 13.75 C10.945 13.75 11.813 12.948 11.895 11.907 L12.5 4.25" />
    <line x1="2.25" y1="4.25" x2="13.75" y2="4.25" />
    <path d="M6 4.25 L6 3.25 C6 2.698 6.448 2.25 7 2.25 L9 2.25 C9.552 2.25 10 2.698 10 3.25 L10 4.25" />
    <line x1="6.75" y1="7" x2="6.75" y2="11" />
    <line x1="9.25" y1="7" x2="9.25" y2="11" />
  </g>
)
export const UserIcon = createIcon(
  'User',
  'outline',
  <g>
    <circle cx="8" cy="5" r="2.75" />
    <path d="M2.75 13.75 C3.3 11.15 5.4 9.5 8 9.5 C10.6 9.5 12.7 11.15 13.25 13.75" />
  </g>
)
export const WaypointsIcon = createIcon(
  'Waypoints',
  'outline',
  <g>
    <circle cx="3.75" cy="3.75" r="1.75" />
    <circle cx="12.25" cy="3.75" r="1.75" />
    <circle cx="3.75" cy="12.25" r="1.75" />
    <circle cx="12.25" cy="12.25" r="1.75" />
    <line x1="5.5" y1="3.75" x2="10.5" y2="3.75" />
    <line x1="11" y1="5" x2="5" y2="11" />
    <line x1="5.5" y1="12.25" x2="10.5" y2="12.25" />
  </g>
)
export const XIcon = createIcon(
  'X',
  'outline',
  <g>
    <line x1="3.75" y1="3.75" x2="12.25" y2="12.25" />
    <line x1="12.25" y1="3.75" x2="3.75" y2="12.25" />
  </g>
)
