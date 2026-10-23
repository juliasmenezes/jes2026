/* =====================================================
   JES 2026 — creditos.js
   Rodapé com os créditos do projeto em TODAS as telas.
   Para alterar nomes ou logos, edite só o objeto abaixo.
   Logos oficiais: coloque os arquivos em img/ com estes nomes
   (se não existirem, aparece o nome em texto no lugar).
   ===================================================== */
(function () {
  'use strict';

  var CREDITOS = {
    ano: 2026,
    alunos: ['Enzo de Castro Santos', 'Gabriela Pedroso Ribeiro', 'Julia Sousa Menezes', 'Stella da Mota Xavier'],
    professores: ['Ricardo Caironi', 'André Luiz Santos Santos de Souza'],
    logos: [
      { nome: 'SESI', arquivo: 'img/logo-sesi.png' },
      { nome: 'SENAI', arquivo: 'img/logo-senai.png' }
    ]
  };

  function esc(t) {
    return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function lista(nomes) {
    if (nomes.length < 2) return esc(nomes[0] || '');
    return nomes.slice(0, -1).map(esc).join(', ') + ' e ' + esc(nomes[nomes.length - 1]);
  }

  function html() {
    var logos = CREDITOS.logos.map(function (l) {
      return '<span class="creditos__logo"><img src="' + esc(l.arquivo) + '" alt="' + esc(l.nome) + '" height="30" data-nome="' + esc(l.nome) + '"></span>';
    }).join('');
    return '<div class="creditos">' +
      '<div class="creditos__logos">' + logos + '</div>' +
      '<div class="creditos__texto">' +
        '<p><b>Desenvolvido pelos alunos</b> ' + lista(CREDITOS.alunos) + '.</p>' +
        '<p><b>Professores orientadores:</b> ' + lista(CREDITOS.professores) + '.</p>' +
        '<p class="creditos__ano">JES ' + CREDITOS.ano + ' · Jogos Estudantis SESI · © ' + CREDITOS.ano + '</p>' +
      '</div>' +
    '</div>';
  }

  /* Sem o arquivo da logo, mostra o nome da instituição em texto */
  function tratarLogosAusentes(raiz) {
    raiz.querySelectorAll('.creditos__logo img').forEach(function (img) {
      img.addEventListener('error', function () {
        var nome = document.createElement('span');
        nome.className = 'creditos__logo-texto';
        nome.textContent = img.getAttribute('data-nome');
        img.replaceWith(nome);
      });
    });
  }

  function montar() {
    var rodape = document.querySelector('.site-footer');
    var envoltorio = document.createElement('div');
    envoltorio.innerHTML = html();
    var bloco = envoltorio.firstChild;

    if (rodape) {
      var faixa = document.createElement('div');
      faixa.className = 'wrap site-footer__creditos';
      faixa.appendChild(bloco);
      rodape.appendChild(faixa);
    } else if (document.querySelector('.adm-main')) {
      var f = document.createElement('footer');
      f.className = 'site-footer site-footer--painel';
      f.appendChild(bloco);
      document.querySelector('.adm-main').appendChild(f);
    } else if (document.querySelector('.login__form')) {
      bloco.classList.add('creditos--login');
      document.querySelector('.login__form').appendChild(bloco);
    } else {
      return;
    }
    tratarLogosAusentes(bloco);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
