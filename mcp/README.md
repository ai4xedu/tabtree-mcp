# TabTree Connector for Claude

Let Claude read your TabTree library and build new maps for you.

> "Turn these meeting notes into a mind map."
> "Map the structure of this codebase."
> "Draw our database schema as a board."
> "Add the risks we just discussed to my Q3 plan."

The map appears as a file in your backup folder. You pull it into TabTree from
*My maps* → **🛟** → **"Bring maps back from this folder…"**.

The connector **only ever creates new files.** It cannot overwrite a map, cannot
delete one, and never touches your browser storage. There is no account, no
server, no upload: it runs on your machine and reads one folder you choose.

**You need TabTree itself.** This package is the bridge, not the app: it reads
and writes map files in one folder, and TabTree is what opens them. TabTree is a
single local HTML file you buy once and keep for life — no subscription, no
account, works offline. See [tabtree.app](https://tabtree.app/).

Changes to a map you already have are no exception. Claude never writes to it:
it files a **proposal**, TabTree shows it as a banner on that map, and you tick
the changes you want. ⌘Z undoes them afterwards, like anything else you do.

---

## Before you start

**1. TabTree needs a backup folder.** Open TabTree → *My maps* → 🛟 and pick a
folder. That folder is what the connector reads and writes. If you have never
set one up, do that first — the connector has nothing to talk to otherwise.

**2. Node.js 18+ — for the npm and Claude Code routes.** Claude Desktop ships
its own Node, so the `.mcpb` install below needs nothing. For the other routes,
check with `node --version` and install the LTS build from
[nodejs.org](https://nodejs.org) if it errors. The app itself never needs Node.

---

## Install — npm (Claude Code, Cursor, any MCP client)

Nothing to clone, nothing to build. Point `TABTREE_DIR` at your backup folder:

```bash
claude mcp add tabtree --scope user -e TABTREE_DIR="/path/to/your/backup/folder" -- npx -y tabtree-mcp
```

For any client that reads a JSON config, the same thing:

```json
{
  "mcpServers": {
    "tabtree": {
      "command": "npx",
      "args": ["-y", "tabtree-mcp"],
      "env": { "TABTREE_DIR": "/path/to/your/backup/folder" }
    }
  }
}
```

The path must be absolute — `~` and relative paths will not resolve.

---

## Install — Claude Desktop (double-click)

**Double-click `TabTree-Connector.mcpb`.** Claude Desktop opens its install
screen, asks which folder to use — pick your backup folder — and that is the
whole procedure. No terminal, no config file, no Node.

To change the folder later, or to remove the connector, use Claude Desktop's own
extension settings. Nothing was written outside the app.

## Install — Claude Code (one command)

`.mcpb` is a Claude Desktop format; Claude Code reads a config file instead. The
installer writes it for you, backing up any existing one first:

```bash
node mcp/install.mjs --dir "/path/to/your/backup/folder"
```

It prints the `claude mcp add` command to paste for user-wide access.

To see what it *would* do without writing anything:

```bash
node mcp/install.mjs --dir "/path/to/your/backup/folder" --dry-run
```

To check an install that already exists:

```bash
node mcp/install.mjs --check
```

### Manual install — Claude Code

```bash
claude mcp add tabtree --scope user -e TABTREE_DIR="/path/to/your/backup/folder" -- node /absolute/path/to/mcp/tabtree-mcp.mjs
```

`--scope user` makes the connector available in every project. Drop it and the
connector only exists in the directory you ran the command from.

If you would rather not use the CLI, put this in a `.mcp.json` file at the root
of a project — same result, scoped to that project:

```json
{
  "mcpServers": {
    "tabtree": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/tabtree-mcp.mjs"],
      "env": { "TABTREE_DIR": "/path/to/your/backup/folder" }
    }
  }
}
```

### Manual install — Claude Desktop (fallback)

You should not need this: the `.mcpb` above does it for you. Use it only if your
Claude Desktop is too old to install extensions. Open the config file for your
system:

| System | File |
| --- | --- |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Add the `tabtree` block shown above inside `mcpServers`, keeping any servers
already listed there. Save, then **fully quit and reopen Claude Desktop** —
reloading the window is not enough.

Paths must be absolute in both clients. `~` and relative paths will not resolve.

---

## What Claude can do

| Tool | What it does |
| --- | --- |
| `list_maps` | Lists every map and board — name, type, folder, size, last modified. |
| `read_map` | Reads one map. A mind map comes back as a markdown outline, a board as elements and connections. |
| `search_maps` | Searches the whole library — map names, nodes, notes, shapes, stickies. Case-insensitive. |
| `create_mindmap` | Creates a new mind map from a markdown outline. |
| `create_board` | Creates a new whiteboard — shapes and arrows that stay anchored in the app. |
| `propose_changes` | Proposes changes to a map you already have. Nothing is written to it — TabTree asks you first. |

`create_mindmap` takes an indented markdown outline. Headings (`#`, `##`) and
bullet lists both work, two spaces per level, `[x]` for a checked item and
`[title](url)` for a link. The first top-level line becomes the centre of the
map.

`create_board` takes a list of elements (`rect`, `ellipse`, `text`, `sticky`)
and connections between them. Leave out the x/y coordinates and it lays the
board out automatically — the connections define the hierarchy, left to right.
Both accept an optional `folder`, which becomes a folder in your library.

`propose_changes` is the one tool that points at a map you already have. It can
add a branch, rename a node, write a note, tick a task, or remove a branch — and
it does none of those things by itself. It writes a small file into a
`Propositions` subfolder of your backup folder; TabTree checks that folder while
it is open and raises a banner on the map concerned. You review the changes one
by one, tick the ones you want, and press **Apply**. ⌘Z undoes the lot.

Claude names each node by its exact text, so ask it to read the map first. When
the same wording appears twice, it must write a path — `"Q4 > Hire"` — and if it
cannot tell them apart, the proposal is refused rather than applied to the wrong
one. A proposal you ignore is moved to `Propositions/Reviewed`, never deleted.

If you close TabTree, or the backup folder is not connected, nothing is lost:
the proposal waits in the folder and the banner appears the next time you open
the app with that folder connected.

---

## Getting the maps into TabTree

New files land in your backup folder but the app does not watch that folder, so
nothing appears on its own. Open *My maps*, click the **🛟** button in the
toolbar, and choose **"Bring maps back from this folder…"**. Anything already in
your library is skipped, so you can press it as often as you like. The same
command is in ⌘K under "Bring my maps back from a folder…".

There is no ♻️ button in the toolbar: it only appears when your library is
empty. With maps already in it, the 🛟 menu is the way in.

**The folder must match.** The connector writes to the folder you configured;
TabTree reads the folder named next to its 🛟 button. If those are two different
folders, maps are created correctly and never appear. Every creation message
tells you which folder was written — compare it with what the app shows.

Tell Claude to use a `folder` — `"Depuis Claude"`, `"Claude"`, whatever you
prefer — and everything it makes stays grouped in one place in your library.

---

## When it does not work

**Claude does not offer the tools.** Restart the client — Claude Desktop needs a
full quit, not a window reload. Then check the config file is valid JSON; a
trailing comma is enough to make the whole file be ignored silently.

**"TABTREE_DIR is not set."** The `env` block is missing or the path is wrong.
Run `node mcp/install.mjs --check` to see the path the connector resolves.

**"The TABTREE_DIR folder does not exist."** The path has a typo, or the folder
is in iCloud Drive / OneDrive and has been evicted to the cloud. Open it in
Finder or Explorer once to bring it back.

**New maps do not show up in the app.** They are files on disk until you press
brought them in from the 🛟 menu. Check the folder in Finder first — if the file
is there, the connector did its job, and the question is only which folder the
app is reading.

**A map comes back empty.** The connector reads `.tabtree` and `.ygmind` files
one folder deep. A map filed two levels down is out of reach; move it up.

**Claude filed a proposal and no banner appeared.** Three things must all be
true: TabTree is open, its 🛟 folder is the folder the connector writes to, and
the map the proposal targets is one this browser actually has. That last one
catches the common case — a proposal for a map that only exists on your other
machine stays silent here, on purpose. Type `__ygProps()` in the browser console
to see what the app found.

---

## 🇫🇷 En français

Le connecteur permet à Claude de lire votre bibliothèque TabTree et de créer des
cartes et des boards. Il ne crée que de **nouveaux fichiers** : il ne peut rien
écraser ni supprimer, et ne touche jamais au stockage du navigateur. Pour
modifier une carte existante, il dépose une **proposition** que TabTree vous
présente ligne par ligne : rien n'est appliqué sans votre clic, et ⌘Z l'annule.

Prérequis : un dossier de sauvegarde configuré dans TabTree (🛟 dans « Mes
cartes »).

**Claude Desktop** — double-cliquez `TabTree-Connector.mcpb`. Claude demande le
dossier à utiliser, et c'est terminé : ni terminal, ni fichier de config, ni
Node à installer.

**Claude Code** — `.mcpb` ne s'y applique pas, il lit un fichier de config :

```bash
node mcp/install.mjs --dir "/chemin/vers/votre/dossier"
```

Cette voie-là demande Node.js 18 ou plus. Ensuite, demandez par exemple
« transforme ces notes de réunion en carte mentale » : la carte est écrite dans
le dossier ; récupérez-la dans l'app par *Mes cartes* → **🛟** → **« Bring maps
back from this folder… »**. Le dossier visé par le connecteur doit être celui
que TabTree affiche à côté de son bouton 🛟 : s'ils diffèrent, les cartes sont
créées et n'apparaissent jamais.

Support : info@ai4x.academy
