/** @type {import('expo/metro-config').MetroConfig} */
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// expo-sqlite web 需要 wasm 资产与 SharedArrayBuffer 头（官方文档 v58）
config.resolver.assetExts.push('wasm')
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    middleware(req, res, next)
  }
}

module.exports = config
