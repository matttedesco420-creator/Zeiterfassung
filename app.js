"use strict";

/* =========================================================
   Storage keys & palette
   ========================================================= */
const K = {
  entries: "azt_entries_v1",
  costCenters: "azt_costcenters_v1",
  projects: "azt_projects_v1",
  profile: "azt_profile_v1",
  vacations: "azt_vacations_v1",
  labs: "azt_labs_v1",
  contracts: "azt_contracts_v1",
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
const LAB_PALETTE = [
  "#2F7A64", "#3E7B8C", "#7A6B3F", "#6E4C7A",
  "#8C5A3C", "#4A7A4E", "#5A5F8C", "#8C4A5E",
];

/* =========================================================
   Small helpers
   ========================================================= */
/* Muss ein echtes UUID sein: die Supabase-Spalten sind vom Typ uuid.
   Frühere Versionen erzeugten Kurz-IDs, wodurch das Speichern serverseitig fehlschlug. */
function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback für ältere Browser
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === "string" && UUID_RE.test(v); }
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
/* Eingabe erfolgt in Dezimalstunden (z. B. "2,5" = 2 h 30 min).
   Intern rechnen wir weiterhin in Minuten. Komma und Punkt sind beide erlaubt. */
function parseHoursInput(value) {
  if (value === null || value === undefined) return 0;
  const n = parseFloat(String(value).trim().replace(",", "."));
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.round(n * 60);
}
function minutesToHoursInput(minutes) {
  if (!minutes || minutes <= 0) return "";
  return (minutes / 60)
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
    .replace(".", ",");
}

/* Baut eine Zuteilungszeile: Name, darunter Prozent-Schnellwahl und Stundenfeld.
   Die Prozente beziehen sich auf die Gesamtarbeitszeit des Eintrags. */
function allocRowHTML({ color, label, attr, id, value, extraAttr = "" }) {
  return `
    <div class="alloc-row">
      <span class="alloc-swatch" style="background:${color};"></span>
      <span class="alloc-name">${label}</span>
    </div>
    <div class="alloc-controls">
      <div class="pct-group">
        <button type="button" class="pct-btn" data-pct="-25" data-for="${id}">-25%</button>
        <button type="button" class="pct-btn" data-pct="-10" data-for="${id}">-10%</button>
        <button type="button" class="pct-btn" data-pct="10" data-for="${id}">+10%</button>
        <button type="button" class="pct-btn" data-pct="25" data-for="${id}">+25%</button>
      </div>
      <div class="alloc-input">
        <input type="text" inputmode="decimal" placeholder="0"
          ${attr}="${id}" ${extraAttr} value="${value}" />
      </div>
      <span class="alloc-unit">h</span>
    </div>`;
}

/* Prozent-Buttons: addieren/subtrahieren einen Anteil der Gesamtarbeitszeit. */
function wirePercentButtons(container, onChange) {
  container.querySelectorAll(".pct-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.for;
      const input = container.querySelector(
        `[data-cc-id="${id}"], [data-project-id="${id}"], [data-lab-id="${id}"]`
      );
      if (!input) return;
      const total = flow.draft.totalMinutes || 0;
      if (total <= 0) return;
      /* In Prozentschritten rechnen statt gerundete Minuten aufzuaddieren: sonst
         summieren sich Rundungsfehler (4 x +25% ergäbe bei 7,5 h nicht exakt 7,5 h). */
      const currentPct = Math.round((parseHoursInput(input.value) / total) * 100);
      const nextPct = Math.max(0, currentPct + Number(btn.dataset.pct));
      input.value = minutesToHoursInput(Math.round((total * nextPct) / 100));
      onChange();
    });
  });
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

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(K.profile));
    if (p) return { firstName: "", lastName: "", weeklyHours: null, vacationDaysPerYear: null, ...p };
  } catch { /* fall through */ }
  // Migration: if an old single "employee name" value exists from an earlier version, split it once.
  const legacy = localStorage.getItem("azt_employeename_v1");
  if (legacy) {
    const parts = legacy.trim().split(/\s+/);
    const migrated = {
      firstName: parts.slice(0, -1).join(" ") || parts[0] || "",
      lastName: parts.length > 1 ? parts[parts.length - 1] : "",
      weeklyHours: null, vacationDaysPerYear: null,
    };
    saveProfile(migrated);
    return migrated;
  }
  return { firstName: "", lastName: "", weeklyHours: null, vacationDaysPerYear: null };
}
function saveProfile(p) { localStorage.setItem(K.profile, JSON.stringify(p)); }

function loadVacations() {
  try { return JSON.parse(localStorage.getItem(K.vacations)) || []; }
  catch { return []; }
}
function saveVacations(list) { localStorage.setItem(K.vacations, JSON.stringify(list)); }

function loadLabs() {
  try { return JSON.parse(localStorage.getItem(K.labs)) || []; }
  catch { return []; }
}
function saveLabs(list) { localStorage.setItem(K.labs, JSON.stringify(list)); }

function loadContracts() {
  try { return JSON.parse(localStorage.getItem(K.contracts)) || []; }
  catch { return []; }
}
function saveContracts(list) { localStorage.setItem(K.contracts, JSON.stringify(list)); }

/* Wochenstunden für einen konkreten Monat: der zugeordnete Vertrag gewinnt,
   sonst der Wert aus den Profildaten (Rückfallebene). */
function weeklyHoursForMonth(year, monthIndex) {
  const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const contract = contracts.find((c) => (c.months || []).includes(key));
  return contract && contract.weeklyHours != null ? Number(contract.weeklyHours) : 0;
}
/* Tagesstunden eines Monats (Arbeitswoche Mo–Fr). */
function dailyHoursForMonth(year, monthIndex) {
  return weeklyHoursForMonth(year, monthIndex) / 5;
}
function dailyHoursForDate(dateISO) {
  return dailyHoursForMonth(Number(dateISO.slice(0, 4)), Number(dateISO.slice(5, 7)) - 1);
}

/* Urlaubs-Soll pro Monat = Wochenstunden x 5/12 (entspricht 25 Urlaubstagen im Jahr). */
function monthlyVacationHours(year, monthIndex) {
  return Number(((weeklyHoursForMonth(year, monthIndex) * 5) / 12).toFixed(2));
}

/* Returns every ISO date between start and end (inclusive), weekends excluded. */
function vacationWeekdaysInRange(startISO, endISO) {
  const out = [];
  const [sy, sm, sd] = startISO.split("-").map(Number);
  const [ey, em, ed] = endISO.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/* Set of all ISO dates covered by any saved vacation range (weekdays only). */
function vacationDateSet() {
  const set = new Set();
  vacations.forEach((v) => vacationWeekdaysInRange(v.startDate, v.endDate).forEach((d) => set.add(d)));
  return set;
}

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
let profile = loadProfile();
let vacations = loadVacations();
let labs = loadLabs();
let contracts = loadContracts();

/* Einmalige Migration: Frühere Versionen vergaben Kurz-IDs (z. B. "m2x1k3f9abc").
   Supabase erwartet echte UUIDs, weshalb das Hochladen fehlschlug. Wir vergeben neue
   UUIDs und schreiben ALLE Verweise (Zuteilungen) entsprechend um. */
function migrateLegacyIds() {
  const idMap = new Map();
  const remap = (list) => list.forEach((item) => {
    if (!isUuid(item.id)) {
      const fresh = uid();
      idMap.set(item.id, fresh);
      item.id = fresh;
    }
  });
  remap(costCenters);
  remap(projects);
  remap(labs);
  remap(contracts);
  remap(vacations);
  remap(entries);

  if (idMap.size === 0) return false;

  projects.forEach((p) => {
    if (idMap.has(p.costCenterId)) p.costCenterId = idMap.get(p.costCenterId);
  });
  entries.forEach((e) => {
    (e.allocations || []).forEach((a) => {
      if (idMap.has(a.costCenterId)) a.costCenterId = idMap.get(a.costCenterId);
    });
    (e.projectAllocations || []).forEach((a) => {
      if (idMap.has(a.projectId)) a.projectId = idMap.get(a.projectId);
    });
    (e.laborAllocations || []).forEach((a) => {
      if (idMap.has(a.labId)) a.labId = idMap.get(a.labId);
    });
  });

  saveCostCenters(costCenters);
  saveProjects(projects);
  saveLabs(labs);
  saveContracts(contracts);
  saveVacations(vacations);
  saveEntries(entries);
  return true;
}
const hadLegacyIds = migrateLegacyIds();
let tickHandle = null;

let flow = { mode: null, editingId: null, draft: null }; // shared draft used by the two sheets

/* =========================================================
   SUPABASE SYNC LAYER (optional — only active if config.js has
   real credentials; otherwise the app stays purely local, exactly
   as before).
   ========================================================= */
const APP_VERSION = "v31 (Laborblock-Fix)";

const SB = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.anonKey)
  ? supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

let currentUser = null;
let realtimeChannel = null;
let appInitialized = false;
let authMode = "login";
let pendingRetries = [];

function queueRetry(fn) { pendingRetries.push(fn); }

/* Speicherfehler dürfen nicht stillschweigend passieren: sonst denkt man, alles sei
   gespeichert, während serverseitig nichts ankommt. */
function reportSyncError(what, error) {
  console.error(`Sync-Fehler (${what}):`, error);
  const msg = error && error.message ? error.message : String(error);
  toast(`„${what}" nicht synchronisiert: ${msg.slice(0, 80)}`);
}
async function flushRetries() {
  if (!navigator.onLine || pendingRetries.length === 0) return;
  const jobs = pendingRetries;
  pendingRetries = [];
  for (const job of jobs) {
    try { await job(); } catch { pendingRetries.push(job); }
  }
}
function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

/* ---- row <-> app-object mappers ---- */
function rowToCostCenter(row) {
  return { id: row.id, code: row.code, name: row.name, colorIndex: row.color_index };
}
function costCenterToRow(cc) {
  return { id: cc.id, user_id: currentUser.id, code: cc.code, name: cc.name, color_index: cc.colorIndex };
}
function rowToProject(row) {
  return { id: row.id, code: row.code, name: row.name, colorIndex: row.color_index, costCenterId: row.cost_center_id };
}
function projectToRow(pr) {
  return { id: pr.id, user_id: currentUser.id, code: pr.code, name: pr.name, color_index: pr.colorIndex, cost_center_id: pr.costCenterId || null };
}
function rowToEntry(row) {
  return {
    id: row.id, date: row.date, start: row.start, end: row.end,
    pauseStart: row.pause_start, pauseEnd: row.pause_end, activity: row.activity,
    totalMinutes: row.total_minutes, allocations: row.allocations || [],
    projectAllocations: row.project_allocations || [],
    laborAllocations: row.labor_allocations || [], laborMinutes: row.labor_minutes,
    source: row.source,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}
function entryToRow(e) {
  return {
    id: e.id, user_id: currentUser.id, date: e.date, start: e.start, end: e.end,
    pause_start: e.pauseStart, pause_end: e.pauseEnd, activity: e.activity || null,
    total_minutes: e.totalMinutes, allocations: e.allocations || [],
    project_allocations: e.projectAllocations || [],
    labor_allocations: e.laborAllocations || [], labor_minutes: e.laborMinutes,
    source: e.source, updated_at: new Date().toISOString(),
  };
}

/* ---- push/delete helpers (fire-and-forget, queue on failure) ---- */
async function pushCostCenter(cc) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("cost_centers").upsert(costCenterToRow(cc));
  if (error) { reportSyncError("Kostenstelle", error); queueRetry(() => pushCostCenter(cc)); }
}
async function deleteCostCenterRemote(id) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("cost_centers").delete().eq("id", id);
  if (error) queueRetry(() => deleteCostCenterRemote(id));
}
async function pushProject(pr) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("projects").upsert(projectToRow(pr));
  if (error) { reportSyncError("Projekt", error); queueRetry(() => pushProject(pr)); }
}
async function deleteProjectRemote(id) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("projects").delete().eq("id", id);
  if (error) queueRetry(() => deleteProjectRemote(id));
}
async function pushEntry(entry) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("entries").upsert(entryToRow(entry));
  if (error) { reportSyncError("Eintrag", error); queueRetry(() => pushEntry(entry)); }
}
async function pushLab(lab) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("labs").upsert({
    id: lab.id, user_id: currentUser.id, code: lab.code, name: lab.name, color_index: lab.colorIndex,
  });
  if (error) { reportSyncError("Labor", error); queueRetry(() => pushLab(lab)); }
}
async function deleteLabRemote(id) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("labs").delete().eq("id", id);
  if (error) queueRetry(() => deleteLabRemote(id));
}
async function pushContract(c) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("contracts").upsert({
    id: c.id, user_id: currentUser.id, name: c.name,
    weekly_hours: c.weeklyHours, months: c.months || [],
  });
  if (error) { reportSyncError("Vertrag", error); queueRetry(() => pushContract(c)); }
}
async function deleteContractRemote(id) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("contracts").delete().eq("id", id);
  if (error) queueRetry(() => deleteContractRemote(id));
}
async function pushVacation(v) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("vacations").upsert({
    id: v.id, user_id: currentUser.id, start_date: v.startDate, end_date: v.endDate,
  });
  if (error) { reportSyncError("Urlaub", error); queueRetry(() => pushVacation(v)); }
}
async function deleteVacationRemote(id) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("vacations").delete().eq("id", id);
  if (error) queueRetry(() => deleteVacationRemote(id));
}
async function deleteEntryRemote(id) {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("entries").delete().eq("id", id);
  if (error) queueRetry(() => deleteEntryRemote(id));
}
async function pushTimerState() {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("settings").upsert({ user_id: currentUser.id, timer_state: timer });
  if (error) queueRetry(pushTimerState);
}
const pushProfileDebounced = debounce(async (p) => {
  if (!SB || !currentUser) return;
  const { error } = await SB.from("settings").upsert({
    user_id: currentUser.id,
    first_name: p.firstName || null,
    last_name: p.lastName || null,
    weekly_hours: p.weeklyHours,
    vacation_days_per_year: p.vacationDaysPerYear,
  });
  if (error) queueRetry(() => pushProfileDebounced(p));
}, 800);

async function bulkReplaceRemote() {
  if (!SB || !currentUser) return;
  const check = (label, res) => {
    if (res && res.error) { reportSyncError(label, res.error); throw res.error; }
    return res;
  };
  check("Einträge löschen", await SB.from("entries").delete().eq("user_id", currentUser.id));
  check("Kostenstellen löschen", await SB.from("cost_centers").delete().eq("user_id", currentUser.id));
  check("Projekte löschen", await SB.from("projects").delete().eq("user_id", currentUser.id));
  check("Urlaub löschen", await SB.from("vacations").delete().eq("user_id", currentUser.id));
  check("Labore löschen", await SB.from("labs").delete().eq("user_id", currentUser.id));
  if (costCenters.length) check("Kostenstellen speichern", await SB.from("cost_centers").insert(costCenters.map(costCenterToRow)));
  if (projects.length) check("Projekte speichern", await SB.from("projects").insert(projects.map(projectToRow)));
  if (labs.length) {
    check("Labore speichern", await SB.from("labs").insert(labs.map((l) => ({
      id: l.id, user_id: currentUser.id, code: l.code, name: l.name, color_index: l.colorIndex,
    }))));
  }
  if (entries.length) check("Einträge speichern", await SB.from("entries").insert(entries.map(entryToRow)));
  if (contracts.length) {
    await SB.from("contracts").insert(contracts.map((c) => ({
      id: c.id, user_id: currentUser.id, name: c.name,
      weekly_hours: c.weeklyHours, months: c.months || [],
    })));
  }
  if (vacations.length) {
    check("Urlaub speichern", await SB.from("vacations").insert(vacations.map((v) => ({
      id: v.id, user_id: currentUser.id, start_date: v.startDate, end_date: v.endDate,
    }))));
  }
}

/* Prüft die Verbindung Schritt für Schritt und liefert einen lesbaren Bericht.
   Damit lässt sich ohne Entwicklerwerkzeuge feststellen, wo es klemmt. */
async function runDiagnostics() {
  const lines = [];
  lines.push(`App-Version: ${APP_VERSION}`);
  if (!SB) {
    lines.push("FEHLER: Supabase ist nicht konfiguriert (config.js leer oder nicht geladen).");
    return lines.join("\n");
  }
  try {
    lines.push(`Projekt: ${new URL(window.SUPABASE_CONFIG.url).host}`);
  } catch {
    lines.push(`FEHLER: URL ungültig: "${window.SUPABASE_CONFIG.url}"`);
  }
  const { data: { session } } = await SB.auth.getSession();
  if (!session) { lines.push("FEHLER: Nicht angemeldet."); return lines.join("\n"); }
  lines.push(`Angemeldet: ${session.user.email}`);
  lines.push(`Benutzer-ID: ${session.user.id}`);

  const tables = ["cost_centers", "projects", "labs", "contracts", "entries", "vacations", "settings"];
  for (const t of tables) {
    const res = await SB.from(t).select("*", { count: "exact", head: true });
    if (res.error) lines.push(`Tabelle ${t}: FEHLER – ${res.error.message}`);
    else lines.push(`Tabelle ${t}: OK (${res.count ?? 0} Zeilen)`);
  }

  // Schreibtest: anlegen, wieder lesen, wieder löschen
  const testId = uid();
  const ins = await SB.from("cost_centers").insert({
    id: testId, user_id: session.user.id, code: "TEST", name: "Diagnose", color_index: 0,
  });
  if (ins.error) {
    lines.push(`Schreibtest: FEHLGESCHLAGEN – ${ins.error.message}`);
    if (ins.error.hint) lines.push(`Hinweis: ${ins.error.hint}`);
  } else {
    const back = await SB.from("cost_centers").select("*").eq("id", testId).maybeSingle();
    lines.push(back.data ? "Schreibtest: OK (gespeichert und wieder gelesen)"
                         : "Schreibtest: geschrieben, aber nicht lesbar (RLS-Regel prüfen)");
    await SB.from("cost_centers").delete().eq("id", testId);
  }
  lines.push(`Lokal gespeichert: ${costCenters.length} Kostenstellen, ${projects.length} Projekte, ${labs.length} Labore, ${entries.length} Einträge`);
  lines.push(`Offene Sync-Vorgänge: ${pendingRetries.length}`);
  return lines.join("\n");
}

/* Bricht eine hängende Abfrage nach n Sekunden ab. Ohne das wartet Promise.all
   unbegrenzt – ein einziger langsamer Aufruf (z. B. beim Kaltstart eines pausierten
   Supabase-Projekts) ließ die App sonst mit leerer Seite stehen. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) =>
      setTimeout(() => resolve({ data: null, error: { message: `Zeitüberschreitung (${label})` } }), ms)
    ),
  ]);
}

async function fetchAllFromSupabase() {
  if (!SB || !currentUser) return;
  const T = 20000;
  const [ccRes, prRes, laRes, coRes, enRes, vaRes, stRes] = await Promise.all([
    withTimeout(SB.from("cost_centers").select("*").order("created_at"), T, "Kostenstellen"),
    withTimeout(SB.from("projects").select("*").order("created_at"), T, "Projekte"),
    withTimeout(SB.from("labs").select("*").order("created_at"), T, "Labore"),
    withTimeout(SB.from("contracts").select("*").order("created_at"), T, "Verträge"),
    withTimeout(SB.from("entries").select("*").order("date"), T, "Einträge"),
    withTimeout(SB.from("vacations").select("*").order("start_date"), T, "Urlaube"),
    withTimeout(SB.from("settings").select("*").eq("user_id", currentUser.id).maybeSingle(), T, "Profil"),
  ]);

  const failed = [ccRes, prRes, laRes, coRes, enRes, vaRes].filter((r) => r.error);
  if (failed.length) {
    console.error("Supabase-Ladefehler:", failed.map((r) => r.error));
    toast("Daten konnten nicht geladen werden – lokale Daten bleiben erhalten.");
    return; // Bei Fehlern NICHT die lokalen Daten überschreiben.
  }

  /* Wichtig: Der Schutz muss PRO TABELLE greifen. Prüft man nur "ist alles leer?",
     löscht eine einzelne leere Tabelle die lokalen Daten, sobald irgendeine andere
     Tabelle Inhalt hat – genau das ist vorher passiert (auch bei offener Seite,
     ausgelöst durch Realtime-Ereignisse). */
  let needsUpload = false;
  const adopt = (remoteRows, localList, mapFn, saveFn) => {
    if (remoteRows.length === 0 && localList.length > 0) {
      needsUpload = true;      // lokal vorhanden, serverseitig nicht -> hochladen
      return localList;        // lokale Daten behalten
    }
    const mapped = remoteRows.map(mapFn);
    saveFn(mapped);
    return mapped;
  };

  costCenters = adopt(ccRes.data, costCenters, rowToCostCenter, saveCostCenters);
  projects = adopt(prRes.data, projects, rowToProject, saveProjects);
  labs = adopt(laRes.data, labs,
    (r) => ({ id: r.id, code: r.code, name: r.name, colorIndex: r.color_index }), saveLabs);
  contracts = adopt(coRes.data, contracts,
    (r) => ({ id: r.id, name: r.name, weeklyHours: r.weekly_hours, months: r.months || [] }),
    saveContracts);
  entries = adopt(enRes.data, entries, rowToEntry, saveEntries);
  vacations = adopt(vaRes.data, vacations,
    (r) => ({ id: r.id, startDate: r.start_date, endDate: r.end_date }), saveVacations);

  if (needsUpload) {
    try { await bulkReplaceRemote(); }
    catch (err) { reportSyncError("Datenübernahme", err); }
  }

  if (stRes.data) {
    profile = {
      firstName: stRes.data.first_name || "",
      lastName: stRes.data.last_name || "",
      weeklyHours: stRes.data.weekly_hours ?? null,
      vacationDaysPerYear: stRes.data.vacation_days_per_year ?? null,
    };
    saveProfile(profile);
    if (stRes.data.timer_state) { timer = stRes.data.timer_state; saveTimer(timer); }
  }
}

function subscribeRealtime() {
  if (!SB || !currentUser || realtimeChannel) return;
  const filter = `user_id=eq.${currentUser.id}`;
  realtimeChannel = SB.channel("azt-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "entries", filter }, handleRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "cost_centers", filter }, handleRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter }, handleRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "vacations", filter }, handleRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "labs", filter }, handleRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "contracts", filter }, handleRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "settings", filter }, handleRemoteChange)
    .subscribe();
}
let remoteChangeDebounce = null;
function handleRemoteChange() {
  clearTimeout(remoteChangeDebounce);
  remoteChangeDebounce = setTimeout(async () => {
    await fetchAllFromSupabase();
    renderAll();
    renderTimer();
  }, 600);
}

/* ---- auth flow ---- */
function hideBootScreen() {
  const el = document.getElementById("boot-screen");
  if (el) el.style.display = "none";
}
function bootMessage(msg, showSkip) {
  const t = document.getElementById("boot-text");
  if (t) t.textContent = msg;
  const b = document.getElementById("btn-boot-skip");
  if (b && showSkip) b.style.display = "inline-flex";
}

async function initAuth() {
  wireAuthEvents();
  const diag = document.getElementById("auth-diag");
  try {
    const host = new URL(window.SUPABASE_CONFIG.url).host;
    diag.textContent = `${APP_VERSION} · verbunden mit ${host}`;
  } catch {
    diag.textContent = `${APP_VERSION} · Konfiguration unvollständig`;
  }
  // Falls der Start ungewöhnlich lange dauert (z. B. Supabase-Kaltstart), Hinweis zeigen.
  const slowHint = setTimeout(() => {
    bootMessage("Der Server antwortet gerade langsam. Das kann beim ersten Start "
      + "des Tages bis zu einer Minute dauern.", true);
  }, 6000);
  document.getElementById("btn-boot-skip").addEventListener("click", () => {
    hideBootScreen();
    document.getElementById("auth-gate").style.display = "flex";
  });

  let session = null;
  try {
    const res = await withTimeout(SB.auth.getSession(), 15000, "Sitzung");
    session = res && res.data ? res.data.session : null;
  } catch (err) {
    console.error("Sitzung konnte nicht geladen werden:", err);
  }
  clearTimeout(slowHint);

  if (session) {
    currentUser = session.user;
    await onLoggedIn();
  } else {
    hideBootScreen();
    document.getElementById("auth-gate").style.display = "flex";
  }
  SB.auth.onAuthStateChange((_event, sess) => {
    if (_event === "SIGNED_IN" && sess) {
      currentUser = sess.user;
      onLoggedIn();
    } else if (_event === "SIGNED_OUT") {
      location.reload();
    }
  });
  window.addEventListener("online", flushRetries);
}

async function onLoggedIn() {
  hideBootScreen();
  document.getElementById("auth-gate").style.display = "none";
  document.getElementById("app-shell").style.display = "";
  document.getElementById("btn-account").style.display = "flex";
  await fetchAllFromSupabase();
  if (hadLegacyIds) {
    // Diese Daten konnten früher nie hochgeladen werden (ungültige IDs) – jetzt nachholen.
    try {
      await bulkReplaceRemote();
      toast("Bestehende Daten wurden mit dem Konto synchronisiert.");
    } catch (err) {
      reportSyncError("Datenübernahme", err);
    }
  }
  dedupeGeneralProjects();
  ensureGeneralProjects();
  if (!appInitialized) { init(); appInitialized = true; }
  else { renderAll(); renderTimer(); renderTopbarDate(); }
  subscribeRealtime();
}

/* Prüft Schritt für Schritt, wo das Speichern scheitert, und zeigt die Original-Fehler an. */
async function runDiagnostics() {
  const out = document.getElementById("diagnose-output");
  const lines = [];
  const log = (s) => { lines.push(s); out.textContent = lines.join("\n"); };
  out.style.display = "block";
  out.textContent = "Teste …";

  log(`App-Version: ${APP_VERSION}`);

  if (!SB) {
    log("✗ Supabase ist NICHT konfiguriert (config.js leer oder nicht geladen).");
    log("→ url und anonKey in config.js eintragen, dann hart neu laden.");
    return;
  }
  log(`✓ Supabase konfiguriert: ${window.SUPABASE_CONFIG.url}`);

  const { data: sess } = await SB.auth.getSession();
  if (!sess || !sess.session) { log("✗ Nicht angemeldet."); return; }
  log(`✓ Angemeldet als ${sess.session.user.email}`);
  log(`  user_id: ${sess.session.user.id}`);

  const tables = ["cost_centers", "projects", "labs", "contracts", "entries", "vacations", "settings"];
  log("\n--- Tabellen lesen ---");
  const missing = [];
  for (const t of tables) {
    const { error, count } = await SB.from(t).select("*", { count: "exact", head: true });
    if (error) { log(`✗ ${t}: ${error.message}`); missing.push(t); }
    else log(`✓ ${t}: ${count} Zeile(n)`);
  }
  if (missing.length) {
    log(`\n→ Diese Tabellen fehlen oder sind gesperrt: ${missing.join(", ")}`);
    log("→ supabase-schema.sql im Supabase SQL Editor ausführen.");
  }

  log("\n--- Schreibtest (Kostenstelle) ---");
  const testId = uid();
  log(`Test-ID: ${testId}`);
  const insRes = await SB.from("cost_centers").insert({
    id: testId, user_id: sess.session.user.id,
    code: "TEST", name: "Diagnose-Test", color_index: 0,
  });
  if (insRes.error) {
    log(`✗ Schreiben fehlgeschlagen: ${insRes.error.message}`);
    if (insRes.error.details) log(`  Details: ${insRes.error.details}`);
    if (insRes.error.hint) log(`  Hinweis: ${insRes.error.hint}`);
    if (insRes.error.code) log(`  Code: ${insRes.error.code}`);
  } else {
    log("✓ Schreiben erfolgreich");
    const back = await SB.from("cost_centers").select("*").eq("id", testId).maybeSingle();
    log(back.data ? "✓ Zurücklesen erfolgreich" : `✗ Zurücklesen fehlgeschlagen: ${back.error && back.error.message}`);
    const del = await SB.from("cost_centers").delete().eq("id", testId);
    log(del.error ? `✗ Aufräumen fehlgeschlagen: ${del.error.message}` : "✓ Testzeile wieder gelöscht");
  }

  log("\n--- Lokale Daten ---");
  log(`Kostenstellen: ${costCenters.length}, Projekte: ${projects.length}, Labore: ${labs.length}`);
  log(`Verträge: ${contracts.length}`);
  log(`Einträge: ${entries.length}, Urlaube: ${vacations.length}`);
  log(`Offene Sync-Vorgänge: ${pendingRetries.length}`);
  log("\nFertig. Bitte diesen Text kopieren und schicken.");
}

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg; el.style.display = "block";
}
function showAuthInfo(msg) {
  const el = document.getElementById("auth-info");
  el.textContent = msg; el.style.display = "block";
}
function hideAuthMessages() {
  document.getElementById("auth-error").style.display = "none";
  document.getElementById("auth-info").style.display = "none";
}
function translateAuthError(msg) {
  if (/invalid login credentials/i.test(msg)) return "E-Mail oder Passwort ist falsch.";
  if (/already registered|already exists|user already/i.test(msg)) return "Für diese E-Mail existiert bereits ein Konto. Bitte anmelden.";
  if (/password.*(least|6|character)/i.test(msg)) return "Das Passwort muss mindestens 6 Zeichen haben.";
  return msg;
}

function wireAuthEvents() {
  document.getElementById("btn-auth-toggle").addEventListener("click", () => {
    authMode = authMode === "login" ? "signup" : "login";
    document.getElementById("btn-auth-submit").textContent = authMode === "login" ? "Anmelden" : "Konto erstellen";
    document.getElementById("btn-auth-toggle").textContent = authMode === "login" ? "Noch kein Konto? Registrieren" : "Schon ein Konto? Anmelden";
    document.getElementById("auth-sub").textContent = authMode === "login"
      ? "Melde dich an, um deine Zeiten auf allen Geräten zu synchronisieren."
      : "Erstelle ein Konto, um deine Zeiten auf allen Geräten zu synchronisieren.";
    hideAuthMessages();
  });

  document.getElementById("form-auth").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    hideAuthMessages();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const btn = document.getElementById("btn-auth-submit");
    btn.disabled = true;
    try {
      if (authMode === "login") {
        const { error } = await SB.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await SB.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user && !data.session) {
          showAuthInfo("Konto erstellt! Bitte bestätige deine E-Mail-Adresse über den zugeschickten Link und melde dich danach an.");
          authMode = "login";
          document.getElementById("btn-auth-submit").textContent = "Anmelden";
          document.getElementById("btn-auth-toggle").textContent = "Noch kein Konto? Registrieren";
        }
      }
    } catch (err) {
      const raw = err && (err.message || err.error_description) ? (err.message || err.error_description) : String(err);
      showAuthError(translateAuthError(raw));
      document.getElementById("auth-diag").textContent = `Technische Meldung: ${raw}`;
      console.error("Auth-Fehler:", err);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-account").addEventListener("click", () => {
    document.getElementById("account-email").textContent = currentUser ? currentUser.email : "–";
    document.getElementById("account-version").textContent =
      `App ${APP_VERSION}${SB ? "" : " · ohne Supabase (lokaler Modus)"}`;
    document.getElementById("account-sync-status").textContent = pendingRetries.length
      ? "Nicht alles synchronisiert – wird bei Internetverbindung automatisch nachgeholt."
      : "Alles synchronisiert.";
    showBackdrop("sheet-account-backdrop");
  });
  document.getElementById("btn-logout").addEventListener("click", async () => {
    if (!confirm("Wirklich abmelden?")) return;
    if (realtimeChannel) { SB.removeChannel(realtimeChannel); realtimeChannel = null; }
    await SB.auth.signOut();
  });
}

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
  pushTimerState();
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
  pushTimerState();
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
  pushTimerState();
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
  pushTimerState();

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
        ${entryActivitySummary(e) ? `<span>${escapeHtml(entryActivitySummary(e))}</span>` : ""}
      </div>
      ${(tags || projectTags || laborTag || unallocTag) ? `<div class="entry-tags">${tags}${projectTags}${laborTag}${unallocTag}</div>` : ""}
    </div>`;
}

/* Tätigkeiten werden jetzt je Projekt erfasst; für Listen/Übersichten fassen wir sie zusammen. */
function entryActivitySummary(e) {
  return (e.projectAllocations || [])
    .map((a) => (a.activity || "").trim())
    .filter(Boolean)
    .join("; ");
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
    totalMinutes: total,
  };

  closeTimesSheet();
  openAllocSheet();
}

function deleteCurrentEntry() {
  if (!flow.editingId) return;
  if (!confirm("Diesen Eintrag wirklich löschen?")) return;
  const idToDelete = flow.editingId;
  entries = entries.filter((e) => e.id !== idToDelete);
  saveEntries(entries);
  closeTimesSheet();
  renderAll();
  toast("Eintrag gelöscht.");
  deleteEntryRemote(idToDelete);
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
      return allocRowHTML({
        color,
        label: `${escapeHtml(cc.code)} — ${escapeHtml(cc.name)}`,
        attr: "data-cc-id",
        id: cc.id,
        value: existing ? minutesToHoursInput(existing.minutes) : "",
      });
    }).join("");
    const onCcChange = () => {
      updateAllocRemainingHint();
      renderAllocProjectRows();   // andere Kostenstelle -> andere Projektliste
    };
    let ccDebounce = null;
    rowsEl.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
      updateAllocRemainingHint();               // sofort, ohne Neuaufbau
      clearTimeout(ccDebounce);                 // Neuaufbau erst nach kurzer Pause,
      ccDebounce = setTimeout(onCcChange, 400); // damit das Tippen nicht stockt
    }));
    wirePercentButtons(rowsEl, onCcChange);
  }

  updateAllocRemainingHint();
  renderAllocProjectRows();
  showBackdrop("sheet-alloc-backdrop");
}

function closeAllocSheet() { hideBackdrop("sheet-alloc-backdrop"); }

function readAllocRows() {
  const rows = [];
  document.querySelectorAll("#alloc-costcenter-rows input[data-cc-id]").forEach((inp) => {
    const minutes = parseHoursInput(inp.value);
    if (minutes > 0) rows.push({ costCenterId: inp.dataset.ccId, minutes });
  });
  return rows;
}

function readProjectAllocRows() {
  const rows = [];
  document.querySelectorAll("#alloc-project-rows input[data-project-id]").forEach((inp) => {
    const minutes = parseHoursInput(inp.value);
    if (minutes > 0) {
      const actInput = document.querySelector(`#alloc-project-rows input[data-project-activity="${inp.dataset.projectId}"]`);
      rows.push({
        projectId: inp.dataset.projectId,
        minutes,
        activity: actInput ? actInput.value.trim() : "",
      });
    }
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
  const typedActivities = {};
  container.querySelectorAll("input[data-project-activity]").forEach((inp) => {
    typedActivities[inp.dataset.projectActivity] = inp.value;
  });
  const typedLabs = {};
  container.querySelectorAll("input[data-lab-of-project]").forEach((inp) => {
    typedLabs[`${inp.dataset.labOfProject}|${inp.dataset.labId}`] = inp.value;
  });

  const ccMinutes = {};
  document.querySelectorAll("#alloc-costcenter-rows input[data-cc-id]").forEach((inp) => {
    ccMinutes[inp.dataset.ccId] = parseHoursInput(inp.value);
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
      const value = typedValues[pr.id] !== undefined
        ? typedValues[pr.id]
        : (existing ? minutesToHoursInput(existing.minutes) : "");
      const activity = typedActivities[pr.id] !== undefined
        ? typedActivities[pr.id]
        : (existing ? (existing.activity || "") : "");
      const color = PROJECT_PALETTE[pr.colorIndex % PROJECT_PALETTE.length];
      const rowHtml = allocRowHTML({
        color,
        label: `${escapeHtml(pr.code)} — ${escapeHtml(pr.name)}`,
        attr: "data-project-id",
        id: pr.id,
        value,
        extraAttr: `data-parent-cc="${cc.id}"`,
      });

      /* Laborzeit gehört immer zu genau einem Projekt. Die Felder erscheinen deshalb
         unter dem jeweiligen Projekt – so lassen sich 5 h Labor beliebig aufteilen
         (z. B. 3 h auf Projekt A, 2 h auf Projekt B). */
      const hasHours = parseHoursInput(value) > 0;
      const labFields = labs.length === 0 ? "" : `
        <div class="alloc-lab-sub${hasHours ? "" : " is-hidden"}" data-lab-block="${pr.id}">
          <div class="alloc-lab-sub-title">davon im Labor</div>
          ${labs.map((lab) => {
            const key = `${pr.id}|${lab.id}`;
            const savedLab = (flow.draft.laborAllocations || [])
              .find((a) => a.labId === lab.id && a.projectId === pr.id);
            const labValue = typedLabs[key] !== undefined
              ? typedLabs[key]
              : (savedLab ? minutesToHoursInput(savedLab.minutes) : "");
            const labColor = LAB_PALETTE[lab.colorIndex % LAB_PALETTE.length];
            return `
              <div class="alloc-lab-line">
                <span class="alloc-swatch" style="background:${labColor};"></span>
                <span class="alloc-lab-name">${escapeHtml(lab.code)}</span>
                <input type="text" inputmode="decimal" placeholder="0"
                  data-lab-of-project="${pr.id}" data-lab-id="${lab.id}" value="${labValue}" />
                <span class="alloc-lab-unit">h</span>
              </div>`;
          }).join("")}
          <div class="hint" data-lab-sum="${pr.id}"></div>
        </div>`;

      return rowHtml + `
        <div class="alloc-activity">
          <input type="text" data-project-activity="${pr.id}"
            placeholder="Tätigkeit für ${escapeHtml(pr.code)} …" value="${escapeHtml(activity)}" />
        </div>` + labFields;
    }).join("");
    return `
      <div class="alloc-group-label" data-group-hint="${cc.id}">
        <span>${escapeHtml(cc.code)} — ${escapeHtml(cc.name)}</span>
        <span class="hint-inline"></span>
      </div>
      ${rowsHtml}`;
  }).join("");

  container.querySelectorAll("input[data-project-id]").forEach((inp) =>
    inp.addEventListener("input", () => {
      updateAllocGroupHints();
      // Nur ein-/ausblenden statt neu aufzubauen – sonst verliert das Feld beim
      // Tippen den Fokus und der zuletzt eingegebene Wert geht verloren.
      toggleLabBlocks();
      updateProjectLabSums();
    }));
  container.querySelectorAll("input[data-lab-of-project]").forEach((inp) =>
    inp.addEventListener("input", updateProjectLabSums));
  wirePercentButtons(container, () => {
    updateAllocGroupHints();
    toggleLabBlocks();
    updateProjectLabSums();
  });
  updateAllocGroupHints();
  toggleLabBlocks();
  updateProjectLabSums();
}

/* Blendet den Laborblock eines Projekts ein, sobald dieses Stunden hat. */
function toggleLabBlocks() {
  document.querySelectorAll("#alloc-project-rows [data-lab-block]").forEach((block) => {
    const prId = block.dataset.labBlock;
    const inp = document.querySelector(`#alloc-project-rows input[data-project-id="${prId}"]`);
    const hasHours = inp ? parseHoursInput(inp.value) > 0 : false;
    block.classList.toggle("is-hidden", !hasHours);
  });
}

/* Zeigt je Projekt, wie viel der Projektzeit im Labor verbracht wurde. */
function updateProjectLabSums() {
  document.querySelectorAll("#alloc-project-rows [data-lab-sum]").forEach((el) => {
    const prId = el.dataset.labSum;
    const labSum = Array.from(
      document.querySelectorAll(`#alloc-project-rows input[data-lab-of-project="${prId}"]`)
    ).reduce((sum, inp) => sum + parseHoursInput(inp.value), 0);
    const prInput = document.querySelector(`#alloc-project-rows input[data-project-id="${prId}"]`);
    const prMinutes = prInput ? parseHoursInput(prInput.value) : 0;

    if (labSum === 0) { el.textContent = ""; el.className = "hint"; return; }
    if (labSum > prMinutes) {
      el.textContent = `Laborzeit (${fmtHoursDecimal(labSum)} h) übersteigt die Projektzeit (${fmtHoursDecimal(prMinutes)} h).`;
      el.className = "hint warn";
    } else {
      el.textContent = `${fmtHoursDecimal(labSum)} h von ${fmtHoursDecimal(prMinutes)} h im Labor`;
      el.className = "hint ok";
    }
  });
}

function updateAllocGroupHints() {
  const ccMinutes = {};
  document.querySelectorAll("#alloc-costcenter-rows input[data-cc-id]").forEach((inp) => {
    ccMinutes[inp.dataset.ccId] = parseHoursInput(inp.value);
  });
  document.querySelectorAll("#alloc-project-rows [data-group-hint]").forEach((label) => {
    const ccId = label.dataset.groupHint;
    const ccTotal = ccMinutes[ccId] || 0;
    const allocated = Array.from(document.querySelectorAll(`#alloc-project-rows input[data-parent-cc="${ccId}"]`))
      .reduce((s, inp) => s + parseHoursInput(inp.value), 0);
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
  const laborAllocations = readLabAllocRows();
  const laborMinutes = laborAllocations.reduce((sum, a) => sum + a.minutes, 0);

  const entry = {
    id: flow.editingId || uid(),
    date: flow.draft.date,
    start: flow.draft.start,
    end: flow.draft.end,
    pauseStart: flow.draft.pauseStart,
    pauseEnd: flow.draft.pauseEnd,
    totalMinutes: flow.draft.totalMinutes,
    allocations, projectAllocations, laborAllocations, laborMinutes,
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
  pushEntry(entry);
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
      deleteCostCenterRemote(id);
    });
  });
}

function addCostCenter(code, name) {
  const cc = { id: uid(), code: code.toUpperCase(), name, colorIndex: costCenters.length };
  costCenters.push(cc);
  saveCostCenters(costCenters);
  pushCostCenter(cc);
  // Jede Kostenstelle bekommt automatisch ein Projekt "Allgemein" – dorthin läuft alles,
  // was keinem konkreten Projekt zuzuordnen ist (auch Laborzeit).
  addProject("ALLG", "Allgemein", cc.id);
  renderCostCenters();
}

/* Ergänzt fehlende "Allgemein"-Projekte bei bereits bestehenden Kostenstellen. */
function isGeneralProject(p) {
  const code = (p.code || "").replace(/[^a-z]/gi, "").toUpperCase();
  const name = (p.name || "").trim().toLowerCase();
  return code === "ALLG" || code === "ALLGEMEIN" || name === "allgemein";
}

/* Entfernt doppelte "Allgemein"-Projekte je Kostenstelle, die durch unterschiedliche
   Schreibweisen (z. B. "ALLG." vs. "ALLG") entstanden sind. Behalten wird das ältere;
   bereits erfasste Zeiten werden auf dieses umgehängt, damit nichts verloren geht. */
function dedupeGeneralProjects() {
  let changed = false;
  costCenters.forEach((cc) => {
    const generals = projects.filter((p) => p.costCenterId === cc.id && isGeneralProject(p));
    if (generals.length < 2) return;
    const keep = generals[0];
    generals.slice(1).forEach((dup) => {
      entries.forEach((e) => {
        (e.projectAllocations || []).forEach((a) => {
          if (a.projectId === dup.id) a.projectId = keep.id;
        });
        (e.laborAllocations || []).forEach((a) => {
          if (a.projectId === dup.id) a.projectId = keep.id;
        });
      });
      projects = projects.filter((p) => p.id !== dup.id);
      deleteProjectRemote(dup.id);
      changed = true;
    });
  });
  if (changed) {
    saveProjects(projects);
    saveEntries(entries);
    entries.forEach((e) => pushEntry(e));
  }
  return changed;
}

function ensureGeneralProjects() {
  let added = false;
  costCenters.forEach((cc) => {
    const hasGeneral = projects.some((p) => p.costCenterId === cc.id && isGeneralProject(p));
    if (!hasGeneral) {
      projects.push({
        id: uid(), code: "ALLG", name: "Allgemein",
        costCenterId: cc.id, colorIndex: projects.length,
      });
      added = true;
    }
  });
  if (added) {
    saveProjects(projects);
    projects.filter((p) => p.code === "ALLG").forEach((p) => pushProject(p));
  }
  return added;
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
      pushProject(pr);
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
      deleteProjectRemote(id);
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
  const pr = { id: uid(), code: code.toUpperCase(), name, costCenterId, colorIndex: projects.length };
  projects.push(pr);
  saveProjects(projects);
  renderProjects();
  pushProject(pr);
}

/* Liest die Laborzeiten aus den Feldern, die unter dem jeweiligen Projekt stehen.
   Schlüssel ist also das Paar Projekt + Labor – dadurch lassen sich die Stunden eines
   Labors auf mehrere Projekte aufteilen. */
function readLabAllocRows() {
  const rows = [];
  document.querySelectorAll("#alloc-project-rows input[data-lab-of-project]").forEach((inp) => {
    const minutes = parseHoursInput(inp.value);
    if (minutes > 0) {
      rows.push({
        labId: inp.dataset.labId,
        minutes,
        projectId: inp.dataset.labOfProject,
      });
    }
  });
  return rows;
}

/* =========================================================
   LABS management (independent of cost centers and projects)
   ========================================================= */
function renderLabs() {
  const container = document.getElementById("lab-list");
  if (labs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🧪</div>
        <p>Noch keine Labore angelegt.</p>
      </div>`;
    return;
  }
  container.innerHTML = labs.map((lab) => {
    const color = LAB_PALETTE[lab.colorIndex % LAB_PALETTE.length];
    return `
      <div class="cc-row">
        <span class="cc-swatch" style="background:${color};"></span>
        <div class="cc-info">
          <div class="cc-code">${escapeHtml(lab.code)}</div>
          <div class="cc-name">${escapeHtml(lab.name)}</div>
        </div>
        <button class="cc-del" data-lab-id="${lab.id}" aria-label="Löschen">✕</button>
      </div>`;
  }).join("");

  container.querySelectorAll(".cc-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.labId;
      const lab = labs.find((l) => l.id === id);
      const usedIn = entries.filter((e) => (e.laborAllocations || []).some((a) => a.labId === id)).length;
      const msg = usedIn > 0
        ? `„${lab.code}" wird in ${usedIn} Eintrag/Einträgen verwendet. Trotzdem löschen? Die Zuordnung geht dabei verloren.`
        : `Labor „${lab.code}" löschen?`;
      if (!confirm(msg)) return;
      labs = labs.filter((l) => l.id !== id);
      saveLabs(labs);
      saveContracts(contracts);
      renderAll();
      toast("Labor gelöscht.");
      deleteLabRemote(id);
    });
  });
}

function addLab(code, name) {
  const lab = { id: uid(), code: code.toUpperCase(), name, colorIndex: labs.length };
  labs.push(lab);
  saveLabs(labs);
  renderLabs();
  pushLab(lab);
}

/* =========================================================
   CONTRACTS (Wochenstunden je Monat)
   ========================================================= */
let contractMonthSelection = new Set();

function contractYears() {
  const now = new Date().getFullYear();
  const years = new Set([now - 1, now, now + 1]);
  entries.forEach((e) => years.add(Number(e.date.slice(0, 4))));
  contracts.forEach((c) => (c.months || []).forEach((m) => years.add(Number(m.slice(0, 4)))));
  return [...years].sort();
}

function renderContractYearSelect() {
  const sel = document.getElementById("contract-year");
  const prev = sel.value || String(new Date().getFullYear());
  sel.innerHTML = contractYears().map((y) => `<option value="${y}">${y}</option>`).join("");
  sel.value = contractYears().includes(Number(prev)) ? prev : String(new Date().getFullYear());
}

function renderContractMonthGrid() {
  const grid = document.getElementById("contract-months");
  const year = document.getElementById("contract-year").value;
  grid.innerHTML = MONTHS_AT.map((m, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    const takenBy = contracts.find((c) => (c.months || []).includes(key));
    const classes = ["month-chip"];
    if (contractMonthSelection.has(key)) classes.push("selected");
    if (takenBy) classes.push("taken");
    return `<button type="button" class="${classes.join(" ")}" data-month="${key}"
      title="${takenBy ? "bereits: " + escapeHtml(takenBy.name) : ""}">${m.short}</button>`;
  }).join("");

  grid.querySelectorAll(".month-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.dataset.month;
      if (contractMonthSelection.has(key)) contractMonthSelection.delete(key);
      else contractMonthSelection.add(key);
      renderContractMonthGrid();
    });
  });
}

function renderContracts() {
  renderContractYearSelect();
  renderContractMonthGrid();
  const container = document.getElementById("contract-list");
  if (contracts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📄</div>
        <p>Noch kein Vertrag angelegt.</p>
      </div>`;
    return;
  }
  container.innerHTML = contracts.map((c) => {
    const months = (c.months || []).slice().sort();
    const label = months.length === 0 ? "keine Monate zugeordnet" : months
      .map((m) => `${MONTHS_AT[Number(m.slice(5, 7)) - 1].short} ${m.slice(0, 4)}`)
      .join(", ");
    const vac = ((Number(c.weeklyHours) * 5) / 12).toFixed(2).replace(".", ",");
    return `
      <div class="cc-row" style="align-items:flex-start;">
        <span class="cc-swatch" style="background:var(--brass); margin-top:4px;"></span>
        <div class="cc-info">
          <div class="cc-code">${escapeHtml(c.name)} · ${String(c.weeklyHours).replace(".", ",")} h/Woche</div>
          <div class="contract-months">${escapeHtml(label)}</div>
          <div class="contract-months">Urlaub: ${vac} h pro Monat</div>
        </div>
        <button class="cc-del" data-contract-id="${c.id}" aria-label="Löschen">✕</button>
      </div>`;
  }).join("");

  container.querySelectorAll(".cc-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.contractId;
      const c = contracts.find((x) => x.id === id);
      if (!confirm(`Vertrag „${c.name}" löschen?`)) return;
      contracts = contracts.filter((x) => x.id !== id);
      saveContracts(contracts);
      renderContracts();
      renderVacationOverview();
      toast("Vertrag gelöscht.");
      deleteContractRemote(id);
    });
  });
}

function addContract(name, weeklyHours, months) {
  // Ein Monat kann nur zu einem Vertrag gehören – bei Überschneidung gewinnt der neue.
  contracts.forEach((c) => {
    c.months = (c.months || []).filter((m) => !months.includes(m));
  });
  const contract = { id: uid(), name, weeklyHours, months };
  contracts.push(contract);
  saveContracts(contracts);
  contracts.forEach((c) => pushContract(c));
  renderContracts();
}

/* Monatsübersicht: Arbeitsstunden (Soll/Ist) und Urlaub (Anspruch/genommen),
   jeweils auf Basis des für den Monat hinterlegten Vertrags. */
function renderVacationOverview() {
  const sel = document.getElementById("vac-overview-year");
  if (sel.options.length === 0 || sel.dataset.years !== contractYears().join(",")) {
    const prev = sel.value || String(new Date().getFullYear());
    sel.innerHTML = contractYears().map((y) => `<option value="${y}">${y}</option>`).join("");
    sel.value = contractYears().includes(Number(prev)) ? prev : String(new Date().getFullYear());
    sel.dataset.years = contractYears().join(",");
  }
  const year = Number(sel.value);
  const taken = vacationDateSet();

  let sumSoll = 0, sumIst = 0, sumVacSoll = 0, sumVacIst = 0;
  const rows = MONTHS_AT.map((m, i) => {
    const daily = dailyHoursForMonth(year, i);
    const prefix = `${year}-${String(i + 1).padStart(2, "0")}`;

    // Soll = Werktage des Monats x Tagesstunden laut Vertrag
    const daysInMonth = new Date(year, i + 1, 0).getDate();
    let weekdays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, i, d).getDay();
      if (dow !== 0 && dow !== 6) weekdays++;
    }
    const soll = Number((weekdays * daily).toFixed(2));

    // Ist = tatsächlich erfasste Arbeitszeit dieses Monats
    const istMin = entries
      .filter((e) => e.date.startsWith(prefix))
      .reduce((s, e) => s + e.totalMinutes, 0);
    const ist = Number((istMin / 60).toFixed(2));

    const vacSoll = monthlyVacationHours(year, i);
    const vacDays = [...taken].filter((d) => d.startsWith(prefix)).length;
    const vacIst = Number((vacDays * daily).toFixed(2));

    sumSoll += soll; sumIst += ist; sumVacSoll += vacSoll; sumVacIst += vacIst;

    const contract = contracts.find((c) => (c.months || []).includes(prefix));
    const diff = ist - soll;
    const istClass = soll > 0 && Math.abs(diff) > 0.01 ? (diff > 0 ? "over" : "under") : "";

    return `
      <div class="vac-row">
        <span class="vac-month">
          ${m.short}
          <em>${contract ? escapeHtml(contract.name) : "kein Vertrag"}</em>
        </span>
        <span class="vac-num ${istClass}">${ist ? fmtHoursDecimal(ist * 60) : "–"}</span>
        <span class="vac-num vac-sep">${soll ? fmtHoursDecimal(soll * 60) : "–"}</span>
        <span class="vac-num ${vacIst > 0 ? "used" : ""}">${vacIst ? fmtHoursDecimal(vacIst * 60) : "–"}</span>
        <span class="vac-num">${vacSoll ? fmtHoursDecimal(vacSoll * 60) : "–"}</span>
      </div>`;
  }).join("");

  document.getElementById("vacation-overview").innerHTML = `
    <div class="vac-table">
      <div class="vac-row vac-group">
        <span class="vac-month"></span>
        <span class="vac-group-label">Arbeits h</span>
        <span class="vac-group-label">Urlaub h</span>
      </div>
      <div class="vac-row vac-head">
        <span class="vac-month">Monat</span>
        <span class="vac-num">ist</span>
        <span class="vac-num vac-sep">soll</span>
        <span class="vac-num">ist</span>
        <span class="vac-num">soll</span>
      </div>
      ${rows}
      <div class="vac-row vac-total">
        <span class="vac-month">Σ ${year}</span>
        <span class="vac-num">${fmtHoursDecimal(sumIst * 60)}</span>
        <span class="vac-num vac-sep">${fmtHoursDecimal(sumSoll * 60)}</span>
        <span class="vac-num">${fmtHoursDecimal(sumVacIst * 60)}</span>
        <span class="vac-num">${fmtHoursDecimal(sumVacSoll * 60)}</span>
      </div>
    </div>
    <p class="hint" style="margin-top:8px;">
      Soll = Werktage × Tagesstunden laut Vertrag, Ist = erfasste Arbeitszeit.
      <span class="legend-under">Grün</span> = unter dem Soll,
      <span class="legend-over">rot</span> = darüber.
    </p>`;
}

/* =========================================================
   VACATION view
   ========================================================= */
function renderVacations() {
  const container = document.getElementById("vacation-list");
  if (vacations.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🌴</div>
        <p>Noch kein Urlaub eingetragen.</p>
      </div>`;
    return;
  }

  // Genommene Stunden je Monat über ALLE Urlaube – Basis für den Restanspruch.
  const takenByMonth = {};
  vacations.forEach((v) => {
    vacationWeekdaysInRange(v.startDate, v.endDate).forEach((d) => {
      const key = d.slice(0, 7);
      takenByMonth[key] = (takenByMonth[key] || 0) + dailyHoursForDate(d);
    });
  });

  const sorted = [...vacations].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  container.innerHTML = sorted.map((v) => {
    const days = vacationWeekdaysInRange(v.startDate, v.endDate);
    const hours = days.reduce((sum, d) => sum + dailyHoursForDate(d), 0);
    const sameDay = v.startDate === v.endDate;

    // Ein Zeitraum kann über Monatsgrenzen gehen – Restanspruch je betroffenem Monat.
    const monthsTouched = [...new Set(days.map((d) => d.slice(0, 7)))];
    const remainingLines = monthsTouched.map((key) => {
      const y = Number(key.slice(0, 4)), mi = Number(key.slice(5, 7)) - 1;
      const entitlement = monthlyVacationHours(y, mi);
      if (entitlement <= 0) {
        return `${MONTHS_AT[mi].short} ${y}: kein Vertrag hinterlegt`;
      }
      const rest = entitlement - (takenByMonth[key] || 0);
      const restTxt = rest < 0
        ? `${fmtHoursDecimal(-rest * 60)} h über dem Anspruch`
        : `noch ${fmtHoursDecimal(rest * 60)} h frei`;
      return `${MONTHS_AT[mi].short} ${y}: ${restTxt} von ${fmtHoursDecimal(entitlement * 60)} h`;
    });

    return `
      <div class="cc-row" style="align-items:flex-start;">
        <span class="cc-swatch" style="background:var(--teal); margin-top:4px;"></span>
        <div class="cc-info">
          <div class="cc-code">${sameDay ? fmtDatePlain(v.startDate) : `${fmtDatePlain(v.startDate)} – ${fmtDatePlain(v.endDate)}`}</div>
          <div class="cc-name">${days.length} Werktag${days.length === 1 ? "" : "e"} · ${fmtHoursDecimal(hours * 60)} h</div>
          ${remainingLines.map((l) => `<div class="contract-months">${escapeHtml(l)}</div>`).join("")}
        </div>
        <button class="cc-del" data-vacation-id="${v.id}" aria-label="Löschen">✕</button>
      </div>`;
  }).join("");

  container.querySelectorAll(".cc-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.vacationId;
      if (!confirm("Diesen Urlaubszeitraum löschen?")) return;
      vacations = vacations.filter((v) => v.id !== id);
      saveVacations(vacations);
      saveLabs(labs);
      saveContracts(contracts);
      renderVacations();
      renderVacationOverview();
      toast("Urlaub gelöscht.");
      deleteVacationRemote(id);
    });
  });
}

function updateVacationHint() {
  const start = document.getElementById("vac-start").value;
  const end = document.getElementById("vac-end").value;
  const hint = document.getElementById("vac-hint");
  if (!start || !end) { hint.textContent = "Wähle Start- und Enddatum."; hint.className = "hint"; return; }
  if (end < start) {
    hint.textContent = "Das Enddatum liegt vor dem Startdatum.";
    hint.className = "hint warn";
    return;
  }
  const dayList = vacationWeekdaysInRange(start, end);
  if (dayList.length === 0) {
    hint.textContent = "Dieser Zeitraum enthält nur Wochenendtage – es werden keine Urlaubstage gezählt.";
    hint.className = "hint warn";
    return;
  }
  const hours = dayList.reduce((sum, d) => sum + dailyHoursForDate(d), 0);
  if (hours === 0) {
    hint.textContent = `${dayList.length} Werktag${dayList.length === 1 ? "" : "e"} – für diesen Zeitraum ist noch kein Vertrag hinterlegt.`;
    hint.className = "hint warn";
    return;
  }
  hint.textContent = `${dayList.length} Werktag${dayList.length === 1 ? "" : "e"} · ${fmtHoursDecimal(hours * 60)} h Urlaub`;
  hint.className = "hint ok";
}

function addVacation(startDate, endDate) {
  const v = { id: uid(), startDate, endDate };
  vacations.push(v);
  saveVacations(vacations);
  renderVacations();
  renderVacationOverview();
  pushVacation(v);
}

/* =========================================================
   EXPORT view
   ========================================================= */
function exportRange() {
  const from = document.getElementById("export-from").value || null;
  const to = document.getElementById("export-to").value || null;
  return { from, to };
}
function inExportRange(dateISO, range) {
  if (range.from && dateISO < range.from) return false;
  if (range.to && dateISO > range.to) return false;
  return true;
}
function updateExportRangeHint() {
  const { from, to } = exportRange();
  const hint = document.getElementById("export-range-hint");
  if (!from && !to) { hint.textContent = "Alle Einträge werden exportiert."; hint.className = "hint"; return; }
  if (from && to && to < from) {
    hint.textContent = "Das Bis-Datum liegt vor dem Von-Datum.";
    hint.className = "hint warn"; return;
  }
  const count = entries.filter((e) => inExportRange(e.date, { from, to })).length;
  hint.textContent = `${count} Eintrag/Einträge im gewählten Zeitraum.`;
  hint.className = count > 0 ? "hint ok" : "hint warn";
}

function renderExportStats() {
  const note = document.getElementById("local-mode-note");
  if (note) {
    if (SB) {
      note.style.display = "none";
    } else {
      note.style.display = "block";
      note.textContent = `Lokaler Modus (${APP_VERSION}): Daten liegen nur auf diesem Gerät. `
        + "Für die Synchronisierung müssen url und anonKey in config.js eingetragen sein.";
    }
  }
  const container = document.getElementById("export-stats");
  const totalMinutes = entries.reduce((s, e) => s + e.totalMinutes, 0);
  const laborMinutes = entries.reduce((s, e) => s + (e.laborMinutes || 0), 0);
  container.innerHTML = `
    <div class="stat-box"><div class="n">${entries.length}</div><div class="l">Einträge gesamt</div></div>
    <div class="stat-box"><div class="n">${fmtHoursDecimal(totalMinutes)} h</div><div class="l">Erfasste Arbeitszeit</div></div>
    <div class="stat-box"><div class="n">${costCenters.length}</div><div class="l">Kostenstellen</div></div>
    <div class="stat-box"><div class="n">${projects.length}</div><div class="l">Projekte</div></div>
    <div class="stat-box"><div class="n">${labs.length}</div><div class="l">Labore</div></div>
    <div class="stat-box"><div class="n">${contracts.length}</div><div class="l">Verträge</div></div>
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
  // Wochenstunden je Monat aus dem zugeordneten Vertrag (Rückfall: Profildaten).
  const weeklyPerMonth = MONTHS_AT.map((_, i) => weeklyHoursForMonth(year, i));
  const vacationSollPerMonth = MONTHS_AT.map((_, i) => monthlyVacationHours(year, i));
  const vacationIstPerMonth = monthTotals.map((m, i) =>
    Number(((m.vacationDays || 0) * (weeklyPerMonth[i] / 5)).toFixed(2)));
  // (weeklyPerMonth stammt aus den Verträgen; ohne Vertrag ist der Monat 0.)

  const aoa = [];
  aoa.push([`Jahresübersicht ${year}`]);
  aoa.push(["", ...MONTHS_AT.map((m) => m.short), "", "Σ Arbeitszeiten /a"]);
  aoa.push(["Stunden pro Woche", ...weeklyPerMonth, "", ""]);
  aoa.push(["Soll", ...Array(12).fill(0), "", 0]);
  aoa.push(["Ist", ...Array(12).fill(0), "", 0]);
  aoa.push(["Differenz", ...Array(12).fill(""), "", 0]);
  aoa.push([]);
  aoa.push(["", ...MONTHS_AT.map((m) => m.short), "", "Σ Urlaubszeiten /a"]);
  aoa.push(["Soll", ...vacationSollPerMonth, "", 0]);
  aoa.push(["Ist", ...vacationIstPerMonth, "", 0]);
  aoa.push(["Differenz", ...Array(12).fill(""), "", 0]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const O = 14; // column O (A=0 … M=12, N=13 spacer, O=14)
  const BOLD = { font: { bold: true } };

  for (let m = 0; m < 12; m++) {
    const col = m + 1; // B(1) … M(12)
    ws[XLSX.utils.encode_cell({ r: 3, c: col })] = { t: "n", f: `'${monatsblaetterName}'!${monthTotals[m].sollAddr}`, z: "0.00" };
    ws[XLSX.utils.encode_cell({ r: 4, c: col })] = { t: "n", f: `'${monatsblaetterName}'!${monthTotals[m].istAddr}`, z: "0.00" };
    // Best-effort bold on the month-name header cells (both blocks). The free SheetJS build
    // may not persist cell styles on write — see the note in the README/export hint.
    const headCell1 = ws[XLSX.utils.encode_cell({ r: 1, c: col })];
    if (headCell1) headCell1.s = BOLD;
    const headCell2 = ws[XLSX.utils.encode_cell({ r: 7, c: col })];
    if (headCell2) headCell2.s = BOLD;
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
  const boldCells = [];
  const monthTotals = [];
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const vacationDays = vacationDateSet();
  let cursor = 0; // 0-indexed row cursor

  MONTHS_AT.forEach((meta, monthIndex) => {
    const daysCount = new Date(year, monthIndex + 1, 0).getDate();
    const monthCol = XLSX.utils.encode_col(monthIndex + 1);
    const isoPrefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const blockStart = cursor;
    let weekdayCount = 0;
    let monthVacationDays = 0;

    aoa.push(["SOLL", 0, "", `Arbeitsbericht ${meta.full} ${year}`, "", "", ""]);
    aoa.push(["IST", 0, "", fullName, "", "", ""]);
    aoa.push([]);
    aoa.push(["Tag", "Datum", "Arbeitszeit", "", "Pause", "", "Stunden gearbeitet", "Geschäftsstellen-Kürzel", "Urlaub"]);
    aoa.push(["", "", "Beginn", "Ende", "von", "bis", "", "", ""]);
    boldCells.push({ r: blockStart, c: 3 }); // "Arbeitsbericht {Monat} {Jahr}" title

    const dataStart = blockStart + 5;
    for (let d = 1; d <= daysCount; d++) {
      const dateObj = new Date(year, monthIndex, d);
      const iso = `${isoPrefix}-${String(d).padStart(2, "0")}`;
      const dow = dateObj.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const wd = WEEKDAY_ABBR_AT[dow];
      const dateStr = `${String(d).padStart(2, "0")}.${String(monthIndex + 1).padStart(2, "0")}.${year}`;
      const entry = entries.find((e) => e.date === iso);
      if (!isWeekend) weekdayCount++;

      if (isWeekend) {
        aoa.push([wd, dateStr, "", "", "", "", "", "", ""]);
      } else {
        const ccCodes = entry
          ? (entry.allocations || [])
              .map((a) => costCenters.find((c) => c.id === a.costCenterId))
              .filter(Boolean)
              .map((c) => c.code)
              .join(", ")
          : "";
        const onVacation = vacationDays.has(iso);
        if (onVacation) monthVacationDays++;
        aoa.push([
          wd, dateStr,
          entry ? entry.start || "" : "",
          entry ? entry.end || "" : "",
          entry ? entry.pauseStart || "" : "",
          entry ? entry.pauseEnd || "" : "",
          entry ? Number((entry.totalMinutes / 60).toFixed(2)) : 0,
          ccCodes,
          onVacation ? "Urlaub" : "",
        ]);
      }
    }
    const dataEnd = dataStart + daysCount - 1;

    // SOLL = Wochentage im Monat × (Stunden pro Woche ÷ 5) — direkt aus der Übersicht, ohne
    // eigene Tages-Spalte (die wurde entfernt).
    formulaPatches.push({ r: blockStart, c: 1, f: `'${overviewSheetName}'!${monthCol}3/5*${weekdayCount}`, z: "0.00" });
    formulaPatches.push({ r: blockStart + 1, c: 1, f: `SUM(G${dataStart + 1}:G${dataEnd + 1})`, z: "0.00" });

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
    );

    monthTotals.push({
      sollAddr: XLSX.utils.encode_cell({ r: blockStart, c: 1 }),
      istAddr: XLSX.utils.encode_cell({ r: blockStart + 1, c: 1 }),
      vacationDays: monthVacationDays,
    });

    cursor = dataEnd + 2; // gap row between this month's block and the next
    aoa.push([]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  formulaPatches.forEach((p) => {
    ws[XLSX.utils.encode_cell({ r: p.r, c: p.c })] = { t: "n", f: p.f, z: p.z };
  });
  boldCells.forEach(({ r, c }) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (ws[addr]) ws[addr].s = { font: { bold: true } };
  });
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 6 }, { wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 8 },
    { wch: 13 }, { wch: 16 }, { wch: 9 },
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

  /* Laborzeit gehört jeweils zu EINEM Projekt (beim Erfassen zugeordnet).
     Vorher wurde die Gesamtsumme in jeden Projekt-Block geschrieben – das war falsch. */
  const laborFor = (e, projectId) => {
    const mins = (e.laborAllocations || [])
      .filter((a) => (a.projectId || null) === (projectId || null))
      .reduce((sum, a) => sum + a.minutes, 0);
    return mins ? Number((mins / 60).toFixed(2)) : "";
  };

  relevantEntries.forEach((e) => {
    const projAllocs = e.projectAllocations || [];
    if (projAllocs.length === 0) {
      noneRows.push([fmtDatePlain(e.date), generalHoursFn(e), laborFor(e, null), ""]);
    } else {
      projAllocs.forEach((pa) => {
        const arr = projectRowsMap.get(pa.projectId) || [];
        arr.push([fmtDatePlain(e.date), projectHoursFn(e, pa), laborFor(e, pa.projectId), pa.activity || ""]);
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
  const employeeName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
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

  /* Optionaler Zeitraumfilter: Nur Einträge und Urlaube innerhalb von/bis exportieren.
     exportEntries/exportVacations gelten ab hier für den gesamten Export. */
  const range = exportRange();
  if (range.from && range.to && range.to < range.from) {
    toast("Das Bis-Datum liegt vor dem Von-Datum."); return;
  }
  const exportEntries = entries.filter((e) => inExportRange(e.date, range));
  if (exportEntries.length === 0) {
    toast("Im gewählten Zeitraum gibt es keine Einträge."); return;
  }
  const allEntries = entries;
  const allVacations = vacations;
  entries = exportEntries;
  vacations = vacations.filter((v) => inExportRange(v.startDate, range) || inExportRange(v.endDate, range));

  try {
    buildWorkbook();
  } finally {
    entries = allEntries;   // Ansicht der App bleibt unverändert
    vacations = allVacations;
  }
}

function buildWorkbook() {
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
    ...labs.map((l) => `${l.code} (Labor)`)];
  const rows = sorted.map((e) => {
    const row = [
      fmtDateDisplay(e.date), e.start || "", e.end || "", e.pauseStart || "", e.pauseEnd || "",
      Number((e.totalMinutes / 60).toFixed(2)), entryActivitySummary(e),
    ];
    costCenters.forEach((cc) => {
      const alloc = (e.allocations || []).find((a) => a.costCenterId === cc.id);
      row.push(alloc ? Number((alloc.minutes / 60).toFixed(2)) : "");
    });
    projects.forEach((pr) => {
      const alloc = (e.projectAllocations || []).find((a) => a.projectId === pr.id);
      row.push(alloc ? Number((alloc.minutes / 60).toFixed(2)) : "");
    });
    labs.forEach((lab) => {
      const alloc = (e.laborAllocations || []).find((a) => a.labId === lab.id);
      row.push(alloc ? Number((alloc.minutes / 60).toFixed(2)) : "");
    });
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
    const ws = buildBlockSheet(
      cc.name || cc.code,
      ccEntries,
      hoursForCc,                                            // Zeit ohne Projektzuordnung
      (e, pa) => Number((pa.minutes / 60).toFixed(2))        // je Projekt SEINE eigene Zeit
    );
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

  // ---- Labor sheet: one side-by-side block per Labor ----
  const labBlocks = labs.map((lab) => {
    /* flatMap statt find: ein Labor kann innerhalb EINES Eintrags mehrfach vorkommen,
       nämlich einmal je Projekt (z. B. 3 h auf Projekt A, 2 h auf Projekt B). */
    const rows = sorted.flatMap((e) =>
      (e.laborAllocations || [])
        .filter((a) => a.labId === lab.id)
        .map((alloc) => {
          const pr = alloc.projectId ? projects.find((p) => p.id === alloc.projectId) : null;
          const prAlloc = pr ? (e.projectAllocations || []).find((a) => a.projectId === pr.id) : null;
          const desc = pr
            ? `${pr.code}${prAlloc && prAlloc.activity ? " — " + prAlloc.activity : ""}`
            : entryActivitySummary(e);
          return [fmtDatePlain(e.date), Number((alloc.minutes / 60).toFixed(2)), desc];
        })
    );
    return {
      label: lab.name || lab.code,
      rows,
      sum: Number(rows.reduce((s, r) => s + r[1], 0).toFixed(2)),
    };
  });
  if (labBlocks.length === 0) labBlocks.push({ label: "Labor", rows: [], sum: 0 });

  const labMaxRows = Math.max(0, ...labBlocks.map((b) => b.rows.length));
  const labAoa = [];
  const labName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  labAoa.push(["Laborzeiten", "", "", ...(labName ? [labName] : [])]);
  const labRow2 = [], labRow3 = [];
  labBlocks.forEach((b, i) => {
    const last = i === labBlocks.length - 1;
    labRow2.push(b.label, b.sum, "");
    labRow3.push("Datum", "h", "Beschreibung");
    if (!last) { labRow2.push(""); labRow3.push(""); }
  });
  labAoa.push(labRow2);
  labAoa.push(labRow3);
  for (let i = 0; i < labMaxRows; i++) {
    const row = [];
    labBlocks.forEach((b, bi) => {
      const last = bi === labBlocks.length - 1;
      if (b.rows[i]) row.push(...b.rows[i]);
      else row.push("", "", "");
      if (!last) row.push("");
    });
    labAoa.push(row);
  }
  /* Kreuztabelle ganz rechts: Zeilen = Projekte, Spalten = Labore.
     Sie steht bewusst rechts von allen Labor-Blöcken, damit neue Labore links
     davor eingefügt werden und die Tabelle ihre Position behält. */
  const blockWidth = labBlocks.length * 3 + (labBlocks.length - 1); // 3 Spalten je Block + Trenner
  const matrixStart = blockWidth + 1;                               // eine Leerspalte Abstand

  const setCell = (rowIdx, colIdx, value) => {
    while (labAoa.length <= rowIdx) labAoa.push([]);
    const row = labAoa[rowIdx];
    while (row.length < colIdx) row.push("");
    row[colIdx] = value;
  };

  // Kopfzeile: Projektspalte + je Labor eine Spalte + Summe
  setCell(1, matrixStart, "Projekt / Labor");
  labs.forEach((lab, i) => setCell(1, matrixStart + 1 + i, lab.code));
  setCell(1, matrixStart + 1 + labs.length, "Summe");

  const minutesFor = (projectId, labId) =>
    sorted.reduce((sum, e) => sum + (e.laborAllocations || [])
      .filter((a) => a.labId === labId && (a.projectId || null) === projectId)
      .reduce((s, a) => s + a.minutes, 0), 0);

  const matrixProjects = projects.map((pr) => {
    const cc = costCenters.find((c) => c.id === pr.costCenterId);
    return { id: pr.id, label: cc ? `${cc.code} · ${pr.code}` : pr.code };
  });

  const labTotals = labs.map(() => 0);
  matrixProjects.forEach((pr, r) => {
    const rowIdx = 2 + r;
    setCell(rowIdx, matrixStart, pr.label);
    let rowSum = 0;
    labs.forEach((lab, c) => {
      const h = Number((minutesFor(pr.id, lab.id) / 60).toFixed(2));
      setCell(rowIdx, matrixStart + 1 + c, h || "");
      rowSum += h;
      labTotals[c] += h;
    });
    setCell(rowIdx, matrixStart + 1 + labs.length, rowSum ? Number(rowSum.toFixed(2)) : "");
  });

  const totalsRow = 2 + matrixProjects.length;
  setCell(totalsRow, matrixStart, "Summe");
  labs.forEach((lab, c) =>
    setCell(totalsRow, matrixStart + 1 + c, labTotals[c] ? Number(labTotals[c].toFixed(2)) : ""));
  setCell(totalsRow, matrixStart + 1 + labs.length,
    Number(labTotals.reduce((a, b) => a + b, 0).toFixed(2)));

  const wsLabor = XLSX.utils.aoa_to_sheet(labAoa);
  wsLabor["!cols"] = [
    ...labBlocks.flatMap((b, i) => {
      const cols = [{ wch: 11 }, { wch: 7 }, { wch: 30 }];
      if (i < labBlocks.length - 1) cols.push({ wch: 2 });
      return cols;
    }),
    { wch: 2 },                              // Abstand
    { wch: 20 },                             // Projektspalte
    ...labs.map(() => ({ wch: 8 })),         // je Labor
    { wch: 9 },                              // Summe
  ];
  XLSX.utils.book_append_sheet(wb, wsLabor, sanitizeSheetName("Labor", usedNames));

  const filename = `Arbeitszeit_Export_${todayStr()}.xlsx`;
  XLSX.writeFile(wb, filename, { cellStyles: true });
  toast("Excel-Datei wurde erstellt.");
}

/* =========================================================
   Backup import / export (JSON)
   ========================================================= */
function exportJSON() {
  const data = { entries, costCenters, projects, labs, contracts, vacations, exportedAt: new Date().toISOString() };
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
      vacations = Array.isArray(data.vacations) ? data.vacations : [];
      labs = Array.isArray(data.labs) ? data.labs : [];
      contracts = Array.isArray(data.contracts) ? data.contracts : [];
      saveEntries(entries);
      saveCostCenters(costCenters);
      saveProjects(projects);
      saveVacations(vacations);
      saveLabs(labs);
      saveContracts(contracts);
      renderAll();
      toast("Backup importiert.");
      bulkReplaceRemote();
    } catch {
      toast("Diese Datei konnte nicht gelesen werden.");
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm("Wirklich ALLE Einträge und Kostenstellen unwiderruflich löschen?")) return;
  if (!confirm("Bist du sicher? Dieser Schritt kann nicht rückgängig gemacht werden.")) return;
  entries = []; costCenters = []; projects = []; labs = []; contracts = []; vacations = [];
  timer = { status: "idle" };
  saveEntries(entries); saveCostCenters(costCenters); saveProjects(projects);
  saveLabs(labs); saveContracts(contracts); saveVacations(vacations); saveTimer(timer);
  renderAll();
  toast("Alle Daten wurden gelöscht.");
  bulkReplaceRemote();
}

/* =========================================================
   Sheet show/hide helpers
   ========================================================= */
function showBackdrop(id) {
  const el = document.getElementById(id);
  el.classList.add("active");
  const sheet = el.querySelector(".sheet");
  if (sheet) sheet.scrollTop = 0;   // sonst öffnet ein Sheet mitten im Inhalt
}
function hideBackdrop(id) { document.getElementById(id).classList.remove("active"); }

/* =========================================================
   View switching
   ========================================================= */
function switchView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === id));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === id));
  if (id === "view-entries") renderEntries();
  if (id === "view-costcenters") renderCostCenters();
  if (id === "view-projects") { renderProjects(); renderLabs(); }
  if (id === "view-vacation") { renderContracts(); renderVacationOverview(); renderVacations(); }
  if (id === "view-export") renderExportStats();
}

function renderAll() {
  renderTodaySummary();
  renderEntries();
  renderCostCenters();
  renderProjects();
  renderLabs();
  renderContracts();
  renderVacationOverview();
  renderVacations();
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
    // Eingaben sichern – aber ein Fehler dabei darf die Navigation nicht blockieren.
    try {
      flow.draft.allocations = readAllocRows();
      flow.draft.projectAllocations = readProjectAllocRows();
      flow.draft.laborAllocations = readLabAllocRows();
      flow.draft.laborMinutes = flow.draft.laborAllocations.reduce((sum, a) => sum + a.minutes, 0);
    } catch (err) {
      console.error("Zwischenspeichern beim Zurück fehlgeschlagen:", err);
      toast("Eingaben konnten nicht übernommen werden.");
    }
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

  document.getElementById("form-lab").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const code = document.getElementById("lab-code").value.trim();
    const name = document.getElementById("lab-name").value.trim();
    if (!code || !name) return;
    addLab(code, name);
    document.getElementById("form-lab").reset();
    toast("Labor hinzugefügt.");
  });

  ["vac-start", "vac-end"].forEach((id) =>
    document.getElementById(id).addEventListener("input", updateVacationHint));
  document.getElementById("form-vacation").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const start = document.getElementById("vac-start").value;
    const end = document.getElementById("vac-end").value;
    if (!start || !end) return;
    if (end < start) { toast("Das Enddatum liegt vor dem Startdatum."); return; }
    if (vacationWeekdaysInRange(start, end).length === 0) {
      toast("Dieser Zeitraum enthält keine Werktage."); return;
    }
    addVacation(start, end);
    document.getElementById("form-vacation").reset();
    updateVacationHint();
    toast("Urlaub gespeichert.");
  });

  document.getElementById("btn-export").addEventListener("click", exportExcel);

  document.getElementById("profile-firstname").value = profile.firstName || "";
  document.getElementById("profile-lastname").value = profile.lastName || "";
  document.getElementById("btn-profile-save").addEventListener("click", () => {
    profile = {
      firstName: document.getElementById("profile-firstname").value.trim(),
      lastName: document.getElementById("profile-lastname").value.trim(),
      weeklyHours: null,
      vacationDaysPerYear: null,
    };
    saveProfile(profile);
    pushProfileDebounced(profile);
    renderContracts();
    renderVacationOverview();
    toast("Profildaten gespeichert.");
  });

  // --- Verträge ---
  document.getElementById("vac-overview-year").addEventListener("change", renderVacationOverview);
  document.getElementById("contract-year").addEventListener("change", () => {
    contractMonthSelection.clear();
    renderContractMonthGrid();
  });
  document.getElementById("form-contract").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = document.getElementById("contract-name").value.trim();
    const hoursRaw = document.getElementById("contract-hours").value.trim().replace(",", ".");
    const hours = Number(hoursRaw);
    if (!name || !hoursRaw || Number.isNaN(hours) || hours <= 0) {
      toast("Bitte Bezeichnung und gültige Wochenstunden angeben."); return;
    }
    if (contractMonthSelection.size === 0) {
      toast("Bitte mindestens einen Monat auswählen."); return;
    }
    addContract(name, hours, [...contractMonthSelection]);
    document.getElementById("form-contract").reset();
    contractMonthSelection.clear();
    renderContracts();
    renderVacationOverview();
    toast("Vertrag gespeichert.");
  });

  // --- Export-Zeitraum ---
  ["export-from", "export-to"].forEach((id) =>
    document.getElementById(id).addEventListener("input", updateExportRangeHint));
  updateExportRangeHint();

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
  document.getElementById("btn-account-close").addEventListener("click", () => hideBackdrop("sheet-account-backdrop"));
  document.getElementById("btn-force-update").addEventListener("click", async () => {
    if (!confirm("Zwischenspeicher leeren und App neu laden?\n\nDeine Daten bleiben erhalten.")) return;
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (err) {
      console.error("Cache konnte nicht geleert werden:", err);
    }
    // Query-Parameter erzwingt einen echten Neuabruf statt eines Treffers im HTTP-Cache.
    location.replace(location.pathname + "?frisch=" + Date.now());
  });

  document.getElementById("btn-diagnose").addEventListener("click", () => {
    runDiagnostics().catch((err) => {
      const out = document.getElementById("diagnose-output");
      out.style.display = "block";
      out.textContent = "Diagnose-Fehler: " + (err && err.message ? err.message : String(err));
    });
  });
  document.getElementById("sheet-account-backdrop").addEventListener("click", (ev) => {
    if (ev.target.id === "sheet-account-backdrop") hideBackdrop("sheet-account-backdrop");
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
      navigator.serviceWorker.register("sw.js").then((reg) => {
        // Ein wartendes Update sofort aktivieren, damit die neue Version nicht
        // erst nach mehrmaligem Schliessen der App greift.
        if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              sw.postMessage("SKIP_WAITING");
              toast("Neue Version geladen – bitte einmal neu öffnen.");
            }
          });
        });
      }).catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (SB) {
    initAuth();
  } else {
    hideBootScreen();
    dedupeGeneralProjects();
    ensureGeneralProjects();
    document.getElementById("app-shell").style.display = "";
    const accountBtn = document.getElementById("btn-account");
    accountBtn.style.display = "flex";
    accountBtn.addEventListener("click", () => {
      document.getElementById("account-email").textContent = "Nicht angemeldet (lokaler Modus)";
      document.getElementById("account-sync-status").textContent =
        "Keine Synchronisierung – config.js enthält keine Supabase-Zugangsdaten.";
      document.getElementById("account-version").textContent = `App ${APP_VERSION} · lokaler Modus`;
      document.getElementById("btn-logout").style.display = "none";
      showBackdrop("sheet-account-backdrop");
    });
    init();
  }
});
