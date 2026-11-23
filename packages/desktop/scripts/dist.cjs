// pnpm dist entry: build + package, with a QQPCMgr-safe recovery path.
//
// Tencent PC Manager (QQPCMgr real-time scan) briefly locks the freshly
// extracted win-unpacked exe, which makes electron-builder fail at its
// editWindowsResources() step (UNKNOWN: unknown error, open '*.exe', no
// retries in app-builder-lib). When that happens the win-unpacked directory
// is otherwise complete (asar integrity already injected, all files copied).
// This script detects that situation and finishes the job manually:
//   1. edit-exe.cjs  -> writes version info + icon into the exe (resedit)
//   2. electron-builder --win --prepackaged release/win-unpacked
//      -> builds Setup / portable from the repaired directory
// The freshness guard prevents repackaging a STALE win-unpacked left over
// from an older run against a newer source tree.
'use strict'
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const appRoot = path.join(__dirname, '..')
const releaseDir = path.join(appRoot, 'release')
const unpackedDir = path.join(releaseDir, 'win-unpacked')
const exePath = path.join(unpackedDir, '墨纸 Mozhi Reader.exe')
const asarPath = path.join(unpackedDir, 'resources', 'app.asar')

function nodeBin(pkgName) {
  // Resolve the package's real JS entry (pnpm layout-safe).
  const pkgJson = require.resolve(path.join(pkgName, 'package.json'), { paths: [appRoot] })
  const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[pkgName]
  return path.join(path.dirname(pkgJson), bin)
}

function run(cmd, args) {
  console.log(`\n[dist] $ node ${path.relative(appRoot, cmd)} ${args.join(' ')}`)
  const r = spawnSync(process.execPath, [cmd, ...args], {
    cwd: appRoot,
    stdio: 'inherit',
    env: process.env,
  })
  return r.status === 0
}

function isFreshUnpacked(startedAt) {
  const fresh = (p) => {
    try {
      return fs.statSync(p).mtimeMs >= startedAt
    } catch {
      return false
    }
  }
  if (!fresh(exePath) || !fresh(asarPath)) {
    console.log('[dist] win-unpacked is stale or missing — no auto-repair')
    return false
  }
  try {
    const pnpmDir = path.join(appRoot, 'node_modules', '.pnpm')
    const abDir = fs.readdirSync(pnpmDir).find((d) => d.startsWith('app-builder-lib@'))
    const resedit = require(path.join(pnpmDir, abDir, 'node_modules', 'resedit'))
    const executable = resedit.NtExecutable.from(fs.readFileSync(exePath))
    const res = resedit.NtExecutableResource.from(executable)
    const ok = res.entries.some((e) => e.type === 'INTEGRITY')
    console.log(`[dist] win-unpacked fresh${ok ? ' + INTEGRITY present' : ' but INTEGRITY missing'}`)
    return ok
  } catch (e) {
    console.log(`[dist] win-unpacked exe not parseable (${e.message}) — no auto-repair`)
    return false
  }
}

const startedAt = Date.now()

const buildOk = run(nodeBin('electron-vite'), ['build'])
if (!buildOk) process.exit(1)

const packageOk = run(nodeBin('electron-builder'), [...process.argv.slice(2), '--win'])
if (packageOk) {
  console.log('\n[dist] electron-builder finished cleanly')
  process.exit(0)
}

// electron-builder failed. Try the QQPCMgr recovery path.
console.log('\n[dist] electron-builder FAILED — checking recovery options')
if (!isFreshUnpacked(startedAt)) process.exit(1)

console.log('[dist] recovery: repairing exe resources (version info + icon)')
if (!run(path.join(appRoot, 'scripts', 'edit-exe.cjs'), [])) process.exit(1)

console.log('[dist] recovery: packaging from the repaired win-unpacked directory')
const repackOk = run(nodeBin('electron-builder'), [
  ...process.argv.slice(2),
  '--win',
  '--prepackaged',
  unpackedDir,
])
process.exit(repackOk ? 0 : 1)
