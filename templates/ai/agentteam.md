# 🤝 AI agent team design

Design a multi-agent team: orchestration pattern, roles, handoff contracts, guardrails.

**[▶ Open this template in your browser](https://tabtree.app/tabtree-demo.html?embed=1&tpl=agentteam&src=github)** — no signup, nothing to install.

| | |
|---|---|
| Template id | `agentteam` |
| Family | 🤖 AI & agents |
| Document type | Mind map |

## The outline

This is the exact outline TabTree builds. Indentation is the hierarchy, and
`[ ]` marks a checkbox. You can paste it straight into TabTree, or into any
outliner that understands indentation.

```text
Agent team — what the team delivers
  The mission
    One sentence — what the team produces, end to end
    What a human still does by hand, on purpose
  Orchestration pattern
    Chosen — supervisor: one lead delegates and reviews
    Considered — sequential pipeline, hierarchical, peer-to-peer
    Why this one fits the mission
  The roster
    Lead — orchestrator
      Decides what runs, in which order
      Never writes the final answer alone
    Researcher
      Job — find the facts and cite them
      Tools it may use
      Done when — observable
    Maker
      Job — produce the draft
      Tools it may use
    Critic
      Job — try to break the draft before a human sees it
      Returns a verdict, not an essay
  Handoffs — the contract between agents
    What each agent receives, exactly
    What it must return — shape and length
    [ ] Every handoff is structured data, not a chat message
  Shared memory
    What every agent may read
    What only the lead may write
    What is deliberately forgotten between runs
  Guardrails
    [ ] Actions that need human approval
    [ ] Data no agent may send outside
    [ ] Ceiling — max steps and max spend per run
  Evaluation
    [ ] Five test cases per role
    [ ] The team scored end to end, not role by role
    [ ] One adversarial run before each release
  When it fails
    Which agent's failure stops everything
    Fallback — degrade to one agent, or hand back to a human
```

---

Built with [TabTree](https://tabtree.app) — mind maps and whiteboards in one offline HTML file.
Bought once, no subscription, no account. [Try the live demo](https://tabtree.app/tabtree-demo.html?embed=1).
