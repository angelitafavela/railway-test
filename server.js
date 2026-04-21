require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const sharp = require('sharp');
const { addPhoto, getPhotos, getPhoto, toggleFavorite, deletePhoto } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const INVITE_CODE = process.env.INVITE_CODE || 'farmlife2024';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'trranch_admin';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev_secret';

// Simple in-memory token store
const tokens = new Map();
const adminTokens = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token || !tokens.has(token)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = tokens.get(token);
  next();
}

function adminMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token || !adminTokens.has(token)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.user = tokens.get(token) || { name: 'Admin' };
  next();
}

// Storage
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs');
[UPLOADS_DIR, THUMBS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Auth
app.post('/api/auth/join', (req, res) => {
  const { code, name } = req.body;
  if (!code || code.trim().toLowerCase() !== INVITE_CODE.toLowerCase()) {
    return res.status(401).json({ error: 'Invalid invite code' });
  }
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Please enter your name' });
  }
  const token = generateToken();
  tokens.set(token, { name: name.trim() });
  res.json({ token, name: name.trim() });
});

app.post('/api/auth/admin', (req, res) => {
  const { password, token } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  if (token && tokens.has(token)) {
    adminTokens.add(token);
    res.json({ ok: true });
  } else {
    const newToken = generateToken();
    tokens.set(newToken, { name: 'Admin' });
    adminTokens.add(newToken);
    res.json({ token: newToken, name: 'Admin' });
  }
});

app.get('/api/auth/check', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (!token || !tokens.has(token)) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    isAdmin: adminTokens.has(token),
    name: tokens.get(token).name
  });
});

// Upload
app.post('/api/upload', authMiddleware, upload.array('photos', 20), async (req, res) => {
  try {
    const { caption, tags } = req.body;
    const tagList = tags ? JSON.parse(tags) : [];
    const uploader = req.user.name;
    const now = new Date().toISOString();
    const results = [];

    for (const file of req.files) {
      const thumbName = `thumb_${file.filename}`;
      const thumbPath = path.join(THUMBS_DIR, thumbName);

      let width = 0, height = 0;
      try {
        const meta = await sharp(file.path).metadata();
        width = meta.width || 0;
        height = meta.height || 0;
        await sharp(file.path)
          .resize(600, null, { withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(thumbPath);
      } catch (e) {
        fs.copyFileSync(file.path, thumbPath);
      }

      const photo = addPhoto({
        filename: file.filename,
        thumb_filename: thumbName,
        original_name: file.originalname,
        uploader_name: uploader,
        caption: caption || '',
        tags: tagList,
        upload_date: now,
        file_size: file.size,
        width, height
      });
      results.push(photo);
    }

    res.json({ photos: results });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// Photos
app.get('/api/photos', authMiddleware, (req, res) => {
  const { season, tag, favorites } = req.query;
  const photos = getPhotos({ season, tag, favorites: favorites === 'true' });
  res.json({ photos });
});

app.post('/api/photos/:id/favorite', adminMiddleware, (req, res) => {
  const photo = toggleFavorite(parseInt(req.params.id));
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  res.json({ photo });
});

app.delete('/api/photos/:id', adminMiddleware, (req, res) => {
  const photo = deletePhoto(parseInt(req.params.id));
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  // Delete files
  [path.join(UPLOADS_DIR, photo.filename), path.join(THUMBS_DIR, photo.thumb_filename)]
    .forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
  res.json({ ok: true });
});

app.get('/api/photos/:id/download', authMiddleware, (req, res) => {
  const photo = getPhoto(parseInt(req.params.id));
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const filePath = path.join(UPLOADS_DIR, photo.filename);
  res.download(filePath, photo.original_name || photo.filename);
});

app.post('/api/photos/download-bulk', adminMiddleware, (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'No photos selected' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="tr-ranch-photos.zip"');

  const archive = archiver('zip');
  archive.pipe(res);

  ids.forEach(id => {
    const photo = getPhoto(id);
    if (photo) {
      const filePath = path.join(UPLOADS_DIR, photo.filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: photo.original_name || photo.filename });
      }
    }
  });

  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`🌿 Farm Photo Drop running at http://localhost:${PORT}`);
});
