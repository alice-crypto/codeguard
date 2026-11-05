"""Interface en ligne de commande de codeguard."""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

import anthropic

from codeguard import __version__, gitops
from codeguard.clean import run_clean
from codeguard.config import CONFIG_FILENAME, SEVERITIES, ConfigError
from codeguard.report import RENDERERS, clean_text
from codeguard.review import post_review, run_review
from codeguard.service import (
    Overrides,
    describe_error,
    open_cleanup_pull_request,
    prepare_clean,
    prepare_review,
)

EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_ERROR = 2

_CONFIG_TEMPLATE = """\
[codeguard]
# model = "claude-opus-5-5"
# effort = "high"            # low | medium | high | xhigh | max
# language = "français"
# max_turns = 40
# max_cost_usd = 5.0
# min_severity = "low"       # critical | high | medium | low | info

# Consignes propres au projet, transmises à l'agent.
# instructions = "Le code de src/legacy est gelé."

# Exclusions ajoutées aux valeurs par défaut (lockfiles, dist, node_modules...).
# extra_exclude = ["generated/*"]

# Commandes lancées uniquement avec `codeguard clean --run-checks`.
# checks = ["pytest -q", "ruff check ."]
# formatters = ["ruff format ."]
"""

_WORKFLOW_TEMPLATE = """\
name: codeguard

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    # Les PR de forks n'ont pas accès aux secrets : le job est ignoré pour elles.
    if: ${{ !github.event.pull_request.draft && github.event.pull_request.head.repo.full_name == github.repository }}
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: alice-crypto/codeguard@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          fail-on: high
"""


def _log(quiet: bool):
    def log(message: str) -> None:
        if not quiet:
            print(message, file=sys.stderr)

    return log


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--repo", help="Dépôt GitHub owner/nom (détecté depuis origin sinon)")
    parser.add_argument("--config", type=Path, help=f"Fichier de configuration ({CONFIG_FILENAME})")
    parser.add_argument("--model", help="Modèle Claude")
    parser.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max"])
    parser.add_argument("--max-turns", type=int, help="Nombre maximal de tours de l'agent")
    parser.add_argument("--max-cost", type=float, help="Budget estimé maximal en dollars")
    parser.add_argument("-q", "--quiet", action="store_true", help="Masque la progression")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codeguard", description=__doc__)
    parser.add_argument("--version", action="version", version=f"codeguard {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)

    review = commands.add_parser("review", help="Relit du code et produit un rapport")
    scope = review.add_mutually_exclusive_group()
    scope.add_argument("--staged", action="store_true", help="Changements indexés")
    scope.add_argument("--base", help="Branche courante par rapport à cette référence")
    scope.add_argument("--paths", nargs="+", help="Audit complet de fichiers ou de dossiers")
    scope.add_argument("--pr", type=int, help="Numéro de pull request GitHub")
    review.add_argument("--post", action="store_true", help="Publie la review sur la PR")
    review.add_argument("--fail-on", choices=SEVERITIES, help="Code de sortie 1 dès ce niveau")
    review.add_argument("--format", choices=sorted(RENDERERS), default="text")
    review.add_argument("-o", "--output", type=Path, help="Écrit le rapport dans ce fichier")
    review.add_argument("--min-severity", choices=SEVERITIES)
    _add_common(review)

    clean = commands.add_parser("clean", help="Nettoie le code sur une branche dédiée")
    scope = clean.add_mutually_exclusive_group()
    scope.add_argument("--base", help="Fichiers modifiés depuis cette référence")
    scope.add_argument("--paths", nargs="+", help="Fichiers ou dossiers à nettoyer")
    scope.add_argument("--pr", type=int, help="Fichiers d'une pull request GitHub")
    clean.add_argument("--goal", default="", help="Objectif précis du nettoyage")
    clean.add_argument(
        "--run-checks",
        action="store_true",
        help="Exécute les commandes checks et formatters de la configuration",
    )
    clean.add_argument("--dry-run", action="store_true", help="Affiche le diff sans rien conserver")
    clean.add_argument("--push", action="store_true", help="Pousse la branche sur origin")
    clean.add_argument("--open-pr", action="store_true", help="Pousse et ouvre une pull request")
    _add_common(clean)

    init = commands.add_parser("init", help="Crée la configuration et le workflow GitHub")
    init.add_argument("--workflow", action="store_true", help="Crée aussi le workflow GitHub")

    ui = commands.add_parser("ui", help="Ouvre l'interface graphique dans le navigateur")
    ui.add_argument("--port", type=int, help="Port local (8765 par défaut, sinon un port libre)")
    ui.add_argument("--no-browser", action="store_true", help="N'ouvre pas le navigateur")
    return parser


def _overrides(args: argparse.Namespace) -> Overrides:
    return Overrides(
        model=args.model,
        effort=args.effort,
        max_turns=args.max_turns,
        max_cost=args.max_cost,
        min_severity=getattr(args, "min_severity", None),
    )


def _git_root() -> Path | None:
    try:
        return gitops.repo_root(Path.cwd())
    except gitops.GitError:
        return None


def cmd_review(args: argparse.Namespace) -> int:
    log = _log(args.quiet)
    if args.post and args.pr is None:
        raise ConfigError("--post nécessite --pr")

    prepared = prepare_review(
        _git_root(),
        staged=args.staged,
        base=args.base,
        paths=args.paths,
        pr=args.pr,
        repo=args.repo,
        config_path=args.config,
        overrides=_overrides(args),
    )
    report = run_review(
        anthropic.Anthropic(), prepared.target, prepared.config, prepared.settings, log
    )
    if args.post:
        report.posted_url = post_review(prepared.github, prepared.repo, report, prepared.target)
        log(f"review publiée : {report.posted_url}")

    rendered = RENDERERS[args.format](report)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
        log(f"rapport écrit dans {args.output}")
    else:
        print(rendered)

    if args.fail_on:
        threshold = SEVERITIES.index(args.fail_on)
        if any(finding.severity_rank <= threshold for finding in report.findings):
            return EXIT_FINDINGS
    return EXIT_OK


def cmd_clean(args: argparse.Namespace) -> int:
    log = _log(args.quiet)
    root = _git_root()
    if root is None:
        raise ConfigError("le nettoyage nécessite un clone git local")
    if args.dry_run and (args.push or args.open_pr):
        raise ConfigError("--dry-run est incompatible avec --push et --open-pr")

    prepared = prepare_clean(
        root,
        base=args.base,
        paths=args.paths,
        pr=args.pr,
        repo=args.repo,
        goal=args.goal,
        run_checks=args.run_checks,
        dry_run=args.dry_run,
        need_github=args.open_pr,
        config_path=args.config,
        overrides=_overrides(args),
    )
    request = prepared.request
    if not request.files:
        print(
            f"Rien à nettoyer ({request.target}). "
            "Précise --paths pour viser des fichiers existants."
        )
        return EXIT_OK
    for warning in prepared.warnings:
        log(f"attention : {warning}")

    report = run_clean(
        anthropic.Anthropic(), root, request, prepared.config, prepared.settings, log
    )
    print(clean_text(report))

    if report.status in ("checks_failed", "baseline_failed"):
        return EXIT_ERROR
    if report.status == "committed" and (args.push or args.open_pr):
        gitops.push_branch(root, report.branch)
        print(f"Branche poussée : {report.branch}")
        if args.open_pr:
            url = open_cleanup_pull_request(
                prepared.github, prepared.repo, root, report, prepared.pull_request
            )
            print(f"Pull request : {url}")
    return EXIT_OK


def cmd_init(args: argparse.Namespace) -> int:
    root = _git_root() or Path.cwd()
    targets = [(root / CONFIG_FILENAME, _CONFIG_TEMPLATE)]
    if args.workflow:
        targets.append((root / ".github" / "workflows" / "codeguard.yml", _WORKFLOW_TEMPLATE))
    for path, content in targets:
        if path.exists():
            print(f"Déjà présent, non modifié : {path}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(f"Créé : {path}")
    return EXIT_OK


def cmd_ui(args: argparse.Namespace) -> int:
    from codeguard.ui.server import create_server

    server = create_server(port=args.port)
    print(f"Interface codeguard : {server.launch_url}", flush=True)
    print("Ce lien donne accès à l'interface : ne le partage pas. Ctrl+C pour arrêter.")
    if not args.no_browser:
        webbrowser.open(server.launch_url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Arrêt de l'interface.")
    finally:
        server.server_close()
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    handlers = {"review": cmd_review, "clean": cmd_clean, "init": cmd_init, "ui": cmd_ui}
    try:
        return handlers[args.command](args)
    except Exception as exc:
        message = describe_error(exc)
        if message is None:
            raise
        print(f"Erreur : {message}", file=sys.stderr)
    return EXIT_ERROR
