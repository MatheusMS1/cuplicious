import { useEffect, useMemo, useState } from 'react';
import brand from './brand';
import Admin from './Admin';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const phoneDigits = (v) => { const d = v.replace(/\D/g, ''); return (d.length > 11 && d.startsWith('55') ? d.slice(2) : d).slice(0, 11); };
const validPhone = (d) => /^[1-9][1-9](9\d{8}|[2-5]\d{7})$/.test(d);
const maskPhone = (v) => {
  const d = phoneDigits(v), cut = d.length > 10 ? 7 : 6;
  return d.length <= 2 ? d : `(${d.slice(0, 2)}) ${d.slice(2, cut)}${d.length > cut ? '-' + d.slice(cut) : ''}`;
};
const stored = () => { try { return JSON.parse(localStorage.getItem('cl-user')); } catch { return null; } };

function Cupcake({ color, big }) {
  return (
    <svg viewBox="0 0 100 100" className={big ? 'cupcake big' : 'cupcake'} aria-hidden="true">
      <path d="M24 58h52l-7 32H31z" fill={brand.colors.black} />
      <ellipse cx="50" cy="54" rx="30" ry="11" fill={color} />
      <ellipse cx="50" cy="42" rx="23" ry="10" fill={color} />
      <ellipse cx="50" cy="31" rx="15" ry="9" fill={color} />
      <circle cx="50" cy="19" r="5" fill={brand.colors.black} />
    </svg>
  );
}

export default function App() {
  const [view, setView] = useState(() => (window.location.hash === '#painel' ? 'painel' : 'vitrine'));
  const [user, setUser] = useState(stored);
  const [cupcakes, setCupcakes] = useState([]);
  const [cart, setCart] = useState({});
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [auth, setAuth] = useState({ mode: 'login', name: '', email: '', password: '' });
  const [orders, setOrders] = useState([]);
  const [msg, setMsg] = useState('');

  const api = (path, opts = {}) => fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
  });
  const go = (v) => { setMsg(''); setView(v); };
  const logout = () => { localStorage.removeItem('cl-user'); setUser(null); setOrders([]); go('vitrine'); };

  useEffect(() => {
    fetch(`${API}/api/cupcakes`).then((r) => r.json()).then(setCupcakes).catch(() => setMsg('Não foi possível carregar o cardápio.'));
  }, [view]);

  useEffect(() => {
    if (view !== 'pedidos' || !user) return;
    api('/api/my-orders').then(async (r) => (r.ok ? setOrders(await r.json()) : logout()));
  }, [view]);

  const shown = cupcakes.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  const lines = useMemo(() => cupcakes.filter((c) => cart[c.id]).map((c) => ({ ...c, qty: cart[c.id] })), [cupcakes, cart]);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const change = (id, d) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) + d) }));

  async function sendOrder() {
    setMsg('');
    const phone = phoneDigits(form.phone);
    if (!validPhone(phone)) return setMsg('Digite um WhatsApp válido com DDD, ex.: (11) 99999-9999.');
    const customer = { name: form.name || user?.name || '', phone };
    try {
      const res = await api('/api/orders', { method: 'POST', body: JSON.stringify({ customer, items: lines.map((l) => ({ id: l.id, qty: l.qty })) }) });
      const data = await res.json();
      if (!res.ok) return setMsg(data.error);
      setCart({}); setMsg(`Pedido ${data.id} enviado! Entraremos em contato pelo WhatsApp.`);
    } catch {
      setMsg('Não foi possível enviar o pedido. Verifique se o servidor está rodando.');
    }
  }

  async function submitAuth(e) {
    e.preventDefault(); setMsg('');
    const { mode, ...body } = auth;
    const res = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error);
    const u = { token: data.token, name: data.user.name };
    localStorage.setItem('cl-user', JSON.stringify(u)); setUser(u); go('vitrine');
  }

  const c = brand.colors;
  return (
    <div style={{ '--pink': c.pink, '--black': c.black, '--soft': c.soft, '--blush': c.blush }}>
      <header className="top">
        <button className="brand" onClick={() => go('vitrine')}><Cupcake color={c.pink} /> {brand.name}</button>
        <nav>
          <button className={view === 'vitrine' ? 'on' : ''} onClick={() => go('vitrine')}>Vitrine</button>
          <button className={view === 'pedidos' ? 'on' : ''} onClick={() => go(user ? 'pedidos' : 'entrar')}>Meus pedidos</button>
          {user ? <button onClick={logout}>Sair</button> : <button className={view === 'entrar' ? 'on' : ''} onClick={() => go('entrar')}>Entrar</button>}
          <button className="cart-btn" onClick={() => setOpen(true)}>Carrinho <span className="badge">{count}</span></button>
        </nav>
      </header>

      {view === 'vitrine' && (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">{brand.eyebrow}</p>
              <h1>{brand.headline[0]}<br /><em>{brand.headline[1]}</em></h1>
              <p className="lead">{brand.text}</p>
              <a className="cta" href="#sabores">Explorar os sabores ↓</a>
            </div>
            <div className="art"><Cupcake color={c.blush} big /><span className="stamp">{brand.badge}</span></div>
          </section>

          <section id="sabores" className="shelf">
            <div className="shelf-head">
              <div><p className="eyebrow dark">Escolha o seu favorito</p><h2>Um sabor para cada vontade.</h2></div>
              <input type="search" placeholder="Qual sabor você procura?" aria-label="Buscar sabor" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {msg && <p role="status">{msg}</p>}
            <div className="grid">
              {shown.map((p) => (
                <article key={p.id} className="card">
                  <div className="pic">{p.tag && <span className="tag">{p.tag}</span>}<Cupcake color={p.color} big /></div>
                  <div className="info">
                    <div className="row"><h3>{p.name}</h3><div className="price"><b>{brl(p.price)}</b><small>/ unidade</small></div></div>
                    <p>{p.desc}</p>
                    <button className="add" onClick={() => { change(p.id, 1); setOpen(true); }}>Adicionar</button>
                  </div>
                </article>
              ))}
              {cupcakes.length > 0 && shown.length === 0 && <p>Nenhum sabor encontrado. Tente outro nome.</p>}
            </div>
          </section>
        </>
      )}

      {view === 'pedidos' && (
        <section className="page">
          <h2>Meus pedidos</h2>
          {orders.length === 0 && <p>Você ainda não fez pedidos. Escolha um sabor na vitrine.</p>}
          {orders.map((o) => (
            <div key={o.id} className="order">
              <b>Pedido {o.id}</b> · {new Date(o.createdAt).toLocaleDateString('pt-BR')}
              <p>{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
              <b>{brl(o.total)}</b>
            </div>
          ))}
        </section>
      )}

      {view === 'entrar' && (
        <section className="page">
          <h2>{auth.mode === 'login' ? 'Entrar' : 'Criar conta'}</h2>
          <form onSubmit={submitAuth} className="auth">
            {auth.mode === 'register' && <input placeholder="Seu nome" value={auth.name} onChange={(e) => setAuth({ ...auth, name: e.target.value })} />}
            <input type="email" placeholder="E-mail" value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
            <input type="password" placeholder="Senha (mínimo 6 caracteres)" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
            <button className="cta" type="submit">{auth.mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
          </form>
          {msg && <p role="alert">{msg}</p>}
          <button className="link" onClick={() => { setMsg(''); setAuth({ ...auth, mode: auth.mode === 'login' ? 'register' : 'login' }); }}>
            {auth.mode === 'login' ? 'Ainda não tenho conta' : 'Já tenho conta'}
          </button>
        </section>
      )}

      {view === 'painel' && <Admin onExit={() => go('vitrine')} />}

      <footer className="foot">
        <div><strong>{brand.name}</strong> · <a href={`https://wa.me/${brand.whatsapp}`}>WhatsApp</a> · {brand.instagram}</div>
        <button className="owner" onClick={() => go('painel')}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          Área do dono
        </button>
      </footer>

      {open && (
        <aside className="drawer" role="dialog" aria-label="Seu carrinho">
          <button className="close" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
          <h3>Seu carrinho</h3>
          {lines.length === 0 && <p>Seu carrinho está vazio. Escolha um sabor na vitrine.</p>}
          {lines.map((l) => (
            <div key={l.id} className="line">
              <span>{l.name}</span>
              <span><button onClick={() => change(l.id, -1)} aria-label="Menos">−</button> {l.qty} <button onClick={() => change(l.id, 1)} aria-label="Mais">+</button></span>
            </div>
          ))}
          {lines.length > 0 && (
            <>
              <p className="total">Total: {brl(total)}</p>
              <input placeholder="Seu nome" defaultValue={user?.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="WhatsApp com DDD" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} />
              <button className="cta" onClick={sendOrder}>Enviar pedido</button>
            </>
          )}
          {msg && <p role="status">{msg}</p>}
        </aside>
      )}
    </div>
  );
}
