# Netmap NG — "Ledger" design

The UI follows the **Ledger** style: a well-composed operations report, not a
wall of neon tiles. Ink on a calm grey ground, **one accent (cobalt)**, amber
for "watch", red only for an incident. Structure comes from **rules and
space**, never boxes.

Three principles come first:

1. **Order by the user's questions.** A page first answers "is anything
   wrong?", then "how much, which trend?", then the detail.
2. **Normal stays silent** (dark cockpit). A normal state has no color, no
   badge, no animation. Only what is abnormal lights up, and always with **a
   word** ("Watch", "Incident", "Down"), never color alone.
3. **Every visual element carries information.** No decorative glow, pulse,
   fade, gradient or shadow. Animation only to signal something.

## Information architecture (by urgency)

| Page | 1. Is anything wrong? | 2. How much / trend | 3. Detail |
|---|---|---|---|
| Map (private & public) | "Right now" band: links down, devices down, hottest link, data freshness | The map itself (link colors = load, quiet when normal) + legend | Link graph panel, properties |
| Map list | — (per-map health is not fetched) | Table: name, visibility, size, updated | Open the map |
| Editor | Validation / save errors (toast with the reason) | Canvas | Property panel, dialogs |

### "Right now" band (map views)
3–4 facts side by side, separated by vertical rules. Each fact: tertiary label
(13px), value (22px), one context sentence (13px). **A normal fact has no
color.** An abnormal fact colors its value and adds a small word badge
("Watch" on pale amber, "Incident" white-on-red). **The value names what
triggered the color** ("2 links down", "core1 → edge2 at 93%", not a bare
number in red).

Facts: *Links down* (status `down`; `admin_down` is mentioned in the sentence,
not alarmed) · *Devices down* (node status `down`) · *Busiest link* (highest
in/out %, severity from the scale: `utilizationSeverity()`) · *Data* (age of
the newest poll; Watch when older than 15 min).

## Tokens

All colors are CSS variables defined in `frontend/src/styles/index.css`
(`@theme static`), with three themes: dark (default), `.light`, `.scada`
(the Ledger rules on a near-black, high-contrast ground with phosphor-green
ink/accent — no glow, no scanlines).

| Role | Class suffix | Notes |
|---|---|---|
| Page ground | `background` | Sections sit directly on it |
| Surface | `card` | Popovers, menus, dialogs, panels only |
| Ink / secondary / tertiary | `foreground` / `foreground-secondary` / `muted-foreground` | Tertiary for labels, axes, help text |
| Rule / soft rule | `border` / `border-soft` | Soft for table rows and grids |
| Quiet fill | `muted` | Segmented control track, hover, skeletons |
| Accent | `link` (and `ring` for focus) | Links, focus, selection, series B. Nothing else. |
| Series A / B | `series-a` / `series-b` | In / out (ink vs cobalt) |
| Watch | `warning` (text), `warning-mark` (fills), `warning-muted` (badge bg) | Only for a watch state |
| Incident | `destructive`, `destructive-muted`, `on-destructive` | Only for an incident / down |
| OK | `success` | Rarely shown (header health dot) |
| Ordinal | `ordinal-1..8` | Categories when needed |

Map colors may be **tokens** instead of hex: `@quiet`, `@load`, `@watch`,
`@incident`, `@muted`, `@ink`, `@accent`. Resolve with
`resolveColor()` (`utils/scaleColor.ts`); anything drawing resolved colors must
re-render when the theme changes (`useTheme().resolvedTheme`).

Default traffic scale (backend `DEFAULT_SCALE`): 0–40% `@quiet`, 40–70%
`@load`, 70–90% `@watch` ("Watch ≥ 70%"), 90–100% `@incident`
("Incident ≥ 90%"). Maps still on the pre-Ledger default are migrated at
startup; customized scales are kept.

### Old → new classes (the `noc-*` aliases are transitional and must go)

| Old | New |
|---|---|
| `bg-noc-bg` | `bg-background` |
| `bg-noc-card`, `noc-glass`, `noc-card` | `bg-card` + `border border-border` only for floating surfaces; **sections: no box** |
| `bg-noc-surface` | `bg-muted` |
| `border-noc-border` / `border-noc-border-subtle` | `border-border` / `border-border-soft` |
| `text-noc-text` / `-muted` / `-dim` | `text-foreground` / `text-foreground-secondary` / `text-muted-foreground` |
| `text-accent`, `bg-accent/…` | `text-link`; selection fills `bg-link/10` sparingly |
| `traffic-in` / `traffic-out` | `series-a` / `series-b` |
| `node-*` type colors | none: node types are neutral and named by their word |
| `node-firewall` as error color | `destructive` |
| `noc-label` (uppercase micro-label) | sentence case: section title `text-lg font-semibold` (15px/600), field label `text-sm text-muted-foreground` |
| `text-2xs` (10px) | `text-xs` (12px) for axes/legends, `text-sm` (13px) for secondary text |

## Typography

- One family: **Archivo** (variable `wdth` 62–125 and `wght`), self-hosted via
  `@fontsource-variable/archivo` (no third-party request; CSP is `'self'`).
- `tabular-nums lining-nums` on `body`; figures align without monospace.
- Monospace (`font-mono`, system stack) only for `code`, `kbd`, tokens and
  technical URLs (e.g. the public share link).
- Scale (px, the root is 14px so sizes are absolute in `@theme`):
  `text-xs` 12 (axes, legends) · `text-sm` 13 (secondary) · `text-base` 14
  (body) · `text-lg` 15/600 (section titles) · `text-xl`/`text-2xl` 22–28
  (page title, band values) · `font-display` ≈64px/300/115% (hero figure).
- `font-ip` (88% width) for IPs, port names, long identifiers.
- No `uppercase`, no `tracking-*` letter-spaced labels. Nothing under 12px.

## Layout

- **Sections are not cards.** A section opens with an ink rule
  (`border-t-2 border-foreground` for a summary page, `border-t
  border-foreground` for a detail block) on the page ground; no border box, no
  shadow, no radius.
- Summary pages use the two-column ledger grid: left ~220px (section title
  15px/600 + one 13px tertiary line explaining how to read the data), right
  the data. Stacks on mobile.
- **Tables are the default for lists**: header 13px tertiary, sentence case;
  rows separated by `border-border-soft`; numbers right-aligned; no zebra.
- Header: opaque, bottom rule, no blur. Navigation in normal text, the active
  item underlined in ink. Health dot steady green / amber / red, **no pulse**,
  with a tooltip.
- Floating surfaces (dialogs, popovers, side panels, menus) use `bg-card`, a
  1px `border-border`, 4px radius, **no shadow** (a 1px rule is enough).
- Mobile (390px): 16px gutter, no horizontal page scroll; toolbars wrap;
  wide tables scroll inside their own container.

## Components

- **Buttons**: 4px radius, `border-border`, on the page ground. Primary is
  solid ink (`bg-foreground text-background`). Destructive confirmation is
  `bg-destructive text-on-destructive`. No gradient, no shadow.
- **Segmented control** (6h / 24h / 7d / 30d…): `bg-muted` track, the active
  segment `bg-card text-foreground`. Prefer it to duplicating views.
- **Badges**: 12–13px, 4px radius, sentence case; neutral (`border-border`)
  by default, colored only for a state.
- **Loading**: a flat `bg-muted` block, no shimmer, no spinner animation
  beyond a static "Loading…" text when needed.
- **Empty states**: one sentence saying why it is empty and what to do.
- **Toasts**: card surface + rule; an error toast says "Couldn't …" plus the
  backend reason, with the incident color on a word, not a red box.

## Charts (traffic graph)

- **Mirror chart**: in (series A) above a solid zero line, out (series B)
  below, **one shared scale**.
- **Step area (`stepAfter`)**: data is aggregated per RRD interval.
- **Scaled to capacity** when the link has a bandwidth: the top of the chart is
  100% of capacity (both directions), never auto-scale. Without capacity, fall
  back to the shared max.
- Horizontal grid lines only, `border-soft`; axes 12px tertiary with units
  ("800M", "1.2 Gb/s"); no chart border.
- One useful annotation: the window **peak** (dashed line + short label), and
  the capacity when not at the top.
- Previous-period overlay: dashed ink line, toggled by a checkbox.
- Stats (max / avg / 95th) as a small table, tabular figures.

## Motion & accessibility

- No entrance animation, no pulse, no glow, no blur, no shimmer. Control state
  transitions only (100–150ms). `prefers-reduced-motion` is respected globally.
- Focus visible everywhere: `outline: 2px solid var(--color-ring)`.
- AA contrast, including tertiary text and axes.
- The theme is applied before the first paint (`public/theme-init.js`).
- Pinch-zoom is allowed (no `user-scalable=no`).
- Color never carries information alone: add a word, a position or a shape.

## Checklist before shipping

- [ ] The first thing visible answers "is everything fine?", and normal is silent.
- [ ] No text under 12px, no letter-spaced uppercase labels.
- [ ] One font family; monospace only for code.
- [ ] Figures align in columns (tabular-nums).
- [ ] No glow, pulse, entrance fade, blur or shimmer.
- [ ] Sections separated by rules, not boxes.
- [ ] Amber and red only for abnormal states, always with a word.
- [ ] Comparable lists share a scale; anything with a capacity is drawn against it.
- [ ] Light, dark and SCADA checked at 1440px and 390px, no horizontal scroll.
- [ ] Pinch-zoom works and keyboard focus is visible.
