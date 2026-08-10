const STORAGE_KEY = "warcraft-logging.ui";

const els = {
  seasonLine: document.getElementById("season-line"),
  specSelect: document.getElementById("spec-select"),
  apiBase: document.getElementById("api-base"),
  reloadBtn: document.getElementById("reload-btn"),
  statusRow: document.getElementById("status-row"),
  statusText: document.getElementById("status-text"),
  overall: document.getElementById("overall"),
  statKey: document.getElementById("stat-key"),
  statDps: document.getElementById("stat-dps"),
  statPlace: document.getElementById("stat-place"),
  statCount: document.getElementById("stat-count"),
  dungeonBody: document.getElementById("dungeon-body"),
  runsList: document.getElementById("runs-list"),
  jobsBody: document.getElementById("jobs-body"),
};

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function apiRoot() {
  const raw = els.apiBase.value.trim().replace(/\/+$/, "");
  return raw || "";
}

async function apiGet(path) {
  const url = `${apiRoot()}${path}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON response from ${url} (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${res.status} for ${path}`);
  }
  return data;
}

function fmtNumber(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setStatus(message, tone = "info") {
  if (!message) {
    els.statusRow.hidden = true;
    return;
  }
  els.statusRow.hidden = false;
  els.statusRow.dataset.tone = tone;
  els.statusText.textContent = message;
}

function companionChips(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return '<span class="empty">—</span>';
  }
  return `<div class="companions">${list
    .slice(0, 4)
    .map(
      (c) =>
        `<span class="chip">${escapeHtml(c.specName)} <b>×${c.count}</b></span>`,
    )
    .join("")}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderDungeons(dungeons) {
  if (!dungeons?.length) {
    els.dungeonBody.innerHTML =
      '<tr><td colspan="6" class="empty">No dungeon aggregates yet. Run ingest / refresh.</td></tr>';
    return;
  }

  els.dungeonBody.innerHTML = dungeons
    .map(
      (d) => `
      <tr>
        <td>${escapeHtml(d.name)}</td>
        <td class="num">${fmtNumber(d.sampleSize)}</td>
        <td class="num">${fmtNumber(d.avgKeyLevel)}</td>
        <td class="num">${fmtNumber(d.avgDps)}</td>
        <td class="num">${fmtNumber(d.avgPlace)}</td>
        <td>${companionChips(d.companionDps)}</td>
      </tr>`,
    )
    .join("");
}

function renderRuns(runs) {
  if (!runs?.length) {
    els.runsList.innerHTML = '<p class="empty">No runs in leaderboard slots yet.</p>';
    return;
  }

  const byDungeon = new Map();
  for (const run of runs) {
    const key = run.dungeon || "Unknown";
    if (!byDungeon.has(key)) byDungeon.set(key, []);
    byDungeon.get(key).push(run);
  }

  els.runsList.innerHTML = [...byDungeon.entries()]
    .map(([dungeon, rows]) => {
      const body = rows
        .map((r) => {
          const place =
            r.place == null
              ? "—"
              : `<span class="place" data-n="${r.place}">${r.place}</span>`;
          const link = r.reportUrl
            ? `<a href="${escapeHtml(r.reportUrl)}" target="_blank" rel="noreferrer">report</a>`
            : "—";
          return `
            <tr>
              <td class="num">#${r.rank}</td>
              <td class="num">+${r.keyLevel}</td>
              <td class="num">${fmtNumber(Math.round(r.score ?? 0))}</td>
              <td class="num">${r.dps == null ? "—" : fmtNumber(Math.round(r.dps))}</td>
              <td class="num">${place}</td>
              <td>${link}</td>
            </tr>`;
        })
        .join("");

      return `
        <div class="dungeon-block">
          <h3>${escapeHtml(dungeon)}</h3>
          <table class="run-table">
            <thead>
              <tr>
                <th class="num">Rank</th>
                <th class="num">Key</th>
                <th class="num">Score</th>
                <th class="num">DPS</th>
                <th class="num">Place</th>
                <th>Log</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>`;
    })
    .join("");
}

function renderJobs(payload) {
  const jobs = payload?.jobs ?? [];
  if (!jobs.length) {
    els.jobsBody.innerHTML =
      '<tr><td colspan="8" class="empty">No ingest jobs recorded.</td></tr>';
    return;
  }

  els.jobsBody.innerHTML = jobs
    .slice(0, 8)
    .map((j) => {
      const status = escapeHtml(j.status || "unknown");
      return `
        <tr>
          <td>${escapeHtml(fmtWhen(j.startedAt))}</td>
          <td>${escapeHtml(j.trigger)}</td>
          <td><span class="badge ${status}">${status}</span></td>
          <td class="num">${fmtNumber(j.rankingsSeen)}</td>
          <td class="num">${fmtNumber(j.runsCreated)}</td>
          <td class="num">${fmtNumber(j.runsSkipped)}</td>
          <td class="num">${fmtNumber(j.errorCount)}</td>
          <td>${escapeHtml(j.message || "")}</td>
        </tr>`;
    })
    .join("");
}

function renderOverall(data) {
  const overall = data.overall;
  if (!overall) {
    els.overall.hidden = true;
    return;
  }
  els.overall.hidden = false;
  els.statKey.textContent = fmtNumber(overall.avgKeyLevel);
  els.statDps.textContent = fmtNumber(overall.avgDps);
  els.statPlace.textContent = fmtNumber(overall.avgPlace);
  els.statCount.textContent = fmtNumber(overall.dungeonCount);
}

async function ensureSpecs() {
  const meta = await apiGet("/v1/meta/classes");
  const list = meta.allowlist?.length
    ? meta.allowlist
    : [{ className: "Evoker", specName: "Devastation" }];

  const settings = loadSettings();
  const current =
    settings.spec ||
    `${list[0].className}/${list[0].specName}`;

  els.specSelect.innerHTML = list
    .map((s) => {
      const value = `${s.className}/${s.specName}`;
      return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
    })
    .join("");

  if ([...els.specSelect.options].some((o) => o.value === current)) {
    els.specSelect.value = current;
  }
}

async function loadAll() {
  els.reloadBtn.disabled = true;
  setStatus("Loading…");

  try {
    await ensureSpecs();
    const [className, specName] = els.specSelect.value.split("/");
    const [aggregate, jobs] = await Promise.all([
      apiGet(
        `/v1/aggregate/${encodeURIComponent(className)}/${encodeURIComponent(specName)}?includeRuns=1`,
      ),
      apiGet("/v1/jobs"),
    ]);

    const seasonName = aggregate.season?.name ?? "No season ingested";
    els.seasonLine.textContent = `${aggregate.className} · ${aggregate.specName} · ${seasonName}`;

    renderOverall(aggregate);
    renderDungeons(aggregate.dungeons);
    renderRuns(aggregate.runs);
    renderJobs(jobs);

    if (aggregate.note) {
      setStatus(aggregate.note, "warn");
    } else if (!aggregate.dungeons?.length) {
      setStatus(
        "Season exists but aggregates are empty — check jobs.rankingsSeen after refresh.",
        "warn",
      );
    } else {
      setStatus(
        jobs.ingestRunning ? "Ingest is running…" : "Up to date.",
        jobs.ingestRunning ? "warn" : "info",
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(message, "error");
    els.seasonLine.textContent = "Could not load data";
  } finally {
    els.reloadBtn.disabled = false;
  }
}

function init() {
  const settings = loadSettings();
  // Default to local /remote proxy → Railway so the UI works without local Postgres.
  // Use empty string for same-origin (local API + local DB).
  els.apiBase.value = settings.apiBase ?? "/remote";
  els.apiBase.placeholder = "blank = same origin · /remote = Railway proxy";

  els.reloadBtn.addEventListener("click", () => {
    saveSettings({
      apiBase: els.apiBase.value.trim(),
      spec: els.specSelect.value,
    });
    void loadAll();
  });

  els.specSelect.addEventListener("change", () => {
    saveSettings({ spec: els.specSelect.value });
    void loadAll();
  });

  els.apiBase.addEventListener("change", () => {
    saveSettings({ apiBase: els.apiBase.value.trim() });
  });

  void loadAll();
}

init();
