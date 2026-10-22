/* =====================================================
   JES 2026 — regulamentos.js
   Regulamentos das modalidades via Firestore
   ===================================================== */

function initRegulamentos() {
  /* no-op: dados carregados via app.js _loadAllFromFirestore */
}

function getRegulamentos() {
  if (typeof window._db !== 'undefined' && window._db.regulamentos) {
    return window._db.regulamentos;
  }
  return {};
}

async function salvarRegulamento(modalidade, dados) {
  var fb = window.__firebase;
  if (!fb) return;
  var db = fb.db;
  var { collection, query, where, getDocs, updateDoc, addDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');

  var regras = (dados && Array.isArray(dados.regras)) ? dados.regras : [];
  var visaoGeral = String((dados && dados.visaoGeral) || '').trim();
  var regrasLimpar = regras.map(function (regra) {
    return { titulo: String(regra.titulo || '').trim(), icone: regra.icone || 'info', descricao: String(regra.descricao || '').trim() };
  }).filter(function (regra) { return regra.titulo && regra.descricao; });

  // Upsert: tenta update primeiro, se não existir faz insert
  var q = query(collection(db, 'modalidade_regulamentos'), where('modalidade', '==', modalidade));
  var existing = await getDocs(q);
  if (!existing.empty) {
    await updateDoc(doc(db, 'modalidade_regulamentos', existing.docs[0].id), {
      visao_geral: visaoGeral,
      regras: regrasLimpar,
      updated_at: new Date().toISOString()
    });
  } else {
    await addDoc(collection(db, 'modalidade_regulamentos'), {
      modalidade: modalidade,
      visao_geral: visaoGeral,
      regras: regrasLimpar
    });
  }

  if (typeof _db !== 'undefined') {
    _db.regulamentos[modalidade] = { visaoGeral: visaoGeral, regras: regrasLimpar };
  }
  window.dispatchEvent(new Event('jes2026-data-changed'));
}

async function apagarRegulamento(modalidade) {
  var fb = window.__firebase;
  if (!fb) return;
  var db = fb.db;
  var { collection, query, where, getDocs, deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');

  var q = query(collection(db, 'modalidade_regulamentos'), where('modalidade', '==', modalidade));
  var snap = await getDocs(q);
  for (var i = 0; i < snap.docs.length; i++) {
    await deleteDoc(snap.docs[i].ref);
  }

  if (typeof _db !== 'undefined') {
    delete _db.regulamentos[modalidade];
  }
  window.dispatchEvent(new Event('jes2026-data-changed'));
}

function getRegulamentoIcon(name) {
  const paths = {
    clock: '<circle cx="12" cy="12" r="8"></circle><path d="M12 7v5l3 2"></path>',
    users: '<circle cx="9" cy="8" r="3"></circle><path d="M3 19c.4-3 2.3-5 6-5s5.6 2 6 5"></path><path d="M16 6c2.6.2 4 1.7 4 4"></path><path d="M17 14c2.1.5 3.3 2 3.7 4"></path>',
    triangle: '<path d="M12 4l8 15H4L12 4z"></path><path d="M12 9v4"></path><circle cx="12" cy="16" r=".6" fill="currentColor" stroke="none"></circle>',
    shirt: '<path d="M8 4l4 2 4-2 4 3-2 4-2-1v10H8V10l-2 1-2-4 4-3z"></path>',
    target: '<circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1" fill="currentColor"></circle>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"></path>',
    info: '<circle cx="12" cy="12" r="8"></circle><path d="M12 11v5"></path><circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none"></circle>'
  };
  return '<svg class="regulation-icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.info) + '</svg>';
}

window.salvarRegulamento = salvarRegulamento;
window.apagarRegulamento = apagarRegulamento;
window.getRegulamentoIcon = getRegulamentoIcon;
window.getRegulamentos = getRegulamentos;
