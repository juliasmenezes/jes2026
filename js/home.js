/* =====================================================
   JES 2026 — home.js
   Placar ao vivo: seletor de partidas, placar principal com
   estados (intervalo, fim de set, fim de jogo), lance a lance,
   próximos jogos, resultados do dia e ranking
   ===================================================== */

var jogoAoVivoSelecionado = null;
/* Veio de um aviso em outra aba: abre direto na partida que pontuou */
try {
  jogoAoVivoSelecionado = sessionStorage.getItem('jes2026_jogo_foco') || null;
  sessionStorage.removeItem('jes2026_jogo_foco');
} catch (e) { /* sem persistência */ }
var ultimoJogoNoPalco = null;
var observarPartidas = criarObservadorPartidas(aoAcontecerNaPartida);

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('live-chips').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-jogo]');
    if (chip) selecionarJogoAoVivo(chip.getAttribute('data-jogo'));
  });
  initPaginaPublica(renderHome);
  setInterval(atualizarContagens, 1000);
});

/* Palco: partidas rolando agora + as que acabaram há pouco (a comemoração fica visível) */
function jogosDoPalco() {
  var ativos = getJogosHoje().filter(function (j) { return j.status === 'AO VIVO' || j.status === 'PAUSADO'; });
  ativos.sort(function (a, b) {
    if (a.status !== b.status) return a.status === 'AO VIVO' ? -1 : 1;
    return porDataHora(a, b);
  });
  var recentes = getJogosRecemFinalizados(20).sort(function (a, b) { return b.finalizadoEm - a.finalizadoEm; });
  return ativos.concat(recentes);
}

function selecionarJogoAoVivo(id) {
  jogoAoVivoSelecionado = id;
  renderHome();
}

function renderHome() {
  var palco = jogosDoPalco();
  if (!palco.some(function (j) { return j.id === jogoAoVivoSelecionado; })) {
    jogoAoVivoSelecionado = palco.length ? palco[0].id : null;
  }
  renderHeroStats();
  renderLiveChips(palco);
  renderPalco(palco);
  renderProximos();
  renderResultados();
  renderMiniRanking();
  atualizarRelogios();
  atualizarContagens();
  aplicarBumps(document.getElementById('ao-vivo'));
  observarPartidas();
}

/* Animações disparadas pelo observador: aviso discreto para a partida em foco,
   aviso ainda mais leve (com atalho) para as outras */
function aoAcontecerNaPartida(jogo, info) {
  if (jogo.id === jogoAoVivoSelecionado) {
    JESFX.partida(jogo, info, false);
    return;
  }
  if (info.tipo === 'retomada') return;
  var c = JESFX.conteudoPartida(jogo, info);
  if (!c.variante) return;
  JESFX.avisoPartida(jogo, info, c, 'leve', {
    rotulo: 'Ver',
    aoClicar: function () {
      selecionarJogoAoVivo(jogo.id);
      document.getElementById('ao-vivo').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

/* =====================================================
   HERO E SELETOR
   ===================================================== */
function renderHeroStats() {
  var hoje = getJogosHoje();
  document.getElementById('hero-aovivo').textContent = hoje.filter(function (j) { return j.status === 'AO VIVO' || j.status === 'PAUSADO'; }).length;
  document.getElementById('hero-hoje').textContent = hoje.length;
  document.getElementById('hero-encerrados').textContent = hoje.filter(function (j) { return j.status === 'FINALIZADO'; }).length;
}

function renderLiveChips(palco) {
  var el = document.getElementById('live-chips');
  el.hidden = palco.length < 2;
  if (el.hidden) { renderSeMudou(el, ''); return; }
  renderSeMudou(el, palco.map(function (j) {
    var selecionado = j.id === jogoAoVivoSelecionado;
    return '<button type="button" role="tab" aria-selected="' + selecionado + '" class="live-chip' + (selecionado ? ' is-selecionado' : '') + '" data-jogo="' + j.id + '">' +
      '<span class="live-chip__topo">' + htmlChipModalidade(j) + htmlStatus(j) + '</span>' +
      '<span class="live-chip__times">' +
        '<span>' + htmlBrasao(j.timeA, 'brasao--sm') + '<b>' + escapeHtml(j.timeA) + '</b></span>' +
        '<strong>' + j.placarA + ' <i>×</i> ' + j.placarB + '</strong>' +
        '<span><b>' + escapeHtml(j.timeB) + '</b>' + htmlBrasao(j.timeB, 'brasao--sm') + '</span>' +
      '</span>' +
    '</button>';
  }).join(''));
}

/* =====================================================
   PLACAR PRINCIPAL
   ===================================================== */
function renderPalco(palco) {
  var el = document.getElementById('live-palco');
  var jogo = palco.find(function (j) { return j.id === jogoAoVivoSelecionado; }) || null;
  var trocou = (jogo ? jogo.id : null) !== ultimoJogoNoPalco;
  ultimoJogoNoPalco = jogo ? jogo.id : null;
  var mudou = renderSeMudou(el, jogo ? htmlPlacarPrincipal(jogo) : htmlSemAoVivo());
  if (mudou && trocou) {
    el.classList.remove('anima-entrar');
    void el.offsetWidth;
    el.classList.add('anima-entrar');
  }
  if (mudou && jogo) animarLancesNovos(el, jogo.id);
}

function htmlPlacarPrincipal(jogo) {
  var regra = getRegraJogo(jogo);
  var sets = regra.tipo === 'sets';
  var finalizado = jogo.status === 'FINALIZADO';
  var vencedor = finalizado ? getVencedor(jogo) : null;
  var estadoSet = sets ? getEstadoSet(jogo) : null;
  /* Durante um set, os números grandes são os pontos do set; fora dele, o placar de sets */
  var emSet = sets && !finalizado && !(jogo.status === 'PAUSADO' && jogo.pausa === 'fim_periodo');
  var numA = emSet ? jogo.setA : jogo.placarA;
  var numB = emSet ? jogo.setB : jogo.placarB;
  var chave = jogo.id + (emSet ? ':set' + (jogo.parciais.length + 1) : ':placar');
  var periodo = emSet ? (jogo.parciais.length + 1) + 'º Set' : sets ? 'Sets' : getNomePeriodo(jogo);
  var resumo = getResumoLances(jogo);

  return '<article class="placar-card is-' + statusClasse(jogo) + '" aria-label="Placar: ' + escapeHtml(jogo.timeA + ' ' + jogo.placarA + ' a ' + jogo.placarB + ' ' + jogo.timeB) + '">' +
    '<div class="placar-card__faixa"></div>' +
    '<header class="placar-card__topo">' +
      htmlChipModalidade(jogo) +
      '<span class="placar-card__local">' + icone('local') + escapeHtml(jogo.local || 'Local a definir') + ' · ' + escapeHtml(jogo.horario) + '</span>' +
      htmlStatus(jogo) +
    '</header>' +
    htmlFaixaEstado(jogo) +
    '<div class="placar">' +
      htmlLadoPlacar(jogo, 'A', vencedor, estadoSet, resumo) +
      '<div class="placar__centro">' +
        (periodo ? '<span class="placar__periodo">' + escapeHtml(periodo) + '</span>' : '') +
        '<div class="placar__numeros">' + htmlNumeroPlacar(chave + ':a', numA) + '<span class="placar__sep">:</span>' + htmlNumeroPlacar(chave + ':b', numB) + '</div>' +
        (regra.cronometro && !finalizado
          ? '<span class="placar__relogio' + (jogo.status === 'AO VIVO' ? ' is-correndo' : '') + '">' + icone('relogio') + '<span data-relogio="' + jogo.id + '"></span></span>'
          : '') +
        (emSet ? '<span class="placar__sets-resumo">Sets<b>' + jogo.placarA + ' × ' + jogo.placarB + '</b></span>' : '') +
      '</div>' +
      htmlLadoPlacar(jogo, 'B', vencedor, estadoSet, resumo) +
    '</div>' +
    (sets && (jogo.parciais.length || emSet) ? '<div class="placar-card__parciais">' + htmlParciais(jogo, true) + '</div>' : '') +
    (regra.tipo === 'basquete' ? htmlEstatisticasBasquete(resumo) : '') +
    htmlFeed(jogo) +
  '</article>';
}

function htmlLadoPlacar(jogo, lado, vencedor, estadoSet, resumo) {
  var nome = nomeDoTime(jogo, lado);
  var lances = resumo[lado];
  var cartoes = '';
  if (lances.cartao_amarelo) cartoes += '<span class="mini-cartao mini-cartao--amarelo" title="Cartões amarelos">' + lances.cartao_amarelo + '</span>';
  if (lances.cartao_vermelho) cartoes += '<span class="mini-cartao mini-cartao--vermelho" title="Cartões vermelhos">' + lances.cartao_vermelho + '</span>';
  var badge = '';
  if (vencedor === lado) {
    badge = '<span class="placar__badge placar__badge--vencedor">' + icone('trofeu') + 'Vencedor</span>';
  } else if (estadoSet && estadoSet.setPoint === lado && jogo.status === 'AO VIVO') {
    badge = '<span class="placar__badge placar__badge--setpoint">' + (estadoSet.matchPoint ? 'Match point' : 'Set point') + '</span>';
  }
  var classes = 'placar__time placar__time--' + lado.toLowerCase();
  if (vencedor) classes += vencedor === lado ? ' is-vencedor' : ' is-perdedor';
  return '<div class="' + classes + '">' +
    htmlBrasao(nome, 'brasao--xl') +
    '<span class="placar__nome">' + escapeHtml(nome) + '</span>' +
    (cartoes ? '<span class="placar__cartoes">' + cartoes + '</span>' : '') +
    badge +
  '</div>';
}

/* Faixa animada do estado da partida: Intervalo, Fim do Quarto, Fim do Set, Fim de jogo */
function htmlFaixaEstado(jogo) {
  if (jogo.status === 'PAUSADO') {
    var rotulo = getRotuloPausa(jogo);
    return '<div class="estado-faixa estado-faixa--' + rotulo.tipo + '" role="status">' +
      '<span class="estado-faixa__ico">' + icone(rotulo.tipo === 'set' ? 'trofeu' : 'pausa') + '</span>' +
      '<strong>' + escapeHtml(rotulo.titulo) + '</strong>' +
      (rotulo.detalhe ? '<small>' + escapeHtml(rotulo.detalhe) + '</small>' : '') +
    '</div>';
  }
  if (jogo.status === 'FINALIZADO') {
    var vencedor = getVencedor(jogo);
    return '<div class="estado-faixa estado-faixa--fim" role="status">' +
      '<span class="estado-faixa__ico">' + icone('bandeira') + '</span>' +
      '<strong>Fim de jogo</strong>' +
      '<small>' + (vencedor ? escapeHtml(nomeDoTime(jogo, vencedor)) + ' vence' : 'Empate') + '</small>' +
    '</div>';
  }
  return '';
}

function htmlEstatisticasBasquete(resumo) {
  function lado(p) {
    return 'LL <b>' + (p[1] || 0) + '</b> · 2P <b>' + (p[2] || 0) + '</b> · 3P <b>' + (p[3] || 0) + '</b>';
  }
  return '<div class="placar-card__stats">' +
    '<span>' + lado(resumo.A.pontos) + '</span>' +
    '<span class="placar-card__stats-rotulo">Cestas</span>' +
    '<span>' + lado(resumo.B.pontos) + '</span>' +
  '</div>';
}

function htmlFeed(jogo) {
  var eventos = jogo.eventos.slice().reverse().slice(0, 40);
  return '<section class="feed" aria-label="Lance a lance">' +
    '<h3 class="feed__titulo">Lance a lance <span>' + jogo.eventos.length + (jogo.eventos.length === 1 ? ' lance' : ' lances') + '</span></h3>' +
    '<div class="feed__lista">' +
      (eventos.length
        ? eventos.map(function (ev) { return htmlLance(jogo, ev); }).join('')
        : '<p class="feed__vazio">Nenhum lance registrado ainda.</p>') +
    '</div>' +
  '</section>';
}

/* Sem partida rolando: mostra o próximo jogo com contagem regressiva */
function proximoJogo() {
  var hoje = hojeISO();
  return getJogos().filter(function (j) { return j.status === 'EM BREVE' && j.data >= hoje; }).sort(porDataHora)[0] || null;
}

function htmlSemAoVivo() {
  var proximo = proximoJogo();
  var texto = proximo
    ? '<p>Próximo: ' + escapeHtml(proximo.modalidade) + ' ' + escapeHtml(generoCurto(proximo.genero)) + ' — <b>' + escapeHtml(proximo.timeA) + ' × ' + escapeHtml(proximo.timeB) + '</b>, ' +
      (proximo.data === hojeISO() ? 'hoje' : formatDateShort(proximo.data)) + ' às ' + escapeHtml(proximo.horario) + (proximo.local ? ' · ' + escapeHtml(proximo.local) : '') + '</p>'
    : '<p>Confira a <a href="tabela-jogos.html">tabela de jogos</a> para não perder nada.</p>';
  return '<div class="sem-aovivo">' +
    '<div class="sem-aovivo__ico">' + icone('apito') + '</div>' +
    '<div><strong>Nenhuma partida rolando agora</strong>' + texto + '</div>' +
    (proximo ? '<div class="contagem"><b data-contagem="' + escapeHtml(proximo.data + 'T' + proximo.horario) + '">--:--</b><small>para começar</small></div>' : '') +
  '</div>';
}

function atualizarContagens() {
  document.querySelectorAll('[data-contagem]').forEach(function (el) {
    var p = el.getAttribute('data-contagem').split(/[-T:]/).map(Number);
    var alvo = new Date(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0);
    var falta = Math.floor((alvo - Date.now()) / 1000);
    if (falta <= 0) { el.textContent = 'Já já!'; return; }
    var dias = Math.floor(falta / 86400);
    var horas = Math.floor((falta % 86400) / 3600);
    var min = Math.floor((falta % 3600) / 60);
    var seg = falta % 60;
    el.textContent = dias > 0
      ? dias + 'd ' + String(horas).padStart(2, '0') + 'h'
      : (horas > 0 ? String(horas).padStart(2, '0') + ':' : '') + String(min).padStart(2, '0') + ':' + String(seg).padStart(2, '0');
  });
}

/* =====================================================
   PAINÉIS INFERIORES
   ===================================================== */
function renderProximos() {
  var hoje = hojeISO();
  var lista = getJogos().filter(function (j) { return j.status === 'EM BREVE' && j.data >= hoje; }).sort(porDataHora).slice(0, 6);
  var html = lista.length ? lista.map(function (j) {
    return '<div class="jogo-linha">' +
      '<span class="jogo-linha__hora">' + escapeHtml(j.horario) + '<small>' + escapeHtml(j.data === hoje ? 'Hoje' : formatDateShort(j.data)) + '</small></span>' +
      '<span class="jogo-linha__corpo">' + htmlChipModalidade(j) + '<span class="jogo-linha__times">' + escapeHtml(j.timeA) + '<i>×</i>' + escapeHtml(j.timeB) + '</span></span>' +
      '<span class="jogo-linha__fim">' + escapeHtml(j.local || '') + '</span>' +
    '</div>';
  }).join('') : htmlVazio('Sem jogos agendados', 'A tabela é atualizada pela organização.', { compacto: true });
  renderSeMudou(document.getElementById('lista-proximos'), html);
}

function renderResultados() {
  var lista = getJogosHoje().filter(function (j) { return j.status === 'FINALIZADO'; })
    .sort(function (a, b) { return (b.finalizadoEm || 0) - (a.finalizadoEm || 0) || porDataHora(b, a); })
    .slice(0, 5);
  var html = lista.length ? lista.map(htmlResultado).join('') : htmlVazio('Nenhum resultado ainda', 'Os placares finais aparecem aqui.', { compacto: true });
  renderSeMudou(document.getElementById('lista-resultados'), html);
}

function renderMiniRanking() {
  var dados = getClassificacao().slice(0, 5);
  var html = dados.length ? dados.map(function (item) {
    return '<li class="mini-ranking__item">' +
      '<span class="mini-ranking__pos">' + item.posicao + '</span>' +
      htmlBrasao(item.unidade, 'brasao--sm') +
      '<b>' + escapeHtml(item.unidade) + '</b>' +
      '<span class="mini-ranking__pts">' + item.pontos + '<small>pts</small></span>' +
    '</li>';
  }).join('') : '<li class="vazio vazio--compacto"><strong>Sem equipes</strong></li>';
  renderSeMudou(document.getElementById('mini-ranking'), html);
}
