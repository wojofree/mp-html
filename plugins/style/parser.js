const blank = {
  ' ': true,
  '\n': true,
  '\t': true,
  '\r': true,
  '\f': true
}

function Parser (viewportWidth) {
  this.styles = []
  this.selectors = []
  this.variables = Object.create(null)
  this.viewportWidth = viewportWidth === undefined ? getViewportWidth() : viewportWidth
}

/**
 * @description 解析 css 字符串
 * @param {string} content css 内容
 */
Parser.prototype.parse = function (content) {
  this.styles = []
  this.selectors = []
  content = flattenMedia(content, this.viewportWidth)
  collectVariables(content, this.variables)
  new Lexer(this).parse(content)
  return this.styles
}

/**
 * @description 展开 css 自定义变量
 * @param {string} content css 内容
 * @returns {string} 展开后的内容
 */
Parser.prototype.resolve = function (content) {
  return resolveVariables(content, this.variables, Object.create(null))
}

/**
 * @description 收集 :root 中的自定义变量
 * @param {string} content css 内容
 * @param {object} variables 变量表
 */
function collectVariables (content, variables) {
  let i = 0
  let quote
  let comment = false
  while (i < content.length) {
    const c = content[i]
    if (comment) {
      if (c === '*' && content[i + 1] === '/') {
        comment = false
        i += 2
      } else i++
      continue
    }
    if (quote) {
      if (c === '\\') i += 2
      else {
        if (c === quote) quote = undefined
        i++
      }
      continue
    }
    if (c === '/' && content[i + 1] === '*') {
      comment = true
      i += 2
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      i++
      continue
    }
    if (content.substr(i, 5).toLowerCase() === ':root' &&
      !/[\w-]/.test(content[i + 5] || '') &&
      (!i || /[\s,}]/.test(content[i - 1]))) {
      const block = readMediaBlock(content, i + 5)
      if (block) {
        collectDeclarations(block.content, variables)
        i = block.end
        continue
      }
    }
    i++
  }
}

/**
 * @description 收集声明块中的自定义变量
 * @param {string} content 声明内容
 * @param {object} variables 变量表
 */
function collectDeclarations (content, variables) {
  let start = 0
  let floor = 0
  let quote
  for (let i = 0; i <= content.length; i++) {
    const c = content[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = undefined
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '(') {
      floor++
    } else if (c === ')') {
      floor--
    } else if ((c === ';' && !floor) || i === content.length) {
      const declaration = content.substring(start, i)
      const colon = declaration.indexOf(':')
      if (colon > 0) {
        const name = declaration.substring(0, colon).trim()
        if (name.substr(0, 2) === '--') {
          variables[name] = declaration.substring(colon + 1).trim()
        }
      }
      start = i + 1
    }
  }
}

/**
 * @description 递归展开 var()，支持 fallback 和变量引用变量
 * @param {string} content css 内容
 * @param {object} variables 变量表
 * @param {object} stack 当前解析栈
 * @returns {string} 展开后的内容
 */
function resolveVariables (content, variables, stack) {
  let output = ''
  let start = 0
  for (let i = 0; i < content.length; i++) {
    if (content.substr(i, 4).toLowerCase() !== 'var(') continue
    const end = findClosingParenthesis(content, i + 3)
    if (end < 0) break
    output += content.substring(start, i)
    const info = splitVariable(content.substring(i + 4, end))
    const name = info.name.trim()
    let value
    if (Object.prototype.hasOwnProperty.call(variables, name) && !stack[name]) {
      stack[name] = true
      value = resolveVariables(variables[name], variables, stack)
      stack[name] = false
    } else if (info.fallback !== undefined) {
      value = resolveVariables(info.fallback.trim(), variables, stack)
    } else {
      value = content.substring(i, end + 1)
    }
    output += value
    i = end
    start = end + 1
  }
  return output + content.substring(start)
}

function findClosingParenthesis (content, open) {
  let floor = 1
  let quote
  for (let i = open + 1; i < content.length; i++) {
    const c = content[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = undefined
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '(') {
      floor++
    } else if (c === ')' && !--floor) {
      return i
    }
  }
  return -1
}

function splitVariable (content) {
  let floor = 0
  let quote
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = undefined
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '(') {
      floor++
    } else if (c === ')') {
      floor--
    } else if (c === ',' && !floor) {
      return {
        name: content.substring(0, i),
        fallback: content.substring(i + 1)
      }
    }
  }
  return { name: content }
}

/**
 * @description 按当前视口展开命中的 media，保持原始层叠顺序
 * @param {string} content css 内容
 * @param {number} viewportWidth 视口逻辑宽度
 * @returns {string} 合并后的 css
 */
function flattenMedia (content, viewportWidth) {
  let output = ''
  let start = 0
  let i = 0
  let quote
  let comment = false

  while (i < content.length) {
    const c = content[i]
    if (comment) {
      if (c === '*' && content[i + 1] === '/') {
        comment = false
        i += 2
      } else {
        i++
      }
      continue
    }
    if (quote) {
      if (c === '\\') {
        i += 2
      } else {
        if (c === quote) quote = undefined
        i++
      }
      continue
    }
    if (c === '/' && content[i + 1] === '*') {
      comment = true
      i += 2
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      i++
      continue
    }
    if (content.substr(i, 6).toLowerCase() === '@media' && !/[\w-]/.test(content[i + 6] || '')) {
      const block = readMediaBlock(content, i + 6)
      if (block) {
        output += content.substring(start, i)
        if (matchesMediaQuery(block.query, viewportWidth)) {
          output += flattenMedia(block.content, viewportWidth)
        }
        i = block.end
        start = i
        continue
      }
    }
    i++
  }

  return output + content.substring(start)
}

/**
 * @description 判断 media 查询是否匹配当前视口
 * @param {string} query media 查询
 * @param {number} viewportWidth 视口逻辑宽度
 * @returns {boolean} 是否匹配
 */
function matchesMediaQuery (query, viewportWidth) {
  const queries = splitMediaQueries(query)
  for (let i = 0; i < queries.length; i++) {
    if (matchesSingleMediaQuery(queries[i], viewportWidth)) return true
  }
  return false
}

function splitMediaQueries (query) {
  const list = []
  let start = 0
  let floor = 0
  for (let i = 0; i <= query.length; i++) {
    const c = query[i]
    if (c === '(') floor++
    else if (c === ')') floor--
    else if ((c === ',' && !floor) || i === query.length) {
      list.push(query.substring(start, i).trim())
      start = i + 1
    }
  }
  return list
}

function matchesSingleMediaQuery (query, viewportWidth) {
  if (!query) return false
  const normalized = query.toLowerCase().replace(/^only\s+/, '').trim()
  if (/^print\b/.test(normalized) || /^not\s+screen\b/.test(normalized)) return false

  const type = normalized.match(/^(?:not\s+)?([a-z-]+)/)
  if (type && type[1] !== 'screen' && type[1] !== 'all' && type[1] !== 'and') return false

  const features = []
  normalized.replace(/\(([^()]*)\)/g, (_, feature) => {
    features.push(feature.trim())
    return ''
  })
  const remainder = normalized.replace(/\([^()]*\)/g, '')
    .replace(/\b(?:only|screen|all|and)\b/g, '')
    .trim()
  if (remainder || !features.length) return false

  for (let i = 0; i < features.length; i++) {
    const match = features[i].match(/^(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px$/)
    if (!match) return false
    const width = Number(match[2])
    if (match[1] === 'min' && viewportWidth < width) return false
    if (match[1] === 'max' && viewportWidth > width) return false
  }
  return true
}

function getViewportWidth () {
  if (typeof wx !== 'undefined') {
    if (wx.canIUse && wx.canIUse('getWindowInfo') && wx.getWindowInfo) {
      return wx.getWindowInfo().windowWidth
    }
    if (wx.getSystemInfoSync) return wx.getSystemInfoSync().windowWidth
  }
  if (typeof uni !== 'undefined') {
    if (uni.getWindowInfo) return uni.getWindowInfo().windowWidth
    if (uni.getSystemInfoSync) return uni.getSystemInfoSync().windowWidth
  }
  if (typeof window !== 'undefined' && window.innerWidth) return window.innerWidth
  return 375
}

/**
 * @description 读取 media 查询及其完整块
 * @param {string} content css 内容
 * @param {number} start @media 后的位置
 * @returns {object|undefined} media 块
 */
function readMediaBlock (content, start) {
  let i = start
  let quote
  let comment = false
  let open = -1

  for (; i < content.length; i++) {
    const c = content[i]
    if (comment) {
      if (c === '*' && content[i + 1] === '/') {
        comment = false
        i++
      }
      continue
    }
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = undefined
      continue
    }
    if (c === '/' && content[i + 1] === '*') {
      comment = true
      i++
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '{') {
      open = i
      break
    } else if (c === ';') {
      return
    }
  }
  if (open < 0) return

  let floor = 1
  quote = undefined
  comment = false
  for (i = open + 1; i < content.length; i++) {
    const c = content[i]
    if (comment) {
      if (c === '*' && content[i + 1] === '/') {
        comment = false
        i++
      }
      continue
    }
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = undefined
      continue
    }
    if (c === '/' && content[i + 1] === '*') {
      comment = true
      i++
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '{') {
      floor++
    } else if (c === '}' && !--floor) {
      return {
        query: content.substring(start, open).trim(),
        content: content.substring(open + 1, i),
        end: i + 1
      }
    }
  }
}

/**
 * @description 解析到一个选择器
 * @param {string} name 名称
 */
Parser.prototype.onSelector = function (name) {
  const pseudoElement = name.match(/::?(before|after)\s*$/i)
  const staticPseudo = /:(?:first-child|last-child|only-child|nth-child|nth-last-child|first-of-type|last-of-type|only-of-type|nth-of-type|nth-last-of-type|not|is|where|empty|root)(?:\b|\()/i.test(name)
  const dynamicPseudo = /:(?:hover|active|focus|focus-within|focus-visible|visited|link|target|checked|disabled|enabled|required|optional|valid|invalid|in-range|out-of-range|read-only|read-write|placeholder-shown)(?:\b|\()/i.test(name)
  if (dynamicPseudo) return
  if (pseudoElement || staticPseudo) {
    this.selectors.push({
      deferred: true,
      pseudo: pseudoElement && pseudoElement[1].toLowerCase(),
      raw: pseudoElement ? name.substring(0, pseudoElement.index).trim() : name.trim()
    })
    return
  }
  // 不支持的选择器
  if (name.includes('[') || name.includes('*') || name.includes('@')) return
  const selector = {}
  // 伪类
  if (name.includes(':')) {
    const info = name.split(':')
    const pseudo = info.pop()
    if (pseudo === 'before' || pseudo === 'after') {
      selector.pseudo = pseudo
      name = info[0]
    } else return
  }

  // 分割交集选择器
  function splitItem (str) {
    const arr = []
    let i, start
    for (i = 1, start = 0; i < str.length; i++) {
      if (str[i] === '.' || str[i] === '#') {
        arr.push(str.substring(start, i))
        start = i
      }
    }
    if (!arr.length) {
      return str
    } else {
      arr.push(str.substring(start, i))
      return arr
    }
  }

  // 后代选择器
  if (name.includes(' ')) {
    selector.list = []
    const list = name.split(' ')
    for (let i = 0; i < list.length; i++) {
      if (list[i].length) {
        // 拆分子选择器
        const arr = list[i].split('>')
        for (let j = 0; j < arr.length; j++) {
          selector.list.push(splitItem(arr[j]))
          if (j < arr.length - 1) {
            selector.list.push('>')
          }
        }
      }
    }
  } else {
    selector.key = splitItem(name)
  }

  this.selectors.push(selector)
}

/**
 * @description 解析到选择器内容
 * @param {string} content 内容
 */
Parser.prototype.onContent = function (content) {
  // 并集选择器
  for (let i = 0; i < this.selectors.length; i++) {
    this.selectors[i].style = content
  }
  this.styles = this.styles.concat(this.selectors)
  this.selectors = []
}

/**
 * @description css 词法分析器
 * @param {object} handler 高层处理器
 */
function Lexer (handler) {
  this.selector = ''
  this.style = ''
  this.handler = handler
  this.selectorFloor = 0
}

Lexer.prototype.parse = function (content) {
  this.i = 0
  this.content = content
  this.state = this.blank
  for (let len = content.length; this.i < len; this.i++) {
    this.state(content[this.i])
  }
}

Lexer.prototype.comment = function () {
  this.i = this.content.indexOf('*/', this.i) + 1
  if (!this.i) {
    this.i = this.content.length
  }
}

Lexer.prototype.blank = function (c) {
  if (!blank[c]) {
    if (c === '/' && this.content[this.i + 1] === '*') {
      this.comment()
      return
    }
    this.selector += c
    this.state = this.name
  }
}

Lexer.prototype.name = function (c) {
  if (c === '/' && this.content[this.i + 1] === '*') {
    this.comment()
    return
  }
  if (c === '(' || c === '[') this.selectorFloor++
  else if (c === ')' || c === ']') this.selectorFloor--
  if (c === '{' || (c === ',' && !this.selectorFloor) || c === ';') {
    this.handler.onSelector(this.selector.trimEnd())
    this.selector = ''
    if (c !== '{') {
      while (blank[this.content[++this.i]]);
    }
    if (this.content[this.i] === '{') {
      this.floor = 1
      this.state = this.val
    } else {
      this.selector += this.content[this.i]
    }
  } else if (blank[c]) {
    this.selector += ' '
  } else {
    this.selector += c
  }
}

Lexer.prototype.val = function (c) {
  if (c === '/' && this.content[this.i + 1] === '*') {
    this.comment()
    return
  }
  if (c === '{') {
    this.floor++
  } else if (c === '}') {
    this.floor--
    if (!this.floor) {
      this.handler.onContent(this.style)
      this.style = ''
      this.state = this.blank
      return
    }
  }
  this.style += c
}

module.exports = Parser
