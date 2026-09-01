# 🔍 RAG knowledge base plan

Plan a retrieval setup: sources, chunking, permissions, citations, freshness.

**[▶ Open this template in your browser](https://tabtree.app/tabtree-demo.html?embed=1&tpl=rag&src=github)** — no signup, nothing to install.

| | |
|---|---|
| Template id | `rag` |
| Family | 🤖 AI & agents |
| Document type | Mind map |

## The outline

This is the exact outline TabTree builds. Indentation is the hierarchy, and
`[ ]` marks a checkbox. You can paste it straight into TabTree, or into any
outliner that understands indentation.

```text
Knowledge base — subject
  Questions it must answer
    A question a user will really ask
    A second one
    Questions it is NOT meant to answer
  Sources
    Source 1 — owner, format, how often it changes
    Source 2 — owner, format, how often it changes
    [ ] Permission to index each source
    What we deliberately leave out
  Preparation
    How documents are split — and where a split would break meaning
    Metadata kept — date, author, source, access level
    [ ] Tables and images handled, or excluded on purpose
  Retrieval
    How many passages the model receives
    Keywords and semantic search, or semantic only
    [ ] Answers must cite the passage they used
    [ ] "I don't know" is an allowed answer
  Permissions
    Who may see what — enforced at retrieval, not in the prompt
    [ ] Tested with a low-privilege account
  Evaluation
    [ ] 30 real questions with the source expected for each
    Retrieval hit rate — the number
    [ ] Confident-but-wrong answers counted separately
  Freshness
    [ ] Re-indexing schedule
    [ ] A deleted document disappears from answers
  Run
    Owner of the knowledge base
    Where a user reports a bad answer
```

---

Built with [TabTree](https://tabtree.app) — mind maps and whiteboards in one offline HTML file.
Bought once, no subscription, no account. [Try the live demo](https://tabtree.app/tabtree-demo.html?embed=1).
