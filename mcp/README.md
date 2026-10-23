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
| `create_mindmap` | Creates a mind map from a markdown outline — or a **note** (a page of text) or a **Gantt** (give it dates). |
| `create_kanban` | Creates a kanban board in one go: columns, and cards with owners, start and due days, priority, colour labels, time estimates, an Ai4X lever, a note (a Google Meet link in it becomes clickable), a link and sub-tasks. |
| `create_board` | Creates a whiteboard — shapes, **images** (`kind: "image"` + a PNG/JPEG/WebP/GIF/SVG `file`: logos, photos, posters) and arrows that stay anchored in the app. |
| `propose_changes` | Changes a map or kanban you already have — see below. |
| `harvest` | Keeps what matters from the conversation — facts, decisions, lessons — in your Company knowledge and 🌱 Lessons maps. Nothing is filed until you accept it in TabTree. |

Every creation tool takes an optional `folder` and an optional `space`. Name a
**team space** you are an editor of and the new map lives there: every member
sees it.

### Changing a map you already have — hybrid, on purpose

**Safe changes apply by themselves.** Adding cards or branches, moving a card to
a column, ticking it, setting its owner, dates, priority, labels, estimate, Ai4X
lever, an attribute, a link, a comment, a picture — and setting up the columns
of a map that has no kanban yet. TabTree applies them within seconds while it is
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
