"use strict";

const STORAGE_KEY = "medicine-tracker:v1";
const REVIEW_KEY = "medicine-tracker:review:v1";
const SOON_THRESHOLD_DAYS = 30;

let medicines = [];
let reviewSettings = { intervalDays: 30, lastReviewedAt: new Date().toISOString() };
let selectedMedicineIds = new Set();
let calendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let editingMedicineId = null;
let installPrompt = null;

const $ = (id) => document.getElementById(id);
const els = {
  summary: $("summary"),
  body: $("medicine-body"),
  table: $("medicine-table"),
  toolbar: document.querySelector(".toolbar"),
  search: $("search"),
  filter: $("filter"),
  sort: $("sort"),
  groupBy: $("group-by"),
  empty: $("empty-state"),
  emptyTitle: $("empty-title"),
  emptyHint: $("empty-hint"),
  emptyAdd: $("empty-add"),
  soonSection: $("soon-section"),
  soonList: $("soon-list"),
  notice: $("reminder-notice"),
  noticeText: $("reminder-text"),
  dialog: $("add-dialog"),
  form: $("add-form"),
  notifySetting: $("notify-setting"),
  notifyText: $("notify-text"),
  enableNotify: $("enable-notify"),
  calendarGrid: $("calendar-grid"),
  calendarMonth: $("calendar-month"),
  calendarEmpty: $("calendar-empty"),
  bulkActions: $("bulk-actions"),
  lowStockSection: $("low-stock-section"),
  lowStockList: $("low-stock-list"),
  reviewStatus: $("review-status"),
};

/* ---------- Storage ---------- */

function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(medicines));
  } catch (err) {
    alert("Your changes could not be saved in this browser.");
  }
}

function loadFromLocalStorage() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored) ? stored.filter((item) => item && typeof item === "object").map((item) => ({
      ...item,
      minimumQuantity: item.minimumQuantity == null ? "" : item.minimumQuantity,
      batchNumber: typeof item.batchNumber === "string" ? item.batchNumber : "",
      storageNotes: typeof item.storageNotes === "string" ? item.storageNotes : "",
    })) : [];
  } catch (err) {
    return [];
  }
}

function loadReviewSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(REVIEW_KEY));
    if (!stored || typeof stored !== "object") return reviewSettings;
    const intervalDays = [30, 60, 90].includes(Number(stored.intervalDays)) ? Number(stored.intervalDays) : 30;
    const lastReviewedAt = typeof stored.lastReviewedAt === "string" && !Number.isNaN(new Date(stored.lastReviewedAt).getTime())
      ? stored.lastReviewedAt
      : reviewSettings.lastReviewedAt;
    return { intervalDays, lastReviewedAt };
  } catch (error) {
    console.error("Could not load review settings.", error);
    return reviewSettings;
  }
}

function saveReviewSettings() {
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(reviewSettings));
  } catch (error) {
    alert("Your review reminder settings could not be saved in this browser.");
  }
}

/* ---------- Dates and status ---------- */

// Parses "YYYY-MM-DD" as a local date so the day count doesn't shift with timezones.
function parseLocalDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getDaysUntilExpiry(expiryDate) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseLocalDate(expiryDate) - today) / 86400000);
}

function calculateStatus(medicine) {
  if (medicine.status === "disposed") return "disposed";
  const days = getDaysUntilExpiry(medicine.expiryDate);
  if (days < 0) return "expired";
  if (days <= SOON_THRESHOLD_DAYS) return "soon";
  return "active";
}

function describeExpiry(days) {
  if (days > 1) return `expires in ${days} days`;
  if (days === 1) return "expires tomorrow";
  if (days === 0) return "expires today";
  if (days === -1) return "expired yesterday";
  return `expired ${Math.abs(days)} days ago`;
}

function formatDate(date) {
  const value = typeof date === "string" && date.length === 10 ? parseLocalDate(date) : new Date(date);
  return value.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatQuantity(medicine) {
  if (medicine.quantity === "" || medicine.quantity == null) return "—";
  let unit = (medicine.unit || "").toLowerCase();
  if (Number(medicine.quantity) === 1 && unit.endsWith("s")) unit = unit.slice(0, -1);
  return `${medicine.quantity} ${unit}`.trim();
}

const STATUS_LABELS = { active: "Active", soon: "Expiring soon", expired: "Expired", disposed: "Disposed" };

/* ---------- Actions ---------- */

function addMedicine(data) {
  medicines.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: data.name,
    expiryDate: data.expiryDate,
    quantity: data.quantity,
    unit: data.unit,
    reminderDays: data.reminderDays,
    notes: data.notes,
    category: data.category,
    person: data.person,
    location: data.location,
    batchNumber: data.batchNumber,
    minimumQuantity: data.minimumQuantity,
    storageNotes: data.storageNotes,
    status: "active",
    disposedAt: null,
    quantityHistory: [],
  });
  saveToLocalStorage();
}

function updateMedicine(id, data) {
  const medicine = medicines.find((m) => m.id === id);
  if (!medicine) return;
  Object.assign(medicine, data);
  saveToLocalStorage();
}

function changeQuantity(id, amount, action) {
  const medicine = medicines.find((m) => m.id === id);
  if (!medicine) return;
  const current = Number(medicine.quantity);
  const next = action === "used" ? current - amount : current + amount;
  medicine.quantity = next;
  medicine.quantityHistory = Array.isArray(medicine.quantityHistory) ? medicine.quantityHistory : [];
  medicine.quantityHistory.push({ action, amount, date: new Date().toISOString(), quantity: next });
  saveToLocalStorage();
}

function isLowStock(medicine) {
  return calculateStatus(medicine) !== "expired" && medicine.status !== "disposed" &&
    medicine.quantity !== "" && medicine.quantity != null &&
    medicine.minimumQuantity !== "" && medicine.minimumQuantity != null &&
    Number(medicine.quantity) <= Number(medicine.minimumQuantity);
}

function markAsDisposed(id) {
  const medicine = medicines.find((m) => m.id === id);
  if (!medicine) return;
  medicine.status = "disposed";
  medicine.disposedAt = new Date().toISOString();
  saveToLocalStorage();
}

function deleteMedicine(id) {
  const medicine = medicines.find((m) => m.id === id);
  if (!medicine) return;
  if (!confirm(`Delete ${medicine.name}? This can't be undone.`)) return;
  medicines = medicines.filter((m) => m.id !== id);
  selectedMedicineIds.delete(id);
  saveToLocalStorage();
}

/* ---------- Filtering ---------- */

function filterMedicines() {
  const query = els.search.value.trim().toLowerCase();
  const filter = els.filter.value;

  return medicines
    .filter((m) => {
      const status = calculateStatus(m);
      if (filter === "low-stock") return isLowStock(m);
      if (filter === "all") return status !== "disposed";
      return status === filter;
    })
    .filter((m) => [m.name, m.notes, m.category, m.person, m.location, m.batchNumber, m.storageNotes].some((value) => String(value || "").toLowerCase().includes(query)))
    .sort((a, b) => {
      if (els.groupBy.value !== "none") {
        const aGroup = String(a[els.groupBy.value] || "").toLowerCase();
        const bGroup = String(b[els.groupBy.value] || "").toLowerCase();
        const groupOrder = aGroup.localeCompare(bGroup);
        if (groupOrder) return groupOrder;
      }
      const sortBy = els.sort.value;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "quantity") return Number(a.quantity || 0) - Number(b.quantity || 0);
      if (a.status === "disposed") return new Date(b.disposedAt) - new Date(a.disposedAt);
      return a.expiryDate.localeCompare(b.expiryDate);
    });
}

/* ---------- Rendering ---------- */

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function createCell(label, className) {
  const cell = createElement("td", className);
  if (label) cell.dataset.label = label;
  return cell;
}

function createActionsCell(medicine) {
  const cell = createCell(null, "actions");
  if (Number(medicine.quantity) > 0) {
    const quickUse = createElement("button", "btn quick-use", "Use 1");
    quickUse.type = "button";
    quickUse.dataset.action = "quick-use";
    quickUse.dataset.id = medicine.id;
    quickUse.setAttribute("aria-label", `Use one ${String(medicine.unit || "unit").replace(/s$/i, "")} of ${medicine.name}`);
    cell.append(quickUse);
  }
  const toggle = createElement("button", "btn", "Actions");
  toggle.type = "button";
  toggle.dataset.toggle = medicine.id;
  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", `Actions for ${medicine.name}`);

  const menu = createElement("div", "menu");
  menu.hidden = true;
  const edit = createElement("button", null, "Edit details");
  edit.type = "button";
  edit.dataset.action = "edit";
  edit.dataset.id = medicine.id;
  menu.append(edit);
  if (medicine.quantity !== "" && medicine.quantity != null) {
    const adjust = createElement("button", null, "Change quantity");
    adjust.type = "button";
    adjust.dataset.action = "quantity";
    adjust.dataset.id = medicine.id;
    menu.append(adjust);
  }
  if (medicine.status !== "disposed") {
    const dispose = createElement("button", null, "Mark as disposed");
    dispose.type = "button";
    dispose.dataset.action = "dispose";
    dispose.dataset.id = medicine.id;
    menu.append(dispose);
  }
  const remove = createElement("button", "danger", "Delete");
  remove.type = "button";
  remove.dataset.action = "delete";
  remove.dataset.id = medicine.id;
  menu.append(remove);

  cell.append(toggle, menu);
  return cell;
}

function createRow(medicine) {
  const status = calculateStatus(medicine);
  const row = document.createElement("tr");

  const selectCell = createCell("Select");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "medicine-select";
  checkbox.dataset.id = medicine.id;
  checkbox.checked = selectedMedicineIds.has(medicine.id);
  checkbox.setAttribute("aria-label", `Select ${medicine.name}`);
  selectCell.append(checkbox);

  const nameCell = createCell(null, "cell-name");
  nameCell.append(createElement("span", "med-name", medicine.name));
  if (medicine.notes) nameCell.append(createElement("div", "med-note", medicine.notes));
  const details = [medicine.batchNumber && `Batch ${medicine.batchNumber}`, medicine.category, medicine.person, medicine.location].filter(Boolean);
  if (details.length) nameCell.append(createElement("div", "med-note", details.join(" · ")));
  if (medicine.storageNotes) nameCell.append(createElement("div", "storage-note", `Storage note: ${medicine.storageNotes}`));

  const expiryCell = createCell("Expiry");
  expiryCell.append(document.createTextNode(formatDate(medicine.expiryDate)));
  if (status !== "disposed") {
    const hint = describeExpiry(getDaysUntilExpiry(medicine.expiryDate));
    expiryCell.append(createElement("span", "expiry-hint", hint.charAt(0).toUpperCase() + hint.slice(1)));
  }

  const statusCell = createCell("Status");
  const statusText = status === "disposed" ? `Disposed on ${formatDate(medicine.disposedAt)}` : STATUS_LABELS[status];
  statusCell.append(createElement("span", `status status-${status}`, statusText));

  const quantityCell = createCell("Quantity");
  quantityCell.textContent = formatQuantity(medicine);
  if (isLowStock(medicine)) {
    quantityCell.append(createElement("span", "stock-warning", `Restock at ${medicine.minimumQuantity} or less`));
  } else if (medicine.minimumQuantity !== "" && medicine.minimumQuantity != null) {
    quantityCell.append(createElement("span", "expiry-hint", `Minimum ${medicine.minimumQuantity}`));
  }
  if (Array.isArray(medicine.quantityHistory) && medicine.quantityHistory.length) {
    const history = createElement("details", "quantity-history");
    const summary = createElement("summary", null, `History (${medicine.quantityHistory.length})`);
    const list = document.createElement("ul");
    medicine.quantityHistory.slice().reverse().forEach((entry) => {
      const action = entry.action === "used" ? "Used" : "Restocked";
      const when = entry.date ? ` on ${formatDate(entry.date)}` : "";
      list.append(createElement("li", null, `${action} ${entry.amount}${when}; balance ${entry.quantity}`));
    });
    history.append(summary, list);
    quantityCell.append(history);
  }
  row.append(selectCell, nameCell, expiryCell, quantityCell, statusCell, createActionsCell(medicine));
  row.classList.add(`row-${status}`);
  return row;
}

function renderSummary() {
  const current = medicines.filter((m) => m.status !== "disposed");
  const soon = current.filter((m) => calculateStatus(m) === "soon").length;
  const expired = current.filter((m) => calculateStatus(m) === "expired").length;
  const disposed = medicines.length - current.length;
  const lowStock = current.filter(isLowStock).length;

  const parts = [`${current.length} ${current.length === 1 ? "medicine" : "medicines"}`];
  if (soon) parts.push(`${soon} expiring soon`);
  if (expired) parts.push(`${expired} expired`);
  if (lowStock) parts.push(`${lowStock} low stock`);
  parts.push(`${disposed} disposed`);

  els.summary.replaceChildren(...parts.map((text) => createElement("span", null, text)));
}

function renderExpiringSoon() {
  const soon = medicines
    .filter((m) => calculateStatus(m) === "soon")
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  els.soonSection.hidden = soon.length === 0;
  els.soonList.replaceChildren(
    ...soon.map((m) => createElement("li", null, `${m.name} ${describeExpiry(getDaysUntilExpiry(m.expiryDate))}`))
  );
}

function renderLowStock() {
  const low = medicines.filter(isLowStock).sort((a, b) => Number(a.quantity) - Number(b.quantity));
  els.lowStockSection.hidden = low.length === 0;
  els.lowStockList.replaceChildren(...low.map((medicine) =>
    createElement("li", null, `${medicine.name}${medicine.batchNumber ? ` (batch ${medicine.batchNumber})` : ""}: ${formatQuantity(medicine)} remaining; restock at ${medicine.minimumQuantity} or less`)
  ));
}

function renderInsights() {
  const active = medicines.filter((medicine) => medicine.status !== "disposed");
  const soon = active.filter((medicine) => calculateStatus(medicine) === "soon").length;
  const expired = active.filter((medicine) => calculateStatus(medicine) === "expired");
  const now = new Date();
  const disposedThisMonth = medicines.filter((medicine) => {
    if (medicine.status !== "disposed" || !medicine.disposedAt) return false;
    const disposed = new Date(medicine.disposedAt);
    return disposed.getFullYear() === now.getFullYear() && disposed.getMonth() === now.getMonth();
  }).length;
  const expiredQuantity = expired.reduce((total, medicine) => total + (Number.isFinite(Number(medicine.quantity)) ? Number(medicine.quantity) : 0), 0);
  $("insight-soon").textContent = String(soon);
  $("insight-expired").textContent = String(expired.length);
  $("insight-disposed").textContent = String(disposedThisMonth);
  $("insight-quantity").textContent = String(expiredQuantity);
}

function renderReviewReminder() {
  const dueDate = new Date(reviewSettings.lastReviewedAt);
  dueDate.setDate(dueDate.getDate() + reviewSettings.intervalDays);
  const daysRemaining = Math.ceil((new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()) -
    new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000);
  $("review-interval").value = String(reviewSettings.intervalDays);
  els.reviewStatus.textContent = daysRemaining <= 0
    ? `Review due. Last reviewed ${formatDate(reviewSettings.lastReviewedAt)}.`
    : `Next review ${formatDate(dueDate)} (${daysRemaining} days). Last reviewed ${formatDate(reviewSettings.lastReviewedAt)}.`;
  $("review-heading").parentElement.parentElement.classList.toggle("review-due", daysRemaining <= 0);
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  els.calendarMonth.textContent = calendarDate.toLocaleDateString("en", { month: "long", year: "numeric" });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cells = labels.map((label) => {
    const cell = createElement("div", "calendar-day-label", label);
    cell.setAttribute("role", "columnheader");
    return cell;
  });
  let hasExpiries = false;

  for (let i = 0; i < firstDay; i++) {
    const blank = createElement("div", "calendar-day calendar-day-empty");
    blank.setAttribute("role", "gridcell");
    cells.push(blank);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = createElement("div", "calendar-day");
    cell.setAttribute("role", "gridcell");
    cell.append(createElement("strong", "calendar-date", String(day)));
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    medicines.filter((medicine) => medicine.expiryDate === date && medicine.status !== "disposed").forEach((medicine) => {
      hasExpiries = true;
      const item = createElement("span", `calendar-item calendar-item-${calculateStatus(medicine)}`, medicine.name);
      item.title = `${medicine.name}: ${STATUS_LABELS[calculateStatus(medicine)]}`;
      cell.append(item);
    });
    cells.push(cell);
  }
  els.calendarGrid.replaceChildren(...cells);
  els.calendarEmpty.hidden = hasExpiries;
}

function renderBulkActions(visible) {
  for (const id of selectedMedicineIds) {
    if (!medicines.some((medicine) => medicine.id === id)) selectedMedicineIds.delete(id);
  }
  els.bulkActions.hidden = selectedMedicineIds.size === 0;
  $("selected-count").textContent = `${selectedMedicineIds.size} selected`;
  $("select-visible").checked = visible.length > 0 && visible.every((medicine) => selectedMedicineIds.has(medicine.id));
  $("select-visible").indeterminate = visible.some((medicine) => selectedMedicineIds.has(medicine.id)) && !$("select-visible").checked;
}

function renderMedicines() {
  const visible = filterMedicines();
  const hasAny = medicines.length > 0;

  els.toolbar.hidden = !hasAny;
  const grouped = els.groupBy.value;
  const rows = [];
  let previousGroup = null;
  visible.forEach((medicine) => {
    if (grouped !== "none") {
      const groupName = String(medicine[grouped] || "").trim() || `Unspecified ${grouped}`;
      if (groupName !== previousGroup) {
        const groupRow = document.createElement("tr");
        groupRow.className = "group-row";
        const groupCell = createElement("th", null, groupName);
        groupCell.colSpan = 6;
        groupCell.scope = "rowgroup";
        groupRow.append(groupCell);
        rows.push(groupRow);
        previousGroup = groupName;
      }
    }
    rows.push(createRow(medicine));
  });
  els.body.replaceChildren(...rows);
  els.table.hidden = visible.length === 0;
  els.empty.hidden = visible.length > 0;

  if (!hasAny) {
    els.emptyTitle.textContent = "No medicines added yet.";
    els.emptyHint.textContent = "Add a medicine to start keeping track of expiry dates.";
    els.emptyAdd.hidden = false;
  } else {
    els.emptyTitle.textContent = "No medicines match.";
    els.emptyHint.textContent = "Try a different search or filter.";
    els.emptyAdd.hidden = true;
  }

  renderSummary();
  renderExpiringSoon();
  renderLowStock();
  renderInsights();
  renderReviewReminder();
  renderCalendar();
  renderBulkActions(visible);
}

/* ---------- Reminders ---------- */

function getDueReminders() {
  return medicines.filter((m) => {
    if (m.status === "disposed") return false;
    const days = getDaysUntilExpiry(m.expiryDate);
    return days >= 0 && days <= Number(m.reminderDays);
  });
}

function isReviewDue() {
  const dueAt = new Date(reviewSettings.lastReviewedAt);
  dueAt.setDate(dueAt.getDate() + reviewSettings.intervalDays);
  const today = new Date();
  return dueAt <= new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function checkReminders() {
  const due = getDueReminders();
  const lowStock = medicines.filter(isLowStock);
  const reminders = [];
  if (due.length) {
    const names = due.map((medicine) => medicine.name).join(", ");
    reminders.push(`${due.length} ${due.length === 1 ? "medicine has" : "medicines have"} reached the expiry reminder date: ${names}.`);
  }
  if (lowStock.length) {
    reminders.push(`${lowStock.length} ${lowStock.length === 1 ? "package is" : "packages are"} at or below the restock threshold.`);
  }
  if (isReviewDue()) reminders.push("Your medicine records are due for review.");
  if (!reminders.length) return;
  const text = reminders.join(" ");
  els.noticeText.textContent = text;
  els.notice.hidden = false;

  // Only send a browser notification if the user has already granted permission.
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Medicine Tracker", { body: text });
  }
}

function updateNotificationSetting() {
  if (!("Notification" in window)) return;
  els.notifySetting.hidden = false;
  const permission = Notification.permission;
  els.enableNotify.hidden = permission !== "default";
  els.notifyText.textContent =
    permission === "granted" ? "Browser notifications are on. They appear when you open this page."
    : permission === "denied" ? "Browser notifications are blocked in this browser. Reminders still show on this page."
    : "Reminders show on this page when you open it.";
}

function setTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.dataset.theme = isLight ? "light" : "dark";
  const toggle = $("theme-toggle");
  toggle.textContent = isLight ? "Dark theme" : "White theme";
  toggle.setAttribute("aria-pressed", String(isLight));
}

function setupInstallPrompt() {
  const button = $("install-app");
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    button.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    button.hidden = true;
  });
  button.addEventListener("click", async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    button.hidden = true;
  });
  const updateConnectionStatus = () => {
    $("offline-status").hidden = navigator.onLine;
  };
  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
  updateConnectionStatus();

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("The offline app could not be set up.", error);
    });
  }
}

/* ---------- Add form ---------- */

function openAddDialog() {
  openMedicineDialog(null);
}

function openMedicineDialog(medicine) {
  editingMedicineId = medicine ? medicine.id : null;
  els.form.reset();
  clearErrors();
  $("dialog-title").textContent = medicine ? "Edit medicine" : "Add medicine";
  $("name").value = medicine ? medicine.name : "";
  $("expiry").value = medicine ? medicine.expiryDate : "";
  $("quantity").value = medicine ? medicine.quantity : "1";
  $("unit").value = medicine ? medicine.unit : "Tablets";
  $("reminder").value = String(medicine ? medicine.reminderDays : 14);
  $("notes").value = medicine ? medicine.notes || "" : "";
  $("category").value = medicine ? medicine.category || "" : "";
  $("person").value = medicine ? medicine.person || "" : "";
  $("location").value = medicine ? medicine.location || "" : "";
  $("batch-number").value = medicine ? medicine.batchNumber || "" : "";
  $("minimum-quantity").value = medicine && medicine.minimumQuantity !== "" ? medicine.minimumQuantity : "";
  $("storage-notes").value = medicine ? medicine.storageNotes || "" : "";
  $("minimum-quantity-error").hidden = true;
  els.dialog.showModal();
  $("name").focus();
}

function setError(inputId, errorId, hasError) {
  $(errorId).hidden = !hasError;
  $(inputId).setAttribute("aria-invalid", hasError ? "true" : "false");
}

function clearErrors() {
  setError("name", "name-error", false);
  setError("expiry", "expiry-error", false);
  setError("quantity", "quantity-error", false);
  $("minimum-quantity-error").hidden = true;
}

function handleFormSubmit(event) {
  event.preventDefault();
  const name = $("name").value.trim();
  const expiryDate = $("expiry").value;
  const quantityRaw = $("quantity").value;
  const minimumQuantityRaw = $("minimum-quantity").value;

  const nameInvalid = name === "";
  const expiryInvalid = expiryDate === "";
  const quantityInvalid = quantityRaw !== "" && (!Number.isInteger(Number(quantityRaw)) || Number(quantityRaw) < 0);
  const minimumQuantityInvalid = minimumQuantityRaw !== "" &&
    (!Number.isInteger(Number(minimumQuantityRaw)) || Number(minimumQuantityRaw) < 0);
  setError("name", "name-error", nameInvalid);
  setError("expiry", "expiry-error", expiryInvalid);
  setError("quantity", "quantity-error", quantityInvalid);
  $("minimum-quantity-error").hidden = !minimumQuantityInvalid;

  if (nameInvalid) return $("name").focus();
  if (expiryInvalid) return $("expiry").focus();
  if (quantityInvalid) return $("quantity").focus();
  if (minimumQuantityInvalid) return $("minimum-quantity").focus();

  const medicineData = {
    name,
    expiryDate,
    quantity: quantityRaw === "" ? "" : Number(quantityRaw),
    unit: $("unit").value,
    reminderDays: Number($("reminder").value),
    notes: $("notes").value.trim(),
    category: $("category").value.trim(),
    person: $("person").value.trim(),
    location: $("location").value.trim(),
    batchNumber: $("batch-number").value.trim(),
    minimumQuantity: minimumQuantityRaw === "" ? "" : Number(minimumQuantityRaw),
    storageNotes: $("storage-notes").value.trim(),
  };
  if (editingMedicineId) updateMedicine(editingMedicineId, medicineData);
  else addMedicine(medicineData);
  editingMedicineId = null;
  els.dialog.close();
  renderMedicines();
}

function openQuantityDialog(id) {
  const medicine = medicines.find((item) => item.id === id);
  if (!medicine || medicine.quantity === "" || medicine.quantity == null) return;
  $("quantity-id").value = id;
  $("quantity-medicine").textContent = `${medicine.name} — current quantity: ${formatQuantity(medicine)}`;
  $("quantity-change").value = "1";
  $("quantity-action").value = "used";
  $("quantity-change-error").hidden = true;
  $("quantity-stock-error").hidden = true;
  $("quantity-dialog").showModal();
  $("quantity-change").focus();
}

function handleQuantitySubmit(event) {
  event.preventDefault();
  const amount = Number($("quantity-change").value);
  const id = $("quantity-id").value;
  const medicine = medicines.find((item) => item.id === id);
  const action = $("quantity-action").value;
  const invalid = !Number.isInteger(amount) || amount <= 0;
  const insufficient = !invalid && action === "used" && Number(medicine.quantity) < amount;
  $("quantity-change-error").hidden = !invalid;
  $("quantity-stock-error").hidden = !insufficient;
  if (invalid || insufficient) return $("quantity-change").focus();
  changeQuantity(id, amount, action);
  $("quantity-dialog").close();
  renderMedicines();
}

/* ---------- Backups and bulk actions ---------- */

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportJson() {
  downloadFile("medicine-tracker-backup.json", JSON.stringify({ version: 2, medicines, reviewSettings }, null, 2), "application/json");
}

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const fields = ["id", "name", "expiryDate", "quantity", "unit", "reminderDays", "notes", "category", "person", "location", "batchNumber", "minimumQuantity", "storageNotes", "status", "disposedAt", "quantityHistory"];
  const lines = [fields.map(csvEscape).join(",")];
  medicines.forEach((medicine) => lines.push(fields.map((field) => csvEscape(field === "quantityHistory" ? JSON.stringify(medicine[field] || []) : medicine[field])).join(",")));
  downloadFile("medicine-tracker-backup.csv", lines.join("\r\n"), "text/csv;charset=utf-8");
}

function parseCsv(text) {
  const records = [];
  let record = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      record.push(value);
      value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(value);
      if (record.some((field) => field !== "")) records.push(record);
      record = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error("CSV file contains an unclosed quoted value.");
  if (value !== "" || record.length) {
    record.push(value);
    records.push(record);
  }
  if (!records.length) throw new Error("The selected CSV file is empty.");
  const headers = records.shift().map((header) => header.trim());
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function validateImportedMedicine(value) {
  const expiryDate = value && typeof value.expiryDate === "string" ? value.expiryDate : "";
  const parsedExpiryDate = /^\d{4}-\d{2}-\d{2}$/.test(expiryDate) ? parseLocalDate(expiryDate) : null;
  const validExpiryDate = parsedExpiryDate &&
    parsedExpiryDate.getFullYear() === Number(expiryDate.slice(0, 4)) &&
    parsedExpiryDate.getMonth() + 1 === Number(expiryDate.slice(5, 7)) &&
    parsedExpiryDate.getDate() === Number(expiryDate.slice(8, 10));
  if (!value || typeof value !== "object" || typeof value.name !== "string" || !value.name.trim() || !validExpiryDate) {
    throw new Error("Backup contains a medicine with an invalid name or expiry date.");
  }
  const quantity = value.quantity === "" || value.quantity == null ? "" : Number(value.quantity);
  const minimumQuantity = value.minimumQuantity === "" || value.minimumQuantity == null ? "" : Number(value.minimumQuantity);
  const reminderDays = Number(value.reminderDays || 14);
  let quantityHistory = value.quantityHistory;
  if (typeof quantityHistory === "string" && quantityHistory) {
    try {
      quantityHistory = JSON.parse(quantityHistory);
    } catch {
      throw new Error(`Backup contains invalid quantity history for ${value.name}.`);
    }
  }
  if ((quantity !== "" && (!Number.isInteger(quantity) || quantity < 0)) ||
      (minimumQuantity !== "" && (!Number.isInteger(minimumQuantity) || minimumQuantity < 0)) ||
      !Number.isFinite(reminderDays) || reminderDays < 0) {
    throw new Error(`Backup contains invalid quantity, restock threshold, or reminder data for ${value.name}.`);
  }
  if (quantityHistory == null || quantityHistory === "") quantityHistory = [];
  if (!Array.isArray(quantityHistory) || quantityHistory.some((entry) =>
    !entry || !["used", "restocked"].includes(entry.action) ||
    !Number.isInteger(Number(entry.amount)) || Number(entry.amount) <= 0 ||
    !Number.isInteger(Number(entry.quantity)) || Number(entry.quantity) < 0 ||
    typeof entry.date !== "string" || Number.isNaN(new Date(entry.date).getTime())
  )) {
    throw new Error(`Backup contains invalid quantity history for ${value.name}.`);
  }
  return {
    id: typeof value.id === "string" && value.id ? value.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: value.name.trim(),
    expiryDate: value.expiryDate,
    quantity,
    unit: typeof value.unit === "string" ? value.unit : "Other",
    reminderDays,
    notes: typeof value.notes === "string" ? value.notes : "",
    category: typeof value.category === "string" ? value.category : "",
    person: typeof value.person === "string" ? value.person : "",
    location: typeof value.location === "string" ? value.location : "",
    batchNumber: typeof value.batchNumber === "string" ? value.batchNumber : "",
    minimumQuantity,
    storageNotes: typeof value.storageNotes === "string" ? value.storageNotes : "",
    status: value.status === "disposed" ? "disposed" : "active",
    disposedAt: typeof value.disposedAt === "string" ? value.disposedAt : null,
    quantityHistory: Array.isArray(quantityHistory) ? quantityHistory : [],
  };
}

async function importBackup(file) {
  const text = (await file.text()).replace(/^\uFEFF/, "");
  let backupReviewSettings = null;
  let data;
  if (file.name.toLowerCase().endsWith(".csv")) {
    data = parseCsv(text);
  } else {
    const parsed = JSON.parse(text);
    data = Array.isArray(parsed) ? parsed : parsed.medicines;
    if (!Array.isArray(parsed) && parsed.reviewSettings != null) {
      const importedInterval = Number(parsed.reviewSettings.intervalDays);
      const importedLastReviewed = parsed.reviewSettings.lastReviewedAt;
      if (![30, 60, 90].includes(importedInterval) ||
          typeof importedLastReviewed !== "string" ||
          Number.isNaN(new Date(importedLastReviewed).getTime())) {
        throw new Error("Backup contains invalid review reminder settings.");
      }
      backupReviewSettings = { intervalDays: importedInterval, lastReviewedAt: importedLastReviewed };
    }
  }
  if (!Array.isArray(data)) throw new Error("Backup must contain a list of medicines.");
  const imported = data.map(validateImportedMedicine);
  if (backupReviewSettings) {
    reviewSettings = backupReviewSettings;
    saveReviewSettings();
  }
  const existingIds = new Set(medicines.map((medicine) => medicine.id));
  const additions = imported.filter((medicine) => {
    if (existingIds.has(medicine.id)) return false;
    existingIds.add(medicine.id);
    return true;
  });
  if (additions.length === 0 && imported.length > 0) {
    renderReviewReminder();
    alert("No new medicines were imported. Existing medicines were kept unchanged.");
    return;
  }
  medicines.push(...additions);
  saveToLocalStorage();
  renderMedicines();
  checkReminders();
  alert(`${additions.length} ${additions.length === 1 ? "medicine" : "medicines"} imported. Existing medicines were kept unchanged.`);
}

function bulkDispose() {
  if (!selectedMedicineIds.size) return;
  selectedMedicineIds.forEach((id) => {
    const medicine = medicines.find((item) => item.id === id);
    if (medicine && medicine.status !== "disposed") {
      medicine.status = "disposed";
      medicine.disposedAt = new Date().toISOString();
    }
  });
  selectedMedicineIds.clear();
  saveToLocalStorage();
  renderMedicines();
}

function bulkDelete() {
  if (!selectedMedicineIds.size || !confirm(`Delete ${selectedMedicineIds.size} selected medicines? This can't be undone.`)) return;
  medicines = medicines.filter((medicine) => !selectedMedicineIds.has(medicine.id));
  selectedMedicineIds.clear();
  saveToLocalStorage();
  renderMedicines();
}

function clearAllData() {
  if (!medicines.length || !confirm("Delete all medicine data stored by this tracker in this browser? This can't be undone.")) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REVIEW_KEY);
  } catch (error) {
    alert("Medicine data could not be deleted from this browser.");
    return;
  }
  medicines = [];
  reviewSettings = { intervalDays: 30, lastReviewedAt: new Date().toISOString() };
  selectedMedicineIds.clear();
  renderMedicines();
  saveReviewSettings();
  els.notice.hidden = true;
}

/* ---------- Action menus ---------- */

function closeMenus(returnFocus) {
  document.querySelectorAll(".menu").forEach((menu) => {
    if (menu.hidden) return;
    menu.hidden = true;
    const toggle = menu.previousElementSibling;
    toggle.setAttribute("aria-expanded", "false");
    if (returnFocus) toggle.focus();
  });
}

function handleTableClick(event) {
  const checkbox = event.target.closest(".medicine-select");
  if (checkbox) {
    if (checkbox.checked) selectedMedicineIds.add(checkbox.dataset.id);
    else selectedMedicineIds.delete(checkbox.dataset.id);
    renderBulkActions(filterMedicines());
    return;
  }
  const toggle = event.target.closest("[data-toggle]");
  if (toggle) {
    const menu = toggle.nextElementSibling;
    const willOpen = menu.hidden;
    closeMenus(false);
    menu.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) menu.querySelector("button").focus();
    return;
  }

  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "edit") {
    const medicine = medicines.find((item) => item.id === action.dataset.id);
    closeMenus(false);
    if (medicine) openMedicineDialog(medicine);
    return;
  }
  if (action.dataset.action === "quantity") {
    const id = action.dataset.id;
    closeMenus(false);
    openQuantityDialog(id);
    return;
  }
  if (action.dataset.action === "quick-use") {
    changeQuantity(action.dataset.id, 1, "used");
    renderMedicines();
    return;
  }
  if (action.dataset.action === "dispose") markAsDisposed(action.dataset.id);
  if (action.dataset.action === "delete") deleteMedicine(action.dataset.id);
  renderMedicines();
}

/* ---------- Setup ---------- */

function init() {
  medicines = loadFromLocalStorage();
  reviewSettings = loadReviewSettings();

  setTheme("dark");
  $("theme-toggle").addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
  });
  $("open-add").addEventListener("click", openAddDialog);
  els.emptyAdd.addEventListener("click", openAddDialog);
  $("cancel-add").addEventListener("click", () => els.dialog.close());
  els.form.addEventListener("submit", handleFormSubmit);
  $("quantity-form").addEventListener("submit", handleQuantitySubmit);
  $("cancel-quantity").addEventListener("click", () => $("quantity-dialog").close());
  els.search.addEventListener("input", renderMedicines);
  els.filter.addEventListener("change", renderMedicines);
  els.sort.addEventListener("change", renderMedicines);
  els.groupBy.addEventListener("change", renderMedicines);
  els.body.addEventListener("click", handleTableClick);
  $("select-visible").addEventListener("change", (event) => {
    filterMedicines().forEach((medicine) => {
      if (event.target.checked) selectedMedicineIds.add(medicine.id);
      else selectedMedicineIds.delete(medicine.id);
    });
    renderMedicines();
  });
  $("bulk-dispose").addEventListener("click", bulkDispose);
  $("bulk-delete").addEventListener("click", bulkDelete);
  $("clear-selection").addEventListener("click", () => {
    selectedMedicineIds.clear();
    renderMedicines();
  });
  $("export-json").addEventListener("click", exportJson);
  $("export-csv").addEventListener("click", exportCsv);
  $("import-backup").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      await importBackup(file);
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  });
  $("clear-data").addEventListener("click", clearAllData);
  $("review-interval").addEventListener("change", (event) => {
    reviewSettings.intervalDays = Number(event.target.value);
    saveReviewSettings();
    renderReviewReminder();
    checkReminders();
  });
  $("mark-reviewed").addEventListener("click", () => {
    reviewSettings.lastReviewedAt = new Date().toISOString();
    saveReviewSettings();
    renderReviewReminder();
    checkReminders();
  });
  $("calendar-prev").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderCalendar();
  });
  $("calendar-next").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderCalendar();
  });
  $("dismiss-reminder").addEventListener("click", () => (els.notice.hidden = true));

  els.enableNotify.addEventListener("click", async () => {
    await Notification.requestPermission();
    updateNotificationSetting();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".actions")) closeMenus(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus(true);
  });

  renderMedicines();
  checkReminders();
  updateNotificationSetting();
  setupInstallPrompt();
}

init();
