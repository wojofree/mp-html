/**
 * @fileoverview style 插件
 */
// #ifndef APP-PLUS-NVUE
const Parser = require('./parser')
const selector = require('./selector')
// #endif

function Style () {
  this.styles = []
  this.parser = new Parser()
}

// #ifndef APP-PLUS-NVUE
Style.prototype.onParse = function (node, vm) {
  // 获取样式
  if (node.name === 'style' && node.children.length && node.children[0].type === 'text') {
    this.styles = this.styles.concat(this.parser.parse(node.children[0].text))
  } else if (node.name) {
    if (node.attrs.id) node._styleId = node.attrs.id
    // 匹配样式（对非文本标签）
    // 存储不同优先级的样式 name < class < id < 后代
    let matched = ['', '', '', '']
    for (let i = 0, len = this.styles.length; i < len; i++) {
      const item = this.styles[i]
      if (item.deferred) continue
      let res = match(node, item.key || item.list[item.list.length - 1])
      let j
      if (res) {
        // 后代选择器
        if (!item.key) {
          j = item.list.length - 2
          for (let k = vm.stack.length; j >= 0 && k--;) {
            // 子选择器
            if (item.list[j] === '>') {
              // 错误情况
              if (j < 1 || j > item.list.length - 2) break
              if (match(vm.stack[k], item.list[j - 1])) {
                j -= 2
              } else {
                j++
              }
            } else if (match(vm.stack[k], item.list[j])) {
              j--
            }
          }
          res = 4
        }
        if (item.key || j < 0) {
          const style = this.parser.resolve(item.style)
          // 添加伪类
          if (item.pseudo && node.children) {
            let text
            const pseudoStyle = style.replace(/content:([^;]+)/, (_, $1) => {
              text = $1.replace(/['"]/g, '')
                // 处理 attr 函数
                .replace(/attr\((.+?)\)/, (_, $1) => node.attrs[$1.trim()] || '')
                // 编码 \xxx
                .replace(/\\(\w{4})/, (_, $1) => String.fromCharCode(parseInt($1, 16)))
              return ''
            })
            const pseudo = {
              name: 'span',
              attrs: {
                style: pseudoStyle
              },
              children: [{
                type: 'text',
                text
              }]
            }
            if (item.pseudo === 'before') {
              node.children.unshift(pseudo)
            } else {
              node.children.push(pseudo)
            }
          } else {
            matched[res - 1] += style + (style[style.length - 1] === ';' ? '' : ';')
          }
        }
      }
    }
    matched = matched.join('')
    const style = matched + (node.attrs.style || '')
    if (matched.length > 2 || style.includes('var(')) {
      node.attrs.style = this.parser.resolve(style)
    }
  }
}

Style.prototype.onParsed = function (nodes) {
  const rules = this.styles.filter(item => item.deferred)
  if (!rules.length) return
  const context = {
    parents: new WeakMap(),
    roots: nodes
  }
  const elements = []

  function collect (children, parent) {
    for (let i = 0; i < (children || []).length; i++) {
      const node = children[i]
      if (!node || !node.name) continue
      if (parent) context.parents.set(node, parent)
      elements.push(node)
      collect(node.children, node)
    }
  }
  collect(nodes)

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    const style = collectStyle(node, rules, context, false, this.parser)
    if (style) node.attrs.style = (node.attrs.style ? node.attrs.style + ';' : '') + style
  }

  materialize(nodes, rules, context, this.parser, Object.create(null))
  for (let i = 0; i < elements.length; i++) delete elements[i]._styleId
}

function collectStyle (node, rules, context, pseudo, parser) {
  const matched = []
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if ((rule.pseudo || false) !== pseudo) continue
    if (selector.matchSelector(node, rule.raw, context)) {
      matched.push({
        order: i,
        specificity: selector.specificity(rule.raw),
        style: parser.resolve(rule.style)
      })
    }
  }
  matched.sort((a, b) => a.specificity - b.specificity || a.order - b.order)
  return matched.map(item => item.style).join(';')
}

function parseDeclarations (style) {
  const declarations = []
  let start = 0
  let floor = 0
  let quote
  for (let i = 0; i <= style.length; i++) {
    const c = style[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = undefined
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(') floor++
    else if (c === ')') floor--
    else if ((c === ';' && !floor) || i === style.length) {
      const text = style.substring(start, i).trim()
      const colon = text.indexOf(':')
      if (colon > 0) {
        declarations.push({
          name: text.substring(0, colon).trim().toLowerCase(),
          value: text.substring(colon + 1).trim()
        })
      }
      start = i + 1
    }
  }
  return declarations
}

function propertyValue (style, name) {
  const declarations = parseDeclarations(style)
  let value
  let important = false
  for (let i = 0; i < declarations.length; i++) {
    if (declarations[i].name !== name) continue
    const nextImportant = /!important\s*$/i.test(declarations[i].value)
    if (!important || nextImportant) {
      value = declarations[i].value.replace(/\s*!important\s*$/i, '')
      important = nextImportant
    }
  }
  return value
}

function withoutContent (style) {
  return parseDeclarations(style)
    .filter(item => item.name !== 'content' && item.name.indexOf('counter-') !== 0)
    .map(item => item.name + ':' + item.value)
    .join(';')
}

function formatCounter (value, format) {
  if (format === 'decimal-leading-zero') return value < 10 ? '0' + value : String(value)
  if (format === 'lower-alpha' || format === 'upper-alpha') {
    let output = ''
    let current = value
    while (current > 0) {
      current--
      output = String.fromCharCode(97 + current % 26) + output
      current = Math.floor(current / 26)
    }
    return format === 'upper-alpha' ? output.toUpperCase() : output
  }
  return String(value)
}

function decodeCssText (text) {
  return text.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\(.)/g, '$1')
}

function generatedContent (value, node, counters) {
  if (value === undefined || /^(?:none|normal)$/i.test(value)) return
  const url = value.match(/^url\(\s*(["']?)(.*?)\1\s*\)$/i)
  if (url) {
    return {
      name: 'img',
      attrs: {
        src: url[2],
        style: 'max-width:100%;height:auto'
      }
    }
  }
  let text = value
  text = text.replace(/counters?\(\s*([\w-]+)(?:\s*,\s*(["'])(.*?)\2)?(?:\s*,\s*([\w-]+))?\s*\)/gi,
    (_, name, quote, separator, format) => formatCounter(counters[name] || 0, format || 'decimal'))
  text = text.replace(/attr\(\s*([\w:-]+)(?:\s+[^)]*)?\)/gi, (_, name) => (node.attrs && node.attrs[name]) || '')
  text = text.replace(/(["'])(.*?)\1/g, '$2')
    .replace(/\b(?:open-quote|close-quote|no-open-quote|no-close-quote)\b/g, '')
  return decodeCssText(text.trim())
}

function updateCounters (style, counters, property, initial) {
  const value = propertyValue(style, property)
  const saved = []
  if (!value || value === 'none') return saved
  const parts = value.trim().split(/\s+/)
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i]
    if (!/^[\w-]+$/.test(name)) continue
    let amount = initial
    if (/^[+-]?\d+$/.test(parts[i + 1] || '')) amount = Number(parts[++i])
    if (property === 'counter-reset') {
      saved.push({ name, exists: counters[name] !== undefined, value: counters[name] })
      counters[name] = amount
    } else counters[name] = (counters[name] || 0) + amount
  }
  return saved
}

function restoreCounters (saved, counters) {
  for (let i = saved.length; i--;) {
    if (saved[i].exists) counters[saved[i].name] = saved[i].value
    else delete counters[saved[i].name]
  }
}

function createPseudo (node, type, rules, context, parser, counters) {
  const style = collectStyle(node, rules, context, type, parser)
  if (!style || propertyValue(style, 'display') === 'none') return
  const content = generatedContent(propertyValue(style, 'content'), node, counters)
  if (content === undefined) return
  const pseudo = {
    name: 'span',
    attrs: {
      style: withoutContent(style).replace(/[0-9.]+\s*rpx/g, value => {
        let width = 375
        if (typeof wx !== 'undefined' && wx.getWindowInfo) width = wx.getWindowInfo().windowWidth
        return parseFloat(value) * width / 750 + 'px'
      })
    },
    children: []
  }
  if (typeof content === 'string') {
    if (content) pseudo.children.push({ type: 'text', text: content })
  } else pseudo.children.push(content)
  if (type === 'before') node.children.unshift(pseudo)
  else node.children.push(pseudo)
}

function materialize (nodes, rules, context, parser, counters) {
  for (let i = 0; i < (nodes || []).length; i++) {
    const node = nodes[i]
    if (!node || !node.name) continue
    const style = node.attrs.style || ''
    const saved = updateCounters(style, counters, 'counter-reset', 0)
    updateCounters(style, counters, 'counter-increment', 1)
    if (node.children) {
      const children = node.children.slice()
      createPseudo(node, 'before', rules, context, parser, counters)
      materialize(children, rules, context, parser, counters)
      createPseudo(node, 'after', rules, context, parser, counters)
    }
    restoreCounters(saved, counters)
  }
}

/**
 * @description 匹配样式
 * @param {object} node 要匹配的标签
 * @param {string|string[]} keys 选择器
 * @returns {number} 0：不匹配；1：name 匹配；2：class 匹配；3：id 匹配
 */
function match (node, keys) {
  function matchItem (key) {
    if (key[0] === '#') {
      // 匹配 id
      if (node.attrs.id && node.attrs.id.trim() === key.substr(1)) return 3
    } else if (key[0] === '.') {
      // 匹配 class
      key = key.substr(1)
      const selectors = (node.attrs.class || '').split(' ')
      for (let i = 0; i < selectors.length; i++) {
        if (selectors[i].trim() === key) return 2
      }
    } else if (node.name === key) {
      // 匹配 name
      return 1
    }
    return 0
  }

  // 多选择器交集
  if (keys instanceof Array) {
    let res = 0
    for (let j = 0; j < keys.length; j++) {
      const tmp = matchItem(keys[j])
      // 任意一个不匹配就失败
      if (!tmp) return 0
      // 优先级最大的一个作为最终优先级
      if (tmp > res) {
        res = tmp
      }
    }
    return res
  }

  return matchItem(keys)
}
// #endif

module.exports = Style
