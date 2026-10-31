import './env.js';
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';

// Sem variáveis da Turso, usa o arquivo local cuplicious.db (desenvolvimento).
// Com TURSO_DATABASE_URL e TURSO_AUTH_TOKEN, usa o banco hospedado na Turso.
const local = 'file:' + fileURLToPath(new URL('./cuplicious.db', import.meta.url));
const db = createClient({ url: process.env.TURSO_DATABASE_URL || local, authToken: process.env.TURSO_AUTH_TOKEN });
console.log('Banco de dados:', process.env.TURSO_DATABASE_URL ? 'Turso (hospedado)' : local);

const toObjects = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c) => [c, r[c]])));
export const all = async (sql, args = []) => toObjects(await db.execute({ sql, args }));
export const get = async (sql, args = []) => (await all(sql, args))[0];
export const run = (sql, args = []) => db.execute({ sql, args });
export const batch = (stmts) => db.batch(stmts, 'write'); // tudo ou nada

await batch([
  `CREATE TABLE IF NOT EXISTS cupcakes (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
    price_cents INTEGER NOT NULL, color TEXT NOT NULL, tag TEXT)`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    salt TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id),
    customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, total_cents INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    cupcake_id INTEGER NOT NULL, name TEXT NOT NULL, qty INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)',
]);

// Cardápio inicial: só é gravado se a tabela estiver vazia.
const seed = [
  [1, 'Framboesa Pop', 'Baunilha, creme de framboesa e chocolate branco.', 950, '#FF3D9A', 'Mais pedido'],
  [2, 'Pistache Chic', 'Massa de pistache com cobertura de cream cheese.', 1100, '#8FCB9B', null],
  [3, 'Brigadeiro Real', 'Chocolate 50% recheado com brigadeiro cremoso.', 1000, '#B9694F', null],
  [4, 'Limão Siciliano', 'Massa cítrica, glacê de limão e raspas.', 900, '#F5C842', 'Novo'],
  [5, 'Doce de Leite', 'Massa amanteigada recheada com doce de leite cremoso.', 1050, '#D9964B', null],
  [6, 'Morango com Chantilly', 'Baunilha, chantilly de morango e pedacinhos da fruta.', 1050, '#E5484D', null],
  [7, 'Red Velvet', 'Massa aveludada com cobertura de cream cheese.', 1200, '#B3123B', 'Favorito'],
  [8, 'Cookies & Cream', 'Massa de chocolate, creme de baunilha e farelo de biscoito.', 1100, '#8E8E93', null],
];
if ((await get('SELECT COUNT(*) AS n FROM cupcakes')).n === 0) {
  await batch(seed.map((args) => ({
    sql: 'INSERT INTO cupcakes (id, name, description, price_cents, color, tag) VALUES (?, ?, ?, ?, ?, ?)', args,
  })));
}
