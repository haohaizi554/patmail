/** 从 FileSearch.aspx 的 #table_element 抽出查询字段。整段函数可单独放进页面执行。不读取 cookie、账号或输入值。 */

export function scanFileSearchForm(doc) {
  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').replace(/：/g, '').trim()
  }
  function labelOf(cell) {
    const named = cell.querySelector('span[name="Dictionary"]')
    return clean(named ? named.textContent : cell.textContent)
  }
  function inlineHidden(node) {
    return /display\s*:\s*none/i.test(node.getAttribute('style') || '')
  }
  function hideChain(node) {
    const chain = []
    let current = node
    while (current && current.id !== 'table_element') {
      if (inlineHidden(current)) {
        const id = current.id ? `#${current.id}` : ''
        const classes = String(current.className || '').trim().replace(/\s+/g, '.')
        chain.push(`${current.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ''}`)
      }
      current = current.parentElement
    }
    return chain
  }
  function controlOf(node) {
    const tag = node.tagName.toLowerCase()
    if (tag === 'select') return 'select'
    if (tag === 'textarea') return 'text'
    if (node.type === 'checkbox') return 'check'
    if (node.readOnly || node.getAttribute('readonly') != null || node.classList.contains('li_down')) return 'picker'
    return 'text'
  }
  function treeRoot(node) {
    const treeId = node.getAttribute('tree_id')
    const owner = node.ownerDocument
    if (treeId && owner) {
      const found = owner.getElementById(treeId)
      if (found) return found
    }
    return node.parentElement ? node.parentElement.querySelector('ul.ztree') : null
  }
  function clipped(text, max) {
    return clean(text).slice(0, max)
  }
  function treeOptions(node) {
    const list = treeRoot(node)
    if (!list) return []
    const view = node.ownerDocument.defaultView
    const jq = view && (view.jQuery || view.$)
    const api = jq && jq.fn && jq.fn.zTree
    const tree = api && list.id ? api.getZTreeObj(list.id) : null
    const options = []
    if (tree && typeof tree.getNodes === 'function') {
      const flat = typeof tree.transformToArray === 'function' ? tree.transformToArray(tree.getNodes()) : tree.getNodes()
      for (const item of flat) {
        if (!item || options.length >= 800) break
        const label = clipped(item.name || item.text || '', 160)
        const rawId = item.id == null ? '' : String(item.id)
        const value = rawId && rawId !== item.tId ? clipped(rawId, 80) : ''
        if (!label || !value || label === '请选择') continue
        const parentNode = typeof item.getParentNode === 'function' ? item.getParentNode() : null
        const parentRaw = parentNode && parentNode.id != null && String(parentNode.id) !== String(parentNode.tId || '')
          ? String(parentNode.id)
          : (item.pId == null || item.pId === '' || item.pId === 0 ? '' : String(item.pId))
        const parent = parentRaw && parentRaw !== 'null' ? clipped(parentRaw, 80) : ''
        options.push(parent && parent !== value ? { value, label, parent } : { value, label })
      }
      if (options.length) return options
    }
    for (const anchor of list.querySelectorAll('a[title]')) {
      if (options.length >= 800) break
      const label = clipped(anchor.getAttribute('title') || anchor.textContent, 160)
      if (!label || label === '请选择') continue
      options.push({ value: label, label })
    }
    return options
  }
  function optionsOf(node) {
    if (node.tagName === 'SELECT') {
      return [...node.querySelectorAll('option')].slice(0, 800).map(option => ({
        value: clipped(option.getAttribute('value') === null ? option.textContent : (option.getAttribute('value') || ''), 80),
        label: clipped(option.textContent, 160) || '请选择'
      }))
    }
    return treeOptions(node)
  }
  function seenControl(node) {
    if (node.closest('.TreeUserItem, .autoSearchItem, script')) return false
    const id = node.id || ''
    return Boolean(id) && !/txtSearch$|treetxtSearch$|_tree/i.test(id)
  }

  const root = doc && doc.querySelector ? doc : document
  const table = root.querySelector('#table_element')
  if (!table) return { page: 'FileSearch.aspx', fields: [] }
  let section = 'case'
  let advanced = false
  const fields = []
  const seen = new Set()
  for (const row of table.querySelectorAll('tr')) {
    if (row.querySelector('#btn_more')) {
      advanced = true
      continue
    }
    if (row.id === 'is_file') {
      section = 'file'
      continue
    }
    const cells = [...row.children]
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]
      const title = [...cells.slice(0, index)].reverse().find(item => item.classList.contains('tdtitle') || item.querySelector('span[name="Dictionary"]'))
      const controls = [...cell.querySelectorAll('input, select, textarea')].filter(seenControl)
      for (const control of controls) {
        if (seen.has(control.id)) continue
        seen.add(control.id)
        const chain = hideChain(control)
        const view = root.defaultView
        const computedHidden = view ? view.getComputedStyle(control).display === 'none' || view.getComputedStyle(row).display === 'none' : chain.length > 0
        fields.push({
          id: control.id,
          label: title ? labelOf(title) : control.id,
          section: section === 'file' ? 'file' : 'case',
          advanced: section === 'case' && advanced,
          control: controlOf(control),
          visible: chain.length === 0 && !computedHidden,
          hiddenBy: chain,
          options: optionsOf(control)
        })
      }
    }
  }
  return { page: 'FileSearch.aspx', fields }
}

/** 点开只读树形框，等页面把选项写进 zTree。不读取已填内容和 cookie。 */
export async function warmFileSearchTrees(doc) {
  const root = doc && doc.querySelector ? doc : document
  const view = root.defaultView || window
  const jq = view.jQuery || view.$
  const sleep = milliseconds => new Promise(resolve => view.setTimeout(resolve, milliseconds))
  async function waitForLinks(list) {
    let last = -1
    let stable = 0
    const started = Date.now()
    while (Date.now() - started < 2500) {
      const count = list ? list.querySelectorAll('a[title]').length : 0
      if (count > 0 && count === last) {
        stable += 1
        if (stable >= 2) return count
      } else {
        stable = 0
      }
      last = count
      await sleep(150)
    }
    return list ? list.querySelectorAll('a[title]').length : 0
  }
  const inputs = [...root.querySelectorAll('#table_element input.li_down')]
  for (const input of inputs) {
    if (view.getComputedStyle(input).display === 'none') continue
    const list = input.parentElement ? input.parentElement.querySelector('ul.ztree') : null
    if (list && list.querySelector('a[title]')) continue
    if (jq) jq(input).trigger('click')
    else input.click()
    const count = await waitForLinks(list)
    const api = jq && jq.fn && jq.fn.zTree
    const tree = api && list && list.id ? api.getZTreeObj(list.id) : null
    if (tree && count < 8 && typeof tree.expandAll === 'function') {
      tree.expandAll(true)
      await waitForLinks(list)
    }
  }
  if (jq && root.body) jq(root.body).trigger('click')
  else root.body?.click()
}
