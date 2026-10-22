/* =====================================================
   JES 2026 — ui.js
   Interface compartilhada: turno/tema, loader, sincronização,
   toasts, diálogos, componentes de placar e animações (FX)
   Script clássico: roda antes dos modules, usa as funções
   globais do app.js só depois do DOMContentLoaded
   ===================================================== */

var MOVIMENTO_REDUZIDO = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* =====================================================
   UTILITÁRIOS
   ===================================================== */
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

var MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
var DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function formatDate(value) { if (!value) return '—'; var parts = value.split('-'); return parts[2] + '/' + parts[1]; }

function formatDateShort(value) {
  if (!value) return '—';
  var parts = value.split('-');
  return parts[2] + ' ' + MESES_CURTOS[parseInt(parts[1], 10) - 1];
}

/* "Hoje", "Amanhã" ou "quarta, 22 de outubro" */
function formatDateLong(value) {
  if (!value) return '—';
  var parts = value.split('-');
  var data = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  var dif = Math.round((data - hoje) / 86400000);
  var extenso = DIAS_SEMANA[data.getDay()] + ', ' + Number(parts[2]) + ' de ' + MESES[data.getMonth()];
  if (dif === 0) return 'Hoje · ' + extenso;
  if (dif === 1) return 'Amanhã · ' + extenso;
  if (dif === -1) return 'Ontem · ' + extenso;
  return extenso;
}

function generoCurto(genero) {
  if (genero === 'MASCULINO') return 'Masc.';
  if (genero === 'FEMININO') return 'Fem.';
  if (genero === 'MISTO') return 'Misto';
  return genero || '';
}

function nomeDoTime(jogo, time) { return time === 'A' ? jogo.timeA : time === 'B' ? jogo.timeB : ''; }

/* Só troca o innerHTML quando o conteúdo mudou: evita reiniciar animações
   e piscar a tela a cada sincronização */
function renderSeMudou(el, html) {
  if (!el) return false;
  if (el.__htmlJes === html) return false;
  el.innerHTML = html;
  el.__htmlJes = html;
  return true;
}

function vibrar(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) { /* sem suporte */ }
}

function normalizarTexto(txt) {
  return String(txt || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/* "Começa o 2º Tempo" / "Começa a Prorrogação" */
function comecaPeriodo(nomePeriodo) {
  return (/^Prorroga|ª/.test(nomePeriodo) ? 'Começa a ' : 'Começa o ') + nomePeriodo;
}

/* Agrupa jogos (já ordenados) por data: [{ data, jogos }] */
function agruparPorData(jogos) {
  var grupos = [];
  jogos.forEach(function (j) {
    var ultimo = grupos[grupos.length - 1];
    if (!ultimo || ultimo.data !== j.data) grupos.push({ data: j.data, jogos: [j] });
    else ultimo.jogos.push(j);
  });
  return grupos;
}

/* Controle segmentado: botões [data-valor] dentro do container */
function ligarSegmentado(elOuId, aoMudar) {
  var el = typeof elOuId === 'string' ? document.getElementById(elOuId) : elOuId;
  if (!el) return;
  el.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-valor]');
    if (!btn || !el.contains(btn)) return;
    el.querySelectorAll('button[data-valor]').forEach(function (b) {
      var ativo = b === btn;
      b.classList.toggle('is-ativo', ativo);
      b.setAttribute('aria-pressed', String(ativo));
    });
    aoMudar(btn.getAttribute('data-valor'));
  });
}

/* Atualiza as opções de um <select> só quando a lista muda (não fecha o menu aberto) */
function preencherSelect(select, opcoes, valorPadrao) {
  if (!select) return;
  var atual = select.value;
  var html = opcoes.map(function (o) { return '<option value="' + escapeHtml(o[0]) + '">' + escapeHtml(o[1]) + '</option>'; }).join('');
  renderSeMudou(select, html);
  var valores = opcoes.map(function (o) { return o[0]; });
  select.value = valores.indexOf(atual) !== -1 ? atual : (valorPadrao != null ? valorPadrao : valores[0]);
}

/* =====================================================
   ÍCONES
   ===================================================== */
function svgIcone(conteudo, classe) {
  return '<svg class="ico ' + (classe || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + conteudo + '</svg>';
}

var ICONES = {
  futsal: '<circle cx="12" cy="12" r="9"/><path d="M12 7.6l3.1 2.3-1.2 3.7h-3.8L8.9 9.9z"/><path d="M12 3v4.6M15.1 9.9l4.4-1.5M13.9 13.6l2.7 3.8M10.1 13.6l-2.7 3.8M8.9 9.9L4.5 8.4"/>',
  basquete: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18"/><path d="M5.6 5.6a9 9 0 0 1 0 12.8M18.4 5.6a9 9 0 0 0 0 12.8"/>',
  volei: '<circle cx="12" cy="12" r="9"/><path d="M12 12c0-4 1.6-7 4.5-8.2M12 12c-3.5 2-5.4 4.8-5.6 8M12 12c3.4 2 6.8 2.2 8.6.7M12 12C8.2 10.4 5.2 9.6 3.4 10.4"/>',
  handebol: '<circle cx="12" cy="12" r="9"/><path d="M4.5 8.5c4.2 1.3 10.8 1.3 15 0M4.5 15.5c4.2-1.3 10.8-1.3 15 0M12 3c-2.7 3.2-2.7 14.8 0 18"/>',
  mesa: '<circle cx="9.5" cy="9.5" r="6"/><path d="M13.8 13.8l5.7 5.7"/><circle cx="18.5" cy="5.5" r="2"/>',
  pebolim: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M12 6v12M7 3v18M17 3v18"/><circle cx="12" cy="12" r="1.6"/>',
  xadrez: '<path d="M7 21h10M8.5 21c0-3.2 1.2-5.2 3.4-6.3-2.3.1-4-.6-4.6-2.3l4.4-5.6c2.6.2 5.3 2.6 5.3 6.6 0 2.8-.9 5.2-.9 7.6"/><path d="M11 4.5l1.2 2.2"/>',
  trofeu: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
  relogio: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
  local: '<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  calendario: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  troca: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  apito: '<path d="M3.5 10.5a5 5 0 1 0 10 0h7V6.5H9"/><circle cx="8.5" cy="10.5" r="1.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  bandeira: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pausa: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  desfazer: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  editar: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  lixeira: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
  voltar: '<path d="M15 5l-7 7 7 7"/>',
  seta: '<path d="M9 5l7 7-7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  sol: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M1.5 12H4M20 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>',
  lua: '<path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>',
  usuarios: '<circle cx="9" cy="8" r="3.3"/><path d="M2.8 20c.5-3.6 2.8-5.7 6.2-5.7s5.7 2.1 6.2 5.7"/><path d="M15.5 4.9a3.3 3.3 0 0 1 0 6.3M17.5 14.6c2 .6 3.3 2.4 3.7 5.4"/>',
  escudo: '<path d="M12 2.5l8 3.2v5.8c0 5-3.4 9-8 10.5-4.6-1.5-8-5.5-8-10.5V5.7l8-3.2z"/>',
  lista: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  ao_vivo: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  ranking: '<path d="M4 21V12h4v9M10 21V5h4v16M16 21v-6h4v6"/>',
  pasta: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  sair: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  externo: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  mais_opcoes: '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  busca: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  nota: '<path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M8.5 13h7M8.5 16.5h5"/>',
  wifi_off: '<path d="M2 8.5a15 15 0 0 1 5-2.9M22 8.5A15 15 0 0 0 11 4.6M5.5 12a10 10 0 0 1 3.2-1.9M18.5 12a10 10 0 0 0-2.6-1.7M9 15.5a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/><path d="M3 3l18 18"/>'
};

function icone(nome, classe) { return svgIcone(ICONES[nome] || ICONES.info, classe); }

function chaveEsporte(nomeModalidade) {
  var n = String(nomeModalidade || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.indexOf('basquet') !== -1 || n.indexOf('basket') !== -1) return 'basquete';
  if (n.indexOf('volei') !== -1 || n.indexOf('voley') !== -1) return 'volei';
  if (n.indexOf('handebol') !== -1 || n.indexOf('handball') !== -1) return 'handebol';
  if (n.indexOf('ping') !== -1 || n.indexOf('tenis de mesa') !== -1 || n.indexOf('badminton') !== -1) return 'mesa';
  if (n.indexOf('pebolim') !== -1) return 'pebolim';
  if (n.indexOf('xadrez') !== -1) return 'xadrez';
  if (n.indexOf('futsal') !== -1 || n.indexOf('futebol') !== -1 || n.indexOf('society') !== -1) return 'futsal';
  return 'trofeu';
}

function iconeEsporte(nomeModalidade, classe) { return icone(chaveEsporte(nomeModalidade), classe); }

function iconeEvento(evento, jogo) {
  if (!evento) return icone('info');
  if (evento.tipo === 'gol' || evento.tipo === 'ponto') return iconeEsporte(jogo && jogo.modalidade);
  if (evento.tipo === 'cartao_amarelo') return '<span class="ico-cartao ico-cartao--amarelo" aria-hidden="true"></span>';
  if (evento.tipo === 'cartao_vermelho' || evento.tipo === 'cartao') return '<span class="ico-cartao ico-cartao--vermelho" aria-hidden="true"></span>';
  var mapa = { exclusao: 'relogio', falta: 'apito', substituicao: 'troca', tempo: 'relogio', inicio: 'play', fim: 'bandeira', set: 'trofeu' };
  return icone(mapa[evento.tipo] || 'info');
}

/* =====================================================
   COMPONENTES DE JOGO (brasão, chips, status, placar)
   ===================================================== */
function siglaEquipe(nome) {
  var partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  var numero = (partes[0].match(/^\d+/) || [])[0];
  var ultima = partes[partes.length - 1];
  if (numero) return numero + (partes.length > 1 && /^[A-Za-z]$/.test(ultima) ? ultima.toUpperCase() : 'º');
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

function _variacaoPorNome(nome) {
  var soma = 0;
  String(nome || '').split('').forEach(function (c) { soma = (soma * 31 + c.charCodeAt(0)) % 997; });
  return soma % 4;
}

function htmlBrasao(nomeEquipe, classe) {
  var eq = typeof getEquipeByNome === 'function' ? getEquipeByNome(nomeEquipe) : null;
  var cls = 'brasao ' + (classe || '');
  if (eq && eq.brasao) {
    return '<span class="' + cls + '"><img src="' + escapeHtml(eq.brasao) + '" alt="" loading="lazy" decoding="async"></span>';
  }
  return '<span class="' + cls + ' brasao--sigla brasao--v' + _variacaoPorNome(nomeEquipe) + '" aria-hidden="true">' + escapeHtml(siglaEquipe(nomeEquipe)) + '</span>';
}

function corModalidade(jogo) {
  var mod = typeof getModalidadeDoJogo === 'function' && jogo ? getModalidadeDoJogo(jogo) : null;
  return (mod && mod.cor) || '#E30613';
}

function htmlChipModalidade(jogo, classe) {
  return '<span class="chip-mod ' + (classe || '') + '" style="--mod:' + escapeHtml(corModalidade(jogo)) + '">' +
    iconeEsporte(jogo.modalidade) + '<span>' + escapeHtml(jogo.modalidade) + (jogo.genero ? ' · ' + escapeHtml(generoCurto(jogo.genero)) : '') + '</span></span>';
}

/* Pílula de status: AO VIVO pulsa; PAUSADO mostra o motivo (Intervalo, Fim do Set...);
   EM BREVE mostra o horário quando opcoes.horario é verdadeiro */
function htmlStatus(jogo, classe, opcoes) {
  var cls = 'status-pill ' + (classe || '');
  if (jogo.status === 'AO VIVO') return '<span class="' + cls + ' status-pill--live"><i class="live-dot"></i>Ao vivo</span>';
  if (jogo.status === 'PAUSADO') {
    var rotulo = typeof getRotuloPausa === 'function' ? getRotuloPausa(jogo) : null;
    return '<span class="' + cls + ' status-pill--pausa">' + icone('pausa') + escapeHtml(rotulo ? rotulo.titulo : 'Pausado') + '</span>';
  }
  if (jogo.status === 'FINALIZADO') return '<span class="' + cls + ' status-pill--fim">Encerrado</span>';
  if (opcoes && opcoes.horario && jogo.horario) return '<span class="' + cls + ' status-pill--breve status-pill--hora">' + escapeHtml(jogo.horario) + '</span>';
  return '<span class="' + cls + ' status-pill--breve">Em breve</span>';
}

function ehJogoDeSets(jogo) {
  return typeof getRegraJogo === 'function' && getRegraJogo(jogo).tipo === 'sets';
}

/* Parciais de sets: "25-20 · 22-25 · 15-12" (o set em andamento aparece destacado) */
function htmlParciais(jogo, incluirAtual) {
  var itens = (jogo.parciais || []).map(function (p, i) {
    var vencedor = p.a > p.b ? 'a' : 'b';
    return '<span class="parcial parcial--' + vencedor + '" title="' + (i + 1) + 'º set"><b>' + p.a + '</b>-<b>' + p.b + '</b></span>';
  });
  if (incluirAtual && jogo.status !== 'FINALIZADO' && jogo.status !== 'EM BREVE' && !(jogo.status === 'PAUSADO' && jogo.pausa === 'fim_periodo')) {
    itens.push('<span class="parcial parcial--atual" title="Set em andamento"><b>' + jogo.setA + '</b>-<b>' + jogo.setB + '</b></span>');
  }
  if (!itens.length) return '';
  return '<span class="parciais">' + itens.join('') + '</span>';
}

/* Placar compacto para listas: "3 × 2" (sets ganham o rótulo "sets") */
function htmlPlacarCompacto(jogo) {
  if (jogo.status === 'EM BREVE') return '<span class="placar-mini placar-mini--vazio">×</span>';
  var sets = ehJogoDeSets(jogo);
  return '<span class="placar-mini' + (sets ? ' placar-mini--sets' : '') + '"><b>' + jogo.placarA + '</b><i>×</i><b>' + jogo.placarB + '</b>' + (sets ? '<small>sets</small>' : '') + '</span>';
}

function statusClasse(jogo) {
  return { 'AO VIVO': 'live', 'PAUSADO': 'pausa', 'FINALIZADO': 'fim' }[jogo.status] || 'breve';
}

function porDataHora(a, b) {
  return ((a.data || '') + ' ' + (a.horario || '')).localeCompare((b.data || '') + ' ' + (b.horario || ''));
}

/* Uma linha do lance a lance (público e mesa de controle) */
function htmlLance(jogo, ev, opcoes) {
  opcoes = opcoes || {};
  var regra = getRegraJogo(jogo);
  var lado = ev.time === 'A' ? 'a' : ev.time === 'B' ? 'b' : 'neutro';
  var sigla = ev.periodo ? getSiglaPeriodo(jogo, ev.periodo) : '';
  var tempo = regra.cronometro ? (ev.minuto || '—') : (sigla || '—');
  var detalhe = regra.cronometro ? sigla : '';
  var destaque = ehPontuacao(ev) || ev.tipo === 'set' || ev.tipo === 'fim';
  var marco = ['inicio', 'fim', 'fim_periodo', 'inicio_periodo', 'fim_set'].indexOf(ev.marco) !== -1;
  var valor = ehPontuacao(ev) && ev.valor > 1 ? '<span class="lance__valor">+' + ev.valor + '</span>' : '';
  return '<div class="lance lance--' + lado + (destaque ? ' lance--destaque' : '') + (marco && !destaque ? ' lance--marco' : '') + '" data-lance="' + escapeHtml(ev.id) + '">' +
    '<span class="lance__tempo">' + escapeHtml(tempo) + (detalhe ? '<small>' + escapeHtml(detalhe) + '</small>' : '') + '</span>' +
    '<span class="lance__ico">' + iconeEvento(ev, jogo) + '</span>' +
    '<span class="lance__texto">' + escapeHtml(ev.descricao) + valor + '</span>' +
    (opcoes.remover ? '<button type="button" class="lance__remover" data-remover-lance="' + escapeHtml(ev.id) + '" aria-label="Remover lance" title="Remover lance">' + icone('fechar') + '</button>' : '<span></span>') +
  '</div>';
}

/* Marca como "novo" (animação de entrada) só os lances que ainda não estavam na tela */
var _lancesVistos = {};
function animarLancesNovos(container, chave) {
  if (!container) return;
  var vistos = _lancesVistos[chave];
  var primeiraVez = !vistos;
  vistos = vistos || {};
  container.querySelectorAll('[data-lance]').forEach(function (el) {
    var id = el.getAttribute('data-lance');
    if (!primeiraVez && !vistos[id]) el.classList.add('is-novo');
    vistos[id] = true;
  });
  _lancesVistos[chave] = vistos;
}

/* Cartão de resultado (jogo encerrado) */
function htmlResultado(jogo) {
  var vencedor = getVencedor(jogo);
  return '<div class="resultado">' +
    '<div class="resultado__topo">' + htmlChipModalidade(jogo) + '<span>' + escapeHtml(jogo.horario) + '</span></div>' +
    '<div class="resultado__linha' + (vencedor === 'A' ? ' is-vencedor' : '') + '">' + htmlBrasao(jogo.timeA, 'brasao--sm') + '<span>' + escapeHtml(jogo.timeA) + '</span><b>' + jogo.placarA + '</b></div>' +
    '<div class="resultado__linha' + (vencedor === 'B' ? ' is-vencedor' : '') + '">' + htmlBrasao(jogo.timeB, 'brasao--sm') + '<span>' + escapeHtml(jogo.timeB) + '</span><b>' + jogo.placarB + '</b></div>' +
    (ehJogoDeSets(jogo) ? htmlParciais(jogo, false) : '') +
  '</div>';
}

function htmlVazio(titulo, texto, opcoes) {
  opcoes = opcoes || {};
  return '<div class="vazio' + (opcoes.compacto ? ' vazio--compacto' : '') + '">' +
    (opcoes.compacto ? '' : icone(opcoes.icone || 'apito')) +
    '<strong>' + escapeHtml(titulo) + '</strong>' +
    (texto ? '<p>' + escapeHtml(texto) + '</p>' : '') +
    (opcoes.acaoHtml || '') +
  '</div>';
}

/* Número de placar com chave para a animação de "pulo" quando aumenta */
function htmlNumeroPlacar(chave, valor, classe) {
  return '<span class="placar-num ' + (classe || '') + '" data-placar-chave="' + escapeHtml(chave) + '" data-placar-valor="' + valor + '">' + valor + '</span>';
}

var _placaresVistos = {};
function aplicarBumps(raiz) {
  (raiz || document).querySelectorAll('[data-placar-chave]').forEach(function (el) {
    var chave = el.getAttribute('data-placar-chave');
    var valor = Number(el.getAttribute('data-placar-valor'));
    var anterior = _placaresVistos[chave];
    if (anterior !== undefined && valor > anterior) JESFX.bump(el);
    _placaresVistos[chave] = valor;
  });
}

/* Cronômetros: um único intervalo atualiza todos os [data-relogio] da página */
function atualizarRelogios() {
  if (typeof getJogoById !== 'function') return;
  document.querySelectorAll('[data-relogio]').forEach(function (el) {
    var jogo = getJogoById(el.getAttribute('data-relogio'));
    if (jogo) el.textContent = formatarTempoJogo(getTempoJogo(jogo));
  });
}

/* =====================================================
   TURNO / TEMA
   ===================================================== */
function trocarTurno(cat) {
  if (typeof setCategoria !== 'function' || cat === getCategoria()) return;
  if (MOVIMENTO_REDUZIDO) { setCategoria(cat); return; }
  var turno = getTurno(cat);
  var wipe = document.createElement('div');
  wipe.className = 'theme-wipe theme-wipe--' + cat;
  wipe.setAttribute('aria-hidden', 'true');
  wipe.innerHTML = '<div class="theme-wipe__faixas"><i></i><i></i><i></i></div>' +
    '<div class="theme-wipe__conteudo">' + icone(cat === 'manha' ? 'sol' : 'lua', 'theme-wipe__ico') +
    '<strong>Turno da ' + escapeHtml(turno.nome) + '</strong><small>' + escapeHtml(turno.descricao) + '</small></div>';
  document.body.appendChild(wipe);
  /* A faixa cobre a tela entre 42% e 58% da animação (1,3s): o tema troca escondido */
  setTimeout(function () { setCategoria(cat); }, 620);
  setTimeout(function () { wipe.remove(); }, 1400);
}

function atualizarIndicadoresTurno() {
  if (typeof getCategoria !== 'function') return;
  var cat = getCategoria();
  var turno = getTurno(cat);
  document.querySelectorAll('[data-turno-opcao]').forEach(function (btn) {
    var ativo = btn.getAttribute('data-turno-opcao') === cat;
    btn.setAttribute('aria-checked', String(ativo));
    btn.classList.toggle('is-ativo', ativo);
  });
  document.querySelectorAll('[data-turno-nome]').forEach(function (el) { el.textContent = turno.nome; });
  document.querySelectorAll('[data-turno-descricao]').forEach(function (el) { el.textContent = turno.descricao; });
}

function initTurnoSwitch() {
  document.querySelectorAll('[data-turno-opcao]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var grupo = btn.closest('.turno-switch');
      if (grupo && grupo.getAttribute('aria-disabled') === 'true') {
        mostrarToast('Seu turno é definido pelo administrador.', 'info');
        return;
      }
      trocarTurno(btn.getAttribute('data-turno-opcao'));
    });
  });
  atualizarIndicadoresTurno();
  window.addEventListener('jes2026-categoria-changed', atualizarIndicadoresTurno);
}

/* =====================================================
   LOADER (abertura) E INDICADOR DE SINCRONIZAÇÃO
   ===================================================== */
function ocultarLoader() {
  var el = document.getElementById('boot-loader');
  if (!el || el.classList.contains('is-pronto')) return;
  el.classList.add('is-pronto');
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 650);
}

function renderSyncPill(estado) {
  var pill = document.getElementById('sync-pill');
  if (!pill || !estado) return;
  var classe;
  var texto;
  var ico = '';
  if (!estado.online) {
    classe = 'is-offline';
    ico = icone('wifi_off');
    texto = estado.pendentes ? 'Offline · ' + estado.pendentes + ' na fila' : 'Sem conexão';
  } else if (estado.erro && !estado.pendentes) {
    classe = 'is-erro';
    ico = icone('info');
    texto = 'Falha ao salvar';
  } else if (estado.pendentes) {
    classe = 'is-salvando';
    ico = '<span class="spinner"></span>';
    texto = 'Salvando…';
  } else if (!estado.carregado || !estado.servidor) {
    classe = 'is-conectando';
    ico = '<span class="spinner"></span>';
    texto = 'Conectando…';
  } else {
    classe = 'is-online';
    ico = '<i class="live-dot"></i>';
    texto = pill.getAttribute('data-rotulo-online') || 'Ao vivo';
  }
  pill.className = 'sync-pill ' + classe;
  pill.innerHTML = ico + '<span>' + escapeHtml(texto) + '</span>';
  pill.setAttribute('title', texto);
}

function initSyncPill() {
  window.addEventListener('jes2026-sync', function (e) { renderSyncPill(e.detail); });
  if (typeof getEstadoSync === 'function') renderSyncPill(getEstadoSync());
}

/* =====================================================
   TOASTS
   ===================================================== */
function _containerToasts() {
  var c = document.getElementById('toasts');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toasts';
    c.className = 'toasts';
    c.setAttribute('role', 'status');
    c.setAttribute('aria-live', 'polite');
    document.body.appendChild(c);
  }
  return c;
}

/* tipo: 'sucesso' | 'erro' | 'info' | 'lance'; opcoes.acao = { rotulo, aoClicar } */
function mostrarToast(mensagem, tipo, opcoes) {
  opcoes = opcoes || {};
  var toast = document.createElement('div');
  toast.className = 'toast toast--' + (tipo || 'info');
  var ico = tipo === 'sucesso' ? icone('check') : tipo === 'erro' ? icone('info') : tipo === 'lance' ? (opcoes.icone || icone('trofeu')) : icone('info');
  toast.innerHTML = '<span class="toast__ico">' + ico + '</span><span class="toast__msg">' + (opcoes.html ? mensagem : escapeHtml(mensagem)) + '</span>';
  if (opcoes.acao) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__acao';
    btn.textContent = opcoes.acao.rotulo;
    btn.addEventListener('click', function () { opcoes.acao.aoClicar(); fechar(); });
    toast.appendChild(btn);
  }
  var c = _containerToasts();
  c.appendChild(toast);
  while (c.children.length > 3) c.removeChild(c.firstChild);
  var timer = setTimeout(fechar, opcoes.duracao || (opcoes.acao ? 6000 : 3200));
  function fechar() {
    clearTimeout(timer);
    toast.classList.add('is-saindo');
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }
  return fechar;
}

function erroAoSalvar(err) {
  console.error(err);
  mostrarToast('Não foi possível salvar. Verifique a conexão e tente de novo.', 'erro');
}

/* =====================================================
   DIÁLOGO DE CONFIRMAÇÃO (substitui confirm/alert)
   ===================================================== */
function confirmarAcao(opcoes) {
  opcoes = opcoes || {};
  return new Promise(function (resolve) {
    var anterior = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'dialogo-overlay';
    overlay.innerHTML =
      '<div class="dialogo' + (opcoes.perigo ? ' dialogo--perigo' : '') + '" role="alertdialog" aria-modal="true" aria-labelledby="dialogo-titulo" aria-describedby="dialogo-texto">' +
        '<div class="dialogo__ico">' + icone(opcoes.icone || (opcoes.perigo ? 'lixeira' : 'info')) + '</div>' +
        '<h3 class="dialogo__titulo" id="dialogo-titulo">' + escapeHtml(opcoes.titulo || 'Confirmar') + '</h3>' +
        '<p class="dialogo__texto" id="dialogo-texto">' + escapeHtml(opcoes.texto || '') + '</p>' +
        '<div class="dialogo__acoes">' +
          (opcoes.somenteOk ? '' : '<button type="button" class="btn btn--ghost" data-resposta="nao">' + escapeHtml(opcoes.cancelar || 'Cancelar') + '</button>') +
          '<button type="button" class="btn ' + (opcoes.perigo ? 'btn--perigo' : 'btn--primario') + '" data-resposta="sim">' + escapeHtml(opcoes.confirmar || 'Confirmar') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('is-aberto'); });
    var btnSim = overlay.querySelector('[data-resposta="sim"]');
    btnSim.focus();

    function fechar(resposta) {
      document.removeEventListener('keydown', teclado, true);
      overlay.classList.remove('is-aberto');
      setTimeout(function () { overlay.remove(); }, 220);
      if (anterior && anterior.focus) anterior.focus();
      resolve(resposta);
    }
    function teclado(e) {
      if (e.key === 'Escape') { e.preventDefault(); fechar(false); }
      if (e.key === 'Tab') {
        var focaveis = overlay.querySelectorAll('button');
        var primeiro = focaveis[0];
        var ultimo = focaveis[focaveis.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      }
    }
    document.addEventListener('keydown', teclado, true);
    overlay.addEventListener('click', function (e) {
      var alvo = e.target.closest('[data-resposta]');
      if (alvo) fechar(alvo.getAttribute('data-resposta') === 'sim');
      else if (e.target === overlay) fechar(false);
    });
  });
}

function avisar(titulo, texto) {
  return confirmarAcao({ titulo: titulo, texto: texto, confirmar: 'Entendi', somenteOk: true, icone: 'info' });
}

/* Região invisível lida por leitores de tela */
function anunciar(texto) {
  var el = document.getElementById('sr-anuncios');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sr-anuncios';
    el.className = 'sr-only';
    el.setAttribute('aria-live', 'assertive');
    document.body.appendChild(el);
  }
  el.textContent = '';
  setTimeout(function () { el.textContent = texto; }, 60);
}

/* =====================================================
   FX — ANIMAÇÕES DE LANCES E ESTADOS DA PARTIDA
   ===================================================== */
var JESFX = (function () {
  var fila = [];
  var ativo = false;
  var raiz = null;
  var CORES_CONFETE = ['#E30613', '#FFFFFF', '#0A0A0A', '#B8040F', '#FF4D57'];

  function garantirRaiz() {
    if (!raiz || !raiz.isConnected) {
      raiz = document.createElement('div');
      raiz.className = 'fx-root';
      raiz.setAttribute('aria-hidden', 'true');
      document.body.appendChild(raiz);
    }
    return raiz;
  }

  var atual = null;

  /* opts: { variante, titulo, subtitulo, kicker, valor, timeHtml, placarHtml, compacto, confete } */
  function banner(opts) {
    if (opts.compacto) {
      /* Banners compactos não fazem fila: o mesário marcando rápido vê sempre o último lance */
      fila = fila.filter(function (f) { return !f.compacto; });
      if (atual && atual.compacto) {
        clearTimeout(atual.timer);
        atual.el.remove();
        atual = null;
        fila.unshift(opts);
        proximo();
        return;
      }
    }
    fila.push(opts);
    if (fila.length > 3) fila.splice(0, fila.length - 3);
    if (!ativo) proximo();
  }

  function proximo() {
    var opts = fila.shift();
    if (!opts) { ativo = false; atual = null; return; }
    ativo = true;
    var el = document.createElement('div');
    el.className = 'fx-banner fx-banner--' + (opts.variante || 'ponto') + (opts.compacto ? ' fx-banner--compacto' : '');
    if (opts.compacto) {
      el.innerHTML = '<div class="fx-banner__faixas"><i></i><i></i></div>' +
        '<div class="fx-banner__corpo">' +
          (opts.valor ? '<strong class="fx-banner__valor">' + escapeHtml(opts.valor) + '</strong>' : '') +
          '<span class="fx-banner__texto"><b>' + escapeHtml(opts.titulo) + '</b>' + (opts.subtitulo ? '<small>' + escapeHtml(opts.subtitulo) + '</small>' : '') + '</span>' +
        '</div>';
    } else {
      el.innerHTML = '<div class="fx-banner__faixas"><i></i><i></i><i></i><i></i></div>' +
        '<div class="fx-banner__corpo">' +
          (opts.kicker ? '<span class="fx-banner__kicker">' + escapeHtml(opts.kicker) + '</span>' : '') +
          (opts.valor ? '<span class="fx-banner__valor">' + escapeHtml(opts.valor) + '</span>' : '') +
          '<strong class="fx-banner__titulo">' + escapeHtml(opts.titulo) + '</strong>' +
          (opts.timeHtml ? '<span class="fx-banner__time">' + opts.timeHtml + '</span>' : '') +
          (opts.subtitulo ? '<span class="fx-banner__sub">' + escapeHtml(opts.subtitulo) + '</span>' : '') +
          (opts.placarHtml ? '<span class="fx-banner__placar">' + opts.placarHtml + '</span>' : '') +
        '</div>';
    }
    garantirRaiz().appendChild(el);
    if (opts.confete) confete(opts.compacto ? 60 : 140);
    var duracao = MOVIMENTO_REDUZIDO ? 1800 : opts.compacto ? 1500 : opts.variante === 'fim' ? 4200 : 2700;
    var registro = { el: el, compacto: Boolean(opts.compacto), timer: null };
    atual = registro;
    registro.timer = setTimeout(function () {
      el.classList.add('is-saindo');
      registro.timer = setTimeout(function () {
        el.remove();
        if (atual === registro) proximo();
      }, MOVIMENTO_REDUZIDO ? 50 : 420);
    }, duracao);
  }

  function confete(quantidade) {
    if (MOVIMENTO_REDUZIDO) return;
    var camada = document.createElement('div');
    camada.className = 'fx-confete';
    var html = '';
    for (var i = 0; i < quantidade; i++) {
      var cor = CORES_CONFETE[i % CORES_CONFETE.length];
      var x = Math.random() * 100;
      var atraso = Math.random() * 0.6;
      var duracao = 2.2 + Math.random() * 1.6;
      var giro = Math.round(Math.random() * 720 - 360);
      var deriva = Math.round(Math.random() * 160 - 80);
      var largura = 6 + Math.round(Math.random() * 6);
      html += '<i style="left:' + x.toFixed(2) + '%;background:' + cor + ';width:' + largura + 'px;height:' + Math.round(largura * 1.6) + 'px;' +
        '--giro:' + giro + 'deg;--deriva:' + deriva + 'px;animation-delay:' + atraso.toFixed(2) + 's;animation-duration:' + duracao.toFixed(2) + 's"></i>';
    }
    camada.innerHTML = html;
    garantirRaiz().appendChild(camada);
    setTimeout(function () { camada.remove(); }, 4600);
  }

  function bump(el) {
    if (!el || MOVIMENTO_REDUZIDO) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /* Compõe o banner certo para cada acontecimento da partida.
     info: { tipo: 'ponto'|'set'|'cartao'|'inicio'|'retomada'|'pausa'|'fim', evento, periodoAnterior } */
  function conteudoPartida(jogo, info) {
    var regra = getRegraJogo(jogo);
    var ev = info.evento;
    var nome = ev ? nomeDoTime(jogo, ev.time) : '';
    var timeHtml = nome ? htmlBrasao(nome, 'brasao--sm') + '<span>' + escapeHtml(nome) + '</span>' : '';
    var placar = jogo.placarA + ' × ' + jogo.placarB;
    var placarHtml = '<span>' + escapeHtml(jogo.timeA) + '</span><b>' + placar + '</b><span>' + escapeHtml(jogo.timeB) + '</span>';
    var periodo = getNomePeriodo(jogo);
    var kicker = jogo.modalidade + ' · ' + generoCurto(jogo.genero) + (periodo ? ' — ' + periodo : '');
    var c = { kicker: kicker, timeHtml: timeHtml, placarHtml: placarHtml, falado: '' };

    if (info.tipo === 'ponto') {
      if (regra.tipo === 'gol') {
        Object.assign(c, { variante: 'gol', titulo: 'GOOOL!', subtitulo: ev.minuto ? 'aos ' + ev.minuto : '' });
        c.falado = 'Gol de ' + nome + '. ' + placar;
      } else if (regra.tipo === 'basquete') {
        var titulos = { 1: 'LANCE LIVRE', 2: 'CESTA!', 3: 'CESTA DE 3!' };
        Object.assign(c, { variante: ev.valor === 3 ? 'cesta3' : ev.valor === 2 ? 'cesta' : 'll', titulo: titulos[ev.valor] || 'CESTA!', valor: '+' + ev.valor });
        c.falado = titulos[ev.valor] + ' para ' + nome + '. ' + placar;
      } else {
        Object.assign(c, { variante: 'ponto', titulo: 'PONTO!', valor: '+1' });
        c.falado = 'Ponto para ' + nome + '. ' + placar;
      }
    } else if (info.tipo === 'set') {
      var numero = ev.periodo || jogo.parciais.length;
      var parcial = jogo.parciais[numero - 1];
      Object.assign(c, {
        variante: 'set',
        titulo: 'FIM DO ' + numero + 'º SET',
        subtitulo: nome + ' vence o set' + (parcial ? ' · ' + parcial.a + ' × ' + parcial.b : ''),
        kicker: jogo.modalidade + ' · ' + generoCurto(jogo.genero),
        placarHtml: '<span>' + escapeHtml(jogo.timeA) + '</span><b>' + placar + '</b><small>sets</small><span>' + escapeHtml(jogo.timeB) + '</span>'
      });
      c.falado = 'Fim do ' + numero + 'º set. ' + nome + ' vence. Sets ' + placar;
    } else if (info.tipo === 'cartao') {
      var mapa = {
        cartao_amarelo: { variante: 'amarelo', titulo: 'CARTÃO AMARELO' },
        cartao_vermelho: { variante: 'vermelho', titulo: 'CARTÃO VERMELHO' },
        exclusao: { variante: 'exclusao', titulo: 'EXCLUSÃO · 2 MIN' }
      };
      Object.assign(c, mapa[ev.tipo] || mapa.cartao_amarelo, { placarHtml: '' });
      c.falado = c.titulo.toLowerCase() + ' para ' + nome;
    } else if (info.tipo === 'inicio') {
      Object.assign(c, { variante: 'inicio', titulo: regra.tipo === 'sets' ? 'VALENDO!' : 'COMEÇOU!', subtitulo: jogo.timeA + ' × ' + jogo.timeB, timeHtml: '', placarHtml: '' });
      c.falado = 'Começou a partida entre ' + jogo.timeA + ' e ' + jogo.timeB;
    } else if (info.tipo === 'retomada') {
      var novoPeriodo = info.periodoAnterior && jogo.periodo > info.periodoAnterior;
      Object.assign(c, {
        variante: 'inicio',
        titulo: novoPeriodo && periodo ? comecaPeriodo(periodo).toUpperCase() : 'BOLA EM JOGO',
        subtitulo: jogo.timeA + ' ' + placar + ' ' + jogo.timeB, timeHtml: '', placarHtml: ''
      });
      c.falado = c.titulo.toLowerCase();
    } else if (info.tipo === 'pausa') {
      var rotulo = getRotuloPausa(jogo) || { titulo: 'Jogo pausado', detalhe: '' };
      Object.assign(c, { variante: 'pausa', titulo: rotulo.titulo.toUpperCase(), subtitulo: rotulo.detalhe, timeHtml: '' });
      c.falado = rotulo.titulo + '. ' + jogo.timeA + ' ' + placar + ' ' + jogo.timeB;
    } else if (info.tipo === 'fim') {
      var vencedor = getVencedor(jogo);
      var nomeVencedor = nomeDoTime(jogo, vencedor);
      Object.assign(c, {
        variante: 'fim',
        titulo: 'FIM DE JOGO',
        kicker: jogo.modalidade + ' · ' + generoCurto(jogo.genero),
        subtitulo: vencedor ? nomeVencedor + ' vence!' : 'Empate!',
        timeHtml: vencedor ? htmlBrasao(nomeVencedor, 'brasao--md') + '<span>' + escapeHtml(nomeVencedor) + '</span>' : '',
        confete: true
      });
      if (regra.tipo === 'sets') c.placarHtml = '<span>' + escapeHtml(jogo.timeA) + '</span><b>' + placar + '</b><small>sets</small><span>' + escapeHtml(jogo.timeB) + '</span>';
      c.falado = 'Fim de jogo. ' + jogo.timeA + ' ' + placar + ' ' + jogo.timeB;
    }
    return c;
  }

  function partida(jogo, info, compacto) {
    var c = conteudoPartida(jogo, info);
    if (!c.variante) return;
    if (compacto) {
      c.compacto = true;
      c.subtitulo = c.subtitulo || (info.evento ? nomeDoTime(jogo, info.evento.time) : '');
      if (info.tipo === 'ponto' && info.evento) c.subtitulo = nomeDoTime(jogo, info.evento.time) + ' · ' + jogo.placarA + ' × ' + jogo.placarB;
    }
    banner(c);
    if (c.falado) anunciar(c.falado);
  }

  return { banner: banner, confete: confete, bump: bump, partida: partida, conteudoPartida: conteudoPartida };
})();

/* =====================================================
   OBSERVADOR DE PARTIDAS (páginas públicas)
   Compara cada sincronização com a anterior e dispara as
   animações dos acontecimentos novos. Ignora dados do cache e
   lances antigos para não comemorar o que já passou.
   ===================================================== */
function criarObservadorPartidas(aoAcontecer) {
  var base = null;
  var liberado = false;

  function foto(jogo) {
    var ids = {};
    jogo.eventos.forEach(function (ev) { ids[ev.id] = true; });
    return { status: jogo.status, periodo: jogo.periodo, pausa: jogo.pausa, eventos: ids };
  }

  return function verificar() {
    if (typeof getJogos !== 'function') return;
    var sync = getEstadoSync();
    var jogos = getJogos();
    var atual = {};
    jogos.forEach(function (j) { atual[j.id] = foto(j); });

    if (base && liberado && sync.servidor && !document.hidden) {
      var agora = Date.now();
      jogos.forEach(function (jogo) {
        var antes = base[jogo.id];
        if (!antes) return;
        var regra = getRegraJogo(jogo);
        var novos = jogo.eventos.filter(function (ev) { return !antes.eventos[ev.id] && agora - ev.timestamp < 60000; });
        novos.slice(-3).forEach(function (ev) {
          if (ehPontuacao(ev)) aoAcontecer(jogo, { tipo: 'ponto', evento: ev });
          else if (ev.tipo === 'set') aoAcontecer(jogo, { tipo: 'set', evento: ev });
          else if (ev.tipo === 'cartao_amarelo' || ev.tipo === 'cartao_vermelho' || ev.tipo === 'exclusao') aoAcontecer(jogo, { tipo: 'cartao', evento: ev });
        });
        if (antes.status !== jogo.status) {
          if (jogo.status === 'AO VIVO') aoAcontecer(jogo, { tipo: antes.status === 'EM BREVE' ? 'inicio' : 'retomada', periodoAnterior: antes.periodo });
          else if (jogo.status === 'PAUSADO' && !(regra.tipo === 'sets' && jogo.pausa === 'fim_periodo')) aoAcontecer(jogo, { tipo: 'pausa' });
          else if (jogo.status === 'FINALIZADO') aoAcontecer(jogo, { tipo: 'fim' });
        } else if (jogo.status === 'PAUSADO' && antes.pausa !== jogo.pausa && jogo.pausa === 'fim_periodo' && regra.tipo !== 'sets') {
          aoAcontecer(jogo, { tipo: 'pausa' });
        }
      });
    }
    /* Só dispara depois de uma rodada inteira em sincronia com o servidor */
    liberado = sync.servidor;
    base = atual;
  };
}

/* =====================================================
   CABEÇALHO PÚBLICO (navegação, turno, sincronização)
   ===================================================== */
function renderAdminBar() {
  var el = document.getElementById('admin-bar');
  if (!el) return;
  var sessao = typeof getSession === 'function' ? getSession() : null;
  el.innerHTML = sessao
    ? '<div class="admin-edit-bar"><span>' + icone('escudo') + 'Você está conectado como organizador</span><a href="admin-master.html">Abrir painel ' + icone('seta') + '</a></div>'
    : '';
}

/* Inicialização comum às páginas públicas. Recebe a função que desenha a página. */
function initPaginaPublica(renderizar) {
  initTurnoSwitch();
  initSyncPill();
  onReady(function () {
    renderAdminBar();
    renderizar();
    ocultarLoader();
    onSync(renderizar);
    window.addEventListener('jes2026-categoria-changed', function () {
      renderizar();
      atualizarIndicadoresTurno();
    });
    setInterval(atualizarRelogios, 1000);
  });
}

/* Mesmo sem dados, o loader some depois de alguns segundos */
setTimeout(ocultarLoader, 12000);
