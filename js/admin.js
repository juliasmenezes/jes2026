/* =====================================================
   JES 2026 — admin.js
   Painel do organizador: mesa de controle ao vivo (com as
   regras de cada esporte), agenda, classificação e cadastros.
   Roles: master (acesso total) / mesário (só partidas)
   ===================================================== */

var jogoSelecionadoLive = null;
var viewAtual = 'aovivo';
var cadastroAtual = 'equipes';
var brasaoAtual = '';
var regraCounter = 0;
var equipeDetalheSelecionada = null;
var encerradasAbertas = false;
var filtrosJogos = { busca: '', modalidade: 'all', periodo: 'all', status: 'all' };

/* Lances estruturais (início, fim de período...) não saem pelo "x" do lance a lance */
var MARCOS_FIXOS = ['inicio', 'fim', 'fim_periodo', 'inicio_periodo', 'fim_set'];

document.addEventListener('DOMContentLoaded', function () {
  if (!getSession()) { window.location.href = 'login.html'; return; }

  initTurnoSwitch();
  initSyncPill();
  configurarNavegacao();
  configurarMesa();
  configurarJogos();
  configurarClassificacao();
  configurarCadastros();
  configurarModais();

  onReady(function () {
    var user = getUsuarioAtual();
    if (!user) {
      if ((_db.usuarios || []).length === 0) {
        /* Banco inacessível (rede): mantém a sessão e oferece nova tentativa */
        ocultarLoader();
        document.getElementById('live-panel').innerHTML = htmlVazio('Sem conexão com o banco de dados', 'Verifique a internet e tente de novo.', {
          icone: 'wifi_off',
          acaoHtml: '<button type="button" class="btn btn--primario" onclick="window.location.reload()">Tentar de novo</button>'
        });
        return;
      }
      clearSession();
      window.location.href = 'login.html';
      return;
    }

    if (user.role !== 'master' && user.categoria && user.categoria !== 'ambas' && getCategoria() !== user.categoria) {
      setCategoria(user.categoria);
    }
    aplicarPermissoes(user);
    preencherUsuario(user);
    renderTudo();
    ocultarLoader();

    onSync(renderTudo);
    window.addEventListener('jes2026-categoria-changed', function () {
      var jogo = jogoSelecionadoLive ? getJogoById(jogoSelecionadoLive) : null;
      if (jogo && jogo.categoria !== getCategoria() && jogo.categoria !== 'ambas') jogoSelecionadoLive = null;
      equipeDetalheSelecionada = null;
      renderTudo();
    });
    setInterval(atualizarRelogios, 1000);
  });

  document.getElementById('btn-sair').addEventListener('click', async function () {
    var ok = await confirmarAcao({ titulo: 'Sair do painel?', texto: 'Para controlar partidas de novo será preciso entrar com e-mail e senha.', confirmar: 'Sair', icone: 'sair' });
    if (!ok) return;
    clearSession();
    window.location.href = 'home.html';
  });
});

function aplicarPermissoes(user) {
  var master = user.role === 'master';
  document.body.classList.toggle('is-master', master);
  if (!master) {
    document.querySelectorAll('.master-only').forEach(function (el) { el.hidden = true; });
  }
  var travado = !master && user.categoria && user.categoria !== 'ambas';
  var sw = document.getElementById('turno-switch');
  if (sw) {
    sw.setAttribute('aria-disabled', travado ? 'true' : 'false');
    if (travado) sw.title = 'Turno definido pelo administrador';
  }
}

function preencherUsuario(user) {
  var nome = user.nome || user.email;
  var papel = user.role === 'master' ? 'Administrador' : 'Mesário';
  document.getElementById('user-greeting').textContent = nome;
  document.getElementById('admin-role-badge').textContent = papel;
  document.getElementById('user-avatar').textContent = iniciais(nome);
  document.querySelector('.user-chip').title = nome + ' · ' + papel;
}

function iniciais(nome) {
  var partes = String(nome || '?').trim().split(/[\s@._-]+/).filter(Boolean);
  return ((partes[0] || '?')[0] + (partes.length > 1 ? partes[1][0] : '')).toUpperCase();
}

/* =====================================================
   NAVEGAÇÃO ENTRE SEÇÕES
   ===================================================== */
function configurarNavegacao() {
  document.querySelector('.adm-nav').addEventListener('click', function (e) {
    var item = e.target.closest('[data-view]');
    if (item) mostrarView(item.getAttribute('data-view'));
  });
  document.addEventListener('click', function (e) {
    var alvo = e.target.closest('[data-acao-global]');
    if (!alvo) return;
    var acao = alvo.getAttribute('data-acao-global');
    if (acao === 'novo-jogo') abrirModalNovoJogo();
    else if (acao === 'registrar-pontos') abrirModalPonto(equipeDetalheSelecionada);
    else if (acao === 'ver-jogos') mostrarView('jogos');
  });
}

function mostrarView(view) {
  if ((view === 'classificacao' || view === 'cadastros') && !isMaster()) view = 'aovivo';
  /* Tocar de novo em "Ao vivo" com uma mesa aberta volta para a lista de partidas */
  if (view === 'aovivo' && viewAtual === 'aovivo' && jogoSelecionadoLive) jogoSelecionadoLive = null;
  viewAtual = view;
  document.querySelectorAll('.adm-nav__item').forEach(function (btn) {
    var ativo = btn.getAttribute('data-view') === view;
    btn.classList.toggle('is-ativo', ativo);
    if (ativo) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  document.querySelectorAll('.adm-view').forEach(function (sec) { sec.hidden = sec.id !== 'view-' + view; });
  renderTudo();
  window.scrollTo(0, 0);
}

/* Só a seção visível é redesenhada a cada sincronização */
function renderTudo() {
  atualizarBadgeAoVivo();
  if (viewAtual === 'aovivo') renderLivePanel();
  else if (viewAtual === 'jogos') renderAgenda();
  else if (viewAtual === 'classificacao') renderClassificacaoAdmin();
  else if (viewAtual === 'cadastros') renderCadastros();
  atualizarRelogios();
}

function atualizarBadgeAoVivo() {
  var badge = document.getElementById('badge-aovivo');
  var n = getJogos().filter(function (j) { return j.status === 'AO VIVO' || j.status === 'PAUSADO'; }).length;
  badge.textContent = n;
  badge.hidden = n === 0;
}

function executar(promessa) {
  if (promessa && typeof promessa.catch === 'function') promessa.catch(erroAoSalvar);
}

function valor(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}

/* =====================================================
   AO VIVO — SELETOR DE PARTIDAS
   ===================================================== */
function configurarMesa() {
  var painel = document.getElementById('live-panel');
  painel.addEventListener('click', function (e) {
    var abrir = e.target.closest('[data-abrir-jogo]');
    if (abrir) { abrirMesa(abrir.getAttribute('data-abrir-jogo')); return; }
    var remover = e.target.closest('[data-remover-lance]');
    if (remover) { removerLanceUI(remover.getAttribute('data-remover-lance')); return; }
    var alvo = e.target.closest('[data-acao]');
    if (alvo && !alvo.disabled) acaoMesa(alvo.getAttribute('data-acao'), alvo);
  });
  painel.addEventListener('submit', function (e) {
    if (e.target.id !== 'nota-rapida') return;
    e.preventDefault();
    registrarNota();
  });
  /* Lembra se o grupo "Encerradas hoje" está aberto entre uma sincronização e outra */
  painel.addEventListener('toggle', function (e) {
    if (e.target.matches && e.target.matches('[data-grupo="encerradas"]')) encerradasAbertas = e.target.open;
  }, true);
}

function abrirMesa(id) {
  jogoSelecionadoLive = id;
  if (viewAtual !== 'aovivo') mostrarView('aovivo');
  else renderLivePanel();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fecharMesa() {
  jogoSelecionadoLive = null;
  renderLivePanel();
}

function renderLivePanel() {
  var container = document.getElementById('live-panel');
  var jogo = jogoSelecionadoLive ? getJogoById(jogoSelecionadoLive) : null;
  if (jogoSelecionadoLive && !jogo) {
    jogoSelecionadoLive = null;
    mostrarToast('Essa partida foi apagada.', 'info');
  }
  if (jogo) renderMesa(container, jogo);
  else renderSeletorPartidas(container);
}

function renderSeletorPartidas(container) {
  if (container.getAttribute('data-modo') !== 'seletor') {
    container.setAttribute('data-modo', 'seletor');
    container.__htmlJes = null;
  }
  var hoje = getJogosHoje();
  var andamento = hoje.filter(function (j) { return j.status === 'AO VIVO' || j.status === 'PAUSADO'; }).sort(porDataHora);
  var proximos = hoje.filter(function (j) { return j.status === 'EM BREVE'; }).sort(porDataHora);
  var encerrados = hoje.filter(function (j) { return j.status === 'FINALIZADO'; }).sort(function (a, b) { return porDataHora(b, a); });
  var antigos = getJogosAbertosAntigos().sort(porDataHora);

  var html = '<div class="view-head"><div>' +
      '<span class="view-kicker">' + escapeHtml(formatDateLong(hojeISO())) + '</span>' +
      '<h1 class="view-titulo">Mesa de controle</h1>' +
      '<p class="view-sub">Escolha a partida para marcar o placar e os lances.</p>' +
    '</div>' +
    (isMaster() ? '<button type="button" class="btn btn--primario" data-acao-global="novo-jogo">' + icone('mais') + 'Novo jogo</button>' : '') +
  '</div>';

  if (antigos.length) html += grupoPartidas('Abertas de outros dias — encerre-as', antigos, { alerta: true, comData: true });
  if (andamento.length) html += grupoPartidas('Em andamento', andamento);
  if (proximos.length) html += grupoPartidas('Próximas de hoje', proximos);
  if (encerrados.length) html += grupoPartidas('Encerradas hoje', encerrados, { recolhido: true });
  if (!hoje.length && !antigos.length) {
    html += htmlVazio('Nenhuma partida hoje', 'Não há jogos marcados para hoje no turno da ' + getTurno().nome.toLowerCase() + '. Abra a agenda para controlar outra data.', {
      icone: 'calendario',
      acaoHtml: '<button type="button" class="btn btn--secundario" data-acao-global="ver-jogos">' + icone('calendario') + 'Ver todos os jogos</button>'
    });
  }
  renderSeMudou(container, html);
  aplicarBumps(container);
}

function grupoPartidas(titulo, jogos, opcoes) {
  opcoes = opcoes || {};
  var cabecalho = '<span>' + escapeHtml(titulo) + '</span><b>' + jogos.length + '</b>';
  var cards = '<div class="partidas-grid">' + jogos.map(function (j) { return htmlPartidaCard(j, opcoes.comData); }).join('') + '</div>';
  if (opcoes.recolhido) {
    return '<details class="grupo-partidas" data-grupo="encerradas"' + (encerradasAbertas ? ' open' : '') + '>' +
      '<summary class="grupo-partidas__titulo">' + cabecalho + '</summary>' + cards + '</details>';
  }
  return '<section class="grupo-partidas' + (opcoes.alerta ? ' grupo-partidas--alerta' : '') + '">' +
    '<h2 class="grupo-partidas__titulo">' + cabecalho + '</h2>' + cards + '</section>';
}

function htmlPartidaCard(jogo, comData) {
  var sets = ehJogoDeSets(jogo);
  var breve = jogo.status === 'EM BREVE';
  var cta = breve ? 'Preparar' : jogo.status === 'FINALIZADO' ? 'Ver súmula' : 'Controlar';
  var centro = breve
    ? '<span class="partida-card__hora">' + escapeHtml(jogo.horario) + '</span>'
    : '<span>' + htmlNumeroPlacar(jogo.id + ':card:a', jogo.placarA) + '<i>:</i>' + htmlNumeroPlacar(jogo.id + ':card:b', jogo.placarB) + '</span>' + (sets ? '<small>sets</small>' : '');
  var rodape = comData
    ? icone('calendario') + escapeHtml(formatDateShort(jogo.data) + ' · ' + jogo.horario)
    : icone('local') + escapeHtml(jogo.local || 'Local a definir');
  return '<button type="button" class="partida-card is-' + statusClasse(jogo) + '" data-abrir-jogo="' + jogo.id + '">' +
    '<span class="partida-card__topo">' + htmlChipModalidade(jogo) + htmlStatus(jogo) + '</span>' +
    '<span class="partida-card__times">' +
      '<span class="partida-card__time">' + htmlBrasao(jogo.timeA, 'brasao--md') + '<b>' + escapeHtml(jogo.timeA) + '</b></span>' +
      '<span class="partida-card__placar">' + centro + '</span>' +
      '<span class="partida-card__time">' + htmlBrasao(jogo.timeB, 'brasao--md') + '<b>' + escapeHtml(jogo.timeB) + '</b></span>' +
    '</span>' +
    '<span class="partida-card__rodape"><span>' + rodape + '</span><span class="partida-card__cta">' + cta + icone('seta') + '</span></span>' +
  '</button>';
}

/* =====================================================
   AO VIVO — MESA DE CONTROLE
   Montada uma vez por partida; cada região só é redesenhada
   quando muda (o campo de anotação não perde o texto)
   ===================================================== */
function renderMesa(container, jogo) {
  if (container.getAttribute('data-modo') !== 'mesa:' + jogo.id) {
    container.setAttribute('data-modo', 'mesa:' + jogo.id);
    container.__htmlJes = null;
    container.innerHTML =
      '<div class="mesa anima-entrar">' +
        '<div class="mesa__barra" id="mesa-barra"></div>' +
        '<div id="mesa-placar"></div>' +
        '<div id="mesa-alerta"></div>' +
        '<div class="pads" id="mesa-pads"></div>' +
        '<div class="fluxo" id="mesa-fluxo"></div>' +
        '<section class="painel mesa__timeline" aria-labelledby="titulo-timeline">' +
          '<div class="painel__head"><h2 class="titulo-secao titulo-secao--sm" id="titulo-timeline">Lance a lance</h2><span class="mesa__contagem" id="mesa-contagem"></span></div>' +
          '<form class="nota-rapida" id="nota-rapida" autocomplete="off">' +
            '<input type="text" id="nota-texto" maxlength="140" placeholder="Anotar um lance (ex.: defesa difícil do goleiro)…" aria-label="Texto da anotação">' +
            '<select id="nota-time" aria-label="Equipe da anotação"></select>' +
            '<button type="submit" class="btn btn--secundario">' + icone('nota') + 'Anotar</button>' +
          '</form>' +
          '<div class="timeline" id="mesa-timeline"></div>' +
        '</section>' +
      '</div>';
  }
  renderSeMudou(document.getElementById('mesa-barra'), htmlMesaBarra(jogo));
  renderSeMudou(document.getElementById('mesa-placar'), htmlMesaPlacar(jogo));
  renderSeMudou(document.getElementById('mesa-alerta'), htmlMesaAlerta(jogo));
  renderSeMudou(document.getElementById('mesa-pads'), htmlMesaPads(jogo));
  renderSeMudou(document.getElementById('mesa-fluxo'), htmlMesaFluxo(jogo));
  var timeline = document.getElementById('mesa-timeline');
  if (renderSeMudou(timeline, htmlMesaTimeline(jogo))) animarLancesNovos(timeline, 'mesa:' + jogo.id);
  document.getElementById('mesa-contagem').textContent = jogo.eventos.length + (jogo.eventos.length === 1 ? ' lance' : ' lances');
  preencherSelect(document.getElementById('nota-time'), [['', 'Geral'], ['A', jogo.timeA], ['B', jogo.timeB]], '');
  atualizarRelogios();
  aplicarBumps(container);
}

function htmlMesaBarra(jogo) {
  return '<button type="button" class="btn btn--ghost btn--sm" data-acao="voltar">' + icone('voltar') + '<span>Partidas</span></button>' +
    '<div class="mesa__barra-info">' + htmlChipModalidade(jogo) + htmlStatus(jogo) +
      '<span class="mesa__barra-meta">' + icone('local') + escapeHtml((jogo.local || 'Local a definir') + ' · ' + formatDateShort(jogo.data) + ' ' + jogo.horario) + '</span>' +
    '</div>' +
    '<div class="mesa__barra-acoes">' +
      (isMaster() ? '<button type="button" class="btn btn--ghost btn--sm" data-acao="editar" title="Editar dados do jogo">' + icone('editar') + '<span>Editar</span></button>' : '') +
      '<button type="button" class="btn btn--ghost btn--sm" data-acao="zerar" title="Zerar a partida">' + icone('lixeira') + '<span>Zerar</span></button>' +
    '</div>';
}

function htmlMesaPlacar(jogo) {
  var regra = getRegraJogo(jogo);
  var sets = regra.tipo === 'sets';
  var emSet = sets && jogo.status !== 'FINALIZADO' && !(jogo.status === 'PAUSADO' && jogo.pausa === 'fim_periodo');
  var numA = emSet ? jogo.setA : jogo.placarA;
  var numB = emSet ? jogo.setB : jogo.placarB;
  var chave = jogo.id + (emSet ? ':mesa-set' + (jogo.parciais.length + 1) : ':mesa');
  var rotulo = sets ? (emSet ? (jogo.parciais.length + 1) + 'º Set' : 'Placar de sets') : (getNomePeriodo(jogo) || 'Partida');
  if (jogo.status === 'EM BREVE') rotulo = 'Aguardando início';
  if (jogo.status === 'FINALIZADO') rotulo = 'Placar final';
  var vencedor = jogo.status === 'FINALIZADO' ? getVencedor(jogo) : null;
  return '<div class="mesa__placar is-' + statusClasse(jogo) + '">' +
    htmlLadoMesa(jogo, 'A', regra, vencedor) +
    '<div class="mesa__info">' +
      '<span class="placar__periodo">' + escapeHtml(rotulo) + '</span>' +
      '<div class="mesa__numeros">' + htmlNumeroPlacar(chave + ':a', numA) + '<span class="placar__sep">:</span>' + htmlNumeroPlacar(chave + ':b', numB) + '</div>' +
      (regra.cronometro
        ? '<span class="mesa__relogio' + (jogo.status === 'AO VIVO' ? ' is-correndo' : '') + '">' + icone('relogio') + '<span data-relogio="' + jogo.id + '"></span></span>'
        : '<span class="mesa__relogio mesa__relogio--sets">Sets <b>' + jogo.placarA + ' × ' + jogo.placarB + '</b></span>') +
      (sets ? htmlParciais(jogo, false) : '') +
    '</div>' +
    htmlLadoMesa(jogo, 'B', regra, vencedor) +
  '</div>';
}

function htmlLadoMesa(jogo, lado, regra, vencedor) {
  var nome = nomeDoTime(jogo, lado);
  var bolinhas = '';
  if (regra.tipo === 'sets') {
    var ganhos = lado === 'A' ? jogo.placarA : jogo.placarB;
    for (var i = 0; i < regra.setsParaVencer; i++) bolinhas += '<i' + (i < ganhos ? ' class="is-ganho"' : '') + '></i>';
    bolinhas = '<span class="mesa__sets" title="Sets vencidos: ' + ganhos + '">' + bolinhas + '</span>';
  }
  return '<div class="mesa__time' + (vencedor === lado ? ' is-vencedor' : '') + '">' +
    htmlBrasao(nome, 'brasao--lg') +
    '<span class="mesa__time-nome">' + escapeHtml(nome) + '</span>' +
    bolinhas +
  '</div>';
}

function htmlAlerta(tipo, ico, titulo, texto) {
  return '<div class="alerta alerta--' + tipo + '" role="status">' +
    '<span class="alerta__ico">' + icone(ico) + '</span>' +
    '<span class="alerta__texto"><strong>' + escapeHtml(titulo) + '</strong><span>' + escapeHtml(texto) + '</span></span>' +
  '</div>';
}

/* Orientação do momento da partida (dica, set point, set concluído, intervalo...) */
function htmlMesaAlerta(jogo) {
  var regra = getRegraJogo(jogo);
  if (jogo.status === 'EM BREVE') {
    return htmlAlerta('info', 'play', 'Pronto para começar', 'Toque em "Iniciar partida" quando o árbitro apitar' + (regra.cronometro ? ' — o cronômetro começa junto.' : '.'));
  }
  if (jogo.status === 'FINALIZADO') {
    var vencedorFinal = getVencedor(jogo);
    return htmlAlerta('fim', 'bandeira', 'Partida encerrada',
      (vencedorFinal ? nomeDoTime(jogo, vencedorFinal) + ' venceu' : 'Empate') + ' · ' + jogo.placarA + ' × ' + jogo.placarB + (regra.tipo === 'sets' ? ' em sets' : '') + '. O resultado já está no site.');
  }
  if (regra.tipo === 'sets') {
    var est = getEstadoSet(jogo);
    if (jogo.status === 'PAUSADO' && jogo.pausa === 'fim_periodo') {
      if (est.decidido) {
        return htmlAlerta('forte', 'trofeu', nomeDoTime(jogo, getVencedor(jogo)) + ' fechou a partida',
          'Sets ' + jogo.placarA + ' × ' + jogo.placarB + '. Toque em "Finalizar partida" para publicar o resultado.');
      }
      var ultima = jogo.parciais[jogo.parciais.length - 1] || { a: 0, b: 0 };
      return htmlAlerta('pausa', 'pausa', 'Fim do ' + jogo.parciais.length + 'º set',
        'Parcial ' + ultima.a + ' × ' + ultima.b + '. Inicie o ' + (jogo.parciais.length + 1) + 'º set quando as equipes voltarem.');
    }
    if (jogo.status === 'PAUSADO') {
      return htmlAlerta('pausa', 'pausa', getRotuloPausa(jogo).titulo, 'Toque em "Retomar" quando a bola voltar.');
    }
    if (est.vencedor) {
      return htmlAlerta('forte', 'trofeu', 'Set concluído: ' + jogo.setA + ' × ' + jogo.setB,
        nomeDoTime(jogo, est.vencedor) + ' fez ' + Math.max(jogo.setA, jogo.setB) + ' com 2 de vantagem. Toque em "Encerrar ' + est.numero + 'º set".');
    }
    if (est.setPoint) {
      return htmlAlerta('aviso', 'trofeu', (est.matchPoint ? 'Match point' : 'Set point') + ' — ' + nomeDoTime(jogo, est.setPoint),
        'O ' + est.numero + 'º set vai até ' + est.alvo + ' pontos' + (est.decisivo ? ' (set decisivo)' : '') + '.');
    }
    return htmlAlerta('dica', 'info', est.numero + 'º set até ' + est.alvo + ' pontos' + (est.decisivo ? ' · set decisivo' : ''),
      (regra.maxSets > 1 ? 'Melhor de ' + regra.maxSets + ' sets' : 'Set único') + ' · fecha o set quem abrir 2 pontos de vantagem.');
  }
  if (jogo.status === 'PAUSADO') {
    var rotulo = getRotuloPausa(jogo);
    if (jogo.pausa === 'fim_periodo') {
      if (jogo.periodo >= regra.periodos) {
        return htmlAlerta('pausa', 'bandeira', rotulo.titulo, jogo.placarA === jogo.placarB
          ? 'Empate no tempo normal: inicie a prorrogação ou finalize a partida.'
          : 'Finalize a partida para publicar o resultado.');
      }
      return htmlAlerta('pausa', 'pausa', rotulo.titulo, 'Toque em "Iniciar ' + getNomePeriodo(jogo, jogo.periodo + 1) + '" quando a bola voltar a rolar.');
    }
    return htmlAlerta('pausa', 'pausa', rotulo.titulo, 'Cronômetro parado. Toque em "Retomar" para continuar.');
  }
  return '';
}

function htmlMesaPads(jogo) {
  var regra = getRegraJogo(jogo);
  var naoComecou = jogo.status === 'EM BREVE';
  var encerrado = jogo.status === 'FINALIZADO';
  var intervaloSet = regra.tipo === 'sets' && jogo.status === 'PAUSADO' && jogo.pausa === 'fim_periodo';
  var bloqueado = naoComecou || encerrado || intervaloSet;
  var aviso = naoComecou ? 'Inicie a partida para marcar pontos'
    : encerrado ? 'Partida encerrada'
    : intervaloSet ? 'Inicie o próximo set para marcar pontos' : '';
  return htmlPad(jogo, 'A', regra, bloqueado, aviso) + htmlPad(jogo, 'B', regra, bloqueado, aviso);
}

/* Um pad por equipe: botões de pontuação da modalidade + lances rápidos */
function htmlPad(jogo, lado, regra, bloqueado, aviso) {
  var nome = nomeDoTime(jogo, lado);
  var atual = regra.tipo === 'sets' ? (lado === 'A' ? jogo.setA : jogo.setB) : (lado === 'A' ? jogo.placarA : jogo.placarB);
  var podeDesfazer = !bloqueado && atual > 0;
  var botoes = regra.pontuacoes.map(function (p) {
    return '<button type="button" class="btn-ponto" data-acao="ponto" data-time="' + lado + '" data-valor="' + p.valor + '"' + (bloqueado ? ' disabled' : '') +
      ' aria-label="' + escapeHtml(p.rotulo + ' para ' + nome) + '"><span>' + p.curto + '</span><small>' + escapeHtml(p.rotulo) + '</small></button>';
  }).join('');
  var lancesBloqueados = jogo.status === 'EM BREVE' || jogo.status === 'FINALIZADO';
  var lances = regra.lances.map(function (tipo) {
    return '<button type="button" class="btn-lance" data-acao="lance" data-tipo="' + tipo + '" data-time="' + lado + '"' + (lancesBloqueados ? ' disabled' : '') +
      ' title="' + escapeHtml(LANCES[tipo].rotulo) + '">' + iconeEvento({ tipo: tipo }) + escapeHtml(LANCES[tipo].curto) + '</button>';
  }).join('');
  if (regra.pedidoTempo) {
    lances += '<button type="button" class="btn-lance" data-acao="tempo-tecnico" data-time="' + lado + '"' + (jogo.status !== 'AO VIVO' ? ' disabled' : '') +
      ' title="Pedido de tempo">' + icone('relogio') + 'Tempo</button>';
  }
  return '<section class="pad pad--' + lado.toLowerCase() + '" aria-label="Controles de ' + escapeHtml(nome) + '">' +
    '<header class="pad__topo">' + htmlBrasao(nome, 'brasao--sm') + '<span class="pad__nome">' + escapeHtml(nome) + '</span>' +
      '<button type="button" class="pad__desfazer" data-acao="desfazer" data-time="' + lado + '"' + (podeDesfazer ? '' : ' disabled') + ' title="Desfazer o último ponto deste time">' + icone('desfazer') + '<span>Desfazer</span></button>' +
    '</header>' +
    '<div class="pad__pontos" style="--n:' + regra.pontuacoes.length + '">' + botoes +
      (bloqueado && aviso ? '<div class="pad__aviso">' + escapeHtml(aviso) + '</div>' : '') +
    '</div>' +
    (lances ? '<div class="pad__lances">' + lances + '</div>' : '') +
  '</section>';
}

/* Barra de fluxo: as ações possíveis no estado atual, com a recomendada em destaque */
function htmlMesaFluxo(jogo) {
  var regra = getRegraJogo(jogo);
  function botao(acao, rotulo, ico, estilo, extra) {
    return '<button type="button" class="btn ' + (estilo || 'btn--secundario') + '" data-acao="' + acao + '"' + (extra || '') + '>' + icone(ico) + '<span>' + escapeHtml(rotulo) + '</span></button>';
  }
  if (jogo.status === 'EM BREVE') return botao('iniciar', 'Iniciar partida', 'play', 'btn--primario btn--lg');
  if (jogo.status === 'FINALIZADO') return botao('reabrir', 'Reabrir partida', 'desfazer', 'btn--ghost') + botao('voltar', 'Voltar às partidas', 'voltar', 'btn--escuro');

  var pausaOuRetoma = jogo.status === 'AO VIVO' ? botao('pausar', 'Pausar', 'pausa') : botao('retomar', 'Retomar', 'play', 'btn--primario');

  if (regra.tipo === 'sets') {
    var est = getEstadoSet(jogo);
    if (jogo.status === 'PAUSADO' && jogo.pausa === 'fim_periodo') {
      if (est.decidido) return botao('reabrir-set', 'Desfazer fim do set', 'desfazer', 'btn--ghost') + botao('finalizar', 'Finalizar partida', 'bandeira', 'btn--primario btn--pulso');
      return botao('reabrir-set', 'Desfazer fim do set', 'desfazer', 'btn--ghost') +
        botao('finalizar', 'Finalizar', 'bandeira') +
        botao('proximo-periodo', 'Iniciar ' + (jogo.parciais.length + 1) + 'º set', 'play', 'btn--primario');
    }
    var empatado = jogo.setA === jogo.setB;
    return pausaOuRetoma +
      botao('encerrar-set', 'Encerrar ' + est.numero + 'º set', 'trofeu', est.vencedor ? 'btn--primario btn--pulso' : 'btn--secundario', empatado ? ' disabled title="O set não pode terminar empatado"' : '') +
      botao('finalizar', 'Finalizar', 'bandeira', 'btn--perigo');
  }

  if (jogo.status === 'PAUSADO' && jogo.pausa === 'fim_periodo') {
    if (jogo.periodo >= regra.periodos) {
      return botao('desfazer-fim-periodo', 'Desfazer', 'desfazer', 'btn--ghost') +
        botao('proximo-periodo', 'Prorrogação', 'play') +
        botao('finalizar', 'Finalizar partida', 'bandeira', 'btn--primario btn--pulso');
    }
    return botao('desfazer-fim-periodo', 'Desfazer', 'desfazer', 'btn--ghost') +
      botao('finalizar', 'Finalizar', 'bandeira') +
      botao('proximo-periodo', 'Iniciar ' + getNomePeriodo(jogo, jogo.periodo + 1), 'play', 'btn--primario');
  }
  var encerrarPeriodoBtn = regra.periodos > 1 || jogo.periodo > regra.periodos
    ? botao('encerrar-periodo', 'Encerrar ' + getNomePeriodo(jogo), 'stop')
    : '';
  return pausaOuRetoma + encerrarPeriodoBtn + botao('finalizar', 'Finalizar', 'bandeira', 'btn--perigo');
}

function htmlMesaTimeline(jogo) {
  var eventos = jogo.eventos.slice().reverse();
  if (!eventos.length) return '<p class="feed__vazio">Os lances aparecem aqui conforme você marca.</p>';
  return eventos.map(function (ev) {
    return htmlLance(jogo, ev, { remover: MARCOS_FIXOS.indexOf(ev.marco) === -1 });
  }).join('');
}

/* =====================================================
   AO VIVO — AÇÕES DA MESA
   O retorno visual é imediato; o Firestore confirma em segundo plano
   ===================================================== */
function fxMesa(opcoes) {
  JESFX.banner(Object.assign({ compacto: true }, opcoes));
}

function placarTexto(jogo) {
  return jogo.timeA + ' ' + jogo.placarA + ' × ' + jogo.placarB + ' ' + jogo.timeB;
}

function acaoMesa(acao, el) {
  if (acao === 'voltar') { fecharMesa(); return; }
  var jogo = getJogoById(jogoSelecionadoLive);
  if (!jogo) return;
  var time = el.getAttribute('data-time');
  var regra = getRegraJogo(jogo);
  switch (acao) {
    case 'ponto':
      marcarPonto(jogo, time, Number(el.getAttribute('data-valor')), el);
      break;
    case 'desfazer':
      desfazerPontoUI(jogo, time);
      break;
    case 'lance':
      registrarLanceUI(jogo, el.getAttribute('data-tipo'), time);
      break;
    case 'tempo-tecnico':
      vibrar(12);
      executar(pausarPartida(jogo.id, 'tempo_tecnico', time));
      fxMesa({ variante: 'pausa', titulo: 'TEMPO TÉCNICO', subtitulo: nomeDoTime(jogo, time) });
      break;
    case 'iniciar':
      vibrar(20);
      executar(iniciarPartida(jogo.id));
      fxMesa({ variante: 'inicio', titulo: regra.tipo === 'sets' ? 'VALENDO!' : 'COMEÇOU!', subtitulo: jogo.timeA + ' × ' + jogo.timeB });
      break;
    case 'pausar':
      executar(pausarPartida(jogo.id, 'pausa'));
      fxMesa({ variante: 'pausa', titulo: 'JOGO PAUSADO', subtitulo: regra.cronometro ? 'Cronômetro parado' : placarTexto(jogo) });
      break;
    case 'retomar':
      executar(retomarPartida(jogo.id));
      fxMesa({ variante: 'inicio', titulo: 'BOLA EM JOGO', subtitulo: placarTexto(jogo) });
      break;
    case 'encerrar-periodo':
      encerrarPeriodoUI(jogo);
      break;
    case 'proximo-periodo':
      proximoPeriodoUI(jogo);
      break;
    case 'desfazer-fim-periodo':
      executar(desfazerFimPeriodo(jogo.id));
      mostrarToast('Fim de período desfeito — cronômetro correndo.', 'info');
      break;
    case 'encerrar-set':
      encerrarSetUI(jogo);
      break;
    case 'reabrir-set':
      executar(reabrirSet(jogo.id));
      mostrarToast('Set reaberto: a parcial voltou para o placar.', 'info');
      break;
    case 'finalizar':
      finalizarUI(jogo);
      break;
    case 'reabrir':
      reabrirUI(jogo);
      break;
    case 'zerar':
      zerarUI(jogo);
      break;
    case 'editar':
      editarJogo(jogo.id);
      break;
  }
}

function marcarPonto(jogo, time, valorPonto, botao) {
  vibrar(14);
  if (botao) {
    botao.classList.remove('is-tocado');
    void botao.offsetWidth;
    botao.classList.add('is-tocado');
  }
  var regra = getRegraJogo(jogo);
  executar(registrarPonto(jogo.id, time, valorPonto));
  /* Em sets o número pulando já é o retorno: banner a cada rali seria poluição */
  if (regra.tipo === 'sets') return;
  var pontuacao = regra.pontuacoes.find(function (p) { return p.valor === valorPonto; }) || regra.pontuacoes[0];
  var novoA = jogo.placarA + (time === 'A' ? pontuacao.valor : 0);
  var novoB = jogo.placarB + (time === 'B' ? pontuacao.valor : 0);
  var variante = regra.tipo === 'gol' ? 'gol'
    : regra.tipo === 'basquete' ? (pontuacao.valor === 3 ? 'cesta3' : pontuacao.valor === 2 ? 'cesta' : 'll')
    : 'ponto';
  fxMesa({ variante: variante, valor: '+' + pontuacao.valor, titulo: pontuacao.titulo, subtitulo: nomeDoTime(jogo, time) + ' · ' + novoA + ' × ' + novoB });
}

function desfazerPontoUI(jogo, time) {
  var regra = getRegraJogo(jogo);
  var atual = regra.tipo === 'sets' ? (time === 'A' ? jogo.setA : jogo.setB) : (time === 'A' ? jogo.placarA : jogo.placarB);
  if (atual <= 0) { mostrarToast('Nada para desfazer.', 'info'); return; }
  vibrar(8);
  executar(desfazerPonto(jogo.id, time));
  mostrarToast('Último ponto de ' + nomeDoTime(jogo, time) + ' desfeito.', 'info');
}

function registrarLanceUI(jogo, tipo, time) {
  vibrar(10);
  executar(registrarLance(jogo.id, tipo, time));
  var nome = nomeDoTime(jogo, time);
  var destaque = {
    cartao_amarelo: ['amarelo', 'CARTÃO AMARELO'],
    cartao_vermelho: ['vermelho', 'CARTÃO VERMELHO'],
    exclusao: ['exclusao', 'EXCLUSÃO · 2 MIN']
  }[tipo];
  if (destaque) fxMesa({ variante: destaque[0], titulo: destaque[1], subtitulo: nome });
  else mostrarToast((LANCES[tipo] ? LANCES[tipo].rotulo : 'Lance') + ' registrada — ' + nome + '.', 'sucesso');
}

function encerrarPeriodoUI(jogo) {
  var rotulo = getRotuloPausa(Object.assign({}, jogo, { status: 'PAUSADO', pausa: 'fim_periodo' }));
  vibrar(20);
  executar(encerrarPeriodo(jogo.id));
  fxMesa({ variante: 'pausa', titulo: rotulo.titulo.toUpperCase(), subtitulo: placarTexto(jogo) });
}

function proximoPeriodoUI(jogo) {
  var regra = getRegraJogo(jogo);
  var proximo = regra.tipo === 'sets' ? jogo.parciais.length + 1 : jogo.periodo + 1;
  vibrar(20);
  executar(iniciarProximoPeriodo(jogo.id));
  fxMesa({ variante: 'inicio', titulo: comecaPeriodo(getNomePeriodo(jogo, proximo)).toUpperCase(), subtitulo: placarTexto(jogo) });
}

async function encerrarSetUI(jogo) {
  if (jogo.setA === jogo.setB) { mostrarToast('O set não pode terminar empatado.', 'erro'); return; }
  var estado = getEstadoSet(jogo);
  if (!estado.vencedor) {
    var ok = await confirmarAcao({
      titulo: 'Encerrar o set agora?',
      texto: 'O ' + estado.numero + 'º set vai até ' + estado.alvo + ' pontos com 2 de vantagem e está ' + jogo.setA + ' × ' + jogo.setB + '. Encerrar mesmo assim?',
      confirmar: 'Encerrar set',
      icone: 'trofeu'
    });
    if (!ok) return;
    jogo = getJogoById(jogo.id);
    if (!jogo || jogo.setA === jogo.setB) return;
  }
  var vencedor = jogo.setA > jogo.setB ? 'A' : 'B';
  var numero = jogo.parciais.length + 1;
  vibrar(20);
  executar(encerrarSet(jogo.id));
  fxMesa({ variante: 'set', titulo: 'FIM DO ' + numero + 'º SET', subtitulo: nomeDoTime(jogo, vencedor) + ' · ' + jogo.setA + ' × ' + jogo.setB });
}

async function finalizarUI(jogo) {
  var regra = getRegraJogo(jogo);
  var placarA = jogo.placarA;
  var placarB = jogo.placarB;
  var extra = '';
  if (regra.tipo === 'sets' && (jogo.setA || jogo.setB)) {
    if (jogo.setA !== jogo.setB) {
      if (jogo.setA > jogo.setB) placarA++;
      else placarB++;
      extra = ' O set em andamento (' + jogo.setA + ' × ' + jogo.setB + ') entra na súmula.';
    } else {
      extra = ' O set em andamento está empatado e será descartado.';
    }
  }
  var ok = await confirmarAcao({
    titulo: 'Finalizar partida?',
    texto: 'Placar final: ' + jogo.timeA + ' ' + placarA + ' × ' + placarB + ' ' + jogo.timeB + (regra.tipo === 'sets' ? ' (sets)' : '') + '.' + extra + ' O resultado vai direto para o site.',
    confirmar: 'Finalizar',
    icone: 'bandeira'
  });
  if (!ok) return;
  vibrar([20, 40, 20]);
  executar(finalizarPartida(jogo.id));
  var vencedor = placarA === placarB ? null : placarA > placarB ? jogo.timeA : jogo.timeB;
  fxMesa({
    variante: 'fim',
    titulo: 'FIM DE JOGO',
    subtitulo: (vencedor ? vencedor + ' vence' : 'Empate') + ' · ' + placarA + ' × ' + placarB,
    confete: true
  });
}

async function reabrirUI(jogo) {
  var ok = await confirmarAcao({ titulo: 'Reabrir partida?', texto: 'A partida volta como pausada para corrigir o placar ou continuar. No site ela reaparece como em andamento.', confirmar: 'Reabrir', icone: 'desfazer' });
  if (!ok) return;
  executar(reabrirPartida(jogo.id));
  mostrarToast('Partida reaberta.', 'info');
}

async function zerarUI(jogo) {
  var ok = await confirmarAcao({
    titulo: 'Zerar partida?',
    texto: 'Apaga todos os lances, o placar' + (ehJogoDeSets(jogo) ? ', os sets' : '') + ' e o cronômetro de ' + jogo.timeA + ' × ' + jogo.timeB + '. A partida volta para "Em breve". Não dá para desfazer.',
    confirmar: 'Zerar tudo',
    perigo: true
  });
  if (!ok) return;
  executar(zerarPartida(jogo.id));
  mostrarToast('Partida zerada.', 'info');
}

async function removerLanceUI(eventoId) {
  var jogo = getJogoById(jogoSelecionadoLive);
  if (!jogo) return;
  var evento = jogo.eventos.find(function (ev) { return ev.id === eventoId; });
  if (!evento) return;
  if (ehPontuacao(evento)) {
    var ok = await confirmarAcao({
      titulo: 'Remover lance?',
      texto: '"' + evento.descricao + '" será apagado e o placar volta ' + evento.valor + (evento.valor === 1 ? ' ponto.' : ' pontos.'),
      confirmar: 'Remover',
      perigo: true
    });
    if (!ok) return;
  }
  executar(removerEvento(jogo.id, eventoId));
}

function registrarNota() {
  var jogo = getJogoById(jogoSelecionadoLive);
  if (!jogo) return;
  var input = document.getElementById('nota-texto');
  var texto = input.value.trim();
  if (!texto) { input.focus(); mostrarToast('Escreva a anotação do lance.', 'info'); return; }
  executar(registrarLance(jogo.id, 'info', valor('nota-time'), texto));
  input.value = '';
  mostrarToast('Anotação registrada.', 'sucesso');
}

/* =====================================================
   JOGOS — AGENDA COMPLETA
   ===================================================== */
function configurarJogos() {
  var busca = document.getElementById('busca-jogos');
  var espera = null;
  busca.addEventListener('input', function () {
    clearTimeout(espera);
    espera = setTimeout(function () { filtrosJogos.busca = busca.value; renderAgenda(); }, 120);
  });
  document.getElementById('filtro-modalidade').addEventListener('change', function () {
    filtrosJogos.modalidade = this.value;
    renderAgenda();
  });
  ligarSegmentado('filtro-periodo-jogos', function (v) { filtrosJogos.periodo = v; renderAgenda(); });
  ligarSegmentado('filtro-status-jogos', function (v) { filtrosJogos.status = v; renderAgenda(); });
  document.getElementById('lista-jogos').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-acao-jogo]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var acao = btn.getAttribute('data-acao-jogo');
    if (acao === 'controlar') abrirMesa(id);
    else if (acao === 'editar') editarJogo(id);
    else if (acao === 'apagar') confirmarApagarJogo(id);
  });
}

function ordenarModalidades(a, b) {
  return a.nome.localeCompare(b.nome, 'pt-BR') || String(a.genero).localeCompare(String(b.genero));
}

function ordenarEquipes(a, b) {
  return a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true });
}

function renderAgenda() {
  var opcoesModalidade = [['all', 'Todas']].concat(getModalidades().slice().sort(ordenarModalidades).map(function (m) {
    return [m.nome + '|' + m.genero, m.nome + ' · ' + generoCurto(m.genero)];
  }));
  var selectModalidade = document.getElementById('filtro-modalidade');
  preencherSelect(selectModalidade, opcoesModalidade, 'all');
  filtrosJogos.modalidade = selectModalidade.value;

  var hoje = hojeISO();
  var busca = normalizarTexto(filtrosJogos.busca);
  var jogos = getJogos().filter(function (j) {
    if (filtrosJogos.periodo === 'today' && j.data !== hoje) return false;
    if (filtrosJogos.periodo === 'next' && j.data < hoje) return false;
    if (filtrosJogos.status === 'AO VIVO' && j.status !== 'AO VIVO' && j.status !== 'PAUSADO') return false;
    if (filtrosJogos.status !== 'all' && filtrosJogos.status !== 'AO VIVO' && j.status !== filtrosJogos.status) return false;
    if (filtrosJogos.modalidade !== 'all' && j.modalidade + '|' + j.genero !== filtrosJogos.modalidade) return false;
    if (busca && normalizarTexto([j.timeA, j.timeB, j.local, j.modalidade].join(' ')).indexOf(busca) === -1) return false;
    return true;
  }).sort(porDataHora);

  var el = document.getElementById('lista-jogos');
  if (!jogos.length) {
    renderSeMudou(el, htmlVazio('Nenhum jogo encontrado', 'Ajuste os filtros' + (isMaster() ? ' ou cadastre um novo jogo.' : '.'), {
      icone: 'calendario',
      acaoHtml: isMaster() ? '<button type="button" class="btn btn--primario" data-acao-global="novo-jogo">' + icone('mais') + 'Novo jogo</button>' : ''
    }));
    return;
  }
  renderSeMudou(el, agruparPorData(jogos).map(function (grupo) {
    return '<section class="agenda-dia">' +
      '<h2 class="agenda-dia__head">' + escapeHtml(formatDateLong(grupo.data)) + '<small>' + grupo.jogos.length + (grupo.jogos.length === 1 ? ' jogo' : ' jogos') + '</small></h2>' +
      '<div class="agenda-lista">' + grupo.jogos.map(htmlAgendaLinha).join('') + '</div>' +
    '</section>';
  }).join(''));
}

function htmlAgendaLinha(jogo) {
  var encerrado = jogo.status === 'FINALIZADO';
  var acoes = '<button type="button" class="btn btn--sm ' + (encerrado ? 'btn--ghost' : 'btn--primario-suave') + '" data-acao-jogo="controlar" data-id="' + jogo.id + '" title="' + (encerrado ? 'Ver súmula' : 'Controlar partida') + '">' +
    icone(encerrado ? 'lista' : 'play') + '<span>' + (encerrado ? 'Súmula' : 'Controlar') + '</span></button>';
  if (isMaster()) {
    acoes += '<button type="button" class="icon-btn icon-btn--sm" data-acao-jogo="editar" data-id="' + jogo.id + '" title="Editar jogo" aria-label="Editar jogo">' + icone('editar') + '</button>' +
      '<button type="button" class="icon-btn icon-btn--sm icon-btn--perigo" data-acao-jogo="apagar" data-id="' + jogo.id + '" title="Apagar jogo" aria-label="Apagar jogo">' + icone('lixeira') + '</button>';
  }
  return '<div class="agenda-linha is-' + statusClasse(jogo) + '">' +
    '<span class="agenda-linha__hora">' + escapeHtml(jogo.horario) + '</span>' +
    '<span class="agenda-linha__mod">' + htmlChipModalidade(jogo) + '<small>' + icone('local') + escapeHtml(jogo.local || 'Local a definir') + '</small></span>' +
    '<span class="agenda-linha__confronto">' +
      '<span class="lado"><span>' + escapeHtml(jogo.timeA) + '</span>' + htmlBrasao(jogo.timeA, 'brasao--sm') + '</span>' +
      htmlPlacarCompacto(jogo) +
      '<span class="lado lado--b">' + htmlBrasao(jogo.timeB, 'brasao--sm') + '<span>' + escapeHtml(jogo.timeB) + '</span></span>' +
    '</span>' +
    '<span class="agenda-linha__status">' + htmlStatus(jogo) + '</span>' +
    '<span class="agenda-linha__acoes">' + acoes + '</span>' +
  '</div>';
}

async function confirmarApagarJogo(id) {
  var jogo = getJogoById(id);
  if (!jogo) return;
  var ok = await confirmarAcao({
    titulo: 'Apagar jogo?',
    texto: jogo.modalidade + ' ' + generoCurto(jogo.genero) + ' — ' + jogo.timeA + ' × ' + jogo.timeB + ' (' + formatDateShort(jogo.data) + ' ' + jogo.horario + '). Os lances também serão apagados.',
    confirmar: 'Apagar',
    perigo: true
  });
  if (!ok) return;
  if (jogoSelecionadoLive === id) jogoSelecionadoLive = null;
  executar(apagarJogo(id));
  mostrarToast('Jogo apagado.', 'info');
}

/* =====================================================
   CLASSIFICAÇÃO (master)
   ===================================================== */
function configurarClassificacao() {
  document.getElementById('lista-classificacao').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-equipe-detalhe]');
    if (!btn) return;
    var nome = btn.getAttribute('data-equipe-detalhe');
    equipeDetalheSelecionada = equipeDetalheSelecionada === nome ? null : nome;
    renderClassificacaoAdmin();
  });
  document.getElementById('pontos-detalhe-container').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remover-ponto]');
    if (btn) confirmarApagarPonto(btn.getAttribute('data-remover-ponto'));
  });
}

function renderClassificacaoAdmin() {
  var dados = getClassificacao();
  var lista = document.getElementById('lista-classificacao');
  if (!dados.length) {
    renderSeMudou(lista, htmlVazio('Nenhuma equipe no turno', 'Cadastre as equipes na seção Cadastros.', { icone: 'usuarios' }));
  } else {
    renderSeMudou(lista, dados.map(function (item) {
      var registros = getPontosPorEquipe(item.unidade).length;
      var selecionada = item.unidade === equipeDetalheSelecionada;
      return '<div class="cad-linha' + (selecionada ? ' is-selecionada' : '') + '">' +
        '<span class="cad-linha__pos">' + item.posicao + 'º</span>' +
        htmlBrasao(item.unidade, 'brasao--md') +
        '<span class="cad-linha__principal"><b>' + escapeHtml(item.unidade) + '</b><span class="cad-linha__meta">' + registros + (registros === 1 ? ' registro' : ' registros') + '</span></span>' +
        '<span class="cad-linha__pts">' + item.pontos + '<small>pts</small></span>' +
        '<span class="cad-linha__acoes"><button type="button" class="btn btn--sm ' + (selecionada ? 'btn--escuro' : 'btn--secundario') + '" data-equipe-detalhe="' + escapeHtml(item.unidade) + '">' + (selecionada ? 'Fechar' : 'Registros') + '</button></span>' +
      '</div>';
    }).join(''));
  }
  renderPontosDetalhe();
}

function renderPontosDetalhe() {
  var container = document.getElementById('pontos-detalhe-container');
  if (!equipeDetalheSelecionada) {
    renderSeMudou(container, '<div class="painel detalhe-pontos">' + htmlVazio('De onde vêm os pontos', 'Toque em "Registros" em uma equipe para ver e corrigir os lançamentos.', { compacto: true }) + '</div>');
    return;
  }
  var pontos = getPontosPorEquipe(equipeDetalheSelecionada);
  var html = '<div class="painel detalhe-pontos"><div class="painel__head">' +
    '<h2 class="titulo-secao titulo-secao--sm">' + escapeHtml(equipeDetalheSelecionada) + '</h2>' +
    '<button type="button" class="btn btn--sm btn--primario-suave" data-acao-global="registrar-pontos">' + icone('mais') + 'Pontos</button>' +
  '</div>';
  if (!pontos.length) {
    html += '<p class="feed__vazio">Nenhum ponto registrado para esta equipe.</p>';
  } else {
    html += pontos.map(function (p) {
      var jogo = p.jogoId ? getJogoById(p.jogoId) : null;
      var origem = jogo
        ? jogo.modalidade + ' ' + generoCurto(jogo.genero) + ' — ' + jogo.timeA + ' × ' + jogo.timeB + ' (' + formatDateShort(jogo.data) + ')'
        : 'Registro manual';
      return '<div class="detalhe-pontos__item">' +
        '<b>+' + escapeHtml(p.pontos) + '</b>' +
        '<span><strong>' + escapeHtml(p.descricao || 'Pontos') + '</strong><small>' + escapeHtml(origem) + '</small></span>' +
        '<button type="button" class="icon-btn icon-btn--sm icon-btn--perigo" data-remover-ponto="' + escapeHtml(p.id) + '" title="Remover registro" aria-label="Remover registro">' + icone('lixeira') + '</button>' +
      '</div>';
    }).join('');
  }
  renderSeMudou(container, html + '</div>');
}

function abrirModalPonto(equipePreSelecionada) {
  var equipes = getEquipes().slice().sort(ordenarEquipes);
  if (!equipes.length) { avisar('Nenhuma equipe', 'Cadastre equipes antes de registrar pontos.'); return; }
  document.getElementById('form-ponto').reset();
  var select = document.getElementById('ponto_equipe');
  select.innerHTML = '<option value="">Selecione…</option>' + equipes.map(function (e) {
    return '<option value="' + escapeHtml(e.nome) + '">' + escapeHtml(e.nome) + '</option>';
  }).join('');
  select.value = equipePreSelecionada && equipes.some(function (e) { return e.nome === equipePreSelecionada; }) ? equipePreSelecionada : '';
  document.getElementById('ponto_quantidade').value = '3';
  atualizarJogosPorEquipe();
  abrirModal('modal-ponto');
}

function atualizarJogosPorEquipe() {
  var equipe = valor('ponto_equipe');
  var opcoes = '<option value="">Registro manual (sem jogo)</option>';
  if (equipe) {
    opcoes += getJogos().filter(function (j) { return j.status === 'FINALIZADO' && (j.timeA === equipe || j.timeB === equipe); })
      .sort(function (a, b) { return porDataHora(b, a); })
      .map(function (j) {
        return '<option value="' + j.id + '">' + escapeHtml(j.modalidade + ' ' + generoCurto(j.genero) + ' — ' + j.timeA + ' ' + j.placarA + '×' + j.placarB + ' ' + j.timeB + ' (' + formatDateShort(j.data) + ')') + '</option>';
      }).join('');
  }
  document.getElementById('ponto_jogo').innerHTML = opcoes;
}

function salvarPontoForm(e) {
  e.preventDefault();
  var equipe = valor('ponto_equipe');
  var pontos = parseInt(valor('ponto_quantidade'), 10);
  if (!equipe) { mostrarToast('Selecione a equipe.', 'erro'); return; }
  if (!pontos || pontos < 1) { mostrarToast('Informe quantos pontos (1 ou mais).', 'erro'); return; }
  executar(adicionarPonto(equipe, valor('ponto_jogo'), pontos, valor('ponto_descricao').trim()));
  equipeDetalheSelecionada = equipe;
  fecharTodosModais();
  mostrarToast('+' + pontos + (pontos === 1 ? ' ponto' : ' pontos') + ' para ' + equipe + '.', 'sucesso');
  if (viewAtual === 'classificacao') renderClassificacaoAdmin();
}

async function confirmarApagarPonto(id) {
  var ok = await confirmarAcao({ titulo: 'Remover registro?', texto: 'Os pontos deste registro saem da classificação.', confirmar: 'Remover', perigo: true });
  if (!ok) return;
  executar(removerPonto(String(id)));
}

/* =====================================================
   CADASTROS (master): equipes, modalidades, regulamentos, usuários
   ===================================================== */
var TEXTOS_CADASTRO = {
  equipes: {
    botao: 'Nova equipe',
    descricao: function (t) { return 'Turmas do turno da ' + t.nome.toLowerCase() + ' (' + t.descricao + '). Sem foto, o site mostra um escudo com a sigla.'; }
  },
  modalidades: {
    botao: 'Nova modalidade',
    descricao: function () { return 'Esportes do turno. A regra do placar (gols, basquete 1/2/3 ou sets) é escolhida pelo nome.'; }
  },
  regulamentos: {
    botao: '',
    descricao: function () { return 'Regras exibidas na página pública de Modalidades.'; }
  },
  usuarios: {
    botao: 'Novo usuário',
    descricao: function () { return 'Quem pode entrar no painel. Mesários só controlam partidas.'; }
  }
};

function configurarCadastros() {
  ligarSegmentado('abas-cadastro', function (v) { cadastroAtual = v; renderCadastros(); });
  document.getElementById('btn-cadastro-novo').addEventListener('click', function () {
    if (cadastroAtual === 'equipes') abrirModalEquipe();
    else if (cadastroAtual === 'modalidades') abrirModalModalidade();
    else if (cadastroAtual === 'usuarios') abrirModalUsuario();
  });
  var acoes = {
    'editar-equipe': editarEquipe,
    'apagar-equipe': confirmarApagarEquipe,
    'editar-modalidade': editarModalidade,
    'apagar-modalidade': confirmarApagarModalidade,
    'editar-regulamento': abrirModalRegulamento,
    'apagar-regulamento': confirmarApagarRegulamento,
    'editar-usuario': editarUsuario,
    'apagar-usuario': confirmarApagarUsuario
  };
  document.getElementById('cadastro-conteudo').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cad]');
    if (btn && acoes[btn.getAttribute('data-cad')]) acoes[btn.getAttribute('data-cad')](btn.getAttribute('data-id'));
  });
}

function renderCadastros() {
  var textos = TEXTOS_CADASTRO[cadastroAtual];
  document.getElementById('cadastro-descricao').textContent = textos.descricao(getTurno());
  document.getElementById('btn-cadastro-novo').hidden = !textos.botao;
  document.getElementById('btn-cadastro-novo-texto').textContent = textos.botao;
  var html = cadastroAtual === 'equipes' ? htmlListaEquipes()
    : cadastroAtual === 'modalidades' ? htmlListaModalidades()
    : cadastroAtual === 'regulamentos' ? htmlListaRegulamentos()
    : htmlListaUsuarios();
  renderSeMudou(document.getElementById('cadastro-conteudo'), html);
}

function botaoCadastro(acao, id, ico, titulo, perigo) {
  return '<button type="button" class="icon-btn icon-btn--sm' + (perigo ? ' icon-btn--perigo' : '') + '" data-cad="' + acao + '" data-id="' + escapeHtml(id) + '" title="' + escapeHtml(titulo) + '" aria-label="' + escapeHtml(titulo) + '">' + icone(ico) + '</button>';
}

function htmlListaEquipes() {
  var equipes = getEquipes().slice().sort(ordenarEquipes);
  if (!equipes.length) return htmlVazio('Nenhuma equipe cadastrada', 'Cadastre as turmas do turno para montar os jogos.', { icone: 'usuarios' });
  var jogos = getJogos();
  return equipes.map(function (e) {
    var qtd = jogos.filter(function (j) { return j.timeA === e.nome || j.timeB === e.nome; }).length;
    return '<div class="cad-linha">' + htmlBrasao(e.nome, 'brasao--md') +
      '<span class="cad-linha__principal"><b>' + escapeHtml(e.nome) + '</b>' +
        '<span class="cad-linha__meta"><span class="tag">' + escapeHtml(e.turma || 'Sem série') + '</span>' + qtd + (qtd === 1 ? ' jogo' : ' jogos') + '</span></span>' +
      '<span class="cad-linha__acoes">' + botaoCadastro('editar-equipe', e.id, 'editar', 'Editar equipe') + botaoCadastro('apagar-equipe', e.id, 'lixeira', 'Apagar equipe', true) + '</span>' +
    '</div>';
  }).join('');
}

function htmlListaModalidades() {
  var modalidades = getModalidades().slice().sort(ordenarModalidades);
  if (!modalidades.length) return htmlVazio('Nenhuma modalidade', 'Cadastre os esportes do turno — Futsal, Basquete, Vôlei…', { icone: 'trofeu' });
  var regulamentos = getRegulamentos();
  return modalidades.map(function (m) {
    var regra = getRegraModalidade(m.nome);
    return '<div class="cad-linha" style="--mod:' + escapeHtml(m.cor || '#E30613') + '">' +
      '<span class="cad-icone">' + iconeEsporte(m.nome) + '</span>' +
      '<span class="cad-linha__principal"><b>' + escapeHtml(m.nome) + ' · ' + escapeHtml(generoCurto(m.genero)) + '</b>' +
        '<span class="cad-linha__meta"><span class="tag tag--acento">' + escapeHtml(regra.nome) + '</span>' + (regulamentos[m.nome] ? 'Com regulamento' : 'Sem regulamento') + '</span></span>' +
      '<span class="cad-linha__acoes">' + botaoCadastro('editar-modalidade', m.id, 'editar', 'Editar modalidade') + botaoCadastro('apagar-modalidade', m.id, 'lixeira', 'Apagar modalidade', true) + '</span>' +
    '</div>';
  }).join('');
}

function htmlListaRegulamentos() {
  var nomes = getModalidades().map(function (m) { return m.nome; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; })
    .sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  if (!nomes.length) return htmlVazio('Nenhuma modalidade', 'Cadastre as modalidades para escrever os regulamentos.', { icone: 'trofeu' });
  var regulamentos = getRegulamentos();
  return nomes.map(function (nome) {
    var reg = regulamentos[nome];
    var qtd = reg ? (reg.regras || []).length : 0;
    return '<div class="cad-linha">' +
      '<span class="cad-icone">' + iconeEsporte(nome) + '</span>' +
      '<span class="cad-linha__principal"><b>' + escapeHtml(nome) + '</b><span class="cad-linha__meta">' +
        (reg ? '<span class="tag tag--acento">Publicado</span>' + qtd + (qtd === 1 ? ' regra' : ' regras') : '<span class="tag">Sem regulamento</span>') +
      '</span></span>' +
      '<span class="cad-linha__acoes">' +
        '<button type="button" class="btn btn--sm ' + (reg ? 'btn--secundario' : 'btn--primario-suave') + '" data-cad="editar-regulamento" data-id="' + escapeHtml(nome) + '">' + icone(reg ? 'editar' : 'mais') + (reg ? 'Editar' : 'Escrever') + '</button>' +
        (reg ? botaoCadastro('apagar-regulamento', nome, 'lixeira', 'Excluir regulamento', true) : '') +
      '</span>' +
    '</div>';
  }).join('');
}

function htmlListaUsuarios() {
  var usuarios = (_db.usuarios || []).slice().sort(function (a, b) {
    return (a.role === 'master' ? 0 : 1) - (b.role === 'master' ? 0 : 1) || String(a.nome || a.email).localeCompare(String(b.nome || b.email), 'pt-BR');
  });
  if (!usuarios.length) return htmlVazio('Nenhum usuário', '', { icone: 'usuarios' });
  var atual = getUsuarioAtual();
  return usuarios.map(function (u) {
    var turno = u.categoria === 'manha' ? 'Só manhã' : u.categoria === 'tarde' ? 'Só tarde' : 'Ambos os turnos';
    var podeApagar = u.role !== 'master' && (!atual || atual.id !== u.id);
    return '<div class="cad-linha">' +
      '<span class="user-chip__avatar">' + escapeHtml(iniciais(u.nome || u.email)) + '</span>' +
      '<span class="cad-linha__principal"><b>' + escapeHtml(u.nome || u.email) + '</b>' +
        '<span class="cad-linha__meta"><span class="tag' + (u.role === 'master' ? ' tag--acento' : '') + '">' + (u.role === 'master' ? 'Administrador' : 'Mesário') + '</span>' + escapeHtml(turno + ' · ' + u.email) + '</span></span>' +
      '<span class="cad-linha__acoes">' + botaoCadastro('editar-usuario', u.id, 'editar', 'Editar usuário') + (podeApagar ? botaoCadastro('apagar-usuario', u.id, 'lixeira', 'Apagar usuário', true) : '') + '</span>' +
    '</div>';
  }).join('');
}

/* =====================================================
   MODAIS
   ===================================================== */
function configurarModais() {
  document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('.modal-close, .btn-cancel')) fecharTodosModais();
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.querySelector('.modal-overlay.active') && !document.querySelector('.dialogo-overlay')) fecharTodosModais();
  });

  document.getElementById('form-novo-jogo').addEventListener('submit', salvarNovoJogo);
  document.getElementById('modalidade').addEventListener('change', function () { atualizarRegrasDoFormulario(); });
  document.getElementById('regras-campos').addEventListener('change', atualizarResumoRegras);
  document.getElementById('form-equipe').addEventListener('submit', salvarEquipe);
  document.getElementById('form-modalidade').addEventListener('submit', salvarModalidade);
  document.getElementById('nome_modalidade').addEventListener('input', atualizarDicaModalidade);
  document.getElementById('form-ponto').addEventListener('submit', salvarPontoForm);
  document.getElementById('ponto_equipe').addEventListener('change', atualizarJogosPorEquipe);
  document.getElementById('form-regulamento').addEventListener('submit', salvarRegulamentoForm);
  document.getElementById('btn-add-regra').addEventListener('click', function () { adicionarRegraLinha(); });
  document.getElementById('reg-regras-container').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remover-regra]');
    if (btn) btn.closest('.regra-linha').remove();
  });
  document.getElementById('form-usuario').addEventListener('submit', salvarUsuarioForm);
  configurarUploadBrasao();
}

function abrirModal(id) {
  var modal = document.getElementById(id);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  /* No celular, focar o campo abriria o teclado por cima do formulário */
  if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
    setTimeout(function () {
      var campo = modal.querySelector('input:not([type="hidden"]):not([hidden]), select, textarea');
      if (campo) campo.focus();
    }, 80);
  }
}

function fecharTodosModais() {
  document.querySelectorAll('.modal-overlay.active').forEach(function (m) { m.classList.remove('active'); });
  document.body.style.overflow = '';
}

function garantirOpcao(select, valorOpcao, rotulo) {
  if (!valorOpcao) return;
  var existe = Array.prototype.some.call(select.options, function (o) { return o.value === valorOpcao; });
  if (!existe) select.insertAdjacentHTML('beforeend', '<option value="' + escapeHtml(valorOpcao) + '">' + escapeHtml(rotulo || valorOpcao) + '</option>');
}

function generoLongo(genero) {
  return genero === 'MASCULINO' ? 'Masculino' : genero === 'FEMININO' ? 'Feminino' : genero === 'MISTO' ? 'Misto' : (genero || '');
}

/* ---- Jogo ---- */
function prepararFormularioJogo() {
  document.getElementById('form-novo-jogo').reset();
  var modalidades = getModalidades().slice().sort(ordenarModalidades);
  var equipes = getEquipes().slice().sort(ordenarEquipes);
  document.getElementById('modalidade').innerHTML = '<option value="">Selecione…</option>' + modalidades.map(function (m) {
    return '<option value="' + escapeHtml(m.nome + '|' + m.genero) + '">' + escapeHtml(m.nome + ' — ' + generoLongo(m.genero)) + '</option>';
  }).join('');
  var opcoesEquipes = '<option value="">Selecione…</option>' + equipes.map(function (e) {
    return '<option value="' + escapeHtml(e.nome) + '">' + escapeHtml(e.nome) + '</option>';
  }).join('');
  document.getElementById('time_a').innerHTML = opcoesEquipes;
  document.getElementById('time_b').innerHTML = opcoesEquipes;
  var locais = getJogosAll().map(function (j) { return j.local; }).filter(function (l, i, a) { return l && a.indexOf(l) === i; });
  document.getElementById('locais-sugeridos').innerHTML = locais.map(function (l) { return '<option value="' + escapeHtml(l) + '">'; }).join('');
  document.getElementById('jogo-edit-id').value = '';
  document.getElementById('data').value = hojeISO();
  document.getElementById('placar_a').value = '0';
  document.getElementById('placar_b').value = '0';
  document.getElementById('status_jogo').value = 'EM BREVE';
  document.getElementById('parciais').value = '';
  atualizarRegrasDoFormulario();
  return { modalidades: modalidades.length, equipes: equipes.length };
}

function abrirModalNovoJogo() {
  var info = prepararFormularioJogo();
  if (!info.modalidades || info.equipes < 2) {
    avisar('Faltam cadastros', 'Para criar jogos no turno da ' + getTurno().nome.toLowerCase() + ', cadastre pelo menos uma modalidade e duas equipes (seção Cadastros).');
    return;
  }
  document.getElementById('titulo-modal-jogo').textContent = 'Novo jogo';
  abrirModal('modal-novo-jogo');
}

function editarJogo(id) {
  var jogo = getJogoById(id);
  if (!jogo) return;
  prepararFormularioJogo();
  var selectModalidade = document.getElementById('modalidade');
  garantirOpcao(selectModalidade, jogo.modalidade + '|' + jogo.genero, jogo.modalidade + ' — ' + generoLongo(jogo.genero));
  selectModalidade.value = jogo.modalidade + '|' + jogo.genero;
  garantirOpcao(document.getElementById('time_a'), jogo.timeA);
  garantirOpcao(document.getElementById('time_b'), jogo.timeB);
  document.getElementById('time_a').value = jogo.timeA;
  document.getElementById('time_b').value = jogo.timeB;
  document.getElementById('jogo-edit-id').value = jogo.id;
  document.getElementById('data').value = jogo.data;
  document.getElementById('horario').value = jogo.horario;
  document.getElementById('local').value = jogo.local || '';
  document.getElementById('placar_a').value = jogo.placarA;
  document.getElementById('placar_b').value = jogo.placarB;
  document.getElementById('status_jogo').value = jogo.status;
  document.getElementById('parciais').value = jogo.parciais.map(function (p) { return p.a + '-' + p.b; }).join(', ');
  atualizarRegrasDoFormulario(jogo.regras);
  document.getElementById('titulo-modal-jogo').textContent = 'Editar jogo';
  abrirModal('modal-novo-jogo');
}

/* Campos de regra mudam conforme o esporte: períodos (gols/basquete) ou formato de sets */
function atualizarRegrasDoFormulario(ajustes) {
  var nome = valor('modalidade').split('|')[0];
  var dica = document.getElementById('dica-regra-jogo');
  var detalhes = document.getElementById('regras-partida');
  var campoParciais = document.getElementById('campo-parciais');
  if (!nome) {
    dica.hidden = true;
    detalhes.hidden = true;
    campoParciais.hidden = true;
    document.getElementById('rotulo-placar').textContent = 'Placar';
    return;
  }
  var regra = getRegraJogo({ modalidade: nome, regras: ajustes || {} });
  dica.hidden = false;
  dica.innerHTML = iconeEsporte(nome) + '<span>' + escapeHtml(descricaoRegra(regra)) + '</span>';
  detalhes.hidden = false;
  var campos = document.getElementById('regras-campos');
  if (regra.tipo === 'sets') {
    campos.innerHTML =
      campoSelectRegra('regra-sets', 'Formato', [[1, 'Set único'], [2, 'Melhor de 3'], [3, 'Melhor de 5']], regra.setsParaVencer) +
      campoNumeroRegra('regra-pontos-set', 'Pontos por set', regra.pontosSet) +
      campoNumeroRegra('regra-tiebreak', 'Set decisivo', regra.pontosTiebreak);
  } else {
    campos.innerHTML = campoSelectRegra('regra-periodos', 'Períodos', [[1, 'Tempo único'], [2, '2 tempos'], [3, '3 períodos'], [4, '4 quartos']], regra.periodos);
  }
  campoParciais.hidden = regra.tipo !== 'sets';
  document.getElementById('rotulo-placar').textContent = regra.tipo === 'sets' ? 'Placar de sets' : regra.tipo === 'gol' ? 'Placar (gols)' : 'Placar (pontos)';
  atualizarResumoRegras();
}

function campoSelectRegra(id, rotulo, opcoes, atual) {
  return '<div class="field-group"><label for="' + id + '">' + rotulo + '</label><select id="' + id + '">' + opcoes.map(function (o) {
    return '<option value="' + o[0] + '"' + (Number(o[0]) === Number(atual) ? ' selected' : '') + '>' + o[1] + '</option>';
  }).join('') + '</select></div>';
}

function campoNumeroRegra(id, rotulo, atual) {
  return '<div class="field-group"><label for="' + id + '">' + rotulo + '</label><input type="number" id="' + id + '" min="5" max="99" value="' + atual + '" inputmode="numeric"></div>';
}

function coletarRegrasDoFormulario(tipo) {
  if (tipo === 'sets') {
    return { sets_para_vencer: Number(valor('regra-sets')), pontos_set: Number(valor('regra-pontos-set')), pontos_tiebreak: Number(valor('regra-tiebreak')) };
  }
  return { periodos: Number(valor('regra-periodos')) };
}

function atualizarResumoRegras() {
  var nome = valor('modalidade').split('|')[0];
  if (!nome) return;
  var regra = getRegraJogo({ modalidade: nome, regras: coletarRegrasDoFormulario(getRegraModalidade(nome).tipo) });
  document.getElementById('regras-resumo').textContent = resumoRegra(regra);
}

function resumoRegra(regra) {
  if (regra.tipo === 'sets') {
    return (regra.maxSets === 1 ? 'Set único' : 'Melhor de ' + regra.maxSets) + ' · ' + regra.pontosSet + ' pts' + (regra.maxSets > 1 ? ' · decisivo ' + regra.pontosTiebreak : '');
  }
  if (regra.periodos === 4) return '4 quartos';
  if (regra.periodos === 1) return 'Tempo único';
  return regra.periodos + (regra.periodos === 3 ? ' períodos' : ' tempos');
}

function descricaoRegra(regra) {
  if (regra.tipo === 'basquete') return 'Basquete: botões de lance livre (+1), cesta de 2 (+2) e cesta de 3 (+3).';
  if (regra.tipo === 'sets') {
    return 'Placar por sets: o set fecha com ' + regra.pontosSet + ' pontos e 2 de vantagem; vence quem ganhar ' + regra.setsParaVencer + (regra.setsParaVencer === 1 ? ' set.' : ' sets.');
  }
  if (regra.tipo === 'gol') return 'Placar por gols, com cartões e controle de tempos.';
  return 'Placar por pontos (+1 a cada ponto).';
}

/* "25-20, 22-25, 15x12" → [{a:25,b:20}, ...]; formato inválido → null */
function lerParciais(texto) {
  texto = String(texto || '').trim();
  if (!texto) return [];
  var resultado = [];
  var partes = texto.split(/[,;\/]+/);
  for (var i = 0; i < partes.length; i++) {
    var parte = partes[i].trim();
    if (!parte) continue;
    var m = parte.match(/^(\d{1,3})\s*[-x×:]\s*(\d{1,3})$/i);
    if (!m) return null;
    resultado.push({ a: Number(m[1]), b: Number(m[2]) });
  }
  return resultado;
}

function salvarNovoJogo(e) {
  e.preventDefault();
  var editId = valor('jogo-edit-id');
  var mod = valor('modalidade').split('|');
  var dados = {
    modalidade: mod[0],
    genero: mod[1] || '',
    data: valor('data'),
    horario: valor('horario'),
    local: valor('local').trim(),
    timeA: valor('time_a'),
    timeB: valor('time_b'),
    placarA: valor('placar_a'),
    placarB: valor('placar_b'),
    status: valor('status_jogo')
  };
  if (!dados.modalidade || !dados.data || !dados.horario || !dados.timeA || !dados.timeB) {
    mostrarToast('Preencha modalidade, equipes, data e horário.', 'erro');
    return;
  }
  if (dados.timeA === dados.timeB) { mostrarToast('Escolha duas equipes diferentes.', 'erro'); return; }
  var tipo = getRegraModalidade(dados.modalidade).tipo;
  dados.regras = coletarRegrasDoFormulario(tipo);
  if (tipo === 'sets') {
    var parciais = lerParciais(valor('parciais'));
    if (parciais === null) { mostrarToast('Parciais inválidas. Use o formato 25-20, 22-25.', 'erro'); return; }
    if (parciais.length || editId) dados.parciais = parciais;
  }
  executar(editId ? atualizarJogo(editId, dados) : criarJogo(dados));
  fecharTodosModais();
  mostrarToast(editId ? 'Jogo atualizado.' : 'Jogo criado — já aparece no site.', 'sucesso');
}

/* ---- Equipe ---- */
function configurarUploadBrasao() {
  var input = document.getElementById('brasao-input');
  document.getElementById('btn-escolher-brasao').addEventListener('click', function () { input.click(); });
  document.getElementById('btn-remover-brasao').addEventListener('click', removerBrasao);
  input.addEventListener('change', function () {
    var file = this.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { mostrarToast('A imagem deve ter no máximo 8 MB.', 'erro'); return; }
    /* PNG/WebP mantêm o fundo transparente do escudo; fotos viram JPEG leve */
    var formato = /png|gif|webp|svg/.test(file.type) ? 'image/png' : 'image/jpeg';
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        var maxDim = 200;
        var scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        brasaoAtual = canvas.toDataURL(formato, 0.85);
        atualizarBrasaoPreview();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function atualizarBrasaoPreview() {
  var preview = document.getElementById('brasao-preview');
  preview.innerHTML = brasaoAtual ? '<img src="' + brasaoAtual + '" alt="Prévia do brasão">' : icone('escudo');
  document.getElementById('btn-remover-brasao').hidden = !brasaoAtual;
}

function removerBrasao() {
  brasaoAtual = '';
  document.getElementById('brasao-input').value = '';
  atualizarBrasaoPreview();
}

/* Séries do turno: manhã = 7º e 8º anos; tarde = 9º ano ao 3º ano EM */
function popularSeries(valorAtual) {
  var turno = getTurno();
  var series = turno.series.slice();
  if (valorAtual && series.indexOf(valorAtual) === -1) series.unshift(valorAtual);
  var select = document.getElementById('turma');
  select.innerHTML = '<option value="">Selecione…</option>' + series.map(function (s) {
    return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
  }).join('');
  select.value = valorAtual || '';
  document.getElementById('dica-series').textContent = 'Turno da ' + turno.nome.toLowerCase() + ': ' + turno.descricao + '.';
}

function abrirModalEquipe() {
  document.getElementById('form-equipe').reset();
  document.getElementById('equipe-edit-id').value = '';
  document.getElementById('titulo-modal-equipe').textContent = 'Nova equipe';
  document.getElementById('btn-salvar-equipe').textContent = 'Cadastrar';
  popularSeries('');
  brasaoAtual = '';
  document.getElementById('brasao-input').value = '';
  atualizarBrasaoPreview();
  abrirModal('modal-equipe');
}

function editarEquipe(id) {
  var equipe = getEquipes().find(function (e) { return String(e.id) === String(id); });
  if (!equipe) return;
  abrirModalEquipe();
  document.getElementById('equipe-edit-id').value = equipe.id;
  document.getElementById('nome_equipe').value = equipe.nome;
  popularSeries(equipe.turma || '');
  document.getElementById('titulo-modal-equipe').textContent = 'Editar equipe';
  document.getElementById('btn-salvar-equipe').textContent = 'Salvar';
  brasaoAtual = equipe.brasao || '';
  atualizarBrasaoPreview();
}

function salvarEquipe(e) {
  e.preventDefault();
  var id = valor('equipe-edit-id');
  var nome = valor('nome_equipe').trim();
  var turma = valor('turma');
  if (!nome || !turma) { mostrarToast('Informe o nome e a série da equipe.', 'erro'); return; }
  var repetida = getEquipes().some(function (eq) { return eq.nome.toLowerCase() === nome.toLowerCase() && String(eq.id) !== String(id); });
  if (repetida) { mostrarToast('Já existe uma equipe com esse nome neste turno.', 'erro'); return; }
  executar(id ? atualizarEquipe(String(id), { nome: nome, turma: turma, brasao: brasaoAtual }) : criarEquipe(nome, turma, brasaoAtual));
  fecharTodosModais();
  mostrarToast(id ? 'Equipe atualizada.' : 'Equipe cadastrada.', 'sucesso');
}

async function confirmarApagarEquipe(id) {
  var equipe = getEquipes().find(function (e) { return String(e.id) === String(id); });
  if (!equipe) return;
  var jogos = getJogos().filter(function (j) { return j.timeA === equipe.nome || j.timeB === equipe.nome; }).length;
  var ok = await confirmarAcao({
    titulo: 'Apagar equipe?',
    texto: equipe.nome + (jogos
      ? ' aparece em ' + jogos + (jogos === 1 ? ' jogo, que continua' : ' jogos, que continuam') + ' na agenda com esse nome.'
      : ' sai do turno.'),
    confirmar: 'Apagar',
    perigo: true
  });
  if (!ok) return;
  executar(apagarEquipe(String(id)));
  mostrarToast('Equipe apagada.', 'info');
}

/* ---- Modalidade ---- */
function abrirModalModalidade() {
  document.getElementById('form-modalidade').reset();
  document.getElementById('modalidade-edit-id').value = '';
  document.getElementById('cor_modalidade').value = '#E30613';
  document.getElementById('titulo-modal-modalidade').textContent = 'Nova modalidade';
  atualizarDicaModalidade();
  abrirModal('modal-modalidade');
}

function editarModalidade(id) {
  var mod = getModalidades().find(function (m) { return String(m.id) === String(id); });
  if (!mod) return;
  abrirModalModalidade();
  document.getElementById('modalidade-edit-id').value = mod.id;
  document.getElementById('nome_modalidade').value = mod.nome;
  document.getElementById('genero_modalidade').value = mod.genero;
  document.getElementById('cor_modalidade').value = mod.cor || '#E30613';
  document.getElementById('titulo-modal-modalidade').textContent = 'Editar modalidade';
  atualizarDicaModalidade();
}

function atualizarDicaModalidade() {
  var nome = valor('nome_modalidade').trim();
  var dica = document.getElementById('dica-regra-modalidade');
  if (!nome) {
    dica.innerHTML = icone('info') + '<span>Digite o nome: o placar se adapta ao esporte (gols, basquete 1/2/3 ou sets).</span>';
    return;
  }
  var regra = getRegraJogo({ modalidade: nome, regras: {} });
  dica.innerHTML = iconeEsporte(nome) + '<span><b>' + escapeHtml(regra.nome) + '</b> — ' + escapeHtml(descricaoRegra(regra)) + '</span>';
}

function salvarModalidade(e) {
  e.preventDefault();
  var id = valor('modalidade-edit-id');
  var dados = { nome: valor('nome_modalidade').trim(), genero: valor('genero_modalidade'), cor: valor('cor_modalidade') };
  if (!dados.nome) { mostrarToast('Informe o nome da modalidade.', 'erro'); return; }
  var repetida = getModalidades().some(function (m) {
    return normalizarTexto(m.nome) === normalizarTexto(dados.nome) && m.genero === dados.genero && String(m.id) !== String(id);
  });
  if (repetida) { mostrarToast('Essa modalidade já existe para esse gênero.', 'erro'); return; }
  executar(id ? atualizarModalidade(String(id), dados) : criarModalidade(dados));
  fecharTodosModais();
  mostrarToast(id ? 'Modalidade atualizada.' : 'Modalidade cadastrada.', 'sucesso');
}

async function confirmarApagarModalidade(id) {
  var mod = getModalidades().find(function (m) { return String(m.id) === String(id); });
  if (!mod) return;
  if (modalidadeEmUso(String(id))) {
    avisar('Modalidade em uso', 'Existem jogos de ' + mod.nome + ' ' + generoCurto(mod.genero) + '. Apague ou altere esses jogos antes.');
    return;
  }
  var ok = await confirmarAcao({ titulo: 'Apagar modalidade?', texto: mod.nome + ' — ' + generoLongo(mod.genero) + ' sai do turno.', confirmar: 'Apagar', perigo: true });
  if (!ok) return;
  executar(apagarModalidade(String(id)));
  mostrarToast('Modalidade apagada.', 'info');
}

/* ---- Regulamento ---- */
var ICONES_REGRA = [['clock', 'Relógio'], ['users', 'Equipe'], ['triangle', 'Atenção'], ['shirt', 'Uniforme'], ['target', 'Alvo'], ['shield', 'Escudo'], ['info', 'Info']];

function abrirModalRegulamento(nome) {
  var existente = getRegulamentos()[nome];
  var reg = existente || { visaoGeral: '', regras: [] };
  document.getElementById('regulamento-modalidade').value = nome;
  document.getElementById('reg-visao-geral').value = reg.visaoGeral || '';
  document.getElementById('titulo-modal-regulamento').textContent = (existente ? 'Editar' : 'Escrever') + ' — ' + nome;
  regraCounter = 0;
  document.getElementById('reg-regras-container').innerHTML = '';
  (reg.regras || []).forEach(function (regra) { adicionarRegraLinha(regra); });
  if (!(reg.regras || []).length) adicionarRegraLinha();
  abrirModal('modal-regulamento');
}

function adicionarRegraLinha(dados) {
  regraCounter++;
  var div = document.createElement('div');
  div.className = 'regra-linha';
  div.innerHTML =
    '<select class="reg-icone" aria-label="Ícone da regra">' + ICONES_REGRA.map(function (i) {
      return '<option value="' + i[0] + '"' + (dados && dados.icone === i[0] ? ' selected' : '') + '>' + i[1] + '</option>';
    }).join('') + '</select>' +
    '<input type="text" class="reg-titulo" placeholder="Título da regra" aria-label="Título da regra" value="' + escapeHtml(dados ? dados.titulo || '' : '') + '">' +
    '<input type="text" class="reg-descricao" placeholder="Descrição" aria-label="Descrição da regra" value="' + escapeHtml(dados ? dados.descricao || '' : '') + '">' +
    '<button type="button" class="icon-btn icon-btn--sm icon-btn--perigo" data-remover-regra aria-label="Remover regra">' + icone('fechar') + '</button>';
  document.getElementById('reg-regras-container').appendChild(div);
}

function salvarRegulamentoForm(e) {
  e.preventDefault();
  var modalidade = valor('regulamento-modalidade');
  var regras = [];
  document.querySelectorAll('#reg-regras-container .regra-linha').forEach(function (linha) {
    var titulo = linha.querySelector('.reg-titulo').value.trim();
    var descricao = linha.querySelector('.reg-descricao').value.trim();
    if (titulo && descricao) regras.push({ titulo: titulo, icone: linha.querySelector('.reg-icone').value, descricao: descricao });
  });
  fecharTodosModais();
  salvarRegulamento(modalidade, { visaoGeral: valor('reg-visao-geral').trim(), regras: regras }).then(function () {
    mostrarToast('Regulamento de ' + modalidade + ' publicado.', 'sucesso');
  }, erroAoSalvar);
}

async function confirmarApagarRegulamento(nome) {
  var ok = await confirmarAcao({ titulo: 'Excluir regulamento?', texto: 'O regulamento de ' + nome + ' sai da página pública de Modalidades.', confirmar: 'Excluir', perigo: true });
  if (!ok) return;
  apagarRegulamento(nome).then(function () { mostrarToast('Regulamento excluído.', 'info'); }, erroAoSalvar);
}

/* ---- Usuário ---- */
function abrirModalUsuario() {
  document.getElementById('form-usuario').reset();
  document.getElementById('usuario-edit-id').value = '';
  document.getElementById('titulo-modal-usuario').textContent = 'Novo usuário';
  document.getElementById('role_usuario').value = 'mesario';
  document.getElementById('categoria_usuario').value = 'ambas';
  abrirModal('modal-usuario');
}

function editarUsuario(id) {
  var user = (_db.usuarios || []).find(function (u) { return String(u.id) === String(id); });
  if (!user) return;
  abrirModalUsuario();
  document.getElementById('usuario-edit-id').value = user.id;
  document.getElementById('nome_usuario').value = user.nome || '';
  document.getElementById('email_usuario').value = user.email;
  document.getElementById('senha_usuario').value = user.senha || '';
  document.getElementById('role_usuario').value = user.role;
  document.getElementById('categoria_usuario').value = user.categoria || 'ambas';
  document.getElementById('titulo-modal-usuario').textContent = 'Editar usuário';
}

function salvarUsuarioForm(e) {
  e.preventDefault();
  var id = valor('usuario-edit-id');
  var dados = {
    nome: valor('nome_usuario').trim(),
    email: valor('email_usuario').trim(),
    senha: valor('senha_usuario'),
    role: valor('role_usuario'),
    categoria: valor('categoria_usuario')
  };
  if (!dados.email || !dados.senha) { mostrarToast('E-mail e senha são obrigatórios.', 'erro'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) { mostrarToast('Informe um e-mail válido.', 'erro'); return; }
  if (existeUsuarioComEmail(dados.email, id)) { mostrarToast('Já existe um usuário com este e-mail.', 'erro'); return; }
  var atual = getUsuarioAtual();
  var euMesmo = id && atual && String(atual.id) === String(id);
  if (euMesmo && dados.role !== 'master') { mostrarToast('Você não pode tirar o seu próprio acesso de administrador.', 'erro'); return; }
  executar(id ? atualizarUsuario(String(id), dados) : criarUsuario(dados));
  /* Trocou o próprio e-mail: a sessão acompanha para não cair no login */
  if (euMesmo) setSession(dados.email, dados.role, dados.categoria);
  fecharTodosModais();
  mostrarToast(id ? 'Usuário atualizado.' : 'Usuário criado.', 'sucesso');
}

async function confirmarApagarUsuario(id) {
  var user = (_db.usuarios || []).find(function (u) { return String(u.id) === String(id); });
  if (!user) return;
  var ok = await confirmarAcao({ titulo: 'Apagar usuário?', texto: (user.nome || user.email) + ' perde o acesso ao painel.', confirmar: 'Apagar', perigo: true });
  if (!ok) return;
  executar(apagarUsuario(String(id)));
  mostrarToast('Usuário apagado.', 'info');
}
