#!/usr/bin/env node
/**
 * backup-mongo.js — XAUUSD Dashboard MongoDB Backup Tool
 *
 * Exports all MongoDB collections to timestamped JSON files locally.
 * Automatically deletes backups older than MAX_BACKUPS days.
 *
 * Usage:
 *   node backup-mongo.js
 *
 * Schedule (Windows Task Scheduler):
 *   Action: node "C:\path\to\project\backup-mongo.js"
 *   Trigger: Daily at 03:00
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Load .env from backend folder if present
try {
  require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });
} catch (e) {}

const MONGODB_URI = process.env.MONGODB_URI;
const BACKUP_DIR  = path.join(__dirname, 'backups', 'mongodb');
const MAX_BACKUPS = 30; // Keep last 30 snapshots

// ─────────────────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  // Also append to log file
  const logFile = path.join(BACKUP_DIR, 'backup.log');
  try { fs.appendFileSync(logFile, line + '\n'); } catch (_) {}
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log('Created directory: ' + dir);
  }
}

function pruneOldBackups(root) {
  const entries = fs.readdirSync(root)
    .filter(f => f.startsWith('backup-'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(root, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  entries.slice(MAX_BACKUPS).forEach(e => {
    fs.rmSync(path.join(root, e.name), { recursive: true, force: true });
    log('Pruned old backup: ' + e.name);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
async function runBackup() {
  if (!MONGODB_URI) {
    console.error('');
    console.error('[ERROR] MONGODB_URI is not configured.');
    console.error('  Set it in backend/.env:');
    console.error('  MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/<dbname>');
    console.error('');
    process.exit(1);
  }

  const now          = new Date();
  const timestamp    = now.toISOString().replace(/:/g, '-').replace(/\./g, '-').slice(0, 19);
  const backupFolder = path.join(BACKUP_DIR, 'backup-' + timestamp);

  ensureDir(BACKUP_DIR);
  ensureDir(backupFolder);

  log('========================================');
  log('XAUUSD Dashboard — MongoDB Backup Start');
  log('Target folder: ' + backupFolder);

  let client;
  try {
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 10000,
    });
    await client.connect();
    log('Connected to MongoDB successfully.');

    // Auto-detect DB name from URI path; fallback to "xauusd"
    const uriPath = new URL(MONGODB_URI).pathname;
    const dbName  = uriPath.length > 1 ? uriPath.slice(1) : 'xauusd';
    const db      = client.db(dbName);

    const collections = await db.listCollections().toArray();
    log('Collections (' + collections.length + '): ' + collections.map(c => c.name).join(', '));

    let totalDocs = 0;
    for (const col of collections) {
      const docs    = await db.collection(col.name).find({}).toArray();
      const outFile = path.join(backupFolder, col.name + '.json');
      fs.writeFileSync(outFile, JSON.stringify(docs, null, 2), 'utf8');
      log('  [ok] ' + col.name + ' — ' + docs.length + ' documents');
      totalDocs += docs.length;
    }

    // Manifest
    const manifest = {
      createdAt:    now.toISOString(),
      database:     dbName,
      collections:  collections.map(c => c.name),
      totalDocs,
      backupFolder,
    };
    fs.writeFileSync(
      path.join(backupFolder, '_manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    log('BACKUP COMPLETE — ' + totalDocs + ' documents saved.');
    log('Location: ' + backupFolder);
    log('========================================\n');

    // Remove old backups beyond MAX_BACKUPS
    pruneOldBackups(BACKUP_DIR);

  } catch (err) {
    log('[ERROR] Backup failed: ' + err.message);
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
}

runBackup();
