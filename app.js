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

let currentUser = null;
let expenses = [];
let editingExpenseId = null;
let stopTripListener = null;

function renderMemberManager() {
  memberList.innerHTML = members
    .map(member => `
      <div class="member-chip">
        <span>${member}</span>
        <button type="button" data-remove-member="${member}">移除</button>
      </div>
    `)
    .join("");

  memberList.querySelectorAll("[data-remove-member]").forEach(button => {
    button.addEventListener("click", () => removeMember(button.dataset.removeMember));
  });
}

function initMembers() {
  paidByInput.innerHTML = members
    .map(member => `<option value="${member}">${member}</option>`)
    .join("");

  sharedByGroup.innerHTML = members
    .map(member => `
      <label class="checkbox-item">
        <input type="checkbox" value="${member}" checked />
        ${member}
      </label>
    `)
    .join("");

  renderMemberManager();
}

function setToday() {
  const today = new Date().toISOString().slice(0, 10);
  dateInput.value = today;
}

function getSelectedParticipants() {
  return Array.from(sharedByGroup.querySelectorAll("input:checked"))
    .map(input => input.value);
}

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
  amountInput.value = expense.amount || "";
  currencyInput.value = expense.currency || "HKD";
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

function getTripDocRef() { return doc(db, "trips", tripId); }
function getExpensesCollection() { return collection(db, "trips", tripId, "expenses"); }


function startTripListener() {
  if (stopTripListener) stopTripListener();

  stopTripListener = onSnapshot(getTripDocRef(), snapshot => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    if (!Array.isArray(data.members) || data.members.length === 0) return;

    const changed = JSON.stringify(data.members) !== JSON.stringify(members);
    if (!changed) return;

    const previousPayer = paidByInput.value;
    members = data.members;
    initMembers();

    if (members.includes(previousPayer)) {
      paidByInput.value = previousPayer;
    }
  }, error => {
    console.error(error);
  });
}

async function ensureTripMembers() {
  const tripDoc = await getDoc(getTripDocRef());
  if (!tripDoc.exists()) {
    members = ["Marco", "A", "B", "C"];
    await setDoc(getTripDocRef(), {
      members,
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
}

async function addMember() {
  const name = memberNameInput.value.trim();
  if (!name) return alert("請輸入成員名稱。");

  const exists = members.some(member => member.toLowerCase() === name.toLowerCase());
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

async function saveExpense(event) {
  event.preventDefault();
  const participants = getSelectedParticipants();
  if (participants.length === 0) return alert("請至少選擇一位參與人。");

  const amount = Number(amountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) return alert("請輸入有效金額。");

  const payload = {
    date: dateInput.value,
    title: titleInput.value.trim(),
    amount,
    currency: currencyInput.value,
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

function renderExpenses() {
  if (expenses.length === 0) return expenseList.innerHTML = `<p class="neutral">暫時未有支出。</p>`;

  expenseList.innerHTML = expenses.map(expense => `
      <div class="expense-item">
        <div class="expense-title">${expense.title} · ${expense.currency} ${Number(expense.amount).toFixed(2)}</div>
        <div class="expense-meta">${expense.date} · Paid by ${expense.paidBy} · Shared by ${expense.sharedBy.join(", ")}</div>
        <div class="expense-meta">${expense.category}${expense.note ? ` · ${expense.note}` : ""}</div>
        <button class="edit-btn" data-edit-id="${expense.id}">Edit</button>
        <button class="delete-btn" data-delete-id="${expense.id}">Delete</button>
      </div>
    `).join("");

  expenseList.querySelectorAll("[data-edit-id]").forEach(button => button.addEventListener("click", () => enterEditMode(button.dataset.editId)));
  expenseList.querySelectorAll("[data-delete-id]").forEach(button => button.addEventListener("click", () => removeExpense(button.dataset.deleteId)));
}

function buildSettlement(net) {
  const debtors = [];
  const creditors = [];
  Object.entries(net).forEach(([person, amount]) => {
    const rounded = Math.round(amount * 100) / 100;
    if (rounded < 0) debtors.push({ person, amount: Math.abs(rounded) });
    if (rounded > 0) creditors.push({ person, amount: rounded });
  });
  const settlement = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const payAmount = Math.min(debtors[i].amount, creditors[j].amount);
    const roundedPayAmount = Math.round(payAmount * 100) / 100;
    if (roundedPayAmount > 0) settlement.push({ from: debtors[i].person, to: creditors[j].person, amount: roundedPayAmount });
    debtors[i].amount = Math.round((debtors[i].amount - payAmount) * 100) / 100;
    creditors[j].amount = Math.round((creditors[j].amount - payAmount) * 100) / 100;
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }
  return settlement;
}

function calculateSummary() {
  const currency = currencyInput.value;
  const net = {};
  members.forEach(member => { net[member] = 0; });

  expenses.forEach(expense => {
    if (!Object.prototype.hasOwnProperty.call(net, expense.paidBy)) net[expense.paidBy] = 0;
    net[expense.paidBy] += Number(expense.amount);
    const shareAmount = Number(expense.amount) / expense.sharedBy.length;
    expense.sharedBy.forEach(member => {
      if (!Object.prototype.hasOwnProperty.call(net, member)) net[member] = 0;
      net[member] -= shareAmount;
    });
  });

  return { net, settlement: buildSettlement(net), currency };
}

function renderSummary() {
  const { net, settlement, currency } = calculateSummary();
  const netHtml = Object.entries(net).map(([person, amount]) => {
    const rounded = Math.round(amount * 100) / 100;
    const className = rounded > 0 ? "positive" : rounded < 0 ? "negative" : "neutral";
    const label = rounded > 0 ? "應收" : rounded < 0 ? "應付" : "已平數";
    return `<div class="summary-item"><strong>${person}</strong><span class="${className}">${label} ${currency} ${Math.abs(rounded).toFixed(2)}</span></div>`;
  }).join("");

  const settlementHtml = settlement.length
    ? settlement.map(item => `<div class="settlement-item"><strong>${item.from}</strong> pays <strong>${item.to}</strong><span class="negative">${currency} ${item.amount.toFixed(2)}</span></div>`).join("")
    : `<p class="neutral">暫時無需結算。</p>`;

  summary.innerHTML = `<h3>每人淨額</h3>${netHtml}<h3>建議結算</h3>${settlementHtml}`;
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

setToday();
form.addEventListener("submit", saveExpense);
cancelEditBtn.addEventListener("click", resetExpenseForm);
addMemberBtn.addEventListener("click", addMember);

signInAnonymously(auth).catch(error => {
  console.error(error);
  syncStatus.textContent = "Auth error";
});

onAuthStateChanged(auth, async user => {
  if (!user) return;
  currentUser = user;
  syncStatus.textContent = "Connected";
  await ensureTripMembers();
  initMembers();
  startTripListener();
  listenToExpenses();
});
