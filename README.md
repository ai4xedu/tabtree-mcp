# TabTree

**Mind maps and whiteboards in one offline HTML file.**

[Live demo — no signup](https://tabtree.app/tabtree-demo.html?embed=1) · [tabtree.app](https://tabtree.app) · [Templates](templates/) · [Claude connector](#claude-connector)

![TabTree](screenshots/00-hero.png)

---

## What it is

TabTree is a mind-mapping and whiteboard app that fits in **a single HTML file**.
You double-click it and it runs — offline, with no account, no server and no
subscription. One document reads six ways: mind map, kanban board, Gantt chart,
page of notes, spreadsheet or full-screen presentation. Switch views; nothing is
converted and nothing is lost.

| | |
|---|---|
| **One file** | The entire app is one HTML file — no install, no build, no dependencies. |
| **Offline, always** | It runs from `file://`. Nothing leaves your machine. |
| **Bought once** | No subscription, no account, no telemetry, no expiry. |
| **83 templates** | Business Model Canvas, Lean Canvas, OKRs, roadmaps, agent specs… [all of them](templates/) |
| **It leaves the building** | PNG posts, carousel PDFs, MP4 flythroughs, or one `.html` file that carries the app and the map together. |
| **Claude writes into it** | The connector below is free with every licence. |

## This repository

TabTree itself is a commercial product and its source is not published here.
**This repository is the public face of it**, and it holds four things that are
genuinely useful on their own:

- **[`mcp/`](mcp/)** — the full source of the Claude connector, free to use, copy,
  redistribute and modify ([its own licence](mcp/LICENSE.md), no attribution required),
  and the same code published to npm as [`tabtree-mcp`](https://www.npmjs.com/package/tabtree-mcp).
- **[`plugins/tabtree/`](plugins/tabtree/)** — a Claude Code plugin: two facilitation
  skills that end in a real document, plus the connector. See
  [Claude Code plugin](#claude-code-plugin) below.
- **[`templates/`](templates/)** — the 83 template outlines in plain Markdown, each with a
  link that opens it live. Paste them into TabTree, or into any outliner.
- **[`screenshots/`](screenshots/)** — rendered by the real engine, not mocked up.

To use the app itself, [try the demo](https://tabtree.app/tabtree-demo.html?embed=1) — it is the whole application, running
in your browser, with nothing to install.

<a name="claude-connector"></a>

## Claude connector

Let Claude read your TabTree library and turn a conversation, a transcript or a
spec into a real map on your disk. **Local files, no account, nothing uploaded** —
the connector only ever sees the backup folder you point it at.

**Claude Desktop — double-click, nothing to install.** Download
[`TabTree-Connector.mcpb`](https://github.com/ai4xedu/tabtree-mcp/releases/latest) and double-click it. Claude
Desktop ships its own Node, so there is nothing else to install, and it asks you for
your backup folder in a normal folder picker.

**Claude Code, or any MCP client — one line:**

```bash
npx -y tabtree-mcp
```

Or in your client's config:

```json
{
  "mcpServers": {
    "tabtree": {
      "command": "npx",
      "args": [
        "-y",
        "tabtree-mcp"
      ],
      "env": {
        "TABTREE_DIR": "/path/to/your/TabTree/backup/folder"
      }
    }
  }
}
```

Six tools: `list_maps`, `read_map`, `search_maps`, `create_mindmap`,
`create_board`, `propose_changes`. It **only ever writes new files** — it never
modifies or deletes one of your maps, and `propose_changes` drops a proposal the
app applies only when you click. Full detail in [`mcp/README.md`](mcp/README.md).

<a name="claude-code-plugin"></a>

## Claude Code plugin

Two skills that do not end in advice — they end in a **document on your disk**.

```bash
/plugin marketplace add ai4xedu/tabtree-mcp
/plugin install tabtree@tabtree
```

| Skill | What it does |
|---|---|
| `ma-cartographie-du-travail` | A 15-minute interview that maps how you actually work — your processes, their hours, and where AI gives time back. Ends with the number: hours per week you get back. |
| `atelier-vision-okr` | Facilitates a team session — vision, mission, pillars, OKRs per department, plan for the year — then writes it as a canvas you can present. |

Both are written in **French**: they were built to run real workshops, and that is the
language they run in. They read and reply in French; the documents they produce follow
the map's own language.

**One of them needs a folder, the other does not.** `ma-cartographie-du-travail` writes
nothing — it hands you a readable brief and a JSON block — so it works the moment you
install it. `atelier-vision-okr` calls the connector to write the canvas, so it needs
`TABTREE_DIR` pointing at your TabTree backup folder — the one you picked with 🛟 on the
**My maps** screen:

```bash
export TABTREE_DIR="/path/to/your/TabTree/backup/folder"
```

There is no auto-discovery: without that variable the connector says so plainly rather
than guessing a folder. If you only want the connector and not the skills, the
double-click [`.mcpb` bundle](#claude-connector) is the better route — it asks for the
folder in a normal picker.

## Screenshots

**The same document as status columns — every card is still a node of the map.**

![03-kanban.png](screenshots/03-kanban.png)

**Arrows stay attached to the boxes when you move them.**

![06-flowchart.png](screenshots/06-flowchart.png)

**A map sent as one `.html` file: your reader double-clicks it, offline, no install.**

![04-reader.png](screenshots/04-reader.png)

**Images and reasoning on one canvas.**

![05-moodboard.png](screenshots/05-moodboard.png)

**Radial layout, dark theme.**

![90-radial-dark.png](screenshots/90-radial-dark.png)

## Licence

Three different licences, and the distinction matters:

- The **connector** in [`mcp/`](mcp/) is free to use, copy, redistribute and modify,
  for any purpose, with or without a TabTree licence — see [`mcp/LICENSE.md`](mcp/LICENSE.md).
  It is given away on purpose.
- The **skills** in [`plugins/tabtree/`](plugins/tabtree/) are free on the same terms,
  commercial workshops included — see
  [`plugins/tabtree/LICENSE.md`](plugins/tabtree/LICENSE.md). They are a separate
  licence because the connector's own text says it covers the connector only.
- The **app** is a commercial product sold at
  [tabtree.app](https://tabtree.app); its source is **not** in this repository, and its licence
  does not allow redistribution.
- The **template outlines** are yours to copy and adapt freely.

---

Made in Casablanca. [tabtree.app](https://tabtree.app)
