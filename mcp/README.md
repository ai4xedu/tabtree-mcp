# TabTree Connector for Claude

Let Claude read your TabTree library and build mind maps, kanban boards and
whiteboards for you — in your account, on every device, and in your team spaces.

> "Turn these meeting notes into a mind map."
> "Make a kanban for the launch: these eight tasks, Sara owns the design ones, due Friday."
> "Add the three follow-ups from this call to the sprint board, in Doing."
> "Draw our database schema as a board."

**You need a TabTree account.** This package is the bridge, not the app.

---

## Before you start

**1. Get your connector key.** Open TabTree → ⚙️ Settings → Account →
**Claude connector** → *Create a connector key*. It is shown once — copy it. It
starts with `tt_live_`.

**2. Node.js 18+ — for the npm and Claude Code routes.** Claude Desktop ships its
own Node, so the `.mcpb` install below needs nothing.

Quickest test:

```bash
TABTREE_API_KEY=tt_live_… npx tabtree-mcp
```

---

## Install — Claude Desktop (double-click)

**Double-click `TabTree-Connector.mcpb`.** Claude Desktop opens its install
screen and asks for your connector key — paste it, and that is the whole
procedure. To change the key later, or to remove the connector, use Claude
Desktop's own extension settings.

## Install — Claude Code, Cursor, any MCP client (npm)

```bash
claude mcp add tabtree --scope user -e TABTREE_API_KEY="tt_live_…" -- npx -y tabtree-mcp
```

`--scope user` makes the connector available in every project. For any client
that reads a JSON config:

```json
{
  "mcpServers": {
    "tabtree": {
      "command": "npx",
      "args": ["-y", "tabtree-mcp"],
      "env": { "TABTREE_API_KEY": "tt_live_…" }
    }
  }
}
```

---

## What Claude can do

| Tool | What it does |
| --- | --- |
| `list_maps` | Lists every map, kanban, note and board — yours and those of the team spaces you belong to. |
| `read_map` | Reads one map. A mind map or kanban comes back as an outline with each card's column, owner, dates, priority and labels; a board as elements and connections. |
| `search_maps` | Searches the whole library — map names, nodes, notes, shapes, stickies. |
| `create_mindmap` | Creates a mind map from a markdown outline — or a **note** (a page of text), a **Gantt** (give it dates), or a 🗂 **project** (`format: "projet"`: vision, objectives, epics as bets, cards on a kanban with `columns`). |
| `plant_project` | **“Plant me the project.”** Turns a project brief into a TabTree **tree** in one call: the why and the risks grow as roots under the ground (a priority-1 risk is the thickest root), the work streams as branches, the tasks as twigs — an owner is a bird, a due date within 3 days makes the branch sway, a done task is a ripe fruit. TabTree then diagnoses the shape and picks the species (a baobab when three branches carry the work, a fir for a long backlog, a cedar for a deep strategy…), and Claude tells you which tree your project is, and why. |
| `create_kanban` | Creates a kanban board in one go: columns, and cards with owners, start and due days, priority, colour labels, time estimates, an Ai4X lever, a note (a Google Meet link in it becomes clickable), a link and sub-tasks. |
| `create_board` | Creates a whiteboard — shapes, **tables** (`kind: "table"` + `cells`: a comparison, a pricing grid, a RACI — with logos or big titles **inside** cells via `cell: { table, row, col }`, taller rows via `rowHeights`, `valign: "middle"`), **images** (`kind: "image"` + a PNG/JPEG/WebP/GIF/SVG `file`: logos, photos, posters) and arrows that stay anchored in the app. |
| `propose_changes` | Changes a map, kanban or board you already have — see below. On a board: `add_image` (from a file, or an https `url` on a public website; also `inside` a shape, laid out with no overlap), `add_shape`, `add_text`, `move`, `resize`, `label`, `arrange`, `delete`, by the ids `read_map` shows. Sending the same image name twice never makes a duplicate. On a kanban or map, `star` puts a ⭐ on a card for you (it shows in ✅ My work; `value: false` removes it), applied by TabTree itself. On a kanban, `place` puts a card where the 🎨 Board view draws it (`x`, `y` = its top-left corner); a shape there named after a column, a day or a person is a zone, and the move, due date or owner it implies is added for you. |
| `harvest` | Keeps what matters from the conversation — facts, decisions, lessons — in your Company knowledge and 🌱 Lessons maps. Nothing is filed until you accept it in TabTree. |
| `fill_knowledge` | Fills your **knowledge base** — projects, products, topics, clients, people, your company and brands, partners — up to 30 objects per call, each with a short definition, its other names and a few facts. An object already there (same name or alias) is updated, never duplicated. It all waits in TabTree as one proposal: one click applies it. TabTree's 🪄 card prompts then carry these definitions as context. |
| `card_prompt` | Reads **one card** of a kanban and returns the prompt TabTree's 🪄 builds for it: a role and a format picked from the deliverable (spreadsheet, slides, email, code, research, document, plan), the card's context — board, column, owner, dates, labels, the knowledge-base entries it is about, passages from your other maps in the same space — its task and acceptance criteria, and guardrails. Say “work on the card X” and Claude reads it, then does the work. Read-only. |
| `deliver_card` | Sends Claude's finished work **back onto that card**: a 📄 entry holding the deliverable (Markdown), optional next-step sub-tasks, and optionally a move to another column. It waits in TabTree as one proposal: one click applies it, Cmd+Z undoes it. Lines that look like a password, key or token never leave. |

Every creation tool takes an optional `folder` and an optional `space`. Name a
**team space** you are an editor of and the new map lives there: every member
sees it.

### Changing a map you already have — hybrid, on purpose

**Safe changes apply by themselves.** Adding cards or branches, moving a card to
a column, ticking it, setting its owner, dates, priority, labels, estimate, Ai4X
lever, an attribute, a link, a comment, a picture, the map's format — and setting
up the columns of a map that has no kanban yet. TabTree applies them within seconds while it is
open on one of your devices (or the next time you open it). **⌘Z undoes them**
like anything else you do.

**Changes that rewrite or remove what someone wrote wait for you** — renaming,
rewriting a note, deleting, replacing the columns of an existing board. TabTree
shows them as a banner on the map; you tick the ones you want and press Apply.

In one request, the safe changes that come *before* the first review-only change
apply by themselves, and everything from there on waits for you — in order, so
nothing is applied to text that is about to be renamed.

Claude names each card or node by its exact text, so ask it to read the map
first. When the same wording appears twice it writes a path — `"Q4 > Hire"` — and
if it still cannot tell them apart, the change is refused rather than applied to
the wrong one. A column is named by its name: `"Doing"`.

On a team space where your role is **viewer**, Claude can read the maps but not
change them.

### 🗂 Projects — Claude creates one, reads it, and plans the next sprint

A **project** is one TabTree map in the `projet` format: the vision and mission on
the root, the objectives with their key results, the epics as *bets* you settle
(each with a Hypothesis, a Goal, a Signal and a Verdict), their cards on a
kanban, and the sprints TabTree already keeps. No `create_project` tool: Claude
builds it with `create_mindmap` and `format: "projet"`, and steers it with
`read_map` and `propose_changes` — the same four verbs as any map.

**Create one in a call.** The tool's description carries the shape, so a prompt
is enough:

> "Make a TabTree project for the Orchard Café: vision, three objectives with
> measurable KRs, three epics as bets with their cards, two-week sprints from
> 2 November. Put the cards on a Backlog / To do / Doing / Done board."

Claude calls `create_mindmap` with `format: "projet"`, `columns`, and an outline
like this (the `@todo` at the end of a line places the card):

```markdown
# 🗂 Orchard Café
- Description: A neighbourhood café that roasts its own beans.
- Vision: Every street has a place that knows your order.
- Mission: Open the second shop by June with 300 regulars.
- Sprint length: 2 weeks
- Sprints start: 2026-11-02
- 🎯 Objectives
  - O1 — 300 regulars by June
    - [ ] KR1 — 300 loyalty cards
    - [ ] KR2 — 4.6 average rating
- 🧱 Epics
  - R · Roastery
    - Hypothesis: people return for beans they cannot buy elsewhere
    - Goal: 40 % of sales are beans
    - Signal: till report, every Friday
    - Verdict: testing
    - Impact: 4
    - Confidence: 3
    - Effort: 2
    - [ ] R01 · Pick the first two origins @todo
    - [ ] R02 · Print the bean cards @doing
    - [ ] R04 · A tasting flight on the menu
  - S · Second shop
    - Hypothesis: the north side lacks a morning café
    - Verdict: untested
    - [ ] S01 · Count footfall at three corners
      - Impact: 5
      - Confidence: 4
      - Effort: 1
- 📚 Knowledge
  - [Company knowledge](map:map_k1)
- 📝 Decisions
  - 2026-10-01 — No delivery apps this year
```

TabTree recognises the first-level branches by their leading emoji, draws the
vision and mission under the title, a gauge on every objective and epic, and a
coloured dot for each verdict. A project card without an `@` marker goes to the
first column (Backlog): it is not committed yet.

**Read it.** `read_map` opens a project with a `🗂 Project` block before the
outline — what it promises and where it stands:

```
🗂 Project — “🗂 Orchard Café”
  Description: A neighbourhood café that roasts its own beans.
  Vision: Every street has a place that knows your order.
  Mission: Open the second shop by June with 300 regulars.
  🎯 Objectives — 1/3 key results done
    • O1 — 300 regulars by June — 1/2
    • O2 — A second shop — 0/1
  🧱 Epics — 2 epic(s), 1/5 cards done
    • R · Roastery — verdict: testing — 1/4 done — ICE 48
    • S · Second shop — verdict: untested — 0/1 done
  🏁 Sprint 2 — live since 2026-11-16 · planned 14 days, ends 2026-11-30 (since the last close)
    Goal: “Beans on every table”
    2 committed (0 done) · 2 in backlog · 1 archived by a close
    Last closed: “Sprint 1” 2026-11-01 → 2026-11-16 — goal “Open the roastery” — 1 done, 1 carried over
  📋 Backlog by ICE (Impact × Confidence × (6 − Effort); a card without its own scores takes its epic's):
    • S01 · Count footfall at three corners — ICE 100 — S · Second shop
    • R04 · A tasting flight on the menu — ICE 48 (epic) — R · Roastery
```

The sprint is the one TabTree keeps: *committed* is every card off Backlog,
numbered after the last close in the 🏁 panel, started at that close (or at
`Sprints start:` for the first one), with the planned length from
`Sprint length:` on the root, and the name and goal of the running sprint
from its Season — the 🎯 chip and the 🏁 panel (`kanban.season`), never an
attribute.

**Plan the next sprint — the recipe.** No tool for it either: four safe changes,
applied by TabTree itself and undone by ⌘Z.

1. Read the project. The `📋 Backlog by ICE` list is the ranking:
   `ICE = Impact × Confidence × (6 − Effort)`, from the `Impact:` /
   `Confidence:` / `Effort:` attributes (1–5) of the card, or of its epic when
   the card has none.
2. Pull the top of the ranking from Backlog into **To do** with `move`, until
   about **6 cards are committed** in total — fewer when some are still Doing.
3. Set the running sprint's goal with `season` — `goal`, and optionally its
   `name`. It applies by itself when nobody typed a goal yet, and goes to
   review when it would replace one.
4. Settle a bet whose signal has spoken with `attr` on the epic — `Verdict`.

> "Plan the next sprint of the Orchard Café: pull the best backlog cards by ICE
> into To do, keep six in flight, and set the goal 'Prove the second shop'."

```json
{ "file": "Orchard Café", "note": "Sprint 3 — plan by ICE, six in flight", "changes": [
  { "op": "move", "target": "S01 · Count footfall at three corners", "col": "To do", "why": "ICE 100 — the highest in the backlog" },
  { "op": "move", "target": "R04 · A tasting flight on the menu", "col": "To do", "why": "ICE 48; two cards were already committed, this makes four" },
  { "op": "season", "goal": "Prove the second shop", "name": "Sprint 3" },
  { "op": "attr", "target": "R · Roastery", "name": "Verdict", "value": "validated", "why": "Beans are 43 % of sales on the last four Friday reports" }
] }
```

When no goal was typed yet, everything in that call is safe, so TabTree applies it within seconds and the
🏁 panel shows "4 committed · goal: Prove the second shop". The user closes the
sprint in TabTree when it ends; the connector never closes one. To add an epic,
`add` it under `🧱 Epics` with its four attribute lines; to record a decision,
`add` it under `📝 Decisions`; to turn a map you already have into a project,
`{ "op": "format", "format": "projet" }`.

### Screenshots on nodes

Ask Claude to build a map *with screenshots* — of an app, a website, a slide
deck. Claude saves the screenshot and passes its path in `images`:
`{ target: "Login page", file: "/path/to/shot.png" }`. The picture becomes the
node's cover, on the map, in the kanban and in every exported image. It is
re-encoded on your machine first (about 840 px, a few dozen KB). The same works
on a map you already have: `propose_changes` with `op: "img"`.

---

## What the connector will never do

It never overwrites or deletes a map, and never touches your browser storage. It
talks only to TabTree's own API, for your account and the team spaces you are a
member of. Your key is stored by your client, never in a map.

---

## When it does not work

**Claude does not offer the tools.** Restart the client — Claude Desktop needs a
full quit, not a window reload. Then check the config file is valid JSON; a
trailing comma is enough to make the whole file be ignored silently.

**"Unknown or revoked connector key."** Create a new key in TabTree → Settings →
Account → Claude connector, and paste it into the connector's settings.

**"Claude Desktop did not pass your TabTree connector key."** Claude Desktop could
not read the encrypted copy of your key, or the extension was just updated. In its
extension settings, paste the key into **Connector key, not encrypted**, then quit
Claude Desktop completely and reopen it. That field is saved in clear text on this
computer, so leave it empty unless you see this message.

**"TABTREE_API_KEY does not look like a connector key."** The field is empty or
was reset — reinstalling the `.mcpb` clears it. Paste the key again.

**Claude's changes did not appear.** Safe changes are applied by TabTree itself,
so it must be open and signed in on one of your devices; they land within
seconds, or the next time it opens. Changes that need your approval appear as a
banner on that map.

**"The connector can read, not write."** Your trial or subscription has ended —
or, on a team space, the space owner's plan has.

---

### TabTree Classic (the discontinued local file)

The connector still reads a TabTree Classic backup folder when it is given
`TABTREE_DIR` instead of a key — maps are written there as files, and changes are
always filed for review. This mode receives no new features.

---

## 🇫🇷 En français

Le connecteur permet à Claude de lire votre bibliothèque TabTree et d'y créer des
cartes mentales, des **kanbans**, des notes, des Gantt et des boards — dans votre
compte, sur tous vos appareils, et dans les **espaces d'équipe** dont vous êtes
membre.

Créez votre clé dans TabTree → ⚙️ Réglages → Compte → **Claude connector**, puis :

- **Claude Desktop** — double-cliquez `TabTree-Connector.mcpb` et collez la clé.
- **Claude Code** — `claude mcp add tabtree --scope user -e TABTREE_API_KEY="tt_live_…" -- npx -y tabtree-mcp`

Pour une carte existante, le connecteur est **hybride** : ajouter ou déplacer des
cartes, cocher, poser un responsable, des dates, des étiquettes, une estimation,
un levier Ai4X s'applique tout seul en quelques secondes (⌘Z l'annule) ; renommer,
réécrire une note ou supprimer vous est d'abord présenté, et rien n'est appliqué
sans votre clic. Il n'écrase ni ne supprime jamais une carte.

Support : info@ai4x.academy
