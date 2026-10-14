// Log definitions shared by the server (AI prompt + schema) and the browser
// (sheet tab names, header rows, column formatting).
//
// Each log becomes one tab in the linked spreadsheet. `key` refers to a field
// in the parsed entry returned by the AI (see ENTRY_FIELDS).

export const LOGS = {
  expenses: {
    label: 'Expenses',
    tab: 'Expenses',
    hint: 'Money spent or received: purchases, bills, income, fees, refunds.',
    columns: [
      { header: 'Date', key: 'date', format: 'date' },
      { header: 'Type', key: 'kind' },
      { header: 'Amount', key: 'amount', format: 'currency' },
      { header: 'Currency', key: 'currency' },
      { header: 'Category', key: 'category' },
      { header: 'Merchant / Payer', key: 'merchant' },
      { header: 'Notes', key: 'notes' },
      { header: 'Logged At', key: '_loggedAt', format: 'datetime' },
    ],
  },
  inventory: {
    label: 'Inventory',
    tab: 'Inventory',
    hint: 'Stock or field inventory: items added, used, removed or counted at a location.',
    columns: [
      { header: 'Date', key: 'date', format: 'date' },
      { header: 'Item', key: 'item' },
      { header: 'Action', key: 'action' },
      { header: 'Quantity', key: 'quantity', format: 'number' },
      { header: 'Unit', key: 'unit' },
      { header: 'Location', key: 'location' },
      { header: 'Notes', key: 'notes' },
      { header: 'Logged At', key: '_loggedAt', format: 'datetime' },
    ],
  },
  mileage: {
    label: 'Mileage',
    tab: 'Mileage',
    hint: 'Trips driven: distance, start/end places, purpose.',
    columns: [
      { header: 'Date', key: 'date', format: 'date' },
      { header: 'Distance', key: 'distance', format: 'number' },
      { header: 'Unit', key: 'unit' },
      { header: 'From', key: 'from' },
      { header: 'To', key: 'to' },
      { header: 'Purpose', key: 'purpose' },
      { header: 'Notes', key: 'notes' },
      { header: 'Logged At', key: '_loggedAt', format: 'datetime' },
    ],
  },
  habits: {
    label: 'Habits',
    tab: 'Habits',
    hint: 'Habit or health tracking: workouts, water, sleep, reading, meditation, etc.',
    columns: [
      { header: 'Date', key: 'date', format: 'date' },
      { header: 'Habit', key: 'habit' },
      { header: 'Value', key: 'value', format: 'number' },
      { header: 'Unit', key: 'unit' },
      { header: 'Notes', key: 'notes' },
      { header: 'Logged At', key: '_loggedAt', format: 'datetime' },
    ],
  },
  todo: {
    label: 'To-Do',
    tab: 'To-Do',
    hint: 'Tasks, reminders and quick to-do items.',
    columns: [
      { header: 'Created', key: 'date', format: 'date' },
      { header: 'Task', key: 'task' },
      { header: 'Due', key: 'due', format: 'date' },
      { header: 'Priority', key: 'priority' },
      { header: 'Status', key: 'status' },
      { header: 'Notes', key: 'notes' },
      { header: 'Logged At', key: '_loggedAt', format: 'datetime' },
    ],
  },
};

export const LOG_IDS = Object.keys(LOGS);

// Every field the AI may fill in. All are nullable; only the ones relevant to
// the chosen log are expected to be set.
export const ENTRY_FIELDS = {
  date: 'Date the event happened, YYYY-MM-DD. Resolve relative dates ("yesterday", "last Friday") against today. Default to today.',
  kind: 'Expenses only: "Expense" or "Income".',
  amount: 'Expenses only: positive number, no currency symbol.',
  currency: 'Expenses only: ISO 4217 code (USD, THB, EUR...). Use the default currency if unspoken.',
  category: 'Expenses only: short category in Title Case, e.g. Fuel, Groceries, Dining, Transport, Utilities, Rent, Salary, Consulting, Office Supplies.',
  merchant: 'Expenses only: merchant, vendor, or payer, if mentioned.',
  item: 'Inventory only: item name.',
  action: 'Inventory only: "Added", "Removed", "Used" or "Counted".',
  quantity: 'Inventory only: number of units.',
  unit: 'Unit of the quantity/distance/value (pcs, boxes, kg, mi, km, minutes, glasses...).',
  location: 'Inventory only: site, shelf, truck or warehouse, if mentioned.',
  distance: 'Mileage only: distance as a number.',
  from: 'Mileage only: start place.',
  to: 'Mileage only: destination.',
  purpose: 'Mileage only: reason for the trip.',
  habit: 'Habits only: habit name in Title Case, e.g. Running, Water, Sleep, Reading.',
  value: 'Habits only: numeric amount (1 if simply "did it").',
  task: 'To-Do only: the task, phrased as a short imperative.',
  due: 'To-Do only: due date YYYY-MM-DD if mentioned.',
  priority: 'To-Do only: "High", "Medium" or "Low" (Medium if unspoken).',
  status: 'To-Do only: "Open" unless the speaker says it is done.',
  notes: 'Any useful extra detail that does not fit another field. Keep it short.',
};

export const NUMERIC_FIELDS = new Set(['amount', 'quantity', 'distance', 'value']);
