# Product

## Register

product

## Users

Developers who run multiple coding agents (Claude Code, Codex, OpenCode) in
parallel across several repositories. They organize work as
`workspace → thread → direction → session`, and at any moment they are
watching — and occasionally steering — several live agent runs at once. Their
context: a focused, often long desktop session, frequently in a dark room or
beside an IDE, switching attention between runs and wanting to know "what is
each agent doing right now" at a glance.

## Product Purpose

weft is a local-first cockpit for **watching and steering native agent runs**
across logical multi-repo workspaces. It organizes repos into workspaces,
materializes isolated git worktrees per thread/direction, and embeds each
tool's own native TUI as a live viewport — without ever re-drawing the agent's
output. The product is the *shell* around the runs: the workspace structure,
the cross-cutting visibility (status, diffs, session registry), and the light
coordination layer. Success looks like: a developer holds five parallel agent
runs in their head effortlessly, because weft makes each run's state legible
and switching between them instant.

It is explicitly **not** a terminal emulator. The embedded TUI is one viewport
into "how is this run going"; the felt product is calm observability and
orchestration over many runs, not a shell you type into.

## Brand Personality

Composed, exact, quietly alive. Three words: **calm, precise, native-fast.**
The voice is an expert peer's, not a vendor's: it states what is happening and
gets out of the way. No hype, no hand-holding, no decoration for its own sake.
When something is running, the interface should feel like a well-instrumented
control room at night — dark, legible, everything in its place, motion only
when something actually changed.

## Anti-references

- **Generic SaaS pastel gradients** — purple-blue gradient heroes, rounded
  card seas, emoji decoration. The template-site sweetness.
- **Heavy decoration / glassmorphism** — blur stacks, glow, big drop shadows,
  flourish animations. Showy, attention-scattering, slow.
- **Dry enterprise back-office** — gray-on-gray, dense tables with zero
  rhythm, zero craft. Usable but joyless.
- **Terminal/"matrix" aesthetic** — weft frames terminals; it is not one.
  Avoid neon-green-on-black, scanlines, faux-CRT, monospace-everything.

## Design Principles

1. **Observability before ornament.** The run is the content. Chrome stays
   quiet and recedes; nothing decorative competes with what the agent is doing.
2. **Frame, don't redraw.** We host native TUIs verbatim. weft's craft is the
   shell around them — never reskinning or reinterpreting agent output.
3. **Calm under parallelism.** Many threads and sessions at once must read as
   composed, not busy. Density without noise; the eye always finds the one
   thing that changed.
4. **Glanceable state, keyboard-first control.** Every run's status is legible
   in a glance; switching, approving, and navigating are fast keyboard moves.
   Motion exists to explain a change of state, never to perform.
5. **Mirror the user's tools, never override them.** The UI reflects native
   agent state (permissions, sessions, config) and never invents or overrides
   it. What weft shows is true to what the CLI is actually doing.

## Accessibility & Inclusion

- WCAG AA contrast on the dark surface: body text ≥ 4.5:1, large/secondary
  ≥ 3:1. No light-gray "elegance" text that fails to read.
- **Status is never color-only.** Every run state pairs color with a shape,
  icon, and/or label (running / waiting / approval / error / paused), so it
  survives color-blindness and grayscale.
- Full keyboard navigation; visible focus rings on every interactive element.
- `prefers-reduced-motion` honored everywhere — reveals and transitions degrade
  to instant or a simple crossfade.
