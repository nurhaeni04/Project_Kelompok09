'use strict';

const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id              SERIAL PRIMARY KEY,
      name            VARCHAR(255) NOT NULL,
      venue           VARCHAR(255),
      event_date      TIMESTAMP,
      available_seats INT          DEFAULT 0,
      price           NUMERIC(12,2) DEFAULT 0,
      created_at      TIMESTAMP    DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query('SELECT COUNT(*) FROM events');
  if (parseInt(rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO events (name, venue, event_date, available_seats, price) VALUES
        ('Konser Coldplay Jakarta', 'GBK Stadium',     '2026-09-01 19:00', 50000, 1500000),
        ('Konser Dewa 19 Reunion',  'ICE BSD',          '2026-09-15 18:00', 20000,  750000),
        ('We The Fest 2026',        'JIExpo Kemayoran', '2026-10-01 12:00', 30000,  500000)
    `);
  }
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'event-service' }));

app.get('/events', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  try {
    const [data, count] = await Promise.all([
      pool.query('SELECT * FROM events ORDER BY id LIMIT $1 OFFSET $2', [limit, offset]),
      pool.query('SELECT COUNT(*) FROM events'),
    ]);
    res.json({ data: data.rows, page, limit, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/events/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Event not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    await initDB();
    console.log(`event-service listening on port ${PORT}`);
  } catch (err) {
    console.error('DB init failed:', err.message);
    process.exit(1);
  }
});
