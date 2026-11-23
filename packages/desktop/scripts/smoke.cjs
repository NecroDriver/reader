/* better-sqlite3 × Electron ABI 冒烟测试：pnpm exec electron scripts/smoke.cjs */
const { app } = require('electron')

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    const r = db.prepare('SELECT 42 AS v').get()
    console.log(`SQLITE_OK v=${r.v} electron=${process.versions.electron} abi=${process.versions.modules} node=${process.versions.node}`)
  } catch (e) {
    console.error(`SQLITE_FAIL ${e.message}`)
  }
  app.quit()
})
