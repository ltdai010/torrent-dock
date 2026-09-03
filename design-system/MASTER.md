# TorrentDock Design System

TorrentDock is a desktop video-learning app. The interface should be video-first, content-dense, and predictable, closer to YouTube Studio or YouTube watch pages than a marketing site.

## Component Rule

- Use Radix-backed app wrappers for visible controls and visual primitives.
- Use semantic HTML for document structure: `main`, `header`, `section`, `aside`, `form`, `ul`, `li`.
- Use CSS for layout, scroll regions, responsive grids, video overlays, fullscreen behavior, and dynamic media state.
- Avoid raw visual styling inside feature components. Prefer component props such as `variant`, `color`, `size`, and shared app wrapper classes.

## App Layout

- Global top bar stays stable across pages.
- Search is the primary action and should stay visually prominent.
- Page headers use the same structure everywhere:
  - left side: back/navigation when needed
  - title and short description
  - right side: page actions
- Player page uses a YouTube-like split:
  - main column: video, metadata, progress
  - right rail: subtitles, files, details
- Settings should be a dialog/sheet, not a primary page.

## Visual System

- Theme: Radix Themes, red accent, neutral gray, medium radius.
- Cards/panels: Radix `Card` through `AppPanel` when the region is a framed surface.
- Buttons: Radix `Button`.
- Status chips: Radix `Badge`.
- Text fields/selects/sliders: app wrappers around Radix form primitives.
- Icons: lucide-react only.

## Spacing And Size Tokens

- Do not introduce raw spacing in feature CSS. Use `--space-*` tokens for `gap`, `padding`, and repeated margins.
- Do not introduce raw repeated radii. Use `--radius-control`, `--radius-panel`, or `--radius-pill`.
- Do not hard-code repeated control, thumbnail, row, page, or dialog sizes. Use semantic tokens such as `--control-height-md`, `--thumb-catalog-width`, `--title-row-min-height`, `--page-max-width`, and `--dialog-max-width`.
- Raw CSS values are allowed only for browser mechanics, one-off geometry, media query declarations, and dynamic calculations that cannot use CSS variables reliably.
- If a value appears in more than one component or encodes a product decision, add a token first.

## CSS Architecture

- `src/styles.css` is an import-only entrypoint.
- `src/styles/tokens.css` owns theme aliases, spacing, sizing, semantic layout tokens, and the tiny global reset/helper layer.
- `src/styles.css` imports only global tokens.
- Custom CSS that remains must be colocated with its owning page or component, for example `src/pages/PlayerPage.css`, `src/pages/SearchPage.css`, or `src/components/AppControls.css`.
- Prefer Radix props and primitives before adding CSS. New CSS is only for layout constraints, media behavior, overflow, browser mechanics, or dynamic values Radix does not own.

## Interaction Rules

- Search results must expose local state when known: downloaded, now playing, or partial progress.
- Subtitle search uses all configured providers, not a single default provider mode.
- In-player subtitle display controls must be available without leaving the video.
- Destructive actions use red and stay separate from primary actions.
- All touch/click targets should remain at least 44px high unless the control is inside a dense media overlay.
