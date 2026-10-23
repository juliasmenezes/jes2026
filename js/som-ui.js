/* =====================================================
   JES 2026 — som-ui.js
   Roda em TODAS as telas (público, login, painel). Liga a página ao motor de
   som da moldura (index.html) e monta o botão de som no cabeçalho:
   trilha, efeitos e volume, também para administrador e mesários.
   ===================================================== */
(function () {
  'use strict';

  var motor = null;
  try { if (window.parent !== window && window.parent.JESAudio) motor = window.parent.JESAudio; } catch (e) { motor = null; }
  if (!motor) return; /* aberta fora da moldura: o site funciona normalmente, só sem som */
  window.JESAudio = motor;

  var controle = null;
  var desinscrever = null;

  function montar() {
    if (controle || typeof icone !== 'function') return;
    var local = document.querySelector('.site-header__acoes') || document.querySelector('.adm-top__acoes');
    var topoLogin = !local ? document.querySelector('.login__form-topo') : null;
    if (!local && !topoLogin) return;

    controle = document.createElement('div');
    controle.className = 'som-ctrl';
    controle.innerHTML =
      '<button type="button" class="icon-btn som-btn" aria-haspopup="true" aria-expanded="false" title="Som" aria-label="Som do site"></button>' +
      '<div class="som-pop" role="group" aria-label="Opções de som" hidden>' +
        '<label class="som-linha"><span>Trilha sonora</span><input type="checkbox" class="som-switch" data-som="musica"></label>' +
        '<label class="som-linha"><span>Efeitos dos lances</span><input type="checkbox" class="som-switch" data-som="efeitos"></label>' +
        '<label class="som-linha som-linha--vol"><span>Volume</span><input type="range" min="0" max="100" step="5" data-som="volume" aria-label="Volume"></label>' +
      '</div>';

    if (local) {
      var referencia = local.querySelector('a.icon-btn, .user-chip, .adm-user');
      local.insertBefore(controle, referencia || null);
    } else {
      var grupo = document.createElement('div');
      grupo.className = 'login__form-acoes';
      var turno = topoLogin.querySelector('.turno-switch');
      if (turno) grupo.appendChild(turno);
      grupo.appendChild(controle);
      topoLogin.appendChild(grupo);
    }

    var botao = controle.querySelector('.som-btn');
    var pop = controle.querySelector('.som-pop');
    function abrir(sim) {
      pop.hidden = !sim;
      botao.setAttribute('aria-expanded', String(sim));
    }
    botao.addEventListener('click', function () {
      if (!motor.estado().ligado && pop.hidden) {
        motor.ligarTudo(); /* primeiro toque: liga tudo (o toque também libera o som no navegador) */
        abrir(true);
        return;
      }
      abrir(pop.hidden);
    });
    document.addEventListener('click', function (e) {
      /* o ícone do botão é recriado ao ligar/desligar: usa o caminho do evento, não o alvo */
      if (!pop.hidden && e.composedPath().indexOf(controle) === -1) abrir(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !pop.hidden) { abrir(false); botao.focus(); }
    });
    controle.addEventListener('change', function (e) {
      var campo = e.target.getAttribute('data-som');
      if (campo === 'musica' || campo === 'efeitos') motor.definir(campo, e.target.checked);
    });
    controle.addEventListener('input', function (e) {
      if (e.target.getAttribute('data-som') === 'volume') motor.definir('volume', Number(e.target.value) / 100);
    });

    desinscrever = motor.aoMudar(atualizar);
    window.addEventListener('pagehide', function () { if (desinscrever) desinscrever(); });
    atualizar(motor.estado());
  }

  function atualizar(estado) {
    if (!controle) return;
    var botao = controle.querySelector('.som-btn');
    /* só recria o ícone se mudou: trocar o conteúdo no meio do toque cancelaria o clique */
    if (botao.getAttribute('data-icone') !== (estado.ligado ? 'som' : 'mudo')) {
      botao.setAttribute('data-icone', estado.ligado ? 'som' : 'mudo');
      botao.innerHTML = icone(estado.ligado ? 'som' : 'mudo');
    }
    botao.classList.toggle('is-ligado', estado.ligado);
    botao.setAttribute('title', estado.ligado ? 'Som ligado' : 'Som desligado');
    controle.querySelector('[data-som="musica"]').checked = estado.musica;
    controle.querySelector('[data-som="efeitos"]').checked = estado.efeitos;
    controle.querySelector('[data-som="volume"]').value = Math.round(estado.volume * 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
