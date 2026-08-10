const STORAGE_KEY = "warcraft-logging.ui";

const CLASS_ICON_SLUG = {
  DeathKnight: "deathknight",
  DemonHunter: "demonhunter",
  Druid: "druid",
  Evoker: "evoker",
  Hunter: "hunter",
  Mage: "mage",
  Monk: "monk",
  Paladin: "paladin",
  Priest: "priest",
  Rogue: "rogue",
  Shaman: "shaman",
  Warlock: "warlock",
  Warrior: "warrior",
};

const els = {
  seasonLine: document.getElementById("season-line"),
  selectedTitle: document.getElementById("selected-title"),
  selectedIcon: document.getElementById("selected-icon"),
  selectedDungeonHeading: document.getElementById("selected-dungeon-heading"),
  specPicker: document.getElementById("spec-picker"),
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
  compareBody: document.getElementById("compare-body"),
  dungeonLeadersBody: document.getElementById("dungeon-leaders-body"),
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

function classIconUrl(className) {
  const slug = CLASS_ICON_SLUG[className] || className.toLowerCase();
  return `https://wow.zamimg.com/images/wow/icons/large/classicon_${slug}.jpg`;
}

function humanClassName(className) {
  return className.replace(/([a-z])([A-Z])/g, "$1 $2");
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

function specCellHtml(className, specName) {
  return `
    <div class="spec-cell">
      <img src="${classIconUrl(className)}" alt="${escapeHtml(humanClassName(className))}" width="36" height="36" loading="lazy" />
      <div class="stack">
        <strong>${escapeHtml(specName)}</strong>
        <span>${escapeHtml(humanClassName(className))}</span>
      </div>
    </div>`;
}

function renderSelectedHero(className, specName, seasonName) {
  els.selectedIcon.hidden = false;
  els.selectedIcon.src = classIconUrl(className);
  els.selectedIcon.alt = humanClassName(className);
  els.selectedTitle.textContent = `${specName}`;
  els.seasonLine.textContent = `${humanClassName(className)} · ${seasonName}`;
  els.selectedDungeonHeading.textContent = `${specName} by dungeon`;
}

function renderSpecPicker(list, current) {
  els.specSelect.innerHTML = list
    .map((s) => {
      const value = `${s.className}/${s.specName}`;
      return `<option value="${escapeHtml(value)}">${escapeHtml(s.specName)} ${escapeHtml(humanClassName(s.className))}</option>`;
    })
    .join("");

  if ([...els.specSelect.options].some((o) => o.value === current)) {
    els.specSelect.value = current;
  } else if (list[0]) {
    els.specSelect.value = `${list[0].className}/${list[0].specName}`;
  }

  els.specPicker.innerHTML = list
    .map((s) => {
      const value = `${s.className}/${s.specName}`;
      const selected = value === els.specSelect.value;
      return `
        <button
          type="button"
          class="spec-option"
          role="option"
          data-value="${escapeHtml(value)}"
          aria-selected="${selected ? "true" : "false"}"
        >
          <img src="${classIconUrl(s.className)}" alt="" width="56" height="56" loading="lazy" />
          <span class="spec-name">${escapeHtml(s.specName)}</span>
          <span class="class-name">${escapeHtml(humanClassName(s.className))}</span>
        </button>`;
    })
    .join("");
}

function renderCompare(compare, selectedValue) {
  const specs = compare?.specs ?? [];
  if (!specs.length) {
    els.compareBody.innerHTML =
      '<tr><td colspan="5" class="empty">No specs in allowlist / no season data.</td></tr>';
    els.dungeonLeadersBody.innerHTML =
      '<tr><td colspan="5" class="empty">No dungeon leaders yet.</td></tr>';
    return;
  }

  els.compareBody.innerHTML = specs
    .map((s) => {
      const value = `${s.className}/${s.specName}`;
      const o = s.overall;
      return `
        <tr class="${value === selectedValue ? "is-selected" : ""}" data-spec="${escapeHtml(value)}">
          <td>${specCellHtml(s.className, s.specName)}</td>
          <td class="num">${o ? fmtNumber(o.avgKeyLevel) : "—"}</td>
          <td class="num">${o ? fmtNumber(o.avgDps) : "—"}</td>
          <td class="num">${o ? fmtNumber(o.avgPlace) : "—"}</td>
          <td class="num">${o ? fmtNumber(o.dungeonCount) : "0"}</td>
        </tr>`;
    })
    .join("");

  const leaders = compare?.byDungeon ?? [];
  if (!leaders.length) {
    els.dungeonLeadersBody.innerHTML =
      '<tr><td colspan="5" class="empty">No dungeon aggregates yet.</td></tr>';
    return;
  }

  els.dungeonLeadersBody.innerHTML = leaders
    .map((d) => {
      const best = d.best;
      if (!best) {
        return `
          <tr>
            <td>${escapeHtml(d.name)}</td>
            <td colspan="4" class="empty">No specs yet</td>
          </tr>`;
      }
      return `
        <tr>
          <td>${escapeHtml(d.name)}</td>
          <td>${specCellHtml(best.className, best.specName)}</td>
          <td class="num">${fmtNumber(best.avgPlace)}</td>
          <td class="num">${fmtNumber(best.avgKeyLevel)}</td>
          <td class="num">${fmtNumber(best.avgDps)}</td>
        </tr>`;
    })
    .join("");
}

function renderDungeons(dungeons) {
  if (!dungeons?.length) {
    els.dungeonBody.innerHTML =
      '<tr><td colspan="6" class="empty">No dungeon aggregates yet for this spec.</td></tr>';
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

async function ensureSpecs() {
  const meta = await apiGet("/v1/meta/classes");
  const list = meta.allowlist?.length
    ? meta.allowlist
    : [{ className: "Evoker", specName: "Devastation" }];

  const settings = loadSettings();
  const current =
    settings.spec || `${list[0].className}/${list[0].specName}`;
  renderSpecPicker(list, current);
  return list;
}

async function loadAll() {
  els.reloadBtn.disabled = true;
  setStatus("Loading…");

  try {
    await ensureSpecs();
    const selectedValue = els.specSelect.value;
    const [className, specName] = selectedValue.split("/");

    const [aggregate, compare, jobs] = await Promise.all([
      apiGet(
        `/v1/aggregate/${encodeURIComponent(className)}/${encodeURIComponent(specName)}?includeRuns=1`,
      ),
      apiGet("/v1/compare"),
      apiGet("/v1/jobs"),
    ]);

    const seasonName = aggregate.season?.name ?? compare.season?.name ?? "No season ingested";
    renderSelectedHero(className, specName, seasonName);
    renderCompare(compare, selectedValue);
    renderOverall(aggregate);
    renderDungeons(aggregate.dungeons);
    renderRuns(aggregate.runs);
    renderJobs(jobs);

    if (aggregate.note || compare.note) {
      setStatus(aggregate.note || compare.note, "warn");
    } else if (jobs.ingestRunning) {
      setStatus("Ingest is running… reload in a few minutes for new specs.", "warn");
    } else {
      const withData = (compare.specs || []).filter((s) => s.overall).length;
      setStatus(`Loaded ${withData}/${(compare.specs || []).length} specs with aggregates.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(message, "error");
    els.seasonLine.textContent = "Could not load data";
  } finally {
    els.reloadBtn.disabled = false;
  }
}

function selectSpec(value) {
  els.specSelect.value = value;
  for (const btn of els.specPicker.querySelectorAll(".spec-option")) {
    btn.setAttribute("aria-selected", btn.dataset.value === value ? "true" : "false");
  }
  saveSettings({ spec: value });
  void loadAll();
}

function init() {
  const settings = loadSettings();
  els.apiBase.value = settings.apiBase ?? "/remote";

  els.reloadBtn.addEventListener("click", () => {
    saveSettings({
      apiBase: els.apiBase.value.trim(),
      spec: els.specSelect.value,
    });
    void loadAll();
  });

  els.specPicker.addEventListener("click", (event) => {
    const btn = event.target.closest(".spec-option");
    if (!btn) return;
    selectSpec(btn.dataset.value);
  });

  els.compareBody.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-spec]");
    if (!row) return;
    selectSpec(row.dataset.spec);
  });

  els.apiBase.addEventListener("change", () => {
    saveSettings({ apiBase: els.apiBase.value.trim() });
  });

  void loadAll();
}

init();
