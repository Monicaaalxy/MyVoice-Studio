// ===== App State =====
let demos = [];
let currentAudioFile = null;
let currentCoverFile = null;
let editingDemoId = null;
let isOwner = false; // Owner authentication state
let ownerPassword = null; // Stored password for API calls
let playerState = {
    activeDemoId: null,
    currentIndex: 0,
    shuffle: false,
    repeat: false
};

const objectUrlRegistry = new Map(); // key -> objectURL (for cleanup)

// ===== IndexedDB (store uploaded audio/cover blobs securely on device) =====
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

async function idbPut(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

async function idbDelete(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
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

function registerObjectUrl(key, url) {
    const prev = objectUrlRegistry.get(key);
    if (prev && prev !== url) URL.revokeObjectURL(prev);
    objectUrlRegistry.set(key, url);
}

function cleanupObjectUrl(key) {
    const prev = objectUrlRegistry.get(key);
    if (prev) URL.revokeObjectURL(prev);
    objectUrlRegistry.delete(key);
}

function fallbackCoverFor(seed) {
    const hue = hashString(seed || 'MyVoice') % 360;
    const hue2 = (hue + 70) % 360;
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
    for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
}

// Random gradient colors for demo covers
const gradientColors = [
    ['#667eea', '#764ba2'],
    ['#f093fb', '#f5576c'],
    ['#4facfe', '#00f2fe'],
    ['#43e97b', '#38f9d7'],
    ['#fa709a', '#fee140'],
    ['#30cfd0', '#330867'],
    ['#a8edea', '#fed6e3'],
    ['#ff9a9e', '#fecfef'],
    ['#ffecd2', '#fcb69f'],
    ['#ff6e7f', '#bfe9ff'],
    ['#e0c3fc', '#8ec5fc'],
    ['#f5576c', '#f093fb']
];

// Random Pexels image URLs (fallback if no cover is uploaded)
const pexelsImages = [
    'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=600',
    'https://images.pexels.com/photos/167636/pexels-photo-167636.jpeg?auto=compress&cs=tinysrgb&w=600',
    'https://images.pexels.com/photos/1337380/pexels-photo-1337380.jpeg?auto=compress&cs=tinysrgb&w=600',
    'https://images.pexels.com/photos/1626481/pexels-photo-1626481.jpeg?auto=compress&cs=tinysrgb&w=600',
    'https://images.pexels.com/photos/3721941/pexels-photo-3721941.jpeg?auto=compress&cs=tinysrgb&w=600',
    'https://images.pexels.com/photos/164829/pexels-photo-164829.jpeg?auto=compress&cs=tinysrgb&w=600',
    'https://images.pexels.com/photos/1047442/pexels-photo-1047442.jpeg?auto=compress&cs=tinysrgb&w=600',
    'https://images.pexels.com/photos/210887/pexels-photo-210887.jpeg?auto=compress&cs=tinysrgb&w=600'
];

// ===== Initialize App =====
document.addEventListener('DOMContentLoaded', () => {
    // Phones may still have an old PWA Service Worker installed from earlier versions.
    // That can serve stale CSS/JS and make "light mode" look wrong. This app is web-only now,
    // so we proactively unregister any SWs and clear old caches.
    cleanupLegacyServiceWorkersAndCaches().catch(() => {});

    initializeApp();
    // Check if owner was previously logged in
    checkOwnerSession();
    // Load demos from API
    loadDemosFromAPI().then(() => {
        renderDemos();
        routeFromLocation();
    });
    
    // Event Listeners - Upload Modal
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('searchInput').addEventListener('input', handleSearch);
    document.getElementById('uploadDemo').addEventListener('change', handleAudioSelect);
    document.getElementById('uploadCover').addEventListener('change', handleCoverSelect);
    document.getElementById('selectCoverBtn').addEventListener('click', () => {
        document.getElementById('uploadCover').click();
    });
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('cancelUpload').addEventListener('click', closeModal);
    document.getElementById('confirmUpload').addEventListener('click', confirmUpload);
    
    // Event Listeners - Edit Modal
    document.getElementById('closeEditModal').addEventListener('click', closeEditModal);
    document.getElementById('cancelEdit').addEventListener('click', closeEditModal);
    document.getElementById('confirmEdit').addEventListener('click', confirmEdit);
    document.getElementById('reuploadCoverBtn').addEventListener('click', () => {
        document.getElementById('editCoverInput').click();
    });
    document.getElementById('reshuffleCoverBtn').addEventListener('click', reshuffleCover);
    document.getElementById('editCoverInput').addEventListener('change', handleEditCoverSelect);
    
    // Event Listeners - Delete Modal
    document.getElementById('closeDeleteModal').addEventListener('click', closeDeleteModal);
    document.getElementById('cancelDelete').addEventListener('click', closeDeleteModal);
    document.getElementById('confirmDelete').addEventListener('click', confirmDelete);
    
    // Close modals on outside click
    document.getElementById('uploadModal').addEventListener('click', (e) => {
        if (e.target.id === 'uploadModal') {
            closeModal();
        }
    });
    document.getElementById('editModal').addEventListener('click', (e) => {
        if (e.target.id === 'editModal') {
            closeEditModal();
        }
    });
    document.getElementById('deleteModal').addEventListener('click', (e) => {
        if (e.target.id === 'deleteModal') {
            closeDeleteModal();
        }
    });

    // Owner login/logout
    document.getElementById('ownerLoginBtn')?.addEventListener('click', openOwnerLoginModal);
    document.getElementById('ownerLogoutBtn')?.addEventListener('click', logoutOwner);
    document.getElementById('closeOwnerLoginModal')?.addEventListener('click', closeOwnerLoginModal);
    document.getElementById('cancelOwnerLogin')?.addEventListener('click', closeOwnerLoginModal);
    document.getElementById('confirmOwnerLogin')?.addEventListener('click', attemptOwnerLogin);
    document.getElementById('ownerLoginModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'ownerLoginModal') closeOwnerLoginModal();
    });
    document.getElementById('ownerPassword')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptOwnerLogin();
    });

    // Router
    window.addEventListener('hashchange', routeFromLocation);

    // Player UI bindings (in-app Now Playing + mini player)
    bindPlayerUi();
});

async function cleanupLegacyServiceWorkersAndCaches() {
    if (!('serviceWorker' in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));

    if (!('caches' in window)) return;
    const keys = await caches.keys();
    const legacy = keys.filter((k) => k.startsWith('myvoice-studio'));
    await Promise.all(legacy.map((k) => caches.delete(k)));
}

// ===== Initialize App =====
function initializeApp() {
    // Load theme preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
    }
    syncThemeColorMeta();
}

// ===== Owner Authentication =====
function checkOwnerSession() {
    const savedPassword = sessionStorage.getItem('ownerPassword');
    if (savedPassword) {
        ownerPassword = savedPassword;
        isOwner = true;
        updateOwnerUI();
    }
}

function openOwnerLoginModal() {
    document.getElementById('ownerLoginModal').classList.add('show');
    document.getElementById('ownerPassword').value = '';
    document.getElementById('ownerLoginError').style.display = 'none';
    document.getElementById('ownerPassword').focus();
}

function closeOwnerLoginModal() {
    document.getElementById('ownerLoginModal').classList.remove('show');
}

async function attemptOwnerLogin() {
    const password = document.getElementById('ownerPassword').value;
    if (!password) return;

    // Test the password by making a request to the API
    try {
        const res = await fetch('/api/demos', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Owner-Password': password
            },
            body: JSON.stringify({ demo: { name: '__test__' } })
        });

        // If unauthorized, show error
        if (res.status === 401) {
            document.getElementById('ownerLoginError').style.display = 'block';
            return;
        }

        // If we got here with a different error, the password is correct
        // (The test demo will fail validation but that's ok)
        ownerPassword = password;
        isOwner = true;
        sessionStorage.setItem('ownerPassword', password);
        updateOwnerUI();
        closeOwnerLoginModal();
        
        // Reload demos to show edit/delete buttons
        renderDemos();
    } catch (e) {
        console.error('Login error:', e);
        document.getElementById('ownerLoginError').style.display = 'block';
    }
}

function logoutOwner() {
    isOwner = false;
    ownerPassword = null;
    sessionStorage.removeItem('ownerPassword');
    updateOwnerUI();
    renderDemos();
}

function updateOwnerUI() {
    const loginBtn = document.getElementById('ownerLoginBtn');
    const logoutBtn = document.getElementById('ownerLogoutBtn');
    const uploadBtn = document.getElementById('uploadDemoBtn');

    if (isOwner) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'flex';
        uploadBtn.style.display = 'flex';
    } else {
        loginBtn.style.display = 'flex';
        logoutBtn.style.display = 'none';
        uploadBtn.style.display = 'none';
    }
}

// ===== API Functions =====
async function loadDemosFromAPI() {
    try {
        const res = await fetch('/api/demos');
        if (!res.ok) throw new Error('Failed to load demos');
        const data = await res.json();
        demos = data.demos || [];
    } catch (e) {
        console.error('Error loading demos:', e);
        demos = [];
    }
}

// ===== Theme Toggle =====
function toggleTheme() {
    document.body.classList.toggle('light-mode');
    const theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
    localStorage.setItem('theme', theme);
    syncThemeColorMeta();
}

function syncThemeColorMeta() {
    const meta = document.querySelector('meta[name=\"theme-color\"]');
    if (!meta) return;
    const isLight = document.body.classList.contains('light-mode');
    // Match our gradients so mobile browser UI (address bar) also looks consistent.
    meta.setAttribute('content', isLight ? '#fff5f9' : '#1e3a8a');
}

function showView(view) {
    const home = document.getElementById('homeView');
    const player = document.getElementById('playerView');
    const report = document.getElementById('reportView');
    if (!home || !player) return;

    const isPlayer = view === 'player';
    const isReport = view === 'report';
    const isHome = !isPlayer && !isReport;

    home.classList.toggle('app-view-hidden', !isHome);
    player.classList.toggle('app-view-hidden', !isPlayer);
    player.setAttribute('aria-hidden', (!isPlayer).toString());
    
    if (report) {
        report.classList.toggle('app-view-hidden', !isReport);
        report.setAttribute('aria-hidden', (!isReport).toString());
    }

    // Hide fixed theme toggle when in player/report view (they have their own)
    const fixedTheme = document.getElementById('themeToggle');
    if (fixedTheme) fixedTheme.classList.toggle('app-view-hidden', isPlayer || isReport);

    // Only show mini player on Home
    if (isPlayer || isReport) {
        showMiniPlayer(false);
        hideMiniVolumePopover();
    }
}

function routeFromLocation() {
    const hash = window.location.hash || '#home';
    if (hash.startsWith('#now-playing')) {
        showView('player');
        const params = new URLSearchParams(hash.split('?')[1] || '');
        const id = Number(params.get('id'));
        if (Number.isFinite(id)) openDemo(id, { autoplay: false, fromRoute: true });
    } else if (hash === '#report') {
        showView('report');
    } else {
        showView('home');
    }
}

// ===== Audio File Selection =====
function handleAudioSelect(e) {
    const file = e.target.files[0];
    if (file && file.type.includes('audio')) {
        const fileSizeMB = file.size / (1024 * 1024);
        currentAudioFile = file;
        document.getElementById('audioFileName').textContent = `${file.name} (${fileSizeMB.toFixed(1)}MB)`;
        document.getElementById('songName').value = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
        openModal();
    } else {
        alert('Please select a valid MP3 audio file');
    }
}

// ===== Cover Image Selection =====
function handleCoverSelect(e) {
    const file = e.target.files[0];
    if (file && file.type.includes('image')) {
        currentCoverFile = file;
        // Show cover preview
        const reader = new FileReader();
        reader.onload = function(ev) {
            const previewContainer = document.getElementById('coverPreview');
            if (previewContainer) {
                previewContainer.innerHTML = `<img src="${ev.target.result}" alt="Cover preview" style="width: 100%; max-width: 150px; border-radius: 12px; margin-top: 8px;">`;
                previewContainer.style.display = 'block';
            }
        };
        reader.readAsDataURL(file);
        
        // Update button text
        const selectBtn = document.getElementById('selectCoverBtn');
        if (selectBtn) {
            selectBtn.textContent = 'Change Cover Image';
        }
    }
}

// ===== Modal Functions =====
function openModal() {
    document.getElementById('uploadModal').classList.add('show');
}

function closeModal() {
    document.getElementById('uploadModal').classList.remove('show');
    currentAudioFile = null;
    currentCoverFile = null;
    document.getElementById('songName').value = '';
    document.getElementById('audioFileName').textContent = 'No file selected';
    // Reset cover preview
    const coverPreview = document.getElementById('coverPreview');
    if (coverPreview) {
        coverPreview.innerHTML = '';
        coverPreview.style.display = 'none';
    }
    const selectBtn = document.getElementById('selectCoverBtn');
    if (selectBtn) {
        selectBtn.textContent = 'Select Cover Image';
    }
}

// ===== Confirm Upload =====
async function confirmUpload() {
    if (!isOwner) {
        alert('Only the owner can upload demos');
        return;
    }

    const songName = document.getElementById('songName').value.trim();
    
    if (!songName) {
        alert('Please enter a song name');
        return;
    }
    
    if (!currentAudioFile) {
        alert('No audio file selected');
        return;
    }
    
    // Show loading state
    const confirmBtn = document.getElementById('confirmUpload');
    const originalText = confirmBtn.textContent;
    confirmBtn.textContent = 'Uploading...';
    confirmBtn.disabled = true;
    
    try {
        // Always upload audio in chunks to avoid Netlify request-body limits that can surface as "Internal Error (500)".
        const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB

        // 1) init demo (metadata + optional cover)
        const initFd = new FormData();
        initFd.append('name', songName);
        initFd.append('audioFile', currentAudioFile.name);

        if (currentCoverFile) {
            initFd.append('cover', currentCoverFile);
            initFd.append('coverType', 'uploaded');
        } else {
            const randomCover = pexelsImages[Math.floor(Math.random() * pexelsImages.length)];
            initFd.append('coverUrl', randomCover);
            initFd.append('coverType', 'random');
        }

        const initRes = await fetch('/api/upload-demo-init', {
            method: 'POST',
            headers: { 'X-Owner-Password': ownerPassword },
            body: initFd
        });
        if (!initRes.ok) {
            const t = await initRes.text();
            throw new Error(`Init upload failed (${initRes.status}): ${t.slice(0, 180)}`);
        }
        const initData = await initRes.json();
        const demoId = initData?.demo?.id;
        if (!demoId) throw new Error('Init upload failed: missing demo id');

        // 2) upload audio chunks
        const total = Math.ceil(currentAudioFile.size / CHUNK_SIZE);
        for (let i = 0; i < total; i++) {
            confirmBtn.textContent = `Uploading... (${i + 1}/${total})`;
            const start = i * CHUNK_SIZE;
            const end = Math.min(currentAudioFile.size, start + CHUNK_SIZE);
            const chunkBlob = currentAudioFile.slice(start, end);

            const chunkFd = new FormData();
            chunkFd.append('id', String(demoId));
            chunkFd.append('index', String(i));
            chunkFd.append('total', String(total));
            chunkFd.append('contentType', currentAudioFile.type || 'audio/mpeg');
            chunkFd.append('chunk', chunkBlob, `chunk-${i}`);

            const chunkRes = await fetch('/api/upload-audio-chunk', {
                method: 'POST',
                headers: { 'X-Owner-Password': ownerPassword },
                body: chunkFd
            });
            if (!chunkRes.ok) {
                const t = await chunkRes.text();
                throw new Error(`Chunk ${i + 1}/${total} failed (${chunkRes.status}): ${t.slice(0, 180)}`);
            }
        }

        // 3) complete
        confirmBtn.textContent = 'Finalizing...';
        const completeRes = await fetch('/api/upload-audio-complete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Owner-Password': ownerPassword
            },
            body: JSON.stringify({
                id: String(demoId),
                total,
                contentType: currentAudioFile.type || 'audio/mpeg'
            })
        });
        if (!completeRes.ok) {
            const t = await completeRes.text();
            throw new Error(`Finalize failed (${completeRes.status}): ${t.slice(0, 180)}`);
        }

        await loadDemosFromAPI();
        renderDemos();
        closeModal();
    } catch (e) {
        console.error('Upload error:', e);
        alert('Failed to upload demo: ' + e.message);
    } finally {
        // Reset button state
        confirmBtn.textContent = originalText;
        confirmBtn.disabled = false;
        // Reset file input
        document.getElementById('uploadDemo').value = '';
        document.getElementById('uploadCover').value = '';
    }
}

// Helper to convert file to base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ===== Render Demos =====
function renderDemos(filteredDemos = null) {
    const demoGrid = document.getElementById('demoGrid');
    const emptyState = document.getElementById('emptyState');
    const demosToRender = filteredDemos || demos;
    
    if (demosToRender.length === 0) {
        demoGrid.innerHTML = '';
        emptyState.classList.add('show');
        return;
    }
    
    emptyState.classList.remove('show');
    demoGrid.innerHTML = demosToRender.map(demo => {
        const coverSrc = demo.coverType === 'uploaded' 
            ? `/api/demo-audio?id=${demo.id}&type=cover`
            : (demo.coverUrl || fallbackCoverFor(demo.name));
        return `
        <div class="demo-card" data-id="${demo.id}">
            <div class="demo-cover-container">
                <img src="${coverSrc}" alt="${demo.name}" class="demo-cover">
                ${isOwner ? `
                <div class="demo-actions">
                    <button class="demo-action-btn edit-btn" data-action="edit" data-id="${demo.id}" 
                            aria-label="Edit demo" title="Edit">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="demo-action-btn delete-btn" data-action="delete" data-id="${demo.id}" 
                            aria-label="Delete demo" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </div>
                ` : ''}
            </div>
            <div class="demo-name">${demo.name}</div>
            <div class="demo-info">${formatDate(demo.uploadDate)}</div>
        </div>
    `;
    }).join('');
    
    // Add click listeners
    document.querySelectorAll('.demo-cover-container').forEach(container => {
        const card = container.closest('.demo-card');
        container.addEventListener('click', (e) => {
            // Only open demo if not clicking on action buttons
            if (!e.target.closest('.demo-action-btn')) {
                const demoId = parseInt(card.dataset.id);
                openDemo(demoId);
            }
        });
    });
    
    // Add listeners for edit and delete buttons
    document.querySelectorAll('.demo-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const demoId = parseInt(btn.dataset.id);
            
            if (action === 'edit') {
                openEditModal(demoId);
            } else if (action === 'delete') {
                openDeleteModal(demoId);
            }
        });
    });
}

// ===== Search Functionality =====
function handleSearch(e) {
    const searchTerm = e.target.value.toLowerCase().trim();
    
    if (!searchTerm) {
        renderDemos();
        return;
    }
    
    const filteredDemos = demos.filter(demo => 
        demo.name.toLowerCase().includes(searchTerm)
    );
    
    renderDemos(filteredDemos);
}

// ===== Open Demo =====
async function openDemo(demoId, opts = { autoplay: true, fromRoute: false }) {
    const demo = demos.find(d => d.id === demoId);
    if (!demo) return;

    // Check if same track is already loaded → just switch view, don't reload
    const alreadyLoaded = playerState.activeDemoId === demoId;

    playerState.activeDemoId = demoId;
    playerState.currentIndex = demos.findIndex(d => d.id === demoId);

    if (!opts.fromRoute) {
        window.location.hash = `#now-playing?id=${encodeURIComponent(demoId)}`;
    }

    showView('player');

    // Only reload track if it's a different song
    if (!alreadyLoaded) {
        await loadTrackIntoPlayer(opts.autoplay);
    } else {
        // Same track: just sync the UI without reloading audio
        syncPlayerUi();
    }
    showMiniPlayer(true);
}

// ===== Edit Modal Functions =====
function openEditModal(demoId) {
    const demo = demos.find(d => d.id === demoId);
    if (!demo) return;
    
    editingDemoId = demoId;
    document.getElementById('editSongName').value = demo.name;
    document.getElementById('editModal').classList.add('show');
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('show');
    editingDemoId = null;
    document.getElementById('editSongName').value = '';
    document.getElementById('editCoverInput').value = '';
}

function handleEditCoverSelect(e) {
    const file = e.target.files[0];
    if (file && file.type.includes('image')) {
        currentCoverFile = file;
    }
}

function reshuffleCover() {
    // Just mark that we want to reshuffle - will apply on save
    currentCoverFile = 'reshuffle';
}

async function confirmEdit() {
    if (!isOwner) {
        alert('Only the owner can edit demos');
        return;
    }

    const newName = document.getElementById('editSongName').value.trim();
    
    if (!newName) {
        alert('Please enter a song name');
        return;
    }
    
    try {
        // Use FormData for file uploads
        const formData = new FormData();
        formData.append('id', editingDemoId.toString());
        formData.append('name', newName);
        
        // Update cover if changed
        if (currentCoverFile === 'reshuffle') {
            const randomCover = pexelsImages[Math.floor(Math.random() * pexelsImages.length)];
            formData.append('coverUrl', randomCover);
            formData.append('coverType', 'random');
        } else if (currentCoverFile && currentCoverFile !== 'reshuffle') {
            formData.append('cover', currentCoverFile);
            formData.append('coverType', 'uploaded');
        }
        
        const res = await fetch('/api/update-demo', {
            method: 'POST',
            headers: {
                'X-Owner-Password': ownerPassword
            },
            body: formData
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Update failed');
        }

        // Reload demos from API
        await loadDemosFromAPI();
        renderDemos();
        closeEditModal();
    } catch (e) {
        console.error('Update error:', e);
        alert('Failed to update demo: ' + e.message);
    }
    
    currentCoverFile = null;
}

// ===== Delete Modal Functions =====
function openDeleteModal(demoId) {
    const demo = demos.find(d => d.id === demoId);
    if (!demo) return;
    
    editingDemoId = demoId;
    document.getElementById('deleteSongName').textContent = demo.name;
    document.getElementById('deleteModal').classList.add('show');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('show');
    editingDemoId = null;
}

async function confirmDelete() {
    if (!isOwner) {
        alert('Only the owner can delete demos');
        return;
    }

    try {
        const res = await fetch(`/api/demos?id=${editingDemoId}`, {
            method: 'DELETE',
            headers: {
                'X-Owner-Password': ownerPassword
            }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Delete failed');
        }

        // Remove from local array
        demos = demos.filter(d => d.id !== editingDemoId);
        renderDemos();
        closeDeleteModal();
    } catch (e) {
        console.error('Delete error:', e);
        alert('Failed to delete demo: ' + e.message);
    }
}

// ===== Demo Audio Loading =====
async function loadDemoAudio(demoId) {
    try {
        const res = await fetch(`/api/demo-audio?id=${demoId}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.audioData;
    } catch (e) {
        console.error('Error loading audio:', e);
        return null;
    }
}

// ===== Player (Now Playing + mini player) =====
const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

function bindPlayerUi() {
    const audio = document.getElementById('audioEl');
    const ring = document.getElementById('ringProgress');
    const cover = document.getElementById('playerCover');
    const playBtn = document.getElementById('playPauseBtn');

    // Initialize ring
    if (ring) {
        ring.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
        ring.style.strokeDashoffset = `${RING_CIRCUMFERENCE}`;
    }

    document.getElementById('homeBtn')?.addEventListener('click', () => {
        // Return to Home view but keep audio playing
        window.location.hash = '#home';
        showMiniPlayer(true);
    });
    document.getElementById('backIconBtn')?.addEventListener('click', () => {
        window.location.hash = '#home';
        showMiniPlayer(true);
    });

    document.getElementById('prevBtn')?.addEventListener('click', () => playerPrev());
    document.getElementById('nextBtn')?.addEventListener('click', () => playerNext());
    document.getElementById('shuffleBtn')?.addEventListener('click', () => toggleShuffle());
    document.getElementById('repeatBtn')?.addEventListener('click', () => toggleRepeat());

    playBtn?.addEventListener('click', () => {
        if (!audio) return;
        if (audio.paused) audio.play();
        else audio.pause();
    });

    // Volume
    document.getElementById('volumeBtn')?.addEventListener('click', () => toggleVolumePopover());
    document.getElementById('volumePopover')?.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
        const pop = document.getElementById('volumePopover');
        const btn = document.getElementById('volumeBtn');
        if (!pop || !btn) return;
        if (!pop.classList.contains('app-view-hidden')) {
            if (e.target !== pop && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
                hideVolumePopover();
            }
        }
    });
    document.getElementById('volumeSlider')?.addEventListener('input', (e) => {
        if (!audio) return;
        const v = Number(e.target.value);
        audio.volume = Number.isFinite(v) ? v : 1;
        // Sync with mini volume slider
        const miniSlider = document.getElementById('miniVolumeSlider');
        if (miniSlider) miniSlider.value = v;
    });

    // ===== Progress ring seek functionality =====
    const playerRing = document.getElementById('playerRing');
    const ringHitarea = document.getElementById('ringHitarea');
    let isSeeking = false;

    function getSeekPositionFromEvent(e, ringElement) {
        const rect = ringElement.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Get client coordinates (works for both mouse and touch)
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        // Calculate angle from center (0 = top, clockwise)
        const dx = clientX - centerX;
        const dy = clientY - centerY;
        let angle = Math.atan2(dx, -dy); // -dy because y-axis is inverted in screen coords

        // Convert to 0-1 range (0 = top, 1 = full circle back to top)
        if (angle < 0) angle += 2 * Math.PI;
        return angle / (2 * Math.PI);
    }

    function seekToPosition(progress) {
        if (!audio || !audio.duration || !Number.isFinite(audio.duration)) return;
        const newTime = progress * audio.duration;
        audio.currentTime = Math.max(0, Math.min(newTime, audio.duration));
        updateRingProgress(audio.currentTime, audio.duration);
        document.getElementById('elapsedTime').textContent = formatTime(audio.currentTime);
    }

    function startSeek(e) {
        if (!audio || !audio.duration) return;
        isSeeking = true;
        playerRing?.classList.add('seeking');
        const progress = getSeekPositionFromEvent(e, playerRing);
        seekToPosition(progress);
    }

    function moveSeek(e) {
        if (!isSeeking || !audio || !audio.duration) return;
        e.preventDefault();
        const progress = getSeekPositionFromEvent(e, playerRing);
        seekToPosition(progress);
    }

    function endSeek() {
        isSeeking = false;
        playerRing?.classList.remove('seeking');
    }

    // Mouse events
    ringHitarea?.addEventListener('mousedown', startSeek);
    document.addEventListener('mousemove', moveSeek);
    document.addEventListener('mouseup', endSeek);

    // Touch events
    ringHitarea?.addEventListener('touchstart', startSeek, { passive: false });
    document.addEventListener('touchmove', moveSeek, { passive: false });
    document.addEventListener('touchend', endSeek);

    audio?.addEventListener('loadedmetadata', () => {
        document.getElementById('totalTime').textContent = formatTime(audio.duration || 0);
    });

    audio?.addEventListener('timeupdate', () => {
        document.getElementById('elapsedTime').textContent = formatTime(audio.currentTime || 0);
        updateRingProgress(audio.currentTime || 0, audio.duration || 0);
    });

    audio?.addEventListener('play', () => {
        playBtn?.classList.add('playing');
        cover?.classList.add('rotating');
        document.getElementById('miniPlayBtn')?.classList.add('playing');
        showMiniPlayer(true);
    });

    audio?.addEventListener('pause', () => {
        playBtn?.classList.remove('playing');
        cover?.classList.remove('rotating');
        document.getElementById('miniPlayBtn')?.classList.remove('playing');
        showMiniPlayer(true);
    });

    audio?.addEventListener('ended', () => {
        if (playerState.repeat) {
            audio.currentTime = 0;
            audio.play();
            return;
        }
        playerNext(true);
    });

    // Mini player controls
    document.getElementById('miniPrevBtn')?.addEventListener('click', () => playerPrev());
    document.getElementById('miniNextBtn')?.addEventListener('click', () => playerNext());
    document.getElementById('miniShuffleBtn')?.addEventListener('click', () => toggleShuffle(true));
    document.getElementById('miniRepeatBtn')?.addEventListener('click', () => toggleRepeat(true));
    document.getElementById('miniPlayBtn')?.addEventListener('click', () => {
        if (!audio) return;
        if (audio.paused) audio.play();
        else audio.pause();
    });
    document.getElementById('miniTitleBtn')?.addEventListener('click', () => {
        if (playerState.activeDemoId) window.location.hash = `#now-playing?id=${encodeURIComponent(playerState.activeDemoId)}`;
    });

    // Mini volume controls
    document.getElementById('miniVolumeBtn')?.addEventListener('click', toggleMiniVolumePopover);
    document.getElementById('miniVolumeSlider')?.addEventListener('input', (e) => {
        const vol = parseFloat(e.target.value);
        if (audio) audio.volume = vol;
        // Sync with main volume slider
        const mainSlider = document.getElementById('volumeSlider');
        if (mainSlider) mainSlider.value = vol;
    });

    // Theme toggle in player topbar
    document.getElementById('playerThemeBtn')?.addEventListener('click', toggleTheme);

    // AI modal handlers
    document.getElementById('aiBtn')?.addEventListener('click', openAnalysisModal);
    document.getElementById('closeAnalysisModal')?.addEventListener('click', closeAnalysisModal);
    document.getElementById('closeAnalysisBtn')?.addEventListener('click', closeAnalysisModal);
    document.getElementById('analysisModal')?.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'analysisModal') closeAnalysisModal();
    });
    document.getElementById('saveAnalysisBtn')?.addEventListener('click', saveAnalysisForCurrent);
    document.getElementById('regenerateAnalysisBtn')?.addEventListener('click', () => regenerateAnalysisForCurrent());
}

function showMiniPlayer(show) {
    const mini = document.getElementById('miniPlayer');
    if (!mini) return;
    const hasActive = !!playerState.activeDemoId;
    const inPlayerView = (window.location.hash || '').startsWith('#now-playing');
    const shouldShow = show && hasActive && !inPlayerView;
    mini.classList.toggle('app-view-hidden', !shouldShow);
    mini.setAttribute('aria-hidden', (!shouldShow).toString());
}

function toggleVolumePopover() {
    const pop = document.getElementById('volumePopover');
    if (!pop) return;
    const willShow = pop.classList.contains('app-view-hidden');
    pop.classList.toggle('app-view-hidden', !willShow);
    pop.setAttribute('aria-hidden', (!willShow).toString());
}

function hideVolumePopover() {
    const pop = document.getElementById('volumePopover');
    if (!pop) return;
    pop.classList.add('app-view-hidden');
    pop.setAttribute('aria-hidden', 'true');
}

function toggleMiniVolumePopover() {
    const pop = document.getElementById('miniVolumePopover');
    if (!pop) return;
    const willShow = pop.classList.contains('app-view-hidden');
    pop.classList.toggle('app-view-hidden', !willShow);
    pop.setAttribute('aria-hidden', (!willShow).toString());
    // Sync slider with current audio volume
    if (willShow) {
        const audio = document.getElementById('audioEl');
        const slider = document.getElementById('miniVolumeSlider');
        if (audio && slider) slider.value = audio.volume;
    }
}

function hideMiniVolumePopover() {
    const pop = document.getElementById('miniVolumePopover');
    if (!pop) return;
    pop.classList.add('app-view-hidden');
    pop.setAttribute('aria-hidden', 'true');
}

async function loadTrackIntoPlayer(autoplay) {
    const demo = demos[playerState.currentIndex];
    if (!demo) return;

    const title = demo.name || demo.audioFile || 'Untitled';
    document.getElementById('trackName').textContent = title;
    document.getElementById('topbarTrackName').textContent = title;
    document.getElementById('analysisSongTitle').textContent = title;
    document.getElementById('miniTitle').textContent = title;

    const cover = document.getElementById('playerCover');
    if (cover) {
        const coverSrc = demo.coverType === 'uploaded' 
            ? `/api/demo-audio?id=${demo.id}&type=cover`
            : (demo.coverUrl || fallbackCoverFor(title));
        cover.src = coverSrc;
    }

    const audio = document.getElementById('audioEl');
    if (audio) {
        audio.loop = !!playerState.repeat;
        
        // Use direct blob URL for audio
        audio.src = `/api/demo-audio?id=${demo.id}&type=audio`;
        audio.load();
        document.getElementById('elapsedTime').textContent = '0:00';
        document.getElementById('totalTime').textContent = '0:00';
        updateRingProgress(0, 0);
        if (autoplay) audio.play().catch(() => {});
    }
}

function updateRingProgress(current, duration) {
    const ring = document.getElementById('ringProgress');
    if (!ring) return;
    if (!duration || duration <= 0) {
        ring.style.strokeDashoffset = `${RING_CIRCUMFERENCE}`;
        return;
    }
    const progress = Math.max(0, Math.min(1, current / duration));
    ring.style.strokeDashoffset = `${RING_CIRCUMFERENCE * (1 - progress)}`;
}

// Sync player UI to current audio state (used when returning to player view)
function syncPlayerUi() {
    const audio = document.getElementById('audioEl');
    const playBtn = document.getElementById('playPauseBtn');
    const cover = document.getElementById('playerCover');
    const miniPlayBtn = document.getElementById('miniPlayBtn');

    if (!audio) return;

    const isPlaying = !audio.paused;
    playBtn?.classList.toggle('playing', isPlaying);
    cover?.classList.toggle('rotating', isPlaying);
    miniPlayBtn?.classList.toggle('playing', isPlaying);

    // Update elapsed/total time
    document.getElementById('elapsedTime').textContent = formatTime(audio.currentTime);
    document.getElementById('totalTime').textContent = formatTime(audio.duration);
    updateRingProgress(audio.currentTime, audio.duration);
}

function playerPrev() {
    if (!demos.length) return;
    playerState.currentIndex = (playerState.currentIndex - 1 + demos.length) % demos.length;
    playerState.activeDemoId = demos[playerState.currentIndex].id;
    loadTrackIntoPlayer(true);
}

function playerNext() {
    if (!demos.length) return;
    if (playerState.shuffle) {
        playerState.currentIndex = getRandomIndexExcluding(playerState.currentIndex, demos.length);
    } else {
        playerState.currentIndex = (playerState.currentIndex + 1) % demos.length;
    }
    playerState.activeDemoId = demos[playerState.currentIndex].id;
    loadTrackIntoPlayer(true);
}

function getRandomIndexExcluding(exclude, length) {
    if (length <= 1) return 0;
    let idx = exclude;
    while (idx === exclude) idx = Math.floor(Math.random() * length);
    return idx;
}

function toggleShuffle(fromMini = false) {
    playerState.shuffle = !playerState.shuffle;
    document.getElementById('shuffleBtn')?.classList.toggle('active', playerState.shuffle);
    document.getElementById('miniShuffleBtn')?.classList.toggle('active', playerState.shuffle);
    if (playerState.shuffle && fromMini) {
        // optional: jump immediately when toggled from home
        playerNext();
    }
}

function toggleRepeat() {
    playerState.repeat = !playerState.repeat;
    document.getElementById('repeatBtn')?.classList.toggle('active', playerState.repeat);
    document.getElementById('miniRepeatBtn')?.classList.toggle('active', playerState.repeat);
    const audio = document.getElementById('audioEl');
    if (audio) audio.loop = !!playerState.repeat;
}

function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
}

// ===== AI modal logic (safe backend hook; fallback placeholder) =====
function analysisKeyForCurrent() {
    const demo = demos[playerState.currentIndex];
    return demo ? `analysis:${demo.id}` : null;
}

function openAnalysisModal() {
    const modal = document.getElementById('analysisModal');
    if (!modal) return;
    modal.classList.add('show');

    const demo = demos[playerState.currentIndex];
    document.getElementById('analysisSongTitle').textContent = demo?.name || '—';

    const key = analysisKeyForCurrent();
    const cached = key ? localStorage.getItem(key) : null;
    if (cached) {
        showAnalysisText(cached);
        return;
    }
    generateAnalysisForCurrent();
}

function closeAnalysisModal() {
    document.getElementById('analysisModal')?.classList.remove('show');
}

function setAnalysisLoading(isLoading) {
    const loading = document.getElementById('analysisLoading');
    const text = document.getElementById('analysisText');
    if (!loading || !text) return;
    loading.style.display = isLoading ? 'block' : 'none';
    text.style.display = isLoading ? 'none' : 'block';
}

function showAnalysisText(content) {
    const text = document.getElementById('analysisText');
    if (!text) return;
    setAnalysisLoading(false);
    text.textContent = content;
}

function saveAnalysisForCurrent() {
    const key = analysisKeyForCurrent();
    const text = document.getElementById('analysisText')?.textContent || '';
    if (!key || !text) return;
    localStorage.setItem(key, text);
}

function regenerateAnalysisForCurrent() {
    const key = analysisKeyForCurrent();
    if (key) localStorage.removeItem(key);
    generateAnalysisForCurrent();
}

async function generateAnalysisForCurrent() {
    const demo = demos[playerState.currentIndex];
    if (!demo) return;
    setAnalysisLoading(true);

    try {
        // Get the audio blob from IndexedDB and convert to base64
        let audioBase64 = null;
        if (demo.audioKey) {
            try {
                const audioBlob = await idbGet(demo.audioKey);
                if (audioBlob) {
                    audioBase64 = await blobToBase64(audioBlob);
                }
            } catch (e) {
                console.warn('Failed to get audio blob for analysis:', e);
            }
        }

        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                songName: demo.name || demo.audioFile || 'Untitled', 
                demoId: demo.id,
                audioData: audioBase64  // Send the actual audio
            })
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        const content = typeof data?.analysis === 'string' ? data.analysis : JSON.stringify(data, null, 2);
        showAnalysisText(content);
        return;
    } catch (e) {
        console.error('Analysis error:', e);
        showAnalysisText(buildPlaceholderAnalysis(demo));
    }
}

// Helper function to convert Blob to base64 string
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // Remove the data URL prefix (e.g., "data:audio/mpeg;base64,")
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
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
        'Professional readiness'
    ];
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
    lines.push('Note: This is a UI-stage placeholder analysis. For real GPT output, host a secure backend at /api/analyze (never put API keys in the browser).');
    return lines.join('\n');
}

// ===== Utility Functions =====
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
        return 'Today';
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return `${diffDays} days ago`;
    } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
}

function getRandomGradient() {
    const colors = gradientColors[Math.floor(Math.random() * gradientColors.length)];
    return `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
}

// ===== Voice Report Functions =====
const VOICE_REPORT_STORAGE_KEY = 'voiceReportCache';

function initVoiceReport() {
    // Generate Report button
    document.getElementById('generateReportBtn')?.addEventListener('click', handleGenerateReport);
    
    // Not enough demos modal
    document.getElementById('closeNotEnoughModal')?.addEventListener('click', closeNotEnoughModal);
    document.getElementById('okNotEnoughBtn')?.addEventListener('click', closeNotEnoughModal);
    document.getElementById('notEnoughDemosModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'notEnoughDemosModal') closeNotEnoughModal();
    });
    
    // Report page buttons
    document.getElementById('reportBackBtn')?.addEventListener('click', () => {
        window.location.hash = '#home';
        showMiniPlayer(true);
    });
    document.getElementById('reportHomeBtn')?.addEventListener('click', () => {
        window.location.hash = '#home';
        showMiniPlayer(true);
    });
    document.getElementById('reportThemeBtn')?.addEventListener('click', toggleTheme);
    document.getElementById('regenerateReportBtn')?.addEventListener('click', () => {
        localStorage.removeItem(VOICE_REPORT_STORAGE_KEY);
        generateVoiceReport();
    });
}

function handleGenerateReport() {
    if (demos.length < 3) {
        showNotEnoughDemosModal();
        return;
    }
    
    // Navigate to report page
    window.location.hash = '#report';
    
    // Check if we have a cached report
    const cached = localStorage.getItem(VOICE_REPORT_STORAGE_KEY);
    if (cached) {
        try {
            const report = JSON.parse(cached);
            displayVoiceReport(report);
            return;
        } catch (e) {
            console.warn('Failed to parse cached report:', e);
        }
    }
    
    // Generate new report
    generateVoiceReport();
}

function showNotEnoughDemosModal() {
    document.getElementById('currentDemoCount').textContent = demos.length;
    document.getElementById('notEnoughDemosModal').classList.add('show');
}

function closeNotEnoughModal() {
    document.getElementById('notEnoughDemosModal').classList.remove('show');
}

async function generateVoiceReport() {
    const loading = document.getElementById('reportLoading');
    const content = document.getElementById('reportContent');
    const actions = document.getElementById('reportActions');
    
    // Show loading, hide content
    loading?.classList.remove('app-view-hidden');
    content?.classList.add('app-view-hidden');
    actions?.classList.add('app-view-hidden');
    
    // Update demo count
    document.getElementById('reportDemoCount').textContent = demos.length;
    
    // Gather demo info for the API
    const demoInfo = demos.map(d => ({
        name: d.name || d.audioFile || 'Untitled',
        id: d.id
    }));
    
    try {
        const res = await fetch('/api/voice-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ demos: demoInfo })
        });
        
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        
        const report = await res.json();
        
        // Cache the report
        localStorage.setItem(VOICE_REPORT_STORAGE_KEY, JSON.stringify(report));
        
        displayVoiceReport(report);
    } catch (e) {
        console.error('Voice report error:', e);
        // Show placeholder report
        displayVoiceReport(buildPlaceholderVoiceReport());
    }
}

function displayVoiceReport(report) {
    const loading = document.getElementById('reportLoading');
    const content = document.getElementById('reportContent');
    const actions = document.getElementById('reportActions');
    
    // Update each section
    document.getElementById('reportTalent').innerHTML = formatReportSection(report.talent);
    document.getElementById('reportGenre').innerHTML = formatReportSection(report.genre);
    document.getElementById('reportDirectionGo').innerHTML = formatReportSection(report.directionGo);
    document.getElementById('reportDirectionAvoid').innerHTML = formatReportSection(report.directionAvoid);
    document.getElementById('reportSimilar').innerHTML = formatReportSection(report.similar);
    document.getElementById('reportStrengths').innerHTML = formatReportSection(report.strengths);
    document.getElementById('reportWeaknesses').innerHTML = formatReportSection(report.weaknesses);
    document.getElementById('reportExercises').innerHTML = formatReportSection(report.exercises);
    
    // Hide loading, show content
    loading?.classList.add('app-view-hidden');
    content?.classList.remove('app-view-hidden');
    actions?.classList.remove('app-view-hidden');
}

function formatReportSection(text) {
    if (!text) return '<p>Analysis not available.</p>';
    // Convert line breaks to paragraphs
    return text.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('');
}

function buildPlaceholderVoiceReport() {
    return {
        talent: `Based on the analysis of your uploaded demos, you demonstrate notable vocal talent with a natural ear for melody and emotional expression. Your voice shows characteristics of someone who has an intuitive understanding of music, even without formal training. The way you approach phrasing and dynamics suggests an innate musicality that many singers spend years developing.

Your pitch accuracy is generally good, with occasional minor deviations that are common among developing vocalists. What sets you apart is your ability to convey emotion through your singing, which is a quality that cannot be easily taught. This emotional authenticity is one of the most valuable assets a vocalist can possess.`,

        genre: `Your vocal style most naturally aligns with contemporary pop and indie-folk genres. Your voice has a warm, intimate quality that works exceptionally well for acoustic-driven music and emotionally resonant ballads. There are also hints of R&B influence in your phrasing, suggesting versatility within these related genres.

The timbre of your voice carries a slightly breathy quality that adds vulnerability and intimacy to your performances. This characteristic is particularly valued in singer-songwriter styles where personal storytelling is central to the artistic expression.`,

        directionGo: `You should focus on developing your strengths in intimate, emotionally-driven music. Consider exploring acoustic pop, indie-folk, and soft R&B as your primary genres. Your voice naturally suits songs that tell stories and connect with listeners on a personal level.

Collaborating with songwriters who specialize in confessional, introspective lyrics would help you showcase your natural ability to convey emotion. Additionally, exploring the singer-songwriter path where you write your own material could be particularly rewarding, as your authentic expression would shine through original compositions.`,

        directionAvoid: `Based on your current vocal characteristics, you might want to avoid heavily produced electronic dance music or genres that require extensive vocal processing to achieve their signature sound. Your voice's strength lies in its natural, organic quality, which could get lost in overly synthetic productions.

Additionally, extremely demanding vocal styles like heavy metal screaming or operatic classical singing may not align with your current vocal development. These styles require specific techniques that could strain your voice if attempted without proper training and gradual conditioning.`,

        similar: `Your vocal style shares qualities with several successful artists:\n\n• Phoebe Bridgers - Similar intimate, vulnerable delivery and indie-folk sensibility\n• Billie Eilish - Comparable breathy, soft-spoken vocal approach\n• Lorde - Shares your emotional intensity and unique phrasing\n• James Bay - Similar warmth and acoustic-pop orientation\n• Bon Iver - Comparable emotional depth and indie sensibility

Studying these artists' techniques and song choices could provide valuable inspiration for your own artistic development while helping you understand how similar vocal characteristics have been successfully positioned in the market.`,

        strengths: `Your most notable vocal strengths include:\n\n1. Emotional Expression - You have a natural ability to convey feeling through your voice, creating genuine connections with listeners.\n\n2. Pitch Control - Your intonation is generally accurate, especially in your comfortable mid-range.\n\n3. Phrasing - You demonstrate an intuitive sense of musical phrasing, knowing when to hold notes and when to move forward.\n\n4. Tone Quality - Your voice has a pleasant, warm timbre that is naturally appealing and distinctive.\n\n5. Dynamic Awareness - You show understanding of when to sing softly versus when to add power for emotional effect.`,

        weaknesses: `Areas that would benefit from focused development:\n\n1. Breath Support - Strengthening your diaphragmatic breathing would improve sustain and reduce breathiness in longer phrases.\n\n2. Upper Range - Your higher notes could use more development to expand your usable range and add versatility.\n\n3. Vocal Runs - Complex melodic ornamentation needs practice to execute with precision and musicality.\n\n4. Projection - Working on volume control would help you perform more effectively in varied acoustic environments.\n\n5. Consistency - Some phrases show variation in quality; developing more consistent technique would strengthen overall performances.`,

        exercises: `Here are your recommended weekly vocal exercises:\n\n1. Lip Trills (5 mins daily) - Start each practice with lip trills on scales to warm up and improve breath flow. This exercise helps coordinate your breathing with vocalization.\n\n2. Diaphragmatic Breathing (5 mins daily) - Lie on your back with a book on your stomach. Breathe deeply so the book rises on inhale and falls on exhale. This strengthens your breath support foundation.\n\n3. "Mum" Scale Exercises (10 mins) - Sing scales on "mum" to develop a forward, resonant placement while maintaining relaxation in your jaw and tongue.\n\n4. Siren Slides (5 mins) - Glide smoothly from your lowest to highest notes on an "oo" sound. This helps develop range and smooth transitions between registers.\n\n5. Song Study (15 mins) - Choose one song from a similar artist and analyze their phrasing choices, then apply those techniques to your own performances.\n\nResources: Search "Singing Success breath support exercises" and "Eric Arceneaux vocal warm-up" on YouTube for guided tutorials.`
    };
}

// Initialize voice report when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initVoiceReport();
});

