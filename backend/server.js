import './env.js';
import express from 'express';
import cors from 'cors';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
import { all, get, run, batch } from './db.js';

const app = express();
// Na hospedagem, defina FRONTEND_URL (endereço do site) para aceitar requisições só dele.
app.use(cors(process.env.FRONTEND_URL ? { origin: process.env.FRONTEND_URL.replace(/\/$/, '') } : undefined));
app.use(express.json());

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha = (t) => createHash('sha256').update(t).digest('hex');
const hashPw = (pw, salt) => scryptSync(String(pw), salt, 32);
const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'hex') : Buffer.from(v)); // aceita texto (novo) ou blob (antigo)
const now = () => new Date().toISOString();

// Telefone brasileiro: DDD (11 a 99) + celular (9 + 8 dígitos) ou fixo (2 a 5 + 7 dígitos).
const normalizePhone = (raw) => {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return /^[1-9][1-9](9\d{8}|[2-5]\d{7})$/.test(d) ? d : null;
};

const authUser = async (req) => {
  const token = (req.get('authorization') || '').replace('Bearer ', '');
  return token ? get('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [sha(token)]) : undefined;
};
const startSession = async (u, res, status = 200) => {
  const token = randomBytes(32).toString('hex');
  await run('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)', [sha(token), u.id, now()]);
  res.status(status).json({ token, user: { name: u.name, email: u.email } });
};

const withItems = async (orders) => {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const items = await all(
    `SELECT order_id, cupcake_id AS id, name, qty FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`, ids);
  return orders.map((o) => ({
    id: o.id, customer: { name: o.customer_name, phone: o.customer_phone },
    total: o.total_cents / 100, createdAt: o.created_at,
    items: items.filter((i) => i.order_id === o.id).map(({ id, name, qty }) => ({ id, name, qty })),
  }));
};

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/cupcakes', wrap(async (_req, res) => {
  const rows = await all('SELECT * FROM cupcakes ORDER BY id');
  res.json(rows.map(({ description, price_cents, ...c }) => ({ ...c, desc: description, price: price_cents / 100 })));
}));

app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (!name || !/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 6)
    return res.status(400).json({ error: 'Informe nome, e-mail válido e senha com 6 ou mais caracteres.' });
  const key = email.toLowerCase();
  if (await get('SELECT id FROM users WHERE email = ?', [key])) return res.status(409).json({ error: 'Este e-mail já tem cadastro. Use Entrar.' });
  const nm = String(name).slice(0, 80);
  const salt = randomBytes(16);
  const info = await run('INSERT INTO users (name, email, salt, hash, created_at) VALUES (?, ?, ?, ?, ?)',
    [nm, key, salt.toString('hex'), hashPw(password, salt).toString('hex'), now()]);
  await startSession({ id: Number(info.lastInsertRowid), name: nm, email: key }, res, 201);
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body ?? {};
  const u = await get('SELECT * FROM users WHERE email = ?', [String(email || '').toLowerCase()]);
  if (!u || !timingSafeEqual(toBuf(u.hash), hashPw(password || '', toBuf(u.salt))))
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  await startSession(u, res);
}));

app.post('/api/orders', wrap(async (req, res) => {
  const { customer, items } = req.body ?? {};
  if (!customer?.name || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Informe nome e ao menos um cupcake.' });
  const phone = normalizePhone(customer.phone);
  if (!phone) return res.status(400).json({ error: 'Telefone inválido. Use DDD e número, ex.: (11) 99999-9999.' });

  let total = 0;
  const lines = [];
  for (const { id, qty } of items) {
    const c = Number.isInteger(id) ? await get('SELECT * FROM cupcakes WHERE id = ?', [id]) : undefined;
    if (!c || !Number.isInteger(qty) || qty < 1 || qty > 100) return res.status(400).json({ error: 'Item inválido.' });
    total += c.price_cents * qty; // preço sempre vem do banco
    lines.push({ c, qty });
  }
  const orderId = randomUUID().slice(0, 8);
  const user = await authUser(req);
  await batch([
    { sql: 'INSERT INTO orders (id, user_id, customer_name, customer_phone, total_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [orderId, user?.id ?? null, String(customer.name).slice(0, 80), phone, total, now()] },
    ...lines.map(({ c, qty }) => ({
      sql: 'INSERT INTO order_items (order_id, cupcake_id, name, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?)',
      args: [orderId, c.id, c.name, qty, c.price_cents] })),
  ]);
  console.log(`Pedido ${orderId} salvo: ${lines.length} item(ns), R$ ${(total / 100).toFixed(2)}, tel. ${phone}`);
  const [order] = await withItems(await all('SELECT * FROM orders WHERE id = ?', [orderId]));
  res.status(201).json(order);
}));

app.get('/api/my-orders', wrap(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Entre para ver seus pedidos.' });
  res.json(await withItems(await all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [u.id])));
}));

// ---- Painel do dono: exige a senha ADMIN_KEY no header x-admin-key ----
const adminOnly = (req, res, next) => {
  const key = process.env.ADMIN_KEY;
  if (!key) return res.status(503).json({ error: 'Painel desativado: defina ADMIN_KEY (arquivo backend/.env ou variável do servidor) e reinicie.' });
  const ok = timingSafeEqual(Buffer.from(sha(req.get('x-admin-key') || '')), Buffer.from(sha(key)));
  return ok ? next() : res.status(401).json({ error: 'Senha do painel incorreta.' });
};

// Mostra os 200 pedidos mais recentes.
app.get('/api/admin/orders', adminOnly, wrap(async (_req, res) =>
  res.json(await withItems(await all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200')))));

const parseCupcake = (body) => {
  const { name, desc, price, color, tag } = body ?? {};
  const n = String(name ?? '').trim(), d = String(desc ?? '').trim(), t = String(tag ?? '').trim();
  const cents = Math.round(Number(price) * 100);
  if (n.length < 2 || n.length > 60) return { error: 'O nome deve ter de 2 a 60 caracteres.' };
  if (d.length < 5 || d.length > 200) return { error: 'A descrição deve ter de 5 a 200 caracteres.' };
  if (!Number.isFinite(cents) || cents < 1 || cents > 999900) return { error: 'Preço inválido. Use um valor entre R$ 0,01 e R$ 9.999,00.' };
  if (!/^#[0-9a-fA-F]{6}$/.test(color ?? '')) return { error: 'Cor inválida.' };
  if (t.length > 20) return { error: 'A etiqueta pode ter até 20 caracteres.' };
  return { n, d, t: t || null, cents, color };
};
const toCupcake = (id, p) => ({ id, name: p.n, desc: p.d, price: p.cents / 100, color: p.color, tag: p.t });
const nameTaken = (n, id) => get('SELECT id FROM cupcakes WHERE lower(name) = lower(?) AND id != ?', [n, id]);

app.post('/api/admin/cupcakes', adminOnly, wrap(async (req, res) => {
  const p = parseCupcake(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  if (await nameTaken(p.n, 0)) return res.status(409).json({ error: 'Já existe um produto com esse nome.' });
  const info = await run('INSERT INTO cupcakes (name, description, price_cents, color, tag) VALUES (?, ?, ?, ?, ?)', [p.n, p.d, p.cents, p.color, p.t]);
  res.status(201).json(toCupcake(Number(info.lastInsertRowid), p));
}));

app.put('/api/admin/cupcakes/:id', adminOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !(await get('SELECT id FROM cupcakes WHERE id = ?', [id]))) return res.status(404).json({ error: 'Produto não encontrado.' });
  const p = parseCupcake(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  if (await nameTaken(p.n, id)) return res.status(409).json({ error: 'Já existe um produto com esse nome.' });
  await run('UPDATE cupcakes SET name = ?, description = ?, price_cents = ?, color = ?, tag = ? WHERE id = ?', [p.n, p.d, p.cents, p.color, p.t, id]);
  res.json(toCupcake(id, p));
}));

// Pedidos antigos guardam nome e preço da época da compra, então continuam intactos.
app.delete('/api/admin/cupcakes/:id', adminOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !(await run('DELETE FROM cupcakes WHERE id = ?', [id])).rowsAffected)
    return res.status(404).json({ error: 'Produto não encontrado.' });
  res.status(204).end();
}));

app.use((err, _req, res, _next) => {
  console.error('Erro:', err);
  res.status(500).json({ error: 'Erro interno ao salvar. Tente novamente.' });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API na porta ${port}`));
