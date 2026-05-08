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

let currentUser = null;
let expenses = [];
let editingExpenseId = null;
let stopTripListener = null;
let stopExpensesListener = null;
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
const uniqueStrings = (arr) => [...new Set((arr || []).filter(Boolean).map(v => String(v)))];
const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

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
  renderRateEditor(); renderSummary(); renderExpenses();
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
      createdBy: currentUser.uid
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

  if (!uidAllowed && (emailAllowed || isCreator)) {
    const nextUids = uniqueStrings([...tripAllowedUids, currentUser.uid]);
    await setDoc(tripRef, { allowedUids: nextUids }, { merge: true });
    tripAllowedUids = nextUids;
  }

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
    }

    if (data.settings) {
      tripSettings = {
        ...tripSettings,
        ...data.settings,
        exchangeRates: { ...tripSettings.exchangeRates, ...(data.settings.exchangeRates || {}) }
      };
      renderRateEditor(); renderSummary(); renderExpenses();
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
    expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderExpenses(); renderSummary();
    syncStatus.textContent = `Synced (${tripId})`;
  }, err => {
    console.error(err);
    syncStatus.textContent = err?.code === "permission-denied" ? "No access to expenses" : "Sync error";
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

  const participants = getSelectedParticipants();
  if (participants.length === 0) return alert("請至少選擇一位參與人。");

  const originalAmount = Number(amountInput.value);
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) return alert("請輸入有效金額。");

  const originalCurrency = currencyInput.value;
  const convertedAmount = convertToBase(originalAmount, originalCurrency);
  if (convertedAmount === null) return alert(`未有 ${originalCurrency} 匯率。`);

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
    updatedAt: serverTimestamp()
  };

  if (!payload.title) return alert("請輸入項目名稱。");

  if (editingExpenseId) {
    await updateDoc(doc(db, "trips", tripId, "expenses", editingExpenseId), payload);
  } else {
    await addDoc(getExpensesCollection(), {
      ...payload,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });
  }

  resetExpenseForm();
}

async function removeExpense(expenseId) {
  if (!confirm("確定刪除？")) return;
  if (editingExpenseId === expenseId) resetExpenseForm();
  await deleteDoc(doc(db, "trips", tripId, "expenses", expenseId));
}

async function addMember() {
  const name = memberNameInput.value.trim();
  if (!name) return alert("請輸入成員名稱。");
  if (members.some(m => m.toLowerCase() === name.toLowerCase())) return alert("成員名稱已存在。");
  const next = [...members, name];
  await setDoc(getTripDocRef(), { members: next }, { merge: true });
  members = next; initMembers(); memberNameInput.value = "";
}

async function removeMember(name) {
  if (members.length <= 1) return alert("至少要保留一位成員。");
  const used = expenses.some(e => e.paidBy === name || (Array.isArray(e.sharedBy) && e.sharedBy.includes(name)));
  if (used) return alert("此成員已出現在歷史支出，不能移除。");
  const next = members.filter(m => m !== name);
  await setDoc(getTripDocRef(), { members: next }, { merge: true });
  members = next; initMembers();
}

function renderExpenses() {
  if (!expenses.length) return expenseList.innerHTML = `<p class="neutral">暫時未有支出。</p>`;
  const base = tripSettings.baseCurrency;

  expenseList.innerHTML = expenses.map(expense => {
    const oAmt = Number(expense.originalAmount ?? expense.amount ?? 0);
    const oCur = expense.originalCurrency ?? expense.currency ?? base;
    const cAmt = Number(expense.convertedAmount ?? convertToBase(oAmt, oCur) ?? 0);
    const shareText = Array.isArray(expense.sharedBy) ? expense.sharedBy.map(safeEscape).join(", ") : "-";
    return `
      <div class="expense-item">
        <div class="expense-title">${safeEscape(expense.title)} · ${safeEscape(oCur)} ${oAmt.toFixed(2)}</div>
        <div class="expense-meta">換算：${safeEscape(base)} ${cAmt.toFixed(2)}</div>
        <div class="expense-meta">${safeEscape(expense.date)} · Paid by ${safeEscape(expense.paidBy)} · Shared by ${shareText}</div>
        <div class="expense-meta">${safeEscape(expense.category)}${expense.note ? ` · ${safeEscape(expense.note)}` : ""}</div>
        <button class="edit-btn" data-edit-id="${safeEscape(expense.id)}">Edit</button>
        <button class="delete-btn" data-delete-id="${safeEscape(expense.id)}">Delete</button>
      </div>
    `;
  }).join("");

  expenseList.querySelectorAll("[data-edit-id]").forEach(btn => btn.addEventListener("click", () => enterEditMode(btn.dataset.editId)));
  expenseList.querySelectorAll("[data-delete-id]").forEach(btn => btn.addEventListener("click", () => removeExpense(btn.dataset.deleteId)));
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

function calculateSummary() {
  const base = tripSettings.baseCurrency;
  const net = {};
  members.forEach(m => { net[m] = 0; });

  expenses.forEach(expense => {
    if (!Array.isArray(expense.sharedBy) || !expense.sharedBy.length) return;
    const converted = Number(expense.convertedAmount ?? convertToBase(expense.originalAmount ?? expense.amount ?? 0, expense.originalCurrency ?? expense.currency ?? base) ?? 0);
    if (!Object.prototype.hasOwnProperty.call(net, expense.paidBy)) net[expense.paidBy] = 0;
    net[expense.paidBy] += converted;
    const share = converted / expense.sharedBy.length;
    expense.sharedBy.forEach(m => {
      if (!Object.prototype.hasOwnProperty.call(net, m)) net[m] = 0;
      net[m] -= share;
    });
  });

  return { net, settlement: buildSettlement(net), currency: base };
}

function renderSummary() {
  const { net, settlement, currency } = calculateSummary();
  const netHtml = Object.entries(net).map(([person, amount]) => {
    const r = round2(amount);
    const cls = r > 0 ? "positive" : r < 0 ? "negative" : "neutral";
    const label = r > 0 ? "應收" : r < 0 ? "應付" : "已平數";
    return `<div class="summary-item"><strong>${safeEscape(person)}</strong><span class="${cls}">${label} ${currency} ${Math.abs(r).toFixed(2)}</span></div>`;
  }).join("");

  const settlementHtml = settlement.length
    ? settlement.map(s => `<div class="settlement-item"><strong>${safeEscape(s.from)}</strong> pays <strong>${safeEscape(s.to)}</strong><span class="negative">${currency} ${s.amount.toFixed(2)}</span></div>`).join("")
    : `<p class="neutral">暫時無需結算。</p>`;

  summary.innerHTML = `<h3>每人淨額（${currency}）</h3>${netHtml}<h3>建議結算</h3>${settlementHtml}`;
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
    expenses = [];
    tripCreatorUid = null;
    allowedEmailsCache = [];
    renderExpenses();
    renderAllowedEmails();
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
