'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');

var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var coupons = require('../lib/coupons');
var reports = require('../lib/reports');

function makeOrder(items, coupon) {
  var totals = pricing.computeTotals(items, coupon || '');
  return {
    id: 1001,
    date: '26/11/2026',
    customer: 'In-memory customer',
    status: 'completed',
    paymentMode: 'cash',
    items: items,
    coupon: coupon || '',
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  };
}

test('invoice figures match the billed order totals and HSN tax breakdown', function () {
  var items = [{ id: 7, name: 'Rice', sku: 'RICE-7', hsn: '1006', price: 640, qty: 1 }];
  var order = makeOrder(items, 'WELCOME');
  var invoiceFigures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    {
      subtotal: invoiceFigures.subtotal,
      discount: invoiceFigures.discount,
      tax: invoiceFigures.tax,
      cgst: invoiceFigures.cgst,
      sgst: invoiceFigures.sgst,
      total: invoiceFigures.total,
      rowGstPercent: invoiceFigures.rows[0].gstPercent,
      rowTax: invoiceFigures.rows[0].lineTax
    },
    {
      subtotal: order.subtotal,
      discount: order.discount,
      tax: order.tax,
      cgst: 15.2,
      sgst: 15.2,
      total: order.total,
      rowGstPercent: 5,
      rowTax: 30.4
    }
  );
});

test('invoice uses the same HSN slab as order pricing', function () {
  var items = [{ id: 1, name: 'Rice', sku: 'RICE-1', hsn: '1006', price: 100, qty: 2 }];
  var order = makeOrder(items);
  var invoiceFigures = invoice.computeInvoiceFigures(order);

  assert.equal(order.subtotal, 200);
  assert.equal(order.tax, 10);
  assert.equal(order.total, 210);
  assert.equal(invoiceFigures.rows[0].gstPercent, 5);
  assert.equal(invoiceFigures.tax, 10);
  assert.equal(invoiceFigures.total, 210);
});

test('invoice applies the order discount before calculating line GST', function () {
  var items = [{ id: 2, name: 'Rice', sku: 'RICE-2', hsn: '1006', price: 1000, qty: 1 }];
  var order = makeOrder(items, 'WELCOME');
  var invoiceFigures = invoice.computeInvoiceFigures(order);

  assert.equal(order.discount, 50);
  assert.equal(order.tax, 47.5);
  assert.equal(order.total, 997.5);
  assert.deepEqual(
    { gstPercent: invoiceFigures.rows[0].gstPercent, line: invoiceFigures.rows[0].line, lineTax: invoiceFigures.rows[0].lineTax },
    { gstPercent: 5, line: 1000, lineTax: 47.5 }
  );
  assert.equal(invoiceFigures.tax, order.tax);
  assert.equal(invoiceFigures.discount, order.discount);
  assert.equal(invoiceFigures.total, order.total);
});

test('invoice uses the same coupon cap and tax as order pricing', function () {
  var items = [{ id: 3, name: 'Generic item', sku: 'GEN-3', price: 3000, qty: 1 }];
  var order = makeOrder(items, 'WELCOME');
  var invoiceFigures = invoice.computeInvoiceFigures(order);

  assert.equal(coupons.validate('WELCOME', order.subtotal).discount, 100);
  assert.equal(order.discount, 100);
  assert.equal(order.tax, 522);
  assert.equal(order.total, 3422);
  assert.equal(invoiceFigures.discount, 100);
  assert.equal(invoiceFigures.tax, 522);
  assert.equal(invoiceFigures.total, 3422);
});

test('invoice does not apply a coupon that order pricing considers inactive', function () {
  var items = [{ id: 4, name: 'Generic item', price: 1000, qty: 1 }];
  var order = makeOrder(items);
  order.coupon = 'DIWALI20';
  var invoiceFigures = invoice.computeInvoiceFigures(order);

  assert.equal(coupons.validate('DIWALI20', 1000).valid, false);
  assert.equal(invoiceFigures.discount, 0);
  assert.equal(invoiceFigures.tax, 180);
  assert.equal(invoiceFigures.total, 1180);
});

test('GST reconciliation matches invoice and billed order figures', function () {
  var items = [{ id: 5, name: 'Rice', sku: 'RICE-5', hsn: '1006', price: 100, qty: 1 }];
  var order = makeOrder(items);
  var result = reports.getGstReconciliation({ orders: [order] });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].ledgerTax, 5);
  assert.equal(result.rows[0].invoiceTax, 5);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].matched, true);
});

test('GST reconciliation excludes cancelled orders', function () {
  var order = makeOrder([{ id: 6, name: 'Rice', hsn: '1006', price: 100, qty: 1 }]);
  order.status = 'cancelled';
  var result = reports.getGstReconciliation({ orders: [order] });

  assert.deepEqual(result, { totalChecked: 0, mismatchCount: 0, totalDelta: 0, rows: [] });
});
