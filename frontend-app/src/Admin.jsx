import { useEffect, useRef, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPhone = (d) => (d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`);
const STATUS = { novo: 'Novo', em_preparo: 'Em preparo', entregue: 'Entregue', cancelado: 'Cancelado' };
const empty = { name: '', desc: '', price: '', color: '#FF3D9A', tag: '', category: 'classicos' };
const CATEGORY = { classicos: 'Clássicos', especiais: 'Especiais', sem_gluten: 'Sem glúten' };
const noFilter = { search: '', from: '', to: '', status: '' };

export default function Admin({ onExit }) {
  // A senha nunca é persistida: cada montagem da área do dono exige nova autenticação.
  const [key, setKey] = useState('');
  const [input, setInput] = useState('');
  const [tab, setTab] = useState('pedidos');
  const [data, setData] = useState({ orders: [], total: 0, sales: 0, pages: 1 });
  const [flt, setFlt] = useState(noFilter);
  const [applied, setApplied] = useState(noFilter);
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState([]);
  const [topFlavors, setTopFlavors] = useState([]);
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [resetEmail, setResetEmail] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [notice, setNotice] = useState('');
  const [updated, setUpdated] = useState(null);
  const seen = useRef({ k: '', total: 0 });

  const call = (path, opts = {}) => fetch(`${API}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', 'x-admin-key': key } });
  const fail = async (r) => setMsg((await r.json().catch(() => ({}))).error || 'Algo deu errado.');

  async function loadOrders() {
    try {
      const r = await call(`/api/admin/orders?${new URLSearchParams({ ...applied, page })}`);
      if (!r.ok) { await fail(r); if (r.status === 401) setKey(''); return; }
      const d = await r.json(), k = JSON.stringify(applied), last = seen.current;
      setNotice(last.k === k && d.total > last.total ? `${d.total - last.total} pedido(s) novo(s) chegaram!` : '');
      seen.current = { k, total: d.total };
      setMsg(''); setData(d); setUpdated(new Date());
    } catch { setMsg('Não foi possível conectar ao servidor.'); }
  }
  async function loadMenu() {
    try { const r = await call('/api/admin/cupcakes'); if (r.ok) setMenu(await r.json()); } catch { /* ignora */ }
  }
  useEffect(() => { if (key) loadOrders(); }, [key, applied, page]);
  useEffect(() => { if (key) loadMenu(); }, [key]);
  async function loadReport() {
    try { const r = await call('/api/admin/reports/top-flavors?limit=10'); if (r.ok) setTopFlavors(await r.json()); else await fail(r); }
    catch { setMsg('Não foi possível carregar o relatório de sabores.'); }
  }
  useEffect(() => { if (key && tab === 'relatorios') loadReport(); }, [key, tab]);

  // Atualiza os pedidos sozinho a cada 30 s (só com a aba Pedidos aberta e a página visível).
  useEffect(() => {
    if (!key || tab !== 'pedidos') return undefined;
    const tick = () => { if (!document.hidden) loadOrders(); };
    const id = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [key, tab, applied, page]);

  async function setStatus(o, status) {
    if (status === 'cancelado' && !window.confirm(`Cancelar o pedido ${o.id}?`)) return;
    const r = await call(`/api/admin/orders/${o.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    if (!r.ok) return fail(r);
    setData((d) => ({ ...d, orders: d.orders.map((x) => (x.id === o.id ? { ...x, status } : x)) }));
  }

  async function saveProduct(e) {
    e.preventDefault(); setMsg('');
    const price = Number(String(f.price).replace(',', '.'));
    const r = await call(editing ? `/api/admin/cupcakes/${editing}` : '/api/admin/cupcakes', { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ ...f, price }) });
    if (!r.ok) return fail(r);
    const d = await r.json();
    setMenu((m) => (editing ? m.map((p) => (p.id === d.id ? { ...p, ...d } : p)) : [...m, { ...d, active: true }]));
    setMsg(editing ? `"${d.name}" atualizado.` : `"${d.name}" cadastrado! Ele já aparece na vitrine.`);
    setF(empty); setEditing(null);
  }
  function startEdit(p) {
    setMsg(''); setEditing(p.id);
    setF({ name: p.name, desc: p.desc, price: p.price.toFixed(2).replace('.', ','), color: p.color, tag: p.tag || '', category: p.category || 'classicos' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelEdit() { setEditing(null); setF(empty); setMsg(''); }
  async function toggle(p) {
    const r = await call(`/api/admin/cupcakes/${p.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !p.active }) });
    if (!r.ok) return fail(r);
    setMenu((m) => m.map((x) => (x.id === p.id ? { ...x, active: !p.active } : x)));
  }
  async function removeProduct(p) {
    if (!window.confirm(`Remover "${p.name}" de vez? Para só esconder da vitrine, use "Ocultar". Pedidos antigos continuam guardados.`)) return;
    const r = await call(`/api/admin/cupcakes/${p.id}`, { method: 'DELETE' });
    if (!r.ok) return fail(r);
    setMenu((m) => m.filter((x) => x.id !== p.id));
    if (editing === p.id) cancelEdit();
    setMsg(`"${p.name}" removido.`);
  }
  async function genCode(e) {
    e.preventDefault(); setMsg(''); setCode('');
    const r = await call('/api/admin/reset-code', { method: 'POST', body: JSON.stringify({ email: resetEmail }) });
    if (!r.ok) return fail(r);
    setCode((await r.json()).code);
  }

  if (!key) {
    return (
      <section className="page">
        <h2>Painel do dono</h2>
        <form className="auth" onSubmit={(e) => { e.preventDefault(); setMsg(''); setKey(input.trim()); }}>
          <input type="password" placeholder="Senha do painel" autoComplete="current-password" required value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="cta" type="submit">Entrar no painel</button>
        </form>
        {msg && <p role="alert">{msg}</p>}
        <button className="link" onClick={onExit}>Voltar para a loja</button>
      </section>
    );
  }

  return (
    <section className="admin">
      <div className="admin-head">
        <h2>Painel do dono</h2>
        <span><button className="link" onClick={onExit}>Voltar para a loja</button> · <button className="link" onClick={() => { setInput(''); setKey(''); }}>Sair do painel</button></span>
      </div>
      <div className="tabs">
        {[['pedidos', `Pedidos (${data.total})`], ['produtos', `Produtos (${menu.length})`], ['relatorios', 'Relatórios'], ['clientes', 'Clientes']].map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => { setMsg(''); setTab(id); }}>{label}</button>
        ))}
      </div>
      {msg && <p role="status">{msg}</p>}

      {tab === 'pedidos' && (
        <>
          <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(flt); }}>
            <input placeholder="Cliente ou telefone" value={flt.search} onChange={(e) => setFlt({ ...flt, search: e.target.value })} />
            <label>De <input type="date" value={flt.from} onChange={(e) => setFlt({ ...flt, from: e.target.value })} /></label>
            <label>Até <input type="date" value={flt.to} onChange={(e) => setFlt({ ...flt, to: e.target.value })} /></label>
            <select aria-label="Status" value={flt.status} onChange={(e) => setFlt({ ...flt, status: e.target.value })}>
              <option value="">Todos os status</option>
              {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="add" type="submit">Filtrar</button>
            <button className="link" type="button" onClick={() => { setFlt(noFilter); setPage(1); setApplied(noFilter); }}>Limpar</button>
          </form>
          <div className="stats">
            <div className="stat"><b>{data.total}</b>pedidos</div>
            <div className="stat"><b>{brl(data.sales)}</b>em vendas (sem cancelados)</div>
            {updated && <span className="muted">Atualizado às {updated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · automático a cada 30 s</span>}
          </div>
          {notice && <p role="status" className="notice">{notice}</p>}
          {data.orders.length === 0 && <p>Nenhum pedido encontrado.</p>}
          {data.orders.map((o) => (
            <div key={o.id} className={`order${o.status === 'cancelado' ? ' off' : ''}`}>
              <b>Pedido {o.id}</b> · {new Date(o.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              <p><b>{o.customer.name}</b> · <a href={`https://wa.me/55${o.customer.phone}`} target="_blank" rel="noreferrer">{fmtPhone(o.customer.phone)}</a></p>
              <p>{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
              <b>{brl(o.total)}</b>{' '}
              <select aria-label="Status do pedido" value={o.status} onChange={(e) => setStatus(o, e.target.value)}>
                {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{v === 'cancelado' ? 'Cancelar pedido' : l}</option>)}
              </select>
            </div>
          ))}
          <div className="pager">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Anterior</button>
            <span>Página {page} de {data.pages}</span>
            <button disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Próxima →</button>
          </div>
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
            <label>Categoria do produto<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(CATEGORY).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
            <button className="cta" type="submit">{editing ? 'Salvar alterações' : 'Cadastrar produto'}</button>
            {editing && <button type="button" className="link" onClick={cancelEdit}>Cancelar edição</button>}
          </form>
          <h3>Produtos</h3>
          {menu.map((p) => (
            <div key={p.id} className={`order prod${p.active ? '' : ' off'}`}>
              <span><span className="dot" style={{ background: p.color }} /> <b>{p.name}</b> · {brl(p.price)}{p.tag ? ` · ${p.tag}` : ''} · {CATEGORY[p.category] || CATEGORY.classicos}{p.active ? '' : ' · oculto da vitrine'}</span>
              <span className="actions">
                <button onClick={() => toggle(p)}>{p.active ? 'Ocultar' : 'Mostrar'}</button>
                <button onClick={() => startEdit(p)}>Editar</button>
                <button className="danger" onClick={() => removeProduct(p)}>Remover</button>
              </span>
            </div>
          ))}
        </>
      )}

      {tab === 'relatorios' && (
        <>
          <div className="admin-head"><h3>Sabores mais vendidos</h3><button className="add" onClick={loadReport}>Atualizar relatório</button></div>
          <p className="muted">Ranking pela quantidade de unidades vendidas. Pedidos cancelados não entram no cálculo.</p>
          {topFlavors.length === 0 ? <p>Ainda não há vendas registradas para gerar o relatório.</p> : (
            <div className="report-list">
              {topFlavors.map((item, index) => (
                <div className="report-row" key={`${item.id}-${item.name}`}>
                  <b className="report-rank">{index + 1}º</b>
                  <span className="report-name">{item.name}</span>
                  <b>{item.quantity} {item.quantity === 1 ? 'unidade' : 'unidades'}</b>
                  <span className="muted">{brl(item.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'clientes' && (
        <>
          <h3>Redefinir senha de um cliente</h3>
          <p>Se um cliente esquecer a resposta da pergunta de segurança, confirme a identidade dele pelo meio que preferir e gere aqui um código temporário (vale 1 hora). Ele digita esse código no campo da resposta em "Esqueci minha senha", define a nova senha e depois pode cadastrar outra pergunta em "Meus pedidos".</p>
          <form className="admin-form" onSubmit={genCode}>
            <input type="email" placeholder="E-mail da conta do cliente" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
            <button className="cta" type="submit">Gerar código</button>
          </form>
          {code && <p className="code">Código: <b>{code}</b></p>}
        </>
      )}
    </section>
  );
}
