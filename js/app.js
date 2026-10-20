import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updatePassword, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where,
  onSnapshot, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, SOLO_CON_TIROS } from "./firebase-config.js";
import { PREMIO, calcularReparto, euros } from "./payout.js";

const $app = document.getElementById("app");
const $modal = document.getElementById("modal");
const $modalBody = document.getElementById("modal-body");
const $toast = document.getElementById("toast");

if (String(firebaseConfig.apiKey).startsWith("PEGA")) {
  $app.innerHTML = `<div class="login"><div class="panel login-card prose"><h1>Falta configurar Firebase</h1>
    <p>Abre <code>js/firebase-config.js</code> y pega la configuración de tu proyecto. Tienes los pasos en el README.</p></div></div>`;
  throw new Error("Firebase sin configurar");
}

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// ------------------------------------------------------------------ Estado
const S = {
  screen: "loading",          // loading | login | app | blocked
  authUser: null, me: null, config: null, needsSetup: false, blockedMsg: "",
  users: {}, shots: {}, pending: [], pagos: {}, desempates: {},
  monthCache: {}, loadingMonths: new Set(),
  tab: "general", viewMonth: null, openMonths: new Set(),
  subs: [], monthUnsub: null, bootstrapping: false, scrolledFor: null,
  modoMovil: "semana", weekIdx: 0, weekFor: null,
};
// Pantallas estrechas (móvil): navegación inferior y tabla por semanas
const MQ = window.matchMedia("(max-width: 700px)");
const esMovil = () => MQ.matches;
MQ.addEventListener?.("change", () => render());

// ------------------------------------------------------------------ Utilidades
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const pad = n => String(n).padStart(2, "0");
const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const ymd = d => `${ym(d)}-${pad(d.getDate())}`;
const hoy = () => ymd(new Date());
const mesActual = () => ym(new Date());
const parseYM = m => m.split("-").map(Number);
const diasDelMes = m => { const [y, mo] = parseYM(m); return new Date(y, mo, 0).getDate(); };
const sumarMeses = (m, k) => { const [y, mo] = parseYM(m); return ym(new Date(y, mo - 1 + k, 1)); };
const difMeses = (a, b) => { const [ya, ma] = parseYM(a), [yb, mb] = parseYM(b); return (yb - ya) * 12 + (mb - ma); };
const nombreMes = m => { const [y, mo] = parseYM(m); const s = MESES[mo - 1]; return `${s[0].toUpperCase()}${s.slice(1)} ${y}`; };
const fechaLarga = f => { const [y, m, d] = f.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }); };
const fechaCorta = f => { const [, m, d] = f.split("-").map(Number); return `${d} ${MESES[m - 1].slice(0, 3)}`; };
const fmtTs = ts => { const d = ts?.toDate?.(); return d ? d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iniciales = n => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join("");
const nombre = uid => uid === "pizarra" ? "la pizarra" : S.users[uid]?.nombre || "Usuario eliminado";
const myUid = () => S.authUser?.uid;
const valorAcierto = s => (s.tipo === "pie" ? 5 : 1);
const puntosVerif = s => (s.resultado === "acierto" && s.verificadoPor ? valorAcierto(s) : 0);
const puntosPend = s => (s.resultado === "acierto" && !s.verificadoPor ? valorAcierto(s) : 0);
const mesCerrado = m => !!S.pagos[m]?.cerrado;
// Semanas del mes de lunes a domingo (la primera y la última pueden estar incompletas)
function semanasDelMes(m) {
  const n = diasDelMes(m), [y, mo] = parseYM(m), out = [];
  let cur = [];
  for (let d = 1; d <= n; d++) {
    cur.push(d);
    if (new Date(y, mo - 1, d).getDay() === 0 || d === n) { out.push(cur); cur = []; }
  }
  return out;
}

function toast(msg, err = false) {
  $toast.textContent = msg;
  $toast.className = "show" + (err ? " err" : "");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.className = ""), 3500);
}
function errMsg(e) {
  const c = e?.code || "";
  const map = {
    "permission-denied": "No tienes permiso para hacer esto.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/user-not-found": "No existe ningún usuario con ese correo.",
    "auth/invalid-email": "El correo no es válido.",
    "auth/email-already-in-use": "Ya existe un usuario con ese correo.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento y vuelve a probar.",
    "auth/requires-recent-login": "Vuelve a iniciar sesión para cambiar la contraseña.",
    "auth/network-request-failed": "Sin conexión. Revisa tu red.",
  };
  return map[c] || e?.message || "Algo ha fallado.";
}

// ------------------------------------------------------------------ Cálculos
function usuariosDelMes(m, tiros) {
  const conTiros = new Set(Object.values(tiros || {}).map(t => t.uid));
  return Object.values(S.users).filter(u => {
    if (conTiros.has(u.id)) return true;
    if (u.activo === false) return false;
    const alta = u.creadoEn?.toDate?.();
    return !alta || ym(alta) <= m;
  }).map(u => u.id);
}
function participantes(m, tiros) {
  const base = usuariosDelMes(m, tiros);
  if (!SOLO_CON_TIROS) return base;
  const con = new Set(Object.values(tiros || {}).map(t => t.uid));
  return base.filter(u => con.has(u));
}
function estadisticas(tiros) {
  const e = {};
  for (const t of Object.values(tiros || {})) {
    const x = (e[t.uid] ??= { puntos: 0, pend: 0 });
    x.puntos += puntosVerif(t);
    x.pend += puntosPend(t);
  }
  return e;
}
function clasificacion(m, tiros) {
  const e = estadisticas(tiros);
  const jug = participantes(m, tiros).map(uid => ({ uid, puntos: e[uid]?.puntos || 0, pend: e[uid]?.pend || 0 }));
  return calcularReparto(jug, S.desempates[m]?.ganador || null);
}
function deudasPendientes() {
  const out = [];
  for (const [m, p] of Object.entries(S.pagos)) {
    if (!p.cerrado) continue;
    for (const f of p.filas || []) if (f.importe > 0 && !p.pagado?.[f.uid]) out.push({ m, p, f });
  }
  return out.sort((a, b) => a.m.localeCompare(b.m));
}
function esMoroso(uid) {
  const cur = mesActual();
  return deudasPendientes().some(d => d.f.uid === uid && difMeses(d.m, cur) >= 2);
}
function getMonthShots(m) { return m === S.viewMonth ? S.shots : S.monthCache[m]; }
async function loadMonthShots(m, force = false) {
  if (m === S.viewMonth) return S.shots;
  if (S.monthCache[m] && !force) return S.monthCache[m];
  if (S.loadingMonths.has(m) && !force) return null;
  S.loadingMonths.add(m);
  try {
    const snap = await getDocs(query(collection(db, "tiros"), where("mes", "==", m)));
    const out = {};
    snap.forEach(d => (out[d.id] = { id: d.id, ...d.data() }));
    S.monthCache[m] = out;
    render();
    return out;
  } finally { S.loadingMonths.delete(m); }
}
function notificaciones() {
  const me = myUid();
  const porVerificar = S.pending.filter(s => s.uid !== me && !mesCerrado(s.mes) && S.users[s.uid])
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const mios = S.pending.filter(s => s.uid === me && !mesCerrado(s.mes));
  const todas = deudasPendientes();
  const debo = todas.filter(d => d.f.uid === me);
  const meDeben = todas.filter(d => d.p.ganador === me);
  const desempates = Object.entries(S.desempates)
    .filter(([m, t]) => !t.ganador && (t.candidatos || []).includes(me) && !mesCerrado(m));
  return { porVerificar, mios, debo, meDeben, desempates, total: porVerificar.length + debo.length + desempates.length };
}

// ------------------------------------------------------------------ Piezas de interfaz
const SVG = {
  tick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  ring: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
};
const KIND = {
  hit: { icon: SVG.tick, label: "Acierto verificado" },
  pend: { icon: SVG.tick, label: "Acierto sin verificar" },
  miss: { icon: SVG.cross, label: "Fallo" },
  none: { icon: SVG.ring, label: "No tirado" },
  empty: { icon: "", label: "Sin datos" },
};
function kindOf(s, fecha) {
  if (s) return s.resultado === "fallo" ? "miss" : s.verificadoPor ? "hit" : "pend";
  return fecha < hoy() ? "none" : "empty";
}
function describe(s) {
  if (!s) return "No tirado";
  if (s.resultado === "fallo") return "Fallo";
  const t = s.tipo === "pie" ? "con el pie (5 puntos)" : "con la mano (1 punto)";
  return `Acierto ${t}${s.verificadoPor ? "" : ", sin verificar"}`;
}
function avatar(uid, size = "md") {
  const u = S.users[uid] || (uid === myUid() ? S.me : {}) || {};
  const mor = esMoroso(uid);
  const inner = u.foto ? `<img src="${esc(u.foto)}" alt="">` : `<span aria-hidden="true">${esc(iniciales(u.nombre))}</span>`;
  return `<span class="avatar ${size}" title="${esc(u.nombre || "")}${mor ? " (moroso)" : ""}">${inner}${mor ? '<span class="ribbon">Moroso</span>' : ""}</span>`;
}
function shootButtons(fecha, uid = myUid()) {
  return `<div class="row shoot">
    <button class="btn hit" data-act="shoot" data-uid="${uid}" data-date="${fecha}" data-res="acierto" data-tipo="mano">Acierto con la mano</button>
    <button class="btn foot" data-act="shoot" data-uid="${uid}" data-date="${fecha}" data-res="acierto" data-tipo="pie">Acierto con el pie</button>
    <button class="btn miss" data-act="shoot" data-uid="${uid}" data-date="${fecha}" data-res="fallo">Fallo</button>
  </div>`;
}
function seqHtml(rondas = []) {
  return `<span class="seq">${rondas.map(r => `<span class="cell ${r === "acierto" ? "hit" : "miss"}" title="${r === "acierto" ? "Acierto" : "Fallo"}">${r === "acierto" ? SVG.tick : SVG.cross}</span>`).join("")}</span>`;
}

// ------------------------------------------------------------------ Vistas
function loginView() {
  if (S.needsSetup) {
    return `<div class="login"><form class="panel login-card" data-form="setup">
      <div class="brand"><img class="logo" src="img/icon-512.png" alt="" width="34" height="34">Canasta de I+D</div>
      <h2>Crea la cuenta de administrador</h2>
      <p class="muted">Es la primera vez que se abre la web. Esta cuenta podrá dar de alta al resto del equipo.</p>
      <div class="field"><label for="s-nombre">Nombre</label><input id="s-nombre" name="nombre" data-keep="s-nombre" required autocomplete="name"></div>
      <div class="field"><label for="s-email">Correo</label><input id="s-email" name="email" type="email" data-keep="s-email" required autocomplete="email"></div>
      <div class="field"><label for="s-pass">Contraseña</label><input id="s-pass" name="password" type="password" data-keep="s-pass" minlength="6" required autocomplete="new-password"></div>
      <button class="btn primary" type="submit">Crear administrador</button>
    </form></div>`;
  }
  return `<div class="login"><form class="panel login-card" data-form="login">
    <div class="brand"><img class="logo" src="img/icon-512.png" alt="" width="34" height="34">Canasta de I+D</div>
    <div class="field"><label for="l-email">Correo</label><input id="l-email" name="email" type="email" data-keep="l-email" required autocomplete="username"></div>
    <div class="field"><label for="l-pass">Contraseña</label><input id="l-pass" name="password" type="password" data-keep="l-pass" required autocomplete="current-password"></div>
    <div class="row" style="justify-content:space-between">
      <button class="btn primary" type="submit">Entrar</button>
      <button class="link" type="button" data-act="forgot">He olvidado la contraseña</button>
    </div>
  </form></div>`;
}

function shell() {
  const n = notificaciones().total;
  const tabs = [
    ["general", "Vista general", "General", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11M15 9v11"/>'],
    ["info", "Info", "Info", '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'],
    ["notif", "Notificaciones", "Avisos", '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'],
    ["premios", "Premios", "Premios", '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>'],
    ["usuarios", "Usuarios", "Usuarios", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 5.5 5"/>'],
  ];
  const views = { general: viewGeneral, info: viewInfo, notif: viewNotif, premios: viewPremios, usuarios: viewUsuarios };
  return `
  <header class="top">
    <div class="brand"><img class="logo" src="img/icon-512.png" alt="" width="34" height="34">Canasta</div>
    <div class="me">${avatar(myUid(), "sm")}<span class="me-name">${esc(S.me?.nombre)}</span>
      <button class="btn ghost small" data-act="logout">Salir</button></div>
  </header>
  <nav class="tabs" role="tablist" aria-label="Secciones">
    ${tabs.map(([k, l, c, ico]) => `<button role="tab" aria-selected="${S.tab === k}" class="tab ${S.tab === k ? "on" : ""}" data-act="tab" data-tab="${k}">
      <span class="tab-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ico}</svg>${k === "notif" && n ? `<span class="badge" aria-label="${n} pendientes">${n}</span>` : ""}</span>
      <span class="t-long">${l}</span><span class="t-short">${c}</span></button>`).join("")}
  </nav>
  <main class="main">${views[S.tab]()}</main>`;
}

// ---------- Vista general
function viewGeneral() {
  const m = S.viewMonth, cur = mesActual(), t = hoy(), me = myUid();
  const n = diasDelMes(m), [y, mo] = parseYM(m);
  const shots = S.shots;
  const st = clasificacion(m, shots);
  const e = estadisticas(shots);
  const tb = S.desempates[m];
  const showStar = !!tb || (m < cur && st.candidatos.length > 0);
  const maxPts = Math.max(0, ...Object.values(e).map(x => x.puntos));
  const rows = usuariosDelMes(m, shots).sort((a, b) =>
    (e[b]?.puntos || 0) - (e[a]?.puntos || 0) || nombre(a).localeCompare(nombre(b), "es"));
  const start = S.config?.inicio || cur;

  // En móvil, por defecto se ve una semana; con "Mes" se ve el mes entero con scroll lateral
  const semanas = semanasDelMes(m);
  if (S.weekFor !== m) {
    const di = m === cur ? Number(t.slice(8)) : null;
    S.weekIdx = di ? semanas.findIndex(w => w.includes(di)) : semanas.length - 1;
    S.weekFor = m;
  }
  S.weekIdx = Math.min(Math.max(S.weekIdx, 0), semanas.length - 1);
  const porSemana = esMovil() && S.modoMovil === "semana";
  const dias = porSemana ? semanas[S.weekIdx] : Array.from({ length: n }, (_, i) => i + 1);
  const ultimaSemana = !porSemana || S.weekIdx === semanas.length - 1;
  const starVisible = showStar && ultimaSemana;
  const abrev = MESES[mo - 1].slice(0, 3);
  const semanaNav = esMovil() ? `<div class="week-nav">
    <div class="seg" role="group" aria-label="Vista de la tabla">
      <button class="${porSemana ? "on" : ""}" data-act="modo" data-modo="semana" aria-pressed="${porSemana}">Semana</button>
      <button class="${porSemana ? "" : "on"}" data-act="modo" data-modo="mes" aria-pressed="${!porSemana}">Mes</button>
    </div>
    ${porSemana ? `<div class="week-step">
      <button class="icon-btn" data-act="week" data-k="-1" aria-label="Semana anterior" ${S.weekIdx === 0 ? "disabled" : ""}>‹</button>
      <span>${dias[0]}–${dias[dias.length - 1]} ${abrev}</span>
      <button class="icon-btn" data-act="week" data-k="1" aria-label="Semana siguiente" ${S.weekIdx === semanas.length - 1 ? "disabled" : ""}>›</button>
    </div>` : ""}
  </div>` : "";

  const head = dias.map(d => {
    const f = `${m}-${pad(d)}`, wd = new Date(y, mo - 1, d).getDay();
    return `<th scope="col" class="${f === t ? "today" : ""} ${wd === 0 || wd === 6 ? "we" : ""}" ${f === t ? 'id="col-today"' : ""}><span class="wd">${"DLMXJVS"[wd]}</span>${d}</th>`;
  }).join("");

  const body = rows.map(uid => {
    const cells = dias.map(d => {
      const i = d - 1, f = `${m}-${pad(d)}`, s = shots[`${f}_${uid}`], k = kindOf(s, f);
      const mineToday = k === "empty" && (uid === me || S.me?.admin) && f <= t && !mesCerrado(m);
      return `<td class="${f === t ? "today" : ""}"><button class="cell ${k}${mineToday ? " mine" : ""}" data-act="cell" data-uid="${uid}" data-date="${f}"
        aria-label="${esc(nombre(uid))}, día ${i + 1}: ${KIND[k].label}" ${k === "empty" && !mineToday ? "tabindex=\"-1\"" : ""}>${KIND[k].icon}${s?.tipo === "pie" && s.resultado === "acierto" ? '<span class="foot-tag">5</span>' : ""}</button></td>`;
    }).join("");
    const star = starVisible ? `<td class="star">${tb?.candidatos?.includes(uid) ? seqHtml(tb.rondas?.[uid]) : ""}</td>` : "";
    const pts = e[uid]?.puntos || 0, pend = e[uid]?.pend || 0;
    const leader = (st.ganador === uid) || (!st.ganador && pts === maxPts && pts > 0);
    return `<tr class="${leader ? "leader" : ""}"><th scope="row" class="who"><span class="who-in">${avatar(uid, "xs")}<span>${esc(nombre(uid))}</span></span></th>${cells}${star}
      <td class="pts">${pts}${pend ? `<small>+${pend}<span class="t-long"> sin verificar</span></small>` : ""}</td></tr>`;
  }).join("");

  let todayPanel = "";
  if (m === cur && S.me?.activo !== false) {
    const s = shots[`${t}_${me}`];
    todayPanel = s
      ? `<section class="panel today-panel"><div><h2>Tu tiro de hoy</h2><p>${esc(describe(s))}${s.verificadoPor ? `, verificado por ${esc(nombre(s.verificadoPor))}` : ""}</p></div>
         ${s.verificadoPor ? "" : `<button class="btn" data-act="cell" data-uid="${me}" data-date="${t}">Cambiar</button>`}</section>`
      : `<section class="panel today-panel"><div><h2>Tu tiro de hoy</h2><p class="muted">¿Cómo ha ido?</p></div>${shootButtons(t)}</section>`;
  }

  const history = Object.values(shots).sort((a, b) => b.fecha.localeCompare(a.fecha) || nombre(a.uid).localeCompare(nombre(b.uid), "es"));

  return `
  <div class="month-nav">
    <button class="icon-btn" data-act="month" data-k="-1" aria-label="Mes anterior" ${m <= start ? "disabled" : ""}>‹</button>
    <h1>${nombreMes(m)}</h1>
    <button class="icon-btn" data-act="month" data-k="1" aria-label="Mes siguiente" ${m >= cur ? "disabled" : ""}>›</button>
    ${m !== cur ? '<button class="btn small" data-act="month" data-k="0">Ir al mes en curso</button>' : ""}
    ${mesCerrado(m) ? '<span class="chip">Mes cerrado</span>' : ""}
  </div>
  ${todayPanel}
  ${semanaNav}
  <div class="grid-wrap">
    <table class="grid ${porSemana ? "week" : ""}">
      <thead><tr><th scope="col" class="who">Jugador</th>${head}${starVisible ? '<th scope="col" class="star" title="Muerte súbita">*</th>' : ""}<th scope="col" class="pts" style="font-size:1rem">Pts</th></tr></thead>
      <tbody>${body || `<tr><td colspan="${dias.length + 2}" class="muted" style="padding:1rem">Todavía no hay jugadores.</td></tr>`}</tbody>
    </table>
  </div>
  <ul class="legend">
    <li><span class="cell hit">${SVG.tick}</span>Acierto verificado</li>
    <li><span class="cell pend">${SVG.tick}</span>Acierto sin verificar</li>
    <li><span class="cell miss">${SVG.cross}</span>Fallo</li>
    <li><span class="cell none">${SVG.ring}</span>No tirado</li>
    <li><span class="cell hit" style="position:relative">${SVG.tick}<span class="foot-tag">5</span></span>Con el pie</li>
  </ul>
  <section class="panel">
    <h2>Historial de ${nombreMes(m).toLowerCase()}</h2>
    ${history.length ? `<ul class="history">${history.map(s => `<li><time datetime="${s.fecha}">${fechaCorta(s.fecha)}</time><div>
      <strong>${esc(nombre(s.uid))}</strong>: ${esc(describe(s))}.
      ${s.verificadoPor ? `<span class="muted">Verificado por ${esc(nombre(s.verificadoPor))} el ${fmtTs(s.verificadoEn)}.</span>` : ""}</div></li>`).join("")}</ul>`
      : '<p class="empty-state">Nadie ha anotado tiros este mes.</p>'}
  </section>`;
}

// ---------- Info
function formulaHtml() { return document.getElementById("tpl-formula").innerHTML; }
function viewInfo() {
  const tpl = document.createElement("div");
  tpl.innerHTML = document.getElementById("tpl-info").innerHTML;
  const slot = tpl.querySelector('[data-slot="formula"]');
  if (slot) slot.innerHTML = formulaHtml();
  return tpl.innerHTML;
}

// ---------- Notificaciones
function viewNotif() {
  const N = notificaciones();
  const verif = N.porVerificar.length
    ? `<ul class="list">${N.porVerificar.map(s => `<li>${avatar(s.uid, "sm")}<div class="grow"><strong>${esc(nombre(s.uid))}</strong><br>
        <span class="muted">${fechaLarga(s.fecha)}: acierto ${s.tipo === "pie" ? "con el pie" : "con la mano"}</span></div>
        <button class="btn hit" data-act="verify" data-id="${s.id}">Verificar</button></li>`).join("")}</ul>`
    : '<p class="empty-state">No hay aciertos de compañeros pendientes de verificar.</p>';

  const debo = N.debo.length
    ? `<ul class="list">${N.debo.map(d => `<li>${avatar(d.p.ganador, "sm")}<div class="grow">Debes <strong>${euros(d.f.importe)}</strong> a ${esc(nombre(d.p.ganador))}<br>
        <span class="muted">Almuerzo de ${nombreMes(d.m).toLowerCase()}</span></div>${difMeses(d.m, mesActual()) >= 2 ? '<span class="chip warn">Moroso</span>' : '<span class="chip">Pendiente</span>'}</li>`).join("")}</ul>`
    : "";
  const meDeben = N.meDeben.length
    ? `<ul class="list">${N.meDeben.map(d => `<li>${avatar(d.f.uid, "sm")}<div class="grow">${esc(nombre(d.f.uid))} te debe <strong>${euros(d.f.importe)}</strong><br>
        <span class="muted">Almuerzo de ${nombreMes(d.m).toLowerCase()}</span></div>
        <button class="btn small" data-act="toggle-paid" data-month="${d.m}" data-uid="${d.f.uid}">Marcar como pagado</button></li>`).join("")}</ul>`
    : "";
  const tb = N.desempates.length
    ? `<ul class="list">${N.desempates.map(([m]) => `<li><div class="grow">Estás en la muerte súbita de <strong>${nombreMes(m).toLowerCase()}</strong>.</div>
        <button class="btn small" data-act="goto-premios" data-month="${m}">Ver en Premios</button></li>`).join("")}</ul>` : "";
  const mios = N.mios.length
    ? `<p class="muted">Tienes ${N.mios.length} acierto${N.mios.length > 1 ? "s" : ""} esperando a que alguien ${N.mios.length > 1 ? "los" : "lo"} verifique: ${N.mios.map(s => fechaCorta(s.fecha)).join(", ")}.</p>` : "";

  return `
  <section class="panel"><h1>Tiros por verificar</h1>${verif}${mios}</section>
  ${tb ? `<section class="panel"><h2>Muerte súbita</h2>${tb}</section>` : ""}
  <section class="panel"><h2>Pagos pendientes</h2>
    ${debo || meDeben ? `${debo}${meDeben}` : '<p class="empty-state">No debes nada y nadie te debe nada.</p>'}
  </section>`;
}

// ---------- Premios
function viewPremios() {
  const cur = mesActual();
  let start = S.config?.inicio || cur;
  for (const m of Object.keys(S.pagos)) if (m < start) start = m;
  const months = [];
  for (let m = cur; m >= start; m = sumarMeses(m, -1)) months.push(m);
  return `
  <h1>Premios</h1>
  ${months.map(premioMes).join("")}`;
}
function premioMes(m) {
  const p = S.pagos[m], open = S.openMonths.has(m), cur = mesActual();
  let right, body = "";
  if (p?.cerrado) {
    const pend = (p.filas || []).filter(f => f.importe > 0 && !p.pagado?.[f.uid]);
    right = `<span class="sum-winner">${avatar(p.ganador, "xs")} Ganador: <strong style="color:var(--ink)">${esc(nombre(p.ganador))}</strong></span>
      ${pend.length ? `<span class="chip warn">Pendiente de pago (${pend.length})</span>` : '<span class="chip ok">Pagado</span>'}`;
    if (open) body = mesCerradoBody(m, p);
  } else {
    right = `<span class="sum-winner">${m === cur ? "En juego" : "Sin cerrar"}</span><span class="chip info">Provisional</span>`;
    if (open) body = mesAbiertoBody(m);
  }
  return `<details class="month" data-month="${m}" ${open ? "open" : ""}>
    <summary><h2>${nombreMes(m)}</h2>${right}</summary>
    <div class="month-body">${body}</div></details>`;
}
function tablaReparto(filas, opts = {}) {
  const { pagos = null, m = null, puedeMarcar = false } = opts;
  return `<div class="table-scroll"><table class="mini stack">
    <thead><tr><th scope="col">Puesto</th><th scope="col">Jugador</th><th scope="col" class="num">Puntos</th><th scope="col" class="num">Paga</th>${pagos ? '<th scope="col">Estado</th>' : ""}</tr></thead>
    <tbody>${filas.map(f => {
      const pagado = pagos?.pagado?.[f.uid];
      let estado = "";
      if (pagos) {
        if (f.esGanador || !(f.importe > 0)) estado = f.esGanador ? '<span class="chip ok">Gana el almuerzo</span>' : "";
        else estado = `${pagado ? `<span class="chip ok">Pagado</span>` : `<span class="chip warn">Pendiente</span>`}
          ${puedeMarcar ? `<button class="btn small ghost" data-act="toggle-paid" data-month="${m}" data-uid="${f.uid}">${pagado ? "Desmarcar" : "Marcar como pagado"}</button>` : ""}`;
      }
      return `<tr><td class="c-puesto">${f.puesto}º${f.empatado ? '<span class="t-long"> (empate)</span><span class="t-short">=</span>' : ""}</td>
        <td class="c-jug"><span class="who-in">${avatar(f.uid, "xs")}<span>${esc(nombre(f.uid))}</span></span></td>
        <td class="num c-pts">${f.puntos}${f.pend ? ` <span class="muted">(+${f.pend})</span>` : ""}<span class="t-short"> pts</span></td>
        <td class="num c-paga">${f.esGanador ? "—" : f.importe == null ? "?" : euros(f.importe)}</td>${pagos ? `<td class="c-estado">${estado}</td>` : ""}</tr>`;
    }).join("")}</tbody>
  </table></div>`;
}
function mesCerradoBody(m, p) {
  const filas = (p.filas || []).map(f => ({ ...f, esGanador: f.uid === p.ganador }));
  // marcar empates
  const cnt = {}; filas.forEach(f => (cnt[f.puesto] = (cnt[f.puesto] || 0) + 1));
  filas.forEach(f => (f.empatado = cnt[f.puesto] > 1 && !f.esGanador));
  const puede = S.me?.admin || p.ganador === myUid();
  return `${tablaReparto(filas, { pagos: p, m, puedeMarcar: puede })}
    <p class="muted">Mes cerrado por ${esc(nombre(p.cerradoPor))} el ${fmtTs(p.cerradoEn)}. ${puede ? "" : "Solo el ganador o un administrador puede marcar los pagos."}</p>
    ${S.me?.admin ? `<button class="btn small danger" data-act="reopen-month" data-month="${m}">Reabrir mes</button>` : ""}`;
}
function mesAbiertoBody(m) {
  const cur = mesActual();
  const shots = getMonthShots(m);
  if (!shots) { loadMonthShots(m); return '<p class="muted">Cargando…</p>'; }
  const st = clasificacion(m, shots);
  if (!st.filas.length) return '<p class="empty-state">No hay participantes este mes.</p>';
  const pendientes = Object.values(shots).filter(s => s.pendiente).length;
  let html = "";
  if (m === cur) html += '<p class="muted">El mes sigue en juego: la clasificación y los importes son provisionales.</p>';
  if (pendientes) html += `<p><span class="chip warn">${pendientes} acierto${pendientes > 1 ? "s" : ""} sin verificar</span> No cuentan hasta que alguien los verifique.</p>`;
  if (st.candidatos.length && m < cur) html += desempateHtml(m, st);
  else if (st.candidatos.length) html += `<p class="muted">Ahora mismo hay empate en cabeza. Si sigue así a final de mes, habrá muerte súbita.</p>`;
  html += tablaReparto(st.filas);
  if (m < cur && S.me?.admin) {
    html += st.ganador
      ? `<button class="btn primary" data-act="close-month" data-month="${m}">Cerrar mes y fijar pagos</button>`
      : '<p class="muted">Para cerrar el mes hay que proclamar antes al vencedor de la muerte súbita.</p>';
  } else if (m < cur) {
    html += '<p class="muted">Un administrador tiene que cerrar el mes para fijar los pagos.</p>';
  }
  return html;
}
function desempateHtml(m, st) {
  const tb = S.desempates[m];
  const pts = st.filas.find(f => st.candidatos.includes(f.uid))?.puntos ?? 0;
  const names = st.candidatos.map(nombre).map(esc).join(", ");
  if (!tb) {
    return `<div class="tb"><h3>Muerte súbita</h3><p>Empate a ${pts} puntos entre ${names}. Se desempata con muerte súbita.</p>
      <button class="btn primary" data-act="tb-start" data-month="${m}">Empezar muerte súbita</button></div>`;
  }
  const rows = (tb.candidatos || []).map(uid => `<li>${avatar(uid, "sm")}<div class="grow"><strong>${esc(nombre(uid))}</strong><br>${seqHtml(tb.rondas?.[uid])}</div>
    ${tb.ganador ? (tb.ganador === uid ? '<span class="chip ok">Vencedor</span>' : "") : `<div class="row">
      <button class="btn small hit" data-act="tb-add" data-month="${m}" data-uid="${uid}" data-res="acierto" aria-label="Acierto de ${esc(nombre(uid))}">Acierto</button>
      <button class="btn small miss" data-act="tb-add" data-month="${m}" data-uid="${uid}" data-res="fallo" aria-label="Fallo de ${esc(nombre(uid))}">Fallo</button>
      <button class="btn small ghost" data-act="tb-undo" data-month="${m}" data-uid="${uid}">Deshacer</button>
      <button class="btn small" data-act="tb-winner" data-month="${m}" data-uid="${uid}">Proclamar vencedor</button></div>`}</li>`).join("");
  const changed = st.candidatos.length !== (tb.candidatos || []).length || st.candidatos.some(c => !tb.candidatos.includes(c));
  return `<div class="tb"><h3>Muerte súbita</h3>
    ${changed ? '<p><span class="chip warn">Los candidatos han cambiado</span> Algún tiro se ha verificado después de empezar. Un administrador puede reiniciar la muerte súbita.</p>' : ""}
    <ul class="list">${rows}</ul>
    ${S.me?.admin ? `<button class="btn small danger" data-act="tb-reset" data-month="${m}">Reiniciar muerte súbita</button>` : ""}</div>`;
}

// ---------- Usuarios
function viewUsuarios() {
  const me = S.me || {};
  const list = Object.values(S.users).sort((a, b) => (a.activo === false) - (b.activo === false) || a.nombre.localeCompare(b.nombre, "es"));
  const team = list.map(u => {
    const mor = esMoroso(u.id);
    const chips = [u.admin ? '<span class="chip info">Admin</span>' : "", u.activo === false ? '<span class="chip">Desactivado</span>' : "", mor ? '<span class="chip warn">Moroso</span>' : ""].join(" ");
    const actions = me.admin && u.id !== myUid() ? `<div class="row">
      <button class="btn small" data-act="user-admin" data-uid="${u.id}">${u.admin ? "Quitar admin" : "Hacer admin"}</button>
      <button class="btn small ${u.activo === false ? "" : "danger"}" data-act="user-active" data-uid="${u.id}">${u.activo === false ? "Reactivar" : "Desactivar"}</button></div>` : "";
    return `<li>${avatar(u.id, "md")}<div class="grow"><strong>${esc(u.nombre)}</strong> ${chips}<br><span class="muted">${esc(u.email || "")}</span></div>${actions}</li>`;
  }).join("");

  return `
  <section class="panel"><h1>Tu perfil</h1>
    <form data-form="profile">
      <div class="row" style="gap:1.2rem;align-items:flex-start">
        ${avatar(myUid(), "lg")}
        <div style="flex:1 1 16rem">
          <div class="field"><label for="p-nombre">Nombre</label><input id="p-nombre" name="nombre" data-keep="p-nombre" value="${esc(me.nombre)}" required></div>
          <div class="field"><label for="p-foto">Foto de perfil</label><input id="p-foto" name="foto" type="file" accept="image/*"></div>
          <div class="row"><button class="btn primary" type="submit">Guardar perfil</button>
          ${me.foto ? '<button class="btn ghost" type="button" data-act="remove-photo">Quitar foto</button>' : ""}</div>
        </div>
      </div>
    </form>
  </section>
  <section class="panel"><h2>Cambiar contraseña</h2>
    <form data-form="password" class="form-grid">
      <div class="field"><label for="pw-old">Contraseña actual</label><input id="pw-old" name="actual" type="password" data-keep="pw-old" required autocomplete="current-password"></div>
      <div class="field"><label for="pw-new">Nueva contraseña</label><input id="pw-new" name="nueva" type="password" data-keep="pw-new" minlength="6" required autocomplete="new-password"></div>
      <div><button class="btn primary" type="submit">Cambiar contraseña</button></div>
    </form>
  </section>
  ${me.admin ? `<section class="panel"><h2>Dar de alta a un usuario</h2>
    <form data-form="create-user" class="form-grid">
      <div class="field"><label for="c-nombre">Nombre</label><input id="c-nombre" name="nombre" data-keep="c-nombre" required></div>
      <div class="field"><label for="c-email">Correo</label><input id="c-email" name="email" type="email" data-keep="c-email" required autocomplete="off"></div>
      <div class="field"><label for="c-pass">Contraseña inicial</label><input id="c-pass" name="password" type="text" data-keep="c-pass" minlength="6" required autocomplete="off"></div>
      <div><button class="btn primary" type="submit">Dar de alta</button></div>
    </form>
    <p class="muted">Pásale la contraseña inicial a la persona; podrá cambiarla desde esta pestaña.</p>
  </section>` : ""}
  <section class="panel"><h2>Equipo</h2><ul class="list">${team}</ul></section>`;
}

// ------------------------------------------------------------------ Render
function render() {
  // Conservar lo que se esté escribiendo y el scroll de la tabla
  const keep = {};
  $app.querySelectorAll("[data-keep]").forEach(el => (keep[el.dataset.keep] = el.value));
  const active = document.activeElement?.dataset?.keep;
  const selStart = document.activeElement?.selectionStart;
  const wrap = $app.querySelector(".grid-wrap");
  const sl = wrap ? wrap.scrollLeft : null;

  if (S.screen === "loading") $app.innerHTML = '<p class="boot">Cargando…</p>';
  else if (S.screen === "login") $app.innerHTML = loginView();
  else if (S.screen === "blocked") $app.innerHTML = `<div class="login"><div class="panel login-card"><h2>No puedes entrar</h2><p>${esc(S.blockedMsg)}</p><button class="btn" data-act="logout">Salir</button></div></div>`;
  else $app.innerHTML = shell();

  $app.querySelectorAll("[data-keep]").forEach(el => {
    if (keep[el.dataset.keep] != null && el.type !== "file") el.value = keep[el.dataset.keep];
    if (active && el.dataset.keep === active) { el.focus(); try { el.setSelectionRange(selStart, selStart); } catch {} }
  });
  const w2 = $app.querySelector(".grid-wrap");
  if (w2) {
    if (S.scrolledFor === S.viewMonth && sl != null) w2.scrollLeft = sl;
    else {
      const col = w2.querySelector("#col-today");
      if (col) w2.scrollLeft = Math.max(0, col.offsetLeft - w2.clientWidth / 2);
      S.scrolledFor = S.viewMonth;
    }
  }
}

// ------------------------------------------------------------------ Sesión y datos en tiempo real
function stopSubs() {
  S.subs.forEach(u => u()); S.subs = [];
  S.monthUnsub?.(); S.monthUnsub = null;
}
function onErr(e) { console.error(e); toast(errMsg(e), true); }

function subscribeMonth() {
  S.monthUnsub?.();
  const m = S.viewMonth;
  S.shots = S.monthCache[m] || {};
  S.monthUnsub = onSnapshot(query(collection(db, "tiros"), where("mes", "==", m)), snap => {
    const out = {};
    snap.forEach(d => (out[d.id] = { id: d.id, ...d.data() }));
    if (m !== S.viewMonth) return;
    S.shots = out; S.monthCache[m] = out;
    render();
  }, onErr);
}

async function startSession(user) {
  stopSubs();
  S.authUser = user; S.screen = "loading"; render();
  const meSnap = await getDoc(doc(db, "usuarios", user.uid));
  if (!meSnap.exists()) { S.screen = "blocked"; S.blockedMsg = "Tu cuenta no tiene perfil en la web. Pide a un administrador que te dé de alta."; return render(); }
  if (meSnap.data().activo === false) { S.screen = "blocked"; S.blockedMsg = "Tu cuenta está desactivada. Habla con un administrador."; return render(); }
  S.me = { id: user.uid, ...meSnap.data() };
  S.config = (await getDoc(doc(db, "config", "app"))).data() || {};
  S.viewMonth = mesActual();

  S.subs.push(onSnapshot(collection(db, "usuarios"), snap => {
    S.users = {};
    snap.forEach(d => (S.users[d.id] = { id: d.id, ...d.data() }));
    S.me = S.users[user.uid] || S.me;
    if (S.me.activo === false) { S.screen = "blocked"; S.blockedMsg = "Tu cuenta está desactivada. Habla con un administrador."; stopSubs(); }
    render();
  }, onErr));
  S.subs.push(onSnapshot(collection(db, "pagos"), snap => {
    S.pagos = {}; snap.forEach(d => (S.pagos[d.id] = d.data())); render();
  }, onErr));
  S.subs.push(onSnapshot(collection(db, "desempates"), snap => {
    S.desempates = {}; snap.forEach(d => (S.desempates[d.id] = d.data())); render();
  }, onErr));
  S.subs.push(onSnapshot(query(collection(db, "tiros"), where("pendiente", "==", true)), snap => {
    S.pending = []; snap.forEach(d => S.pending.push({ id: d.id, ...d.data() }));
    for (const k of Object.keys(S.monthCache)) if (k !== S.viewMonth) delete S.monthCache[k];
    render();
  }, onErr));
  subscribeMonth();
  S.screen = "app";
  render();
}

onAuthStateChanged(auth, async user => {
  if (S.bootstrapping) return;
  if (!user) {
    stopSubs();
    Object.assign(S, { authUser: null, me: null, users: {}, shots: {}, pending: [], pagos: {}, desempates: {}, monthCache: {} });
    try { S.needsSetup = !(await getDoc(doc(db, "config", "app"))).exists(); } catch { S.needsSetup = false; }
    S.screen = "login"; render(); return;
  }
  try { await startSession(user); } catch (e) { onErr(e); }
});

// ------------------------------------------------------------------ Acciones
async function shoot(fecha, resultado, tipo, uid = myUid()) {
  const id = `${fecha}_${uid}`, m = fecha.slice(0, 7);
  const prev = getMonthShots(m)?.[id];
  if (prev?.verificadoPor) return toast("Este tiro ya está verificado y no se puede cambiar.", true);
  if (fecha > hoy()) return toast("No puedes anotar un tiro de un día que aún no ha llegado.", true);
  await setDoc(doc(db, "tiros", id), {
    uid, fecha, mes: m, resultado,
    tipo: resultado === "acierto" ? tipo : null,
    pendiente: resultado === "acierto",
    verificadoPor: null, verificadoEn: null,
    creadoEn: serverTimestamp(),
    ...(uid !== myUid() ? { anotadoPor: myUid() } : {}),
  });
  toast(resultado === "acierto" ? "Acierto anotado. Falta que alguien lo verifique." : "Fallo anotado.");
}
async function verify(id) {
  await updateDoc(doc(db, "tiros", id), { verificadoPor: myUid(), verificadoEn: serverTimestamp(), pendiente: false });
  toast("Tiro verificado.");
}
function openCell(uid, fecha) {
  const m = fecha.slice(0, 7), id = `${fecha}_${uid}`;
  const s = getMonthShots(m)?.[id];
  const mine = uid === myUid();
  const editable = fecha <= hoy() && !mesCerrado(m);
  const k = kindOf(s, fecha);
  const puedeEditar = (mine || S.me?.admin) && editable;
  if (k === "empty" && !puedeEditar) return;
  let html = `<div class="row" style="gap:.8rem">${avatar(uid, "md")}<div><h2 style="margin:0">${esc(nombre(uid))}</h2><p class="muted" style="margin:0">${fechaLarga(fecha)}</p></div></div>
    <p style="margin-top:1rem"><span class="cell ${k}" style="display:inline-grid;vertical-align:middle;margin-right:.4rem">${KIND[k].icon}</span><strong>${esc(s ? describe(s) : k === "none" ? "No tirado" : "Sin anotar todavía")}</strong></p>`;
  if (s?.verificadoPor) html += `<p>Verificado por <strong>${esc(nombre(s.verificadoPor))}</strong> el ${fmtTs(s.verificadoEn)}.</p>`;
  if (s?.creadoEn) html += `<p class="muted">Anotado el ${fmtTs(s.creadoEn)}${s.anotadoPor ? ` por ${esc(nombre(s.anotadoPor))}` : ""}.</p>`;
  const acts = [];
  if (puedeEditar && !s?.verificadoPor) {
    const quien = mine ? "tu tiro" : `el tiro de ${esc(nombre(uid))}`;
    html += `<p style="margin-top:1rem"><strong>${s ? "Cambiar" : "Anotar"} ${quien}</strong></p>${shootButtons(fecha, uid)}`;
    if (s) acts.push(`<button class="btn danger" data-act="delete-shot" data-id="${id}">Borrar tiro</button>`);
  }
  if (!mine && s?.pendiente && editable) acts.push(`<button class="btn hit" data-act="verify" data-id="${id}">Verificar acierto</button>`);
  if (S.me?.admin && s?.verificadoPor) acts.push(`<button class="btn danger" data-act="delete-shot" data-id="${id}">Borrar tiro (admin)</button>`);
  acts.push('<button class="btn ghost" data-act="modal-close">Cerrar</button>');
  html += `<div class="modal-actions">${acts.join("")}</div>`;
  $modalBody.innerHTML = html;
  if (!$modal.open) $modal.showModal();
}
async function fileToAvatar(file) {
  const bmp = await createImageBitmap(file);
  const size = 192, side = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.82);
}
async function closeMonth(m) {
  const shots = await loadMonthShots(m, true);
  const st = clasificacion(m, shots);
  if (st.pendienteDesempate) return toast("Antes hay que proclamar al vencedor de la muerte súbita.", true);
  if (!st.ganador) return toast("No hay participantes este mes.", true);
  const pend = Object.values(shots).filter(s => s.pendiente).length;
  if (!confirm(`¿Cerrar ${nombreMes(m).toLowerCase()}?${pend ? ` Hay ${pend} acierto(s) sin verificar que no contarán.` : ""} Después no se podrán anotar ni verificar tiros de ese mes.`)) return;
  const filas = st.filas.map(f => ({ uid: f.uid, puntos: f.puntos, puesto: f.puesto, importe: f.importe }));
  const pagado = {};
  filas.forEach(f => { if (f.importe > 0) pagado[f.uid] = false; });
  await setDoc(doc(db, "pagos", m), {
    cerrado: true, ganador: st.ganador, premio: PREMIO, filas, pagado, pagadoEn: {},
    cerradoPor: myUid(), cerradoEn: serverTimestamp(),
  });
  toast(`${nombreMes(m)} cerrado. Gana ${nombre(st.ganador)}.`);
}

document.addEventListener("click", async e => {
  if (e.target === $modal) return $modal.close();
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const d = b.dataset;
  try {
    switch (d.act) {
      case "tab": S.tab = d.tab; render(); window.scrollTo(0, 0); break;
      case "logout": stopSubs(); await signOut(auth); break;
      case "month": {
        const k = Number(d.k);
        S.viewMonth = k === 0 ? mesActual() : sumarMeses(S.viewMonth, k);
        subscribeMonth(); render(); break;
      }
      case "modo": S.modoMovil = d.modo; S.scrolledFor = null; render(); break;
      case "week": S.weekIdx += Number(d.k); render(); break;
      case "shoot": $modal.open && $modal.close(); await shoot(d.date, d.res, d.tipo, d.uid || myUid()); break;
      case "cell": openCell(d.uid, d.date); break;
      case "verify": $modal.open && $modal.close(); await verify(d.id); break;
      case "delete-shot":
        if (!confirm("¿Borrar este tiro?")) break;
        await deleteDoc(doc(db, "tiros", d.id)); $modal.close(); toast("Tiro borrado."); break;
      case "modal-close": $modal.close(); break;
      case "goto-premios": S.tab = "premios"; S.openMonths.add(d.month); render(); break;
      case "toggle-paid": {
        const p = S.pagos[d.month]; const now = !p?.pagado?.[d.uid];
        await updateDoc(doc(db, "pagos", d.month), { [`pagado.${d.uid}`]: now, [`pagadoEn.${d.uid}`]: now ? serverTimestamp() : null });
        toast(now ? `Pago de ${nombre(d.uid)} marcado.` : "Pago desmarcado."); break;
      }
      case "close-month": await closeMonth(d.month); break;
      case "reopen-month":
        if (!confirm("¿Reabrir el mes? Se borrará el reparto fijado y el estado de los pagos.")) break;
        await deleteDoc(doc(db, "pagos", d.month)); toast("Mes reabierto."); break;
      case "tb-start": {
        const st = clasificacion(d.month, await loadMonthShots(d.month));
        const rondas = {}; st.candidatos.forEach(u => (rondas[u] = []));
        await setDoc(doc(db, "desempates", d.month), { candidatos: st.candidatos, rondas, ganador: null, creadoEn: serverTimestamp() });
        break;
      }
      case "tb-add": case "tb-undo": {
        const cur = S.desempates[d.month]?.rondas?.[d.uid] || [];
        const next = d.act === "tb-add" ? [...cur, d.res] : cur.slice(0, -1);
        await updateDoc(doc(db, "desempates", d.month), { [`rondas.${d.uid}`]: next }); break;
      }
      case "tb-winner":
        if (!confirm(`¿Proclamar a ${nombre(d.uid)} vencedor de ${nombreMes(d.month).toLowerCase()}?`)) break;
        await updateDoc(doc(db, "desempates", d.month), { ganador: d.uid }); break;
      case "tb-reset":
        if (!confirm("¿Reiniciar la muerte súbita? Se borrarán sus tiros y el vencedor.")) break;
        await deleteDoc(doc(db, "desempates", d.month)); break;
      case "user-admin": {
        const u = S.users[d.uid];
        await updateDoc(doc(db, "usuarios", d.uid), { admin: !u.admin }); break;
      }
      case "user-active": {
        const u = S.users[d.uid]; const activo = u.activo === false;
        if (!activo && !confirm(`¿Desactivar a ${u.nombre}? No podrá entrar ni aparecerá en los meses nuevos. Sus datos se conservan.`)) break;
        await updateDoc(doc(db, "usuarios", d.uid), { activo }); break;
      }
      case "remove-photo": await updateDoc(doc(db, "usuarios", myUid()), { foto: null }); toast("Foto quitada."); break;
      case "forgot": {
        const email = $app.querySelector("#l-email")?.value.trim();
        if (!email) { toast("Escribe tu correo y vuelve a pulsar.", true); break; }
        await sendPasswordResetEmail(auth, email);
        toast("Te hemos enviado un correo para cambiar la contraseña."); break;
      }
    }
  } catch (err) { onErr(err); }
});

document.addEventListener("toggle", e => {
  const el = e.target;
  if (!el.matches?.("details.month")) return;
  const m = el.dataset.month;
  if (el.open && !S.openMonths.has(m)) { S.openMonths.add(m); render(); }
  else if (!el.open && S.openMonths.has(m)) { S.openMonths.delete(m); render(); }
}, true);

document.addEventListener("submit", async e => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('[type="submit"]');
  if (btn) btn.disabled = true;
  const v = n => f.elements[n]?.value?.trim?.() ?? "";
  try {
    switch (f.dataset.form) {
      case "login":
        await signInWithEmailAndPassword(auth, v("email"), f.elements.password.value);
        break;
      case "setup": {
        S.bootstrapping = true;
        try {
          const cred = await createUserWithEmailAndPassword(auth, v("email"), f.elements.password.value);
          const batch = writeBatch(db);
          batch.set(doc(db, "usuarios", cred.user.uid), {
            nombre: v("nombre"), email: v("email").toLowerCase(), admin: true, activo: true, foto: null, creadoEn: serverTimestamp(),
          });
          batch.set(doc(db, "config", "app"), { inicio: mesActual(), creadoEn: serverTimestamp() });
          await batch.commit();
          S.bootstrapping = false;
          await startSession(cred.user);
        } finally { S.bootstrapping = false; }
        break;
      }
      case "create-user": {
        // Se usa una segunda instancia de Firebase para no cerrar la sesión del administrador.
        const sec = initializeApp(firebaseConfig, "alta-" + Date.now());
        try {
          const secAuth = getAuth(sec);
          const cred = await createUserWithEmailAndPassword(secAuth, v("email"), f.elements.password.value);
          await setDoc(doc(db, "usuarios", cred.user.uid), {
            nombre: v("nombre"), email: v("email").toLowerCase(), admin: false, activo: true, foto: null, creadoEn: serverTimestamp(),
          });
          await signOut(secAuth);
        } finally { await deleteApp(sec); }
        toast(`${v("nombre")} ya puede entrar.`);
        f.querySelectorAll("[data-keep]").forEach(i => (i.value = ""));
        break;
      }
      case "profile": {
        const data = { nombre: v("nombre") };
        const file = f.elements.foto.files[0];
        if (file) data.foto = await fileToAvatar(file);
        await updateDoc(doc(db, "usuarios", myUid()), data);
        toast("Perfil guardado.");
        break;
      }
      case "password": {
        const cred = EmailAuthProvider.credential(auth.currentUser.email, f.elements.actual.value);
        await reauthenticateWithCredential(auth.currentUser, cred);
        await updatePassword(auth.currentUser, f.elements.nueva.value);
        f.querySelectorAll("[data-keep]").forEach(i => (i.value = ""));
        toast("Contraseña cambiada.");
        break;
      }
    }
  } catch (err) { onErr(err); }
  finally { if (btn?.isConnected) btn.disabled = false; }
});
