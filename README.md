# GranaCerta

Controle de gastos simples por **categorias**, com **login via Supabase** e **histórico por mês**.

## O que dá pra fazer

- Criar conta, entrar e sair 
- Criar categorias
- Registrar transações:
  - **Entrada** = distribuir salário para uma categoria
  - **Saída** = gasto em uma categoria
- Filtrar por mês (histórico)
- Arquivar categoria (não apaga histórico)

## Estrutura do projeto

Arquivos principais na raiz:

- `index.html` — app (protegido: se não estiver logado, vai para `entrar.html`)
- `entrar.html` — login + cadastro
- `redefinir-senha.html` — redefinição de senha via link do email
- `css/estilo.css` — estilos
- `js/aplicacao.js` — lógica do app
- `js/config.exemplo.js` — modelo para copiar
- `js/config.js` — credenciais do Supabase (ANON)
- `img/favicon.png` — ícone da aba

## Como rodar

1) Abra a pasta do projeto no VS Code

2) Configure o Supabase (obrigatório)

- Copie `js/config.exemplo.js` para `js/config.js`
- Preencha com:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`

## Banco (Supabase)

O app usa tabelas no Supabase (Postgres) e depende de RLS/policies corretas.

Feito com HTML/CSS/JS puro + Supabase.
