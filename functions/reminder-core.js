const TIME_ZONE = 'Asia/Kolkata';
const APP_URL = 'https://mannam-expense.web.app/orders';

function dateInIndia(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function reminderDate(phase, now = new Date()) {
  const today = dateInIndia(now);
  if (phase === 'day-of') return today;
  if (phase !== 'day-before') throw new Error('Unknown reminder phase.');
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function shouldRemind(order) {
  return ['Confirmed', 'In progress', 'Ready'].includes(order.status);
}

function orderSize(order) {
  if (order.cakeType === 'Hamper') return '1 hamper';
  if (order.cakeType === 'Cupcake' || order.cakeType === 'Brownie') {
    const count = Number(order.quantity) || 1;
    return `${count} piece${count === 1 ? '' : 's'}`;
  }
  return order.cakeWeight || 'Size not recorded';
}

function templateParameters(order, phase) {
  const when = phase === 'day-before' ? 'tomorrow' : 'today';
  return [
    when,
    String(order.customer || 'Client').trim().slice(0, 100),
    String(order.cakeType || 'Order').trim().slice(0, 100),
    orderSize(order),
    String(order.cakeMessage || 'No cake message').trim().slice(0, 200),
  ];
}

function reminderPreview(order, phase) {
  const [when, customer, product, size, message] = templateParameters(order, phase);
  return `Mannam order reminder for ${when}. Client: ${customer}. Product: ${product}. Quantity: ${size}. Cake message: ${message}. Check ${APP_URL} for additional details.`;
}

module.exports = { TIME_ZONE, APP_URL, dateInIndia, reminderDate, shouldRemind, orderSize, templateParameters, reminderPreview };
