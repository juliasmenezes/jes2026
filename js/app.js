/* =====================================================
   JES 2026 — app.js
   Camada de dados via Firebase Firestore (banco de dados real)
   Cache em memória alimentado por listeners em tempo real
   + motor de regras esportivas (gols, basquete, sets)
   ===================================================== */

import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc,
  writeBatch, increment
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const SESSION_KEY = 'jes2026_session';
const CATEGORIA_KEY = 'jes2026_categoria';

var CATEGORIAS = ['manha', 'tarde'];

/* ---- Turnos: cada período tem suas séries e seu tema visual ---- */
var TURNOS = {
  manha: { id: 'manha', nome: 'Manhã', descricao: '7º e 8º anos', series: ['7º ano', '8º ano'], corTema: '#FFFFFF' },
  tarde: { id: 'tarde', nome: 'Tarde', descricao: '9º ano ao 3º ano EM', series: ['9º ano', '1º ano EM', '2º ano EM', '3º ano EM'], corTema: '#0B0C0F' }
};

/* ---- localStorage pode falhar (aba anônima, bloqueio de cookies) ---- */
function _lerStorage(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }
function _gravarStorage(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) { /* sem persistência */ } }
function _removerStorage(chave) { try { localStorage.removeItem(chave); } catch (e) { /* sem persistência */ } }

/* ---- Categoria ativa (manha ou tarde) ---- */
/* Primeira visita: o turno segue o relógio (antes do meio-dia = manhã) */
function _categoriaInicial() {
  var salva = _lerStorage(CATEGORIA_KEY);
  if (CATEGORIAS.indexOf(salva) !== -1) return salva;
  return new Date().getHours() < 12 ? 'manha' : 'tarde';
}

var _categoriaAtual = _categoriaInicial();
_aplicarTurnoNoDocumento(_categoriaAtual);

function _aplicarTurnoNoDocumento(cat) {
  document.documentElement.setAttribute('data-turno', cat);
  if (document.body) document.body.setAttribute('data-turno', cat);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', TURNOS[cat].corTema);
}

function getCategoria() { return _categoriaAtual; }
function getTurno(cat) { return TURNOS[cat || _categoriaAtual]; }
function setCategoria(cat) {
  if (CATEGORIAS.indexOf(cat) === -1) return;
  _categoriaAtual = cat;
  _gravarStorage(CATEGORIA_KEY, cat);
  _aplicarTurnoNoDocumento(cat);
  window.dispatchEvent(new Event('jes2026-categoria-changed'));
}

/* ---- Cache em memória ---- */
var _db = {
  modalidades: [],
  equipes: [],
  jogos: [],
  usuarios: [],
  pontosJogos: [],
  valoresOlimpicos: [],   /* lançamentos de Valores Olímpicos: só o painel do organizador baixa */
  valoresConfig: {},      /* { manha: { liberado, totais }, tarde: {...} }: público, só traz totais depois de liberado */
  regulamentos: {},
  _loaded: false,
  _servidor: false
};

var _jogosDocs = [];
var _eventosPorJogo = {};

/* ---- Cliente Firebase ---- */
function getFirebase() {
  return window.__firebase || null;
}
function getDb() {
  var fb = getFirebase();
  return fb ? fb.db : null;
}

/* ---- Inicialização assíncrona ---- */
var _onReadyCallbacks = [];
var _readyFired = false;

function onReady(cb) {
  if (_readyFired) { cb(); return; }
  _onReadyCallbacks.push(cb);
}

function _fireReady() {
  if (_readyFired) return;
  _readyFired = true;
  _onReadyCallbacks.forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } });
  _onReadyCallbacks = [];
}

/* ---- Realtime: um listener por coleção alimenta todo o cache ----
   Cada listener entrega os dados completos no primeiro disparo, então
   não há leitura inicial separada nem consultas extras por jogo. */
var _PROCESSADORES = {
  modalidades: function (snap) { _db.modalidades = snap.docs.map(_mapModalidade); },
  equipes: function (snap) { _db.equipes = snap.docs.map(_mapEquipe); },
  jogos: function (snap) {
    _jogosDocs = snap.docs.map(function (d) { return { id: d.id, dados: d.data() }; });
    _montarJogos();
  },
  eventos: function (snap) {
    var porJogo = {};
    snap.docs.forEach(function (d) {
      var r = d.data();
      if (!porJogo[r.jogo_id]) porJogo[r.jogo_id] = [];
      porJogo[r.jogo_id].push(_mapEvento(d.id, r));
    });
    Object.keys(porJogo).forEach(function (id) {
      porJogo[id].sort(function (a, b) { return a.timestamp - b.timestamp; });
    });
    _eventosPorJogo = porJogo;
    _montarJogos();
  },
  pontos_jogos: function (snap) { _db.pontosJogos = snap.docs.map(_mapPonto); },
  modalidade_regulamentos: function (snap) {
    _db.regulamentos = {};
    snap.docs.forEach(function (d) {
      var row = d.data();
      _db.regulamentos[row.modalidade] = {
        visaoGeral: row.visao_geral || '',
        regras: row.regras || []
      };
    });
  },
  config: function (snap) {
    _db.valoresConfig = {};
    snap.docs.forEach(function (d) {
      if (d.id === 'valores_olimpicos') _db.valoresConfig = _mapValoresConfig(d.data());
    });
  },
  valores_olimpicos: function (snap) { _db.valoresOlimpicos = snap.docs.map(_mapValor); },
  usuarios: function (snap) { _db.usuarios = snap.docs.map(_mapUsuario); }
};

/* Páginas públicas não baixam usuários nem os lançamentos de Valores Olímpicos
   (eles só viram dado público quando o administrador libera os totais) */
var _COLECOES_SO_ADMIN = ['usuarios', 'valores_olimpicos'];
function _precisaUsuarios() {
  return document.documentElement.getAttribute('data-area') === 'admin';
}

function _iniciarListeners() {
  var db = getDb();
  if (!db) { _fireReady(); return; }

  var colecoes = Object.keys(_PROCESSADORES).filter(function (nome) {
    return _COLECOES_SO_ADMIN.indexOf(nome) === -1 || _precisaUsuarios();
  });
  var pendentes = colecoes.slice();

  function marcarCarregada(nome) {
    var i = pendentes.indexOf(nome);
    if (i === -1) return;
    pendentes.splice(i, 1);
    if (pendentes.length === 0) {
      _db._loaded = true;
      _fireReady();
      _emitirSync();
    }
  }

  colecoes.forEach(function (nome) {
    /* Só "jogos" acompanha metadados: é ele que diz se estamos em sincronia com o servidor */
    var opcoes = { includeMetadataChanges: nome === 'jogos' };
    onSnapshot(collection(db, nome), opcoes, function (snap) {
      if (nome === 'jogos') {
        var doServidor = !snap.metadata.fromCache;
        var mudouConexao = doServidor !== _db._servidor;
        _db._servidor = doServidor;
        if (mudouConexao) _emitirSync();
        if (pendentes.indexOf(nome) === -1 && snap.docChanges().length === 0) {
          if (mudouConexao && _readyFired) _notifySync();
          return;
        }
      }
      _PROCESSADORES[nome](snap);
      marcarCarregada(nome);
      if (_readyFired) _notifySync();
    }, function (err) {
      console.error('Erro ao sincronizar "' + nome + '":', err);
      _ultimoErro = err;
      _emitirSync();
      marcarCarregada(nome);
    });
  });

  /* Segurança: libera a interface mesmo que a rede esteja muito lenta */
  setTimeout(function () {
    if (_readyFired) return;
    _db._loaded = true;
    _fireReady();
    _emitirSync();
  }, 10000);
}

function _montarJogos() {
  _db.jogos = _jogosDocs.map(function (d) {
    var jogo = _mapJogo(d.id, d.dados);
    jogo.eventos = (_eventosPorJogo[d.id] || []).slice();
    return jogo;
  });
}

/* ---- Mapeadores (Firestore -> JS camelCase) ---- */
function _mapModalidade(d) {
  var r = d.data();
  return { id: d.id, nome: r.nome, genero: r.genero, cor: r.cor, categoria: r.categoria || 'manha' };
}
function _mapEquipe(d) {
  var r = d.data();
  return { id: d.id, nome: r.nome, turma: r.turma || '', brasao: r.brasao || '', categoria: r.categoria || 'manha' };
}
function _mapJogo(docId, r) {
  return {
    id: 'jogo-' + docId,
    _dbId: docId,
    modalidadeId: r.modalidade_id || null,
    modalidade: r.modalidade || '',
    genero: r.genero || '',
    data: r.data || '',
    horario: r.horario || '',
    local: r.local || '',
    timeA: r.time_a || '',
    timeB: r.time_b || '',
    placarA: Math.max(0, Number(r.placar_a) || 0),
    placarB: Math.max(0, Number(r.placar_b) || 0),
    status: r.status || 'EM BREVE',
    categoria: r.categoria || 'manha',
    tempoDecorrido: Number(r.tempo_decorrido) || 0,
    timerState: r.timer_state || 'paused',
    timerStartedAt: r.timer_started_at || null,
    periodo: Number(r.periodo) || 1,
    pausa: r.pausa || '',
    setA: Math.max(0, Number(r.set_a) || 0),
    setB: Math.max(0, Number(r.set_b) || 0),
    parciais: Array.isArray(r.parciais) ? r.parciais.map(function (p) {
      return { a: Number(p && p.a) || 0, b: Number(p && p.b) || 0 };
    }) : [],
    regras: r.regras && typeof r.regras === 'object' ? r.regras : {},
    finalizadoEm: Number(r.finalizado_em) || null,
    eventos: []
  };
}
function _mapEvento(id, r) {
  var tipo = r.tipo || 'info';
  return {
    id: 'ev-' + id,
    _dbId: id,
    tipo: tipo,
    marco: r.marco || '',
    time: r.time || '',
    descricao: r.descricao || '',
    minuto: r.minuto || '',
    periodo: Number(r.periodo) || 0,
    valor: Number(r.valor) || (tipo === 'gol' || tipo === 'ponto' ? 1 : 0),
    timestamp: Number(r.timestamp) || 0
  };
}
function _mapUsuario(d) {
  var r = d.data();
  return { id: d.id, email: r.email, senha: r.senha, role: r.role, nome: r.nome, categoria: r.categoria || 'ambas' };
}
function _mapValor(d) {
  var r = d.data();
  return {
    id: d.id,
    equipeNome: r.equipe_nome,
    pontos: Number(r.pontos) || 0,
    criterio: r.criterio || '',
    descricao: r.descricao || '',
    categoria: r.categoria || 'manha',
    criadoEm: Number(r.criado_em) || 0
  };
}
function _mapValoresConfig(r) {
  var saida = {};
  CATEGORIAS.forEach(function (cat) {
    var bloco = r && r[cat] && typeof r[cat] === 'object' ? r[cat] : {};
    var totais = {};
    if (bloco.liberado && bloco.totais && typeof bloco.totais === 'object') {
      Object.keys(bloco.totais).forEach(function (nome) { totais[nome] = Number(bloco.totais[nome]) || 0; });
    }
    saida[cat] = { liberado: Boolean(bloco.liberado), totais: totais, liberadoEm: Number(bloco.liberado_em) || 0 };
  });
  return saida;
}
function _mapPonto(d) {
  var r = d.data();
  return {
    id: d.id,
    equipeNome: r.equipe_nome,
    jogoId: r.jogo_id || '',
    pontos: r.pontos,
    descricao: r.descricao || '',
    categoria: r.categoria || 'manha'
  };
}

/* ---- Sync: dispara quando dados mudam (agrupado por quadro de animação) ---- */
var _syncAgendado = false;
function onSync(callback) {
  window.addEventListener('jes2026-data-changed', function () { callback(); });
}
function _notifySync() {
  if (_syncAgendado) return;
  _syncAgendado = true;
  /* Aba em segundo plano não recebe animation frames: um timer garante que a atualização (e o som
     dos lances) aconteça mesmo assim. Quem chegar primeiro dispara, uma única vez. */
  var feito = false;
  function disparar() {
    if (feito) return;
    feito = true;
    _syncAgendado = false;
    window.dispatchEvent(new Event('jes2026-data-changed'));
  }
  if (window.requestAnimationFrame && !document.hidden) window.requestAnimationFrame(disparar);
  setTimeout(disparar, document.hidden ? 16 : 100);
}

/* ---- Estado de sincronização (indicador "ao vivo / salvando / offline") ---- */
var _escritasPendentes = 0;
var _ultimoErro = null;

function getEstadoSync() {
  return {
    online: navigator.onLine !== false,
    pendentes: _escritasPendentes,
    carregado: _db._loaded,
    servidor: _db._servidor,
    erro: _ultimoErro
  };
}
function _emitirSync() {
  window.dispatchEvent(new CustomEvent('jes2026-sync', { detail: getEstadoSync() }));
}
window.addEventListener('online', _emitirSync);
window.addEventListener('offline', _emitirSync);

/* Toda escrita passa por aqui: conta pendências e registra falhas.
   A interface não espera a promessa — o listener local já reflete a mudança. */
function _rastrear(promessa) {
  _escritasPendentes++;
  _ultimoErro = null;
  _emitirSync();
  return promessa.then(function (resultado) {
    _escritasPendentes = Math.max(0, _escritasPendentes - 1);
    _emitirSync();
    return resultado;
  }, function (err) {
    _escritasPendentes = Math.max(0, _escritasPendentes - 1);
    _ultimoErro = err;
    _emitirSync();
    console.error('Erro ao salvar no Firestore:', err);
    throw err;
  });
}

/* ---- Compatibilidade: initDB não faz nada ---- */
function initDB() {}

/* ---- Sessão (continua em localStorage) ---- */
function setSession(email, role, categoria) {
  _gravarStorage(SESSION_KEY, JSON.stringify({ email: email, role: role || 'master', categoria: categoria || 'ambas', timestamp: Date.now() }));
}
function getSession() {
  var raw = _lerStorage(SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function clearSession() {
  _removerStorage(SESSION_KEY);
}

/* ---- Helpers de usuários ---- */
function getUsuarioAtual() {
  var session = getSession();
  if (!session) return null;
  return _db.usuarios.find(function (c) { return c.email === session.email; }) || null;
}
function isMaster() {
  var user = getUsuarioAtual();
  return Boolean(user && user.role === 'master');
}
function existeUsuarioComEmail(email, ignorarId) {
  var alvo = String(email || '').trim().toLowerCase();
  return _db.usuarios.some(function (u) {
    return String(u.email || '').toLowerCase() === alvo && String(u.id) !== String(ignorarId || '');
  });
}

/* =====================================================
   MOTOR DE REGRAS ESPORTIVAS
   Cada modalidade cai em um perfil: gols, basquete (1/2/3),
   sets (vôlei, mesa) ou pontos genéricos
   ===================================================== */
var PERFIS = {
  gol: {
    tipo: 'gol', nome: 'Gols', periodos: 2, cronometro: true,
    pontuacoes: [{ valor: 1, rotulo: 'Gol', curto: '+1', titulo: 'GOOOL!' }]
  },
  basquete: {
    tipo: 'basquete', nome: 'Basquete — 1, 2 e 3 pontos', periodos: 4, cronometro: true,
    pontuacoes: [
      { valor: 1, rotulo: 'Lance livre', curto: '+1', titulo: 'LANCE LIVRE' },
      { valor: 2, rotulo: 'Cesta de 2', curto: '+2', titulo: 'CESTA!' },
      { valor: 3, rotulo: 'Cesta de 3', curto: '+3', titulo: 'CESTA DE 3!' }
    ]
  },
  volei: {
    tipo: 'sets', nome: 'Sets — vôlei', cronometro: false,
    setsParaVencer: 2, pontosSet: 25, pontosTiebreak: 15,
    pontuacoes: [{ valor: 1, rotulo: 'Ponto', curto: '+1', titulo: 'PONTO!' }]
  },
  mesa: {
    tipo: 'sets', nome: 'Sets — mesa', cronometro: false,
    setsParaVencer: 2, pontosSet: 11, pontosTiebreak: 11,
    pontuacoes: [{ valor: 1, rotulo: 'Ponto', curto: '+1', titulo: 'PONTO!' }]
  },
  pontos: {
    tipo: 'pontos', nome: 'Pontos', periodos: 1, cronometro: true,
    pontuacoes: [{ valor: 1, rotulo: 'Ponto', curto: '+1', titulo: 'PONTO!' }]
  }
};

/* Lances rápidos (sem pontuação) disponíveis na mesa de controle */
var LANCES = {
  cartao_amarelo: { rotulo: 'Cartão amarelo', curto: 'Amarelo' },
  cartao_vermelho: { rotulo: 'Cartão vermelho', curto: 'Vermelho' },
  exclusao: { rotulo: 'Exclusão de 2 minutos', curto: "2 min" },
  falta: { rotulo: 'Falta', curto: 'Falta' },
  /* Não aparece mais nos botões da mesa; fica só para exibir lances antigos já gravados */
  substituicao: { rotulo: 'Substituição', curto: 'Troca' }
};

function _normalizar(txt) {
  return String(txt || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function _perfilPorNome(n) {
  if (n.indexOf('basquet') !== -1 || n.indexOf('basket') !== -1) return 'basquete';
  if (n.indexOf('volei') !== -1 || n.indexOf('voley') !== -1) return 'volei';
  if (n.indexOf('ping') !== -1 || n.indexOf('tenis de mesa') !== -1 || n.indexOf('badminton') !== -1) return 'mesa';
  if (n.indexOf('futsal') !== -1 || n.indexOf('futebol') !== -1 || n.indexOf('society') !== -1 ||
      n.indexOf('handebol') !== -1 || n.indexOf('handball') !== -1 || n.indexOf('pebolim') !== -1) return 'gol';
  return 'pontos';
}

function _lancesDoPerfil(perfil, n) {
  if (perfil === 'basquete') return ['falta'];
  if (perfil === 'volei') return [];
  if (perfil === 'mesa' || perfil === 'pontos' || n.indexOf('pebolim') !== -1) return [];
  if (n.indexOf('handebol') !== -1 || n.indexOf('handball') !== -1) return ['cartao_amarelo', 'exclusao', 'cartao_vermelho'];
  return ['cartao_amarelo', 'cartao_vermelho'];
}

function getRegraModalidade(nome) {
  var n = _normalizar(nome);
  var perfil = _perfilPorNome(n);
  var regra = Object.assign({
    perfil: perfil,
    lances: _lancesDoPerfil(perfil, n),
    pedidoTempo: perfil !== 'mesa' && perfil !== 'pontos' && n.indexOf('pebolim') === -1
  }, PERFIS[perfil]);
  if (regra.tipo === 'sets') regra.maxSets = regra.setsParaVencer * 2 - 1;
  return regra;
}

function _inteiroEntre(valor, min, max, padrao) {
  var n = parseInt(valor, 10);
  if (isNaN(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}

/* Regras efetivas de um jogo: padrões da modalidade + ajustes salvos no próprio jogo */
function getRegraJogo(jogo) {
  var base = getRegraModalidade(jogo && jogo.modalidade);
  var ajustes = (jogo && jogo.regras) || {};
  var regra = Object.assign({}, base);
  if (regra.tipo === 'sets') {
    regra.setsParaVencer = _inteiroEntre(ajustes.sets_para_vencer, 1, 5, base.setsParaVencer);
    regra.pontosSet = _inteiroEntre(ajustes.pontos_set, 5, 99, base.pontosSet);
    regra.pontosTiebreak = _inteiroEntre(ajustes.pontos_tiebreak, 5, 99, base.pontosTiebreak);
    regra.maxSets = regra.setsParaVencer * 2 - 1;
  } else {
    regra.periodos = _inteiroEntre(ajustes.periodos, 1, 8, base.periodos);
  }
  return regra;
}

function ehPontuacao(evento) {
  return Boolean(evento) && (evento.tipo === 'gol' || evento.tipo === 'ponto');
}

/* "do 1º Tempo" / "da Prorrogação" */
function _comArtigo(nomePeriodo) {
  var feminino = /^Prorroga|ª/.test(nomePeriodo);
  return (feminino ? 'da ' : 'do ') + nomePeriodo;
}

/* Nome do período: "2º Tempo", "3º Quarto", "1º Set", "Prorrogação" ('' em jogo de tempo único) */
function getNomePeriodo(jogo, numero) {
  var regra = getRegraJogo(jogo);
  var n = numero || (jogo && jogo.periodo) || 1;
  if (regra.tipo === 'sets') return n + 'º Set';
  if (n > regra.periodos) return n - regra.periodos === 1 ? 'Prorrogação' : (n - regra.periodos) + 'ª Prorrogação';
  if (regra.periodos === 1) return '';
  if (regra.periodos === 4) return n + 'º Quarto';
  return n + 'º Tempo';
}

/* Sigla curta para o lance a lance: "1ºT", "3ºQ", "2ºS", "PR" */
function getSiglaPeriodo(jogo, numero) {
  var regra = getRegraJogo(jogo);
  var n = numero || 1;
  if (regra.tipo === 'sets') return n + 'ºS';
  if (n > regra.periodos) return 'PR' + (n - regra.periodos > 1 ? String(n - regra.periodos) : '');
  if (regra.periodos === 1) return '';
  return n + (regra.periodos === 4 ? 'ºQ' : 'ºT');
}

/* Rótulo do estado pausado: "Intervalo", "Fim do 1º Quarto", "Fim do 2º Set"... */
function getRotuloPausa(jogo) {
  if (!jogo || jogo.status !== 'PAUSADO') return null;
  var regra = getRegraJogo(jogo);
  var n = jogo.periodo || 1;
  if (jogo.pausa === 'tempo_tecnico') {
    return { tipo: 'tempo', titulo: 'Tempo técnico', detalhe: getNomePeriodo(jogo, n) || 'Partida parada' };
  }
  if (jogo.pausa === 'fim_periodo') {
    if (regra.tipo === 'sets') {
      var numero = jogo.parciais.length;
      var ultimo = jogo.parciais[numero - 1];
      return { tipo: 'set', titulo: 'Fim do ' + numero + 'º Set', detalhe: ultimo ? 'Parcial ' + ultimo.a + ' × ' + ultimo.b : '' };
    }
    if (n > regra.periodos) return { tipo: 'periodo', titulo: 'Fim ' + _comArtigo(getNomePeriodo(jogo, n)), detalhe: 'Aguardando a mesa' };
    if (n === regra.periodos) return { tipo: 'periodo', titulo: 'Fim do tempo normal', detalhe: 'Aguardando a mesa' };
    if (regra.periodos === 4) {
      if (n === 2) return { tipo: 'intervalo', titulo: 'Intervalo', detalhe: 'Fim do 2º Quarto' };
      return { tipo: 'quarto', titulo: 'Fim do ' + n + 'º Quarto', detalhe: 'A seguir: ' + (n + 1) + 'º Quarto' };
    }
    if (regra.periodos === 2 && n === 1) return { tipo: 'intervalo', titulo: 'Intervalo', detalhe: 'Fim do 1º Tempo' };
    return { tipo: 'periodo', titulo: 'Fim ' + _comArtigo(getNomePeriodo(jogo, n)), detalhe: 'A seguir: ' + getNomePeriodo(jogo, n + 1) };
  }
  return { tipo: 'pausa', titulo: 'Jogo pausado', detalhe: 'Aguardando reinício' };
}

function _placarPorParciais(parciais) {
  var placar = { a: 0, b: 0 };
  parciais.forEach(function (p) {
    if (p.a > p.b) placar.a++;
    else if (p.b > p.a) placar.b++;
  });
  return placar;
}

function partidaDecidida(jogo) {
  var regra = getRegraJogo(jogo);
  if (regra.tipo !== 'sets') return false;
  return jogo.placarA >= regra.setsParaVencer || jogo.placarB >= regra.setsParaVencer;
}

/* Estado do set em andamento: alvo de pontos, set point, set concluído */
function getEstadoSet(jogo) {
  var regra = getRegraJogo(jogo);
  if (regra.tipo !== 'sets') return null;
  var numero = jogo.parciais.length + 1;
  var decisivo = regra.maxSets > 1 && numero === regra.maxSets;
  var alvo = decisivo ? regra.pontosTiebreak : regra.pontosSet;
  var a = jogo.setA;
  var b = jogo.setB;
  var vencedor = null;
  var setPoint = null;
  if ((a >= alvo || b >= alvo) && Math.abs(a - b) >= 2) vencedor = a > b ? 'A' : 'B';
  else if (a >= alvo - 1 && a > b) setPoint = 'A';
  else if (b >= alvo - 1 && b > a) setPoint = 'B';
  var matchPoint = Boolean(setPoint) && (setPoint === 'A' ? jogo.placarA : jogo.placarB) + 1 >= regra.setsParaVencer;
  return {
    numero: numero,
    decisivo: decisivo,
    alvo: alvo,
    vencedor: vencedor,
    setPoint: setPoint,
    matchPoint: matchPoint,
    decidido: partidaDecidida(jogo)
  };
}

function getVencedor(jogo) {
  if (!jogo || jogo.placarA === jogo.placarB) return null;
  return jogo.placarA > jogo.placarB ? 'A' : 'B';
}

/* Contagem por time: { A: { pontos: {1:n,2:n,3:n}, cartao_amarelo: n, ... }, B: {...} } */
function getResumoLances(jogo) {
  var resumo = { A: { pontos: { 1: 0, 2: 0, 3: 0 } }, B: { pontos: { 1: 0, 2: 0, 3: 0 } } };
  (jogo && jogo.eventos || []).forEach(function (ev) {
    var lado = resumo[ev.time];
    if (!lado) return;
    if (ehPontuacao(ev)) lado.pontos[ev.valor] = (lado.pontos[ev.valor] || 0) + 1;
    else lado[ev.tipo] = (lado[ev.tipo] || 0) + 1;
  });
  return resumo;
}

/* ---- Helpers de dados (síncronos, lêem do cache) ---- */
/* Todos filtrados pela categoria ativa, exceto quando indicado */
function _filterCat(items) {
  return items.filter(function (item) {
    var cat = item.categoria || 'manha';
    return cat === _categoriaAtual || cat === 'ambas';
  });
}

/* Data local (toISOString usaria UTC e viraria o dia às 21h no Brasil) */
function hojeISO() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getJogos() { return _filterCat(_db.jogos); }
function getEquipes() { return _filterCat(_db.equipes); }
function getModalidades() { return _filterCat(_db.modalidades); }
function getRegulamentos() { return _db.regulamentos; }

function getJogosAll() { return _db.jogos; }
function getEquipesAll() { return _db.equipes; }
function getModalidadesAll() { return _db.modalidades; }

function getJogoById(id) {
  return _db.jogos.find(function (j) { return j.id === id; }) || null;
}
function getEquipeByNome(nome) {
  return _db.equipes.find(function (e) { return e.nome === nome; }) || null;
}
function getModalidadeDoJogo(jogo) {
  return _db.modalidades.find(function (m) { return m.nome === jogo.modalidade && m.genero === jogo.genero; }) || null;
}

function getJogosHoje() {
  var hoje = hojeISO();
  return _filterCat(_db.jogos).filter(function (j) { return j.data === hoje; });
}

/* Jogos que terminaram há pouco (para a comemoração ficar visível na home) */
function getJogosRecemFinalizados(minutos) {
  var limite = Date.now() - (minutos || 20) * 60000;
  return getJogosHoje().filter(function (j) {
    return j.status === 'FINALIZADO' && j.finalizadoEm && j.finalizadoEm >= limite;
  });
}

/* Partidas de outros dias que ficaram abertas (a mesa precisa encerrar) */
function getJogosAbertosAntigos() {
  var hoje = hojeISO();
  return _filterCat(_db.jogos).filter(function (j) {
    return (j.status === 'AO VIVO' || j.status === 'PAUSADO') && j.data !== hoje;
  });
}

/* Classificação: com modalidade, soma só os pontos ligados a jogos daquele esporte.
   Na classificação geral entram também os Valores Olímpicos, mas só depois que o
   administrador libera (antes disso o público não recebe esses números). */
function getClassificacao(modalidadeNome) {
  var equipes = _filterCat(_db.equipes);
  var pontosJogos = _filterCat(_db.pontosJogos);
  var geral = !modalidadeNome || modalidadeNome === 'all';
  if (!geral) {
    pontosJogos = pontosJogos.filter(function (p) {
      var jogo = p.jogoId ? getJogoById(p.jogoId) : null;
      return Boolean(jogo) && jogo.modalidade === modalidadeNome;
    });
  }
  var publicados = geral ? getValoresPublicados() : { liberado: false, totais: {} };
  var classificacao = equipes.map(function (eq) {
    var doJogos = pontosJogos.filter(function (p) { return p.equipeNome === eq.nome; })
      .reduce(function (sum, p) { return sum + (parseInt(p.pontos, 10) || 0); }, 0);
    var valores = publicados.liberado ? (Number(publicados.totais[eq.nome]) || 0) : 0;
    return { id: eq.id, unidade: eq.nome, pontosJogos: doJogos, valores: valores, pontos: doJogos + valores };
  });
  classificacao.sort(function (a, b) { return b.pontos - a.pontos || a.unidade.localeCompare(b.unidade); });
  classificacao.forEach(function (row, i) { row.posicao = i + 1; });
  return classificacao;
}

function getHistorico() {
  return _filterCat(_db.jogos).filter(function (jogo) { return jogo.status === 'FINALIZADO'; })
    .sort(function (a, b) { return (b.data + b.horario).localeCompare(a.data + a.horario); });
}

function getPontosPorEquipe(equipeNome) {
  return _filterCat(_db.pontosJogos).filter(function (p) { return p.equipeNome === equipeNome; });
}

/* ---- Temporizador ---- */
function getTempoJogo(jogo, agora) {
  var tempo = Number(jogo && jogo.tempoDecorrido) || 0;
  if (!jogo || jogo.timerState !== 'running' || !jogo.timerStartedAt) return tempo;
  return tempo + Math.max(0, Math.floor(((agora || Date.now()) - jogo.timerStartedAt) / 1000));
}

function formatarTempoJogo(segundos) {
  var total = Math.max(0, Number(segundos) || 0);
  var minutos = Math.floor(total / 60);
  var segundosRestantes = total % 60;
  return String(minutos).padStart(2, '0') + ':' + String(segundosRestantes).padStart(2, '0');
}

function atualizarTempoJogo(jogo) {
  if (!jogo) return;
  jogo.tempoDecorrido = getTempoJogo(jogo);
  jogo.timerStartedAt = null;
}

function sincronizarTemporizadorComStatus(jogo, status) {
  if (!jogo) return;
  if (status === 'AO VIVO') {
    if (jogo.timerState !== 'running') {
      jogo.timerState = 'running';
      jogo.timerStartedAt = Date.now();
    }
  } else if (status === 'FINALIZADO') {
    atualizarTempoJogo(jogo);
    jogo.timerState = 'stopped';
  } else if (jogo.timerState === 'running') {
    atualizarTempoJogo(jogo);
    jogo.timerState = 'paused';
  }
}

/* Campos de cronômetro que acompanham uma troca de status */
function _camposTimerParaStatus(jogo, status) {
  var copia = Object.assign({}, jogo);
  sincronizarTemporizadorComStatus(copia, status);
  return {
    tempo_decorrido: copia.tempoDecorrido,
    timer_state: copia.timerState,
    timer_started_at: copia.timerStartedAt || null
  };
}

/* Congela o cronômetro e mescla campos extras */
function _camposPausa(jogo, extra) {
  return Object.assign({
    tempo_decorrido: getTempoJogo(jogo),
    timer_state: 'paused',
    timer_started_at: null
  }, extra || {});
}

/* =====================================================
   OPERAÇÕES DA PARTIDA (mesa de controle)
   Placar usa increment() e lote atômico (writeBatch):
   dois mesários marcando ao mesmo tempo não perdem pontos
   ===================================================== */
function _jogo(id) { return getJogoById(id); }
function _refJogo(jogo) { return doc(getDb(), 'jogos', jogo._dbId); }
function _novoRefEvento() { return doc(collection(getDb(), 'eventos')); }
function _nomeTime(jogo, time) { return time === 'A' ? jogo.timeA : time === 'B' ? jogo.timeB : ''; }

function _dadosEvento(jogo, dados) {
  return {
    jogo_id: jogo._dbId,
    tipo: dados.tipo || 'info',
    marco: dados.marco || '',
    time: dados.time || '',
    descricao: dados.descricao || '',
    minuto: dados.minuto != null ? dados.minuto : formatarTempoJogo(getTempoJogo(jogo)),
    periodo: dados.periodo || jogo.periodo || 1,
    valor: dados.valor || 0,
    timestamp: Date.now()
  };
}

function _ultimoMarco(jogo, marco, periodo) {
  return jogo.eventos.slice().reverse().find(function (ev) {
    return ev.marco === marco && (periodo == null || ev.periodo === periodo);
  }) || null;
}

async function iniciarPartida(jogoId) {
  var jogo = _jogo(jogoId);
  if (!jogo || jogo.status === 'FINALIZADO') return false;
  var batch = writeBatch(getDb());
  batch.update(_refJogo(jogo), {
    status: 'AO VIVO', pausa: '', periodo: 1, tempo_decorrido: 0,
    timer_state: 'running', timer_started_at: Date.now(), finalizado_em: null
  });
  batch.set(_novoRefEvento(), _dadosEvento(jogo, { tipo: 'inicio', marco: 'inicio', descricao: 'Início da partida', minuto: '00:00', periodo: 1 }));
  return _rastrear(batch.commit());
}

async function retomarPartida(jogoId) {
  var jogo = _jogo(jogoId);
  if (!jogo || jogo.status !== 'PAUSADO') return false;
  return _rastrear(updateDoc(_refJogo(jogo), {
    status: 'AO VIVO', pausa: '', timer_state: 'running', timer_started_at: Date.now()
  }));
}

/* motivo: 'pausa' | 'tempo_tecnico' | 'fim_periodo' */
async function pausarPartida(jogoId, motivo, time) {
  motivo = motivo || 'pausa';
  if (motivo === 'fim_periodo') return encerrarPeriodo(jogoId);
  var jogo = _jogo(jogoId);
  if (!jogo || jogo.status !== 'AO VIVO') return false;
  var batch = writeBatch(getDb());
  batch.update(_refJogo(jogo), _camposPausa(jogo, { status: 'PAUSADO', pausa: motivo }));
  if (motivo === 'tempo_tecnico') {
    var nome = _nomeTime(jogo, time);
    batch.set(_novoRefEvento(), _dadosEvento(jogo, {
      tipo: 'tempo', marco: 'tempo_tecnico', time: time || '',
      descricao: 'Pedido de tempo' + (nome ? ' — ' + nome : '')
    }));
  }
  return _rastrear(batch.commit());
}

async function encerrarPeriodo(jogoId) {
  var jogo = _jogo(jogoId);
  if (!jogo) return false;
  if (getRegraJogo(jogo).tipo === 'sets') return encerrarSet(jogoId);
  var podeEncerrar = jogo.status === 'AO VIVO' || (jogo.status === 'PAUSADO' && jogo.pausa !== 'fim_periodo');
  if (!podeEncerrar) return false;
  var nomePeriodo = getNomePeriodo(jogo);
  var batch = writeBatch(getDb());
  batch.update(_refJogo(jogo), _camposPausa(jogo, { status: 'PAUSADO', pausa: 'fim_periodo' }));
  batch.set(_novoRefEvento(), _dadosEvento(jogo, {
    tipo: 'tempo', marco: 'fim_periodo',
    descricao: nomePeriodo ? 'Fim ' + _comArtigo(nomePeriodo) : 'Fim do tempo'
  }));
  return _rastrear(batch.commit());
}

/* Começa o próximo tempo/quarto/set (cronômetro do período recomeça do zero) */
async function iniciarProximoPeriodo(jogoId) {
  var jogo = _jogo(jogoId);
  if (!jogo || jogo.status === 'FINALIZADO') return false;
  var regra = getRegraJogo(jogo);
  var proximo = regra.tipo === 'sets' ? jogo.parciais.length + 1 : (jogo.periodo || 1) + 1;
  var campos = { status: 'AO VIVO', pausa: '', periodo: proximo, timer_state: 'running', timer_started_at: Date.now() };
  if (regra.tipo !== 'sets') campos.tempo_decorrido = 0;
  var batch = writeBatch(getDb());
  batch.update(_refJogo(jogo), campos);
  batch.set(_novoRefEvento(), _dadosEvento(jogo, {
    tipo: 'tempo', marco: 'inicio_periodo', periodo: proximo,
    minuto: regra.tipo === 'sets' ? null : '00:00',
    descricao: 'Início ' + _comArtigo(getNomePeriodo(jogo, proximo))
  }));
  return _rastrear(batch.commit());
}

/* Corrige um "fim de período" marcado sem querer */
async function desfazerFimPeriodo(jogoId) {
  var jogo = _jogo(jogoId);
  if (!jogo || jogo.status !== 'PAUSADO' || jogo.pausa !== 'fim_periodo') return false;
  if (getRegraJogo(jogo).tipo === 'sets') return reabrirSet(jogoId);
  var batch = writeBatch(getDb());
  batch.update(_refJogo(jogo), { status: 'AO VIVO', pausa: '', timer_state: 'running', timer_started_at: Date.now() });
  var marco = _ultimoMarco(jogo, 'fim_periodo', jogo.periodo);
  if (marco) batch.delete(doc(getDb(), 'eventos', marco._dbId));
  return _rastrear(batch.commit());
}

async function finalizarPartida(jogoId) {
  var jogo = _jogo(jogoId);
  if (!jogo || jogo.status === 'FINALIZADO') return false;
  var regra = getRegraJogo(jogo);
  var campos = _camposPausa(jogo, { status: 'FINALIZADO', pausa: '', timer_state: 'stopped', finalizado_em: Date.now() });
  var placarA = jogo.placarA;
  var placarB = jogo.placarB;
  if (regra.tipo === 'sets' && (jogo.setA > 0 || jogo.setB > 0)) {
    /* Set em andamento com vencedor entra na súmula; empatado é descartado */
    if (jogo.setA !== jogo.setB) {
      var parciais = jogo.parciais.concat([{ a: jogo.setA, b: jogo.setB }]);
      var placar = _placarPorParciais(parciais);
      campos.parciais = parciais;
      campos.placar_a = placarA = placar.a;
      campos.placar_b = placarB = placar.b;
    }
    campos.set_a = 0;
    campos.set_b = 0;
  }
  var batch = writeBatch(getDb());
  batch.update(_refJogo(jogo), campos);
  batch.set(_novoRefEvento(), _dadosEvento(jogo, {
    tipo: 'fim', marco: 'fim',
    descricao: 'Fim de jogo: ' + jogo.timeA + ' ' + placarA + ' × ' + placarB + ' ' + jogo.timeB
  }));
  return _rastrear(batch.commit());
}

async function reabrirPartida(jogoId) {
  var jogo = _jogo(jogoId);
  if (!jogo || jogo.status !== 'FINALIZADO') return false;
  var batch = writeBatch(getDb());
  batch.update(_refJogo(jogo), { status: 'PAUSADO', pausa: 'pausa', timer_state: 'paused', timer_started_at: null, finalizado_em: null });
  var marco = _ultimoMarco(jogo, 'fim');
  if (marco) batch.delete(doc(getDb(), 'eventos', marco._dbId));
  return _rastrear(batch.commit());
}

/* Ponto/gol/cesta. Em sets, conta o ponto do set atual (sem poluir o lance a lance) */
async function registrarPonto(jogoId, time, valor) {
  var jogo = _jogo(jogoId);
  if (!jogo || (time !== 'A' && time !== 'B')) return false;
  if (jogo.status === 'EM BREVE' || jogo.status === 'FINALIZADO') return false;
  var regra = getRegraJogo(jogo);
  var upd = {};
  if (regra.tipo === 'sets') {
    if (jogo.status === 'PAUSADO' && jogo.pausa === 'fim_periodo') return false;
    upd[time === 'A' ? 'set_a' : 'set_b'] = increment(1);
    return _rastrear(updateDoc(_refJogo(jogo), upd));
  }
  var pontuacao = regra.pontuacoes.find(function (p) { return p.valor === Number(valor); }) || regra.pontuacoes[0];
  var batch = writeBatch(getDb());
  batch.set(_novoRefEvento(), _dadosEvento(jogo, {
    tipo: regra.tipo === 'gol' ? 'gol' : 'ponto',
    time: time,
    valor: pontuacao.valor,
    descricao: pontuacao.rotulo + ' — ' + _nomeTime(jogo, time)
  }));
  upd[time === 'A' ? 'placar_a' : 'placar_b'] = increment(pontuacao.valor);
  batch.update(_refJogo(jogo), upd);
  return _rastrear(batch.commit());
}

/* Desfaz o último ponto do time (remove o lance e devolve o valor dele) */
async function desfazerPonto(jogoId, time) {
  var jogo = _jogo(jogoId);
  if (!jogo || (time !== 'A' && time !== 'B')) return false;
  var regra = getRegraJogo(jogo);
  var upd = {};
  if (regra.tipo === 'sets') {
    if ((time === 'A' ? jogo.setA : jogo.setB) <= 0) return false;
    upd[time === 'A' ? 'set_a' : 'set_b'] = increment(-1);
    return _rastrear(updateDoc(_refJogo(jogo), upd));
  }
  var placar = time === 'A' ? jogo.placarA : jogo.placarB;
  if (placar <= 0) return false;
  var ultimo = jogo.eventos.slice().reverse().find(function (ev) { return ehPontuacao(ev) && ev.time === time; });
  var batch = writeBatch(getDb());
  if (ultimo) batch.delete(doc(getDb(), 'eventos', ultimo._dbId));
  upd[time === 'A' ? 'placar_a' : 'placar_b'] = increment(-Math.min(ultimo ? ultimo.valor : 1, placar));
  batch.update(_refJogo(jogo), upd);
  return _rastrear(batch.commit());
}

/* Lance sem pontuação: cartões, faltas, anotações */
async function registrarLance(jogoId, tipo, time, descricao) {
  var jogo = _jogo(jogoId);
  if (!jogo) return false;
  var info = LANCES[tipo];
  var nome = _nomeTime(jogo, time);
  var texto = descricao || ((info ? info.rotulo : 'Lance') + (nome ? ' — ' + nome : ''));
  return _rastrear(addDoc(collection(getDb(), 'eventos'), _dadosEvento(jogo, { tipo: tipo || 'info', time: time || '', descricao: texto })));
}

/* Fecha o set atual: grava a parcial e recalcula o placar de sets */
async function encerrarSet(jogoId) {
  var jogo = _jogo(jogoId);
  if (!jogo || jogo.status === 'FINALIZADO' || jogo.status === 'EM BREVE') return false;
  if (getRegraJogo(jogo).tipo !== 'sets') return false;
  var a = jogo.setA;
  var b = jogo.setB;
  if (a === b) return false;
  var vencedor = a > b ? 'A' : 'B';
  var parciais = jogo.parciais.concat([{ a: a, b: b }]);
  var placar = _placarPorParciais(parciais);
  var batch = writeBatch(getDb());
  batch.update(_refJogo(jogo), _camposPausa(jogo, {
    parciais: parciais, placar_a: placar.a, placar_b: placar.b,
    set_a: 0, set_b: 0, periodo: parciais.length, status: 'PAUSADO', pausa: 'fim_periodo'
  }));
  batch.set(_novoRefEvento(), _dadosEvento(jogo, {
    tipo: 'set', marco: 'fim_set', time: vencedor, periodo: parciais.length,
    descricao: parciais.length + 'º set: ' + a + ' × ' + b + ' — ' + _nomeTime(jogo, vencedor)
  }));
  return _rastrear(batch.commit());
}

/* Desfaz o último set encerrado: devolve a parcial para o placar do set */
async function reabrirSet(jogoId) {
  var jogo = _jogo(jogoId);
  if (!jogo || jogo.parciais.length === 0 || jogo.status === 'FINALIZADO') return false;
  var ultimo = jogo.parciais[jogo.parciais.length - 1];
  var parciais = jogo.parciais.slice(0, -1);
  var placar = _placarPorParciais(parciais);
  var batch = writeBatch(getDb());
  batch.update(_refJogo(jogo), {
    parciais: parciais, placar_a: placar.a, placar_b: placar.b,
    set_a: ultimo.a, set_b: ultimo.b, periodo: parciais.length + 1,
    status: 'AO VIVO', pausa: '', timer_state: 'running', timer_started_at: Date.now()
  });
  var marco = _ultimoMarco(jogo, 'fim_set');
  if (marco) batch.delete(doc(getDb(), 'eventos', marco._dbId));
  return _rastrear(batch.commit());
}

/* Volta a partida ao estado inicial (apaga lances, placar, sets e cronômetro) */
async function zerarPartida(jogoId) {
  var jogo = _jogo(jogoId);
  if (!jogo) return false;
  var db = getDb();
  var refs = jogo.eventos.map(function (ev) { return doc(db, 'eventos', ev._dbId); });
  var lotes = [];
  for (var i = 0; i < refs.length; i += 450) lotes.push(refs.slice(i, i + 450));
  if (lotes.length === 0) lotes.push([]);
  return _rastrear(Promise.all(lotes.map(function (lote, indice) {
    var batch = writeBatch(db);
    lote.forEach(function (ref) { batch.delete(ref); });
    if (indice === lotes.length - 1) {
      batch.update(_refJogo(jogo), {
        placar_a: 0, placar_b: 0, set_a: 0, set_b: 0, parciais: [], periodo: 1, pausa: '',
        status: 'EM BREVE', tempo_decorrido: 0, timer_state: 'paused', timer_started_at: null, finalizado_em: null
      });
    }
    return batch.commit();
  })));
}

async function removerEvento(jogoId, eventoId) {
  var jogo = _jogo(jogoId);
  if (!jogo) return false;
  var evento = jogo.eventos.find(function (ev) { return ev.id === eventoId; });
  if (!evento) return false;
  var db = getDb();
  var placar = evento.time === 'A' ? jogo.placarA : evento.time === 'B' ? jogo.placarB : 0;
  if (ehPontuacao(evento) && placar > 0) {
    var batch = writeBatch(db);
    var upd = {};
    batch.delete(doc(db, 'eventos', evento._dbId));
    upd[evento.time === 'A' ? 'placar_a' : 'placar_b'] = increment(-Math.min(evento.valor || 1, placar));
    batch.update(_refJogo(jogo), upd);
    return _rastrear(batch.commit());
  }
  return _rastrear(deleteDoc(doc(db, 'eventos', evento._dbId)));
}

/* ---- Compatibilidade com a API anterior do painel ---- */
async function adicionarEvento(jogoId, tipo, time, descricao, minuto) {
  var jogo = _jogo(jogoId);
  if (!jogo) return false;
  var pontua = (tipo === 'gol' || tipo === 'ponto') && (time === 'A' || time === 'B');
  var batch = writeBatch(getDb());
  batch.set(_novoRefEvento(), _dadosEvento(jogo, { tipo: tipo, time: time, descricao: descricao, minuto: minuto || null, valor: pontua ? 1 : 0 }));
  var upd = {};
  if (pontua) upd[time === 'A' ? 'placar_a' : 'placar_b'] = increment(1);
  if (jogo.status === 'EM BREVE') Object.assign(upd, { status: 'AO VIVO', timer_state: 'running', timer_started_at: Date.now() });
  if (Object.keys(upd).length) batch.update(_refJogo(jogo), upd);
  return _rastrear(batch.commit());
}
async function iniciarTemporizadorJogo(id) {
  var jogo = _jogo(id);
  if (!jogo) return false;
  if (jogo.status === 'EM BREVE') return iniciarPartida(id);
  if (jogo.status === 'PAUSADO' && jogo.pausa === 'fim_periodo') return iniciarProximoPeriodo(id);
  return retomarPartida(id);
}
async function pausarTemporizadorJogo(id) { return pausarPartida(id, 'pausa'); }
async function finalizarTemporizadorJogo(id) { return finalizarPartida(id); }
async function limparEventos(jogoId) { return zerarPartida(jogoId); }

async function atualizarPlacarJogo(jogoId, placarA, placarB) {
  var jogo = _jogo(jogoId);
  if (!jogo) return false;
  return _rastrear(updateDoc(_refJogo(jogo), {
    placar_a: Math.max(0, parseInt(placarA, 10) || 0),
    placar_b: Math.max(0, parseInt(placarB, 10) || 0)
  }));
}

async function atualizarResultado(id, placarA, placarB, status) {
  var jogo = _jogo(id);
  if (!jogo) return false;
  var row = Object.assign({
    placar_a: Math.max(0, parseInt(placarA, 10) || 0),
    placar_b: Math.max(0, parseInt(placarB, 10) || 0),
    status: status
  }, _camposTimerParaStatus(jogo, status));
  if (status === 'FINALIZADO' && jogo.status !== 'FINALIZADO') row.finalizado_em = Date.now();
  if (status !== 'PAUSADO') row.pausa = '';
  return _rastrear(updateDoc(_refJogo(jogo), row));
}

async function alterarStatusJogo(id, status) {
  var jogo = _jogo(id);
  if (!jogo) return false;
  var row = Object.assign({ status: status }, _camposTimerParaStatus(jogo, status));
  if (status === 'FINALIZADO' && jogo.status !== 'FINALIZADO') row.finalizado_em = Date.now();
  if (status !== 'PAUSADO') row.pausa = '';
  return _rastrear(updateDoc(_refJogo(jogo), row));
}

/* ---- CRUD Modalidades ---- */
async function criarModalidade(dados) {
  var row = { nome: dados.nome.trim(), genero: dados.genero, cor: dados.cor || '#E30613', categoria: dados.categoria || _categoriaAtual };
  return _rastrear(addDoc(collection(getDb(), 'modalidades'), row));
}

/* Renomear a modalidade também atualiza os jogos já cadastrados com ela */
async function atualizarModalidade(id, dados) {
  var db = getDb();
  var row = { nome: dados.nome.trim(), genero: dados.genero, cor: dados.cor || '#E30613' };
  var batch = writeBatch(db);
  batch.update(doc(db, 'modalidades', id), row);
  _db.jogos.forEach(function (jogo) {
    if (jogo.modalidadeId === id && (jogo.modalidade !== row.nome || jogo.genero !== row.genero)) {
      batch.update(_refJogo(jogo), { modalidade: row.nome, genero: row.genero });
    }
  });
  return _rastrear(batch.commit());
}

function modalidadeEmUso(id) {
  var mod = _db.modalidades.find(function (m) { return m.id === id; });
  return _db.jogos.some(function (jogo) {
    return jogo.modalidadeId === id || (mod && jogo.modalidade === mod.nome && jogo.genero === mod.genero && jogo.categoria === mod.categoria);
  });
}

async function apagarModalidade(id) {
  if (modalidadeEmUso(id)) return false;
  await _rastrear(deleteDoc(doc(getDb(), 'modalidades', id)));
  return true;
}

/* ---- CRUD Equipes ---- */
async function criarEquipe(nome, turma, brasao, categoria) {
  var row = { nome: nome.trim(), turma: (turma || '').trim(), brasao: brasao || '', categoria: categoria || _categoriaAtual };
  return _rastrear(addDoc(collection(getDb(), 'equipes'), row));
}

/* Jogos e pontos guardam o nome da equipe: um novo nome é propagado para eles */
async function atualizarEquipe(id, dados) {
  var db = getDb();
  var equipe = _db.equipes.find(function (e) { return e.id === id; });
  var row = {};
  if (dados.nome !== undefined) row.nome = dados.nome.trim();
  if (dados.turma !== undefined) row.turma = dados.turma.trim();
  if (dados.brasao !== undefined) row.brasao = dados.brasao;
  if (dados.categoria !== undefined) row.categoria = dados.categoria;
  var batch = writeBatch(db);
  batch.update(doc(db, 'equipes', id), row);
  if (equipe && row.nome && row.nome !== equipe.nome) {
    var antigo = equipe.nome;
    _db.jogos.forEach(function (jogo) {
      if (jogo.categoria !== equipe.categoria) return;
      var upd = {};
      if (jogo.timeA === antigo) upd.time_a = row.nome;
      if (jogo.timeB === antigo) upd.time_b = row.nome;
      if (Object.keys(upd).length) batch.update(_refJogo(jogo), upd);
    });
    _db.pontosJogos.forEach(function (p) {
      if (p.equipeNome === antigo && p.categoria === equipe.categoria) batch.update(doc(db, 'pontos_jogos', p.id), { equipe_nome: row.nome });
    });
    _db.valoresOlimpicos.forEach(function (v) {
      if (v.equipeNome === antigo && v.categoria === equipe.categoria) batch.update(doc(db, 'valores_olimpicos', v.id), { equipe_nome: row.nome });
    });
    var publicado = getValoresPublicados(equipe.categoria);
    if (publicado.liberado) {
      var totais = Object.assign({}, publicado.totais);
      if (Object.prototype.hasOwnProperty.call(totais, antigo)) { totais[row.nome] = totais[antigo]; delete totais[antigo]; }
      _gravarBlocoValores(batch, equipe.categoria, _blocoValores(true, totais, publicado.liberadoEm));
    }
  }
  return _rastrear(batch.commit());
}

async function apagarEquipe(id) {
  return _rastrear(deleteDoc(doc(getDb(), 'equipes', id)));
}

/* ---- CRUD Jogos ---- */
function _validarParciais(parciais) {
  if (!Array.isArray(parciais)) return null;
  return parciais.map(function (p) { return { a: Math.max(0, parseInt(p.a, 10) || 0), b: Math.max(0, parseInt(p.b, 10) || 0) }; });
}

async function criarJogo(dados) {
  var mod = _db.modalidades.find(function (m) { return m.nome === dados.modalidade && m.genero === dados.genero; });
  var status = dados.status || 'EM BREVE';
  var row = {
    modalidade_id: mod ? mod.id : null,
    modalidade: dados.modalidade,
    genero: dados.genero,
    data: dados.data,
    horario: dados.horario,
    local: dados.local || '',
    time_a: dados.timeA,
    time_b: dados.timeB,
    placar_a: Math.max(0, parseInt(dados.placarA, 10) || 0),
    placar_b: Math.max(0, parseInt(dados.placarB, 10) || 0),
    status: status,
    categoria: dados.categoria || _categoriaAtual,
    tempo_decorrido: 0,
    timer_state: status === 'AO VIVO' ? 'running' : status === 'FINALIZADO' ? 'stopped' : 'paused',
    timer_started_at: status === 'AO VIVO' ? Date.now() : null,
    periodo: 1,
    pausa: '',
    set_a: 0,
    set_b: 0,
    parciais: [],
    regras: dados.regras || {},
    finalizado_em: status === 'FINALIZADO' ? Date.now() : null
  };
  var parciais = _validarParciais(dados.parciais);
  if (parciais && parciais.length) {
    var placar = _placarPorParciais(parciais);
    row.parciais = parciais;
    row.placar_a = placar.a;
    row.placar_b = placar.b;
  }
  return _rastrear(addDoc(collection(getDb(), 'jogos'), row));
}

async function atualizarJogo(id, dados) {
  var jogo = _jogo(id);
  if (!jogo) return false;
  var status = dados.status || jogo.status;
  var mod = _db.modalidades.find(function (m) { return m.nome === dados.modalidade && m.genero === dados.genero; });
  var row = Object.assign({
    modalidade: dados.modalidade,
    genero: dados.genero,
    modalidade_id: mod ? mod.id : (dados.modalidadeId || jogo.modalidadeId || null),
    data: dados.data,
    horario: dados.horario,
    local: dados.local || '',
    time_a: dados.timeA,
    time_b: dados.timeB,
    placar_a: Math.max(0, parseInt(dados.placarA, 10) || 0),
    placar_b: Math.max(0, parseInt(dados.placarB, 10) || 0),
    status: status
  }, _camposTimerParaStatus(jogo, status));
  if (dados.regras) row.regras = dados.regras;
  var parciais = _validarParciais(dados.parciais);
  if (parciais) {
    var placar = _placarPorParciais(parciais);
    row.parciais = parciais;
    if (parciais.length) {
      row.placar_a = placar.a;
      row.placar_b = placar.b;
    }
  }
  if (status === 'FINALIZADO' && jogo.status !== 'FINALIZADO') row.finalizado_em = Date.now();
  if (status !== 'FINALIZADO') row.finalizado_em = null;
  if (status !== 'PAUSADO') row.pausa = '';
  return _rastrear(updateDoc(_refJogo(jogo), row));
}

async function apagarJogo(id) {
  var jogo = _jogo(id);
  if (!jogo) return false;
  var db = getDb();
  var batch = writeBatch(db);
  /* Lances do jogo saem junto, no mesmo lote */
  jogo.eventos.slice(0, 450).forEach(function (ev) { batch.delete(doc(db, 'eventos', ev._dbId)); });
  batch.delete(_refJogo(jogo));
  return _rastrear(batch.commit());
}

/* ---- CRUD Usuários ---- */
async function criarUsuario(dados) {
  if (existeUsuarioComEmail(dados.email)) return false;
  var row = {
    email: dados.email.trim(),
    senha: dados.senha,
    role: dados.role || 'mesario',
    nome: dados.nome || dados.email.split('@')[0],
    categoria: dados.categoria || 'ambas'
  };
  await _rastrear(addDoc(collection(getDb(), 'usuarios'), row));
  return true;
}

async function atualizarUsuario(id, dados) {
  var row = {};
  if (dados.email) row.email = dados.email.trim();
  if (dados.senha) row.senha = dados.senha;
  if (dados.role) row.role = dados.role;
  if (dados.nome) row.nome = dados.nome.trim();
  if (dados.categoria) row.categoria = dados.categoria;
  return _rastrear(updateDoc(doc(getDb(), 'usuarios', id), row));
}

async function apagarUsuario(id) {
  return _rastrear(deleteDoc(doc(getDb(), 'usuarios', id)));
}

/* ---- Pontos (classificação) ---- */
async function adicionarPonto(equipeNome, jogoId, pontos, descricao) {
  var row = {
    equipe_nome: equipeNome,
    jogo_id: jogoId || '',
    pontos: Math.max(0, parseInt(pontos, 10) || 0),
    descricao: descricao || '',
    categoria: _categoriaAtual
  };
  return _rastrear(addDoc(collection(getDb(), 'pontos_jogos'), row));
}

async function removerPonto(pontoId) {
  return _rastrear(deleteDoc(doc(getDb(), 'pontos_jogos', String(pontoId))));
}

/* ---- Valores Olímpicos ----
   Pontos de conduta (trabalho em equipe, respeito...) que independem do placar. Podem ser
   positivos (bônus) ou negativos (penalidade). Ficam escondidos até o administrador liberar:
   os lançamentos vivem numa coleção que as páginas públicas nem baixam, e só os TOTAIS são
   publicados (em config/valores_olimpicos) quando ele libera o turno. */
function getValoresPublicados(cat) {
  var c = _db.valoresConfig[cat || _categoriaAtual];
  return c && c.liberado ? c : { liberado: false, totais: {}, liberadoEm: 0 };
}
function valoresLiberados(cat) { return getValoresPublicados(cat).liberado; }

/* Visão do painel (administrador): lançamentos reais, mesmo antes de liberar */
function getValoresPorEquipe(equipeNome) {
  return _db.valoresOlimpicos.filter(function (v) {
    return v.equipeNome === equipeNome && v.categoria === _categoriaAtual;
  }).sort(function (a, b) { return b.criadoEm - a.criadoEm; });
}
function getTotalValoresEquipe(equipeNome) {
  return getValoresPorEquipe(equipeNome).reduce(function (soma, v) { return soma + v.pontos; }, 0);
}

function _refConfigValores() { return doc(getDb(), 'config', 'valores_olimpicos'); }

/* Soma por equipe do turno; ajuste simula um lançamento a mais ou a menos antes de gravar */
function _totaisValores(cat, ajuste) {
  var totais = {};
  _db.equipes.forEach(function (e) { if (e.categoria === cat) totais[e.nome] = 0; });
  _db.valoresOlimpicos.forEach(function (v) {
    if (v.categoria !== cat || (ajuste && ajuste.removerId === v.id)) return;
    totais[v.equipeNome] = (totais[v.equipeNome] || 0) + v.pontos;
  });
  if (ajuste && ajuste.adicionar) {
    totais[ajuste.adicionar.equipeNome] = (totais[ajuste.adicionar.equipeNome] || 0) + ajuste.adicionar.pontos;
  }
  return totais;
}

function _blocoValores(liberado, totais, liberadoEm) {
  return { liberado: liberado, totais: liberado ? totais : {}, liberado_em: liberado ? (liberadoEm || Date.now()) : 0 };
}
function _gravarBlocoValores(escritor, cat, bloco) {
  var dados = {};
  dados[cat] = bloco;
  /* mergeFields troca o bloco do turno inteiro (sem sobrar total de equipe apagada) e preserva o outro turno */
  var opcoes = { mergeFields: [cat] };
  if (typeof escritor.commit === 'function') return escritor.set(_refConfigValores(), dados, opcoes);
  return setDoc(_refConfigValores(), dados, opcoes);
}

async function adicionarValor(equipeNome, pontos, criterio, descricao) {
  var valorPontos = parseInt(pontos, 10) || 0;
  if (!equipeNome || !valorPontos) return false;
  var cat = _categoriaAtual;
  var db = getDb();
  var batch = writeBatch(db);
  batch.set(doc(collection(db, 'valores_olimpicos')), {
    equipe_nome: equipeNome,
    pontos: valorPontos,
    criterio: String(criterio || '').trim(),
    descricao: String(descricao || '').trim(),
    categoria: cat,
    criado_em: Date.now()
  });
  /* Já liberado: os totais públicos acompanham o lançamento na mesma gravação */
  var publicado = getValoresPublicados(cat);
  if (publicado.liberado) {
    _gravarBlocoValores(batch, cat, _blocoValores(true, _totaisValores(cat, { adicionar: { equipeNome: equipeNome, pontos: valorPontos } }), publicado.liberadoEm));
  }
  return _rastrear(batch.commit());
}

async function removerValor(valorId) {
  var valor = _db.valoresOlimpicos.find(function (v) { return v.id === valorId; });
  if (!valor) return false;
  var db = getDb();
  var batch = writeBatch(db);
  batch.delete(doc(db, 'valores_olimpicos', valorId));
  var publicado = getValoresPublicados(valor.categoria);
  if (publicado.liberado) {
    _gravarBlocoValores(batch, valor.categoria, _blocoValores(true, _totaisValores(valor.categoria, { removerId: valorId }), publicado.liberadoEm));
  }
  return _rastrear(batch.commit());
}

/* Libera (ou volta a esconder) os Valores Olímpicos do turno ativo */
async function liberarValores() {
  var cat = _categoriaAtual;
  return _rastrear(_gravarBlocoValores(getDb(), cat, _blocoValores(true, _totaisValores(cat))));
}
async function ocultarValores() {
  return _rastrear(_gravarBlocoValores(getDb(), _categoriaAtual, _blocoValores(false, {})));
}

/* ---- Expor funções globalmente (app.js é module, outros scripts não são) ---- */
Object.assign(window, {
  _db: _db,
  TURNOS: TURNOS,
  LANCES: LANCES,
  onReady: onReady,
  onSync: onSync,
  initDB: initDB,
  getEstadoSync: getEstadoSync,
  setSession: setSession,
  getSession: getSession,
  clearSession: clearSession,
  getUsuarioAtual: getUsuarioAtual,
  isMaster: isMaster,
  existeUsuarioComEmail: existeUsuarioComEmail,
  hojeISO: hojeISO,
  getJogos: getJogos,
  getEquipes: getEquipes,
  getModalidades: getModalidades,
  getRegulamentos: getRegulamentos,
  getJogoById: getJogoById,
  getEquipeByNome: getEquipeByNome,
  getModalidadeDoJogo: getModalidadeDoJogo,
  getJogosHoje: getJogosHoje,
  getJogosRecemFinalizados: getJogosRecemFinalizados,
  getJogosAbertosAntigos: getJogosAbertosAntigos,
  getClassificacao: getClassificacao,
  getHistorico: getHistorico,
  getPontosPorEquipe: getPontosPorEquipe,
  getJogosAll: getJogosAll,
  getEquipesAll: getEquipesAll,
  getModalidadesAll: getModalidadesAll,
  getCategoria: getCategoria,
  setCategoria: setCategoria,
  getTurno: getTurno,
  getRegraModalidade: getRegraModalidade,
  getRegraJogo: getRegraJogo,
  getNomePeriodo: getNomePeriodo,
  getSiglaPeriodo: getSiglaPeriodo,
  getRotuloPausa: getRotuloPausa,
  getEstadoSet: getEstadoSet,
  partidaDecidida: partidaDecidida,
  getVencedor: getVencedor,
  getResumoLances: getResumoLances,
  ehPontuacao: ehPontuacao,
  getTempoJogo: getTempoJogo,
  formatarTempoJogo: formatarTempoJogo,
  atualizarTempoJogo: atualizarTempoJogo,
  sincronizarTemporizadorComStatus: sincronizarTemporizadorComStatus,
  iniciarPartida: iniciarPartida,
  retomarPartida: retomarPartida,
  pausarPartida: pausarPartida,
  encerrarPeriodo: encerrarPeriodo,
  iniciarProximoPeriodo: iniciarProximoPeriodo,
  desfazerFimPeriodo: desfazerFimPeriodo,
  finalizarPartida: finalizarPartida,
  reabrirPartida: reabrirPartida,
  registrarPonto: registrarPonto,
  desfazerPonto: desfazerPonto,
  registrarLance: registrarLance,
  encerrarSet: encerrarSet,
  reabrirSet: reabrirSet,
  zerarPartida: zerarPartida,
  criarModalidade: criarModalidade,
  atualizarModalidade: atualizarModalidade,
  apagarModalidade: apagarModalidade,
  modalidadeEmUso: modalidadeEmUso,
  criarEquipe: criarEquipe,
  atualizarEquipe: atualizarEquipe,
  apagarEquipe: apagarEquipe,
  criarJogo: criarJogo,
  atualizarJogo: atualizarJogo,
  atualizarResultado: atualizarResultado,
  alterarStatusJogo: alterarStatusJogo,
  iniciarTemporizadorJogo: iniciarTemporizadorJogo,
  pausarTemporizadorJogo: pausarTemporizadorJogo,
  finalizarTemporizadorJogo: finalizarTemporizadorJogo,
  apagarJogo: apagarJogo,
  adicionarEvento: adicionarEvento,
  removerEvento: removerEvento,
  limparEventos: limparEventos,
  atualizarPlacarJogo: atualizarPlacarJogo,
  criarUsuario: criarUsuario,
  atualizarUsuario: atualizarUsuario,
  apagarUsuario: apagarUsuario,
  adicionarPonto: adicionarPonto,
  removerPonto: removerPonto,
  getValoresPublicados: getValoresPublicados,
  valoresLiberados: valoresLiberados,
  getValoresPorEquipe: getValoresPorEquipe,
  getTotalValoresEquipe: getTotalValoresEquipe,
  adicionarValor: adicionarValor,
  removerValor: removerValor,
  liberarValores: liberarValores,
  ocultarValores: ocultarValores
});

/* Iniciada quando o firebase-setup carrega — mas como ambos são modules,
   o evento pode disparar antes deste script registrar o listener.
   Por isso checamos se o Firebase já está pronto.
   (Fica no fim do módulo: tudo acima já está definido quando os listeners sobem) */
if (window.__firebase) {
  _iniciarListeners();
} else {
  window.addEventListener('firebase-ready', _iniciarListeners);
}
