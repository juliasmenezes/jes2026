/* =====================================================
   JES 2026 — login.js
   Autenticação via tabela de usuários no Firestore
   ===================================================== */

document.addEventListener('DOMContentLoaded', function () {
  initTurnoSwitch();

  var form = document.getElementById('login-form');
  if (!form) return;
  var erro = document.getElementById('login-erro');
  var submitBtn = form.querySelector('.btn-submit');
  var senhaInput = document.getElementById('senha');

  /* Já logado? Vai direto para o painel */
  if (getSession()) {
    window.location.href = 'admin-master.html';
    return;
  }

  document.getElementById('mostrar-senha').addEventListener('click', function () {
    var mostrando = senhaInput.type === 'text';
    senhaInput.type = mostrando ? 'password' : 'text';
    this.textContent = mostrando ? 'Mostrar' : 'Ocultar';
    this.setAttribute('aria-pressed', String(!mostrando));
  });

  function mostrarErro(texto) {
    erro.hidden = false;
    erro.textContent = texto;
    /* Reinicia a animação de "tremida" a cada erro */
    erro.style.animation = 'none';
    void erro.offsetWidth;
    erro.style.animation = '';
  }

  function carregando(ativo) {
    submitBtn.disabled = ativo;
    submitBtn.innerHTML = ativo ? '<span class="spinner"></span>Entrando…' : 'Entrar no painel';
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    erro.hidden = true;

    var email = document.getElementById('email').value.trim();
    var senha = senhaInput.value;

    if (!email || !senha) {
      mostrarErro('Preencha o e-mail e a senha.');
      return;
    }

    carregando(true);

    try {
      var db = window.__firebase ? window.__firebase.db : null;
      if (!db) {
        mostrarErro('Banco de dados indisponível. Verifique a conexão e tente de novo.');
        carregando(false);
        return;
      }

      var { query, where, getDocs, collection } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      var q = query(collection(db, 'usuarios'), where('email', '==', email), where('senha', '==', senha));
      var snap = await getDocs(q);

      if (snap.empty) {
        mostrarErro('E-mail ou senha incorretos.');
        carregando(false);
        return;
      }

      var userDoc = snap.docs[0].data();
      setSession(userDoc.email, userDoc.role, userDoc.categoria || 'ambas');
      if (userDoc.categoria && userDoc.categoria !== 'ambas') {
        setCategoria(userDoc.categoria);
      }
      window.location.href = 'admin-master.html';
    } catch (err) {
      mostrarErro('Erro ao conectar: ' + (err.message || 'tente novamente.'));
      carregando(false);
    }
  });
});
