import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
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

let members = [];
let tripSettings = {
  baseCurrency: "HKD",
  exchangeRates: {
    HKD: 1,
    JPY: 0.055,
    CNY: 1.08,
    TWD: 0.24,
    KRW: 0.0058,
    USD: 7.8
  }
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

let currentUser = null;
let expenses = [];
let editingExpenseId = null;
let stopTripListener = null;

/* ----------------- utils ----------------- */
function safeEscape(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function getTripDocRef() { return doc(db, "trips", tripId); }
function getExpensesCollection() { return collection(db, "trips", tripId, "expenses"); }

function getRateFor(currency) {
  const rate = tripSettings.exchangeRates?.[currency];
  return Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : null;
}

function convertToBase(amount, currency) {
  const rate = getRateFor(currency);
  if (!rate) return null;
  return round2(Number(amount) * rate);
}

function setToday() {
  const today = new Date().toISOString().slice(0, 10);
  dateInput.value = today;
}

function getSelectedParticipants() {
  return Array.from(sharedByGroup.querySelectorAll("input:checked")).map(input => input.value);
}

/* ----------------- members ----------------- */
function renderMemberManager() {
  memberList.innerHTML = members
    .map(member => `
      <div class="member-chip">
        <span>${safeEscape(member)}</span>
        <button type="button" data-remove-member="${safeEscape(member)}">移除</button>
      </div>
    `)
    .join("");

  memberList.querySelectorAll("[data-remove-member]").forEach(button => {
    button.addEventListener("click", () => removeMember(button.dataset.removeMember));
  });
}

function initMembers() {
  paidByInput.innerHTML = members
    .map(member => `<option value="${safeEscape(member)}">${safeEscape(member)}</option>`)
    .join("");

  sharedByGroup.innerHTML = members
    .map(member => `
      <label class="checkbox-item">
        <input type="checkbox" value="${safeEscape(member)}" checked />
        ${safeEscape(member)}
      </label>
    `)
    .join("");

  renderMemberManager();
}

async function addMember() {
  const name = memberNameInput.value.trim();
  if (!name) return alert("請輸入成員名稱。");

  const exists = members.some(m => m.toLowerCase() === name.toLowerCase());
  if (exists) return alert("成員名稱已存在。");

  const nextMembers = [...members, name];
  try {
    await setDoc(getTripDocRef(), { members: nextMembers }, { merge: true });
    members = nextMembers;
    initMembers();
    memberNameInput.value = "";
  } catch (error) {
    console.error(error);
    alert("新增成員失敗，請稍後再試。");
  }
}

async function removeMember(name) {
  if (members.length <= 1) return alert("至少要保留一位成員。");

  const used = expenses.some(expense =>
    expense.paidBy === name || (Array.isArray(expense.sharedBy) && expense.sharedBy.includes(name))
  );
  if (used) return alert("此成員已出現在歷史支出，暫時不能移除。");

  const nextMembers = members.filter(member => member !== name);

  try {
    await setDoc(getTripDocRef(), { members: nextMembers }, { merge: true });
    members = nextMembers;
    initMembers();
  } catch (error) {
    console.error(error);
    alert("移除成員失敗，請稍後再試。");
  }
}

/* ----------------- trip settings ----------------- */
function renderRateEditor() {
  if (!baseCurrencyInput || !ratesContainer) return;

  baseCurrencyInput.value = tripSettings.baseCurrency || "HKD";

  const currencyOptions = Array.from(currencyInput.options).map(o => o.value);
  ratesContainer.innerHTML = currencyOptions.map(code => {
    const value = tripSettings.exchangeRates?.[code] ?? "";
    const disabled = code === tripSettings.baseCurrency ? "disabled" : "";
    const hint = code === tripSettings.baseCurrency ? "(base=1)" : "";
    return `
      <label class="rate-row">
        <span>${code} ${hint}</span>
        <input type="number" step="0.0001" min="0" data-rate-code="${code}" value="${value}" ${disabled}/>
      </label>
    `;
  }).join("");
}

async function saveTripSettings() {
  if (!baseCurrencyInput || !ratesContainer) return;
  const newBase = baseCurrencyInput.value;
  const nextRates = {};

  ratesContainer.querySelectorAll("[data-rate-code]").forEach(input => {
    const code = input.dataset.rateCode;
    const n = Number(input.value);
    if (code === newBase) {
      nextRates[code] = 1;
    } else if (Number.isFinite(n) && n > 0) {
      nextRates[code] = n;
    }
  });

  if (!nextRates[newBase]) nextRates[newBase] = 1;

  tripSettings = {
    ...tripSettings,
    baseCurrency: newBase,
    exchangeRates: nextRates
  };

  await setDoc(getTripDocRef(), { settings: tripSettings }, { merge: true });
  alert("匯率設定已儲存。");
  renderRateEditor();
  renderSummary();
  renderExpenses();
}

async function ensureTripMembersAndSettings() {
  const tripDoc = await getDoc(getTripDocRef());

  if (!tripDoc.exists()) {
    members = ["Marco", "A", "B", "C"];
    await setDoc(getTripDocRef(), {
      members,
      settings: tripSettings,
      createdAt: serverTimestamp(),
      createdBy: currentUser ? currentUser.uid : null
    }, { merge: true });
    return;
  }

  const data = tripDoc.data();

  if (Array.isArray(data.members) && data.members.length > 0) {
    members = data.members;
  } else {
    members = ["Marco"];
    await setDoc(getTripDocRef(), { members }, { merge: true });
  }

  if (data.settings) {
    tripSettings = {
      ...tripSettings,
      ...data.settings,
      exchangeRates: {
        ...tripSettings.exchangeRates,
        ...(data.settings.exchangeRates || {})
      }
    };
  } else {
    await setDoc(getTripDocRef(), { settings: tripSettings }, { merge: true });
  }
}

function startTripListener() {
  if (stopTripListener) stopTripListener();

  stopTripListener = onSnapshot(getTripDocRef(), snapshot => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();

    if (Array.isArray(data.members) && data.members.length > 0) {
      const changed = JSON.stringify(data.members) !== JSON.stringify(members);
      if (changed) {
        const previousPayer = paidByInput.value;
        members = data.members;
        initMembers();
        if (members.includes(previousPayer)) paidByInput.value = previousPayer;
      }
    }

    if (data.settings) {
      tripSettings = {
        ...tripSettings,
        ...data.settings,
        exchangeRates: {
          ...tripSettings.exchangeRates,
          ...(data.settings.exchangeRates || {})
        }
      };
      renderRateEditor();
      renderSummary();
      renderExpenses();
    }
  }, error => console.error(error));
}

/* ----------------- expense CRUD ----------------- */
function resetExpenseForm() {
  form.reset();
  setToday();

  Array.from(sharedByGroup.querySelectorAll("input")).forEach(input => {
    input.checked = true;
  });

  editingExpenseId = null;
  submitBtn.textContent = "新增";
  cancelEditBtn.classList.add("hidden");

  const existingNotice = document.getElementById("editingNotice");
  if (existingNotice) existingNotice.remove();
}

function enterEditMode(expenseId) {
  const expense = expenses.find(item => item.id === expenseId);
  if (!expense) {
    alert("搵唔到呢筆支出，可能已經被刪除。");
    return;
  }

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

  const existingNotice = document.getElementById("editingNotice");
  if (existingNotice) existingNotice.remove();

  const notice = document.createElement("div");
  notice.id = "editingNotice";
  notice.className = "editing-notice";
  notice.textContent = `正在編輯：${expense.title}`;
  form.prepend(notice);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveExpense(event) {
  event.preventDefault();

  const participants = getSelectedParticipants();
  if (participants.length === 0) return alert("請至少選擇一位參與人。");

  const originalAmount = Number(amountInput.value);
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) return alert("請輸入有效金額。");

  const originalCurrency = currencyInput.value;
  const convertedAmount = convertToBase(originalAmount, originalCurrency);
  if (convertedAmount === null) return alert(`未有 ${originalCurrency} 匯率，請先在匯率設定加入。`);

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

    updatedBy: currentUser ? currentUser.uid : null,
    updatedAt: serverTimestamp()
  };

  if (!payload.title) return alert("請輸入項目名稱。");

  if (editingExpenseId) {
    await updateDoc(doc(db, "trips", tripId, "expenses", editingExpenseId), payload);
  } else {
    await addDoc(getExpensesCollection(), {
      ...payload,
      createdBy: currentUser ? currentUser.uid : null,
      createdAt: serverTimestamp()
    });
  }

  resetExpenseForm();
}

async function removeExpense(expenseId) {
  if (!confirm("確定刪除呢筆支出？")) return;
  if (editingExpenseId === expenseId) resetExpenseForm();
  await deleteDoc(doc(db, "trips", tripId, "expenses", expenseId));
}

/* ----------------- render ----------------- */
function renderExpenses() {
  if (expenses.length === 0) {
    expenseList.innerHTML = `<p class="neutral">暫時未有支出。</p>`;
    return;
  }

  const base = tripSettings.baseCurrency;

  expenseList.innerHTML = expenses.map(expense => {
    const oAmt = Number(expense.originalAmount ?? expense.amount ?? 0);
    const oCur = expense.originalCurrency ?? expense.currency ?? base;
    const cAmt = Number(expense.convertedAmount ?? convertToBase(oAmt, oCur) ?? 0);
    const shareText = Array.isArray(expense.sharedBy) ? expense.sharedBy.map(safeEscape).join(", ") : "-";

    return `
      <div class="expense-item">
        <div class="expense-title">${safeEscape(expense.title)} · ${safeEscape(oCur)} ${oAmt.toFixed(2)}</div>
        <div class="expense-meta">換算：${safeEscape(base)} ${cAmt.toFixed(2)}（rate ${expense.fxRateUsed ?? getRateFor(oCur) ?? "n/a"}）</div>
        <div class="expense-meta">${safeEscape(expense.date)} · Paid by ${safeEscape(expense.paidBy)} · Shared by ${shareText}</div>
        <div class="expense-meta">${safeEscape(expense.category)}${expense.note ? ` · ${safeEscape(expense.note)}` : ""}</div>
        <button class="edit-btn" data-edit-id="${safeEscape(expense.id)}">Edit</button>
        <button class="delete-btn" data-delete-id="${safeEscape(expense.id)}">Delete</button>
      </div>
    `;
  }).join("");

  expenseList.querySelectorAll("[data-edit-id]").forEach(button =>
    button.addEventListener("click", () => enterEditMode(button.dataset.editId))
  );
  expenseList.querySelectorAll("[data-delete-id]").forEach(button =>
    button.addEventListener("click", () => removeExpense(button.dataset.deleteId))
  );
}

function buildSettlement(net) {
  const debtors = [];
  const creditors = [];

  Object.entries(net).forEach(([person, amount]) => {
    const rounded = round2(amount);
    if (rounded < 0) debtors.push({ person, amount: Math.abs(rounded) });
    if (rounded > 0) creditors.push({ person, amount: rounded });
  });

  const settlement = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const payAmount = Math.min(debtors[i].amount, creditors[j].amount);
    const roundedPayAmount = round2(payAmount);

    if (roundedPayAmount > 0) {
      settlement.push({
        from: debtors[i].person,
        to: creditors[j].person,
        amount: roundedPayAmount
      });
    }

    debtors[i].amount = round2(debtors[i].amount - payAmount);
    creditors[j].amount = round2(creditors[j].amount - payAmount);

    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }

  return settlement;
}

function calculateSummary() {
  const base = tripSettings.baseCurrency;
  const net = {};
  members.forEach(member => { net[member] = 0; });

  expenses.forEach(expense => {
    if (!Array.isArray(expense.sharedBy) || expense.sharedBy.length === 0) return;

    const convertedAmount = Number(
      expense.convertedAmount ??
      convertToBase(expense.originalAmount ?? expense.amount ?? 0, expense.originalCurrency ?? expense.currency ?? base) ??
      0
    );

    if (!Object.prototype.hasOwnProperty.call(net, expense.paidBy)) net[expense.paidBy] = 0;
    net[expense.paidBy] += convertedAmount;

    const shareAmount = convertedAmount / expense.sharedBy.length;
    expense.sharedBy.forEach(member => {
      if (!Object.prototype.hasOwnProperty.call(net, member)) net[member] = 0;
      net[member] -= shareAmount;
    });
  });

  return { net, settlement: buildSettlement(net), currency: base };
}

function renderSummary() {
  const { net, settlement, currency } = calculateSummary();

  const netHtml = Object.entries(net).map(([person, amount]) => {
    const rounded = round2(amount);
    const className = rounded > 0 ? "positive" : rounded < 0 ? "negative" : "neutral";
    const label = rounded > 0 ? "應收" : rounded < 0 ? "應付" : "已平數";
    return `<div class="summary-item"><strong>${safeEscape(person)}</strong><span class="${className}">${label} ${safeEscape(currency)} ${Math.abs(rounded).toFixed(2)}</span></div>`;
  }).join("");

  const settlementHtml = settlement.length
    ? settlement.map(item => `<div class="settlement-item"><strong>${safeEscape(item.from)}</strong> pays <strong>${safeEscape(item.to)}</strong><span class="negative">${safeEscape(currency)} ${item.amount.toFixed(2)}</span></div>`).join("")
    : `<p class="neutral">暫時無需結算。</p>`;

  summary.innerHTML = `<h3>每人淨額（已換算到 ${safeEscape(currency)}）</h3>${netHtml}<h3>建議結算</h3>${settlementHtml}`;
}

function listenToExpenses() {
  const expensesQuery = query(getExpensesCollection(), orderBy("date", "desc"));
  onSnapshot(expensesQuery, snapshot => {
    expenses = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    renderExpenses();
    renderSummary();
    syncStatus.textContent = `Synced (${tripId})`;
  }, error => {
    console.error(error);
    syncStatus.textContent = "Sync error";
  });
}

/* ----------------- OCR FREE ----------------- */
async function ensureTesseract() {
  if (window.Tesseract) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

function normalizeOCRText(raw) {
  return String(raw || "")
    .replace(/[|]/g, "1")
    .replace(/[Ｏ]/g, "0")
    .replace(/[，]/g, ",")
    .replace(/[：]/g, ":")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function splitLines(text) {
  return text.split("\n").map(line => line.trim()).filter(Boolean);
}

function parseMoneyFromLine(line) {
  const cleaned = line.replace(/([A-Z]{3}|HK\$|NT\$|US\$|RMB|JPY|KRW|TWD|CNY|USD|HKD)/gi, " ");
  const matches = [...cleaned.matchAll(/(?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:[.,]\d{2})?/g)];

  const nums = matches.map(m => m[0].replace(/\s/g, "")).map(token => {
    if (token.includes(",") && token.includes(".")) {
      const lastComma = token.lastIndexOf(",");
      const lastDot = token.lastIndexOf(".");
      const decimalSep = lastComma > lastDot ? "," : ".";
      if (decimalSep === ",") token = token.replace(/\./g, "").replace(",", ".");
      else token = token.replace(/,/g, "");
    } else if (token.includes(",") && !token.includes(".")) {
      const parts = token.split(",");
      if (parts.length === 2 && parts[1].length === 2) token = parts[0] + "." + parts[1];
      else token = token.replace(/,/g, "");
    }
    return Number(token);
  }).filter(n => Number.isFinite(n) && n > 0);

  if (!nums.length) return null;
  return Math.max(...nums);
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
  if (t.includes("¥")) {
    if (/TOKYO|OSAKA|JAPAN|JP\b/.test(t)) return "JPY";
    if (/SHENZHEN|GUANGZHOU|BEIJING|CHINA|CN\b/.test(t)) return "CNY";
    return fallback;
  }
  if (t.includes("$")) {
    if (t.includes("HK")) return "HKD";
    if (t.includes("US")) return "USD";
    if (t.includes("NT")) return "TWD";
    return fallback;
  }

  return fallback;
}

function extractDateAdvanced(lines) {
  const joined = lines.join(" ");
  const patterns = [
    /\b(20\d{2})[\/\-.](0?\d|1[0-2])[\/\-.](0?\d|[12]\d|3[01])\b/g,
    /\b(0?\d|[12]\d|3[01])[\/\-.](0?\d|1[0-2])[\/\-.](20\d{2})\b/g,
    /\b(0?\d|1[0-2])[\/\-.](0?\d|[12]\d|3[01])[\/\-.](20\d{2})\b/g
  ];

  const candidates = [];

  for (const p of patterns) {
    let m;
    while ((m = p.exec(joined)) !== null) {
      let y, mo, d;

      if (m[1].startsWith("20")) {
        y = m[1];
        mo = m[2];
        d = m[3];
      } else if (m[3].startsWith("20")) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        y = m[3];

        if (a > 12 && b <= 12) { d = a; mo = b; }
        else if (b > 12 && a <= 12) { d = b; mo = a; }
        else { d = a; mo = b; }
      }

      const ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dt = new Date(`${ymd}T00:00:00Z`);
      if (!Number.isNaN(dt.getTime()) && Number(y) >= 2010 && Number(y) <= 2100) {
        candidates.push(ymd);
      }
    }
  }

  if (!candidates.length) return null;

  const today = new Date();
  const scored = candidates.map(c => {
    const dt = new Date(`${c}T00:00:00`);
    const diff = Math.abs(today.getTime() - dt.getTime());
    return { c, score: diff };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored[0].c;
}

function scoreAmountLine(line) {
  const upper = line.toUpperCase();
  let score = 0;

  if (/TOTAL|GRAND TOTAL|AMOUNT DUE|BALANCE DUE|PAYABLE|應付|合計|總計|實付|付款金額/.test(upper)) score += 80;
  if (/SUBTOTAL|SUB-TOTAL|小計/.test(upper)) score += 30;
  if (/TAX|VAT|GST|SERVICE|服務費|折扣|DISCOUNT|CHANGE|找續/.test(upper)) score -= 35;
  if (/[A-Z]{3}|HK\$|NT\$|US\$|RMB|JPY|KRW|TWD|CNY|USD|HKD|¥|\$|₩/.test(upper)) score += 10;
  if (/\b\d+(?:[.,]\d{2})\b/.test(upper)) score += 10;

  if (line.length < 4) score -= 10;
  if (line.length > 60) score -= 5;

  const amount = parseMoneyFromLine(line);
  if (amount !== null) {
    if (amount < 0.5) score -= 15;
    if (amount > 1000000) score -= 30;
  } else {
    score -= 40;
  }

  return { score, amount };
}

function extractTotalAmountAdvanced(lines) {
  const candidates = [];

  lines.forEach((line, idx) => {
    const { score, amount } = scoreAmountLine(line);
    if (amount !== null) candidates.push({ line, idx, amount, score });
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.idx - a.idx;
  });

  const first = candidates[0];
  const second = candidates[1];

  if (
    second &&
    /TAX|GST|VAT|SERVICE|DISCOUNT|CHANGE|找續|折扣/.test(first.line.toUpperCase()) &&
    second.score >= first.score - 8
  ) {
    return second.amount;
  }

  return first.amount;
}

function extractTitleAdvanced(lines) {
  const blacklist = /TEL|電話|FAX|NO\.|INVOICE|RECEIPT|日期|DATE|TIME|CASHIER|TABLE|ORDER|THANK|WELCOME|WWW|HTTP|@/i;

  const candidates = lines
    .slice(0, 8)
    .map(line => line.trim())
    .filter(line => line.length >= 3 && line.length <= 48)
    .filter(line => !blacklist.test(line))
    .filter(line => parseMoneyFromLine(line) === null);

  if (candidates.length) return candidates[0];
  return lines[0]?.slice(0, 60) || "Receipt";
}

function parseReceiptTextAdvanced(rawText, currentCurrency) {
  const normalized = normalizeOCRText(rawText);
  const lines = splitLines(normalized);

  const date = extractDateAdvanced(lines);
  const currency = detectCurrencyFromContext(normalized, currentCurrency);
  const amount = extractTotalAmountAdvanced(lines);

  const amountCandidates = lines.map((line, idx) => {
    const { score, amount: a } = scoreAmountLine(line);
    return { line, idx, score, amount: a };
  }).filter(x => x.amount !== null);

  let amountLine = "";
  if (amount !== null && amountCandidates.length) {
    const best = amountCandidates
      .filter(x => x.amount === amount)
      .sort((a, b) => b.score - a.score || b.idx - a.idx)[0];
    amountLine = best?.line || "";
  }

  const merchant = extractTitleAdvanced(lines);

  // 純規則信心估算（0~1）
  let confidence = 0.45;
  if (amount !== null) confidence += 0.2;
  if (date) confidence += 0.15;
  if (currency) confidence += 0.1;
  if (amountLine && /TOTAL|合計|總計|應付|AMOUNT DUE/i.test(amountLine)) confidence += 0.1;
  confidence = Math.min(0.95, round2(confidence));

  const reason = `rule-based OCR parse; amountLine="${amountLine || "n/a"}"`;

  return {
    merchant,
    date: date || "",
    currency: currency || (currentCurrency || "HKD"),
    total: amount,
    confidence,
    reason,
    topLines: lines
  };
}

/* ----------------- OCR modal ----------------- */
function openAiPreviewModal(result) {
  if (!ocrPreviewModal) return;

  if (aiMerchantInput) aiMerchantInput.value = result.merchant || "";
  if (aiDateInput) aiDateInput.value = result.date || "";
  if (aiCurrencyInput) aiCurrencyInput.value = result.currency || (currencyInput?.value || "HKD");
  if (aiTotalInput) aiTotalInput.value = Number.isFinite(Number(result.total)) ? String(result.total) : "";
  if (aiConfidenceInput) {
    aiConfidenceInput.value = typeof result.confidence === "number"
      ? `${Math.round(result.confidence * 100)}%`
      : (result.confidence || "n/a");
  }
  if (aiReasonInput) aiReasonInput.value = result.reason || "";

  ocrPreviewModal.classList.remove("hidden");
}

function closeAiPreviewModal() {
  if (!ocrPreviewModal) return;
  ocrPreviewModal.classList.add("hidden");
}

function applyAiResultToForm() {
  if (aiMerchantInput?.value?.trim() && !titleInput.value.trim()) {
    titleInput.value = aiMerchantInput.value.trim();
  }
  if (aiDateInput?.value) dateInput.value = aiDateInput.value;
  if (aiCurrencyInput?.value) currencyInput.value = aiCurrencyInput.value;
  if (aiTotalInput?.value) amountInput.value = aiTotalInput.value;

  const aiTag = `OCR:merchant=${aiMerchantInput?.value || "n/a"},confidence=${aiConfidenceInput?.value || "n/a"}`;
  noteInput.value = [noteInput.value.trim(), aiTag].filter(Boolean).join(" | ");

  closeAiPreviewModal();
}

async function runReceiptOCR() {
  if (!ocrFileInput) return alert("未找到 OCR 檔案輸入欄位。");
  const file = ocrFileInput.files?.[0];
  if (!file) return alert("請先選擇收據圖片。");

  try {
    syncStatus.textContent = "OCR scanning...";
    await ensureTesseract();

    const { data } = await window.Tesseract.recognize(file, "eng+chi_tra");
    const rawText = data?.text || "";

    const parsed = parseReceiptTextAdvanced(rawText, currencyInput.value || "HKD");
    openAiPreviewModal(parsed);

    syncStatus.textContent = `OCR ready (${tripId})`;
  } catch (error) {
    console.error(error);
    syncStatus.textContent = "OCR error";
    alert("OCR 失敗，請試另一張較清晰圖片。");
  }
}

/* ----------------- boot ----------------- */
setToday();
form.addEventListener("submit", saveExpense);
cancelEditBtn.addEventListener("click", resetExpenseForm);
addMemberBtn.addEventListener("click", addMember);

if (saveRatesBtn) saveRatesBtn.addEventListener("click", saveTripSettings);
if (baseCurrencyInput) {
  baseCurrencyInput.addEventListener("change", () => {
    tripSettings.baseCurrency = baseCurrencyInput.value;
    renderRateEditor();
  });
}

if (ocrBtn) ocrBtn.addEventListener("click", runReceiptOCR);
if (confirmAiFillBtn) confirmAiFillBtn.addEventListener("click", applyAiResultToForm);
if (cancelAiFillBtn) cancelAiFillBtn.addEventListener("click", closeAiPreviewModal);

signInAnonymously(auth).catch(error => {
  console.error(error);
  syncStatus.textContent = "Auth error";
});

onAuthStateChanged(auth, async user => {
  if (!user) return;
  currentUser = user;
  syncStatus.textContent = "Connected";
  await ensureTripMembersAndSettings();
  initMembers();
  renderRateEditor();
  startTripListener();
  listenToExpenses();
});
