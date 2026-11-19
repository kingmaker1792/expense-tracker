const { createHash } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { reminderDate, shouldRemind, templateParameters } = require('./reminder-core');

initializeApp();
const whatsappConfig = defineSecret('MANNAM_WHATSAPP_CONFIG');
const db = getFirestore();

function configuration() {
  const config = JSON.parse(whatsappConfig.value());
  const recipients = [...new Set(config.recipients || [])];
  if (!/^\d{10,15}$/.test(String(config.phoneNumberId)) || !config.accessToken || !recipients.length ||
      recipients.some(number => !/^\d{10,15}$/.test(String(number)))) {
    throw new Error('WhatsApp reminder configuration is incomplete.');
  }
  return { ...config, recipients, templateName: config.templateName || 'mannam_order_reminder' };
}

async function sendTemplate(config, recipient, order, phase) {
  const parameters = templateParameters(order, phase).map(text => ({ type: 'text', text }));
  const response = await fetch(`https://graph.facebook.com/v27.0/${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'template',
      template: {
        name: config.templateName,
        language: { code: config.language || 'en_US' },
        components: [{ type: 'body', parameters }],
      },
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`WhatsApp rejected reminder: ${result.error?.code || response.status}`);
  return result.messages?.[0]?.id || '';
}

async function sendOnce(config, recipient, order, phase, targetDate) {
  const key = createHash('sha256').update(`${phase}|${targetDate}|${order.id}|${recipient}`).digest('hex');
  const ref = db.collection('orderReminderDeliveries').doc(key);
  const claimed = await db.runTransaction(async transaction => {
    const previous = await transaction.get(ref);
    const data = previous.data();
    if (data?.status === 'sent') return false;
    if (data?.status === 'sending' && Date.now() - (data.startedAt?.toMillis() || 0) < 10 * 60_000) return false;
    transaction.set(ref, {
      orderId: order.id, dueDate: targetDate, phase,
      recipientLastFour: String(recipient).slice(-4),
      status: 'sending', startedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!claimed) return;

  try {
    const messageId = await sendTemplate(config, recipient, order, phase);
    await ref.update({ status: 'sent', messageId, sentAt: FieldValue.serverTimestamp() });
  } catch (error) {
    await ref.update({ status: 'failed', error: String(error.message || error).slice(0, 200), failedAt: FieldValue.serverTimestamp() });
    throw error;
  }
}

async function runReminders(phase) {
  const targetDate = reminderDate(phase);
  const snapshot = await db.collection('orders').where('dueDate', '==', targetDate).get();
  const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(shouldRemind);
  if (!orders.length) { logger.info('No orders need reminders.', { phase, targetDate }); return; }
  const config = configuration();
  const failures = [];
  for (const order of orders) {
    for (const recipient of config.recipients) {
      try { await sendOnce(config, recipient, order, phase, targetDate); }
      catch (error) { failures.push({ orderId: order.id, message: String(error.message || error) }); }
    }
  }
  logger.info('Order reminder run completed.', { phase, targetDate, orders: orders.length, recipients: config.recipients.length, failures: failures.length });
  if (failures.length) {
    logger.error('Some WhatsApp reminders failed.', { failures });
    throw new Error(`${failures.length} reminder deliveries failed.`);
  }
}

const options = { region: 'asia-south1', timeZone: 'Asia/Kolkata', secrets: [whatsappConfig], retryCount: 2, minBackoffSeconds: 60, maxBackoffSeconds: 180 };

exports.remindTomorrowOrders = onSchedule({ ...options, schedule: '0 9 * * *' }, () => runReminders('day-before'));
exports.remindTodayOrders = onSchedule({ ...options, schedule: '0 6 * * *' }, () => runReminders('day-of'));
