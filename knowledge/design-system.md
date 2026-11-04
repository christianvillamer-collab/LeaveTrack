# LeaveTrack Design System — "Evergreen" v1.0 (Day 0 provisional)

> No Figma export was present in `docs/designs/` when this scaffold was generated. This document is
> the Day 0 source of truth for UI work. Replace it — and the tokens in `app/globals.css` — when a
> real Figma export arrives.

Implementation: `app/globals.css` (`@theme` + `@layer base`). All colors are HSL; never introduce
hex, rgb, or oklch values into CSS.

## 1. Color tokens

| Token                | Value              | Use                           |
| -------------------- | ------------------ | ----------------------------- |
| `background`         | `hsl(40 20% 98%)`  | App background                |
| `foreground`         | `hsl(215 25% 15%)` | Primary text                  |
| `surface` / `card`   | `hsl(0 0% 100%)`   | Cards, inputs, popovers       |
| `surface-muted`      | `hsl(40 15% 96%)`  | Subtle panels, table hover    |
| `muted`              | `hsl(40 15% 94%)`  | Disabled/neutral fills        |
| `muted-foreground`   | `hsl(215 16% 46%)` | Secondary text                |
| `border`             | `hsl(214 20% 89%)` | Dividers, card outlines       |
| `input`              | `hsl(214 20% 84%)` | Form control borders          |
| `primary`            | `hsl(164 72% 24%)` | Brand, primary buttons, links |
| `primary-hover`      | `hsl(164 72% 19%)` | Primary hover                 |
| `primary-foreground` | `hsl(0 0% 100%)`   | Text on primary               |
| `primary-subtle`     | `hsl(158 45% 94%)` | Selected nav, soft highlights |
| `secondary`          | `hsl(214 40% 30%)` | Secondary actions             |
| `success`            | `hsl(152 60% 32%)` | Approved                      |
| `warning`            | `hsl(35 92% 40%)`  | Pending                       |
| `danger`             | `hsl(0 72% 45%)`   | Rejected, destructive         |
| `info`               | `hsl(214 80% 45%)` | Informational states          |
| `sidebar`            | `hsl(164 30% 12%)` | Desktop navigation            |
| `sidebar-active`     | `hsl(164 40% 20%)` | Active nav item               |

Each semantic color has `-subtle` and `-foreground` companions. Badges always use dark text on a
subtle fill, never white on a mid-tone amber.

### Contrast

- White on `primary` ≈ 6.4:1 (WCAG AA for normal text).
- `foreground` on `background` ≈ 14:1.
- `muted-foreground` on `surface` ≈ 5.1:1.
- Warning/danger/success badges pair `-foreground` on `-subtle` (all ≥ 4.5:1).
- Never use `muted-foreground` for essential body copy on `surface-muted` without checking.

## 2. Typography

Family: **Inter**, self-hosted at `app/fonts/InterVariable-latin.woff2` and loaded with
`next/font/local` as `--font-inter` / `font-sans`. Do not switch back to `next/font/google`: builds and
CI must not require network access to Google Fonts.

| Token          | Size / line-height / weight | Use                         |
| -------------- | --------------------------- | --------------------------- |
| `text-display` | 36 / 40 / 700               | Login hero                  |
| `text-h1`      | 30 / 36 / 650               | Page titles                 |
| `text-h2`      | 24 / 32 / 600               | Section titles, stat values |
| `text-h3`      | 20 / 28 / 600               | Card titles                 |
| `text-body`    | 16 / 24 / 400               | Body                        |
| `text-small`   | 14 / 20 / 400–600           | Controls, table cells       |
| `text-caption` | 12 / 16 / 400–600           | Metadata, hints             |

Use `tabular-nums` for balances, counts, and table numerals.

## 3. Spacing, radii, shadows

- Spacing: 4px base — `1`=4, `2`=8, `3`=12, `4`=16, `5`=20, `6`=24, `8`=32, `10`=40, `12`=48,
  `16`=64, `20`=80, `24`=96.
- Radii: `sm` 6px, `md` 10px (controls), `lg` 14px (cards), `xl` 20px (dialogs).
- Shadows: `xs` resting cards, `sm` controls, `md` raised panels, `lg` dialogs.
- Focus: 2px `ring` outline with 2px offset plus a 3px 25%-opacity primary ring on form controls.
  Never remove focus-visible styling.

## 4. Breakpoints & layout

Mobile-first. Tailwind defaults plus `xs` 480px.

| Name  | Width | Behavior                                       |
| ----- | ----- | ---------------------------------------------- |
| `xs`  | 480   | Small phones                                   |
| `sm`  | 640   | 2-column stat grids                            |
| `md`  | 768   | Two-column stat grids                          |
| `lg`  | 1024  | Sidebar appears, mobile bottom nav hides       |
| `xl`  | 1280  | Dense tables replace cards; two-column layouts |
| `2xl` | 1440  | Max content width 1200px                       |

- Desktop: 264px sidebar (sticky), 64px top bar, content `max-w-[1200px]` with 32px gutters.
- Mobile: 56px header, slide-over navigation, fixed 5-item bottom nav, 24px bottom padding plus
  `env(safe-area-inset-bottom)`.
- Verify at 320, 375, 768, 1024, and 1440px. No horizontal scroll at 320.

## 5. Component inventory

### Primitives (`components/ui/`)

| Component    | Variants / states                                                                      |
| ------------ | -------------------------------------------------------------------------------------- |
| `Button`     | primary, secondary, ghost, danger, link; sm/md/lg/icon; loading, disabled, asChild     |
| `Input`      | default, focus, invalid, disabled; optional leading icon                               |
| `Textarea`   | default, focus, invalid, disabled                                                      |
| `Select`     | default, focus, invalid, disabled; chevron overlay                                     |
| `Label`      | required marker handled by `Field`                                                     |
| `Field`      | label, hint, error, required; render-prop wires `id`/`aria-describedby`/`aria-invalid` |
| `Badge`      | neutral, primary, success, warning, danger, info, outline                              |
| `Card`       | Card/Header/Title/Description/Content/Footer                                           |
| `Alert`      | info, success, warning, danger; `role=alert` for danger                                |
| `Avatar`     | sm/md/lg; initials                                                                     |
| `Skeleton`   | `aria-hidden`, pulse                                                                   |
| `EmptyState` | icon, title, description, optional action                                              |
| `Table`      | scroll container; header/body/row/head/cell                                            |
| `Dialog`     | native `<dialog>`, Escape/backdrop close, labelled, footer slot                        |
| `PageHeader` | eyebrow, title, description, actions                                                   |

### Domain (`components/domain/`)

`StatusBadge`, `LeaveTypeBadge`, `StatCard`, `BalanceCard`, `RequestTable` (desktop table + mobile
cards), `RequestForm`, `ApprovalCard` + decision dialog, `AuditTrail`, `AuditExplorer`.

### Layout (`components/layout/`)

`AppShell`, `Sidebar` (desktop), `TopBar`, `MobileNav` (header + slide-over + bottom nav), `Brand`,
`PreviewBadge`.

## 6. Interaction states

Every interactive component must render: default, hover, focus-visible, active/selected, disabled,
loading, empty, and error.

- Buttons: `disabled:opacity-50`, `aria-busy` while loading, spinner + "Working…" text.
- Forms: error text uses `role="alert"` and `aria-describedby`; invalid fields get `aria-invalid`.
- Lists/tables: empty states use `EmptyState`, never a bare "No data".
- Page-level failures: `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`.
- Dashboard/page loads: `app/loading.tsx` with skeletons (`aria-busy`).

## 7. Iconography

- Library: `lucide-react`, stroke width 2.
- Sizes: 16px inline, 20px default, 24px navigation. Use `size-*` utilities.
- Decorative icons: `aria-hidden="true"`. Icon-only controls: `aria-label` + `sr-only` text.
- Center icons with flex (`items-center justify-center`) or `mx-auto`. Never rely on a parent's
  `text-align: center`; Tailwind preflight makes `<svg>` block-level.

## 8. Accessibility

- Semantic landmarks: `header`, `nav aria-label`, `main#main-content`, `footer`.
- Skip link is the first focusable element.
- Every page has one `h1`; sections use `h2`/`h3` without skipping levels.
- Tables use `th scope="col"` and caption-like card headers.
- Keyboard: all controls reachable; dialogs trap focus natively; Escape closes.
- Live regions announce search result counts and success/error messages.
- Minimum target size 32px (`icon-sm`) with 40px preferred.
- Respect `prefers-reduced-motion` (base layer disables transitions/animations).

## 9. Page map

| Route                | Role          | Purpose                                |
| -------------------- | ------------- | -------------------------------------- |
| `/login`             | public        | Mock sign-in + role picker             |
| `/dashboard`         | all           | Role-aware overview                    |
| `/requests`          | all           | Own request history                    |
| `/requests/new`      | all           | Submit form (DB-backed, TASK-011)      |
| `/requests/[id]`     | scoped        | Detail + audit trail + decision        |
| `/balance`           | all           | DB-backed confirmed vs pending         |
| `/approvals`         | manager, HR   | DB queue + approve/reject; HR boundary |
| `/audit`             | HR            | Searchable audit log                   |
| `/settings/policies` | HR            | Read-only policies                     |
| `/forbidden`         | authenticated | 403                                    |
| `/api/health`        | public        | Health probe                           |

## 10. Do not regress

1. Keep every hand-written base selector inside `@layer base`. Tailwind v4 utilities live in a
   cascade layer; an unlayered `a {}` or `body {}` silently beats every utility.
2. Keep colors in HSL inside `@theme`. Convert any new Figma values before adding them.
3. Do not center icons with `text-align`.
4. Do not add `console.log`; use `lib/logging/logger.ts` on the server.
5. Do not add client-side manager filtering. Scope belongs in the query.
