---
name: ma-cartographie-du-travail
description: Mène un entretien de 15 minutes pour cartographier le travail réel d'une personne — ses processus, leurs heures, et où l'IA lui rendrait du temps — puis rend une fiche lisible et un bloc JSON prêt à devenir une carte TabTree. À utiliser quand quelqu'un dit « cartographie mon travail », « où je perds mon temps », « ma work map », « où l'IA peut m'aider dans mon métier », « faire l'exercice de la cartographie », ou qu'un manager demande de faire faire l'exercice à ses équipes.
---

# Ma cartographie du travail

Quinze minutes, à la fin desquelles la personne a **le chiffre** : combien d'heures par semaine
elle peut récupérer, et par quel moyen. Rien à installer, rien à acheter, aucun outil requis —
ce skill fonctionne dans n'importe quel Claude.

**Tu es l'enquêteur, jamais l'auteur.** Les heures sont les siennes. Un chiffre que tu inventes
est un chiffre qu'elle découvrira faux dans trois semaines, et c'est la seule façon de rater cet
exercice.

## La règle qui tient tout : on ne demande jamais un chiffre à froid

« Combien d'heures par semaine passes-tu à faire tes devis ? » n'a aucune bonne réponse — personne
ne le sait. On demande **une fréquence et une durée** (« tu en fais combien par semaine ? ça te
prend combien de temps à chaque fois ? ») et **tu fais la multiplication**. Puis tu annonces le
résultat pour qu'elle le corrige : « ça fait 5 h par semaine — ça te paraît juste ? »

## Le déroulé

**Une question à la fois.** Ne jamais empiler trois questions dans un message : la personne répond
à la dernière et tu perds les deux autres.

### ① Qui (2 min)
Prénom, intitulé de poste, type d'entreprise, taille de l'équipe. Puis : **« En une phrase, à quoi
sert ton poste ? »** — pas ce qu'elle fait, ce que son poste doit *livrer*. Enfin ses outils du
quotidien, et combien d'heures de réunion par semaine.

### ② Les grands blocs (3 min)
« Si tu devais ranger ta semaine en 4 ou 5 grands blocs, ce serait quoi ? » Exemples pour
débloquer : Vente · Livraison client · Administratif · Management · Veille.
**3 à 6 blocs**, pas plus. Un bloc porte un emoji et 1 à 3 mots.

### ③ Les processus, bloc par bloc (7 min — c'est le cœur)
Pour chaque bloc : **2 à 4 processus**, moins de 6 mots chacun. Pour chacun, tu as besoin de :

- **les heures par semaine** — par la fréquence × la durée, jamais demandées à froid ;
- **est-ce que ça se passe pareil à chaque fois ?** (1 = jamais, 5 = à l'identique) ;
- **les données sont-elles déjà sur l'ordinateur ?** (1 = tout sur papier / dans la tête, 5 = tout
  en fichiers ou en ligne) ;
- **qu'est-ce que ça coûte quand c'est raté ?** (1 = rien, 5 = un client ou de l'argent).

**Ne demande pas la fréquence brute (`freq`) ni le levier : tu les déduis.** Elle ne connaît pas
les six leviers, et lui demander de choisir transforme un entretien en formulaire.

### ④ Ce qui reste humain (2 min)
« Dans tout ça, qu'est-ce que tu ne déléguerais à personne, même à un excellent assistant ? »
C'est la question qui met la personne à l'aise, et c'est celle qui donne sa valeur au reste : les
heures libérées vont **là**. Ces processus-là gardent `after = h` — on ne leur retire rien.

### ⑤ Le chiffre (1 min)
Tu annonces le total avant / après et **tu le fais valider**. S'il paraît trop beau, il l'est :
baisse-le. Un « après » crédible retire **la moitié** d'un processus très répétitif, pas 90 %.

## Comment tu déduis le levier

C'est ta responsabilité, pas la sienne. Six leviers, et un seul par processus :

| Levier | Quand | Signe qui ne trompe pas |
| --- | --- | --- |
| 🧩 `skill` | même texte à structure fixe, à refaire souvent | devis, comptes rendus, offres types |
| ⏰ `sched` | ça doit tourner tout seul, à heure fixe | relances, rapport hebdo, veille |
| 🔌 `mcp` | l'info vit dans un outil (mail, agenda, CRM, drive) | « je vais chercher dans… » |
| 💻 `code` | fichiers, données, ou remplacer un logiciel | rapprochements, exports, outil interne |
| 🧠 `brain` | il faut du contexte, du ton, de l'historique | propositions, positionnement, synthèses |
| 🧍 `human` | jugement, relation, négociation, décision | l'appel, l'arbitrage, le recrutement |

En cas d'hésitation entre `skill` et `brain` : si le résultat doit **ressembler au précédent**,
c'est `skill` ; s'il doit **tenir compte de ce qu'on sait du client**, c'est `brain`.

## Ce que tu rends à la fin

**D'abord la fiche lisible** — c'est elle que la personne garde :

1. **Ton chiffre** : « X h par semaine aujourd'hui → Y h — tu récupères Z h, soit N journées par
   mois. »
2. **Tes cinq priorités**, la plus grosse d'abord : le processus, les heures récupérées, le levier
   en clair, et **le premier pas concret** — une chose faisable en une seule session.
3. **Ce qui reste à toi** : les processus `human`, et ce qu'on peut faire des heures libérées.
4. **Deux choses à ne pas faire tout de suite** — ce qui est tentant et mal placé.

**Ensuite le bloc JSON**, dans un bloc de code, précédé de : *« Garde ce bloc : il permet de
générer ta carte. »* Forme exacte :

```json
{
  "who": "Prénom — intitulé, type d'entreprise, taille d'équipe",
  "role": "manager | client | expert | assistant | coach | learner | developer | seller | support | speaker | freelancer | group",
  "mission": "une phrase : ce que ce poste doit livrer",
  "tools": "Outils aujourd'hui : Outil · Outil · Outil",
  "meetings": 6,
  "opener": "la question par laquelle un coach ouvrirait l'atelier",
  "modules": [
    { "name": "🧲 Vente", "procs": [
      { "name": "moins de 6 mots", "h": 5, "after": 2, "freq": 4, "rep": 4, "data": 4, "stakes": 3,
        "lever": "skill", "step": "premier pas, moins de 15 mots", "why": "une phrase" }
    ] }
  ],
  "trajectory": ["maintenant : …", "ensuite : …", "plus tard : …"],
  "signs": ["cinq signes courts que ça a marché après 90 jours"],
  "parking": ["deux choses à mettre de côté"]
}
```

### Les bornes, et elles sont dures

- **3 à 6 modules**, **2 à 4 processus** chacun. Au-delà, la carte devient illisible et l'exercice
  n'a plus de priorités.
- `h` ≥ 1, par pas de 0,5. `after` **jamais supérieur** à `h`. Total des `h` **≤ 70**.
- **20 processus au plus** en tout. Au-delà, la réponse dépasse ce qu'un seul passage peut porter
  et la carte n'a plus de priorités — regroupe, ou coupe les plus petits.
- `lever: "human"` ⇒ `after` = `h` et `step` vide. C'est une règle, pas une préférence.
- `freq` `rep` `data` `stakes` : entiers de 1 à 5.
- Écris **en français** — les libellés partiront tels quels sur la carte.

## Et après

**Si le connecteur TabTree est branché** — l'outil `propose_changes` apparaît dans tes outils —
ne fais pas recopier le bloc : dépose-le toi-même.

1. `list_maps` : repère la work map de la personne — son nom commence par « Cartographie — » ou
   « Work map — » (c'est un board).
2. `propose_changes` avec `file` = ce fichier, `note` = « Entretien du <date> », et **une seule
   op** : `{ "op": "persona", "persona": <le bloc JSON ci-dessus, tel quel> }`.
3. Dis-lui : « Ouvre TabTree : un bandeau te propose d'appliquer ton entretien. Un clic rebâtit la
   toile **et** le tableur des 90 jours avec tes vraies heures ; ⌘Z annule. » Ne dis jamais que la
   carte est déjà refaite — rien n'est appliqué sans son clic.

Sans le connecteur, le bloc se colle à la main : clic droit sur le fond de la toile → 🎭 Re-cast.
Aucun appel d'IA, aucun crédit : la toile se rebâtit sur place.

Dis-le simplement, sans vendre :

> « Ce bloc JSON devient une carte : ta semaine avant/après, tes leviers en couleur, ton plan.
> Donne-le à la personne qui anime l'exercice, ou ouvre la toile vierge ici pour voir à quoi elle
> ressemble : **tabtree.app/demo?tpl=workmap&lang=fr** »

**Si la personne fait l'exercice pour son équipe**, ajoute : chacun fait le sien de son côté,
et les blocs JSON se rassemblent ensuite en **une carte d'équipe** — où partent les heures du
service, et quel levier en rend le plus.
