"use strict";

/* =========================================================
   Storage keys & palette
   ========================================================= */
const K = {
  entries: "azt_entries_v1",
  costCenters: "azt_costcenters_v1",
  projects: "azt_projects_v1",
  employeeName: "azt_employeename_v1",
  timer: "azt_timer_v1",
};

const CC_PALETTE = [
  "#4C6EF5", "#B5406B", "#6B8F3F", "#8355C9",
  "#C94F4F", "#2E8FB0", "#B08A2E", "#5C6B73",
];
const PROJECT_PALETTE = [
  "#3D6EA5", "#B4532C", "#5E8C3F", "#8C4A8F",
  "#C2A233", "#6B5CA5", "#A34D64", "#4F6B8C",
];
const LABOR_COLOR = "#2F7A64";

/* =========================================================
   Small helpers
   ========================================================= */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function todayStr() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
function timeToMin(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function fmtHoursDecimal(minutes) {
  return (minutes / 60).toFixed(2).replace(".", ",");
}
function fmtDateDisplay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDatePlain(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
}
function parseHHMM(value) {
  if (!value) return 0;
  const parts = value.split(":");
  if (parts.length !== 2) return 0;
  const h = Number(parts[0]), m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}
function minutesToHHMM(minutes) {
  if (!minutes || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function computeTotalMinutes(start, end, pauseStart, pauseEnd) {
  const s = timeToMin(start), e = timeToMin(end);
  if (s === null || e === null) return 0;
  let gross = e - s;
  if (gross < 0) gross += 24 * 60;
  let pause = 0;
  if (pauseStart && pauseEnd) {
    const ps = timeToMin(pauseStart), pe = timeToMin(pauseEnd);
    let p = pe - ps;
    if (p < 0) p += 24 * 60;
    pause = p;
  }
  return Math.max(0, gross - pause);
}
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

/* =========================================================
   Storage layer
   ========================================================= */
function loadEntries() {
  try { return JSON.parse(localStorage.getItem(K.entries)) || []; }
  catch { return []; }
}
function saveEntries(list) { localStorage.setItem(K.entries, JSON.stringify(list)); }

function loadCostCenters() {
  try { return JSON.parse(localStorage.getItem(K.costCenters)) || []; }
  catch { return []; }
}
function saveCostCenters(list) { localStorage.setItem(K.costCenters, JSON.stringify(list)); }

function loadProjects() {
  try { return JSON.parse(localStorage.getItem(K.projects)) || []; }
  catch { return []; }
}
function saveProjects(list) { localStorage.setItem(K.projects, JSON.stringify(list)); }

function loadEmployeeName() { return localStorage.getItem(K.employeeName) || ""; }
function saveEmployeeName(v) { localStorage.setItem(K.employeeName, v || ""); }

/* Austrian month labels used for the Übersicht header row and the Monatsblatt sheet names */
const MONTHS_AT = [
  { short: "Jän", full: "Jänner" },
  { short: "Feb", full: "Februar" },
  { short: "Mrz", full: "März" },
  { short: "Apr", full: "April" },
  { short: "Mai", full: "Mai" },
  { short: "Jun", full: "Juni" },
  { short: "Jul", full: "Juli" },
  { short: "Aug", full: "August" },
  { short: "Sept", full: "September" },
  { short: "Okt", full: "Oktober" },
  { short: "Nov", full: "November" },
  { short: "Dez", full: "Dezember" },
];
const WEEKDAY_ABBR_AT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]; // JS Date#getDay(): 0 = Sunday

function loadTimer() {
  try {
    return JSON.parse(localStorage.getItem(K.timer)) || { status: "idle" };
  } catch { return { status: "idle" }; }
}
function saveTimer(t) { localStorage.setItem(K.timer, JSON.stringify(t)); }

/* =========================================================
   App state
   ========================================================= */
let entries = loadEntries();
let costCenters = loadCostCenters();
let projects = loadProjects();
let timer = loadTimer();
let tickHandle = null;

let flow = { mode: null, editingId: null, draft: null }; // shared draft used by the two sheets

/* =========================================================
   Topbar date
   ========================================================= */
function renderTopbarDate() {
  const el = document.getElementById("topbar-date");
  el.textContent = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

/* =========================================================
   TIMER: state machine
   ========================================================= */
function startWork() {
  const now = Date.now();
  timer = {
    status: "running",
    date: todayStr(),
    startTs: now,
    accumulatedWorkedMs: 0,
    segmentStartTs: now,
    pauseStartTs: null,
    firstPauseStartTs: null,
    lastPauseEndTs: null,
    totalPausedMs: 0,
  };
  saveTimer(timer);
  renderTimer();
}

function pauseWork() {
  if (timer.status !== "running") return;
  const now = Date.now();
  timer.accumulatedWorkedMs += now - timer.segmentStartTs;
  timer.segmentStartTs = null;
  timer.pauseStartTs = now;
  if (!timer.firstPauseStartTs) timer.firstPauseStartTs = now;
  timer.status = "paused";
  saveTimer(timer);
  renderTimer();
}

function resumeWork() {
  if (timer.status !== "paused") return;
  const now = Date.now();
  timer.totalPausedMs += now - timer.pauseStartTs;
  timer.lastPauseEndTs = now;
  timer.pauseStartTs = null;
  timer.segmentStartTs = now;
  timer.status = "running";
  saveTimer(timer);
  renderTimer();
}

function finishWork() {
  if (timer.status !== "running" && timer.status !== "paused") return;
  const now = Date.now();
  if (timer.status === "running") {
    timer.accumulatedWorkedMs += now - timer.segmentStartTs;
    timer.segmentStartTs = null;
  } else if (timer.status === "paused") {
    timer.totalPausedMs += now - timer.pauseStartTs;
    timer.lastPauseEndTs = now;
    timer.pauseStartTs = null;
  }

  const draft = {
    id: null,
    date: timer.date,
    start: fmtTs(timer.startTs),
    end: fmtTs(now),
    pauseStart: timer.firstPauseStartTs ? fmtTs(timer.firstPauseStartTs) : "",
    pauseEnd: timer.lastPauseEndTs ? fmtTs(timer.lastPauseEndTs) : "",
    activity: "",
    allocations: [],
    projectAllocations: [],
    laborMinutes: 0,
    source: "timer",
  };

  timer = { status: "idle" };
  saveTimer(timer);
  renderTimer();
  renderTodaySummary();

  openTimesSheet("timer-finish", draft);
}

function fmtTs(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function liveWorkedMs() {
  if (timer.status === "running") {
    return timer.accumulatedWorkedMs + (Date.now() - timer.segmentStartTs);
  }
  if (timer.status === "paused") {
    return timer.accumulatedWorkedMs;
  }
  return 0;
}

function renderTimer() {
  const statusEl = document.getElementById("timer-status");
  const statusText = document.getElementById("timer-status-text");
  const display = document.getElementById("timer-display");
  const sub = document.getElementById("timer-sub");
  const btnStart = document.getElementById("btn-start");
  const runningActions = document.getElementById("timer-running-actions");
  const pausedActions = document.getElementById("timer-paused-actions");

  statusEl.classList.remove("running", "paused");
  if (timer.status === "idle") {
    statusText.textContent = "Bereit";
    display.textContent = "00:00:00";
    sub.textContent = "Noch kein Arbeitsbeginn heute.";
    btnStart.style.display = "block";
    runningActions.style.display = "none";
    pausedActions.style.display = "none";
    stopTick();
  } else if (timer.status === "running") {
    statusEl.classList.add("running");
    statusText.textContent = "Aktiv";
    sub.innerHTML = `Gestartet um <b>${fmtTs(timer.startTs)}</b>`;
    btnStart.style.display = "none";
    runningActions.style.display = "flex";
    pausedActions.style.display = "none";
    startTick();
  } else if (timer.status === "paused") {
    statusEl.classList.add("paused");
    statusText.textContent = "Pausiert";
    sub.innerHTML = `Pausiert seit <b>${fmtTs(timer.pauseStartTs)}</b>`;
    btnStart.style.display = "none";
    runningActions.style.display = "none";
    pausedActions.style.display = "flex";
    stopTick();
    updateDisplayOnce();
  }
  if (timer.status !== "paused") updateDisplayOnce();
}

function updateDisplayOnce() {
  const ms = liveWorkedMs();
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  document.getElementById("timer-display").textContent = `${h}:${m}:${s}`;
}

function startTick() {
  stopTick();
  tickHandle = setInterval(updateDisplayOnce, 1000);
  updateDisplayOnce();
}
function stopTick() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
}

/* =========================================================
   TODAY summary (below timer)
   ========================================================= */
function renderTodaySummary() {
  const container = document.getElementById("today-summary");
  const todays = entries.filter((e) => e.date === todayStr());

  if (todays.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:28px 10px;">
        <div class="icon">🕐</div>
        <p>Heute noch keine abgeschlossenen Einträge.</p>
      </div>`;
    return;
  }

  container.innerHTML = buildSummaryCardHTML(todays);
}

function buildSummaryCardHTML(list) {
  const totalMinutes = list.reduce((s, e) => s + e.totalMinutes, 0);
  const laborMinutes = list.reduce((s, e) => s + (e.laborMinutes || 0), 0);

  const ccTotals = {}; // id -> minutes
  list.forEach((e) => (e.allocations || []).forEach((a) => {
    ccTotals[a.costCenterId] = (ccTotals[a.costCenterId] || 0) + a.minutes;
  }));
  const projectTotals = {}; // id -> minutes
  list.forEach((e) => (e.projectAllocations || []).forEach((a) => {
    projectTotals[a.projectId] = (projectTotals[a.projectId] || 0) + a.minutes;
  }));

  const ccSegs = Object.entries(ccTotals).map(([ccId, min]) => {
    const cc = costCenters.find((c) => c.id === ccId);
    if (!cc) return null;
    return { label: cc.code, color: CC_PALETTE[cc.colorIndex % CC_PALETTE.length], minutes: min };
  }).filter(Boolean);
  const projectSegs = Object.entries(projectTotals).map(([prId, min]) => {
    const pr = projects.find((p) => p.id === prId);
    if (!pr) return null;
    return { label: pr.code, color: PROJECT_PALETTE[pr.colorIndex % PROJECT_PALETTE.length], minutes: min };
  }).filter(Boolean);

  const daybarHTML = (segs) => {
    const allocatedSum = segs.reduce((s, x) => s + x.minutes, 0);
    const unallocated = Math.max(0, totalMinutes - allocatedSum);
    let bar = "";
    if (totalMinutes > 0) {
      segs.forEach((s) => {
        const pct = (s.minutes / totalMinutes) * 100;
        bar += `<div class="seg" style="width:${pct}%;background:${s.color};"></div>`;
      });
      if (unallocated > 0) {
        const pct = (unallocated / totalMinutes) * 100;
        bar += `<div class="seg empty-track" style="width:${pct}%;"></div>`;
      }
    } else {
      bar = `<div class="seg empty-track" style="width:100%;"></div>`;
    }
    let legend = segs.map((s) => `
      <div class="legend-item">
        <span class="legend-swatch" style="background:${s.color};"></span>
        ${escapeHtml(s.label)} · ${fmtHoursDecimal(s.minutes)} h
      </div>`).join("");
    if (unallocated > 0) {
      legend += `
      <div class="legend-item">
        <span class="legend-swatch" style="background:#e4e6ea;"></span>
        Nicht zugeteilt · ${fmtHoursDecimal(unallocated)} h
      </div>`;
    }
    return `<div class="daybar">${bar}</div><div class="legend">${legend}</div>`;
  };

  const laborPct = totalMinutes > 0 ? Math.min(100, (laborMinutes / totalMinutes) * 100) : 0;

  return `
    <div class="summary-card">
      <div class="summary-head">
        <span class="summary-title">${list.length} Eintrag/Einträge</span>
        <span class="total">${fmtHoursDecimal(totalMinutes)} h</span>
      </div>
      ${daybarHTML(ccSegs)}

      <div class="section-label" style="margin:16px 0 8px;">Projekte</div>
      ${daybarHTML(projectSegs)}

      <div class="labor-row">
        <span class="label">Labor</span>
        <span class="labor-track"><span class="labor-fill" style="width:${laborPct}%;"></span></span>
        <span class="amount">${fmtHoursDecimal(laborMinutes)} h</span>
      </div>
    </div>`;
}

/* =========================================================
   ENTRIES list view
   ========================================================= */
function renderEntries() {
  const container = document.getElementById("entries-list");
  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <p>Noch keine Einträge vorhanden.<br>Starte den Timer oder erfasse einen Eintrag manuell.</p>
      </div>`;
    return;
  }
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  container.innerHTML = sorted.map((e) => entryCardHTML(e)).join("");

  container.querySelectorAll("[data-entry-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const entry = entries.find((x) => x.id === card.dataset.entryId);
      if (entry) openTimesSheet("edit", entry);
    });
  });
}

function entryCardHTML(e) {
  const ccSum = (e.allocations || []).reduce((s, a) => s + a.minutes, 0);
  const unallocated = Math.max(0, e.totalMinutes - ccSum);
  const tags = (e.allocations || []).map((a) => {
    const cc = costCenters.find((c) => c.id === a.costCenterId);
    if (!cc) return "";
    const color = CC_PALETTE[cc.colorIndex % CC_PALETTE.length];
    return `<span class="tag" style="background:${color};">${escapeHtml(cc.code)} · ${fmtHoursDecimal(a.minutes)} h</span>`;
  }).join("");
  const projectTags = (e.projectAllocations || []).map((a) => {
    const pr = projects.find((p) => p.id === a.projectId);
    if (!pr) return "";
    const color = PROJECT_PALETTE[pr.colorIndex % PROJECT_PALETTE.length];
    return `<span class="tag" style="background:${color};">${escapeHtml(pr.code)} · ${fmtHoursDecimal(a.minutes)} h</span>`;
  }).join("");
  const laborTag = e.laborMinutes > 0
    ? `<span class="tag tag-labor">Labor · ${fmtHoursDecimal(e.laborMinutes)} h</span>` : "";
  const unallocTag = unallocated > 0
    ? `<span class="tag-unallocated">${fmtHoursDecimal(unallocated)} h offen</span>` : "";

  return `
    <div class="entry-card" data-entry-id="${e.id}">
      <div class="entry-top">
        <span class="entry-date">${fmtDateDisplay(e.date)}</span>
        <span class="entry-total">${fmtHoursDecimal(e.totalMinutes)} h</span>
      </div>
      <div class="entry-meta">
        <span>${e.start}–${e.end}</span>
        ${e.pauseStart && e.pauseEnd ? `<span>Pause ${e.pauseStart}–${e.pauseEnd}</span>` : ""}
        ${e.activity ? `<span>${escapeHtml(e.activity)}</span>` : ""}
      </div>
      ${(tags || projectTags || laborTag || unallocTag) ? `<div class="entry-tags">${tags}${projectTags}${laborTag}${unallocTag}</div>` : ""}
    </div>`;
}

/* =========================================================
   TIMES sheet (create manual / edit / after timer finish)
   ========================================================= */
function openTimesSheet(mode, entry) {
  flow.mode = mode;
  flow.editingId = entry.id || null;
  flow.draft = { ...entry };

  document.getElementById("sheet-times-title").textContent =
    mode === "edit" ? "Eintrag bearbeiten" :
    mode === "timer-finish" ? "Feierabend – Eintrag prüfen" : "Eintrag manuell erfassen";

  document.getElementById("f-date").value = entry.date || todayStr();
  document.getElementById("f-start").value = entry.start || "";
  document.getElementById("f-end").value = entry.end || "";
  document.getElementById("f-pause-start").value = entry.pauseStart || "";
  document.getElementById("f-pause-end").value = entry.pauseEnd || "";
  document.getElementById("f-activity").value = entry.activity || "";

  document.getElementById("times-delete-row").style.display = mode === "edit" ? "block" : "none";
  document.getElementById("btn-times-next").textContent =
    mode === "edit" ? "Weiter zur Aufteilung" : "Weiter zur Aufteilung";

  updateTimesHint();
  showBackdrop("sheet-times-backdrop");
}

function closeTimesSheet() { hideBackdrop("sheet-times-backdrop"); }

function cancelTimesSheet() {
  if (flow.mode === "timer-finish") {
    if (!confirm("Eintrag verwerfen? Die soeben erfasste Arbeitszeit für heute geht dabei verloren.")) return;
  }
  flow = { mode: null, editingId: null, draft: null };
  closeTimesSheet();
}

function readTimesForm() {
  return {
    date: document.getElementById("f-date").value,
    start: document.getElementById("f-start").value,
    end: document.getElementById("f-end").value,
    pauseStart: document.getElementById("f-pause-start").value,
    pauseEnd: document.getElementById("f-pause-end").value,
    activity: document.getElementById("f-activity").value.trim(),
  };
}

function updateTimesHint() {
  const v = readTimesForm();
  const hint = document.getElementById("times-total-hint");
  if (!v.start || !v.end) { hint.textContent = "Gesamtarbeitszeit: –"; hint.className = "hint"; return; }
  if ((v.pauseStart && !v.pauseEnd) || (!v.pauseStart && v.pauseEnd)) {
    hint.textContent = "Bitte Pause-Start und Pause-Ende beide angeben (oder beide leer lassen).";
    hint.className = "hint warn";
    return;
  }
  const total = computeTotalMinutes(v.start, v.end, v.pauseStart, v.pauseEnd);
  hint.textContent = `Gesamtarbeitszeit: ${fmtHoursDecimal(total)} h`;
  hint.className = "hint ok";
}

function proceedToAllocation() {
  const v = readTimesForm();
  if (!v.date || !v.start || !v.end) { toast("Bitte Datum, Beginn und Ende ausfüllen."); return; }
  if ((v.pauseStart && !v.pauseEnd) || (!v.pauseStart && v.pauseEnd)) {
    toast("Pause bitte mit Start UND Ende angeben."); return;
  }
  const total = computeTotalMinutes(v.start, v.end, v.pauseStart, v.pauseEnd);

  flow.draft = {
    ...flow.draft,
    date: v.date, start: v.start, end: v.end,
    pauseStart: v.pauseStart, pauseEnd: v.pauseEnd,
    activity: v.activity, totalMinutes: total,
  };

  closeTimesSheet();
  openAllocSheet();
}

function deleteCurrentEntry() {
  if (!flow.editingId) return;
  if (!confirm("Diesen Eintrag wirklich löschen?")) return;
  entries = entries.filter((e) => e.id !== flow.editingId);
  saveEntries(entries);
  closeTimesSheet();
  renderAll();
  toast("Eintrag gelöscht.");
}

/* =========================================================
   ALLOCATION sheet
   ========================================================= */
function openAllocSheet() {
  const total = flow.draft.totalMinutes || 0;
  document.getElementById("alloc-sub").textContent = `Gesamtarbeitszeit: ${fmtHoursDecimal(total)} h – teile sie auf.`;

  const rowsEl = document.getElementById("alloc-costcenter-rows");
  const noCcHint = document.getElementById("alloc-no-cc");

  if (costCenters.length === 0) {
    rowsEl.innerHTML = "";
    noCcHint.style.display = "block";
  } else {
    noCcHint.style.display = "none";
    rowsEl.innerHTML = costCenters.map((cc) => {
      const existing = (flow.draft.allocations || []).find((a) => a.costCenterId === cc.id);
      const color = CC_PALETTE[cc.colorIndex % CC_PALETTE.length];
      return `
        <div class="alloc-row">
          <span class="alloc-swatch" style="background:${color};"></span>
          <span class="alloc-name">${escapeHtml(cc.code)} — ${escapeHtml(cc.name)}</span>
          <div class="alloc-input">
            <input type="time" data-cc-id="${cc.id}" value="${existing ? minutesToHHMM(existing.minutes) : ""}" />
          </div>
          <span class="alloc-unit"></span>
        </div>`;
    }).join("");
    rowsEl.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
      updateAllocRemainingHint();
      renderAllocProjectRows();
    }));
  }

  document.getElementById("alloc-labor-minutes").value = minutesToHHMM(flow.draft.laborMinutes);
  document.getElementById("alloc-labor-minutes").oninput = updateAllocRemainingHint;

  updateAllocRemainingHint();
  renderAllocProjectRows();
  showBackdrop("sheet-alloc-backdrop");
}

function closeAllocSheet() { hideBackdrop("sheet-alloc-backdrop"); }

function readAllocRows() {
  const rows = [];
  document.querySelectorAll("#alloc-costcenter-rows input[data-cc-id]").forEach((inp) => {
    const minutes = parseHHMM(inp.value);
    if (minutes > 0) rows.push({ costCenterId: inp.dataset.ccId, minutes });
  });
  return rows;
}

function readProjectAllocRows() {
  const rows = [];
  document.querySelectorAll("#alloc-project-rows input[data-project-id]").forEach((inp) => {
    const minutes = parseHHMM(inp.value);
    if (minutes > 0) rows.push({ projectId: inp.dataset.projectId, minutes });
  });
  return rows;
}

function updateAllocRemainingHint() {
  const total = flow.draft.totalMinutes || 0;
  const allocated = readAllocRows().reduce((s, a) => s + a.minutes, 0);
  const remaining = total - allocated;
  const hint = document.getElementById("alloc-remaining-hint");
  if (allocated === 0) {
    hint.textContent = `Noch nichts zugeteilt (Gesamt: ${fmtHoursDecimal(total)} h).`;
    hint.className = "hint";
  } else if (remaining > 0.4) {
    hint.textContent = `Noch nicht zugeteilt: ${fmtHoursDecimal(remaining)} h`;
    hint.className = "hint warn";
  } else if (remaining < -0.4) {
    hint.textContent = `Zuteilung übersteigt Gesamtzeit um ${fmtHoursDecimal(-remaining)} h`;
    hint.className = "hint warn";
  } else {
    hint.textContent = "✓ Vollständig zugeteilt";
    hint.className = "hint ok";
  }
}

/* Projekte erscheinen erst, sobald ihre übergeordnete Kostenstelle Zeit hat
   (oder wenn sie bereits aus einer früheren Speicherung Zeit zugewiesen bekommen haben,
   damit beim Bearbeiten nichts unsichtbar verloren geht). */
function renderAllocProjectRows() {
  const container = document.getElementById("alloc-project-rows");
  const noProjectHint = document.getElementById("alloc-no-project");

  const typedValues = {};
  container.querySelectorAll("input[data-project-id]").forEach((inp) => {
    typedValues[inp.dataset.projectId] = inp.value;
  });

  const ccMinutes = {};
  document.querySelectorAll("#alloc-costcenter-rows input[data-cc-id]").forEach((inp) => {
    ccMinutes[inp.dataset.ccId] = parseHHMM(inp.value);
  });

  const savedProjectCcIds = new Set(
    (flow.draft.projectAllocations || [])
      .map((a) => projects.find((p) => p.id === a.projectId))
      .filter(Boolean)
      .map((p) => p.costCenterId)
  );
  const activeCcIds = costCenters
    .filter((cc) => (ccMinutes[cc.id] || 0) > 0 || savedProjectCcIds.has(cc.id))
    .map((cc) => cc.id);

  if (activeCcIds.length === 0) {
    container.innerHTML = "";
    noProjectHint.textContent = "Trage zuerst oben bei einer Kostenstelle Zeit ein – die zugehörigen Projekte erscheinen dann automatisch hier.";
    noProjectHint.style.display = "block";
    return;
  }

  const groups = activeCcIds
    .map((ccId) => ({ cc: costCenters.find((c) => c.id === ccId), list: projects.filter((p) => p.costCenterId === ccId) }))
    .filter((g) => g.list.length > 0);

  if (groups.length === 0) {
    container.innerHTML = "";
    noProjectHint.textContent = "Für die aktuell eingetragene(n) Kostenstelle(n) sind noch keine Projekte angelegt.";
    noProjectHint.style.display = "block";
    return;
  }
  noProjectHint.style.display = "none";

  container.innerHTML = groups.map(({ cc, list }) => {
    const rowsHtml = list.map((pr) => {
      const existing = (flow.draft.projectAllocations || []).find((a) => a.projectId === pr.id);
      const value = typedValues[pr.id] !== undefined ? typedValues[pr.id] : (existing ? minutesToHHMM(existing.minutes) : "");
      const color = PROJECT_PALETTE[pr.colorIndex % PROJECT_PALETTE.length];
      return `
        <div class="alloc-row">
          <span class="alloc-swatch" style="background:${color};"></span>
          <span class="alloc-name">${escapeHtml(pr.code)} — ${escapeHtml(pr.name)}</span>
          <div class="alloc-input">
            <input type="time" data-project-id="${pr.id}" data-parent-cc="${cc.id}" value="${value}" />
          </div>
          <span class="alloc-unit"></span>
        </div>`;
    }).join("");
    return `
      <div class="alloc-group-label" data-group-hint="${cc.id}">
        <span>${escapeHtml(cc.code)} — ${escapeHtml(cc.name)}</span>
        <span class="hint-inline"></span>
      </div>
      ${rowsHtml}`;
  }).join("");

  container.querySelectorAll("input[data-project-id]").forEach((inp) => inp.addEventListener("input", updateAllocGroupHints));
  updateAllocGroupHints();
}

function updateAllocGroupHints() {
  const ccMinutes = {};
  document.querySelectorAll("#alloc-costcenter-rows input[data-cc-id]").forEach((inp) => {
    ccMinutes[inp.dataset.ccId] = parseHHMM(inp.value);
  });
  document.querySelectorAll("#alloc-project-rows [data-group-hint]").forEach((label) => {
    const ccId = label.dataset.groupHint;
    const ccTotal = ccMinutes[ccId] || 0;
    const allocated = Array.from(document.querySelectorAll(`#alloc-project-rows input[data-parent-cc="${ccId}"]`))
      .reduce((s, inp) => s + parseHHMM(inp.value), 0);
    const remaining = ccTotal - allocated;
    const span = label.querySelector(".hint-inline");
    if (allocated === 0) {
      span.textContent = "";
      span.className = "hint-inline";
    } else if (remaining > 0.4) {
      span.textContent = `noch ${fmtHoursDecimal(remaining)} h offen`;
      span.className = "hint-inline warn";
    } else if (remaining < -0.4) {
      span.textContent = `${fmtHoursDecimal(-remaining)} h über Kostenstelle`;
      span.className = "hint-inline warn";
    } else {
      span.textContent = "✓ vollständig";
      span.className = "hint-inline ok";
    }
  });
}

function saveAllocation() {
  const allocations = readAllocRows();
  const projectAllocations = readProjectAllocRows();
  const laborMinutes = parseHHMM(document.getElementById("alloc-labor-minutes").value);

  const entry = {
    id: flow.editingId || uid(),
    date: flow.draft.date,
    start: flow.draft.start,
    end: flow.draft.end,
    pauseStart: flow.draft.pauseStart,
    pauseEnd: flow.draft.pauseEnd,
    activity: flow.draft.activity,
    totalMinutes: flow.draft.totalMinutes,
    allocations, projectAllocations, laborMinutes,
    source: flow.draft.source || (flow.mode === "timer-finish" ? "timer" : "manual"),
    createdAt: flow.draft.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  if (flow.editingId) {
    entries = entries.map((e) => (e.id === entry.id ? entry : e));
  } else {
    entries.push(entry);
  }
  saveEntries(entries);
  closeAllocSheet();
  flow = { mode: null, editingId: null, draft: null };
  renderAll();
  toast("Eintrag gespeichert.");
}

/* =========================================================
   COST CENTERS view
   ========================================================= */
function renderCostCenters() {
  const container = document.getElementById("costcenter-list");
  if (costCenters.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🏷</div>
        <p>Noch keine Kostenstellen angelegt.</p>
      </div>`;
    return;
  }
  container.innerHTML = costCenters.map((cc) => {
    const color = CC_PALETTE[cc.colorIndex % CC_PALETTE.length];
    return `
      <div class="cc-row">
        <span class="cc-swatch" style="background:${color};"></span>
        <div class="cc-info">
          <div class="cc-code">${escapeHtml(cc.code)}</div>
          <div class="cc-name">${escapeHtml(cc.name)}</div>
        </div>
        <button class="cc-del" data-cc-id="${cc.id}" aria-label="Löschen">✕</button>
      </div>`;
  }).join("");

  container.querySelectorAll(".cc-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.ccId;
      const cc = costCenters.find((c) => c.id === id);
      const usedIn = entries.filter((e) => (e.allocations || []).some((a) => a.costCenterId === id)).length;
      const ownProjects = projects.filter((p) => p.costCenterId === id);
      let msg = `Kostenstelle „${cc.code}" löschen?`;
      if (ownProjects.length > 0) {
        msg = `„${cc.code}" hat ${ownProjects.length} zugeordnete(s) Projekt(e) (${ownProjects.map((p) => p.code).join(", ")}). Diese werden mitgelöscht. `;
      }
      if (usedIn > 0) {
        msg += `„${cc.code}" wird außerdem in ${usedIn} Eintrag/Einträgen verwendet – die Zuordnung geht dabei verloren. `;
      }
      msg += "Wirklich löschen?";
      if (!confirm(msg)) return;
      costCenters = costCenters.filter((c) => c.id !== id);
      projects = projects.filter((p) => p.costCenterId !== id);
      saveCostCenters(costCenters);
      saveProjects(projects);
      renderAll();
      toast("Kostenstelle gelöscht.");
    });
  });
}

function addCostCenter(code, name) {
  costCenters.push({ id: uid(), code: code.toUpperCase(), name, colorIndex: costCenters.length });
  saveCostCenters(costCenters);
  renderCostCenters();
}

/* =========================================================
   PROJECTS view (independent of cost centers)
   ========================================================= */
function renderProjects() {
  const container = document.getElementById("project-list");
  populateProjectCostCenterSelect();

  if (projects.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📁</div>
        <p>Noch keine Projekte angelegt.</p>
      </div>`;
    return;
  }
  container.innerHTML = projects.map((pr) => {
    const color = PROJECT_PALETTE[pr.colorIndex % PROJECT_PALETTE.length];
    const options = costCenters.map((cc) =>
      `<option value="${cc.id}" ${cc.id === pr.costCenterId ? "selected" : ""}>${escapeHtml(cc.code)}</option>`
    ).join("");
    const missing = !costCenters.some((c) => c.id === pr.costCenterId);
    return `
      <div class="cc-row">
        <span class="cc-swatch" style="background:${color};"></span>
        <div class="cc-info">
          <div class="cc-code">${escapeHtml(pr.code)}</div>
          <div class="cc-name">${escapeHtml(pr.name)}</div>
        </div>
        <select class="project-cc-select ${missing ? "missing" : ""}" data-project-id="${pr.id}">
          ${missing ? `<option value="" selected disabled>Kostenstelle?</option>` : ""}
          ${options}
        </select>
        <button class="cc-del" data-project-id="${pr.id}" aria-label="Löschen">✕</button>
      </div>`;
  }).join("");

  container.querySelectorAll(".project-cc-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      const pr = projects.find((p) => p.id === sel.dataset.projectId);
      pr.costCenterId = sel.value;
      saveProjects(projects);
      renderProjects();
      toast("Kostenstelle aktualisiert.");
    });
  });

  container.querySelectorAll(".cc-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.projectId;
      const pr = projects.find((p) => p.id === id);
      const usedIn = entries.filter((e) => (e.projectAllocations || []).some((a) => a.projectId === id)).length;
      const msg = usedIn > 0
        ? `„${pr.code}" wird in ${usedIn} Eintrag/Einträgen verwendet. Trotzdem löschen? Die Zuordnung geht dabei verloren.`
        : `Projekt „${pr.code}" löschen?`;
      if (!confirm(msg)) return;
      projects = projects.filter((p) => p.id !== id);
      saveProjects(projects);
      renderAll();
      toast("Projekt gelöscht.");
    });
  });
}

function populateProjectCostCenterSelect() {
  const select = document.getElementById("pr-costcenter");
  const noCcHint = document.getElementById("project-no-cc-hint");
  const submitBtn = document.querySelector("#form-project button[type=submit]");
  const prevValue = select.value;

  select.innerHTML = costCenters
    .map((cc) => `<option value="${cc.id}">${escapeHtml(cc.code)} — ${escapeHtml(cc.name)}</option>`)
    .join("");

  if (costCenters.length === 0) {
    noCcHint.style.display = "block";
    select.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
  } else {
    noCcHint.style.display = "none";
    select.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
    if (costCenters.some((c) => c.id === prevValue)) select.value = prevValue;
  }
}

function addProject(code, name, costCenterId) {
  projects.push({ id: uid(), code: code.toUpperCase(), name, costCenterId, colorIndex: projects.length });
  saveProjects(projects);
  renderProjects();
}

/* =========================================================
   EXPORT view
   ========================================================= */
function renderExportStats() {
  const container = document.getElementById("export-stats");
  const totalMinutes = entries.reduce((s, e) => s + e.totalMinutes, 0);
  const laborMinutes = entries.reduce((s, e) => s + (e.laborMinutes || 0), 0);
  container.innerHTML = `
    <div class="stat-box"><div class="n">${entries.length}</div><div class="l">Einträge gesamt</div></div>
    <div class="stat-box"><div class="n">${fmtHoursDecimal(totalMinutes)} h</div><div class="l">Erfasste Arbeitszeit</div></div>
    <div class="stat-box"><div class="n">${costCenters.length}</div><div class="l">Kostenstellen</div></div>
    <div class="stat-box"><div class="n">${projects.length}</div><div class="l">Projekte</div></div>
    <div class="stat-box"><div class="n">${fmtHoursDecimal(laborMinutes)} h</div><div class="l">davon Labor</div></div>
  `;
}

function sanitizeSheetName(name, used) {
  let n = String(name).replace(/[\\/?*\[\]:]/g, "-").slice(0, 31).trim() || "Blatt";
  let base = n, i = 2;
  while (used.has(n)) { n = (base.slice(0, 28) + "-" + i).slice(0, 31); i++; }
  used.add(n);
  return n;
}

/* =========================================================
   Übersicht (year overview) sheet
   ========================================================= */
function buildUebersichtSheet(year, monatsblaetterName, monthTotals) {
  const aoa = [];
  aoa.push([`Jahresübersicht ${year}`]);
  aoa.push(["", ...MONTHS_AT.map((m) => m.short), "", "Σ Arbeitszeiten /a"]);
  aoa.push(["Stunden pro Woche", ...Array(12).fill(0), "", ""]);
  aoa.push(["Soll", ...Array(12).fill(0), "", 0]);
  aoa.push(["Ist", ...Array(12).fill(0), "", 0]);
  aoa.push(["Differenz", ...Array(12).fill(""), "", 0]);
  aoa.push([]);
  aoa.push(["", ...MONTHS_AT.map((m) => m.short), "", "Σ Urlaubszeiten /a"]);
  aoa.push(["Soll", ...Array(12).fill(0), "", 0]);
  aoa.push(["Ist", ...Array(12).fill(0), "", 0]);
  aoa.push(["Differenz", ...Array(12).fill(""), "", 0]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const O = 14; // column O (A=0 … M=12, N=13 spacer, O=14)

  for (let m = 0; m < 12; m++) {
    const col = m + 1; // B(1) … M(12)
    ws[XLSX.utils.encode_cell({ r: 3, c: col })] = { t: "n", f: `'${monatsblaetterName}'!${monthTotals[m].sollAddr}`, z: "0.00" };
    ws[XLSX.utils.encode_cell({ r: 4, c: col })] = { t: "n", f: `'${monatsblaetterName}'!${monthTotals[m].istAddr}`, z: "0.00" };
  }
  ws[XLSX.utils.encode_cell({ r: 3, c: O })] = { t: "n", f: "SUM(B4:M4)", z: "0.00" };
  ws[XLSX.utils.encode_cell({ r: 4, c: O })] = { t: "n", f: "SUM(B5:M5)", z: "0.00" };
  ws[XLSX.utils.encode_cell({ r: 5, c: O })] = { t: "n", f: "O5-O4", z: "0.00" };

  ws[XLSX.utils.encode_cell({ r: 8, c: O })] = { t: "n", f: "SUM(B9:M9)", z: "0.00" };
  ws[XLSX.utils.encode_cell({ r: 9, c: O })] = { t: "n", f: "SUM(B10:M10)", z: "0.00" };
  ws[XLSX.utils.encode_cell({ r: 10, c: O })] = { t: "n", f: "O10-O9", z: "0.00" };

  ws["!cols"] = [{ wch: 18 }, ...Array(12).fill({ wch: 8 }), { wch: 2 }, { wch: 16 }];
  return ws;
}

/* =========================================================
   Monatsblätter: ONE worksheet containing all 12 monthly
   "Arbeitsbericht" tables, stacked vertically (not 12 tabs).
   ========================================================= */
function buildMonatsblaetterSheet(year, overviewSheetName) {
  const aoa = [];
  const merges = [];
  const formulaPatches = [];
  const monthTotals = [];
  let cursor = 0; // 0-indexed row cursor

  MONTHS_AT.forEach((meta, monthIndex) => {
    const daysCount = new Date(year, monthIndex + 1, 0).getDate();
    const monthCol = XLSX.utils.encode_col(monthIndex + 1);
    const isoPrefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const blockStart = cursor;

    aoa.push(["SOLL", 0, "", `Arbeitsbericht ${meta.full} ${year}`, "", "", ""]);
    aoa.push(["IST", 0, "", loadEmployeeName(), "", "", ""]);
    aoa.push([]);
    aoa.push(["Tag", "Datum", "Arbeitszeit", "", "Pause", "", "Stunden gearbeitet", "Tätigkeit", "Geschäftsstellen-Kürzel", "davon BESN", "Stunden Soll"]);
    aoa.push(["", "", "Beginn", "Ende", "von", "bis", "", "", "", "", ""]);

    const dataStart = blockStart + 5;
    for (let d = 1; d <= daysCount; d++) {
      const dateObj = new Date(year, monthIndex, d);
      const iso = `${isoPrefix}-${String(d).padStart(2, "0")}`;
      const dow = dateObj.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const wd = WEEKDAY_ABBR_AT[dow];
      const dateStr = `${String(d).padStart(2, "0")}.${String(monthIndex + 1).padStart(2, "0")}.${year}`;
      const entry = entries.find((e) => e.date === iso);

      if (isWeekend) {
        aoa.push([wd, dateStr, "", "", "", "", "", "", "", "", ""]);
      } else {
        const ccCodes = entry
          ? (entry.allocations || [])
              .map((a) => costCenters.find((c) => c.id === a.costCenterId))
              .filter(Boolean)
              .map((c) => c.code)
              .join(", ")
          : "";
        aoa.push([
          wd, dateStr,
          entry ? entry.start || "" : "",
          entry ? entry.end || "" : "",
          entry ? entry.pauseStart || "" : "",
          entry ? entry.pauseEnd || "" : "",
          entry ? Number((entry.totalMinutes / 60).toFixed(2)) : 0,
          entry ? entry.activity || "" : "",
          ccCodes,
          "",
          0,
        ]);
      }
    }
    const dataEnd = dataStart + daysCount - 1;

    formulaPatches.push({ r: blockStart, c: 1, f: `SUM(K${dataStart + 1}:K${dataEnd + 1})`, z: "0.00" });
    formulaPatches.push({ r: blockStart + 1, c: 1, f: `SUM(G${dataStart + 1}:G${dataEnd + 1})`, z: "0.00" });
    for (let d = 1; d <= daysCount; d++) {
      const rowIdx = dataStart + (d - 1);
      const dow = new Date(year, monthIndex, d).getDay();
      if (dow !== 0 && dow !== 6) {
        formulaPatches.push({ r: rowIdx, c: 10, f: `'${overviewSheetName}'!${monthCol}3/5`, z: "0.00" });
      }
    }

    merges.push(
      { s: { r: blockStart, c: 3 }, e: { r: blockStart, c: 6 } },
      { s: { r: blockStart + 1, c: 3 }, e: { r: blockStart + 1, c: 6 } },
      { s: { r: blockStart + 3, c: 0 }, e: { r: blockStart + 4, c: 0 } },
      { s: { r: blockStart + 3, c: 1 }, e: { r: blockStart + 4, c: 1 } },
      { s: { r: blockStart + 3, c: 2 }, e: { r: blockStart + 3, c: 3 } },
      { s: { r: blockStart + 3, c: 4 }, e: { r: blockStart + 3, c: 5 } },
      { s: { r: blockStart + 3, c: 6 }, e: { r: blockStart + 4, c: 6 } },
      { s: { r: blockStart + 3, c: 7 }, e: { r: blockStart + 4, c: 7 } },
      { s: { r: blockStart + 3, c: 8 }, e: { r: blockStart + 4, c: 8 } },
      { s: { r: blockStart + 3, c: 9 }, e: { r: blockStart + 4, c: 9 } },
      { s: { r: blockStart + 3, c: 10 }, e: { r: blockStart + 4, c: 10 } },
    );

    monthTotals.push({
      sollAddr: XLSX.utils.encode_cell({ r: blockStart, c: 1 }),
      istAddr: XLSX.utils.encode_cell({ r: blockStart + 1, c: 1 }),
    });

    cursor = dataEnd + 2; // gap row between this month's block and the next
    aoa.push([]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  formulaPatches.forEach((p) => {
    ws[XLSX.utils.encode_cell({ r: p.r, c: p.c })] = { t: "n", f: p.f, z: p.z };
  });
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 6 }, { wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 8 },
    { wch: 13 }, { wch: 26 }, { wch: 14 }, { wch: 10 }, { wch: 11 },
  ];
  return { ws, monthTotals };
}

/* =========================================================
   Side-by-side project-block sheet (used for Kostenstellen sheets):
   one 4-column block (Datum | h | davon Labor | Beschreibung) per
   project, "Allgemein" first for unassigned time, blocks placed
   next to each other with each keeping its own row count.
   ========================================================= */
function buildBlockSheet(titleLabel, relevantEntries, generalHoursFn, projectHoursFn) {
  const noneRows = [];
  const projectRowsMap = new Map();

  relevantEntries.forEach((e) => {
    const laborH = e.laborMinutes ? Number((e.laborMinutes / 60).toFixed(2)) : "";
    const projAllocs = e.projectAllocations || [];
    if (projAllocs.length === 0) {
      noneRows.push([fmtDatePlain(e.date), generalHoursFn(e), laborH, e.activity || ""]);
    } else {
      projAllocs.forEach((pa) => {
        const arr = projectRowsMap.get(pa.projectId) || [];
        arr.push([fmtDatePlain(e.date), projectHoursFn(e, pa), laborH, e.activity || ""]);
        projectRowsMap.set(pa.projectId, arr);
      });
    }
  });

  const blockDefs = [];
  if (noneRows.length > 0) blockDefs.push({ label: "Allgemein", rows: noneRows });
  projects.forEach((pr) => {
    if (projectRowsMap.has(pr.id)) blockDefs.push({ label: pr.name, rows: projectRowsMap.get(pr.id) });
  });
  if (blockDefs.length === 0) blockDefs.push({ label: "Allgemein", rows: [] });

  blockDefs.forEach((b) => {
    b.sum = Number(b.rows.reduce((s, r) => s + (typeof r[1] === "number" ? r[1] : 0), 0).toFixed(2));
  });

  const maxRows = Math.max(0, ...blockDefs.map((b) => b.rows.length));
  const aoa = [];

  const row1 = [titleLabel];
  const employeeName = loadEmployeeName();
  if (employeeName) {
    const lastBlockCol = (blockDefs.length - 1) * 5; // 4 data cols + 1 spacer per block
    row1[lastBlockCol] = employeeName;
  }
  aoa.push(row1);

  const row2 = [], row3 = [];
  blockDefs.forEach((b, i) => {
    const last = i === blockDefs.length - 1;
    row2.push(b.label, b.sum, "", "");
    row3.push("Datum", "h", "davon Labor", "Beschreibung");
    if (!last) { row2.push(""); row3.push(""); }
  });
  aoa.push(row2);
  aoa.push(row3);

  for (let i = 0; i < maxRows; i++) {
    const row = [];
    blockDefs.forEach((b, bi) => {
      const last = bi === blockDefs.length - 1;
      if (b.rows[i]) row.push(...b.rows[i]);
      else row.push("", "", "", "");
      if (!last) row.push("");
    });
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  ws["!cols"] = blockDefs.flatMap((b, i) => {
    const cols = [{ wch: 11 }, { wch: 7 }, { wch: 10 }, { wch: 32 }];
    if (i < blockDefs.length - 1) cols.push({ wch: 2 });
    return cols;
  });
  return ws;
}

function exportExcel() {
  if (typeof XLSX === "undefined") {
    toast("Excel-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.");
    return;
  }
  if (entries.length === 0) { toast("Noch keine Einträge zum Exportieren vorhanden."); return; }

  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  // ---- Übersicht + Monatsblätter (one block per calendar year present in the data) ----
  const years = [...new Set(entries.map((e) => e.date.slice(0, 4)))].sort();
  const multiYear = years.length > 1;
  years.forEach((year) => {
    const suffix = multiYear ? ` ${year}` : "";
    const monatsblaetterName = sanitizeSheetName("Monatsblätter" + suffix, usedNames);
    const overviewName = sanitizeSheetName("Übersicht" + suffix, usedNames);

    const { ws: wsMonths, monthTotals } = buildMonatsblaetterSheet(Number(year), overviewName);
    const wsOverview = buildUebersichtSheet(year, monatsblaetterName, monthTotals);

    XLSX.utils.book_append_sheet(wb, wsOverview, overviewName);
    XLSX.utils.book_append_sheet(wb, wsMonths, monatsblaetterName);
  });

  // ---- Gesamt (unchanged: flat list with a column per Kostenstelle and per Projekt) ----
  const header = ["Datum", "Beginn der Arbeit", "Ende der Arbeit", "Pause Start", "Pause Ende",
    "Gesamtarbeitszeit (h)", "Tätigkeit",
    ...costCenters.map((c) => c.code),
    ...projects.map((p) => `${p.code} (Projekt)`),
    "Labor (h)"];
  const rows = sorted.map((e) => {
    const row = [
      fmtDateDisplay(e.date), e.start || "", e.end || "", e.pauseStart || "", e.pauseEnd || "",
      Number((e.totalMinutes / 60).toFixed(2)), e.activity || "",
    ];
    costCenters.forEach((cc) => {
      const alloc = (e.allocations || []).find((a) => a.costCenterId === cc.id);
      row.push(alloc ? Number((alloc.minutes / 60).toFixed(2)) : "");
    });
    projects.forEach((pr) => {
      const alloc = (e.projectAllocations || []).find((a) => a.projectId === pr.id);
      row.push(alloc ? Number((alloc.minutes / 60).toFixed(2)) : "");
    });
    row.push(e.laborMinutes ? Number((e.laborMinutes / 60).toFixed(2)) : "");
    return row;
  });
  const ws1 = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws1["!cols"] = header.map((h, i) => ({ wch: i === 6 ? 26 : i === 0 ? 12 : 14 }));
  XLSX.utils.book_append_sheet(wb, ws1, sanitizeSheetName("Gesamt", usedNames));

  // ---- One sheet per Kostenstelle: Projekte as side-by-side blocks (Allgemein first) ----
  costCenters.forEach((cc) => {
    const ccEntries = sorted.filter((e) => (e.allocations || []).some((a) => a.costCenterId === cc.id));
    const hoursForCc = (e) => {
      const alloc = (e.allocations || []).find((a) => a.costCenterId === cc.id);
      return alloc ? Number((alloc.minutes / 60).toFixed(2)) : 0;
    };
    const ws = buildBlockSheet(cc.name || cc.code, ccEntries, hoursForCc, hoursForCc);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(cc.code, usedNames));
  });

  // ---- Safety net: project time that has NO cost-center allocation at all would otherwise be lost ----
  const orphanEntries = sorted.filter((e) =>
    (e.projectAllocations || []).length > 0 && (e.allocations || []).length === 0
  );
  if (orphanEntries.length > 0) {
    const ws = buildBlockSheet(
      "Projekte ohne Kostenstelle",
      orphanEntries,
      () => 0,
      (e, pa) => Number((pa.minutes / 60).toFixed(2))
    );
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName("Projekte ohne Kostenstelle", usedNames));
  }

  // ---- Labor sheet (unchanged) ----
  const laborRows = sorted
    .filter((e) => e.laborMinutes > 0)
    .map((e) => [fmtDateDisplay(e.date), e.activity || "", Number((e.laborMinutes / 60).toFixed(2))]);
  const laborSum = laborRows.reduce((s, r) => s + r[2], 0);
  const laborAoa = [["Datum", "Tätigkeit", "Labor-Stunden"], ...laborRows, [], ["", "Summe", Number(laborSum.toFixed(2))]];
  const wsLabor = XLSX.utils.aoa_to_sheet(laborAoa);
  wsLabor["!cols"] = [{ wch: 12 }, { wch: 34 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsLabor, sanitizeSheetName("Labor", usedNames));

  const filename = `Arbeitszeit_Export_${todayStr()}.xlsx`;
  XLSX.writeFile(wb, filename);
  toast("Excel-Datei wurde erstellt.");
}

/* =========================================================
   Backup import / export (JSON)
   ========================================================= */
function exportJSON() {
  const data = { entries, costCenters, projects, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `Arbeitszeit_Backup_${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast("Backup wurde heruntergeladen.");
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.entries) || !Array.isArray(data.costCenters)) throw new Error("format");
      if (!confirm("Backup importieren? Vorhandene Daten in dieser App werden dabei ersetzt.")) return;
      entries = data.entries;
      costCenters = data.costCenters;
      projects = Array.isArray(data.projects) ? data.projects : [];
      saveEntries(entries);
      saveCostCenters(costCenters);
      saveProjects(projects);
      renderAll();
      toast("Backup importiert.");
    } catch {
      toast("Diese Datei konnte nicht gelesen werden.");
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm("Wirklich ALLE Einträge und Kostenstellen unwiderruflich löschen?")) return;
  if (!confirm("Bist du sicher? Dieser Schritt kann nicht rückgängig gemacht werden.")) return;
  entries = []; costCenters = []; projects = []; timer = { status: "idle" };
  saveEntries(entries); saveCostCenters(costCenters); saveProjects(projects); saveTimer(timer);
  renderAll();
  toast("Alle Daten wurden gelöscht.");
}

/* =========================================================
   Sheet show/hide helpers
   ========================================================= */
function showBackdrop(id) { document.getElementById(id).classList.add("active"); }
function hideBackdrop(id) { document.getElementById(id).classList.remove("active"); }

/* =========================================================
   View switching
   ========================================================= */
function switchView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === id));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === id));
  if (id === "view-entries") renderEntries();
  if (id === "view-costcenters") renderCostCenters();
  if (id === "view-projects") renderProjects();
  if (id === "view-export") renderExportStats();
}

function renderAll() {
  renderTodaySummary();
  renderEntries();
  renderCostCenters();
  renderProjects();
  renderExportStats();
}

/* =========================================================
   Event wiring
   ========================================================= */
function wireEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) =>
    btn.addEventListener("click", () => switchView(btn.dataset.view)));

  document.getElementById("btn-start").addEventListener("click", startWork);
  document.getElementById("btn-pause").addEventListener("click", pauseWork);
  document.getElementById("btn-resume").addEventListener("click", resumeWork);
  document.getElementById("btn-end").addEventListener("click", finishWork);
  document.getElementById("btn-end-2").addEventListener("click", finishWork);

  document.getElementById("btn-add-manual").addEventListener("click", () => {
    openTimesSheet("manual-new", {
      date: todayStr(), start: "", end: "", pauseStart: "", pauseEnd: "", activity: "",
    });
  });

  ["f-date", "f-start", "f-end", "f-pause-start", "f-pause-end"].forEach((id) =>
    document.getElementById(id).addEventListener("input", updateTimesHint));

  document.getElementById("form-times").addEventListener("submit", (ev) => {
    ev.preventDefault();
    proceedToAllocation();
  });
  document.getElementById("btn-times-cancel").addEventListener("click", cancelTimesSheet);
  document.getElementById("btn-times-delete").addEventListener("click", deleteCurrentEntry);

  document.getElementById("btn-alloc-back").addEventListener("click", () => {
    // keep whatever the user already typed so it isn't lost when going back
    flow.draft.allocations = readAllocRows();
    flow.draft.projectAllocations = readProjectAllocRows();
    flow.draft.laborMinutes = parseHHMM(document.getElementById("alloc-labor-minutes").value);
    closeAllocSheet();
    openTimesSheet(flow.mode, flow.draft);
  });
  document.getElementById("btn-alloc-save").addEventListener("click", saveAllocation);

  document.getElementById("form-costcenter").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const code = document.getElementById("cc-code").value.trim();
    const name = document.getElementById("cc-name").value.trim();
    if (!code || !name) return;
    addCostCenter(code, name);
    document.getElementById("form-costcenter").reset();
    toast("Kostenstelle hinzugefügt.");
  });

  document.getElementById("form-project").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const code = document.getElementById("pr-code").value.trim();
    const name = document.getElementById("pr-name").value.trim();
    const costCenterId = document.getElementById("pr-costcenter").value;
    if (!code || !name) return;
    if (!costCenterId) { toast("Bitte zuerst eine Kostenstelle anlegen und auswählen."); return; }
    addProject(code, name, costCenterId);
    document.getElementById("form-project").reset();
    populateProjectCostCenterSelect();
    toast("Projekt hinzugefügt.");
  });

  document.getElementById("btn-export").addEventListener("click", exportExcel);
  const employeeNameInput = document.getElementById("employee-name");
  employeeNameInput.value = loadEmployeeName();
  employeeNameInput.addEventListener("input", () => saveEmployeeName(employeeNameInput.value));
  document.getElementById("btn-export-json").addEventListener("click", exportJSON);
  document.getElementById("btn-import-json").addEventListener("click", () =>
    document.getElementById("import-file-input").click());
  document.getElementById("import-file-input").addEventListener("change", (ev) => {
    const file = ev.target.files[0];
    if (file) importJSON(file);
    ev.target.value = "";
  });
  document.getElementById("btn-reset-all").addEventListener("click", resetAll);

  // Close sheets by tapping the dim backdrop (but not the sheet itself)
  document.getElementById("sheet-times-backdrop").addEventListener("click", (ev) => {
    if (ev.target.id === "sheet-times-backdrop") cancelTimesSheet();
  });
  document.getElementById("sheet-alloc-backdrop").addEventListener("click", (ev) => {
    if (ev.target.id === "sheet-alloc-backdrop") closeAllocSheet();
  });
}

/* =========================================================
   Init
   ========================================================= */
function init() {
  renderTopbarDate();
  wireEvents();
  renderTimer();
  renderAll();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
