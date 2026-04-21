// ── State ──────────────────────────────────────────────────────────────────
let authToken = localStorage.getItem('fpd_token') || null;
let userName = localStorage.getItem('fpd_name') || null;
let isAdmin = false;
let photos = [];
let currentFilter = 'all';
let lightboxIndex = 0;
let selectMode = false;
let selectedIds = new Set();
let pendingInviteCode = null;

// ── Init ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if (authToken) {
    const ok = await checkAuth();
    if (ok) return showApp();
  }
  showScreen('auth-screen');

  // Enter key support
  document.getElementById('invite-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitCode(); });
  document.getElementById('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitName(); });
  document.getElementById('admin-password-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitAdminLogin(); });
});

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

async function checkAuth() {
  try {
    const res = await api('GET', '/api/auth/check');
    if (res.authenticated) {
      isAdmin = res.isAdmin;
      userName = res.name;
      return true;
    }
  } catch (e) {}
  authToken = null;
  localStorage.removeItem('fpd_token');
  localStorage.removeItem('fpd_name');
  return false;
}

// ── Auth ────────────────────────────────────────────────────────────────────
async function submitCode() {
  const code = document.getElementById('invite-code-input').value.trim();
  const err = document.getElementById('code-error');
  err.classList.remove('show');
  if (!code) { err.classList.add('show'); return; }

  pendingInviteCode = code;
  // Check if we have a name already
  if (userName) {
    await finalizeJoin(code, userName);
  } else {
    document.getElementById('step-code').classList.remove('active');
    document.getElementById('step-name').classList.add('active');
    document.getElementById('name-input').focus();
  }
}

async function submitName() {
  const name = document.getElementById('name-input').value.trim();
  const err = document.getElementById('name-error');
  err.classList.remove('show');
  if (name.length < 2) { err.classList.add('show'); return; }
  await finalizeJoin(pendingInviteCode, name);
}

async function finalizeJoin(code, name) {
  try {
    const res = await fetch('/api/auth/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name })
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('code-error').textContent = data.error || 'Invalid code';
      document.getElementById('code-error').classList.add('show');
      document.getElementById('step-name').classList.remove('active');
      document.getElementById('step-code').classList.add('active');
      return;
    }
    authToken = data.token;
    userName = data.name;
    localStorage.setItem('fpd_token', authToken);
    localStorage.setItem('fpd_name', userName);
    showApp();
  } catch (e) {
    document.getElementById('code-error').textContent = 'Something went wrong. Try again.';
    document.getElementById('code-error').classList.add('show');
  }
}

function showApp() {
  document.getElementById('user-name-display').textContent = userName;
  if (isAdmin) {
    document.getElementById('admin-badge').style.display = 'inline-flex';
    document.getElementById('lb-admin-actions').style.display = 'flex';
  } else {
    document.getElementById('lb-admin-actions').style.display = 'none';
    // Show favorites filter for all users, hide admin actions
  }
  showScreen('app-screen');
  loadPhotos();
}

// ── Admin Auth ──────────────────────────────────────────────────────────────
function showAdminLogin() {
  document.getElementById('admin-modal').classList.add('show');
  setTimeout(() => document.getElementById('admin-password-input').focus(), 100);
}
function closeAdminModal() {
  document.getElementById('admin-modal').classList.remove('show');
  document.getElementById('admin-error').classList.remove('show');
  document.getElementById('admin-password-input').value = '';
}

async function submitAdminLogin() {
  const password = document.getElementById('admin-password-input').value;
  const err = document.getElementById('admin-error');
  err.classList.remove('show');

  try {
    const res = await fetch('/api/auth/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, token: authToken })
    });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.error || 'Wrong password';
      err.classList.add('show');
      return;
    }
    if (data.token) {
      authToken = data.token;
      userName = data.name;
      localStorage.setItem('fpd_token', authToken);
      localStorage.setItem('fpd_name', userName);
    }
    isAdmin = true;
    closeAdminModal();
    if (document.getElementById('app-screen').classList.contains('active')) {
      document.getElementById('admin-badge').style.display = 'inline-flex';
      document.getElementById('lb-admin-actions').style.display = 'flex';
    } else {
      showApp();
    }
  } catch (e) {
    err.textContent = 'Something went wrong.';
    err.classList.add('show');
  }
}

// ── Gallery ─────────────────────────────────────────────────────────────────
async function loadPhotos() {
  document.getElementById('gallery-loading').style.display = 'block';
  document.getElementById('gallery-empty').style.display = 'none';
  document.getElementById('gallery-grid').innerHTML = '';

  try {
    let url = '/api/photos?';
    if (currentFilter === 'fav') url += 'favorites=true';
    else if (currentFilter.startsWith('tag-')) url += `tag=${currentFilter.replace('tag-', '')}`;
    else if (['Spring', 'Summer', 'Fall', 'Winter'].includes(currentFilter)) url += `season=${currentFilter}`;

    const res = await api('GET', url);
    photos = res.photos || [];
  } catch (e) {
    photos = [];
  }

  document.getElementById('gallery-loading').style.display = 'none';

  if (photos.length === 0) {
    document.getElementById('gallery-empty').style.display = 'flex';
    return;
  }

  renderGallery();
}

function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '';

  photos.forEach((photo, idx) => {
    const tile = document.createElement('div');
    tile.className = 'photo-tile' + (selectMode ? ' select-mode' : '') + (selectedIds.has(photo.id) ? ' selected' : '');
    tile.dataset.id = photo.id;
    tile.dataset.idx = idx;

    const imgSrc = `/uploads/thumbs/${photo.thumb_filename || photo.filename}`;
    tile.innerHTML = `
      <img src="${imgSrc}" alt="${escHtml(photo.caption || '')}" loading="lazy" />
      ${photo.is_favorited ? '<div class="fav-badge">⭐</div>' : ''}
      <div class="select-overlay"><span class="check-icon">✓</span></div>
    `;

    tile.addEventListener('click', () => {
      if (selectMode) { toggleSelect(photo.id, tile); return; }
      openLightbox(idx);
    });

    grid.appendChild(tile);
  });
}

function setFilter(filter, el) {
  currentFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  // Favorites filter available to all; admin actions only for admin
  loadPhotos();
}

// ── Upload ──────────────────────────────────────────────────────────────────
let selectedFiles = [];

function openUploadModal() {
  document.getElementById('upload-modal').classList.add('show');
}
function closeUploadModal() {
  document.getElementById('upload-modal').classList.remove('show');
  document.getElementById('file-input').value = '';
  document.getElementById('upload-caption').value = '';
  document.getElementById('file-preview').style.display = 'none';
  document.getElementById('preview-thumbs').innerHTML = '';
  document.getElementById('upload-error').classList.remove('show');
  document.getElementById('upload-success').classList.remove('show');
  document.getElementById('upload-progress-bar').classList.remove('show');
  document.getElementById('upload-progress-fill').style.width = '0%';
  document.getElementById('upload-btn').disabled = false;
  document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('selected'));
  selectedFiles = [];
}

function handleFileSelect(input) {
  selectedFiles = Array.from(input.files);
  const preview = document.getElementById('file-preview');
  const thumbs = document.getElementById('preview-thumbs');
  const count = document.getElementById('file-count');

  thumbs.innerHTML = '';
  if (selectedFiles.length === 0) { preview.style.display = 'none'; return; }

  count.textContent = `${selectedFiles.length} photo${selectedFiles.length > 1 ? 's' : ''} selected`;
  selectedFiles.slice(0, 8).forEach(f => {
    const img = document.createElement('img');
    img.style.cssText = 'width:60px;height:60px;object-fit:cover;border-radius:6px;';
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.readAsDataURL(f);
    thumbs.appendChild(img);
  });
  if (selectedFiles.length > 8) {
    const more = document.createElement('div');
    more.style.cssText = 'width:60px;height:60px;border-radius:6px;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text-muted);';
    more.textContent = `+${selectedFiles.length - 8}`;
    thumbs.appendChild(more);
  }
  preview.style.display = 'block';
}

function toggleTag(btn) { btn.classList.toggle('selected'); }

async function compressImage(file, maxSize = 2000, quality = 0.85) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
        else { width = Math.round(width * maxSize / height); height = maxSize; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(new File([blob], file.name, { type: 'image/jpeg' })), 'image/jpeg', quality);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

async function submitUpload() {
  const errEl = document.getElementById('upload-error');
  const successEl = document.getElementById('upload-success');
  const progressBar = document.getElementById('upload-progress-bar');
  const progressFill = document.getElementById('upload-progress-fill');
  const btn = document.getElementById('upload-btn');

  errEl.classList.remove('show');
  successEl.classList.remove('show');

  if (selectedFiles.length === 0) {
    errEl.textContent = 'Please select at least one photo.';
    errEl.classList.add('show');
    return;
  }

  const tags = Array.from(document.querySelectorAll('.tag-btn.selected')).map(b => b.dataset.tag);
  const caption = document.getElementById('upload-caption').value.trim();

  btn.disabled = true;
  btn.textContent = 'Compressing...';
  progressBar.classList.add('show');
  progressFill.style.width = '10%';

  try {
    const formData = new FormData();
    let processed = 0;

    for (const file of selectedFiles) {
      const compressed = await compressImage(file);
      formData.append('photos', compressed, file.name);
      processed++;
      progressFill.style.width = `${10 + (processed / selectedFiles.length) * 40}%`;
    }

    formData.append('caption', caption);
    formData.append('tags', JSON.stringify(tags));

    btn.textContent = 'Uploading...';
    progressFill.style.width = '55%';

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        progressFill.style.width = `${55 + (e.loaded / e.total) * 40}%`;
      }
    };

    await new Promise((resolve, reject) => {
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(JSON.parse(xhr.responseText)?.error || 'Upload failed'));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('x-auth-token', authToken);
      xhr.send(formData);
    });

    progressFill.style.width = '100%';
    successEl.textContent = `✓ ${selectedFiles.length} photo${selectedFiles.length > 1 ? 's' : ''} uploaded!`;
    successEl.classList.add('show');

    setTimeout(() => {
      closeUploadModal();
      loadPhotos();
    }, 1200);
  } catch (e) {
    errEl.textContent = e.message || 'Upload failed. Please try again.';
    errEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Upload Photos';
    progressBar.classList.remove('show');
  }
}

// ── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(idx) {
  lightboxIndex = idx;
  renderLightbox();
  document.getElementById('lightbox').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('show');
  document.body.style.overflow = '';
}

function renderLightbox() {
  const photo = photos[lightboxIndex];
  if (!photo) return;

  document.getElementById('lb-img').src = `/uploads/${photo.filename}`;
  document.getElementById('lb-season-badge').textContent = seasonEmoji(photo.season) + ' ' + photo.season;

  const date = new Date(photo.upload_date);
  const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('lb-meta').textContent = `Uploaded by ${photo.uploader_name} · ${dateStr}`;
  document.getElementById('lb-caption').textContent = photo.caption || '';

  const tagsEl = document.getElementById('lb-tags');
  tagsEl.innerHTML = photo.tags.map(t => `<span class="lightbox-tag">${tagEmoji(t)} ${t}</span>`).join('');

  if (isAdmin) {
    const favBtn = document.getElementById('lb-fav-btn');
    favBtn.textContent = photo.is_favorited ? '★ Favorited' : '⭐ Favorite';
    favBtn.style.background = photo.is_favorited ? 'var(--amber)' : '';
  }
}

function lightboxNav(dir) {
  lightboxIndex = Math.max(0, Math.min(photos.length - 1, lightboxIndex + dir));
  renderLightbox();
}

async function lightboxFavorite() {
  if (!isAdmin) return;
  const photo = photos[lightboxIndex];
  try {
    const res = await api('POST', `/api/photos/${photo.id}/favorite`);
    photos[lightboxIndex] = res.photo;
    renderLightbox();
    renderGallery();
  } catch (e) {}
}

function lightboxDownload() {
  const photo = photos[lightboxIndex];
  const a = document.createElement('a');
  a.href = `/api/photos/${photo.id}/download`;
  a.download = photo.original_name || photo.filename;
  a.click();
}

async function lightboxDelete() {
  if (!isAdmin) return;
  const photo = photos[lightboxIndex];
  if (!confirm(`Delete this photo by ${photo.uploader_name}?`)) return;
  try {
    await api('DELETE', `/api/photos/${photo.id}`);
    photos.splice(lightboxIndex, 1);
    if (photos.length === 0) { closeLightbox(); loadPhotos(); return; }
    lightboxIndex = Math.min(lightboxIndex, photos.length - 1);
    renderLightbox();
    renderGallery();
  } catch (e) {}
}

// Swipe support
let touchStartX = 0;
document.getElementById('lightbox').addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
document.getElementById('lightbox').addEventListener('touchend', e => {
  const diff = touchStartX - e.changedTouches[0].clientX;
  if (Math.abs(diff) > 50) lightboxNav(diff > 0 ? 1 : -1);
});

// ── Select Mode ──────────────────────────────────────────────────────────────
function enterSelectMode() {
  if (!isAdmin) return;
  closeLightbox();
  selectMode = true;
  selectedIds.clear();
  renderGallery();
}

function toggleSelect(id, tile) {
  if (selectedIds.has(id)) { selectedIds.delete(id); tile.classList.remove('selected'); }
  else { selectedIds.add(id); tile.classList.add('selected'); }
  const bulkBar = document.getElementById('bulk-bar');
  const count = selectedIds.size;
  if (count > 0) {
    bulkBar.classList.add('show');
    document.getElementById('bulk-count').textContent = `${count} photo${count > 1 ? 's' : ''} selected`;
  } else {
    bulkBar.classList.remove('show');
  }
}

function cancelSelect() {
  selectMode = false;
  selectedIds.clear();
  document.getElementById('bulk-bar').classList.remove('show');
  renderGallery();
}

async function bulkDownload() {
  if (selectedIds.size === 0) return;
  const ids = Array.from(selectedIds);

  try {
    const res = await fetch('/api/photos/download-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
      body: JSON.stringify({ ids })
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'tr-ranch-photos.zip'; a.click();
    URL.revokeObjectURL(url);
    cancelSelect();
  } catch (e) {
    alert('Download failed. Try again.');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function api(method, url, body) {
  const opts = {
    method,
    headers: { 'x-auth-token': authToken || '' }
  };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function seasonEmoji(s) {
  return { Winter: '❄️', Spring: '🌸', Summer: '☀️', Fall: '🍂' }[s] || '📷';
}

function tagEmoji(t) {
  return { chickens: '🐔', alpacas: '🦙', ducks: '🦆', honey: '🍯', garden: '🌱', eggs: '🥚', seasonal: '🌾', other: '✨' }[t] || '';
}

// Keyboard nav for lightbox
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox').classList.contains('show')) return;
  if (e.key === 'ArrowRight') lightboxNav(1);
  if (e.key === 'ArrowLeft') lightboxNav(-1);
  if (e.key === 'Escape') closeLightbox();
});
