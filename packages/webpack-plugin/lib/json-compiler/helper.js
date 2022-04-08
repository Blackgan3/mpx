const path = require('path')
const normalize = require('../utils/normalize')
const nativeLoaderPath = normalize.lib('native-loader')
const isUrlRequestRaw = require('../utils/is-url-request')
const parseRequest = require('../utils/parse-request')
const addQuery = require('../utils/add-query')
const loaderUtils = require('loader-utils')
const resolve = require('../utils/resolve')

module.exports = function createJSONHelper ({ loaderContext, emitWarning, customGetDynamicEntry }) {
  const mpx = loaderContext.getMpx()
  const resolveMode = mpx.resolveMode
  const externals = mpx.externals
  const root = mpx.projectRoot
  const publicPath = (loaderContext._compilation && loaderContext._compilation.outputOptions.publicPath) || ''
  const pathHash = mpx.pathHash
  const getOutputPath = mpx.getOutputPath
  const mode = mpx.mode

  const isUrlRequest = r => isUrlRequestRaw(r, root, externals)
  const urlToRequest = r => loaderUtils.urlToRequest(r)

  const dynamicEntryMap = new Map()

  let dynamicEntryCount = 0

  const getDynamicEntry = (request, type, outputPath = '', packageRoot = '', relativePath = '', context = '') => {
    if (typeof customGetDynamicEntry === 'function') return customGetDynamicEntry(request, type, outputPath, packageRoot, relativePath, context)
    const key = `mpx_dynamic_entry_${dynamicEntryCount++}`
    const value = `__mpx_dynamic_entry__( ${JSON.stringify(request)},${JSON.stringify(type)},${JSON.stringify(outputPath)},${JSON.stringify(packageRoot)},${JSON.stringify(relativePath)},${JSON.stringify(context)})`
    dynamicEntryMap.set(key, value)
    return key
  }

  const processDynamicEntry = (output) => {
    return output.replace(/"mpx_dynamic_entry_\d+"/g, (match) => {
      const key = match.slice(1, -1)
      return dynamicEntryMap.get(key)
    })
  }

  const processComponent = (component, context, { tarRoot = '', outputPath = '', relativePath = '' }, callback) => {
    if (!isUrlRequest(component)) return callback(null, component)
    if (resolveMode === 'native') {
      component = urlToRequest(component)
    }

    resolve(context, component, loaderContext, (err, resource, info) => {
      if (err) return callback(err)
      const { resourcePath, queryObj } = parseRequest(resource)

      if (queryObj.root) {
        // 删除root query
        resource = addQuery(resource, {}, false, ['root'])
        // 目前只有微信支持分包异步化
        if (mode === 'wx') tarRoot = queryObj.root
      }
      const parsed = path.parse(resourcePath)
      const ext = parsed.ext
      const resourceName = path.join(parsed.dir, parsed.name)

      if (!outputPath) {
        if (ext === '.js' && resourceName.includes('node_modules')) {
          let root = info.descriptionFileRoot
          let name = 'nativeComponent'
          if (info.descriptionFileData) {
            if (info.descriptionFileData.miniprogram) {
              root = path.join(root, info.descriptionFileData.miniprogram)
            }
            if (info.descriptionFileData.name) {
              // 去掉name里面的@符号，因为支付宝不支持文件路径上有@
              name = info.descriptionFileData.name.replace(/@/g, '')
            }
          }
          let relative = path.relative(root, resourceName)
          outputPath = path.join('components', name + pathHash(root), relative)
        } else {
          outputPath = getOutputPath(resourcePath, 'component')
        }
      }
      if (ext === '.js') {
        resource = `!!${nativeLoaderPath}!${resource}`
      }

      const entry = getDynamicEntry(resource, 'component', outputPath, tarRoot, relativePath)
      callback(null, entry)
    })
  }

  const processPage = (page, context, tarRoot = '', callback) => {
    let aliasPath = ''
    if (typeof page !== 'string') {
      aliasPath = page.path
      page = page.src
    }
    if (!isUrlRequest(page)) return callback(null, page)
    if (resolveMode === 'native') {
      page = urlToRequest(page)
    }
    // 增加 page 标识
    page = addQuery(page, { isPage: true })
    resolve(context, page, loaderContext, (err, resource) => {
      if (err) return callback(err)
      const { resourcePath, queryObj: { isFirst } } = parseRequest(resource)
      const ext = path.extname(resourcePath)
      let outputPath
      if (aliasPath) {
        outputPath = aliasPath.replace(/^\//, '')
      } else {
        const relative = path.relative(context, resourcePath)
        if (/^\./.test(relative)) {
          // 如果当前page不存在于context中，对其进行重命名
          outputPath = getOutputPath(resourcePath, 'page')
          emitWarning(`Current page [${resourcePath}] is not in current pages directory [${context}], the page path will be replaced with [${outputPath}], use ?resolve to get the page path and navigate to it!`)
        } else {
          outputPath = /^(.*?)(\.[^.]*)?$/.exec(relative)[1]
        }
      }
      if (ext === '.js') {
        resource = `!!${nativeLoaderPath}!${resource}`
      }
      const entry = getDynamicEntry(resource, 'page', outputPath, tarRoot, publicPath + tarRoot)
      const key = [resourcePath, outputPath, tarRoot].join('|')
      callback(null, entry, {
        isFirst,
        key
      })
    })
  }

  const processJsExport = (js, context, tarRoot = '', callback) => {
    if (resolveMode === 'native') {
      js = urlToRequest(js)
    }
    resolve(context, js, loaderContext, (err, resource) => {
      if (err) return callback(err)
      const { resourcePath } = parseRequest(resource)
      const relative = path.relative(context, resourcePath)
      if (/^\./.test(relative)) {
        return callback(new Error(`The js export path ${resourcePath} must be in the context ${context}!`))
      }
      const outputPath = /^(.*?)(\.[^.]*)?$/.exec(relative)[1]
      const entry = getDynamicEntry(resource, 'export', outputPath, tarRoot, publicPath + tarRoot)
      callback(null, entry)
    })
  }

  return {
    processComponent,
    processDynamicEntry,
    processPage,
    processJsExport,
    isUrlRequest,
    urlToRequest
  }
}
