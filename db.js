'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { resolve } = require('node:path');

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const transactionContext = new AsyncLocalStorage();
let db;
let ready;

if (connectionString) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, Number);
  const pool = new Pool({ connectionString, max: 4 });
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY, phone text UNIQUE NOT NULL, fullname text NOT NULL,
      password text NOT NULL, role text NOT NULL CHECK (role IN ('pupil','teacher','admin')),
      klass text NOT NULL DEFAULT '', created text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires bigint NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      code text PRIMARY KEY, phone text NOT NULL, expires bigint NOT NULL
    );
    CREATE TABLE IF NOT EXISTS marks (
      id bigserial PRIMARY KEY, pupil_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      teacher_id text REFERENCES users(id) ON DELETE SET NULL, klass text NOT NULL,
      subject text NOT NULL, value text NOT NULL, created text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS marks_class_subject ON marks (klass, subject, pupil_id);
    CREATE INDEX IF NOT EXISTS marks_pupil ON marks (pupil_id, id);
    CREATE TABLE IF NOT EXISTS homework (
      id bigserial PRIMARY KEY, teacher_id text REFERENCES users(id) ON DELETE SET NULL,
      klass text NOT NULL, subject text NOT NULL, text text NOT NULL, due text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS homework_done (
      task_id bigint NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
      pupil_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, pupil_id)
    );
  `;
  ready = pool.query(schema);
  db = {
    prepare(sql) {
      let index = 0;
      let query = sql.replace(/\?/g, () => '$' + ++index)
        .replace(/INSERT OR IGNORE INTO/i, 'INSERT INTO');
      if (/INSERT OR IGNORE INTO/i.test(sql)) query += ' ON CONFLICT DO NOTHING';
      const execute = async (args, returning) => {
        const client = transactionContext.getStore() || pool;
        const result = await client.query(query + (returning ? ' RETURNING id' : ''), args);
        const rows = result.rows.map(row => {
          if ('fullname' in row) { row.fullName = row.fullname; delete row.fullname; }
          if ('pupilid' in row) { row.pupilId = row.pupilid; delete row.pupilid; }
          return row;
        });
        return { rows, changes: result.rowCount, lastInsertRowid: rows[0]?.id };
      };
      return {
        get: async (...args) => (await execute(args)).rows[0],
        all: async (...args) => (await execute(args)).rows,
        run: async (...args) => execute(args, /^INSERT INTO marks /i.test(query))
      };
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await transactionContext.run(client, work);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  };
} else {
  const { DatabaseSync } = require('node:sqlite');
  const sqlite = new DatabaseSync(process.env.LYCEUM_DB || resolve(__dirname, 'lyceum.sqlite'));
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, fullName TEXT NOT NULL,
      password TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('pupil','teacher','admin')),
      klass TEXT NOT NULL DEFAULT '', created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, phone TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS marks (
      id INTEGER PRIMARY KEY, pupil_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL, klass TEXT NOT NULL,
      subject TEXT NOT NULL, value TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS marks_class_subject ON marks (klass, subject, pupil_id);
    CREATE INDEX IF NOT EXISTS marks_pupil ON marks (pupil_id, id);
    CREATE TABLE IF NOT EXISTS homework (
      id INTEGER PRIMARY KEY, teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      klass TEXT NOT NULL, subject TEXT NOT NULL, text TEXT NOT NULL, due TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS homework_done (
      task_id INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
      pupil_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (task_id, pupil_id)
    );
  `);
  ready = Promise.resolve();
  db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        get: async (...args) => statement.get(...args),
        all: async (...args) => statement.all(...args),
        run: async (...args) => statement.run(...args)
      };
    },
    async transaction(work) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await work();
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

module.exports = { db, ready };
