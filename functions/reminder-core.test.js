const test = require('node:test');
const assert = require('node:assert/strict');
const { reminderDate, shouldRemind, templateParameters } = require('./reminder-core');

test('uses India calendar dates across UTC and month boundaries', () => {
  const now = new Date('2026-11-30T20:00:00Z'); // 1 Dec in India
  assert.equal(reminderDate('day-of', now), '2026-12-01');
  assert.equal(reminderDate('day-before', now), '2026-12-02');
});

test('reminds only orders that still need preparation', () => {
  assert.equal(shouldRemind({ status: 'Ready' }), true);
  assert.equal(shouldRemind({ status: 'Delivered' }), false);
  assert.equal(shouldRemind({ status: 'Closed' }), false);
});

test('includes client, product, quantity and cake message', () => {
  assert.deepEqual(templateParameters({ customer: 'Sonam', cakeType: 'Cupcake', quantity: 12, cakeMessage: 'Happy birthday' }, 'day-before'),
    ['tomorrow', 'Sonam', 'Cupcake', '12 pieces', 'Happy birthday']);
  assert.equal(templateParameters({ customer: 'M', cakeType: 'Hamper' }, 'day-of')[3], '1 hamper');
});
