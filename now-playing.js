// Now Playing page logic for MyVoice Studio

// NOTE: This page intentionally does NOT embed any API keys.
// AI analysis is fetched from an optional backend endpoint (/api/analyze).

let demos = [];
let currentIndex = 0;
let shuffleEnabled = false;
let repeatEnabled = false;

const RING_CIRCUMFERENCE = 2 * Math.PI * 52; // r=52 matches SVG circle

// ===== IndexedDB (read uploaded audio/cover blobs stored by Home page) =====
const IDB_NAME = 'myvoice-studio';
const IDB_STORE = 'files';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initializeTheme();
  loadDemosFromStorage();

  const startId = getSelectedDemoIdFromQuery();
  if (startId !== null) {
    const idx = demos.findIndex((d) => d.id === startId);
    if (idx >= 0) currentIndex = idx;
  }

  bindUi();
  void syncTrackUi(false);
});

function $(id) {
  return document.getElementById(id);
}

function initializeTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') document.body.classList.add('light-mode');
  const toggle = $('themeToggle');
  toggle?.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    const theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
    localStorage.setItem('theme', theme);
  });
}

function getSelectedDemoIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const idStr = params.get('id');
  if (!idStr) return null;
  const id = Number(idStr);
  return Number.isFinite(id) ? id : null;
}

function loadDemosFromStorage() {
  const stored = localStorage.getItem('demos');
  demos = stored ? JSON.parse(stored) : [];

  // If audioUrl isn't present (e.g., reloaded page), attempt to map to bundled songs folder.
  // This helps during the UI stage if you place mp3 files under `My songs/`.
  demos = demos.map((d) => {
    if (!d.audioUrl && !d.audioKey && d.audioFile) {
      d.audioUrl = `My songs/${encodeURIComponent(d.audioFile)}`;
    }
    if (!d.coverUrl) {
      // keep null; UI will fallback
      d.coverUrl = null;
    }
    return d;
  });
}

function bindUi() {
  const audio = $('audioEl');
  const ring = $('ringProgress');
  const cover = $('playerCover');
  const playBtn = $('playPauseBtn');

  // Initialize ring
  if (ring) {
    ring.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
    ring.style.strokeDashoffset = `${RING_CIRCUMFERENCE}`;
  }

  $('homeBtn')?.addEventListener('click', () => (window.location.href = 'index.html'));
  $('backIconBtn')?.addEventListener('click', () => (window.location.href = 'index.html'));
  $('searchIconBtn')?.addEventListener('click', () => (window.location.href = 'index.html'));

  $('prevBtn')?.addEventListener('click', () => void playPrev());
  $('nextBtn')?.addEventListener('click', () => void playNext());
  $('shuffleBtn')?.addEventListener('click', () => toggleShuffle());
  $('repeatBtn')?.addEventListener('click', () => toggleRepeat());

  playBtn?.addEventListener('click', () => {
    if (!audio) return;
    if (audio.paused) audio.play();
    else audio.pause();
  });

  audio?.addEventListener('loadedmetadata', () => {
    $('totalTime').textContent = formatTime(audio.duration || 0);
  });

  audio?.addEventListener('timeupdate', () => {
    $('elapsedTime').textContent = formatTime(audio.currentTime || 0);
    updateRingProgress(audio.currentTime || 0, audio.duration || 0);
  });

  audio?.addEventListener('play', () => {
    playBtn?.classList.add('playing');
    cover?.classList.add('rotating');
  });

  audio?.addEventListener('pause', () => {
    playBtn?.classList.remove('playing');
    cover?.classList.remove('rotating');
  });

  audio?.addEventListener('ended', () => {
    if (repeatEnabled) {
      audio.currentTime = 0;
      audio.play();
      return;
    }
    void playNext(true);
  });

  // AI analysis modal
  $('aiBtn')?.addEventListener('click', openAnalysisModal);
  $('closeAnalysisModal')?.addEventListener('click', closeAnalysisModal);
  $('closeAnalysisBtn')?.addEventListener('click', closeAnalysisModal);
  $('analysisModal')?.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'analysisModal') closeAnalysisModal();
  });
  $('saveAnalysisBtn')?.addEventListener('click', saveAnalysisForCurrent);
  $('regenerateAnalysisBtn')?.addEventListener('click', () => regenerateAnalysisForCurrent());
}

async function syncTrackUi(autoplay = false) {
  const demo = demos[currentIndex];
  const audio = $('audioEl');
  const cover = $('playerCover');

  if (!demo) {
    $('trackName').textContent = 'No song selected';
    $('topbarTrackName').textContent = '—';
    $('analysisSongTitle').textContent = '—';
    if (audio) audio.src = '';
    if (cover) cover.src = '';
    return;
  }

  const title = demo.name || demo.audioFile || 'Untitled';
  $('trackName').textContent = title;
  $('topbarTrackName').textContent = title;
  $('analysisSongTitle').textContent = title;

  // Hydrate from IndexedDB if present
  if (demo.audioKey && !demo.audioUrl) {
    try {
      const blob = await idbGet(demo.audioKey);
      if (blob) demo.audioUrl = URL.createObjectURL(blob);
    } catch (_) {}
  }
  if (demo.coverKey && !demo.coverUrl) {
    try {
      const blob = await idbGet(demo.coverKey);
      if (blob) demo.coverUrl = URL.createObjectURL(blob);
    } catch (_) {}
  }

  // Cover
  if (cover) {
    cover.src = demo.coverUrl || fallbackCoverFor(title);
    cover.onerror = () => {
      cover.src = fallbackCoverFor(title);
    };
  }

  // Audio source
  if (audio) {
    audio.loop = !!repeatEnabled;
    audio.src = demo.audioUrl || '';
    audio.load();
    $('elapsedTime').textContent = '0:00';
    $('totalTime').textContent = '0:00';
    updateRingProgress(0, 0);
    if (autoplay) audio.play().catch(() => {});
  }
}

function updateRingProgress(current, duration) {
  const ring = $('ringProgress');
  if (!ring) return;
  if (!duration || duration <= 0) {
    ring.style.strokeDashoffset = `${RING_CIRCUMFERENCE}`;
    return;
  }
  const progress = Math.max(0, Math.min(1, current / duration));
  ring.style.strokeDashoffset = `${RING_CIRCUMFERENCE * (1 - progress)}`;
}

async function playPrev() {
  if (!demos.length) return;
  currentIndex = (currentIndex - 1 + demos.length) % demos.length;
  await syncTrackUi(true);
}

async function playNext(fromEnded = false) {
  if (!demos.length) return;

  if (shuffleEnabled) {
    currentIndex = getRandomIndexExcluding(currentIndex, demos.length);
  } else {
    currentIndex = (currentIndex + 1) % demos.length;
  }

  // If we reached end and it wasn't fromEnded, still play next as requested
  await syncTrackUi(true);
}

function getRandomIndexExcluding(exclude, length) {
  if (length <= 1) return 0;
  let idx = exclude;
  while (idx === exclude) idx = Math.floor(Math.random() * length);
  return idx;
}

function toggleShuffle() {
  shuffleEnabled = !shuffleEnabled;
  $('shuffleBtn')?.classList.toggle('active', shuffleEnabled);
  if (shuffleEnabled) {
    // Immediately jump to a random song if user wants
    currentIndex = getRandomIndexExcluding(currentIndex, demos.length);
    void syncTrackUi(true);
  }
}

function toggleRepeat() {
  repeatEnabled = !repeatEnabled;
  $('repeatBtn')?.classList.toggle('active', repeatEnabled);
  const audio = $('audioEl');
  if (audio) audio.loop = !!repeatEnabled;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function fallbackCoverFor(seed) {
  // deterministic-ish fallback via gradient-like data URL
  const hue = hashString(seed) % 360;
  const hue2 = (hue + 60) % 360;
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 90%, 60%)"/>
        <stop offset="100%" stop-color="hsl(${hue2}, 90%, 55%)"/>
      </linearGradient>
    </defs>
    <rect width="600" height="600" rx="48" fill="url(#g)"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// ===== AI Analysis Modal =====
function analysisKeyForCurrent() {
  const demo = demos[currentIndex];
  return demo ? `analysis:${demo.id}` : null;
}

function openAnalysisModal() {
  const modal = $('analysisModal');
  if (!modal) return;
  modal.classList.add('show');

  const key = analysisKeyForCurrent();
  const cached = key ? localStorage.getItem(key) : null;
  if (cached) {
    showAnalysisText(cached);
    return;
  }

  generateAnalysisForCurrent(false);
}

function closeAnalysisModal() {
  $('analysisModal')?.classList.remove('show');
}

function setAnalysisLoading(isLoading) {
  const loading = $('analysisLoading');
  const text = $('analysisText');
  if (!loading || !text) return;
  loading.style.display = isLoading ? 'block' : 'none';
  text.style.display = isLoading ? 'none' : 'block';
}

function showAnalysisText(content) {
  const text = $('analysisText');
  if (!text) return;
  setAnalysisLoading(false);
  text.textContent = content;
}

function saveAnalysisForCurrent() {
  const key = analysisKeyForCurrent();
  const text = $('analysisText')?.textContent || '';
  if (!key || !text) return;
  localStorage.setItem(key, text);
}

function regenerateAnalysisForCurrent() {
  const key = analysisKeyForCurrent();
  if (key) localStorage.removeItem(key);
  generateAnalysisForCurrent(true);
}

async function generateAnalysisForCurrent(force) {
  const demo = demos[currentIndex];
  if (!demo) return;
  setAnalysisLoading(true);

  // Attempt backend call. If it fails, fall back to a local placeholder analysis.
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songName: demo.name || demo.audioFile || 'Untitled',
        demoId: demo.id,
        // Note: We are not sending raw audio here in this UI stage.
      }),
    });

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    const content = typeof data?.analysis === 'string' ? data.analysis : JSON.stringify(data, null, 2);
    showAnalysisText(content);
    return;
  } catch (e) {
    // fallback
    const content = buildPlaceholderAnalysis(demo);
    showAnalysisText(content);
  }
}

function buildPlaceholderAnalysis(demo) {
  const title = demo.name || demo.audioFile || 'Untitled';
  const dims = [
    'Breath control & support',
    'Tone quality & timbre',
    'Emotional delivery & storytelling',
    'Pitch & intonation',
    'Vocal technique (register balance / mixed voice)',
    'Rhythm & time feel',
    'Dynamics & control',
    'Diction & articulation',
    'Musical phrasing',
    'Style & genre awareness',
    'Vocal health & tension',
    'Professional readiness',
  ];

  // deterministic scores from id
  const base = (hashString(String(demo.id)) % 1000) / 1000;
  const scores = dims.map((_, i) => {
    const v = (base * 7.5 + (i * 0.23)) % 10;
    return Math.max(0, Math.min(10, Math.round(v * 10) / 10));
  });
  const finalScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;

  const lines = [];
  lines.push(`Song: ${title}`);
  lines.push('');
  lines.push('Scores (0–10):');
  dims.forEach((d, i) => lines.push(`- ${d}: ${scores[i]}`));
  lines.push('');
  lines.push(`Final score (avg): ${finalScore}`);
  lines.push('');
  lines.push('Strengths (example):');
  lines.push('- Clear diction on sustained phrases; good vowel consistency on mid-range notes.');
  lines.push('- Solid rhythmic placement in steady sections; you land phrase endings confidently.');
  lines.push('');
  lines.push('Weaknesses (example):');
  lines.push('- Breath support fades in longer lines; consider quicker, quieter replenishment breaths.');
  lines.push('- Intonation drifts slightly in ascending passages; stabilize with lighter onset.');
  lines.push('');
  lines.push('Suggested exercises (weekly):');
  lines.push('- Straw phonation (3–5 mins): gentle slides from low to high to reduce tension.');
  lines.push('- Sirens on “ng” (5 mins): smooth register transitions; keep jaw relaxed.');
  lines.push('- Metronome vowels (5 mins): “ah/eh/ee” on 8th notes to lock time feel.');
  lines.push('');
  lines.push('References:');
  lines.push('- YouTube: search “straw phonation exercise singing”');
  lines.push('- Article: search “semi-occluded vocal tract exercises SOVT”');
  lines.push('');
  lines.push('Note: This is a UI-stage placeholder analysis. To generate real GPT-5.2 output, host a secure backend at /api/analyze (never put API keys in the browser).');
  return lines.join('\n');
}


