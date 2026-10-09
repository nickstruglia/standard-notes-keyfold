import type { SVGAttributes } from 'preact'

// Inline icons (stroke style) so the editor needs no external assets.
const paths = {
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  eyeOff:
    'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2 M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  plus: 'M12 5v14 M5 12h14',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z',
  lock: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  back: 'M15 18l-6-6 6-6',
  check: 'M5 12l5 5 9-10',
  alert: 'M12 3l10 18H2Z M12 10v4 M12 17.5v.5',
  key: 'M14 10a4 4 0 1 0-3.6 4L13 17h2v2h2v2h3v-3l-6.4-6.4A4 4 0 0 0 14 10Z',
  seed: 'M4 6h16 M4 12h16 M4 18h10',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z',
  duplicate: 'M8 8h12v12H8z M4 16V4h12',
  archive: 'M3 4h18v4H3z M5 8v12h14V8 M10 12h4',
  x: 'M6 6l12 12 M18 6L6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M20 20l-4-4',
  chevron: 'M9 6l6 6-6 6',
  wallet: 'M3 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3z M3 7V5h13v2 M16 13.5h.01',
  terminal: 'M4 6l6 6-6 6 M12 19h8',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  code: 'M8 6l-6 6 6 6 M16 6l6 6-6 6',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l3 2',
  expand: 'M7 9l5-5 5 5 M7 15l5 5 5-5',
  collapse: 'M7 4l5 5 5-5 M7 20l5-5 5 5',
  sliders: 'M4 6h16 M4 12h16 M4 18h16 M9 4v4 M15 10v4 M7 16v4',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  file: 'M6 3h8l4 4v14H6z M14 3v4h4',
} as const

export type IconName = keyof typeof paths

export const Icon = ({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGAttributes<SVGSVGElement>) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    {...rest}
  >
    <path d={paths[name]} />
  </svg>
)
