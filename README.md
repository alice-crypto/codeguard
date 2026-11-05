# codeguard

Agent de **review** et de **nettoyage** de code, en local et sur GitHub, propulsé par Claude.

- `codeguard review` relit des changements locaux, une branche, des fichiers ou une PR GitHub.
- `codeguard clean` nettoie le code sans changer son comportement, sur une branche dédiée.

## Installation

Python 3.11 ou plus récent, et git.

```bash
pip install -e .
```

Identifiants, lus uniquement depuis l'environnement :

| Variable | Usage |
|---|---|
| `ANTHROPIC_API_KEY` | Obligatoire pour `review` et `clean` |
| `GITHUB_TOKEN` ou `GH_TOKEN` | Pour `--pr`, `--post` et `--open-pr` (la CLI `gh` n'est pas nécessaire) |

## Interface graphique

```bash
codeguard ui
```

La commande ouvre l'interface dans ton navigateur (`--port` pour choisir le port, `--no-browser`
pour seulement afficher le lien). Elle fait la même chose que la CLI :

- ouvrir un dépôt, voir sa branche et ses changements, puis lancer une review ou un nettoyage ;
- suivre l'activité de l'agent en direct et l'arrêter ;
- lire et filtrer les remarques, copier les suggestions, exporter en Markdown, JSON ou SARIF ;
- relire le diff d'un nettoyage, puis le pousser, ouvrir une PR ou l'abandonner.

Publier, pousser, abandonner ou lancer les vérifications demande toujours une confirmation.
La fusion reste une commande à copier, car elle modifie ton répertoire de travail.

Les clés peuvent venir de l'environnement ou être saisies dans l'interface : elles restent alors
en mémoire jusqu'à l'arrêt du serveur, sans jamais être écrites sur le disque. Une seule analyse
tourne à la fois. L'arrêt prend effet à la fin de la requête en cours, et l'historique est perdu à
la fermeture du serveur.

Le serveur n'écoute que sur `127.0.0.1`. Un site ouvert dans le même navigateur peut quand même
tenter de joindre un port local, c'est pourquoi chaque requête est contrôlée : hôte, cookie de
session issu d'un jeton aléatoire, et en-tête dédié sur les écritures. Le lien affiché au démarrage
donne accès à l'interface : ne le partage pas.

## Review

```bash
codeguard review                      # changements non commités, sinon branche vs base
codeguard review --staged             # changements indexés
codeguard review --base main          # branche courante par rapport à main
codeguard review --paths src/api      # audit complet, sans diff
codeguard review --pr 42              # PR GitHub, rapport local uniquement
codeguard review --pr 42 --post       # publie les commentaires sur la PR
```

Options utiles : `--format text|markdown|json|sarif`, `-o rapport.sarif`, `--fail-on high` (code de
sortie 1 à partir de ce niveau), `--min-severity medium`, `--effort xhigh`, `--max-cost 2`.

Avant d'être affichée, chaque remarque est vérifiée par le code : un fichier ou une ligne qui
n'existe pas fait écarter la remarque, et le rapport le signale. Sur GitHub, une remarque hors des
lignes du diff va dans le résumé, et une remarque déjà publiée n'est pas répétée.

## Nettoyage

```bash
codeguard clean                       # fichiers modifiés depuis la branche par défaut
codeguard clean --paths src/utils     # fichiers ou dossiers précis
codeguard clean --goal "code mort"    # objectif précis
codeguard clean --run-checks          # lance les checks configurés avant et après
codeguard clean --dry-run             # affiche le diff et ne conserve rien
codeguard clean --pr 42 --open-pr     # nettoie une PR et propose le résultat en PR
```

Le travail se fait dans un worktree temporaire : ton répertoire courant n'est jamais modifié et les
changements non commités ne sont pas pris en compte. Le résultat est un commit sur une branche
`codeguard/clean-<date>`, avec les commandes pour le voir, le fusionner ou l'abandonner.

Avec `--run-checks` :

- si les checks échouent déjà avant le nettoyage, l'agent n'est pas lancé ;
- s'ils échouent après, rien n'est commité et le worktree est conservé pour inspection.

Dans un worktree neuf, les dépendances ignorées par git (`node_modules`, `.venv`) sont absentes :
tes commandes de check doivent en tenir compte. Sans `--run-checks`, rien ne vérifie que le
comportement est préservé : relis le diff avant de fusionner.

## Configuration

`codeguard init` crée un fichier `.codeguard.toml` commenté :

```toml
[codeguard]
effort = "high"
language = "français"
max_cost_usd = 5.0
min_severity = "low"
instructions = "Le code de src/legacy est gelé."
extra_exclude = ["generated/*"]
checks = ["pytest -q", "ruff check ."]
formatters = ["ruff format ."]
```

Le modèle par défaut est `claude-opus-5-5`. Le budget est une estimation calculée à partir des
tarifs connus : une fois atteint, l'agent perd ses outils et rend le travail fait, marqué comme
incomplet. Le dépassement peut donc atteindre le coût d'une dernière requête. Pour un modèle absent
de la table de prix, seul `max_turns` s'applique.

## GitHub Actions

1. Publie ce dépôt sur GitHub : le fichier `action.yml` en fait une action réutilisable.
2. Ajoute le secret `ANTHROPIC_API_KEY` au dépôt à relire.
3. Lance `codeguard init --workflow` dans ce dépôt, puis remplace `OWNER/codeguard` dans
   `.github/workflows/codeguard.yml`.

Le workflow utilise `pull_request` et non `pull_request_target` : il ne s'exécute pas sur les PR de
forks, faute d'accès aux secrets. Il ne clone rien et n'exécute pas le code de la PR. Sa
configuration est lue sur le commit de base, pour qu'une PR ne puisse pas changer ses propres règles.

## Sécurité

Le contenu d'un dépôt peut chercher à manipuler l'agent. Les garanties ci-dessous sont donc
appliquées par le code, et ne reposent pas sur les consignes données au modèle.

| Garantie | Mise en œuvre |
|---|---|
| Rien n'est publié sans demande | Seuls `--post`, `--push` et `--open-pr` écrivent sur GitHub. Le modèle n'a aucun outil pour cela |
| Une PR n'est ni approuvée ni bloquée par l'agent | Les reviews sont toujours de simples commentaires |
| Confinement | Chemins absolus, `..`, `.git` et liens sortant du dépôt sont refusés |
| Secrets | `.env`, clés et fichiers similaires sont exclus des diffs, listes, recherches et lectures |
| Périmètre du nettoyage | Le modèle ne peut modifier ou supprimer que les fichiers du périmètre, mais peut en créer de nouveaux |
| Pas de commande libre | Le modèle ne peut lancer que les checks configurés, sans shell et sans les identifiants du processus |
| Exécution de code | Rien n'est exécuté sans `--run-checks`. Sur une PR, les commandes viennent de ta configuration locale |
| Token GitHub | Jamais envoyé au modèle ni transmis lors d'une redirection vers un autre hôte. HTTPS obligatoire hors localhost |
| Mentions | Les `@mentions` rédigées par le modèle sont neutralisées dans les commentaires publiés |

Limites à connaître :

- `--run-checks` sur une PR exécute le code de cette PR sur ta machine : ne l'utilise que sur du
  code auquel tu fais confiance.
- La détection des fichiers sensibles repose sur leur nom : un secret écrit en dur dans un fichier
  source ordinaire est envoyé à l'API comme le reste du fichier.
- Le code relu est transmis à l'API Anthropic.

## Codes de sortie

| Code | Signification |
|---|---|
| 0 | Succès |
| 1 | Remarques au niveau de `--fail-on` ou au-dessus |
| 2 | Erreur, ou vérifications en échec |

## Développement

```bash
pip install -e ".[dev]"
pytest
ruff check .
```

Pour essayer l'interface sans clé ni réseau, avec un dépôt d'exemple et de faux services :

```bash
python tests/demo_ui.py
```

Les tests utilisent le vrai SDK et le vrai git, avec de faux serveurs Anthropic et GitHub locaux.
Ils ne nécessitent ni clé ni réseau, mais ne garantissent pas à eux seuls que l'API réelle accepte
les requêtes.
