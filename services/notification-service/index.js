'use strict';

const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id        SERIAL PRIMARY KEY,
      recipient VARCHAR(255),
      type      VARCHAR(100),
      message   TEXT,
      sent_at   TIMESTAMP DEFAULT NOW()
    )
  `);
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notification-service' }));

app.post('/notifications', async (req, res) => {
  const { recipient, type, message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO notifications (recipient, type, message) VALUES ($1, $2, $3) RETURNING *',
      [recipient || '', type || 'general', message]
    );
    console.log(`[notification] ${type}: ${message}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/notifications', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM notifications ORDER BY sent_at DESC LIMIT 50'
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    await initDB();
    console.log(`notification-service listening on port ${PORT}`);
  } catch (err) {
    console.error('DB init failed:', err.message);
    process.exit(1);
  }
});
