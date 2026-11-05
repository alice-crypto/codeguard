"use strict";

// Everything from a repository (code, paths, model text) is hostile by assumption:
// the DOM is only ever built through h(), which inserts text nodes, never HTML.

const SEVERITY_LABELS = {
  critical: "Critique",
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
  info: "Info",
};
const CATEGORY_LABELS = {
  bug: "bug",
  security: "sécurité",
  performance: "performance",
  concurrency: "concurrence",
  maintainability: "maintenabilité",
  dead_code: "code mort",
  tests: "tests",
  style: "style",
};
const KIND_LABELS = {
  dead_code: "code mort",
  duplication: "duplication",
  simplification: "simplification",
  naming: "nommage",
  comments: "commentaires",
  imports: "imports",
  other: "autre",
};
const EFFORT_LABELS = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
  xhigh: "Très élevé",
  max: "Maximal",
};
const TARGETS = {
  review: [
    ["auto", "Changements en cours", "Non commités, sinon la branche par rapport à la base"],
    ["staged", "Changements indexés", null],
    ["base", "Branche par rapport à une référence", null],
    ["paths", "Audit de fichiers", "Sans diff : les fichiers tels quels"],
    ["pr", "Pull request GitHub", null],
  ],
  clean: [
    ["base", "Fichiers modifiés depuis une référence", null],
    ["paths", "Fichiers ou dossiers précis", null],
    ["pr", "Fichiers d'une pull request", null],
  ],
};
const STATUS_LABELS = {
  running: "En cours",
  done: "Terminée",
  failed: "En échec",
  cancelled: "Arrêtée",
};
const POLL_MS = 800;
const RECENT_KEY = "codeguard.recentProjects";

const state = {
  status: null,
  project: null,
  kind: "review",
  mode: { review: "auto", clean: "base" },
  jobs: [],
  current: null,
  logs: [],
  filter: null,
  pollTimer: null,
};

const $ = (id) => document.getElementById(id);

function h(tag, attributes, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") element.className = value;
    else if (name === "onclick") element.addEventListener("click", value);
    else element.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

async function api(path, body) {
  const options = body === undefined
    ? {}
    : {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Codeguard": "1" },
        body: JSON.stringify(body),
      };
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error("Interface déconnectée : le serveur codeguard ne répond plus.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}

function readRecent() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberProject(path) {
  const recent = [path, ...readRecent().filter((item) => item !== path)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Storage may be unavailable: recent projects are only a convenience.
  }
  renderRecent();
}

function renderRecent() {
  $("project-recent").replaceChildren(...readRecent().map((path) => h("option", { value: path })));
}

function showError(element, message) {
  element.textContent = message || "";
  element.hidden = !message;
}

function formatCost(value) {
  return typeof value === "number" ? `~${value.toFixed(2)} $` : "coût inconnu";
}

function formatTime(seconds) {
  return new Date(seconds * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function plural(count, singular, pluralForm) {
  return `${count} ${count > 1 ? pluralForm || `${singular}s` : singular}`;
}

// --- Confirmation

function confirmAction(title, body, label) {
  const dialog = $("confirm-dialog");
  $("confirm-title").textContent = title;
  $("confirm-body").textContent = body;
  $("confirm-ok").textContent = label;
  dialog.showModal();
  return new Promise((resolve) => {
    const finish = (value) => {
      $("confirm-ok").onclick = null;
      $("confirm-cancel").onclick = null;
      dialog.oncancel = null;
      dialog.close();
      resolve(value);
    };
    $("confirm-ok").onclick = () => finish(true);
    $("confirm-cancel").onclick = () => finish(false);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
  });
}

// --- Credentials

function renderCredentials() {
  const credentials = state.status.credentials;
  const describe = (source) =>
    source === "session" ? "définie pour cette session" : source === "env" ? "définie dans l'environnement" : "non définie";
  $("dot-anthropic").classList.toggle("on", Boolean(credentials.anthropic));
  $("dot-github").classList.toggle("on", Boolean(credentials.github));
  $("credentials-open").setAttribute(
    "aria-label",
    `Identifiants. Claude : ${describe(credentials.anthropic)}. GitHub : ${describe(credentials.github)}.`,
  );
  $("state-anthropic").textContent = `(${describe(credentials.anthropic)})`;
  $("state-github").textContent = `(${describe(credentials.github)})`;
  $("credentials-forget").hidden =
    credentials.anthropic !== "session" && credentials.github !== "session";
  renderRunForm();
}

async function saveCredentials(payload) {
  state.status.credentials = await api("/api/secrets", payload);
  renderCredentials();
}

// --- Project

function renderProject() {
  const project = state.project;
  const facts = $("project-facts");
  facts.hidden = !project;
  if (!project) return;
  const rows = [
    ["Branche", project.branch],
    ["Base", project.default_base || "non détectée"],
    ["Modifiés", plural(project.changed_files, "fichier")],
    ["GitHub", project.github_repo || "aucun"],
  ];
  facts.replaceChildren(...rows.flatMap(([term, value]) => [h("dt", null, term), h("dd", null, value)]));

  $("input-base").placeholder = project.default_base || "origin/main";
  $("input-repo").placeholder = project.github_repo || "owner/nom";
  const config = project.config;
  if (config) {
    $("input-effort").value = config.effort;
    $("input-severity").value = config.min_severity;
    $("input-cost").value = config.max_cost_usd;
  }
  showError($("project-error"), project.config_error ? `Configuration : ${project.config_error}` : "");
}

async function openProject(path) {
  showError($("project-error"), "");
  try {
    state.project = await api("/api/project", { path });
    $("project-path").value = state.project.root;
    rememberProject(state.project.root);
  } catch (error) {
    state.project = null;
    showError($("project-error"), error.message);
  }
  renderProject();
  renderRunForm();
}

// --- Run form

function renderTargets() {
  const container = $("target-options");
  const current = state.mode[state.kind];
  container.replaceChildren(
    ...TARGETS[state.kind].map(([value, label, help]) => {
      const input = h("input", { type: "radio", name: "target", value, checked: value === current });
      input.addEventListener("change", () => {
        state.mode[state.kind] = value;
        renderRunForm();
      });
      return h(
        "label",
        { class: "radio" },
        input,
        h("span", null, label, help ? h("span", { class: "hint", style: null }, h("br"), help) : null),
      );
    }),
  );
}

function renderRunForm() {
  const isClean = state.kind === "clean";
  const mode = state.mode[state.kind];
  $("tab-review").setAttribute("aria-selected", String(!isClean));
  $("tab-clean").setAttribute("aria-selected", String(isClean));
  renderTargets();

  $("field-base").hidden = mode !== "base";
  $("field-paths").hidden = mode !== "paths";
  $("field-pr").hidden = mode !== "pr";
  $("field-goal").hidden = !isClean;
  $("field-severity").hidden = isClean;
  $("clean-options").hidden = !isClean;

  const checks = state.project?.config?.checks || [];
  const formatters = state.project?.config?.formatters || [];
  const commands = [...checks, ...formatters];
  const checksBox = $("input-checks");
  checksBox.disabled = checks.length === 0;
  if (checksBox.disabled) checksBox.checked = false;
  const preview = $("checks-preview");
  preview.hidden = !isClean;
  preview.replaceChildren(
    ...(commands.length
      ? commands.map((command) => h("div", null, `$ ${command}`))
      : [h("span", { class: "muted" }, "Aucune commande dans .codeguard.toml")]),
  );

  const cost = Number($("input-cost").value);
  const budget = cost > 0 ? `${cost} $ max` : "";
  const running = state.jobs.some((job) => job.status === "running");
  const needsProject = !state.project && !(state.kind === "review" && mode === "pr");
  const button = $("run-button");
  button.textContent = `${isClean ? "Lancer le nettoyage" : "Lancer la review"}${budget ? ` · ${budget}` : ""}`;
  button.disabled = running || needsProject;

  let hint = "";
  if (running) hint = "Une analyse est déjà en cours.";
  else if (needsProject) hint = "Ouvre d'abord un projet.";
  else if (!state.status?.credentials.anthropic) hint = "Aucune clé Claude détectée : ajoute-la en haut à droite.";
  else if (isClean) hint = "Ton répertoire de travail n'est pas modifié : le résultat va sur une branche dédiée.";
  else hint = "Rien n'est publié sans ta confirmation.";
  $("run-hint").textContent = hint;
}

function collectRun() {
  const mode = state.mode[state.kind];
  const payload = {
    path: state.project?.root || null,
    mode,
    effort: $("input-effort").value,
    max_cost: $("input-cost").value,
  };
  if (mode === "base") payload.base = $("input-base").value.trim() || state.project?.default_base || "";
  if (mode === "paths") payload.paths = $("input-paths").value;
  if (mode === "pr") {
    payload.pr = $("input-pr").value;
    payload.repo = $("input-repo").value.trim() || state.project?.github_repo || "";
  }
  if (state.kind === "review") {
    payload.min_severity = $("input-severity").value;
  } else {
    payload.goal = $("input-goal").value;
    payload.run_checks = $("input-checks").checked;
    payload.dry_run = $("input-dry").checked;
  }
  return payload;
}

async function submitRun(event) {
  event.preventDefault();
  showError($("run-error"), "");
  const payload = collectRun();
  if (payload.run_checks) {
    const commands = state.project.config.checks.join(", ");
    const inPullRequest = payload.mode === "pr" ? " Elles exécuteront le code de cette pull request sur ta machine." : "";
    const accepted = await confirmAction(
      "Lancer les vérifications ?",
      `Ces commandes vont s'exécuter sur ta machine : ${commands}.${inPullRequest}`,
      "Lancer",
    );
    if (!accepted) return;
  }
  try {
    const job = await api(`/api/${state.kind}`, payload);
    await refreshJobs();
    selectJob(job.id);
  } catch (error) {
    showError($("run-error"), error.message);
  }
}

// --- History

async function refreshJobs() {
  state.jobs = await api("/api/jobs");
  renderHistory();
  renderRunForm();
}

function renderHistory() {
  $("history-panel").hidden = state.jobs.length === 0;
  $("history").replaceChildren(
    ...state.jobs.map((job) =>
      h(
        "li",
        null,
        h(
          "button",
          {
            type: "button",
            "aria-current": state.current?.id === job.id ? "true" : null,
            onclick: () => selectJob(job.id),
          },
          h("span", { class: `state-dot ${job.status}`, title: STATUS_LABELS[job.status] }),
          h("span", { class: "label" }, job.label),
          h("span", { class: "kind" }, `${job.kind === "clean" ? "nettoyage" : "review"} · ${formatTime(job.created)}`),
        ),
      ),
    ),
  );
}

// --- Job view

function selectJob(id) {
  clearTimeout(state.pollTimer);
  state.current = { id };
  state.logs = [];
  state.filter = null;
  // On a narrow screen the result sits below the form.
  if (matchMedia("(max-width: 860px)").matches) $("main").scrollIntoView();
  poll();
}

async function poll() {
  const id = state.current?.id;
  if (!id) return;
  let detail;
  try {
    detail = await api(`/api/jobs/${id}?since=${state.logs.length}`);
  } catch (error) {
    renderFatal(error.message);
    return;
  }
  if (state.current?.id !== id) return;
  state.logs.push(...detail.logs);
  const wasRunning = state.current.status === "running";
  state.current = detail;
  if (detail.status === "running") {
    renderJob();
    state.pollTimer = setTimeout(poll, POLL_MS);
    if (!wasRunning) renderHistory();
  } else {
    renderJob();
    await refreshJobs();
  }
}

function renderFatal(message) {
  $("main").replaceChildren(h("div", { class: "banner error" }, h("strong", null, "Connexion perdue"), message));
}

function renderEmpty() {
  $("main").replaceChildren(
    h(
      "div",
      { class: "empty" },
      h("h1", null, "Aucune analyse sélectionnée"),
      h("p", null, "Ouvre un dépôt git, choisis une cible et lance une review ou un nettoyage."),
    ),
  );
}

function renderJob() {
  const job = state.current;
  const main = $("main");
  const activityOpen = main.querySelector(".activity")?.open;
  const logScroll = main.querySelector(".activity pre");
  const followLog = !logScroll || logScroll.scrollTop + logScroll.clientHeight >= logScroll.scrollHeight - 8;
  const previousScroll = main.scrollTop;
  const collapsedDiffs = new Set(
    [...main.querySelectorAll(".diff-file")].filter((item) => !item.open).map((item) => item.dataset.path),
  );

  const running = job.status === "running";
  const cancel = running
    ? h(
        "button",
        {
          type: "button",
          class: "button",
          disabled: job.cancel_requested,
          onclick: async () => {
            await api(`/api/jobs/${job.id}/cancel`, {});
            state.current.cancel_requested = true;
            renderJob();
          },
        },
        job.cancel_requested ? "Arrêt demandé…" : "Arrêter",
      )
    : null;

  const kindLabel = job.kind === "clean" ? "Nettoyage" : "Review";
  const logText = state.logs.join("\n");
  const activity = h(
    "details",
    { class: "activity", open: activityOpen ?? running ? true : null },
    h("summary", null, `Activité (${plural(state.logs.length, "étape")})`),
    h("pre", null, logText || "Démarrage…"),
  );

  const parts = [
    h(
      "header",
      { class: "job-head" },
      h(
        "div",
        { class: "job-title" },
        h("h1", null, `${kindLabel} : ${job.label}`),
        h("div", { class: "job-meta" }, `${STATUS_LABELS[job.status]} · lancée à ${formatTime(job.created)}`),
      ),
      cancel,
    ),
  ];
  if (job.cancel_requested && running) {
    parts.push(h("div", { class: "banner warning" }, "L'agent s'arrêtera à la fin de la requête en cours."));
  }
  if (job.status === "failed") {
    parts.push(h("div", { class: "banner error" }, h("strong", null, "L'analyse a échoué"), job.error));
  }
  if (job.status === "cancelled") {
    parts.push(h("div", { class: "banner warning" }, "Analyse arrêtée : aucun résultat n'a été conservé."));
  }
  if (job.result) parts.push(...(job.kind === "review" ? renderReview(job) : renderClean(job)));
  parts.push(activity);

  main.replaceChildren(h("div", { class: "job" }, parts));
  main.scrollTop = previousScroll;
  for (const item of main.querySelectorAll(".diff-file")) {
    if (collapsedDiffs.has(item.dataset.path)) item.open = false;
  }
  const newLog = main.querySelector(".activity pre");
  if (newLog) newLog.scrollTop = followLog ? newLog.scrollHeight : logScroll?.scrollTop || 0;
}

async function runAction(path, payload) {
  const job = state.current;
  try {
    const detail = await api(`/api/jobs/${job.id}/${path}`, payload);
    state.current = detail;
  } catch (error) {
    job.actionError = error.message;
  }
  renderJob();
}

function actionErrorBanner(job) {
  return job.actionError ? h("div", { class: "banner error", role: "alert" }, job.actionError) : null;
}

function copyButton(text) {
  const button = h("button", { type: "button", class: "button small" }, "Copier");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copié";
    } catch {
      button.textContent = "Échec";
    }
    setTimeout(() => {
      button.textContent = "Copier";
    }, 1500);
  });
  return button;
}

function safeLink(url, label) {
  // Only real web links; anything else is shown as plain text.
  return /^https:\/\//.test(url || "") ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, label) : url;
}

function usageLine(result) {
  const usage = result.usage;
  const input = usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens;
  return h(
    "p",
    { class: "footnote" },
    `${result.model} · ${input.toLocaleString("fr-FR")} jetons en entrée, ${usage.output_tokens.toLocaleString("fr-FR")} en sortie · ${formatCost(result.estimated_cost_usd)} (estimation)`,
  );
}

function findingLocation(finding) {
  return finding.end_line !== finding.line
    ? `${finding.path}:${finding.line}-${finding.end_line}`
    : `${finding.path}:${finding.line}`;
}

function renderFinding(finding) {
  return h(
    "li",
    { class: `finding sev-${finding.severity}` },
    h(
      "div",
      { class: "finding-head" },
      h("span", { class: "severity" }, SEVERITY_LABELS[finding.severity]),
      h("span", { class: "tag" }, CATEGORY_LABELS[finding.category] || finding.category),
      finding.confidence === "low" ? h("span", { class: "tag" }, "confiance faible") : null,
      h("span", { class: "location" }, findingLocation(finding)),
    ),
    h("h3", null, finding.title),
    h("p", null, finding.explanation),
    finding.suggested_code
      ? h("div", { class: "code" }, h("pre", null, h("code", null, finding.suggested_code)), copyButton(finding.suggested_code))
      : null,
  );
}

function renderReview(job) {
  const result = job.result;
  const findings = result.findings;
  const counts = {};
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] || 0) + 1;
  const visible = state.filter ? findings.filter((item) => item.severity === state.filter) : findings;

  const filterButton = (value, label, count) =>
    h(
      "button",
      {
        type: "button",
        class: "filter",
        "aria-pressed": String(state.filter === value),
        onclick: () => {
          state.filter = value;
          renderJob();
        },
      },
      label,
      h("span", { class: "count" }, count),
    );

  const exportLink = (format, label) =>
    h("a", { class: "button small", href: `/api/jobs/${job.id}/export?format=${format}`, download: true }, label);

  const publish = job.can_post && !result.posted_url
    ? h(
        "button",
        {
          type: "button",
          class: "button primary",
          onclick: async () => {
            const accepted = await confirmAction(
              "Publier sur la pull request ?",
              `${plural(findings.length, "remarque")} seront visibles par tous sur ${job.repo}. Les remarques déjà publiées ne sont pas répétées.`,
              "Publier",
            );
            if (accepted) await runAction("post", {});
          },
        },
        "Publier sur la PR",
      )
    : null;

  return [
    result.partial ? h("div", { class: "banner warning" }, "Review incomplète : limite de tours ou de budget atteinte.") : null,
    h("p", { class: "summary" }, result.summary),
    actionErrorBanner(job),
    result.posted_url ? h("div", { class: "banner success" }, "Publié sur GitHub : ", safeLink(result.posted_url, "voir la review")) : null,
    h(
      "div",
      { class: "actions" },
      publish,
      findings.length || result.summary ? exportLink("markdown", "Markdown") : null,
      exportLink("json", "JSON"),
      exportLink("sarif", "SARIF"),
    ),
    findings.length
      ? h(
          "div",
          { class: "filters", role: "group", "aria-label": "Filtrer par sévérité" },
          filterButton(null, "Toutes", findings.length),
          Object.keys(SEVERITY_LABELS)
            .filter((key) => counts[key])
            .map((key) => filterButton(key, SEVERITY_LABELS[key], counts[key])),
        )
      : h("div", { class: "banner success" }, h("strong", null, "Aucune remarque"), "Rien à signaler sur cette cible."),
    h("ul", { class: "findings" }, visible.map(renderFinding)),
    result.dropped.length
      ? h(
          "section",
          { class: "section" },
          h("h2", null, `${plural(result.dropped.length, "remarque écartée", "remarques écartées")} : lignes non vérifiables`),
          h("ul", { class: "rows" }, result.dropped.map((item) => h("li", null, item))),
        )
      : null,
    usageLine(result),
  ];
}

function diffFiles(diff) {
  const files = [];
  let current = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/ b\/(.+)$/);
      current = { path: match ? match[1] : line, lines: [], added: 0, removed: 0, started: false };
      files.push(current);
    } else if (current) {
      if (line.startsWith("@@")) current.started = true;
      if (!current.started) continue;
      if (line.startsWith("+")) current.added += 1;
      else if (line.startsWith("-")) current.removed += 1;
      current.lines.push(line);
    }
  }
  return files;
}

function renderDiff(diff) {
  const files = diffFiles(diff);
  const large = files.length > 8;
  return files.map((file) =>
    h(
      "details",
      { class: "diff-file", open: !large && file.lines.length < 500 ? true : null, "data-path": file.path },
      h(
        "summary",
        null,
        h("span", null, file.path),
        h(
          "span",
          { class: "stat" },
          h("span", { class: "plus" }, `+${file.added}`),
          " ",
          h("span", { class: "minus" }, `-${file.removed}`),
        ),
      ),
      h(
        "div",
        { class: "diff-body" },
        file.lines.map((line) => {
          const kind = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
          return h("span", { class: `diff-line ${kind}` }, line || " ");
        }),
      ),
    ),
  );
}

function commandRow(label, command) {
  return h("div", { class: "command" }, h("span", null, label), h("code", null, command), copyButton(command));
}

function renderClean(job) {
  const result = job.result;
  const tone = { committed: "success", dry_run: "success", no_change: "success" }[result.status] || "error";
  const committed = result.status === "committed" && !job.discarded;
  const canKeepBranch = committed || (result.status === "checks_failed" && !job.discarded);

  const pushButton = committed && !job.pushed
    ? h(
        "button",
        {
          type: "button",
          class: "button",
          onclick: async () => {
            const accepted = await confirmAction(
              "Pousser la branche ?",
              `La branche ${result.branch} sera envoyée sur origin.`,
              "Pousser",
            );
            if (accepted) await runAction("push", { open_pr: false });
          },
        },
        "Pousser la branche",
      )
    : null;
  const openPr = committed && job.github_repo && !job.pull_request_url
    ? h(
        "button",
        {
          type: "button",
          class: "button primary",
          onclick: async () => {
            const accepted = await confirmAction(
              "Ouvrir une pull request ?",
              `La branche ${result.branch} sera poussée, puis une PR sera ouverte sur ${job.github_repo}.`,
              "Ouvrir la PR",
            );
            if (accepted) await runAction("push", { open_pr: true });
          },
        },
        "Ouvrir une PR",
      )
    : null;
  const discard = canKeepBranch && !job.pushed
    ? h(
        "button",
        {
          type: "button",
          class: "button danger",
          onclick: async () => {
            const accepted = await confirmAction(
              "Abandonner ce nettoyage ?",
              `La branche locale ${result.branch} sera supprimée. Ton répertoire de travail n'est pas touché.`,
              "Abandonner",
            );
            if (accepted) await runAction("discard", {});
          },
        },
        "Abandonner",
      )
    : null;

  return [
    h("div", { class: `banner ${tone}` }, h("strong", null, job.discarded ? "Nettoyage abandonné" : result.status_label), job.discarded ? "La branche a été supprimée." : null),
    result.partial ? h("div", { class: "banner warning" }, "Nettoyage incomplet : limite de tours ou de budget atteinte.") : null,
    committed && !result.checks_ran
      ? h("div", { class: "banner warning" }, "Aucune vérification n'a été exécutée : relis le diff avant de fusionner.")
      : null,
    result.out_of_scope.length
      ? h("div", { class: "banner warning" }, h("strong", null, "Fichiers modifiés hors périmètre, par un formateur"), result.out_of_scope.join(", "))
      : null,
    result.summary ? h("p", { class: "summary" }, result.summary) : null,
    actionErrorBanner(job),
    job.pull_request_url ? h("div", { class: "banner success" }, "Pull request ouverte : ", safeLink(job.pull_request_url, "la voir")) : null,
    job.pushed && !job.pull_request_url ? h("div", { class: "banner success" }, `Branche poussée : ${result.branch}`) : null,
    pushButton || openPr || discard ? h("div", { class: "actions" }, openPr, pushButton, discard) : null,
    committed
      ? h(
          "section",
          { class: "section" },
          h("h2", null, `Branche ${result.branch}`),
          h(
            "div",
            { class: "commands-list" },
            commandRow("Voir", `git diff HEAD...${result.branch}`),
            commandRow("Fusionner", `git merge --squash ${result.branch}`),
          ),
        )
      : null,
    result.worktree && !job.discarded
      ? h("section", { class: "section" }, h("h2", null, "Worktree conservé pour inspection"), h("div", { class: "commands-list" }, commandRow("Dossier", result.worktree)))
      : null,
    result.changes.length
      ? h(
          "section",
          { class: "section" },
          h("h2", null, "Changements"),
          h(
            "ul",
            { class: "rows" },
            result.changes.map((change) =>
              h("li", null, h("span", { class: "path" }, `${change.path} · ${KIND_LABELS[change.kind] || change.kind}`), change.description),
            ),
          ),
        )
      : null,
    result.left_alone.length
      ? h("section", { class: "section" }, h("h2", null, "Laissé en l'état"), h("ul", { class: "rows" }, result.left_alone.map((item) => h("li", null, item))))
      : null,
    result.checks_output && result.status !== "committed" && result.status !== "dry_run"
      ? h("section", { class: "section" }, h("h2", null, "Sortie des vérifications"), h("pre", { class: "output" }, result.checks_output))
      : null,
    result.diff ? h("section", { class: "section" }, h("h2", null, "Diff"), renderDiff(result.diff)) : null,
    result.model ? usageLine(result) : null,
  ];
}

// --- Start-up

function fillSelect(select, values, labels) {
  select.replaceChildren(...values.map((value) => h("option", { value }, labels[value] || value)));
}

async function init() {
  $("project-form").addEventListener("submit", (event) => {
    event.preventDefault();
    openProject($("project-path").value.trim());
  });
  $("run-form").addEventListener("submit", submitRun);
  $("input-cost").addEventListener("input", renderRunForm);
  for (const [id, kind] of [["tab-review", "review"], ["tab-clean", "clean"]]) {
    $(id).addEventListener("click", () => {
      state.kind = kind;
      showError($("run-error"), "");
      renderRunForm();
    });
  }

  const dialog = $("credentials-dialog");
  const resetFields = () => {
    $("input-anthropic").value = "";
    $("input-github").value = "";
  };
  $("credentials-open").addEventListener("click", () => dialog.showModal());
  $("credentials-cancel").addEventListener("click", () => {
    resetFields();
    dialog.close();
  });
  $("credentials-forget").addEventListener("click", async () => {
    await saveCredentials({ anthropic_key: "", github_token: "" });
    resetFields();
    dialog.close();
  });
  $("credentials-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {};
    if ($("input-anthropic").value) payload.anthropic_key = $("input-anthropic").value;
    if ($("input-github").value) payload.github_token = $("input-github").value;
    await saveCredentials(payload);
    resetFields();
    dialog.close();
  });

  renderRecent();
  renderEmpty();
  try {
    state.status = await api("/api/status");
  } catch (error) {
    renderFatal(error.message);
    return;
  }
  fillSelect($("input-effort"), state.status.efforts, EFFORT_LABELS);
  fillSelect($("input-severity"), state.status.severities, SEVERITY_LABELS);
  $("input-effort").value = "high";
  $("input-severity").value = "low";
  renderCredentials();
  await refreshJobs();

  const [lastProject] = readRecent();
  if (lastProject) {
    $("project-path").value = lastProject;
    await openProject(lastProject);
  }
  const running = state.jobs.find((job) => job.status === "running");
  if (running) selectJob(running.id);
}

init();
