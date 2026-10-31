# Publicação gratuita: Netlify (site) + Render (API) + Turso (banco)

Ordem: banco, API e, por último, o site. Os planos gratuitos mudam; confira os termos de cada serviço no cadastro.

## 0. Ajuste no seu computador (uma vez)
    cd backend
    npm uninstall better-sqlite3
    npm install @libsql/client
    npm run dev

Deve aparecer "Banco de dados: ...cuplicious.db" e "API na porta 3001". O `package.json` agora lista `@libsql/client`. Faça commit dele e envie ao GitHub (`git add .`, `git commit -m "Turso"`, `git push`).
Sem as variáveis da Turso, tudo continua funcionando com o arquivo local.

## 1. Turso (banco)
1. Crie a conta em turso.tech e um banco novo (nome sugerido: `cuplicious`).
2. No painel do banco, copie a **URL** (começa com `libsql://`) e gere um **token de acesso**. Se os nomes dos botões forem diferentes, siga o guia "Get started" da documentação deles.
3. Guarde a URL e o token: são as variáveis `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`.

As tabelas e o cardápio inicial são criados sozinhos na primeira vez que a API inicia. Contas, pedidos e produtos do seu banco local não são copiados.

## 2. Render (API)
1. Em render.com, **New > Web Service** e conecte o repositório do GitHub.
2. Configure:
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
3. Em **Environment Variables**, cadastre:
   - `ADMIN_KEY` = a senha do painel do dono
   - `TURSO_DATABASE_URL` = a URL da Turso
   - `TURSO_AUTH_TOKEN` = o token da Turso
   - se o build reclamar da versão do Node: `NODE_VERSION` = `22`
4. Aguarde o deploy. Copie o endereço do serviço (`https://nome.onrender.com`) e teste `https://nome.onrender.com/api/health` e `/api/cupcakes` no navegador.

## 3. Netlify (site)
O endereço da API é gravado no site na hora de gerar a versão final. No PowerShell:

    cd frontend-app
    $env:VITE_API_URL="https://nome.onrender.com"
    npm run build

1. Em netlify.com, **Add new site > Deploy manually**.
2. Arraste a pasta `frontend-app\dist` para a área indicada.
3. Copie o endereço gerado (`https://algo.netlify.app`).

Para atualizar o site depois de mudar o código, repita o `npm run build` e arraste a pasta `dist` de novo.

## 4. Liberar o site na API (CORS)
No Render, adicione a variável `FRONTEND_URL` = endereço da Netlify (sem barra no final) e aguarde o reinício.

## 5. Teste final
Abra o site da Netlify: vitrine, pedido com telefone, criar conta, "Meus pedidos" e **Área do dono** (senha = `ADMIN_KEY`).

## Observações
- O plano gratuito do Render desliga a API após 15 minutos sem acesso, e o primeiro acesso depois disso leva cerca de 1 minuto. Antes de apresentar, abra o site uma vez para "acordar" a API.
- Se aparecer "Não foi possível carregar o cardápio", a API ainda está acordando, ou `VITE_API_URL` foi gerado errado. Refaça o `npm run build` com o endereço certo.
- Nunca envie o arquivo `.env` ao GitHub. Os segredos ficam só nas variáveis do Render.
