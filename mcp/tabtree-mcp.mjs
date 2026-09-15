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

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { inflateSync, deflateSync } from "node:zlib";
import { tmpdir, platform } from "node:os";

const DIR = process.env.TABTREE_DIR || process.env.YGMIND_DIR || "";
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
if(/^\$\{.*\}$/.test(API_KEY)) API_KEY = "";
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
      body: JSON.stringify(Object.assign({ action }, body || {})) });
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
  "developer", "seller", "support", "speaker", "freelancer", "group"
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
             size: (+e.size>=9 && +e.size<=72) ? Math.round(+e.size) : null,
             // L'image sans octets sur un élément de board (2026-09-03) : même frontière que
             // pour un nœud — un id inventé retombe sur « aucune image », jamais sur du balisage.
             // Pas sur un secteur, un gradin ou un chevron : leur silhouette n'a pas de « haut ».
             pic: (e.pic != null && !["arc","trap","chev"].includes(kind)) ? okPic(String(e.pic)) : "" };
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
      stickies.push({ text:e.text, x:e.x, y:e.y, w:e.w, h:e.h, color:e.color, size:e.size||undefined, pic:e.pic||undefined });
    } else {
      refOf.set(e.lid, "sh:" + shapes.length);
      shapes.push({ kind:e.kind, x:e.x, y:e.y, w:e.w, h:e.h, color:e.kind==="text" ? "#ffffff" : e.color, text:e.text, size:e.size||undefined,
                    pic: e.pic||undefined,
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
// La bibliothèque du COMPTE, présentée exactement comme celle du dossier : mêmes champs, donc
// les six outils n'ont rien à savoir de la source. `file` porte la clé de la carte (map_key),
// que `propose_changes` renvoie telle quelle — pas de suffixe « __id » à analyser ici.
async function cloudLibrary(){
  const j = await cloudCall("docs", {});
  const folders = new Map((j.folders||[]).filter(f=>f && f.folder_key).map(f=>[f.folder_key, f]));
  const pathOf = (k)=>{
    const out = [], seen = new Set();
    let f = folders.get(k);
    while(f && !seen.has(f.folder_key) && out.length <= 16){ seen.add(f.folder_key); out.unshift(f.name); f = f.parent_key ? folders.get(f.parent_key) : null; }
    return out.length ? out.join(" / ") : null;
  };
  const out = [];
  for(const r of (j.maps||[])){
    const doc = r && r.doc;
    if(!doc || !doc.root) continue;
    out.push({
      file: r.map_key,
      name: String(r.name || "") || String(doc.root.text || "").slice(0, 60) || r.map_key,
      folder: pathOf(r.folder_key),
      kind: doc.board ? "board" : "map",
      nodes: countNodes(doc.root),
      elements: doc.board ? ((doc.shapes||[]).length + (doc.stickies||[]).length + (doc.arrows||[]).length + (doc.draws||[]).length) : undefined,
      mtime: String(r.updated_at || "").slice(0,16).replace("T"," "),
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
async function writeDoc(name, doc, folder){
  if(CLOUD){
    // Le dossier est un NOM de dossier de bibliothèque : on le résout en clé s'il existe déjà,
    // sinon la carte arrive à la racine et le texte de réponse le dit (« no silent caps »).
    let folder_key = null;
    if(folder){
      const j = await cloudCall("list", {});
      const hit = (j.folders||[]).find(f=>f && String(f.name||"").trim().toLowerCase() === String(folder).trim().toLowerCase());
      if(hit) folder_key = hit.folder_key;
    }
    const kind = doc.board ? "board" : (doc.kanban ? "kanban" : "map");
    const r = await cloudCall("create", { name: String(name||"").slice(0,200), kind, doc, folder_key });
    return "cloud:" + r.map_key + (folder && !folder_key ? "  (folder “" + folder + "” does not exist in this account — the map is at the root)" : "");
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
const PROP_OPS = ["add","rename","note","check","delete","move","pic","img","persona"];

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

// L'app ignore un fichier de proposition au-delà de PROP_FILE_MAX octets (`propScan`) — sans un
// mot, puisqu'elle ne peut pas savoir ce qu'il contenait. Avec des captures d'écran dedans, la
// borne se rencontre : on refuse ICI en nommant le geste, jamais un dépôt qui n'arrive pas.
const PROP_FILE_MAX = 1400000;
async function writeProposal(map, note, ops){
  const payload = (id)=>({
    v: 1, kind: "tabtree-proposal", mapId: id, mapFile: CLOUD ? map.file : basename(map.file), mapName: map.name,
    createdAt: Date.now(), by: "Claude", note: String(note||"").slice(0, 2000), ops
  });
  const shots = ops.filter(o=>o.op === "img" && o.img).length;
  if(JSON.stringify(payload("x")).length > PROP_FILE_MAX)
    throw new Error("This proposal is too large for TabTree's mailbox (" + Math.round(PROP_FILE_MAX / 1024) + " KB max) — it carries " + shots + " screenshot(s). Send it as several proposals with fewer screenshots each.");
  if(CLOUD){
    // La boîte aux lettres cloud : la table `proposals`, que l'app relit au sondage suivant.
    // Même charge utile que le fichier — c'est le même `parseProposal` qui la lit côté app.
    const r = await cloudCall("propose", { map_key: map.file, payload: payload(map.file) });
    return "cloud:" + (r.id || "proposal");
  }
  dirOk();
  const target = join(DIR, PROP_DIR);
  if(!existsSync(target)) mkdirSync(target);
  const id = mapIdOf(map.file);
  if(!id) throw new Error("This map's file has no id suffix (“…__map123.tabtree”), so the app cannot match a proposal to it. Open it once in TabTree with the backup folder turned on, then try again.");
  const file = "prop_" + id + "__" + Date.now().toString(36) + ".json";
  writeFileSync(join(target, file), JSON.stringify(payload(id), null, 2), "utf8");
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
  if(CLOUD) return "Saved to the user's TabTree account. It appears in TabTree within a minute (the app polls "
    + "its account while open), or on the next sign-in on any device. Nothing is overwritten.";
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
    description: "Creates a NEW TabTree mind map from a markdown outline (#/## headings, bullet lists indented by 2 spaces, [x]/[ ] checkboxes, [title](url) links, and \" @a:<id>\" / \" @e:<emoji>\" at the end of a line for an illustration). The first top-level line becomes the centre. SCREENSHOTS: pass `images` — a list of { target, file } where `file` is the path of a PNG/JPEG on this machine (a screenshot you saved) and `target` the exact text of the node it goes on; the picture is re-encoded to fit and drawn as the node's cover. Writes a .tabtree file into the backup folder; the user pulls it into the app from the 🛟 menu.",
    inputSchema: { type:"object", properties:{
      name:{ type:"string", description:"Name of the map" },
      markdown:{ type:"string", description:"Markdown outline (headings and/or bullet list). End any line with \" @a:<id>\" to give that node a built-in illustration, or \" @e:<emoji>\" for one large emoji — e.g. \"Launch @a:rocket\". Ids: person, team, chat, idea, target, trophy, star, heart, warning, done, flag, clock, laptop, phone, mail, folder, book, chart, money, calendar, building, car, globe, rocket, house, pin, plane, coffee, plant, sun, camera, music, lock, key, health, gift. An unknown id is left as plain text rather than dropped." },
      folder:{ type:"string", description:"Optional TabTree subfolder (e.g. \"From Claude\")" },
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
        pic:{ type:"string", description:"Optional picture drawn INSIDE the element, no file needed — \"a:<id>\" for a built-in illustration (roles: manager, client, expert, assistant, coach, learner, developer, seller, support, speaker, freelancer, group — plus person, team, idea, target, rocket…) or \"e:<emoji>\". Not on arc/trap/chev." },
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
    description: "Proposes changes to an EXISTING mind map: add branches, rename a node, write a note, tick a task, remove a branch, illustrate a node, put a screenshot on a node (op \"img\" with `file`) — or, with op \"persona\", re-cast a WORK MAP canvas from a finished interview (the JSON block of the « ma cartographie du travail » skill). Nothing is applied — the proposal appears in TabTree as a banner on that map, the user reviews it change by change and picks what to keep (and can undo with Cmd+Z afterwards). Name each target node by its exact text, or by a path \"Ancestor > Node\" when the same wording appears twice. Read the map first so the wording matches.",
    inputSchema: { type:"object", properties:{
      file:{ type:"string", description:"The map to change — a file name (or map name) from list_maps" },
      note:{ type:"string", description:"One line telling the user what this proposal does and why. Shown above the changes." },
      changes:{ type:"array", description:"The proposed changes, applied in order", items:{ type:"object", properties:{
        op:{ type:"string", enum:["add","rename","note","check","delete","move","pic","img","persona"], description:"add = new children under `target`; rename = change its text; note = set its note; check = tick/untick the task; delete = remove it and its children; move = send the card to a kanban column; pic = put an illustration on it; img = put a SCREENSHOT on it (give `file`, the path of the image on this machine — or `data`; `img: \"\"` removes it); persona = re-cast a work map canvas (a board whose name starts with “Work map —” / “Cartographie —”) or a Second Brain Blueprint (“Second brain —”) from an interview — no target" },
        target:{ type:"string", description:"Exact node text, or \"Ancestor > Node\" if ambiguous (not used by persona)" },
        persona:{ type:"object", description:"persona: the interview object exactly as the skill returns it — who, role, mission, tools, meetings, opener, modules[{name, procs[{name,h,after,freq,rep,data,stakes,lever,step,why}]}], trajectory, signs, parking. TabTree rebuilds the canvas AND its companion sheet from it." },
        markdown:{ type:"string", description:"add: the new branch as a bullet list, 2 spaces per level" },
        text:{ type:"string", description:"rename: the new text" },
        note:{ type:"string", description:"note: the note body (empty string clears it)" },
        value:{ type:"boolean", description:"check: true to tick, false to untick" },
        col:{ type:"string", description:"move: the kanban column id (read_map shows them), or \"\" to take the card off the board" },
        pic:{ type:"string", description:"pic: \"a:<id>\" for a built-in illustration, or \"e:<emoji>\" for one large emoji, or \"\" to remove it. Ids: person, team, chat, idea, target, trophy, star, heart, warning, done, flag, clock, laptop, phone, mail, folder, book, chart, money, calendar, building, car, globe, rocket, house, pin, plane, coffee, plant, sun, camera, music, lock, key, health, gift." },
        file:{ type:"string", description:"img: full path of the screenshot (PNG/JPEG/WebP/GIF) on this machine. It is re-encoded to about 840 px and becomes the node's cover picture." },
        data:{ type:"string", description:"img: a data:image/…;base64 URL instead of `file`" },
        img:{ type:"string", description:"img: pass \"\" to REMOVE the screenshot from that node (otherwise give `file` or `data`)" }
      }, required:["op"], additionalProperties:false } }
    }, required:["file","changes"], additionalProperties:false }
  }
];

const HANDLERS = {
  async list_maps(){
    const maps = await loadLibrary();
    if(!maps.length) return CLOUD ? "This TabTree account has no maps yet." : "The library is empty (or TABTREE_DIR points at the wrong folder: " + DIR + ").";
    return maps.map(m=>
      `• ${m.name}  [${m.kind}]${m.folder ? "  📁 " + m.folder : ""}\n  file: ${m.file}\n  ${m.kind==="board" ? m.elements + " elements" : m.nodes + " nodes"} · modified ${m.mtime}`
    ).join("\n");
  },
  async read_map(args){
    const m = await findMap(args.file);
    const head = `${m.name} [${m.kind}] — file: ${m.file}\n`;
    if(m.kind === "board") return head + boardToText(m.doc);
    // Le rappel sur propose_changes vit ici et pas dans la description de l'outil : c'est au
    // moment où le plan est sous les yeux qu'il est utile, et il porte la règle de désignation.
    return head + nodeToMarkdown(m.doc.root, 0)
      + "\n\n(To change this map, use propose_changes with `file: \"" + m.file + "\"`. Name a node by the exact text above, or \"Ancestor > Node\" when it appears twice. Nothing is applied until the user approves it in TabTree.)";
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
    const doc = { v:1, root, images:[], stickies:[] };
    const st = okStyleMcp(args.style);
    if(st) doc.style = st;
    const file = await writeDoc(args.name || root.text, doc, args.folder);
    const shotLines = shots.length ? `\n📷 ${shots.length} screenshot(s) on the map:\n` + shots.map(x=>"   • " + x).join("\n") + "\n" : "";
    return `✅ Map created (${countNodes(root)} nodes): ${file}\n${shotLines}${importHint()}`;
  },
  async create_board(args){
    const { doc, warnings } = buildBoardDoc(args.name || "Board", args.elements, args.connections, args.style);
    const file = await writeDoc(args.name || "Board", doc, args.folder);
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
  async propose_changes(args){
    const m = await findMap(args.file);
    // Un persona est la SEULE op qui vise un board — la work map en est un — et il ne vise que ça.
    const allPersona = Array.isArray(args.changes) && args.changes.length > 0 && args.changes.every(c=>c && c.op === "persona");
    if(m.kind === "board" && !allPersona)
      throw new Error("Proposals only apply to mind maps. A board has free positions and drawings, which a change list cannot describe.");
    if(allPersona && m.kind !== "board")
      throw new Error("A persona re-casts a WORK MAP or a SECOND BRAIN BLUEPRINT canvas, which is a board. “" + m.name + "” is a mind map — pick the person's canvas from list_maps (its name starts with “Work map —”, “Cartographie —” or “Second brain —”).");
    const ops = buildProposalOps(m.doc, args.changes);
    const file = await writeProposal(m, args.note, ops);
    if(allPersona){
      return `📮 Interview filed for “${m.name}” — ${ops[0].domains ? ops[0].domains + " domains" : ops[0].procs + " processes"}: ${file}\n`
        + "NOTHING has been changed yet. The canvas file is untouched.\n"
        + (CLOUD ? "TabTree shows a banner on that work map within a minute (app open, signed in): " : "TabTree shows a banner on that work map within a few seconds (backup folder connected, app open): ") + "“Your Claude interview is ready — re-cast this work map?”. "
        + "One click rebuilds the canvas AND its companion sheet from these hours; Cmd+Z undoes it.\n"
        + "Tell the user to look at TabTree — do not claim the map has been re-cast.";
    }
    const adds = ops.reduce((n,o)=>n + (o.adds||0), 0);
    const drops = ops.reduce((n,o)=>n + (o.drops||0), 0);
    const shots = ops.filter(o=>o.op === "img" && o.img);
    return `📮 Proposal filed for “${m.name}” — ${ops.length} change(s)`
      + (adds ? `, ${adds} node(s) to add` : "")
      + (drops ? `, ${drops} node(s) to remove` : "")
      + (shots.length ? `, ${shots.length} screenshot(s)` : "")
      + `: ${file}\n`
      + (shots.length ? shots.map(o=>"   📷 “" + String(o.was || o.target).slice(0, 60) + "” ← " + o.shot).join("\n") + "\n" : "")
      + "NOTHING has been changed yet. The map file is untouched.\n"
      + (CLOUD ? "TabTree shows a banner on that map within a minute (the app open and signed in). " : "TabTree shows a banner on that map within a few seconds (the backup folder must be connected, and the app open). ")
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
      serverInfo: { name: "tabtree", version: "1.3.0" }
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
