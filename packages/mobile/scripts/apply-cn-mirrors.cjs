// expo prebuild 重新生成 android/ 后，重放中国网络构建配置：
// 1) gradle 发行包改腾讯镜像（services.gradle.org 直连常超时；腾讯镜像实测 200）。
// 2) build.gradle 仓库顺序：google()/mavenCentral() 优先直连（实测可达），阿里云镜像仅作后备。
//    镜像不能放在最前：阿里云对缺失工件回 502 会中断解析（expo npm 包内嵌 local-maven-repo 的
//    expo.modules.* 工件就是这样被弄挂的），404 才会继续尝试下一个仓库。
// 用法：node scripts/apply-cn-mirrors.cjs   （在 packages/mobile 下运行，紧跟在 npx expo prebuild 之后）
'use strict'
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'android')
const changed = []

const wrapperProps = path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties')
if (fs.existsSync(wrapperProps)) {
  let t = fs.readFileSync(wrapperProps, 'utf8')
  if (t.includes('services.gradle.org')) {
    t = t.replace('https\\://services.gradle.org/distributions/', 'https\\://mirrors.cloud.tencent.com/gradle/')
    fs.writeFileSync(wrapperProps, t)
    changed.push('gradle-wrapper.properties -> tencent mirror')
  }
}

const fallback = [
  "    // 阿里云镜像仅作后备（google/mavenCentral 直连不可达时）；放最前会对缺失工件回 502 中断解析",
  "    maven { url 'https://maven.aliyun.com/repository/google' }",
  "    maven { url 'https://maven.aliyun.com/repository/public' }"
].join('\n')

const buildGradle = path.join(root, 'build.gradle')
if (fs.existsSync(buildGradle)) {
  let t = fs.readFileSync(buildGradle, 'utf8')
  if (!t.includes('maven.aliyun.com')) {
    // buildscript 块：google+mavenCentral 后插后备镜像
    t = t.replace(
      '  repositories {\n    google()\n    mavenCentral()\n  }',
      '  repositories {\n    google()\n    mavenCentral()\n' + fallback + '\n  }'
    )
    // allprojects 块：google+mavenCentral 后插后备镜像（jitpack 之前）
    t = t.replace(
      "  repositories {\n    google()\n    mavenCentral()\n    maven { url 'https://www.jitpack.io' }",
      "  repositories {\n    google()\n    mavenCentral()\n" + fallback + "\n    maven { url 'https://www.jitpack.io' }"
    )
    fs.writeFileSync(buildGradle, t)
    changed.push('build.gradle -> aliyun mirrors as fallback (after google/mavenCentral)')
  }
}

console.log(changed.length ? changed.join('\n') : 'already patched, nothing to do')
