import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut
} from "https://www.gstatic.com/firebasejs/11.8.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.8.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const tripId = new URLSearchParams(window.location.search).get("trip") || "demo-trip-001";
const provider = new GoogleAuthProvider();

let members = [];
let tripSettings = {
  baseCurrency: "HKD",
  exchangeRates: { HKD: 1, JPY: 0.055, CNY: 1.08, TWD: 0.24, KRW: 0.0058, USD: 7.8 }
};

const form = document.getElementById("expenseForm");
const dateInput = document.getElementById("date");
const titleInput = document.getElementById("title");
const amountInput = document.getElementById("amount");
const currencyInput = document.getElementById("currency");
const paidByInput = document.getElementById("paidBy");
const sharedByGroup = document.getElementById("sharedByGroup");
const categoryInput = document.getElementById("category");
const noteInput = document.getElementById("note");
const syncStatus = document.getElementById("syncStatus");
const expenseList = document.getElementById("expenseList");
const summary = document.getElementById("summary");
const submitBtn = document.getElementById("submitBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const memberList = document.getElementById("memberList");
const memberNameInput = document.getElementById("memberNameInput");
const addMemberBtn = document.getElementById("addMemberBtn");

const baseCurrencyInput = document.getElementById("baseCurrency");
const ratesContainer = document.getElementById("ratesContainer");
const saveRatesBtn = document.getElementById("saveRatesBtn");

const ocrFileInput = document.getElementById("ocrReceiptInput");
const ocrBtn = document.getElementById("ocrScanBtn");

const ocrPreviewModal = document.getElementById("ocrPreviewModal");
const aiMerchantInput = document.getElementById("aiMerchantInput");
const aiDateInput = document.getElementById("aiDateInput");
const aiCurrencyInput = document.getElementById("aiCurrencyInput");
const aiTotalInput = document.getElementById("aiTotalInput");
const aiConfidenceInput = document.getElementById("aiConfidenceInput");
const aiReasonInput = document.getElementById("aiReasonInput");
const confirmAiFillBtn = document.getElementById("confirmAiFillBtn");
const cancelAiFillBtn = document.getElementById("cancelAiFillBtn");

const googleSignInBtn = document.getElementById("googleSignInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const authUserText = document.getElementById("authUserText");

const adminPanel = document.getElementById("adminPanel");
const allowedEmailList = document.getElementById("allowedEmailList");
const allowedEmailInput = document.getElementById("allowedEmailInput");
const addAllowedEmailBtn = document.getElementById("addAllowedEmailBtn");
const exportExcelBtn = document.getElementById("exportExcelBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportJsonBackupBtn = document.getElementById("exportJsonBackupBtn");
const exportExcelReportBtn = document.getElementById("exportExcelReportBtn");

const tripControlPanel = document.getElementById("tripControlPanel");
const tripStatusText = document.getElementById("tripStatusText");
const lockTripBtn = document.getElementById("lockTripBtn");
const unlockTripBtn = document.getElementById("unlockTripBtn");
const deletedExpenseList = document.getElementById("deletedExpenseList");
const activityLogList = document.getElementById("activityLogList");

let currentUser = null;
let allExpenses = [];
let expenses = [];
let settlements = [];
let activityLogs = [];
let tripStatus = "open";
let tripLockedAt = null;
let tripLockedBy = null;
let tripLockedByName = "";
let editingExpenseId = null;
let stopTripListener = null;
let stopExpensesListener = null;
let stopSettlementsListener = null;
let stopActivityLogsListener = null;
let tripAllowedUids = [];
let tripCreatorUid = null;
let allowedEmailsCache = [];

/* utils */
const safeEscape = (text) => String(text ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const getTripDocRef = () => doc(db, "trips", tripId);
const getExpensesCollection = () => collection(db, "trips", tripId, "expenses");
const getSettlementsCollection = () => collection(db, "trips", tripId, "settlements");
const getActivityLogsCollection = () => collection(db, "trips", tripId, "activityLogs");
const uniqueStrings = (arr) => [...new Set((arr || []).filter(Boolean).map(v => String(v)))];
const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

function getCurrentUserDisplayName() {
  if (!currentUser) return "未知用戶";
  return currentUser.displayName || currentUser.email || currentUser.uid.slice(0, 7) + "…";
}

function isTripLocked() {
  return tripStatus === "locked";
}

function assertTripOpen(message = "此旅程已鎖定，不能再修改支出或設定。") {
  if (isTripLocked()) {
    alert(message);
    return false;
  }
  return true;
}

function getActiveExpenses() {
  return allExpenses.filter(expense => expense.isDeleted !== true);
}

function getDeletedExpenses() {
  return allExpenses.filter(expense => expense.isDeleted === true);
}

function setFormDisabled(disabled) {
  Array.from(form.elements).forEach(el => {
    el.disabled = disabled;
  });
  if (disabled) {
    submitBtn.textContent = "旅程已鎖定";
    cancelEditBtn.classList.add("hidden");
  } else if (!editingExpenseId) {
    submitBtn.textContent = "新增";
  }
}

function updateTripStatusUi() {
  const locked = isTripLocked();
  const lockInfo = locked
    ? `已鎖定${tripLockedByName ? ` · ${tripLockedByName}` : ""}${tripLockedAt ? ` · ${formatTimestamp(tripLockedAt)}` : ""}`
    : "Open，仍可新增及修改支出";

  if (tripStatusText) {
    tripStatusText.innerHTML = locked
      ? `<span class="locked-badge">Locked</span> ${safeEscape(lockInfo)}`
      : `<span class="open-badge">Open</span> ${safeEscape(lockInfo)}`;
  }

  if (tripControlPanel) {
    tripControlPanel.classList.toggle("hidden", !isAdmin());
  }

  if (lockTripBtn) lockTripBtn.classList.toggle("hidden", locked || !isAdmin());
  if (unlockTripBtn) unlockTripBtn.classList.toggle("hidden", !locked || !isAdmin());

  setFormDisabled(locked);

  if (addMemberBtn) addMemberBtn.disabled = locked;
  if (memberNameInput) memberNameInput.disabled = locked;
  if (saveRatesBtn) saveRatesBtn.disabled = locked;
  if (baseCurrencyInput) baseCurrencyInput.disabled = locked;
  if (ratesContainer) {
    ratesContainer.querySelectorAll("input").forEach(input => {
      input.disabled = locked || input.dataset.rateCode === tripSettings.baseCurrency;
    });
  }
  if (ocrBtn) ocrBtn.disabled = locked;
  if (ocrFileInput) ocrFileInput.disabled = locked;
}

async function logActivity(action, message, targetType = "trip", targetId = tripId, details = {}) {
  if (!currentUser) return;

  try {
    await addDoc(getActivityLogsCollection(), {
      action,
      message,
      actorUid: currentUser.uid,
      actorName: getCurrentUserDisplayName(),
      targetType,
      targetId: String(targetId || ""),
      details,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Activity log failed:", error);
  }
}


function getSettlementKey(item) {
  return `${item.from}|${item.to}|${item.currency}|${Number(item.amount).toFixed(2)}`;
}

function getSettlementPairKey(item) {
  return `${item.from}|${item.to}|${item.currency}`;
}

function getTotalRecordedPayments(currency) {
  return round2(settlements.reduce((sum, record) => {
    if (record.currency !== currency) return sum;
    return sum + Number(record.paidAmount ?? record.amount ?? 0);
  }, 0));
}

function applyRecordedPaymentsToNet(net, currency) {
  settlements.forEach(record => {
    if (record.currency !== currency) return;

    const from = record.from;
    const to = record.to;
    const paidAmount = Number(record.paidAmount ?? record.amount ?? 0);

    if (!from || !to || !Number.isFinite(paidAmount) || paidAmount <= 0) return;

    if (!Object.prototype.hasOwnProperty.call(net, from)) net[from] = 0;
    if (!Object.prototype.hasOwnProperty.call(net, to)) net[to] = 0;

    // A settlement payment is a cash transfer.
    // Payer's payable position reduces, receiver's receivable position reduces.
    // If someone overpays, the net position will naturally flip and the next settlement will ask the receiver to pay back the excess.
    net[from] += paidAmount;
    net[to] -= paidAmount;
  });

  Object.keys(net).forEach(person => {
    net[person] = round2(net[person]);
  });

  return net;
}

function getExportFileName() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `trip-expenses-${tripId}-${date}.xlsx`;
}

function getJsonBackupFileName() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `trip-expenses-backup-${tripId}-${date}.json`;
}

function timestampToIso(ts) {
  if (!ts) return "";
  const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function toPlainValue(value) {
  if (value == null) return value;

  if (typeof value?.toDate === "function") {
    return timestampToIso(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => toPlainValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, toPlainValue(val)])
    );
  }

  return value;
}

function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setToday() { dateInput.value = new Date().toISOString().slice(0, 10); }
function getSelectedParticipants() { return Array.from(sharedByGroup.querySelectorAll("input:checked")).map(i => i.value); }
function getRateFor(currency) { const r = tripSettings.exchangeRates?.[currency]; return Number.isFinite(Number(r)) && Number(r) > 0 ? Number(r) : null; }
function convertToBase(amount, currency) { const rate = getRateFor(currency); return rate ? round2(Number(amount) * rate) : null; }

function setAuthUI(user) {
  if (user) {
    googleSignInBtn.classList.add("hidden");
    signOutBtn.classList.remove("hidden");
    authUserText.textContent = `已登入：${user.email || user.displayName || user.uid}`;
  } else {
    googleSignInBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
    authUserText.textContent = "未登入";
  }
}

async function handleGoogleSignIn() {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Google popup login error:", error?.code, error?.message, error);
    const popupRelated = [
      "auth/popup-blocked",
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
      "auth/operation-not-supported-in-this-environment"
    ];
    if (popupRelated.includes(error?.code)) {
      try {
        await signInWithRedirect(auth, provider);
        return;
      } catch (redirectError) {
        console.error("Google redirect login error:", redirectError?.code, redirectError?.message, redirectError);
        alert(`Google 登入失敗：${redirectError?.code || "unknown"}`);
        return;
      }
    }
    alert(`Google 登入失敗：${error?.code || "unknown"}`);
  }
}

async function handleSignOut() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
    alert("登出失敗。");
  }
}

function renderMemberManager() {
  memberList.innerHTML = members.map(member => `
    <div class="member-chip">
      <span>${safeEscape(member)}</span>
      <button type="button" data-remove-member="${safeEscape(member)}">移除</button>
    </div>
  `).join("");

  memberList.querySelectorAll("[data-remove-member]").forEach(button => {
    button.addEventListener("click", () => removeMember(button.dataset.removeMember));
  });
}

function initMembers() {
  paidByInput.innerHTML = members.map(member => `<option value="${safeEscape(member)}">${safeEscape(member)}</option>`).join("");
  sharedByGroup.innerHTML = members.map(member => `
    <label class="checkbox-item">
      <input type="checkbox" value="${safeEscape(member)}" checked />
      ${safeEscape(member)}
    </label>
  `).join("");
  renderMemberManager();
}

function renderRateEditor() {
  if (!baseCurrencyInput || !ratesContainer) return;
  baseCurrencyInput.value = tripSettings.baseCurrency || "HKD";
  const currencyOptions = Array.from(currencyInput.options).map(o => o.value);

  ratesContainer.innerHTML = currencyOptions.map(code => {
    const value = tripSettings.exchangeRates?.[code] ?? "";
    const disabled = code === tripSettings.baseCurrency ? "disabled" : "";
    const hint = code === tripSettings.baseCurrency ? "(base=1)" : "";
    return `<label class="rate-row"><span>${code} ${hint}</span><input type="number" step="0.0001" min="0" data-rate-code="${code}" value="${value}" ${disabled}/></label>`;
  }).join("");
}

async function saveTripSettings() {
  if (!assertTripOpen()) return;
  const newBase = baseCurrencyInput.value;
  const nextRates = {};
  ratesContainer.querySelectorAll("[data-rate-code]").forEach(input => {
    const code = input.dataset.rateCode;
    const n = Number(input.value);
    if (code === newBase) nextRates[code] = 1;
    else if (Number.isFinite(n) && n > 0) nextRates[code] = n;
  });
  if (!nextRates[newBase]) nextRates[newBase] = 1;
  tripSettings = { ...tripSettings, baseCurrency: newBase, exchangeRates: nextRates };

  await setDoc(getTripDocRef(), { settings: tripSettings }, { merge: true });
  alert("匯率設定已儲存。");
  await logActivity("settings_updated", `修改匯率設定，基準貨幣為 ${newBase}`, "trip", tripId, { baseCurrency: newBase });
  renderRateEditor(); updateTripStatusUi(); renderSummary(); renderExpenses();
}

async function ensureTripMembersAndSettings() {
  const tripRef = getTripDocRef();
  const tripDoc = await getDoc(tripRef);

  if (!tripDoc.exists()) {
    members = [currentUser.displayName || "Me"];
    tripAllowedUids = [currentUser.uid];
    tripCreatorUid = currentUser.uid;
    const myEmail = normalizeEmail(currentUser.email);
    allowedEmailsCache = myEmail ? [myEmail] : [];

    await setDoc(tripRef, {
      members,
      allowedUids: tripAllowedUids,
      allowedEmails: allowedEmailsCache,
      settings: tripSettings,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
      status: "open"
    }, { merge: true });
    return;
  }

  const data = tripDoc.data();
  tripAllowedUids = Array.isArray(data.allowedUids) ? uniqueStrings(data.allowedUids) : [];
  tripCreatorUid = data.createdBy || null;
  const allowedEmails = Array.isArray(data.allowedEmails)
    ? data.allowedEmails.map(normalizeEmail).filter(Boolean)
    : [];
  allowedEmailsCache = allowedEmails;

  const myEmail = normalizeEmail(currentUser.email);
  const uidAllowed = tripAllowedUids.includes(currentUser.uid);
  const emailAllowed = !!myEmail && allowedEmails.includes(myEmail);
  const isCreator = data.createdBy === currentUser.uid;

  if (!data.status && isCreator) {
    await setDoc(tripRef, { status: "open" }, { merge: true });
  }

  // 自動 claim：email 已白名單 or 係 trip 創建者 -> 自動加 uid
  if (!uidAllowed && (emailAllowed || isCreator)) {
    const nextUids = uniqueStrings([...tripAllowedUids, currentUser.uid]);
    await setDoc(tripRef, { allowedUids: nextUids }, { merge: true });
    tripAllowedUids = nextUids;
  }

  // 最終判斷
  if (!tripAllowedUids.includes(currentUser.uid)) {
    throw Object.assign(new Error("not_allowed"), { code: "permission-denied" });
  }

  members = Array.isArray(data.members) && data.members.length > 0 ? data.members : [currentUser.displayName || "Me"];
  if (!Array.isArray(data.members) || data.members.length === 0) {
    await setDoc(tripRef, { members }, { merge: true });
  }

  if (data.settings) {
    tripSettings = {
      ...tripSettings,
      ...data.settings,
      exchangeRates: { ...tripSettings.exchangeRates, ...(data.settings.exchangeRates || {}) }
    };
  } else {
    await setDoc(tripRef, { settings: tripSettings }, { merge: true });
  }
}

function startTripListener() {
  if (stopTripListener) stopTripListener();

  stopTripListener = onSnapshot(getTripDocRef(), snap => {
    if (!snap.exists()) return;
    const data = snap.data();

    tripStatus = data.status === "locked" ? "locked" : "open";
    tripLockedAt = data.lockedAt || null;
    tripLockedBy = data.lockedBy || null;
    tripLockedByName = data.lockedByName || "";
    updateTripStatusUi();

    if (Array.isArray(data.members) && data.members.length > 0) {
      const changed = JSON.stringify(data.members) !== JSON.stringify(members);
      if (changed) {
        const prev = paidByInput.value;
        members = data.members;
        initMembers();
        if (members.includes(prev)) paidByInput.value = prev;
      }
    }

    if (Array.isArray(data.allowedUids)) tripAllowedUids = uniqueStrings(data.allowedUids);
    if (data.createdBy) tripCreatorUid = data.createdBy;
    if (Array.isArray(data.allowedEmails)) {
      allowedEmailsCache = data.allowedEmails.map(normalizeEmail).filter(Boolean);
      renderAllowedEmails();
      updateTripStatusUi();
    }

    if (data.settings) {
      tripSettings = {
        ...tripSettings,
        ...data.settings,
        exchangeRates: { ...tripSettings.exchangeRates, ...(data.settings.exchangeRates || {}) }
      };
      renderRateEditor(); updateTripStatusUi(); renderSummary(); renderExpenses();
    }
  }, err => {
    console.error(err);
    if (err?.code === "permission-denied") {
      syncStatus.textContent = "No access to this trip";
      alert("你無權限進入此 trip。");
    }
  });
}

function listenToExpenses() {
  if (stopExpensesListener) stopExpensesListener();
  const q = query(getExpensesCollection(), orderBy("date", "desc"));
  stopExpensesListener = onSnapshot(q, snap => {
    allExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    expenses = getActiveExpenses();
    renderExpenses();
    renderDeletedExpenses();
    renderSummary();
    syncStatus.textContent = `Synced (${tripId})`;
  }, err => {
    console.error(err);
    syncStatus.textContent = err?.code === "permission-denied" ? "No access to expenses" : "Sync error";
  });
}

function listenToSettlements() {
  if (stopSettlementsListener) stopSettlementsListener();
    if (stopActivityLogsListener) stopActivityLogsListener();
  const q = query(getSettlementsCollection(), orderBy("paidAt", "desc"));
  stopSettlementsListener = onSnapshot(q, snap => {
    settlements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSummary();
  }, err => {
    console.error(err);
    syncStatus.textContent = err?.code === "permission-denied" ? "No access to settlements" : "Settlement sync error";
  });
}

function listenToActivityLogs() {
  if (stopActivityLogsListener) stopActivityLogsListener();
  const q = query(getActivityLogsCollection(), orderBy("createdAt", "desc"));
  stopActivityLogsListener = onSnapshot(q, snap => {
    activityLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderActivityLogs();
  }, err => {
    console.error(err);
    syncStatus.textContent = err?.code === "permission-denied" ? "No access to activity logs" : "Activity log sync error";
  });
}


function resetExpenseForm() {
  form.reset(); setToday();
  Array.from(sharedByGroup.querySelectorAll("input")).forEach(i => i.checked = true);
  editingExpenseId = null;
  submitBtn.textContent = "新增";
  cancelEditBtn.classList.add("hidden");
  document.getElementById("editingNotice")?.remove();
}

function enterEditMode(expenseId) {
  if (!assertTripOpen()) return;
  const expense = expenses.find(item => item.id === expenseId);
  if (!expense) return alert("搵唔到呢筆支出。");
  editingExpenseId = expense.id;
  dateInput.value = expense.date || "";
  titleInput.value = expense.title || "";
  amountInput.value = expense.originalAmount || expense.amount || "";
  currencyInput.value = expense.originalCurrency || expense.currency || "HKD";
  paidByInput.value = expense.paidBy || members[0];
  categoryInput.value = expense.category || "Other";
  noteInput.value = expense.note || "";

  Array.from(sharedByGroup.querySelectorAll("input")).forEach(input => {
    input.checked = Array.isArray(expense.sharedBy) ? expense.sharedBy.includes(input.value) : false;
  });

  submitBtn.textContent = "儲存修改";
  cancelEditBtn.classList.remove("hidden");
  document.getElementById("editingNotice")?.remove();

  const notice = document.createElement("div");
  notice.id = "editingNotice";
  notice.className = "editing-notice";
  notice.textContent = `正在編輯：${expense.title}`;
  form.prepend(notice);
}

async function saveExpense(event) {
  event.preventDefault();
  if (!currentUser) return alert("請先登入。");
  if (!assertTripOpen()) return;

  const participants = getSelectedParticipants();
  if (participants.length === 0) return alert("請至少選擇一位參與人。");

  const originalAmount = Number(amountInput.value);
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) return alert("請輸入有效金額。");

  const originalCurrency = currencyInput.value;
  const convertedAmount = convertToBase(originalAmount, originalCurrency);
  if (convertedAmount === null) return alert(`未有 ${originalCurrency} 匯率。`);

  const displayName = getCurrentUserDisplayName();

  const payload = {
    date: dateInput.value,
    title: titleInput.value.trim(),
    amount: originalAmount,
    currency: originalCurrency,
    originalAmount,
    originalCurrency,
    convertedAmount,
    baseCurrency: tripSettings.baseCurrency,
    fxRateUsed: getRateFor(originalCurrency),
    paidBy: paidByInput.value,
    sharedBy: participants,
    category: categoryInput.value,
    note: noteInput.value.trim(),
    updatedBy: currentUser.uid,
    updatedByName: displayName,
    updatedAt: serverTimestamp()
  };

  if (!payload.title) return alert("請輸入項目名稱。");

  if (editingExpenseId) {
    await updateDoc(doc(db, "trips", tripId, "expenses", editingExpenseId), payload);
    await logActivity("expense_updated", `${displayName} 修改 ${payload.title} ${payload.originalCurrency} ${payload.originalAmount.toFixed(2)}`, "expense", editingExpenseId, {
      title: payload.title,
      amount: payload.originalAmount,
      currency: payload.originalCurrency
    });
  } else {
    const docRef = await addDoc(getExpensesCollection(), {
      ...payload,
      isDeleted: false,
      createdBy: currentUser.uid,
      createdByName: displayName,
      createdAt: serverTimestamp()
    });
    await logActivity("expense_created", `${displayName} 新增 ${payload.title} ${payload.originalCurrency} ${payload.originalAmount.toFixed(2)}`, "expense", docRef.id, {
      title: payload.title,
      amount: payload.originalAmount,
      currency: payload.originalCurrency
    });
  }

  resetExpenseForm();
}

async function removeExpense(expenseId) {
  if (!assertTripOpen()) return;

  const expense = expenses.find(item => item.id === expenseId);
  const title = expense?.title || "支出";

  if (!confirm(`確定刪除「${title}」？資料會保留在 Deleted Items，可供審計追蹤。`)) return;

  if (editingExpenseId === expenseId) resetExpenseForm();

  await updateDoc(doc(db, "trips", tripId, "expenses", expenseId), {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    deletedBy: currentUser.uid,
    deletedByName: getCurrentUserDisplayName(),
    updatedBy: currentUser.uid,
    updatedByName: getCurrentUserDisplayName(),
    updatedAt: serverTimestamp()
  });

  await logActivity("expense_deleted", `${getCurrentUserDisplayName()} 刪除 ${title}`, "expense", expenseId, {
    title,
    softDelete: true
  });
}

async function restoreExpense(expenseId) {
  if (!assertTripOpen()) return;

  const expense = allExpenses.find(item => item.id === expenseId);
  const title = expense?.title || "支出";

  if (!confirm(`還原「${title}」？`)) return;

  await updateDoc(doc(db, "trips", tripId, "expenses", expenseId), {
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    deletedByName: "",
    updatedBy: currentUser.uid,
    updatedByName: getCurrentUserDisplayName(),
    updatedAt: serverTimestamp()
  });

  await logActivity("expense_restored", `${getCurrentUserDisplayName()} 還原 ${title}`, "expense", expenseId, {
    title
  });
}

async function addMember() {
  if (!assertTripOpen()) return;
  const name = memberNameInput.value.trim();
  if (!name) return alert("請輸入成員名稱。");
  if (members.some(m => m.toLowerCase() === name.toLowerCase())) return alert("成員名稱已存在。");
  const next = [...members, name];
  await setDoc(getTripDocRef(), { members: next }, { merge: true });
  members = next; initMembers(); memberNameInput.value = "";
  await logActivity("member_added", `${getCurrentUserDisplayName()} 新增成員 ${name}`, "member", name, { member: name });
}

async function removeMember(name) {
  if (!assertTripOpen()) return;
  if (members.length <= 1) return alert("至少要保留一位成員。");
  const used = expenses.some(e => e.paidBy === name || (Array.isArray(e.sharedBy) && e.sharedBy.includes(name)));
  if (used) return alert("此成員已出現在歷史支出，不能移除。");
  const next = members.filter(m => m !== name);
  await setDoc(getTripDocRef(), { members: next }, { merge: true });
  members = next; initMembers();
  await logActivity("member_removed", `${getCurrentUserDisplayName()} 移除成員 ${name}`, "member", name, { member: name });
}

function formatAuditUid(uid) {
  if (!uid) return "未知";
  if (currentUser && uid === currentUser.uid) return "你";
  return uid.slice(0, 7) + "…";
}

function formatTimestamp(ts) {
  if (!ts) return "時間未記錄";
  const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return "時間未記錄";
  return d.toLocaleString("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderExpenses() {
  if (!expenses.length) return expenseList.innerHTML = `<p class="neutral">暫時未有支出。</p>`;
  const base = tripSettings.baseCurrency;

  expenseList.innerHTML = expenses.map(expense => {
    const oAmt = Number(expense.originalAmount ?? expense.amount ?? 0);
    const oCur = expense.originalCurrency ?? expense.currency ?? base;
    const cAmt = Number(expense.convertedAmount ?? convertToBase(oAmt, oCur) ?? 0);
    const shareText = Array.isArray(expense.sharedBy) ? expense.sharedBy.map(safeEscape).join(", ") : "-";
    const createdName = expense.createdByName || formatAuditUid(expense.createdBy);
    const updatedName = expense.updatedByName || formatAuditUid(expense.updatedBy);
    return `
      <div class="expense-item">
        <div class="expense-title">${safeEscape(expense.title)} · ${safeEscape(oCur)} ${oAmt.toFixed(2)}</div>
        <div class="expense-meta">換算：${safeEscape(base)} ${cAmt.toFixed(2)}</div>
        <div class="expense-meta">${safeEscape(expense.date)} · Paid by ${safeEscape(expense.paidBy)} · Shared by ${shareText}</div>
        <div class="expense-meta">${safeEscape(expense.category)}${expense.note ? ` · ${safeEscape(expense.note)}` : ""}</div>
        <div class="expense-audit">
          <div>建立：${safeEscape(createdName)} · ${formatTimestamp(expense.createdAt)}</div>
          <div>更新：${safeEscape(updatedName)} · ${formatTimestamp(expense.updatedAt)}</div>
        </div>
        <button class="edit-btn" data-edit-id="${safeEscape(expense.id)}" ${isTripLocked() ? "disabled" : ""}>Edit</button>
        <button class="delete-btn" data-delete-id="${safeEscape(expense.id)}" ${isTripLocked() ? "disabled" : ""}>Delete</button>
      </div>
    `;
  }).join("");

  expenseList.querySelectorAll("[data-edit-id]").forEach(btn => btn.addEventListener("click", () => enterEditMode(btn.dataset.editId)));
  expenseList.querySelectorAll("[data-delete-id]").forEach(btn => btn.addEventListener("click", () => removeExpense(btn.dataset.deleteId)));
}

function renderDeletedExpenses() {
  if (!deletedExpenseList) return;

  const deleted = getDeletedExpenses();

  if (!deleted.length) {
    deletedExpenseList.innerHTML = `<p class="neutral">暫時未有已刪除支出。</p>`;
    return;
  }

  const base = tripSettings.baseCurrency;

  deletedExpenseList.innerHTML = deleted.map(expense => {
    const oAmt = Number(expense.originalAmount ?? expense.amount ?? 0);
    const oCur = expense.originalCurrency ?? expense.currency ?? base;
    return `
      <div class="expense-item deleted-item">
        <div class="expense-title">${safeEscape(expense.title)} · ${safeEscape(oCur)} ${oAmt.toFixed(2)}</div>
        <div class="expense-meta">${safeEscape(expense.date)} · Paid by ${safeEscape(expense.paidBy || "")}</div>
        <div class="expense-audit">
          <div>刪除：${safeEscape(expense.deletedByName || formatAuditUid(expense.deletedBy))} · ${formatTimestamp(expense.deletedAt)}</div>
        </div>
        <button class="edit-btn" data-restore-id="${safeEscape(expense.id)}" ${isTripLocked() ? "disabled" : ""}>還原</button>
      </div>
    `;
  }).join("");

  deletedExpenseList.querySelectorAll("[data-restore-id]").forEach(btn => {
    btn.addEventListener("click", () => restoreExpense(btn.dataset.restoreId));
  });
}


function buildSettlement(net) {
  const debtors = [], creditors = [];
  Object.entries(net).forEach(([person, amount]) => {
    const r = round2(amount);
    if (r < 0) debtors.push({ person, amount: Math.abs(r) });
    if (r > 0) creditors.push({ person, amount: r });
  });
  const settlement = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    const rpay = round2(pay);
    if (rpay > 0) settlement.push({ from: debtors[i].person, to: creditors[j].person, amount: rpay });
    debtors[i].amount = round2(debtors[i].amount - pay);
    creditors[j].amount = round2(creditors[j].amount - pay);
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }
  return settlement;
}

function calculateExpenseNetOnly() {
  const base = tripSettings.baseCurrency;
  const net = {};
  members.forEach(m => { net[m] = 0; });

  expenses.forEach(expense => {
    if (!Array.isArray(expense.sharedBy) || !expense.sharedBy.length) return;

    const converted = Number(
      expense.convertedAmount ??
      convertToBase(
        expense.originalAmount ?? expense.amount ?? 0,
        expense.originalCurrency ?? expense.currency ?? base
      ) ??
      0
    );

    if (!Object.prototype.hasOwnProperty.call(net, expense.paidBy)) net[expense.paidBy] = 0;
    net[expense.paidBy] += converted;

    const share = converted / expense.sharedBy.length;

    expense.sharedBy.forEach(m => {
      if (!Object.prototype.hasOwnProperty.call(net, m)) net[m] = 0;
      net[m] -= share;
    });
  });

  Object.keys(net).forEach(person => {
    net[person] = round2(net[person]);
  });

  return { net, currency: base };
}

function calculateSummary() {
  const { net: expenseNet, currency } = calculateExpenseNetOnly();
  const netAfterPayments = applyRecordedPaymentsToNet({ ...expenseNet }, currency);

  return {
    expenseNet,
    net: netAfterPayments,
    settlement: buildSettlement(netAfterPayments),
    currency,
    recordedPaymentsTotal: getTotalRecordedPayments(currency)
  };
}

function renderSummary() {
  const { expenseNet, net, settlement, currency, recordedPaymentsTotal } = calculateSummary();

  const netHtml = Object.entries(net).map(([person, amount]) => {
    const r = round2(amount);
    const original = round2(expenseNet[person] ?? 0);
    const cls = r > 0 ? "positive" : r < 0 ? "negative" : "neutral";
    const label = r > 0 ? "應收" : r < 0 ? "應付" : "已平數";
    const originalText = original === r
      ? ""
      : `<div class="expense-meta">原本：${original > 0 ? "應收" : original < 0 ? "應付" : "已平數"} ${currency} ${Math.abs(original).toFixed(2)}，已計入找數紀錄</div>`;

    return `
      <div class="summary-item">
        <strong>${safeEscape(person)}</strong>
        <span class="${cls}">${label} ${currency} ${Math.abs(r).toFixed(2)}</span>
        ${originalText}
      </div>
    `;
  }).join("");

  const settlementHtml = settlement.length
    ? settlement.map(item => {
        const key = getSettlementKey({ ...item, currency });
        const pairKey = getSettlementPairKey({ ...item, currency });

        return `
          <div class="settlement-item">
            <div><strong>${safeEscape(item.from)}</strong> pays <strong>${safeEscape(item.to)}</strong> <span class="negative">${currency} ${Number(item.amount).toFixed(2)}</span></div>
            <div class="settlement-status"><span class="unpaid-badge">尚欠，已扣除已找數紀錄</span></div>
            <div class="settlement-actions">
              <div class="settlement-payment-row">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="輸入今次找數金額"
                  data-payment-input="${safeEscape(pairKey)}"
                />
                <button
                  type="button"
                  class="settle-btn"
                  data-record-payment="${safeEscape(pairKey)}"
                  data-settlement-key="${safeEscape(key)}"
                  data-from="${safeEscape(item.from)}"
                  data-to="${safeEscape(item.to)}"
                  data-amount="${Number(item.amount).toFixed(2)}"
                  data-currency="${safeEscape(currency)}"
                  data-balance="${Number(item.amount).toFixed(2)}"
                >記錄找數</button>
              </div>
            </div>
          </div>
        `;
      }).join("")
    : `<p class="neutral">暫時無需結算，已計入支出及找數紀錄。</p>`;

  const paidHistoryHtml = settlements.length
    ? settlements.map(item => {
        const paidAmount = Number(item.paidAmount ?? item.amount ?? 0);
        return `
          <div class="settlement-item paid-history-item">
            <div><strong>${safeEscape(item.from)}</strong> paid <strong>${safeEscape(item.to)}</strong> ${safeEscape(item.currency)} ${paidAmount.toFixed(2)}</div>
            <div class="expense-meta">標記：${safeEscape(item.markedByName || formatAuditUid(item.markedBy))} · ${formatTimestamp(item.paidAt)}</div>
            ${item.note ? `<div class="expense-meta">備註：${safeEscape(item.note)}</div>` : ""}
            <button type="button" class="settle-btn secondary-btn" data-unpay-id="${safeEscape(item.id)}">取消此紀錄</button>
          </div>
        `;
      }).join("")
    : `<p class="neutral">暫時未有已找數紀錄。</p>`;

  summary.innerHTML = `
    <h3>每人淨額（${currency}，已計入找數）</h3>
    <p class="hint">已找數總額：${currency} ${recordedPaymentsTotal.toFixed(2)}。如有人找多咗，系統會自動反映為對方要找返。</p>
    ${netHtml}
    <h3>建議結算（剩餘應找）</h3>
    ${settlementHtml}
    <h3>已找數紀錄</h3>
    ${paidHistoryHtml}
  `;

  summary.querySelectorAll("[data-record-payment]").forEach(btn => {
    btn.addEventListener("click", () => recordSettlementPayment({
      settlementKey: btn.dataset.settlementKey,
      settlementPairKey: btn.dataset.recordPayment,
      from: btn.dataset.from,
      to: btn.dataset.to,
      settlementAmount: Number(btn.dataset.amount),
      balanceAmount: Number(btn.dataset.balance),
      currency: btn.dataset.currency
    }));
  });

  summary.querySelectorAll("[data-unpay-id]").forEach(btn => {
    btn.addEventListener("click", () => cancelSettlementPaid(btn.dataset.unpayId));
  });
}

async function recordSettlementPayment(item) {
  if (!currentUser) return alert("請先登入。");

  const input = summary.querySelector(`[data-payment-input="${CSS.escape(item.settlementPairKey)}"]`);
  const paidAmount = Number(input?.value);

  if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
    return alert("請輸入有效找數金額。");
  }

  if (paidAmount > item.balanceAmount) {
    const confirmed = confirm(`輸入金額 ${item.currency} ${paidAmount.toFixed(2)} 大過尚欠 ${item.currency} ${item.balanceAmount.toFixed(2)}，仍然記錄？`);
    if (!confirmed) return;
  }

  const note = prompt("備註，例如 FPS / Cash / Alipay，可留空：", "") || "";

  const docRef = await addDoc(getSettlementsCollection(), {
    settlementKey: item.settlementKey,
    settlementPairKey: item.settlementPairKey,
    from: item.from,
    to: item.to,
    settlementAmount: Number(item.settlementAmount),
    balanceBeforePayment: Number(item.balanceAmount),
    paidAmount,
    amount: paidAmount,
    currency: item.currency,
    status: paidAmount >= item.balanceAmount ? "paid" : "partial",
    note: note.trim(),
    markedBy: currentUser.uid,
    markedByName: getCurrentUserDisplayName(),
    paidAt: serverTimestamp()
  });

  await logActivity("settlement_recorded", `${getCurrentUserDisplayName()} 記錄 ${item.from} paid ${item.to} ${item.currency} ${paidAmount.toFixed(2)}`, "settlement", docRef.id, {
    from: item.from,
    to: item.to,
    paidAmount,
    currency: item.currency
  });
}

async function cancelSettlementPaid(settlementId) {
  if (!confirm("取消此已找數標記？")) return;
  const record = settlements.find(item => item.id === settlementId);
  await deleteDoc(doc(db, "trips", tripId, "settlements", settlementId));
  await logActivity("settlement_cancelled", `${getCurrentUserDisplayName()} 取消找數紀錄 ${record?.from || ""} paid ${record?.to || ""}`, "settlement", settlementId, {
    from: record?.from || "",
    to: record?.to || "",
    paidAmount: Number(record?.paidAmount ?? record?.amount ?? 0),
    currency: record?.currency || ""
  });
}

async function ensureSheetJs() {
  if (window.XLSX) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

function worksheetFromRows(rows, headers) {
  const normalizedRows = rows.length
    ? rows
    : [Object.fromEntries(headers.map(header => [header, ""]))];

  const ws = window.XLSX.utils.json_to_sheet(normalizedRows, { header: headers });
  if (ws["!ref"]) {
    ws["!autofilter"] = { ref: ws["!ref"] };
  }
  ws["!cols"] = headers.map(header => ({ wch: Math.max(String(header).length + 2, 14) }));
  return ws;
}

function coverSheetFromSummary(metrics) {
  const rows = [
    ["Trip Expense Report"],
    [],
    ["Trip ID", tripId],
    ["Trip Status", tripStatus],
    ["Base Currency", metrics.currency],
    ["Exported At", new Date().toLocaleString("zh-HK")],
    ["Exported By", getCurrentUserDisplayName()],
    ["Active Expenses", expenses.length],
    ["Deleted Expenses", getDeletedExpenses().length],
    ["Payment Records", settlements.length],
    ["Activity Log Records", activityLogs.length],
    ["Total Active Expense Amount", metrics.totalActiveExpenses],
    ["Total Recorded Payments", metrics.recordedPaymentsTotal],
    ["Outstanding Settlement Count", metrics.outstandingCount],
    ["Outstanding Settlement Amount", metrics.outstandingAmount]
  ];

  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 30 }, { wch: 28 }];
  return ws;
}

function exportWorkbook() {
  const { expenseNet, net, settlement, currency, recordedPaymentsTotal } = calculateSummary();
  const totalActiveExpenses = round2(expenses.reduce((sum, expense) => sum + Number(expense.convertedAmount ?? 0), 0));
  const outstandingAmount = round2(settlement.reduce((sum, item) => sum + Number(item.amount || 0), 0));

  const coverWs = coverSheetFromSummary({
    currency,
    totalActiveExpenses,
    recordedPaymentsTotal,
    outstandingCount: settlement.length,
    outstandingAmount
  });

  const expenseHeaders = [
    "Status",
    "Date",
    "Item",
    "Category",
    "OriginalCurrency",
    "OriginalAmount",
    "FxRateUsed",
    "BaseCurrency",
    "ConvertedAmount",
    "PaidBy",
    "SharedBy",
    "Note",
    "CreatedBy",
    "CreatedAt",
    "UpdatedBy",
    "UpdatedAt",
    "DeletedBy",
    "DeletedAt"
  ];

  const expensesRows = allExpenses.map(expense => ({
    Status: expense.isDeleted === true ? "Deleted" : "Active",
    Date: expense.date || "",
    Item: expense.title || "",
    Category: expense.category || "",
    OriginalCurrency: expense.originalCurrency || expense.currency || "",
    OriginalAmount: Number(expense.originalAmount ?? expense.amount ?? 0),
    FxRateUsed: Number(expense.fxRateUsed ?? getRateFor(expense.originalCurrency || expense.currency) ?? 0),
    BaseCurrency: expense.baseCurrency || tripSettings.baseCurrency,
    ConvertedAmount: Number(expense.convertedAmount ?? 0),
    PaidBy: expense.paidBy || "",
    SharedBy: Array.isArray(expense.sharedBy) ? expense.sharedBy.join(", ") : "",
    Note: expense.note || "",
    CreatedBy: expense.createdByName || formatAuditUid(expense.createdBy),
    CreatedAt: formatTimestamp(expense.createdAt),
    UpdatedBy: expense.updatedByName || formatAuditUid(expense.updatedBy),
    UpdatedAt: formatTimestamp(expense.updatedAt),
    DeletedBy: expense.deletedByName || formatAuditUid(expense.deletedBy),
    DeletedAt: formatTimestamp(expense.deletedAt)
  }));

  const summaryHeaders = [
    "Person",
    "OriginalStatusBeforePayments",
    "OriginalAmountBeforePayments",
    "PaymentEffect",
    "FinalStatusAfterPayments",
    "FinalAmountAfterPayments",
    "Currency"
  ];

  const summaryRows = Object.entries(net).map(([person, amount]) => {
    const rounded = round2(amount);
    const original = round2(expenseNet[person] ?? 0);
    const paymentEffect = round2(rounded - original);

    return {
      Person: person,
      OriginalStatusBeforePayments: original > 0 ? "Receivable" : original < 0 ? "Payable" : "Settled",
      OriginalAmountBeforePayments: Math.abs(original),
      PaymentEffect: paymentEffect,
      FinalStatusAfterPayments: rounded > 0 ? "Receivable" : rounded < 0 ? "Payable" : "Settled",
      FinalAmountAfterPayments: Math.abs(rounded),
      Currency: currency
    };
  });

  const settlementHeaders = [
    "From",
    "To",
    "Currency",
    "RemainingAmountToPay",
    "Status",
    "SettlementPairKey",
    "SettlementKey"
  ];

  const settlementRows = settlement.map(item => {
    const row = { ...item, currency };
    const key = getSettlementKey(row);
    const pairKey = getSettlementPairKey(row);

    return {
      From: item.from,
      To: item.to,
      Currency: currency,
      RemainingAmountToPay: Number(item.amount),
      Status: "Outstanding after recorded payments",
      SettlementPairKey: pairKey,
      SettlementKey: key
    };
  });

  const paidHeaders = [
    "From",
    "To",
    "Currency",
    "PaidAmount",
    "SettlementAmount",
    "BalanceBeforePayment",
    "Status",
    "Note",
    "MarkedBy",
    "PaidAt",
    "SettlementPairKey",
    "SettlementKey"
  ];

  const paidRows = settlements.map(item => ({
    From: item.from || "",
    To: item.to || "",
    Currency: item.currency || "",
    PaidAmount: Number(item.paidAmount ?? item.amount ?? 0),
    SettlementAmount: Number(item.settlementAmount ?? 0),
    BalanceBeforePayment: Number(item.balanceBeforePayment ?? 0),
    Status: item.status || "",
    Note: item.note || "",
    MarkedBy: item.markedByName || formatAuditUid(item.markedBy),
    PaidAt: formatTimestamp(item.paidAt),
    SettlementPairKey: item.settlementPairKey || "",
    SettlementKey: item.settlementKey || ""
  }));

  const activityHeaders = ["Action", "Message", "Actor", "TargetType", "TargetId", "CreatedAt"];
  const activityRows = activityLogs.map(item => ({
    Action: item.action || "",
    Message: item.message || "",
    Actor: item.actorName || formatAuditUid(item.actorUid),
    TargetType: item.targetType || "",
    TargetId: item.targetId || "",
    CreatedAt: formatTimestamp(item.createdAt)
  }));

  const deletedHeaders = ["Date", "Item", "OriginalCurrency", "OriginalAmount", "PaidBy", "SharedBy", "DeletedBy", "DeletedAt"];
  const deletedRows = getDeletedExpenses().map(expense => ({
    Date: expense.date || "",
    Item: expense.title || "",
    OriginalCurrency: expense.originalCurrency || expense.currency || "",
    OriginalAmount: Number(expense.originalAmount ?? expense.amount ?? 0),
    PaidBy: expense.paidBy || "",
    SharedBy: Array.isArray(expense.sharedBy) ? expense.sharedBy.join(", ") : "",
    DeletedBy: expense.deletedByName || formatAuditUid(expense.deletedBy),
    DeletedAt: formatTimestamp(expense.deletedAt)
  }));

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, coverWs, "Cover");
  window.XLSX.utils.book_append_sheet(wb, worksheetFromRows(expensesRows, expenseHeaders), "Expenses");
  window.XLSX.utils.book_append_sheet(wb, worksheetFromRows(summaryRows, summaryHeaders), "Summary");
  window.XLSX.utils.book_append_sheet(wb, worksheetFromRows(settlementRows, settlementHeaders), "Settlement");
  window.XLSX.utils.book_append_sheet(wb, worksheetFromRows(paidRows, paidHeaders), "Paid Records");
  window.XLSX.utils.book_append_sheet(wb, worksheetFromRows(activityRows, activityHeaders), "Activity Log");
  window.XLSX.utils.book_append_sheet(wb, worksheetFromRows(deletedRows, deletedHeaders), "Deleted Items");

  window.XLSX.writeFile(wb, getExportFileName());
}

function exportJsonBackup() {
  const { expenseNet, net, settlement, currency, recordedPaymentsTotal } = calculateSummary();

  const backup = {
    schemaVersion: 2,
    appName: "travel-expenses",
    exportedAt: new Date().toISOString(),
    exportedBy: {
      uid: currentUser?.uid || "",
      name: getCurrentUserDisplayName(),
      email: currentUser?.email || ""
    },
    trip: {
      tripId,
      status: tripStatus,
      lockedAt: timestampToIso(tripLockedAt),
      lockedBy: tripLockedBy || "",
      lockedByName: tripLockedByName || "",
      creatorUid: tripCreatorUid || "",
      members: [...members],
      settings: toPlainValue(tripSettings),
      allowedEmails: [...allowedEmailsCache],
      allowedUids: [...tripAllowedUids]
    },
    data: {
      expenses: toPlainValue(allExpenses),
      settlements: toPlainValue(settlements),
      activityLogs: toPlainValue(activityLogs)
    },
    computed: {
      currency,
      expenseNet: toPlainValue(expenseNet),
      finalNet: toPlainValue(net),
      settlement: toPlainValue(settlement),
      recordedPaymentsTotal
    }
  };

  downloadTextFile(
    getJsonBackupFileName(),
    JSON.stringify(backup, null, 2),
    "application/json;charset=utf-8"
  );
}

async function handleExportExcel() {
  try {
    syncStatus.textContent = "Preparing Excel...";
    await ensureSheetJs();
    exportWorkbook();
    syncStatus.textContent = `Synced (${tripId})`;
  } catch (error) {
    console.error(error);
    syncStatus.textContent = "Export error";
    alert("匯出 Excel 失敗，請稍後再試。");
  }
}

async function handleExportJsonBackup() {
  try {
    syncStatus.textContent = "Preparing JSON backup...";
    exportJsonBackup();
    syncStatus.textContent = `Synced (${tripId})`;
  } catch (error) {
    console.error(error);
    syncStatus.textContent = "JSON export error";
    alert("匯出 JSON Backup 失敗，請稍後再試。");
  }
}

async function lockTrip() {
  if (!isAdmin()) return alert("只有 creator 可以鎖定旅程。");
  if (isTripLocked()) return;

  const confirmed = confirm("鎖定後不可再新增、修改、刪除支出，亦不可修改成員及匯率。仍可記錄找數及匯出 Excel。確定鎖定？");
  if (!confirmed) return;

  const displayName = getCurrentUserDisplayName();

  await setDoc(getTripDocRef(), {
    status: "locked",
    lockedAt: serverTimestamp(),
    lockedBy: currentUser.uid,
    lockedByName: displayName
  }, { merge: true });

  await logActivity("trip_locked", `${displayName} 鎖定旅程`, "trip", tripId, {});
}

async function unlockTrip() {
  if (!isAdmin()) return alert("只有 creator 可以解鎖旅程。");
  if (!isTripLocked()) return;

  const confirmed = confirm("解鎖後大家可以再次修改支出及設定。除非真係要改數，否則不建議解鎖。確定解鎖？");
  if (!confirmed) return;

  const displayName = getCurrentUserDisplayName();

  await setDoc(getTripDocRef(), {
    status: "open",
    unlockedAt: serverTimestamp(),
    unlockedBy: currentUser.uid,
    unlockedByName: displayName
  }, { merge: true });

  await logActivity("trip_unlocked", `${displayName} 解鎖旅程`, "trip", tripId, {});
}

function renderActivityLogs() {
  if (!activityLogList) return;

  if (!activityLogs.length) {
    activityLogList.innerHTML = `<p class="neutral">暫時未有活動紀錄。</p>`;
    return;
  }

  activityLogList.innerHTML = activityLogs.slice(0, 80).map(item => `
    <div class="activity-item">
      <div><strong>${safeEscape(item.actorName || formatAuditUid(item.actorUid))}</strong> · ${safeEscape(item.message || item.action || "Activity")}</div>
      <div class="expense-meta">${safeEscape(item.action || "")} · ${safeEscape(item.targetType || "")} · ${formatTimestamp(item.createdAt)}</div>
    </div>
  `).join("");
}

/* admin panel */
function isAdmin() {
  return !!(currentUser && tripCreatorUid && currentUser.uid === tripCreatorUid);
}

function renderAllowedEmails() {
  if (!adminPanel) return;
  if (!isAdmin()) { adminPanel.classList.add("hidden"); return; }
  adminPanel.classList.remove("hidden");

  allowedEmailList.innerHTML = allowedEmailsCache.length
    ? allowedEmailsCache.map(email => `
        <div class="member-chip">
          <span>${safeEscape(email)}</span>
          <button type="button" data-remove-email="${safeEscape(email)}">移除</button>
        </div>`).join("")
    : `<p class="hint" style="margin:0">暫無授權 email</p>`;

  allowedEmailList.querySelectorAll("[data-remove-email]").forEach(btn => {
    btn.addEventListener("click", () => removeAllowedEmail(btn.dataset.removeEmail));
  });
}

async function addAllowedEmail() {
  const email = normalizeEmail(allowedEmailInput.value);
  if (!email || !email.includes("@")) return alert("請輸入有效 email。");
  if (allowedEmailsCache.includes(email)) return alert("此 email 已在名單中。");
  await setDoc(getTripDocRef(), { allowedEmails: [...allowedEmailsCache, email] }, { merge: true });
  allowedEmailInput.value = "";
}

async function removeAllowedEmail(email) {
  if (!confirm(`移除 ${email}？`)) return;
  await setDoc(getTripDocRef(), { allowedEmails: allowedEmailsCache.filter(e => e !== email) }, { merge: true });
}

/* OCR local free */
async function ensureTesseract() {
  if (window.Tesseract) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = resolve; script.onerror = reject;
    document.body.appendChild(script);
  });
}

async function preprocessReceiptImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onerror = reject;
    img.onload = () => {
      URL.revokeObjectURL(url);

      const longer = Math.max(img.width, img.height);
      const scale = longer < 1800 ? 1800 / longer : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);

      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;

      for (let i = 0; i < d.length; i += 4) {
        const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        d[i] = d[i + 1] = d[i + 2] = gray;
      }

      const pixels = [];
      for (let i = 0; i < d.length; i += 4) pixels.push(d[i]);
      pixels.sort((a, b) => a - b);
      const lo = pixels[Math.floor(pixels.length * 0.05)];
      const hi = pixels[Math.floor(pixels.length * 0.95)];
      const range = hi - lo || 1;

      for (let i = 0; i < d.length; i += 4) {
        const v = Math.round(Math.min(255, Math.max(0, (d[i] - lo) / range * 255)));
        d[i] = d[i + 1] = d[i + 2] = v;
      }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob(blob => resolve(blob), "image/png");
    };
    img.src = url;
  });
}
function normalizeOCRText(raw) { return String(raw || "").replace(/[|]/g, "1").replace(/[Ｏ]/g, "0").replace(/[，]/g, ",").replace(/[：]/g, ":").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim(); }
function splitLines(text) { return text.split("\n").map(l => l.trim()).filter(Boolean); }
function parseMoneyFromLine(line) {
  const cleaned = line.replace(/([A-Z]{3}|HK\$|NT\$|US\$|RMB|JPY|KRW|TWD|CNY|USD|HKD)/gi, " ");
  const matches = [...cleaned.matchAll(/(?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:[.,]\d{2})?/g)];
  const nums = matches.map(m => m[0].replace(/\s/g, "")).map(token => {
    if (token.includes(",") && token.includes(".")) {
      const lastComma = token.lastIndexOf(","), lastDot = token.lastIndexOf(".");
      const decimalSep = lastComma > lastDot ? "," : ".";
      token = decimalSep === "," ? token.replace(/\./g, "").replace(",", ".") : token.replace(/,/g, "");
    } else if (token.includes(",") && !token.includes(".")) {
      const parts = token.split(",");
      token = (parts.length === 2 && parts[1].length === 2) ? `${parts[0]}.${parts[1]}` : token.replace(/,/g, "");
    }
    return Number(token);
  }).filter(n => Number.isFinite(n) && n > 0);
  return nums.length ? Math.max(...nums) : null;
}
function detectCurrencyFromContext(text, fallback = "HKD") {
  const t = text.toUpperCase();
  if (/\bHKD\b|HK\$/.test(t)) return "HKD";
  if (/\bUSD\b|US\$/.test(t)) return "USD";
  if (/\bTWD\b|NT\$/.test(t)) return "TWD";
  if (/\bCNY\b|\bRMB\b/.test(t)) return "CNY";
  if (/\bJPY\b/.test(t)) return "JPY";
  if (/\bKRW\b/.test(t)) return "KRW";
  if (t.includes("₩")) return "KRW";
  if (t.includes("¥")) return /JAPAN|TOKYO|OSAKA/.test(t) ? "JPY" : fallback;
  if (t.includes("$")) return t.includes("HK") ? "HKD" : t.includes("US") ? "USD" : t.includes("NT") ? "TWD" : fallback;
  return fallback;
}
function extractDateAdvanced(lines) {
  const joined = lines.join(" ");
  const patterns = [
    /\b(20\d{2})[\/\-.](0?\d|1[0-2])[\/\-.](0?\d|[12]\d|3[01])\b/g,
    /\b(0?\d|[12]\d|3[01])[\/\-.](0?\d|1[0-2])[\/\-.](20\d{2})\b/g
  ];
  const candidates = [];
  for (const p of patterns) {
    let m; while ((m = p.exec(joined)) !== null) {
      let y, mo, d;
      if (m[1].startsWith("20")) { y = m[1]; mo = m[2]; d = m[3]; }
      else { d = m[1]; mo = m[2]; y = m[3]; }
      const ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dt = new Date(`${ymd}T00:00:00Z`);
      if (!Number.isNaN(dt.getTime())) candidates.push(ymd);
    }
  }
  return candidates[0] || "";
}
function scoreAmountLine(line) {
  const u = line.toUpperCase();
  let score = 0;
  if (/TOTAL|GRAND TOTAL|AMOUNT DUE|應付|合計|總計/.test(u)) score += 80;
  if (/SUBTOTAL|小計/.test(u)) score += 30;
  if (/TAX|VAT|GST|SERVICE|折扣|DISCOUNT|CHANGE|找續/.test(u)) score -= 35;
  const amount = parseMoneyFromLine(line);
  if (amount !== null) score += 20; else score -= 40;
  return { score, amount };
}
function extractTotalAmountAdvanced(lines) {
  const candidates = lines.map((line, idx) => ({ line, idx, ...scoreAmountLine(line) })).filter(c => c.amount !== null);
  if (!candidates.length) return { amount: null, line: "" };
  candidates.sort((a, b) => b.score - a.score || b.idx - a.idx);
  return { amount: candidates[0].amount, line: candidates[0].line };
}
function extractTitleAdvanced(lines) {
  const blacklist = /TEL|INVOICE|RECEIPT|DATE|TIME|THANK|WELCOME|WWW|HTTP|@/i;
  const c = lines.slice(0, 8).filter(l => l.length >= 3 && l.length <= 48 && !blacklist.test(l) && parseMoneyFromLine(l) === null);
  return c[0] || lines[0] || "Receipt";
}
function parseReceiptTextAdvanced(rawText, currentCurrency) {
  const normalized = normalizeOCRText(rawText);
  const lines = splitLines(normalized);
  const date = extractDateAdvanced(lines);
  const currency = detectCurrencyFromContext(normalized, currentCurrency);
  const { amount, line } = extractTotalAmountAdvanced(lines);
  const merchant = extractTitleAdvanced(lines);

  let confidence = 0.45;
  if (amount !== null) confidence += 0.2;
  if (date) confidence += 0.15;
  if (currency) confidence += 0.1;
  if (line && /TOTAL|合計|總計|應付|AMOUNT DUE/i.test(line)) confidence += 0.1;

  return {
    merchant,
    date,
    currency,
    total: amount,
    confidence: Math.min(0.95, round2(confidence)),
    reason: `rule-based OCR; amountLine="${line || "n/a"}"`
  };
}

function openAiPreviewModal(result) {
  aiMerchantInput.value = result.merchant || "";
  aiDateInput.value = result.date || "";
  aiCurrencyInput.value = result.currency || (currencyInput.value || "HKD");
  aiTotalInput.value = Number.isFinite(Number(result.total)) ? String(result.total) : "";
  aiConfidenceInput.value = typeof result.confidence === "number" ? `${Math.round(result.confidence * 100)}%` : "n/a";
  aiReasonInput.value = result.reason || "";
  ocrPreviewModal.classList.remove("hidden");
}
function closeAiPreviewModal() { ocrPreviewModal.classList.add("hidden"); }
function applyAiResultToForm() {
  if (aiMerchantInput.value.trim() && !titleInput.value.trim()) titleInput.value = aiMerchantInput.value.trim();
  if (aiDateInput.value) dateInput.value = aiDateInput.value;
  if (aiCurrencyInput.value) currencyInput.value = aiCurrencyInput.value;
  if (aiTotalInput.value) amountInput.value = aiTotalInput.value;
  noteInput.value = [noteInput.value.trim(), `OCR:merchant=${aiMerchantInput.value || "n/a"},confidence=${aiConfidenceInput.value || "n/a"}`].filter(Boolean).join(" | ");
  closeAiPreviewModal();
}
async function runReceiptOCR() {
  if (!assertTripOpen()) return;
  const file = ocrFileInput.files?.[0];
  if (!file) return alert("請先選擇收據圖片。");
  try {
    syncStatus.textContent = "預處理圖片...";
    await ensureTesseract();
    const processed = await preprocessReceiptImage(file);
    syncStatus.textContent = "OCR 辨識中...";
    const { data } = await window.Tesseract.recognize(processed, "eng+chi_tra", {
      tessedit_ocr_engine_mode: "1",
      tessedit_pageseg_mode: "6",
    });
    const parsed = parseReceiptTextAdvanced(data?.text || "", currencyInput.value || "HKD");
    openAiPreviewModal(parsed);
    syncStatus.textContent = `OCR ready (${tripId})`;
  } catch (e) {
    console.error(e);
    syncStatus.textContent = "OCR error";
    alert("OCR 失敗，請試另一張清晰圖片。");
  }
}

/* boot */
setToday();
form.addEventListener("submit", saveExpense);
cancelEditBtn.addEventListener("click", resetExpenseForm);
addMemberBtn.addEventListener("click", addMember);
if (saveRatesBtn) saveRatesBtn.addEventListener("click", saveTripSettings);
if (baseCurrencyInput) baseCurrencyInput.addEventListener("change", () => { tripSettings.baseCurrency = baseCurrencyInput.value; renderRateEditor(); });

if (ocrBtn) ocrBtn.addEventListener("click", runReceiptOCR);
if (confirmAiFillBtn) confirmAiFillBtn.addEventListener("click", applyAiResultToForm);
if (cancelAiFillBtn) cancelAiFillBtn.addEventListener("click", closeAiPreviewModal);

googleSignInBtn.addEventListener("click", handleGoogleSignIn);
signOutBtn.addEventListener("click", handleSignOut);
if (addAllowedEmailBtn) addAllowedEmailBtn.addEventListener("click", addAllowedEmail);
if (exportExcelBtn) exportExcelBtn.addEventListener("click", handleExportExcel);
if (exportExcelReportBtn) exportExcelReportBtn.addEventListener("click", handleExportExcel);
if (exportJsonBtn) exportJsonBtn.addEventListener("click", handleExportJsonBackup);
if (exportJsonBackupBtn) exportJsonBackupBtn.addEventListener("click", handleExportJsonBackup);
if (lockTripBtn) lockTripBtn.addEventListener("click", lockTrip);
if (unlockTripBtn) unlockTripBtn.addEventListener("click", unlockTrip);

getRedirectResult(auth).catch((error) => {
  console.error("Google redirect login error:", error?.code, error?.message, error);
  alert(`Google redirect 失敗：${error?.code || "unknown"}`);
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  setAuthUI(user);

  if (!user) {
    syncStatus.textContent = "Please sign in";
    if (stopTripListener) stopTripListener();
    if (stopExpensesListener) stopExpensesListener();
    if (stopSettlementsListener) stopSettlementsListener();
    if (stopActivityLogsListener) stopActivityLogsListener();
    allExpenses = [];
    expenses = [];
    settlements = [];
    activityLogs = [];
    tripStatus = "open";
    tripLockedAt = null;
    tripLockedBy = null;
    tripLockedByName = "";
    tripCreatorUid = null;
    allowedEmailsCache = [];
    renderExpenses();
    renderDeletedExpenses();
    renderAllowedEmails();
    renderActivityLogs();
    updateTripStatusUi();
    summary.innerHTML = "";
    return;
  }

  syncStatus.textContent = "Connected";
  try {
    await ensureTripMembersAndSettings();
    initMembers();
    renderRateEditor();
    renderAllowedEmails();
    startTripListener();
    listenToExpenses();
    listenToSettlements();
    listenToActivityLogs();
  } catch (error) {
    console.error(error);
    if (error?.code === "permission-denied") {
      syncStatus.textContent = "No access";
      alert("你無權限進入此 trip。請管理員把你 email 加入 allowedEmails。");
    } else {
      syncStatus.textContent = "Init error";
      alert(`初始化失敗：${error?.code || error?.message || "unknown"}`);
    }
  }
});
