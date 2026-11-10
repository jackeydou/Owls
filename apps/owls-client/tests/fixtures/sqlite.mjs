/**
 * The part of the better-sqlite3 client that drizzle and OwlsStore use, over
 * Node's built-in `node:sqlite`. better-sqlite3 is built for Electron, so plain
 * Node tests open real databases through this instead.
 */
import { DatabaseSync } from 'node:sqlite'

export function openSqlite(path) {
  const db = new DatabaseSync(path)
  const prepare = (sql) => {
    const statement = db.prepare(sql)
    return {
      run: (...params) => statement.run(...params),
      get: (...params) => statement.get(...params),
      all: (...params) => statement.all(...params),
      // drizzle reads rows as arrays in column order.
      raw: () => ({
        get: (...params) => {
          const row = statement.get(...params)
          return row === undefined ? undefined : Object.values(row)
        },
        all: (...params) => statement.all(...params).map((row) => Object.values(row))
      })
    }
  }
  return {
    prepare,
    exec: (sql) => db.exec(sql),
    pragma: (text) => db.exec(`PRAGMA ${text}`),
    transaction(fn) {
      const run = (...args) => {
        db.exec('BEGIN')
        try {
          const result = fn(...args)
          db.exec('COMMIT')
          return result
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
      return Object.assign(run, { deferred: run, immediate: run, exclusive: run })
    },
    close: () => {
      if (db.isOpen) db.close()
    }
  }
}
