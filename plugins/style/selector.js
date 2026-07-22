function splitTopLevel (content, delimiter) {
  const list = []
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
    } else if (c === '(' || c === '[') {
      floor++
    } else if (c === ')' || c === ']') {
      floor--
    } else if ((c === delimiter && !floor) || i === content.length) {
      list.push(content.substring(start, i).trim())
      start = i + 1
    }
  }
  return list
}

function tokenize (selector) {
  const compounds = []
  const combinators = []
  let buffer = ''
  let floor = 0
  let quote
  let pendingSpace = false

  function flush () {
    const value = buffer.trim()
    if (value) compounds.push(value)
    buffer = ''
  }

  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (quote) {
      buffer += c
      if (c === '\\') buffer += selector[++i] || ''
      else if (c === quote) quote = undefined
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      buffer += c
    } else if (c === '(' || c === '[') {
      floor++
      buffer += c
    } else if (c === ')' || c === ']') {
      floor--
      buffer += c
    } else if (!floor && /\s/.test(c)) {
      if (buffer.trim()) {
        flush()
        pendingSpace = true
      }
    } else if (!floor && (c === '>' || c === '+' || c === '~')) {
      if (buffer.trim()) flush()
      if (compounds.length) {
        if (combinators.length === compounds.length) combinators[combinators.length - 1] = c
        else combinators.push(c)
      }
      pendingSpace = false
    } else {
      if (pendingSpace && compounds.length && combinators.length < compounds.length) combinators.push(' ')
      pendingSpace = false
      buffer += c
    }
  }
  if (buffer.trim()) flush()
  while (combinators.length >= compounds.length) combinators.pop()
  return { compounds, combinators }
}

function readIdentifier (content, start) {
  let i = start
  while (i < content.length && /[\w-]/.test(content[i])) i++
  return { value: content.substring(start, i), end: i }
}

function readBlock (content, start, open, close) {
  let floor = 1
  let quote
  for (let i = start + 1; i < content.length; i++) {
    const c = content[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = undefined
    } else if (c === '"' || c === "'") quote = c
    else if (c === open) floor++
    else if (c === close && !--floor) return { value: content.substring(start + 1, i), end: i + 1 }
  }
  return { value: '', end: content.length }
}

function parseCompound (content) {
  const result = { tag: '', ids: [], classes: [], attrs: [], pseudos: [] }
  let i = 0
  if (content[i] === '*') {
    result.tag = '*'
    i++
  } else if (/[a-z_-]/i.test(content[i] || '')) {
    const info = readIdentifier(content, i)
    result.tag = info.value.toLowerCase()
    i = info.end
  }
  while (i < content.length) {
    const c = content[i]
    if (c === '#' || c === '.') {
      const info = readIdentifier(content, i + 1)
      if (!info.value) return
      if (c === '#') result.ids.push(info.value)
      else result.classes.push(info.value)
      i = info.end
    } else if (c === '[') {
      const info = readBlock(content, i, '[', ']')
      result.attrs.push(info.value.trim())
      i = info.end
    } else if (c === ':') {
      const info = readIdentifier(content, i + 1)
      if (!info.value) return
      const pseudo = { name: info.value.toLowerCase() }
      i = info.end
      if (content[i] === '(') {
        const args = readBlock(content, i, '(', ')')
        pseudo.args = args.value.trim()
        i = args.end
      }
      result.pseudos.push(pseudo)
    } else return
  }
  return result
}

function elementSiblings (node, context, ofType) {
  const parent = context.parents.get(node)
  const children = parent ? parent.children : context.roots
  return (children || []).filter(item => item && item.name && (!ofType || item.name === node.name))
}

function nthMatches (expression, index) {
  const value = expression.replace(/\s+/g, '').toLowerCase()
  if (value === 'odd') return index % 2 === 1
  if (value === 'even') return index % 2 === 0
  if (/^[+-]?\d+$/.test(value)) return index === Number(value)
  const match = value.match(/^([+-]?\d*)n([+-]\d+)?$/)
  if (!match) return false
  let a = match[1]
  if (a === '' || a === '+') a = 1
  else if (a === '-') a = -1
  else a = Number(a)
  const b = Number(match[2] || 0)
  return a === 0 ? index === b : (index - b) / a >= 0 && Number.isInteger((index - b) / a)
}

function matchAttribute (node, expression) {
  const match = expression.match(/^([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:(["'])(.*?)\3|([^\s]+)))?$/)
  if (!match) return false
  const actual = node.attrs && node.attrs[match[1]]
  if (!match[2]) return actual !== undefined
  if (actual === undefined) return false
  const value = String(match[4] !== undefined ? match[4] : match[5])
  const text = String(actual)
  if (match[2] === '=') return text === value
  if (match[2] === '~=') return text.split(/\s+/).includes(value)
  if (match[2] === '|=') return text === value || text.indexOf(value + '-') === 0
  if (match[2] === '^=') return text.indexOf(value) === 0
  if (match[2] === '$=') return text.lastIndexOf(value) === text.length - value.length
  if (match[2] === '*=') return text.includes(value)
  return false
}

function matchPseudo (node, pseudo, context) {
  const name = pseudo.name
  const ofType = name.includes('of-type')
  const siblings = elementSiblings(node, context, ofType)
  const index = siblings.indexOf(node) + 1
  if (name === 'root') return !context.parents.get(node)
  if (name === 'empty') return !(node.children || []).some(child => child.name || (child.type === 'text' && child.text.trim()))
  if (name === 'first-child' || name === 'first-of-type') return index === 1
  if (name === 'last-child' || name === 'last-of-type') return index === siblings.length
  if (name === 'only-child' || name === 'only-of-type') return siblings.length === 1
  if (name === 'nth-child' || name === 'nth-of-type') return nthMatches(pseudo.args || '', index)
  if (name === 'nth-last-child' || name === 'nth-last-of-type') return nthMatches(pseudo.args || '', siblings.length - index + 1)
  if (name === 'not' || name === 'is' || name === 'where') {
    const matches = splitTopLevel(pseudo.args || '', ',').some(selector => matchSelector(node, selector, context))
    return name === 'not' ? !matches : matches
  }
  return false
}

function matchCompound (node, content, context) {
  const parsed = parseCompound(content)
  if (!parsed || !node || !node.name) return false
  if (parsed.tag && parsed.tag !== '*' && parsed.tag !== node.name) return false
  if (parsed.ids.some(id => !node.attrs || (node.attrs.id !== id && node._styleId !== id))) return false
  const classes = ((node.attrs && node.attrs.class) || '').split(/\s+/)
  if (parsed.classes.some(name => !classes.includes(name))) return false
  if (parsed.attrs.some(attr => !matchAttribute(node, attr))) return false
  if (parsed.pseudos.some(pseudo => !matchPseudo(node, pseudo, context))) return false
  return true
}

function previousElement (node, context) {
  const siblings = elementSiblings(node, context, false)
  return siblings[siblings.indexOf(node) - 1]
}

function matchTokens (node, tokens, index, context) {
  if (!matchCompound(node, tokens.compounds[index], context)) return false
  if (!index) return true
  const combinator = tokens.combinators[index - 1] || ' '
  if (combinator === '>') return matchTokens(context.parents.get(node), tokens, index - 1, context)
  if (combinator === '+') return matchTokens(previousElement(node, context), tokens, index - 1, context)
  if (combinator === '~') {
    let sibling = previousElement(node, context)
    while (sibling) {
      if (matchTokens(sibling, tokens, index - 1, context)) return true
      sibling = previousElement(sibling, context)
    }
    return false
  }
  let parent = context.parents.get(node)
  while (parent) {
    if (matchTokens(parent, tokens, index - 1, context)) return true
    parent = context.parents.get(parent)
  }
  return false
}

function matchSelector (node, selector, context) {
  const tokens = tokenize(selector)
  return !!tokens.compounds.length && matchTokens(node, tokens, tokens.compounds.length - 1, context)
}

function specificity (selector) {
  const clean = selector.replace(/:where\([^)]*\)/g, '')
  const ids = (clean.match(/#[\w-]+/g) || []).length
  const classes = (clean.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length
  const tags = (clean.match(/(^|[\s>+~,(])(?:[a-z][\w-]*)/gi) || []).length
  return ids * 10000 + classes * 100 + tags
}

module.exports = {
  matchSelector,
  specificity,
  splitTopLevel
}
