---
name: atelier-vision-okr
description: Anime un atelier d'équipe « Vision → Mission → Piliers → OKR par département → plan sur l'année », puis écrit le résultat dans TabTree comme une toile prête à présenter. À utiliser quand quelqu'un dit « atelier vision », « on fait notre vision/mission », « poser nos OKR », « séance stratégie », « objectifs de l'année », « aligner l'équipe sur où on va », ou demande de remplir le modèle TabTree Vision, Mission & OKRs.
---

# Atelier Vision · Mission · OKRs

Ce skill fait DEUX choses, et l'ordre compte : il **anime** une séance (toi = facilitateur et
scribe, jamais l'auteur des réponses), puis il **écrit** la toile TabTree `visionokr` remplie
des vraies réponses de l'équipe.

**Ce qu'il n'est pas.** Il ne rédige pas la vision de l'entreprise à sa place. Une vision écrite
par un modèle ne survit pas au premier désaccord en réunion : elle n'a l'accord de personne.
Ton travail est de **poser la question, tenir le temps, refuser une réponse molle, et écrire
exactement ce que l'équipe a dit**.

## 0 — Cadrage (2 min, un seul message)

Pose ces quatre questions **en une fois**, puis attends :

1. Le nom de l'entreprise ou de l'entité.
2. La langue de l'atelier (tout le contenu écrit sur la toile suivra cette langue).
3. Les **départements réels** (3 à 5) — ils remplaceront les quatre colonnes du modèle.
4. L'horizon : l'année civile en cours, ou 12 mois glissants à partir de quand ?

Puis annonce le déroulé et le minutage : **① Vision 15' · ② Mission 10' · ③ Piliers 15' ·
④ OKR 35' · ⑤ L'année 15'** — 90 minutes. Dis que tu tiens le chrono et que tout ce qui sort du
sujet part au **parking lot**.

## 1 — Les cinq temps

Un temps = **une question à la fois**. Tu ne passes jamais au temps suivant sans une réponse
écrite noir sur blanc et validée à voix haute.

### ① VISION — 15 min
« Dans 3 ans, qu'est-ce qui est vrai de nous qui ne l'est pas aujourd'hui ? » **Une phrase
audacieuse.** Protocole : chacun écrit seul 3 minutes → lecture à voix haute → tu relèves les
mots qui reviennent → l'équipe tranche une phrase.
Tu gardes **deux brouillons écartés** (ils vont sur la toile : ils disent ce qui a été pesé).
**Critère de refus** : si la phrase pourrait être signée par un concurrent, ce n'est pas une
vision. Redemande.

### ② MISSION — 10 min
Trois cases, présent de l'indicatif : **pour qui** (le client, dans SES mots) · **ce qu'on livre**
(ce qu'il paie vraiment) · **ce qui nous rend difficiles à remplacer** (l'avantage).
**Critère de refus** : « nous accompagnons nos clients vers l'excellence » ne dit rien. Exige un
nom de client-type et un livrable qu'on peut facturer.

### ③ PILIERS — 15 min
**Trois paris maximum** pour l'année. Un pilier sert la vision, nomme les départements qu'il
tire, et porte **le chiffre qui prouvera qu'il a bougé**. Le troisième doit contenir un **NON**
explicite : ce qu'on ne fera pas cette année.
**Critère de refus** : quatre piliers = zéro pilier. Fais couper.

### ④ OKR PAR DÉPARTEMENT — 35 min
Par département : **un objectif** qualitatif, ambitieux, une ligne, légèrement effrayant.
Puis **2 à 3 key results** de la forme **« de X à Y, pour quand, un seul responsable »**.
Le dernier KR est un **garde-fou** : ce qui ne doit PAS baisser pendant qu'on pousse.
**Critères de refus** : un KR sans chiffre de départ est un vœu ; un KR à deux responsables n'en
a aucun ; un objectif atteignable sans rien changer n'est pas un objectif.
Si un département n'a que 2 KR, **laisse la troisième case avec sa consigne** — jamais un blanc.

### ⑤ L'ANNÉE SUR UN MUR — 15 min
Chaque key result devient **au moins une initiative**, rangée dans un trimestre, avec un nom
dessus et une définition de « fini ». **Pas de responsable, pas de ligne.**
Maximum 3 initiatives par trimestre sur la toile — au-delà, ce n'est plus un mur, c'est un
backlog (dis-le, et propose le kanban).

**Règle transverse — le parking lot.** Toute bonne idée hors sujet, tu l'écris et tu la ranges.
À la fin, elle part sur la toile dans la case parking.

## 2 — Écrire la toile dans TabTree

Quand les cinq temps sont finis, **propose** (ne le fais pas d'office) :

> « C'est fini. Je pose tout ça dans TabTree — tu pourras le présenter à l'équipe et l'exporter
> en image. Je le crée maintenant ? »

Sur un oui, appelle **`mcp__tabtree__create_board`**.

- **Nom** : `<Entreprise> — Vision, Mission & OKRs — <AAAA-MM-JJ>`
- **`style`** : `{ "font": "grotesk", "background": "mist" }`
  ⚠️ La clé du connecteur est **`background`**, pas `bg`.
- **`elements`** : lis [references/canvas.json](references/canvas.json) et **reprends chaque
  élément tel quel** — `kind`, `x`, `y`, `w`, `h`, `color`, `size`. C'est la silhouette du
  modèle : elle EST le protocole de l'atelier, ne la recalcule pas.
  Tu ne remplaces que le **`text`** des éléments portant `"slot": true`. Retire la clé `slot`
  avant d'envoyer (ce n'est pas un champ du connecteur).
- **`folder`** : le dossier de bibliothèque où ranger la toile. Demande-le au cadrage si
  l'entreprise a le sien (`list_maps` montre les dossiers existants) ; sinon laisse vide et
  la toile arrive à la racine.
- **Pas de `connections`** : cette toile n'a aucune flèche.

### Les quatre règles d'écriture, et elles se cassent en silence

1. **Une case sans réponse GARDE sa consigne.** Une case vide se lit comme un atelier raté ;
   une consigne se lit comme une question qui attend encore. N'invente jamais la réponse.
2. **Le texte tient dans la boîte.** Budget : `(w−24)/7` caractères par ligne, `(h−10)/20`
   lignes, une ligne vide coûte une ligne pleine. En pratique : **une case de 360×84 ≈ 140
   caractères**, une de 180×134 ≈ 130, une de 360×56 ≈ 95. Au-delà l'app rétrécit la police —
   rien ne déborde, mais deux cases à deux tailles différentes se voient tout de suite.
   Écris des **légendes, pas des paragraphes**.
3. **Les départements réels remplacent les quatre colonnes.** Pour `n` départements (3 à 5) :
   `w = arrondi((1500 − 20×(n−1)) / n)` et `x_i = 20 + i×(w+20)`, `i` de 0 à n−1.
   Applique le même `x`/`w` aux quatre lignes de la colonne : `dept.i`, `obj.i`, `kr.i.1..3`.
   Supprime les colonnes en trop. Garde l'emoji en tête du nom de département.
4. **Plusieurs initiatives par trimestre** : la k-ième (k de 0 à 2) se pose à
   `y = 1296 + 88×k`, même `x`/`w`/`h` que `q<N>.1`, id `q<N>.<k+1>`.
   Si le trimestre le plus chargé porte `m` initiatives, alors **`z.year.h = 290 + 88×(m−1)`**
   et **`footer.y = 1412 + 88×(m−1)`** — sinon les post-it débordent hors de la zone orange.

### Après l'écriture

Le connecteur écrit un **nouveau fichier** dans le dossier 🛟 ; il ne modifie jamais une carte
existante. Dis-le comme ça :

> « C'est écrit. Ouvre TabTree : la toile arrive au prochain scan du dossier 🛟 — sinon
> **♻️ Restaurer**. Vérifie-la, puis **▶ Present** pour la repasser à l'équipe et **📣 Share
> image** pour l'envoyer. »

Puis propose la suite utile : **rejouer Q1 en kanban** pour le suivre semaine par semaine.

### Si le connecteur ne répond pas

`TABTREE_DIR` peut pointer sur un dossier renommé ou déplacé — l'app continue de marcher, le
connecteur non. **Dis-le et arrête-toi là** : ne prétends pas avoir écrit la toile, et ne
propose pas de repli qui fabriquerait un fichier à un endroit que personne ne retrouvera.
Redonne le contenu de l'atelier dans le chat pour qu'il ne soit pas perdu.
