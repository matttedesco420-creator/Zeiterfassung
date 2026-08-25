"use strict";

/* =========================================================
   Storage keys & palette
   ========================================================= */
const K = {
  entries: "azt_entries_v1",
  costCenters: "azt_costcenters_v1",
  timer: "azt_timer_v1",
};

const CC_PALETTE = [
  "#4C6EF5", "#B5406B", "#6B8F3F", "#8355C9",
  "#C94F4F", "#2E8FB0", "#B08A2E", "#5C6B73",
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

  const segs = Object.entries(ccTotals).map(([ccId, min]) => {
    const cc = costCenters.find((c) => c.id === ccId);
    if (!cc) return null;
    return { label: cc.code, color: CC_PALETTE[cc.colorIndex % CC_PALETTE.length], minutes: min };
  }).filter(Boolean);

  const allocatedSum = segs.reduce((s, x) => s + x.minutes, 0);
  const unallocated = Math.max(0, totalMinutes - allocatedSum);

  let barHTML = "";
  if (totalMinutes > 0) {
    segs.forEach((s) => {
      const pct = (s.minutes / totalMinutes) * 100;
      barHTML += `<div class="seg" style="width:${pct}%;background:${s.color};"></div>`;
    });
    if (unallocated > 0) {
      const pct = (unallocated / totalMinutes) * 100;
      barHTML += `<div class="seg empty-track" style="width:${pct}%;"></div>`;
    }
  } else {
    barHTML = `<div class="seg empty-track" style="width:100%;"></div>`;
  }

  let legendHTML = segs.map((s) => `
      <div class="legend-item">
        <span class="legend-swatch" style="background:${s.color};"></span>
        ${escapeHtml(s.label)} · ${fmtHoursDecimal(s.minutes)} h
      </div>`).join("");
  if (unallocated > 0) {
    legendHTML += `
      <div class="legend-item">
        <span class="legend-swatch" style="background:#e4e6ea;"></span>
        Nicht zugeteilt · ${fmtHoursDecimal(unallocated)} h
      </div>`;
  }

  const laborPct = totalMinutes > 0 ? Math.min(100, (laborMinutes / totalMinutes) * 100) : 0;

  return `
    <div class="summary-card">
      <div class="summary-head">
        <span class="summary-title">${list.length} Eintrag/Einträge</span>
        <span class="total">${fmtHoursDecimal(totalMinutes)} h</span>
      </div>
      <div class="daybar">${barHTML}</div>
      <div class="legend">${legendHTML}</div>
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
      ${(tags || laborTag || unallocTag) ? `<div class="entry-tags">${tags}${laborTag}${unallocTag}</div>` : ""}
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
            <input type="number" min="0" step="5" placeholder="0"
              data-cc-id="${cc.id}" value="${existing ? existing.minutes : ""}" />
          </div>
          <span class="alloc-unit">Min</span>
        </div>`;
    }).join("");
    rowsEl.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", updateAllocRemainingHint));
  }

  document.getElementById("alloc-labor-minutes").value = flow.draft.laborMinutes || "";
  document.getElementById("alloc-labor-minutes").oninput = updateAllocRemainingHint;

  updateAllocRemainingHint();
  showBackdrop("sheet-alloc-backdrop");
}

function closeAllocSheet() { hideBackdrop("sheet-alloc-backdrop"); }

function readAllocRows() {
  const rows = [];
  document.querySelectorAll("#alloc-costcenter-rows input[data-cc-id]").forEach((inp) => {
    const minutes = parseFloat(inp.value);
    if (minutes > 0) rows.push({ costCenterId: inp.dataset.ccId, minutes });
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

function saveAllocation() {
  const allocations = readAllocRows();
  const laborMinutes = parseFloat(document.getElementById("alloc-labor-minutes").value) || 0;

  const entry = {
    id: flow.editingId || uid(),
    date: flow.draft.date,
    start: flow.draft.start,
    end: flow.draft.end,
    pauseStart: flow.draft.pauseStart,
    pauseEnd: flow.draft.pauseEnd,
    activity: flow.draft.activity,
    totalMinutes: flow.draft.totalMinutes,
    allocations, laborMinutes,
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
      const msg = usedIn > 0
        ? `„${cc.code}" wird in ${usedIn} Eintrag/Einträgen verwendet. Trotzdem löschen? Die Zuordnung geht dabei verloren.`
        : `Kostenstelle „${cc.code}" löschen?`;
      if (!confirm(msg)) return;
      costCenters = costCenters.filter((c) => c.id !== id);
      saveCostCenters(costCenters);
      renderCostCenters();
      renderAll(true);
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

function exportExcel() {
  if (typeof XLSX === "undefined") {
    toast("Excel-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.");
    return;
  }
  if (entries.length === 0) { toast("Noch keine Einträge zum Exportieren vorhanden."); return; }

  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  // ---- Sheet 1: Gesamt ----
  const header = ["Datum", "Beginn der Arbeit", "Ende der Arbeit", "Pause Start", "Pause Ende",
    "Gesamtarbeitszeit (h)", "Tätigkeit", ...costCenters.map((c) => c.code), "Labor (h)"];
  const rows = sorted.map((e) => {
    const row = [
      fmtDateDisplay(e.date), e.start || "", e.end || "", e.pauseStart || "", e.pauseEnd || "",
      Number((e.totalMinutes / 60).toFixed(2)), e.activity || "",
    ];
    costCenters.forEach((cc) => {
      const alloc = (e.allocations || []).find((a) => a.costCenterId === cc.id);
      row.push(alloc ? Number((alloc.minutes / 60).toFixed(2)) : "");
    });
    row.push(e.laborMinutes ? Number((e.laborMinutes / 60).toFixed(2)) : "");
    return row;
  });
  const ws1 = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws1["!cols"] = header.map((h, i) => ({ wch: i === 6 ? 26 : i === 0 ? 12 : 14 }));
  XLSX.utils.book_append_sheet(wb, ws1, sanitizeSheetName("Gesamt", usedNames));

  // ---- One sheet per cost center ----
  costCenters.forEach((cc) => {
    const ccRows = sorted
      .map((e) => {
        const alloc = (e.allocations || []).find((a) => a.costCenterId === cc.id);
        if (!alloc) return null;
        return [fmtDateDisplay(e.date), e.activity || "", Number((alloc.minutes / 60).toFixed(2))];
      })
      .filter(Boolean);
    const sum = ccRows.reduce((s, r) => s + r[2], 0);
    const aoa = [["Datum", "Tätigkeit", "Stunden"], ...ccRows, [], ["", "Summe", Number(sum.toFixed(2))]];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 34 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(`${cc.code}`, usedNames));
  });

  // ---- Labor sheet ----
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
  const data = { entries, costCenters, exportedAt: new Date().toISOString() };
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
      saveEntries(entries);
      saveCostCenters(costCenters);
      renderAll(true);
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
  entries = []; costCenters = []; timer = { status: "idle" };
  saveEntries(entries); saveCostCenters(costCenters); saveTimer(timer);
  renderAll(true);
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
  if (id === "view-export") renderExportStats();
}

function renderAll() {
  renderTodaySummary();
  renderEntries();
  renderCostCenters();
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
    flow.draft.laborMinutes = parseFloat(document.getElementById("alloc-labor-minutes").value) || 0;
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

  document.getElementById("btn-export").addEventListener("click", exportExcel);
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
  renderTodaySummary();
  renderEntries();
  renderCostCenters();
  renderExportStats();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
