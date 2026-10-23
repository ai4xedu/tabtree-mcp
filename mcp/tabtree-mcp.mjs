#!/usr/bin/env node
// ============================================================================
// TabTree MCP — serveur local, zéro dépendance (Model Context Protocol, stdio)
//
// Rôle : permettre à Claude (Claude Code, Claude Desktop…) de LIRE la
// bibliothèque TabTree et de CRÉER des cartes mentales et des boards,
// sans passer par l'interface — génération depuis une conversation,
// un document, un plan…
//
// Où (1.5.0, 2026-10-20) : le COMPTE TabTree. TabTree est 100 % en ligne depuis le 2026-10-20
// (Zemind seule source, la licence Classic arrêtée) : la source normale est la clé personnelle
// `TABTREE_API_KEY` et l'edge function `mcp` (supabase/functions/mcp), qui voit la bibliothèque
// du compte ET les espaces d'équipe dont il est membre (migration 0033).
//
// Le DOSSIER 🛟 (TABTREE_DIR, ancien nom YGMIND_DIR) reste lu par compatibilité : les acheteurs
// Classic ont des connecteurs installés qui le pointent, et la fin de Classic n'est pas encore
// annoncée côté ventes. Il n'est plus documenté que comme ancien mode — ne pas y ajouter de
// fonction : tout ce qui est nouveau (espaces, application sans clic) n'existe qu'en compte.
//
// Ce fichier vit dans le dépôt Zemind depuis la 1.5.0 (mcp/) — il était dans le moteur figé, et
// son test de dérive comparait au moteur, plus à ce qui est en ligne. Il compare app/index.html.
// Protocole : JSON-RPC 2.0, un message JSON par ligne sur stdin/stdout.
// ============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { inflateSync, deflateSync } from "node:zlib";
import { tmpdir, platform } from "node:os";

// ⚠️ LE GABARIT NON RÉSOLU vaut « vide », pour le dossier comme pour la clé (2026-10-20). Claude
// Desktop passe `${user_config.backup_folder}` TEL QUEL quand le champ (ancien, Classic) est vide :
// pris pour un chemin, il produisait « The TABTREE_DIR folder does not exist: ${user_config…} » —
// un message sur un dossier que l'utilisateur n'a jamais choisi, qui cachait la vraie cause (la clé).
const DIR_RAW = process.env.TABTREE_DIR || process.env.YGMIND_DIR || "";
const DIR = /^\$\{.*\}$/.test(String(DIR_RAW).trim()) ? "" : DIR_RAW;
// ---------------------------------------------------------------------------
// DEUX SOURCES, UN CONNECTEUR (2026-09-08). Le dossier 🛟 sert TabTree Classic (le fichier
// local) ; le CLOUD sert l'abonné TabTree SaaS. La source est choisie par la présence d'une
// clé personnelle `TABTREE_API_KEY` (fabriquée dans ⚙️ Account → Claude connector) : les six
// outils ne changent pas d'un mot de contrat, seule la tuyauterie de lecture/écriture change.
// `TABTREE_API_URL` n'est là que pour une préversion — la valeur par défaut est la production.
// ---------------------------------------------------------------------------
let API_KEY = String(process.env.TABTREE_API_KEY || "").trim();
// ⚠️ UN CHAMP NON RENSEIGNÉ N'EST PAS UNE CLÉ FAUSSE (2026-09-09). Claude Desktop passe le
// gabarit `${user_config.api_key}` TEL QUEL quand le champ est vide — mesuré le jour où la
// réinstallation du .mcpb a vidé la configuration (la clé est `sensitive`, donc rangée dans le
// Trousseau et liée à l'installation précédente). `CLOUD = !!API_KEY` prenait ce littéral pour
// une clé, l'envoyait, et le serveur répondait « Unknown or revoked connector key » : un
// message FAUX, qui envoie chercher une clé révoquée là où il n'y a simplement rien de saisi.
// Mesuré de nouveau le 2026-10-20 (mise à jour 1.3.0 → 1.5.0 par la page /connector) : la clé
// était bien enregistrée — chiffrée, liée à l'installation précédente — et c'est le gabarit qui
// est arrivé. On s'en souvient pour DIRE la cause au lieu de « aucune source ».
const KEY_UNSENT = /^\$\{.*\}$/.test(API_KEY);
if(KEY_UNSENT) API_KEY = "";
const API_URL = String(process.env.TABTREE_API_URL || "https://aynmiptyvisxoslzkzxn.supabase.co/functions/v1/mcp").trim();
const CLOUD = !!API_KEY;
// La FORME d'une clé se vérifie ici, avant tout aller-retour : l'app en fabrique une en
// `tt_live_` + 43 caractères base64url (`connKeyMaterial`). Une valeur qui n'y ressemble pas est
// une faute de copie ou un champ mal rempli — le dire tout de suite nomme la bonne cause, et
// évite d'aller faire dire au serveur quelque chose qu'il ne sait pas.
const API_KEY_OK = /^tt_live_[A-Za-z0-9_-]{20,}$/.test(API_KEY);
async function cloudCall(action, body){
  if(!API_KEY_OK) throw new Error(
    "TABTREE_API_KEY does not look like a connector key — it must start with \"tt_live_\". "
  + "If you just reinstalled the connector, its settings were reset: open TabTree → \u2699\ufe0f Settings "
  + "\u2192 Account \u2192 Claude connector, create a key, paste it into the connector's settings, "
  + "then restart the connector.");
  let r;
  try{
    r = await fetch(API_URL, { method:"POST",
      headers:{ "content-type":"application/json", "x-tabtree-key": API_KEY },
      // `v: 2` : le contrat 1.5.0 (espaces d'équipe, propriétaire de chaque carte, pagination).
      // Une edge function plus ancienne l'ignore ; une plus récente sert les 1.2–1.4 sans `v` à l'identique.
      body: JSON.stringify(Object.assign({ action, v: 2 }, body || {})) });
  }catch(e){ throw new Error("Could not reach the TabTree cloud (" + (e && e.message || e) + ")."); }
  let j = null; try{ j = await r.json(); }catch(e){}
  if(!r.ok || !j || j.ok === false) throw new Error((j && j.error) || ("The TabTree cloud answered HTTP " + r.status + "."));
  return j;
}
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
  if(CLOUD) return;   // la source est le compte, pas un dossier
  if(!DIR && KEY_UNSENT) throw new Error("Claude Desktop did not pass your TabTree connector key to the connector. This happens after the extension is updated or reinstalled: the key saved in its settings belongs to the previous install. Open Claude Desktop → Settings → Extensions → TabTree, paste your key again (create one in TabTree → Settings → Account → Claude connector if you need to), then quit Claude Desktop completely and reopen it.");
  if(!DIR) throw new Error("The connector has no source. For TabTree (subscription), set TABTREE_API_KEY to the connector key from ⚙️ Settings → Account → Claude connector. For TabTree Classic (the local file), set TABTREE_DIR to your 🛟 backup folder. (The older name YGMIND_DIR still works.)");
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
  "camera", "music", "lock", "key", "health", "gift",
  "manager", "client", "expert", "assistant", "coach", "learner",
  "developer", "seller", "support", "speaker", "freelancer", "group",
  "uilogin", "uifeed", "uichat", "uidash", "uichart", "uishop",
  "uimap", "uivideo", "uislide", "uiprofile", "uiboard", "uitable",
  "atom", "dna", "flask", "microscope", "brain", "planet",
  "pencil", "gradcap", "calc", "palette", "ruler", "backpack"
];
const ART = Object.fromEntries(ART_IDS_MCP.map(id=>[id, true]));
// ≡ `artHas` d'app/index.html : seule une propriété PROPRE compte. `ART["toString"]` est une
// fonction héritée, vraie au test de vérité — « a:toString » passait `okPic` ici alors que l'app
// le refusait déjà (dérive attrapée le 2026-10-20 en comparant enfin au fichier EN LIGNE).
const artHas = id => typeof id === "string" && Object.prototype.hasOwnProperty.call(ART, id);
  const EMO_PIC_PAT = "\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?)*";
  const PIC_EMO_RE = (()=>{
    try{ return new RegExp("^(?:" + EMO_PIC_PAT + ")$", "u"); }
    // Repli du côté SÛR : un navigateur sans échappement de propriété refuse l'emoji plutôt
    // que d'accepter n'importe quoi. On perd un ornement, jamais la carte.
    catch(e){ return /^(?:[‼-㊙\uD800-\uDBFF][\uDC00-\uDFFF]?[️︎]?[‍]?)+$/; }
  })();
function okPic(v){
    if(typeof v !== "string" || !v || v.length > PIC_MAX) return "";
    if(v.startsWith("a:")) return artHas(v.slice(2)) ? v : "";
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
// Une CAPTURE D'ÉCRAN sur un nœud (`node.img`, 2026-09-15)
//
// Demande de l'utilisateur : « générer une mindmap avec des screenshots tirés d'une app ».
// Le champ existait de bout en bout — `node.img` est la COUVERTURE d'un nœud, tenue dans les
// cinq places, peinte sur le canevas, dans l'export et sur le recto kanban. Ce qui manquait,
// c'est la PORTE : le connecteur ne savait poser qu'une désignation (`pic`), jamais des pixels.
//
// Deux contraintes décident de tout ce qui suit :
//  1. `okCover` (index.html) n'accepte qu'un `data:image/(png|jpeg|webp|gif)` de moins de
//     COVER_MAX_BYTES caractères. Une capture d'écran Retina fait 2 à 5 Mo : embarquée telle
//     quelle, l'app la REFUSE à l'ouverture et le nœud arrive nu — sans une erreur. Il faut donc
//     ré-encoder ICI, avant d'écrire. La constante et la fonction sont portées MOT POUR MOT et le
//     test les compare à l'app : si elles divergent, le connecteur écrit une image que l'app
//     efface, et personne ne sait pourquoi.
//  2. Le connecteur est ZÉRO dépendance et Node n'a aucun codec d'image. Trois encodeurs, dans
//     l'ordre : `sips` (livré avec macOS), `magick`/`convert` (ImageMagick, s'il est là), et un
//     chemin PUR JS — décodeur PNG (zlib est natif), réduction par moyenne de zone, encodeur PNG.
//     Le chemin JS ne lit que du PNG, ce qui est le format de TOUTES les captures que Claude
//     produit (navigateur, computer-use, simulateur). Quand rien ne tient dans le budget, on
//     REFUSE en nommant la limite — jamais une image tronquée, jamais un nœud silencieusement nu.
//
// Le côté long est ré-encodé à IMG_LONG = 840 px, soit 2 × COVER_MAX_DIM : l'app affiche une
// couverture à 420 px au plus, et 840 la garde nette sur un écran Retina. Au-delà on stockerait
// des pixels que personne ne voit. Le budget par image (IMG_BUDGET) est bien plus bas que
// COVER_MAX_BYTES, et c'est délibéré : vingt captures à 900 Ko feraient un document de 18 Mo, lu
// SYNCHRONIQUEMENT depuis le miroir localStorage de l'app. À 840 px en JPEG, une capture pèse
// 80 à 200 Ko ; en PNG (chemin JS) 150 à 400 Ko — d'où les trois paliers de repli.
// ---------------------------------------------------------------------------
const COVER_MAX_BYTES = 900000; // ~900 Ko de data URL : au-delà, on refuse
function okCover(v){
    return (typeof v === "string" && v.length <= COVER_MAX_BYTES
      && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) ? v : "";
  }
const IMG_LONG = 840;                     // côté long visé (2 × COVER_MAX_DIM de l'app)
const IMG_STEPS = [840, 600, 420];        // paliers de repli quand le budget ne tient pas
const IMG_BUDGET = 320000;                // data URL par image — bien sous COVER_MAX_BYTES, voir ci-dessus
const IMG_FILE_MAX = 40 * 1024 * 1024;    // un fichier plus gros n'est pas une capture d'écran
const IMG_JPEG_Q = 82;
const IMG_MIMES = { png:"image/png", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif" };

// Sonde les octets, jamais l'extension : un « .png » qui contient du JPEG s'ouvre partout, et
// c'est l'octet qui décide de ce que l'app saura décoder.
function imageInfo(buf){
  if(!buf || buf.length < 12) return null;
  if(buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG" && buf.length >= 24)
    return { kind:"png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if(buf[0] === 0xFF && buf[1] === 0xD8){
    let i = 2;
    while(i + 9 < buf.length){
      if(buf[i] !== 0xFF){ i++; continue; }
      const m = buf[i + 1];
      if(m === 0xFF){ i++; continue; }
      if(m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
        return { kind:"jpeg", h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      if(m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01){ i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { kind:"jpeg", w:0, h:0 };
  }
  if(buf.toString("latin1", 0, 4) === "GIF8")
    return { kind:"gif", w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if(buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP" && buf.length >= 30){
    const c = buf.toString("latin1", 12, 16);
    if(c === "VP8 ") return { kind:"webp", w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if(c === "VP8L"){ const b = buf.subarray(21, 25); return { kind:"webp", w: 1 + (((b[1] & 0x3F) << 8) | b[0]), h: 1 + (((b[3] & 0xF) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6)) }; }
    if(c === "VP8X") return { kind:"webp", w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    return { kind:"webp", w:0, h:0 };
  }
  return null;
}
function dataUrlOf(buf, kind){ return "data:" + IMG_MIMES[kind] + ";base64," + buf.toString("base64"); }

// --- Le chemin PUR JS : PNG → RGB, réduction, → PNG ------------------------------------
// 8 bits, non entrelacé, types 0/2/3/4/6 : c'est ce qu'écrivent Chrome, macOS et Windows pour
// une capture. Le reste (16 bits, entrelacé) est refusé en le disant. L'alpha est composité
// sur du BLANC — même règle qu'`avatarFromFile` dans l'app : une capture transparente sortirait
// noire dans un JPEG, et grise dans l'export.
function pngDecode(buf){
  let i = 8, w = 0, h = 0, depth = 0, ct = 0, inter = 0, plte = null;
  const idat = [];
  while(i + 8 <= buf.length){
    const len = buf.readUInt32BE(i), type = buf.toString("latin1", i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if(type === "IHDR"){ w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ct = data[9]; inter = data[12]; }
    else if(type === "PLTE") plte = data;
    else if(type === "IDAT") idat.push(data);
    else if(type === "IEND") break;
    i += 12 + len;
  }
  if(!w || !h) throw new Error("the PNG has no IHDR");
  if(depth !== 8) throw new Error("a " + depth + "-bit PNG — only 8-bit PNGs can be re-encoded here");
  if(inter) throw new Error("an interlaced PNG cannot be re-encoded here");
  const ch = { 0:1, 2:3, 3:1, 4:2, 6:4 }[ct];
  if(!ch || (ct === 3 && !plte)) throw new Error("unsupported PNG colour type " + ct);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, rgb = new Uint8Array(w * h * 3);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride), p = 0;
  for(let y = 0; y < h; y++){
    const f = raw[p++];
    for(let x = 0; x < stride; x++){
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = raw[p++];
      if(f === 1) v += a; else if(f === 2) v += b; else if(f === 3) v += (a + b) >> 1;
      else if(f === 4){ const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 255;
    }
    for(let x = 0; x < w; x++){
      const q = x * ch; let r, g, bl, al = 255;
      if(ct === 0){ r = g = bl = cur[q]; }
      else if(ct === 4){ r = g = bl = cur[q]; al = cur[q + 1]; }
      else if(ct === 2){ r = cur[q]; g = cur[q + 1]; bl = cur[q + 2]; }
      else if(ct === 6){ r = cur[q]; g = cur[q + 1]; bl = cur[q + 2]; al = cur[q + 3]; }
      else { const k = cur[q] * 3; r = plte[k]; g = plte[k + 1]; bl = plte[k + 2]; }
      if(al < 255){ r = (r * al + 255 * (255 - al)) / 255 | 0; g = (g * al + 255 * (255 - al)) / 255 | 0; bl = (bl * al + 255 * (255 - al)) / 255 | 0; }
      const o = (y * w + x) * 3; rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = bl;
    }
    const t = prev; prev = cur; cur = t;
  }
  return { w, h, rgb };
}
// Moyenne de zone : chaque pixel de sortie est la moyenne du rectangle source qu'il couvre.
// C'est ce qui garde lisible le texte d'une capture réduite d'un facteur 3 — un simple
// sous-échantillonnage saute des lignes de texte entières.
function rgbScale(src, W, H){
  const { w, h, rgb } = src, out = new Uint8Array(W * H * 3);
  for(let Y = 0; Y < H; Y++){
    const y0 = Math.floor(Y * h / H), y1 = Math.max(y0 + 1, Math.floor((Y + 1) * h / H));
    for(let X = 0; X < W; X++){
      const x0 = Math.floor(X * w / W), x1 = Math.max(x0 + 1, Math.floor((X + 1) * w / W));
      let r = 0, g = 0, b = 0, n = 0;
      for(let y = y0; y < y1; y++){ let o = (y * w + x0) * 3; for(let x = x0; x < x1; x++){ r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2]; o += 3; n++; } }
      const q = (Y * W + X) * 3; out[q] = r / n | 0; out[q + 1] = g / n | 0; out[q + 2] = b / n | 0;
    }
  }
  return { w: W, h: H, rgb: out };
}
const CRC_T = (()=>{ const t = new Int32Array(256); for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(buf){ let c = -1; for(let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function pngEncode(img){
  const { w, h, rgb } = img;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for(let y = 0; y < h; y++){ raw[y * (w * 3 + 1)] = 0; raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const chunk = (type, data)=>{
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// --- Les encodeurs, et l'ordre dans lequel on les essaie ---------------------------------
// `TABTREE_IMG_ENCODER` force un chemin (js | sips | magick) — c'est ce qui permet au test
// d'exercer le chemin pur JS sur une machine qui a `sips`, et à qui veut un rendu identique
// sur toutes ses machines de le demander.
function encoders(){
  const want = String(process.env.TABTREE_IMG_ENCODER || "").trim();
  if(want) return [want];
  return platform() === "darwin" ? ["sips", "magick", "js"] : ["magick", "js"];
}
function withTmpFiles(fn){
  const dir = mkdtempSync(join(tmpdir(), "tabtree-img-"));
  try{ return fn(dir); }
  finally{ try{ rmSync(dir, { recursive:true, force:true }); }catch(e){} }
}
// Rend { buf, kind, w, h } ou lève. `long` = côté long visé.
function encodeWith(name, buf, info, long){
  if(name === "js"){
    if(info.kind !== "png") throw new Error("the built-in encoder only reads PNG");
    const src = pngDecode(buf);
    const k = Math.min(1, long / Math.max(src.w, src.h));
    const W = Math.max(1, Math.round(src.w * k)), H = Math.max(1, Math.round(src.h * k));
    const out = pngEncode(k < 1 ? rgbScale(src, W, H) : src);
    return { buf: out, kind:"png", w: W, h: H };
  }
  return withTmpFiles(dir=>{
    const inp = join(dir, "in." + (info.kind === "jpeg" ? "jpg" : info.kind)), outp = join(dir, "out.jpg");
    writeFileSync(inp, buf);
    if(name === "sips"){
      execFileSync("sips", ["-Z", String(long), "-s", "format", "jpeg", "-s", "formatOptions", String(IMG_JPEG_Q), inp, "--out", outp], { stdio:"ignore", timeout: 20000 });
    } else if(name === "magick"){
      const bin = ["magick", "convert"];
      let ok = false, last = null;
      for(const b of bin){
        try{ execFileSync(b, [inp, "-resize", long + "x" + long + ">", "-quality", String(IMG_JPEG_Q), outp], { stdio:"ignore", timeout: 20000 }); ok = true; break; }
        catch(e){ last = e; }
      }
      if(!ok) throw last || new Error("ImageMagick is not installed");
    } else throw new Error("unknown encoder " + name);
    const out = readFileSync(outp), oi = imageInfo(out);
    if(!oi || oi.kind !== "jpeg") throw new Error(name + " produced no JPEG");
    return { buf: out, kind:"jpeg", w: oi.w, h: oi.h };
  });
}

// --- La porte : un fichier ou une data URL → une couverture que l'app acceptera ---------
// Rend { img, note } — `note` dit ce qui a été fait, pour la réponse : une image ré-encodée
// à l'insu de Claude serait une capture qu'il croit envoyer en pleine résolution.
function readImageSpec(spec, where){
  if(!spec || typeof spec !== "object") throw new Error(`${where}: give \`file\` (a path on this machine) or \`data\` (a data:image/… URL).`);
  if(typeof spec.data === "string" && spec.data){
    const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/.exec(spec.data.trim());
    if(!m) throw new Error(`${where}: \`data\` must be a data:image/(png|jpeg|webp|gif);base64,… URL.`);
    return { buf: Buffer.from(m[2].replace(/\s+/g, ""), "base64"), label: "inline image" };
  }
  if(typeof spec.file === "string" && spec.file.trim()){
    const p = resolve(spec.file.trim());
    if(!existsSync(p)) throw new Error(`${where}: no file at ${p}. Save the screenshot to disk first (a PNG), then pass its full path.`);
    const st = statSync(p);
    if(!st.isFile()) throw new Error(`${where}: ${p} is not a file.`);
    if(st.size > IMG_FILE_MAX) throw new Error(`${where}: ${basename(p)} is ${(st.size / 1048576).toFixed(0)} MB — too large for a screenshot (40 MB max).`);
    return { buf: readFileSync(p), label: basename(p) };
  }
  throw new Error(`${where}: give \`file\` (a path on this machine) or \`data\` (a data:image/… URL).`);
}
function coverFrom(spec, where){
  const { buf, label } = readImageSpec(spec, where);
  const info = imageInfo(buf);
  if(!info) throw new Error(`${where}: ${label} is not a PNG, JPEG, WebP or GIF image.`);
  const long = Math.max(info.w, info.h);
  const src = `${info.w}×${info.h} ${info.kind.toUpperCase()}`;
  // Tel quel quand ça tient DÉJÀ — le budget et la taille : ré-encoder une image qui va bien
  // ne ferait que la dégrader.
  if(long && long <= IMG_LONG){
    const d = dataUrlOf(buf, info.kind);
    if(d.length <= IMG_BUDGET && okCover(d)) return { img: d, note: `${label} (${src}, ${Math.round(d.length / 1024)} KB, kept as is)` };
  }
  const tried = [];
  for(const step of IMG_STEPS){
    if(long && step > long && step !== IMG_STEPS[IMG_STEPS.length - 1]) continue;   // ne pas « réduire » vers plus grand
    for(const enc of encoders()){
      let out;
      try{ out = encodeWith(enc, buf, info, step); }
      catch(e){ tried.push(enc + "@" + step + ": " + (e && e.message || e).split("\n")[0]); continue; }
      const d = dataUrlOf(out.buf, out.kind);
      if(d.length <= IMG_BUDGET && okCover(d))
        return { img: d, note: `${label} (${src} → ${out.w}×${out.h} ${out.kind.toUpperCase()}, ${Math.round(d.length / 1024)} KB, via ${enc})` };
      tried.push(enc + "@" + step + ": " + Math.round(d.length / 1024) + " KB, over the " + Math.round(IMG_BUDGET / 1024) + " KB budget");
    }
  }
  throw new Error(`${where}: ${label} (${src}) could not be brought under ${Math.round(IMG_BUDGET / 1024)} KB. `
    + (info.kind === "png" ? "Crop it to the part that matters, or " : "Save it as a PNG (the built-in encoder only reads PNG), or ")
    + "install ImageMagick. Tried: " + tried.join("; "));
}
// Pose les captures d'une carte NEUVE : chaque entrée désigne un nœud par son texte (ou un
// chemin « Parent > Nœud »), exactement comme une proposition — une désignation qui touche deux
// nœuds est refusée, jamais devinée. Une capture REMPLACE une illustration `pic` : deux images
// sur un nœud seraient deux vérités pour une question, et c'est `deserialize` qui trancherait.
function applyImages(root, images){
  if(images == null) return [];
  if(!Array.isArray(images)) throw new Error("`images` must be a list of { target, file } (or { target, data }).");
  if(images.length > 60) throw new Error("Too many screenshots in one map (60 max).");
  const notes = [];
  images.forEach((im, i)=>{
    const where = "images[" + i + "]";
    const target = String((im && im.target) == null ? "" : im.target);
    const r = propFind(root, target);
    if(r.error === "empty")   throw new Error(`${where}: \`target\` is required — the exact text of the node the screenshot goes on.`);
    if(r.error === "missing") throw new Error(`${where}: no node "${target}" in this outline. Use the exact wording of a line (without its bullet, checkbox or @-marker).`);
    if(r.error === "ambiguous") throw new Error(`${where}: "${target}" matches ${r.count} nodes. Name an ancestor too, e.g. "Parent > ${parts_last(target)}".`);
    const { img, note } = coverFrom(im, where);
    r.node.img = img;
    if(r.node.pic) delete r.node.pic;
    notes.push("“" + String(r.node.text || "").slice(0, 60) + "” ← " + note);
  });
  return notes;
}

// --- Les IMAGES d'un board (2026-10-23) ----------------------------------------------
// Un logo, une photo, une affiche posés LIBREMENT sur la toile : `doc.images` de l'app
// ({ id, src, x, y, w, h }), le même tableau que remplit un glisser-déposer. Rapporté : « l'outil
// qui crée les boards ne sait poser que des pictogrammes intégrés, pas tes fichiers de logo » —
// Claude avait dû écrire le fichier du board à la main. Un PNG/JPEG/WebP/GIF passe par la porte
// des captures (`coverFrom` : même budget, même ré-encodage) ; un SVG — la forme ordinaire d'un
// logo — est gardé tel quel, sans rasterisation (aucun codec ici). Il ne court aucun risque :
// l'app le peint dans un `<image href>`, où un script ne s'exécute jamais, et `deserialize`
// accepte tout `data:image/` sur un élément image (c'est ainsi que vit le logo de la toile Ai4X).
const SVG_BUDGET = 300000;
function svgSize(txt){
  const head = (/<svg\b[^>]*>/i.exec(txt) || [""])[0];
  const num = re => { const m = re.exec(head); const v = m ? parseFloat(m[1]) : NaN; return v > 0 ? v : 0; };
  let w = num(/\swidth\s*=\s*["']\s*([\d.]+)\s*(?:px)?\s*["']/i), h = num(/\sheight\s*=\s*["']\s*([\d.]+)\s*(?:px)?\s*["']/i);
  const vb = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
  if((!w || !h) && vb){ w = parseFloat(vb[1]); h = parseFloat(vb[2]); }
  return { w, h };
}
function boardImageFrom(spec, where){
  if(spec && typeof spec.data === "string" && /^data:image\/svg\+xml/i.test(spec.data.trim())){
    const d = spec.data.trim();
    if(d.length > SVG_BUDGET) throw new Error(`${where}: the SVG is over ${Math.round(SVG_BUDGET / 1024)} KB.`);
    let txt = "";
    const b64 = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/=\s]+)$/i.exec(d);
    if(b64) txt = Buffer.from(b64[1].replace(/\s+/g, ""), "base64").toString("utf8");
    else { const c = d.indexOf(","); try{ txt = decodeURIComponent(d.slice(c + 1)); }catch(e){ txt = ""; } }
    if(!/<svg\b/i.test(txt)) throw new Error(`${where}: \`data\` is not an SVG image.`);
    return { src: "data:image/svg+xml;base64," + Buffer.from(txt, "utf8").toString("base64"), ...svgSize(txt), note: `inline SVG kept as is` };
  }
  if(spec && typeof spec.file === "string" && spec.file.trim()){
    const p = resolve(spec.file.trim());
    if(existsSync(p) && statSync(p).isFile() && statSync(p).size <= IMG_FILE_MAX){
      const raw = readFileSync(p);
      const head = raw.subarray(0, 512).toString("utf8").replace(/^\uFEFF/, "").trimStart();
      if(/^(<\?xml|<svg\b|<!--|<!DOCTYPE svg)/i.test(head) && /<svg\b/i.test(raw.toString("utf8"))){
        const txt = raw.toString("utf8");
        const src = "data:image/svg+xml;base64," + Buffer.from(txt, "utf8").toString("base64");
        if(src.length > SVG_BUDGET) throw new Error(`${where}: ${basename(p)} is an SVG of ${Math.round(raw.length / 1024)} KB — over the ${Math.round(SVG_BUDGET / 1024)} KB budget. Simplify it, or export it as a PNG.`);
        return { src, ...svgSize(txt), note: `${basename(p)} (SVG, ${Math.round(src.length / 1024)} KB, kept as is)` };
      }
    }
  }
  const { img, note } = coverFrom(spec, where);
  const info = imageInfo(Buffer.from(img.slice(img.indexOf(",") + 1), "base64")) || {};
  return { src: img, w: info.w || 0, h: info.h || 0, note };
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
// Les marqueurs ⟪…⟫ disent ce qu'un plan ne montre pas (2026-10-12) : les dépendances (par le
// TEXTE du nœud attendu, résolu ici — Claude ne lit pas des ids), la récurrence, le nombre de
// commentaires et l'estimation. Sans eux, Claude proposerait une date avant celle du
// prédécesseur ou cocherait une tâche qui repart aussitôt, sans rien savoir de ce qu'il fait.
const RECUR_LABEL = { d:"daily", wd:"weekdays", w:"weekly", "2w":"every 2 weeks", m:"monthly", q:"quarterly", y:"yearly" };
function durText(sec){ const m = Math.round(sec / 60), h = Math.floor(m / 60); return h ? (h + "h" + (m % 60 ? String(m % 60).padStart(2, "0") : "")) : (m + "m"); }
// `ctx` (1.5.0) : ce que la carte sait du KANBAN et des autres cartes — la colonne de chaque carte,
// son responsable, ses dates, sa priorité, ses étiquettes, et le NOM de la carte qu'un lien `map:`
// ouvre (un board attaché à une carte kanban se lit « ⟪opens “Vision” [board]⟫ », pas « map:x7 »).
function nodeToMarkdown(n, depth, ctx){
  const lines = [];
  const cx = ctx || {};
  const colName = new Map(((cx.cols) || []).map(k => [k.id, k]));
  const doneCol = ((cx.cols) || []).find(k => k.done) || null;
  const byId = new Map();
  (function idx(node){ if(node && node.id) byId.set(node.id, node); (node.children||[]).forEach(idx); })(n);
  (function walk(node, d){
    let bullet;
    if(d===0) bullet = "# ";
    else bullet = "  ".repeat(d-1) + (node.check!=null ? (node.check ? "- [x] " : "- [ ] ") : "- ");
    const mlink = /^map:([A-Za-z0-9_]+)$/.exec(String(node.link || ""));
    const linked = mlink && cx.maps ? cx.maps.get(mlink[1]) : null;
    const body = node.link && !mlink ? `[${node.text}](${node.link})` : node.text;
    const marks = [];
    if(mlink) marks.push(linked ? "⟪opens “" + linked.name + "” [" + linked.kind + "]⟫" : "⟪opens another map (" + mlink[1] + ")⟫");
    if(d > 0 && colName.size){
      if(node.check === true && doneCol && node.col) marks.push("⟪column: " + doneCol.name + "⟫");
      else if(node.col && colName.has(node.col)) marks.push("⟪column: " + colName.get(node.col).name + "⟫");
    }
    if(typeof node.assign === "string" && node.assign.trim()) marks.push("⟪owner: " + node.assign.trim() + "⟫");
    if(node.start || node.due) marks.push("⟪" + (node.start && node.due ? node.start + " → " + node.due : node.due ? "due " + node.due : "starts " + node.start) + "⟫");
    if(Number.isInteger(node.priority) && node.priority > 0) marks.push("⟪P" + node.priority + "⟫");
    if(Array.isArray(node.tags) && node.tags.length) marks.push("⟪labels: " + node.tags.map(t => (cx.tagNames && cx.tagNames[t]) ? t + " “" + cx.tagNames[t] + "”" : t).join(", ") + "⟫");
    if(node.note && node.note.trim()) marks.push("⟪note⟫");
    if(Array.isArray(node.deps) && node.deps.length){
      const names = node.deps.map(id => byId.get(id)).filter(Boolean).map(p => String(p.text || "").trim()).filter(Boolean);
      if(names.length) marks.push("⟪waits on: " + names.join(", ") + "⟫");
    }
    if(node.recur && RECUR_LABEL[node.recur]) marks.push("⟪repeats " + RECUR_LABEL[node.recur] + "⟫");
    if(Array.isArray(node.cmts) && node.cmts.length) marks.push("⟪" + node.cmts.length + " comment" + (node.cmts.length > 1 ? "s" : "") + "⟫");
    if(typeof node.est === "number" && node.est > 0) marks.push("⟪est " + durText(node.est) + "⟫");
    lines.push(bullet + body + (marks.length ? "  " + marks.join(" ") : ""));
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

// L'ordre de superposition (`z`, ≡ `zOk` de l'app) : un entier [-9, 9], 0 omis. À z égal l'app peint
// par nature — images < formes < flèches < tracés < post-it — donc un panneau coloré REMPLI recouvre
// un logo posé dedans : `z:-1` sur le panneau (ou `z:1` sur l'image) est ce qui le remet devant.
function zMcp(v){
  const n = Math.round(+v);
  return (v != null && isFinite(n) && n >= -9 && n <= 9 && n !== 0) ? n : undefined;
}
function buildBoardDoc(name, elements, connections, style){
  if(!Array.isArray(elements) || !elements.length) throw new Error("`elements` must be a non-empty list.");
  const imgCount = elements.filter(e=>e && e.kind === "image").length;
  if(imgCount > 60) throw new Error("Too many images in one board (60 max).");
  const imageNotes = [];
  const els = elements.map((e,i)=>{
    if(e && e.kind === "image"){
      const where = "elements[" + i + "] (image" + (e.id != null ? " “" + e.id + "”" : "") + ")";
      const im = boardImageFrom(e, where);
      imageNotes.push(im.note);
      // La boîte garde les PROPORTIONS de l'image : un logo étiré se voit tout de suite. Une
      // seule cote donnée → l'autre en découle ; aucune → 220 px sur le côté long.
      const ar = (im.w > 0 && im.h > 0) ? im.w / im.h : 1;
      let w = (+e.w >= 24) ? Math.round(+e.w) : null, h = (+e.h >= 24) ? Math.round(+e.h) : null;
      if(w && !h) h = Math.max(24, Math.round(w / ar));
      else if(h && !w) w = Math.max(24, Math.round(h * ar));
      else if(!w && !h){ if(ar >= 1){ w = 220; h = Math.max(24, Math.round(220 / ar)); } else { h = 220; w = Math.max(24, Math.round(220 * ar)); } }
      return { lid: String(e.id != null ? e.id : i), kind: "image", text: "", src: im.src, z: zMcp(e.z),
               x: Number.isFinite(+e.x) && e.x!=null ? Math.round(+e.x) : null,
               y: Number.isFinite(+e.y) && e.y!=null ? Math.round(+e.y) : null, w, h };
    }
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
             size: (+e.size>=9 && +e.size<=72) ? Math.round(+e.size) : null,
             // L'image sans octets sur un élément de board (2026-09-03) : même frontière que
             // pour un nœud — un id inventé retombe sur « aucune image », jamais sur du balisage.
             // Pas sur un secteur, un gradin ou un chevron : leur silhouette n'a pas de « haut ».
             pic: (e.pic != null && !["arc","trap","chev"].includes(kind)) ? okPic(String(e.pic)) : "",
             z: zMcp(e.z) };
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
    if(e.kind === "image") continue;
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
    if(e.kind === "image") continue;
    const f = fitSize(e.text, e.w, e.h, e.kind, e.size || 15);
    if(!f.shrunk) continue;
    e.size = f.size;
    const budget = Math.round(Math.max(40, Math.floor((e.w - 24)/CHAR_W) * Math.max(1, Math.floor((e.h - 10)/LINE_H)) * 0.7));
    warnings.push(`“${e.text.slice(0, 38).replace(/\s+/g, " ")}…” — ${e.text.length} chars in a ${e.w}×${e.h} box, `
      + `shrunk to ${f.size}px${f.readable ? "" : " (too small to read)"}. Aim for ~${budget} chars.`);
  }

  // Sortie au format de l'app : shapes / stickies + refs "sh:i" / "st:i"
  const shapes = [], stickies = [], images = [], refOf = new Map();
  for(const e of els){
    if(e.kind==="image"){
      refOf.set(e.lid, "im:" + images.length);
      images.push({ id: "im" + images.length, src: e.src, x: e.x, y: e.y, w: e.w, h: e.h, z: e.z });
    } else if(e.kind==="sticky"){
      refOf.set(e.lid, "st:" + stickies.length);
      stickies.push({ text:e.text, x:e.x, y:e.y, w:e.w, h:e.h, color:e.color, size:e.size||undefined, pic:e.pic||undefined, z:e.z });
    } else {
      refOf.set(e.lid, "sh:" + shapes.length);
      shapes.push({ kind:e.kind, x:e.x, y:e.y, w:e.w, h:e.h, color:e.kind==="text" ? "#ffffff" : e.color, text:e.text, size:e.size||undefined,
                    pic: e.pic||undefined,
                    tk: e.tk != null ? e.tk : undefined,
                    a0: e.a0 != null ? e.a0 : undefined,
                    a1: e.a1 != null ? e.a1 : undefined,
                    ir: e.ir != null ? e.ir : undefined,
                    z: e.z });
    }
  }
  const arrows = conns.map(c=>{
    const a = byId.get(c.from), b = byId.get(c.to);
    return { x1: a.x + Math.round(a.w/2), y1: a.y + Math.round(a.h/2),
             x2: b.x + Math.round(b.w/2), y2: b.y + Math.round(b.h/2),
             from: refOf.get(c.from), to: refOf.get(c.to) };
  });
  const root = makeNode(name); root.color = "#dbeafe";
  const doc = { v:1, root, images, stickies, board:true, shapes, arrows, draws:[] };
  // `style` n'est émis que s'il est posé : l'app elle-même l'omet quand il vaut le défaut
  // (styleParDefaut), et le JSON d'un board ordinaire ne doit pas gagner un octet.
  const st = okStyleMcp(style);
  if(st) doc.style = st;
  return { doc, warnings, imageNotes };
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
    // Un ONGLET (2026-09-15) est un document CACHÉ de la bibliothèque : `sub` porte l'id de son
    // classeur. Sans le lire, Claude verrait « Sheet 2 » comme une carte ordinaire, sans savoir
    // de quel classeur elle est la seconde page — et proposerait de la ranger, ou de la lier.
    const byId = new Map((m.maps||[]).filter(x=>x && x.id).map(x=>[x.id, x]));
    const okId = v => typeof v === "string" && /^[A-Za-z0-9_]{1,64}$/.test(v);
    const byFile = new Map();
    (m.maps||[]).forEach(x=>{
      if(!x || !x.file) return;
      const book = okId(x.sub) && x.sub !== x.id ? byId.get(x.sub) : null;
      byFile.set(x.file, { name:x.name, folder: pathOf(x.folderId), tabOf: book ? (book.name || book.id) : null });
    });
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
        tabOf: meta.tabOf || null,   // le classeur dont ce document est un onglet, sinon null
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
// La bibliothèque du COMPTE, présentée exactement comme celle du dossier : mêmes champs, donc
// les outils n'ont rien à savoir de la source. `file` est l'identifiant que l'APP donne à la carte
// (≡ `teamLocalId`) : sa clé pour une carte à moi, « T<10 hexa du propriétaire>_<clé> » pour une
// carte d'équipe — c'est lui qu'une proposition doit porter, l'app le cherche dans SA bibliothèque.
//
// ⚠️ PAGINÉE (1.5.0) : la version précédente lisait 300 documents et s'arrêtait EN SILENCE — la
//    recherche ratait des cartes sur un gros compte sans le dire. On boucle jusqu'au `total`.
function teamLocalId(owner, key){
  const t = String(owner || "").replace(/-/g, "").toLowerCase().slice(0, 10);
  if(!/^[0-9a-f]{10}$/.test(t) || !/^[A-Za-z0-9_]{1,52}$/.test(String(key || ""))) return null;
  return "T" + t + "_" + key;
}
let cloudSpacesCache = null;   // les espaces vus au dernier chargement — la création les résout par nom
let cloudMe = null;            // le compte de la clé, vu au dernier chargement — la récolte en a besoin pour « Personal »
async function cloudLibrary(){
  const pages = [];
  let total = Infinity, off = 0, j = null;
  while(off < total && off < 5000){
    j = await cloudCall("docs", { limit: 100, offset: off });
    const got = j.maps || [];
    pages.push(...got);
    total = typeof j.total === "number" ? j.total : got.length;   // edge function d'avant la 1.5.0 : une seule page
    if(!got.length || typeof j.total !== "number") break;
    off += got.length;
  }
  const me = (j && j.me) || null;
  cloudMe = me;
  cloudSpacesCache = (j && j.spaces) || [];
  const spaceName = (owner, key)=>{ const sp = cloudSpacesCache.find(x=>x.owner === owner && x.space_key === key); return sp ? sp.name : null; };
  const folders = new Map((j && j.folders || []).filter(f=>f && f.folder_key).map(f=>[(f.owner || "") + "|" + f.folder_key, f]));
  const pathOf = (owner, k)=>{
    const out = [], seen = new Set();
    let f = folders.get((owner || "") + "|" + k) || folders.get("|" + k);
    while(f && !seen.has(f.folder_key) && out.length <= 16){ seen.add(f.folder_key); out.unshift(f.name); f = f.parent_key ? (folders.get((owner || "") + "|" + f.parent_key) || folders.get("|" + f.parent_key)) : null; }
    return out.length ? out.join(" / ") : null;
  };
  // L'ESPACE d'une carte (1.6.0, pour la récolte) : le sien, sinon celui du dossier RACINE qui la contient —
  // la règle de l'app (`spaceOfMapIn` : ce qui est dans un dossier hérite de la racine). Sans elle, une carte
  // « Company knowledge » rangée dans un dossier d'un espace passerait pour une carte de Personal.
  const rootSpaceOf = (owner, k)=>{
    const seen = new Set();
    let f = folders.get((owner || "") + "|" + k) || folders.get("|" + k);
    while(f && f.parent_key && !seen.has(f.folder_key) && seen.size <= 16){ seen.add(f.folder_key); f = folders.get((owner || "") + "|" + f.parent_key) || folders.get("|" + f.parent_key); }
    return (f && f.space_key) || null;
  };
  const out = [];
  for(const r of pages){
    const doc = r && r.doc;
    if(!doc || !doc.root) continue;
    const owner = r.owner || me;
    const team = !!(owner && me && owner !== me);
    const file = team ? teamLocalId(owner, r.map_key) : r.map_key;
    if(!file) continue;
    out.push({
      file, key: r.map_key, owner, team,
      role: r.role || "owner",
      space: r.space_key ? spaceName(owner, r.space_key) : null,
      name: String(r.name || "") || String(doc.root.text || "").slice(0, 60) || r.map_key,
      folder: pathOf(owner, r.folder_key),
      // La SORTE de l'index (kanban, note, gantt, sheet) quand le compte la dit : c'est elle qui décide
      // de la vue d'ouverture dans l'app. Le document seul ne distingue que board / carte.
      kind: doc.board ? "board" : (r.kind && r.kind !== "board" ? r.kind : "map"),
      nodes: countNodes(doc.root),
      elements: doc.board ? ((doc.shapes||[]).length + (doc.stickies||[]).length + (doc.arrows||[]).length + (doc.draws||[]).length) : undefined,
      mtime: String(r.updated_at || "").slice(0,16).replace("T"," "),
      updatedAt: String(r.updated_at || ""),
      spaceKey: r.space_key || (r.folder_key ? rootSpaceOf(owner, r.folder_key) : null),
      doc
    });
  }
  return out;
}
async function loadLibrary(){ return CLOUD ? cloudLibrary() : scanLibrary(); }
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
  const zs = o=>o && o.z ? ` z:${o.z}` : "";
  lines.push(`Shapes (${(doc.shapes||[]).length}):`);
  (doc.shapes||[]).forEach((s,i)=>lines.push(`  sh:${i} [${s.kind}] ${JSON.stringify((s.text||"").slice(0,80))} @(${s.x},${s.y}) ${s.w}×${s.h}${zs(s)}`));
  // Les images d'un board (2026-10-23) : le type et le poids, jamais les octets — une data URL de
  // 200 Ko dans la réponse noierait tout le reste, et Claude n'en lirait rien.
  const imgs = (doc.images||[]);
  if(imgs.length){
    lines.push(`Images (${imgs.length}):`);
    imgs.forEach((m,i)=>{
      const t = (/^data:image\/([a-z+.-]+)/i.exec(m.src||"") || [,"?"])[1].replace("svg+xml","svg");
      lines.push(`  im:${i} [${t}, ${Math.round(String(m.src||"").length * 3 / 4 / 1024)} KB] @(${m.x},${m.y}) ${m.w}×${m.h}${zs(m)}`);
    });
  }
  if((doc.stickies||[]).length){
    lines.push(`Sticky notes (${doc.stickies.length}):`);
    doc.stickies.forEach((s,i)=>lines.push(`  st:${i} ${JSON.stringify((s.text||"").slice(0,80))} @(${s.x},${s.y})`));
  }
  const named = ref=>{
    if(typeof ref !== "string") return null;
    const m = /^(sh|st|im):(\d+)$/.exec(ref); if(!m) return null;
    if(m[1]==="im") return (doc.images||[])[+m[2]] ? "im:" + m[2] + " (image)" : "im:" + m[2] + " ?";
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
async function findMap(file){
  checkRelPath(file);
  const all = await loadLibrary();
  const hit = all.find(m=>m.file===file) || all.find(m=>m.file.endsWith(file)) || all.find(m=>m.name===file);
  if(!hit) throw new Error("No such map: " + file + ". Use list_maps to see what is available.");
  return hit;
}

// ---------------------------------------------------------------------------
// Écriture (toujours un NOUVEAU fichier — jamais de modification en place)
// ---------------------------------------------------------------------------
async function writeDoc(name, doc, folder, opts){
  const o = opts || {};
  if(CLOUD){
    // Le dossier est un NOM ou un CHEMIN de dossier de bibliothèque : on le résout en clé s'il
    // existe déjà, sinon la carte arrive à la racine et le texte de réponse le dit
    // (« no silent caps »).
    //
    // ⚠️ 2026-09-23 — LE NOM SEUL NE SUFFIT PAS. Un compte qui a « Ai4X » à la racine ET un « Ai4X »
    // imbriqué dedans faisait tirer au sort. Deux règles : un CHEMIN complet (« Ai4X / Ai4X ») gagne
    // toujours, et un nom seul prend le dossier le MOINS PROFOND. L'ambiguïté est dite.
    //
    // 👥 1.5.0 — LES ESPACES D'ÉQUIPE. `space` (un nom d'espace) dit OÙ : un de mes espaces, ou un
    // espace dont je suis membre — la carte vit alors chez son PROPRIÉTAIRE, comme toute carte
    // d'équipe. Les dossiers candidats sont ceux de cet espace ; sans `space`, mes dossiers d'abord,
    // puis ceux des espaces d'équipe (un dossier d'équipe se désigne aussi par son chemin).
    const j = await cloudCall("list", {});
    const me = j.me || null;
    const spaces = (j.spaces || []).filter(x=>x && x.space_key);
    const all = (j.folders || []).filter(f=>f && f.folder_key);
    const byKey = new Map(all.map(f=>[(f.owner || "") + "|" + f.folder_key, f]));
    const chain = (f0)=>{ const out=[]; const seen=new Set(); let f=f0;
      while(f && !seen.has(f.folder_key) && out.length<=16){ seen.add(f.folder_key); out.unshift(f.name); f = f.parent_key ? byKey.get((f.owner || "") + "|" + f.parent_key) : null; }
      return out; };
    const norm = (x)=>String(x||"").split("/").map(t=>t.trim()).filter(Boolean).join(" / ").toLowerCase();
    let sp = null;
    if(o.space){
      const want = norm(o.space);
      const hits = spaces.filter(x=>norm(x.name) === want);
      if(!hits.length) throw new Error("No space named “" + o.space + "” in this account" + (spaces.length ? ". Spaces you can use: " + spaces.map(x=>"“" + x.name + "”" + (x.owner !== me ? " (team, " + x.role + ")" : "")).join(", ") : " — it has no spaces") + ".");
      sp = hits.find(x=>x.owner === me) || hits[0];
      if(!sp.writable) throw new Error("You cannot add maps to the space “" + sp.name + "” — " + (sp.role === "viewer" ? "your role there is viewer. Ask its owner for the editor role." : "its owner's plan has ended, so it is read-only."));
    }
    let f0 = null, folder_twins = 0;
    if(folder){
      const want = norm(folder);
      let cands = all.filter(f=>!sp || (f.owner === sp.owner && f.space_key === sp.space_key));
      if(!sp) cands = cands.slice().sort((a,b)=>(a.owner === me ? 0 : 1) - (b.owner === me ? 0 : 1));
      let hits = cands.filter(f=>norm(chain(f).join(" / ")) === want);                       // chemin exact
      if(!hits.length) hits = cands.filter(f=>norm(f.name) === want)                         // nom de feuille
                                  .sort((a,b)=>((a.owner === me ? 0 : 1) - (b.owner === me ? 0 : 1)) || (chain(a).length - chain(b).length));
      if(hits.length){ f0 = hits[0]; folder_twins = hits.length; }
    }
    const owner = f0 ? (f0.owner || me) : (sp ? sp.owner : me);
    const kind = o.kind || (doc.board ? "board" : (doc.kanban ? "kanban" : "map"));
    const body = { name: String(name||"").slice(0,200), kind, doc, folder_key: f0 ? f0.folder_key : null };
    if(owner && me && owner !== me) body.owner = owner;
    if(!f0 && sp) body.space_key = sp.space_key;
    const r = await cloudCall("create", body);
    // On DIT toujours où la carte a atterri : l'espace, le chemin complet — pas le nom demandé.
    const spaceOf = (own, key)=>{ const x = spaces.find(y=>y.owner === own && y.space_key === key); return x ? x.name : null; };
    const inSpace = f0 ? spaceOf(f0.owner, f0.space_key) : (sp ? sp.name : null);
    let where = "";
    if(f0){
      where = "  (in “" + chain(f0).join(" / ") + "”" + (inSpace ? ", space “" + inSpace + "”" : "") + ")";
      if(folder_twins > 1) where += "  ⚠ " + folder_twins + " folders are named “" + folder
        + "” in this account; the shallowest was used. Pass the full path (e.g. “" + folder + " / " + folder
        + "”) to choose another one.";
    } else if(folder){
      where = "  (folder “" + folder + "” does not exist" + (sp ? " in the space “" + sp.name + "”" : " in this account") + " — the map is at the root" + (sp ? " of that space" : "") + ")";
    } else if(sp){
      where = "  (space “" + sp.name + "”" + (owner !== me ? " — a team space: every member sees it" : "") + ")";
    }
    const id = (owner && me && owner !== me) ? teamLocalId(owner, r.map_key) : r.map_key;
    // La récolte (1.6.0) crée une carte PUIS y dépose une proposition : il lui faut la clé et le
    // propriétaire, que la phrase ne rend pas sans perte (une carte d'équipe s'y nomme par son id d'app).
    if(o.info) return { text: "cloud:" + (id || r.map_key) + where, key: r.map_key, owner, id: id || r.map_key, team: !!(owner && me && owner !== me) };
    return "cloud:" + (id || r.map_key) + where;
  }
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
const PROP_OPS = ["add","rename","note","check","delete","move","pic","img","persona","tags","assign","priority","due","attr","comment","est","start","cols","link","vote"];
// ⚡ Les ops que l'app applique D'ELLE-MÊME (1.5.0, décidé « hybride » le 2026-10-20) — ≡
// `PROP_AUTO_OPS` d'app/index.html (le test compare les deux). Plus `cols` quand le tableau n'a
// pas encore de colonnes (`seed`). C'est l'APP qui décide : le connecteur ne fait que demander
// (`auto:true`) et découper le lot pour que le reste parte à la revue.
const PROP_AUTO_OPS = ["add","move","check","tags","assign","priority","due","start","est","attr","comment","pic","img","link"];
// Les ops que Claude peut ÉCRIRE et qui n'existent pas telles quelles dans l'app : `lever` devient
// un attribut « Lever: <clé> » (c'est ainsi que l'app le range, `KB_LEVER_ATTR`), `columns` est le
// nom lisible de `cols`.
const INPUT_OPS = PROP_OPS.concat(["lever", "columns"]);
// Les quatre leviers Ai4X — ≡ les clés de `KB_LEVERS` d'app/index.html (le test compare).
const KB_LEVER_KEYS_MCP = ["human","think","accelerate","automate"];
// Un identifiant de nœud neuf, de la forme qu'`okNodeId` accepte. Posé sur chaque `add` (`nid`) :
// c'est ce qui rend l'ajout IDEMPOTENT dans l'app — rejoué par deux appareils, il ne double pas.
function newNid(){ return "mcp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function cloneDoc(d){ return JSON.parse(JSON.stringify(d)); }
// Les dix étiquettes de couleur du kanban — ≡ `KB_TAGS` de index.html (le test compare les deux).
const KB_TAG_KEYS = ["green","yellow","orange","red","purple","blue","sky","lime","pink","gray"];

// Tout est vérifié ICI, contre la carte réelle, et un défaut fait ÉCHOUER l'appel. C'est
// délibéré : une cible introuvable remonte à Claude, qui peut relire la carte et corriger,
// alors qu'une proposition à moitié valide arriverait chez l'utilisateur sous forme de
// lignes barrées qu'il ne peut ni comprendre ni réparer. La boîte aux lettres ne reçoit
// que des propositions applicables.
// ⚠️ SÉQUENTIEL depuis la 1.5.0 : chaque op est validée contre la carte TELLE QUE LES OPS
//    PRÉCÉDENTES L'ONT LAISSÉE (une copie, `work`). Sans ça, « ajoute la carte X, puis mets-lui une
//    échéance » échouait : X n'existait pas encore dans la carte lue. L'app applique dans le même
//    ordre, donc la cible validée ici est celle qu'elle trouvera.
function buildProposalOps(mapDoc0, changes){
  if(!Array.isArray(changes) || !changes.length) throw new Error("`changes` must be a non-empty list.");
  if(changes.length > 100) throw new Error("Too many changes in one proposal (max 100). Send several smaller ones — the user reviews them one by one.");
  const mapDoc = cloneDoc(mapDoc0);
  const colsNow = ()=>(mapDoc.kanban && Array.isArray(mapDoc.kanban.cols) && mapDoc.kanban.cols.length) ? mapDoc.kanban.cols : null;
  // Une colonne se désigne par son id OU par son nom (« Doing ») — Claude lit les noms.
  const colRef = (raw, where)=>{
    const cols = colsNow();
    const v = String(raw);
    if(!cols) throw new Error(`${where}: this map has no kanban board yet. Add a "columns" change first (e.g. { op: "columns", columns: [{ name: "To do" }, { name: "Doing" }, { name: "Done", done: true }] }), then refer to those column names.`);
    const hit = cols.find(k => k.id === v) || cols.find(k => String(k.name).trim().toLowerCase() === v.trim().toLowerCase());
    if(!hit) throw new Error(`${where}: no column "${v}" on this board. Use one of: ${cols.map(k => `"${k.name}" (${k.id})`).join(", ")}.`);
    return hit.id;
  };
  return changes.map((c, i)=>{
    const where = "change #" + (i+1);
    const op = String((c && c.op) || "").trim();
    if(!INPUT_OPS.includes(op)) throw new Error(`${where}: unknown op "${op}". Use one of: ${INPUT_OPS.filter(x=>x !== "cols").join(", ")}.`);
    if(op === "columns" || op === "cols"){
      // Les colonnes du tableau, en un bloc. Un tableau qui n'en a PAS reçoit `seed` : l'app pose ces
      // colonnes d'elle-même, sans écraser celles qu'un collègue aurait posées entre-temps. Un tableau
      // qui en a déjà : un REMPLACEMENT, qui part à la revue (les cartes d'une colonne retirée
      // quittent le tableau). Un id existant est GARDÉ quand le nom revient — sinon chaque carte de
      // « Doing » perdrait sa colonne au passage.
      const list = Array.isArray(c.columns) ? c.columns : (Array.isArray(c.cols) ? c.cols : null);
      if(!list || !list.length || list.length > 12) throw new Error(`${where}: \`columns\` must list 1 to 12 columns — { name, done?, wip? }.`);
      const before = colsNow() || [];
      const used = new Set();
      const cols = list.map((k, j)=>{
        const name = String((k && (k.name != null ? k.name : k)) || "").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 60);
        if(!name) throw new Error(`${where}: column #${j+1} has no name.`);
        const prev = before.find(b => String(b.name).trim().toLowerCase() === name.toLowerCase() && !used.has(b.id));
        let id = prev ? prev.id : (k && typeof k.id === "string" && /^[\w-]{1,24}$/.test(k.id) && !before.some(b=>b.id === k.id) ? k.id : "c" + (j+1));
        while(used.has(id) || (!prev && before.some(b => b.id === id))) id = "c" + Math.random().toString(36).slice(2, 7);
        used.add(id);
        const wip = parseInt(k && k.wip, 10);
        return Object.assign({ id, name }, k && k.done ? { done: true } : {}, (wip >= 1 && wip <= 99) ? { wip } : {});
      });
      if(cols.filter(k => k.done).length > 1) throw new Error(`${where}: only one column can be the "done" column.`);
      const out = { op: "cols", cols };
      if(!before.length) out.seed = true;
      mapDoc.kanban = Object.assign({}, mapDoc.kanban || {}, { cols });
      return out;
    }
    if(op === "persona"){
      // `persona` (2026-09-08) vise le DOCUMENT entier — la toile d'une work map — jamais un
      // nœud : donc pas de `target`. C'est le relais skill → carte sans copier-coller : le skill
      // « ma cartographie du travail » dépose ici l'objet de l'entretien, l'app propose de
      // l'appliquer d'un clic. Contrôle SUPERFICIEL, et c'est une décision : `okPersona`, la
      // frontière de confiance de l'app (soixante lignes de bornes), juge à l'application et
      // nomme son refus dans le panneau. La dupliquer ici serait une seconde règle à figer
      // caractère par caractère comme `okPic`. La raison qui fait valider les autres ops en
      // profondeur — « une proposition à moitié valide arrive en lignes barrées » — ne
      // s'applique pas : une op persona est ATOMIQUE, elle rebâtit la toile ou ne fait rien.
      const P = c.persona;
      // DEUX personas (2026-09-11) : celui d'une WORK MAP porte des `modules`, celui d'un SECOND
      // CERVEAU des `domains`. Même contrôle superficiel — `okBrain` juge à l'application.
      const isBrain = !!(P && typeof P === "object" && Array.isArray(P.domains) && P.domains.length);
      if(!P || typeof P !== "object" || (!isBrain && (!Array.isArray(P.modules) || !P.modules.length)))
        throw new Error(`${where}: \`persona\` must be the interview object — a work map { who, role, mission, tools, meetings, opener, modules:[{ name, procs:[{ name, h, after, freq, rep, data, stakes, lever, step, why }] }], trajectory, signs, parking }, or a second-brain blueprint { who, role, mission, tools, opener, domains:[{ name, kind, share, holds }], losses, outputs, sources, nevermix, cadence, review, ailevel, signs }.`);
      if(JSON.stringify(P).length > 60000) throw new Error(`${where}: the persona is too large (60000 characters max).`);
      if(isBrain){
        if(P.domains.length > 5) throw new Error(`${where}: the blueprint has ${P.domains.length} domains — five at most.`);
        return { op, persona: P, procs: 0, domains: P.domains.length };
      }
      const n = P.modules.reduce((a, m)=>a + ((m && Array.isArray(m.procs)) ? m.procs.length : 0), 0);
      if(n < 3) throw new Error(`${where}: the persona has ${n} process(es) — a work map needs at least three. Finish the interview first.`);
      return { op, persona: P, procs: n };
    }
    const target = String(c.target == null ? "" : c.target);
    const r = propFind(mapDoc.root, target);
    if(r.error === "empty")   throw new Error(`${where}: \`target\` is required — the node the change applies to.`);
    if(r.error === "missing") throw new Error(`${where}: no node "${target}" in this map. Run read_map first and copy the wording exactly.`);
    if(r.error === "ambiguous") throw new Error(`${where}: "${target}" matches ${r.count} nodes. Name an ancestor too, e.g. "Parent > ${parts_last(target)}".`);
    const out = { op, target, was: String(r.node.text||"") };
    // `why` (2026-10-12) : la RAISON d'un changement, en une ligne — l'app la montre sous la ligne
    // à approuver. ≡ la règle de `parseProposal` côté app (une ligne, 200 caractères) : une raison
    // trop longue est rognée, jamais refusée ; une raison qui n'est pas du texte, si.
    if(c.why != null){
      if(typeof c.why !== "string") throw new Error(`${where}: \`why\` must be text — one short line saying why this change.`);
      const w = c.why.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      if(w) out.why = w;
    }
    if(op === "add"){
      if(typeof c.markdown !== "string" || !c.markdown.trim()) throw new Error(`${where}: \`markdown\` is required for an "add".`);
      if(c.markdown.length > 20000) throw new Error(`${where}: \`markdown\` is too long (20000 characters max).`);
      const forest = buildForest(parseOutline(c.markdown));
      if(!forest.length) throw new Error(`${where}: \`markdown\` has no usable structure (a bullet list, indented by 2 spaces).`);
      out.markdown = c.markdown;
      out.adds = countForest(forest);
      out.nid = newNid();
      // `col` facultatif (2026-10-12) : les cartes NEUVES vont dans cette colonne du kanban.
      // Validé comme pour `move` — une colonne inventée est refusée ICI, en nommant les vraies ;
      // un NOM de colonne est accepté et traduit en id (1.5.0).
      if(c.col != null && c.col !== "") out.col = colRef(c.col, where);
      // La copie de travail reçoit les nœuds : une op suivante du même lot peut les viser.
      r.node.children = (r.node.children || []).concat(forest);
      // `assign` facultatif (2026-10-12, 👥) : le RESPONSABLE des cartes neuves. Mêmes bornes que l'op
      // `assign` ; refusé ICI en le disant, plutôt que de laisser l'app le retirer en silence.
      if(c.assign != null && c.assign !== ""){
        if(typeof c.assign !== "string" || c.assign.length > 120 || /[\x00-\x1f\x7f]/.test(c.assign))
          throw new Error(`${where}: \`assign\` must be a name or e-mail (120 characters max) — the owner of the new cards.`);
        if(c.assign.trim()) out.assign = c.assign.trim();
      }
    } else if(op === "rename"){
      if(typeof c.text !== "string" || !c.text.trim()) throw new Error(`${where}: \`text\` is required for a "rename".`);
      out.text = c.text.trim().slice(0, 2000);
      r.node.text = out.text;
    } else if(op === "note"){
      if(typeof c.note !== "string") throw new Error(`${where}: \`note\` is required for a "note" (an empty string clears it).`);
      out.note = c.note.slice(0, 8000);
    } else if(op === "check"){
      const v = c.value === "true" ? true : c.value === "false" ? false : c.value;
      if(typeof v !== "boolean") throw new Error(`${where}: \`value\` must be true or false for a "check".`);
      out.value = v;
    } else if(op === "delete"){
      if(r.node === mapDoc.root) throw new Error(`${where}: the centre of the map cannot be deleted.`);
      out.drops = countNodes(r.node);
      (function cut(n){ const k = (n.children || []).indexOf(r.node); if(k >= 0){ n.children.splice(k, 1); return true; } return (n.children || []).some(cut); })(mapDoc.root);
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
    } else if(op === "img"){
      // Des PIXELS, cette fois — ré-encodés ICI pour passer `okCover` chez l'utilisateur. Une
      // capture trop lourde est refusée à l'écriture, en nommant la limite, plutôt que d'arriver
      // dans le panneau comme une ligne grisée. `img: ""` retire la capture.
      if(c.img === "" || c.img === null){ out.img = ""; }
      else {
        const { img, note } = coverFrom(c, where);
        out.img = img; out.shot = note;
      }
    } else if(op === "move"){
      // ⚠️ Dans le FICHIER les colonnes sont `{cols:[…]}` ; en mémoire, côté app, c'est un
      // tableau nu. Confondre les deux donne un contrôle qui ne regarde rien.
      // Vide = retirer du tableau, comme le ✕ d'une carte. Toute autre valeur doit désigner une
      // colonne RÉELLE (id ou nom) : une carte envoyée ailleurs disparaîtrait de l'écran sans un message.
      const raw = String(c.col == null ? "" : c.col);
      if(!colsNow()) colRef(raw || "?", where);   // lève le message « pas encore de kanban »
      out.col = raw ? colRef(raw, where) : "";
    } else if(op === "tags"){
      // Les dix couleurs, liste FERMÉE — ≡ `okTags` de l'app. Une clé inventée est refusée ICI,
      // en nommant la liste, plutôt que de tomber en silence à la lecture. [] retire tout.
      if(!Array.isArray(c.tags)) throw new Error(`${where}: \`tags\` must be a list of label colours for a "tags" (an empty list clears them).`);
      const bad = c.tags.filter(t => !KB_TAG_KEYS.includes(t));
      if(bad.length) throw new Error(`${where}: unknown label colour "${bad[0]}". Use any of: ${KB_TAG_KEYS.join(", ")} (read_map shows the names the board gave them).`);
      out.tags = KB_TAG_KEYS.filter(k => c.tags.includes(k));
    } else if(op === "assign"){
      if(typeof c.assign !== "string") throw new Error(`${where}: \`assign\` is required for an "assign" — a name or e-mail (an empty string clears it).`);
      if(c.assign.length > 120 || /[\x00-\x1f\x7f]/.test(c.assign)) throw new Error(`${where}: \`assign\` is too long or contains control characters (120 characters max).`);
      out.assign = c.assign.trim();
    } else if(op === "priority"){
      const q = (c.priority == null) ? 0 : c.priority;
      if(!Number.isInteger(q) || q < 0 || q > 6) throw new Error(`${where}: \`priority\` must be a whole number from 1 (highest) to 6, or 0 to remove it.`);
      out.priority = q;
    } else if(op === "due" || op === "start"){
      const q = (c[op] == null) ? "" : String(c[op]);
      if(q && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(q)) throw new Error(`${where}: \`${op}\` must be a day written YYYY-MM-DD (or "" to remove it).`);
      out[op] = q;
    } else if(op === "vote"){
      // 👍 Un vote est le geste d'une PERSONNE sur le tableau (app, page publiée) : Claude ne vote pas à la place de quelqu'un.
      throw new Error(`${where}: "vote" is cast by people on the board, not proposed by Claude.`);
    } else if(op === "link"){
      // La liste blanche de l'app (`okOpLink`), en plus étroit : une page web, un e-mail, ou une
      // autre carte (`map:<id>` — l'id que list_maps donne). Jamais `javascript:` ni `data:`.
      const q = (c.link == null) ? "" : String(c.link).trim();
      if(q && !/^(https?:\/\/[^\s\x00-\x1f]+|mailto:[^\s\x00-\x1f]+|map:[A-Za-z0-9_]+)$/i.test(q))
        throw new Error(`${where}: \`link\` must be an https:// address, a mailto: address, or "map:<file>" to open another map from list_maps (or "" to remove it).`);
      out.link = q;
    } else if(op === "lever"){
      // Le levier Ai4X d'une carte. L'app le range en ATTRIBUT « Lever: <clé> » (`kbLeverSet` →
      // `shAttrSet`) : on écrit exactement ça, par l'op `attr`, que l'app sait appliquer.
      const q = String(c.lever == null ? "" : c.lever).trim().toLowerCase();
      if(q && !KB_LEVER_KEYS_MCP.includes(q)) throw new Error(`${where}: \`lever\` must be one of ${KB_LEVER_KEYS_MCP.join(", ")} (or "" to remove it).`);
      out.op = "attr"; out.name = "Lever"; out.value = q;
    } else if(op === "attr"){
      if(typeof c.name !== "string" || !c.name.trim() || c.name.length > 60 || /[:\x00-\x1f]/.test(c.name))
        throw new Error(`${where}: \`name\` is required for an "attr" — the attribute's name, without a colon (60 characters max).`);
      if(typeof c.value !== "string" || c.value.length > 400 || /[\x00-\x1f]/.test(c.value))
        throw new Error(`${where}: \`value\` is required for an "attr" — its value as text (400 characters max; "" removes the attribute).`);
      out.name = c.name.trim(); out.value = c.value.trim();
    } else if(op === "comment"){
      // Un commentaire est AJOUTÉ au fil de la carte, jamais substitué : la seule op qui ne
      // réécrit rien. Signé « Claude » par l'app (le `by` de la proposition), borné comme
      // `CMT_TEXT_MAX` côté app — un fil est lu par des gens, pas par un tableur.
      if(typeof c.text !== "string" || !c.text.trim()) throw new Error(`${where}: \`text\` is required for a "comment" — what you want to say about this card.`);
      if(c.text.length > 2000) throw new Error(`${where}: the comment is too long (2000 characters max).`);
      out.text = c.text.trim();
    } else if(op === "est"){
      // Une DURÉE, dans les formes que `parseDur` lit côté app (« 2h », « 1h30 », « 45 » = minutes,
      // « 2:15 »), jamais une phrase : « soon » est refusé ICI, en nommant les formes, plutôt que
      // de tomber en silence à la lecture. Vide = retirer l'estimation.
      const q = (c.est == null) ? "" : String(c.est).trim().toLowerCase().replace(/\s+/g, "");
      if(q && !DUR_RE.test(q)) throw new Error(`${where}: \`est\` must be a duration — "2h", "1h30", "45" (minutes) or "2:15" — or "" to remove the estimate.`);
      out.est = q;
    }
    return out;
  });
}
// 👥 L'ÉQUIPE du tableau (`kanban.team`, 2026-10-12) — qui fait quoi. Montrée par read_map pour la
// même raison que dans l'app : c'est elle qui permet de proposer un RESPONSABLE (assign) au lieu de
// deviner à partir d'un prénom écrit dans un titre. Lecture seule, bornée comme `okKbTeam` côté app
// (30 personnes, textes rognés) : le fichier vient du disque, c'est-à-dire de n'importe qui.
function teamToText(doc){
  const t = doc && doc.kanban && doc.kanban.team;
  if(!t || typeof t !== "object" || !Array.isArray(t.people)) return "";
  const line = (v, max) => String(typeof v === "string" ? v : "").replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const people = t.people.filter(p => p && typeof p.who === "string" && line(p.who, 120)).slice(0, 30);
  if(!people.length) return "";
  let out = "\n\n👥 Team — who does what (pick owners from here; `assign` takes the exact name):";
  const goal = line(t.goal, 800);
  if(goal) out += "\n  Team objectives: " + goal;
  for(const p of people){
    out += "\n• " + line(p.who, 120) + (line(p.role, 80) ? " — " + line(p.role, 80) : "");
    if(line(p.does, 800)) out += "\n    owns: " + line(p.does, 800);
    if(line(p.goals, 800)) out += "\n    objectives: " + line(p.goals, 800);
  }
  return out;
}
// ≡ les formes que `parseDur` accepte dans index.html (hh:mm, Nh, NhMM, Nm, Ns, N = minutes).
const DUR_RE = /^(\d{1,5}:[0-5]\d|\d{1,5}h([0-5]?\d)?m?|\d{1,7}m(in)?|\d{1,9}s(ec)?|\d{1,7})$/;
function parts_last(spec){ const p = String(spec||"").split(">"); return p[p.length-1].trim(); }

// L'app ignore un fichier de proposition au-delà de PROP_FILE_MAX octets (`propScan`) — sans un
// mot, puisqu'elle ne peut pas savoir ce qu'il contenait. Avec des captures d'écran dedans, la
// borne se rencontre : on refuse ICI en nommant le geste, jamais un dépôt qui n'arrive pas.
const PROP_FILE_MAX = 1400000;
// ⚡ LE DÉCOUPAGE « HYBRIDE » (1.5.0). Le début du lot fait d'ops sûres part avec `auto:true` —
// l'app l'applique d'elle-même ; à partir de la PREMIÈRE op qui demande une revue, tout le reste
// part dans une seconde proposition, à revoir. Découper AU PREMIER refus, jamais op par op : une
// op sûre qui suit un renommage vise souvent le texte renommé, et l'appliquer avant lui la ferait
// échouer chez l'utilisateur.
function autoOk(o){ return o.op === "cols" ? o.seed === true : PROP_AUTO_OPS.includes(o.op); }
function splitAuto(ops){
  let k = 0;
  while(k < ops.length && autoOk(ops[k])) k++;
  return { auto: ops.slice(0, k), review: ops.slice(k) };
}
async function writeProposal(map, note, ops, opts){
  const o = opts || {};
  const payload = (id, list, auto)=>Object.assign({
    v: 1, kind: "tabtree-proposal", mapId: id, mapFile: CLOUD ? map.file : basename(map.file), mapName: map.name,
    createdAt: Date.now(), by: "Claude", note: String(note||"").slice(0, 2000), ops: list
  }, auto ? { auto: true } : {}, o.extra || {});
  const shots = ops.filter(x=>x.op === "img" && x.img).length;
  if(JSON.stringify(payload("x", ops)).length > PROP_FILE_MAX)
    throw new Error("This proposal is too large for TabTree's mailbox (" + Math.round(PROP_FILE_MAX / 1024) + " KB max) — it carries " + shots + " screenshot(s). Send it as several proposals with fewer screenshots each.");
  if(CLOUD){
    // La boîte aux lettres cloud : la table `proposals`, que l'app relit au sondage suivant.
    // Même charge utile que le fichier — c'est le même `parseProposal` qui la lit côté app.
    // Une carte d'équipe : la clé chez son propriétaire, et `mapId` = l'id que l'app lui donne.
    const parts = o.review ? { auto: [], review: ops } : splitAuto(ops);
    const base = { map_key: map.key || map.file };
    if(map.team && map.owner) base.owner = map.owner;
    const ids = {};
    if(parts.auto.length){ const r = await cloudCall("propose", Object.assign({ payload: payload(map.file, parts.auto, true) }, base)); ids.auto = r.id || "proposal"; }
    if(parts.review.length){ const r = await cloudCall("propose", Object.assign({ payload: payload(map.file, parts.review, false) }, base)); ids.review = r.id || "proposal"; }
    return { auto: parts.auto, review: parts.review, ids };
  }
  dirOk();
  const target = join(DIR, PROP_DIR);
  if(!existsSync(target)) mkdirSync(target);
  const id = mapIdOf(map.file);
  if(!id) throw new Error("This map's file has no id suffix (“…__map123.tabtree”), so the app cannot match a proposal to it. Open it once in TabTree with the backup folder turned on, then try again.");
  const file = "prop_" + id + "__" + Date.now().toString(36) + ".json";
  writeFileSync(join(target, file), JSON.stringify(payload(id, ops, false), null, 2), "utf8");
  return { auto: [], review: ops, ids: { review: PROP_DIR + "/" + file } };
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
  if(CLOUD) return "Saved to the user's TabTree account. It appears in TabTree within a minute (the app polls "
    + "its account while open), or on the next sign-in on any device. Nothing is overwritten.";
  return "Written to the folder “" + basename(DIR) + "”.\n"
    + "To see it in TabTree: My maps → 🛟 → “Bring maps back from this folder…”. "
    + "(Or press ⌘K and type “bring my maps back”.) Nothing is overwritten.\n"
    + "If “" + basename(DIR) + "” is not the folder TabTree names next to its 🛟 button, "
    + "the connector is pointed at a different library — that is why a map can be created and never appear.";
}

// ---------------------------------------------------------------------------
// 🃏 Le KANBAN (1.5.0) — lire ses colonnes, et en fabriquer un d'un seul appel
// ---------------------------------------------------------------------------
function kanbanToText(doc){
  const k = doc && doc.kanban;
  if(!k || !Array.isArray(k.cols) || !k.cols.length) return "";
  const cols = k.cols.map(c => "“" + c.name + "” (" + c.id + (c.done ? ", done" : "") + (c.wip ? ", WIP " + c.wip : "") + ")").join(" · ");
  const tags = (k.tags && typeof k.tags === "object") ? Object.entries(k.tags)
    .filter(([key, v]) => KB_TAG_KEYS.includes(key) && typeof v === "string" && v.trim())
    .map(([key, v]) => key + " = “" + v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, 40) + "”") : [];
  return "\n\n🃏 Kanban columns: " + cols + (tags.length ? "\n🏷 Labels: " + tags.join(", ") : "")
    + "\n(Cards are the nodes marked ⟪column: …⟫. Move one with propose_changes op \"move\" and `col` = a column name or id; a ticked card [x] shows in the done column.)";
}
function kbTagNames(doc){
  const t = doc && doc.kanban && doc.kanban.tags;
  const out = {};
  if(t && typeof t === "object") for(const k of KB_TAG_KEYS) if(typeof t[k] === "string" && t[k].trim()) out[k] = t[k].trim().slice(0, 40);
  return out;
}
// Une durée en SECONDES, depuis les formes que `parseDur` lit dans l'app (« 2h », « 1h30 », « 45 »
// = minutes, « 2:15 », « 30m », « 90s »). L'estimation d'un nœud est stockée en secondes (`okSecs`).
function durSecs(v){
  const q = String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, "");
  if(!q || !DUR_RE.test(q)) return null;
  let m;
  if((m = /^(\d+):([0-5]\d)$/.exec(q))) return (+m[1] * 60 + +m[2]) * 60;
  if((m = /^(\d+)h(\d+)?m?$/.exec(q))) return (+m[1] * 60 + (+m[2] || 0)) * 60;
  if((m = /^(\d+)m(in)?$/.exec(q))) return +m[1] * 60;
  if((m = /^(\d+)s(ec)?$/.exec(q))) return +m[1];
  return +q * 60;
}
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// Un identifiant sur chaque nœud créé : l'app en donnerait un à l'ouverture, mais la signature du
// document changerait alors entre le serveur et l'app (un aller-retour de synchro pour rien), et
// une proposition suivante ne pourrait viser une carte que par son texte.
function assignIds(n){ if(!n.id) n.id = "n" + Math.random().toString(36).slice(2, 12); (n.children || []).forEach(assignIds); return n; }
// Les colonnes demandées, validées et munies d'ids — même forme qu'`okKanbanCols` côté app.
function kanbanColsFrom(list, where){
  const src = Array.isArray(list) && list.length ? list : [{ name:"To do" }, { name:"Doing" }, { name:"Done", done:true }];
  if(src.length > 12) throw new Error(where + ": a kanban has 12 columns at most.");
  const cols = src.map((k, j)=>{
    const name = String((k && (k.name != null ? k.name : k)) || "").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 60);
    if(!name) throw new Error(where + ": column #" + (j+1) + " has no name.");
    const wip = parseInt(k && k.wip, 10);
    return Object.assign({ id: "c" + (j+1), name }, k && k.done ? { done: true } : {}, (wip >= 1 && wip <= 99) ? { wip } : {});
  });
  if(cols.filter(k => k.done).length > 1) throw new Error(where + ": only one column can be the \"done\" column.");
  return cols;
}
// UN appel, un tableau complet : colonnes, cartes, et sur chaque carte ce que l'app affiche au recto
// et au dos — responsable, dates, priorité, étiquettes, estimation, levier Ai4X, note, lien,
// sous-tâches. Tout passe par les mêmes bornes que les propositions : une carte qui serait refusée
// par l'app à l'ouverture est refusée ICI, en le disant.
function buildKanbanDoc(args){
  const name = String(args.name || "").trim() || "Kanban";
  const cols = kanbanColsFrom(args.columns, "columns");
  const work = cols.filter(k => !k.done), done = cols.find(k => k.done) || null;
  const firstWork = (work[0] || cols[0]).id;
  const colOf = (raw, where)=>{
    if(raw == null || raw === "") return firstWork;
    const v = String(raw).trim().toLowerCase();
    const hit = cols.find(k => k.id === String(raw)) || cols.find(k => k.name.toLowerCase() === v);
    if(!hit) throw new Error(where + ": no column \"" + raw + "\". Columns: " + cols.map(k => "“" + k.name + "”").join(", ") + ".");
    return hit.id;
  };
  const cards = Array.isArray(args.cards) ? args.cards : [];
  if(cards.length > 300) throw new Error("A kanban created in one call holds 300 cards at most — create it, then add more with propose_changes.");
  const root = makeNode(name);
  root.color = "#dbeafe";
  cards.forEach((c, i)=>{
    const where = "card #" + (i+1);
    const text = String((c && c.text) || "").replace(/[\x00-\x1f\x7f]/g, " ").trim();
    if(!text) throw new Error(where + ": `text` is required.");
    const n = makeNode(text.slice(0, 2000));
    const col = colOf(c.column, where);
    if(done && col === done.id){ n.col = firstWork; n.check = true; }     // la règle de l'app : Done COCHE, la colonne reste de travail
    else { n.col = col; n.check = false; }
    if(c.note != null){ if(typeof c.note !== "string") throw new Error(where + ": `note` must be text."); n.note = c.note.slice(0, 8000); }
    if(c.link){
      const l = String(c.link).trim();
      if(!/^(https?:\/\/[^\s\x00-\x1f]+|mailto:[^\s\x00-\x1f]+|map:[A-Za-z0-9_]+)$/i.test(l)) throw new Error(where + ": `link` must be an https:// or mailto: address, or map:<file>.");
      n.link = l;
    }
    if(c.assign){
      if(typeof c.assign !== "string" || c.assign.length > 120 || /[\x00-\x1f\x7f]/.test(c.assign)) throw new Error(where + ": `assign` must be a name or e-mail (120 characters max).");
      n.assign = c.assign.trim();
    }
    for(const k of ["start", "due"]) if(c[k]){ if(!DAY_RE.test(String(c[k]))) throw new Error(where + ": `" + k + "` must be YYYY-MM-DD."); n[k] = String(c[k]); }
    if(n.start && n.due && n.due < n.start){ const t = n.start; n.start = n.due; n.due = t; }   // la règle du fichier : remis en ordre, pas refusé
    if(c.priority != null && c.priority !== 0){
      if(!Number.isInteger(c.priority) || c.priority < 1 || c.priority > 6) throw new Error(where + ": `priority` must be 1 (highest) to 6.");
      n.priority = c.priority;
    }
    const tags = c.labels != null ? c.labels : c.tags;
    if(tags != null){
      if(!Array.isArray(tags)) throw new Error(where + ": `labels` must be a list of colours.");
      const bad = tags.filter(t => !KB_TAG_KEYS.includes(t));
      if(bad.length) throw new Error(where + ": unknown label colour \"" + bad[0] + "\". Use any of: " + KB_TAG_KEYS.join(", ") + ".");
      if(tags.length) n.tags = KB_TAG_KEYS.filter(k => tags.includes(k));
    }
    if(c.est != null && c.est !== ""){
      const sec = durSecs(c.est);
      if(sec == null) throw new Error(where + ": `est` must be a duration — \"2h\", \"1h30\", \"45\" (minutes) or \"2:15\".");
      if(sec > 0) n.est = sec;
    }
    if(c.pic){ if(!okPic(String(c.pic))) throw new Error(where + ": `pic` must be \"a:<id>\" (" + ART_IDS_MCP.slice(0, 8).join(", ") + "…) or \"e:<emoji>\"."); n.pic = String(c.pic); }
    // Les sous-tâches sont des ENFANTS cochables, sans colonne — la règle du dos de la carte
    // (`kbAddSub`) : jamais des cartes sœurs.
    const subs = Array.isArray(c.subtasks) ? c.subtasks : [];
    if(subs.length > 50) throw new Error(where + ": 50 sub-tasks at most.");
    for(const t of subs){
      const st = String(t || "").replace(/[\x00-\x1f\x7f]/g, " ").trim();
      if(!st) continue;
      const k = makeNode(st.slice(0, 2000)); k.check = false; n.children.push(k);
    }
    // Le levier Ai4X : un attribut « Lever: <clé> », exactement ce que pose le dos de la carte.
    if(c.lever){
      const lv = String(c.lever).trim().toLowerCase();
      if(!KB_LEVER_KEYS_MCP.includes(lv)) throw new Error(where + ": `lever` must be one of " + KB_LEVER_KEYS_MCP.join(", ") + ".");
      n.children.push(makeNode("Lever: " + lv));
    }
    root.children.push(n);
  });
  assignIds(root);
  const kanban = { cols };
  const names = {};
  if(args.labels && typeof args.labels === "object") for(const k of KB_TAG_KEYS) if(typeof args.labels[k] === "string" && args.labels[k].trim()) names[k] = args.labels[k].replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 40);
  if(Object.keys(names).length) kanban.tags = names;
  const doc = { v:1, root, images:[], stickies:[], kanban };
  const st = okStyleMcp(args.style);
  if(st) doc.style = st;
  return doc;
}

// ---------------------------------------------------------------------------
// 🏁 LA RÉCOLTE D'UNE CONVERSATION (1.6.0, 2026-10-20) — docs/second-brain-harvest-spec.md
// ---------------------------------------------------------------------------
// À la fin d'une conversation, Claude envoie ce qui mérite d'être gardé — faits, décisions, leçons — et
// la personne le range d'un clic. Trois règles portent tout :
//  · JAMAIS SANS CLIC. Toute la récolte part à la revue (`review`), marquée `origin: "harvest"`, et l'app
//    refuse de l'appliquer seule même si chaque op est dans PROP_AUTO_OPS (`propAutoOk`). L'appel d'outil
//    est fait par le MODÈLE, qui a pu lire une page qui lui dicte quoi envoyer : rien de ce qu'il envoie ne
//    devient un FAIT sans un geste dans l'app.
//  · LE LOT ENTIER OU RIEN. Un élément invalide fait échouer l'appel, en le nommant : une récolte est
//    petite et la personne l'a vue dans la conversation — mieux vaut la corriger que la ranger à moitié.
//  · UN ESPACE PAR APPEL. Les faits ne traversent pas les domaines ; les LEÇONS, elles, vont toujours dans
//    la carte « 🌱 Lessons » de Personal : la pensée appartient à la personne.
// Les entrées ont la grammaire de 📚 File it (`kbFileEntry`) : un titre, une note qui finit par sa
// provenance, des attributs « Nom: valeur » en enfants, rien de coché (une case recopiée serait une tâche
// FANTÔME dans My work).
// ≡ `KNOW_NAME` et `KNOW_DEFAULT` d'app/index.html (le test compare) : le connecteur cherche la carte de
// connaissance par ce NOM — la marque `know` est un champ d'index du compte, qu'il ne lit pas encore — et
// la crée avec ces sections quand l'espace n'en a pas.
const KNOW_NAME = "Company knowledge";
const KNOW_DEFAULT = ["🔑 Access — who has what", "🌐 Domains & infrastructure", "🧰 Tools & subscriptions",
                        "💼 Clients & deals", "📖 Playbooks", "⚖️ Decisions"];
const LESSONS_NAME = "🌱 Lessons";
const HARVEST_MAX = 12;
// ≡ app/index.html, comparés caractère par caractère par le test : un secret que l'app retirerait au
// rangement et que le connecteur aurait laissé partir serait déjà dans la table `proposals`.
const KB_SECRET_RES = [
    /\b(pass(word|wd|code|phrase)|pwd|mdp|mot de passe|secret|api[ _-]?key|token)\s*[:=]/i,
    /\b(sk-(ant-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{12,}|xox[abpr]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{20,})/,
    /\bBearer [A-Za-z0-9._~+\/-]{12,}/i
  ];
function kbSecretLike(line){
    const s = String(line == null ? "" : line);
    if(KB_SECRET_RES.some(re => re.test(s))) return true;
    for(const w of s.split(/\s+/)){
      if(w.length >= 32 && !/^(https?:|mailto:|map:|fsref:)/i.test(w) && /^[A-Za-z0-9._~+\/=-]+$/.test(w)
         && /[A-Za-z]/.test(w) && /[0-9]/.test(w)) return true;
    }
    return false;
  }
function knowNorm(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
const hvSame = (a, b)=>knowNorm(a).trim() === knowNorm(b).trim();
// Un texte d'une ligne, borné. `[` et `]` deviennent des parenthèses dans ce qui passe par le markdown d'un
// `add` : « [x] » y serait lu comme une case, « [a](b) » comme un lien.
function hvLine(v, max){ return (typeof v === "string") ? v.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
function hvMd(v){ return String(v).replace(/\[/g, "(").replace(/\]/g, ")"); }
// Un JOUR qui existe : la forme (`DAY_RE`) puis l'aller-retour par le calendrier — le piège du 30 février,
// payé par 🏁 Harvest côté app.
function hvDayOk(s){ if(!DAY_RE.test(s)) return false; const d = new Date(s + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === s; }
const okNid = v=>typeof v === "string" && /^[A-Za-z0-9_]{1,40}$/.test(v);
// Le document d'une carte de connaissance (ou de leçons) NEUVE : celui que `kbKnowCreate` écrirait.
function hvNewDoc(name, sections){
  const root = makeNode(name);
  root.color = "#dbeafe";
  root.children = sections.map(t=>makeNode(t));
  assignIds(root);
  return { v:1, root, images:[], stickies:[] };
}
// La carte la plus récente qui porte EXACTEMENT ce nom dans une portée (propriétaire + espace ; Personal =
// pas d'espace), jamais un board, un kanban, un tableur ni un Gantt — la règle de `kbKnowMapId`.
function hvFindMap(lib, owner, spaceKey, name){
  return lib.filter(m=>m.owner === owner && (m.spaceKey || null) === (spaceKey || null)
                    && (m.kind === "map" || m.kind === "note") && hvSame(m.name, name))
            .sort((x, y)=>String(y.updatedAt).localeCompare(String(x.updatedAt)))[0] || null;
}
// Les ops d'UNE carte : un état de travail (la carte telle que les ops précédentes la laissent) et la liste.
function hvTarget(doc){ return { seed: doc, doc: cloneDoc(doc), ops: [] }; }
// Une op qui vise un nœud : par son ID quand il en a un valide (exact, jamais ambigu), avec le chemin
// lisible pour le panneau ; sinon par le chemin seul.
function hvAt(node, path){ return Object.assign(okNid(node.id) ? { node: node.id } : {}, { target: path.slice(0, 600) }); }
// La section d'une carte de connaissance, par son nom (casse et accents ignorés, la règle de
// `kbKnowSection`) ; absente, elle est AJOUTÉE par une op de section, une seule fois par appel. Elle ne
// porte pas de `hv` : deux éléments peuvent y aller, et décocher l'un ne doit pas retirer l'autre.
function hvSection(t, name){
  const root = t.doc.root;
  const hit = (root.children || []).find(c=>hvSame(c.text, name));
  if(hit) return hit;
  const nid = newNid();
  const node = Object.assign(makeNode(name), { id: nid });
  root.children = (root.children || []).concat([node]);
  t.ops.push(Object.assign({ op:"add" }, hvAt(root, String(root.text || "")), { markdown: "- " + hvMd(name), text: name, nid, adds: 1, why: "New section of your " + KNOW_NAME }));
  return node;
}
function hvFindEntry(section, text){ return (section.children || []).find(c=>hvSame(c.text, text)) || null; }

// ---------------------------------------------------------------------------
// Définition des outils
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "list_maps",
    description: "Lists every mind map, kanban, note and board in the TabTree library — the user's own and those of the team spaces they belong to (name, type, space, folder, size, last modified).",
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
    description: "Creates a NEW TabTree mind map from a markdown outline (#/## headings, bullet lists indented by 2 spaces, [x]/[ ] checkboxes, [title](url) links, and \" @a:<id>\" / \" @e:<emoji>\" at the end of a line for an illustration). The first top-level line becomes the centre. SCREENSHOTS: pass `images` — a list of { target, file } where `file` is the path of a PNG/JPEG on this machine (a screenshot you saved) and `target` the exact text of the node it goes on; the picture is re-encoded to fit and drawn as the node's cover. Writes a .tabtree file into the backup folder; the user pulls it into the app from the 🛟 menu.",
    inputSchema: { type:"object", properties:{
      name:{ type:"string", description:"Name of the map" },
      markdown:{ type:"string", description:"Markdown outline (headings and/or bullet list). End any line with \" @a:<id>\" to give that node a built-in illustration, or \" @e:<emoji>\" for one large emoji — e.g. \"Launch @a:rocket\". Ids: person, team, chat, idea, target, trophy, star, heart, warning, done, flag, clock, laptop, phone, mail, folder, book, chart, money, calendar, building, car, globe, rocket, house, pin, plane, coffee, plant, sun, camera, music, lock, key, health, gift. An unknown id is left as plain text rather than dropped." },
      folder:{ type:"string", description:"Optional TabTree folder. A NAME (\"From Claude\") or a full PATH (\"Ai4X / Programmes\"). When several folders share a name, the shallowest is used and the answer says which — pass the full path to choose another." },
      space:{ type:"string", description:"Optional TabTree SPACE to put it in, by name — one of the user's spaces, or a TEAM space they are an editor of (every member then sees it). list_maps shows the spaces. Omit for the user's own library." },
      view:{ type:"string", enum:["map","note","gantt"], description:"How TabTree opens it: map (default, a mind map), note (a page of text — the outline becomes headings and paragraphs, for meeting notes or a document), gantt (a timeline — give `dates`). It stays one document: the user can switch views at any time." },
      dates:{ type:"array", description:"Optional start/due days on nodes — what the Gantt view draws (and what the kanban and calendar show). One entry per node.", items:{ type:"object", properties:{
        target:{ type:"string", description:"Exact node text, or \"Ancestor > Node\"" },
        start:{ type:"string", description:"YYYY-MM-DD" },
        due:{ type:"string", description:"YYYY-MM-DD" }
      }, required:["target"], additionalProperties:false } },
      images:{ type:"array", description:"Optional screenshots, one per node: { target, file } or { target, data }. `target` = the exact text of a line of the outline (or \"Ancestor > Node\" when the wording repeats); `file` = full path of a PNG/JPEG/WebP/GIF on this machine (take the screenshot, save it, pass the path); `data` = a data:image/… URL instead of a file. The image is re-encoded to about 840 px and becomes the node's cover picture (it replaces any @a:/@e: illustration on that node). 60 max.", items:{ type:"object", properties:{
        target:{ type:"string", description:"Exact node text, or \"Ancestor > Node\"" },
        file:{ type:"string", description:"Path of the image file on this machine" },
        data:{ type:"string", description:"A data:image/(png|jpeg|webp|gif);base64,… URL — instead of `file`" }
      }, required:["target"], additionalProperties:false } },
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
    description: "Creates a NEW TabTree board (whiteboard): shapes (rect, ellipse, diamond, text, sticky), IMAGES (kind \"image\" with a `file` path — your logos, photos, posters, placed where you say) and arrow connections that stay anchored to the shapes in the app. With no x/y coordinates, layout is automatic by level (the connections define the hierarchy, left to right). Good for a diagram, a flow, a brainstorm. In a flowchart use ellipse for start/end, rect for a step, and diamond for a decision — its text should read as a closed question with exactly two ways out.\n\nFIT THE TEXT TO THE BOX. A box shows roughly (w−24)/7 characters per line and (h−10)/20 lines, and every blank line costs a full line. Write captions, not paragraphs: when filling a canvas template (Business Model Canvas, Lean Canvas, SWOT…), the shipped templates use 70–110 characters per block, and that is what looks composed. Longer text is shrunk to fit — nothing ever spills out — but past ~11px it stops being readable and the response will warn you.",
    inputSchema: { type:"object", properties:{
      name:{ type:"string", description:"Name of the board" },
      elements:{ type:"array", description:"Board elements", items:{ type:"object", properties:{
        id:{ type:"string", description:"Logical id used by connections (defaults to the index)" },
        kind:{ type:"string", enum:["rect","ellipse","diamond","trap","chev","arc","text","sticky","image"], description:"Type (defaults to rect). image = a PICTURE placed freely on the board — a logo, a photo, a poster: give `file` (full path of a PNG/JPEG/WebP/GIF/SVG on this machine) or `data` (a data:image/… URL); w/h keep the image's proportions when only one (or neither, 220 px on the long side) is given; arrows can start or end on it; `text` is ignored. diamond = a decision in a flowchart, trap = a pyramid/funnel tier (tk = small-side ratio, negative when the base is the narrow side), chev = a process step pointing forward, arc = a pie slice (a0/a1 in degrees from 12 o'clock, ir = inner-radius fraction for a donut)." },
        text:{ type:"string" },
        x:{ type:"number" }, y:{ type:"number" }, w:{ type:"number" }, h:{ type:"number" },
        color:{ type:"string", description:"Hex fill colour (shapes) or sticky-note colour" },
        size:{ type:"number", description:"Text size 9-72 (defaults to 15)" },
        pic:{ type:"string", description:"Optional picture drawn INSIDE the element, no file needed — \"a:<id>\" for a built-in illustration (roles: manager, client, expert, assistant, coach, learner, developer, seller, support, speaker, freelancer, group — plus person, team, idea, target, rocket…) or \"e:<emoji>\". Not on arc/trap/chev." },
        tk:{ type:"number", description:"trap only — small-side/large-side ratio, 0..0.95 (0 = triangle); NEGATIVE puts the narrow side at the bottom (funnel tier)" },
        a0:{ type:"number", description:"arc only — start angle in degrees, 0 at 12 o'clock, clockwise" },
        a1:{ type:"number", description:"arc only — end angle in degrees (a1 > a0; a full circle is a0=0, a1=360)" },
        ir:{ type:"number", description:"arc only — inner-radius fraction 0..0.9 (0 = pie slice, 0.55 = donut)" },
        file:{ type:"string", description:"image only — full path of a PNG/JPEG/WebP/GIF/SVG file on this machine. Rasters are re-encoded to about 840 px; an SVG is kept as is (300 KB max)." },
        data:{ type:"string", description:"image only — a data:image/(png|jpeg|webp|gif|svg+xml) URL instead of a file" },
        z:{ type:"number", description:"Stacking order, -9..9 (default 0). At equal z the app paints images UNDER shapes, shapes under sticky notes — so a filled background panel hides a logo placed on it. Give such a panel z:-1 (or the image z:1) to keep the picture visible." }
      }, additionalProperties:false } },
      connections:{ type:"array", description:"Arrows anchored between elements (by id)", items:{ type:"object", properties:{
        from:{ type:"string" }, to:{ type:"string" }
      }, required:["from","to"], additionalProperties:false } },
      folder:{ type:"string", description:"Optional TabTree folder. A NAME or a full PATH (\"Ai4X / Programmes\"). When several folders share a name, the shallowest is used and the answer says which." },
      space:{ type:"string", description:"Optional TabTree SPACE to put it in, by name — one of the user's spaces, or a TEAM space they are an editor of (every member then sees it). list_maps shows the spaces. Omit for the user's own library." },
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
    name: "create_kanban",
    description: "Creates a NEW TabTree kanban board in one call — columns and cards, each card with what TabTree shows on it: owner, start/due days, priority, colour labels, time estimate, Ai4X lever, note (links in it become clickable — a Google Meet link, a doc), a link, and sub-tasks. It opens directly as a kanban in TabTree, on every device signed in to the account, and in a TEAM space every member sees it. To add or move cards on an EXISTING kanban, use propose_changes instead.",
    inputSchema: { type:"object", properties:{
      name:{ type:"string", description:"Name of the board (e.g. \"Sprint W43\", \"Launch\")" },
      columns:{ type:"array", description:"The columns, left to right. Omit for To do / Doing / Done. Mark ONE column done:true: a card put there is ticked, and unticking it sends it back. 12 max.", items:{ type:"object", properties:{
        name:{ type:"string" }, done:{ type:"boolean" }, wip:{ type:"integer", description:"Optional work-in-progress limit 1–99 (the column turns red above it — nothing is blocked)" }
      }, required:["name"], additionalProperties:false } },
      cards:{ type:"array", description:"The cards, in order within each column. 300 max.", items:{ type:"object", properties:{
        text:{ type:"string", description:"The card's title" },
        column:{ type:"string", description:"Column NAME (or id). Default: the first column" },
        assign:{ type:"string", description:"Owner — a name or e-mail" },
        start:{ type:"string", description:"YYYY-MM-DD" },
        due:{ type:"string", description:"YYYY-MM-DD" },
        priority:{ type:"integer", description:"1 (highest) to 6" },
        labels:{ type:"array", items:{ type:"string" }, description:"Colour labels from: green, yellow, orange, red, purple, blue, sky, lime, pink, gray (name them with `labels` at the board level)" },
        est:{ type:"string", description:"Time estimate: \"2h\", \"1h30\", \"45\" (minutes), \"2:15\"" },
        lever:{ type:"string", enum:["human","think","accelerate","automate"], description:"Ai4X lever: human (stays human), think (think with Claude), accelerate (Claude Code or a connector), automate (a skill or a scheduled task)" },
        note:{ type:"string", description:"The back of the card — plain text; http(s) and mailto links become clickable" },
        link:{ type:"string", description:"An https:// or mailto: link on the card, or map:<file> to open another map from list_maps" },
        subtasks:{ type:"array", items:{ type:"string" }, description:"Sub-tasks, ticked on the back of the card (the card shows n/m)" },
        pic:{ type:"string", description:"\"a:<id>\" built-in illustration or \"e:<emoji>\"" }
      }, required:["text"], additionalProperties:false } },
      labels:{ type:"object", description:"Optional names for the colour labels, e.g. { \"red\": \"Bug\", \"green\": \"Quick win\" }", additionalProperties:{ type:"string" } },
      folder:{ type:"string", description:"Optional folder, by NAME or full PATH." },
      space:{ type:"string", description:"Optional TabTree SPACE to put it in, by name — one of the user's spaces, or a TEAM space they are an editor of (every member then sees it). list_maps shows the spaces. Omit for the user's own library." },
      style:{ type:"object", description:"Optional look (same keys as create_mindmap: font, background, skin…).", additionalProperties:true }
    }, required:["name"], additionalProperties:false }
  },
  {
    name: "propose_changes",
    description: "Changes an EXISTING mind map or kanban (also one in a team space). HYBRID, by design: SAFE changes — add cards or branches, move a card to a column, tick it, set its owner, dates, priority, labels, estimate, Ai4X lever, an attribute, a link, a comment, a picture, and set up the columns of a board that has none — are APPLIED BY TABTREE ITSELF within seconds when TabTree is open on one of the user's devices (otherwise the next time it opens), and Cmd+Z undoes them. Changes that rewrite or remove what someone wrote — rename, note, delete, replacing existing columns, a persona re-cast — appear as a banner for the user to review and approve. In one call, the safe changes BEFORE the first review-only change apply by themselves and the rest goes to review, in order. Name each target node by its exact text, or by a path \"Ancestor > Node\" when the same wording appears twice; a later change may target a node added earlier in the same call. Read the map first so the wording matches.",
    inputSchema: { type:"object", properties:{
      file:{ type:"string", description:"The map to change — a file name (or map name) from list_maps" },
      note:{ type:"string", description:"One line telling the user what this proposal does and why. Shown above the changes." },
      changes:{ type:"array", description:"The proposed changes, applied in order", items:{ type:"object", properties:{
        op:{ type:"string", enum:["add","rename","note","check","delete","move","pic","img","persona","tags","assign","priority","due","start","attr","comment","est","lever","link","columns"], description:"columns = set the kanban columns (give `columns`; no target) — on a map with no kanban yet this creates the board; add = new children under `target`; rename = change its text; note = set its note; check = tick/untick the task; delete = remove it and its children; move = send the card to a kanban column; pic = put an illustration on it; img = put a SCREENSHOT on it (give `file`, the path of the image on this machine — or `data`; `img: \"\"` removes it); persona = re-cast a work map canvas (a board whose name starts with “Work map —” / “Cartographie —”) or a Second Brain Blueprint (“Second brain —”) from an interview — no target; tags = set the card's colour labels; assign = who the task is for; priority = 1 (highest) to 6; due = the due day; attr = set a “Name: value” attribute on the node (an estimate, a budget…); comment = add a signed comment to the card's thread (give `text`); est = set the time ESTIMATE of the task (give `est`, e.g. \"2h\", \"45\" = 45 minutes, \"\" removes it); start = the start day; lever = the card's Ai4X lever (give `lever`); link = put a link on the node (give `link`)" },
        target:{ type:"string", description:"Exact node text, or \"Ancestor > Node\" if ambiguous (not used by persona)" },
        persona:{ type:"object", description:"persona: the interview object exactly as the skill returns it — who, role, mission, tools, meetings, opener, modules[{name, procs[{name,h,after,freq,rep,data,stakes,lever,step,why}]}], trajectory, signs, parking. TabTree rebuilds the canvas AND its companion sheet from it." },
        markdown:{ type:"string", description:"add: the new branch as a bullet list, 2 spaces per level" },
        text:{ type:"string", description:"rename: the new text. comment: the comment body (plain text; http/mailto links become clickable)" },
        note:{ type:"string", description:"note: the note body (empty string clears it)" },
        col:{ type:"string", description:"move: the kanban column — its NAME (\"Doing\") or id, both shown by read_map — or \"\" to take the card off the board. add: optional — the column the NEW cards go to" },
        columns:{ type:"array", description:"columns: the board's columns left to right — [{ name, done?, wip? }]; mark ONE done:true. Existing columns keep their cards when their name is kept", items:{ type:"object", properties:{ name:{ type:"string" }, done:{ type:"boolean" }, wip:{ type:"integer" } }, required:["name"], additionalProperties:false } },
        start:{ type:"string", description:"start: the start day as YYYY-MM-DD (\"\" removes it)" },
        lever:{ type:"string", description:"lever: human, think, accelerate or automate (\"\" removes it)" },
        link:{ type:"string", description:"link: an https:// or mailto: address, or map:<file> to open another map (\"\" removes it)" },
        pic:{ type:"string", description:"pic: \"a:<id>\" for a built-in illustration, or \"e:<emoji>\" for one large emoji, or \"\" to remove it. Ids: person, team, chat, idea, target, trophy, star, heart, warning, done, flag, clock, laptop, phone, mail, folder, book, chart, money, calendar, building, car, globe, rocket, house, pin, plane, coffee, plant, sun, camera, music, lock, key, health, gift." },
        file:{ type:"string", description:"img: full path of the screenshot (PNG/JPEG/WebP/GIF) on this machine. It is re-encoded to about 840 px and becomes the node's cover picture." },
        data:{ type:"string", description:"img: a data:image/…;base64 URL instead of `file`" },
        img:{ type:"string", description:"img: pass \"\" to REMOVE the screenshot from that node (otherwise give `file` or `data`)" },
        tags:{ type:"array", items:{ type:"string" }, description:"tags: the colour labels to set, from: green, yellow, orange, red, purple, blue, sky, lime, pink, gray — read_map shows the name the board gave each colour. [] clears them." },
        assign:{ type:"string", description:"assign: a name or e-mail (\"\" clears it). add: optional — the owner of the NEW cards. When read_map shows a 👥 Team, pick from it, by role, what each person owns and their objectives" },
        why:{ type:"string", description:"Any change: optional — one short line saying WHY (e.g. \"Owns the website\"). Shown to the user next to the change, so they can judge it" },
        priority:{ type:"integer", description:"priority: 1 (highest) to 6, or 0 to remove it" },
        due:{ type:"string", description:"due: the due day as YYYY-MM-DD (\"\" removes it)" },
        name:{ type:"string", description:"attr: the attribute's name, e.g. \"Estimate\"" },
        // ⚠️ UNE seule déclaration de `value` (1.5.0) : il y en avait deux (booléen pour check, texte pour
        // attr) et la seconde écrasait la première — le schéma disait donc « texte » pour un check, et
        // Claude envoyait "true", que le contrôle d'un check refuse.
        value:{ type:["boolean","string"], description:"check: true to tick, false to untick. attr: its value as text, e.g. \"2h\" (\"\" removes the attribute)" },
        est:{ type:"string", description:"est: the estimate as a duration — \"2h\", \"1h30\", \"45\" (minutes), \"2:15\" — or \"\" to remove it" }
      }, required:["op"], additionalProperties:false } }
    }, required:["file","changes"], additionalProperties:false }
  },
  {
    // 🏁 1.6.0. La description porte la règle de déclenchement : c'est elle que Claude lit au moment de choisir.
    name: "harvest",
    description: "Keeps what matters from THIS conversation in the user's TabTree second brain: facts, decisions and lessons. Call it ONLY after you listed the items to the user in the conversation and they agreed — then once. Nothing is filed until the user accepts it in TabTree (a banner, on any of their devices). Use it when the user ends a conversation (thanks, \"that's all\", \"ok bye\") or right after a decision was made. Facts and decisions go to the \"Company knowledge\" map of ONE space (created if the space has none); lessons always go to the user's \"🌱 Lessons\" map in Personal. Never for tasks (use propose_changes or create_kanban). Never a password, key or token. If nothing is worth keeping, call it with nothing: true and tell the user so.",
    inputSchema: { type:"object", properties:{
      space:   { type:"string", description:"The space the conversation was about, by name (list_maps shows them). Omit for Personal. If two spaces could apply, ASK the user — never guess: facts never cross between spaces." },
      title:   { type:"string", description:"One line naming the conversation, e.g. \"Discount request — Batimar\". Shown in TabTree and written as the source of every entry." },
      nothing: { type:"boolean", description:"true when nothing is worth keeping — then send no items." },
      items:   { type:"array", description:"What to keep, 12 at most.", items:{ type:"object", properties:{
        kind:    { type:"string", enum:["fact","decision","lesson"], description:"fact = what is true today (a price, an access, a client's answer); decision = what was decided, appended and never rewritten; lesson = what the user learned, reusable anywhere." },
        text:    { type:"string", description:"The entry's title: one sentence that stays true on its own, without the conversation. 300 characters max." },
        detail:  { type:"string", description:"Optional: what a reader needs in six months. 1500 characters max." },
        section: { type:"string", description:"fact only, required: the section of the Company knowledge map — its EXACT name when it exists (read_map shows them; the defaults are " + KNOW_DEFAULT.map(s=>"\"" + s + "\"").join(", ") + "), or a new name to create one." },
        updates: { type:"string", description:"fact only: the EXACT text of the entry of that section this fact replaces (its new value). Omit for a new entry." },
        signal:  { type:"string", description:"decision only: the observable sign that will say whether it was right, e.g. \"Q4 margins back above 22%\"." },
        check_on:{ type:"string", description:"decision only: YYYY-MM-DD, the day to look at the signal." },
        replaces:{ type:"string", description:"decision only: the EXACT text of an earlier decision this one supersedes. The earlier one is kept." },
        why:     { type:"string", description:"One short line: why keep it. Shown next to the item when the user reviews it." }
      }, required:["kind","text"], additionalProperties:false } }
    }, additionalProperties:false }
  }
];

const HANDLERS = {
  async list_maps(){
    const maps = await loadLibrary();
    if(!maps.length) return CLOUD ? "This TabTree account has no maps yet." : "The library is empty (or TABTREE_DIR points at the wrong folder: " + DIR + ").";
    const lines = maps.map(m=>
      `• ${m.name}  [${m.kind}]${m.space ? "  " + (m.team ? "👥 " : "◻︎ ") + m.space + (m.team ? " (" + m.role + ")" : "") : ""}${m.folder ? "  📁 " + m.folder : ""}${m.tabOf ? "  ↳ tab of “" + m.tabOf + "”" : ""}\n  file: ${m.file}\n  ${m.kind==="board" ? m.elements + " elements" : m.nodes + " nodes"} · modified ${m.mtime}`
    );
    // Les espaces où Claude peut créer (`space` des outils de création) — y compris ceux qui sont VIDES,
    // qu'aucune carte ne ferait apparaître dans la liste.
    const sps = CLOUD && cloudSpacesCache && cloudSpacesCache.length
      ? "\n\nSpaces: " + cloudSpacesCache.map(x=>"“" + x.name + "”" + (x.role !== "owner" ? " (team, " + x.role + (x.writable ? "" : ", read-only") + ")" : "")).join(", ")
      : "";
    return lines.join("\n") + sps;
  },
  async read_map(args){
    checkRelPath(args.file);
    const all = await loadLibrary();
    const m = all.find(x=>x.file===args.file) || all.find(x=>x.file.endsWith(args.file)) || all.find(x=>x.name===args.file);
    if(!m) throw new Error("No such map: " + args.file + ". Use list_maps to see what is available.");
    const head = `${m.name} [${m.kind}]${m.space ? " — space “" + m.space + "”" + (m.team ? " (team, " + m.role + ")" : "") : ""} — file: ${m.file}\n`;
    if(m.kind === "board") return head + boardToText(m.doc);
    // Les cartes qu'un lien `map:` peut ouvrir, par l'id que l'app leur donne (clé, ou id d'équipe).
    const maps = new Map();
    for(const x of all){ maps.set(x.file, { name: x.name, kind: x.kind }); if(x.key) maps.set(x.key, { name: x.name, kind: x.kind }); }
    const ctx = { cols: (m.doc.kanban && Array.isArray(m.doc.kanban.cols)) ? m.doc.kanban.cols : [], tagNames: kbTagNames(m.doc), maps };
    // Le rappel sur propose_changes vit ici et pas dans la description de l'outil : c'est au
    // moment où le plan est sous les yeux qu'il est utile, et il porte la règle de désignation.
    const ro = m.team && m.role === "viewer";
    return head + nodeToMarkdown(m.doc.root, 0, ctx) + kanbanToText(m.doc) + teamToText(m.doc)
      + (ro ? "\n\n(You can read this team map but not change it — the user's role in its space is viewer.)"
            : "\n\n(To change this map, use propose_changes with `file: \"" + m.file + "\"`. Name a node by the exact text above, or \"Ancestor > Node\" when it appears twice. "
              + (CLOUD ? "Safe changes (add, move, tick, owner, dates, labels, lever…) are applied by TabTree itself; rename, note and delete wait for the user's approval.)"
                       : "Nothing is applied until the user approves it in TabTree.)"));
  },
  async search_maps(args){
    const q = String(args.query||"").toLowerCase();
    if(!q) throw new Error("`query` is empty.");
    const hits = [];
    for(const m of await loadLibrary()){
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
  async create_mindmap(args){
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
    // Les captures d'écran APRÈS les marqueurs : une désignation se retire du texte avant que le
    // texte serve de cible, et une capture remplace l'illustration du même nœud.
    const shots = applyImages(root, args.images);
    // Les DATES (1.5.0) : ce que la vue Gantt dessine. Une cible introuvable ou ambiguë est refusée
    // en le disant — une date posée sur le mauvais nœud fausserait toute la frise.
    const dated = [];
    if(args.dates != null){
      if(!Array.isArray(args.dates)) throw new Error("`dates` must be a list of { target, start, due }.");
      args.dates.forEach((d, i)=>{
        const where = "dates #" + (i+1);
        const r = propFind(root, String((d && d.target) || ""));
        if(r.error === "empty") throw new Error(where + ": `target` is required.");
        if(r.error === "missing") throw new Error(where + ": no node \"" + d.target + "\" in this outline.");
        if(r.error === "ambiguous") throw new Error(where + ": \"" + d.target + "\" matches " + r.count + " nodes — use \"Ancestor > Node\".");
        for(const k of ["start", "due"]) if(d[k]){ if(!DAY_RE.test(String(d[k]))) throw new Error(where + ": `" + k + "` must be YYYY-MM-DD."); r.node[k] = String(d[k]); }
        if(r.node.start && r.node.due && r.node.due < r.node.start){ const t = r.node.start; r.node.start = r.node.due; r.node.due = t; }
        dated.push(r.node);
      });
    }
    const view = ["note", "gantt"].includes(args.view) ? args.view : "map";
    if(view === "gantt" && !dated.length) throw new Error("A Gantt needs dates — pass `dates` with a start and/or due day for the nodes to draw.");
    assignIds(root);
    const doc = { v:1, root, images:[], stickies:[] };
    const st = okStyleMcp(args.style);
    if(st) doc.style = st;
    const file = await writeDoc(args.name || root.text, doc, args.folder, { kind: view, space: args.space });
    const shotLines = shots.length ? `\n📷 ${shots.length} screenshot(s) on the map:\n` + shots.map(x=>"   • " + x).join("\n") + "\n" : "";
    const label = view === "note" ? "Note" : view === "gantt" ? "Gantt" : "Map";
    return `✅ ${label} created (${countNodes(root)} nodes${dated.length ? ", " + dated.length + " dated" : ""}): ${file}\n${shotLines}${importHint()}`;
  },
  async create_board(args){
    const { doc, warnings, imageNotes } = buildBoardDoc(args.name || "Board", args.elements, args.connections, args.style);
    const file = await writeDoc(args.name || "Board", doc, args.folder, { space: args.space });
    const n = doc.shapes.length + doc.stickies.length + doc.images.length;
    const imgs = imageNotes.length ? `🖼  ${imageNotes.length} image(s):\n` + imageNotes.map(t=>"   • " + t).join("\n") + "\n" : "";
    // Les avertissements passent AVANT l'astuce d'import : c'est le seul moment où le texte
    // peut encore être raccourci, et une ligne noyée en fin de réponse ne se lit pas.
    const warn = warnings.length
      ? `\n⚠️  ${warnings.length} element(s) hold more text than their box shows at full size:\n`
        + warnings.map(w=>"   • " + w).join("\n")
        + `\n   Nothing spills out — the text was shrunk to fit — but blocks at different sizes look\n`
        + `   uneven on a canvas. Recreate the board with shorter text to keep it clean.\n`
      : "";
    return `✅ Board created (${n} elements, ${doc.arrows.length} connection(s)): ${file}\n${imgs}${warn}${importHint()}`;
  },
  async create_kanban(args){
    if(typeof args.name !== "string" || !args.name.trim()) throw new Error("The `name` parameter is required (the board's name).");
    const doc = buildKanbanDoc(args);
    const file = await writeDoc(args.name, doc, args.folder, { kind: "kanban", space: args.space });
    const cards = doc.root.children;
    const per = doc.kanban.cols.map(k => k.name + " " + cards.filter(c => k.done ? c.check === true : (c.col === k.id && c.check !== true)).length).join(" · ");
    return `✅ Kanban created — ${cards.length} card(s): ${per}\n${file}\n${importHint()}`
      + (CLOUD ? "\nIt opens as a kanban. To add or move cards later, use propose_changes on this file — those changes apply by themselves." : "");
  },
  async propose_changes(args){
    const m = await findMap(args.file);
    // Un persona est la SEULE op qui vise un board — la work map en est un — et il ne vise que ça.
    const allPersona = Array.isArray(args.changes) && args.changes.length > 0 && args.changes.every(c=>c && c.op === "persona");
    if(m.kind === "board" && !allPersona)
      throw new Error("Proposals only apply to mind maps. A board has free positions and drawings, which a change list cannot describe.");
    if(allPersona && m.kind !== "board")
      throw new Error("A persona re-casts a WORK MAP or a SECOND BRAIN BLUEPRINT canvas, which is a board. “" + m.name + "” is a mind map — pick the person's canvas from list_maps (its name starts with “Work map —”, “Cartographie —” or “Second brain —”).");
    if(m.team && m.role === "viewer") throw new Error("“" + m.name + "” is in a team space where the user is a viewer — it can be read, not changed. Ask the space's owner for the editor role.");
    const ops = buildProposalOps(m.doc, args.changes);
    const res = await writeProposal(m, args.note, ops, { review: allPersona });
    if(allPersona){
      return `📮 Interview filed for “${m.name}” — ${ops[0].domains ? ops[0].domains + " domains" : ops[0].procs + " processes"}: ${res.ids.review}\n`
        + "NOTHING has been changed yet. The canvas file is untouched.\n"
        + (CLOUD ? "TabTree shows a banner on that work map within a minute (app open, signed in): " : "TabTree shows a banner on that work map within a few seconds (backup folder connected, app open): ") + "“Your Claude interview is ready — re-cast this work map?”. "
        + "One click rebuilds the canvas AND its companion sheet from these hours; Cmd+Z undoes it.\n"
        + "Tell the user to look at TabTree — do not claim the map has been re-cast.";
    }
    const tally = (list)=>{
      const adds = list.reduce((n,o)=>n + (o.adds||0), 0), drops = list.reduce((n,o)=>n + (o.drops||0), 0);
      const shots = list.filter(o=>o.op === "img" && o.img).length;
      return list.length + " change(s)" + (adds ? `, ${adds} node(s) to add` : "") + (drops ? `, ${drops} node(s) to remove` : "") + (shots ? `, ${shots} screenshot(s)` : "");
    };
    const shotLines = ops.filter(o=>o.op === "img" && o.img).map(o=>"   📷 “" + String(o.was || o.target).slice(0, 60) + "” ← " + o.shot).join("\n");
    let out = "";
    if(res.auto.length){
      out += `⚡ ${tally(res.auto)} sent to “${m.name}” — TabTree applies them BY ITSELF within seconds when it is open on one of the user's devices (signed in), otherwise the next time it opens. `
        + "Cmd+Z undoes them. They have not been applied yet at this instant: do not read the map back expecting them — tell the user they are on their way.\n";
    }
    if(res.review.length){
      out += `📮 Proposal filed for “${m.name}” — ${tally(res.review)}${res.auto.length ? " (everything from the first change that rewrites or removes something)" : ""}: ${CLOUD ? "cloud:" + res.ids.review : res.ids.review}\n`
        + "NOTHING has been changed yet by these. The map is untouched until the user approves them.\n"
        + (CLOUD ? "TabTree shows a banner on that map within a minute (the app open and signed in). " : "TabTree shows a banner on that map within a few seconds (the backup folder must be connected, and the app open). ")
        + "The user ticks the changes they want, applies them, and Cmd+Z undoes the lot.\n"
        + "Tell the user to look at TabTree — do not claim those changes are made.\n";
    }
    return out + (shotLines ? shotLines + "\n" : "");
  },
  async harvest(args){
    if(!CLOUD) throw new Error("harvest keeps what matters in the user's TabTree ACCOUNT, and this connector reads a backup folder. Connect it with a connector key (TabTree → Settings → Account → Claude connector) — the backup-folder mode does not receive new features.");
    const a = args || {};
    const items = Array.isArray(a.items) ? a.items : [];
    if(a.nothing === true){
      if(items.length) throw new Error("`nothing: true` means nothing is worth keeping — send no items with it.");
      return "Nothing filed: nothing from this conversation needed keeping. Tell the user so.";
    }
    if(!items.length) throw new Error("No items. List what is worth keeping — facts, decisions, lessons — or pass nothing: true.");
    if(items.length > HARVEST_MAX) throw new Error(items.length + " items: a harvest keeps " + HARVEST_MAX + " at most. Beyond that it is a report — put it in a map of its own with create_mindmap, or keep only what matters.");
    const title = hvLine(a.title, 120);
    if(!title) throw new Error("`title` is required — one line naming the conversation; it is written as the source of every entry.");
    const today = new Date().toISOString().slice(0, 10);

    // 1. Contrôler chaque élément AVANT de toucher au compte : un appel refusé ne crée rien.
    const clean = items.map((it, i)=>{
      const where = "item #" + (i + 1);
      if(!it || typeof it !== "object") throw new Error(where + ": must be an object { kind, text, … }.");
      const kind = it.kind;
      if(!["fact", "decision", "lesson"].includes(kind)) throw new Error(where + ": `kind` must be fact, decision or lesson.");
      const text = hvLine(it.text, 300);
      if(!text) throw new Error(where + ": `text` is required — one sentence that stays true on its own.");
      if(kbSecretLike(text)) throw new Error(where + ": its text looks like a password, key or token. Never file a secret — leave it out.");
      let secrets = 0;
      const detail = (typeof it.detail === "string" ? it.detail.replace(/\r/g, "").slice(0, 1500) : "").split("\n")
        .filter(l=>{ if(kbSecretLike(l)){ secrets++; return false; } return true; }).join("\n").trim();
      const out = { i, kind, text, detail, secrets, why: hvLine(it.why, 200) };
      const only = (k, kinds)=>{ if(it[k] != null && it[k] !== "" && !kinds.includes(kind)) throw new Error(where + ": `" + k + "` is for a " + kinds.join(" or ") + ", not a " + kind + "."); };
      only("section", ["fact"]); only("updates", ["fact"]);
      only("signal", ["decision"]); only("check_on", ["decision"]); only("replaces", ["decision"]);
      if(kind === "fact"){
        out.section = hvLine(it.section, 80);
        if(!out.section) throw new Error(where + ": a fact needs its `section` of the " + KNOW_NAME + " map (read_map shows them).");
        out.updates = hvLine(it.updates, 300);
      }
      if(kind === "decision"){
        out.signal = hvLine(it.signal, 300);
        out.replaces = hvLine(it.replaces, 300);
        out.check_on = hvLine(it.check_on, 10);
        if(out.check_on && !hvDayOk(out.check_on)) throw new Error(where + ": `check_on` must be a real day written YYYY-MM-DD.");
        if(kbSecretLike(out.signal)) throw new Error(where + ": its signal looks like a password, key or token.");
      }
      return out;
    });

    // 2. L'espace, puis les deux cartes (sans rien créer encore).
    const lib = await loadLibrary();
    const me = cloudMe;
    let sp = null;
    if(a.space != null && String(a.space).trim()){
      const hits = (cloudSpacesCache || []).filter(x=>hvSame(x.name, a.space));
      if(!hits.length) throw new Error("No space named “" + a.space + "” in this account" + ((cloudSpacesCache || []).length ? ". Spaces: " + cloudSpacesCache.map(x=>"“" + x.name + "”").join(", ") + " — or omit `space` for Personal" : "") + ".");
      sp = hits.find(x=>x.owner === me) || hits[0];
      if(!sp.writable) throw new Error("The space “" + sp.name + "” is read-only for this user (" + (sp.role === "viewer" ? "their role there is viewer — ask its owner for the editor role" : "its owner's plan has ended") + "). Nothing was filed.");
    }
    const knowOwner = sp ? sp.owner : me, knowKey = sp ? sp.space_key : null;
    const needKnow = clean.some(x=>x.kind !== "lesson"), needLessons = clean.some(x=>x.kind === "lesson");
    const knowMap = needKnow ? hvFindMap(lib, knowOwner, knowKey, KNOW_NAME) : null;
    const lessMap = needLessons ? hvFindMap(lib, me, null, LESSONS_NAME) : null;
    const know = needKnow ? hvTarget(knowMap ? knowMap.doc : hvNewDoc(KNOW_NAME, KNOW_DEFAULT)) : null;
    const less = needLessons ? hvTarget(lessMap ? lessMap.doc : hvNewDoc(LESSONS_NAME, [])) : null;

    // 3. Les ops, élément par élément, contre la carte TELLE QUE LES ÉLÉMENTS PRÉCÉDENTS LA LAISSENT.
    const said = [], skipped = [];
    let secretLines = 0;
    const src = (verb)=>verb + " a conversation with Claude — “" + title + "” · " + today;
    for(const x of clean){
      const where = "item #" + (x.i + 1);
      secretLines += x.secrets;
      const hv = x.i;
      const noteOf = (verb)=>(x.detail ? x.detail + "\n\n" : "") + src(verb);
      const addEntry = (t, parent, path, attrs)=>{
        const nid = newNid();
        const md = "- " + hvMd(x.text) + attrs.map(([k, v])=>"\n  - " + k + ": " + hvMd(v)).join("");
        t.ops.push(Object.assign({ op:"add" }, hvAt(parent, path), { markdown: md, text: x.text, nid, adds: 1 + attrs.length, hv }, x.why ? { why: x.why } : {}));
        t.ops.push({ op:"note", node: nid, target: (path + " > " + x.text).slice(0, 600), note: noteOf("From"), hv });
        const node = Object.assign(makeNode(x.text), { id: nid });
        node.children = attrs.map(([k, v])=>makeNode(k + ": " + v));
        parent.children = (parent.children || []).concat([node]);
      };
      if(x.kind === "lesson"){
        const root = less.doc.root;
        if(hvFindEntry(root, x.text)){ skipped.push("“" + x.text + "” is already in your " + LESSONS_NAME); continue; }
        addEntry(less, root, String(root.text || LESSONS_NAME), []);
        said.push("🌱 lesson — " + x.text);
        continue;
      }
      const root = know.doc.root;
      if(x.kind === "decision"){
        const sec = (root.children || []).find(c=>/decision/.test(knowNorm(c.text))) || hvSection(know, "⚖️ Decisions");
        if(hvFindEntry(sec, x.text)){ skipped.push("“" + x.text + "” is already among the decisions"); continue; }
        const attrs = [];
        if(x.signal) attrs.push(["Signal", x.signal]);
        if(x.check_on) attrs.push(["Check on", x.check_on]);
        if(x.replaces){
          const prev = hvFindEntry(sec, x.replaces);
          if(!prev) throw new Error(where + ": no decision “" + x.replaces + "” in “" + sec.text + "” — `replaces` takes the EXACT text of an earlier decision" + ((sec.children || []).length ? " (" + sec.children.slice(-6).map(c=>"“" + c.text + "”").join(", ") + ")" : "") + ".");
          attrs.push(["Replaces", String(prev.text)]);
        }
        addEntry(know, sec, String(root.text) + " > " + String(sec.text), attrs);
        said.push("⚖️ decision — " + x.text + (x.check_on ? " (check on " + x.check_on + ")" : ""));
        continue;
      }
      // fact
      const sec = hvSection(know, x.section);
      const path = String(root.text) + " > " + String(sec.text);
      if(x.updates){
        const prev = hvFindEntry(sec, x.updates);
        if(!prev) throw new Error(where + ": no entry “" + x.updates + "” in “" + sec.text + "” — `updates` takes the EXACT text of the entry it replaces" + ((sec.children || []).length ? " (" + sec.children.slice(0, 8).map(c=>"“" + c.text + "”").join(", ") + ")" : ", and that section is empty") + ".");
        const at = hvAt(prev, path + " > " + String(prev.text));
        if(!hvSame(prev.text, x.text)) know.ops.push(Object.assign({ op:"rename" }, at, { was: String(prev.text), text: x.text, hv }, x.why ? { why: x.why } : {}));
        know.ops.push(Object.assign({ op:"note" }, at, { was: String(prev.text), note: noteOf("Updated from"), hv }));
        prev.text = x.text;
        said.push("✏️ updated in " + sec.text + " — " + x.text);
        continue;
      }
      const dup = hvFindEntry(sec, x.text);
      if(dup){
        if(!x.detail){ skipped.push("“" + x.text + "” is already in “" + sec.text + "”"); continue; }
        know.ops.push(Object.assign({ op:"note" }, hvAt(dup, path + " > " + String(dup.text)), { was: String(dup.text), note: noteOf("Updated from"), hv }));
        said.push("✏️ detail updated in " + sec.text + " — " + x.text);
        continue;
      }
      addEntry(know, sec, path, []);
      said.push("📚 " + sec.text + " — " + x.text);
    }
    const targets = [];
    if(know && know.ops.length) targets.push([know, knowMap, KNOW_NAME, sp ? sp.name : undefined]);
    if(less && less.ops.length) targets.push([less, lessMap, LESSONS_NAME, undefined]);
    if(!targets.length) return "Nothing new to file — everything is already there:\n" + skipped.map(s=>"   • " + s).join("\n") + "\nTell the user so.";

    // 4. Créer ce qui manque (un squelette sans un fait : rien à approuver), puis déposer, à la revue.
    const harvest_id = "hv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const created = [], filed = [];
    for(const [t, map0, name, space] of targets){
      let map = map0;
      if(!map){
        // Le squelette créé est EXACTEMENT celui contre lequel les ops ont été validées (`seed`, avant
        // toute op) : mêmes ids — les ops de la proposition visent ses sections par leur id.
        const info = await writeDoc(name, t.seed, null, { kind: "map", space, info: true });
        map = { file: info.id, key: info.key, owner: info.owner, team: info.team, name };
        created.push("“" + name + "”" + (space ? " in the space “" + space + "”" : " in Personal"));
      }
      const res = await writeProposal(map, "🏁 From your conversation with Claude: “" + title + "”", t.ops, { review: true, extra: { origin: "harvest", harvest_id, title } });
      filed.push(res.ids.review);
    }
    const n = said.length;
    return "🏁 " + n + " item" + (n > 1 ? "s are" : " is") + " waiting in TabTree" + (sp ? " (space “" + sp.name + "”)" : "") + ":\n"
      + said.map(s=>"   • " + s).join("\n") + "\n"
      + (skipped.length ? "Left out, already there:\n" + skipped.map(s=>"   • " + s).join("\n") + "\n" : "")
      + (secretLines ? "🔒 " + secretLines + " line(s) of detail looked like a password, key or token and were left out.\n" : "")
      + (created.length ? "📚 Created " + created.join(" and ") + " to hold them.\n" : "")
      + "NOTHING is filed yet. TabTree shows a banner on any device where it is open (otherwise the next time it opens): the user ticks what to keep and accepts it; Cmd+Z undoes it.\n"
      + "Tell the user it is waiting in TabTree — do not claim it is filed.";
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
      serverInfo: { name: "tabtree", version: "1.6.1" }
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
    // Les gestionnaires sont ASYNCHRONES depuis la source cloud (2026-09-08) : un `fn` qui
    // lève ou qui rejette rend le même message d'erreur — Claude n'a pas à distinguer les deux.
    Promise.resolve().then(()=>fn((params && params.arguments) || {})).then(text=>{
      reply(id, { content: [{ type:"text", text }] });
    }, e=>{
      reply(id, { content: [{ type:"text", text: "Erreur : " + (e && e.message || e) }], isError: true });
    });
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
