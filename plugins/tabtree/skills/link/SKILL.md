---
name: link
description: Links this git repository to one TabTree board. Use when the user runs /tabtree:link or asks to connect this repo to a board.
---

1. Call the TabTree `list_maps` tool and show the user the kanban boards, by name.
2. Ask which board this repository belongs to. Never choose for the user.
3. Run `tabtree link "<file>" "<name>"` with the `file:` value and the name that `list_maps` showed.
4. Tell the user that `.tabtree.json` was written and contains no secret. Suggest committing it so teammates share the link. Do not commit it yourself unless asked.
