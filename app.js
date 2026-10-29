'use strict';

const MAX_COUNT = 15; // 1 chiffre hexadécimal par vignette dans le lien de partage
const STORAGE_KEY = 'vignettes-leclerc:v1';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue; // pas d'attribut "null" (ex. disabled)
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...children.filter((c) => c != null));
  return el;
}

// ---------- État ----------

let editions = [];        // [{ id, title, file }]
let collection = null;    // édition courante : { id, title, items: [{ n, name?, type? }] }
let filter = 'all';
let removeMode = false;
let friend = null;        // { id, counts, name } quand un lien de partage est ouvert

let state = loadState();  // { current, name, counts: { [editionId]: number[] } }

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && typeof s === 'object') return { current: s.current || null, name: s.name || '', welcomed: !!s.welcomed, installDismissed: !!s.installDismissed, trades: Array.isArray(s.trades) ? s.trades : [], lastTrade: s.lastTrade || null, counts: s.counts || {} };
  } catch (_) { /* stockage indisponible ou corrompu */ }
  return { current: null, name: '', welcomed: false, installDismissed: false, trades: [], lastTrade: null, counts: {} };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {
    toast('Impossible de sauvegarder (stockage bloqué)');
  }
}

function myCounts() {
  const n = collection.items.length;
  const arr = state.counts[collection.id] || [];
  return Array.from({ length: n }, (_, i) => clamp(arr[i]));
}

function clamp(v) {
  v = Number.isFinite(+v) ? Math.trunc(+v) : 0;
  return Math.max(0, Math.min(MAX_COUNT, v));
}

function setCount(i, value) {
  const arr = myCounts();
  arr[i] = clamp(value);
  state.counts[collection.id] = arr;
  saveState();
}

// ---------- Chargement des éditions ----------

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(path + ' : ' + res.status);
  return res.json();
}

async function loadCollection(id) {
  const meta = editions.find((e) => e.id === id) || editions[0];
  const data = await fetchJSON('collections/' + meta.file);
  let items = Array.isArray(data.items) ? data.items : [];
  // Complète avec des vignettes génériques jusqu'à `total` (liste pas encore saisie en entier).
  const known = new Set(items.map((it) => it.n));
  items = items.slice();
  // Les fixeez (autocollants non numérotés) viennent après les cartes : n = total + rang.
  const cards = data.total || 0;
  for (let n = 1; n <= cards + (data.fixeezTotal || 0); n++) {
    if (known.has(n)) continue;
    items.push(n <= cards ? { n } : { n, kind: 'fixeez', label: 'F' + (n - cards), page: 'Fixeez', color: '#e0a100' });
  }
  items.sort((a, b) => a.n - b.n);
  collection = { id: meta.id, title: data.title || meta.title, subtitle: data.subtitle || '', imagesDir: data.imagesDir || '', items };
  state.current = meta.id;
  saveState();
}

// ---------- Rendu : collection ----------

function renderAll() {
  $('#title').textContent = collection.title;
  $('#subtitle').textContent = collection.subtitle;
  document.title = collection.title + ' · Vignettes Leclerc';
  renderProgress();
  renderGrid();
  renderDoubles();
  renderQR();
  $('#my-name').value = state.name;
}

function renderProgress() {
  const counts = myCounts();
  const stat = (kind) => {
    const idx = collection.items.map((it, i) => i).filter((i) => (collection.items[i].kind === 'fixeez') === (kind === 'fixeez'));
    return { total: idx.length, have: idx.filter((i) => counts[i] > 0).length };
  };
  const cards = stat('card');
  const fix = stat('fixeez');
  const dups = counts.reduce((s, c) => s + Math.max(0, c - 1), 0);
  $('#bar-fill').style.width = (cards.total ? (cards.have / cards.total) * 100 : 0) + '%';
  $('#progress-text').textContent =
    `${cards.have} / ${cards.total} cartes` + (cards.total ? ` (${Math.round((cards.have / cards.total) * 100)} %)` : '') +
    (fix.total ? ` · ${fix.have} / ${fix.total} fixeez` : '') +
    ` · ${dups} double${dups > 1 ? 's' : ''}`;
}

function renderGrid() {
  const counts = myCounts();
  const grid = $('#grid');
  grid.replaceChildren();
  const paged = collection.items.some((it) => it.page);
  let lastPage;
  collection.items.forEach((item, i) => {
    const c = counts[i];
    if (!passesFilter(c)) return;
    const page = item.page || (paged ? 'Autres' : '');
    if (page !== lastPage) {
      lastPage = page;
      if (page) grid.append(h('h3', { class: 'page-head', style: pageHeadStyle(item.color) }, page));
    }
    grid.append(tileEl(item, i, c));
  });
  if (!grid.children.length) grid.append(h('p', { class: 'empty' }, 'Rien à afficher ici.'));
}

// Libellé affiché : numéro pour les cartes, "F1"… ou nom pour les fixeez.
function lab(item) {
  return item.label != null ? String(item.label) : '#' + String(item.n).padStart(3, '0');
}

// `color` : une couleur, ou une liste de couleurs (page bicolore) rendue en dégradé.
function pageHeadStyle(color) {
  if (Array.isArray(color)) return `border-image:linear-gradient(${color.join(',')}) 1`;
  return `border-color:${color || 'var(--line)'}`;
}

function sparkleEl() {
  const span = h('span', { class: 'tag' });
  span.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-sparkle"/></svg>';
  return span;
}

function passesFilter(c) {
  return !((filter === 'missing' && c > 0) || (filter === 'have' && c === 0) || (filter === 'dups' && c < 2));
}

function tileEl(item, i, c) {
  const cls = 'tile' + (c > 0 ? ' have' : '') + (c > 1 ? ' dup' : '') + (item.kind === 'fixeez' ? ' fixeez' : '');
  const color = [].concat(item.color || '#6b7280')[0];
  return h('button', {
    class: cls, type: 'button', 'data-i': i, 'aria-label': tileLabel(item, c), style: `--c1:${color}`,
  },
    h('span', { class: 'frame' },
      artEl(item),
      item.type ? sparkleEl() : null,
      item.symbol ? symbolEl(item.symbol) : null,
      c > 1 ? h('span', { class: 'badge' }, '×' + c) : null,
    ),
    h('span', { class: 'cap' },
      lab(item) ? h('span', { class: 'num' }, lab(item)) : null,
      h('span', { class: 'tname' }, item.name || ''),
    ),
  );
}

// Visuel : image de la carte si elle existe (img/cartes/NNN.webp ou item.image), sinon silhouette générique.
function artEl(item, eager = false) {
  const art = h('span', { class: 'art' });
  art.innerHTML = '<svg class="sil" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-sparkle"/></svg>';
  const src = item.image || (collection.imagesDir ? collection.imagesDir + String(item.n).padStart(3, '0') + '.webp' : '');
  if (src) {
    const img = h('img', { src, alt: '', loading: eager ? 'eager' : 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.remove());
    art.append(img);
  }
  return art;
}

function tileLabel(item, c) {
  return `${item.kind === 'fixeez' ? 'Fixeez' : 'Vignette'} ${lab(item)}${item.name ? ' ' + item.name : ''}, ${c === 0 ? 'manquante' : c + ' exemplaire' + (c > 1 ? 's' : '')}`;
}

// Ajoute (+1) ou retire (-1) un exemplaire et rafraîchit la tuile, la progression, les listes et le QR.
function adjust(i, delta) {
  const c = myCounts()[i];
  if (delta > 0 && c >= MAX_COUNT) return toast(`Maximum ${MAX_COUNT} exemplaires`);
  setCount(i, c + delta);
  const newC = myCounts()[i];
  const tile = $('#grid').querySelector(`.tile[data-i="${i}"]`);
  if (tile && passesFilter(newC)) tile.replaceWith(tileEl(collection.items[i], i, newC));
  else renderGrid(); // la vignette sort du filtre : on redessine pour garder les titres de pages cohérents
  renderProgress();
  renderDoubles();
  renderQR();
}

// Appui long (ou clic droit) : fiche détaillée ; appui court : +1 / -1 selon le mode.
let pressTimer = null;
let longPressed = false;
const grid = $('#grid');
const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
grid.addEventListener('pointerdown', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  longPressed = false;
  cancelPress();
  pressTimer = setTimeout(() => { longPressed = true; openDetail(+tile.dataset.i); }, 450);
});
['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((t) => grid.addEventListener(t, cancelPress));
grid.addEventListener('contextmenu', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  e.preventDefault();
  longPressed = true;
  openDetail(+tile.dataset.i);
});
grid.addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  if (longPressed) { longPressed = false; return; }
  adjust(+tile.dataset.i, removeMode ? -1 : 1);
});

// ---------- Fiche détaillée ----------

const SYMBOL_NAMES = { photo: 'Appareil photo', tongs: 'Tongs', carte: 'Carte', chapeau: 'Chapeau', valise: 'Valise', lunettes: 'Lunettes de soleil' };
const SPECIAL_NAMES = { main: 'main', oeil: 'œil', brillant: 'éclat', etoiles: 'étoiles' };
let detailIndex = -1;

function symbolEl(sym) {
  const el = h('span', { class: 'sym', title: SYMBOL_NAMES[sym.icon] || '', style: `color:${sym.color}` });
  el.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#s-${sym.icon}"/></svg>`;
  return el;
}

function openDetail(i) {
  detailIndex = i;
  const item = collection.items[i];
  $('#d-art').replaceChildren(artEl(item, true));
  $('#d-meta').textContent = [lab(item), item.page].filter(Boolean).join(' · ');
  $('#d-title').textContent = item.name || lab(item);
  $('#d-desc').textContent = item.description || '';
  const extra = [];
  if (item.symbol) extra.push('Symbole : ' + (SYMBOL_NAMES[item.symbol.icon] || item.symbol.icon));
  if (item.type) extra.push('Carte spéciale (' + (SPECIAL_NAMES[item.type] || item.type) + ')');
  $('#d-sym').textContent = extra.join(' · ');
  refreshDetailCount();
  const dlg = $('#detail');
  if (!dlg.open) dlg.showModal();
}

function refreshDetailCount() {
  const c = myCounts()[detailIndex];
  $('#d-count').textContent = c === 0 ? 'Manquante' : c + ' exemplaire' + (c > 1 ? 's' : '');
}

$('#d-plus').addEventListener('click', () => { adjust(detailIndex, 1); refreshDetailCount(); });
$('#d-minus').addEventListener('click', () => { adjust(detailIndex, -1); refreshDetailCount(); });
$('#detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

$('#mode-add').addEventListener('click', () => setMode(false));
$('#mode-remove').addEventListener('click', () => setMode(true));
function setMode(remove) {
  removeMode = remove;
  $('#mode-add').classList.toggle('on', !remove);
  $('#mode-remove').classList.toggle('on', remove);
}

$$('[data-filter]').forEach((b) => b.addEventListener('click', () => {
  filter = b.dataset.filter;
  $$('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
  renderGrid();
}));

// ---------- Rendu : doubles / manquantes ----------

function chip(item, extra, dup) {
  return h('span', { class: 'chip' + (dup ? ' dup' : '') },
    h('b', {}, lab(item)), item.name ? h('small', {}, ' ' + item.name) : null, extra ? h('small', {}, ' ' + extra) : null);
}

function renderDoubles() {
  const counts = myCounts();
  const doubles = $('#doubles-list');
  const missing = $('#missing-list');
  doubles.replaceChildren();
  missing.replaceChildren();
  const dChips = [], mChips = [];
  collection.items.forEach((item, i) => {
    if (counts[i] > 1) dChips.push(chip(item, '×' + (counts[i] - 1), true));
    if (counts[i] === 0) mChips.push(chip(item));
  });
  doubles.append(dChips.length ? h('div', { class: 'chips' }, ...dChips) : h('p', { class: 'hint' }, 'Aucun double pour l\'instant.'));
  missing.append(mChips.length ? h('div', { class: 'chips' }, ...mChips) : h('p', { class: 'hint' }, 'Collection complète, bravo !'));
}

function listsText() {
  const counts = myCounts();
  const d = [], m = [];
  collection.items.forEach((it, i) => {
    const l = (lab(it) + (it.kind === 'fixeez' && it.name ? ' ' + it.name : '')).trim();
    if (counts[i] > 1) d.push(l + (counts[i] > 2 ? ` (×${counts[i] - 1})` : ''));
    if (counts[i] === 0) m.push(l);
  });
  return `${collection.title}\nMes doubles : ${d.join(', ') || 'aucun'}\nIl me manque : ${m.join(', ') || 'rien !'}`;
}

$('#copy-lists').addEventListener('click', async () => {
  const text = listsText();
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  await copyText(text, 'Listes copiées');
});

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch (_) {
    window.prompt('Copie ce texte :', text);
  }
}

// ---------- Partage : encodage compact + QR ----------

function encodeCounts(counts) {
  return counts.map((c) => clamp(c).toString(16)).join('');
}

function decodeCounts(hex) {
  return [...hex].map((ch) => clamp(parseInt(ch, 16)));
}

function shareURL() {
  const base = location.origin + location.pathname;
  const name = state.name.trim();
  return `${base}#/s/${encodeURIComponent(collection.id)}/${encodeCounts(myCounts())}` + (name ? '/' + encodeURIComponent(name) : '');
}

function parseShare(hash) {
  const m = /^#\/s\/([^/]+)\/([0-9a-f]*)(?:\/(.*))?$/i.exec(hash || '');
  if (!m) return null;
  let name = '';
  try { name = m[3] ? decodeURIComponent(m[3]) : ''; } catch (_) { /* nom illisible : ignoré */ }
  return { id: decodeURIComponent(m[1]), counts: decodeCounts(m[2]), name: name.slice(0, 20) };
}

function renderQR() {
  qrInto($('#qr'), shareURL());
}

$('#my-name').addEventListener('input', (e) => {
  state.name = e.target.value.slice(0, 20);
  saveState();
  renderQR();
});

// Premier lancement : demande du pseudo (modifiable ensuite dans Échanger).
function closeWelcome(save) {
  const name = $('#welcome-name').value.trim().slice(0, 20);
  if (save && name) state.name = name;
  state.welcomed = true;
  saveState();
  $('#my-name').value = state.name;
  renderQR();
  $('#welcome').close();
}
$('#welcome form').addEventListener('submit', (e) => { e.preventDefault(); closeWelcome(true); });
$('#welcome-later').addEventListener('click', () => closeWelcome(false));
$('#welcome').addEventListener('cancel', (e) => { e.preventDefault(); closeWelcome(false); });

$('#link-btn').addEventListener('click', () => copyText(shareURL(), 'Lien copié'));

// ---------- Échanges ----------

let sel = { give: new Set(), get: new Set() }; // indices cochés dans l'échange en préparation
let incoming = null;  // confirmation reçue d'un pote (lien #/x/…)
let doneTrade = null; // échange que je viens de confirmer (affiche le QR de confirmation)

async function ensureEdition(id) {
  if (id === collection.id) return true;
  if (!editions.some((e) => e.id === id)) { toast(`Édition « ${id} » inconnue`); return false; }
  await loadCollection(id);
  renderEditionSelect();
  renderAll();
  return true;
}

async function openFriend(f) {
  if (!(await ensureEdition(f.id))) return;
  friend = f; incoming = null; doneTrade = null;
  // sélection par défaut : autant de vignettes de chaque côté (échange équitable)
  const { iGive, theyGive } = tradeLists();
  const n = Math.min(iGive.length, theyGive.length);
  sel = { give: new Set(iGive.slice(0, n)), get: new Set(theyGive.slice(0, n)) };
  renderFriend();
  showView('trade');
}

// Indices des vignettes que je peux donner (double chez moi, manquante chez lui) et qu'il peut me donner.
function tradeLists() {
  const mine = myCounts();
  const theirs = collection.items.map((_, i) => clamp(friend.counts[i]));
  const iGive = [], theyGive = [];
  collection.items.forEach((_, i) => {
    if (mine[i] > 1 && theirs[i] === 0) iGive.push(i);
    if (theirs[i] > 1 && mine[i] === 0) theyGive.push(i);
  });
  return { iGive, theyGive };
}

const itemsText = (idx) => idx.map((i) => lab(collection.items[i]) + (collection.items[i].name ? ' ' + collection.items[i].name : '')).join(', ');
const indexOfN = (n) => collection.items.findIndex((it) => it.n === n);

function qrInto(box, url) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    box.innerHTML = qr.createSvgTag(4, 0);
  } catch (_) {
    box.textContent = 'QR code indisponible (trop de vignettes ?)';
  }
}

function newTradeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// Applique un échange à MA collection : give = indices que je donne (-1), get = indices que je reçois (+1).
function applyTrade(id, give, get) {
  const arr = myCounts();
  give.forEach((i) => { arr[i] = clamp(arr[i] - 1); });
  get.forEach((i) => { arr[i] = clamp(arr[i] + 1); });
  state.counts[collection.id] = arr;
  state.trades = [...state.trades.filter((t) => t !== id), id].slice(-100);
  state.lastTrade = { id, edition: collection.id, give, get };
  saveState();
  renderAll();
}

function undoLastTrade() {
  const t = state.lastTrade;
  if (!t || t.edition !== collection.id) return toast('Rien à annuler pour cette édition');
  const arr = myCounts();
  t.give.forEach((i) => { arr[i] = clamp(arr[i] + 1); });
  t.get.forEach((i) => { arr[i] = clamp(arr[i] - 1); });
  state.counts[collection.id] = arr;
  state.trades = state.trades.filter((x) => x !== t.id); // le lien de confirmation pourra être rescanné
  state.lastTrade = null;
  saveState();
  renderAll();
  renderLastTrade();
  toast('Échange annulé : tes compteurs sont remis comme avant');
}

function renderLastTrade() {
  const t = state.lastTrade;
  const box = $('#last-trade');
  box.hidden = !t || t.edition !== collection.id;
  if (box.hidden) return;
  $('#last-trade-text').textContent = `Dernier échange : tu as donné ${t.give.length}, reçu ${t.get.length}.`;
}

function closeTrade() {
  friend = null; incoming = null; doneTrade = null;
  history.replaceState(null, '', location.pathname);
  renderFriend();
}

const manualBtn = () => h('button', { class: 'btn ghost', type: 'button', onclick: () => { closeTrade(); showView('collection'); toast('Corrige à la main avec + / −'); } }, 'Corriger à la main');

function selChip(item, i, side) {
  const on = sel[side].has(i);
  return h('button', { class: 'chip sel' + (on ? ' on' : ''), type: 'button', 'data-i': i, 'data-side': side, 'aria-pressed': on ? 'true' : 'false' },
    h('b', {}, lab(item)), item.name ? h('small', {}, ' ' + item.name) : null);
}

function selBox(title, idx, side, emptyText) {
  return h('div', { class: 'trade-box' },
    h('h3', {}, title),
    idx.length ? h('div', { class: 'chips' }, ...idx.map((i) => selChip(collection.items[i], i, side))) : h('p', { class: 'hint' }, emptyText));
}

function renderFriend() {
  const box = $('#friend-result');
  renderLastTrade();
  if (doneTrade) return renderDone(box);
  if (incoming) return renderIncoming(box);
  if (!friend) { box.hidden = true; $('#trade-home').hidden = false; return; }
  const { iGive, theyGive } = tradeLists();
  const who = friend.name || 'ton pote';
  $('#friend-title').textContent = `Échange avec ${who}`;
  const giveSel = iGive.filter((i) => sel.give.has(i)), getSel = theyGive.filter((i) => sel.get.has(i));
  const body = $('#friend-body');
  body.replaceChildren(
    h('p', { class: 'hint' }, iGive.length || theyGive.length
      ? 'Touche une vignette pour l\'ajouter ou la retirer de l\'échange. Une seule personne confirme : l\'autre scanne ensuite le QR de confirmation pour que ça se coche aussi chez lui.'
      : 'Rien à échanger pour cette fois.'),
    selBox(`Tu donnes à ${who} (${giveSel.length}/${iGive.length})`, iGive, 'give', 'Rien : tes doubles ne lui manquent pas.'),
    selBox(`${who} te donne (${getSel.length}/${theyGive.length})`, theyGive, 'get', 'Rien : ses doubles ne te manquent pas.'),
    h('button', {
      class: 'btn', type: 'button', disabled: giveSel.length + getSel.length ? null : 'true',
      onclick: () => confirmTrade(giveSel, getSel),
    }, giveSel.length + getSel.length ? `Confirmer l'échange (${giveSel.length} contre ${getSel.length})` : 'Confirmer l\'échange'),
    manualBtn(),
  );
  $('#friend-close').textContent = 'Annuler';
  box.hidden = false;
  $('#trade-home').hidden = true;
}

function confirmTrade(give, get) {
  const who = friend.name || 'ton pote';
  if (!confirm(`Confirmer l'échange avec ${who} ?\n\nTu donnes : ${itemsText(give) || 'rien'}\nTu reçois : ${itemsText(get) || 'rien'}\n\nTa collection sera mise à jour tout de suite (tu pourras annuler).`)) return;
  const id = newTradeId();
  applyTrade(id, give, get);
  doneTrade = { id, give, get, who };
  renderFriend();
}

function tradeURL(t) {
  const base = location.origin + location.pathname;
  const ns = (idx) => idx.map((i) => collection.items[i].n).join('.') || '-';
  const name = state.name.trim();
  return `${base}#/x/${encodeURIComponent(collection.id)}/${t.id}/${ns(t.give)}/${ns(t.get)}` + (name ? '/' + encodeURIComponent(name) : '');
}

function renderDone(box) {
  const t = doneTrade;
  $('#friend-title').textContent = 'Échange enregistré chez toi';
  const qr = h('div', { class: 'qr' });
  qrInto(qr, tradeURL(t));
  $('#friend-body').replaceChildren(
    h('p', { class: 'status' },
      h('span', { class: 'pill ok' }, 'Chez toi : fait'),
      h('span', { class: 'pill wait' }, `Chez ${t.who} : en attente`)),
    h('div', { class: 'callout' },
      h('p', { class: 'callout-title' }, `Ce n'est pas fini : ${t.who} doit valider de son côté`),
      h('ol', {},
        h('li', {}, `${t.who} scanne ce QR avec son appareil photo ou l'appli (ou ouvre le lien).`),
        h('li', {}, 'Il appuie sur « Valider de mon côté ».'),
        h('li', {}, 'Sa collection se met à jour : l\'échange est terminé pour vous deux.'))),
    qr,
    h('button', { class: 'btn ghost', type: 'button', onclick: () => copyText(tradeURL(t), 'Lien de confirmation copié') }, 'Copier le lien de confirmation'),
    h('button', { class: 'btn danger', type: 'button', onclick: () => { undoLastTrade(); closeTrade(); } }, 'Annuler cet échange'),
    manualBtn(),
  );
  $('#friend-close').textContent = 'Terminer';
  box.hidden = false;
  $('#trade-home').hidden = true;
}

function parseTrade(hash) {
  const m = /^#\/x\/([^/]+)\/([a-z0-9]+)\/([\d.-]*)\/([\d.-]*)(?:\/(.*))?$/i.exec(hash || '');
  if (!m) return null;
  const nums = (s) => (s === '-' || !s ? [] : s.split('.').map(Number).filter(Number.isFinite));
  let name = '';
  try { name = m[5] ? decodeURIComponent(m[5]) : ''; } catch (_) { /* nom illisible : ignoré */ }
  return { edition: decodeURIComponent(m[1]), id: m[2], senderGives: nums(m[3]), senderGets: nums(m[4]), name: name.slice(0, 20) };
}

async function openTrade(t) {
  if (!(await ensureEdition(t.edition))) return;
  friend = null; doneTrade = null; incoming = t;
  renderFriend();
  showView('trade');
}

function renderIncoming(box) {
  const t = incoming;
  const who = t.name || 'Ton pote';
  const get = t.senderGives.map(indexOfN).filter((i) => i >= 0);   // je les reçois
  const give = t.senderGets.map(indexOfN).filter((i) => i >= 0);   // je les donne
  const already = state.trades.includes(t.id);
  const mine = myCounts();
  const lacking = give.filter((i) => mine[i] < 1);
  $('#friend-title').textContent = `${who} a confirmé un échange`;
  const body = $('#friend-body');
  body.replaceChildren(
    already ? h('p', { class: 'hint' }, 'Cet échange est déjà enregistré chez toi.') : h('p', { class: 'hint' }, 'Valide pour mettre ta collection à jour de ton côté.'),
    h('div', { class: 'trade-box' }, h('h3', {}, `Tu reçois (${get.length})`), get.length ? h('div', { class: 'chips' }, ...get.map((i) => chip(collection.items[i], '', true))) : h('p', { class: 'hint' }, 'Rien')),
    h('div', { class: 'trade-box' }, h('h3', {}, `Tu donnes (${give.length})`), give.length ? h('div', { class: 'chips' }, ...give.map((i) => chip(collection.items[i], '', true))) : h('p', { class: 'hint' }, 'Rien')),
    lacking.length ? h('p', { class: 'hint' }, `Attention : tu n'as pas (ou plus) ${itemsText(lacking)}. Vérifie ta collection.`) : null,
    h('button', {
      class: 'btn', type: 'button', disabled: already ? 'true' : null,
      onclick: () => { applyTrade(t.id, give, get); toast('Échange enregistré'); incoming = null; history.replaceState(null, '', location.pathname); renderFriend(); showView('collection'); },
    }, 'Valider de mon côté'),
    manualBtn(),
  );
  $('#friend-close').textContent = 'Refuser';
  box.hidden = false;
  $('#trade-home').hidden = true;
}

$('#friend-body').addEventListener('click', (e) => {
  const b = e.target.closest('.chip.sel');
  if (!b) return;
  const set = sel[b.dataset.side], i = +b.dataset.i;
  if (set.has(i)) set.delete(i); else set.add(i);
  renderFriend();
});

$('#friend-close').addEventListener('click', closeTrade);
$('#undo-last').addEventListener('click', undoLastTrade);

async function handleLink(text) {
  let hash = text;
  try { hash = new URL(text).hash; } catch (_) { /* déjà un fragment */ }
  const f = parseShare(hash);
  if (f) return openFriend(f);
  const t = parseTrade(hash);
  if (t) return openTrade(t);
  toast('Ce lien n\'est pas un échange de vignettes');
}

$('#paste-link').addEventListener('change', async (e) => {
  const v = e.target.value.trim();
  if (v) { await handleLink(v); e.target.value = ''; }
});

window.addEventListener('hashchange', () => {
  const f = parseShare(location.hash);
  if (f) return openFriend(f);
  const t = parseTrade(location.hash);
  if (t) openTrade(t);
});

// ---------- Scanner QR ----------

let stream = null;
let scanning = false;

async function startScan() {
  const msg = $('#scan-msg');
  msg.textContent = '';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    msg.textContent = 'Caméra indisponible ici : utilise l\'appareil photo du téléphone, il ouvrira le lien directement.';
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (_) {
    msg.textContent = 'Accès à la caméra refusé. Tu peux scanner avec l\'appareil photo du téléphone à la place.';
    return;
  }
  const video = $('#video');
  video.srcObject = stream;
  await video.play();
  $('#sc-msg').textContent = 'Cadre le QR code affiché sur son téléphone.';
  $('#scanner').showModal();
  scanning = true;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (!scanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code && (parseShare(safeHash(code.data)) || parseTrade(safeHash(code.data)))) {
        stopScan();
        await handleLink(code.data);
        return;
      }
      if (code) $('#sc-msg').textContent = 'Ce QR code n\'est pas un échange de vignettes.';
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function safeHash(text) {
  try { return new URL(text).hash; } catch (_) { return text; }
}

function stopScan() {
  scanning = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  const dlg = $('#scanner');
  if (dlg.open) dlg.close();
}

$('#scan-btn').addEventListener('click', startScan);
$('#scan-stop').addEventListener('click', stopScan);
$('#scanner').addEventListener('close', stopScan); // fermeture par Échap ou retour

// ---------- Sauvegarde ----------

$('#export-btn').addEventListener('click', () => {
  const payload = {
    app: 'vignettes-leclerc',
    version: 1,
    exportedAt: new Date().toISOString(),
    name: state.name,
    counts: state.counts,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `vignettes-leclerc-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('#save-msg').textContent = 'Fichier exporté. Garde-le précieusement (mail, cloud…).';
});

$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'vignettes-leclerc' || typeof data.counts !== 'object' || !data.counts) throw new Error('format');
    const ids = Object.keys(data.counts);
    if (!confirm(`Importer ${ids.length} édition(s) (${ids.join(', ')}) ? Ça remplace les données actuelles de ces éditions.`)) return;
    for (const id of ids) {
      if (Array.isArray(data.counts[id])) state.counts[id] = data.counts[id].map(clamp);
    }
    if (data.name && !state.name) state.name = String(data.name).slice(0, 20);
    state.welcomed = true;
    saveState();
    renderAll();
    $('#save-msg').textContent = 'Import terminé.';
  } catch (_) {
    $('#save-msg').textContent = 'Fichier invalide : ce n\'est pas une sauvegarde de cette appli.';
  }
});

$('#reset-btn').addEventListener('click', () => {
  if (!confirm(`Remettre « ${collection.title} » à zéro ? C'est définitif (pense à exporter avant).`)) return;
  delete state.counts[collection.id];
  saveState();
  renderAll();
  toast('Édition remise à zéro');
});

// ---------- Navigation ----------

function showView(name) {
  if (name !== 'trade') stopScan();
  $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + name; });
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  window.scrollTo(0, 0);
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function renderEditionSelect() {
  const sel = $('#edition');
  sel.replaceChildren(...editions.map((e) => h('option', { value: e.id }, e.title)));
  sel.value = collection.id;
  sel.hidden = editions.length < 2;
}

$('#edition').addEventListener('change', async (e) => {
  await loadCollection(e.target.value);
  friend = null;
  renderFriend();
  renderAll();
});

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Installation (PWA) ----------

let installEvent = null; // Chrome / Android / bureau : prompt natif ; iOS n'en a pas (Partager → Sur l'écran d'accueil)
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);

function renderInstall() {
  const installed = isStandalone();
  $('#install').hidden = installed;
  $('#install-banner').hidden = installed || state.installDismissed;
  if (installed) return;
  $('#install-btn').hidden = !installEvent;
  const ios = isIOS(), android = !ios && isAndroid();
  $('#install-ios').hidden = !ios;
  $('#install-android').hidden = !android || !!installEvent;
  $('#install-desktop').hidden = ios || android || !!installEvent;
}

async function promptInstall() {
  if (!installEvent) { showView('save'); $('#install').scrollIntoView({ behavior: 'smooth' }); return; }
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  renderInstall();
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; renderInstall(); });
window.addEventListener('appinstalled', () => { installEvent = null; renderInstall(); toast('Appli installée'); });
$('#install-btn').addEventListener('click', promptInstall);
$('#banner-install').addEventListener('click', promptInstall);
$('#banner-close').addEventListener('click', () => { state.installDismissed = true; saveState(); renderInstall(); });

// ---------- Démarrage ----------

async function init() {
  try {
    const index = await fetchJSON('collections/index.json');
    editions = index.editions;
    const wanted = editions.some((e) => e.id === state.current) ? state.current : index.default;
    await loadCollection(wanted);
  } catch (_) {
    $('#grid').textContent = 'Impossible de charger la collection. Réessaie avec du réseau.';
    return;
  }
  renderEditionSelect();
  renderAll();
  renderInstall();
  renderLastTrade();
  const f = parseShare(location.hash);
  const t = parseTrade(location.hash);
  if (f) await openFriend(f);
  else if (t) await openTrade(t);
  else if (!state.name && !state.welcomed) $('#welcome').showModal();
}

// Hauteur de l'en-tête collant, pour caler le sélecteur de mode juste en dessous.
const topBar = $('.top');
const syncTopHeight = () => document.documentElement.style.setProperty('--top-h', topBar.offsetHeight + 'px');
syncTopHeight();
if ('ResizeObserver' in window) new ResizeObserver(syncTopHeight).observe(topBar);
else window.addEventListener('resize', syncTopHeight);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
init();
