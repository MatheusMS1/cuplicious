// Carrega backend/.env (linhas CHAVE=valor), se o arquivo existir. Na hospedagem, use as variáveis do painel.
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const envFile = fileURLToPath(new URL('./.env', import.meta.url));
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
