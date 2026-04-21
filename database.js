const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'photos.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    thumb_filename TEXT,
    original_name TEXT,
    uploader_name TEXT NOT NULL,
    caption TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    season TEXT NOT NULL,
    upload_date TEXT NOT NULL,
    is_favorited INTEGER DEFAULT 0,
    file_size INTEGER DEFAULT 0,
    width INTEGER DEFAULT 0,
    height INTEGER DEFAULT 0
  )
`);

function getSeason(date) {
  const month = new Date(date).getMonth() + 1;
  if ([12, 1, 2].includes(month)) return 'Winter';
  if ([3, 4, 5].includes(month)) return 'Spring';
  if ([6, 7, 8].includes(month)) return 'Summer';
  return 'Fall';
}

function addPhoto(data) {
  const season = getSeason(data.upload_date);
  const stmt = db.prepare(`
    INSERT INTO photos (filename, thumb_filename, original_name, uploader_name, caption, tags, season, upload_date, file_size, width, height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.filename, data.thumb_filename, data.original_name,
    data.uploader_name, data.caption || '', JSON.stringify(data.tags || []),
    season, data.upload_date, data.file_size || 0, data.width || 0, data.height || 0
  );
  return getPhoto(result.lastInsertRowid);
}

function getPhotos(filters = {}) {
  let query = 'SELECT * FROM photos WHERE 1=1';
  const params = [];
  if (filters.season) { query += ' AND season = ?'; params.push(filters.season); }
  if (filters.tag) { query += ' AND tags LIKE ?'; params.push(`%"${filters.tag}"%`); }
  if (filters.favorites) { query += ' AND is_favorited = 1'; }
  query += ' ORDER BY upload_date DESC, id DESC';
  const rows = db.prepare(query).all(...params);
  return rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]'), is_favorited: !!r.is_favorited }));
}

function getPhoto(id) {
  const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, tags: JSON.parse(row.tags || '[]'), is_favorited: !!row.is_favorited };
}

function toggleFavorite(id) {
  const photo = getPhoto(id);
  if (!photo) return null;
  db.prepare('UPDATE photos SET is_favorited = ? WHERE id = ?').run(photo.is_favorited ? 0 : 1, id);
  return getPhoto(id);
}

function deletePhoto(id) {
  const photo = getPhoto(id);
  if (!photo) return null;
  db.prepare('DELETE FROM photos WHERE id = ?').run(id);
  return photo;
}

module.exports = { addPhoto, getPhotos, getPhoto, toggleFavorite, deletePhoto, getSeason };
