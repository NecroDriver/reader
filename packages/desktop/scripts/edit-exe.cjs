// Finish the exe resource edit that electron-builder could not do itself when
// QQPCMgr (Tencent AV) briefly locks the freshly-extracted exe (unknown error,
// open 'release\win-unpacked\*.exe' at the "updating asar integrity" step).
// Mirrors app-builder-lib out/util/resEdit.js editWindowsResources() with the
// versionStrings built in winPackager.signAndEditResources() for this project.
// Used by scripts/dist.cjs as the automatic fallback after a failed build.
'use strict'
const fs = require('fs')
const path = require('path')

const appRoot = path.join(__dirname, '..')
const exePath = process.argv[2] || path.join(appRoot, 'release', 'win-unpacked', '墨纸 Mozhi Reader.exe')
const iconPath = path.join(appRoot, 'build', 'icon.ico')

// resolve resedit from app-builder-lib's dependency tree (pnpm strict layout)
const pnpmDir = path.join(appRoot, 'node_modules', '.pnpm')
const abDir = fs
  .readdirSync(pnpmDir)
  .find((d) => d.startsWith('app-builder-lib@'))
if (!abDir) throw new Error('app-builder-lib not found in .pnpm')
const resedit = require(path.join(pnpmDir, abDir, 'node_modules', 'resedit'))

function waitForLock(file, timeoutMs) {
  const t0 = Date.now()
  for (;;) {
    try {
      const fd = fs.openSync(file, 'r+')
      fs.closeSync(fd)
      return
    } catch (e) {
      if (Date.now() - t0 > timeoutMs) throw e
      fs.sleepSync ? fs.sleepSync(500) : Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
    }
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
const version = pkg.version
const productName = pkg.build.productName // 墨纸 Mozhi Reader
const author = typeof pkg.author === 'object' ? pkg.author.name : pkg.author || ''
const year = new Date().getFullYear()

const versionStrings = {
  FileDescription: productName,
  ProductName: productName,
  LegalCopyright: `Copyright © ${year} ${author}`.trim(),
  InternalName: path.basename(exePath, '.exe'),
  OriginalFilename: '',
}

waitForLock(exePath, 60000)

const buffer = fs.readFileSync(exePath)
const executable = resedit.NtExecutable.from(buffer)
const res = resedit.NtExecutableResource.from(executable)
const viList = resedit.Resource.VersionInfo.fromEntries(res.entries)
const vi = viList.length > 0 ? viList[0] : resedit.Resource.VersionInfo.createEmpty()
const languages = vi.getAllLanguagesForStringValues()
const lang = languages.length > 0 ? languages[0] : { lang: 0x0409, codepage: 1200 }
vi.setStringValues(lang, versionStrings)
vi.setFileVersion(version)
vi.setProductVersion(version)
vi.setStringValues(lang, { FileVersion: version })
vi.outputToResourceEntries(res.entries)

const iconBuf = fs.readFileSync(iconPath)
const iconFile = resedit.Data.IconFile.from(iconBuf)
resedit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, lang.lang, iconFile.icons.map((i) => i.data))

res.outputResource(executable)

// QQPCMgr (and/or Explorer icon cache) briefly memory-maps the fresh exe:
// openSync('r+') still succeeds, but writeFileSync's internal open with
// O_TRUNC fails with UNKNOWN (-4094). The mapping self-releases (~45s+), so
// retry the write over a 4-minute window instead of failing fast.
const out = Buffer.from(executable.generate())
const t0 = Date.now()
for (let attempt = 1; ; attempt++) {
  try {
    fs.writeFileSync(exePath, out)
    break
  } catch (e) {
    const retryable = ['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES', 'ETXTBSY'].includes(e.code)
    const waited = Date.now() - t0
    if (!retryable || attempt >= 16 || waited > 240000) {
      console.error(`[edit-exe] write failed after ${attempt} attempt(s) / ${waited}ms: ${e.code}`)
      throw e
    }
    console.log(`[edit-exe] exe locked (${e.code}), retry ${attempt}/16 in 15s`)
    fs.sleepSync ? fs.sleepSync(15000) : Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000)
  }
}
console.log('[edit-exe] OK', JSON.stringify({ exePath, version, productName, icons: iconFile.icons.length }))
