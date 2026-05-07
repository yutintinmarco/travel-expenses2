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
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/11.8.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const tripId = "demo-trip-001";

const members = ["Marco", "A", "B", "C"];

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

let currentUser = null;
let expenses = [];

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
}

function setToday() {
  const today = new Date().toISOString().slice(0, 10);
  dateInput.value = today;
}

function getSelectedParticipants() {
  return Array.from(sharedByGroup.querySelectorAll("input:checked"))
    .map(input => input.value);
}

function getExpensesCollection() {
  return collection(db, "trips", tripId, "expenses");
}

async function addExpense(event) {
  event.preventDefault();

  const participants = getSelectedParticipants();

  if (participants.length === 0) {
    alert("請至少選擇一位參與人。");
    return;
  }

  const amount = Number(amountInput.value);

  if (!Number.isFinite(amount) || amount <= 0) {
    alert("請輸入有效金額。");
    return;
  }

  await addDoc(getExpensesCollection(), {
    date: dateInput.value,
    title: titleInput.value.trim(),
    amount,
    currency: currencyInput.value,
    paidBy: paidByInput.value,
    sharedBy: participants,
    category: categoryInput.value,
    note: noteInput.value.trim(),
    createdBy: currentUser ? currentUser.uid : null,
    createdAt: serverTimestamp()
  });

  form.reset();
  setToday();

  Array.from(sharedByGroup.querySelectorAll("input")).forEach(input => {
    input.checked = true;
  });
}

async function removeExpense(expenseId) {
  const confirmed = confirm("確定刪除呢筆支出？");

  if (!confirmed) return;

  await deleteDoc(doc(db, "trips", tripId, "expenses", expenseId));
}

function renderExpenses() {
  if (expenses.length === 0) {
    expenseList.innerHTML = `<p class="neutral">暫時未有支出。</p>`;
    return;
  }

  expenseList.innerHTML = expenses
    .map(expense => `
      <div class="expense-item">
        <div class="expense-title">
          ${expense.title} · ${expense.currency} ${expense.amount.toFixed(2)}
        </div>
        <div class="expense-meta">
          ${expense.date} · Paid by ${expense.paidBy} · Shared by ${expense.sharedBy.join(", ")}
        </div>
        <div class="expense-meta">
          ${expense.category}${expense.note ? ` · ${expense.note}` : ""}
        </div>
        <button class="delete-btn" data-delete-id="${expense.id}">Delete</button>
      </div>
    `)
    .join("");

  expenseList.querySelectorAll("[data-delete-id]").forEach(button => {
    button.addEventListener("click", () => removeExpense(button.dataset.deleteId));
  });
}

function calculateSummary() {
  const currency = currencyInput.value;
  const net = {};

  members.forEach(member => {
    net[member] = 0;
  });

  expenses.forEach(expense => {
    if (!net.hasOwnProperty(expense.paidBy)) {
      net[expense.paidBy] = 0;
    }

    net[expense.paidBy] += expense.amount;

    const shareAmount = expense.amount / expense.sharedBy.length;

    expense.sharedBy.forEach(member => {
      if (!net.hasOwnProperty(member)) {
        net[member] = 0;
      }

      net[member] -= shareAmount;
    });
  });

  const settlement = buildSettlement(net);

  return { net, settlement, currency };
}

function buildSettlement(net) {
  const debtors = [];
  const creditors = [];

  Object.entries(net).forEach(([person, amount]) => {
    const rounded = Math.round(amount * 100) / 100;

    if (rounded < 0) {
      debtors.push({ person, amount: Math.abs(rounded) });
    }

    if (rounded > 0) {
      creditors.push({ person, amount: rounded });
    }
  });

  const settlement = [];

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const payAmount = Math.min(debtors[i].amount, creditors[j].amount);
    const roundedPayAmount = Math.round(payAmount * 100) / 100;

    if (roundedPayAmount > 0) {
      settlement.push({
        from: debtors[i].person,
        to: creditors[j].person,
        amount: roundedPayAmount
      });
    }

    debtors[i].amount = Math.round((debtors[i].amount - payAmount) * 100) / 100;
    creditors[j].amount = Math.round((creditors[j].amount - payAmount) * 100) / 100;

    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }

  return settlement;
}

function renderSummary() {
  const { net, settlement, currency } = calculateSummary();

  const netHtml = Object.entries(net)
    .map(([person, amount]) => {
      const rounded = Math.round(amount * 100) / 100;
      const className = rounded > 0 ? "positive" : rounded < 0 ? "negative" : "neutral";
      const label = rounded > 0 ? "應收" : rounded < 0 ? "應付" : "已平數";

      return `
        <div class="summary-item">
          <strong>${person}</strong>
          <span class="${className}">${label} ${currency} ${Math.abs(rounded).toFixed(2)}</span>
        </div>
      `;
    })
    .join("");

  const settlementHtml = settlement.length
    ? settlement
        .map(item => `
          <div class="settlement-item">
            <strong>${item.from}</strong> pays <strong>${item.to}</strong>
            <span class="negative">${currency} ${item.amount.toFixed(2)}</span>
          </div>
        `)
        .join("")
    : `<p class="neutral">暫時無需結算。</p>`;

  summary.innerHTML = `
    <h3>每人淨額</h3>
    ${netHtml}
    <h3>建議結算</h3>
    ${settlementHtml}
  `;
}

function listenToExpenses() {
  const expensesQuery = query(getExpensesCollection(), orderBy("date", "desc"));

  onSnapshot(expensesQuery, snapshot => {
    expenses = snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    renderExpenses();
    renderSummary();
    syncStatus.textContent = "Synced";
  }, error => {
    console.error(error);
    syncStatus.textContent = "Sync error";
  });
}

initMembers();
setToday();

form.addEventListener("submit", addExpense);

signInAnonymously(auth).catch(error => {
  console.error(error);
  syncStatus.textContent = "Auth error";
});

onAuthStateChanged(auth, user => {
  if (!user) return;

  currentUser = user;
  syncStatus.textContent = "Connected";
  listenToExpenses();
});