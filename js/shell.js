/* =====================================================
   JES 2026 — shell.js
   Moldura fixa (index.html): abre cada página do site dentro de um
   quadro e mantém o motor de som (audio.js) vivo entre as trocas de tela.
   ===================================================== */
(function () {
  'use strict';

  var PAGINAS = ['home.html', 'tabela-jogos.html', 'classificacao.html', 'modalidades.html', 'login.html', 'admin-master.html'];
  var quadro = document.getElementById('app');
  var sonda = document.getElementById('sonda-seguranca');
  var metaTema = document.querySelector('meta[name="theme-color"]');

  function destinoInicial() {
    var p = '';
    try { p = new URLSearchParams(window.location.search).get('p') || ''; } catch (e) { p = ''; }
    var arquivo = p.split(/[?#]/)[0];
    return PAGINAS.indexOf(arquivo) !== -1 ? p : 'home.html';
  }

  /* Cor do navegador e fundo acompanham o turno da página aberta */
  function aplicarTema(turno) {
    if (turno !== 'manha' && turno !== 'tarde') return;
    document.documentElement.setAttribute('data-turno', turno);
    if (metaTema) metaTema.setAttribute('content', turno === 'tarde' ? '#0B0C0F' : '#FFFFFF');
  }

  /* Dentro de um quadro o iPhone zera as áreas seguras (barra home / notch): repassa as medidas daqui */
  function repassarAreaSegura(janela) {
    try {
      var estilo = window.getComputedStyle(sonda);
      var raiz = janela.document.documentElement;
      raiz.style.setProperty('--safe-bottom', estilo.paddingBottom || '0px');
      raiz.style.setProperty('--safe-top', estilo.paddingTop || '0px');
    } catch (e) { /* sem acesso */ }
  }

  var janelaAtual = null;

  function aoCarregar() {
    var janela;
    try { janela = quadro.contentWindow; janela.location.href; } catch (e) { return; }
    janelaAtual = janela;
    var arquivo = (janela.location.pathname.split('/').pop() || 'home.html');
    if (PAGINAS.indexOf(arquivo) === -1) return;
    /* a barra de endereço mostra a página real, então recarregar ou compartilhar o link funciona */
    try { window.history.replaceState(null, '', arquivo + janela.location.search + janela.location.hash); } catch (e) { /* sem história */ }
    try { document.title = janela.document.title; } catch (e) { /* sem título */ }
    aplicarTema(janela.document.documentElement.getAttribute('data-turno'));
    repassarAreaSegura(janela);
    janela.addEventListener('jes2026-categoria-changed', function () {
      aplicarTema(janela.document.documentElement.getAttribute('data-turno'));
    });
    /* um toque dentro da página também destrava o som no navegador */
    ['pointerdown', 'keydown', 'touchend'].forEach(function (nome) {
      janela.addEventListener(nome, function () { JESAudio.destravar(); }, true);
    });
  }

  quadro.addEventListener('load', aoCarregar);
  window.addEventListener('resize', function () { if (janelaAtual) repassarAreaSegura(janelaAtual); });
  window.addEventListener('orientationchange', function () { if (janelaAtual) repassarAreaSegura(janelaAtual); });
  /* foco no quadro para o teclado funcionar de imediato */
  quadro.addEventListener('load', function () { try { quadro.contentWindow.focus(); } catch (e) { /* sem foco */ } });

  JESAudio.iniciar();
  quadro.src = destinoInicial();
})();
