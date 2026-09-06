// ========== CONSTANTS ==========
var APP_ID = 'radiotivi';
var STORAGE_KEY = 'radiotivi-favs';
var CACHE_KEY = 'radiotivi-cache';
var ADMIN_EMAIL = 'roca.jlr@gmail.com';

// ========== STATE ==========
var supabaseClient = null;
var supabaseChannel = null;
var currentUserEmail = null;
var favoritos = { radio: [], tv: [] };

var currentView = 'radio';
var radios = [];
var canales = [];
var tvLoaded = false;
var radioTotal = 0;

// TV pagination state
var tvFiltered = [];
var tvShown = 0;
var tvGroupsBuilt = false;

// Player state
var audioEl = null;
var currentRadio = null;
var currentHls = null;
var currentTvChannel = null;

// Google Cast state
var castAvailable = false;
var castContext = null;
var castSession = null;
var castPlaybackStarted = false;
var currentTvChannel = null;
// Radio country state
var radioCountries = [];
var radioCountryCode = '';
var radiosSearchActive = false;
var radioCatCode = '';
var radioCountriesCacheKey = 'radiotivi-radiocountries';
var radioTagsCacheKey = 'radiotivi-radiotags';
var radioActiveCountries = null;
var radioActiveChecking = false;
var radioActiveCountriesKey = 'radiotivi-radiocountries-active';

// Radio favorites filter state
var radioFavOnly = true;
var tvFavOnly = true;
var currentRadioList = [];

// Cache de canales m3u parseados
var canalesCacheKey = 'radiotivi-tvcanales';
var canalesPlaylistKey = 'radiotivi-tvcanales-alltxt';
var canalesGlobal = null;

// ========== STORAGE ==========
function loadFavsLocal() {
  try { var s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : { radio: [], tv: [] }; } catch(e) { return { radio: [], tv: [] }; }
}

function saveFavsLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favoritos));
}

function cacheCanales(arr, cc) {
  try { localStorage.setItem(cc ? canalesCacheKey + '-' + cc : canalesCacheKey, JSON.stringify(arr)); } catch(e) {}
}

function loadCachedCanales(cc) {
  try { var s = localStorage.getItem(cc ? canalesCacheKey + '-' + cc : canalesCacheKey); return s ? JSON.parse(s) : null; } catch(e) { return null; }
}

function cacheGlobalTvText(t) {
  try { localStorage.setItem(canalesPlaylistKey, t); } catch(e) {}
}

function loadCachedGlobalTvText() {
  try { return localStorage.getItem(canalesPlaylistKey); } catch(e) { return null; }
}

function ensureGlobalTv() {
  if (canalesGlobal) return Promise.resolve(canalesGlobal);
  var cached = loadCachedGlobalTvText();
  if (cached) {
    canalesGlobal = parseM3U(cached).filter(isPlayableTv);
    assignGlobalPais(canalesGlobal);
    return Promise.resolve(canalesGlobal);
  }
  return fetch(TV_SOURCES.playlist).then(function(r) { return r.text(); }).then(function(txt) {
    cacheGlobalTvText(txt);
    canalesGlobal = parseM3U(txt).filter(isPlayableTv);
    assignGlobalPais(canalesGlobal);
    return canalesGlobal;
  }).catch(function() {
    canalesGlobal = [];
    return canalesGlobal;
  });
}

function assignGlobalPais(list) {
  for (var i = 0; i < list.length; i++) {
    var cc = list[i].cc;
    if (!list[i].pais && cc) list[i].pais = tvCountryName(cc) || cc.toUpperCase();
  }
}

function cacheRadioCountries(arr) {
  try { localStorage.setItem(radioCountriesCacheKey, JSON.stringify(arr)); } catch(e) {}
}

function loadCachedRadioCountries() {
  try { var s = localStorage.getItem(radioCountriesCacheKey); return s ? JSON.parse(s) : null; } catch(e) { return null; }
}

// ========== SUPABASE ==========
function initSupabase() {
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

function handleGoogleLogin() {
  if (!supabaseClient) return;
  var btn = document.getElementById('btnGoogleLogin');
  btn.disabled = true;
  btn.innerHTML =
    '<svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 2v4"/></svg>' +
    ' Iniciando sesi\u00F3n\u2026';
  supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
}

function checkSession() {
  if (!supabaseClient) return Promise.resolve(null);
  return supabaseClient.auth.getSession().then(function(result) {
    var session = result.data ? result.data.session : null;
    if (!session) return null;
    return supabaseClient.from('allowed_emails')
      .select('email').in('app_id', [APP_ID, 'all'])
      .eq('email', session.user.email).maybeSingle()
      .then(function(res) {
        if (res.data) {
          currentUserEmail = session.user.email;
          return session.user.email;
        }
        supabaseClient.auth.signOut();
        showToast('No tienes permiso para acceder');
        return null;
      }).catch(function() {
        currentUserEmail = session.user.email;
        return session.user.email;
      });
  }).catch(function() { return null; });
}

function supabaseSaveFavs() {
  if (!supabaseClient || !currentUserEmail) return Promise.resolve();
  return supabaseClient.from('app_data').upsert({
    app_id: APP_ID,
    data: { favoritos: favoritos },
    updated_at: new Date().toISOString()
  }).then(function(res) {
    if (res.error) throw res.error;
  });
}

function supabaseLoadFavs() {
  if (!supabaseClient || !currentUserEmail) return Promise.resolve(null);
  return supabaseClient.from('app_data')
    .select('data').eq('app_id', APP_ID).maybeSingle()
    .then(function(res) {
      if (res.data && res.data.data && res.data.data.favoritos) return res.data.data.favoritos;
      return null;
    }).catch(function() { return null; });
}

function supabaseOnChange(payload) {
  if (!payload.new || !payload.new.data || !payload.new.data.favoritos) return;
  var incoming = payload.new.data.favoritos;
  if (!incoming) return;
  favoritos = {
    radio: incoming.radio || [],
    tv: incoming.tv || []
  };
  saveFavsLocal();
  if (currentView === 'radio') renderRadio();
  else if (currentView === 'tv') renderTv();
}

function supabaseSubscribe() {
  if (!supabaseClient || !currentUserEmail) return;
  supabaseChannel = supabaseClient.channel('radiotivi-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'app_data', filter: 'app_id=eq.' + APP_ID },
      supabaseOnChange
    )
    .subscribe();
}

function supabaseUnsubscribe() {
  if (supabaseChannel) {
    supabaseClient.removeChannel(supabaseChannel);
    supabaseChannel = null;
  }
}

// ========== AUTH UI ==========
function showLogin() {
  document.getElementById('viewLogin').classList.remove('hidden');
  document.getElementById('viewApp').classList.add('hidden');
}

function hideLogin() {
  document.getElementById('viewLogin').classList.add('hidden');
  document.getElementById('viewApp').classList.remove('hidden');
}

// ========== HELPERS ==========
function escapeHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str == null ? '' : str)));
  return div.innerHTML;
}

function showToast(msg) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(function() { toast.classList.remove('show'); }, 2000);
}
var toastTimeout;

var confirmCallback = null;
function showConfirm(message, onConfirm, buttonText) {
  confirmCallback = onConfirm;
  document.getElementById('confirmText').textContent = message;
  document.getElementById('btnConfirmOk').textContent = buttonText || 'Eliminar';
  document.getElementById('modalConfirm').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeConfirm() {
  confirmCallback = null;
  document.getElementById('modalConfirm').classList.remove('open');
  document.body.style.overflow = '';
}

function favKey(type, id) {
  return type + ':' + id;
}

function isFav(type, id) {
  var list = favoritos[type] || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return true;
  }
  return false;
}

function toggleFav(type, item) {
  var list = favoritos[type] || [];
  if (isFav(type, item.id)) {
    var nl = [];
    for (var i = 0; i < list.length; i++) if (list[i].id !== item.id) nl.push(list[i]);
    list = nl;
    showToast('Quitado de favoritos');
  } else {
    list.push(item);
    showToast('A\u00F1adido a favoritos');
  }
  favoritos[type] = list;
  saveFavsLocal();
  supabaseSaveFavs().catch(function() { showToast('Error al guardar favoritos'); });
  if (currentView === 'radio') renderRadio();
  else if (currentView === 'tv') renderTv();
}

// ========== SOURCE: RADIO ==========
function radioApiBase() {
  var bases = RADIO_SOURCES.api || ['https://de1.api.radio-browser.info'];
  return bases[Math.floor(Math.random() * bases.length)];
}

function loadRadioCountries() {
  var cached = loadCachedRadioCountries();
  if (cached && cached.length) {
    radioCountries = cached;
    populateRadioCountries();
    return;
  }
  var base = radioApiBase();
  fetch(base + '/json/countries').then(function(r) { return r.json(); }).then(function(d) {
    if (Array.isArray(d)) {
      d.sort(function(a, b) { return (b.stationcount || 0) - (a.stationcount || 0); });
      radioCountries = d;
      cacheRadioCountries(d);
      populateRadioCountries();
    }
  }).catch(function() {});
}

function isRadioTagBlocked(name) {
  if (!name) return true;
  var blocked = ['radio', 'estaci\u00F3n', 'm\u00E9xico', 'norteam\u00E9rica', 'stream',
    'audio', 'music radio', 'oi', 'EA1', '1.1', '1.0', 'welle', 'gayradio.it', 'usa', 'polska', 'germany'];
  return blocked.indexOf(name.toLowerCase()) !== -1;
}

function checkCountryHasCategories(code) {
  var base = radioApiBase();
  return fetch(base + '/json/stations/search?countrycode=' + encodeURIComponent(code) + '&order=votes&reverse=true&limit=5&hidebroken=true')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!Array.isArray(d)) return false;
      for (var i = 0; i < d.length; i++) {
        var tg = (d[i].tags || '').split(',')[0];
        if (tg && !isRadioTagBlocked(tg.trim())) return true;
      }
      return false;
    })
    .catch(function() { return true; });
}

function checkRadioActiveCountries() {
  if (radioActiveChecking) return;
  radioActiveChecking = true;
  try { var s = localStorage.getItem(radioActiveCountriesKey); } catch(e) { s = null; }
  if (s) {
    try { radioActiveCountries = JSON.parse(s); } catch(e) { radioActiveCountries = null; }
    if (radioActiveCountries && radioActiveCountries.length) {
      radioActiveChecking = false;
      populateRadioCountries();
      return;
    }
    radioActiveCountries = null;
  }
  var codes = radioCountries
    .filter(function(c) { return (c.stationcount || 0) > 0; })
    .map(function(c) { return c.iso_3166_1; });
  var active = [];
  var pos = 0;
  var CONC = 6;
  function step() {
    var end = Math.min(pos + CONC, codes.length);
    var batch = codes.slice(pos, end);
    pos = end;
    var tasks = [];
    for (var b = 0; b < batch.length; b++) tasks.push(checkCountryHasCategories(batch[b]));
    Promise.all(tasks).then(function(results) {
      for (var r = 0; r < results.length; r++) if (results[r]) active.push(batch[r]);
      if (pos < codes.length) {
        step();
      } else {
        radioActiveChecking = false;
        radioActiveCountries = active;
        try { localStorage.setItem(radioActiveCountriesKey, JSON.stringify(active)); } catch(e) {}
        populateRadioCountries();
      }
    });
  }
  step();
}

function populateRadioCountries() {
  var select = document.getElementById('radioCountrySelect');
  if (!select) return;
  var base = radioCountries.slice().filter(function(c) { return (c.stationcount || 0) > 0; });
  if (radioActiveCountries && radioActiveCountries.length) {
    base = base.filter(function(c) { return radioActiveCountries.indexOf(c.iso_3166_1) !== -1; });
  }
  if (radioCountryCode && radioActiveCountries && radioActiveCountries.length &&
      base.every(function(c) { return c.iso_3166_1 !== radioCountryCode; })) {
    radioCountryCode = '';
    radioCatCode = '';
    radios = [];
    renderRadio();
  }
  var sorted = base.sort(function(a, b) {
    if (a.iso_3166_1 === 'ES') return -1;
    if (b.iso_3166_1 === 'ES') return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  select.innerHTML = '<option value="">Pa\u00EDs</option>';
  for (var i = 0; i < sorted.length; i++) {
    var c = sorted[i];
    var opt = document.createElement('option');
    opt.value = c.iso_3166_1;
    opt.textContent = c.name;
    select.appendChild(opt);
  }
  select.value = radioCountryCode;
  if (!radioActiveCountries) checkRadioActiveCountries();
}

function radioCountryFullName(code) {
  if (!code) return '';
  var target = code.toLowerCase();
  for (var i = 0; i < radioCountries.length; i++) {
    if ((radioCountries[i].iso_3166_1 || '').toLowerCase() === target) return radioCountries[i].name || '';
  }
  return '';
}

function mapStation(s) {
  return {
    id: s.stationuuid || (s.name + '|' + (s.url_resolved || s.url)),
    nombre: s.name ? s.name.replace(/^\s+/, '') : 'Sin nombre',
    url: s.url_resolved || s.url,
    logo: s.favicon || '',
    pais: s.country || radioCountryFullName(s.countrycode) || (s.countrycode ? s.countrycode.toUpperCase() : ''),
    tags: s.tags || '',
    tipo: 'radio'
  };
}

function filterValidStations(data) {
  if (!Array.isArray(data)) return [];
  return data.filter(function(s) {
    var u = (s.url_resolved || s.url || '').trim();
    return u && s.lastcheckok === 1 && /^https?:\/\//i.test(u);
  }).map(mapStation);
}

function buildCountryCategories(stations) {
  var freq = {};
  for (var i = 0; i < stations.length; i++) {
    var tags = (stations[i].tags || '').split(',');
    for (var j = 0; j < tags.length; j++) {
      var tg = tags[j].trim();
      if (!tg || isRadioTagBlocked(tg)) continue;
      freq[tg] = (freq[tg] || 0) + 1;
    }
  }
  return Object.keys(freq).sort(function(a, b) {
    return (freq[b] - freq[a]) || a.localeCompare(b);
  });
}

function loadRadioCatOptions(cc) {
  if (!cc) { populateRadioTags([]); return; }
  var key = radioTagsCacheKey + '-v2-' + cc.toLowerCase();
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) {}
  if (cached && cached.length) {
    populateRadioTags(cached, cc);
    return;
  }
  var base = radioApiBase();
  fetch(base + '/json/stations/search?countrycode=' + encodeURIComponent(cc) + '&order=votes&reverse=true&limit=100&hidebroken=true')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (Array.isArray(d)) {
        var cats = buildCountryCategories(d);
        try { localStorage.setItem(key, JSON.stringify(cats)); } catch(e) {}
        populateRadioTags(cats, cc);
      } else {
        populateRadioTags([], cc);
      }
    }).catch(function() { populateRadioTags([], cc); });
}

function populateRadioTags(tags, cc) {
  if (cc && cc !== radioCountryCode) return;
  var select = document.getElementById('radioCatSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Categor\u00EDa</option>';
  var valid = [];
  for (var i = 0; i < tags.length; i++) {
    var t = typeof tags[i] === 'string' ? tags[i] : ((tags[i] && tags[i].name) || '');
    if (isRadioTagBlocked(t)) continue;
    valid.push(t);
    var opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  }
  if (cc && !valid.length) removeRadioCountryOption(cc);
}

function removeRadioCountryOption(cc) {
  var select = document.getElementById('radioCountrySelect');
  if (!select) return;
  var opt = select.querySelector('option[value="' + cc + '"]');
  if (opt) opt.parentNode.removeChild(opt);
  if (!radioActiveCountries) return;
  var idx = radioActiveCountries.indexOf(cc);
  if (idx !== -1) {
    radioActiveCountries.splice(idx, 1);
    try { localStorage.setItem(radioActiveCountriesKey, JSON.stringify(radioActiveCountries)); } catch(e) {}
  }
}

function loadRadioList() {
  if (!radioCountryCode || !radioCatCode) {
    radios = [];
    renderRadio();
    return;
  }
  var base = radioApiBase();
  var url = base + '/json/stations/search?countrycode=' + encodeURIComponent(radioCountryCode) +
    (radioCatCode ? '&tag=' + encodeURIComponent(radioCatCode) : '') +
    '&order=votes&reverse=true&limit=60&hidebroken=true';
  return fetch(url).then(function(r) { return r.json(); }).then(function(data) {
    radios = filterValidStations(data);
    renderRadio();
  }).catch(function() { radios = []; renderRadio(); });
}

function loadRadioCountry(cc) {
  radioCountryCode = cc || '';
  radiosSearchActive = false;
  radioCatCode = '';
  if (!radioCountryCode) {
    populateRadioTags([]);
    radios = [];
    renderRadio();
    return;
  }
  loadRadioCatOptions(radioCountryCode);
  renderRadio();
}

function loadRadioCategory(tag) {
  radioCatCode = tag || '';
  radiosSearchActive = false;
  if (!radioCatCode) {
    radios = [];
    renderRadio();
    return;
  }
  loadRadioList();
}

function searchRadio(q) {
  var base = radioApiBase();
  var url = base + '/json/stations/search?name=' + encodeURIComponent(q) +
    '&limit=60&hidebroken=true&order=votes&reverse=true';
  return fetch(url).then(function(r) { return r.json(); }).then(function(data) {
    return filterValidStations(data);
  }).catch(function() { return []; });
}

function renderRadio() {
  var container = document.getElementById('radioResults');
  var empty = document.getElementById('radioEmpty');
  var count = document.getElementById('radioCount');
  syncRadioFavButton();
  updateFilterStates();
  var q = (document.getElementById('radioSearch').value || '').trim();
  currentRadioList = radioFavOnly ? (favoritos.radio || []) : radios;
  var list = currentRadioList;

  if (!radioFavOnly && !q && (!radioCountryCode || !radioCatCode)) {
    container.innerHTML = '<div class="empty-content"><p class="empty-text">Selecciona un pa&iacute;s y una categor&iacute;a o busca una emisora</p></div>';
    if (count) count.textContent = '';
    empty.classList.add('hidden');
    currentRadioList = [];
    return;
  }
  if (count) {
    if (radioFavOnly) {
      count.textContent = list.length > 0 ? list.length + ' favoritos' : '';
    } else if (!list.length) {
      count.textContent = '';
    } else {
      count.textContent = list.length + ' emisoras';
    }
  }
  if (!list.length) {
    container.innerHTML = '';
    var vt = empty.querySelector('.empty-text');
    var vs = empty.querySelector('.empty-sub');
    if (radioFavOnly) {
      vt.textContent = 'No tienes favoritos';
      vs.innerHTML = 'Desactiva \u2665 Favoritos para ver emisoras y marca las que te gusten';
    } else {
      vt.textContent = 'Sin resultados';
      vs.textContent = 'Prueba otra b\u00FAsqueda o cambia los filtros';
    }
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  var html = '<div class="results-list-inner">';
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    var fav = isFav('radio', r.id);
    var pais = r.pais || radioCountryFullName(radioCountryCode);
    var tags = (r.tags || '').split(',').map(function(x) { return x.trim(); }).filter(function(x) { return x; });
    var metas = [];
    if (pais) metas.push(escapeHtml(pais));
    for (var ti = 0; ti < tags.length; ti++) metas.push(escapeHtml(tags[ti]));
    html += '<div class="result-item radio-item" data-idx="' + i + '">' +
      '<div class="result-logo"><span>&#127897;</span></div>' +
      '<div class="result-info" data-play="1">' +
        '<div class="result-name">' + escapeHtml(r.nombre) + '</div>' +
        (metas.length ? '<div class="result-meta"><span>' + metas.join('</span><span>') + '</span></div>' : '') +
      '</div>' +
      '<button class="btn-fav' + (fav ? ' active' : '') + '" data-fav="1" aria-label="Favorito">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="' + (fav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
      '</button>' +
    '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

// ========== AUDIO PLAYER ==========
function playRadio(r) {
  stopAudio(true);
  currentRadio = r;
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.preload = 'none';
    document.body.appendChild(audioEl);
  }
  audioEl.src = r.url;
  audioEl.play().then(function() {
    showAudioPlayer(r);
  }).catch(function() {
    showToast('No se pudo reproducir la emisora');
  });
  showAudioPlayer(r);
}

function showAudioPlayer(r) {
  var player = document.getElementById('audioPlayer');
  player.classList.remove('hidden');
  document.getElementById('audioTitle').textContent = r.nombre;
  document.getElementById('audioMeta').textContent = r.pais || 'En directo';
  updateAudioIcon(true);
}

function updateAudioIcon(playing) {
  document.getElementById('audioIconPlay').style.display = playing ? 'none' : '';
  document.getElementById('audioIconPause').style.display = playing ? '' : 'none';
}

function toggleAudio() {
  if (!audioEl || !currentRadio) return;
  if (audioEl.paused) {
    audioEl.play().then(function() { updateAudioIcon(true); }).catch(function() { showToast('No se pudo reproducir'); });
  } else {
    audioEl.pause();
    updateAudioIcon(false);
  }
}

function stopAudio(keepElement) {
  if (audioEl) {
    audioEl.pause();
    audioEl.src = '';
    audioEl.removeAttribute('src');
    try { audioEl.load(); } catch(e) {}
    if (!keepElement) { audioEl = null; }
  }
  currentRadio = null;
  updateAudioIcon(false);
  var player = document.getElementById('audioPlayer');
  if (player) player.classList.add('hidden');
}

// ========== SOURCE: TV ==========
function parseM3U(text) {
  var lines = text.split(/\r?\n/);
  var list = [];
  var i = 0;
  while (i < lines.length) {
    var line = (lines[i] || '').trim();
    if (line.indexOf('#EXTINF:') === 0) {
      var meta = line.substring(8);
      var tvgId = '';
      var logo = '';
      var group = '';
      var userAgent = '';
      var referrer = '';
      var m = meta.match(/tvg-id="([^"]*)"/i); if (m) tvgId = m[1];
      m = meta.match(/tvg-logo="([^"]*)"/i); if (m) logo = m[1];
      m = meta.match(/group-title="([^"]*)"/i); if (m) group = m[1];
      m = meta.match(/http-user-agent="([^"]*)"/i); if (m) userAgent = m[1];
      m = meta.match(/http-referrer="([^"]*)"/i); if (m) referrer = m[1];
      var cc = '';
      m = tvgId.match(/\.([a-z]{2})@/i); if (m) cc = m[1];
      var commaIdx = meta.indexOf(',');
      var name = commaIdx >= 0 ? meta.substring(commaIdx + 1).trim() : '';
      var skip = !!(userAgent || referrer);

      // Advance to the URL line: skip any #EXT... directives
      i++;
      var url = '';
      while (i < lines.length) {
        var l2 = (lines[i] || '').trim();
        if (/^#EXTVLCOPT/i.test(l2)) {
          if (/http-user-agent|http-referrer/i.test(l2)) skip = true;
          i++;
          continue;
        }
        if (l2.charAt(0) !== '#') { url = l2; i++; break; }
        i++;
      }

      if (url && !skip) {
        list.push({
          id: (name || url),
          nombre: name,
          url: url,
          logo: logo,
          grupo: group,
          cc: cc,
          tipo: 'tv'
        });
      }
    } else {
      i++;
    }
  }
  return list;
}

function sanitizeTvChannel(c) {
  // Only playable-in-browser streams: https, .m3u8 or compatible, no custom headers
  if (!/^https:\/\//i.test(c.url)) return false;
  if (!/\.m3u8/i.test(c.url) && !/\.mpd/i.test(c.url)) return false;
  return true;
}

function isPlayableTv(c) {
  return sanitizeTvChannel(c);
}

// TV country state
var tvCountries = [];
var tvCountryCode = '';
var tvCountryCacheKey = 'radiotivi-tvcounties';
var tvActiveCountries = null;
var tvActiveChecking = false;
var tvActiveCountriesKey = 'radiotivi-tvcountries-active';

function checkCountryPlaylist(code) {
  return fetch(TV_SOURCES.countryPlaylist(code), { method: 'HEAD' }).then(function(r) {
    return { code: code, ok: r.ok };
  }).catch(function() {
    return { code: code, ok: true };
  });
}

function checkTvActiveCountries() {
  if (tvActiveChecking) return;
  tvActiveChecking = true;
  try { var s = localStorage.getItem(tvActiveCountriesKey); } catch(e) { s = null; }
  if (s) {
    try { tvActiveCountries = JSON.parse(s); } catch(e) { tvActiveCountries = null; }
    if (tvActiveCountries && tvActiveCountries.length) {
      tvActiveChecking = false;
      refreshTvCountryOptions();
      return;
    }
    tvActiveCountries = null;
  }
  var codes = [];
  for (var i = 0; i < tvCountries.length; i++) codes.push(tvCountries[i].code);
  var active = [];
  var pos = 0;
  var CONC = 10;
  function step() {
    var end = Math.min(pos + CONC, codes.length);
    var tasks = [];
    for (var b = pos; b < end; b++) tasks.push(checkCountryPlaylist(codes[b]));
    pos = end;
    Promise.all(tasks).then(function(results) {
      for (var r = 0; r < results.length; r++) if (results[r].ok) active.push(results[r].code);
      if (pos < codes.length) {
        step();
      } else {
        tvActiveChecking = false;
        tvActiveCountries = active;
        try { localStorage.setItem(tvActiveCountriesKey, JSON.stringify(active)); } catch(e) {}
        refreshTvCountryOptions();
      }
    });
  }
  step();
}

function refreshTvCountryOptions() {
  populateTvCountries();
}

function tvCountryName(cc) {
  if (!cc) return '';
  var target = cc.toLowerCase();
  for (var i = 0; i < tvCountries.length; i++) {
    if ((tvCountries[i].code || '').toLowerCase() === target) return tvCountries[i].name || '';
  }
  return '';
}

function loadTvCountries() {
  try { var s = localStorage.getItem(tvCountryCacheKey); } catch(e) { s = null; }
  if (s) {
    try { tvCountries = JSON.parse(s); } catch(e) { tvCountries = []; }
    if (tvCountries.length) { populateTvCountries(); checkTvActiveCountries(); return; }
  }
  fetch(TV_SOURCES.countries).then(function(r) { return r.json(); }).then(function(d) {
    if (Array.isArray(d)) {
      tvCountries = d;
      try { localStorage.setItem(tvCountryCacheKey, JSON.stringify(d)); } catch(e) {}
      populateTvCountries();
    }
  }).catch(function() {});
}

function populateTvCountries() {
  var select = document.getElementById('tvCountrySelect');
  if (!select) return;
  var base = tvCountries.slice();
  if (tvActiveCountries && tvActiveCountries.length) {
    base = base.filter(function(c) { return tvActiveCountries.indexOf(c.code) !== -1; });
  }
  if (tvCountryCode && tvActiveCountries && tvActiveCountries.length &&
      base.every(function(c) { return c.code !== tvCountryCode; })) {
    tvCountryCode = '';
    canales = [];
    setupTvView();
  }
  var sorted = base.sort(function(a, b) {
    if (a.code === 'ES') return -1;
    if (b.code === 'ES') return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  select.innerHTML = '<option value="">Pa\u00EDs</option>';
  for (var i = 0; i < sorted.length; i++) {
    var c = sorted[i];
    if (!c.code) continue;
    var opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = (c.flag || '') + ' ' + (c.name || c.code);
    select.appendChild(opt);
  }
  select.value = tvCountryCode || '';
  if (!tvActiveCountries) checkTvActiveCountries();
}

function loadTv(cc) {
  tvCountryCode = cc || '';
  if (!tvCountryCode) {
    canales = [];
    setupTvView();
    return Promise.resolve(canales);
  }
  var status = document.getElementById('tvStatus');
  var pais = tvCountryName(tvCountryCode);
  var applyPais = function(list) {
    for (var i = 0; i < list.length; i++) list[i].pais = pais;
    return list;
  };
  if (status) status.textContent = 'Cargando canales de ' + tvCountryCode + '...';
  var cache = loadCachedCanales(tvCountryCode);
  if (cache && cache.length > 0) {
    canales = applyPais(cache);
    tvLoaded = true;
    if (status) status.textContent = '';
    setupTvView();
    return Promise.resolve(canales);
  }
  return fetch(TV_SOURCES.countryPlaylist(tvCountryCode))
    .then(function(r) { return r.text(); })
    .then(function(text) {
      var parsed = parseM3U(text);
      canales = applyPais(parsed.filter(isPlayableTv));
      cacheCanales(canales, tvCountryCode);
      tvLoaded = true;
      if (status) status.textContent = '';
      setupTvView();
      return canales;
    })
    .catch(function() {
      if (status) status.textContent = 'Error al cargar los canales. Comprueba tu conexi\u00F3n.';
      canales = [];
      setupTvView();
      return canales;
    });
}

function setupTvView() {
  tvGroupsBuilt = false;
  var group = document.getElementById('tvGroupSelect');
  if (group) group.value = '';
  populateTvGroups();
  renderTv();
}

function populateTvGroups() {
  var select = document.getElementById('tvGroupSelect');
  if (!select) return;
  tvGroupsBuilt = true;
  var grupos = {};
  for (var i = 0; i < canales.length; i++) {
    if (canales[i].grupo) {
      var parts = canales[i].grupo.split(';');
      for (var p = 0; p < parts.length; p++) {
        var g = parts[p].trim();
        if (g) grupos[g] = true;
      }
    }
  }
  var names = Object.keys(grupos).sort(function(a, b) { return a.localeCompare(b); });
  select.innerHTML = '<option value="">Categor\u00EDa</option>';
  for (var j = 0; j < names.length; j++) {
    var opt = document.createElement('option');
    opt.value = names[j];
    opt.textContent = names[j];
    select.appendChild(opt);
  }
}

function finalizeTvRender(container, count) {
  if (!tvFiltered.length) {
    if (tvFavOnly) {
      container.innerHTML = '<div class="empty-content"><p class="empty-text">No tienes favoritos</p><p class="empty-sub">Desactiva &hearts; Favoritos para ver canales y marca los que te gusten</p></div>';
    } else {
      container.innerHTML = '<div class="empty-content"><p class="empty-text">Sin resultados</p><p class="empty-sub">Prueba otra b&uacute;squeda o cambia los filtros</p></div>';
    }
    if (count) count.textContent = '0 canales';
    return;
  }
  tvShown = 0;
  container.innerHTML = '<div class="results-list-inner"></div>';
  tvRenderBatch();
}

function renderTv() {
  var container = document.getElementById('tvResults');
  var empty = document.getElementById('tvEmpty');
  var count = document.getElementById('tvCount');
  syncTvFavButton();
  updateFilterStates();

  empty.classList.add('hidden');

  var q = document.getElementById('tvSearch').value.trim().toLowerCase();

  if (tvFavOnly) {
    tvFiltered = (favoritos.tv || []).filter(function(c) {
      return !q || c.nombre.toLowerCase().indexOf(q) !== -1;
    });
    finalizeTvRender(container, count);
    return;
  }

  if (q) {
    container.innerHTML = '<div class="empty-content"><p class="empty-text">Buscando...</p></div>';
    if (count) count.textContent = '';
    var marker = q;
    ensureGlobalTv().then(function(global) {
      if (document.getElementById('tvSearch').value.trim().toLowerCase() !== marker) return;
      tvFiltered = global.filter(function(c) {
        return c.nombre.toLowerCase().indexOf(marker) !== -1;
      });
      finalizeTvRender(container, count);
    });
    return;
  }

  var grupo = document.getElementById('tvGroupSelect').value;
  if (!tvCountryCode || !canales.length || !grupo) {
    container.innerHTML = '<div class="empty-content"><p class="empty-text">Selecciona un pa&iacute;s y una categor&iacute;a o busca un canal de TV</p></div>';
    if (count) count.textContent = '';
    return;
  }

  tvFiltered = canales.filter(function(c) {
    if (!c.grupo) return false;
    var parts = c.grupo.split(';');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].trim() === grupo) return true;
    }
    return false;
  });
  finalizeTvRender(container, count);
}

function tvRenderBatch() {
  var container = document.getElementById('tvResults');
  var inner = container.querySelector('.results-list-inner');
  if (!inner) return;
  var html = '';
  var end = tvFiltered.length;
  for (var i = tvShown; i < end; i++) {
    var c = tvFiltered[i];
    var cPath = (c.pais || '').trim() || tvCountryName(tvCountryCode);
    var fav = isFav('tv', c.id);
    var metas = [];
    if (cPath) metas.push(escapeHtml(cPath));
    if (c.grupo) {
      var cats = c.grupo.split(';');
      for (var ci = 0; ci < cats.length; ci++) {
        var t = cats[ci].trim();
        if (t) metas.push(escapeHtml(t));
      }
    }
    html += '<div class="result-item tv-item" data-id="' + escapeHtml(c.id) + '">' +
      '<div class="result-logo"><span>&#128250;</span></div>' +
      '<div class="result-info" data-play="1">' +
        '<div class="result-name">' + escapeHtml(c.nombre) + '</div>' +
        (metas.length ? '<div class="result-meta"><span>' + metas.join('</span><span>') + '</span></div>' : '') +
      '</div>' +
      '<button class="btn-fav' + (fav ? ' active' : '') + '" data-fav="1" aria-label="Favorito">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="' + (fav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
      '</button>' +
    '</div>';
  }
  inner.insertAdjacentHTML('beforeend', html);
  tvShown = end;

  var count = document.getElementById('tvCount');
  if (count) {
    count.textContent = tvFavOnly
      ? tvFiltered.length + ' favoritos'
      : tvFiltered.length + ' canales';
  }
}

function syncTvFavButton() {
  var btn = document.getElementById('tvFavOnly');
  if (!btn) return;
  btn.classList.toggle('active', tvFavOnly);
  btn.setAttribute('aria-pressed', String(tvFavOnly));
}

function syncRadioFavButton() {
  var btn = document.getElementById('radioFavOnly');
  if (!btn) return;
  btn.classList.toggle('active', radioFavOnly);
  btn.setAttribute('aria-pressed', String(radioFavOnly));
}

function updateFilterStates() {
  var tvItems = ['tvCountrySelect', 'tvGroupSelect', 'tvSearch'];
  for (var t = 0; t < tvItems.length; t++) {
    var tel = document.getElementById(tvItems[t]);
    if (tel) tel.disabled = tvFavOnly;
  }
  var radItems = ['radioCountrySelect', 'radioCatSelect', 'radioSearch'];
  for (var r = 0; r < radItems.length; r++) {
    var rel = document.getElementById(radItems[r]);
    if (rel) rel.disabled = radioFavOnly;
  }
}

// ========== GOOGLE CAST ==========
var castInitAttempts = 0;
var castConnecting = false;
var castConnectTimer = null;
var castLoadTimer = null;
var castLoadAttempt = 0;
var castMedia = null;

function castReadySafe() {
  try {
    if (window.__CAST_AVAIL_RAW__ !== undefined) {
      castAvailable = !!window.__CAST_AVAIL_RAW__;
    }
    if (!castAvailable && typeof cast !== 'undefined' && cast.framework && cast.framework.CastContext) {
      castAvailable = true;
    }
    if (castAvailable && !castContext) {
      initializeCastApi();
    }
    updateCastButton();
    updateCastStatus();
  } catch (e) {
    if (castInitAttempts < 5) {
      castInitAttempts = castInitAttempts + 1;
      setTimeout(castReadySafe, 1000);
    } else {
      castAvailable = false;
      updateCastStatus();
    }
  }
}

function initializeCastApi() {
  castContext = cast.framework.CastContext.getInstance();
  castContext.setOptions({
    receiverApplicationId: CAST_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });
  var sm = castContext.getSessionManager();
  sm.addEventListener(cast.framework.SessionManagerEventType.SESSION_STARTED, function() {
    castSession = sm.getCurrentSession();
    castPlaybackStarted = false;
    castConnecting = false;
    if (castConnectTimer) { clearTimeout(castConnectTimer); castConnectTimer = null; }
    updateCastButton();
    updateCastStatus();
    try {
      if (castSession) {
        castSession.addMediaListener(function(data) {
          if (!data) return;
          var ms = data.media;
          if (ms && ms.playerState) {
            castMedia = ms;
            var wasPlaybackStarted = castPlaybackStarted;
            castPlaybackStarted = ms.playerState !== 'IDLE';
            if (castPlaybackStarted && !wasPlaybackStarted) {
              var stv = document.getElementById('videoStatus');
              if (stv) stv.textContent = 'Reproduciendo en la TV';
              castDiag('MEDIA_STATUS activo: ' + ms.playerState);
            } else if (!castPlaybackStarted && wasPlaybackStarted) {
              castDiag('MEDIA_STATUS: ' + ms.playerState);
            }
            updateCastButton();
          }
        });
      }
    } catch (e) {}
    if (currentTvChannel) {
      startCastPlayback(currentTvChannel);
    }
  });
  sm.addEventListener(cast.framework.SessionManagerEventType.SESSION_ENDED, function() {
    castSession = null;
    castMedia = null;
    castPlaybackStarted = false;
    castConnecting = false;
    castLoadAttempt = 0;
    if (castConnectTimer) { clearTimeout(castConnectTimer); castConnectTimer = null; }
    if (castLoadTimer) { clearTimeout(castLoadTimer); castLoadTimer = null; }
    updateCastButton();
    updateCastStatus();
    resumeLocalPlayback();
  });
  sm.addEventListener(cast.framework.SessionManagerEventType.SESSION_START_FAILED, function(ev) {
    var err = ev && ev.error;
    console.error('[Cast] SESSION_START_FAILED', err, castErrInfo(err));
    castConnecting = false;
    if (castConnectTimer) { clearTimeout(castConnectTimer); castConnectTimer = null; }
    updateCastButton();
    updateCastStatus();
    var st = document.getElementById('videoStatus');
    if (st) st.textContent = 'Error al conectar: ' + castErrInfo(err) + '. ' + castHint(err && err.code);
  });
  updateCastButton();
  updateCastStatus();
}

function isCasting() {
  return !!(castContext && castSession);
}

function updateCastStatus() {
  var el = document.getElementById('castStatus');
  if (!el) return;
  if (castAvailable) {
    el.textContent = 'Google Cast: disponible';
    el.classList.remove('no');
  } else {
    el.textContent = 'Google Cast: no disponible en este navegador';
    el.classList.add('no');
  }
}

function castFriendlyError(code) {
  if (code === 'timeout' || code === 6) return 'tiempo de espera agotado';
  if (code === 'cancel' || code === 5) return 'cancelado';
  if (code === 'receiver_unavailable' || code === 3) return 'receptor no disponible';
  if (code === 'session_error' || code === 8) return 'error de sesion';
  return 'error ' + (code || 'desconocido');
}

function castErrInfo(err) {
  try {
    if (!err) return 'error desconocido';
    var parts = [];
    if (err.code) parts.push('code=' + err.code);
    if (err.description) parts.push(err.description);
    if (err.details) parts.push(String(err.details));
    if (!parts.length) parts.push(String(err));
    return parts.join(' | ');
  } catch (e) {
    return 'error desconocido';
  }
}

function castHint(code) {
  if (code === 'session_error') return 'El receptor de la TV rechazo la sesion. Actualiza la app "Google Cast" en la TV (Play Store) y reinicia el Google TV.';
  if (code === 'timeout') return 'Tiempo de espera agotado al conectar. Reinicia el Google TV y reintenta.';
  return 'Si persiste, actualiza "Google Cast" en la TV y reinicia el Google TV.';
}

function castDiag(msg) {
  var el = document.getElementById('castDiag');
  if (!el) return;
  var t = new Date().toLocaleTimeString();
  el.textContent = '[' + t + '] ' + msg + '\n' + el.textContent;
}

function startCastPlayback(c) {
  if (!c || !castSession) return;
  var statusEl = document.getElementById('videoStatus');
  if (castLoadTimer) { clearTimeout(castLoadTimer); castLoadTimer = null; }
  castDiag('inicio loadMedia: ' + c.url);
  try {
    var url = c.url;
    var contentType = 'application/x-mpegURL';
    if (/\.mpd(?:\?|$)/i.test(url)) contentType = 'application/dash+xml';
    else if (/\.(mp4|m4v)(?:\?|$)/i.test(url)) contentType = 'video/mp4';
    else if (/\.(mp3|aac)(?:\?|$)/i.test(url)) contentType = 'audio/mpeg';
    var mediaInfo = new chrome.cast.media.MediaInfo(url, contentType);
    var meta = new chrome.cast.media.MediaMetadata(chrome.cast.media.MetadataType.TV_SHOW);
    meta.title = c.nombre;
    mediaInfo.metadata = meta;
    var request = new chrome.cast.media.LoadRequest(mediaInfo);
    castPlaybackStarted = false;
    updateCastButton();
    if (statusEl) statusEl.textContent = 'Preparando canal en la TV...';
    castDiag('enviando ' + contentType + ' (intento ' + (castLoadAttempt + 1) + ')');
    console.log('[Cast] loadMedia', url, contentType);

    castLoadTimer = setTimeout(function() {
      castLoadTimer = null;
      console.error('[Cast] loadMedia timeout sin confirmar');
      castDiag('timeout loadMedia (no confirmado). Reintentando...');
      if (castLoadAttempt < 1) {
        castLoadAttempt++;
        if (statusEl) statusEl.textContent = 'El canal tarda... reintentando';
        startCastPlayback(c);
      } else {
        castLoadAttempt = 0;
        if (statusEl) statusEl.textContent = 'No se pudo cargar el canal en la TV (el receptor tardó demasiado). Pulsa proyectar para reintentar.';
        var de = document.getElementById('castDiag');
        if (de && de.textContent) de.hidden = false;
      }
    }, 15000);

    castSession.loadMedia(request).then(function() {
      if (castLoadTimer) { clearTimeout(castLoadTimer); castLoadTimer = null; }
      castLoadAttempt = 0;
      castPlaybackStarted = true;
      updateCastButton();
      if (statusEl) statusEl.textContent = 'Reproduciendo en la TV';
      castDiag('loadMedia confirmado');
    }).catch(function(err) {
      if (castLoadTimer) { clearTimeout(castLoadTimer); castLoadTimer = null; }
      castLoadAttempt = 0;
      castPlaybackStarted = false;
      updateCastButton();
      console.error('[Cast] loadMedia error', err);
      if (statusEl) statusEl.textContent = 'No se pudo cargar el canal en la TV: ' + castFriendlyError(err && err.code) + '. Prueba otro canal.';
      castDiag('FALLO loadMedia: ' + castErrInfo(err));
      var de = document.getElementById('castDiag');
      if (de && de.textContent) de.hidden = false;
    });
  } catch (e) {
    console.error('[Cast] loadMedia throw', e);
    castPlaybackStarted = false;
    updateCastButton();
    if (statusEl) statusEl.textContent = 'No se pudo enviar a la TV';
    castDiag('throw loadMedia: ' + e);
  }
}

function toggleCast() {
  if (!castContext) {
    var st = document.getElementById('videoStatus');
    if (st) st.textContent = 'Tu navegador no soporta Chromecast';
    return;
  }
  if (castSession) {
    var active = false;
    if (castMedia && castMedia.playerState) {
      active = castMedia.playerState !== 'IDLE';
    }
    if (!active && currentTvChannel) {
      var stRe = document.getElementById('videoStatus');
      if (stRe) stRe.textContent = 'Reenviando canal a la TV...';
      startCastPlayback(currentTvChannel);
      return;
    }
    if (castConnectTimer) { clearTimeout(castConnectTimer); castConnectTimer = null; }
    castConnecting = false;
    if (castLoadTimer) { clearTimeout(castLoadTimer); castLoadTimer = null; }
    castPlaybackStarted = false;
    castContext.endCurrentSession(true);
    updateCastButton();
    var stEnd = document.getElementById('videoStatus');
    if (stEnd) stEnd.textContent = 'Proyección detenida';
    return;
  } else if (!castAvailable) {
    var stx = document.getElementById('videoStatus');
    if (stx) stx.textContent = 'Tu navegador no soporta Chromecast';
    return;
  } else if (castConnecting) {
    var stConn = document.getElementById('videoStatus');
    if (stConn) stConn.textContent = 'Conectando con el Google TV...';
    return;
  } else {
    castConnecting = true;
    var stc = document.getElementById('videoStatus');
    if (stc) stc.textContent = 'Conectando con el Google TV...';
    updateCastButton();
    if (castConnectTimer) { clearTimeout(castConnectTimer); castConnectTimer = null; }
    castConnectTimer = setTimeout(function() {
      castConnecting = false;
      castConnectTimer = null;
      updateCastButton();
      var stt = document.getElementById('videoStatus');
      if (stt && stt.textContent.indexOf('Conectando') !== -1) {
        stt.textContent = 'No se pudo conectar (tiempo agotado). Reinicia el Google TV y vuelve a intentar.';
      }
    }, 45000);
    castContext.requestSession().then(function() {
      castConnecting = false;
      if (castConnectTimer) { clearTimeout(castConnectTimer); castConnectTimer = null; }
      updateCastButton();
      console.log('[Cast] requestSession ok');
    }).catch(function(err) {
      castConnecting = false;
      if (castConnectTimer) { clearTimeout(castConnectTimer); castConnectTimer = null; }
      updateCastButton();
      console.error('[Cast] requestSession error', err, castErrInfo(err));
      var cur = null;
      try { cur = castContext.getCurrentSession(); } catch (e) {}
      if (cur) {
        castSession = cur;
        castPlaybackStarted = false;
        updateCastButton();
        updateCastStatus();
        var stC = document.getElementById('videoStatus');
        if (stC) stC.textContent = 'Reproduciendo en el Google TV...';
        if (currentTvChannel) startCastPlayback(currentTvChannel);
        return;
      }
      var ste = document.getElementById('videoStatus');
      if (ste) ste.textContent = 'No se pudo conectar: ' + castErrInfo(err) + '. ' + castHint(err && err.code);
    });
  }
}

function updateCastButton() {
  var btn = document.getElementById('castBtn');
  if (!btn) return;
  btn.hidden = false;
  var active = false;
  if (castSession) {
    if (castMedia && castMedia.playerState) {
      active = castMedia.playerState !== 'IDLE';
    } else {
      active = castPlaybackStarted;
    }
  }
  btn.classList.toggle('active', active);
  btn.classList.toggle('connecting', !!castConnecting || !!castLoadTimer);
}

function resumeLocalPlayback() {
  if (!currentTvChannel) return;
  var modal = document.getElementById('videoModal');
  if (!modal.classList.contains('open')) return;
  openVideoModal(currentTvChannel);
}

// ========== TV PLAYER ==========
function openVideoModal(c) {
  stopAudio();
  currentTvChannel = c;
  document.getElementById('videoTitle').textContent = c.nombre;
  var statusEl = document.getElementById('videoStatus');
  var video = document.getElementById('videoPlayer');
  video.pause();
  video.src = '';
  video.removeAttribute('src');
  try { video.load(); } catch(e) {}
  if (currentHls) { currentHls.destroy(); currentHls = null; }
  statusEl.textContent = 'Cargando...';
  var diagEl = document.getElementById('castDiag');
  if (diagEl) { diagEl.textContent = ''; diagEl.hidden = true; }
  document.getElementById('videoModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  updateCastButton();
  updateCastStatus();

  if (castSession) {
    statusEl.textContent = 'Enviando a TV...';
    startCastPlayback(c);
    return;
  }

  if (window.Hls && Hls.isSupported() && /\.m3u8/i.test(c.url)) {
    var hls = new Hls();
    currentHls = hls;
    hls.loadSource(c.url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      statusEl.textContent = '';
      video.play().catch(function() {});
    });
    hls.on(Hls.Events.ERROR, function(ev, data) {
      if (data && data.fatal) {
        statusEl.textContent = 'No se pudo reproducir este canal';
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = c.url;
    video.play().catch(function() {});
  } else if (/\.mpd/i.test(c.url)) {
    statusEl.textContent = 'Formato no soportado en este navegador';
  } else {
    video.src = c.url;
    video.play().catch(function() {});
  }
}

function closeVideoModal() {
  var video = document.getElementById('videoPlayer');
  if (video) { video.pause(); video.src = ''; video.removeAttribute('src'); try { video.load(); } catch(e) {} }
  if (currentHls) { currentHls.destroy(); currentHls = null; }
  currentTvChannel = null;
  document.getElementById('videoModal').classList.remove('open');
  document.body.style.overflow = '';
  var videoStatus = document.getElementById('videoStatus');
  if (videoStatus) videoStatus.textContent = '';
  updateCastButton();
  updateCastStatus();
}

// ========== NAVIGATION ==========
function switchView(view) {
  currentView = view;
  var navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(function(item) {
    item.classList.toggle('active', item.dataset.view === view);
  });
  ['viewRadio', 'viewTv', 'viewUsuarios'].forEach(function(v) {
    var el = document.getElementById(v);
    if (el) el.classList.remove('active');
  });
  if (view === 'radio') {
    document.getElementById('viewRadio').classList.add('active');
    document.getElementById('bottomNav').style.display = 'flex';
    document.getElementById('fabAdd').style.display = 'none';
    document.getElementById('btnBack').classList.remove('visible');
    document.getElementById('headerTitle').textContent = 'RADIOTIVI';
    renderRadio();
  } else if (view === 'tv') {
    document.getElementById('viewTv').classList.add('active');
    document.getElementById('bottomNav').style.display = 'flex';
    document.getElementById('fabAdd').style.display = 'none';
    document.getElementById('btnBack').classList.remove('visible');
    document.getElementById('headerTitle').textContent = 'RADIOTIVI';
    renderTv();
  } else if (view === 'usuarios') {
    document.getElementById('viewUsuarios').classList.add('active');
    document.getElementById('bottomNav').style.display = 'none';
    document.getElementById('fabAdd').style.display = '';
    document.getElementById('btnBack').classList.add('visible');
    renderUsuarios();
  }
}

// ========== ADMIN: USER MANAGEMENT ==========
function renderUsuarios() {
  if (!supabaseClient) return;
  supabaseClient.from('allowed_emails').select('email').eq('app_id', APP_ID).then(function(res) {
    var total = res.data ? res.data.length : 0;
    document.getElementById('headerTitle').textContent = 'RADIOTIVI: Usuarios (' + total + ')';
    var html = '';
    if (res.data) {
      var filtered = res.data.filter(function(r) { return r.email !== currentUserEmail; });
      for (var i = 0; i < filtered.length; i++) {
        html += '<div class="player-card" style="cursor:default">' +
          '<div class="player-info"><div class="player-name" style="font-size:14px;text-transform:none">' + escapeHtml(filtered[i].email) + '</div></div>' +
          '<button class="btn-edit" data-email="' + escapeHtml(filtered[i].email) + '" aria-label="Editar usuario">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button>' +
          '<button class="btn-delete" data-email="' + escapeHtml(filtered[i].email) + '" aria-label="Eliminar usuario">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>' +
          '</button></div>';
      }
    }
    document.getElementById('usuariosList').innerHTML = html || '<div class="empty-state"><p class="empty-title">No hay usuarios</p><p class="empty-sub">A\u00F1ade el primer email</p></div>';
  });
}

function openUsuarioModal(email) {
  document.getElementById('inviteEmail').value = email || '';
  document.getElementById('editUsuarioEmail').value = email || '';
  document.getElementById('usuarioModalTitle').textContent = email ? 'Editar usuario' : 'Nuevo usuario';
  document.getElementById('modalUsuario').classList.add('open');
  setTimeout(function() { document.getElementById('inviteEmail').focus(); }, 350);
}

function closeUsuarioModal() {
  document.getElementById('modalUsuario').classList.remove('open');
  document.getElementById('editUsuarioEmail').value = '';
}

function saveUsuario() {
  var input = document.getElementById('inviteEmail');
  var email = input.value.trim();
  if (!email || email.indexOf('@') === -1) {
    showToast('Email no v\u00E1lido');
    return;
  }
  if (!supabaseClient) return;
  var oldEmail = document.getElementById('editUsuarioEmail').value;
  var doInsert = function() {
    supabaseClient.from('allowed_emails').insert({ app_id: APP_ID, email: email }).then(function(res) {
      if (res.error) {
        showToast('Error al guardar: ' + res.error.message);
      } else {
        closeUsuarioModal();
        renderUsuarios();
        showToast(oldEmail ? 'Usuario actualizado' : 'Usuario a\u00F1adido');
      }
    });
  };
  if (oldEmail && oldEmail !== email) {
    supabaseClient.from('allowed_emails').delete().eq('app_id', APP_ID).eq('email', oldEmail).then(function(res) {
      if (res.error) {
        showToast('Error al actualizar');
      } else {
        doInsert();
      }
    });
  } else {
    doInsert();
  }
}

function removeUsuario(email) {
  showConfirm('\u00BF Eliminar a ' + email + '?', function() {
    supabaseClient.from('allowed_emails').delete().eq('app_id', APP_ID).eq('email', email).then(function(res) {
      if (res.error) {
        showToast('Error al eliminar');
      } else {
        renderUsuarios();
        showToast('Usuario eliminado');
      }
    });
  });
}

// ========== SERVICE WORKER ==========
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(function(reg) {
    reg.addEventListener('updatefound', function() {
      var nuevo = reg.installing;
      nuevo.addEventListener('statechange', function() {
        if (this.state === 'installed' && navigator.serviceWorker.controller) {
          showToast('Nueva versi\u00F3n disponible');
          this.postMessage({ action: 'skipWaiting' });
        }
      });
    });
  });
  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (refreshing) return;
    refreshing = true;     window.location.reload();
  });
}

// ========== INIT ==========
function init() {
  initSupabase();
  castReadySafe();

  checkSession().then(function(email) {
    if (email) {
      currentUserEmail = email;
      favoritos = loadFavsLocal();

      supabaseLoadFavs().then(function(remote) {
        if (remote) {
          favoritos = { radio: remote.radio || [], tv: remote.tv || [] };
          saveFavsLocal();
        }
        supabaseSubscribe();
        hideLogin();
        switchView('radio');
        bindEvents();
        loadRadioCountries();
        loadTvCountries();
      });
    } else {
      showLogin();
      document.getElementById('btnGoogleLogin').addEventListener('click', handleGoogleLogin);
    }
  });
}

function bindEvents() {
  // Radio search (live)
  var radioSearch = document.getElementById('radioSearch');
  radioSearch.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') renderRadio();
  });
  var radioSearchDebounce = null;
  radioSearch.addEventListener('input', function() {
    clearTimeout(radioSearchDebounce);
    radioSearchDebounce = setTimeout(function() {
      var q = radioSearch.value.trim();
      if (!q) {
        radiosSearchActive = false;
        loadRadioList();
        return;
      }
      radiosSearchActive = true;
      document.getElementById('radioResults').innerHTML = '<div class="empty-content"><p class="empty-text">Buscando...</p></div>';
      searchRadio(q).then(function(list) {
        radios = list;
        renderRadio();
      });
    }, 200);
  });

  // Radio country filter
  document.getElementById('radioCountrySelect').addEventListener('change', function() {
    var cc = this.value;
    radiosSearchActive = false;
    radioSearch.value = '';
    if (cc && radioCatCode) document.getElementById('radioResults').innerHTML = '<div class="empty-content"><p class="empty-text">Cargando emisoras...</p></div>';
    loadRadioCountry(cc);
  });

  // Radio category filter
  document.getElementById('radioCatSelect').addEventListener('change', function() {
    var tag = this.value;
    radiosSearchActive = false;
    radioSearch.value = '';
    if (tag && radioCountryCode) document.getElementById('radioResults').innerHTML = '<div class="empty-content"><p class="empty-text">Cargando emisoras...</p></div>';
    loadRadioCategory(tag);
  });

  // Radio favorites only toggle
  document.getElementById('radioFavOnly').addEventListener('click', function() {
    radioFavOnly = !radioFavOnly;
    this.classList.toggle('active', radioFavOnly);
    this.setAttribute('aria-pressed', String(radioFavOnly));
    renderRadio();
  });

  // TV search (live)
  var tvSearch = document.getElementById('tvSearch');
  tvSearch.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') renderTv();
  });
  var tvSearchDebounce = null;
  tvSearch.addEventListener('input', function() {
    clearTimeout(tvSearchDebounce);
    tvSearchDebounce = setTimeout(renderTv, 200);
  });

  // TV group filter
  document.getElementById('tvGroupSelect').addEventListener('change', renderTv);

  // TV country filter
  document.getElementById('tvCountrySelect').addEventListener('change', function() {
    var cc = this.value;
    document.getElementById('tvSearch').value = '';
    var status = document.getElementById('tvStatus');
    if (!cc) {
      if (status) status.textContent = '';
      tvCountryCode = '';
      canales = [];
      tvLoaded = false;
      setupTvView();
      return;
    }
    tvCountryCode = cc;
    document.getElementById('tvResults').innerHTML = '';
    if (status) status.textContent = 'Cargando canales de ' + cc + '...';
    loadTv(cc);
  });

  // TV favorites only toggle
  document.getElementById('tvFavOnly').addEventListener('click', function() {
    tvFavOnly = !tvFavOnly;
    this.classList.toggle('active', tvFavOnly);
    this.setAttribute('aria-pressed', String(tvFavOnly));
    renderTv();
  });

  // Radio results clicks
  document.getElementById('radioResults').addEventListener('click', function(e) {
    var btnFav = e.target.closest('.btn-fav');
    if (btnFav) {
      var item = e.target.closest('.result-item');
      var idx = parseInt(item.dataset.idx, 10);
      if (idx >= 0 && currentRadioList[idx]) toggleFav('radio', currentRadioList[idx]);
      return;
    }
    var play = e.target.closest('[data-play]');
    if (play) {
      var it = e.target.closest('.result-item');
      var idxi = parseInt(it.dataset.idx, 10);
      if (idxi >= 0 && currentRadioList[idxi]) playRadio(currentRadioList[idxi]);
    }
  });

  // TV results clicks (delegated, canal por id)
  document.getElementById('tvResults').addEventListener('click', function(e) {
    var findChannel = function(idInput) {
      for (var k = 0; k < canales.length; k++) if (canales[k].id === idInput) return canales[k];
      var favs = favoritos.tv || [];
      for (var f = 0; f < favs.length; f++) if (favs[f].id === idInput) return favs[f];
      if (canalesGlobal) {
        for (var g = 0; g < canalesGlobal.length; g++) if (canalesGlobal[g].id === idInput) return canalesGlobal[g];
      }
      return null;
    };
    var btnFav = e.target.closest('.btn-fav');
    if (btnFav) {
      var it = e.target.closest('.result-item');
      var id = it.dataset.id;
      var ch = findChannel(id);
      if (ch) toggleFav('tv', ch);
      return;
    }
    var play = e.target.closest('[data-play]');
    if (play) {
      var it2 = e.target.closest('.result-item');
      var id2 = it2.dataset.id;
      var ch2 = findChannel(id2);
      if (ch2) openVideoModal(ch2);
    }
  });

  // Nav
  document.querySelectorAll('.nav-item').forEach(function(item) {
    item.addEventListener('click', function() { switchView(this.dataset.view); });
  });

  // Logo -> admin user management
  document.getElementById('btnLogo').addEventListener('click', function() {
    if (currentUserEmail !== ADMIN_EMAIL) return;
    if (currentView === 'usuarios') {
      switchView('radio');
    } else {
      switchView('usuarios');
    }
  });

  // Back button
  document.getElementById('btnBack').addEventListener('click', function() {
    if (currentView === 'usuarios') {
      switchView('radio');
    }
  });

  // FAB (solo visible en usuarios: anade usuario)
  document.getElementById('fabAdd').addEventListener('click', function() {
    if (currentView === 'usuarios') {
      openUsuarioModal();
    }
  });

  // User management modal
  document.getElementById('modalUsuarioClose').addEventListener('click', closeUsuarioModal);
  document.getElementById('modalUsuarioOverlay').addEventListener('click', closeUsuarioModal);
  document.getElementById('usuariosList').addEventListener('click', function(e) {
    if (e.target.closest('.btn-delete')) {
      removeUsuario(e.target.closest('.btn-delete').dataset.email);
    } else if (e.target.closest('.btn-edit')) {
      openUsuarioModal(e.target.closest('.btn-edit').dataset.email);
    }
  });
  document.getElementById('usuarioForm').addEventListener('submit', function(e) {
    e.preventDefault();
    saveUsuario();
  });

  // Audio player controls
  document.getElementById('audioToggle').addEventListener('click', toggleAudio);
  document.getElementById('audioClose').addEventListener('click', function() { stopAudio(false); });

  // Video modal
  document.getElementById('videoModalClose').addEventListener('click', closeVideoModal);
  document.getElementById('videoModalOverlay').addEventListener('click', closeVideoModal);
  document.getElementById('castBtn').addEventListener('click', toggleCast);

  // Confirm
  document.getElementById('btnConfirmOk').addEventListener('click', function() {
    if (confirmCallback) confirmCallback();
    closeConfirm();
  });
  document.getElementById('btnConfirmCancel').addEventListener('click', closeConfirm);
  document.getElementById('modalConfirmOverlay').addEventListener('click', closeConfirm);
}

document.addEventListener('DOMContentLoaded', init);