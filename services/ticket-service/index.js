'use strict';

const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3000';

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id            SERIAL PRIMARY KEY,
      event_id      INT           NOT NULL,
      type          VARCHAR(50)   NOT NULL DEFAULT 'Regular',
      price         NUMERIC(12,2) NOT NULL,
      available_qty INT           NOT NULL DEFAULT 0,
      created_at    TIMESTAMP     DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id             SERIAL PRIMARY KEY,
      ticket_id      INT           NOT NULL,
      quantity       INT           NOT NULL,
      customer_name  VARCHAR(255),
      customer_email VARCHAR(255),
      total_price    NUMERIC(12,2) NOT NULL,
      status         VARCHAR(50)   DEFAULT 'pending',
      payment_id     INT,
      created_at     TIMESTAMP     DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query('SELECT COUNT(*) FROM tickets');
  if (parseInt(rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO tickets (event_id, type, price, available_qty) VALUES
        (1, 'VVIP',    3000000,  1000),
        (1, 'VIP',     2000000,  5000),
        (1, 'Regular', 1500000, 44000),
        (2, 'VIP',     1500000,  2000),
        (2, 'Regular',  750000, 18000),
        (3, 'Regular',  500000, 30000)
    `);
  }
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ticket-service' }));

app.get('/tickets', async (req, res) => {
  try {
    const where  = req.query.event_id ? 'WHERE event_id = $1' : '';
    const params = req.query.event_id ? [req.query.event_id] : [];
    const { rows } = await pool.query(`SELECT * FROM tickets ${where} ORDER BY id`, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/tickets/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/orders', async (req, res) => {
  const { ticketId, quantity, customerName, customerEmail } = req.body;

  if (!ticketId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'ticketId and quantity are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ticketRows } = await client.query(
      'SELECT * FROM tickets WHERE id = $1 FOR UPDATE',
      [ticketId]
    );
    if (!ticketRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = ticketRows[0];
    if (ticket.available_qty < quantity) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Not enough tickets available' });
    }

    await client.query(
      'UPDATE tickets SET available_qty = available_qty - $1 WHERE id = $2',
      [quantity, ticketId]
    );

    const totalPrice = parseFloat(ticket.price) * quantity;
    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (ticket_id, quantity, customer_name, customer_email, total_price, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
      [ticketId, quantity, customerName || 'Guest', customerEmail || '', totalPrice]
    );
    await client.query('COMMIT');

    const order = orderRows[0];

    // Call payment-service; update order status when done
    fetch(`${PAYMENT_SERVICE_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id, amount: totalPrice, customerEmail: customerEmail || '' }),
    }).then(async (r) => {
      if (r.ok) {
        const payment = await r.json();
        await pool.query(
          "UPDATE orders SET status = 'paid', payment_id = $1 WHERE id = $2",
          [payment.id, order.id]
        );
      }
    }).catch(() => {});

    res.status(201).json(order);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/orders', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders ORDER BY id DESC LIMIT 50');
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    await initDB();
    console.log(`ticket-service listening on port ${PORT}`);
  } catch (err) {
    console.error('DB init failed:', err.message);
    process.exit(1);
  }
});
