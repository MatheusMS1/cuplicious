import { useEffect, useMemo, useRef, useState } from 'react';
import brand from './brand';
import Admin from './Admin';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_LABEL = { novo: 'Novo', em_preparo: 'Em preparo', entregue: 'Entregue', cancelado: 'Cancelado' };
const CATEGORY_LABEL = { classicos: 'Clássicos', especiais: 'Especiais', sem_gluten: 'Sem glúten' };
const phoneDigits = (v) => { const d = v.replace(/\D/g, ''); return (d.length > 11 && d.startsWith('55') ? d.slice(2) : d).slice(0, 11); };
const validPhone = (d) => /^[1-9][1-9](9\d{8}|[2-5]\d{7})$/.test(d);
const maskPhone = (v) => {
  const d = phoneDigits(v), cut = d.length > 10 ? 7 : 6;
  return d.length <= 2 ? d : `(${d.slice(0, 2)}) ${d.slice(2, cut)}${d.length > cut ? '-' + d.slice(cut) : ''}`;
};
const stored = () => { try { return JSON.parse(localStorage.getItem('cl-user')); } catch { return null; } };

const blankAuth = { mode: 'login', name: '', email: '', password: '', question: '', answer: '' };

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
  const [cart, setCart] = useState(() => { try { return JSON.parse(localStorage.getItem('cl-cart')) || {}; } catch { return {}; } });
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('todos');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const requestKeyRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [auth, setAuth] = useState(blankAuth);
  const [orders, setOrders] = useState([]);
  const [msg, setMsg] = useState('');

  const [fq, setFq] = useState('');
  const [sec, setSec] = useState({ password: '', question: '', answer: '' });
  const [profile, setProfile] = useState({ name: '', email: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  useEffect(() => { try { localStorage.setItem('cl-cart', JSON.stringify(cart)); } catch { /* ignora */ } }, [cart]);

  const api = (path, opts = {}) => fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(opts.headers || {}) },
  });
  const go = (v) => { setMsg(''); if (v === 'entrar') { setAuth(blankAuth); setFq(''); } setView(v); }; // tela de entrar sempre começa limpa
  const logout = () => { localStorage.removeItem('cl-user'); setUser(null); setOrders([]); setAuth(blankAuth); setFq(''); setSec({ password: '', question: '', answer: '' }); go('vitrine'); };

  useEffect(() => {
    fetch(`${API}/api/cupcakes`)
      .then(async (r) => { const d = await r.json(); if (!r.ok || !Array.isArray(d)) throw new Error(); setCupcakes(d); })
      .catch(() => setMsg('Não foi possível carregar o cardápio.'));
  }, [view]);

  useEffect(() => {
    if (view !== 'pedidos' || !user) return undefined;
    const load = () => api('/api/my-orders').then(async (r) => (r.ok ? setOrders(await r.json()) : logout())).catch(() => setMsg('Não foi possível atualizar seus pedidos.'));
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [view, user?.token]);

  useEffect(() => {
    if (view !== 'perfil' || !user) return;
    api('/api/auth/profile').then(async (r) => {
      const data = await r.json();
      if (r.ok) {
        setProfile({ name: data.name || '', email: data.email || '' });
        setSec((current) => ({ ...current, question: data.securityQuestion || '' }));
      }
      else setMsg(data.error || 'Não foi possível carregar o perfil.');
    }).catch(() => setMsg('Não foi possível conectar ao servidor.'));
  }, [view, user?.token]);

  const shown = cupcakes.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) && (categoryFilter === 'todos' || (c.category || 'classicos') === categoryFilter));
  const lines = useMemo(() => cupcakes.filter((c) => cart[c.id]).map((c) => ({ ...c, qty: cart[c.id] })), [cupcakes, cart]);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const change = (id, d) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) + d) }));

  async function sendOrder() {
    if (sendingRef.current) return;
    if (!user?.token) {
      setMsg('Entre na sua conta para finalizar o pedido.');
      setOpen(false);
      go('entrar');
      return;
    }
    if (!lines.length) return setMsg('Adicione ao menos um produto ao carrinho.');
    const phone = phoneDigits(form.phone);
    if (!validPhone(phone)) return setMsg('Digite um WhatsApp válido com DDD, ex.: (11) 99999-9999.');

    // Bloqueio síncrono no ref evita que dois cliques no mesmo instante disparem dois POSTs.
    sendingRef.current = true;
    setSending(true);
    setMsg('Enviando seu pedido...');
    if (!requestKeyRef.current) {
      requestKeyRef.current = globalThis.crypto?.randomUUID?.() || `pedido-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    }
    const customer = { name: form.name || user.name || '', phone };
    try {
      const res = await api('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKeyRef.current },
        body: JSON.stringify({ customer, items: lines.map((l) => ({ id: l.id, qty: l.qty })) }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || 'Não foi possível enviar o pedido.'); return; }
      requestKeyRef.current = null;
      setCart({});
      setMsg(`Pedido ${data.id} enviado! Você pode acompanhar o status em Meus pedidos.`);
      setOrders((current) => [data, ...current.filter((order) => order.id !== data.id)]);
    } catch {
      setMsg('Não foi possível confirmar o envio. Tente novamente; não será criado outro pedido se este já tiver sido registrado.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function saveSecurity(e) {
    e.preventDefault(); setMsg('');
    try {
      const res = await api('/api/auth/security', { method: 'POST', body: JSON.stringify(sec) });
      const data = await res.json();
      if (!res.ok) return setMsg(data.error || 'Não foi possível atualizar a pergunta de segurança.');
      setSec((current) => ({ password: '', question: current.question, answer: '' }));
      setMsg('Pergunta e resposta de segurança atualizadas com sucesso!');
    } catch {
      setMsg('Não foi possível conectar ao servidor.');
    }
  }

  async function saveProfile(e) {
    e.preventDefault(); setMsg('');
    try {
      const res = await api('/api/auth/profile', { method: 'PUT', body: JSON.stringify(profile) });
      const data = await res.json();
      if (!res.ok) return setMsg(data.error || 'Não foi possível atualizar o perfil.');
      const updated = { ...user, name: data.name, email: data.email };
      localStorage.setItem('cl-user', JSON.stringify(updated)); setUser(updated);
      setProfile({ name: data.name, email: data.email });
      setMsg('Dados do perfil atualizados com sucesso!');
    } catch { setMsg('Não foi possível conectar ao servidor.'); }
  }

  async function changePassword(e) {
    e.preventDefault(); setMsg('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) return setMsg('A confirmação da nova senha não confere.');
    if (passwordForm.newPassword.length < 6) return setMsg('A nova senha deve ter pelo menos 6 caracteres.');
    try {
      const res = await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }) });
      const data = await res.json();
      if (!res.ok) return setMsg(data.error || 'Não foi possível alterar a senha.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMsg('Senha alterada com sucesso!');
    } catch { setMsg('Não foi possível conectar ao servidor.'); }
  }

  async function submitAuth(e) {
    e.preventDefault(); setMsg('');
    const { mode, question, answer, name, email, password } = auth;
    try {
      if (mode === 'forgot' && !fq) {
        const r = await api('/api/auth/question', { method: 'POST', body: JSON.stringify({ email }) });
        const d = await r.json();
        return r.ok ? setFq(d.question) : setMsg(d.error);
      }
      const body = mode === 'register' ? { name, email, password, question, answer } : mode === 'forgot' ? { email, password, answer } : { email, password };
      const res = await api(`/api/auth/${mode === 'forgot' ? 'reset' : mode}`, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) return setMsg(data.error);
      if (mode === 'forgot') { setFq(''); setAuth({ ...auth, mode: 'login', password: '', answer: '' }); return setMsg('Senha alterada! Agora entre com a nova senha.'); }
      const u = { token: data.token, name: data.user.name, email: data.user.email };
      localStorage.setItem('cl-user', JSON.stringify(u)); setUser(u); setAuth(blankAuth); setFq(''); go('vitrine');
    } catch { setMsg('Não foi possível conectar ao servidor.'); }
  }

  const c = brand.colors;
  return (
    <div style={{ '--pink': c.pink, '--black': c.black, '--soft': c.soft, '--blush': c.blush }}>
      <header className="top">
        <button className="brand" onClick={() => go('vitrine')}><Cupcake color={c.pink} /> {brand.name}</button>
        <nav>
          <button className={view === 'vitrine' ? 'on' : ''} onClick={() => go('vitrine')}>Vitrine</button>
          <button className={view === 'pedidos' ? 'on' : ''} onClick={() => go(user ? 'pedidos' : 'entrar')}>Meus pedidos</button>
          {user ? <><button className={view === 'perfil' ? 'on' : ''} onClick={() => go('perfil')}>Meu perfil</button><button onClick={logout}>Sair</button></> : <button className={view === 'entrar' ? 'on' : ''} onClick={() => go('entrar')}>Entrar</button>}
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
            <div className="category-filters" aria-label="Filtrar por categoria">
              {[['todos', 'Todos'], ...Object.entries(CATEGORY_LABEL)].map(([value, label]) => <button key={value} className={categoryFilter === value ? 'on' : ''} onClick={() => setCategoryFilter(value)}>{label}</button>)}
            </div>
            <div className="grid">
              {shown.map((p) => (
                <article key={p.id} className="card">
                  <div className="pic">{p.tag && <span className="tag">{p.tag}</span>}<span className="category-tag">{CATEGORY_LABEL[p.category || 'classicos']}</span><Cupcake color={p.color} big /></div>
                  <div className="info">
                    <div className="row"><h3>{p.name}</h3><div className="price"><b>{brl(p.price)}</b><small>/ unidade</small></div></div>
                    <p>{p.desc}</p>
                    {cart[p.id] ? (
                      <div className="step"><button onClick={() => change(p.id, -1)} aria-label="Menos">−</button><b>{cart[p.id]}</b><button onClick={() => change(p.id, 1)} aria-label="Mais">+</button></div>
                    ) : (
                      <button className="add" onClick={() => change(p.id, 1)}>Adicionar</button>
                    )}
                  </div>
                </article>
              ))}
              {cupcakes.length > 0 && shown.length === 0 && <p>Nenhum sabor encontrado. Tente outro nome.</p>}
            </div>
          </section>
        </>
      )}

      {view === 'perfil' && user && (
        <section className="page">
          <h2>Meu perfil</h2>
          <p>Atualize seus dados de acesso e mantenha sua conta em dia.</p>
          <form className="auth" onSubmit={saveProfile}>
            <h3>Dados pessoais</h3>
            <input placeholder="Seu nome" maxLength={80} required value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            <input type="email" placeholder="E-mail" required value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
            <button className="cta" type="submit">Salvar alterações</button>
          </form>
          <form className="auth profile-password" onSubmit={changePassword}>
            <h3>Alterar senha</h3>
            <input type="password" placeholder="Senha atual" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} />
            <input type="password" placeholder="Nova senha (mínimo 6 caracteres)" autoComplete="new-password" minLength={6} required value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} />
            <input type="password" placeholder="Confirme a nova senha" autoComplete="new-password" minLength={6} required value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} />
            <button className="cta" type="submit">Alterar senha</button>
          </form>
          <form className="auth profile-password" onSubmit={saveSecurity}>
            <h3>Pergunta e resposta de segurança</h3>
            <p className="hint">Esses dados serão usados para recuperar sua conta caso esqueça a senha. Para sua segurança, confirme sua senha atual.</p>
            <input placeholder="Pergunta de segurança" minLength={8} maxLength={120} required value={sec.question} onChange={(e) => setSec({ ...sec, question: e.target.value })} />
            <input placeholder="Nova resposta de segurança" minLength={3} maxLength={80} required value={sec.answer} onChange={(e) => setSec({ ...sec, answer: e.target.value })} />
            <input type="password" placeholder="Senha atual" autoComplete="current-password" required value={sec.password} onChange={(e) => setSec({ ...sec, password: e.target.value })} />
            <button className="cta" type="submit">Salvar pergunta e resposta</button>
          </form>
          {msg && <p role="status">{msg}</p>}
        </section>
      )}

      {view === 'pedidos' && (
        <section className="page">
          <h2>Meus pedidos</h2>
          {orders.length === 0 && <p>Você ainda não fez pedidos. Escolha um sabor na vitrine.</p>}
          {orders.map((o) => (
            <div key={o.id} className="order">
              <div className="customer-order-head"><b>Pedido {o.id}</b><span className={`status-pill status-${o.status || 'novo'}`}>Status: {STATUS_LABEL[o.status] || o.status}</span></div>
              <small>{new Date(o.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>
              <p>{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
              <b>{brl(o.total)}</b>
            </div>
          ))}
          {msg && <p role="alert">{msg}</p>}
        </section>
      )}

      {view === 'entrar' && (
        <section className="page">
          <h2>{{ login: 'Entrar', register: 'Criar conta', forgot: 'Redefinir senha' }[auth.mode]}</h2>
          {auth.mode === 'forgot' && <p>{fq ? 'Responda à sua pergunta de segurança e escolha a nova senha.' : 'Digite o e-mail da sua conta para ver a pergunta de segurança.'}</p>}
          <form onSubmit={submitAuth} className="auth">
            {auth.mode === 'register' && <input placeholder="Seu nome" value={auth.name} onChange={(e) => setAuth({ ...auth, name: e.target.value })} />}
            <input type="email" placeholder="E-mail" value={auth.email} disabled={auth.mode === 'forgot' && !!fq} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
            {auth.mode !== 'forgot' && <input type="password" placeholder="Senha (mínimo 6 caracteres)" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />}
            {auth.mode === 'register' && (
              <>
                <p className="hint">Escolha uma pergunta que só você saiba responder. Ela será usada se você esquecer a senha. Evite respostas fáceis de adivinhar.</p>
                <input placeholder="Sua pergunta de segurança (ex.: Qual era o nome do meu primeiro cachorro?)" maxLength={120} value={auth.question} onChange={(e) => setAuth({ ...auth, question: e.target.value })} />
                <input placeholder="Resposta (não diferencia maiúsculas nem acentos)" maxLength={80} value={auth.answer} onChange={(e) => setAuth({ ...auth, answer: e.target.value })} />
              </>
            )}
            {auth.mode === 'forgot' && fq && (
              <>
                <p><b>{fq}</b></p>
                <input placeholder="Sua resposta" maxLength={80} value={auth.answer} onChange={(e) => setAuth({ ...auth, answer: e.target.value })} />
                <input type="password" placeholder="Nova senha (mínimo 6 caracteres)" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
              </>
            )}
            <button className="cta" type="submit">{auth.mode === 'login' ? 'Entrar' : auth.mode === 'register' ? 'Criar conta' : fq ? 'Salvar nova senha' : 'Ver minha pergunta'}</button>
          </form>
          {msg && <p role="alert">{msg}</p>}
          <p>
            <button className="link" onClick={() => { setMsg(''); setFq(''); setAuth({ ...auth, mode: auth.mode === 'login' ? 'register' : 'login' }); }}>
              {auth.mode === 'login' ? 'Ainda não tenho conta' : auth.mode === 'register' ? 'Já tenho conta' : 'Voltar para entrar'}
            </button>
            {auth.mode !== 'forgot' && <> · <button className="link" onClick={() => { setMsg(''); setFq(''); setAuth({ ...auth, mode: 'forgot' }); }}>Esqueci minha senha</button></>}
          </p>
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
              <button className="clear-cart" onClick={() => { if (window.confirm('Tem certeza de que deseja remover todos os itens do carrinho?')) setCart({}); }}>Esvaziar carrinho</button>
              <p className="total">Total: {brl(total)}</p>
              {user ? (
                <>
                  <input placeholder="Seu nome" defaultValue={user.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  <input placeholder="WhatsApp com DDD" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} />
                  <button className="cta" onClick={sendOrder} disabled={sending}>{sending ? 'Enviando...' : 'Enviar pedido'}</button>
                </>
              ) : (
                <>
                  <p className="hint">Para realizar um pedido, entre ou crie sua conta.</p>
                  <button className="cta" onClick={() => { setOpen(false); go('entrar'); }}>Entrar para continuar</button>
                </>
              )}
            </>
          )}
          {msg && <p role="status">{msg}</p>}
        </aside>
      )}
    </div>
  );
}
