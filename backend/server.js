import './env.js';
import express from 'express';
import cors from 'cors';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash, randomInt } from 'crypto';
import { all, get, run, batch } from './db.js';

const app = express();
app.set('trust proxy', 1); 
app.use(cors(process.env.FRONTEND_URL ? { origin: process.env.FRONTEND_URL.replace(/\/$/, '') } : undefined));
app.use(express.json());

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha = (t) => createHash('sha256').update(t).digest('hex');
const hashPw = (pw, salt) => scryptSync(String(pw), salt, 32);
const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'hex') : Buffer.from(v)); 
const now = () => new Date().toISOString();


const normAnswer = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const parseQA = (q, a) => {
  const question = String(q || '').trim(), answer = normAnswer(a);
  if (question.length < 8 || question.length > 120) return { error: 'A pergunta de segurança deve ter de 8 a 120 caracteres.' };
  if (answer.length < 3 || answer.length > 80) return { error: 'A resposta deve ter de 3 a 80 caracteres.' };
  return { question, answer };
};
const FAKE_Q = ['Qual era o nome do seu primeiro bichinho de estimação?', 'Em que cidade você nasceu?', 'Qual era o seu apelido de infância?',
  'Qual era o nome da sua escola primária?', 'Qual é a sua comida favorita?'];


const fails = new Map();
const blocked = (k, max = 5) => { const f = fails.get(k); return f && f.n >= max && Date.now() < f.until; };
const addFail = (k) => { const f = fails.get(k), t = Date.now(); f && t < f.until ? f.n++ : fails.set(k, { n: 1, until: t + 15 * 60 * 1000 }); };
const tooMany = (res) => res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' });

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
const startSession = async (u, res, status = 200, extra = {}) => {
  const token = randomBytes(32).toString('hex');
  await run('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)', [sha(token), u.id, now()]);
  res.status(status).json({ token, user: { name: u.name, email: u.email }, ...extra });
};

const withItems = async (orders) => {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const items = await all(
    `SELECT order_id, cupcake_id AS id, name, qty FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`, ids);
  return orders.map((o) => ({
    id: o.id, customer: { name: o.customer_name, phone: o.customer_phone },
    total: o.total_cents / 100, createdAt: o.created_at, status: o.status,
    items: items.filter((i) => i.order_id === o.id).map(({ id, name, qty }) => ({ id, name, qty })),
  }));
};

const toList = (rows) => rows.map(({ description, price_cents, active, ...c }) => ({ ...c, desc: description, price: price_cents / 100, active: !!active }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/cupcakes', wrap(async (_req, res) => {
  res.json(toList(await all('SELECT * FROM cupcakes WHERE active = 1 ORDER BY id')));
}));

app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (!name || !/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 6)
    return res.status(400).json({ error: 'Informe nome, e-mail válido e senha com 6 ou mais caracteres.' });
  const key = email.toLowerCase();
  if (await get('SELECT id FROM users WHERE email = ?', [key])) return res.status(409).json({ error: 'Este e-mail já tem cadastro. Use Entrar.' });
  const nm = String(name).slice(0, 80);
  const salt = randomBytes(16);
  const qa = parseQA(req.body.question, req.body.answer);
  if (qa.error) return res.status(400).json({ error: qa.error });
  const qsalt = randomBytes(16);
  const info = await run('INSERT INTO users (name, email, salt, hash, created_at, sec_question, sec_salt, sec_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [nm, key, salt.toString('hex'), hashPw(password, salt).toString('hex'), now(), qa.question, qsalt.toString('hex'), hashPw(qa.answer, qsalt).toString('hex')]);
  await startSession({ id: Number(info.lastInsertRowid), name: nm, email: key }, res, 201);
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body ?? {};
  const mail = String(email || '').toLowerCase(), k = `login:${req.ip}:${mail}`;
  if (blocked(k)) return tooMany(res);
  const u = await get('SELECT * FROM users WHERE email = ?', [mail]);
  if (!u || !timingSafeEqual(toBuf(u.hash), hashPw(password || '', toBuf(u.salt)))) {
    addFail(k);
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }
  fails.delete(k);
  await startSession(u, res);
}));

app.get('/api/auth/profile', wrap(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
  res.json({ name: u.name, email: u.email, securityQuestion: u.sec_question || '' });
}));

app.put('/api/auth/profile', wrap(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'O nome deve ter de 2 a 80 caracteres.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  const existing = await get('SELECT id FROM users WHERE email = ? AND id != ?', [email, u.id]);
  if (existing) return res.status(409).json({ error: 'Este e-mail já está sendo utilizado por outra conta.' });
  await run('UPDATE users SET name = ?, email = ? WHERE id = ?', [name, email, u.id]);
  res.json({ name, email });
}));

app.post('/api/auth/change-password', wrap(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
  const { currentPassword, newPassword } = req.body ?? {};
  const key = `change-password:${req.ip}:${u.id}`;
  if (blocked(key)) return tooMany(res);
  if (!timingSafeEqual(toBuf(u.hash), hashPw(currentPassword || '', toBuf(u.salt)))) {
    addFail(key);
    return res.status(401).json({ error: 'A senha atual está incorreta.' });
  }
  if (String(newPassword || '').length < 6 || String(newPassword).length > 128)
    return res.status(400).json({ error: 'A nova senha deve ter entre 6 e 128 caracteres.' });
  if (String(currentPassword) === String(newPassword))
    return res.status(400).json({ error: 'A nova senha deve ser diferente da senha atual.' });
  fails.delete(key);
  const salt = randomBytes(16);
  await run('UPDATE users SET salt = ?, hash = ? WHERE id = ?', [salt.toString('hex'), hashPw(newPassword, salt).toString('hex'), u.id]);

  const token = (req.get('authorization') || '').replace('Bearer ', '');
  await run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [u.id, sha(token)]);
  res.json({ ok: true });
}));

app.post('/api/orders', wrap(async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error: 'Você precisa entrar na sua conta para realizar um pedido.' });

  const { customer, items } = req.body ?? {};
  if (!customer?.name || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Informe nome e ao menos um cupcake.' });
  const phone = normalizePhone(customer.phone);
  if (!phone) return res.status(400).json({ error: 'Telefone inválido. Use DDD e número, ex.: (11) 99999-9999.' });

  let total = 0;
  const lines = [];
  for (const { id, qty } of items) {
    const c = Number.isInteger(id) ? await get('SELECT * FROM cupcakes WHERE id = ? AND active = 1', [id]) : undefined;
    if (!c || !Number.isInteger(qty) || qty < 1 || qty > 100) return res.status(400).json({ error: 'Item inválido.' });
    total += c.price_cents * qty;
    lines.push({ c, qty });
  }
  const requestKey = String(req.get('Idempotency-Key') || req.body?.requestKey || '').trim();
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(requestKey))
    return res.status(400).json({ error: 'Chave de envio inválida. Atualize a página e tente novamente.' });

  // A chave única por cliente impede a criação de dois pedidos quando o navegador
  // reenvia a mesma solicitação (duplo clique, timeout ou repetição de rede).
  const previous = await get('SELECT * FROM orders WHERE user_id = ? AND request_key = ?', [user.id, requestKey]);
  if (previous) {
    const [order] = await withItems([previous]);
    return res.json(order);
  }

  const orderId = randomUUID().slice(0, 8);
  try {
    await batch([
      { sql: 'INSERT INTO orders (id, user_id, customer_name, customer_phone, total_cents, created_at, claim_hash, request_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [orderId, user.id, String(customer.name || user.name).slice(0, 80), phone, total, now(), null, requestKey] },
      ...lines.map(({ c, qty }) => ({
        sql: 'INSERT INTO order_items (order_id, cupcake_id, name, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?)',
        args: [orderId, c.id, c.name, qty, c.price_cents] })),
    ]);
  } catch (error) {
    // Se duas requisições idênticas chegarem simultaneamente, a restrição UNIQUE
    // garante que apenas uma grave; a outra devolve o pedido já criado.
    const duplicate = await get('SELECT * FROM orders WHERE user_id = ? AND request_key = ?', [user.id, requestKey]);
    if (!duplicate) throw error;
    const [order] = await withItems([duplicate]);
    return res.json(order);
  }
  console.log(`Pedido ${orderId} salvo: ${lines.length} item(ns), R$ ${(total / 100).toFixed(2)}, tel. ${phone}`);
  const [order] = await withItems(await all('SELECT * FROM orders WHERE id = ?', [orderId]));
  res.status(201).json(order);
}));

app.get('/api/my-orders', wrap(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Entre para ver seus pedidos.' });
  res.json(await withItems(await all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [u.id])));
}));

const adminOnly = (req, res, next) => {
  const key = process.env.ADMIN_KEY;
  if (!key) return res.status(503).json({ error: 'Painel desativado: defina ADMIN_KEY (arquivo backend/.env ou variável do servidor) e reinicie.' });
  const k = `admin:${req.ip}`;
  if (blocked(k)) return tooMany(res);
  const ok = timingSafeEqual(Buffer.from(sha(req.get('x-admin-key') || '')), Buffer.from(sha(key)));
  if (!ok) addFail(k);
  return ok ? next() : res.status(401).json({ error: 'Senha do painel incorreta.' });
};

const STATUS = ['novo', 'em_preparo', 'entregue', 'cancelado'];
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

app.get('/api/admin/orders', adminOnly, wrap(async (req, res) => {
  const { search = '', from = '', to = '', status = '' } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1), size = 20;
  const w = [], a = [];
  if (search) { w.push('(customer_name LIKE ? OR customer_phone LIKE ?)'); a.push(`%${search}%`, `%${search.replace(/\D/g, '') || search}%`); }
  if (isDate(from)) { w.push('created_at >= ?'); a.push(new Date(`${from}T00:00:00-03:00`).toISOString()); }
  if (isDate(to)) { w.push('created_at <= ?'); a.push(new Date(`${to}T23:59:59.999-03:00`).toISOString()); }
  if (STATUS.includes(status)) { w.push('status = ?'); a.push(status); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const sum = await get(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status != 'cancelado' THEN total_cents END), 0) AS sales FROM orders ${where}`, a);
  const rows = await all(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...a, size, (page - 1) * size]);
  res.json({ orders: await withItems(rows), total: sum.n, sales: sum.sales / 100, page, pages: Math.max(1, Math.ceil(sum.n / size)) });
}));

app.patch('/api/admin/orders/:id/status', adminOnly, wrap(async (req, res) => {
  if (!STATUS.includes(req.body?.status)) return res.status(400).json({ error: 'Status inválido.' });
  const r = await run('UPDATE orders SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
  r.rowsAffected ? res.json({ ok: true }) : res.status(404).json({ error: 'Pedido não encontrado.' });
}));

app.get('/api/admin/reports/top-flavors', adminOnly, wrap(async (req, res) => {
  const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const rows = await all(`
    SELECT oi.cupcake_id AS id, oi.name, SUM(oi.qty) AS quantity,
           SUM(oi.qty * oi.unit_price_cents) AS revenue_cents
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status != 'cancelado'
    GROUP BY oi.cupcake_id, oi.name
    ORDER BY quantity DESC, revenue_cents DESC, oi.name ASC
    LIMIT ?`, [limit]);
  res.json(rows.map((r) => ({ id: r.id, name: r.name, quantity: r.quantity, revenue: r.revenue_cents / 100 })));
}));

app.get('/api/admin/cupcakes', adminOnly, wrap(async (_req, res) => res.json(toList(await all('SELECT * FROM cupcakes ORDER BY id')))));

app.patch('/api/admin/cupcakes/:id/active', adminOnly, wrap(async (req, res) => {
  const r = await run('UPDATE cupcakes SET active = ? WHERE id = ?', [req.body?.active ? 1 : 0, Number(req.params.id)]);
  r.rowsAffected ? res.json({ ok: true }) : res.status(404).json({ error: 'Produto não encontrado.' });
}));

app.post('/api/admin/reset-code', adminOnly, wrap(async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase();
  if (!(await get('SELECT id FROM users WHERE email = ?', [email]))) return res.status(404).json({ error: 'Nenhuma conta com esse e-mail.' });
  const code = String(randomInt(100000, 1000000));
  await run('INSERT OR REPLACE INTO password_resets (email, code_hash, expires_at) VALUES (?, ?, ?)', [email, sha(code), new Date(Date.now() + 3600e3).toISOString()]);
  res.json({ code });
}));

app.post('/api/auth/question', wrap(async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase();
  const u = await get('SELECT sec_question FROM users WHERE email = ?', [email]);
  res.json({ question: u?.sec_question || FAKE_Q[parseInt(sha(email).slice(0, 6), 16) % FAKE_Q.length] });
}));

app.post('/api/auth/reset', wrap(async (req, res) => {
  const { email, answer, password } = req.body ?? {};
  const key = String(email || '').toLowerCase(), k1 = `reset:${req.ip}:${key}`, k2 = `reset:${key}`;
  if (blocked(k1) || blocked(k2, 10)) return tooMany(res);
  if (String(password || '').length < 6) return res.status(400).json({ error: 'A nova senha precisa ter 6 ou mais caracteres.' });
  const given = normAnswer(answer);
  const u = await get('SELECT id, sec_salt, sec_hash FROM users WHERE email = ?', [key]);
  const r = await get('SELECT * FROM password_resets WHERE email = ?', [key]);
  const okAnswer = u && u.sec_hash && timingSafeEqual(toBuf(u.sec_hash), hashPw(given, toBuf(u.sec_salt)));
  const okTemp = u && r && r.expires_at >= now() && r.code_hash === sha(given);
  if (!okAnswer && !okTemp) { addFail(k1); addFail(k2); return res.status(400).json({ error: 'Resposta incorreta. Confira o e-mail e tente de novo.' }); }
  fails.delete(k1); fails.delete(k2);
  const salt = randomBytes(16);
  await batch([
    { sql: 'UPDATE users SET salt = ?, hash = ? WHERE id = ?', args: [salt.toString('hex'), hashPw(password, salt).toString('hex'), u.id] },
    { sql: 'DELETE FROM sessions WHERE user_id = ?', args: [u.id] },
    { sql: 'DELETE FROM password_resets WHERE email = ?', args: [key] },
  ]);
  res.json({ ok: true });
}));

app.post('/api/auth/security', wrap(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Entre para salvar a pergunta.' });
  const k = `security:${req.ip}:${u.id}`;
  if (blocked(k)) return tooMany(res);
  if (!timingSafeEqual(toBuf(u.hash), hashPw(req.body?.password || '', toBuf(u.salt)))) { addFail(k); return res.status(401).json({ error: 'Senha incorreta.' }); }
  const qa = parseQA(req.body?.question, req.body?.answer);
  if (qa.error) return res.status(400).json({ error: qa.error });
  const salt = randomBytes(16);
  await run('UPDATE users SET sec_question = ?, sec_salt = ?, sec_hash = ? WHERE id = ?', [qa.question, salt.toString('hex'), hashPw(qa.answer, salt).toString('hex'), u.id]);
  res.json({ ok: true });
}));

app.post('/api/orders/claim', wrap(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Entre para ver seus pedidos.' });
  for (const { id, claim } of (Array.isArray(req.body?.orders) ? req.body.orders : []).slice(0, 50))
    if (id && claim) await run('UPDATE orders SET user_id = ?, claim_hash = NULL WHERE id = ? AND user_id IS NULL AND claim_hash = ?', [u.id, String(id), sha(String(claim))]);
  res.json({ ok: true });
}));

const parseCupcake = (body) => {
  const { name, desc, price, color, tag } = body ?? {};
  const n = String(name ?? '').trim(), d = String(desc ?? '').trim(), t = String(tag ?? '').trim();
  const category = String(body?.category || 'classicos');
  const cents = Math.round(Number(price) * 100);
  if (n.length < 2 || n.length > 60) return { error: 'O nome deve ter de 2 a 60 caracteres.' };
  if (d.length < 5 || d.length > 200) return { error: 'A descrição deve ter de 5 a 200 caracteres.' };
  if (!Number.isFinite(cents) || cents < 1 || cents > 999900) return { error: 'Preço inválido. Use um valor entre R$ 0,01 e R$ 9.999,00.' };
  if (!/^#[0-9a-fA-F]{6}$/.test(color ?? '')) return { error: 'Cor inválida.' };
  if (t.length > 20) return { error: 'A etiqueta pode ter até 20 caracteres.' };
  if (!['classicos', 'especiais', 'sem_gluten'].includes(category)) return { error: 'Selecione uma categoria válida.' };
  return { n, d, t: t || null, cents, color, category };
};
const toCupcake = (id, p) => ({ id, name: p.n, desc: p.d, price: p.cents / 100, color: p.color, tag: p.t, category: p.category });
const nameTaken = (n, id) => get('SELECT id FROM cupcakes WHERE lower(name) = lower(?) AND id != ?', [n, id]);

app.post('/api/admin/cupcakes', adminOnly, wrap(async (req, res) => {
  const p = parseCupcake(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  if (await nameTaken(p.n, 0)) return res.status(409).json({ error: 'Já existe um produto com esse nome.' });
  const info = await run('INSERT INTO cupcakes (name, description, price_cents, color, tag, category) VALUES (?, ?, ?, ?, ?, ?)', [p.n, p.d, p.cents, p.color, p.t, p.category]);
  res.status(201).json(toCupcake(Number(info.lastInsertRowid), p));
}));

app.put('/api/admin/cupcakes/:id', adminOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !(await get('SELECT id FROM cupcakes WHERE id = ?', [id]))) return res.status(404).json({ error: 'Produto não encontrado.' });
  const p = parseCupcake(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  if (await nameTaken(p.n, id)) return res.status(409).json({ error: 'Já existe um produto com esse nome.' });
  await run('UPDATE cupcakes SET name = ?, description = ?, price_cents = ?, color = ?, tag = ?, category = ? WHERE id = ?', [p.n, p.d, p.cents, p.color, p.t, p.category, id]);
  res.json(toCupcake(id, p));
}));

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
