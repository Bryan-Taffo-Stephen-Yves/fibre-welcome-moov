# Fibre Welcome

Démonstrateur du thème 1 du concours Moov Africa Côte d’Ivoire : suivre une installation fibre **du paiement à l’activation**, avec un dossier partagé entre le client, le service client, le planificateur, le technicien et la supervision.

Les règles métier (machine à états, droits, événements, audit, tâches différées) tournent **dans la page**. Sans Internet, tout continue dans le navigateur ; les onglets ouverts sur le même espace se synchronisent en direct.

**Plusieurs appareils : le serveur de démonstration.** Avec Internet, l’espace de test est gardé sur un vrai serveur (projet Supabase « fibre-welcome », base PostgreSQL à Paris). Chaque visiteur reçoit sa **salle**, un code de 8 caractères écrit dans l’adresse (`?salle=K7MP2QXR`). La pastille « Partagé » en haut affiche ce code, un **code QR** et le lien : on le scanne avec le téléphone et les deux appareils voient le même espace, les mêmes dossiers et les mêmes images. Exemple : téléphone en « Client · Awa », ordinateur en « Équipe Moov · Nadia ». Deux visiteurs sans le même code ne se voient pas, et un lien avec un code inconnu ne crée rien.

Si le serveur est injoignable à l’ouverture, la pastille affiche « Cet appareil seulement » et l’application réessaie seule toutes les 15 secondes. Si la connexion tombe en cours d’utilisation, elle affiche « En attente du réseau » : l’action reste faite sur l’appareil et part dès le retour du réseau, une seule fois même si la réponse du serveur s’était perdue. Si un autre appareil a écrit entre-temps, l’action est rejouée sur la version commune (rien n’est écrasé ; si elle ne peut plus s’appliquer, un message le dit). Le serveur refuse toute écriture faite sur une version dépassée. S’il refuse un envoi pour une autre raison (serveur plein, trop d’envois), la pastille devient rouge (« Envoi refusé »), la fenêtre du partage dit pourquoi, et l’application réessaie quelques minutes plus tard. Avec deux onglets ouverts dans le même navigateur, une action faite sans réseau reste à l’onglet qui l’a faite : l’autre onglet demande d’attendre au lieu de mélanger ses actions. Une photo ou une sauvegarde faite sans réseau attend sur l’appareil et part au retour du réseau. Une réinitialisation qui croise l’écriture d’un autre appareil est gardée ; une action qui croise une réinitialisation faite ailleurs est refusée avec un message. Une suppression demandée sans réseau n’efface rien et le dit.

Dans l’aperçu claude.ai, c’est la petite base de l’aperçu qui joue ce rôle (un seul espace commun).

## Lancer

- **Lien public** (GitHub Pages) : https://bryan-taffo-stephen-yves.github.io/fibre-welcome-moov/ , mis à jour à chaque modification de la branche `main` (`.github/workflows/pages.yml` ; une seule fois : Settings, Pages, Source « GitHub Actions »).
- Ou ouvrir `index.html` dans Chrome ou Edge : le partage entre appareils marche aussi, et le code QR renvoie vers le lien public.
- Pour l’installer comme application (PWA) : `python3 -m http.server 8000` dans ce dossier, puis `http://localhost:8000`.
- Au premier lancement, un **espace de test** est créé avec des dossiers fictifs, et une **visite guidée** est proposée.

## Démo en direct (téléphone + ordinateur)

1. Sur l'ordinateur, ouvrir l'application, toucher « Partagé » pour créer une salle, puis sur l'accueil « Ouvrir sur le téléphone » : scanner le code QR (lien `?salle=CODE&vue=client#offres`).
2. Téléphone : choisir une offre, payer (paiement simulé, code à 4 chiffres affiché à l'écran), l'application s'ouvre avec le compte à rebours de 24 h, envoyer le dossier (photos, repère, créneau). Des photos « spécimen » sont proposées : aucune vraie pièce n'est nécessaire.
3. Ordinateur, Équipe Moov : Nadia reçoit la notification, regarde les photos (contrôle automatique simple : netteté, lumière, taille, même photo envoyée deux fois). Un « avis automatique » (simulé, pas une vraie IA) lui propose de valider ou de refuser, avec un bouton « Suivre l’avis » : c’est toujours elle qui décide. Elle peut aussi dire au client ce qui manque. Hervé choisit le technicien et l'heure puis valide.
4. Téléphone : « le technicien viendra le … à … », préparation à cocher. Technicien : « Je pars », le client suit le trajet en direct (durée réglable dans Admin, Réglages), puis arrivée, installation, note du technicien.
5. Téléphone : « Appeler » le service client ; Nadia décroche sur l'ordinateur (appel simulé, sans son).

Le scénario SC-17 du Laboratoire vérifie chaque étape.

## Ce que contient l’application

| Espace | Rôles | Fonctions du cahier des charges |
|---|---|---|
| Espace client (téléphone) | Client, représentant | CL-01 à CL-20 : rattachement par code, accueil avec prochaine action, historique, estimation avec fourchette, adresse et repère, pièces, rendez-vous avec réservation temporaire, préparation, technicien et code de réception, messages, assistant IA, rappel, signalements, notifications, compte rendu, activation et avis, délégation, données personnelles, mode hors ligne |
| Espace terrain (téléphone) | Technicien | TE-01 à TE-08 : missions, étapes, checklist avec unités, numéro de série contrôlé, photos, réception client, file hors ligne rejouée une seule fois, conflits, incident |
| Console opérations | Conseiller, planificateur, superviseur | OP-01 à OP-07, PL-01 à PL-05, PL-07, MO-01, MO-02, MO-06, MO-07 : files de travail avec priorité expliquée, recherche, fiche unifiée, résumé IA relié aux événements, notes internes, doublons, planning, capacités, affectation et réaffectation justifiée, ports et matériel, tableau de bord, double validation |
| Administration | Administrateur, auditeur | MO-03 à MO-12 : comptes et invitations, référentiels et seuils, intégrations et rejeu, audit filtrable, export neutralisé, modèles IA et évaluation, base documentaire, mode dégradé, sauvegarde et restauration |
| Laboratoire | Testeur | Chapitre 7 : espaces isolés, génération, invitation, horloge accélérable, 17 scénarios SC-01 à SC-17 vérifiés sur l’état réel, simulateur de webhooks et de pannes, boîte d’envoi SMS, journal |
| Salle multi-rôles | Tous | Plusieurs sessions côte à côte sur le même dossier |

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/server/model.js` | États, motifs de blocage, rôles, référentiels, lexique |
| `src/server/domain.js` | Règles métier : transitions, blocages, créneaux atomiques, terrain, activation, webhooks signés et dédoublonnés |
| `src/server/backend.js` | « API » : sessions, droits par rôle et périmètre, commandes, lectures filtrées, tâches, reprises, espaces de test |
| `src/server/ai.js` | Estimation (référence et modèle par quantiles), risque, assistant, résumé, évaluation temporelle |
| `src/server/scenarios.js` | Préparation et vérification des 17 scénarios |
| `src/server/seed.js` | Génération des données fictives par graine |
| `src/ui/platform.js` | Branchement du serveur simulé : stockage, verrou, synchronisation des onglets, réseau simulé par personnage, file hors ligne du technicien, photothèque (images en IndexedDB) |
| `src/ui/cloud.js` | Partage entre appareils : salles, version commune et écriture conditionnelle, rejeu des actions faites sans réseau, état compressé, images et sauvegardes (avec leur file d’attente) |
| `src/ui/server-db.js`, `src/ui/server-config.js` | Accès au serveur de démonstration (Supabase) : adresse, clé publique, suivi des versions |
| `supabase/schema.sql` | Table et fonctions publiques du serveur, avec leurs garde-fous : taille, budget total de données, volume et nouveaux documents limités par adresse IP (par /64 en IPv6), 80 images par espace, un seul code de salle par lecture, numéros de version qui ne reculent jamais (à rejouer tel quel sur un nouveau projet) |
| `supabase/a-coller-dans-supabase.sql` | Dernière mise à jour du serveur existant, à coller une fois dans l’éditeur SQL de Supabase |
| `src/ui/vendor/fflate.js` | Compression pour les navigateurs plus anciens (bibliothèque libre fflate, licence MIT) |
| `src/ui/vendor/qrcode.js` | Dessin du code QR (bibliothèque libre qrcode-generator, licence MIT) |
| `src/ui/*.jsx` | Interfaces (React, sans framework) |
| `src/ui/people.jsx` | Personnages dessinés (avatars des rôles, Aya la guide, petites scènes) |
| `src/ui/charts.jsx` | Graphiques sans bibliothèque : courbes, barres, anneau, carte d’Abidjan |
| `src/ui/styles.css`, `src/ui/css/*.css` | Styles communs, puis un fichier par espace (client, terrain, opérations, admin, labo) |
| `tests/backend.test.js` | 16 tests de recette (R-01, R-05 à R-15, R-19 à R-23, scénarios, droits sur les images) |
| `tests/sync.test.js` | 51 tests du partage entre appareils contre une imitation du serveur : écritures croisées, action faite sans réseau, réponse perdue (même après de nombreuses écritures), deux onglets, page rechargée ou tuée avant l’envoi, réseau qui ne répond plus, liaison lente, réponse bloquée en route, code tapé pendant la connexion, réinitialisations croisées, ménage en retard, suppression sans réseau, repartage, nettoyage du serveur, refus du serveur, sauvegardes, photos envoyées plus tard, page ouverte sans réseau, lien piégé, données piégées, navigateur ancien |
| `.github/workflows/` | `pages.yml` met le lien public à jour ; `keepalive.yml` garde le serveur éveillé (lecture tous les deux jours) |

Le serveur simulé n’a aucune dépendance au navigateur : il tourne aussi dans Node pour les tests. Le jour du pilote, on le remplace par une vraie API (NestJS + PostgreSQL, par exemple) qui expose les mêmes commandes, sans réécrire les écrans.

## Design

Style « tableau de bord de suivi » (police Plus Jakarta Sans, cartes arrondies, cartes sombres pour les chiffres, onglets en pastilles), avec des personnages dessinés pour chaque rôle. Clair et sombre, ordinateur et téléphone.

## Commandes

```bash
npm install        # installe esbuild (outil de construction)
npm run build      # reconstruit app.js et styles.css depuis src/
npm test           # 72 tests : recette du serveur simulé et partage entre appareils
```

`node build.mjs page.html` produit en plus une page autonome (React chargé depuis cdnjs) pour un aperçu en ligne.

## Ce qui est simulé ou à valider

- **Systèmes Moov** : Moov Prospect, Moov Money, activation réseau, SMS/WhatsApp et inventaire sont des simulateurs, signalés partout par un badge violet. Ils reproduisent aussi les pannes.
- **IA** : entraînée sur un historique **synthétique** généré par graine. L’évaluation montre que la chaîne marche, pas la précision réelle.
- **Identité** : codes de démonstration affichés dans la boîte d’envoi simulée ; aucune vraie authentification.
- **Serveur** : le serveur de démonstration garde et partage les espaces, mais les règles s’exécutent encore dans chaque navigateur. Pour un vrai pilote, ces règles passent côté serveur (même découpage en commandes) avec une vraie authentification. Le projet Supabase gratuit se met en pause après une semaine sans visite : `keepalive.yml` l’évite en le consultant tous les deux jours ; s’il est quand même en pause, il se relance d’un clic depuis le tableau de bord Supabase. Toute personne qui a le code d’une salle voit son espace : données fictives seulement ; un espace inactif 14 jours est effacé.
- **Images** (pièces d’identité, photos du technicien) : réduites à 1 280 px, rangées à part du dossier ; chacun ne voit que ce que son rôle l’autorise à voir (le technicien seulement pendant sa mission, jamais le représentant ni l’auditeur). Démo : n’envoyez pas de vraie pièce d’identité.
- **Valeurs métier** (seuils, délais, capacités, règles de remboursement) : valeurs de démonstration à fixer avec Moov.
