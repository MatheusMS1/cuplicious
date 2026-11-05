# Publicação gratuita: Netlify (site) + Render (API) + Turso (banco)

## Observações
- O plano gratuito do Render desliga a API após 15 minutos sem acesso, e o primeiro acesso depois disso leva cerca de 1 minuto. Antes de apresentar, abra o site uma vez para "acordar" a API.
- Se aparecer "Não foi possível carregar o cardápio", a API ainda está acordando, ou `VITE_API_URL` foi gerado errado. Refaça o `npm run build` com o endereço certo.
- Nunca envie o arquivo `.env` ao GitHub. Os segredos ficam só nas variáveis do Render.
