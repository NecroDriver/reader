// one-off asar content spot check
const fs = require('fs')
const b = fs.readFileSync('release/win-unpacked/resources/app.asar')
const s = b.toString('latin1')
console.log('toc-desc:', s.includes('mozhi-toc-desc'))
console.log('logs-ipc:', s.includes('logs:openDir'))
console.log('ensure-crawl:', s.includes('正在检查目录'))
console.log('markSourceFailed:', s.includes('markSourceFailed'))
console.log('no-source-seed:', !s.includes('rsshub.app/ruanyifeng/blog'))
