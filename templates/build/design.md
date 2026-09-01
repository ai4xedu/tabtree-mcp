# 🖌 Design system brief for AI

Tokens, components and rules — so generated screens look like one product.

**[▶ Open this template in your browser](https://tabtree.app/tabtree-demo.html?embed=1&tpl=design&src=github)** — no signup, nothing to install.

| | |
|---|---|
| Template id | `design` |
| Family | 🛠 Build with Claude |
| Document type | Mind map |

## The outline

This is the exact outline TabTree builds. Indentation is the hierarchy, and
`[ ]` marks a checkbox. You can paste it straight into TabTree, or into any
outliner that understands indentation.

```text
Design system — product name
  Principles
    The one thing every screen must get right
    What we deliberately do not do
  Colour tokens
    Ink — main text
    Muted — secondary text
    Surface — page and card backgrounds
    Line — borders and dividers
    Accent — the single action colour
    Danger — destructive only, never decorative
  Type scale
    Display — size, weight, where
    Heading — size, weight, where
    Body — size, weight, line height
    Small — size, and the one place it is allowed
  Spacing and radius
    The scale — 4, 8, 12, 16, 24, 32
    Radius — one value for cards, one for controls
    Nothing outside the scale, ever
  Components
    Button — variants, sizes, hover, focus, disabled, loading
    Input — label, help text, error state
    Card — padding, and when it gets a border
    Modal — width, and how it is dismissed
  States, for every component
    Focus stays visible — never removed
    Disabled says why, not only that
    Loading must not make the layout jump
  Accessibility
    Contrast — the minimum ratio, no exception
    Every control reachable by keyboard
    Motion respects reduced-motion
  Rules for whoever generates the UI
    Use the tokens above — no raw hex, no one-off spacing
    Reuse a component before inventing one
    Ask before adding a token
```

---

Built with [TabTree](https://tabtree.app) — mind maps and whiteboards in one offline HTML file.
Bought once, no subscription, no account. [Try the live demo](https://tabtree.app/tabtree-demo.html?embed=1).
