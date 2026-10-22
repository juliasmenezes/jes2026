/* =====================================================
   JES 2026 — modalidades.js
   Esportes do turno, "como funciona o placar" (vindo do motor
   de regras) e regulamento. Com ?admin=1 e sessão ativa, o
   organizador edita o regulamento direto na página.
   ===================================================== */

var esporteSelecionado = null;
var modoEditor = false;

document.addEventListener('DOMContentLoaded', function () {
  modoEditor = new URLSearchParams(window.location.search).get('admin') === '1';

  document.getElementById('sport-menu-items').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-esporte]');
    if (!btn) return;
    esporteSelecionado = btn.getAttribute('data-esporte');
    renderModalidades(true);
  });

  var view = document.getElementById('regulation-view');
  view.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-editor]');
    if (!btn) return;
    var acao = btn.getAttribute('data-editor');
    if (acao === 'adicionar') document.getElementById('rule-editor-list').insertAdjacentHTML('beforeend', htmlRegraEditor({ titulo: '', descricao: '', icone: 'info' }));
    if (acao === 'remover') btn.closest('.reg-editor__regra').remove();
    if (acao === 'cancelar') renderModalidades(true);
  });
  view.addEventListener('submit', salvarRegulamentoPublico);

  initPaginaPublica(function () { renderModalidades(false); });
});

/* Agrupa as modalidades do turno por nome (Futsal masc. + fem. = um esporte) */
function esportesDoTurno() {
  var mapa = {};
  getModalidades().forEach(function (m) {
    if (!mapa[m.nome]) mapa[m.nome] = { nome: m.nome, cor: m.cor, generos: [] };
    if (mapa[m.nome].generos.indexOf(m.genero) === -1) mapa[m.nome].generos.push(m.genero);
  });
  return Object.keys(mapa).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function (k) { return mapa[k]; });
}

function renderModalidades(forcar) {
  var podeEditar = modoEditor && Boolean(getSession());
  var esportes = esportesDoTurno();
  if (!esportes.some(function (e) { return e.nome === esporteSelecionado; })) {
    esporteSelecionado = esportes.length ? esportes[0].nome : null;
    forcar = true;
  }

  renderSeMudou(document.getElementById('sport-menu-items'), esportes.length ? esportes.map(function (e) {
    var ativo = e.nome === esporteSelecionado;
    return '<button type="button" role="tab" aria-selected="' + ativo + '" class="esporte-btn' + (ativo ? ' is-ativo' : '') + '" data-esporte="' + escapeHtml(e.nome) + '" style="--mod:' + escapeHtml(e.cor || '#E30613') + '">' +
      '<span class="esporte-btn__ico">' + iconeEsporte(e.nome) + '</span><span>' + escapeHtml(e.nome) + '</span></button>';
  }).join('') : '');

  var view = document.getElementById('regulation-view');
  /* Uma sincronização não pode apagar o que o organizador está digitando */
  var editorAberto = view.querySelector('#reg-editor-form');
  if (editorAberto && !forcar && editorAberto.getAttribute('data-esporte') === esporteSelecionado) return;

  var esporte = esportes.find(function (e) { return e.nome === esporteSelecionado; });
  if (!esporte) {
    renderSeMudou(view, htmlVazio('Nenhuma modalidade neste turno', 'Os esportes aparecem aqui quando a organização cadastrar.', { icone: 'trofeu' }));
    return;
  }
  var mudou = renderSeMudou(view, htmlRegulamento(esporte, podeEditar));
  if (mudou && forcar) {
    view.classList.remove('anima-entrar');
    void view.offsetWidth;
    view.classList.add('anima-entrar');
  }
}

function htmlRegulamento(esporte, podeEditar) {
  var regra = getRegraModalidade(esporte.nome);
  var regulamento = getRegulamentos()[esporte.nome] || null;
  var jogos = getJogos().filter(function (j) { return j.modalidade === esporte.nome; }).length;
  var generos = esporte.generos.map(function (g) {
    return '<span class="tag">' + escapeHtml({ MASCULINO: 'Masculino', FEMININO: 'Feminino', MISTO: 'Misto' }[g] || g) + '</span>';
  }).join('');

  return '<article class="painel regra-card">' +
    '<header class="regra-card__topo">' +
      '<span class="regra-card__ico">' + iconeEsporte(esporte.nome) + '</span>' +
      '<div><h2>' + escapeHtml(esporte.nome) + '</h2>' +
        '<div class="regra-card__tags">' + generos + '<span class="tag tag--acento">' + escapeHtml(regra.nome) + '</span><span class="tag">' + jogos + (jogos === 1 ? ' jogo' : ' jogos') + '</span></div>' +
      '</div>' +
    '</header>' +
    '<section class="regra-secao"><h3>' + icone('trofeu') + 'Como funciona o placar</h3>' + htmlComoFunciona(regra) + '</section>' +
    (podeEditar ? htmlEditor(regulamento) : htmlConteudoPublico(regulamento)) +
  '</article>';
}

/* Explicação gerada pelas regras do sistema (as mesmas usadas pela mesa de controle) */
function htmlComoFunciona(regra) {
  var itens;
  if (regra.tipo === 'basquete') {
    itens = [['+1', 'lance livre'], ['+2', 'cesta de quadra'], ['+3', 'cesta de 3 pontos'], [regra.periodos, regra.periodos === 4 ? 'quartos' : 'tempos']];
  } else if (regra.tipo === 'sets') {
    itens = [
      [regra.setsParaVencer, regra.setsParaVencer === 1 ? 'set vence (set único)' : 'sets para vencer · melhor de ' + regra.maxSets],
      [regra.pontosSet, 'pontos por set'],
      ['+2', 'de vantagem para fechar o set']
    ];
    if (regra.maxSets > 1) itens.splice(2, 0, [regra.pontosTiebreak, 'pontos no set decisivo']);
  } else if (regra.tipo === 'gol') {
    itens = [['+1', 'por gol'], [regra.periodos, regra.periodos === 1 ? 'tempo único' : 'tempos de jogo']];
    if (regra.lances.indexOf('exclusao') !== -1) itens.push(['2 min', 'de exclusão']);
    if (regra.lances.indexOf('cartao_amarelo') !== -1) itens.push(['Cartões', 'amarelo e vermelho']);
  } else {
    itens = [['+1', 'por ponto']];
  }
  return '<div class="regra-placar">' + itens.map(function (i) {
    return '<div class="regra-placar__item"><b>' + escapeHtml(i[0]) + '</b><span>' + escapeHtml(i[1]) + '</span></div>';
  }).join('') + '</div>';
}

function htmlConteudoPublico(regulamento) {
  if (!regulamento) {
    return '<section class="regra-secao">' + htmlVazio('Regulamento em atualização', 'A organização vai publicar as regras desta modalidade em breve.', { compacto: true }) + '</section>';
  }
  var regras = regulamento.regras || [];
  return (regulamento.visaoGeral
      ? '<section class="regra-secao"><h3>' + icone('info') + 'Visão geral</h3><p>' + escapeHtml(regulamento.visaoGeral) + '</p></section>'
      : '') +
    '<section class="regra-secao"><h3>' + icone('escudo') + 'Regras</h3>' +
      (regras.length
        ? '<div class="regras-lista">' + regras.map(function (r, i) {
          return '<article class="regra-item" style="animation-delay:' + Math.min(i * 50, 400) + 'ms">' +
            '<span class="regra-item__ico">' + getRegulamentoIcon(r.icone) + '</span>' +
            '<div><h4>' + escapeHtml(r.titulo) + '</h4><p>' + escapeHtml(r.descricao) + '</p></div>' +
          '</article>';
        }).join('') + '</div>'
        : '<p>Nenhuma regra específica cadastrada.</p>') +
    '</section>';
}

/* =====================================================
   EDITOR NA PÁGINA (modo organizador)
   ===================================================== */
function htmlEditor(regulamento) {
  regulamento = regulamento || { visaoGeral: '', regras: [] };
  return '<form class="reg-editor" id="reg-editor-form" data-esporte="' + escapeHtml(esporteSelecionado) + '">' +
    '<div class="reg-editor__topo"><h3 class="titulo-secao titulo-secao--sm">Editar conteúdo público</h3><span class="tag tag--acento">Modo organizador</span></div>' +
    '<div class="field-group"><label for="regulation-overview">Visão geral</label><textarea id="regulation-overview" rows="4">' + escapeHtml(regulamento.visaoGeral || '') + '</textarea></div>' +
    '<div class="reg-editor__topo"><span class="rotulo">Regras</span><button type="button" class="btn btn--secundario btn--sm" data-editor="adicionar">' + icone('mais') + 'Adicionar regra</button></div>' +
    '<div id="rule-editor-list" class="lista">' + (regulamento.regras || []).map(htmlRegraEditor).join('') + '</div>' +
    '<div class="reg-editor__acoes"><button type="button" class="btn btn--ghost" data-editor="cancelar">Descartar</button><button type="submit" class="btn btn--primario">Salvar regulamento</button></div>' +
  '</form>';
}

function htmlRegraEditor(regra) {
  return '<div class="reg-editor__regra" data-icone="' + escapeHtml(regra.icone || 'info') + '">' +
    '<div class="reg-editor__regra-topo">' +
      '<input data-field="title" value="' + escapeHtml(regra.titulo || '') + '" placeholder="Título da regra" aria-label="Título da regra">' +
      '<button type="button" class="icon-btn icon-btn--sm icon-btn--perigo" data-editor="remover" aria-label="Remover regra">' + icone('fechar') + '</button>' +
    '</div>' +
    '<textarea data-field="description" rows="2" placeholder="Descrição da regra" aria-label="Descrição da regra">' + escapeHtml(regra.descricao || '') + '</textarea>' +
  '</div>';
}

function salvarRegulamentoPublico(event) {
  if (event.target.id !== 'reg-editor-form') return;
  event.preventDefault();
  var regras = Array.prototype.map.call(document.querySelectorAll('.reg-editor__regra'), function (el) {
    return {
      titulo: el.querySelector('[data-field="title"]').value,
      descricao: el.querySelector('[data-field="description"]').value,
      icone: el.getAttribute('data-icone') || 'info'
    };
  });
  var botao = event.target.querySelector('[type="submit"]');
  botao.disabled = true;
  salvarRegulamento(esporteSelecionado, { visaoGeral: document.getElementById('regulation-overview').value, regras: regras }).then(function () {
    mostrarToast('Regulamento publicado.', 'sucesso');
    renderModalidades(true);
  }, function (err) {
    botao.disabled = false;
    erroAoSalvar(err);
  });
}
