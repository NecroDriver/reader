// expo prebuild 重新生成 android/ 后，重放中国网络镜像配置（直连 google/mavenCentral/services.gradle.org 不可达时仍能本地构建）。
// 用法：node scripts/apply-cn-mirrors.cjs   （在 packages/mobile 下运行，紧跟在 npx expo prebuild 之后）
'use strict'
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'android')

const wrapperProps = path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties')
const wrapperOrig = 'https\\://services.gradle.org/distributions/'
const wrapperMirror = 'https\\://mirrors.cloud.tencent.com/gradle/'

const buildGradle = path.join(root, 'build.gradle')
const mirrorBlock = [
  "    // 中国网络镜像优先（直连 google/mavenCentral 不可达时仍能构建）",
  "    maven { url 'https://maven.aliyun.com/repository/google' }",
  "    maven { url 'https://maven.aliyun.com/repository/public' }",
  "    maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }"
].join('\n')

let changed = []

if (fs.existsSync(wrapperProps)) {
  let t = fs.readFileSync(wrapperProps, 'utf8')
  if (t.includes('services.gradle.org')) {
    t = t.replace(wrapperOrig, wrapperMirror)
    fs.writeFileSync(wrapperProps, t)
    changed.push('gradle-wrapper.properties -> tencent mirror')
  }
}

if (fs.existsSync(buildGradle)) {
  let t = fs.readFileSync(buildGradle, 'utf8')
  if (!t.includes('maven.aliyun.com')) {
    t = t.replace('  repositories {\n    google()', '  repositories {\n' + mirrorBlock + '\n    google()', 'g')
    t = t.replace('  repositories {\n    google()\n    mavenCentral()\n    maven { url \'https://www.jitpack.io\' }', '  repositories {\n' + mirrorBlock + '\n    google()\n    mavenCentral()\n    maven { url \'https://www.jitpack.io\' }')
    fs.writeFileSync(buildGradle, t)
    changed.push('build.gradle -> aliyun maven mirrors')
  }
}

console.log(changed.length ? changed.join('\n') : 'already patched, nothing to do')
