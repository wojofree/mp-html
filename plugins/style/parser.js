const blank = {
  ' ': true,
  '\n': true,
  '\t': true,
  '\r': true,
  '\f': true
}

function Parser () {
  this.styles = []
  this.selectors = []
  this.variables = Object.create(null)
}

/**
 * @description 解析 css 字符串
 * @param {string} content css 内容
 */
Parser.prototype.parse = function (content) {
  this.styles = []
  this.selectors = []
  content = mergeSmallestMedia(content)
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
 * @description 保留基础样式，并仅合并最小的 max-width 断点
 * @param {string} content css 内容
 * @returns {string} 合并后的 css
 */
function mergeSmallestMedia (content) {
  let base = ''
  const media = []
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
        base += content.substring(start, i)
        const match = block.query.match(/max-width\s*:\s*(\d+(?:\.\d+)?)px/i)
        if (match && !/\bprint\b/i.test(block.query)) {
          media.push({
            width: Number(match[1]),
            content: block.content
          })
        }
        i = block.end
        start = i
        continue
      }
    }
    i++
  }

  base += content.substring(start)
  if (!media.length) return base

  let width = media[0].width
  for (i = 1; i < media.length; i++) {
    if (media[i].width < width) width = media[i].width
  }
  for (i = 0; i < media.length; i++) {
    if (media[i].width === width) base += '\n' + media[i].content
  }
  return base
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
  if (c === '{' || c === ',' || c === ';') {
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
