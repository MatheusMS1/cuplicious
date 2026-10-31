# CupLicious: loja de cupcakes online

Loja virtual de cupcakes com vitrine, carrinho, cadastro e login de clientes, histórico de pedidos e painel do dono para gerenciar pedidos e produtos.

## Tecnologias
- **Back end:** Node.js + Express
- **Banco de dados:** SQLite (via `@libsql/client`): Utilizado Turso na hospedagem
- **Front end:** React (Vite)

## Estrutura
    backend/        API, banco de dados (db.js) e regras de negócio (server.js)
    frontend-app/   aplicação React (src/App.jsx, Admin.jsx, brand.js, styles.css)

## Como rodar (Node.js 20.19 ou superior)

### 1. Back end
    cd backend
    npm install
    copy .env.example .env (Windows) e troque ADMIN_KEY por uma senha sua
    npm run dev

A API sobe em http://localhost:3001 e o arquivo `cuplicious.db` é criado sozinho, já com o cardápio inicial.

### 2. Front end (em outro terminal)
    cd frontend-app
    npm install
    npm run dev

Acesse http://localhost:5173

## Funcionalidades
- Vitrine com busca por sabor e carrinho
- Pedido com validação de telefone brasileiro (DDD + número)
- Cadastro, login e "Meus pedidos"
- Painel do dono ("Área do dono", no rodapé): lista de pedidos, cadastro, edição e remoção de produtos
- Dados guardados em banco SQLite

## Publicação
Passo a passo de hospedagem (Netlify, Render e Turso) em `DEPLOY.md`.


## Limitações conhecidas
- Hospedagem gratuita: o back end "dorme" após 15 min sem acesso e o primeiro acesso demora cerca de 1 minuto (veja `DEPLOY.md`)

