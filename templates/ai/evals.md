# 🧪 AI evaluation plan

Build the golden set and the scoring rules before you tune anything.

**[▶ Open this template in your browser](https://tabtree.app/tabtree-demo.html?embed=1&tpl=evals&src=github)** — no signup, nothing to install.

| | |
|---|---|
| Template id | `evals` |
| Family | 🤖 AI & agents |
| Document type | Mind map |

## The outline

This is the exact outline TabTree builds. Indentation is the hierarchy, and
`[ ]` marks a checkbox. You can paste it straight into TabTree, or into any
outliner that understands indentation.

```text
Evaluation — what we are grading
  What "good" means here
    The output quality that matters most
    Second quality, if there is one
    The threshold we will tolerate
  Golden set
    [ ] 30 real cases, not invented ones
    [ ] Expected output written by a human
    [ ] Five hard cases held back, never used to tune
  How a case is scored
    Exact match, rules, or a judge model
    If a judge — its own instructions, and who audits it
    [ ] Two humans agreed on ten cases first
  What we report
    Pass rate on the golden set
    Cost per case, and latency
    Failure types, counted
  Regression
    [ ] Evals run before every prompt or model change
    [ ] A change that lowers the pass rate does not ship
  Live monitoring
    [ ] A sample of real runs reviewed weekly
    User signals — corrections, retries, escalations
    [ ] Real failures added to the golden set
  Owner and cadence
    Who runs it, and how often
```

---

Built with [TabTree](https://tabtree.app) — mind maps and whiteboards in one offline HTML file.
Bought once, no subscription, no account. [Try the live demo](https://tabtree.app/tabtree-demo.html?embed=1).
