#!/usr/bin/env node
// ============================================================================
// TabTree MCP — serveur local, zéro dépendance (Model Context Protocol, stdio)
//
// Rôle : permettre à Claude (Claude Code, Claude Desktop…) de LIRE la
// bibliothèque TabTree et de CRÉER des cartes mentales et des boards,
// sans passer par l'interface — génération depuis une conversation,
// un document, un plan…
//
// Où : le serveur travaille sur le DOSSIER DE SAUVEGARDE AUTO de TabTree
// (celui choisi via 🛟 dans « Mes cartes ») : 1 fichier .ygmind par carte
// + bibliotheque.json (manifeste, propriété de l'app — jamais modifié ici).
// Le MCP ne crée que de NOUVEAUX fichiers ; l'app les avale par le menu 🛟
// (« Bring maps back from this folder… »), avec dédoublonnage et sans écrasement.
//
// Config : TABTREE_DIR = chemin du dossier. YGMIND_DIR (ancien nom) reste accepté,
// pour qu'un .mcp.json écrit avant le renommage continue de marcher sans retouche.
// Protocole : JSON-RPC 2.0, un message JSON par ligne sur stdin/stdout.
// ============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

const DIR = process.env.TABTREE_DIR || process.env.YGMIND_DIR || "";
const MANIFEST = "bibliotheque.json";
// Boîte aux lettres des propositions. Le connecteur reste EN AJOUT SEUL : il ne modifie
// jamais un .tabtree, il dépose ici un fichier que l'app lit, montre, et n'applique que si
// l'utilisateur clique. C'est la seule raison pour laquelle un outil qui « modifie une
// carte » peut exister sans mettre en danger le travail de qui que ce soit.
const PROP_DIR = "Propositions";

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function dirOk(){
  if(!DIR) throw new Error("TABTREE_DIR is not set. Point it at your TabTree backup folder — the one you picked with 🛟 on the My maps screen. (The older name YGMIND_DIR still works.)");
  if(!existsSync(DIR)) throw new Error("The TABTREE_DIR folder does not exist: " + DIR);
}
// Même règle de nommage que l'app (bkSafeName) : la restauration retire le
// suffixe __map… pour retrouver le nom de la carte.
function safeName(s){
  return String(s||"").replace(/[\/\\:*?"<>|\n\r\t]+/g, "_").replace(/\s+/g, " ").trim().slice(0,60) || "map";
}
function newFileName(name){ return safeName(name) + "__map_mcp" + Date.now().toString(36) + ".tabtree"; }
function checkRelPath(f){
  if(typeof f !== "string" || !f || f.includes("..") || f.startsWith("/")) throw new Error("Invalid file path: " + f);
  return f;
}
function makeNode(text){
  return { text: String(text||""), color: "#ffffff", link: "", note: "", check: null, priority: null, collapsed: false, children: [] };
}

// ---------------------------------------------------------------------------
// Markdown → arbre (portage de parseOutline/buildForest de l'app)
// ---------------------------------------------------------------------------
function parseOutline(txt){
  const items = [];
  let headingBase = -1;
  String(txt).replace(/\r/g,"").split("\n").forEach(raw=>{
    if(!raw.trim()) return;
    const hm = raw.match(/^\s*(#{1,6})\s+(.*)$/);
    let level, text;
    if(hm){ level = hm[1].length - 1; headingBase = level; text = hm[2]; }
    else {
      const m = raw.match(/^(\s*)(?:[-*+]\s+|\d+[.)]\s+)?(.*)$/);
      const indent = m[1].replace(/\t/g,"  ");
      level = (headingBase>=0 ? headingBase+1 : 0) + Math.floor(indent.length/2);
      text = m[2];
    }
    let check = null;
    const cm = text.match(/^\[([ xX])\]\s+(.*)$/);
    if(cm){ check = /x/i.test(cm[1]); text = cm[2]; }
    let link = "";
    const lm = text.trim().match(/^\[(.+?)\]\((\S+?)\)$/);
    if(lm){ text = lm[1]; link = lm[2]; }
    items.push({ level, text: text.trim(), check, link });
  });
  return items;
}
function buildForest(items){
  if(!items.length) return [];
  const minLevel = Math.min(...items.map(i=>i.level));
  const roots = [], stack = [];
  for(const it of items){
    const lvl = it.level - minLevel;
    const node = makeNode(it.text);
    if(it.check!=null) node.check = it.check;
    if(it.link) node.link = it.link;
    let parent = null;
    for(let k=lvl-1;k>=0;k--){ if(stack[k]){ parent = stack[k]; break; } }
    if(parent) parent.children.push(node); else roots.push(node);
    stack[lvl] = node; stack.length = lvl+1;
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Une ILLUSTRATION sur un nœud (`node.pic`, 2026-08-19)
//
// Claude ne dessine pas — l'API rend du texte, et 🖼 Generate image de l'app parle à Google
// avec une seconde clé. Mais `node.pic` ne porte pas de pixels : il porte une DÉSIGNATION,
// `a:<id>` parmi les illustrations livrées avec l'app, ou `e:<emoji>`. Une vingtaine
// d'octets. C'est donc exactement ce qu'un producteur de TEXTE sait produire, et c'est ce qui
// permet au connecteur de livrer une carte ILLUSTRÉE au lieu d'un arbre nu.
//
// ⚠️ Portage MOT POUR MOT d'`okPic` et de `tplPicAssign`, et le test les compare caractère
// par caractère — comme `propFind`, et pour la même raison en pire : `okPic` est une
// FRONTIÈRE DE CONFIANCE. Si les deux divergent, le connecteur écrit une désignation que
// l'app refuse à l'ouverture, et l'illustration disparaît sans une erreur. Les ids, eux,
// sont comparés en ENSEMBLE à `ART_GROUPS` de l'app — même dispositif que les formes et
// que les listes d'habillage.
const PIC_MAX = 40;   // un emoji ou un id, jamais une charge utile
const ART_IDS_MCP = [
  "person", "team", "chat", "idea", "target", "trophy",
  "star", "heart", "warning", "done", "flag", "clock",
  "laptop", "phone", "mail", "folder", "book", "chart",
  "money", "calendar", "building", "car", "globe", "rocket",
  "house", "pin", "plane", "coffee", "plant", "sun",
  "camera", "music", "lock", "key", "health", "gift"
];
const ART = Object.fromEntries(ART_IDS_MCP.map(id=>[id, true]));
  const EMO_PIC_PAT = "\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?)*";
  const PIC_EMO_RE = (()=>{
    try{ return new RegExp("^(?:" + EMO_PIC_PAT + ")$", "u"); }
    // Repli du côté SÛR : un navigateur sans échappement de propriété refuse l'emoji plutôt
    // que d'accepter n'importe quoi. On perd un ornement, jamais la carte.
    catch(e){ return /^(?:[‼-㊙\uD800-\uDBFF][\uDC00-\uDFFF]?[️︎]?[‍]?)+$/; }
  })();
function okPic(v){
    if(typeof v !== "string" || !v || v.length > PIC_MAX) return "";
    if(v.startsWith("a:")) return ART[v.slice(2)] ? v : "";
    if(v.startsWith("e:")){
      const ch = v.slice(2);
      return (ch && PIC_EMO_RE.test(ch)) ? "e:" + ch : "";
    }
    return "";
  }
function tplPicAssign(n){
    (function walk(x){
      const m = /^(.*\S)\s+@([ae]:\S+)$/.exec(x.text || "");
      const v = m ? okPic(m[2]) : "";
      if(v){ x.text = m[1]; x.pic = v; }
      x.children.forEach(walk);
    })(n);
  }

// ---------------------------------------------------------------------------
// Désignation d'un nœud (partagé mot pour mot avec l'app — voir tabtree-mcp.test.mjs)
//
// Une proposition doit nommer le nœud qu'elle vise, et ce nom est écrit par Claude puis
// relu par l'app : les deux DOIVENT désigner le même nœud, sinon le panneau montre une
// modification et une autre est appliquée. D'où deux fonctions dupliquées et gelées par
// un test caractère par caractère, comme safeName.
//
// La syntaxe est celle qu'un humain écrirait : « Parent > Enfant ». Seule la DERNIÈRE
// partie doit être le nœud lui-même ; les précédentes sont des ancêtres, dans l'ordre mais
// pas forcément contigus — on peut donc désigner « Q3 > Recruter » sans réciter tout le
// chemin. Une désignation qui touche deux nœuds est refusée, jamais devinée : appliquer la
// modification au mauvais jumeau serait une perte de données silencieuse.
function propPathMatch(path, parts){
  let i = path.length - 1, j = parts.length - 1;
  if(path[i] !== parts[j]) return false;
  j--;
  while(j >= 0){
    i--;
    while(i >= 0 && path[i] !== parts[j]) i--;
    if(i < 0) return false;
    j--;
  }
  return true;
}
function propFind(root, spec){
  const parts = String(spec == null ? "" : spec).split(">").map(s=>s.trim()).filter(Boolean);
  if(!parts.length) return { error:"empty", count:0 };
  const hits = [];
  (function walk(n, path){
    const p = path.concat([String(n.text == null ? "" : n.text).trim()]);
    if(propPathMatch(p, parts)) hits.push(n);
    (n.children||[]).forEach(c=>walk(c, p));
  })(root, []);
  if(hits.length === 1) return { node: hits[0], count:1 };
  return { error: hits.length ? "ambiguous" : "missing", count: hits.length };
}

// ---------------------------------------------------------------------------
// Arbre → markdown (lecture d'une carte)
// ---------------------------------------------------------------------------
function nodeToMarkdown(n, depth){
  const lines = [];
  (function walk(node, d){
    let bullet;
    if(d===0) bullet = "# ";
    else bullet = "  ".repeat(d-1) + (node.check!=null ? (node.check ? "- [x] " : "- [ ] ") : "- ");
    const body = node.link ? `[${node.text}](${node.link})` : node.text;
    lines.push(bullet + body + (node.note && node.note.trim() ? "  ⟪note⟫" : ""));
    (node.children||[]).forEach(c=>walk(c, d+1));
  })(n, depth||0);
  return lines.join("\n");
}
function countNodes(n){ let c = 1; (n.children||[]).forEach(k=>c += countNodes(k)); return c; }

// ---------------------------------------------------------------------------
// Board : construction avec layout automatique par niveaux
// ---------------------------------------------------------------------------
// Doit rester ALIGNÉ sur la liste blanche de `deserialize()` dans index.html
// (`rect` / `ellipse` / `diamond` / `trap` / `chev` / `arc` / `text`, plus `sticky` qui
// est un post-it et non une forme). Le losange a été ajouté le 2026-08-14 en même temps
// que dans l'app : sans ça, le Copilote intégré savait dessiner un nœud de décision et le
// connecteur non — exactement la dérive app ↔ connecteur que `safeName` a déjà payée.
// `trap` porte `tk` (rapport du petit côté, signe = quel côté est en haut) et `arc` porte
// a0/a1/ir — le connecteur les laisse passer tels quels, c'est `deserialize()` qui borne.
const KINDS = ["rect","ellipse","diamond","trap","chev","arc","text","sticky"];
// ---- Le texte tient-il dans sa boîte ? ---------------------------------------------
// L'app MESURE le texte (canvas measureText) et réduit le corps jusqu'à ce qu'il tienne :
// depuis le 2026-08-16, rien ne peut donc plus sortir d'une forme. Mais un texte ramené à
// 9 px « tient » et reste illisible — et une toile BMC dont les neuf blocs sont en 9 px est
// exactement le résultat qui a motivé tout ceci. On estime donc ICI, on pose le corps qui
// convient, et surtout on le DIT dans la réponse : c'est le seul moment où Claude peut encore
// raccourcir son texte.
//
// 7,2 px par caractère à 15 px : moyenne MESURÉE dans le navigateur sur six phrases réelles
// de toile (6,77 à 7,34 selon la phrase). C'est une ESTIMATION assumée, pas un miroir de
// wrap() — l'app reste seule juge à l'écran, et c'est pour ça que cette fonction n'a pas à
// être figée caractère par caractère comme parseOutline ou propFind.
const CHAR_W = 7.2, LINE_H = 20, FIT_FLOOR = 11;
function fitSize(text, w, h, kind, want){
  if(kind === "text") return { size: want, shrunk: false, readable: true }; // grandit avec son contenu
  const sticky = kind === "sticky";
  const pad = sticky ? 10 : kind === "diamond" ? Math.max(14, Math.round(w*0.22)) : 12;
  const avail = Math.max(30, w - pad*2);
  const linesAt = (size)=>{                       // wrap glouton, comme celui de l'app
    const cw = CHAR_W * size/15;
    let n = 0;
    for(const para of String(text).split("\n")){
      const words = para.split(/\s+/).filter(Boolean);
      if(!words.length){ n++; continue; }
      let cur = 0;
      for(const word of words){
        const wl = word.length*cw, sp = cur ? cw : 0;
        if(cur && cur + sp + wl > avail){ n++; cur = wl; } else cur += sp + wl;
      }
      if(cur) n++;
    }
    return n;
  };
  const fits = (size)=>{
    const lh = Math.round(size*LINE_H/15);
    return sticky ? linesAt(size) <= Math.floor((h - 14)/lh)   // un post-it COUPE au-delà
                  : linesAt(size)*lh + 10 <= h;                // une forme centre et débordait
  };
  for(let size = want; size >= 9; size--)
    if(fits(size)) return { size, shrunk: size < want, readable: size >= FIT_FLOOR };
  return { size: 9, shrunk: true, readable: false };
}

function buildBoardDoc(name, elements, connections, style){
  if(!Array.isArray(elements) || !elements.length) throw new Error("`elements` must be a non-empty list.");
  const els = elements.map((e,i)=>{
    const kind = KINDS.includes(e.kind) ? e.kind : "rect";
    return { lid: String(e.id != null ? e.id : i), kind, text: String(e.text||""),
             x: Number.isFinite(+e.x) && e.x!=null ? Math.round(+e.x) : null,
             y: Number.isFinite(+e.y) && e.y!=null ? Math.round(+e.y) : null,
             w: (+e.w>=20) ? Math.round(+e.w) : null, h: (+e.h>=20) ? Math.round(+e.h) : null,
             color: (typeof e.color==="string" && /^#[0-9a-fA-F]{3,8}$/.test(e.color)) ? e.color : null,
             // Géométrie des formes « diagramme » : transmise telle quelle, deserialize() borne.
             tk: (e.kind==="trap" && Number.isFinite(+e.tk)) ? +e.tk : null,
             a0: (e.kind==="arc" && Number.isFinite(+e.a0)) ? +e.a0 : null,
             a1: (e.kind==="arc" && Number.isFinite(+e.a1)) ? +e.a1 : null,
             ir: (e.kind==="arc" && Number.isFinite(+e.ir)) ? +e.ir : null,
             size: (+e.size>=9 && +e.size<=72) ? Math.round(+e.size) : null };
  });
  const byId = new Map();
  for(const e of els){
    if(byId.has(e.lid)) throw new Error("Duplicate element id: " + e.lid);
    byId.set(e.lid, e);
  }
  const conns = (Array.isArray(connections) ? connections : []).map(c=>{
    const from = String(c.from), to = String(c.to);
    if(!byId.has(from) || !byId.has(to))
      throw new Error(`connexion ${from}→${to} : id inconnu (ids valides : ${[...byId.keys()].join(", ")})`);
    return { from, to };
  });

  // Niveaux : racines = jamais cibles ; enfants = BFS. Sert au placement auto.
  const targets = new Set(conns.map(c=>c.to));
  const kids = new Map();
  conns.forEach(c=>{ if(!kids.has(c.from)) kids.set(c.from, []); kids.get(c.from).push(c.to); });
  const level = new Map();
  const queue = els.filter(e=>!targets.has(e.lid)).map(e=>e.lid);
  queue.forEach(id=>level.set(id, 0));
  while(queue.length){
    const id = queue.shift();
    for(const k of (kids.get(id)||[])){
      if(!level.has(k)){ level.set(k, level.get(id)+1); queue.push(k); }
    }
  }
  els.forEach(e=>{ if(!level.has(e.lid)) level.set(e.lid, 0); }); // cycles / isolés

  // Placement : une colonne par niveau, empilement vertical.
  const perLevel = new Map();
  for(const e of els){
    const defW = e.kind==="sticky" ? 190 : e.kind==="text" ? 220 : 180;
    const defH = e.kind==="sticky" ? 130 : e.kind==="text" ? 28 : 90;
    e.w = e.w || defW; e.h = e.h || defH;
    if(e.x==null || e.y==null){
      const lv = level.get(e.lid);
      const idx = perLevel.get(lv) || 0; perLevel.set(lv, idx+1);
      e.x = 60 + lv*320;
      e.y = 60 + idx*170;
    }
    if(!e.color) e.color = e.kind==="sticky" ? "#fff59d" : (level.get(e.lid)===0 && conns.length ? "#dbeafe" : "#ffffff");
  }

  // Ajustement du texte à sa boîte : on pose le corps qui tient, et on signale ce qui a dû
  // être réduit. Sans ce retour, un texte trois fois trop long part quand même et ne se
  // découvre qu'à l'écran, une fois la carte importée.
  // On signale TOUT rétrécissement, pas seulement l'illisible : sur une toile, un bloc à
  // 15 px à côté d'un bloc à 11 px se voit immédiatement, alors que les deux « tiennent ».
  // C'est l'uniformité qui fait qu'une toile remplie a l'air composée.
  const warnings = [];
  for(const e of els){
    const f = fitSize(e.text, e.w, e.h, e.kind, e.size || 15);
    if(!f.shrunk) continue;
    e.size = f.size;
    const budget = Math.round(Math.max(40, Math.floor((e.w - 24)/CHAR_W) * Math.max(1, Math.floor((e.h - 10)/LINE_H)) * 0.7));
    warnings.push(`“${e.text.slice(0, 38).replace(/\s+/g, " ")}…” — ${e.text.length} chars in a ${e.w}×${e.h} box, `
      + `shrunk to ${f.size}px${f.readable ? "" : " (too small to read)"}. Aim for ~${budget} chars.`);
  }

  // Sortie au format de l'app : shapes / stickies + refs "sh:i" / "st:i"
  const shapes = [], stickies = [], refOf = new Map();
  for(const e of els){
    if(e.kind==="sticky"){
      refOf.set(e.lid, "st:" + stickies.length);
      stickies.push({ text:e.text, x:e.x, y:e.y, w:e.w, h:e.h, color:e.color, size:e.size||undefined });
    } else {
      refOf.set(e.lid, "sh:" + shapes.length);
      shapes.push({ kind:e.kind, x:e.x, y:e.y, w:e.w, h:e.h, color:e.kind==="text" ? "#ffffff" : e.color, text:e.text, size:e.size||undefined,
                    tk: e.tk != null ? e.tk : undefined,
                    a0: e.a0 != null ? e.a0 : undefined,
                    a1: e.a1 != null ? e.a1 : undefined,
                    ir: e.ir != null ? e.ir : undefined });
    }
  }
  const arrows = conns.map(c=>{
    const a = byId.get(c.from), b = byId.get(c.to);
    return { x1: a.x + Math.round(a.w/2), y1: a.y + Math.round(a.h/2),
             x2: b.x + Math.round(b.w/2), y2: b.y + Math.round(b.h/2),
             from: refOf.get(c.from), to: refOf.get(c.to) };
  });
  const root = makeNode(name); root.color = "#dbeafe";
  const doc = { v:1, root, images:[], stickies, board:true, shapes, arrows, draws:[] };
  // `style` n'est émis que s'il est posé : l'app elle-même l'omet quand il vaut le défaut
  // (styleParDefaut), et le JSON d'un board ordinaire ne doit pas gagner un octet.
  const st = okStyleMcp(style);
  if(st) doc.style = st;
  return { doc, warnings };
}

// Habillage du document : familles de caractères, forme des nœuds, fond de page. Liste
// blanche recopiée de l'app (FONTS / NODE_SHAPES / BACKGROUNDS) — même nécessité que KINDS :
// une valeur inconnue serait silencieusement ramenée au défaut par okStyle() à l'ouverture.
const FONTS_MCP = ["", "grotesk", "humanist", "condensed", "rounded", "serif",
  "garamond", "didone", "slab", "typewriter", "mono", "hand"];
const SHAPES_MCP = ["", "line", "plain"];
const BACKGROUNDS_MCP = ["", "plain", "grid", "graph", "lines", "iso", "paper",
  "cream", "kraft", "aged", "mist", "sage", "dawn", "blue", "slate", "chalk"];
// `palette` ne parle qu'aux couleurs de BRANCHE : accepté sur une carte, sans effet sur un
// board (les formes n'ont pas de branche) — même règle que la rangée du menu ✒️ Style.
const PALETTES_MCP = ["", "ocean", "sunset", "forest", "berry", "nordic", "earth",
  "vintage", "candy", "muted"];
// `skin` est l'axe STRUCTUREL (bordures, ombres, coins — 2026-08-17) : recopié de SKINS
// dans l'app, et comparé en ensemble par le test anti-dérive comme les trois autres listes.
const SKINS_MCP = ["", "soft", "flat", "paper", "ink", "draft", "sticker", "brutal", "arcade"];
// `ico` est l'axe des PICTOGRAMMES (2026-08-17) : « Plain » les dessine au trait comme depuis
// toujours, « Chip » et « Large » les posent sur une pastille teintée de la couleur de branche.
// Sans effet sur un board (aucune forme ne porte de pictogramme), accepté quand même — même
// règle que `palette`. Recopié d'ICO_STYLES et comparé en ensemble par le test anti-dérive.
const ICOS_MCP = ["", "chip", "big"];
function okStyleMcp(s){
  if(!s || typeof s !== "object") return null;
  const out = {};
  if(FONTS_MCP.includes(s.font)) out.font = s.font;
  if(SHAPES_MCP.includes(s.shape)) out.shape = s.shape;
  if(BACKGROUNDS_MCP.includes(s.background)) out.bg = s.background;
  if(PALETTES_MCP.includes(s.palette)) out.palette = s.palette;
  if(SKINS_MCP.includes(s.skin)) out.skin = s.skin;
  if(ICOS_MCP.includes(s.icons)) out.ico = s.icons;
  return (out.font || out.shape || out.bg || out.palette || out.skin || out.ico)
    ? { font:out.font||"", shape:out.shape||"", bg:out.bg||"", palette:out.palette||"",
        skin:out.skin||"", ico:out.ico||"" } : null;
}

// ---------------------------------------------------------------------------
// Lecture de la bibliothèque
// ---------------------------------------------------------------------------
function readManifest(){
  try{
    const m = JSON.parse(readFileSync(join(DIR, MANIFEST), "utf8"));
    // Les dossiers de la bibliothèque sont ARBORESCENTS (parentId) : on rend le chemin
    // complet, sinon deux « Archive » rangés sous deux parents sont indiscernables ici.
    // Un manifeste d'avant les sous-dossiers n'a pas de parentId → chemin à une part,
    // c'est-à-dire l'ancien comportement.
    const folders = new Map((m.folders||[]).filter(f=>f && f.id).map(f=>[f.id, f]));
    const pathOf = (id)=>{
      const out = [], seen = new Set();
      let f = folders.get(id);
      while(f && !seen.has(f.id) && out.length <= 16){ seen.add(f.id); out.unshift(f.name); f = f.parentId ? folders.get(f.parentId) : null; }
      return out.length ? out.join(" / ") : null;
    };
    const byFile = new Map();
    (m.maps||[]).forEach(x=>{ if(x && x.file) byFile.set(x.file, { name:x.name, folder: pathOf(x.folderId) }); });
    return byFile;
  }catch(e){ return new Map(); }
}
function scanLibrary(){
  dirOk();
  const man = readManifest();
  const out = [];
  const scanDir = (path, folder)=>{
    for(const ent of readdirSync(path, { withFileTypes:true })){
      if(ent.isDirectory()){
        // Corbeille = cartes supprimées, Propositions = boîte aux lettres : ni l'une ni
        // l'autre ne contient de carte vivante. Sans cette exclusion, une proposition
        // déposée ici se relirait comme une carte de la bibliothèque au tour suivant.
        if(folder===null && ent.name !== "Corbeille" && ent.name !== PROP_DIR) scanDir(join(path, ent.name), ent.name); // 1 niveau, comme bkCollect
        // ⚠️ « comme l'app » est vrai de ♻️ Restaurer (bkCollect) et FAUX de la synchro
        // automatique : syncReadDisk ne lit QUE la racine. Une carte écrite ici dans un
        // sous-dossier est donc invisible au scan, syncDecide rend « push » et l'app en
        // recrée une copie à la racine. Dette nommée, pas un oubli.
        continue;
      }
      if(!/\.(tabtree|ygmind|json)$/i.test(ent.name) || ent.name === MANIFEST) continue;
      const rel = folder ? folder + "/" + ent.name : ent.name;
      const meta = man.get(ent.name) || {};
      let doc = null;
      try{ doc = JSON.parse(readFileSync(join(path, ent.name), "utf8")); }catch(e){}
      if(!doc || !doc.root) continue;
      out.push({
        file: rel,
        name: meta.name || ent.name.replace(/\.(tabtree|ygmind|json)$/i, "").replace(/__map[A-Za-z0-9_]+$/, ""),
        folder: meta.folder || folder || null,
        kind: doc.board ? "board" : "map",
        nodes: countNodes(doc.root),
        elements: doc.board ? ((doc.shapes||[]).length + (doc.stickies||[]).length + (doc.arrows||[]).length + (doc.draws||[]).length) : undefined,
        mtime: statSync(join(path, ent.name)).mtime.toISOString().slice(0,16).replace("T"," "),
        doc
      });
    }
  };
  scanDir(DIR, null);
  out.sort((a,b)=>b.mtime.localeCompare(a.mtime));
  return out;
}
function collectTexts(doc){
  const texts = [];
  (function walk(n){ if(n.text) texts.push(n.text); if(n.note) texts.push(n.note); (n.children||[]).forEach(walk); })(doc.root);
  (doc.shapes||[]).forEach(s=>{ if(s.text) texts.push(s.text); });
  (doc.stickies||[]).forEach(s=>{ if(s.text) texts.push(s.text); });
  return texts;
}
function boardToText(doc){
  const lines = [];
  const label = (arr, i, tag)=>{
    const o = arr[i];
    return o ? `${tag}${i} ${JSON.stringify((o.text||"(no text)").slice(0,60))}` : tag+i+" ?";
  };
  lines.push(`Shapes (${(doc.shapes||[]).length}):`);
  (doc.shapes||[]).forEach((s,i)=>lines.push(`  sh:${i} [${s.kind}] ${JSON.stringify((s.text||"").slice(0,80))} @(${s.x},${s.y}) ${s.w}×${s.h}`));
  if((doc.stickies||[]).length){
    lines.push(`Sticky notes (${doc.stickies.length}):`);
    doc.stickies.forEach((s,i)=>lines.push(`  st:${i} ${JSON.stringify((s.text||"").slice(0,80))} @(${s.x},${s.y})`));
  }
  const named = ref=>{
    if(typeof ref !== "string") return null;
    const m = /^(sh|st):(\d+)$/.exec(ref); if(!m) return null;
    return label(m[1]==="sh" ? (doc.shapes||[]) : (doc.stickies||[]), +m[2], m[1]+":");
  };
  if((doc.arrows||[]).length){
    lines.push(`Arrows (${doc.arrows.length}):`);
    doc.arrows.forEach(a=>{
      const f = named(a.from), t = named(a.to);
      lines.push(`  ${f || `(${a.x1},${a.y1})`} → ${t || `(${a.x2},${a.y2})`}`);
    });
  }
  if((doc.draws||[]).length) lines.push(`Pencil strokes: ${doc.draws.length}`);
  return lines.join("\n");
}
function findMap(file){
  checkRelPath(file);
  const all = scanLibrary();
  const hit = all.find(m=>m.file===file) || all.find(m=>m.file.endsWith(file)) || all.find(m=>m.name===file);
  if(!hit) throw new Error("No such map: " + file + ". Use list_maps to see what is available.");
  return hit;
}

// ---------------------------------------------------------------------------
// Écriture (toujours un NOUVEAU fichier — jamais de modification en place)
// ---------------------------------------------------------------------------
function writeDoc(name, doc, folder){
  dirOk();
  let target = DIR;
  if(folder){
    const f = safeName(folder);
    target = join(DIR, f);
    if(!existsSync(target)) mkdirSync(target);
  }
  const file = newFileName(name);
  writeFileSync(join(target, file), JSON.stringify(doc, null, 2), "utf8");
  return (folder ? safeName(folder) + "/" : "") + file;
}
// ---------------------------------------------------------------------------
// Propositions de modification (dépôt seul — l'app décide, l'utilisateur clique)
// ---------------------------------------------------------------------------
// L'id de carte est le suffixe « __<id> » du nom de fichier : c'est lui qui apparie une
// proposition à la carte ouverte dans le navigateur. Même règle que syncIdOf côté app.
function mapIdOf(file){
  const base = basename(String(file||"")).replace(/\.(tabtree|ygmind|json)$/i, "");
  const i = base.lastIndexOf("__");
  if(i < 0) return null;
  const id = base.slice(i + 2);
  return /^[A-Za-z0-9_]+$/.test(id) ? id : null;
}
function countForest(roots){ return roots.reduce((n,r)=>n + countNodes(r), 0); }

// ≡ la liste de `index.html`. Une op connue d'un seul côté ne lève AUCUNE erreur : le
// connecteur la refuserait à l'écriture, ou l'app la jetterait à la lecture — dans les deux
// cas Claude croirait avoir proposé quelque chose qui n'arrive jamais chez l'utilisateur.
// C'est le défaut du losange, rejoué. Un test compare les deux listes en ensembles.
const PROP_OPS = ["add","rename","note","check","delete","move","pic"];

// Tout est vérifié ICI, contre la carte réelle, et un défaut fait ÉCHOUER l'appel. C'est
// délibéré : une cible introuvable remonte à Claude, qui peut relire la carte et corriger,
// alors qu'une proposition à moitié valide arriverait chez l'utilisateur sous forme de
// lignes barrées qu'il ne peut ni comprendre ni réparer. La boîte aux lettres ne reçoit
// que des propositions applicables.
function buildProposalOps(mapDoc, changes){
  if(!Array.isArray(changes) || !changes.length) throw new Error("`changes` must be a non-empty list.");
  if(changes.length > 100) throw new Error("Too many changes in one proposal (max 100). Send several smaller ones — the user reviews them one by one.");
  return changes.map((c, i)=>{
    const where = "change #" + (i+1);
    const op = String((c && c.op) || "").trim();
    if(!PROP_OPS.includes(op)) throw new Error(`${where}: unknown op "${op}". Use one of: ${PROP_OPS.join(", ")}.`);
    const target = String(c.target == null ? "" : c.target);
    const r = propFind(mapDoc.root, target);
    if(r.error === "empty")   throw new Error(`${where}: \`target\` is required — the node the change applies to.`);
    if(r.error === "missing") throw new Error(`${where}: no node "${target}" in this map. Run read_map first and copy the wording exactly.`);
    if(r.error === "ambiguous") throw new Error(`${where}: "${target}" matches ${r.count} nodes. Name an ancestor too, e.g. "Parent > ${parts_last(target)}".`);
    const out = { op, target, was: String(r.node.text||"") };
    if(op === "add"){
      if(typeof c.markdown !== "string" || !c.markdown.trim()) throw new Error(`${where}: \`markdown\` is required for an "add".`);
      if(c.markdown.length > 20000) throw new Error(`${where}: \`markdown\` is too long (20000 characters max).`);
      const forest = buildForest(parseOutline(c.markdown));
      if(!forest.length) throw new Error(`${where}: \`markdown\` has no usable structure (a bullet list, indented by 2 spaces).`);
      out.markdown = c.markdown;
      out.adds = countForest(forest);
    } else if(op === "rename"){
      if(typeof c.text !== "string" || !c.text.trim()) throw new Error(`${where}: \`text\` is required for a "rename".`);
      out.text = c.text.trim().slice(0, 2000);
    } else if(op === "note"){
      if(typeof c.note !== "string") throw new Error(`${where}: \`note\` is required for a "note" (an empty string clears it).`);
      out.note = c.note.slice(0, 8000);
    } else if(op === "check"){
      if(typeof c.value !== "boolean") throw new Error(`${where}: \`value\` must be true or false for a "check".`);
      out.value = c.value;
    } else if(op === "delete"){
      if(r.node === mapDoc.root) throw new Error(`${where}: the centre of the map cannot be deleted.`);
      out.drops = countNodes(r.node);
    } else if(op === "pic"){
      // Une désignation, jamais des pixels. La liste est FERMÉE : un id inventé est refusé ICI,
      // contre la carte réelle, plutôt que d'arriver chez l'utilisateur sous forme d'une ligne
      // barrée qu'il ne peut ni comprendre ni réparer. Vide = retirer l'illustration.
      const pic = String(c.pic == null ? "" : c.pic);
      if(pic && !okPic(pic)){
        throw new Error(`${where}: "${pic}" is not a picture. Use "e:" followed by one emoji, `
          + `or "a:" followed by one of: ${ART_IDS_MCP.join(", ")} — or "" to remove it.`);
      }
      out.pic = pic;
    } else if(op === "move"){
      // ⚠️ Dans le FICHIER les colonnes sont `{cols:[…]}` ; en mémoire, côté app, c'est un
      // tableau nu. Confondre les deux donne un contrôle qui ne regarde rien.
      const cols = (mapDoc.kanban && Array.isArray(mapDoc.kanban.cols)) ? mapDoc.kanban.cols : null;
      if(!cols || !cols.length) throw new Error(`${where}: this map has no kanban board yet. Open it in TabTree and press 🃏 once, then try again.`);
      const col = String(c.col == null ? "" : c.col);
      // Vide = retirer du tableau, comme le ✕ d'une carte. Toute autre valeur doit désigner une
      // colonne RÉELLE : une carte envoyée ailleurs disparaîtrait de l'écran sans un message.
      if(col && !cols.some(k => k.id === col)){
        const noms = cols.map(k => `"${k.name}" (${k.id})`).join(", ");
        throw new Error(`${where}: no column "${col}" on this board. Use one of: ${noms} — or "" to take the card off the board.`);
      }
      out.col = col;
    }
    return out;
  });
}
function parts_last(spec){ const p = String(spec||"").split(">"); return p[p.length-1].trim(); }

function writeProposal(map, note, ops){
  dirOk();
  const target = join(DIR, PROP_DIR);
  if(!existsSync(target)) mkdirSync(target);
  const id = mapIdOf(map.file);
  if(!id) throw new Error("This map's file has no id suffix (“…__map123.tabtree”), so the app cannot match a proposal to it. Open it once in TabTree with the backup folder turned on, then try again.");
  const file = "prop_" + id + "__" + Date.now().toString(36) + ".json";
  writeFileSync(join(target, file), JSON.stringify({
    v: 1, kind: "tabtree-proposal", mapId: id, mapFile: basename(map.file), mapName: map.name,
    createdAt: Date.now(), by: "Claude", note: String(note||"").slice(0, 2000), ops
  }, null, 2), "utf8");
  return PROP_DIR + "/" + file;
}

// Ce texte est lu par CHAQUE acheteur, à chaque création. Il a déjà été faux une
// fois : il disait « My maps → ♻️ Restore », or ce bouton est masqué tant que la
// bibliothèque n'est pas vide. L'utilisateur cherchait un bouton inexistant
// pendant que son fichier attendait sur le disque.
//
// Il nomme aussi le DOSSIER écrit, et c'est délibéré : la panne la plus vicieuse
// du connecteur est de viser une autre bibliothèque que celle ouverte dans l'app.
// Tout répond « ✅ » et rien n'apparaît. Donner le nom du dossier rend l'écart
// visible en une seconde, sans que personne ait à soupçonner quoi que ce soit.
function importHint(){
  return "Written to the folder “" + basename(DIR) + "”.\n"
    + "To see it in TabTree: My maps → 🛟 → “Bring maps back from this folder…”. "
    + "(Or press ⌘K and type “bring my maps back”.) Nothing is overwritten.\n"
    + "If “" + basename(DIR) + "” is not the folder TabTree names next to its 🛟 button, "
    + "the connector is pointed at a different library — that is why a map can be created and never appear.";
}

// ---------------------------------------------------------------------------
// Définition des outils
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "list_maps",
    description: "Lists every mind map and board in the TabTree library (name, type, folder, size, last modified).",
    inputSchema: { type:"object", properties:{}, additionalProperties:false }
  },
  {
    name: "read_map",
    description: "Reads one TabTree map. A mind map comes back as a markdown outline; a board as a list of elements and connections. `file` is a file name (or a map name) returned by list_maps.",
    inputSchema: { type:"object", properties:{ file:{ type:"string", description:"The .tabtree file name (or the map name)" } }, required:["file"], additionalProperties:false }
  },
  {
    name: "search_maps",
    description: "Searches text across the whole TabTree library — map names, nodes, notes, shapes, sticky notes. Case-insensitive.",
    inputSchema: { type:"object", properties:{ query:{ type:"string", description:"Text to search for" } }, required:["query"], additionalProperties:false }
  },
  {
    name: "create_mindmap",
    description: "Creates a NEW TabTree mind map from a markdown outline (#/## headings, bullet lists indented by 2 spaces, [x]/[ ] checkboxes, [title](url) links, and \" @a:<id>\" / \" @e:<emoji>\" at the end of a line for an illustration). The first top-level line becomes the centre. Writes a .tabtree file into the backup folder; the user pulls it into the app from the 🛟 menu.",
    inputSchema: { type:"object", properties:{
      name:{ type:"string", description:"Name of the map" },
      markdown:{ type:"string", description:"Markdown outline (headings and/or bullet list). End any line with \" @a:<id>\" to give that node a built-in illustration, or \" @e:<emoji>\" for one large emoji — e.g. \"Launch @a:rocket\". Ids: person, team, chat, idea, target, trophy, star, heart, warning, done, flag, clock, laptop, phone, mail, folder, book, chart, money, calendar, building, car, globe, rocket, house, pin, plane, coffee, plant, sun, camera, music, lock, key, health, gift. An unknown id is left as plain text rather than dropped." },
      folder:{ type:"string", description:"Optional TabTree subfolder (e.g. \"From Claude\")" },
      style:{ type:"object", description:"Optional look of the document. Omit it for the default.", properties:{
        font:{ type:"string", enum:["","grotesk","humanist","condensed","rounded","serif","garamond","didone","slab","typewriter","mono","hand"], description:"Type family: grotesk (corporate), humanist (warm), condensed (dense), rounded (friendly), serif/garamond (editorial), didone (elegant), slab (sturdy), typewriter, mono (technical), hand (handwritten)." },
        shape:{ type:"string", enum:["","line","plain"], description:"Node shape: cards (default), line = underlined, plain = plain text." },
        background:{ type:"string", enum:["","plain","grid","graph","lines","iso","paper","cream","kraft","aged","mist","sage","dawn","blue","slate","chalk"], description:"Page background: dots (default), plain, grid, graph paper, ruled lines, isometric, paper, cream, kraft, aged, mist, sage, dawn, blueprint, slate (dark), chalkboard (dark)." },
        palette:{ type:"string", enum:["","ocean","sunset","forest","berry","nordic","earth","vintage","candy","muted"], description:"Branch colour palette (mind maps only): classic (default), ocean (cool blues), sunset (warm), forest (greens), berry (purples), nordic (calm cool), earth (terracotta and olive), vintage (faded warm), candy (bright and playful), muted (subdued, client-ready)." },
        skin:{ type:"string", enum:["","soft","flat","paper","ink","draft","sticker","brutal","arcade"], description:"Structural skin — borders, shadows, corners: classic (default), soft (borderless, rounded, cushioned), flat (no shadows at all — for print and projection), paper (journal, soft warm shadows), ink (fine ink outline, no shadow), draft (square corners, dashed links — technical sketch), sticker (white cut-out ring, drop shadow — made to be posted), brutal (thick ink borders, hard offset shadows — the poster look), arcade (square corners, hard short shadows). Travels with the map and into exported images." },
        icons:{ type:"string", enum:["","chip","big"], description:"How node icons are drawn: plain (default — a 20px line drawing), chip (the same drawing on a pill tinted with the branch colour), big (a 30px drawing on a larger pill). Only affects nodes that carry an icon. Travels with the map and into exported images." }
      }, additionalProperties:false }
    }, required:["name","markdown"], additionalProperties:false }
  },
  {
    name: "create_board",
    description: "Creates a NEW TabTree board (whiteboard): shapes (rect, ellipse, diamond, text, sticky) and arrow connections that stay anchored to the shapes in the app. With no x/y coordinates, layout is automatic by level (the connections define the hierarchy, left to right). Good for a diagram, a flow, a brainstorm. In a flowchart use ellipse for start/end, rect for a step, and diamond for a decision — its text should read as a closed question with exactly two ways out.\n\nFIT THE TEXT TO THE BOX. A box shows roughly (w−24)/7 characters per line and (h−10)/20 lines, and every blank line costs a full line. Write captions, not paragraphs: when filling a canvas template (Business Model Canvas, Lean Canvas, SWOT…), the shipped templates use 70–110 characters per block, and that is what looks composed. Longer text is shrunk to fit — nothing ever spills out — but past ~11px it stops being readable and the response will warn you.",
    inputSchema: { type:"object", properties:{
      name:{ type:"string", description:"Name of the board" },
      elements:{ type:"array", description:"Board elements", items:{ type:"object", properties:{
        id:{ type:"string", description:"Logical id used by connections (defaults to the index)" },
        kind:{ type:"string", enum:["rect","ellipse","diamond","trap","chev","arc","text","sticky"], description:"Type (defaults to rect). diamond = a decision in a flowchart, trap = a pyramid/funnel tier (tk = small-side ratio, negative when the base is the narrow side), chev = a process step pointing forward, arc = a pie slice (a0/a1 in degrees from 12 o'clock, ir = inner-radius fraction for a donut)." },
        text:{ type:"string" },
        x:{ type:"number" }, y:{ type:"number" }, w:{ type:"number" }, h:{ type:"number" },
        color:{ type:"string", description:"Hex fill colour (shapes) or sticky-note colour" },
        size:{ type:"number", description:"Text size 9-72 (defaults to 15)" },
        tk:{ type:"number", description:"trap only — small-side/large-side ratio, 0..0.95 (0 = triangle); NEGATIVE puts the narrow side at the bottom (funnel tier)" },
        a0:{ type:"number", description:"arc only — start angle in degrees, 0 at 12 o'clock, clockwise" },
        a1:{ type:"number", description:"arc only — end angle in degrees (a1 > a0; a full circle is a0=0, a1=360)" },
        ir:{ type:"number", description:"arc only — inner-radius fraction 0..0.9 (0 = pie slice, 0.55 = donut)" }
      }, required:["text"], additionalProperties:false } },
      connections:{ type:"array", description:"Arrows anchored between elements (by id)", items:{ type:"object", properties:{
        from:{ type:"string" }, to:{ type:"string" }
      }, required:["from","to"], additionalProperties:false } },
      folder:{ type:"string", description:"Optional TabTree subfolder" },
      style:{ type:"object", description:"Optional look of the document. Omit it for the default.", properties:{
        font:{ type:"string", enum:["","grotesk","humanist","condensed","rounded","serif","garamond","didone","slab","typewriter","mono","hand"], description:"Type family: grotesk (corporate), humanist (warm), condensed (dense), rounded (friendly), serif/garamond (editorial), didone (elegant), slab (sturdy), typewriter, mono (technical), hand (handwritten)." },
        shape:{ type:"string", enum:["","line","plain"], description:"Node shape: cards (default), line = underlined, plain = plain text." },
        background:{ type:"string", enum:["","plain","grid","graph","lines","iso","paper","cream","kraft","aged","mist","sage","dawn","blue","slate","chalk"], description:"Page background: dots (default), plain, grid, graph paper, ruled lines, isometric, paper, cream, kraft, aged, mist, sage, dawn, blueprint, slate (dark), chalkboard (dark)." },
        skin:{ type:"string", enum:["","soft","flat","paper","ink","draft","sticker","brutal","arcade"], description:"Structural skin — borders, shadows, corners: classic (default), soft (borderless, rounded), flat (no shadows — for print), paper (soft warm shadows), ink (fine ink outline), draft (square corners, technical), sticker (white cut-out ring), brutal (thick ink borders, hard shadows), arcade (square, hard short shadows). Travels with the board and into exported images." }
        // Pas d'`icons` ici, et c'est délibéré : un board n'a pas de nœuds, donc aucune forme
        // ne porte de pictogramme. Le déclarer promettrait un réglage sans effet — même règle
        // que la rangée du menu ✒️ Style, gardée par `!boardMode`.
      }, additionalProperties:false }
    }, required:["name","elements"], additionalProperties:false }
  },
  {
    name: "propose_changes",
    description: "Proposes changes to an EXISTING mind map: add branches, rename a node, write a note, tick a task, remove a branch, illustrate a node. Nothing is applied — the proposal appears in TabTree as a banner on that map, the user reviews it change by change and picks what to keep (and can undo with Cmd+Z afterwards). Name each target node by its exact text, or by a path \"Ancestor > Node\" when the same wording appears twice. Read the map first so the wording matches.",
    inputSchema: { type:"object", properties:{
      file:{ type:"string", description:"The map to change — a file name (or map name) from list_maps" },
      note:{ type:"string", description:"One line telling the user what this proposal does and why. Shown above the changes." },
      changes:{ type:"array", description:"The proposed changes, applied in order", items:{ type:"object", properties:{
        op:{ type:"string", enum:["add","rename","note","check","delete","move","pic"], description:"add = new children under `target`; rename = change its text; note = set its note; check = tick/untick the task; delete = remove it and its children; move = send the card to a kanban column; pic = put an illustration on it" },
        target:{ type:"string", description:"Exact node text, or \"Ancestor > Node\" if ambiguous" },
        markdown:{ type:"string", description:"add: the new branch as a bullet list, 2 spaces per level" },
        text:{ type:"string", description:"rename: the new text" },
        note:{ type:"string", description:"note: the note body (empty string clears it)" },
        value:{ type:"boolean", description:"check: true to tick, false to untick" },
        col:{ type:"string", description:"move: the kanban column id (read_map shows them), or \"\" to take the card off the board" },
        pic:{ type:"string", description:"pic: \"a:<id>\" for a built-in illustration, or \"e:<emoji>\" for one large emoji, or \"\" to remove it. Ids: person, team, chat, idea, target, trophy, star, heart, warning, done, flag, clock, laptop, phone, mail, folder, book, chart, money, calendar, building, car, globe, rocket, house, pin, plane, coffee, plant, sun, camera, music, lock, key, health, gift." }
      }, required:["op","target"], additionalProperties:false } }
    }, required:["file","changes"], additionalProperties:false }
  }
];

const HANDLERS = {
  list_maps(){
    const maps = scanLibrary();
    if(!maps.length) return "The library is empty (or TABTREE_DIR points at the wrong folder: " + DIR + ").";
    return maps.map(m=>
      `• ${m.name}  [${m.kind}]${m.folder ? "  📁 " + m.folder : ""}\n  file: ${m.file}\n  ${m.kind==="board" ? m.elements + " elements" : m.nodes + " nodes"} · modified ${m.mtime}`
    ).join("\n");
  },
  read_map(args){
    const m = findMap(args.file);
    const head = `${m.name} [${m.kind}] — file: ${m.file}\n`;
    if(m.kind === "board") return head + boardToText(m.doc);
    // Le rappel sur propose_changes vit ici et pas dans la description de l'outil : c'est au
    // moment où le plan est sous les yeux qu'il est utile, et il porte la règle de désignation.
    return head + nodeToMarkdown(m.doc.root, 0)
      + "\n\n(To change this map, use propose_changes with `file: \"" + m.file + "\"`. Name a node by the exact text above, or \"Ancestor > Node\" when it appears twice. Nothing is applied until the user approves it in TabTree.)";
  },
  search_maps(args){
    const q = String(args.query||"").toLowerCase();
    if(!q) throw new Error("`query` is empty.");
    const hits = [];
    for(const m of scanLibrary()){
      const found = [];
      if(m.name.toLowerCase().includes(q)) found.push("(map name)");
      for(const t of collectTexts(m.doc)){
        if(t.toLowerCase().includes(q)) found.push(t.slice(0,100));
        if(found.length >= 5) break;
      }
      if(found.length) hits.push(`• ${m.name} [${m.kind}] — file: ${m.file}\n  ${found.join("\n  ")}`);
    }
    return hits.length ? hits.join("\n") : "Nothing found for \"" + args.query + "\".";
  },
  create_mindmap(args){
    // Sans cette garde, un appel où « markdown » manque donnait String(undefined) =
    // la chaîne "undefined" : une carte à un seul nœud, écrite sur le disque sans erreur.
    if(typeof args.markdown !== "string" || !args.markdown.trim())
      throw new Error("The `markdown` parameter is required (an indented outline, or # headings).");
    const roots = buildForest(parseOutline(args.markdown));
    if(!roots.length) throw new Error("`markdown` is empty or has no usable structure (# headings or a bullet list).");
    let root;
    if(roots.length === 1){ root = roots[0]; }
    else { root = makeNode(args.name || "Map"); root.children = roots; }
    root.color = "#dbeafe";
    // Le marqueur d'illustration, retiré ICI et jamais dans parseOutline() — ce parseur est
    // comparé caractère par caractère avec celui de l'app, et lui ajouter une syntaxe le ferait
    // diverger en silence. Même partage des rôles que côté modèles.
    tplPicAssign(root);
    const doc = { v:1, root, images:[], stickies:[] };
    const st = okStyleMcp(args.style);
    if(st) doc.style = st;
    const file = writeDoc(args.name || root.text, doc, args.folder);
    return `✅ Map created (${countNodes(root)} nodes): ${file}\n${importHint()}`;
  },
  create_board(args){
    const { doc, warnings } = buildBoardDoc(args.name || "Board", args.elements, args.connections, args.style);
    const file = writeDoc(args.name || "Board", doc, args.folder);
    const n = doc.shapes.length + doc.stickies.length;
    // Les avertissements passent AVANT l'astuce d'import : c'est le seul moment où le texte
    // peut encore être raccourci, et une ligne noyée en fin de réponse ne se lit pas.
    const warn = warnings.length
      ? `\n⚠️  ${warnings.length} element(s) hold more text than their box shows at full size:\n`
        + warnings.map(w=>"   • " + w).join("\n")
        + `\n   Nothing spills out — the text was shrunk to fit — but blocks at different sizes look\n`
        + `   uneven on a canvas. Recreate the board with shorter text to keep it clean.\n`
      : "";
    return `✅ Board created (${n} elements, ${doc.arrows.length} connection(s)): ${file}\n${warn}${importHint()}`;
  },
  propose_changes(args){
    const m = findMap(args.file);
    if(m.kind === "board")
      throw new Error("Proposals only apply to mind maps. A board has free positions and drawings, which a change list cannot describe.");
    const ops = buildProposalOps(m.doc, args.changes);
    const file = writeProposal(m, args.note, ops);
    const adds = ops.reduce((n,o)=>n + (o.adds||0), 0);
    const drops = ops.reduce((n,o)=>n + (o.drops||0), 0);
    return `📮 Proposal filed for “${m.name}” — ${ops.length} change(s)`
      + (adds ? `, ${adds} node(s) to add` : "")
      + (drops ? `, ${drops} node(s) to remove` : "")
      + `: ${file}\n`
      + "NOTHING has been changed yet. The map file is untouched.\n"
      + "TabTree shows a banner on that map within a few seconds (the backup folder must be connected, and the app open). "
      + "The user ticks the changes they want, applies them, and Cmd+Z undoes the lot.\n"
      + "Tell the user to look at TabTree — do not claim the map has been updated.";
  }
};

// ---------------------------------------------------------------------------
// Boucle JSON-RPC (stdio, un message par ligne)
// ---------------------------------------------------------------------------
function send(obj){ process.stdout.write(JSON.stringify(obj) + "\n"); }
function reply(id, result){ send({ jsonrpc:"2.0", id, result }); }
function replyErr(id, code, message){ send({ jsonrpc:"2.0", id, error:{ code, message } }); }

function handle(msg){
  const { id, method, params } = msg;
  if(method === "initialize"){
    reply(id, {
      protocolVersion: (params && params.protocolVersion) || "2024-11-05",
      capabilities: { tools: {} },
      // Cette version vit dans QUATRE fichiers — ici, mcpb/manifest.json,
      // mcp/package.json (npm) et mcp/server.json (registre MCP). Elle avait
      // déjà dérivé (1.0.0 ici, 1.1.0 dans le manifeste) sans que rien ne le
      // signale : un client affiche l'une, le registre publie l'autre. Un
      // autotest les compare désormais toutes les quatre.
      serverInfo: { name: "tabtree", version: "1.1.0" }
    });
  } else if(method === "notifications/initialized" || (method||"").startsWith("notifications/")){
    // notification : pas de réponse
  } else if(method === "ping"){
    reply(id, {});
  } else if(method === "tools/list"){
    reply(id, { tools: TOOLS });
  } else if(method === "tools/call"){
    const name = params && params.name;
    const fn = HANDLERS[name];
    if(!fn){ replyErr(id, -32602, "Outil inconnu : " + name); return; }
    try{
      const text = fn((params && params.arguments) || {});
      reply(id, { content: [{ type:"text", text }] });
    }catch(e){
      reply(id, { content: [{ type:"text", text: "Erreur : " + (e && e.message || e) }], isError: true });
    }
  } else if(id !== undefined){
    replyErr(id, -32601, "Méthode non supportée : " + method);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk=>{
  buf += chunk;
  let i;
  while((i = buf.indexOf("\n")) >= 0){
    const line = buf.slice(0, i); buf = buf.slice(i+1);
    if(!line.trim()) continue;
    try{ handle(JSON.parse(line)); }
    catch(e){ replyErr(null, -32700, "JSON invalide"); }
  }
});
process.stdin.on("end", ()=>process.exit(0));
