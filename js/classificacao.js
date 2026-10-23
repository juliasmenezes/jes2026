/* =====================================================
   JES 2026 — classificacao.js
   Ranking geral e por modalidade: abas, pódio e tabela
   com jogos, vitórias, empates, derrotas e forma recente
   ===================================================== */

var modalidadeRanking = 'all';

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('ranking-tabs').addEventListener('click', function (e) {
    var aba = e.target.closest('[data-modalidade]');
    if (!aba) return;
    modalidadeRanking = aba.getAttribute('data-modalidade');
    renderClassificacao();
  });
  initPaginaPublica(renderClassificacao);
});

function renderClassificacao() {
  var nomes = getModalidades().map(function (m) { return m.nome; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; })
    .sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  if (modalidadeRanking !== 'all' && nomes.indexOf(modalidadeRanking) === -1) modalidadeRanking = 'all';

  renderSeMudou(document.getElementById('ranking-tabs'), [['all', 'Geral']].concat(nomes.map(function (n) { return [n, n]; })).map(function (item) {
    var ativo = item[0] === modalidadeRanking;
    return '<button type="button" role="tab" aria-selected="' + ativo + '" class="aba' + (ativo ? ' is-ativo' : '') + '" data-modalidade="' + escapeHtml(item[0]) + '">' +
      (item[0] === 'all' ? icone('trofeu') : iconeEsporte(item[0])) + escapeHtml(item[1]) + '</button>';
  }).join(''));

  var encerrados = getJogos().filter(function (j) {
    return j.status === 'FINALIZADO' && (modalidadeRanking === 'all' || j.modalidade === modalidadeRanking);
  }).sort(porDataHora);

  var linhas = getClassificacao(modalidadeRanking).map(function (item) {
    return Object.assign({}, item, estatisticasDaEquipe(item.unidade, encerrados));
  });

  var comValores = modalidadeRanking === 'all' && valoresLiberados();
  linhas.forEach(function (l) { l.comValores = comValores; });
  renderPodio(linhas);
  renderTabelaRanking(linhas);
  document.getElementById('nota-valores').hidden = !comValores;
}

function estatisticasDaEquipe(nome, jogos) {
  var resultado = { jogos: 0, v: 0, e: 0, d: 0, forma: [] };
  jogos.forEach(function (j) {
    if (j.timeA !== nome && j.timeB !== nome) return;
    var meu = j.timeA === nome ? j.placarA : j.placarB;
    var outro = j.timeA === nome ? j.placarB : j.placarA;
    var r = meu > outro ? 'v' : meu === outro ? 'e' : 'd';
    resultado.jogos++;
    resultado[r]++;
    resultado.forma.push(r);
  });
  resultado.forma = resultado.forma.slice(-5);
  return resultado;
}

/* Com os Valores Olímpicos liberados, mostra de onde vem o total: jogos + valores */
function htmlDetalheValores(item) {
  if (!item.comValores) return '';
  var v = item.valores;
  return '<small class="' + (v < 0 ? 'is-negativo' : '') + '" title="Pontos dos jogos e Valores Olímpicos">' +
    item.pontosJogos + (v < 0 ? ' − ' : ' + ') + Math.abs(v) + ' val.</small>';
}

/* Pódio só faz sentido com três equipes e alguém já pontuando */
function renderPodio(linhas) {
  var el = document.getElementById('podio');
  if (linhas.length < 3 || linhas[0].pontos <= 0) {
    el.hidden = true;
    renderSeMudou(el, '');
    return;
  }
  el.hidden = false;
  renderSeMudou(el, linhas.slice(0, 3).map(function (item, i) {
    return '<div class="podio__item podio__item--' + (i + 1) + '">' +
      '<span class="podio__pos">' + (i + 1) + '</span>' +
      htmlBrasao(item.unidade, 'brasao--lg') +
      '<span class="podio__nome">' + escapeHtml(item.unidade) + '</span>' +
      '<span class="podio__pts">' + item.pontos + '<small>pts</small></span>' +
    '</div>';
  }).join(''));
}

function renderTabelaRanking(linhas) {
  var body = document.getElementById('ranking-body');
  if (!linhas.length) {
    renderSeMudou(body, htmlVazio('Nenhuma equipe cadastrada', 'A classificação aparece assim que a organização cadastrar as equipes.', { icone: 'ranking' }));
    return;
  }
  renderSeMudou(body, linhas.map(function (item, index) {
    var forma = item.forma.length
      ? item.forma.map(function (r) {
        return '<span class="forma__item forma__item--' + r + '" title="' + { v: 'Vitória', e: 'Empate', d: 'Derrota' }[r] + '">' + r.toUpperCase() + '</span>';
      }).join('')
      : '<span class="forma__item forma__item--vazio" title="Sem jogos"></span>';
    return '<div class="ranking-linha' + (index < 3 ? ' top-' + (index + 1) : '') + '" style="animation-delay:' + Math.min(index * 40, 400) + 'ms">' +
      '<span class="ranking-pos">' + item.posicao + 'º</span>' +
      '<span class="ranking-equipe">' + htmlBrasao(item.unidade, 'brasao--sm') + '<b>' + escapeHtml(item.unidade) + '</b></span>' +
      '<span>' + item.jogos + '</span>' +
      '<span>' + item.v + '</span>' +
      '<span>' + item.e + '</span>' +
      '<span>' + item.d + '</span>' +
      '<strong class="ranking-pts">' + item.pontos + htmlDetalheValores(item) + '</strong>' +
      '<span class="forma">' + forma + '</span>' +
    '</div>';
  }).join(''));
}
