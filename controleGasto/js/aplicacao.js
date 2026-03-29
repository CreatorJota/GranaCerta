import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js'

// COLOCA OS DADOS DO SUPABASE
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
)

let user = null
const LOGIN_PAGE = './entrar.html'

let categoriasById = {}
let mesFiltroAtual = ''
let salarioAtual = null
let salarioTotalAtual = null

function getCurrentMonthStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function getSelectedMonthStr() {
  return mesFiltroAtual || getCurrentMonthStr()
}

async function ensureMesNoBanco() {
  // Garante que existam registros do mês (salário mensal) sem apagar histórico.
  // Não bloqueia o app se a função ainda não estiver criada.
  try {
    await supabase.rpc('sync_mes', { p_mes: getSelectedMonthStr() })
  } catch (e) {
    console.warn('sync_mes rpc não disponível (ignore até rodar o SQL):', e)
  }
}

const msgAutoHideTimers = new Map()

function formatMoneyBR(value) {
  const num = Number(value)
  const safe = Number.isFinite(num) ? num : 0
  return `R$ ${safe.toFixed(2)}`
}

function renderSalarioInfo(value) {
  const el = document.getElementById('salarioInfo')
  if (!el) return
  if (value == null) {
    el.textContent = 'Salário: —'
    return
  }
  el.textContent = `Salário: ${formatMoneyBR(value)}`
}

async function ensurePerfilMesRow() {
  if (!user?.id) return

  const mes = getSelectedMonthStr()

  // Cria o registro do usuário em `perfil_mensal` para o mês, caso ainda não exista.
  const { data: existingRows, error: selError } = await supabase
    .from('perfil_mensal')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('mes_ref', mes)
    .limit(1)

  if (selError) {
    // Se a tabela ainda não existir no Supabase, evita quebrar a UI.
    console.error('Supabase ensurePerfilRow (select) error:', selError)
    renderSalarioInfo(null)
    return
  }

  if (existingRows && existingRows.length > 0) return

  const { error: insError } = await supabase
    .from('perfil_mensal')
    .insert([{ user_id: user.id, mes_ref: mes, salario_total: 0, salario_disponivel: 0 }])

  if (insError) {
    // 23505 = unique_violation (alguém criou ao mesmo tempo)
    if (String(insError.code || '') !== '23505') {
      console.error('Supabase ensurePerfilRow (insert) error:', insError)
      renderSalarioInfo(null)
    }
  }
}

async function carregarSalario() {
  if (!user?.id) return

  const mes = getSelectedMonthStr()

  // Evita .maybeSingle(): se houver duplicatas antigas no banco, pode dar erro e “sumir” o salário.
  const { data: rows, error } = await supabase
    .from('perfil_mensal')
    .select('salario_total, salario_disponivel, updated_at')
    .eq('user_id', user.id)
    .eq('mes_ref', mes)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('Supabase carregarSalario error:', error)
    // Não trava o app; só não mostra salário.
    renderSalarioInfo(null)
    return
  }

  const data = rows?.[0]

  if (!data) {
    await ensurePerfilMesRow()
    salarioAtual = 0
    salarioTotalAtual = 0
    renderSalarioInfo(salarioAtual)
    return
  }

  salarioTotalAtual = Number(data.salario_total)
  if (!Number.isFinite(salarioTotalAtual)) salarioTotalAtual = 0

  salarioAtual = Number(data.salario_disponivel)
  if (!Number.isFinite(salarioAtual)) salarioAtual = 0
  renderSalarioInfo(salarioAtual)
}

async function adicionarSalario() {
  if (!user) {
    setAppMsg('Sessão não carregada. Faça login novamente.', 'error')
    window.location.href = LOGIN_PAGE
    return
  }

  const input = document.getElementById('salarioValor')
  const btn = document.getElementById('btnAdicionarSalario')
  const raw = String(input?.value || '').replace(',', '.').trim()
  const valor = Number(raw)

  setAppMsg('', null)

  if (!Number.isFinite(valor) || valor <= 0) {
    setAppMsg('Informe um valor de salário válido.', 'error')
    return
  }

  setButtonLoading(btn, true, 'Adicionando...')
  try {
    await ensureMesNoBanco()
    await ensurePerfilMesRow()
    await carregarSalario()

    const mes = getSelectedMonthStr()
    const atual = (Number.isFinite(Number(salarioAtual)) ? Number(salarioAtual) : 0)
    const totalAtual = (Number.isFinite(Number(salarioTotalAtual)) ? Number(salarioTotalAtual) : 0)
    const novoDisponivel = atual + valor
    const novoTotal = totalAtual + valor

    const { error } = await supabase
      .from('perfil_mensal')
      .update({
        salario_total: novoTotal,
        salario_disponivel: novoDisponivel
      })
      .eq('user_id', user.id)
      .eq('mes_ref', mes)

    if (error) {
      console.error('Supabase adicionarSalario error:', error)
      setAppMsg(formatSupabaseError(error) || 'Não foi possível atualizar o salário.', 'error')
      return
    }

    if (input) input.value = ''
    setAppMsg('Salário atualizado!', 'success')
    await carregarSalario()
  } finally {
    setButtonLoading(btn, false)
  }
}

function renderCategoriasResumo(categorias) {
  const wrapAtivas = document.getElementById('categoriasResumoAtivas')
  const wrapHistorico = document.getElementById('categoriasResumoHistorico')
  const histLabel = document.getElementById('historicoLabel')
  const histDivider = document.getElementById('historicoDivider')

  // Compatibilidade com layout antigo (caso ainda exista no HTML)
  const legacyWrap = document.getElementById('categoriasResumo')

  const useLegacy = legacyWrap && (!wrapAtivas || !wrapHistorico)
  const clear = (el) => { if (el) el.innerHTML = '' }
  clear(wrapAtivas)
  clear(wrapHistorico)
  clear(legacyWrap)

  if (!categorias || categorias.length === 0) {
    if (histLabel) histLabel.style.display = 'none'
    if (histDivider) histDivider.style.display = 'none'
    if (wrapHistorico) wrapHistorico.style.display = 'none'
    return
  }

  const tilesAtivas = []
  const tilesHistorico = []

  categorias.forEach(cat => {
    const tile = document.createElement('div')
    tile.className = 'cat-tile'

    // Categorias arquivadas (ativo=false) aparecem no histórico, mas sem botão de remoção.
    if (cat.ativo !== false) {
      const btnDelete = document.createElement('button')
      btnDelete.className = 'cat-delete'
      btnDelete.type = 'button'
      btnDelete.textContent = '×'
      btnDelete.setAttribute('aria-label', `Arquivar categoria ${cat.nome || ''}`.trim())
      btnDelete.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        removerCategoriaById(String(cat.id))
      })
      tile.appendChild(btnDelete)
    }

    const name = document.createElement('div')
    name.className = 'cat-name'
    name.textContent = cat.nome || 'Categoria'

    const saldoVal = Number(cat.saldo)
    const saldo = document.createElement('div')
    saldo.className = 'cat-saldo'
    if (Number.isFinite(saldoVal)) {
      if (saldoVal > 0) saldo.classList.add('cat-saldo--pos')
      if (saldoVal < 0) saldo.classList.add('cat-saldo--neg')
    }
    saldo.textContent = formatMoneyBR(cat.saldo)

    const meta = document.createElement('div')
    meta.className = 'cat-meta'
    meta.textContent = 'Saldo'

    tile.appendChild(name)
    tile.appendChild(saldo)
    tile.appendChild(meta)

    if (cat.ativo === false) tilesHistorico.push(tile)
    else tilesAtivas.push(tile)
  })

  if (useLegacy) {
    // Mantém comportamento antigo: tudo em um grid
    ;[...tilesAtivas, ...tilesHistorico].forEach(t => legacyWrap.appendChild(t))
    return
  }

  tilesAtivas.forEach(t => wrapAtivas?.appendChild(t))
  tilesHistorico.forEach(t => wrapHistorico?.appendChild(t))

  const hasHistorico = tilesHistorico.length > 0
  if (histLabel) histLabel.style.display = hasHistorico ? 'block' : 'none'
  if (histDivider) histDivider.style.display = hasHistorico ? 'block' : 'none'
  if (wrapHistorico) wrapHistorico.style.display = hasHistorico ? 'grid' : 'none'
}

function formatSupabaseError(error) {
  // Mensagem amigável para o usuário (sem codes internos).
  if (!error) return ''
  return error.message || 'Ocorreu um erro.'
}

// Helpers de UI
function setMsg(targetId, text, type) {
  const msgEl = document.getElementById(targetId)
  if (!msgEl) return

  // Cancela qualquer auto-hide anterior desse mesmo alvo
  const prevTimer = msgAutoHideTimers.get(targetId)
  if (prevTimer) {
    clearTimeout(prevTimer)
    msgAutoHideTimers.delete(targetId)
  }

  msgEl.style.display = text ? 'block' : 'none'
  msgEl.className = 'msg'
  msgEl.textContent = text || ''
  if (type === 'error') msgEl.classList.add('msg--error')
  if (type === 'success') msgEl.classList.add('msg--success')

  // Auto-esconde após 8s quando há mensagem
  if (text) {
    const timer = setTimeout(() => {
      const el = document.getElementById(targetId)
      if (!el) return
      el.style.display = 'none'
      el.textContent = ''
      msgAutoHideTimers.delete(targetId)
    }, 8000)

    msgAutoHideTimers.set(targetId, timer)
  }
}

function setAppMsg(text, type) {
  setMsg('msgApp', text, type)
}

function setButtonLoading(buttonEl, isLoading, loadingText) {
  if (!buttonEl) return
  if (!buttonEl.dataset.originalLabel) {
    buttonEl.dataset.originalLabel = buttonEl.textContent || ''
  }

  buttonEl.disabled = isLoading
  buttonEl.textContent = isLoading ? (loadingText || 'Carregando...') : buttonEl.dataset.originalLabel
}

async function logout() {
  await supabase.auth.signOut()
  window.location.href = LOGIN_PAGE
}

window.logout = logout

async function carregarCategorias() {
  const { data, error } = await supabase
    .from('categorias')
    .select('*')
    .eq('user_id', user.id)

  if (error) {
    console.error('Supabase carregarCategorias error:', error)
    setAppMsg(formatSupabaseError(error) || 'Não foi possível carregar categorias.', 'error')
    return
  }

  categoriasById = {}
  ;(data || []).forEach(c => {
    categoriasById[c.id] = c.nome
  })

  // Resumo mensal: calcula saldo do mês a partir das transações (histórico)
  await carregarResumoMensalCategorias(data || [])

  const select = document.getElementById('categoria')
  if (!select) return

  const selectedBefore = select.value
  select.innerHTML = ''

  // Placeholder (obriga a selecionar)
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = 'Selecione uma categoria'
  select.appendChild(placeholder)

  if (!data || data.length === 0) {
    placeholder.textContent = 'Nenhuma categoria cadastrada'
    return
  }

  ;(data || []).filter(cat => cat.ativo !== false).forEach(cat => {
    const option = document.createElement('option')
    option.value = cat.id
    option.textContent = cat.nome
    select.appendChild(option)
  })

  // Tenta preservar seleção
  if (selectedBefore) {
    select.value = selectedBefore
  }
}

async function carregarResumoMensalCategorias(categorias) {
  const mes = getSelectedMonthStr()

  const { data: txs, error } = await supabase
    .from('transacoes')
    .select('categoria_id, tipo, valor')
    .eq('user_id', user.id)
    .eq('mes_ref', mes)

  if (error) {
    console.error('Supabase carregarResumoMensalCategorias error:', error)
    // fallback: renderiza sem cálculo mensal
    renderCategoriasResumo((categorias || []).filter(c => c.ativo !== false))
    return
  }

  const saldoPorCategoria = {}
  ;(txs || []).forEach(t => {
    const catId = String(t.categoria_id)
    const v = Number(t.valor) || 0
    const delta = t.tipo === 'entrada' ? v : -v
    saldoPorCategoria[catId] = (Number(saldoPorCategoria[catId]) || 0) + delta
  })

  const categoriasRender = (categorias || []).filter(c => {
    const isActive = c.ativo !== false
    const hasMov = saldoPorCategoria[String(c.id)] != null
    return isActive || hasMov
  })

  const payload = categoriasRender.map(c => ({
    ...c,
    saldo: Number(saldoPorCategoria[String(c.id)] || 0)
  }))

  renderCategoriasResumo(payload)
}

async function removerCategoriaById(categoriaId) {
  if (!user) {
    setAppMsg('Sessão não carregada. Faça login novamente.', 'error')
    window.location.href = LOGIN_PAGE
    return
  }

  const categoriaNome = categoriasById?.[categoriaId] || 'esta categoria'
  const ok = window.confirm(
    `Tem certeza que deseja remover a categoria ${categoriaNome}?

Isso irá ARQUIVAR a categoria (não apaga transações do histórico).`
  )
  if (!ok) return

  // O botão do header foi removido; desabilita/reabilita apenas se existir.
  const btn = document.getElementById('btnRemoverCategoria')
  setButtonLoading(btn, true, 'Removendo...')
  try {
    const { error } = await supabase
      .rpc('remover_categoria', { p_categoria_id: categoriaId })

    if (error) {
      console.error('Supabase remover_categoria rpc error:', error)
      const msg = String(error.message || '')
      if (/remover_categoria/i.test(msg) && /function|not found|does not exist/i.test(msg)) {
        setAppMsg('Banco não atualizado. Rode o script SQL no Supabase e tente novamente.', 'error')
      } else {
        setAppMsg(formatSupabaseError(error) || 'Não foi possível remover a categoria.', 'error')
      }
      return
    }

    setAppMsg('Categoria arquivada.', 'success')

    await carregarCategorias()
    await carregarSalario()
  } finally {
    setButtonLoading(btn, false)
  }
}

async function criarCategoria() {
  if (!user) {
    setAppMsg('Sessão não carregada. Faça login novamente.', 'error')
    window.location.href = LOGIN_PAGE
    return
  }

  const input = document.getElementById('novaCategoria')
  const btn = document.getElementById('btnCriarCategoria')
  const nome = String(input?.value || '').trim()

  setAppMsg('', null)

  if (!nome) {
    setAppMsg('Digite o nome da categoria.', 'error')
    return
  }

  setButtonLoading(btn, true, 'Criando...')
  try {
    const { data, error } = await supabase
      .from('categorias')
      .insert([{ nome, user_id: user.id }])
      .select('*')
      .single()

    if (error) {
      console.error('Supabase criarCategoria error:', error)
      setAppMsg(formatSupabaseError(error) || 'Não foi possível criar a categoria.', 'error')
      return
    }

    setAppMsg('Categoria criada!', 'success')
    if (input) input.value = ''

    await carregarCategorias()

    // Seleciona a categoria recém-criada
    const select = document.getElementById('categoria')
    if (select && data?.id) select.value = String(data.id)
  } finally {
    setButtonLoading(btn, false)
  }
}

async function adicionarGasto() {
  if (!user) {
    setAppMsg('Sessão não carregada. Faça login novamente.', 'error')
    window.location.href = LOGIN_PAGE
    return
  }
  const valorEl = document.getElementById('valor')
  const tipoEl = document.getElementById('tipo')
  const categoriaEl = document.getElementById('categoria')

  const valor = String(valorEl?.value ?? '')
  const tipo = String(tipoEl?.value ?? '')
  const categoria_id = String(categoriaEl?.value ?? '')

  const btnAdd = document.getElementById('btnAdicionarGasto')
  if (btnAdd) btnAdd.disabled = true
  setAppMsg('', null)

  await ensureMesNoBanco()

  if (!categoria_id) {
    setAppMsg('Selecione uma categoria.', 'error')
    if (btnAdd) btnAdd.disabled = false
    return
  }

  const valorNum = Number(String(valor || '').replace(',', '.'))
  if (!Number.isFinite(valorNum) || valorNum <= 0) {
    setAppMsg('Informe um valor válido.', 'error')
    if (btnAdd) btnAdd.disabled = false
    return
  }

  if (tipo !== 'entrada' && tipo !== 'saida') {
    setAppMsg('Selecione um tipo válido (entrada ou saída).', 'error')
    if (btnAdd) btnAdd.disabled = false
    return
  }

  // Confirma que a chamada está autenticada (role = authenticated)
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) {
    console.error('Supabase getUser error:', authError)
    setAppMsg(formatSupabaseError(authError) || 'Não foi possível validar a sessão.', 'error')
    if (btnAdd) btnAdd.disabled = false
    return
  }

  const authUserId = authData?.user?.id
  if (!authUserId) {
    setAppMsg('Sua sessão expirou. Entre novamente.', 'error')
    if (btnAdd) btnAdd.disabled = false
    window.location.href = LOGIN_PAGE
    return
  }

  const { error } = await supabase
    .from('transacoes')
    .insert([
      {
        valor: valorNum,
        tipo,
        categoria_id,
        user_id: authUserId,
        mes_ref: getSelectedMonthStr()
      }
    ])

  if (error) {
    console.error('Supabase adicionarGasto insert error:', error)
    setAppMsg(formatSupabaseError(error) || 'Não foi possível salvar a transação.', 'error')
    if (btnAdd) btnAdd.disabled = false
    return
  }

  setAppMsg('Transação salva!', 'success')
  if (valorEl) valorEl.value = ''

  if (btnAdd) btnAdd.disabled = false

  await carregarCategorias()
  await carregarSalario()
}
window.adicionarGasto = adicionarGasto

async function initApp() {
  // Se cair no app com tokens de recuperação (hash), manda para a tela dedicada.
  const hash = window.location.hash
  if (hash && hash.includes('access_token')) {
    window.location.href = './redefinir-senha.html' + hash
    return
  }

  // Protege o index: se não estiver logado, manda para a tela de login.
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData?.session
  if (!session?.user) {
    window.location.href = LOGIN_PAGE
    return
  }

  user = session.user

  const userInfo = document.getElementById('userInfo')
  if (userInfo) {
    userInfo.textContent = user.email ? `Logado como: ${user.email}` : 'Sessão ativa'
  }

  const btnLogout = document.getElementById('btnLogout')
  if (btnLogout) {
    btnLogout.addEventListener('click', logout)
  }

  const btnAdicionarSalario = document.getElementById('btnAdicionarSalario')
  if (btnAdicionarSalario) {
    btnAdicionarSalario.addEventListener('click', adicionarSalario)
  }

  // Garante dados do mês selecionado (sem apagar histórico)
  await ensureMesNoBanco()
  await ensurePerfilMesRow()
  await carregarSalario()

  const btnCriarCategoria = document.getElementById('btnCriarCategoria')
  if (btnCriarCategoria) {
    btnCriarCategoria.addEventListener('click', criarCategoria)
  }

  const mesFiltro = document.getElementById('mesFiltro')
  if (mesFiltro) {
    // Por padrão, sempre inicia no mês atual
    const monthStr = getCurrentMonthStr()
    mesFiltro.value = monthStr
    mesFiltroAtual = monthStr

    mesFiltro.addEventListener('change', () => {
      mesFiltroAtual = mesFiltro.value || ''
      ensureMesNoBanco().finally(() => {
        carregarSalario()
        carregarCategorias()
      })
    })
  }

  const btnLimparFiltro = document.getElementById('btnLimparFiltro')
  if (btnLimparFiltro && mesFiltro) {
    btnLimparFiltro.addEventListener('click', () => {
      mesFiltro.value = ''
      mesFiltroAtual = ''
      ensureMesNoBanco().finally(() => {
        carregarSalario()
        carregarCategorias()
      })
    })
  }

  await carregarCategorias()
}

// Inicializa automaticamente quando `js/aplicacao.js` é carregado no index.
initApp()

// (o redirecionamento de hash agora é tratado no initApp)
