/* =====================================================
   JES 2026 — tabela.js
   Tabela de jogos: filtros, agenda agrupada por dia e
   trilho de resultados (sets aparecem com as parciais)
   ===================================================== */

var filtroData = 'all';
var filtroStatus = 'all';

document.addEventListener('DOMContentLoaded', function () {
  ligarSegmentado('filtro-data', function (v) { filtroData = v; renderTabela(); });
  ligarSegmentado('filtro-status', function (v) { filtroStatus = v; renderTabela(); });
  ['filter-sport', 'filter-gender', 'filter-team'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', renderTabela);
  });
  initPaginaPublica(function () {
    popularFiltros();
    renderTabela();
  });
});

function popularFiltros() {
  var nomes = getModalidades().map(function (m) { return m.nome; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; })
    .sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  preencherSelect(document.getElementById('filter-sport'), [['all', 'Todas']].concat(nomes.map(function (n) { return [n, n]; })), 'all');

  var equipes = getEquipes().map(function (e) { return e.nome; })
    .sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); });
  preencherSelect(document.getElementById('filter-team'), [['all', 'Todas']].concat(equipes.map(function (n) { return [n, n]; })), 'all');
}

function jogosFiltrados() {
  var hoje = hojeISO();
  var esporte = document.getElementById('filter-sport').value;
  var genero = document.getElementById('filter-gender').value;
  var equipe = document.getElementById('filter-team').value;
  return getJogos().filter(function (j) {
    if (filtroData === 'today' && j.data !== hoje) return false;
    if (filtroData === 'next' && j.data < hoje) return false;
    /* "Ao vivo" inclui partidas pausadas (intervalo, fim de set...) */
    if (filtroStatus === 'AO VIVO' && j.status !== 'AO VIVO' && j.status !== 'PAUSADO') return false;
    if (filtroStatus !== 'all' && filtroStatus !== 'AO VIVO' && j.status !== filtroStatus) return false;
    if (esporte !== 'all' && j.modalidade !== esporte) return false;
    if (genero !== 'all' && j.genero !== genero) return false;
    if (equipe !== 'all' && j.timeA !== equipe && j.timeB !== equipe) return false;
    return true;
  });
}

function renderTabela() {
  var jogos = jogosFiltrados();
  var ativos = jogos.filter(function (j) { return j.status !== 'FINALIZADO'; }).sort(porDataHora);
  var encerrados = jogos.filter(function (j) { return j.status === 'FINALIZADO'; }).sort(function (a, b) { return porDataHora(b, a); });

  var agenda = ativos.length
    ? agruparPorData(ativos).map(htmlDia).join('')
    : htmlVazio('Nenhum jogo por vir', 'Ajuste os filtros ou confira os resultados.', { icone: 'calendario' });

  var resultados = encerrados.length
    ? agruparPorData(encerrados).map(function (g) {
      return '<div class="resultados-dia"><div class="resultados-dia__data">' + escapeHtml(formatDateShort(g.data)) + '</div>' + g.jogos.map(htmlResultado).join('') + '</div>';
    }).join('')
    : htmlVazio('Sem resultados', 'Os placares finais aparecem aqui.', { compacto: true });

  var el = document.getElementById('games-layout');
  renderSeMudou(el,
    '<div class="jogos-dias">' + agenda + '</div>' +
    '<aside class="painel resultados-rail" aria-label="Resultados">' +
      '<div class="painel__head"><h2 class="titulo-secao titulo-secao--sm">Resultados</h2><span class="secao__meta">' + encerrados.length + (encerrados.length === 1 ? ' partida' : ' partidas') + '</span></div>' +
      resultados +
    '</aside>');
  aplicarBumps(el);
}

function htmlDia(grupo) {
  var aoVivo = grupo.jogos.filter(function (j) { return j.status === 'AO VIVO' || j.status === 'PAUSADO'; }).length;
  return '<section class="dia">' +
    '<div class="dia__head">' +
      '<h2 class="dia__data">' + escapeHtml(formatDateLong(grupo.data)) + '</h2>' +
      '<span class="dia__meta">' + grupo.jogos.length + (grupo.jogos.length === 1 ? ' jogo' : ' jogos') +
        (aoVivo ? '<span class="status-pill status-pill--live"><i class="live-dot"></i>' + aoVivo + ' ao vivo</span>' : '') +
      '</span>' +
    '</div>' +
    '<div class="jogos-grid">' + grupo.jogos.map(htmlJogoCard).join('') + '</div>' +
  '</section>';
}

function htmlJogoCard(j) {
  var sets = ehJogoDeSets(j);
  var breve = j.status === 'EM BREVE';
  var periodo = '';
  if (j.status === 'AO VIVO') periodo = sets ? (j.parciais.length + 1) + 'º set' : getNomePeriodo(j);

  function linha(lado) {
    var nome = nomeDoTime(j, lado);
    var placar = lado === 'A' ? j.placarA : j.placarB;
    return '<div class="jogo-card__time">' + htmlBrasao(nome, 'brasao--sm') + '<span>' + escapeHtml(nome) + '</span>' +
      '<b>' + (breve ? '–' : htmlNumeroPlacar(j.id + ':tabela:' + lado, placar)) + '</b></div>';
  }

  return '<article class="jogo-card is-' + statusClasse(j) + '">' +
    '<header class="jogo-card__topo">' + htmlChipModalidade(j) + htmlStatus(j) + '</header>' +
    '<div class="jogo-card__times">' + linha('A') + linha('B') + '</div>' +
    (sets && (j.parciais.length || j.status === 'AO VIVO') ? htmlParciais(j, true) : '') +
    '<footer class="jogo-card__rodape">' +
      '<span>' + icone('relogio') + escapeHtml(j.horario) + '</span>' +
      '<span>' + icone('local') + escapeHtml(j.local || 'Local a definir') + '</span>' +
      (periodo ? '<span>' + escapeHtml(periodo) + '</span>' : '') +
    '</footer>' +
  '</article>';
}
