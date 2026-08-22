'use strict';

const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3000';

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id             SERIAL PRIMARY KEY,
      order_id       INT          NOT NULL,
      amount         NUMERIC(12,2) NOT NULL,
      customer_email VARCHAR(255),
      status         VARCHAR(50)  DEFAULT 'completed',
      created_at     TIMESTAMP    DEFAULT NOW()
    )
  `);
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'payment-service' }));

app.post('/payments', async (req, res) => {
  const { orderId, amount, customerEmail } = req.body;
  if (!orderId || !amount) {
    return res.status(400).json({ error: 'orderId and amount are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO payments (order_id, amount, customer_email, status)
       VALUES ($1, $2, $3, 'completed') RETURNING *`,
      [orderId, amount, customerEmail || '']
    );
    const payment = rows[0];

    // Notify asynchronously — fire and forget
    fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: customerEmail || 'unknown',
        type: 'payment_success',
        message: `Pembayaran Rp${Number(amount).toLocaleString('id-ID')} untuk pesanan #${orderId} berhasil.`,
      }),
    }).catch(() => {});

    res.status(201).json(payment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/payments/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Payment not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    await initDB();
    console.log(`payment-service listening on port ${PORT}`);
  } catch (err) {
    console.error('DB init failed:', err.message);
    process.exit(1);
  }
});
