/* =====================================================
   JES 2026 — audio.js  (motor de som, v2)
   Trilha sonora esportiva + efeitos dos lances

   Este arquivo roda SÓ na moldura fixa do site (index.html). As páginas
   (início, jogos, classificação, painel...) abrem dentro dela e usam este
   motor por js/som-ui.js. Como a moldura nunca recarrega, a música não
   para ao trocar de tela.

   Tudo é sintetizado na hora com Web Audio (sem arquivos, sem direitos
   autorais). Para usar gravações reais, aponte os arquivos abaixo.

   Regras do navegador: o som só começa depois de um toque da pessoa.
   Por isso tudo nasce DESLIGADO; o botão de som liga, e a escolha fica
   salva neste aparelho.
   ===================================================== */
var JESAudio = (function () {
  'use strict';

  /* ---- Arquivos opcionais (vazio = som sintetizado) ----
     Efeitos: chaves gol, cesta, ponto, set, cartao, apito, fim, valores
     Ex.: var ARQUIVO_TRILHA = 'audio/trilha.mp3';
          var ARQUIVOS_EFEITOS = { gol: 'audio/gol.mp3' }; */
  var ARQUIVO_TRILHA = '../audio/trilhaEsportes.mp3';
  var ARQUIVOS_EFEITOS = {};

  var CHAVE_PREFS = 'jes2026_audio';
  var CHAVE_EPOCH = 'jes2026_audio_epoch';

  var prefs = { musica: false, efeitos: false, volume: 0.6 };
  var ctx = null;
  var master = null;
  var compressor = null;
  var musicaFade = null;   /* fade in/out e "duck" da trilha quando há efeito */
  var musicaBus = null;    /* nível base da trilha */
  var pumpBus = null;      /* baixo, metais e pads "respiram" com o bumbo */
  var reverbEnvio = null;
  var efeitosBus = null;
  var ruido = null;
  var buffersArquivo = {};
  var elementoTrilha = null;
  var elementoSaida = null;  /* saída via <audio>: o navegador trata como mídia e mantém tocando em segundo plano */
  var streamDestino = null;
  var camaTorcida = null;
  var silenciado = false;    /* outra aba do site assumiu o som */
  var ouvintes = [];

  /* ---------- preferências ---------- */
  function lerPrefs() {
    try {
      var salvo = JSON.parse(localStorage.getItem(CHAVE_PREFS) || 'null');
      if (salvo && typeof salvo === 'object') {
        prefs.musica = Boolean(salvo.musica);
        prefs.efeitos = Boolean(salvo.efeitos);
        var v = Number(salvo.volume);
        if (!isNaN(v)) prefs.volume = Math.min(1, Math.max(0, v));
      }
    } catch (e) { /* sem persistência */ }
  }
  function gravarPrefs() {
    try { localStorage.setItem(CHAVE_PREFS, JSON.stringify(prefs)); } catch (e) { /* sem persistência */ }
  }
  function ligarAlgo() { return prefs.musica || prefs.efeitos; }

  /* ---------- contexto de áudio ---------- */
  function criarContexto() {
    if (ctx) return ctx;
    var Classe = window.AudioContext || window.webkitAudioContext;
    if (!Classe) return null;
    try { ctx = new Classe({ latencyHint: 'playback' }); } catch (e) {
      try { ctx = new Classe(); } catch (e2) { return null; }
    }
    montarGrafo({});
    ctx.onstatechange = function () { if (pronto()) aplicar(); };
    /* iOS/Safari: categoria "playback" deixa o som seguir com a tela apagada ou em segundo plano */
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* sem suporte */ }
    configurarMediaSession();
    return ctx;
  }

  function criarImpulso(segundos, curva) {
    var n = Math.floor(ctx.sampleRate * segundos);
    var buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, curva);
    }
    return buf;
  }

  function montarGrafo(opcoes) {
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = prefs.volume;
    master.connect(compressor);

    /* Saída: via <audio> (mídia de verdade, segue em segundo plano) com queda para a saída direta */
    streamDestino = null;
    elementoSaida = null;
    if (!opcoes.semElemento && ctx.createMediaStreamDestination && window.Audio) {
      try {
        streamDestino = ctx.createMediaStreamDestination();
        compressor.connect(streamDestino);
        elementoSaida = new Audio();
        elementoSaida.srcObject = streamDestino.stream;
        elementoSaida.setAttribute('playsinline', '');
        elementoSaida.setAttribute('aria-hidden', 'true');
      } catch (e) {
        streamDestino = null;
        elementoSaida = null;
      }
    }
    if (!elementoSaida) compressor.connect(ctx.destination);

    /* Trilha: fade -> (pump) -> bus -> master, com reverb de "arena" */
    musicaFade = ctx.createGain();
    musicaFade.gain.value = 0;
    musicaBus = ctx.createGain();
    musicaBus.gain.value = 0.42;
    pumpBus = ctx.createGain();
    pumpBus.gain.value = 1;
    pumpBus.connect(musicaFade);
    musicaFade.connect(musicaBus);
    musicaBus.connect(master);
    var reverb = ctx.createConvolver();
    reverb.buffer = criarImpulso(2.1, 2.6);
    reverbEnvio = ctx.createGain();
    reverbEnvio.gain.value = 0.26;
    musicaBus.connect(reverbEnvio);
    reverbEnvio.connect(reverb);
    reverb.connect(master);

    efeitosBus = ctx.createGain();
    efeitosBus.gain.value = 2.4; /* efeitos acima da trilha */
    efeitosBus.connect(master);

    /* 2 s de ruído branco, reaproveitado por torcida, chimbal, palmas e respiração do apito */
    ruido = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    var dados = ruido.getChannelData(0);
    for (var i = 0; i < dados.length; i++) dados[i] = Math.random() * 2 - 1;
  }

  function pronto() { return Boolean(ctx) && ctx.state === 'running'; }

  function ativarSaidaElemento() {
    if (!elementoSaida) return;
    var conferir = function () {
      setTimeout(function () {
        if (elementoSaida && !(elementoSaida.currentTime > 0)) voltarParaSaidaDireta();
      }, 2000);
    };
    var p = elementoSaida.play();
    if (p && p.then) p.then(conferir, voltarParaSaidaDireta);
    else conferir();
  }

  function voltarParaSaidaDireta() {
    if (!elementoSaida) return;
    try { compressor.disconnect(streamDestino); } catch (e) { /* já solto */ }
    try { compressor.connect(ctx.destination); } catch (e) { /* já ligado */ }
    try { elementoSaida.pause(); } catch (e) { /* sem elemento */ }
    elementoSaida = null;
  }

  /* Notificação do sistema / tela de bloqueio: título e play/pause */
  function configurarMediaSession() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Trilha JES 2026',
        artist: 'Jogos Estudantis SESI',
        album: 'JES 2026',
        artwork: [{ src: 'img/logo-512.png', sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.setActionHandler('play', function () { definir('musica', true); });
      navigator.mediaSession.setActionHandler('pause', function () { definir('musica', false); });
    } catch (e) { /* sem suporte */ }
  }

  /* ---------- blocos de síntese ---------- */
  function midiParaHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  /* Nota com envelope: attack linear, queda exponencial até o fim */
  function tom(destino, t, dur, freq, opts) {
    opts = opts || {};
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    var pico = opts.ganho == null ? 0.2 : opts.ganho;
    var ataque = opts.ataque == null ? 0.005 : opts.ataque;
    osc.type = opts.tipo || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.ate) osc.frequency.exponentialRampToValueAtTime(opts.ate, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(pico, t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var saida = osc;
    if (opts.passaBaixa) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.passaBaixa;
      osc.connect(f);
      saida = f;
    }
    saida.connect(g);
    g.connect(destino);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return g;
  }

  /* Rajada de ruído filtrada (torcida, palma, chimbal, "swish") */
  function rajada(destino, t, dur, opts) {
    var fonte = ctx.createBufferSource();
    fonte.buffer = ruido;
    fonte.loop = true;
    var filtro = ctx.createBiquadFilter();
    filtro.type = opts.filtro || 'bandpass';
    filtro.frequency.setValueAtTime(opts.freq || 1000, t);
    if (opts.freqFim) filtro.frequency.exponentialRampToValueAtTime(opts.freqFim, t + dur);
    filtro.Q.value = opts.q == null ? 0.7 : opts.q;
    var g = ctx.createGain();
    var pico = opts.ganho == null ? 0.2 : opts.ganho;
    var ataque = opts.ataque == null ? 0.005 : opts.ataque;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(pico, t + ataque);
    if (opts.sustenta) g.gain.setValueAtTime(pico, t + dur * opts.sustenta);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    fonte.connect(filtro);
    filtro.connect(g);
    g.connect(destino);
    fonte.start(t, Math.random() * 1.5);
    fonte.stop(t + dur + 0.05);
  }

  /* ---------- efeitos ---------- */
  function apito(destino, t, dur, freq, ganho) {
    freq = freq || 2900;
    ganho = ganho == null ? 0.16 : ganho;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    /* a "bolinha" do apito: vibrato rápido na frequência */
    var lfo = ctx.createOscillator();
    var lfoGanho = ctx.createGain();
    lfo.frequency.value = 28;
    lfoGanho.gain.value = freq * 0.035;
    lfo.connect(lfoGanho);
    lfoGanho.connect(osc.frequency);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(ganho, t + 0.012);
    g.gain.setValueAtTime(ganho, t + Math.max(0.02, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(destino);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
    rajada(destino, t, dur, { filtro: 'bandpass', freq: freq * 1.1, q: 2.5, ganho: ganho * 0.35, ataque: 0.01 });
  }

  function torcida(destino, t, dur, ganho) {
    ganho = ganho == null ? 0.3 : ganho;
    rajada(destino, t, dur, { filtro: 'bandpass', freq: 850, freqFim: 1500, q: 0.55, ganho: ganho, ataque: Math.min(0.4, dur * 0.3), sustenta: 0.45 });
    rajada(destino, t, dur * 0.9, { filtro: 'highpass', freq: 2600, q: 0.3, ganho: ganho * 0.22, ataque: Math.min(0.3, dur * 0.25), sustenta: 0.4 });
  }

  function buzina(destino, t, dur, ganho) {
    ganho = ganho == null ? 0.1 : ganho;
    [233, 293.7, 349.2].forEach(function (f) {
      tom(destino, t, dur, f, { tipo: 'sawtooth', ganho: ganho, ataque: 0.02, passaBaixa: 1400 });
    });
  }

  function sino(destino, t, freq, ganho, dur) {
    tom(destino, t, dur || 0.7, freq, { ganho: ganho == null ? 0.16 : ganho, ataque: 0.004 });
    tom(destino, t, (dur || 0.7) * 0.6, freq * 2.01, { ganho: (ganho == null ? 0.16 : ganho) * 0.35, ataque: 0.004 });
  }

  function swish(destino, t) {
    rajada(destino, t, 0.28, { filtro: 'bandpass', freq: 5200, freqFim: 1800, q: 1.2, ganho: 0.14, ataque: 0.03 });
  }

  function ping(destino, t) {
    tom(destino, t, 0.35, 988, { ganho: 0.1, ataque: 0.004 });
    tom(destino, t + 0.09, 0.45, 1319, { ganho: 0.08, ataque: 0.004 });
  }

  function palma(destino, t, ganho) {
    rajada(destino, t, 0.09, { filtro: 'bandpass', freq: 1700, q: 0.9, ganho: ganho == null ? 0.3 : ganho, ataque: 0.002 });
  }

  var EFEITOS = {
    gol: function (d, t) {
      torcida(d, t, 2.3, 0.34);
      buzina(d, t + 0.03, 0.55, 0.09);
      sino(d, t + 0.02, 1046.5, 0.07, 0.5);
    },
    cesta3: function (d, t) {
      swish(d, t);
      sino(d, t + 0.18, 784, 0.15, 0.55);
      sino(d, t + 0.3, 1174.7, 0.15, 0.7);
      torcida(d, t + 0.2, 1.1, 0.16);
    },
    cesta: function (d, t) {
      swish(d, t);
      sino(d, t + 0.2, 880, 0.15, 0.6);
      torcida(d, t + 0.2, 0.7, 0.1);
    },
    ll: function (d, t) {
      sino(d, t, 698.5, 0.12, 0.4);
    },
    ponto: function (d, t) {
      tom(d, t, 0.13, 520, { ate: 880, tipo: 'triangle', ganho: 0.16 });
      sino(d, t + 0.09, 1174.7, 0.1, 0.45);
    },
    set: function (d, t) {
      apito(d, t, 0.3, 2900, 0.12);
      [523.3, 659.3, 784, 1046.5].forEach(function (f, i) { sino(d, t + 0.35 + i * 0.1, f, 0.1, 0.6); });
      torcida(d, t + 0.35, 1.2, 0.13);
    },
    amarelo: function (d, t) { apito(d, t, 0.4, 2900, 0.14); },
    vermelho: function (d, t) {
      apito(d, t, 0.9, 3000, 0.15);
      buzina(d, t + 0.1, 0.5, 0.05);
    },
    exclusao: function (d, t) {
      apito(d, t, 0.3, 2900, 0.13);
      apito(d, t + 0.4, 0.3, 2900, 0.13);
    },
    inicio: function (d, t) {
      apito(d, t, 0.25, 2900, 0.14);
      apito(d, t + 0.4, 0.7, 2900, 0.14);
      torcida(d, t + 0.4, 1.4, 0.12);
    },
    retomada: function (d, t) { apito(d, t, 0.35, 2900, 0.13); },
    pausa: function (d, t) { apito(d, t, 0.45, 2500, 0.12); },
    fim: function (d, t) {
      apito(d, t, 0.25, 2900, 0.14);
      apito(d, t + 0.35, 0.25, 2900, 0.14);
      apito(d, t + 0.7, 0.9, 2900, 0.14);
      torcida(d, t + 0.7, 3.2, 0.26);
      for (var i = 0; i < 10; i++) palma(d, t + 1.2 + i * 0.13 + Math.random() * 0.05, 0.1);
    },
    valores: function (d, t) {
      [523.3, 659.3, 784, 1046.5].forEach(function (f, i) {
        tom(d, t + i * 0.11, 0.7, f, { tipo: 'triangle', ganho: 0.12, ataque: 0.01 });
      });
      sino(d, t + 0.5, 1568, 0.08, 0.9);
    },
    ping: function (d, t) { ping(d, t); },
    /* confirmação curta para quem opera a mesa (painel): um "ding" em vez da torcida inteira */
    confirma: function (d, t) {
      tom(d, t, 0.12, 660, { ate: 990, tipo: 'triangle', ganho: 0.14 });
      sino(d, t + 0.08, 1318.5, 0.1, 0.5);
    }
  };

  /* Evento da partida -> efeito sintetizado e chave de arquivo opcional */
  function escolherEfeito(tipo, variante) {
    if (tipo === 'ponto') {
      if (variante === 'gol') return { nome: 'gol', chave: 'gol' };
      if (variante === 'cesta3') return { nome: 'cesta3', chave: 'cesta' };
      if (variante === 'cesta') return { nome: 'cesta', chave: 'cesta' };
      if (variante === 'll') return { nome: 'll', chave: 'ponto' };
      return { nome: 'ponto', chave: 'ponto' };
    }
    if (tipo === 'set') return { nome: 'set', chave: 'set' };
    if (tipo === 'cartao') {
      if (variante === 'vermelho') return { nome: 'vermelho', chave: 'cartao' };
      if (variante === 'exclusao') return { nome: 'exclusao', chave: 'cartao' };
      return { nome: 'amarelo', chave: 'cartao' };
    }
    if (tipo === 'inicio') return { nome: 'inicio', chave: 'apito' };
    if (tipo === 'retomada') return { nome: 'retomada', chave: 'apito' };
    if (tipo === 'pausa') return { nome: 'pausa', chave: 'apito' };
    if (tipo === 'fim') return { nome: 'fim', chave: 'fim' };
    if (tipo === 'valores') return { nome: 'valores', chave: 'valores' };
    return null;
  }

  /* ---------- arquivos opcionais ---------- */
  function carregarArquivo(url) {
    if (buffersArquivo[url] !== undefined) return;
    buffersArquivo[url] = null; /* carregando */
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (dados) {
      return new Promise(function (ok, erro) { ctx.decodeAudioData(dados, ok, erro); });
    }).then(function (buffer) {
      buffersArquivo[url] = buffer;
    }).catch(function () {
      buffersArquivo[url] = false; /* indisponível: usa o som sintetizado */
    });
  }

  function tocarArquivo(url, t, ganho) {
    var buffer = buffersArquivo[url];
    if (buffer === undefined) { carregarArquivo(url); return false; }
    if (!buffer) return false;
    var fonte = ctx.createBufferSource();
    var g = ctx.createGain();
    g.gain.value = ganho;
    fonte.buffer = buffer;
    fonte.connect(g);
    g.connect(efeitosBus);
    fonte.start(t);
    return true;
  }

  /* o "duck" abaixa a trilha enquanto um efeito toca */
  function abaixarTrilha(t, dur) {
    if (!musicaFade || !musicaTocando) return;
    musicaFade.gain.cancelScheduledValues(t);
    musicaFade.gain.setTargetAtTime(0.3, t, 0.06);
    musicaFade.gain.setTargetAtTime(1, t + dur, 0.5);
  }

  function evento(tipo, variante, nivel) {
    if (!prefs.efeitos || !pronto() || silenciado) return;
    var t = ctx.currentTime + 0.02;
    if (nivel === 'leve') {
      /* fora da aba Ao vivo: um "plim" baixinho, só para pontuações e avisos */
      if (tipo === 'ponto' || tipo === 'valores') EFEITOS.ping(efeitosBus, t);
      return;
    }
    if (nivel === 'mesa' && tipo === 'ponto') {
      /* painel: confirmação curta, sem a torcida inteira a cada ponto marcado */
      EFEITOS.confirma(efeitosBus, t);
      return;
    }
    var escolha = escolherEfeito(tipo, variante);
    if (!escolha) return;
    var url = ARQUIVOS_EFEITOS[escolha.chave];
    if (url && tocarArquivo(url, t, 0.9)) { abaixarTrilha(t, 2.5); return; }
    EFEITOS[escolha.nome](efeitosBus, t);
    abaixarTrilha(t, escolha.nome === 'fim' || escolha.nome === 'gol' ? 2.6 : 1.2);
  }

  /* ---------- trilha "Arena" ----------
     16 compassos a 126 bpm, progressão C – G – Am – F (clima de hino de torcida):
       compassos 1–4   aquecimento: chimbal, palmas e bumbo entrando, riser no fim
       compassos 5–8   groove: bumbo em 4, baixo pulsante, metais em stabs, prato
       compassos 9–12  hino: melodia de metais (fanfarra) sobre pads
       compassos 13–16 clímax: melodia dobrada, mais torcida, rolo de caixa no final
     Baixo, metais e pads "respiram" com o bumbo (efeito de estádio/arena).
     Cada passo depende só do relógio (epoch): a música segue no mesmo ponto
     mesmo se o site for recarregado. */
  var BPM = 126;
  var PASSO = 60 / BPM / 4;      /* semicolcheia, em segundos */
  var COMPASSOS = 16;
  var PASSOS_LOOP = 16 * COMPASSOS;
  var ACORDES = [
    { raiz: 48, notas: [60, 64, 67], stab: [72, 76, 79] }, /* C  */
    { raiz: 43, notas: [59, 62, 67], stab: [71, 74, 79] }, /* G  */
    { raiz: 45, notas: [57, 60, 64], stab: [69, 72, 76] }, /* Am */
    { raiz: 41, notas: [57, 60, 65], stab: [69, 72, 77] }  /* F  */
  ];
  /* [passo, nota MIDI, duração em passos] */
  var MELODIA = [
    [[0, 72, 2], [3, 76, 2], [6, 79, 2], [8, 84, 4], [12, 79, 1.5], [14, 76, 2]],
    [[0, 74, 2], [3, 79, 2], [6, 83, 2], [8, 86, 4], [12, 83, 1.5], [14, 79, 2]],
    [[0, 72, 2], [3, 76, 2], [6, 81, 2], [8, 84, 4], [12, 81, 1.5], [14, 76, 2]],
    [[0, 77, 2], [3, 81, 2], [6, 84, 2], [8, 81, 3], [12, 79, 1.5], [14, 79, 2]]
  ];
  var musicaTocando = false;
  var relogio = null;
  var epoch = 0;
  var proximoPasso = 0;

  /* instrumentos da trilha */
  function bumbo(d, t) {
    tom(d, t, 0.18, 160, { ate: 48, ganho: 0.62, ataque: 0.002 });
    rajada(d, t, 0.025, { filtro: 'highpass', freq: 3000, ganho: 0.16, ataque: 0.001 });
  }
  function caixa(d, t, ganho) {
    rajada(d, t, 0.18, { filtro: 'bandpass', freq: 2400, q: 0.7, ganho: ganho * 1.3, ataque: 0.002 });
    tom(d, t, 0.11, 190, { ate: 110, tipo: 'triangle', ganho: ganho * 0.6, ataque: 0.002 });
  }
  function palmaDupla(d, t, ganho) {
    palma(d, t, ganho);
    palma(d, t + 0.011, ganho * 0.7);
  }
  function chimbal(d, t, aberto, ganho) {
    rajada(d, t, aberto ? 0.1 : 0.035, { filtro: 'highpass', freq: 7500, q: 0.3, ganho: ganho, ataque: 0.002 });
  }
  function prato(d, t, ganho) {
    rajada(d, t, 1.6, { filtro: 'highpass', freq: 5500, q: 0.3, ganho: ganho * 1.5, ataque: 0.004 });
    rajada(d, t, 0.9, { filtro: 'bandpass', freq: 9500, q: 1.2, ganho: ganho * 0.5, ataque: 0.004 });
  }
  function tomBateria(d, t, freq) {
    tom(d, t, 0.24, freq, { ate: freq * 0.55, ganho: 0.4, ataque: 0.003 });
  }
  function riser(d, t, dur) {
    rajada(d, t, dur, { filtro: 'bandpass', freq: 400, freqFim: 5500, q: 0.8, ganho: 0.2, ataque: dur * 0.96 });
  }
  /* metal: dois dentes-de-serra levemente desafinados + filtro que "abre" no ataque */
  function metal(d, t, dur, freq, ganho) {
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(freq * 1.6, t);
    f.frequency.exponentialRampToValueAtTime(Math.min(freq * 7, 9000), t + 0.05);
    f.frequency.exponentialRampToValueAtTime(freq * 2.6, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(ganho, t + 0.02);
    g.gain.setValueAtTime(ganho, t + Math.max(0.03, dur * 0.55));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    [-7, 7].forEach(function (desafina) {
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = desafina;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
    f.connect(g);
    g.connect(d);
  }
  function bombear(t) {
    pumpBus.gain.setValueAtTime(0.45, t);
    pumpBus.gain.linearRampToValueAtTime(1, t + 0.27);
  }

  function tocarPasso(indice, t) {
    var compasso = Math.floor(indice / 16) % COMPASSOS;
    var s = indice % 16;
    var secao = compasso < 4 ? 0 : compasso < 8 ? 1 : compasso < 12 ? 2 : 3;
    var acorde = ACORDES[compasso % 4];
    var d = musicaFade;
    var m = pumpBus;
    var finalDeFrase = s >= 12 && (compasso === 3 || compasso === 7 || compasso === 11);
    var rolo = compasso === 15 && s >= 8;
    var nivel = [0.75, 0.95, 1.1, 1.25][secao];

    /* bateria */
    var bumboTocando = compasso >= 2 ? (s % 4 === 0 && !(compasso === 15 && s >= 12)) : (s === 0 || s === 8);
    if (bumboTocando && !finalDeFrase) {
      bumbo(d, t);
      if (compasso >= 2) bombear(t);
    }
    if ((s === 4 || s === 12) && compasso >= 2 && !finalDeFrase && !rolo) {
      palmaDupla(d, t, (secao >= 2 ? 0.5 : 0.42) * (secao === 3 ? 1.15 : 1));
      if (secao >= 1) caixa(d, t, 0.22);
    }
    if (s % 2 === 0) {
      var aberto = secao >= 1 && s % 4 === 2;
      chimbal(d, t, aberto, (aberto ? 0.14 : 0.1) * nivel);
    } else if (secao >= 2) {
      chimbal(d, t, false, 0.05);
    }
    if (s === 0 && (compasso % 4 === 0)) prato(d, t, compasso === 0 ? 0.12 : 0.22);

    /* viradas: tons no fim das frases, riser e rolo de caixa antes do clímax / da volta */
    if (finalDeFrase) {
      tomBateria(d, t, [190, 160, 130, 100][s - 12]);
    }
    if (s === 0 && (compasso === 3 || compasso === 7 || compasso === 11 || compasso === 15)) {
      riser(d, t, 16 * PASSO);
    }
    if (rolo) {
      caixa(d, t, 0.12 + (s - 8) * 0.05);
    }

    /* torcida: ondas que crescem antes do hino e do clímax */
    if (s === 8 && (compasso === 7 || compasso === 11 || compasso === 15)) {
      torcida(d, t, 2.0, compasso === 15 ? 0.3 : 0.22);
    }

    /* baixo pulsante (a partir do 3º compasso) e nota longa no aquecimento */
    if (compasso < 2) {
      if (s === 0) tom(m, t, 16 * PASSO, midiParaHz(acorde.raiz), { tipo: 'sawtooth', ganho: 0.07, ataque: 0.05, passaBaixa: 420 });
    } else if (s % 2 === 0 && !rolo) {
      var nota = acorde.raiz + (s % 8 === 6 ? 12 : 0);
      tom(m, t, PASSO * 1.8, midiParaHz(nota), { tipo: 'sawtooth', ganho: 0.12, ataque: 0.004, passaBaixa: 700 });
    }

    /* pads sustentados */
    if (s === 0 && secao >= 1) {
      acorde.notas.forEach(function (n) {
        tom(m, t, 16 * PASSO, midiParaHz(n), { tipo: 'sawtooth', ganho: (secao >= 2 ? 0.07 : 0.05) * (secao === 3 ? 1.2 : 1), ataque: 0.3, passaBaixa: 1400 });
      });
    }

    /* metais em stabs (groove) */
    if (secao === 1 && (s === 0 || s === 3 || s === 6 || s === 10)) {
      acorde.stab.forEach(function (n) { metal(m, t, PASSO * 2.3, midiParaHz(n), 0.1); });
    }
    if (secao >= 2 && (s === 0 || s === 6)) {
      acorde.stab.forEach(function (n) { metal(m, t, PASSO * 2.3, midiParaHz(n - 12), 0.07); });
    }

    /* fanfarra */
    if (secao >= 2) {
      MELODIA[compasso % 4].forEach(function (nt) {
        if (nt[0] !== s) return;
        metal(m, t, PASSO * nt[2], midiParaHz(nt[1]), secao === 3 ? 0.17 : 0.15);
        if (secao === 3) metal(m, t, PASSO * nt[2], midiParaHz(nt[1] + 12), 0.07);
      });
    }
  }

  function lerEpoch() {
    var valor = 0;
    try { valor = Number(localStorage.getItem(CHAVE_EPOCH)) || 0; } catch (e) { /* sem persistência */ }
    if (!valor) {
      valor = Date.now() / 1000;
      try { localStorage.setItem(CHAVE_EPOCH, String(valor)); } catch (e) { /* sem persistência */ }
    }
    return valor;
  }

  /* Relógio num Worker: abas em segundo plano seguram timers comuns (1 por segundo) e a música
     travaria; timers de Worker não sofrem isso. */
  function criarRelogio(aoTic) {
    try {
      var blob = new Blob(['var t=null;onmessage=function(e){clearInterval(t);if(e.data==="start"){t=setInterval(function(){postMessage(0)},25)}}'], { type: 'text/javascript' });
      var url = URL.createObjectURL(blob);
      var w = new Worker(url);
      w.onmessage = aoTic;
      return {
        iniciar: function () { w.postMessage('start'); },
        parar: function () { w.postMessage('stop'); }
      };
    } catch (e) {
      var id = null;
      return {
        iniciar: function () { clearInterval(id); id = setInterval(aoTic, 25); },
        parar: function () { clearInterval(id); }
      };
    }
  }

  var AVANCO = 0.7; /* quanto adiantar a programação das notas, em segundos */

  function agendar() {
    if (!pronto()) return;
    var agora = Date.now() / 1000;
    var limite = agora + AVANCO;
    /* voltou de uma parada longa: recomeça do ponto atual do relógio */
    if (epoch + proximoPasso * PASSO < agora - 0.5) proximoPasso = Math.ceil((agora - epoch) / PASSO);
    while (epoch + proximoPasso * PASSO < limite) {
      var quando = epoch + proximoPasso * PASSO;
      var t = Math.max(ctx.currentTime, ctx.currentTime + (quando - agora));
      tocarPasso(proximoPasso % PASSOS_LOOP, t);
      proximoPasso++;
    }
  }

  function iniciarCamaDeTorcida() {
    if (camaTorcida) return;
    var fonte = ctx.createBufferSource();
    fonte.buffer = ruido;
    fonte.loop = true;
    var filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.value = 520;
    filtro.Q.value = 0.45;
    var g = ctx.createGain();
    g.gain.value = 0.05;
    var lfo = ctx.createOscillator();
    var lfoGanho = ctx.createGain();
    lfo.frequency.value = 0.17;
    lfoGanho.gain.value = 0.018;
    lfo.connect(lfoGanho);
    lfoGanho.connect(g.gain);
    fonte.connect(filtro);
    filtro.connect(g);
    g.connect(musicaFade);
    fonte.start();
    lfo.start();
    camaTorcida = { fonte: fonte, lfo: lfo };
  }

  function pararCamaDeTorcida() {
    if (!camaTorcida) return;
    var c = camaTorcida;
    camaTorcida = null;
    setTimeout(function () {
      try { c.fonte.stop(); c.lfo.stop(); } catch (e) { /* já parado */ }
    }, 600);
  }

  function iniciarMusica() {
    if (musicaTocando || !pronto() || silenciado) return;
    musicaTocando = true;
    var t = ctx.currentTime;
    musicaFade.gain.cancelScheduledValues(t);
    musicaFade.gain.setValueAtTime(musicaFade.gain.value, t);
    musicaFade.gain.linearRampToValueAtTime(1, t + 1.2);
    ativarSaidaElemento();
    if (ARQUIVO_TRILHA) {
      iniciarTrilhaArquivo();
      return;
    }
    iniciarCamaDeTorcida();
    epoch = lerEpoch();
    proximoPasso = Math.ceil((Date.now() / 1000 - epoch) / PASSO);
    agendar();
    if (!relogio) relogio = criarRelogio(agendar);
    relogio.iniciar();
  }

  function pararMusica() {
    if (!musicaTocando) return;
    musicaTocando = false;
    if (relogio) relogio.parar();
    pararCamaDeTorcida();
    if (elementoTrilha) elementoTrilha.pause();
    if (ctx && musicaFade) {
      var t = ctx.currentTime;
      musicaFade.gain.cancelScheduledValues(t);
      musicaFade.gain.setValueAtTime(musicaFade.gain.value, t);
      musicaFade.gain.linearRampToValueAtTime(0, t + 0.35);
    }
  }

  function iniciarTrilhaArquivo() {
    if (!elementoTrilha) {
      elementoTrilha = new Audio(ARQUIVO_TRILHA);
      elementoTrilha.loop = true;
      elementoTrilha.crossOrigin = 'anonymous';
      try { ctx.createMediaElementSource(elementoTrilha).connect(musicaFade); } catch (e) { /* toca direto */ }
    }
    var tocar = elementoTrilha.play();
    if (tocar && tocar.catch) tocar.catch(function () {
      /* arquivo ausente: cai para a trilha sintetizada */
      elementoTrilha = null;
      musicaTocando = false;
      var antigo = ARQUIVO_TRILHA;
      ARQUIVO_TRILHA = '';
      iniciarMusica();
      ARQUIVO_TRILHA = antigo;
    });
  }

  /* ---------- estado geral ---------- */
  function aplicar() {
    if (!ctx) return;
    master.gain.setTargetAtTime(prefs.volume, ctx.currentTime, 0.05);
    if (prefs.musica && pronto() && !silenciado) iniciarMusica();
    else pararMusica();
    try {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = musicaTocando ? 'playing' : 'paused';
    } catch (e) { /* sem suporte */ }
    notificar();
  }

  /* As páginas (dentro da moldura) se inscrevem para atualizar o botão de som */
  function notificar() {
    ouvintes.slice().forEach(function (cb) {
      try { cb(estado()); } catch (e) { ouvintes.splice(ouvintes.indexOf(cb), 1); }
    });
  }
  function aoMudar(cb) {
    ouvintes.push(cb);
    return function () { var i = ouvintes.indexOf(cb); if (i !== -1) ouvintes.splice(i, 1); };
  }
  function estado() {
    return { musica: prefs.musica, efeitos: prefs.efeitos, volume: prefs.volume, ligado: ligarAlgo(), tocando: musicaTocando, silenciado: silenciado };
  }

  /* ---------- várias abas do site: só uma toca por vez ---------- */
  var idAba = Math.random().toString(36).slice(2);
  var canal = null;
  try {
    canal = new BroadcastChannel('jes2026-audio');
    canal.onmessage = function (e) {
      var msg = e.data || {};
      if (msg.id === idAba) return;
      if (msg.tipo === 'dono') {
        silenciado = true;
        aplicar();
      } else if (msg.tipo === 'prefs') {
        lerPrefs();
        aplicar();
      }
    };
  } catch (e) { canal = null; }

  function reivindicar() {
    if (!ligarAlgo()) return;
    silenciado = false;
    if (canal) canal.postMessage({ tipo: 'dono', id: idAba });
  }

  /* Navegadores só liberam o som depois de um toque: a primeira interação destrava */
  function destravar() {
    if (!ligarAlgo() || !criarContexto()) return;
    var resposta = ctx.state === 'suspended' ? ctx.resume() : null;
    var concluir = function () {
      if (!pronto()) return;
      if (ligarAlgo()) reivindicar();
      aplicar();
    };
    if (resposta && resposta.then) resposta.then(concluir, function () { /* tenta no próximo toque */ });
    else concluir();
  }

  var gestoArmado = false;
  function armarDesbloqueio(janela) {
    var eventos = ['pointerdown', 'keydown', 'touchend'];
    function aoGesto() { if (pronto()) return; destravar(); }
    eventos.forEach(function (nome) { janela.addEventListener(nome, aoGesto, true); });
    gestoArmado = true;
  }

  function definir(chave, valor) {
    if (chave === 'volume') prefs.volume = Math.min(1, Math.max(0, Number(valor) || 0));
    else prefs[chave] = Boolean(valor);
    gravarPrefs();
    if (canal) canal.postMessage({ tipo: 'prefs', id: idAba });
    if (ligarAlgo() && chave !== 'volume') {
      if (criarContexto()) {
        reivindicar();
        var resposta = ctx.state === 'suspended' ? ctx.resume() : null;
        if (resposta && resposta.then) resposta.then(aplicar, aplicar);
        else aplicar();
        return;
      }
    }
    aplicar();
    notificar();
  }

  /* Primeiro toque no botão: liga tudo (e o toque também libera o som no navegador) */
  function ligarTudo() {
    prefs.musica = true;
    prefs.efeitos = true;
    gravarPrefs();
    if (canal) canal.postMessage({ tipo: 'prefs', id: idAba });
    if (!criarContexto()) { notificar(); return; }
    reivindicar();
    var resposta = ctx.state === 'suspended' ? ctx.resume() : null;
    var depois = function () {
      aplicar();
      if (pronto()) EFEITOS.ping(efeitosBus, ctx.currentTime + 0.02);
    };
    if (resposta && resposta.then) resposta.then(depois, depois);
    else depois();
  }

  /* Sem pausar ao sair da aba: a música e os efeitos seguem em segundo plano.
     Ao voltar, só garante que o contexto está rodando e retoma a vez de tocar. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !ctx) return;
    var resposta = ctx.state !== 'running' ? ctx.resume() : null;
    var concluir = function () { if (pronto() && ligarAlgo()) { reivindicar(); aplicar(); } };
    if (resposta && resposta.then) resposta.then(concluir, function () { /* aguarda toque */ });
    else concluir();
  });

  lerPrefs();

  /* Já estava ligado numa visita anterior: tenta voltar e, se o navegador exigir, espera o primeiro toque */
  function iniciar() {
    armarDesbloqueio(window);
    if (ligarAlgo() && criarContexto()) {
      var tentativa = ctx.resume();
      if (tentativa && tentativa.then) tentativa.then(function () { if (pronto()) { reivindicar(); aplicar(); } }, function () { /* espera o toque */ });
    }
  }

  return {
    iniciar: iniciar,
    estado: estado,
    definir: definir,
    ligarTudo: ligarTudo,
    aoMudar: aoMudar,
    evento: evento,
    destravar: destravar,
    /* Ganchos de teste (renderização offline e sonda de nível) */
    _teste: {
      usarContexto: function (c) { ctx = c; montarGrafo({ semElemento: true }); musicaFade.gain.value = 1; },
      passo: function (indice, t) { tocarPasso(indice, t); },
      efeito: function (nome, t) { EFEITOS[nome](efeitosBus, t); },
      nomes: function () { return Object.keys(EFEITOS); },
      passosLoop: PASSOS_LOOP,
      passoSeg: PASSO,
      sonda: function () {
        if (!ctx) return null;
        var an = ctx.createAnalyser();
        an.fftSize = 1024;
        compressor.connect(an);
        var dados = new Float32Array(an.fftSize);
        return function () {
          an.getFloatTimeDomainData(dados);
          var soma = 0;
          for (var i = 0; i < dados.length; i++) soma += dados[i] * dados[i];
          return Math.sqrt(soma / dados.length);
        };
      },
      contexto: function () { return ctx; },
      tocando: function () { return musicaTocando; },
      silenciado: function () { return silenciado; },
      passoAtual: function () { return proximoPasso; },
      saidaPorElemento: function () { return Boolean(elementoSaida); }
    }
  };
})();
