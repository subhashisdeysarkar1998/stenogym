import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    initializeFirestore,
    collection,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ==========================================
// 1. FIREBASE INIT (LONG POLLING + REST READS)
// ==========================================
const FIREBASE_PROJECT_ID = "stenogym";
const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

const firebaseConfig = {
    apiKey: "AIzaSyCilbp4K3EXNZbG2a4R-CeZQk7ijtqQh10",
    authDomain: "stenogym.firebaseapp.com",
    projectId: FIREBASE_PROJECT_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Forces reliable HTTP Long Polling to eliminate Edge/ISP "client is offline" errors
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

// ==========================================
// 2. ADMIN AUTH BOUNCER & 5-TAB NAVIGATION
// ==========================================
let authResolved = false;
setTimeout(() => {
    if (!authResolved) {
        const sub = document.getElementById("authOverlaySub");
        if (sub) sub.textContent = "Still waiting for Firebase Auth... check internet connection or refresh.";
    }
}, 7000);

onAuthStateChanged(auth, (user) => {
    authResolved = true;
    if (user && user.email === "subhashisdeysarkar1998@gmail.com") {
        const sec = document.getElementById("securityOverlay");
        if (sec) {
            sec.style.opacity = "0";
            setTimeout(() => {
                sec.classList.add("hidden");
                document.body.classList.remove("overflow-hidden");
            }, 350);
        }
        const stat = document.getElementById("dbStatus");
        if (stat) stat.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Live DB Ready (REST + LP)';
        // Warm drills cache silently for instant dropdowns & Library
        fetchAllDrillsMetadata().then(populateExistingDropdowns).catch(() => {});
    } else {
        window.location.href = "login.html";
    }
});

const sidebar = document.getElementById("megaSidebar");
const overlay = document.getElementById("sidebarOverlay");
function closeSidebar() {
    sidebar?.classList.add("-translate-x-full");
    overlay?.classList.add("hidden");
}
document.getElementById("mobileMenuBtn")?.addEventListener("click", () => {
    sidebar?.classList.remove("-translate-x-full");
    overlay?.classList.remove("hidden");
});
document.getElementById("closeSidebarBtn")?.addEventListener("click", closeSidebar);
overlay?.addEventListener("click", closeSidebar);

const TAB_TITLES = {
    "tab-daily": "Daily Upload",
    "tab-manage": "Manage Daily CA",
    "tab-weekly": "Weekly Builder",
    "tab-monthly-special": "Monthly & Special",
    "tab-library": "Library & Mega PDF"
};

let activeTabId = "tab-daily";
let activeStagingContext = "daily"; // 'daily' | 'weekly' | 'ms'
let pendingPasteContext = "daily";

function switchToTab(targetId) {
    activeTabId = targetId;
    document.querySelectorAll(".nav-btn").forEach((b) => {
        const isMatch = b.getAttribute("data-target") === targetId;
        b.classList.toggle("active", isMatch);
        b.classList.toggle("bg-indigo-600", isMatch);
        b.classList.toggle("text-white", isMatch);
        b.classList.toggle("shadow-sm", isMatch);
        b.classList.toggle("text-slate-400", !isMatch);
    });
    document.querySelectorAll(".tab-content").forEach((c) => {
        c.classList.toggle("active", c.id === targetId);
    });
    const hTitle = document.getElementById("headerTitle");
    if (hTitle) hTitle.textContent = TAB_TITLES[targetId] || "CA Studio";
    closeSidebar();

    if (targetId === "tab-daily") {
        activeStagingContext = "daily";
    } else if (targetId === "tab-weekly") {
        activeStagingContext = "weekly";
        if (browseDrillsCache.length === 0) {
            fetchAllDrillsMetadata().then(populateExistingDropdowns).catch(() => {});
        } else {
            populateExistingDropdowns();
        }
    } else if (targetId === "tab-monthly-special") {
        activeStagingContext = "ms";
        if (browseDrillsCache.length === 0) {
            fetchAllDrillsMetadata().then(populateExistingDropdowns).catch(() => {});
        } else {
            populateExistingDropdowns();
        }
    } else if (targetId === "tab-manage") {
        fetchCAManage();
    } else if (targetId === "tab-library") {
        refreshLibraryDrills();
    }

    syncStagingVisibility();
    updateStagingContextBanner();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        switchToTab(btn.getAttribute("data-target"));
    });
});

// ==========================================
// 3. UTILITIES & ROCK-SOLID REST API HELPERS
// ==========================================
window.escapeHtml = (val) => {
    const d = document.createElement("div");
    d.textContent = val ?? "";
    return d.innerHTML;
};
window.escapeJsStr = (val) =>
    String(val ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, "&quot;");

function getISTDateString(offsetDays = 0) {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const ist = new Date(utc + 3600000 * 5.5 + offsetDays * 86400000);
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, "0")}-${String(ist.getDate()).padStart(2, "0")}`;
}

function getISTMonthBounds() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const ist = new Date(utc + 3600000 * 5.5);
    const y = ist.getFullYear();
    const m = ist.getMonth();
    const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const end = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const monthName = ist.toLocaleString("en-US", { month: "long", year: "numeric" });
    return { start, end, monthName };
}

function initDefaultDates() {
    const today = getISTDateString(0);
    const weekAgo = getISTDateString(-6);
    const { start, end, monthName } = getISTMonthBounds();

    const setVal = (id, v) => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = v;
    };
    setVal("dailyTargetDate", today);
    setVal("caManageDate", today);
    setVal("wpStartDate", weekAgo);
    setVal("wpEndDate", today);
    setVal("asStartDate", start);
    setVal("asEndDate", end);
    setVal("asFolderName", monthName);
}
initDefaultDates();

function slugify(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/&/g, " ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

function parseRestValue(val) {
    if (!val || typeof val !== "object") return null;
    if (val.stringValue !== undefined) return val.stringValue;
    if (val.booleanValue !== undefined) return val.booleanValue;
    if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
    if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
    if (val.timestampValue !== undefined) return val.timestampValue;
    if (val.arrayValue !== undefined) return val.arrayValue.values ? val.arrayValue.values.map(parseRestValue) : [];
    if (val.mapValue !== undefined && val.mapValue.fields) {
        const obj = {};
        for (const [k, v] of Object.entries(val.mapValue.fields)) {
            obj[k] = parseRestValue(v);
        }
        return obj;
    }
    return null;
}

function formatRestDoc(docObj) {
    const data = {};
    if (docObj && docObj.fields) {
        for (const [k, v] of Object.entries(docObj.fields)) {
            data[k] = parseRestValue(v);
        }
    }
    const id = docObj?.name ? docObj.name.split("/").pop() : "";
    return { docId: id, id, ...data };
}

async function restGetDoc(collectionName, docId) {
    const url = `${FIRESTORE_REST_BASE}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`REST read failed (HTTP ${res.status})`);
    const json = await res.json();
    return formatRestDoc(json);
}

async function restRunQuery(structuredQuery) {
    const url = `${FIRESTORE_REST_BASE}:runQuery`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structuredQuery })
    });
    if (!res.ok) throw new Error(`REST query failed (HTTP ${res.status})`);
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return json.filter((row) => row.document).map((row) => formatRestDoc(row.document));
}

async function restFetchDailyRange(startDate, endDate) {
    return restRunQuery({
        from: [{ collectionId: "daily_news" }],
        where: {
            compositeFilter: {
                op: "AND",
                filters: [
                    { fieldFilter: { field: { fieldPath: "date" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: startDate } } },
                    { fieldFilter: { field: { fieldPath: "date" }, op: "LESS_THAN_OR_EQUAL", value: { stringValue: endDate } } }
                ]
            }
        }
    });
}

async function restFetchDailyByDate(dateStr) {
    return restRunQuery({
        from: [{ collectionId: "daily_news" }],
        where: {
            fieldFilter: { field: { fieldPath: "date" }, op: "EQUAL", value: { stringValue: dateStr } }
        }
    });
}

function normalizeHeadlineKey(str) {
    return String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 75);
}

function normalizeCard(raw) {
    const mcqEn = raw.mcq || {};
    const mcqHi = raw.mcq_hi || {};
    const ansIdx = Number.isFinite(Number(mcqEn.correctIndex)) ? Number(mcqEn.correctIndex) : 0;
    return {
        emoji: raw.emoji || "📰",
        category: raw.category || "National & Global",
        category_hi: raw.category_hi || "",
        subCategory: raw.subCategory || "General",
        subCategory_hi: raw.subCategory_hi || "",
        priority: raw.priority === "standard" ? "standard" : raw.priority === "high" ? "high" : "",
        targetExams: Array.isArray(raw.targetExams) && raw.targetExams.length ? raw.targetExams : ["SSC CGL", "IBPS PO"],
        oneLiner: raw.oneLiner || "",
        oneLiner_hi: raw.oneLiner_hi || "",
        contextBullets: Array.isArray(raw.contextBullets) ? raw.contextBullets.filter((b) => String(b).trim() !== "") : [],
        contextBullets_hi: Array.isArray(raw.contextBullets_hi) ? raw.contextBullets_hi.filter((b) => String(b).trim() !== "") : [],
        dataTable: Array.isArray(raw.dataTable) && raw.dataTable.length ? raw.dataTable : null,
        impact: raw.impact || "",
        impact_hi: raw.impact_hi || "",
        staticBox: { facts: raw.staticBox?.facts || "" },
        staticBox_hi: { facts: raw.staticBox_hi?.facts || "" },
        mcq: {
            question: mcqEn.question || "",
            options: [mcqEn.options?.[0] || "", mcqEn.options?.[1] || "", mcqEn.options?.[2] || "", mcqEn.options?.[3] || ""],
            correctIndex: ansIdx,
            explanation: mcqEn.explanation || ""
        },
        mcq_hi: {
            question: mcqHi.question || "",
            options: [mcqHi.options?.[0] || "", mcqHi.options?.[1] || "", mcqHi.options?.[2] || "", mcqHi.options?.[3] || ""],
            correctIndex: ansIdx,
            explanation: mcqHi.explanation || ""
        }
    };
}

function isCardTranslated(card) {
    const hasEnNote = Boolean((card.oneLiner || "").trim());
    const hasEnMcq = Boolean((card.mcq?.question || "").trim());
    const hasHiNote = Boolean((card.oneLiner_hi || "").trim());
    const hasHiMcq = Boolean((card.mcq_hi?.question || "").trim());
    if (hasEnNote && !hasHiNote) return false;
    if (hasEnMcq && !hasHiMcq) return false;
    return hasHiNote || hasHiMcq;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function translateEnToHi(text) {
    if (!text || text.trim() === "") return "";
    await delay(300);
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=hi&dt=t&q=${encodeURIComponent(text)}`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        return data[0].map((item) => item[0]).join("");
    } catch (e) {
        console.error("Translation Error:", e);
        return null;
    }
}

// ==========================================
// 4. STATE, AUTO-SLUG & MODE TOGGLES
// ==========================================
window.stagedNewsItems = [];
window.activeStagingFilter = "all";
let weeklyIsEdit = false;
let msIsEdit = false;
const slugManuallyEdited = { weekly: false, ms: false };
let browseDrillsCache = [];
let activeBrowseCadenceFilter = "all";

function getContextIds(ctx) {
    if (ctx === "weekly") {
        return {
            title: "weeklyDisplayTitle",
            id: "weeklyIdentifier",
            preview: "weeklySlugPreview",
            folder: null,
            cadence: null,
            mode: "weeklyDeckMode",
            pdfEn: "weeklyPdfUrl_en",
            pdfHi: "weeklyPdfUrl_hi",
            pdfLabel: "weeklyPdfLabel",
            select: "weeklyExistingSelect",
            editBar: "weeklyEditBar",
            btnFetch: "btnFetchWeekly",
            btnSaveInfo: "btnSaveWeeklyInfo",
            btnDelete: "btnDeleteWeekly"
        };
    }
    return {
        title: "msDisplayTitle",
        id: "msIdentifier",
        preview: "msSlugPreview",
        folder: "msFolderName",
        cadence: "msCadenceType",
        mode: "msDeckMode",
        pdfEn: "msPdfUrl_en",
        pdfHi: "msPdfUrl_hi",
        pdfLabel: "msPdfLabel",
        select: "msExistingSelect",
        editBar: "msEditBar",
        btnFetch: "btnFetchMs",
        btnSaveInfo: "btnSaveMsInfo",
        btnDelete: "btnDeleteMs"
    };
}

function isContextEditing(ctx) {
    if (ctx === "weekly") return weeklyIsEdit;
    if (ctx === "ms") return msIsEdit;
    return false;
}

window.onTitleAutoSlug = function (ctx) {
    if (isContextEditing(ctx) || slugManuallyEdited[ctx]) {
        updateStagingContextBanner();
        return;
    }
    const ids = getContextIds(ctx);
    const titleVal = document.getElementById(ids.title)?.value.trim() || "";
    const folderVal = ids.folder ? document.getElementById(ids.folder)?.value.trim() || "" : "";
    let rawSlug = "";
    if (ctx === "ms" && folderVal && titleVal) {
        rawSlug = slugify(`${folderVal}-${titleVal}`);
    } else {
        rawSlug = slugify(titleVal || folderVal);
    }
    const idInput = document.getElementById(ids.id);
    if (idInput) idInput.value = rawSlug;
    syncSlugPreview(ctx);
};

window.syncSlugPreview = function (ctx) {
    const ids = getContextIds(ctx);
    const val = document.getElementById(ids.id)?.value.trim() || "";
    const preview = document.getElementById(ids.preview);
    if (preview) preview.textContent = val || "auto-generated";
    updateStagingContextBanner();
};

window.toggleSlugInput = function (ctx) {
    const ids = getContextIds(ctx);
    const input = document.getElementById(ids.id);
    if (!input) return;
    if (isContextEditing(ctx)) {
        const allow = confirm("⚠️ Editing an existing Doc ID will create a NEW duplicate URL instead of updating the current deck. Unlock anyway?");
        if (!allow) return;
        input.readOnly = false;
    }
    input.classList.toggle("hidden");
    if (!input.classList.contains("hidden")) {
        slugManuallyEdited[ctx] = true;
        input.focus();
    }
};

window.toggleWeeklyMode = function (mode) {
    weeklyIsEdit = mode === "edit";
    slugManuallyEdited.weekly = false;
    document.getElementById("lblWeeklyNew").className =
        mode === "new" ? "flex items-center gap-2 font-black text-xs cursor-pointer text-indigo-700" : "flex items-center gap-2 font-bold text-xs cursor-pointer text-slate-500 hover:text-indigo-600";
    document.getElementById("lblWeeklyEdit").className =
        mode === "edit" ? "flex items-center gap-2 font-black text-xs cursor-pointer text-indigo-700" : "flex items-center gap-2 font-bold text-xs cursor-pointer text-slate-500 hover:text-indigo-600";
    document.getElementById("weeklyEditBar").classList.toggle("hidden", !weeklyIsEdit);

    const idInput = document.getElementById("weeklyIdentifier");
    if (idInput) {
        idInput.readOnly = weeklyIsEdit;
        idInput.classList.add("hidden");
    }
    if (weeklyIsEdit) {
        populateExistingDropdowns();
        onSelectExistingDropdown("weekly");
    } else {
        resetDeckForm("weekly");
    }
    updateStagingContextBanner();
};

window.toggleMsMode = function (mode) {
    msIsEdit = mode === "edit";
    slugManuallyEdited.ms = false;
    document.getElementById("lblMsNew").className =
        mode === "new" ? "flex items-center gap-2 font-black text-xs cursor-pointer text-indigo-700" : "flex items-center gap-2 font-bold text-xs cursor-pointer text-slate-500 hover:text-indigo-600";
    document.getElementById("lblMsEdit").className =
        mode === "edit" ? "flex items-center gap-2 font-black text-xs cursor-pointer text-indigo-700" : "flex items-center gap-2 font-bold text-xs cursor-pointer text-slate-500 hover:text-indigo-600";
    document.getElementById("msEditBar").classList.toggle("hidden", !msIsEdit);

    const idInput = document.getElementById("msIdentifier");
    if (idInput) {
        idInput.readOnly = msIsEdit;
        idInput.classList.add("hidden");
    }
    if (msIsEdit) {
        populateExistingDropdowns();
        onSelectExistingDropdown("ms");
    } else {
        resetDeckForm("ms");
    }
    updateStagingContextBanner();
};

function resetDeckForm(ctx) {
    const ids = getContextIds(ctx);
    const clear = (elId, val = "") => {
        const el = document.getElementById(elId);
        if (el) el.value = val;
    };
    clear(ids.title, "");
    clear(ids.id, "");
    if (ids.folder) clear(ids.folder, "");
    clear(ids.pdfEn, "");
    clear(ids.pdfHi, "");
    clear(ids.pdfLabel, "");
    clear(ids.mode, ctx === "weekly" ? "quiz_only" : "study_quiz");
    syncSlugPreview(ctx);
}

function populateExistingDropdowns() {
    const weeklySel = document.getElementById("weeklyExistingSelect");
    const msSel = document.getElementById("msExistingSelect");

    const weeklyItems = browseDrillsCache.filter((d) => d.cadence === "weekly");
    const msItems = browseDrillsCache.filter((d) => d.cadence === "monthly" || d.cadence === "special");

    if (weeklySel) {
        const prev = weeklySel.value;
        weeklySel.innerHTML =
            weeklyItems.length === 0
                ? '<option value="">— No Weekly drills found yet —</option>'
                : weeklyItems
                      .map((d) => `<option value="${escapeHtml(d.docId)}">${escapeHtml(d.displayTitle || d.docId)} (${d.count} cards)</option>`)
                      .join("");
        if (prev && weeklyItems.some((x) => x.docId === prev)) weeklySel.value = prev;
    }

    if (msSel) {
        const prev = msSel.value;
        msSel.innerHTML =
            msItems.length === 0
                ? '<option value="">— No Monthly / Special decks found yet —</option>'
                : msItems
                      .map((d) => {
                          const tag = d.cadence === "monthly" ? "📥" : "🎯";
                          const fLabel = d.folderName ? `[${d.folderName}] ` : "";
                          return `<option value="${escapeHtml(d.docId)}">${tag} ${escapeHtml(fLabel + (d.displayTitle || d.docId))} (${d.count})</option>`;
                      })
                      .join("");
        if (prev && msItems.some((x) => x.docId === prev)) msSel.value = prev;
    }
}

window.onSelectExistingDropdown = function (ctx) {
    const ids = getContextIds(ctx);
    const selectedId = document.getElementById(ids.select)?.value;
    if (!selectedId) return;
    const meta = browseDrillsCache.find((d) => d.docId === selectedId);
    if (!meta) return;
    fillDeckFormFromMeta(ctx, meta);
};

function fillDeckFormFromMeta(ctx, d) {
    const ids = getContextIds(ctx);
    document.getElementById(ids.id).value = d.docId || "";
    document.getElementById(ids.title).value = d.displayTitle || d.date || "";
    if (ids.folder) document.getElementById(ids.folder).value = d.folderName || "";
    if (ids.cadence && (d.cadence === "monthly" || d.cadence === "special")) {
        document.getElementById(ids.cadence).value = d.cadence;
    }
    document.getElementById(ids.mode).value = d.deckMode || (ctx === "weekly" ? "quiz_only" : "study_quiz");
    document.getElementById(ids.pdfEn).value = d.pdfEmbedUrl_en || d.pdfEmbedUrl || "";
    document.getElementById(ids.pdfHi).value = d.pdfEmbedUrl_hi || "";
    document.getElementById(ids.pdfLabel).value = d.pdfLabel || "";
    syncSlugPreview(ctx);
}

// ==========================================
// 5. STAGING SYNC, CONTEXT BANNER & METRICS
// ==========================================
function syncStagingVisibility() {
    const stage = document.getElementById("caStagingArea");
    if (!stage) return;
    const isEditorTab = ["tab-daily", "tab-weekly", "tab-monthly-special"].includes(activeTabId);
    const shouldShow = isEditorTab && window.stagedNewsItems.length > 0;
    stage.classList.toggle("hidden", !shouldShow);
}

window.updateStagingContextBanner = function () {
    const badge = document.getElementById("stagedContextBadge");
    const btnTop = document.getElementById("btnPublishCA");
    const btnBottom = document.getElementById("btnPublishCABottom");
    if (!badge || !btnTop || !btnBottom) return;

    let label = "";
    let isEdit = false;
    if (activeStagingContext === "daily") {
        const dt = document.getElementById("dailyTargetDate")?.value || "";
        label = `Target: 📅 Daily (${dt})`;
    } else if (activeStagingContext === "weekly") {
        isEdit = weeklyIsEdit;
        const t = document.getElementById("weeklyDisplayTitle")?.value.trim() || document.getElementById("weeklyIdentifier")?.value.trim() || "New Weekly";
        label = `Target: ⚡ Weekly — ${t}`;
    } else {
        isEdit = msIsEdit;
        const cad = document.getElementById("msCadenceType")?.value === "special" ? "🎯 Special" : "📥 Monthly";
        const t = document.getElementById("msDisplayTitle")?.value.trim() || document.getElementById("msIdentifier")?.value.trim() || "New Deck";
        label = `Target: ${cad} — ${t}`;
    }

    badge.textContent = label;
    const btnHtml = isEdit ? "<span>💾</span> Save &amp; Overwrite Deck" : "<span>🚀</span> Commit Drop";
    const clsTop = isEdit
        ? "bg-amber-400 hover:bg-amber-300 text-slate-950 font-black py-2 px-4 rounded-xl shadow transition text-xs flex items-center gap-1.5"
        : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-2 px-4 rounded-xl shadow transition text-xs flex items-center gap-1.5";
    const clsBot = isEdit
        ? "bg-amber-400 hover:bg-amber-300 text-slate-950 font-black py-2 px-5 rounded-xl shadow transition text-xs flex items-center gap-1.5"
        : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-2 px-5 rounded-xl shadow transition text-xs flex items-center gap-1.5";

    btnTop.innerHTML = btnHtml;
    btnTop.className = clsTop;
    btnBottom.innerHTML = btnHtml;
    btnBottom.className = clsBot;
    updateStagingMetrics();
};

window.syncStagingFromDOM = function () {
    document.querySelectorAll(".ca-staged-card").forEach((el) => {
        const idx = parseInt(el.getAttribute("data-master-idx"), 10);
        if (isNaN(idx) || !window.stagedNewsItems[idx]) return;
        const item = window.stagedNewsItems[idx];

        const enBullets = el.querySelector(".ca-en-c").value.split("\n").map((b) => b.trim()).filter(Boolean);
        const hiBullets = el.querySelector(".ca-hi-c").value.split("\n").map((b) => b.trim()).filter(Boolean);
        const exams = el.querySelector(".ca-exams").value.split(",").map((s) => s.trim()).filter(Boolean);
        const ansIdx = Math.max(0, Math.min(3, parseInt(el.querySelector(".ca-mcq-ans").value, 10) || 0));

        item.emoji = el.querySelector(".ca-emj").value || "📰";
        item.category = el.querySelector(".ca-cat").value.trim() || "National & Global";
        item.category_hi = el.querySelector(".ca-hi-cat").value.trim();
        item.subCategory = el.querySelector(".ca-sub").value.trim() || "General";
        item.subCategory_hi = el.querySelector(".ca-sub-hi").value.trim();
        item.priority = el.querySelector(".ca-priority").value;
        item.targetExams = exams.length ? exams : ["SSC CGL", "IBPS PO"];
        item.oneLiner = el.querySelector(".ca-en-h").value.trim();
        item.oneLiner_hi = el.querySelector(".ca-hi-h").value.trim();
        item.contextBullets = enBullets;
        item.contextBullets_hi = hiBullets;
        item.impact = el.querySelector(".ca-en-imp").value.trim();
        item.impact_hi = el.querySelector(".ca-hi-imp").value.trim();
        item.staticBox = { facts: el.querySelector(".ca-en-st").value.trim() };
        item.staticBox_hi = { facts: el.querySelector(".ca-hi-st").value.trim() };
        item.mcq = {
            question: el.querySelector(".ca-mcq-en-q").value.trim(),
            options: [
                el.querySelector(".ca-mcq-en-o0").value.trim(),
                el.querySelector(".ca-mcq-en-o1").value.trim(),
                el.querySelector(".ca-mcq-en-o2").value.trim(),
                el.querySelector(".ca-mcq-en-o3").value.trim()
            ],
            correctIndex: ansIdx,
            explanation: el.querySelector(".ca-mcq-en-exp").value.trim()
        };
        item.mcq_hi = {
            question: el.querySelector(".ca-mcq-hi-q").value.trim(),
            options: [
                el.querySelector(".ca-mcq-hi-o0").value.trim(),
                el.querySelector(".ca-mcq-hi-o1").value.trim(),
                el.querySelector(".ca-mcq-hi-o2").value.trim(),
                el.querySelector(".ca-mcq-hi-o3").value.trim()
            ],
            correctIndex: ansIdx,
            explanation: el.querySelector(".ca-mcq-hi-exp").value.trim()
        };
    });
    updateStagingMetrics();
};

function updateStagingMetrics() {
    const total = window.stagedNewsItems.length;
    const translatedCount = window.stagedNewsItems.filter(isCardTranslated).length;
    const countEl = document.getElementById("stagedCount");
    const trEl = document.getElementById("stagedTranslatedBadge");
    const botEl = document.getElementById("bottomStagedSummary");
    const sizeBadge = document.getElementById("stagedSizeBadge");

    if (countEl) countEl.textContent = total;
    if (trEl) trEl.textContent = `HI: ${translatedCount}/${total}`;
    if (botEl) botEl.textContent = `${total} Card${total === 1 ? "" : "s"} Staged • HI Ready: ${translatedCount}/${total}`;

    const bytes = new Blob([JSON.stringify(window.stagedNewsItems)]).size;
    const kb = Math.round(bytes / 1024);
    if (sizeBadge) {
        if (activeStagingContext === "daily") {
            sizeBadge.textContent = `📦 ${kb} KB (Split Docs)`;
            sizeBadge.className = "text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-emerald-300";
        } else if (kb >= 850) {
            sizeBadge.textContent = `🚨 ${kb} KB / 900 KB DANGER (Split Part 2!)`;
            sizeBadge.className = "text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full bg-rose-600 text-white animate-pulse";
        } else if (kb >= 680) {
            sizeBadge.textContent = `⚠️ ${kb} KB / 900 KB Heavy`;
            sizeBadge.className = "text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950";
        } else {
            sizeBadge.textContent = `📦 ${kb} KB / 900 KB Safe`;
            sizeBadge.className = "text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-emerald-300";
        }
    }
}

// ==========================================
// 6. JSON INGESTION & STAGING RENDERER
// ==========================================
window.openPasteModal = (ctx = activeStagingContext) => {
    pendingPasteContext = ctx;
    activeStagingContext = ctx;
    document.getElementById("rawJsonInput").value = "";
    document.getElementById("jsonPasteModal").classList.remove("hidden");
};
window.closePasteModal = () => document.getElementById("jsonPasteModal").classList.add("hidden");

window.ingestFromClipboard = async (ctx = activeStagingContext) => {
    pendingPasteContext = ctx;
    activeStagingContext = ctx;
    try {
        const text = await navigator.clipboard.readText();
        if (!text) throw new Error("Clipboard is empty.");
        parseAndStagePayload(text, ctx);
    } catch (err) {
        openPasteModal(ctx);
    }
};

window.processPastedJson = () => {
    const raw = document.getElementById("rawJsonInput").value;
    if (!raw.trim()) return alert("Paste JSON first.");
    parseAndStagePayload(raw, pendingPasteContext);
    closePasteModal();
};

function parseAndStagePayload(rawText, ctx = activeStagingContext) {
    try {
        syncStagingFromDOM();
        let cleaned = rawText
            .replace(/\[cite:[^\]]*\]/g, "")
            .replace(/\[\d+\]/g, "")
            .replace(/\$\$(B|R|G)\$\$/g, "")
            .replace(/\$\$\/(B|R|G)\$\$/g, "")
            .replace(/\$(B|R|G)\$/g, "")
            .replace(/\$\/(B|R|G)\$/g, "")
            .trim();

        const start = cleaned.indexOf("[");
        const end = cleaned.lastIndexOf("]");
        if (start !== -1 && end !== -1) cleaned = cleaned.substring(start, end + 1);

        const parsed = JSON.parse(cleaned);
        const cards = Array.isArray(parsed) ? parsed : parsed.news || parsed.data || Object.values(parsed)[0];
        if (!Array.isArray(cards) || cards.length === 0) throw new Error("Expected a non-empty JSON array of cards.");

        const normalized = cards.map(normalizeCard);
        const hasAnyNotes = normalized.some((c) => c.oneLiner || c.contextBullets.length > 0);
        if ((ctx === "ms" || ctx === "weekly") && !hasAnyNotes && window.stagedNewsItems.length === 0) {
            const ids = getContextIds(ctx);
            const modeEl = document.getElementById(ids.mode);
            if (modeEl) modeEl.value = "quiz_only";
        }

        window.stagedNewsItems = [...window.stagedNewsItems, ...normalized];
        window.activeStagingFilter = "all";
        activeStagingContext = ctx;
        renderStagingCards();
        updateStagingContextBanner();
    } catch (err) {
        alert("Failed to ingest JSON: " + err.message);
    }
}

window.clearStagingArea = function () {
    if (window.stagedNewsItems.length === 0) return;
    if (!confirm("Clear all cards from the staging area?")) return;
    window.stagedNewsItems = [];
    window.activeStagingFilter = "all";
    document.getElementById("caCardsContainer").innerHTML = "";
    syncStagingVisibility();
    updateStagingMetrics();
};

window.removeStagedCard = function (masterIdx) {
    syncStagingFromDOM();
    window.stagedNewsItems.splice(masterIdx, 1);
    if (window.stagedNewsItems.length === 0) {
        document.getElementById("caCardsContainer").innerHTML = "";
        syncStagingVisibility();
        updateStagingMetrics();
        return;
    }
    renderStagingCards();
};

window.setStagingFilter = function (cat) {
    syncStagingFromDOM();
    window.activeStagingFilter = cat;
    renderStagingCards();
};

function renderStagingCards() {
    syncStagingVisibility();
    updateStagingMetrics();

    const categories = Array.from(new Set(window.stagedNewsItems.map((i) => i.category || "General"))).sort();
    if (window.activeStagingFilter !== "all" && !categories.includes(window.activeStagingFilter)) {
        window.activeStagingFilter = "all";
    }

    const pillsContainer = document.getElementById("stagingCategoryPills");
    let pillsHtml = `<button onclick="setStagingFilter('all')" class="px-3 py-1.5 rounded-xl font-bold text-xs transition ${
        window.activeStagingFilter === "all" ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
    }">All (${window.stagedNewsItems.length})</button>`;
    categories.forEach((cat) => {
        const count = window.stagedNewsItems.filter((i) => (i.category || "General") === cat).length;
        pillsHtml += `<button onclick="setStagingFilter('${escapeJsStr(cat)}')" class="px-3 py-1.5 rounded-xl font-bold text-xs transition ${
            window.activeStagingFilter === cat ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
        }">${escapeHtml(cat)} (${count})</button>`;
    });
    pillsContainer.innerHTML = pillsHtml;

    const list = document.getElementById("caCardsContainer");
    const indexedVisible = window.stagedNewsItems
        .map((card, masterIdx) => ({ card, masterIdx }))
        .filter((entry) => window.activeStagingFilter === "all" || (entry.card.category || "General") === window.activeStagingFilter);

    let html = "";
    indexedVisible.forEach(({ card, masterIdx }) => {
        const exams = (card.targetExams || ["SSC CGL", "IBPS PO"]).join(", ");
        const mcqEn = card.mcq || { question: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" };
        const mcqHi = card.mcq_hi || { question: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" };
        const translated = isCardTranslated(card);
        const statusPill = translated
            ? `<span class="text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">✅ HI Ready</span>`
            : `<span class="text-[10px] font-black bg-amber-100 text-amber-800 px-2 py-0.5 rounded">⏳ Needs HI</span>`;

        html += `
        <div class="bg-white border border-slate-300 p-5 rounded-2xl ca-staged-card space-y-4 shadow-xs" data-master-idx="${masterIdx}">
            <div class="flex flex-wrap justify-between items-center gap-2 pb-2.5 border-b border-slate-200">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs font-black text-indigo-700 uppercase bg-indigo-50 px-2.5 py-1 rounded-lg">#${masterIdx + 1} &bull; ${escapeHtml(card.emoji || "📰")} ${escapeHtml(card.category || "")}</span>
                    ${statusPill}
                    <select class="ca-priority border border-slate-300 rounded-lg px-2 py-1 text-[11px] font-bold bg-slate-50">
                        <option value="high" ${card.priority === "high" ? "selected" : ""}>⭐ High Priority</option>
                        <option value="standard" ${card.priority === "standard" ? "selected" : ""}>• Standard</option>
                        <option value="" ${!card.priority ? "selected" : ""}>— Unset Priority</option>
                    </select>
                </div>
                <div class="flex items-center gap-2">
                    <input type="text" class="ca-exams border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold w-44" value="${escapeHtml(exams)}" title="Target Exams">
                    <button onclick="removeStagedCard(${masterIdx})" class="text-rose-600 hover:bg-rose-50 font-bold text-xs px-2.5 py-1 rounded-lg transition">🗑️ Remove</button>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="font-black text-xs text-indigo-600 uppercase">English Content</span>
                        <div class="flex gap-1.5">
                            <input type="text" class="ca-emj border rounded px-1.5 py-0.5 text-xs w-10 text-center" value="${escapeHtml(card.emoji || "📰")}" title="Emoji">
                            <input type="text" class="ca-cat border rounded px-2 py-0.5 text-[11px] font-bold w-36" value="${escapeHtml(card.category || "")}" placeholder="Category">
                            <input type="text" class="ca-sub border rounded px-2 py-0.5 text-[11px] w-28" value="${escapeHtml(card.subCategory || "")}" placeholder="Sub-Cat">
                        </div>
                    </div>
                    <div><label class="text-[10px] font-bold text-slate-500 uppercase">Headline (Blank for Quiz-Only)</label>
                    <input type="text" class="ca-en-h w-full border rounded-lg p-2 text-sm font-bold bg-slate-50/50" value="${escapeHtml(card.oneLiner || "")}"></div>
                    <div><label class="text-[10px] font-bold text-slate-500 uppercase">Bullets (1 per line)</label>
                    <textarea class="ca-en-c w-full border rounded-lg p-2 text-xs bg-slate-50/50" rows="3">${escapeHtml((card.contextBullets || []).join("\n"))}</textarea></div>
                    <div class="grid grid-cols-2 gap-2">
                        <div><label class="text-[10px] font-bold text-slate-500 uppercase">Exam Impact</label>
                        <input type="text" class="ca-en-imp w-full border rounded-lg p-2 text-xs bg-slate-50/50" value="${escapeHtml(card.impact || "")}"></div>
                        <div><label class="text-[10px] font-bold text-slate-500 uppercase">Static Facts</label>
                        <input type="text" class="ca-en-st w-full border rounded-lg p-2 text-xs bg-slate-50/50" value="${escapeHtml(card.staticBox?.facts || "")}"></div>
                    </div>
                </div>

                <div class="space-y-2 bg-emerald-50/40 p-3 rounded-xl border border-emerald-100">
                    <div class="flex items-center justify-between">
                        <span class="font-black text-xs text-emerald-700 uppercase">Hindi Content (हिंदी)</span>
                        <div class="flex gap-1.5">
                            <input type="text" class="ca-hi-cat border border-emerald-200 rounded px-2 py-0.5 text-[11px] font-bold bg-white w-36" value="${escapeHtml(card.category_hi || "")}" placeholder="श्रेणी">
                            <input type="text" class="ca-sub-hi border border-emerald-200 rounded px-2 py-0.5 text-[11px] bg-white w-28" value="${escapeHtml(card.subCategory_hi || "")}" placeholder="उप-श्रेणी">
                        </div>
                    </div>
                    <div><label class="text-[10px] font-bold text-emerald-800 uppercase">Headline (HI)</label>
                    <input type="text" class="ca-hi-h w-full border border-emerald-200 rounded-lg p-2 text-sm font-bold bg-white" value="${escapeHtml(card.oneLiner_hi || "")}"></div>
                    <div><label class="text-[10px] font-bold text-emerald-800 uppercase">Bullets (HI)</label>
                    <textarea class="ca-hi-c w-full border border-emerald-200 rounded-lg p-2 text-xs bg-white" rows="3">${escapeHtml((card.contextBullets_hi || []).join("\n"))}</textarea></div>
                    <div class="grid grid-cols-2 gap-2">
                        <div><label class="text-[10px] font-bold text-emerald-800 uppercase">Exam Impact (HI)</label>
                        <input type="text" class="ca-hi-imp w-full border border-emerald-200 rounded-lg p-2 text-xs bg-white" value="${escapeHtml(card.impact_hi || "")}"></div>
                        <div><label class="text-[10px] font-bold text-emerald-800 uppercase">Static Facts (HI)</label>
                        <input type="text" class="ca-hi-st w-full border border-emerald-200 rounded-lg p-2 text-xs bg-white" value="${escapeHtml(card.staticBox_hi?.facts || "")}"></div>
                    </div>
                </div>
            </div>

            <div class="pt-3 border-t border-slate-200">
                <div class="flex justify-between items-center mb-2">
                    <span class="font-black text-xs text-purple-700 uppercase">⚡ Verification MCQ</span>
                    <div class="text-xs font-bold flex items-center gap-2 text-slate-700">
                        Correct Index (0–3):
                        <input type="number" class="ca-mcq-ans w-14 border border-purple-300 rounded-lg p-1 text-center font-mono font-black bg-purple-50" min="0" max="3" value="${mcqEn.correctIndex ?? 0}">
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="space-y-2 bg-purple-50/50 p-3 rounded-xl border border-purple-100">
                        <input type="text" class="ca-mcq-en-q w-full border rounded p-1.5 text-xs font-bold bg-white" placeholder="EN Question" value="${escapeHtml(mcqEn.question || "")}">
                        <div class="grid grid-cols-2 gap-2">
                            <input type="text" class="ca-mcq-en-o0 border rounded p-1 text-xs bg-white" placeholder="Opt A" value="${escapeHtml(mcqEn.options?.[0] || "")}">
                            <input type="text" class="ca-mcq-en-o1 border rounded p-1 text-xs bg-white" placeholder="Opt B" value="${escapeHtml(mcqEn.options?.[1] || "")}">
                            <input type="text" class="ca-mcq-en-o2 border rounded p-1 text-xs bg-white" placeholder="Opt C" value="${escapeHtml(mcqEn.options?.[2] || "")}">
                            <input type="text" class="ca-mcq-en-o3 border rounded p-1 text-xs bg-white" placeholder="Opt D" value="${escapeHtml(mcqEn.options?.[3] || "")}">
                        </div>
                        <input type="text" class="ca-mcq-en-exp w-full border rounded p-1.5 text-xs bg-white" placeholder="Explanation (EN)" value="${escapeHtml(mcqEn.explanation || "")}">
                    </div>
                    <div class="space-y-2 bg-emerald-50/50 p-3 rounded-xl border border-emerald-100">
                        <input type="text" class="ca-mcq-hi-q w-full border border-emerald-200 rounded p-1.5 text-xs font-bold bg-white" placeholder="HI Question" value="${escapeHtml(mcqHi.question || "")}">
                        <div class="grid grid-cols-2 gap-2">
                            <input type="text" class="ca-mcq-hi-o0 border border-emerald-200 rounded p-1 text-xs bg-white" placeholder="विकल्प A" value="${escapeHtml(mcqHi.options?.[0] || "")}">
                            <input type="text" class="ca-mcq-hi-o1 border border-emerald-200 rounded p-1 text-xs bg-white" placeholder="विकल्प B" value="${escapeHtml(mcqHi.options?.[1] || "")}">
                            <input type="text" class="ca-mcq-hi-o2 border border-emerald-200 rounded p-1 text-xs bg-white" placeholder="विकल्प C" value="${escapeHtml(mcqHi.options?.[2] || "")}">
                            <input type="text" class="ca-mcq-hi-o3 border border-emerald-200 rounded p-1 text-xs bg-white" placeholder="विकल्प D" value="${escapeHtml(mcqHi.options?.[3] || "")}">
                        </div>
                        <input type="text" class="ca-mcq-hi-exp w-full border border-emerald-200 rounded p-1.5 text-xs bg-white" placeholder="व्याख्या (HI)" value="${escapeHtml(mcqHi.explanation || "")}">
                    </div>
                </div>
            </div>
        </div>`;
    });

    list.innerHTML = "";
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const nodes = Array.from(temp.children);
    let idx = 0;
    function paintChunk() {
        const end = Math.min(idx + 12, nodes.length);
        for (let i = idx; i < end; i++) list.appendChild(nodes[i]);
        idx += 12;
        if (idx < nodes.length) requestAnimationFrame(paintChunk);
    }
    requestAnimationFrame(paintChunk);
}

// ==========================================
// 7. SMART SKIP TRANSLATION
// ==========================================
window.autoTranslateCA = async function (forceAll = false) {
    syncStagingFromDOM();
    if (window.stagedNewsItems.length === 0) return alert("No cards in staging.");
    if (forceAll && !confirm(`Re-translate ALL ${window.stagedNewsItems.length} cards from scratch?`)) return;

    const btnMain = document.getElementById("btnAutoTranslateCA");
    const btnForce = document.getElementById("btnForceTranslateCA");
    const origMain = btnMain.innerHTML;
    btnMain.disabled = true;
    btnForce.disabled = true;

    const targets = [];
    let skipped = 0;
    window.stagedNewsItems.forEach((card, i) => {
        if (!forceAll && isCardTranslated(card)) skipped++;
        else targets.push(i);
    });

    if (targets.length === 0) {
        btnMain.disabled = false;
        btnForce.disabled = false;
        return alert(`✅ All ${skipped} cards already have Hindi translations!`);
    }

    let done = 0;
    try {
        for (const masterIdx of targets) {
            done++;
            btnMain.innerHTML = `<span>⏳</span> ${done}/${targets.length} (Skipped ${skipped})`;
            const card = window.stagedNewsItems[masterIdx];
            const fields = [
                card.category || "",
                card.subCategory || "",
                card.oneLiner || "",
                (card.contextBullets || []).join(" | "),
                card.impact || "",
                card.staticBox?.facts || "",
                card.mcq?.question || "",
                card.mcq?.options?.[0] || "",
                card.mcq?.options?.[1] || "",
                card.mcq?.options?.[2] || "",
                card.mcq?.options?.[3] || "",
                card.mcq?.explanation || ""
            ];
            const translatedStr = await translateEnToHi(fields.join(" ||| "));
            if (translatedStr) {
                const parts = translatedStr.split(/\s*\|\|\|\s*/);
                card.category_hi = (parts[0] || card.category || "").trim();
                card.subCategory_hi = (parts[1] || card.subCategory || "").trim();
                card.oneLiner_hi = (parts[2] || "").trim();
                card.contextBullets_hi = (parts[3] || "").split(/\s*\|\s*/).map((b) => b.trim()).filter(Boolean);
                card.impact_hi = (parts[4] || "").trim();
                card.staticBox_hi = { facts: (parts[5] || "").trim() };
                card.mcq_hi = {
                    question: (parts[6] || "").trim(),
                    options: [(parts[7] || "").trim(), (parts[8] || "").trim(), (parts[9] || "").trim(), (parts[10] || "").trim()],
                    correctIndex: card.mcq?.correctIndex ?? 0,
                    explanation: (parts[11] || "").trim()
                };
            }
            await delay(250);
        }
        renderStagingCards();
        alert(`✅ Smart Translation Complete! Translated ${done} new card(s), skipped ${skipped} already translated.`);
    } catch (err) {
        alert("Translation interrupted: " + err.message);
        renderStagingCards();
    } finally {
        btnMain.innerHTML = origMain;
        btnMain.disabled = false;
        btnForce.disabled = false;
    }
};

// ==========================================
// 8. PUBLISH / SAVE INFO ONLY / FETCH / DELETE (REST READS + MERGE WRITES)
// ==========================================
window.publishStagedNews = async function () {
    syncStagingFromDOM();
    if (window.stagedNewsItems.length === 0) return alert("No cards in staging.");

    if (window.activeStagingFilter !== "all") {
        if (!confirm(`Note: You are viewing only "${window.activeStagingFilter}", but ALL ${window.stagedNewsItems.length} staged cards will be committed.\n\nProceed?`)) return;
    }

    const btnTop = document.getElementById("btnPublishCA");
    const btnBot = document.getElementById("btnPublishCABottom");
    btnTop.disabled = true;
    btnBot.disabled = true;
    btnTop.innerHTML = "⏳ Saving...";
    btnBot.innerHTML = "⏳ Saving...";

    try {
        if (activeStagingContext === "daily") {
            const targetDate = document.getElementById("dailyTargetDate").value;
            if (!targetDate) throw new Error("Select a Target Date in Daily Upload.");

            const existing = await restFetchDailyByDate(targetDate);
            if (existing.length > 0) {
                if (!confirm(`⚠️ ${existing.length} Daily cards already exist for ${targetDate}.\n\nAppend these ${window.stagedNewsItems.length} staged cards?`)) return;
            }

            const scheduleMode = document.getElementById("dailyReleaseSchedule").value;
            let publishTimestamp = new Date();
            if (scheduleMode === "6am") {
                const [y, m, d] = targetDate.split("-").map(Number);
                publishTimestamp = new Date(Date.UTC(y, m - 1, d, 0, 30, 0));
            }

            const batch = writeBatch(db);
            window.stagedNewsItems.forEach((card) => {
                const ref = doc(collection(db, "daily_news"));
                batch.set(ref, {
                    date: targetDate,
                    cadence: "daily",
                    publishAt: publishTimestamp.toISOString(),
                    timestamp: serverTimestamp(),
                    ...card
                });
            });
            await batch.commit();
            alert(`✅ Published ${window.stagedNewsItems.length} Daily CA cards for ${targetDate}!`);
        } else {
            const ctx = activeStagingContext; // 'weekly' | 'ms'
            const ids = getContextIds(ctx);
            const displayTitle = document.getElementById(ids.title).value.trim();
            let docId = document.getElementById(ids.id).value.trim();
            if (!docId && displayTitle) {
                docId = slugify(displayTitle);
                document.getElementById(ids.id).value = docId;
                syncSlugPreview(ctx);
            }
            if (!docId) throw new Error("Enter a Display Title (or URL Slug) before saving.");

            const payloadBytes = new Blob([JSON.stringify(window.stagedNewsItems)]).size;
            if (payloadBytes > 950000) {
                throw new Error(`Payload is ${Math.round(payloadBytes / 1024)} KB — too close to Firestore's 1 MB limit! Split into a Part 2 deck.`);
            }

            if (!isContextEditing(ctx)) {
                const existingDoc = await restGetDoc("ca_drills", docId);
                if (existingDoc) {
                    if (!confirm(`⚠️ A deck with ID "${docId}" already exists (${existingDoc.count || 0} cards).\n\nOverwrite it with these ${window.stagedNewsItems.length} cards?`)) return;
                }
            }

            const cadence = ctx === "weekly" ? "weekly" : document.getElementById(ids.cadence).value;
            const folderName = ids.folder ? document.getElementById(ids.folder).value.trim() : "";
            const deckMode = document.getElementById(ids.mode).value;
            const pdfEn = document.getElementById(ids.pdfEn).value.trim();
            const pdfHi = document.getElementById(ids.pdfHi).value.trim();
            const pdfLabel = document.getElementById(ids.pdfLabel).value.trim();

            // { merge: true } guarantees folderPdfUrl_en / folderPdfUrl_hi / folderPdfLabel are NEVER wiped!
            await setDoc(
                doc(db, "ca_drills", docId),
                {
                    docType: "summary",
                    date: docId,
                    cadence,
                    displayTitle: displayTitle || docId.replace(/[-_]+/g, " "),
                    folderName: folderName || "",
                    deckMode,
                    pdfEmbedUrl_en: pdfEn || null,
                    pdfEmbedUrl_hi: pdfHi || null,
                    pdfLabel: pdfLabel || null,
                    count: window.stagedNewsItems.length,
                    cards: window.stagedNewsItems,
                    timestamp: serverTimestamp()
                },
                { merge: true }
            );

            alert(`✅ Saved ${cadence.toUpperCase()} deck "${displayTitle || docId}" (${window.stagedNewsItems.length} cards)!`);
            await fetchAllDrillsMetadata();
            populateExistingDropdowns();
        }

        window.stagedNewsItems = [];
        window.activeStagingFilter = "all";
        document.getElementById("caCardsContainer").innerHTML = "";
        syncStagingVisibility();
    } catch (err) {
        alert("Save Error: " + err.message);
    } finally {
        btnTop.disabled = false;
        btnBot.disabled = false;
        updateStagingContextBanner();
    }
};

window.saveDrillInfoOnly = async function (ctx) {
    const ids = getContextIds(ctx);
    const docId = document.getElementById(ids.id).value.trim() || document.getElementById(ids.select)?.value;
    if (!docId) return alert("Select an existing drill first.");

    const btn = document.getElementById(ids.btnSaveInfo);
    const orig = btn.innerHTML;
    btn.innerHTML = "⏳ Saving...";
    btn.disabled = true;

    try {
        const displayTitle = document.getElementById(ids.title).value.trim();
        const cadence = ctx === "weekly" ? "weekly" : document.getElementById(ids.cadence).value;
        const folderName = ids.folder ? document.getElementById(ids.folder).value.trim() : "";
        const deckMode = document.getElementById(ids.mode).value;
        const pdfEn = document.getElementById(ids.pdfEn).value.trim();
        const pdfHi = document.getElementById(ids.pdfHi).value.trim();
        const pdfLabel = document.getElementById(ids.pdfLabel).value.trim();

        await updateDoc(doc(db, "ca_drills", docId), {
            cadence,
            displayTitle: displayTitle || docId.replace(/[-_]+/g, " "),
            folderName: folderName || "",
            deckMode,
            pdfEmbedUrl_en: pdfEn || null,
            pdfEmbedUrl_hi: pdfHi || null,
            pdfLabel: pdfLabel || null
        });

        await fetchAllDrillsMetadata();
        populateExistingDropdowns();
        alert(`✅ Updated metadata & links for "${displayTitle || docId}" in 1 second without touching any cards!`);
    } catch (err) {
        alert("Save Info Error: " + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

window.fetchDrillForContext = async function (ctx) {
    const ids = getContextIds(ctx);
    const docId = document.getElementById(ids.id).value.trim() || document.getElementById(ids.select)?.value;
    if (!docId) return alert("Select or enter a Drill ID to fetch.");

    const btn = document.getElementById(ids.btnFetch);
    const orig = btn.innerHTML;
    btn.innerHTML = "⏳ Fetching...";
    btn.disabled = true;

    try {
        let d = await restGetDoc("ca_drills", docId);
        if (!d) {
            const matches = await restRunQuery({
                from: [{ collectionId: "ca_drills" }],
                where: { fieldFilter: { field: { fieldPath: "date" }, op: "EQUAL", value: { stringValue: docId } } }
            });
            if (matches.length > 0) d = matches[0];
        }
        if (!d) return alert(`No drill found for ID "${docId}".`);

        fillDeckFormFromMeta(ctx, d);
        if (!Array.isArray(d.cards)) return alert("This drill does not contain a cards array.");

        activeStagingContext = ctx;
        window.stagedNewsItems = d.cards.map(normalizeCard);
        window.activeStagingFilter = "all";
        renderStagingCards();
        updateStagingContextBanner();
        alert(`✅ Loaded "${d.displayTitle || d.docId}" (${window.stagedNewsItems.length} cards) via REST API!`);
    } catch (err) {
        alert("Fetch Error: " + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

window.deleteDrillByContext = async function (ctx) {
    const ids = getContextIds(ctx);
    const docId = document.getElementById(ids.id).value.trim() || document.getElementById(ids.select)?.value;
    if (!docId) return alert("Select a drill to delete.");
    if (!confirm(`⚠️ PERMANENT DELETE: Wipe "${docId}" from Firestore? This cannot be undone.`)) return;

    const btn = document.getElementById(ids.btnDelete);
    const orig = btn.innerHTML;
    btn.innerHTML = "⏳...";
    btn.disabled = true;

    try {
        const batch = writeBatch(db);
        const idsToDelete = new Set();

        const directDoc = await restGetDoc("ca_drills", docId);
        if (directDoc) idsToDelete.add(directDoc.docId);

        const matches = await restRunQuery({
            from: [{ collectionId: "ca_drills" }],
            where: { fieldFilter: { field: { fieldPath: "date" }, op: "EQUAL", value: { stringValue: docId } } }
        });
        matches.forEach((m) => idsToDelete.add(m.docId));

        if (idsToDelete.size === 0) return alert(`No document found matching "${docId}".`);
        idsToDelete.forEach((id) => batch.delete(doc(db, "ca_drills", id)));
        await batch.commit();

        window.stagedNewsItems = [];
        document.getElementById("caCardsContainer").innerHTML = "";
        syncStagingVisibility();
        resetDeckForm(ctx);
        await fetchAllDrillsMetadata();
        populateExistingDropdowns();
        alert(`✅ Deleted "${docId}" cleanly (${idsToDelete.size} document(s) removed)!`);
    } catch (err) {
        alert("Delete Error: " + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

// ==========================================
// 9. ON-PAGE WEEKLY DATE-RANGE PICKER (REST)
// ==========================================
let wpFetchedItems = [];
let wpSelectedIds = new Set();

window.fetchDailyRangeForPicker = async function () {
    const start = document.getElementById("wpStartDate").value;
    const end = document.getElementById("wpEndDate").value;
    if (!start || !end || start > end) return alert("Select a valid Start and End date.");

    const btn = document.getElementById("btnFetchDateRange");
    const orig = btn.innerHTML;
    btn.innerHTML = "⏳ Fetching...";
    btn.disabled = true;
    document.getElementById("wpListContainer").innerHTML =
        '<div class="text-center py-8 text-indigo-500 text-xs font-bold animate-pulse">Querying daily_news via REST API...</div>';

    try {
        const docs = await restFetchDailyRange(start, end);
        wpFetchedItems = docs
            .map((d) => ({ _docId: d.docId, _date: d.date || "", ...normalizeCard(d) }))
            .sort((a, b) => a._date.localeCompare(b._date) || (a.category || "").localeCompare(b.category || ""));

        wpSelectedIds.clear();
        const hasAnyPriority = wpFetchedItems.some((i) => i.priority === "high" || i.priority === "standard");
        wpFetchedItems.forEach((item) => {
            if (!hasAnyPriority || item.priority === "high") wpSelectedIds.add(item._docId);
        });

        renderWeeklyPickerList();
    } catch (err) {
        document.getElementById("wpListContainer").innerHTML = `<div class="text-center py-8 text-rose-500 text-xs font-bold">Error: ${escapeHtml(err.message)}</div>`;
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

window.renderWeeklyPickerList = function () {
    const catFilter = document.getElementById("wpCategoryFilter").value;
    const visible = catFilter === "all" ? wpFetchedItems : wpFetchedItems.filter((i) => i.category === catFilter);
    const wrap = document.getElementById("wpListContainer");

    const selectedVisible = visible.filter((i) => wpSelectedIds.has(i._docId)).length;
    document.getElementById("wpSelectedSummary").textContent = `${wpSelectedIds.size} Selected (${selectedVisible}/${visible.length} shown)`;

    if (visible.length === 0) {
        wrap.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs font-bold bg-white/80 rounded-xl border border-dashed border-amber-300">No Daily CA cards found for this date range / category.</div>';
        return;
    }

    wrap.innerHTML = visible
        .map((item) => {
            const checked = wpSelectedIds.has(item._docId);
            const prioBadge =
                item.priority === "high"
                    ? '<span class="text-[10px] font-black bg-amber-100 text-amber-800 px-2 py-0.5 rounded">⭐ HIGH</span>'
                    : item.priority === "standard"
                    ? '<span class="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded">STD</span>'
                    : '<span class="text-[10px] font-bold bg-slate-100 text-slate-400 px-2 py-0.5 rounded">LEGACY</span>';
            const hiBadge = isCardTranslated(item)
                ? '<span class="text-[10px] font-bold text-emerald-700">✅ HI</span>'
                : '<span class="text-[10px] font-bold text-amber-600">No HI</span>';

            return `
            <label class="flex items-start gap-3 p-2.5 rounded-xl border transition cursor-pointer ${
                checked ? "bg-white border-indigo-300 shadow-xs" : "bg-white/50 border-slate-200 opacity-65"
            }">
                <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleWpItem('${escapeJsStr(item._docId)}', this.checked)" class="mt-0.5 accent-indigo-600 w-4 h-4 flex-shrink-0">
                <div class="flex-grow min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <span class="text-[10px] font-mono font-bold text-slate-400">${escapeHtml(item._date)}</span>
                        <span class="text-[10px] font-black text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">${escapeHtml(item.category)}</span>
                        ${prioBadge} ${hiBadge}
                    </div>
                    <div class="text-xs font-bold text-slate-900 leading-snug">${escapeHtml(item.oneLiner || item.mcq?.question || "Untitled Card")}</div>
                </div>
            </label>`;
        })
        .join("");
};

window.toggleWpItem = function (docId, isChecked) {
    if (isChecked) wpSelectedIds.add(docId);
    else wpSelectedIds.delete(docId);
    renderWeeklyPickerList();
};

window.wpQuickSelect = function (mode) {
    const catFilter = document.getElementById("wpCategoryFilter").value;
    const visible = catFilter === "all" ? wpFetchedItems : wpFetchedItems.filter((i) => i.category === catFilter);
    visible.forEach((i) => {
        if (mode === "all") wpSelectedIds.add(i._docId);
        else if (mode === "none") wpSelectedIds.delete(i._docId);
        else if (mode === "high") {
            if (i.priority === "high") wpSelectedIds.add(i._docId);
            else wpSelectedIds.delete(i._docId);
        }
    });
    renderWeeklyPickerList();
};

window.loadWeeklyPickerToStaging = function () {
    syncStagingFromDOM();
    const chosen = wpFetchedItems.filter((i) => wpSelectedIds.has(i._docId));
    if (chosen.length === 0) return alert("Select at least one card first.");

    const existingKeys = new Set(window.stagedNewsItems.map((c) => normalizeHeadlineKey(c.oneLiner || c.mcq?.question)));
    let added = 0;
    let dupes = 0;
    chosen.forEach((item) => {
        const { _docId, _date, ...cleanCard } = item;
        const key = normalizeHeadlineKey(cleanCard.oneLiner || cleanCard.mcq?.question);
        if (key && existingKeys.has(key)) {
            dupes++;
            return;
        }
        if (key) existingKeys.add(key);
        window.stagedNewsItems.push(cleanCard);
        added++;
    });

    activeStagingContext = "weekly";
    window.activeStagingFilter = "all";
    renderStagingCards();
    updateStagingContextBanner();
    alert(`✅ Loaded ${added} Daily CA cards into Weekly staging!${dupes ? ` (${dupes} duplicate(s) skipped)` : ""}`);
};

// ==========================================
// 10. 1-CLICK AUTO-SPLIT MONTH INTO CATEGORY DECKS
// ==========================================
let autoSplitGroupsCache = [];

window.toggleAutoSplitPanel = function () {
    document.getElementById("autoSplitMonthPanel").classList.toggle("hidden");
};

window.previewAutoSplitMonth = async function () {
    const start = document.getElementById("asStartDate").value;
    const end = document.getElementById("asEndDate").value;
    const folderName = document.getElementById("asFolderName").value.trim();
    const prioFilter = document.getElementById("asPriorityFilter").value;

    if (!start || !end || start > end) return alert("Select a valid Month Start and End date.");
    if (!folderName) return alert("Enter a Target Month Folder name (e.g., November 2026).");

    const btn = document.getElementById("btnPreviewAutoSplit");
    const orig = btn.innerHTML;
    btn.innerHTML = "⏳ Scanning...";
    btn.disabled = true;

    try {
        const docs = await restFetchDailyRange(start, end);
        let cards = docs.map(normalizeCard);
        if (prioFilter === "high") cards = cards.filter((c) => c.priority === "high");

        if (cards.length === 0) {
            document.getElementById("autoSplitPreviewBox").classList.add("hidden");
            return alert("No Daily CA cards found for that date range and filter.");
        }

        const groupsMap = {};
        cards.forEach((c) => {
            const cat = (c.category || "General").trim();
            if (!groupsMap[cat]) groupsMap[cat] = [];
            groupsMap[cat].push(c);
        });

        autoSplitGroupsCache = Object.entries(groupsMap)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([cat, list]) => ({
                category: cat,
                folderName,
                docId: slugify(`${folderName}-${cat}`),
                cards: list
            }));

        const listEl = document.getElementById("autoSplitSummaryList");
        listEl.innerHTML = autoSplitGroupsCache
            .map(
                (g) => `
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col justify-between">
                <div class="font-black text-slate-900">${escapeHtml(g.cards[0]?.emoji || "📌")} ${escapeHtml(g.category)}</div>
                <div class="text-[10px] font-mono text-slate-400 mt-0.5 truncate">${escapeHtml(g.docId)}</div>
                <div class="text-xs font-black text-emerald-700 mt-1.5">${g.cards.length} Cards</div>
            </div>`
            )
            .join("");

        document.getElementById("autoSplitPreviewBox").classList.remove("hidden");
    } catch (err) {
        alert("Auto-Split Preview Error: " + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

window.commitAutoSplitMonth = async function () {
    if (autoSplitGroupsCache.length === 0) return alert("Run Preview Split first.");
    const folderName = autoSplitGroupsCache[0].folderName;
    const totalCards = autoSplitGroupsCache.reduce((s, g) => s + g.cards.length, 0);
    if (!confirm(`Commit ${autoSplitGroupsCache.length} Monthly Category Decks (${totalCards} cards total) into folder "${folderName}"?\n\nExisting decks with the same slug will be safely merged & deduplicated.`)) {
        return;
    }

    const btn = document.getElementById("btnCommitAutoSplit");
    const orig = btn.innerHTML;
    btn.disabled = true;

    try {
        let createdOrMerged = 0;
        for (let i = 0; i < autoSplitGroupsCache.length; i++) {
            const g = autoSplitGroupsCache[i];
            btn.innerHTML = `⏳ Saving ${i + 1}/${autoSplitGroupsCache.length}...`;

            let finalCards = [...g.cards];
            const existing = await restGetDoc("ca_drills", g.docId);
            if (existing && Array.isArray(existing.cards)) {
                const seen = new Set(existing.cards.map((c) => normalizeHeadlineKey(c.oneLiner || c.mcq?.question)));
                const merged = existing.cards.map(normalizeCard);
                g.cards.forEach((c) => {
                    const key = normalizeHeadlineKey(c.oneLiner || c.mcq?.question);
                    if (!key || !seen.has(key)) {
                        if (key) seen.add(key);
                        merged.push(c);
                    }
                });
                finalCards = merged;
            }

            await setDoc(
                doc(db, "ca_drills", g.docId),
                {
                    docType: "summary",
                    date: g.docId,
                    cadence: "monthly",
                    displayTitle: g.category,
                    folderName: g.folderName,
                    deckMode: "study_quiz",
                    count: finalCards.length,
                    cards: finalCards,
                    timestamp: serverTimestamp()
                },
                { merge: true }
            );
            createdOrMerged++;
        }

        await fetchAllDrillsMetadata();
        populateExistingDropdowns();
        document.getElementById("autoSplitPreviewBox").classList.add("hidden");
        autoSplitGroupsCache = [];
        alert(`✅ Successfully created/merged ${createdOrMerged} Monthly Category Decks inside "${folderName}"! Open Tab 5 (Library & Mega PDF) to build the Full-Month Vector PDF.`);
    } catch (err) {
        alert("Auto-Split Commit Error: " + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

// ==========================================
// 11. MERGE FROM EXISTING DRILLS MODAL (REST)
// ==========================================
window.openMergeDrillsModal = async function () {
    document.getElementById("mergeDrillsModal").classList.remove("hidden");
    document.getElementById("mergeDrillsList").innerHTML = '<div class="text-center py-8 text-slate-400 font-bold animate-pulse">Loading live drills...</div>';
    try {
        if (browseDrillsCache.length === 0) await fetchAllDrillsMetadata();
        renderMergeDrillsList();
    } catch (err) {
        document.getElementById("mergeDrillsList").innerHTML = `<div class="text-center py-8 text-rose-500 font-bold">${escapeHtml(err.message)}</div>`;
    }
};

window.closeMergeDrillsModal = () => document.getElementById("mergeDrillsModal").classList.add("hidden");

window.renderMergeDrillsList = function () {
    const q = (document.getElementById("mergeSearchInput").value || "").toLowerCase().trim();
    const filtered = browseDrillsCache.filter((d) => {
        const hay = `${d.displayTitle} ${d.folderName} ${d.docId} ${d.cadence}`.toLowerCase();
        return !q || hay.includes(q);
    });
    const wrap = document.getElementById("mergeDrillsList");
    if (filtered.length === 0) {
        wrap.innerHTML = '<div class="text-center py-8 text-slate-400 font-bold">No matching drills.</div>';
        return;
    }
    wrap.innerHTML = filtered
        .map(
            (d) => `
        <label class="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 hover:bg-violet-50/40 cursor-pointer">
            <div class="flex items-center gap-3">
                <input type="checkbox" class="chk-merge-drill accent-violet-600 w-4 h-4" value="${escapeHtml(d.docId)}">
                <div>
                    <div class="text-xs font-black text-slate-900">${escapeHtml(d.displayTitle || d.docId)}</div>
                    <div class="text-[10px] font-bold text-slate-500">${escapeHtml(d.cadence.toUpperCase())} ${d.folderName ? "• 📁 " + escapeHtml(d.folderName) : ""} • ${escapeHtml(d.docId)}</div>
                </div>
            </div>
            <span class="text-xs font-black text-violet-700 bg-violet-100 px-2.5 py-0.5 rounded-full">${d.count} cards</span>
        </label>`
        )
        .join("");
};

window.executeMergeSelectedDrills = async function () {
    const ids = Array.from(document.querySelectorAll(".chk-merge-drill:checked")).map((c) => c.value);
    if (ids.length === 0) return alert("Select at least one deck to merge.");

    const btn = document.getElementById("btnExecuteMerge");
    const orig = btn.innerHTML;
    btn.innerHTML = "⏳ Merging...";
    btn.disabled = true;

    try {
        syncStagingFromDOM();
        const existingKeys = new Set(window.stagedNewsItems.map((c) => normalizeHeadlineKey(c.oneLiner || c.mcq?.question)));
        let added = 0;
        let dupes = 0;

        for (const id of ids) {
            const d = await restGetDoc("ca_drills", id);
            if (d && Array.isArray(d.cards)) {
                d.cards.map(normalizeCard).forEach((card) => {
                    const key = normalizeHeadlineKey(card.oneLiner || card.mcq?.question);
                    if (key && existingKeys.has(key)) {
                        dupes++;
                        return;
                    }
                    if (key) existingKeys.add(key);
                    window.stagedNewsItems.push(card);
                    added++;
                });
            }
        }

        closeMergeDrillsModal();
        activeStagingContext = "ms";
        window.activeStagingFilter = "all";
        renderStagingCards();
        updateStagingContextBanner();
        alert(`✅ Merged ${added} bilingual cards from ${ids.length} deck(s) via REST API!${dupes ? ` (${dupes} duplicate(s) skipped)` : ""}`);
    } catch (err) {
        alert("Merge Error: " + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

// ==========================================
// 12. TAB 5: FULL-PAGE LIBRARY, BULK MOVE & MEGA PDF
// ==========================================
async function fetchAllDrillsMetadata() {
    const docs = await restRunQuery({
        select: {
            fields: [
                { fieldPath: "date" },
                { fieldPath: "cadence" },
                { fieldPath: "count" },
                { fieldPath: "folderName" },
                { fieldPath: "displayTitle" },
                { fieldPath: "deckMode" },
                { fieldPath: "pdfEmbedUrl" },
                { fieldPath: "pdfEmbedUrl_en" },
                { fieldPath: "pdfEmbedUrl_hi" },
                { fieldPath: "pdfLabel" },
                { fieldPath: "folderPdfUrl_en" },
                { fieldPath: "folderPdfUrl_hi" },
                { fieldPath: "folderPdfLabel" },
                { fieldPath: "timestamp" }
            ]
        },
        from: [{ collectionId: "ca_drills" }],
        where: { fieldFilter: { field: { fieldPath: "docType" }, op: "EQUAL", value: { stringValue: "summary" } } }
    });

    const list = docs.map((d) => ({
        docId: d.docId,
        date: d.date || d.docId,
        cadence: d.cadence || "weekly",
        count: Number(d.count) || 0,
        folderName: (d.folderName || "").trim(),
        displayTitle: (d.displayTitle || "").trim(),
        deckMode: d.deckMode || "study_quiz",
        pdfEmbedUrl_en: d.pdfEmbedUrl_en || d.pdfEmbedUrl || "",
        pdfEmbedUrl_hi: d.pdfEmbedUrl_hi || "",
        pdfLabel: (d.pdfLabel || "").trim(),
        folderPdfUrl_en: d.folderPdfUrl_en || "",
        folderPdfUrl_hi: d.folderPdfUrl_hi || "",
        folderPdfLabel: (d.folderPdfLabel || "").trim(),
        tsMs: d.timestamp ? Date.parse(d.timestamp) || 0 : 0
    }));
    list.sort((a, b) => b.tsMs - a.tsMs || a.docId.localeCompare(b.docId));
    browseDrillsCache = list;
    return list;
}

window.switchLibrarySubTab = function (tab) {
    const isDrills = tab === "drills";
    document.getElementById("libDrillsView").classList.toggle("hidden", !isDrills);
    document.getElementById("libFoldersView").classList.toggle("hidden", isDrills);
    document.getElementById("btnLibViewDrills").className = isDrills
        ? "px-3.5 py-1.5 bg-indigo-600 text-white rounded-lg shadow-xs transition"
        : "px-3.5 py-1.5 text-slate-600 hover:text-slate-900 rounded-lg transition";
    document.getElementById("btnLibViewFolders").className = !isDrills
        ? "px-3.5 py-1.5 bg-emerald-600 text-white rounded-lg shadow-xs transition"
        : "px-3.5 py-1.5 text-slate-600 hover:text-slate-900 rounded-lg transition";
    if (!isDrills) renderFoldersBuilderList();
};

window.refreshLibraryDrills = async function () {
    const tbody = document.getElementById("browseDrillsTableBody");
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-10 text-slate-400 font-bold animate-pulse">Fetching live drills via REST API...</td></tr>';
    try {
        await fetchAllDrillsMetadata();
        populateExistingDropdowns();
        renderBrowseDrillsTable();
        renderFoldersBuilderList();
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-rose-500 font-bold">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
};

window.filterBrowseCadence = function (cad) {
    activeBrowseCadenceFilter = cad;
    document.querySelectorAll(".browse-cad-pill").forEach((p) => {
        const active = p.getAttribute("data-cad") === cad;
        p.className = active ? "browse-cad-pill px-2.5 py-1 rounded-lg bg-slate-900 text-white" : "browse-cad-pill px-2.5 py-1 rounded-lg bg-white text-slate-600 border";
    });
    renderBrowseDrillsTable();
};

function renderBrowseDrillsTable() {
    const tbody = document.getElementById("browseDrillsTableBody");
    if (!tbody) return;
    const visible = activeBrowseCadenceFilter === "all" ? browseDrillsCache : browseDrillsCache.filter((d) => d.cadence === activeBrowseCadenceFilter);

    const chkAll = document.getElementById("chkSelectAllDrills");
    if (chkAll) chkAll.checked = false;
    updateBulkSelectedCount();

    if (visible.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-10 text-slate-400 font-bold">No drills found in this filter.</td></tr>';
        return;
    }

    tbody.innerHTML = visible
        .map((d) => {
            const badgeMap = {
                weekly: "bg-indigo-100 text-indigo-700",
                monthly: "bg-emerald-100 text-emerald-700",
                special: "bg-violet-100 text-violet-700"
            };
            const cadClass = badgeMap[d.cadence] || "bg-slate-100 text-slate-600";
            const cleanTitle = d.displayTitle || d.date.replace(/[-_]+/g, " ");
            const modeTag = d.deckMode === "quiz_only" ? '<span class="ml-1 text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-black">QUIZ</span>' : "";
            return `
            <tr class="hover:bg-slate-50 transition">
                <td class="px-4 py-3"><input type="checkbox" class="chk-browse-drill accent-indigo-600 w-4 h-4" value="${escapeHtml(d.docId)}" onchange="updateBulkSelectedCount()"></td>
                <td class="px-4 py-3 whitespace-nowrap"><span class="text-[10px] font-black uppercase px-2 py-0.5 rounded ${cadClass}">${escapeHtml(d.cadence)}</span>${modeTag}</td>
                <td class="px-4 py-3">
                    <div class="font-bold text-slate-900">${escapeHtml(cleanTitle)}</div>
                    <div class="text-[10px] font-mono text-slate-400">${escapeHtml(d.docId)}</div>
                </td>
                <td class="px-4 py-3">
                    ${
                        d.folderName
                            ? `<span class="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">📁 ${escapeHtml(d.folderName)}</span>`
                            : '<span class="text-[11px] text-slate-400 italic">Standalone</span>'
                    }
                </td>
                <td class="px-4 py-3 font-bold text-slate-600 whitespace-nowrap">${d.count}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                    <button onclick="selectDrillFromBrowse('${escapeJsStr(d.docId)}')" class="bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-700 font-black text-xs px-3 py-1.5 rounded-lg transition">Edit / Expand</button>
                </td>
            </tr>`;
        })
        .join("");
}

window.toggleSelectAllBrowseDrills = function (checked) {
    document.querySelectorAll(".chk-browse-drill").forEach((chk) => {
        chk.checked = checked;
    });
    updateBulkSelectedCount();
};

window.updateBulkSelectedCount = function () {
    const count = document.querySelectorAll(".chk-browse-drill:checked").length;
    const badge = document.getElementById("bulkSelectedCountBadge");
    if (badge) badge.textContent = `${count} Selected`;
};

window.applyBulkFolderMove = async function () {
    const checkedIds = Array.from(document.querySelectorAll(".chk-browse-drill:checked")).map((c) => c.value);
    if (checkedIds.length === 0) return alert("Tick at least one drill checkbox first.");

    const targetCad = document.getElementById("bulkTargetCadence").value;
    const folderInput = document.getElementById("bulkFolderName").value.trim();
    const clearFolder = document.getElementById("bulkClearFolder").checked;
    const targetMode = document.getElementById("bulkDeckMode").value;

    const updates = {};
    if (targetCad !== "__keep__") updates.cadence = targetCad;
    if (clearFolder) updates.folderName = "";
    else if (folderInput) updates.folderName = folderInput;
    if (targetMode !== "__keep__") updates.deckMode = targetMode;

    if (Object.keys(updates).length === 0) return alert("Choose a Target Section, Folder Name, Deck Mode, or Remove Folder first.");

    const btn = document.getElementById("btnApplyBulkMove");
    const orig = btn.innerHTML;
    btn.innerHTML = "⏳ Updating...";
    btn.disabled = true;

    try {
        const batch = writeBatch(db);
        checkedIds.forEach((id) => batch.update(doc(db, "ca_drills", id), updates));
        await batch.commit();
        document.getElementById("bulkClearFolder").checked = false;
        alert(`✅ Updated ${checkedIds.length} drill(s) cleanly without touching any cards or translations!`);
        await refreshLibraryDrills();
    } catch (err) {
        alert("Bulk Update Error: " + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

window.selectDrillFromBrowse = function (docId) {
    const d = browseDrillsCache.find((x) => x.docId === docId);
    if (!d) return;

    if (d.cadence === "weekly") {
        switchToTab("tab-weekly");
        document.querySelector('input[name="weeklyMode"][value="edit"]').checked = true;
        toggleWeeklyMode("edit");
        const sel = document.getElementById("weeklyExistingSelect");
        if (sel) sel.value = d.docId;
        fillDeckFormFromMeta("weekly", d);
        fetchDrillForContext("weekly");
    } else {
        switchToTab("tab-monthly-special");
        document.querySelector('input[name="msMode"][value="edit"]').checked = true;
        toggleMsMode("edit");
        const sel = document.getElementById("msExistingSelect");
        if (sel) sel.value = d.docId;
        fillDeckFormFromMeta("ms", d);
        fetchDrillForContext("ms");
    }
};

function renderFoldersBuilderList() {
    const wrap = document.getElementById("foldersBuilderList");
    if (!wrap) return;
    const groups = {};
    browseDrillsCache.forEach((d) => {
        if (!d.folderName) return;
        const key = `${d.cadence}::${d.folderName}`;
        if (!groups[key]) {
            groups[key] = {
                cadence: d.cadence,
                name: d.folderName,
                decks: [],
                totalMcqs: 0,
                folderPdfEn: "",
                folderPdfHi: "",
                folderPdfLabel: ""
            };
        }
        groups[key].decks.push(d);
        groups[key].totalMcqs += d.count || 0;
        if (!groups[key].folderPdfEn && d.folderPdfUrl_en) groups[key].folderPdfEn = d.folderPdfUrl_en;
        if (!groups[key].folderPdfHi && d.folderPdfUrl_hi) groups[key].folderPdfHi = d.folderPdfUrl_hi;
        if (!groups[key].folderPdfLabel && d.folderPdfLabel) groups[key].folderPdfLabel = d.folderPdfLabel;
    });

    const list = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
    if (list.length === 0) {
        wrap.innerHTML =
            '<div class="col-span-full text-center py-10 text-slate-400 font-bold bg-white rounded-2xl border border-dashed border-slate-300">No folders created yet. Use "All Drills & Bulk Move" to group decks into a folder like "May–June 2026".</div>';
        return;
    }

    wrap.innerHTML = list
        .map(
            (f, idx) => `
        <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div>
                <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded ${f.cadence === "monthly" ? "bg-emerald-100 text-emerald-800" : "bg-violet-100 text-violet-800"}">${escapeHtml(f.cadence)}</span>
                <h4 class="text-lg font-black text-slate-900 mt-1">📁 ${escapeHtml(f.name)}</h4>
                <p class="text-xs font-bold text-slate-500">${f.decks.length} Category Decks &bull; ${f.totalMcqs} Total Cards</p>
            </div>

            <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                <div class="text-[10px] font-black uppercase text-slate-500">1. Build Crash-Proof Vector Mega PDF</div>
                <div class="flex gap-2">
                    <select id="megaPdfOpt-${idx}" class="flex-grow bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold">
                        <option value="full_en">📄 Full Magazine Digest (English)</option>
                        <option value="full_hi">📄 Full Magazine Digest (Hindi)</option>
                        <option value="quiz_en">⚡ Compact Layout A Quiz Sheet (English)</option>
                        <option value="quiz_hi">⚡ Compact Layout A Quiz Sheet (Hindi)</option>
                        <option value="cheat_en">📑 1-Line Revision Cheat Sheet (English)</option>
                        <option value="cheat_hi">📑 1-Line Revision Cheat Sheet (Hindi)</option>
                    </select>
                    <button onclick="buildFolderVectorMegaPDF('${escapeJsStr(f.cadence)}', '${escapeJsStr(f.name)}', 'megaPdfOpt-${idx}', this)" class="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-3.5 py-1.5 rounded-lg shadow-xs whitespace-nowrap transition">
                        📄 Build PDF
                    </button>
                </div>
            </div>

            <div class="bg-indigo-50/50 p-3.5 rounded-xl border border-indigo-100 space-y-2">
                <div class="text-[10px] font-black uppercase text-indigo-700">2. Attach Full-Folder Telegram / Drive Link (Single Top Button)</div>
                <input type="url" id="folderLinkEn-${idx}" value="${escapeHtml(f.folderPdfEn)}" placeholder="Full-Month Telegram / Drive PDF URL (English)" class="w-full bg-white border border-indigo-200 rounded-lg px-2.5 py-1.5 text-xs font-bold">
                <input type="url" id="folderLinkHi-${idx}" value="${escapeHtml(f.folderPdfHi)}" placeholder="Full-Month Telegram / Drive PDF URL (Hindi — Optional)" class="w-full bg-white border border-emerald-200 rounded-lg px-2.5 py-1.5 text-xs font-bold">
                <input type="text" id="folderLinkLabel-${idx}" value="${escapeHtml(f.folderPdfLabel)}" placeholder="Optional Button Label (Default: 📥 Full Month Mega PDF)" class="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold">
                <button onclick="saveFolderPdfLinks('${escapeJsStr(f.cadence)}', '${escapeJsStr(f.name)}', 'folderLinkEn-${idx}', 'folderLinkHi-${idx}', 'folderLinkLabel-${idx}', this)" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs py-2 rounded-lg transition">
                    💾 Save Folder Mega PDF Links
                </button>
            </div>
        </div>`
        )
        .join("");
}

window.saveFolderPdfLinks = async function (cadence, folderName, enInputId, hiInputId, labelInputId, btn) {
    const urlEn = document.getElementById(enInputId).value.trim();
    const urlHi = document.getElementById(hiInputId).value.trim();
    const label = document.getElementById(labelInputId).value.trim();
    const decks = browseDrillsCache.filter((d) => d.cadence === cadence && d.folderName === folderName);
    if (decks.length === 0) return;

    const orig = btn.innerHTML;
    btn.innerHTML = "⏳ Saving...";
    btn.disabled = true;
    try {
        const batch = writeBatch(db);
        decks.forEach((d) => {
            batch.update(doc(db, "ca_drills", d.docId), {
                folderPdfUrl_en: urlEn || null,
                folderPdfUrl_hi: urlHi || null,
                folderPdfLabel: label || null
            });
        });
        await batch.commit();
        alert(`✅ Saved Full-Folder PDF settings across all ${decks.length} decks inside "${folderName}"!`);
        await refreshLibraryDrills();
    } catch (err) {
        alert("Save Error: " + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

// ==========================================
// 13. SHARED CRASH-PROOF VECTOR PRINT STUDIO
//     (MEGA PDF + COMPACT LAYOUT A QUIZ SHEET)
// ==========================================
function formatVectorHighlight(txt) {
    if (!txt) return "";
    return escapeHtml(txt)
        .replace(/\*\*\*(.+?)\*\*\*/g, "**$1**")
        .replace(/\*\*(.+?)\*\*(?!\*)/g, (_, p1) => {
            const c = p1.replace(/\*/g, "").trim();
            const isNum = /^[\₹\$€£]?\d+[\d.,]*%?(st|nd|rd|th)?(\s*(Crore|Lakh|Million|Billion))?$/i.test(c) || !isNaN(parseFloat(c));
            return `<strong style="color:${isNum ? "#e11d48" : "#1d4ed8"};font-weight:800;">${p1}</strong>`;
        })
        .replace(/(^|[\s(\['"“‘>—–:\/\-])\*([^*\n]+?)\*/g, (_, pre, inner) => `${pre}${inner.trim()}`);
}

function openVectorPrintStudio({ docTitle, subtitle, coverMeta, sections, mode, lang, totalCards }) {
    const win = window.open("", "_blank");
    if (!win) {
        alert("Pop-up blocked! Please allow pop-ups for this site to open the Vector PDF studio.");
        return;
    }

    const isHi = lang === "hi";
    const logoDataUrl = typeof stenogymLogoBase64 !== "undefined" ? stenogymLogoBase64 : "";
    const tgUrl = "https://t.me/stenogym";
    const siteUrl = "https://www.stenogym.com";
    const twoColIndex = sections.length > 10 ? "index-grid-2" : "";

    const palette = [
        { hex: "#4f46e5", soft: "#eef2ff", border: "#c7d2fe", text: "#3730a3" }, // Indigo
        { hex: "#059669", soft: "#ecfdf5", border: "#a7f3d0", text: "#065f46" }, // Emerald
        { hex: "#d97706", soft: "#fffbeb", border: "#fde68a", text: "#92400e" }, // Amber
        { hex: "#e11d48", soft: "#fff1f2", border: "#fecdd3", text: "#9f1239" }, // Rose
        { hex: "#7c3aed", soft: "#f5f3ff", border: "#ddd6fe", text: "#5b21b6" }, // Violet
        { hex: "#0284c7", soft: "#f0f9ff", border: "#bae6fd", text: "#075985" }  // Sky
    ];

    const coverHtml = `
    <div class="cover-page" id="doc-index">
        <div class="cover-top">
            <div class="brand-bar">
                <div>
                    <div class="brand-name">STENOGYM</div>
                    <div class="brand-sub">${escapeHtml(subtitle)}</div>
                </div>
                ${logoDataUrl ? `<img src="${logoDataUrl}" class="brand-logo" />` : ""}
            </div>
            <h1 class="cover-title">${escapeHtml(docTitle)}</h1>
            <p class="cover-meta">${escapeHtml(coverMeta)}</p>
            <div class="index-box">
                <h3>${isHi ? "विषय सूची — किसी भी श्रेणी पर क्लिक करें (Clickable Index)" : "Master Document Index (Click Any Category to Jump)"}</h3>
                <div class="index-list ${twoColIndex}">
                    ${sections
                        .map((s, idx) => {
                            const p = palette[idx % palette.length];
                            return `<a href="#sec-${idx}" class="index-row" style="border-left: 3.5px solid ${p.hex}; background: ${p.soft};">
                                <span><strong style="color:${p.text};">${idx + 1}.</strong> ${s.emoji || "📌"} ${escapeHtml(s.title)}</span>
                                <span class="index-count" style="color:${p.text};">${s.cards.length} ${mode === "quiz" ? "MCQs" : "Cards"} &rarr;</span>
                            </a>`;
                        })
                        .join("")}
                </div>
            </div>
        </div>
        <div class="cover-cta">
            <a href="${siteUrl}/current-affairs.html" target="_blank">🎯 Practice Interactive Flashcards &amp; Timed Quizzes at <strong>www.stenogym.com</strong></a>
        </div>
    </div>`;

    let sectionsHtml = "";
    let globalQNum = 0;

    sections.forEach((sec, sIdx) => {
        const p = palette[sIdx % palette.length];
        const secEmoji = sec.emoji || "📌";
        const targetPracticeUrl = sec.practiceUrl
            ? sec.practiceUrl
            : sec.docId
            ? `${siteUrl}/current-affairs.html?topic=${encodeURIComponent(sec.docId)}`
            : "";
        const practiceBtn = targetPracticeUrl
            ? `<a href="${targetPracticeUrl}" target="_blank" class="banner-btn">⚡ Practice Online &nearr;</a>`
            : "";

        sectionsHtml += `
        <div class="cat-banner" id="sec-${sIdx}" style="background:${p.hex};">
            <span class="cat-banner-title">${sIdx + 1}. ${secEmoji} ${escapeHtml(sec.title)} (${sec.cards.length})</span>
            <span class="cat-banner-actions">
                ${practiceBtn}
                <a href="#doc-index" class="banner-btn">&uarr; Index</a>
            </span>
        </div>`;

        sec.cards.forEach((card, cIdx) => {
            globalQNum++;
            const hLine = isHi ? card.oneLiner_hi || card.oneLiner || "" : card.oneLiner || "";
            const sub = isHi ? card.subCategory_hi || card.subCategory || "" : card.subCategory || "";
            const bullets = (isHi ? card.contextBullets_hi || card.contextBullets || [] : card.contextBullets || []).filter((b) => String(b).trim() !== "");
            const st = isHi ? card.staticBox_hi?.facts || card.staticBox?.facts || "" : card.staticBox?.facts || "";
            const mcq = isHi ? card.mcq_hi || card.mcq || {} : card.mcq || {};
            const itemEmoji = card.emoji || secEmoji;

            if (mode === "cheat") {
                sectionsHtml += `
                <div class="cheat-row atomic-unit ${cIdx % 2 === 1 ? "alt" : ""}" style="border-left: 3px solid ${p.hex};">
                    <span class="cheat-emoji">${itemEmoji}</span>
                    <div class="cheat-text"><span class="cheat-sub" style="color:${p.text};background:${p.soft};">${escapeHtml(sub)}</span> ${formatVectorHighlight(hLine || mcq.question || "")}</div>
                </div>`;
            } else if (mode === "quiz") {
                const ansIdx = Number(mcq.correctIndex) || 0;
                const ansChar = String.fromCharCode(65 + ansIdx);
                const opts = mcq.options || ["", "", "", ""];
                const optsHtml = opts
                    .map((o, oi) => `<div class="qz-opt"><span class="qz-let">${String.fromCharCode(65 + oi)}.</span> ${formatVectorHighlight(o)}</div>`)
                    .join("");
                sectionsHtml += `
                <div class="qz-card" style="border-left-color:${p.hex};">
                    <div class="qz-stem atomic-unit">
                        <div class="qz-q"><span class="qz-num" style="color:${p.text};">Q${globalQNum}.</span> ${formatVectorHighlight(mcq.question || hLine)}</div>
                        <div class="qz-opts">${optsHtml}</div>
                    </div>
                    <div class="qz-ans atomic-unit"><strong>${isHi ? "उत्तर:" : "Ans:"} ${ansChar}</strong> &mdash; ${formatVectorHighlight(mcq.explanation || "")}</div>
                </div>`;
            } else {
                const bulletsHtml = bullets.length
                    ? `<ul class="card-bullets">${bullets.map((b) => `<li class="atomic-unit">${formatVectorHighlight(b)}</li>`).join("")}</ul>`
                    : "";
                const staticHtml = st
                    ? `<div class="static-box atomic-unit" style="border-left-color:${p.hex};background:${p.soft};">🧠 <strong style="color:${p.text};">Static:</strong> ${formatVectorHighlight(st)}</div>`
                    : "";

                let mcqBlock = "";
                if (mcq && mcq.question) {
                    const ansIdx = Number(mcq.correctIndex) || 0;
                    const ansChar = String.fromCharCode(65 + ansIdx);
                    const ansText = mcq.options ? mcq.options[ansIdx] : "";
                    mcqBlock = `
                    <div class="mcq-box">
                        <div class="mcq-q atomic-unit">${isHi ? "प्रश्न:" : "Q."} ${formatVectorHighlight(mcq.question)}</div>
                        <div class="mcq-ans-wrap atomic-unit">
                            <div class="mcq-a">${isHi ? "उत्तर:" : "Ans:"} ${ansChar}. ${formatVectorHighlight(ansText)}</div>
                            ${mcq.explanation ? `<div class="mcq-exp">${formatVectorHighlight(mcq.explanation)}</div>` : ""}
                        </div>
                    </div>`;
                }

                sectionsHtml += `
                <div class="news-card" style="border-left: 3px solid ${p.border};">
                    <div class="card-head-wrap atomic-unit keep-with-next">
                        <div class="card-meta" style="color:${p.text};">#${cIdx + 1} &bull; ${escapeHtml(sub || "EXAM UPDATE")}</div>
                        ${hLine ? `<div class="card-headline">${formatVectorHighlight(hLine)}</div>` : ""}
                    </div>
                    ${bulletsHtml}
                    ${staticHtml}
                    ${mcqBlock}
                </div>`;
            }
        });
    });

    sectionsHtml += `
    <div class="end-signoff atomic-unit">
        <div class="end-title">${isHi ? "अभ्यास जारी रखें — स्टेनोजिम के साथ" : "Keep Your Streak Going With Stenogym"}</div>
        <div class="end-links">
            <a href="${siteUrl}/current-affairs.html" target="_blank">🌐 Live Desk: www.stenogym.com/current-affairs.html</a>
            <span>&bull;</span>
            <a href="${tgUrl}" target="_blank">✈ Telegram: t.me/stenogym</a>
        </div>
    </div>`;

    win.document.title = `Stenogym_${docTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}_${mode.toUpperCase()}_${lang.toUpperCase()}`;
    const styleEl = win.document.createElement("style");
    styleEl.textContent = `
        @page {
            size: A4;
            margin: 8mm 8mm 9.5mm 8mm;
            @bottom-right {
                content: "Page " counter(page) " of " counter(pages);
                font-family: 'Segoe UI', Arial, sans-serif;
                font-size: 8pt;
                font-weight: 800;
                color: #334155;
                padding-right: 1mm;
                padding-top: 1.5mm;
                vertical-align: top;
            }
        }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        html { scroll-behavior: smooth; }
        body { font-family: 'Segoe UI', 'Noto Sans Devanagari', Arial, sans-serif; color: #0f172a; margin: 0; padding: 0; background: #f1f5f9; }
        .atomic-unit { page-break-inside: avoid; break-inside: avoid; }
        .keep-with-next { page-break-after: avoid; break-after: avoid; }
        .toolbar { position: sticky; top: 0; background: #0f172a; color: #fff; padding: 11px 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px; z-index: 999; font-size: 12px; }
        .toolbar button { background: #10b981; color: #0f172a; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 900; cursor: pointer; font-size: 13px; white-space: nowrap; }
        /* CENTERED LOGO WATERMARK ABOVE CARD BACKGROUNDS, NON-BLOCKING */
        .page-watermark { position: fixed; top: 48%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 40; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.055; }
        .wm-logo { width: 265px; height: 265px; object-fit: contain; }
        .wm-text { font-size: 46px; font-weight: 900; letter-spacing: 3px; color: #0f172a; transform: rotate(-30deg); white-space: nowrap; }
        /* PRINT-ONLY REPEATING BORDER & OUTSIDE-THE-BORDER CLICKABLE FOOTER */
        .page-border { display: none; }
        .page-footer { display: none; }
        .ft-brand { color: #0f172a; font-weight: 900; text-decoration: none; letter-spacing: 0.5px; }
        .ft-tg { color: #0284c7; font-weight: 800; text-decoration: none; }
        .ft-brand:hover, .ft-tg:hover { text-decoration: underline; }
        /* MAIN SHEET CONTAINER (SCREEN PREVIEW) */
        .wrap { max-width: 820px; margin: 18px auto 34px auto; background: #ffffff; border: 2px solid #0f172a; box-shadow: 0 12px 35px rgba(15, 23, 42, 0.12); position: relative; z-index: 1; }
        .cover-page { page-break-after: always; break-after: page; padding: 24px 26px 26px 26px; min-height: 920px; display: flex; flex-direction: column; justify-content: space-between; }
        .brand-bar { border-left: 8px solid #0f172a; padding-left: 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 22px; }
        .brand-name { font-size: 30px; font-weight: 900; letter-spacing: 2px; }
        .brand-sub { font-size: 11px; font-weight: 800; color: #e11d48; letter-spacing: 1.5px; margin-top: 2px; }
        .brand-logo { width: 54px; height: 54px; object-fit: contain; }
        .cover-title { font-size: 26px; font-weight: 900; margin: 0 0 8px 0; color: #0f172a; }
        .cover-meta { font-size: 12px; font-weight: 700; color: #475569; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 20px; }
        .index-box h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px; margin: 0 0 12px 0; color: #0f172a; }
        .index-list { display: flex; flex-direction: column; gap: 7px; }
        .index-list.index-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 14px; }
        .index-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 11px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 11.5px; font-weight: 700; color: #1e293b; text-decoration: none; }
        .index-row:hover { filter: brightness(0.97); }
        .index-count { white-space: nowrap; font-weight: 800; font-size: 11px; }
        .cover-cta { margin-top: 24px; text-align: center; padding: 12px 16px; border: 1.8px solid #4f46e5; border-radius: 8px; background: #eef2ff; font-size: 11.5px; font-weight: 700; line-height: 1.6; }
        .cover-cta a { color: #3730a3; text-decoration: none; }
        .cover-cta a:hover { text-decoration: underline; }
        /* PRINT SPACER TABLE SO CONTENT NEVER COLLIDES WITH BORDER OR FOOTER */
        .print-layout { width: 100%; border-collapse: collapse; }
        .print-layout td { padding: 0; }
        .head-sp { height: 0; }
        .foot-sp { height: 0; }
        .content-cell { padding: 12px 24px 24px 24px; }
        /* CATEGORY BANNER WITH CLICKABLE LINKS */
        .cat-banner { color: #fff; padding: 8px 14px; border-radius: 6px; margin: 18px 0 12px 0; page-break-after: avoid; break-after: avoid; page-break-inside: avoid; break-inside: avoid; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
        .cat-banner-title { font-size: 12.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.45px; }
        .cat-banner-actions { display: inline-flex; align-items: center; gap: 6px; }
        .banner-btn { background: rgba(255, 255, 255, 0.2); color: #ffffff; text-decoration: none; font-size: 9.5px; font-weight: 800; padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.38); white-space: nowrap; }
        .banner-btn:hover { background: rgba(255, 255, 255, 0.34); }
        /* AIRY FULL DIGEST CARD (SEGMENT-FLOW, ZERO SLICED LINES, CLEAN GREEN MCQ BOX) */
        .news-card { margin-bottom: 18px; padding: 2px 0 14px 13px; border-bottom: 1px solid #e2e8f0; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        .card-meta { font-size: 9.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
        .card-headline { font-size: 12.8px; font-weight: 800; color: #0f172a; line-height: 1.5; margin-bottom: 9px; }
        .card-bullets { margin: 0 0 10px 0; padding-left: 19px; font-size: 10.8px; line-height: 1.62; color: #334155; }
        .card-bullets li { margin-bottom: 6px; }
        .static-box { border-left: 3px solid #64748b; padding: 7px 12px; font-size: 10.3px; line-height: 1.55; color: #334155; margin: 9px 0 10px 0; border-radius: 0 5px 5px 0; }
        .mcq-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 3.5px solid #059669; padding: 9px 12px; border-radius: 6px; margin-top: 9px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        .mcq-q { font-size: 10.8px; font-weight: 800; color: #065f46; line-height: 1.5; margin-bottom: 6px; }
        .mcq-a { font-size: 10.5px; font-weight: 800; color: #047857; line-height: 1.48; margin-bottom: 5px; }
        .mcq-exp { font-size: 10px; color: #334155; border-top: 1px dashed #a7f3d0; padding-top: 5px; line-height: 1.55; }
        /* AIRY COMPACT QUIZ SHEET (QUESTION + OPTIONS ALWAYS LOCKED TOGETHER; EVEN PAGE FILL) */
        .qz-card { padding: 10px 13px; margin-bottom: 11px; border: 1px solid #e2e8f0; border-left: 3.5px solid #4f46e5; border-radius: 6px; background: #fff; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        .qz-q { font-size: 10pt; font-weight: 800; color: #0f172a; line-height: 1.48; margin-bottom: 6px; }
        .qz-num { margin-right: 4px; }
        .qz-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 16px; margin-bottom: 8px; font-size: 9.3pt; color: #334155; line-height: 1.42; }
        .qz-opt { line-height: 1.42; }
        .qz-let { font-weight: 800; color: #0f172a; }
        .qz-ans { background: #f0fdf4; border-left: 3px solid #059669; padding: 6px 10px; border-radius: 4px; font-size: 9pt; line-height: 1.48; color: #065f46; }
        /* AIRY 1-LINE CHEAT SHEET (EMOJIS + CATEGORY COLORS) */
        .cheat-row { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; margin-bottom: 3px; border-bottom: 1px solid #f1f5f9; border-radius: 0 5px 5px 0; font-size: 10.8px; line-height: 1.58; }
        .cheat-row.alt { background: #f8fafc; }
        .cheat-emoji { font-size: 13px; line-height: 1.4; min-width: 22px; text-align: center; flex-shrink: 0; }
        .cheat-text { flex: 1; color: #1e293b; }
        .cheat-sub { font-weight: 800; text-transform: uppercase; font-size: 9.2px; margin-right: 6px; padding: 1.5px 6px; border-radius: 4px; }
        /* END SIGN-OFF */
        .end-signoff { margin: 18px 0 8px 0; padding: 13px 16px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; text-align: center; }
        .end-title { font-size: 11.5px; font-weight: 900; color: #0f172a; margin-bottom: 4px; }
        .end-links { font-size: 10.5px; font-weight: 700; }
        .end-links a { color: #4f46e5; text-decoration: none; margin: 0 5px; }
        .end-links a:hover { text-decoration: underline; }
        @media print {
            body { background: #ffffff; }
            .toolbar { display: none !important; }
            .wrap { max-width: 100%; margin: 0; border: none; box-shadow: none; }
            .cover-page { min-height: 266mm; max-height: 270mm; padding: 7mm 7mm 7mm 7mm; }
            /* REPEATING A4 BORDER ENDING ABOVE THE OUTSIDE FOOTNOTE */
            .page-border { display: block !important; position: fixed; top: 0; left: 0; right: 0; bottom: 8mm; border: 1.8px solid #0f172a; pointer-events: none; z-index: 50; }
            /* CLICKABLE FOOTNOTE SITTING CLEANLY OUTSIDE & BELOW THE DARK BORDER */
            .page-footer { display: flex !important; position: fixed; left: 0; right: 0; bottom: 0; height: 6.5mm; padding: 0 1.5mm; align-items: center; justify-content: space-between; background: #ffffff; z-index: 55; font-size: 8.5pt; }
            .head-sp { height: 6mm; }
            .foot-sp { height: 15mm; }
            .content-cell { padding: 0 7mm; }
        }
    `;
    win.document.head.appendChild(styleEl);
    win.document.body.innerHTML = `
        <div class="toolbar">
            <span>📄 Stenogym Vector PDF Ready (${totalCards} ${mode === "quiz" ? "MCQs" : "Cards"}) &mdash; In Print: check <strong>Background graphics</strong> &amp; uncheck <strong>Headers and footers</strong></span>
            <button onclick="window.print()">🖨️ Save as PDF</button>
        </div>
        <div class="page-border" aria-hidden="true"></div>
        <div class="page-footer">
            <a href="${siteUrl}" target="_blank" class="ft-brand">STENOGYM.COM</a>
            <a href="${tgUrl}" target="_blank" class="ft-tg">✈ Official Telegram: t.me/stenogym</a>
        </div>
        <div class="page-watermark" aria-hidden="true">
            ${logoDataUrl ? `<img src="${logoDataUrl}" class="wm-logo" />` : `<div class="wm-text">STENOGYM</div>`}
        </div>
        <div class="wrap">
            ${coverHtml}
            <table class="print-layout">
                <thead><tr><td><div class="head-sp"></div></td></tr></thead>
                <tfoot><tr><td><div class="foot-sp"></div></td></tr></tfoot>
                <tbody><tr><td class="content-cell">${sectionsHtml}</td></tr></tbody>
            </table>
        </div>
    `;
}

window.buildFolderVectorMegaPDF = async function (cadence, folderName, selectId, btn) {
    const [mode, lang] = document.getElementById(selectId).value.split("_");
    const decks = browseDrillsCache
        .filter((d) => d.cadence === cadence && d.folderName === folderName)
        .sort((a, b) => (a.displayTitle || a.docId).localeCompare(b.displayTitle || b.docId));

    if (decks.length === 0) return alert("No decks in this folder.");
    const orig = btn.innerHTML;
    btn.innerHTML = "⏳ Fetching...";
    btn.disabled = true;

    try {
        const sections = [];
        let totalCards = 0;
        for (let i = 0; i < decks.length; i++) {
            btn.innerHTML = `⏳ ${i + 1}/${decks.length}`;
            const d = await restGetDoc("ca_drills", decks[i].docId);
            if (d && Array.isArray(d.cards)) {
                totalCards += d.cards.length;
                sections.push({
                    docId: decks[i].docId,
                    title: decks[i].displayTitle || decks[i].date.replace(/[-_]+/g, " "),
                    emoji: d.cards[0]?.emoji || "📌",
                    cards: d.cards
                });
            }
        }

        const isHi = lang === "hi";
        const modeLabel =
            mode === "cheat"
                ? isHi
                    ? "1-लाइन रिवीजन शीट"
                    : "1-Line Revision Cheat Sheet"
                : mode === "quiz"
                ? isHi
                    ? "रैपिड MCQ क्विज़ शीट"
                    : "Compact Layout A Quiz Sheet"
                : isHi
                ? "संपूर्ण नोट्स + MCQ"
                : "Complete Notes + Verification MCQs";

        openVectorPrintStudio({
            docTitle: folderName,
            subtitle: isHi ? "मासिक मेगा करेंट अफेयर्स संकलन" : "MONTHLY MEGA CURRENT AFFAIRS DIGEST",
            coverMeta: `${sections.length} Categories • ${totalCards} Verified Exam Cards • ${modeLabel}`,
            sections,
            mode,
            lang,
            totalCards
        });
    } catch (err) {
        alert("Mega PDF Build Error: " + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

window.triggerUniversalPDF = function (sourceContext) {
    if (sourceContext === "staging") syncStagingFromDOM();
    const dropdown = document.getElementById(sourceContext === "staging" ? "stagingPdfType" : "managePdfType");
    const [pdfFormat, langCode] = dropdown.value.split("_");
    const rawData = sourceContext === "staging" ? window.stagedNewsItems : caInspectCache;

    if (!rawData || rawData.length === 0) return alert(`No cards loaded in ${sourceContext}.`);

    let targetLabel = "";
    let reportTitle = "DAILY CURRENT AFFAIRS DIGEST";
    let practiceUrl = "";

    if (sourceContext === "manage") {
        targetLabel = document.getElementById("caManageDate").value;
        if (targetLabel) practiceUrl = `https://www.stenogym.com/current-affairs.html?tab=daily&date=${encodeURIComponent(targetLabel)}`;
    } else if (activeStagingContext === "daily") {
        targetLabel = document.getElementById("dailyTargetDate").value;
        if (targetLabel) practiceUrl = `https://www.stenogym.com/current-affairs.html?tab=daily&date=${encodeURIComponent(targetLabel)}`;
    } else if (activeStagingContext === "weekly") {
        const slug = document.getElementById("weeklyIdentifier").value.trim();
        targetLabel = document.getElementById("weeklyDisplayTitle").value.trim() || slug || "Weekly Drill";
        reportTitle = "WEEKLY SPEED DRILL";
        if (slug) practiceUrl = `https://www.stenogym.com/current-affairs.html?topic=${encodeURIComponent(slug)}`;
    } else {
        const slug = document.getElementById("msIdentifier").value.trim();
        targetLabel = document.getElementById("msDisplayTitle").value.trim() || slug || "Compilation";
        reportTitle = document.getElementById("msCadenceType").value === "special" ? "SPECIAL TOPIC BOOSTER" : "MONTHLY CATEGORY DIGEST";
        if (slug) practiceUrl = `https://www.stenogym.com/current-affairs.html?topic=${encodeURIComponent(slug)}`;
    }

    const isHi = langCode === "hi";
    const groupedData = rawData.reduce((acc, item) => {
        const c = (isHi ? item.category_hi : item.category) || item.category || "General";
        if (!acc[c]) acc[c] = [];
        acc[c].push(item);
        return acc;
    }, {});
    const sortedCategories = Object.keys(groupedData).sort();

    const mode = pdfFormat === "quiz" ? "quiz" : pdfFormat === "cheat" ? "cheat" : "full";
    const modeLabel =
        mode === "cheat"
            ? isHi
                ? "1-लाइन रिवीजन शीट"
                : "1-Line Revision Cheat Sheet"
            : mode === "quiz"
            ? isHi
                ? "रैपिड MCQ क्विज़ शीट"
                : "Compact Layout A Quiz Sheet (Inline Answers & Trap Alerts)"
            : isHi
            ? "संपूर्ण नोट्स + MCQ"
            : "Complete Notes + Verification MCQs";

    const sections = sortedCategories.map((cat) => ({
        practiceUrl,
        title: cat,
        emoji: groupedData[cat][0]?.emoji || "📌",
        cards: groupedData[cat]
    }));

    openVectorPrintStudio({
        docTitle: targetLabel,
        subtitle: reportTitle,
        coverMeta: `${sortedCategories.length} Categories • ${rawData.length} Verified ${mode === "quiz" ? "MCQs" : "Cards"} • ${modeLabel}`,
        sections,
        mode,
        lang: langCode,
        totalCards: rawData.length
    });
};

// ==========================================
// 14. TAB 2: MANAGE DAILY CA (REST POWERED)
// ==========================================
let caInspectCache = [];

window.fetchCAManage = async function () {
    const targetDate = document.getElementById("caManageDate").value;
    if (!targetDate) return;
    document.getElementById("caManageCardsContainer").innerHTML =
        `<div class="text-center py-8 text-slate-400 font-bold animate-pulse">Loading cards for ${escapeHtml(targetDate)} via REST API...</div>`;

    try {
        caInspectCache = await restFetchDailyByDate(targetDate);
        const badge = document.getElementById("caDayStatusBadge");
        if (caInspectCache.length === 0) {
            badge.innerHTML = `<span class="text-slate-500 font-bold">No cards found for ${escapeHtml(targetDate)}</span>`;
        } else {
            const first = caInspectCache[0];
            const isLocked = first.publishAt && new Date(first.publishAt) > new Date();
            badge.innerHTML = isLocked
                ? `<span class="text-amber-600 font-bold">⏰ Scheduled (Unlocks 6:00 AM IST • ${caInspectCache.length} Cards)</span>`
                : `<span class="text-emerald-600 font-bold">🟢 Live to Students (${caInspectCache.length} Cards)</span>`;
        }
        renderCAManageCards();
    } catch (err) {
        document.getElementById("caManageCardsContainer").innerHTML = `<div class="text-center py-8 text-rose-500 font-bold">Error: ${escapeHtml(err.message)}</div>`;
    }
};

function renderCAManageCards() {
    const container = document.getElementById("caManageCardsContainer");
    const filterCat = document.getElementById("caManageCategory").value;
    const filtered = filterCat === "all" ? caInspectCache : caInspectCache.filter((c) => c.category === filterCat);

    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-center py-12 text-slate-400 font-bold border border-dashed border-slate-200 rounded-2xl">No cards matching filter.</div>';
        return;
    }

    container.innerHTML = filtered
        .map((card, i) => {
            const mcqEn = card.mcq || { question: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" };
            const mcqHi = card.mcq_hi || { question: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" };
            return `
            <div class="bg-slate-50 border border-slate-300 p-5 rounded-2xl manage-staged-card space-y-4 shadow-xs" data-docid="${escapeHtml(card.id)}">
                <div class="flex flex-wrap justify-between items-center gap-2 pb-2 border-b border-slate-200">
                    <div class="flex flex-wrap items-center gap-2.5">
                        <span class="text-xs font-black text-indigo-700 uppercase">Card #${i + 1} &bull; ${escapeHtml(card.emoji || "📰")} ${escapeHtml(card.category || "")}</span>
                        <select class="m-priority border border-slate-300 rounded-lg px-2 py-1 text-[11px] font-bold bg-white">
                            <option value="high" ${card.priority === "high" ? "selected" : ""}>⭐ High Priority</option>
                            <option value="standard" ${card.priority === "standard" ? "selected" : ""}>• Standard</option>
                            <option value="" ${!card.priority ? "selected" : ""}>— Unset</option>
                        </select>
                        <button onclick="autoTranslateManageCard(this)" class="bg-yellow-100 hover:bg-yellow-200 text-yellow-800 border border-yellow-300 font-bold py-1 px-2.5 rounded-lg text-[10px] transition">⚡ Auto-Translate</button>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="saveManageCard(this)" class="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs px-4 py-1.5 rounded-lg shadow-xs transition">💾 Save Live</button>
                        <button onclick="deleteCACard('${escapeJsStr(card.id)}')" class="text-rose-500 hover:text-rose-700 font-bold text-xs px-2">🗑️ Delete</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <div class="font-black text-xs text-indigo-600 uppercase">English Content</div>
                        <input type="hidden" class="m-cat" value="${escapeHtml(card.category || "National & Global")}">
                        <input type="hidden" class="m-sub" value="${escapeHtml(card.subCategory || "General")}">
                        <input type="text" class="m-en-h w-full border rounded-lg p-2 text-sm font-bold bg-white" value="${escapeHtml(card.oneLiner || "")}">
                        <textarea class="m-en-c w-full border rounded-lg p-2 text-xs bg-white" rows="3">${escapeHtml((card.contextBullets || []).join("\n"))}</textarea>
                        <div class="grid grid-cols-2 gap-2">
                            <input type="text" class="m-en-imp w-full border rounded-lg p-2 text-xs bg-white" placeholder="Impact" value="${escapeHtml(card.impact || "")}">
                            <input type="text" class="m-en-st w-full border rounded-lg p-2 text-xs bg-white" placeholder="Static Facts" value="${escapeHtml(card.staticBox?.facts || "")}">
                        </div>
                    </div>

                    <div class="space-y-2 bg-emerald-50/40 p-3 rounded-xl border border-emerald-100">
                        <div class="font-black text-xs text-emerald-700 uppercase">Hindi Content (हिंदी)</div>
                        <input type="hidden" class="m-hi-cat" value="${escapeHtml(card.category_hi || card.category || "")}">
                        <input type="text" class="m-hi-h w-full border border-emerald-200 rounded-lg p-2 text-sm font-bold bg-white" value="${escapeHtml(card.oneLiner_hi || "")}">
                        <textarea class="m-hi-c w-full border border-emerald-200 rounded-lg p-2 text-xs bg-white" rows="3">${escapeHtml((card.contextBullets_hi || []).join("\n"))}</textarea>
                        <div class="grid grid-cols-2 gap-2">
                            <input type="text" class="m-hi-imp w-full border border-emerald-200 rounded-lg p-2 text-xs bg-white" placeholder="प्रभाव" value="${escapeHtml(card.impact_hi || "")}">
                            <input type="text" class="m-hi-st w-full border border-emerald-200 rounded-lg p-2 text-xs bg-white" placeholder="स्टेटिक तथ्य" value="${escapeHtml(card.staticBox_hi?.facts || "")}">
                        </div>
                    </div>
                </div>

                <div class="pt-3 border-t border-slate-200">
                    <div class="flex justify-between items-center mb-2">
                        <span class="font-bold text-xs text-purple-700 uppercase">⚡ Verification MCQ</span>
                        <div class="text-xs font-bold flex items-center gap-2">
                            Correct Index (0–3):
                            <input type="number" class="m-mcq-ans w-14 border rounded p-1 text-center font-mono font-black bg-white" min="0" max="3" value="${mcqEn.correctIndex ?? 0}">
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="space-y-2 bg-purple-50/50 p-3 rounded-xl border border-purple-100">
                            <input type="text" class="m-mcq-en-q w-full border rounded p-1.5 text-xs font-bold bg-white" value="${escapeHtml(mcqEn.question || "")}">
                            <div class="grid grid-cols-2 gap-2">
                                <input type="text" class="m-mcq-en-o0 border rounded p-1 text-xs bg-white" value="${escapeHtml(mcqEn.options?.[0] || "")}">
                                <input type="text" class="m-mcq-en-o1 border rounded p-1 text-xs bg-white" value="${escapeHtml(mcqEn.options?.[1] || "")}">
                                <input type="text" class="m-mcq-en-o2 border rounded p-1 text-xs bg-white" value="${escapeHtml(mcqEn.options?.[2] || "")}">
                                <input type="text" class="m-mcq-en-o3 border rounded p-1 text-xs bg-white" value="${escapeHtml(mcqEn.options?.[3] || "")}">
                            </div>
                            <input type="text" class="m-mcq-en-exp w-full border rounded p-1.5 text-xs bg-white" value="${escapeHtml(mcqEn.explanation || "")}">
                        </div>
                        <div class="space-y-2 bg-emerald-50/50 p-3 rounded-xl border border-emerald-100">
                            <input type="text" class="m-mcq-hi-q w-full border border-emerald-200 rounded p-1.5 text-xs font-bold bg-white" value="${escapeHtml(mcqHi.question || "")}">
                            <div class="grid grid-cols-2 gap-2">
                                <input type="text" class="m-mcq-hi-o0 border border-emerald-200 rounded p-1 text-xs bg-white" value="${escapeHtml(mcqHi.options?.[0] || "")}">
                                <input type="text" class="m-mcq-hi-o1 border border-emerald-200 rounded p-1 text-xs bg-white" value="${escapeHtml(mcqHi.options?.[1] || "")}">
                                <input type="text" class="m-mcq-hi-o2 border border-emerald-200 rounded p-1 text-xs bg-white" value="${escapeHtml(mcqHi.options?.[2] || "")}">
                                <input type="text" class="m-mcq-hi-o3 border border-emerald-200 rounded p-1 text-xs bg-white" value="${escapeHtml(mcqHi.options?.[3] || "")}">
                            </div>
                            <input type="text" class="m-mcq-hi-exp w-full border border-emerald-200 rounded p-1.5 text-xs bg-white" value="${escapeHtml(mcqHi.explanation || "")}">
                        </div>
                    </div>
                </div>
            </div>`;
        })
        .join("");
}

window.autoTranslateManageCard = async function (btnEl) {
    const orig = btnEl.innerHTML;
    btnEl.innerHTML = "⚡ Translating...";
    btnEl.disabled = true;
    const card = btnEl.closest(".manage-staged-card");
    try {
        const payload = [
            card.querySelector(".m-cat").value,
            card.querySelector(".m-en-h").value,
            card.querySelector(".m-en-c").value.split("\n").map((b) => b.trim()).filter(Boolean).join(" | "),
            card.querySelector(".m-en-imp").value,
            card.querySelector(".m-en-st").value,
            card.querySelector(".m-mcq-en-q").value,
            card.querySelector(".m-mcq-en-o0").value,
            card.querySelector(".m-mcq-en-o1").value,
            card.querySelector(".m-mcq-en-o2").value,
            card.querySelector(".m-mcq-en-o3").value,
            card.querySelector(".m-mcq-en-exp").value
        ].join(" ||| ");

        const translatedStr = await translateEnToHi(payload);
        if (translatedStr) {
            const parts = translatedStr.split(/\s*\|\|\|\s*/);
            card.querySelector(".m-hi-cat").value = (parts[0] || "").trim();
            card.querySelector(".m-hi-h").value = (parts[1] || "").trim();
            card.querySelector(".m-hi-c").value = (parts[2] || "").split(/\s*\|\s*/).map((b) => b.trim()).filter(Boolean).join("\n");
            card.querySelector(".m-hi-imp").value = (parts[3] || "").trim();
            card.querySelector(".m-hi-st").value = (parts[4] || "").trim();
            card.querySelector(".m-mcq-hi-q").value = (parts[5] || "").trim();
            card.querySelector(".m-mcq-hi-o0").value = (parts[6] || "").trim();
            card.querySelector(".m-mcq-hi-o1").value = (parts[7] || "").trim();
            card.querySelector(".m-mcq-hi-o2").value = (parts[8] || "").trim();
            card.querySelector(".m-mcq-hi-o3").value = (parts[9] || "").trim();
            card.querySelector(".m-mcq-hi-exp").value = (parts[10] || "").trim();
        }
    } catch (e) {
        alert("Translation Error: " + e.message);
    } finally {
        btnEl.innerHTML = orig;
        btnEl.disabled = false;
    }
};

window.saveManageCard = async function (btnEl) {
    const orig = btnEl.innerHTML;
    btnEl.innerHTML = "💾 Saving...";
    btnEl.disabled = true;

    const card = btnEl.closest(".manage-staged-card");
    const docId = card.getAttribute("data-docid");
    const ansIdx = Math.max(0, Math.min(3, parseInt(card.querySelector(".m-mcq-ans").value, 10) || 0));

    const updatedObj = {
        priority: card.querySelector(".m-priority").value,
        category_hi: card.querySelector(".m-hi-cat").value.trim(),
        oneLiner: card.querySelector(".m-en-h").value.trim(),
        oneLiner_hi: card.querySelector(".m-hi-h").value.trim(),
        contextBullets: card.querySelector(".m-en-c").value.split("\n").map((b) => b.trim()).filter(Boolean),
        contextBullets_hi: card.querySelector(".m-hi-c").value.split("\n").map((b) => b.trim()).filter(Boolean),
        impact: card.querySelector(".m-en-imp").value.trim(),
        impact_hi: card.querySelector(".m-hi-imp").value.trim(),
        staticBox: { facts: card.querySelector(".m-en-st").value.trim() },
        staticBox_hi: { facts: card.querySelector(".m-hi-st").value.trim() },
        mcq: {
            question: card.querySelector(".m-mcq-en-q").value.trim(),
            options: [
                card.querySelector(".m-mcq-en-o0").value.trim(),
                card.querySelector(".m-mcq-en-o1").value.trim(),
                card.querySelector(".m-mcq-en-o2").value.trim(),
                card.querySelector(".m-mcq-en-o3").value.trim()
            ],
            correctIndex: ansIdx,
            explanation: card.querySelector(".m-mcq-en-exp").value.trim()
        },
        mcq_hi: {
            question: card.querySelector(".m-mcq-hi-q").value.trim(),
            options: [
                card.querySelector(".m-mcq-hi-o0").value.trim(),
                card.querySelector(".m-mcq-hi-o1").value.trim(),
                card.querySelector(".m-mcq-hi-o2").value.trim(),
                card.querySelector(".m-mcq-hi-o3").value.trim()
            ],
            correctIndex: ansIdx,
            explanation: card.querySelector(".m-mcq-hi-exp").value.trim()
        }
    };

    try {
        await updateDoc(doc(db, "daily_news", docId), updatedObj);
        const idx = caInspectCache.findIndex((c) => c.id === docId);
        if (idx > -1) caInspectCache[idx] = { ...caInspectCache[idx], ...updatedObj };
        btnEl.innerHTML = "✅ Saved!";
        setTimeout(() => {
            btnEl.innerHTML = orig;
            btnEl.disabled = false;
        }, 1600);
    } catch (err) {
        alert("Save Error: " + err.message);
        btnEl.innerHTML = orig;
        btnEl.disabled = false;
    }
};

window.deleteCACard = async function (id) {
    if (!confirm("Permanently delete this Daily CA card?")) return;
    try {
        await deleteDoc(doc(db, "daily_news", id));
        caInspectCache = caInspectCache.filter((c) => c.id !== id);
        renderCAManageCards();
    } catch (e) {
        alert("Delete Error: " + e.message);
    }
};

window.purgeSelectedDay = async function () {
    const targetDate = document.getElementById("caManageDate").value;
    if (!caInspectCache.length) return alert("No cards loaded for this date.");
    if (!confirm(`⚠️ DANGER: Permanently delete ALL ${caInspectCache.length} Daily CA cards for ${targetDate}?`)) return;
    try {
        const batch = writeBatch(db);
        caInspectCache.forEach((c) => batch.delete(doc(db, "daily_news", c.id)));
        await batch.commit();
        alert(`✅ Purged all cards for ${targetDate}.`);
        fetchCAManage();
    } catch (e) {
        alert("Purge Error: " + e.message);
    }
};

document.getElementById("caManageDate")?.addEventListener("change", fetchCAManage);
document.getElementById("caManageCategory")?.addEventListener("change", renderCAManageCards);
document.getElementById("btnRefreshCAManage")?.addEventListener("click", fetchCAManage);