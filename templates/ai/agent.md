# 🦾 AI agent spec

Specify an AI agent before building it: job, tools, guardrails, evals.

**[▶ Open this template in your browser](https://tabtree.app/tabtree-demo.html?embed=1&tpl=agent&src=github)** — no signup, nothing to install.

| | |
|---|---|
| Template id | `agent` |
| Family | 🤖 AI & agents |
| Document type | Mind map |

## The outline

This is the exact outline TabTree builds. Indentation is the hierarchy, and
`[ ]` marks a checkbox. You can paste it straight into TabTree, or into any
outliner that understands indentation.

```text
AI agent — name
  Job to be done
    The task, in one sentence a human could execute
    What done looks like — observable
    Out of scope — what the agent must NOT do
  Inputs and context
    What it knows at start
    What it must fetch, and from where
  Tools
    Tool 1 — what it does, when to use it
    Tool 2 — what it does, when to use it
  Guardrails
    [ ] Actions that require human confirmation
    [ ] Data it must never touch or send
    [ ] Cost and iteration ceiling
  Evaluation
    [ ] 5 test cases with expected output
    [ ] One adversarial case — try to break it
    [ ] Human review of the first 20 runs
  Failure modes
    What happens when a tool fails
    When it must hand back to a human
```

---

Built with [TabTree](https://tabtree.app) — mind maps and whiteboards in one offline HTML file.
Bought once, no subscription, no account. [Try the live demo](https://tabtree.app/tabtree-demo.html?embed=1).
