import Map from 'ol/Map.js';
import View from 'ol/View.js';
import Feature from 'ol/Feature.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import OSM from 'ol/source/OSM.js';
import VectorSource from 'ol/source/Vector.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import { Style, Stroke, Fill, Circle as CircleStyle, Text } from 'ol/style.js';
import { defaults as defaultInteractions } from 'ol/interaction/defaults.js';
import { getDistance } from 'ol/sphere.js';
import 'ol/ol.css';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { isConfigured, saveRoute } from './api.js';
import { initSavedTab } from './saved.js';

// ================= Mapa =================

const routeSource = new VectorSource();

const styles = {
  route: [
    new Style({ stroke: new Stroke({ color: 'white', width: 8 }) }),
    new Style({ stroke: new Stroke({ color: '#e8590c', width: 5 }) }),
  ],
  start: pointStyle('#2b8a3e', 8),
  end: pointStyle('#c92a2a', 8),
  waypoint: pointStyle('#e8590c', 5),
};

function pointStyle(color, radius) {
  return new Style({
    image: new CircleStyle({
      radius,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: 'white', width: 2 }),
    }),
  });
}

function kmStyle(km) {
  return new Style({
    image: new CircleStyle({
      radius: 10,
      fill: new Fill({ color: 'white' }),
      stroke: new Stroke({ color: '#e8590c', width: 2 }),
    }),
    text: new Text({
      text: String(km),
      font: 'bold 11px sans-serif',
      fill: new Fill({ color: '#e8590c' }),
    }),
  });
}

const map = new Map({
  target: 'map',
  // Sem zoom no duplo clique: cada clique adiciona um ponto ao trajeto
  interactions: defaultInteractions({ doubleClickZoom: false }),
  layers: [
    new TileLayer({ source: new OSM() }),
    new VectorLayer({
      source: routeSource,
      style: (feature) => feature.get('style'),
    }),
  ],
  view: new View({ center: fromLonLat([-51.2, -30.0]), zoom: 12 }),
});

// ================= Trajeto =================

// Pontos clicados (lon/lat) e os trechos entre eles.
// segments[i] liga waypoints[i] a waypoints[i + 1].
let waypoints = [];
let segments = [];

const distanceEl = document.getElementById('distance');
const timeEl = document.getElementById('time');
const paceInput = document.getElementById('pace');
const followRoads = document.getElementById('follow-roads');
const undoBtn = document.getElementById('undo');
const outAndBackBtn = document.getElementById('out-and-back');
const clearBtn = document.getElementById('clear');
const hintEl = document.getElementById('hint');

map.on('click', (evt) => addWaypoint(toLonLat(evt.coordinate)));

function addWaypoint(lonLat) {
  const prev = waypoints[waypoints.length - 1];
  waypoints.push(lonLat);
  if (prev) {
    const seg = { coords: [prev, lonLat], pending: false };
    segments.push(seg);
    if (followRoads.checked) routeSegment(seg, prev, lonLat);
  }
  render();
}

// Busca o caminho a pé pelas ruas (OSRM do OpenStreetMap).
// Enquanto não chega, o trecho aparece como linha reta.
async function routeSegment(seg, from, to) {
  seg.pending = true;
  render();
  try {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/` +
      `${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes.length) throw new Error(data.code);
    seg.coords = data.routes[0].geometry.coordinates;
  } catch (err) {
    console.warn('Não foi possível seguir as ruas, usando linha reta:', err);
  } finally {
    seg.pending = false;
    // Se o trecho foi desfeito enquanto carregava, não há o que atualizar
    if (segments.includes(seg)) render();
  }
}

function undo() {
  if (segments.length) segments.pop();
  waypoints.pop();
  render();
}

// Duplica o trajeto no sentido contrário, voltando ao ponto de partida
function outAndBack() {
  if (segments.length === 0 || segments.some((s) => s.pending)) return;
  const back = segments.slice().reverse().map((s) => ({
    coords: s.coords.slice().reverse(),
    pending: false,
  }));
  waypoints.push(...waypoints.slice(0, -1).reverse());
  segments.push(...back);
  render();
}

function clearRoute() {
  waypoints = [];
  segments = [];
  render();
}

undoBtn.addEventListener('click', undo);
outAndBackBtn.addEventListener('click', outAndBack);
clearBtn.addEventListener('click', clearRoute);
paceInput.addEventListener('input', updateStats);

// Ctrl+Z desfaz o último ponto
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    undo();
  }
});

// ================= Cálculos =================

function routeCoords() {
  const coords = [];
  segments.forEach((seg, i) => {
    // O primeiro ponto de cada trecho repete o último do anterior
    coords.push(...(i === 0 ? seg.coords : seg.coords.slice(1)));
  });
  return coords;
}

function lineLength(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += getDistance(coords[i - 1], coords[i]);
  }
  return total; // metros
}

// Posições de cada quilômetro completo ao longo do trajeto
function kmMarkers(coords) {
  const markers = [];
  let traveled = 0;
  let nextKm = 1000;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    const d = getDistance(a, b);
    while (d > 0 && traveled + d >= nextKm) {
      const t = (nextKm - traveled) / d;
      markers.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      nextKm += 1000;
    }
    traveled += d;
  }
  return markers;
}

// "5:30" -> 330 segundos por km
function parsePace(text) {
  const match = text.trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2] || 0);
  return seconds > 0 ? seconds : null;
}

function formatDuration(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}min` : `${m}min${sec}s`;
}

// ================= Desenho na tela =================

function render() {
  routeSource.clear();
  const coords = routeCoords();

  if (coords.length >= 2) {
    const line = new Feature(new LineString(coords.map((c) => fromLonLat(c))));
    line.set('style', styles.route);
    routeSource.addFeature(line);
  }

  kmMarkers(coords).forEach((c, i) => {
    const f = new Feature(new Point(fromLonLat(c)));
    f.set('style', kmStyle(i + 1));
    routeSource.addFeature(f);
  });

  waypoints.forEach((c, i) => {
    const f = new Feature(new Point(fromLonLat(c)));
    const isLast = i === waypoints.length - 1;
    f.set('style', i === 0 ? styles.start : isLast ? styles.end : styles.waypoint);
    routeSource.addFeature(f);
  });

  updateStats();
}

function updateStats() {
  const meters = lineLength(routeCoords());
  const km = meters / 1000;
  distanceEl.textContent = km.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const pace = parsePace(paceInput.value);
  timeEl.textContent = pace && km > 0 ? formatDuration(km * pace) : '–';
  paceInput.style.borderColor = pace ? '' : '#c92a2a';

  const pending = segments.some((s) => s.pending);
  undoBtn.disabled = waypoints.length === 0;
  clearBtn.disabled = waypoints.length === 0;
  outAndBackBtn.disabled = segments.length === 0 || pending;

  saveOpenBtn.disabled = !isConfigured || segments.length === 0 || pending;
  saveOpenBtn.title = isConfigured ? '' : 'Banco de dados não configurado';
  if (segments.length === 0) closeSaveForm();

  hintEl.textContent = pending
    ? 'Calculando caminho pelas ruas...'
    : waypoints.length === 0
      ? 'Clique no mapa para marcar o início do trajeto.'
      : 'Clique no mapa para continuar o trajeto.';
}

// ================= Salvar trajeto =================

const saveOpenBtn = document.getElementById('save-open');
const saveForm = document.getElementById('save-form');
const saveNameInput = document.getElementById('save-name');
const saveSubmitBtn = document.getElementById('save-submit');

function closeSaveForm() {
  saveForm.hidden = true;
  saveOpenBtn.hidden = false;
}

saveOpenBtn.addEventListener('click', () => {
  saveOpenBtn.hidden = true;
  saveForm.hidden = false;
  saveNameInput.value = '';
  saveNameInput.focus();
});

document.getElementById('save-cancel').addEventListener('click', closeSaveForm);

// 6 casas decimais ≈ 10 cm de precisão, suficiente e deixa o registro menor
const round = ([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))];

saveForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = saveNameInput.value.trim();
  if (!name || segments.some((s) => s.pending)) return;

  saveSubmitBtn.disabled = true;
  try {
    await saveRoute({
      name,
      distance_m: Math.round(lineLength(routeCoords())),
      waypoints: waypoints.map(round),
      segments: segments.map((s) => s.coords.map(round)),
    });
    closeSaveForm();
    hintEl.textContent = `Trajeto "${name}" salvo!`;
  } catch (err) {
    console.error(err);
    alert('Não foi possível salvar o trajeto. Tente novamente.');
  } finally {
    saveSubmitBtn.disabled = false;
  }
});

// ================= Abrir trajeto salvo =================

function loadRoute(route) {
  waypoints = route.waypoints;
  segments = route.segments.map((coords) => ({ coords, pending: false }));
  render();
  showTab('plan');

  const coords = routeCoords();
  if (coords.length >= 2) {
    const extent = new LineString(coords.map((c) => fromLonLat(c))).getExtent();
    map.getView().fit(extent, { padding: [40, 40, 260, 40], maxZoom: 17, duration: 800 });
  }
  hintEl.textContent = `Trajeto "${route.name}" aberto.`;
}

// ================= Abas =================

const savedTab = initSavedTab({ onOpen: loadRoute });
const tabButtons = document.querySelectorAll('.tab');

function showTab(name) {
  document.body.dataset.tab = name;
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'saved') savedTab.refresh();
}

tabButtons.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

render();

// ================= Minha localização =================

document.getElementById('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      map.getView().animate({
        center: fromLonLat([pos.coords.longitude, pos.coords.latitude]),
        zoom: 16,
        duration: 1000,
      });
    },
    (err) => console.warn('Localização indisponível:', err.message),
  );
});

// ================= Busca de endereço =================

const searchInput = document.getElementById('search');
const suggestionsEl = document.getElementById('suggestions');
let debounceTimer = null;
let currentResults = [];
let selectedIndex = -1;

// --- Debounce: espera 1s após parar de digitar (política do Nominatim: máx. 1 req/s) ---
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const query = searchInput.value.trim();

  if (query.length < 3) {
    hideSuggestions();
    return;
  }

  debounceTimer = setTimeout(() => search(query), 1000);
});

// --- Busca no Nominatim ---
async function search(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&accept-language=pt-BR`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const results = await res.json();
    // Ignora respostas de buscas antigas (o usuário continuou digitando)
    if (searchInput.value.trim() !== query) return;
    currentResults = results;
    renderSuggestions(results);
  } catch (err) {
    console.error('Erro:', err);
  }
}

// --- Renderiza a lista ---
function renderSuggestions(results) {
  if (results.length === 0) {
    hideSuggestions();
    return;
  }
  selectedIndex = -1;
  suggestionsEl.replaceChildren(...results.map((r, i) => {
    const el = document.createElement('div');
    el.className = 'suggestion';
    el.dataset.index = i;
    el.textContent = r.display_name;

    // Clique em uma sugestão
    el.addEventListener('click', () => {
      goToResult(currentResults[i]);
      hideSuggestions();
    });
    el.addEventListener('mouseenter', () => highlightSuggestion(i));
    return el;
  }));
  suggestionsEl.style.display = 'block';
}

function hideSuggestions() {
  suggestionsEl.style.display = 'none';
  currentResults = [];
  selectedIndex = -1;
}

function highlightSuggestion(index) {
  const items = suggestionsEl.querySelectorAll('.suggestion');
  items.forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
  selectedIndex = index;
}

// --- Navegação por teclado ---
searchInput.addEventListener('keydown', (e) => {
  const items = suggestionsEl.querySelectorAll('.suggestion');

  if (e.key === 'ArrowDown' && items.length > 0) {
    e.preventDefault();
    const next = (selectedIndex + 1) % items.length;
    highlightSuggestion(next);
    items[next].scrollIntoView({ block: 'nearest' });
  }
  else if (e.key === 'ArrowUp' && items.length > 0) {
    e.preventDefault();
    const prev = (selectedIndex - 1 + items.length) % items.length;
    highlightSuggestion(prev);
    items[prev].scrollIntoView({ block: 'nearest' });
  }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (selectedIndex >= 0 && currentResults[selectedIndex]) {
      goToResult(currentResults[selectedIndex]);
      hideSuggestions();
    } else if (currentResults.length > 0) {
      goToResult(currentResults[0]);
      hideSuggestions();
    }
  }
  else if (e.key === 'Escape') {
    hideSuggestions();
  }
});

// --- Fecha ao clicar fora ---
document.addEventListener('click', (e) => {
  if (!e.target.closest('#search') && !e.target.closest('#suggestions')) {
    hideSuggestions();
  }
});

// --- Anima o mapa até o resultado ---
function goToResult(result) {
  const coord = fromLonLat([parseFloat(result.lon), parseFloat(result.lat)]);
  map.getView().animate({
    center: coord,
    zoom: 16,
    duration: 1000,
  });
  searchInput.value = result.display_name;
}
