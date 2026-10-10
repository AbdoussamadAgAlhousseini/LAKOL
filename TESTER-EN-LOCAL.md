# Tester LAKOL sur son ordinateur

Ce guide permet d'essayer LAKOL sur un ordinateur Windows, Mac ou Linux, sans serveur ni nom de domaine. Aucune connaissance en programmation n'est nécessaire. Tout tourne dans Docker, et les messages WhatsApp et les emails sont simulés : rien n'est envoyé à de vrais parents.

Durée : environ 30 minutes la première fois, dont 10 à 20 minutes de téléchargement et de construction. Ensuite, le démarrage prend moins d'une minute.

## 1. Ce qu'il faut

- Un ordinateur avec **8 Go de mémoire** (16 Go c'est plus confortable) et **15 Go d'espace disque** libre.
- Une connexion internet pour la première installation. Ensuite, LAKOL fonctionne sans internet sur l'ordinateur.

## 2. Installer Docker Desktop (une seule fois)

1. Télécharger Docker Desktop sur https://www.docker.com/products/docker-desktop/ (Windows, Mac Intel ou Mac Apple Silicon).
2. L'installer et redémarrer l'ordinateur si on vous le demande.
   - Sur Windows, accepter l'installation de **WSL 2** si elle est proposée.
3. Lancer Docker Desktop et attendre que la baleine en bas à gauche indique « Engine running ».

## 3. Récupérer le code

Le plus simple, sans Git :

1. Ouvrir https://github.com/AbdoussamadAgAlhousseini/LAKOL (en étant connecté à votre compte GitHub).
2. Cliquer sur le bouton vert **Code**, puis **Download ZIP**.
3. Décompresser le fichier, par exemple dans `Documents\LAKOL`.

Avec Git, la commande est : `git clone https://github.com/AbdoussamadAgAlhousseini/LAKOL.git`

Pour récupérer plus tard une nouvelle version : retélécharger le ZIP, ou lancer `git pull` dans le dossier.

## 4. Ouvrir un terminal dans le dossier

- **Windows** : ouvrir le dossier décompressé dans l'explorateur de fichiers, cliquer dans la barre d'adresse, taper `powershell` puis Entrée.
- **Mac** : clic droit sur le dossier dans le Finder, puis « Nouveau terminal au dossier ». Si cette option n'apparaît pas, ouvrir Terminal, taper `cd `, glisser le dossier dans la fenêtre, puis Entrée.

Toutes les commandes ci-dessous se tapent dans ce terminal.

## 5. Démarrer LAKOL

```sh
docker compose --profile app up -d --build
```

La première fois, cette commande télécharge et construit tout ; comptez 10 à 20 minutes. Elle s'arrête quand tous les services sont démarrés.

Ensuite, charger les écoles de démonstration (30 élèves, professeurs, parents, notes, devoirs, paiements) :

```sh
docker compose --profile demo run --rm demo
```

Le message `École « Les Étoiles » : 30 élèves` confirme que tout est prêt.

> Attention : cette commande **efface toute la base** avant de recréer les données de démonstration. C'est voulu pour un essai, mais elle ne doit jamais être utilisée sur le serveur de production.

## 6. Utiliser l'application

Ouvrir **http://localhost:3000** dans le navigateur.

| Rôle                         | Identifiant                         | Mot de passe  |
| ---------------------------- | ----------------------------------- | ------------- |
| Directeur                    | `directeur@les-etoiles.lakol.test`  | `Lakol2025!`  |
| Comptable                    | `comptable@les-etoiles.lakol.test`  | `Lakol2025!`  |
| Professeur de maths          | `prof.maths@les-etoiles.lakol.test` | `Lakol2025!`  |
| Parent de deux enfants       | `70 00 00 01`                       | `Parent2025!` |
| Élève (Aminata Traoré, 7e A) | `ETO-25-0029`                       | `Eleve2025!`  |
| Super admin de la plateforme | `admin@lakol.test`                  | `Admin2025!`  |

La liste complète des comptes est dans `README.md`, section « Comptes de démonstration ».

Quelques parcours à essayer :

1. **Professeur** : faire l'appel d'une classe en marquant un élève absent.
2. **Parent** : voir la notification d'absence, les devoirs, les notes et le solde des frais des deux enfants.
3. **Comptable** : enregistrer un paiement en espèces, puis télécharger le reçu PDF.
4. **Directeur** : consulter le tableau de bord, valider les notes, publier les bulletins.
5. **Super admin** (http://localhost:3000/fr/admin) : voir les écoles, les formules et les factures.
6. **Nouvelle école** (http://localhost:3000/fr/creer-mon-ecole) : tester l'assistant de démarrage.

Pour tester l'affichage sur téléphone, réduire la largeur de la fenêtre. Autre option : dans Chrome, appuyer sur F12 puis sur l'icône téléphone.

### Voir les WhatsApp et emails simulés

Les WhatsApp et les emails (absences, accès des parents, relances d'impayés…) ne partent pas vraiment. Ils s'affichent dans le journal du « worker » :

```sh
docker compose logs -f worker
```

Appuyer sur `Ctrl + C` pour arrêter l'affichage (LAKOL continue de tourner).

## 7. Arrêter, relancer, repartir de zéro

| Pour…                                        | Commande                                      |
| -------------------------------------------- | --------------------------------------------- |
| Arrêter LAKOL (les données sont conservées)  | `docker compose --profile app down`           |
| Relancer                                     | `docker compose --profile app up -d`          |
| Remettre les données de démonstration à neuf | `docker compose --profile demo run --rm demo` |
| Installer une nouvelle version du code       | `docker compose --profile app up -d --build`  |
| Tout supprimer, données comprises            | `docker compose --profile app down -v`        |

## 8. En cas de problème

- **« port is already allocated »** (ports 3000, 5432, 6379, 8025 ou 9000) : un autre logiciel utilise déjà ce port, souvent une base PostgreSQL ou un autre projet. Arrêter ce logiciel, ou redémarrer l'ordinateur, puis relancer la commande.
- **« Cannot connect to the Docker daemon »** ou **« docker: command not found »** : Docker Desktop n'est pas lancé. L'ouvrir, attendre « Engine running », puis recommencer.
- **La page ne s'affiche pas** : attendre une minute après le démarrage. Ensuite, vérifier l'état avec `docker compose --profile app ps` : le service `app` doit être `healthy`. En cas de doute, regarder `docker compose logs app`.
- **« Identifiant ou mot de passe incorrect »** avec les comptes ci-dessus : les données de démonstration ne sont pas chargées. Lancer `docker compose --profile demo run --rm demo`.
- **Construction très lente ou ordinateur saturé** : dans Docker Desktop, Settings > Resources, allouer au moins 4 Go de mémoire.

## Pour les développeurs

Pour modifier le code avec rechargement automatique, utiliser `pnpm dev` (voir `README.md`, section « Installation »). Dans ce cas, ne démarrer que les services avec `docker compose up -d`.
