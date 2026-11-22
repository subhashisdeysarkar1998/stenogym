// STENOGYM CURRENT AFFAIRS DESK ENGINE (v4.0)
// ==========================================

// ==========================================
// 1. ZEN-MODE SCROLL & BACK-TO-TOP
// ==========================================
const secondaryNav = document.getElementById("secondaryNavBar");
const compHeader = document.getElementById("compilationHeader");

window.addEventListener(
    "scroll",
    () => {
        const currentScrollY = window.scrollY;
        const btnTop = document.getElementById("scrollToTopBtn");

        if (btnTop) {
            if (currentScrollY > 350) {
                btnTop.classList.remove("opacity-0", "translate-y-5", "pointer-events-none");
                btnTop.classList.add("opacity-100", "translate-y-0", "pointer-events-auto");
            } else {
                btnTop.classList.add("opacity-0", "translate-y-5", "pointer-events-none");
                btnTop.classList.remove("opacity-100", "translate-y-0", "pointer-events-auto");
            }
        }

        if (currentScrollY > 150) {
            secondaryNav?.classList.add("-translate-y-[150%]", "opacity-0");
            compHeader?.classList.add("-translate-y-[150%]", "opacity-0");
        } else {
            secondaryNav?.classList.remove("-translate-y-[150%]", "opacity-0");
            compHeader?.classList.remove("-translate-y-[150%]", "opacity-0");
        }
    },
    { passive: true }
);

// ==========================================
// 2. ZERO-LAG DRAG-TO-SCROLL (PC ONLY)
// ==========================================
const isMobileDevice = window.innerWidth < 768 || "ontouchstart" in window;

if (!isMobileDevice) {
    let activeScrollZone = null;
    let isDragging = false;
    let startY = 0;
    let scrollTopTarget = 0;

    document.addEventListener("mousedown", (e) => {
        const scrollZone = e.target.closest(".drag-scroll-zone");
        if (!scrollZone) return;
        isDragging = true;
        activeScrollZone = scrollZone;
        startY = e.pageY - activeScrollZone.offsetTop;
        scrollTopTarget = activeScrollZone.scrollTop;
        activeScrollZone.classList.add("is-dragging");
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDragging || !activeScrollZone) return;
        e.preventDefault();
        const y = e.pageY - activeScrollZone.offsetTop;
        const walk = (y - startY) * 1.5;
        window.requestAnimationFrame(() => {
            if (activeScrollZone) activeScrollZone.scrollTop = scrollTopTarget - walk;
        });
    });

    document.addEventListener("mouseup", () => {
        if (activeScrollZone) {
            activeScrollZone.classList.remove("is-dragging");
            activeScrollZone = null;
        }
        isDragging = false;
    });
}

// ==========================================
// 3. FIREBASE INIT (LONG POLLING + REST)
// ==========================================
const FIREBASE_PROJECT_ID = "stenogym";
const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

const firebaseConfig = {
    apiKey: "AIzaSyCilbp4K3EXNZbG2a4R-CeZQk7ijtqQh10",
    authDomain: "stenogym.firebaseapp.com",
    projectId: FIREBASE_PROJECT_ID
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
// Force HTTP Long Polling so Edge/ISP clients never get stuck offline during bookmark sync
try {
    db.settings({ experimentalForceLongPolling: true });
} catch (e) {}

db.enablePersistence().catch((err) => {
    if (err.code !== "failed-precondition" && err.code !== "unimplemented") {
        console.warn("Persistence note:", err);
    }
});

let activeUser = null;
const urlParams = new URLSearchParams(window.location.search);
let activeView = urlParams.get("tab") || sessionStorage.getItem("lastActiveTab") || "daily";
let activeMonthlyFolder = urlParams.get("folder") || null;
let activeSpecialFolderFilter = "all";
let savedBookmarks = JSON.parse(localStorage.getItem("stenoBookmarks") || "[]");

firebase.auth().onAuthStateChanged((user) => {
    activeUser = user;
    if (user) {
        document.getElementById("desktopLoginBtn")?.classList.add("hidden");
        document.getElementById("mobileLoginBtn")?.classList.add("hidden");
        document.getElementById("navDashboard")?.classList.remove("hidden");
        document.getElementById("navDashboardMob")?.classList.remove("hidden");
        document.getElementById("btnLogout")?.classList.remove("hidden");
        document.getElementById("mobileLogoutBtn")?.classList.remove("hidden");

        const logoutHandler = () => firebase.auth().signOut().then(() => window.location.reload());
        const btnLogout = document.getElementById("btnLogout");
        const mobLogout = document.getElementById("mobileLogoutBtn");
        if (btnLogout) btnLogout.onclick = logoutHandler;
        if (mobLogout) mobLogout.onclick = logoutHandler;

        const wm = document.getElementById("forensicWatermark");
        if (wm) wm.innerHTML = Array(30).fill(`<span>${escapeHtml(user.email)}</span>`).join("");

        // Multi-device bookmark cloud sync
        const localBookmarks = JSON.parse(localStorage.getItem("stenoBookmarks") || "[]");
        const userRef = db.collection("users").doc(user.uid);

        userRef
            .get()
            .then((doc) => {
                const cloudBookmarks = doc.exists && Array.isArray(doc.data().bookmarks) ? doc.data().bookmarks : [];
                const mergedBookmarks = [...new Set([...localBookmarks, ...cloudBookmarks])];
                userRef.set({ bookmarks: mergedBookmarks }, { merge: true }).catch(() => {});
                localStorage.setItem("stenoBookmarks", JSON.stringify(mergedBookmarks));
                savedBookmarks = mergedBookmarks;

                if (activeView === "daily") renderDailyView();
                if (activeView === "compilationActive") renderCompilationPage(currentCompilationPage);
            })
            .catch(() => {});
    } else {
        document.getElementById("desktopLoginBtn")?.classList.remove("hidden");
        document.getElementById("mobileLoginBtn")?.classList.remove("hidden");
        document.getElementById("navDashboard")?.classList.add("hidden");
        document.getElementById("navDashboardMob")?.classList.add("hidden");
        document.getElementById("btnLogout")?.classList.add("hidden");
        document.getElementById("mobileLogoutBtn")?.classList.add("hidden");
        const wm = document.getElementById("forensicWatermark");
        if (wm) wm.innerHTML = "";
    }
});

// Anti-theft & keyboard navigation
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["c", "p", "s", "u"].includes(e.key.toLowerCase())) {
        e.preventDefault();
    }
});

window.addEventListener("keydown", (e) => {
    if (["input", "textarea", "select"].includes(document.activeElement?.tagName?.toLowerCase())) return;
    if (activeView === "daily") {
        if (e.key === "ArrowLeft") document.getElementById("btnPrevDay")?.click();
        else if (e.key === "ArrowRight") document.getElementById("btnNextDay")?.click();
    }
});

function requireLogin(e) {
    if (!activeUser) {
        if (e) e.preventDefault();
        document.getElementById("premiumModal")?.classList.remove("hidden");
        return false;
    }
    return true;
}

window.closePremiumModal = () => document.getElementById("premiumModal")?.classList.add("hidden");
window.closeTgModal = () => document.getElementById("telegramGrowthModal")?.classList.add("hidden");

// ==========================================
// 4. TELEGRAM SOFT GATE & SMART PDF ROUTING
// ==========================================
function isDirectCheckoutUrl(url) {
    if (!url) return false;
    return /razorpay\.|rzp\.io|cosmofeed\.com|topmate\.io|instamojo\.com/i.test(url);
}

window.triggerTelegramDownload = function (e, type = "daily", urlEn = null, urlHi = null) {
    if (e) e.preventDefault();
    const targetUrl = currentLang === "hi" ? urlHi || urlEn : urlEn || urlHi;

    // Paid checkout links open directly without showing Telegram gate
    if (type === "compilation" && isDirectCheckoutUrl(targetUrl)) {
        window.open(targetUrl, "_blank");
        return;
    }

    const hasJoined = localStorage.getItem("hasJoinedTelegram");
    if (!hasJoined) {
        window.pendingDownload = { type, urlEn, urlHi };
        document.getElementById("telegramGrowthModal")?.classList.remove("hidden");
    } else {
        executeDownload(type, urlEn, urlHi);
    }
};

window.acceptTelegramAndDownload = function () {
    localStorage.setItem("hasJoinedTelegram", "true");
    closeTgModal();
    setTimeout(() => {
        if (window.pendingDownload) {
            executeDownload(window.pendingDownload.type, window.pendingDownload.urlEn, window.pendingDownload.urlHi);
        }
    }, 900);
};

function executeDownload(type, urlEn, urlHi) {
    if (type === "daily") {
        generateDailyPDF();
    } else if (type === "compilation") {
        const targetUrl = currentLang === "hi" ? urlHi || urlEn : urlEn || urlHi;
        if (targetUrl) window.open(targetUrl, "_blank");
    }
}

// ==========================================
// 5. THEME & BILINGUAL LANGUAGE ENGINE
// ==========================================
const htmlTag = document.documentElement;
const themeBtn = document.getElementById("themeToggleBtn");
const themeIcon = document.getElementById("themeIcon");
const mobileThemeBtn = document.getElementById("mobileThemeToggleBtn");

function syncThemeIcons() {
    const isDark = htmlTag.classList.contains("dark");
    if (themeIcon) themeIcon.textContent = isDark ? "☀️" : "🌙";
    if (mobileThemeBtn) mobileThemeBtn.textContent = isDark ? "☀️" : "🌙";
}
syncThemeIcons();

function toggleTheme() {
    if (htmlTag.classList.contains("dark")) {
        htmlTag.classList.remove("dark");
        localStorage.setItem("theme", "light");
    } else {
        htmlTag.classList.add("dark");
        localStorage.setItem("theme", "dark");
    }
    syncThemeIcons();
}
themeBtn?.addEventListener("click", toggleTheme);
mobileThemeBtn?.addEventListener("click", toggleTheme);

let currentLang = localStorage.getItem("preferredLang") || "en";

const MOBILE_CAT_OPTIONS = {
    en: {
        all: "🌟 Filter: All News",
        "Banking & Economy": "🏦 Banking & Economy",
        "National & Global": "🌍 National & Global",
        "Science & Defence": "🚀 Science & Defence",
        "Persons in News": "👤 Persons in News",
        Sports: "🏆 Sports",
        "Awards & Honours": "🏅 Awards & Honours"
    },
    hi: {
        all: "🌟 फ़िल्टर: सभी समाचार",
        "Banking & Economy": "🏦 बैंकिंग और अर्थव्यवस्था",
        "National & Global": "🌍 राष्ट्रीय और वैश्विक",
        "Science & Defence": "🚀 विज्ञान और रक्षा",
        "Persons in News": "👤 चर्चा में रहे व्यक्ति",
        Sports: "🏆 खेल जगत",
        "Awards & Honours": "🏅 पुरस्कार और सम्मान"
    }
};

function applyStaticTranslations() {
    document.querySelectorAll(".translation-el").forEach((el) => {
        if (currentLang === "hi" && el.hasAttribute("data-hi")) el.innerHTML = el.getAttribute("data-hi");
        else if (el.hasAttribute("data-en")) el.innerHTML = el.getAttribute("data-en");
    });

    const mobSel = document.getElementById("mobileCategorySelect");
    if (mobSel) {
        const labels = MOBILE_CAT_OPTIONS[currentLang] || MOBILE_CAT_OPTIONS.en;
        Array.from(mobSel.options).forEach((opt) => {
            if (labels[opt.value]) opt.textContent = labels[opt.value];
        });
    }
}

window.setLanguage = function (lang) {
    currentLang = lang;
    localStorage.setItem("preferredLang", lang);

    const btnsEn = [document.getElementById("btnLangEn"), document.getElementById("btnLangEnMob")];
    const btnsHi = [document.getElementById("btnLangHi"), document.getElementById("btnLangHiMob")];
    if (lang === "en") {
        btnsEn.forEach((b) => {
            if (b) {
                b.classList.add("bg-indigo-600", "text-white");
                b.classList.remove("text-slate-400");
            }
        });
        btnsHi.forEach((b) => {
            if (b) {
                b.classList.remove("bg-indigo-600", "text-white");
                b.classList.add("text-slate-400");
            }
        });
    } else {
        btnsHi.forEach((b) => {
            if (b) {
                b.classList.add("bg-indigo-600", "text-white");
                b.classList.remove("text-slate-400");
            }
        });
        btnsEn.forEach((b) => {
            if (b) {
                b.classList.remove("bg-indigo-600", "text-white");
                b.classList.add("text-slate-400");
            }
        });
    }
    applyStaticTranslations();

    if (activeView === "daily") {
        renderDailyView();
        updateProgress();
    } else if (activeView === "compilationActive") {
        renderCompilationPage(currentCompilationPage);
    } else if (["weekly", "monthly", "special"].includes(activeView)) {
        renderCurrentShelf(activeView);
    }
};

// ==========================================
// 6. REST PARSER & DATE / STRING HELPERS
// ==========================================
function formatRestDocument(doc) {
    function parseValue(val) {
        if (!val || typeof val !== "object") return null;
        if (val.stringValue !== undefined) return val.stringValue;
        if (val.booleanValue !== undefined) return val.booleanValue;
        if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
        if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
        if (val.timestampValue !== undefined) return val.timestampValue;
        if (val.arrayValue !== undefined) return val.arrayValue.values ? val.arrayValue.values.map(parseValue) : [];
        if (val.mapValue !== undefined && val.mapValue.fields) {
            const mapObj = {};
            for (const [k, v] of Object.entries(val.mapValue.fields)) {
                mapObj[k] = parseValue(v);
            }
            return mapObj;
        }
        return null;
    }
    const data = {};
    if (doc && doc.fields) {
        for (const [key, val] of Object.entries(doc.fields)) {
            data[key] = parseValue(val);
        }
    }
    return { id: doc?.name ? doc.name.split("/").pop() : "", ...data };
}

async function restGetDoc(collectionName, docId) {
    const url = `${FIRESTORE_REST_BASE}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return formatRestDocument(json);
}

function getISTDateObj(dateObj = new Date()) {
    const utc = dateObj.getTime() + dateObj.getTimezoneOffset() * 60000;
    return new Date(utc + 3600000 * 5.5);
}

function getISTDateString(dateObj = new Date()) {
    const istDate = getISTDateObj(dateObj);
    const yyyy = istDate.getFullYear();
    const mm = String(istDate.getMonth() + 1).padStart(2, "0");
    const dd = String(istDate.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function formatISTDisplay(dateStr) {
    if (!dateStr || !dateStr.includes("-")) return dateStr || "";
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function escapeHtml(v) {
    const d = document.createElement("div");
    d.textContent = v ?? "";
    return d.innerHTML;
}

function escapeJsStr(v) {
    return String(v ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, "&quot;");
}

function stripBoldMarkers(str) {
    return String(str ?? "").replace(/\*\*/g, "");
}

function formatUIText(str) {
    if (!str) return "";
    return escapeHtml(str).replace(
        /\*\*(.*?)\*\*/g,
        '<span class="bg-yellow-200 dark:bg-yellow-900/40 px-1 rounded text-slate-900 dark:text-yellow-100 font-bold">$1</span>'
    );
}

function getCleanDeckTitle(ed) {
    if (ed.displayTitle && ed.displayTitle.trim()) return ed.displayTitle.trim();
    const raw = ed.date || ed.id || "Deck";
    return raw.replace(/[-_]+/g, " ").trim();
}

function getTimestampMs(ts) {
    if (!ts) return 0;
    if (typeof ts === "string") {
        const ms = Date.parse(ts);
        return isNaN(ms) ? 0 : ms;
    }
    if (typeof ts === "object" && ts.seconds) return ts.seconds * 1000;
    return 0;
}

// ==========================================
// 7. STUDY STREAK, DATE & AUDIO BRIEF
// ==========================================
let selectedDateStr = urlParams.get("date") || getISTDateString();
let allArticlesCache = [];
let activeCategoryFilter = "all";
let dailyMode = "notes"; // 'notes' | 'quiz'
let readArticlesSet = new Set();

const dateInput = document.getElementById("selectedDateInput");
if (dateInput) dateInput.value = selectedDateStr;

window.updateLocalStudyTracker = function (isDailyMcq = false) {
    const todayIST = getISTDateObj();
    const todayStr = getISTDateString(todayIST);
    const lastStudyDate = localStorage.getItem("lastStudyDate");
    let currentStreak = parseInt(localStorage.getItem("studyStreak") || "0", 10);

    if (lastStudyDate !== todayStr) {
        if (lastStudyDate) {
            const yesterdayIST = new Date(todayIST.getTime() - 86400000);
            const yesterdayStr = getISTDateString(yesterdayIST);
            currentStreak = lastStudyDate === yesterdayStr ? currentStreak + 1 : 1;
        } else {
            currentStreak = 1;
        }
        localStorage.setItem("studyStreak", currentStreak.toString());
        localStorage.setItem("lastStudyDate", todayStr);
    }

    if (isDailyMcq) {
        const dailyProg = JSON.parse(localStorage.getItem("quiz_prog_daily") || '{"correct":0,"attempted":0,"answers":{},"lastUpdated":0}');
        dailyProg.attempted++;
        dailyProg.lastUpdated = Date.now();
        localStorage.setItem("quiz_prog_daily", JSON.stringify(dailyProg));
    }
};

function updateUrlAndLoad(dateStr) {
    window.history.pushState({ path: window.location.href }, "", `?tab=daily&date=${dateStr}`);
    loadNewsForDate(dateStr);
}

window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const topicParam = params.get("topic");
    const folderParam = params.get("folder");
    selectedDateStr = params.get("date") || getISTDateString();
    if (dateInput) dateInput.value = selectedDateStr;
    const newTab = params.get("tab") || "daily";

    if (topicParam) {
        triggerTopicRouter(topicParam);
        return;
    }
    if (newTab === "daily") setCadence(tabDaily, dailyFeedView, "daily", false);
    else if (newTab === "weekly") setCadence(tabWeekly, weeklyDrillView, "weekly", false);
    else if (newTab === "monthly") {
        activeMonthlyFolder = folderParam || null;
        setCadence(tabMonthly, monthlyPdfView, "monthly", false);
    } else if (newTab === "special") {
        activeSpecialFolderFilter = folderParam || "all";
        setCadence(tabSpecial, specialTopicView, "special", false);
    }
});

dateInput?.addEventListener("change", (e) => {
    selectedDateStr = e.target.value;
    updateUrlAndLoad(selectedDateStr);
});

document.getElementById("btnPrevDay")?.addEventListener("click", () => {
    const [y, m, d] = selectedDateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d - 1);
    selectedDateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    if (dateInput) dateInput.value = selectedDateStr;
    updateUrlAndLoad(selectedDateStr);
});

document.getElementById("btnNextDay")?.addEventListener("click", () => {
    const [y, m, d] = selectedDateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d + 1);
    selectedDateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    if (dateInput) dateInput.value = selectedDateStr;
    updateUrlAndLoad(selectedDateStr);
});

const audioSynth = window.speechSynthesis;
let isAudioPlaying = false;

window.toggleAudioBrief = function () {
    const btnIcon = document.getElementById("audioIcon");
    const btnLabel = document.getElementById("audioLabel");

    if (isAudioPlaying) {
        audioSynth.cancel();
        isAudioPlaying = false;
        if (btnIcon) btnIcon.textContent = "🎧";
        if (btnLabel) btnLabel.textContent = currentLang === "hi" ? "2 मिनट" : "2m Brief";
        return;
    }

    if (allArticlesCache.length === 0) return alert("No news available for audio brief.");

    let textToRead = currentLang === "hi" ? "आज के करेंट अफेयर्स। " : "Here is your Stenogym Daily Brief. ";
    allArticlesCache.forEach((item, idx) => {
        const headline = currentLang === "hi" ? item.oneLiner_hi || item.oneLiner || "" : item.oneLiner || "";
        textToRead += `News item ${idx + 1}. ${stripBoldMarkers(headline)}. `;
    });

    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.lang = currentLang === "hi" ? "hi-IN" : "en-US";
    utterance.rate = 1.0;

    utterance.onend = () => {
        isAudioPlaying = false;
        if (btnIcon) btnIcon.textContent = "🎧";
        if (btnLabel) btnLabel.textContent = currentLang === "hi" ? "2 मिनट" : "2m Brief";
    };

    audioSynth.speak(utterance);
    isAudioPlaying = true;
    if (btnIcon) btnIcon.textContent = "⏹️";
    if (btnLabel) btnLabel.textContent = currentLang === "hi" ? "रोकें" : "Stop";
};

// ==========================================
// 8. 4-TAB CADENCE ROUTER & CATEGORY SYNC
// ==========================================
const tabDaily = document.getElementById("tabDaily");
const tabWeekly = document.getElementById("tabWeekly");
const tabMonthly = document.getElementById("tabMonthly");
const tabSpecial = document.getElementById("tabSpecial");

const dailyFeedView = document.getElementById("dailyFeedView");
const weeklyDrillView = document.getElementById("weeklyDrillView");
const monthlyPdfView = document.getElementById("monthlyPdfView");
const specialTopicView = document.getElementById("specialTopicView");
const compilationWorkspace = document.getElementById("compilationWorkspace");
const dateControlBar = document.getElementById("dateControlBar");
const headerCategorySection = document.getElementById("headerCategorySection");

function highlightActiveTab(activeTabBtn) {
    [tabDaily, tabWeekly, tabMonthly, tabSpecial].forEach((t) => {
        if (!t) return;
        t.classList.remove("bg-indigo-600", "text-white", "shadow-sm");
        t.classList.add("text-slate-500", "dark:text-slate-400");
    });
    if (activeTabBtn) {
        activeTabBtn.classList.remove("text-slate-500", "dark:text-slate-400");
        activeTabBtn.classList.add("bg-indigo-600", "text-white", "shadow-sm");
    }
}

function setHeaderCategoryVisibility(show) {
    if (!headerCategorySection) return;
    headerCategorySection.classList.toggle("hidden", !show);
}

function setActiveCategory(cat, shouldRender = true) {
    activeCategoryFilter = cat || "all";

    document.querySelectorAll(".cat-pill").forEach((p) => {
        const isMatch = p.getAttribute("data-cat") === activeCategoryFilter;
        p.className = isMatch
            ? "cat-pill active bg-indigo-600 text-white px-3 py-2 rounded-xl font-bold text-xs whitespace-nowrap shadow-md transition translation-el"
            : "cat-pill bg-slate-800 text-slate-300 hover:bg-slate-700 px-3 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition translation-el";
    });

    const mobSel = document.getElementById("mobileCategorySelect");
    if (mobSel && mobSel.value !== activeCategoryFilter) mobSel.value = activeCategoryFilter;

    if (!shouldRender) return;
    if (activeView === "daily") renderDailyView();
    if (activeView === "compilationActive") {
        currentCompilationPage = 1;
        renderCompilationPage(1);
    }
}

document.querySelectorAll(".cat-pill").forEach((btn) => {
    btn.addEventListener("click", () => setActiveCategory(btn.getAttribute("data-cat")));
});

document.getElementById("mobileCategorySelect")?.addEventListener("change", (e) => {
    setActiveCategory(e.target.value);
});

function setCadence(activeTab, viewElement, cadenceVal, updateHistory = true) {
    activeView = cadenceVal;
    highlightActiveTab(activeTab);

    [dailyFeedView, weeklyDrillView, monthlyPdfView, specialTopicView, compilationWorkspace, document.getElementById("emptyFeedState"), document.getElementById("dailyQuizStatusBar")].forEach(
        (v) => v?.classList.add("hidden")
    );
    viewElement?.classList.remove("hidden");

    const isDaily = cadenceVal === "daily";
    if (dateControlBar) dateControlBar.style.display = isDaily ? "flex" : "none";
    const pw = document.getElementById("progressWidget");
    if (pw) pw.style.display = isDaily ? "" : "none";

    // Auto-hide category filters on Weekly / Monthly / Special shelf views
    setHeaderCategoryVisibility(isDaily);
    sessionStorage.setItem("lastActiveTab", cadenceVal);

    if (cadenceVal === "weekly" || cadenceVal === "monthly" || cadenceVal === "special") {
        if (updateHistory) {
            let targetUrl = `?tab=${cadenceVal}`;
            if (cadenceVal === "monthly" && activeMonthlyFolder) targetUrl += `&folder=${encodeURIComponent(activeMonthlyFolder)}`;
            window.history.replaceState({}, "", targetUrl);
        }
        loadCompilationShelf(cadenceVal);
    } else {
        if (updateHistory) {
            window.history.replaceState({}, "", `?tab=daily&date=${selectedDateStr}`);
        }
        loadNewsForDate(selectedDateStr);
    }
}

tabDaily?.addEventListener("click", () => setCadence(tabDaily, dailyFeedView, "daily"));
tabWeekly?.addEventListener("click", () => setCadence(tabWeekly, weeklyDrillView, "weekly"));
tabMonthly?.addEventListener("click", () => {
    activeMonthlyFolder = null;
    setCadence(tabMonthly, monthlyPdfView, "monthly");
});
tabSpecial?.addEventListener("click", () => {
    activeSpecialFolderFilter = "all";
    setCadence(tabSpecial, specialTopicView, "special");
});

// ==========================================
// 9. BOOKMARKS, PROGRESS & SCROLL HIGHLIGHT
// ==========================================
window.toggleBookmark = function (e, docId, btnId) {
    if (!requireLogin(e)) return;
    const btn = document.getElementById(btnId);
    const idx = savedBookmarks.indexOf(docId);

    if (idx > -1) {
        savedBookmarks.splice(idx, 1);
        btn?.classList.remove("bg-indigo-100", "dark:bg-indigo-900/50", "text-indigo-700", "dark:text-indigo-400");
        if (btn) btn.innerHTML = currentLang === "hi" ? "🔖 सहेजें" : "🔖 Save";
    } else {
        savedBookmarks.push(docId);
        btn?.classList.add("bg-indigo-100", "dark:bg-indigo-900/50", "text-indigo-700", "dark:text-indigo-400");
        if (btn) btn.innerHTML = currentLang === "hi" ? "🔖 सहेजा गया" : "🔖 Saved";
    }
    localStorage.setItem("stenoBookmarks", JSON.stringify(savedBookmarks));

    if (activeUser) {
        db.collection("users").doc(activeUser.uid).set({ bookmarks: savedBookmarks }, { merge: true }).catch(() => {});
    }
};

window.markAsRead = function (cardId, uiIndex) {
    const cardFront = document.getElementById(`cardContainer-${uiIndex}`);
    const btn = document.getElementById(`btnRead-${uiIndex}`);
    if (readArticlesSet.has(cardId)) {
        readArticlesSet.delete(cardId);
        cardFront?.classList.remove("card-completed");
        if (btn) {
            btn.innerHTML = currentLang === "hi" ? "पढ़ा हुआ चिह्नित करें" : "Mark as Read";
            btn.className =
                "flex-1 justify-center flex items-center gap-1.5 border font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm transition bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700";
        }
    } else {
        readArticlesSet.add(cardId);
        cardFront?.classList.add("card-completed");
        if (btn) {
            btn.innerHTML = currentLang === "hi" ? "✅ पूर्ण" : "✅ Completed";
            btn.className =
                "flex-1 justify-center flex items-center gap-1.5 border font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm transition bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700";
        }
    }
    updateProgress();
};

function updateProgress() {
    const total = allArticlesCache.length;
    const readCount = readArticlesSet.size;
    const filler = document.getElementById("progressBarFiller");
    const txt = document.getElementById("progressText");
    if (filler) filler.style.width = `${total === 0 ? 0 : (readCount / total) * 100}%`;
    if (txt) txt.innerText = currentLang === "hi" ? `${readCount}/${total} पढ़े गए` : `${readCount}/${total} Read`;
}

function scrollToAndHighlight(docId, isComp = false) {
    if (!docId) return;
    let targetEl = document.querySelector(`[data-docid="${CSS.escape(docId)}"]`);

    if (!targetEl && isComp && workingCompilationCards.length > 0) {
        const rawTarget = docId.replace(/^comp_/, "");
        const matchIdx = workingCompilationCards.findIndex((c) => c.id === docId || c.id === rawTarget);
        if (matchIdx > -1) {
            const targetPage = Math.floor(matchIdx / COMPILATION_PER_PAGE) + 1;
            if (targetPage !== currentCompilationPage) {
                currentCompilationPage = targetPage;
                renderCompilationPage(targetPage);
            }
            targetEl = document.querySelector(`[data-docid="${CSS.escape(workingCompilationCards[matchIdx].id)}"]`);
        }
    }

    if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        targetEl.classList.add("bookmark-highlight-ring");
        setTimeout(() => targetEl.classList.remove("bookmark-highlight-ring"), 3000);
    }
}

// ==========================================
// 10. DAILY CA FETCHER + 6:00 AM SCHEDULE LOCK
// ==========================================
async function fetchDailyNews(dateStr) {
    const cleanDate = (dateStr || "").trim();
    const queryPayload = {
        structuredQuery: {
            from: [{ collectionId: "daily_news" }],
            where: { fieldFilter: { field: { fieldPath: "date" }, op: "EQUAL", value: { stringValue: cleanDate } } }
        }
    };
    const url = `${FIRESTORE_REST_BASE}:runQuery`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(queryPayload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error("REST API Network Error");
        const json = await response.json();

        if (!json || json.length === 0 || (json.length === 1 && !json[0].document)) {
            return { empty: true, docs: [], error: false };
        }
        const cleanDocs = json
            .filter((item) => item.document)
            .map((item) => ({
                id: item.document.name.split("/").pop(),
                data: () => formatRestDocument(item.document)
            }));
        return { empty: cleanDocs.length === 0, docs: cleanDocs, error: false };
    } catch (error) {
        console.error("Network Drop Detected:", error);
        return { empty: true, docs: [], error: true };
    }
}

async function loadNewsForDate(dateStr) {
    document.getElementById("feedLoading")?.classList.remove("hidden");
    dailyFeedView?.classList.add("hidden");
    document.getElementById("dailyQuizStatusBar")?.classList.add("hidden");
    document.getElementById("emptyFeedState")?.classList.add("hidden");
    const badge = document.getElementById("displayDateBadge");
    if (badge) badge.innerText = formatISTDisplay(dateStr);

    try {
        const snapshot = await fetchDailyNews(dateStr);
        const rawArticles = !snapshot.empty && snapshot.docs ? snapshot.docs.map((d) => d.data()) : [];

        // Enforce 6:00 AM IST Schedule Lock
        const nowMs = Date.now();
        const scheduledFutureArticles = rawArticles.filter((item) => {
            if (!item.publishAt) return false;
            const pubMs = Date.parse(item.publishAt);
            return !isNaN(pubMs) && pubMs > nowMs;
        });
        allArticlesCache = rawArticles.filter((item) => {
            if (!item.publishAt) return true;
            const pubMs = Date.parse(item.publishAt);
            return isNaN(pubMs) || pubMs <= nowMs;
        });

        document.getElementById("feedLoading")?.classList.add("hidden");

        if (allArticlesCache.length === 0) {
            const emptyFeedState = document.getElementById("emptyFeedState");
            const todayStr = getISTDateString();
            const currentHour = getISTDateObj().getHours();
            const isHindi = currentLang === "hi";
            emptyFeedState.classList.remove("hidden");

            if (snapshot.error) {
                emptyFeedState.innerHTML = `
                    <div class="text-4xl mb-4 animate-bounce">📡</div>
                    <h3 class="text-xl font-bold text-slate-800 dark:text-white mb-2">${isHindi ? "कनेक्शन त्रुटि" : "Connection Error"}</h3>
                    <p class="text-slate-500 text-sm mb-4">${isHindi ? "दैनिक करेंट अफेयर्स लोड नहीं हो सका। कृपया पेज को रीफ्रेश करें।" : "The Daily CA could not be loaded. Please refresh the page."}</p>
                    <button onclick="location.reload()" class="bg-indigo-600 text-white px-6 py-2 rounded-xl font-semibold shadow hover:bg-indigo-700 transition">🔄 ${isHindi ? "रीफ्रेश करें" : "Refresh Page"}</button>`;
            } else if (scheduledFutureArticles.length > 0 || (dateStr === todayStr && currentHour < 6)) {
                emptyFeedState.innerHTML = `
                    <div class="text-4xl mb-4">🌅</div>
                    <h3 class="text-xl font-bold text-slate-800 dark:text-white mb-2">${isHindi ? "सुबह 6:00 बजे लाइव होगा" : "Scheduled for 6:00 AM"}</h3>
                    <p class="text-slate-500 text-sm mb-4">${isHindi ? "आज का करेंट अफेयर्स संकलित हो चुका है और सुबह 6:00 बजे (IST) लाइव होगा।" : "Today's Current Affairs digest is ready and unlocks sharp at 6:00 AM IST."}</p>
                    <button onclick="document.getElementById('btnPrevDay').click()" class="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">📖 ${isHindi ? "कल का पढ़ें" : "Read Yesterday's Digest"}</button>`;
            } else if (dateStr === todayStr) {
                emptyFeedState.innerHTML = `
                    <div class="text-4xl mb-4">⏳</div>
                    <h3 class="text-xl font-bold text-slate-800 dark:text-white mb-2">${isHindi ? "संकलन जारी है" : "Compiling..."}</h3>
                    <p class="text-slate-500 text-sm mb-4">${isHindi ? "आज का करेंट अफेयर्स अभी अपलोड नहीं हुआ है। हमारी टीम इसे संकलित कर रही है!" : "Today's news hasn't been uploaded yet. Our team is compiling it!"}</p>
                    <button onclick="location.reload()" class="bg-indigo-600 text-white px-6 py-2 rounded-xl font-semibold shadow hover:bg-indigo-700 transition">🔄 ${isHindi ? "रीफ्रेश करें" : "Refresh Feed"}</button>`;
            } else {
                emptyFeedState.innerHTML = `
                    <div class="text-4xl mb-4">📭</div>
                    <h3 class="text-xl font-bold text-slate-800 dark:text-white mb-2">${isHindi ? "कोई खबर नहीं" : "Archive Empty"}</h3>
                    <p class="text-slate-500 text-sm mb-4">${isHindi ? "इस विशिष्ट तिथि के लिए कोई खबर दर्ज नहीं की गई थी।" : "No news was filed for this specific date."}</p>
                    <button onclick="document.getElementById('selectedDateInput').value='${todayStr}'; document.getElementById('selectedDateInput').dispatchEvent(new Event('change'))" class="bg-slate-800 text-white px-6 py-2 rounded-xl font-semibold shadow hover:bg-slate-900 transition">📅 ${isHindi ? "आज पर जाएं" : "Jump to Today"}</button>`;
            }
            return;
        }

        const topNews = stripBoldMarkers(allArticlesCache[0].oneLiner || "Daily Exam Updates");
        document.title = `${formatISTDisplay(dateStr)} Current Affairs PDF & Quiz: ${topNews.substring(0, 60)}... | Stenogym`;
        document
            .querySelector('meta[name="description"]')
            ?.setAttribute("content", `Daily Current Affairs for ${formatISTDisplay(dateStr)}. Top News: ${topNews}. Free interactive notes & MCQs for SSC CGL, RRB NTPC, and IBPS PO.`);

        readArticlesSet.clear();
        updateProgress();
        renderDailyView();
        dailyFeedView?.classList.remove("hidden");
    } catch (err) {
        console.error("News load error:", err);
        document.getElementById("feedLoading")?.classList.add("hidden");
        const emptyFeedState = document.getElementById("emptyFeedState");
        emptyFeedState.classList.remove("hidden");
        emptyFeedState.innerHTML = `<div class="text-base text-rose-500 font-bold py-8">Critical Load Error: Please refresh the page.</div>`;
    }
}

// ==========================================
// 11. DAILY NOTES + DAILY RAPID QUIZ ENGINE
// ==========================================
window.setDailyMode = function (mode) {
    dailyMode = mode === "quiz" ? "quiz" : "notes";
    const btnNotes = document.getElementById("btnDailyModeNotes");
    const btnQuiz = document.getElementById("btnDailyModeQuiz");

    if (btnNotes) {
        btnNotes.className =
            dailyMode === "notes"
                ? "px-2.5 sm:px-3 py-1.5 bg-indigo-600 text-white rounded-lg shadow-xs transition translation-el"
                : "px-2.5 sm:px-3 py-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg transition translation-el";
    }
    if (btnQuiz) {
        btnQuiz.className =
            dailyMode === "quiz"
                ? "px-2.5 sm:px-3 py-1.5 bg-indigo-600 text-white rounded-lg shadow-xs transition translation-el"
                : "px-2.5 sm:px-3 py-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg transition translation-el";
    }

    if (activeView === "daily") renderDailyView();
};

function getDailyQuizStorageKey() {
    return `quiz_prog_daily_${selectedDateStr}`;
}

window.retakeDailyQuiz = function () {
    if (!confirm("Reset your Daily Rapid Quiz score for this date?")) return;
    localStorage.removeItem(getDailyQuizStorageKey());
    renderDailyView();
};

function renderDailyView() {
    const statusBar = document.getElementById("dailyQuizStatusBar");
    if (allArticlesCache.length === 0) {
        statusBar?.classList.add("hidden");
        return;
    }

    if (dailyMode === "quiz") {
        statusBar?.classList.remove("hidden");
        renderDailyRapidQuiz();
    } else {
        statusBar?.classList.add("hidden");
        renderFeedCards();
    }
}

function renderDailyRapidQuiz() {
    const feedContainer = document.getElementById("dailyFeedView");
    feedContainer.innerHTML = "";
    const filtered = activeCategoryFilter === "all" ? allArticlesCache : allArticlesCache.filter((item) => item.category === activeCategoryFilter);

    const saved = JSON.parse(localStorage.getItem(getDailyQuizStorageKey()) || '{"correct":0,"attempted":0,"answers":{}}');
    const scoreBadge = document.getElementById("dailyQuizScoreBadge");
    const subEl = document.getElementById("dailyQuizSubtitle");
    if (scoreBadge) scoreBadge.textContent = `Score: ${saved.correct}/${saved.attempted}`;
    if (subEl) subEl.textContent = `${formatISTDisplay(selectedDateStr)} • ${filtered.length} ${currentLang === "hi" ? "प्रश्न" : "Questions"}`;

    if (filtered.length === 0) {
        feedContainer.innerHTML = `<div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-10 text-center max-w-md mx-auto shadow-sm my-6"><div class="text-4xl mb-3">📂</div><h3 class="text-lg font-black text-slate-800 dark:text-white">${currentLang === "hi" ? "इस श्रेणी में कोई प्रश्न नहीं है।" : "No questions available for this category."}</h3></div>`;
        return;
    }

    let html = "";
    filtered.forEach((card, idx) => {
        const docId = card.id ? `daily_news_${card.id}` : `daily_news_temp-${idx}`;
        const displayCat = currentLang === "hi" ? card.category_hi || card.category || "" : card.category || "";
        const mcqData = currentLang === "hi" ? card.mcq_hi || card.mcq || {} : card.mcq || {};
        const safeExp = encodeURIComponent(mcqData?.explanation || "").replace(/'/g, "%27");
        const correctIdx = Number(mcqData?.correctIndex) || 0;

        html += `
        <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 md:p-6 rounded-2xl shadow-sm" id="dailyQuizCard-${idx}" data-docid="${escapeHtml(docId)}">
            <div class="mb-3 flex items-center justify-between gap-2 flex-wrap">
                <span class="text-[10px] font-black uppercase text-indigo-700 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/50 px-2 py-0.5 rounded">Q${idx + 1} of ${filtered.length}</span>
                ${displayCat ? `<span class="text-[10px] font-bold uppercase text-slate-400">${escapeHtml(displayCat)}</span>` : ""}
            </div>
            <h4 class="font-black text-slate-900 dark:text-white text-sm md:text-base mb-4 leading-snug">${formatUIText(mcqData.question || card.oneLiner)}</h4>
            <div class="space-y-2" id="dailyQuizOptions-${idx}">
                ${(mcqData.options || [])
                    .map(
                        (opt, oIdx) => `
                    <button onclick="handleDailyRapidAnswer(event, '${escapeJsStr(docId)}', ${idx}, ${oIdx}, ${correctIdx}, '${safeExp}')" class="w-full text-left bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 hover:border-indigo-400 text-slate-700 dark:text-slate-300 font-bold text-xs md:text-sm p-3 rounded-xl transition flex items-center justify-between shadow-xs daily-q-opt-${idx} disabled:cursor-not-allowed">
                        <span>${String.fromCharCode(65 + oIdx)}. ${formatUIText(opt)}</span><span class="status-marker text-xs font-black"></span>
                    </button>`
                    )
                    .join("")}
            </div>
            <div id="dailyQuizExp-${idx}" class="hidden mt-3.5 p-3 rounded-xl text-xs leading-relaxed font-semibold"></div>
        </div>`;
    });

    feedContainer.innerHTML = html;

    // Restore saved answers for this date
    filtered.forEach((card, idx) => {
        const docId = card.id ? `daily_news_${card.id}` : `daily_news_temp-${idx}`;
        const pastAns = saved.answers?.[docId];
        if (pastAns !== undefined) {
            const mcqData = currentLang === "hi" ? card.mcq_hi || card.mcq || {} : card.mcq || {};
            const safeExp = encodeURIComponent(mcqData?.explanation || "").replace(/'/g, "%27");
            restoreDailyRapidAnswerUI(idx, pastAns, Number(mcqData?.correctIndex) || 0, safeExp);
        }
    });
}

window.handleDailyRapidAnswer = function (e, docId, uiIdx, selIdx, corIdx, encodedExp) {
    const btns = document.querySelectorAll(`.daily-q-opt-${uiIdx}`);
    if (!btns.length || btns[0].disabled) return;

    const saved = JSON.parse(localStorage.getItem(getDailyQuizStorageKey()) || '{"correct":0,"attempted":0,"answers":{}}');
    if (saved.answers[docId] === undefined) {
        saved.attempted++;
        if (selIdx === corIdx) saved.correct++;
        saved.answers[docId] = selIdx;
        saved.lastUpdated = Date.now();
        localStorage.setItem(getDailyQuizStorageKey(), JSON.stringify(saved));
    }

    const scoreBadge = document.getElementById("dailyQuizScoreBadge");
    if (scoreBadge) scoreBadge.textContent = `Score: ${saved.correct}/${saved.attempted}`;
    updateLocalStudyTracker(true);
    restoreDailyRapidAnswerUI(uiIdx, selIdx, corIdx, encodedExp);

    if (!readArticlesSet.has(docId)) {
        readArticlesSet.add(docId);
        updateProgress();
    }
};

function restoreDailyRapidAnswerUI(uiIdx, selIdx, corIdx, encodedExp) {
    const btns = document.querySelectorAll(`.daily-q-opt-${uiIdx}`);
    const expContainer = document.getElementById(`dailyQuizExp-${uiIdx}`);
    if (!btns.length || !expContainer) return;

    btns.forEach((b) => {
        b.disabled = true;
        b.classList.add("opacity-50");
    });

    const correctText = currentLang === "hi" ? "✅ सही" : "✅ Correct";
    const incorrectText = currentLang === "hi" ? "❌ गलत" : "❌ Incorrect";

    if (selIdx === corIdx) {
        btns[selIdx].classList.remove("opacity-50");
        btns[selIdx].className = `w-full text-left font-bold text-xs md:text-sm p-3 rounded-xl transition flex items-center justify-between shadow-xs border border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-300 daily-q-opt-${uiIdx} disabled:cursor-not-allowed`;
        btns[selIdx].querySelector(".status-marker").textContent = correctText;
        expContainer.className = "mt-3.5 p-3 rounded-xl text-xs leading-relaxed font-semibold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 block";
    } else {
        btns[selIdx].classList.remove("opacity-50");
        btns[selIdx].className = `w-full text-left font-bold text-xs md:text-sm p-3 rounded-xl transition flex items-center justify-between shadow-xs border border-rose-500 bg-rose-50 dark:bg-rose-900/30 text-rose-900 dark:text-rose-300 daily-q-opt-${uiIdx} disabled:cursor-not-allowed`;
        btns[selIdx].querySelector(".status-marker").textContent = incorrectText;

        if (btns[corIdx]) {
            btns[corIdx].classList.remove("opacity-50");
            btns[corIdx].className = `w-full text-left font-bold text-xs md:text-sm p-3 rounded-xl transition flex items-center justify-between shadow-xs border border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-300 daily-q-opt-${uiIdx} disabled:cursor-not-allowed`;
            btns[corIdx].querySelector(".status-marker").textContent = correctText;
        }
        expContainer.className = "mt-3.5 p-3 rounded-xl text-xs leading-relaxed font-semibold bg-rose-50 dark:bg-rose-900/30 text-rose-900 dark:text-rose-300 border border-rose-200 dark:border-rose-800 block";
    }
    expContainer.innerHTML = formatUIText(decodeURIComponent(encodedExp));
}

function renderFeedCards() {
    const feedContainer = document.getElementById("dailyFeedView");
    feedContainer.innerHTML = "";
    const filtered = activeCategoryFilter === "all" ? allArticlesCache : allArticlesCache.filter((item) => item.category === activeCategoryFilter);

    if (filtered.length === 0 && allArticlesCache.length > 0) {
        feedContainer.innerHTML = `<div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-10 text-center max-w-md mx-auto shadow-sm my-6"><div class="text-4xl mb-3">📂</div><h3 class="text-lg font-black text-slate-800 dark:text-white">${currentLang === "hi" ? "इस श्रेणी में कोई समाचार नहीं है।" : "No news available for this category."}</h3></div>`;
        return;
    }

    const impactLabel = currentLang === "hi" ? "💡 प्रभाव:" : "💡 Impact:";
    const staticContextLabel = currentLang === "hi" ? "स्थैतिक संदर्भ (Static Context)" : "Static Context Box";
    const testFactLabel = currentLang === "hi" ? "तथ्य का परीक्षण करें" : "Test Fact";
    const liveVerifLabel = currentLang === "hi" ? "लाइव सत्यापन क्विज़" : "Live Verification Quiz";
    const backToNotesLabel = currentLang === "hi" ? "नोट्स पर वापस जाएं" : "Read Notes";
    const tryAgainLabel = currentLang === "hi" ? "पुनः प्रयास करें" : "Try Again";

    let html = "";
    filtered.forEach((card, idx) => {
        const docId = card.id ? `daily_news_${card.id}` : `daily_news_temp-${idx}`;
        const dailyIndex = idx + 1;

        const displayCat = currentLang === "hi" ? card.category_hi || card.category || "" : card.category || "";
        const displaySub = currentLang === "hi" ? card.subCategory_hi || card.subCategory || "" : card.subCategory || "";
        const displayHeadline = currentLang === "hi" ? card.oneLiner_hi || card.oneLiner || "" : card.oneLiner || "";
        const displayImpact = currentLang === "hi" ? card.impact_hi || card.impact || "" : card.impact || "";
        const displayBullets = (currentLang === "hi" ? card.contextBullets_hi || card.contextBullets || [] : card.contextBullets || []).filter((b) => b.trim() !== "");
        const mcqData = currentLang === "hi" ? card.mcq_hi || card.mcq || {} : card.mcq || {};
        const staticBoxText = currentLang === "hi" ? card.staticBox_hi?.facts || card.staticBox?.facts || "" : card.staticBox?.facts || "";

        const safeEmoji = card.emoji || "📰";
        const exams = card.targetExams ? card.targetExams.join(" • ") : "SSC • Banking • Railways";
        const safeExp = encodeURIComponent(mcqData?.explanation || "").replace(/'/g, "%27");
        const correctIdx = Number(mcqData?.correctIndex) || 0;

        const isRead = readArticlesSet.has(docId);
        const btnClass = isRead
            ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700"
            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700";
        const readBtnText = isRead ? (currentLang === "hi" ? "✅ पूर्ण" : "✅ Completed") : currentLang === "hi" ? "पढ़ा हुआ चिह्नित करें" : "Mark as Read";

        const isBkmrk = savedBookmarks.includes(docId);
        const bkmrkClass = isBkmrk ? "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400" : "text-slate-600 dark:text-slate-400";
        const bkmrkText = isBkmrk ? (currentLang === "hi" ? "🔖 सहेजा गया" : "🔖 Saved") : currentLang === "hi" ? "🔖 सहेजें" : "🔖 Save";

        const bulletsHtml = displayBullets
            .map((b) => `<li class="flex items-start gap-2 text-slate-700 dark:text-slate-300 text-xs md:text-sm leading-relaxed font-medium"><span class="text-indigo-500 font-black mt-0.5">📌</span><span>${formatUIText(b)}</span></li>`)
            .join("");

        let dataTableHtml = "";
        if (card.dataTable && Array.isArray(card.dataTable) && card.dataTable.length > 0) {
            dataTableHtml = `<div class="mt-3 overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg"><table class="w-full text-left text-xs bg-white dark:bg-slate-800">`;
            card.dataTable.forEach((row, rIdx) => {
                const bg = rIdx === 0 ? "bg-indigo-600 text-white font-black" : rIdx % 2 === 0 ? "bg-slate-50 dark:bg-slate-800/50" : "bg-transparent";
                const textC = rIdx === 0 ? "text-white" : "text-slate-700 dark:text-slate-300";
                dataTableHtml += `<tr class="${bg} ${textC} border-b border-slate-200 dark:border-slate-700 last:border-0">`;
                Object.values(row).forEach((val) => {
                    dataTableHtml += `<td class="p-2 whitespace-nowrap">${formatUIText(val)}</td>`;
                });
                dataTableHtml += `</tr>`;
            });
            dataTableHtml += `</table></div>`;
        }

        const staticBoxHtml = staticBoxText
            ? `<div class="mt-3.5 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/60 rounded-xl p-3 flex items-start gap-2.5 shadow-xs"><span class="text-indigo-600 dark:text-indigo-400 text-base mt-0.5 flex-shrink-0">🧠</span><div class="flex-grow"><span class="text-[9px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300 block mb-0.5">${staticContextLabel}</span><p class="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-snug">${formatUIText(staticBoxText)}</p></div></div>`
            : "";

        html += `
        <div class="perspective-1000 w-full transition-all duration-300 ${isRead ? "card-completed" : ""}" id="cardContainer-${idx}" data-docid="${escapeHtml(docId)}">
            <div class="flip-card-inner relative w-full transform-style-3d bg-transparent rounded-3xl transition-all duration-500">
                <div class="flip-card-front bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl flex flex-col justify-between min-h-[400px] max-h-[540px] shadow-sm hover:shadow-md transition">
                    <div class="flex-grow drag-scroll-zone hide-scrollbar p-5 md:p-6 pb-2">
                        <div class="flex flex-wrap items-center justify-between gap-2 mb-3 border-b border-slate-100 dark:border-slate-700/80 pb-2.5">
                            <div class="flex items-center gap-2">
                                <span class="bg-indigo-600 text-white text-[10px] font-black px-2 py-1 rounded-md">CARD #${dailyIndex}</span>
                                <span class="text-xl hidden md:inline">${safeEmoji}</span>
                                <div class="flex flex-col">
                                    <span class="text-slate-900 dark:text-white font-black text-xs uppercase tracking-tight">${escapeHtml(displayCat)}</span>
                                    <span class="text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase tracking-wider">${escapeHtml(displaySub)}</span>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-slate-500 dark:text-slate-400 text-[9px] font-black tracking-widest bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-0.5 rounded-full uppercase">🎯 ${escapeHtml(exams)}</span>
                                <button id="btnBookmark-${idx}" onclick="event.stopPropagation(); toggleBookmark(event, '${escapeJsStr(docId)}', 'btnBookmark-${idx}');" class="text-[10px] font-bold border border-slate-200 dark:border-slate-600 px-2 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition ${bkmrkClass} cursor-pointer">${bkmrkText}</button>
                            </div>
                        </div>
                        ${displayImpact ? `<div class="bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[10px] font-bold px-2.5 py-1 rounded-lg inline-block mb-3">${impactLabel} ${escapeHtml(displayImpact)}</div>` : ""}
                        <h3 class="text-base md:text-lg font-black text-slate-900 dark:text-white leading-snug mb-3">${formatUIText(displayHeadline)}</h3>
                        <ul class="space-y-2 mb-2">${bulletsHtml}</ul>
                        ${dataTableHtml}
                        ${staticBoxHtml}
                    </div>
                    <div class="flex-shrink-0 border-t border-slate-100 dark:border-slate-700/80 p-4 md:p-5 flex items-center justify-between gap-2 cursor-pointer bg-slate-50/50 dark:bg-slate-800 rounded-b-3xl" onclick="flipCard(${idx})">
                        <div class="flex gap-2 w-full">
                            <button class="flex-1 justify-center flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm transition"><span>🔄</span> ${testFactLabel}</button>
                            <button id="btnRead-${idx}" onclick="event.stopPropagation(); markAsRead('${escapeJsStr(docId)}', ${idx});" class="flex-1 justify-center flex items-center gap-1.5 border font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm transition ${btnClass}">${readBtnText}</button>
                        </div>
                    </div>
                </div>

                <div class="flip-card-back bg-slate-50 dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 rounded-3xl shadow-sm flex flex-col justify-between min-h-[400px] max-h-[540px] hover:shadow-md transition">
                    <div class="flex-grow drag-scroll-zone hide-scrollbar p-5 md:p-6 pb-2">
                        <div class="flex justify-between items-center mb-3 border-b border-indigo-100 dark:border-indigo-800 pb-2">
                            <span class="text-[9px] font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/50 px-2 py-1 rounded-md">${liveVerifLabel} #${dailyIndex}</span>
                        </div>
                        <h4 class="font-black text-slate-900 dark:text-white text-sm md:text-base mb-3 leading-snug">${formatUIText(mcqData?.question)}</h4>
                        <div id="mcqOptions-${idx}" class="space-y-2">
                            ${(mcqData?.options || [])
                                .map(
                                    (opt, oIdx) =>
                                        `<button onclick="handleOptionSelect(event, '${escapeJsStr(docId)}', ${idx}, ${oIdx}, ${correctIdx}, '${safeExp}')" class="w-full text-left bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-600 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-slate-700 dark:text-slate-300 font-bold text-xs md:text-sm p-3 rounded-xl transition flex items-center justify-between shadow-xs cursor-pointer disabled:cursor-not-allowed"><span>${String.fromCharCode(65 + oIdx)}. ${formatUIText(opt)}</span><span class="status-marker text-xs font-black"></span></button>`
                                )
                                .join("")}
                        </div>
                        <div id="mcqFeedback-${idx}" class="hidden mt-3 p-3 rounded-xl text-xs md:text-sm leading-relaxed font-semibold shadow-inner flex-col gap-1.5 items-start"><div id="mcqFeedbackText-${idx}"></div></div>
                    </div>
                    <div class="flex-shrink-0 border-t border-indigo-100 dark:border-indigo-800 p-4 md:p-5 flex items-center justify-between w-full gap-2 cursor-pointer bg-slate-100/50 dark:bg-slate-900 rounded-b-3xl" onclick="flipCard(${idx})">
                        <button id="btnTryAgain-${idx}" onclick="event.stopPropagation(); resetQuiz(${idx});" class="hidden flex-1 justify-center items-center gap-1 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-800 dark:text-slate-200 px-4 py-2.5 rounded-xl text-xs font-bold transition shadow-xs border border-slate-200 dark:border-slate-700 cursor-pointer"><span>🔄</span> ${tryAgainLabel}</button>
                        <button class="flex-1 justify-center items-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 shadow-xs px-4 py-2.5 rounded-xl transition">&larr; ${backToNotesLabel}</button>
                    </div>
                </div>
            </div>
        </div>`;
    });

    feedContainer.innerHTML = "";
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;
    const allNewCards = Array.from(tempDiv.children);
    let chunkIndex = 0;
    function renderChunk() {
        const end = Math.min(chunkIndex + 5, allNewCards.length);
        for (let i = chunkIndex; i < end; i++) feedContainer.appendChild(allNewCards[i]);
        chunkIndex += 5;
        if (chunkIndex < allNewCards.length) requestAnimationFrame(renderChunk);
    }
    requestAnimationFrame(renderChunk);
}

window.flipCard = function (idx) {
    document.getElementById(`cardContainer-${idx}`)?.querySelector(".flip-card-inner")?.classList.toggle("rotate-y-180");
};

window.handleOptionSelect = function (e, docId, uiIdx, selIdx, corIdx, encodedExp) {
    const container = document.getElementById(`mcqOptions-${uiIdx}`);
    const buttons = container.querySelectorAll("button");
    const feedback = document.getElementById(`mcqFeedback-${uiIdx}`);
    const feedbackText = document.getElementById(`mcqFeedbackText-${uiIdx}`);
    if (buttons[0].disabled) return;

    buttons.forEach((b) => {
        b.disabled = true;
        b.classList.add("opacity-50");
    });

    const correctText = currentLang === "hi" ? "✅ सही" : "✅ Correct";
    const incorrectText = currentLang === "hi" ? "❌ गलत" : "❌ Incorrect";
    const expCorrectPrefix = currentLang === "hi" ? "शानदार!" : "Excellent!";
    const expIncorrectPrefix = currentLang === "hi" ? "गलत।" : "Incorrect.";

    if (selIdx === corIdx) {
        buttons[selIdx].classList.remove("opacity-50");
        buttons[selIdx].classList.replace("border-slate-100", "border-emerald-500");
        buttons[selIdx].classList.replace("dark:border-slate-600", "dark:border-emerald-500");
        buttons[selIdx].classList.add("bg-emerald-50", "dark:bg-emerald-900/30", "text-emerald-900", "dark:text-emerald-400");
        buttons[selIdx].querySelector(".status-marker").textContent = correctText;
        feedback.className = "mt-3 p-3 rounded-xl text-xs md:text-sm leading-relaxed font-semibold flex flex-col gap-1.5 items-start bg-emerald-100 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 shadow-inner";
        feedbackText.innerHTML = `<strong class="text-emerald-700 dark:text-emerald-400 block mb-1">${expCorrectPrefix}</strong> ${formatUIText(decodeURIComponent(encodedExp))}`;
    } else {
        buttons[selIdx].classList.remove("opacity-50");
        buttons[selIdx].classList.replace("border-slate-100", "border-rose-500");
        buttons[selIdx].classList.replace("dark:border-slate-600", "dark:border-rose-500");
        buttons[selIdx].classList.add("bg-rose-50", "dark:bg-rose-900/30", "text-rose-900", "dark:text-rose-400");
        buttons[selIdx].querySelector(".status-marker").textContent = incorrectText;

        buttons[corIdx].classList.remove("opacity-50");
        buttons[corIdx].classList.replace("border-slate-100", "border-emerald-500");
        buttons[corIdx].classList.replace("dark:border-slate-600", "dark:border-emerald-500");
        buttons[corIdx].classList.add("bg-emerald-50", "dark:bg-emerald-900/30", "text-emerald-900", "dark:text-emerald-400");
        buttons[corIdx].querySelector(".status-marker").textContent = correctText;

        feedback.className = "mt-3 p-3 rounded-xl text-xs md:text-sm leading-relaxed font-semibold flex flex-col gap-1.5 items-start bg-rose-100 dark:bg-rose-900/50 text-rose-900 dark:text-rose-400 border border-rose-300 dark:border-rose-700 shadow-inner";
        feedbackText.innerHTML = `<strong class="text-rose-700 dark:text-rose-400 block mb-1">${expIncorrectPrefix}</strong> ${formatUIText(decodeURIComponent(encodedExp))}`;
    }

    updateLocalStudyTracker(true);
    const btnTryAgain = document.getElementById(`btnTryAgain-${uiIdx}`);
    if (btnTryAgain) {
        btnTryAgain.classList.remove("hidden");
        btnTryAgain.classList.add("flex");
    }
    if (!readArticlesSet.has(docId)) markAsRead(docId, uiIdx);
};

window.resetQuiz = function (uiIdx) {
    const container = document.getElementById(`mcqOptions-${uiIdx}`);
    const buttons = container.querySelectorAll("button");
    const feedback = document.getElementById(`mcqFeedback-${uiIdx}`);
    buttons.forEach((b) => {
        b.disabled = false;
        b.classList.remove("opacity-50", "bg-emerald-50", "bg-rose-50", "dark:bg-emerald-900/30", "dark:bg-rose-900/30", "text-emerald-900", "text-rose-900", "dark:text-emerald-400", "dark:text-rose-400", "border-emerald-500", "dark:border-emerald-500", "border-rose-500", "dark:border-rose-500");
        b.classList.add("bg-white", "dark:bg-slate-800", "border-slate-100", "dark:border-slate-600", "text-slate-700", "dark:text-slate-300");
        b.querySelector(".status-marker").textContent = "";
    });
    feedback.classList.add("hidden");
    feedback.classList.remove("flex");
    const btnTryAgain = document.getElementById(`btnTryAgain-${uiIdx}`);
    if (btnTryAgain) {
        btnTryAgain.classList.remove("flex");
        btnTryAgain.classList.add("hidden");
    }
};

// ==========================================
// 12. NATIVE DAILY PDF GENERATOR
// ==========================================
window.generateDailyPDF = function () {
    if (allArticlesCache.length === 0) return alert("No news available to generate PDF.");
    const btn = document.getElementById("btnDailyPdf");
    const origHTML = btn ? btn.innerHTML : "";
    if (btn) {
        btn.innerHTML = "<span>⏳</span>";
        btn.disabled = true;
    }

    const isHi = currentLang === "hi";
    const logoDataUrl = typeof stenogymLogoBase64 !== "undefined" ? stenogymLogoBase64 : "";

    const formatHighlight = (text) => {
        if (!text) return "";
        return escapeHtml(text).replace(/\*\*(.*?)\*\*/g, (_, p1) => {
            const c = p1.trim();
            const isNum = /^[\₹\$€£]?\d+[\d.,]*%?(st|nd|rd|th)?(\s*(Crore|Lakh|Million|Billion))?$/i.test(c) || !isNaN(parseFloat(c));
            return `<strong style="color:${isNum ? "#e11d48" : "#2563eb"};font-weight:900;">${p1}</strong>`;
        });
    };

    const groupedData = allArticlesCache.reduce((acc, item) => {
        const c = (isHi ? item.category_hi : item.category) || item.category || "General";
        if (!acc[c]) acc[c] = [];
        acc[c].push(item);
        return acc;
    }, {});
    const sortedCategories = Object.keys(groupedData).sort();

    let htmlContent = `<div style="font-family:'Segoe UI',Arial,sans-serif;background:#fff;">`;
    htmlContent += `<div style="page-break-after:always;padding:20px 40px;">
        <div style="border-left:8px solid #0f172a;padding-left:24px;margin-bottom:36px;display:flex;justify-content:space-between;align-items:center;">
            <div>
                <h1 style="margin:0;color:#0f172a;font-size:32px;font-weight:900;letter-spacing:2px;">STENOGYM</h1>
                <h2 style="margin:4px 0 0 0;color:#e11d48;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;">${isHi ? "दैनिक करेंट अफेयर्स" : "DAILY CURRENT AFFAIRS DIGEST"}</h2>
            </div>
            ${logoDataUrl ? `<img src="${logoDataUrl}" style="width:50px;height:50px;object-fit:contain;">` : ""}
        </div>
        <div style="margin-bottom:28px;font-size:14px;font-weight:800;color:#334155;border-bottom:2px solid #e2e8f0;padding-bottom:10px;">
            📅 ${escapeHtml(selectedDateStr)} &nbsp;&bull;&nbsp; ${allArticlesCache.length} Total Cards
        </div>
        <div style="margin-bottom:36px;">
            <h3 style="margin-top:0;color:#0f172a;font-size:16px;text-transform:uppercase;margin-bottom:14px;">Document Index</h3>
            ${sortedCategories.map((cat, idx) => `<div style="padding:9px 0;border-bottom:1px dashed #e2e8f0;font-size:13px;font-weight:700;color:#334155;display:flex;justify-content:space-between;"><span>${idx + 1}. ${groupedData[cat][0]?.emoji || "📌"} ${escapeHtml(cat)}</span><span style="color:#4f46e5;">${groupedData[cat].length} Cards</span></div>`).join("")}
        </div>
        <div style="text-align:center;padding-top:20px;">
            <a href="https://www.stenogym.com" style="display:inline-block;background:#f8fafc;border:2px solid #4f46e5;color:#4f46e5;text-decoration:none;font-weight:900;font-size:13px;padding:12px 24px;border-radius:6px;">🎯 Practice as Timed Mock on Stenogym</a>
        </div>
    </div>`;

    sortedCategories.forEach((category) => {
        const items = groupedData[category];
        const catEmoji = items[0]?.emoji || "📌";
        htmlContent += `<div style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:4px;margin-top:18px;margin-bottom:14px;page-break-after:avoid;page-break-inside:avoid;">
            <h2 style="margin:0;font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:1px;">${catEmoji} ${escapeHtml(category)}</h2>
        </div>`;

        items.forEach((card, index) => {
            const hLine = isHi ? card.oneLiner_hi || card.oneLiner : card.oneLiner;
            const cBullets = isHi ? card.contextBullets_hi || card.contextBullets || [] : card.contextBullets || [];
            const subCat = isHi ? card.subCategory_hi || card.subCategory : card.subCategory;
            const statBox = isHi ? card.staticBox_hi?.facts || card.staticBox?.facts : card.staticBox?.facts;
            const mcq = isHi ? card.mcq_hi || card.mcq || {} : card.mcq || {};

            const bullets = cBullets.filter((b) => b.trim() !== "").map((b) => `<li style="page-break-inside:avoid;margin:5px 0;">${formatHighlight(b)}</li>`).join("");
            const staticFacts = statBox ? `<div style="page-break-inside:avoid;background:#f8fafc;border-left:3px solid #94a3b8;padding:8px 12px;font-size:11px;color:#475569;margin:10px 0;font-weight:600;">🧠 <strong>Static:</strong> ${formatHighlight(statBox)}</div>` : "";
            let mcqHtml = "";
            if (mcq && mcq.question) {
                const ansIdx = Number(mcq.correctIndex) || 0;
                const ansChar = String.fromCharCode(65 + ansIdx);
                const ansText = mcq.options ? mcq.options[ansIdx] : "";
                mcqHtml = `<div style="page-break-inside:avoid;border-left:3px solid #059669;background:#f0fdf4;padding:10px 14px;margin-top:10px;border-radius:4px;">
                    <div style="font-size:11.5px;font-weight:800;color:#065f46;margin-bottom:5px;">${isHi ? "प्रश्न:" : "Q."} ${formatHighlight(mcq.question)}</div>
                    <div style="font-size:11px;font-weight:700;color:#047857;margin-bottom:5px;">${isHi ? "उत्तर:" : "Ans:"} ${ansChar}. ${formatHighlight(ansText)}</div>
                    <div style="font-size:10.5px;color:#334155;line-height:1.45;border-top:1px dashed #a7f3d0;padding-top:5px;"><em>${formatHighlight(mcq.explanation)}</em></div>
                </div>`;
            }
            htmlContent += `<div style="margin-bottom:22px;padding-bottom:14px;border-bottom:1px solid #e2e8f0;">
                <div style="page-break-inside:avoid;page-break-after:avoid;">
                    <div style="font-size:10px;font-weight:900;color:#e11d48;margin-bottom:3px;text-transform:uppercase;">#${index + 1} &bull; ${escapeHtml(subCat || "NEWS")}</div>
                    <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:8px;line-height:1.4;">${formatHighlight(hLine)}</div>
                </div>
                <ul style="font-size:11.5px;color:#334155;line-height:1.55;margin-top:0;padding-left:18px;list-style-type:disc;">${bullets}</ul>
                ${staticFacts}
                ${mcqHtml}
            </div>`;
        });
    });

    htmlContent += `</div>`;
    const element = document.createElement("div");
    element.innerHTML = htmlContent;

    const opt = {
        margin: [0.5, 0.5, 0.8, 0.5],
        filename: `Stenogym_Daily_CA_${selectedDateStr.replace(/\s+/g, "_")}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        pagebreak: { mode: ["css", "legacy"] },
        enableLinks: true,
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" }
    };

    html2pdf()
        .set(opt)
        .from(element)
        .toPdf()
        .get("pdf")
        .then((pdf) => {
            const totalPages = pdf.internal.getNumberOfPages();
            const pw = pdf.internal.pageSize.getWidth();
            const ph = pdf.internal.pageSize.getHeight();
            for (let i = 1; i <= totalPages; i++) {
                pdf.setPage(i);
                pdf.setDrawColor(15, 23, 42);
                pdf.setLineWidth(0.02);
                pdf.rect(0.25, 0.25, pw - 0.5, ph - 0.5);
                if (logoDataUrl) {
                    try {
                        pdf.setGState(new pdf.GState({ opacity: 0.03 }));
                        pdf.addImage(logoDataUrl, "PNG", (pw - 4) / 2, (ph - 4) / 2, 4, 4);
                        pdf.setGState(new pdf.GState({ opacity: 1.0 }));
                    } catch (e) {}
                }
                pdf.setDrawColor(226, 232, 240);
                pdf.setLineWidth(0.01);
                pdf.line(0.25, ph - 0.65, pw - 0.25, ph - 0.65);
                pdf.setFontSize(9);
                pdf.setFont("helvetica", "bold");
                pdf.setTextColor(15, 23, 42);
                pdf.textWithLink("STENOGYM.COM", 0.5, ph - 0.45, { url: "https://www.stenogym.com" });
                pdf.setFont("helvetica", "normal");
                pdf.setTextColor(100, 116, 139);
                pdf.textWithLink("Official Telegram: t.me/stenogym", 2.2, ph - 0.45, { url: "https://t.me/stenogym" });
                pdf.setFont("helvetica", "bold");
                pdf.text(`Page ${i} of ${totalPages}`, pw - 0.9, ph - 0.45);
            }
        })
        .save()
        .then(() => {
            if (btn) {
                btn.innerHTML = origHTML;
                btn.disabled = false;
            }
        });
};

// ==========================================
// 13. COMPILATIONS SHELF (AUTO-HIDE EMPTY PDF BUTTONS)
// ==========================================
let allDrillsSummaryCache = null;
let compilationsData = {};
let workingCompilationCards = [];
let currentCompilationPage = 1;
const COMPILATION_PER_PAGE = 20;
let compilationMode = "flip";
let currentCompIsQuizOnly = false;
let currentCompId = null;

async function fetchAllDrillsSummary(forceRefresh = false) {
    if (allDrillsSummaryCache && !forceRefresh) return allDrillsSummaryCache;
    const url = `${FIRESTORE_REST_BASE}:runQuery`;
    const payload = {
        structuredQuery: {
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
        }
    };
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to load archive summary.");
    const json = await res.json();

    const editions = [];
    if (Array.isArray(json)) {
        json.filter((item) => item.document).forEach((item) => {
            const data = formatRestDocument(item.document);
            editions.push({
                docId: data.id,
                tag: data.date || data.id,
                cadence: data.cadence || "weekly",
                count: Number(data.count) || 0,
                folderName: (data.folderName || "").trim(),
                displayTitle: (data.displayTitle || "").trim(),
                deckMode: data.deckMode || "study_quiz",
                pdfEmbedUrl_en: data.pdfEmbedUrl_en || data.pdfEmbedUrl || "",
                pdfEmbedUrl_hi: data.pdfEmbedUrl_hi || "",
                pdfLabel: (data.pdfLabel || "").trim(),
                folderPdfUrl_en: data.folderPdfUrl_en || "",
                folderPdfUrl_hi: data.folderPdfUrl_hi || "",
                folderPdfLabel: (data.folderPdfLabel || "").trim(),
                tsMs: getTimestampMs(data.timestamp)
            });
        });
    }
    allDrillsSummaryCache = editions;
    return editions;
}

function sortEditionsNewestFirst(list) {
    return [...list].sort((a, b) => {
        if (b.tsMs !== a.tsMs) return b.tsMs - a.tsMs;
        return (b.tag || b.docId).localeCompare(a.tag || a.docId);
    });
}

function renderDeckCardHtml(ed, badgeText, badgeColorClass) {
    const title = getCleanDeckTitle(ed);
    const countDisplay = ed.count ? `${ed.count} MCQs` : "Practice Pack";
    const pdfEn = ed.pdfEmbedUrl_en || "";
    const pdfHi = ed.pdfEmbedUrl_hi || "";
    const hasPdf = Boolean(pdfEn || pdfHi);
    const safeUrlId = encodeURIComponent(ed.docId);
    const safeJsId = escapeJsStr(ed.docId);
    const isQuizOnly = ed.deckMode === "quiz_only";

    const openBtnLabel = isQuizOnly
        ? currentLang === "hi"
            ? "⚡ रैपिड क्विज़ शुरू करें"
            : "⚡ Start Rapid Quiz"
        : currentLang === "hi"
        ? "📖 डेक खोलें"
        : "📖 Open Deck";

    const defaultPdfLabel = currentLang === "hi" ? "📥 PDF डाउनलोड करें" : "📥 Download PDF";
    const pdfBtnLabel = ed.pdfLabel || defaultPdfLabel;

    return `
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 md:p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
        <div>
            <div class="flex flex-wrap justify-between items-center gap-2 mb-2.5">
                <span class="${badgeColorClass} text-[10px] font-black uppercase px-2.5 py-1 rounded-md">${escapeHtml(badgeText)}</span>
                <div class="flex items-center gap-1.5">
                    ${isQuizOnly ? '<span class="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-[9px] font-black uppercase px-2 py-0.5 rounded">⚡ Quiz Only</span>' : ""}
                    <span class="text-xs font-bold text-slate-400">${escapeHtml(countDisplay)}</span>
                </div>
            </div>
            <h3 class="font-black text-base md:text-lg text-slate-900 dark:text-white mb-4 leading-snug">${escapeHtml(title)}</h3>
        </div>
        <div class="flex flex-col gap-2">
            <a href="?topic=${safeUrlId}" onclick="event.preventDefault(); window.history.pushState({}, '', '?topic=${safeUrlId}'); openCompilation('${safeJsId}');" class="${
        isQuizOnly ? "bg-indigo-600 hover:bg-indigo-500" : "bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500"
    } text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm transition text-center inline-block w-full">
                ${openBtnLabel}
            </a>
            ${
                hasPdf
                    ? `<button onclick="triggerTelegramDownload(event, 'compilation', '${escapeJsStr(pdfEn)}', '${escapeJsStr(pdfHi)}')" class="bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 transition w-full">
                        ${escapeHtml(pdfBtnLabel)}
                    </button>`
                    : ""
            }
        </div>
    </div>`;
}

async function loadCompilationShelf(cadence) {
    const loadingHtml = `<div class="col-span-full text-center text-slate-400 font-bold py-10 animate-pulse">${currentLang === "hi" ? "संग्रह लोड हो रहा है..." : "Loading Archive..."}</div>`;
    if (cadence === "weekly") document.getElementById("weeklyShelfGrid").innerHTML = loadingHtml;
    else if (cadence === "monthly") {
        document.getElementById("monthlyFoldersOverview").classList.remove("hidden");
        document.getElementById("monthlyFolderDetailView").classList.add("hidden");
        document.getElementById("monthlyShelfGrid").innerHTML = loadingHtml;
    } else if (cadence === "special") {
        document.getElementById("specialFolderPills").innerHTML = "";
        document.getElementById("specialShelfGrid").innerHTML = loadingHtml;
    }

    try {
        await fetchAllDrillsSummary(false);
        renderCurrentShelf(cadence);
    } catch (err) {
        const errHtml = `<div class="col-span-full text-center p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700"><div class="text-3xl mb-2">📦</div><h3 class="text-lg font-black text-slate-800 dark:text-white">Error loading data. Please refresh.</h3></div>`;
        if (cadence === "weekly") document.getElementById("weeklyShelfGrid").innerHTML = errHtml;
        else if (cadence === "monthly") document.getElementById("monthlyShelfGrid").innerHTML = errHtml;
        else if (cadence === "special") document.getElementById("specialShelfGrid").innerHTML = errHtml;
    }
}

function renderCurrentShelf(cadence) {
    if (!allDrillsSummaryCache) return;
    const editions = allDrillsSummaryCache.filter((ed) => ed.cadence === cadence);

    if (cadence === "weekly") renderWeeklyShelf(editions);
    else if (cadence === "monthly") {
        if (activeMonthlyFolder) openMonthlyFolder(activeMonthlyFolder, false);
        else renderMonthlyFoldersShelf(editions);
    } else if (cadence === "special") renderSpecialShelves(editions);
    applyStaticTranslations();
}

function renderWeeklyShelf(editions) {
    const grid = document.getElementById("weeklyShelfGrid");
    const sorted = sortEditionsNewestFirst(editions);
    if (sorted.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700"><div class="text-3xl mb-2">⚡</div><h3 class="text-lg font-black text-slate-800 dark:text-white">${currentLang === "hi" ? "अभी कोई साप्ताहिक ड्रिल प्रकाशित नहीं हुई है।" : "No Weekly Speed Drills published yet."}</h3><p class="text-slate-500 text-sm mt-1">${currentLang === "hi" ? "रविवार के अगले संकलन के लिए जल्द वापस आएं!" : "Check back soon for the next Sunday Speed Drill!"}</p></div>`;
        return;
    }
    grid.innerHTML = sorted
        .map((ed) =>
            renderDeckCardHtml(
                ed,
                currentLang === "hi" ? "साप्ताहिक स्पीड ड्रिल" : "Weekly Speed Drill",
                "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-300"
            )
        )
        .join("");
}

function renderMonthlyFoldersShelf(editions) {
    document.getElementById("monthlyFoldersOverview").classList.remove("hidden");
    document.getElementById("monthlyFolderDetailView").classList.add("hidden");
    const grid = document.getElementById("monthlyShelfGrid");

    if (editions.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700"><div class="text-3xl mb-2">📥</div><h3 class="text-lg font-black text-slate-800 dark:text-white">${currentLang === "hi" ? "अभी कोई मासिक संकलन प्रकाशित नहीं हुआ है।" : "No Monthly Digests published yet."}</h3></div>`;
        return;
    }

    const folderMap = {};
    const standalone = [];

    editions.forEach((ed) => {
        if (ed.folderName) {
            if (!folderMap[ed.folderName]) {
                folderMap[ed.folderName] = {
                    name: ed.folderName,
                    decks: [],
                    totalMcqs: 0,
                    latestTs: 0,
                    folderPdfEn: "",
                    folderPdfHi: "",
                    folderPdfLabel: ""
                };
            }
            const f = folderMap[ed.folderName];
            f.decks.push(ed);
            f.totalMcqs += ed.count || 0;
            if (ed.tsMs > f.latestTs) f.latestTs = ed.tsMs;
            if (!f.folderPdfEn && ed.folderPdfUrl_en) f.folderPdfEn = ed.folderPdfUrl_en;
            if (!f.folderPdfHi && ed.folderPdfUrl_hi) f.folderPdfHi = ed.folderPdfUrl_hi;
            if (!f.folderPdfLabel && ed.folderPdfLabel) f.folderPdfLabel = ed.folderPdfLabel;
        } else {
            standalone.push(ed);
        }
    });

    const folders = Object.values(folderMap).sort((a, b) => (b.latestTs !== a.latestTs ? b.latestTs - a.latestTs : b.name.localeCompare(a.name)));

    let html = "";
    folders.forEach((folder) => {
        const safeFolderJs = escapeJsStr(folder.name);
        const sortedDecks = [...folder.decks].sort((a, b) => getCleanDeckTitle(a).localeCompare(getCleanDeckTitle(b)));
        const previewPills = sortedDecks
            .slice(0, 4)
            .map((d) => `<span class="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-md">${escapeHtml(getCleanDeckTitle(d))}</span>`)
            .join("");
        const extraCount = sortedDecks.length > 4 ? `<span class="text-[10px] font-black text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5">+${sortedDecks.length - 4} more</span>` : "";
        const hasFolderPdf = Boolean(folder.folderPdfEn || folder.folderPdfHi);
        const defaultLbl = currentLang === "hi" ? "📥 संपूर्ण मासिक मेगा PDF" : "📥 Download Full Month Mega PDF";
        const folderBtnLbl = folder.folderPdfLabel || defaultLbl;

        html += `
        <div class="bg-white dark:bg-slate-800 border-2 border-emerald-100 dark:border-emerald-900/50 rounded-3xl p-5 md:p-6 shadow-sm hover:shadow-md hover:border-emerald-400 dark:hover:border-emerald-600 transition flex flex-col justify-between">
            <div>
                <div class="flex items-center justify-between gap-2 mb-3">
                    <span class="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-[10px] font-black uppercase px-2.5 py-1 rounded-md">📁 ${currentLang === "hi" ? "मासिक फ़ोल्डर" : "Month Archive"}</span>
                    <span class="text-xs font-black text-slate-500 dark:text-slate-400">${folder.decks.length} ${currentLang === "hi" ? "श्रेणियाँ" : "Categories"} &bull; ${folder.totalMcqs} MCQs</span>
                </div>
                <h3 class="font-black text-xl text-slate-900 dark:text-white mb-3">${escapeHtml(folder.name)}</h3>
                <div class="flex flex-wrap gap-1.5 mb-5">${previewPills}${extraCount}</div>
            </div>
            <div class="flex flex-col gap-2">
                <button onclick="openMonthlyFolder('${safeFolderJs}', true)" class="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs px-4 py-3 rounded-xl shadow-sm transition w-full flex items-center justify-center gap-2">
                    <span>📂</span> ${currentLang === "hi" ? "मासिक डेक खोलें" : "Open Month Folder"} (${folder.decks.length})
                </button>
                ${
                    hasFolderPdf
                        ? `<button onclick="triggerTelegramDownload(event, 'compilation', '${escapeJsStr(folder.folderPdfEn)}', '${escapeJsStr(folder.folderPdfHi)}')" class="bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 transition w-full">
                            ${escapeHtml(folderBtnLbl)}
                        </button>`
                        : ""
                }
            </div>
        </div>`;
    });

    if (standalone.length > 0) {
        const sortedStandalone = sortEditionsNewestFirst(standalone);
        if (folders.length > 0) {
            html += `<div class="col-span-full pt-3 border-t border-slate-200 dark:border-slate-700"><h3 class="text-xs font-black uppercase tracking-widest text-slate-400">${currentLang === "hi" ? "📦 अन्य मासिक संकलन" : "📦 Standalone Monthly Digests"}</h3></div>`;
        }
        html += sortedStandalone
            .map((ed) =>
                renderDeckCardHtml(
                    ed,
                    currentLang === "hi" ? "मासिक मेगा संकलन" : "Monthly Mega Digest",
                    "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300"
                )
            )
            .join("");
    }

    grid.innerHTML = html;
}

window.openMonthlyFolder = function (folderName, pushUrl = true) {
    if (!allDrillsSummaryCache) return;
    const decks = allDrillsSummaryCache
        .filter((ed) => ed.cadence === "monthly" && ed.folderName === folderName)
        .sort((a, b) => getCleanDeckTitle(a).localeCompare(getCleanDeckTitle(b)));

    if (decks.length === 0) {
        activeMonthlyFolder = null;
        renderMonthlyFoldersShelf(allDrillsSummaryCache.filter((ed) => ed.cadence === "monthly"));
        return;
    }

    activeMonthlyFolder = folderName;
    if (pushUrl) window.history.pushState({}, "", `?tab=monthly&folder=${encodeURIComponent(folderName)}`);

    document.getElementById("monthlyFoldersOverview").classList.add("hidden");
    document.getElementById("monthlyFolderDetailView").classList.remove("hidden");

    const totalMcqs = decks.reduce((sum, d) => sum + (d.count || 0), 0);
    document.getElementById("monthlyFolderHeading").textContent = `📁 ${folderName}`;
    document.getElementById("monthlyFolderStats").textContent = `${decks.length} ${currentLang === "hi" ? "श्रेणियाँ" : "Category Decks"} • ${totalMcqs} MCQs`;

    const pdfEn = decks.find((d) => d.folderPdfUrl_en)?.folderPdfUrl_en || "";
    const pdfHi = decks.find((d) => d.folderPdfUrl_hi)?.folderPdfUrl_hi || "";
    const customLabel = decks.find((d) => d.folderPdfLabel)?.folderPdfLabel || "";
    const fullPdfBtn = document.getElementById("btnDownloadFullMonthPdf");
    if (pdfEn || pdfHi) {
        fullPdfBtn.textContent = customLabel || (currentLang === "hi" ? "📥 संपूर्ण मासिक PDF" : "📥 Full Month Mega PDF");
        fullPdfBtn.classList.remove("hidden");
        fullPdfBtn.onclick = (e) => triggerTelegramDownload(e, "compilation", pdfEn, pdfHi);
    } else {
        fullPdfBtn.classList.add("hidden");
    }

    document.getElementById("monthlyFolderDecksGrid").innerHTML = decks
        .map((ed) => renderDeckCardHtml(ed, folderName, "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300"))
        .join("");
    window.scrollTo({ top: 0, behavior: "smooth" });
};

window.closeMonthlyFolder = function () {
    activeMonthlyFolder = null;
    window.history.pushState({}, "", "?tab=monthly");
    if (allDrillsSummaryCache) {
        renderMonthlyFoldersShelf(allDrillsSummaryCache.filter((ed) => ed.cadence === "monthly"));
    }
};

function renderSpecialShelves(editions) {
    const pillsWrap = document.getElementById("specialFolderPills");
    const grid = document.getElementById("specialShelfGrid");

    if (editions.length === 0) {
        pillsWrap.innerHTML = "";
        grid.innerHTML = `<div class="text-center p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700"><div class="text-3xl mb-2">🎯</div><h3 class="text-lg font-black text-slate-800 dark:text-white">${currentLang === "hi" ? "अभी कोई विशेष विषय बूस्टर प्रकाशित नहीं हुआ है।" : "No Special Topic Boosters published yet."}</h3></div>`;
        return;
    }

    const STANDALONE_KEY = "__standalone__";
    const groups = {};
    editions.forEach((ed) => {
        const key = ed.folderName || STANDALONE_KEY;
        if (!groups[key]) {
            groups[key] = {
                key,
                label: ed.folderName || (currentLang === "hi" ? "✨ विशेष संकलन" : "✨ Standalone Specials"),
                decks: [],
                latestTs: 0
            };
        }
        groups[key].decks.push(ed);
        if (ed.tsMs > groups[key].latestTs) groups[key].latestTs = ed.tsMs;
    });

    const orderedGroups = Object.values(groups).sort((a, b) => {
        if (a.key === STANDALONE_KEY) return 1;
        if (b.key === STANDALONE_KEY) return -1;
        return b.latestTs - a.latestTs;
    });

    if (orderedGroups.length > 1) {
        let pillsHtml = `<button onclick="setSpecialFolderFilter('all')" class="px-3.5 py-2 rounded-xl text-xs font-black transition ${
            activeSpecialFolderFilter === "all"
                ? "bg-violet-600 text-white shadow-sm"
                : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
        }">🌟 ${currentLang === "hi" ? "सभी विशेष" : "All Special"} (${editions.length})</button>`;
        orderedGroups.forEach((g) => {
            const isActive = activeSpecialFolderFilter === g.key;
            pillsHtml += `<button onclick="setSpecialFolderFilter('${escapeJsStr(g.key)}')" class="px-3.5 py-2 rounded-xl text-xs font-black transition ${
                isActive
                    ? "bg-violet-600 text-white shadow-sm"
                    : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            }">${escapeHtml(g.label)} (${g.decks.length})</button>`;
        });
        pillsWrap.innerHTML = pillsHtml;
    } else {
        pillsWrap.innerHTML = "";
    }

    const visibleGroups = activeSpecialFolderFilter === "all" ? orderedGroups : orderedGroups.filter((g) => g.key === activeSpecialFolderFilter);

    grid.innerHTML = visibleGroups
        .map((g) => {
            const sortedDecks = sortEditionsNewestFirst(g.decks);
            const sectionPdfEn = sortedDecks.find((d) => d.folderPdfUrl_en)?.folderPdfUrl_en || "";
            const sectionPdfHi = sortedDecks.find((d) => d.folderPdfUrl_hi)?.folderPdfUrl_hi || "";
            const sectionLabel = sortedDecks.find((d) => d.folderPdfLabel)?.folderPdfLabel || "📥 Combined Bundle PDF";

            return `
            <section class="space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                    <h3 class="text-sm md:text-base font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <span>${g.key === STANDALONE_KEY ? "" : "📁 "}</span>
                        <span>${escapeHtml(g.label)}</span>
                        <span class="text-[11px] font-bold text-slate-400">(${sortedDecks.length} ${sortedDecks.length === 1 ? "Deck" : "Decks"})</span>
                    </h3>
                    ${
                        sectionPdfEn || sectionPdfHi
                            ? `<button onclick="triggerTelegramDownload(event, 'compilation', '${escapeJsStr(sectionPdfEn)}', '${escapeJsStr(sectionPdfHi)}')" class="text-[11px] font-black text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/40 hover:bg-violet-200 px-3 py-1.5 rounded-lg transition">
                                ${escapeHtml(sectionLabel)}
                            </button>`
                            : ""
                    }
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                    ${sortedDecks
                        .map((ed) =>
                            renderDeckCardHtml(
                                ed,
                                ed.folderName || (currentLang === "hi" ? "विशेष विषय मॉक" : "Special Topic Mock"),
                                "bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-300"
                            )
                        )
                        .join("")}
                </div>
            </section>`;
        })
        .join("");
}

window.setSpecialFolderFilter = function (key) {
    activeSpecialFolderFilter = key;
    if (allDrillsSummaryCache) {
        renderSpecialShelves(allDrillsSummaryCache.filter((ed) => ed.cadence === "special"));
    }
};

// ==========================================
// 14. COMPILATION WORKSPACE & PAGINATION
// ==========================================
function injectFaqSchema(cards) {
    const existing = document.getElementById("dynamic-faq-schema");
    if (existing) existing.remove();
    const schemaData = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: cards
            .slice(0, 60)
            .map((card) => {
                const mcq = currentLang === "hi" ? card.mcq_hi || card.mcq || {} : card.mcq || {};
                const q = stripBoldMarkers(mcq?.question || card.oneLiner || "");
                const ansText = stripBoldMarkers(mcq?.options ? mcq.options[mcq.correctIndex || 0] : "");
                const exp = stripBoldMarkers(mcq?.explanation || "");
                return {
                    "@type": "Question",
                    name: q,
                    acceptedAnswer: { "@type": "Answer", text: `${ansText} - ${exp}` }
                };
            })
            .filter((item) => item.name)
    };
    const script = document.createElement("script");
    script.id = "dynamic-faq-schema";
    script.type = "application/ld+json";
    script.text = JSON.stringify(schemaData);
    document.head.appendChild(script);
}

async function loadAndRenderBundle(compId, bkmkParam = null) {
    currentCompId = compId;
    document.getElementById("compilationCardsContainer").innerHTML =
        '<div class="p-8 text-center text-indigo-500 font-bold bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 animate-pulse">Loading Deck Data...</div>';
    document.getElementById("compilationPagination").classList.add("hidden");

    activeView = "compilationActive";
    [dailyFeedView, document.getElementById("emptyFeedState"), document.getElementById("dailyQuizStatusBar"), weeklyDrillView, monthlyPdfView, specialTopicView].forEach((v) =>
        v?.classList.add("hidden")
    );
    compilationWorkspace?.classList.remove("hidden");
    if (dateControlBar) dateControlBar.style.display = "none";
    const pw = document.getElementById("progressWidget");
    if (pw) pw.style.display = "none";

    try {
        workingCompilationCards = [];
        const d = await restGetDoc("ca_drills", compId);
        if (!d || !Array.isArray(d.cards)) throw new Error("Drill not found.");

        const drillCadence = d.cadence || "weekly";
        const folderName = (d.folderName || "").trim();
        const displayTitle = getCleanDeckTitle({ displayTitle: d.displayTitle, date: d.date, id: compId });
        const pdfEn = d.pdfEmbedUrl_en || d.pdfEmbedUrl || "";
        const pdfHi = d.pdfEmbedUrl_hi || "";
        const pdfLabel = (d.pdfLabel || "").trim();

        workingCompilationCards = d.cards.map((c, i) => ({ id: `${compId}_${i}`, ...c }));

        // Show header category filter only if the deck actually spans multiple categories
        const uniqueCats = new Set(workingCompilationCards.map((c) => c.category).filter(Boolean));
        setHeaderCategoryVisibility(uniqueCats.size > 1);

        const hasAnyNotes = workingCompilationCards.some(
            (c) => (c.oneLiner && c.oneLiner.trim() !== "") || (Array.isArray(c.contextBullets) && c.contextBullets.length > 0)
        );
        currentCompIsQuizOnly = d.deckMode === "quiz_only" || (workingCompilationCards.length > 0 && !hasAnyNotes);

        compilationsData[compId] = {
            id: compId,
            cadence: drillCadence,
            folderName,
            displayTitle,
            deckMode: currentCompIsQuizOnly ? "quiz_only" : "study_quiz",
            pdfUrl_en: pdfEn,
            pdfUrl_hi: pdfHi,
            pdfLabel,
            cards: workingCompilationCards
        };

        if (drillCadence === "monthly") highlightActiveTab(tabMonthly);
        else if (drillCadence === "special") highlightActiveTab(tabSpecial);
        else highlightActiveTab(tabWeekly);

        setActiveCategory("all", false);

        const deckBanner = document.getElementById("compilationDeckBanner");
        const folderPill = document.getElementById("compDeckFolderPill");
        document.getElementById("compDeckTitleText").textContent = displayTitle;
        document.getElementById("compDeckCountPill").textContent = `${workingCompilationCards.length} ${currentCompIsQuizOnly ? "MCQs" : "Cards"}`;
        if (folderName) {
            folderPill.textContent = `📁 ${folderName}`;
            folderPill.classList.remove("hidden");
        } else {
            folderPill.classList.add("hidden");
        }
        deckBanner.classList.remove("hidden");

        const toggleWrap = document.getElementById("compModeToggleWrap");
        const quizOnlyBadge = document.getElementById("compQuizOnlyBadge");
        if (currentCompIsQuizOnly) {
            toggleWrap.classList.add("hidden");
            quizOnlyBadge.classList.remove("hidden");
            quizOnlyBadge.classList.add("flex");
        } else {
            toggleWrap.classList.remove("hidden");
            quizOnlyBadge.classList.add("hidden");
            quizOnlyBadge.classList.remove("flex");
        }

        // AUTO-HIDE PDF BUTTON IN WORKSPACE HEADER WHEN NO LINK IS ATTACHED
        const dlBtn = document.getElementById("btnDownloadCompilation");
        if (dlBtn) {
            if (pdfEn || pdfHi) {
                dlBtn.textContent = pdfLabel || (currentLang === "hi" ? "📥 PDF डाउनलोड" : "📥 Download PDF");
                dlBtn.classList.remove("hidden");
                dlBtn.classList.add("flex");
                dlBtn.onclick = (e) => triggerTelegramDownload(e, "compilation", pdfEn, pdfHi);
            } else {
                dlBtn.classList.add("hidden");
                dlBtn.classList.remove("flex");
            }
        }

        let cadencePrefix = "Weekly Speed Drill";
        if (drillCadence === "monthly") cadencePrefix = folderName ? `${folderName} Digest` : "Monthly Mega Digest";
        if (drillCadence === "special") cadencePrefix = "Special Topic Booster";
        document.title = `${displayTitle} (${cadencePrefix}) MCQs | Stenogym`;
        document
            .querySelector('meta[name="description"]')
            ?.setAttribute("content", `Interactive practice deck for ${displayTitle} (${cadencePrefix}). Master high-yield MCQs for SSC CGL, RRB NTPC, and Banking exams.`);
        injectFaqSchema(workingCompilationCards);

        currentCompilationPage = 1;
        setCompilationMode(currentCompIsQuizOnly ? "quiz" : "flip");
        applyStaticTranslations();

        if (bkmkParam) setTimeout(() => scrollToAndHighlight(bkmkParam, true), 450);
        else window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
        console.error("Drill Load Error:", e);
        document.getElementById("compilationDeckBanner")?.classList.add("hidden");
        document.getElementById("compilationCardsContainer").innerHTML =
            '<div class="p-8 text-center text-rose-500 font-bold bg-rose-50 border border-rose-200 dark:bg-rose-900/20 dark:border-rose-800 rounded-2xl">Error: Drill Data Not Found. It may have been moved or deleted.</div>';
    }
}

window.openCompilation = function (compId) {
    loadAndRenderBundle(compId, null);
};
async function triggerTopicRouter(topicParam, bkmkParam = null) {
    await loadAndRenderBundle(topicParam, bkmkParam);
}

window.closeCompilation = function () {
    compilationWorkspace?.classList.add("hidden");
    const meta = compilationsData[currentCompId] || {};
    const targetCadence = meta.cadence || "weekly";

    if (targetCadence === "monthly") {
        activeMonthlyFolder = meta.folderName || null;
        const url = activeMonthlyFolder ? `?tab=monthly&folder=${encodeURIComponent(activeMonthlyFolder)}` : "?tab=monthly";
        window.history.pushState({}, "", url);
        setCadence(tabMonthly, monthlyPdfView, "monthly", false);
    } else if (targetCadence === "special") {
        window.history.pushState({}, "", "?tab=special");
        setCadence(tabSpecial, specialTopicView, "special", false);
    } else {
        window.history.pushState({}, "", "?tab=weekly");
        setCadence(tabWeekly, weeklyDrillView, "weekly", false);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
};

window.retakeCompilationQuiz = function () {
    if (!confirm("Reset your score and restart this drill?")) return;
    localStorage.removeItem(`quiz_prog_${currentCompId}`);
    document.getElementById("compilationScoreBadge").textContent = "Score: 0/0";
    currentCompilationPage = 1;
    renderCompilationPage(1);
};

window.setCompilationMode = function (mode) {
    if (currentCompIsQuizOnly) mode = "quiz";
    compilationMode = mode;

    document.getElementById("btnModeFlip").className =
        mode === "flip"
            ? "px-3.5 py-1.5 bg-indigo-600 text-white rounded-lg shadow-sm transition translation-el"
            : "px-3.5 py-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-white transition translation-el";
    document.getElementById("btnModeQuiz").className =
        mode === "quiz"
            ? "px-3.5 py-1.5 bg-indigo-600 text-white rounded-lg shadow-sm transition translation-el"
            : "px-3.5 py-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-white transition translation-el";

    document.getElementById("compilationScoreBadge").style.display = mode === "quiz" ? "inline-block" : "none";
    document.getElementById("btnRetakeCompQuiz").style.display = mode === "quiz" ? "inline-flex" : "none";

    if (mode === "quiz") {
        const saved = JSON.parse(localStorage.getItem(`quiz_prog_${currentCompId}`) || '{"correct":0,"attempted":0,"answers":{}}');
        document.getElementById("compilationScoreBadge").textContent = `Score: ${saved.correct}/${saved.attempted}`;
    }

    currentCompilationPage = 1;
    renderCompilationPage(1);
};

window.changeCompPage = function (direction) {
    goToCompPage(currentCompilationPage + direction);
};

window.goToCompPage = function (pageNum) {
    const filtered = activeCategoryFilter === "all" ? workingCompilationCards : workingCompilationCards.filter((c) => c.category === activeCategoryFilter);
    const totalPages = Math.max(1, Math.ceil(filtered.length / COMPILATION_PER_PAGE));
    const clamped = Math.max(1, Math.min(pageNum, totalPages));
    currentCompilationPage = clamped;
    renderCompilationPage(clamped);
    window.scrollTo({ top: 0, behavior: "smooth" });
};

function buildPaginationPages(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [1];
    if (current > 3) pages.push("...");
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let p = start; p <= end; p++) pages.push(p);
    if (current < total - 2) pages.push("...");
    pages.push(total);
    return pages;
}

function renderPaginationBar(targetPage, totalPages, filteredCards) {
    const pagContainer = document.getElementById("compilationPagination");
    const numsContainer = document.getElementById("compilationPageNumbers");
    const rangeText = document.getElementById("compilationRangeText");

    if (totalPages <= 1) {
        pagContainer.classList.add("hidden");
        return;
    }
    pagContainer.classList.remove("hidden");

    const prevBtn = document.getElementById("btnCompPrev");
    const nextBtn = document.getElementById("btnCompNext");
    prevBtn.disabled = targetPage === 1;
    prevBtn.style.opacity = targetPage === 1 ? "0.45" : "1";
    nextBtn.disabled = targetPage === totalPages;
    nextBtn.style.opacity = targetPage === totalPages ? "0.45" : "1";

    const savedQuiz = compilationMode === "quiz" ? JSON.parse(localStorage.getItem(`quiz_prog_${currentCompId}`) || '{"answers":{}}') : null;

    const items = buildPaginationPages(targetPage, totalPages);
    numsContainer.innerHTML = items
        .map((item) => {
            if (item === "...") return '<span class="px-1.5 text-slate-400 font-black text-xs select-none">&hellip;</span>';
            const isActive = item === targetPage;
            let isPageDone = false;
            if (savedQuiz && savedQuiz.answers) {
                const pStart = (item - 1) * COMPILATION_PER_PAGE;
                const pSlice = filteredCards.slice(pStart, pStart + COMPILATION_PER_PAGE);
                isPageDone = pSlice.length > 0 && pSlice.every((c) => savedQuiz.answers[`${currentCompId}_${c.id}`] !== undefined);
            }
            const baseClasses = isActive
                ? "bg-indigo-600 text-white border-indigo-600 shadow-md scale-105"
                : isPageDone
                ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100"
                : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-indigo-400 hover:text-indigo-600";
            const dotHtml = isPageDone && !isActive ? '<span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-800"></span>' : "";
            return `<button onclick="goToCompPage(${item})" class="relative min-w-[34px] h-9 px-2 rounded-xl border font-black text-xs transition ${baseClasses}" aria-label="Go to page ${item}">${item}${dotHtml}</button>`;
        })
        .join("");

    const startIdx = (targetPage - 1) * COMPILATION_PER_PAGE + 1;
    const endIdx = Math.min(targetPage * COMPILATION_PER_PAGE, filteredCards.length);
    rangeText.textContent = `Page ${targetPage} of ${totalPages} • Showing ${startIdx}–${endIdx} of ${filteredCards.length}`;
}

window.toggleCompCard = function (idx) {
    document.getElementById(`compCardContainer-${idx}`)?.querySelector(".flip-card-inner")?.classList.toggle("rotate-y-180");
};

function renderCompilationPage(targetPage = currentCompilationPage) {
    const container = document.getElementById("compilationCardsContainer");
    const pagContainer = document.getElementById("compilationPagination");

    let filtered = workingCompilationCards;
    if (activeCategoryFilter !== "all") filtered = filtered.filter((c) => c.category === activeCategoryFilter);

    if (filtered.length === 0) {
        container.innerHTML = `<div class="p-8 text-center text-slate-400 font-bold bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">${currentLang === "hi" ? "इस श्रेणी में कोई प्रश्न नहीं है।" : "No questions in this category."}</div>`;
        pagContainer.classList.add("hidden");
        return;
    }

    const totalPages = Math.ceil(filtered.length / COMPILATION_PER_PAGE);
    if (targetPage > totalPages) {
        targetPage = totalPages;
        currentCompilationPage = totalPages;
    }
    renderPaginationBar(targetPage, totalPages, filtered);

    const startIndex = (targetPage - 1) * COMPILATION_PER_PAGE;
    const endIndex = Math.min(startIndex + COMPILATION_PER_PAGE, filtered.length);
    const batch = filtered.slice(startIndex, endIndex);

    const tryAgainLabel = currentLang === "hi" ? "पुनः प्रयास करें" : "Try Again";
    const backToNotesLabel = currentLang === "hi" ? "नोट्स पर वापस जाएं" : "Read Notes";
    const testFactLabel = currentLang === "hi" ? "तथ्य का परीक्षण करें" : "Test Fact";

    let html = "";
    if (compilationMode === "flip") {
        batch.forEach((card, idx) => {
            const globalIndex = startIndex + idx + 1;
            const docId = card.id;
            const displayCat = currentLang === "hi" ? card.category_hi || card.category || "" : card.category || "";
            const displaySub = currentLang === "hi" ? card.subCategory_hi || card.subCategory || "" : card.subCategory || "";
            const displayHeadline = currentLang === "hi" ? card.oneLiner_hi || card.oneLiner || "" : card.oneLiner || "";
            const displayImpact = currentLang === "hi" ? card.impact_hi || card.impact || "" : card.impact || "";
            const staticBoxText = currentLang === "hi" ? card.staticBox_hi?.facts || card.staticBox?.facts || "" : card.staticBox?.facts || "";
            const mcqData = currentLang === "hi" ? card.mcq_hi || card.mcq || {} : card.mcq || {};
            const safeExp = encodeURIComponent(mcqData?.explanation || "").replace(/'/g, "%27");
            const correctIdx = Number(mcqData?.correctIndex) || 0;
            const isBkmrk = savedBookmarks.includes(docId);
            const bkmrkClass = isBkmrk ? "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400" : "text-slate-600 dark:text-slate-400";
            const bkmrkText = isBkmrk ? (currentLang === "hi" ? "🔖 सहेजा गया" : "🔖 Saved") : currentLang === "hi" ? "🔖 सहेजें" : "🔖 Save";
            const safeEmoji = card.emoji || "📰";
            const exams = card.targetExams ? card.targetExams.join(" • ") : "SSC • Banking • Railways";
            const impactLabel = currentLang === "hi" ? "💡 प्रभाव:" : "💡 Impact:";
            const staticContextLabel = currentLang === "hi" ? "स्थैतिक संदर्भ (Static Context)" : "Static Context Box";

            const bulletsHtml = (currentLang === "hi" ? card.contextBullets_hi || card.contextBullets || [] : card.contextBullets || [])
                .filter((b) => b.trim() !== "")
                .map((b) => `<li class="flex items-start gap-2 text-slate-700 dark:text-slate-300 text-xs md:text-sm font-medium"><span class="text-indigo-500 font-black mt-0.5">📌</span><span>${formatUIText(b)}</span></li>`)
                .join("");

            const staticBoxHtml = staticBoxText
                ? `<div class="mt-4 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/60 rounded-xl p-3 flex items-start gap-2.5 shadow-xs"><span class="text-indigo-600 dark:text-indigo-400 text-base mt-0.5 flex-shrink-0">🧠</span><div class="flex-grow"><span class="text-[9px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300 block mb-0.5">${staticContextLabel}</span><p class="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-snug">${formatUIText(staticBoxText)}</p></div></div>`
                : "";

            html += `
            <div class="perspective-1000 w-full" id="compCardContainer-${idx}" data-docid="${escapeHtml(docId)}">
                <div class="flip-card-inner relative w-full transform-style-3d rounded-3xl transition-all duration-500">
                    <div class="flip-card-front flex flex-col justify-between min-h-[400px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl shadow-sm">
                        <div class="p-5 md:p-7">
                            <div class="flex flex-wrap justify-between items-center mb-3 pb-2 border-b border-slate-100 dark:border-slate-700 gap-2">
                                <div class="flex items-center gap-2">
                                    <span class="bg-indigo-600 text-white text-[10px] font-black px-2 py-1 rounded-md">CARD #${globalIndex}</span>
                                    <span class="text-xl hidden md:inline">${safeEmoji}</span>
                                    <div class="flex flex-col">
                                        <span class="text-slate-900 dark:text-white font-black text-xs uppercase">${escapeHtml(displayCat)}</span>
                                        <span class="text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase tracking-wider">${escapeHtml(displaySub)}</span>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="text-slate-500 dark:text-slate-400 text-[9px] font-black tracking-widest bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-0.5 rounded-full uppercase">🎯 ${escapeHtml(exams)}</span>
                                    <button id="btnBookmarkComp-${idx}" onclick="event.stopPropagation(); toggleBookmark(event, '${escapeJsStr(docId)}', 'btnBookmarkComp-${idx}');" class="text-[10px] font-bold border border-slate-200 dark:border-slate-600 px-2 py-0.5 rounded transition ${bkmrkClass}">${bkmrkText}</button>
                                </div>
                            </div>
                            ${displayImpact ? `<div class="bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[10px] font-bold px-2.5 py-1 rounded-lg inline-block mb-3">${impactLabel} ${escapeHtml(displayImpact)}</div>` : ""}
                            <h3 class="text-base md:text-lg font-black text-slate-900 dark:text-white leading-snug mb-3">${formatUIText(displayHeadline)}</h3>
                            <ul class="space-y-2 mb-2">${bulletsHtml}</ul>
                            ${staticBoxHtml}
                        </div>
                        <div class="border-t border-slate-200 dark:border-slate-700 text-center w-full p-4 cursor-pointer bg-slate-50 dark:bg-slate-900 rounded-b-3xl" onclick="toggleCompCard(${idx})">
                            <button class="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition"><span>🔄</span> ${testFactLabel}</button>
                        </div>
                    </div>

                    <div class="flip-card-back flex flex-col justify-between min-h-[400px] bg-slate-50 dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 rounded-3xl">
                        <div class="p-5 md:p-7">
                            <span class="text-[9px] font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/50 px-2 py-1 rounded-md mb-3 block w-max">Verification Quiz #${globalIndex}</span>
                            <h4 class="font-black text-slate-900 dark:text-white text-sm md:text-base mb-3">${formatUIText(mcqData?.question)}</h4>
                            <div id="compMcqOptions-${idx}" class="space-y-2">
                                ${(mcqData?.options || [])
                                    .map(
                                        (opt, oIdx) => `
                                    <button onclick="handleCompFlipAnswer(event, '${escapeJsStr(docId)}', ${idx}, ${oIdx}, ${correctIdx}, '${safeExp}')" class="w-full text-left bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-600 hover:border-indigo-400 font-bold text-xs md:text-sm p-3 rounded-xl transition flex justify-between">
                                        <span>${String.fromCharCode(65 + oIdx)}. ${formatUIText(opt)}</span><span class="status-marker text-xs font-black"></span>
                                    </button>`
                                    )
                                    .join("")}
                            </div>
                            <div id="compMcqFeedback-${idx}" class="hidden mt-3 p-3 rounded-xl text-xs font-semibold shadow-inner flex-col gap-1.5 bg-indigo-50 border border-indigo-100 dark:border-indigo-800"><div id="compMcqFeedbackText-${idx}"></div></div>
                        </div>
                        <div class="border-t border-indigo-100 dark:border-indigo-800 p-4 flex gap-2 cursor-pointer bg-white dark:bg-slate-800 rounded-b-3xl" onclick="toggleCompCard(${idx})">
                            <button id="btnTryAgainComp-${idx}" onclick="event.stopPropagation(); resetCompFlipQuiz(${idx});" class="hidden flex-1 justify-center items-center gap-1 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 text-slate-800 dark:text-slate-200 px-4 py-2.5 rounded-xl text-xs font-bold transition border border-slate-300 dark:border-slate-600 cursor-pointer"><span>🔄</span> ${tryAgainLabel}</button>
                            <button class="flex-1 justify-center bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600">&larr; ${backToNotesLabel}</button>
                        </div>
                    </div>
                </div>
            </div>`;
        });
    } else {
        batch.forEach((card, idx) => {
            const globalIndex = startIndex + idx + 1;
            const docId = card.id;
            const displayCat = currentLang === "hi" ? card.category_hi || card.category || "" : card.category || "";
            const mcqData = currentLang === "hi" ? card.mcq_hi || card.mcq || {} : card.mcq || {};
            const safeExp = encodeURIComponent(mcqData?.explanation || "").replace(/'/g, "%27");
            const correctIdx = Number(mcqData?.correctIndex) || 0;

            html += `
            <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 md:p-6 rounded-2xl shadow-sm" id="quizCard-${idx}" data-docid="${escapeHtml(docId)}">
                <div class="mb-3 flex items-center justify-between gap-2 flex-wrap">
                    <span class="text-[10px] font-black uppercase text-indigo-700 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/50 px-2 py-0.5 rounded">Question ${globalIndex} of ${filtered.length}</span>
                    ${displayCat ? `<span class="text-[10px] font-bold uppercase text-slate-400">${escapeHtml(displayCat)}</span>` : ""}
                </div>
                <h4 class="font-black text-slate-900 dark:text-white text-sm md:text-base mb-4 leading-snug">${formatUIText(mcqData.question)}</h4>
                <div class="space-y-2" id="quizOptions-${idx}">
                    ${(mcqData.options || [])
                        .map(
                            (opt, oIdx) => `
                        <button onclick="handleCompQuizAnswer(event, '${escapeJsStr(docId)}', ${idx}, ${oIdx}, ${correctIdx}, '${safeExp}')" class="w-full text-left bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 hover:border-indigo-400 text-slate-700 dark:text-slate-300 font-bold text-xs md:text-sm p-3 rounded-xl transition flex items-center justify-between shadow-xs comp-opt-${idx} disabled:cursor-not-allowed">
                            <span>${String.fromCharCode(65 + oIdx)}. ${formatUIText(opt)}</span><span class="status-marker text-xs font-black"></span>
                        </button>`
                        )
                        .join("")}
                </div>
                <div id="quizExp-${idx}" class="hidden mt-3.5 p-3 rounded-xl text-xs leading-relaxed font-semibold"></div>
            </div>`;
        });
    }

    container.innerHTML = html;

    if (compilationMode === "quiz") {
        const saved = JSON.parse(localStorage.getItem(`quiz_prog_${currentCompId}`) || '{"correct":0,"attempted":0,"answers":{}}');
        batch.forEach((card, idx) => {
            const pastAnswer = saved.answers[`${currentCompId}_${card.id}`];
            if (pastAnswer !== undefined) {
                const mcqData = currentLang === "hi" ? card.mcq_hi || card.mcq || {} : card.mcq || {};
                const safeExp = encodeURIComponent(mcqData?.explanation || "").replace(/'/g, "%27");
                restoreCompQuizAnswerUI(idx, pastAnswer, Number(mcqData?.correctIndex) || 0, safeExp);
            }
        });
    }
}

window.handleCompFlipAnswer = function (e, cardId, uiIdx, selIdx, corIdx, encodedExp) {
    const container = document.getElementById(`compMcqOptions-${uiIdx}`);
    const buttons = container.querySelectorAll("button");
    const feedback = document.getElementById(`compMcqFeedback-${uiIdx}`);
    const feedbackText = document.getElementById(`compMcqFeedbackText-${uiIdx}`);
    if (buttons[0].disabled) return;

    buttons.forEach((b) => {
        b.disabled = true;
        b.classList.add("opacity-50");
    });

    const correctText = currentLang === "hi" ? "✅ सही" : "✅ Correct";
    const incorrectText = currentLang === "hi" ? "❌ गलत" : "❌ Incorrect";
    const expCorrectPrefix = currentLang === "hi" ? "शानदार!" : "Excellent!";
    const expIncorrectPrefix = currentLang === "hi" ? "गलत।" : "Incorrect.";

    if (selIdx === corIdx) {
        buttons[selIdx].classList.remove("opacity-50");
        buttons[selIdx].classList.replace("border-slate-100", "border-emerald-500");
        buttons[selIdx].classList.replace("dark:border-slate-600", "dark:border-emerald-500");
        buttons[selIdx].classList.add("bg-emerald-50", "dark:bg-emerald-900/30", "text-emerald-900", "dark:text-emerald-400");
        buttons[selIdx].querySelector(".status-marker").textContent = correctText;
        feedback.className = "mt-3 p-3 rounded-xl text-xs md:text-sm font-semibold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 shadow-inner flex flex-col gap-1.5 items-start";
        feedbackText.innerHTML = `<strong class="text-emerald-700 dark:text-emerald-400 block mb-1">${expCorrectPrefix}</strong> ${formatUIText(decodeURIComponent(encodedExp))}`;
    } else {
        buttons[selIdx].classList.remove("opacity-50");
        buttons[selIdx].classList.replace("border-slate-100", "border-rose-500");
        buttons[selIdx].classList.replace("dark:border-slate-600", "dark:border-rose-500");
        buttons[selIdx].classList.add("bg-rose-50", "dark:bg-rose-900/30", "text-rose-900", "dark:text-rose-400");
        buttons[selIdx].querySelector(".status-marker").textContent = incorrectText;

        buttons[corIdx].classList.remove("opacity-50");
        buttons[corIdx].classList.replace("border-slate-100", "border-emerald-500");
        buttons[corIdx].classList.replace("dark:border-slate-600", "dark:border-emerald-500");
        buttons[corIdx].classList.add("bg-emerald-50", "dark:bg-emerald-900/30", "text-emerald-900", "dark:text-emerald-400");
        buttons[corIdx].querySelector(".status-marker").textContent = correctText;

        feedback.className = "mt-3 p-3 rounded-xl text-xs md:text-sm font-semibold bg-rose-100 dark:bg-rose-900/50 text-rose-900 dark:text-rose-400 border border-rose-300 dark:border-rose-700 shadow-inner flex flex-col gap-1.5 items-start";
        feedbackText.innerHTML = `<strong class="text-rose-700 dark:text-rose-400 block mb-1">${expIncorrectPrefix}</strong> ${formatUIText(decodeURIComponent(encodedExp))}`;
    }

    updateLocalStudyTracker(false);
    const btnTryAgain = document.getElementById(`btnTryAgainComp-${uiIdx}`);
    if (btnTryAgain) {
        btnTryAgain.classList.remove("hidden");
        btnTryAgain.classList.add("flex");
    }
};

window.resetCompFlipQuiz = function (uiIdx) {
    const container = document.getElementById(`compMcqOptions-${uiIdx}`);
    const buttons = container.querySelectorAll("button");
    const feedback = document.getElementById(`compMcqFeedback-${uiIdx}`);
    buttons.forEach((b) => {
        b.disabled = false;
        b.classList.remove("opacity-50", "bg-emerald-50", "bg-rose-50", "dark:bg-emerald-900/30", "dark:bg-rose-900/30", "text-emerald-900", "text-rose-900", "dark:text-emerald-400", "dark:text-rose-400", "border-emerald-500", "dark:border-emerald-500", "border-rose-500", "dark:border-rose-500");
        b.classList.add("bg-white", "dark:bg-slate-800", "border-slate-100", "dark:border-slate-600", "text-slate-700", "dark:text-slate-300");
        b.querySelector(".status-marker").textContent = "";
    });
    feedback.classList.add("hidden");
    feedback.classList.remove("flex");
    const btnTryAgain = document.getElementById(`btnTryAgainComp-${uiIdx}`);
    if (btnTryAgain) {
        btnTryAgain.classList.remove("flex");
        btnTryAgain.classList.add("hidden");
    }
};

window.handleCompQuizAnswer = function (e, cardId, uiIdx, selIdx, corIdx, encodedExp) {
    const btns = document.querySelectorAll(`.comp-opt-${uiIdx}`);
    if (!btns.length || btns[0].disabled) return;

    const saved = JSON.parse(localStorage.getItem(`quiz_prog_${currentCompId}`) || '{"correct":0,"attempted":0,"answers":{}}');
    saved.attempted++;
    if (selIdx === corIdx) saved.correct++;
    saved.answers[`${currentCompId}_${cardId}`] = selIdx;
    saved.lastUpdated = Date.now();
    localStorage.setItem(`quiz_prog_${currentCompId}`, JSON.stringify(saved));

    document.getElementById("compilationScoreBadge").textContent = `Score: ${saved.correct}/${saved.attempted}`;
    updateLocalStudyTracker(false);
    restoreCompQuizAnswerUI(uiIdx, selIdx, corIdx, encodedExp);

    const filtered = activeCategoryFilter === "all" ? workingCompilationCards : workingCompilationCards.filter((c) => c.category === activeCategoryFilter);
    renderPaginationBar(currentCompilationPage, Math.ceil(filtered.length / COMPILATION_PER_PAGE), filtered);
};

function restoreCompQuizAnswerUI(uiIdx, selIdx, corIdx, encodedExp) {
    const btns = document.querySelectorAll(`.comp-opt-${uiIdx}`);
    const expContainer = document.getElementById(`quizExp-${uiIdx}`);
    if (!btns.length || !expContainer) return;

    btns.forEach((b) => {
        b.disabled = true;
        b.classList.add("opacity-50");
    });

    const correctText = currentLang === "hi" ? "✅ सही" : "✅ Correct";
    const incorrectText = currentLang === "hi" ? "❌ गलत" : "❌ Incorrect";

    if (selIdx === corIdx) {
        btns[selIdx].classList.remove("opacity-50");
        btns[selIdx].className = `w-full text-left font-bold text-xs md:text-sm p-3 rounded-xl transition flex items-center justify-between shadow-xs border border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-300 comp-opt-${uiIdx} disabled:cursor-not-allowed`;
        btns[selIdx].querySelector(".status-marker").textContent = correctText;
        expContainer.className = "mt-3.5 p-3 rounded-xl text-xs leading-relaxed font-semibold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 block";
    } else {
        btns[selIdx].classList.remove("opacity-50");
        btns[selIdx].className = `w-full text-left font-bold text-xs md:text-sm p-3 rounded-xl transition flex items-center justify-between shadow-xs border border-rose-500 bg-rose-50 dark:bg-rose-900/30 text-rose-900 dark:text-rose-300 comp-opt-${uiIdx} disabled:cursor-not-allowed`;
        btns[selIdx].querySelector(".status-marker").textContent = incorrectText;

        if (btns[corIdx]) {
            btns[corIdx].classList.remove("opacity-50");
            btns[corIdx].className = `w-full text-left font-bold text-xs md:text-sm p-3 rounded-xl transition flex items-center justify-between shadow-xs border border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-300 comp-opt-${uiIdx} disabled:cursor-not-allowed`;
            btns[corIdx].querySelector(".status-marker").textContent = correctText;
        }
        expContainer.className = "mt-3.5 p-3 rounded-xl text-xs leading-relaxed font-semibold bg-rose-50 dark:bg-rose-900/30 text-rose-900 dark:text-rose-300 border border-rose-200 dark:border-rose-800 block";
    }
    expContainer.innerHTML = formatUIText(decodeURIComponent(encodedExp));
}

// ==========================================
// 15. INITIALIZATION, REST BOOKMARK ROUTER, FAB & NAV
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    // 1. Mobile Menu & Steno Accordion
    document.getElementById("mobileMenuBtn")?.addEventListener("click", () => {
        document.getElementById("mobileMenu")?.classList.toggle("hidden");
    });
    document.getElementById("mobileStenoToggle")?.addEventListener("click", () => {
        const stenoMenu = document.getElementById("mobileStenoMenu");
        stenoMenu?.classList.toggle("hidden");
        stenoMenu?.classList.toggle("flex");
        const chev = document.getElementById("stenoChevron");
        if (chev && stenoMenu) chev.textContent = stenoMenu.classList.contains("hidden") ? "▼" : "▲";
    });

    // 2. Active Navbar Link Highlight
    let currentPath = window.location.pathname.split("?")[0].split("#")[0].replace(/\/$/, "").split("/").pop().replace(".html", "");
    if (!currentPath) currentPath = "index";
    document.querySelectorAll("nav a").forEach((link) => {
        const href = link.getAttribute("href");
        if (href && !href.startsWith("http") && !href.startsWith("mailto")) {
            const targetFile = href.split("?")[0].split("#")[0].split("/").pop().replace(".html", "") || "index";
            if (targetFile === currentPath) {
                link.classList.remove("text-slate-300", "text-cyan-300", "text-slate-400");
                link.classList.add("active-nav");
            }
        }
    });

    // 3. Floating Assistive FAB
    const fabContainer = document.getElementById("stenoFabContainer");
    const fabMain = document.getElementById("stenoFabMain");
    const fabMenu = document.getElementById("stenoFabMenu");
    const shareBtn = document.getElementById("fabShareBtn");

    if (fabContainer && fabMain && fabMenu) {
        let isDragging = false;
        let hasDragged = false;
        let startX = 0;
        let startY = 0;
        let initialX = 0;
        let initialY = 0;
        const fabSize = 52;

        if (isMobileDevice) {
            fabMain.addEventListener("click", (e) => {
                e.stopPropagation();
                fabMenu.classList.toggle("active");
            });
        } else {
            const savedX = localStorage.getItem("stenoFabX");
            const savedY = localStorage.getItem("stenoFabY");
            if (savedX !== null && savedY !== null) {
                const x = parseInt(savedX, 10);
                const y = parseInt(savedY, 10);
                if (x >= 0 && x <= window.innerWidth - fabSize && y >= 0 && y <= window.innerHeight - fabSize) {
                    fabContainer.style.left = x + "px";
                    fabContainer.style.top = y + "px";
                    fabContainer.style.right = "auto";
                    fabContainer.style.bottom = "auto";
                }
            }

            fabMain.addEventListener("mousedown", (e) => {
                if (e.target.closest("#stenoFabMenu")) return;
                isDragging = true;
                hasDragged = false;
                startX = e.clientX;
                startY = e.clientY;
                initialX = fabContainer.offsetLeft;
                initialY = fabContainer.offsetTop;
                document.body.style.userSelect = "none";
            });

            document.addEventListener("mousemove", (e) => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                if (Math.abs(dx) > 12 || Math.abs(dy) > 12) hasDragged = true;
                if (!hasDragged) return;
                fabMenu.classList.remove("active");
                const newX = Math.max(0, Math.min(initialX + dx, window.innerWidth - fabSize));
                const newY = Math.max(0, Math.min(initialY + dy, window.innerHeight - fabSize));
                fabContainer.style.left = newX + "px";
                fabContainer.style.top = newY + "px";
                fabContainer.style.right = "auto";
                fabContainer.style.bottom = "auto";
            });

            document.addEventListener("mouseup", () => {
                if (!isDragging) return;
                isDragging = false;
                document.body.style.userSelect = "auto";
                if (hasDragged) {
                    const currentX = fabContainer.offsetLeft;
                    const targetX = currentX < window.innerWidth / 2 ? 10 : window.innerWidth - (fabSize + 10);
                    fabContainer.style.transition = "left 0.3s ease-out";
                    fabContainer.style.left = targetX + "px";
                    localStorage.setItem("stenoFabX", targetX);
                    localStorage.setItem("stenoFabY", fabContainer.offsetTop);
                    setTimeout(() => {
                        fabContainer.style.transition = "";
                    }, 300);
                } else {
                    fabMenu.classList.toggle("active");
                }
            });
        }
        document.addEventListener("click", (e) => {
            if (!fabContainer.contains(e.target)) fabMenu.classList.remove("active");
        });
        shareBtn?.addEventListener("click", async (e) => {
            e.preventDefault();
            const shareData = { title: document.title, text: "Check out this Stenogym resource!", url: window.location.href };
            try {
                if (navigator.share) await navigator.share(shareData);
                else {
                    await navigator.clipboard.writeText(window.location.href);
                    alert("Link copied to clipboard!");
                }
            } catch (err) {}
        });
    }

    // 4. Initial Language UI State
    const btnsEn = [document.getElementById("btnLangEn"), document.getElementById("btnLangEnMob")];
    const btnsHi = [document.getElementById("btnLangHi"), document.getElementById("btnLangHiMob")];
    if (currentLang === "hi") {
        btnsHi.forEach((b) => {
            if (b) {
                b.classList.add("bg-indigo-600", "text-white");
                b.classList.remove("text-slate-400");
            }
        });
        btnsEn.forEach((b) => {
            if (b) {
                b.classList.remove("bg-indigo-600", "text-white");
                b.classList.add("text-slate-400");
            }
        });
    }
    applyStaticTranslations();

    // 5. Smart Deep-Link & REST Bookmark Router
    const bkmkParam = urlParams.get("bookmark");
    const topicParam = urlParams.get("topic");
    const folderParam = urlParams.get("folder");
    const tabParam = urlParams.get("tab") || sessionStorage.getItem("lastActiveTab") || "daily";

    if (bkmkParam) {
        if (bkmkParam.startsWith("daily_news_")) {
            const docIdRaw = bkmkParam.replace("daily_news_", "");
            try {
                const docData = await restGetDoc("daily_news", docIdRaw);
                if (docData && docData.date) {
                    selectedDateStr = docData.date;
                    if (dateInput) dateInput.value = selectedDateStr;
                    window.history.replaceState({}, "", `?tab=daily&date=${selectedDateStr}&bookmark=${encodeURIComponent(bkmkParam)}`);
                }
            } catch (e) {}
            setCadence(tabDaily, dailyFeedView, "daily", false);
            setTimeout(() => scrollToAndHighlight(bkmkParam, false), 700);
        } else if (bkmkParam.startsWith("comp_")) {
            const docIdRaw = bkmkParam.replace("comp_", "");
            try {
                const docData = await restGetDoc("ca_drills", docIdRaw);
                if (docData) {
                    const compKey = docData.id || docData.date;
                    window.history.replaceState({}, "", `?topic=${encodeURIComponent(compKey)}&bookmark=${encodeURIComponent(bkmkParam)}`);
                    await triggerTopicRouter(compKey, bkmkParam);
                } else {
                    setCadence(tabDaily, dailyFeedView, "daily", false);
                }
            } catch (e) {
                setCadence(tabDaily, dailyFeedView, "daily", false);
            }
        } else if (bkmkParam.includes("_")) {
            const lastUnderscore = bkmkParam.lastIndexOf("_");
            const compIdGuess = bkmkParam.substring(0, lastUnderscore);
            if (compIdGuess) {
                window.history.replaceState({}, "", `?topic=${encodeURIComponent(compIdGuess)}&bookmark=${encodeURIComponent(bkmkParam)}`);
                await triggerTopicRouter(compIdGuess, bkmkParam);
            } else {
                setCadence(tabDaily, dailyFeedView, "daily", false);
            }
        } else {
            setCadence(tabDaily, dailyFeedView, "daily", false);
        }
    } else if (topicParam) {
        await triggerTopicRouter(topicParam);
    } else if (tabParam === "weekly") {
        setCadence(tabWeekly, weeklyDrillView, "weekly", false);
    } else if (tabParam === "monthly") {
        activeMonthlyFolder = folderParam || null;
        setCadence(tabMonthly, monthlyPdfView, "monthly", false);
    } else if (tabParam === "special") {
        activeSpecialFolderFilter = folderParam || "all";
        setCadence(tabSpecial, specialTopicView, "special", false);
    } else {
        setCadence(tabDaily, dailyFeedView, "daily", false);
    }
});
    