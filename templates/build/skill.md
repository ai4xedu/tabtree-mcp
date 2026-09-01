# 🪄 Claude Skill spec

Specify a skill before writing it — trigger wording, procedure, and the prompts that must fire it.

**[▶ Open this template in your browser](https://tabtree.app/tabtree-demo.html?embed=1&tpl=skill&src=github)** — no signup, nothing to install.

| | |
|---|---|
| Template id | `skill` |
| Family | 🛠 Build with Claude |
| Document type | Mind map |

## The outline

This is the exact outline TabTree builds. Indentation is the hierarchy, and
`[ ]` marks a checkbox. You can paste it straight into TabTree, or into any
outliner that understands indentation.

```text
Claude Skill — skill name
  Trigger description — the line that decides
    What it does, in one sentence, starting with a verb
    The words a user would actually type
    File types or tasks that should pull it in
  When to use it
    Situation 1 — concrete enough to recognise
    Situation 2 — concrete enough to recognise
  When NOT to use it
    The neighbouring task it must not hijack
    The cheaper path that should win instead
  The procedure
    Step 1 — what to do, and what done looks like
    Step 2 — what to do, and what done looks like
    Step 3 — how to verify before reporting
  Bundled files
    Reference it reads — what is inside
    Script it runs — what it takes, what it returns
    Example of the output you expect
  Guardrails
    Never do this, even if asked in passing
    Stop and ask when this is unclear
  Trigger tests
    [ ] Prompt that MUST fire it
    [ ] Prompt that MUST fire it, worded differently
    [ ] Prompt in another language that must fire it
    [ ] Near-miss prompt that must NOT fire it
    [ ] Neighbouring task that must NOT fire it
```

---

Built with [TabTree](https://tabtree.app) — mind maps and whiteboards in one offline HTML file.
Bought once, no subscription, no account. [Try the live demo](https://tabtree.app/tabtree-demo.html?embed=1).
