import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPhone = (d) => (d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`);
const saved = {
  get: () => { try { return sessionStorage.getItem('cl-admin') || ''; } catch { return ''; } },
  set: (v) => { try { v ? sessionStorage.setItem('cl-admin', v) : sessionStorage.removeItem('cl-admin'); } catch { /* ignora */ } },
};
const empty = { name: '', desc: '', price: '', color: '#FF3D9A', tag: '' };

export default function Admin({ onExit }) {
  const [key, setKey] = useState(saved.get);
  const [input, setInput] = useState('');
  const [tab, setTab] = useState('pedidos');
  const [orders, setOrders] = useState([]);
  const [menu, setMenu] = useState([]);
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState('');

  const call = (path, opts = {}) => fetch(`${API}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', 'x-admin-key': key } });

  async function loadOrders() {
    try {
      const r = await call('/api/admin/orders');
      const d = await r.json();
      if (!r.ok) { setMsg(d.error); if (r.status === 401) { saved.set(''); setKey(''); } return; }
      setMsg(''); setOrders(d);
    } catch { setMsg('Não foi possível conectar ao servidor.'); }
  }

  useEffect(() => {
    if (!key) return;
    loadOrders();
    fetch(`${API}/api/cupcakes`).then((r) => r.json()).then(setMenu).catch(() => {});
  }, [key]);

  async function saveProduct(e) {
    e.preventDefault(); setMsg('');
    const price = Number(String(f.price).replace(',', '.'));
    try {
      const r = await call(editing ? `/api/admin/cupcakes/${editing}` : '/api/admin/cupcakes', {
        method: editing ? 'PUT' : 'POST', body: JSON.stringify({ ...f, price }),
      });
      const d = await r.json();
      if (!r.ok) return setMsg(d.error);
      setMenu((m) => (editing ? m.map((p) => (p.id === d.id ? d : p)) : [...m, d]));
      setMsg(editing ? `"${d.name}" atualizado.` : `"${d.name}" cadastrado! Ele já aparece na vitrine.`);
      setF(empty); setEditing(null);
    } catch { setMsg('Não foi possível conectar ao servidor.'); }
  }

  function startEdit(p) {
    setMsg(''); setEditing(p.id);
    setF({ name: p.name, desc: p.desc, price: p.price.toFixed(2).replace('.', ','), color: p.color, tag: p.tag || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() { setEditing(null); setF(empty); setMsg(''); }

  async function removeProduct(p) {
    if (!window.confirm(`Remover "${p.name}" da vitrine? Os pedidos antigos continuam guardados.`)) return;
    try {
      const r = await call(`/api/admin/cupcakes/${p.id}`, { method: 'DELETE' });
      if (!r.ok) return setMsg((await r.json()).error);
      setMenu((m) => m.filter((x) => x.id !== p.id));
      if (editing === p.id) cancelEdit();
      setMsg(`"${p.name}" removido da vitrine.`);
    } catch { setMsg('Não foi possível conectar ao servidor.'); }
  }

  if (!key) {
    return (
      <section className="page">
        <h2>Painel do dono</h2>
        <form className="auth" onSubmit={(e) => { e.preventDefault(); saved.set(input); setKey(input); }}>
          <input type="password" placeholder="Senha do painel" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="cta" type="submit">Entrar no painel</button>
        </form>
        {msg && <p role="alert">{msg}</p>}
        <button className="link" onClick={onExit}>Voltar para a loja</button>
      </section>
    );
  }

  const revenue = orders.reduce((s, o) => s + o.total, 0);
  return (
    <section className="admin">
      <div className="admin-head">
        <h2>Painel do dono</h2>
        <span><button className="link" onClick={onExit}>Voltar para a loja</button> · <button className="link" onClick={() => { saved.set(''); setKey(''); }}>Sair do painel</button></span>
      </div>
      <div className="tabs">
        <button className={tab === 'pedidos' ? 'on' : ''} onClick={() => { setMsg(''); setTab('pedidos'); }}>Pedidos ({orders.length})</button>
        <button className={tab === 'produtos' ? 'on' : ''} onClick={() => { setMsg(''); setTab('produtos'); }}>Produtos ({menu.length})</button>
      </div>
      {msg && <p role="status">{msg}</p>}

      {tab === 'pedidos' && (
        <>
          <div className="stats">
            <div className="stat"><b>{orders.length}</b>pedidos</div>
            <div className="stat"><b>{brl(revenue)}</b>em vendas</div>
            <button className="add" onClick={loadOrders}>Atualizar</button>
          </div>
          {orders.length === 0 && <p>Ainda não há pedidos.</p>}
          {orders.map((o) => (
            <div key={o.id} className="order">
              <b>Pedido {o.id}</b> · {new Date(o.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              <p><b>{o.customer.name}</b> · <a href={`https://wa.me/55${o.customer.phone}`} target="_blank" rel="noreferrer">{fmtPhone(o.customer.phone)}</a></p>
              <p>{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
              <b>{brl(o.total)}</b>
            </div>
          ))}
        </>
      )}

      {tab === 'produtos' && (
        <>
          <h3>{editing ? 'Editar produto' : 'Cadastrar novo produto'}</h3>
          <form className="admin-form" onSubmit={saveProduct}>
            <input placeholder="Nome do sabor" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <textarea rows={3} placeholder="Descrição (massa, recheio, cobertura)" value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} />
            <input inputMode="decimal" placeholder="Preço, ex.: 12,50" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
            <label>Cor do cupcake <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></label>
            <input placeholder="Etiqueta (opcional), ex.: Novo" maxLength={20} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} />
            <button className="cta" type="submit">{editing ? 'Salvar alterações' : 'Cadastrar produto'}</button>
            {editing && <button type="button" className="link" onClick={cancelEdit}>Cancelar edição</button>}
          </form>
          <h3>Produtos na vitrine</h3>
          {menu.map((p) => (
            <div key={p.id} className="order prod">
              <span><span className="dot" style={{ background: p.color }} /> <b>{p.name}</b> · {brl(p.price)}{p.tag ? ` · ${p.tag}` : ''}</span>
              <span className="actions">
                <button onClick={() => startEdit(p)}>Editar</button>
                <button className="danger" onClick={() => removeProduct(p)}>Remover</button>
              </span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
