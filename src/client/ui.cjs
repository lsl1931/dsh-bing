// React surface: one sound picker shared by the full settings page and the
// Plugins-page tab. JSX-free: build.mjs does not transpile, so everything is
// React.createElement.
const React = require('react')
const { createElement: h, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React
const { fmt } = require('./locales.cjs')

function useSettings(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

function useLibrary(loadLibrary) {
  const [library, setLibrary] = useState({ builtin: [], custom: [] })
  const loaderRef = useRef(loadLibrary)
  useEffect(() => {
    loaderRef.current = loadLibrary
  }, [loadLibrary])
  const reload = React.useCallback(() => {
    const loader = loaderRef.current
    if (typeof loader !== 'function') return
    void loader().then(value => {
      if (value !== null && typeof value === 'object') {
        setLibrary({
          builtin: Array.isArray(value.builtin) ? value.builtin : [],
          custom: Array.isArray(value.custom) ? value.custom : [],
        })
      }
    }).catch(() => {})
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return { library, reload }
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function labelOf(id, library, t) {
  if (id === 'silent') return t('silent')
  const all = (library.builtin || []).concat(library.custom || [])
  const found = all.find(item => item.id === id)
  if (found !== undefined) return found.name || id
  if (typeof id === 'string' && id.indexOf(':') !== -1) return id.slice(id.indexOf(':') + 1).replace(/[-_]/g, ' ')
  return id
}

function SoundPicker(props) {
  const { value, library, t, onPick, onPreview } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = event => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const groups = [
    { key: 'builtin', label: t('groupBuiltin'), items: library.builtin || [] },
    { key: 'custom', label: t('groupCustom'), items: library.custom || [] },
  ]

  const sections = groups.map(group => {
    const options = group.items.length === 0
      ? h('div', { className: 'dsh_bing_empty' }, t('empty'))
      : group.items.map(item => {
        const main = h('button', {
          type: 'button',
          className: 'dsh_bing_optionMain',
          onClick: () => {
            onPick(item.id)
            setOpen(false)
          },
        },
        h('span', { className: 'dsh_bing_optionName' }, item.name || item.id),
        h('span', { className: 'dsh_bing_optionMeta' },
          item.description || (typeof item.seconds === 'number' ? item.seconds.toFixed(2) + 's' : '')))

        const preview = h('button', {
          type: 'button',
          className: 'dsh_bing_preview',
          title: t('preview'),
          'aria-label': t('preview'),
          onClick: event => {
            event.stopPropagation()
            onPreview(item.id)
          },
        }, '▶')

        return h('div', {
          key: item.id,
          role: 'option',
          'aria-selected': item.id === value ? 'true' : 'false',
          className: 'dsh_bing_option' + (item.id === value ? ' dsh_bing_selected' : ''),
        }, main, preview)
      })

    return h('div', { key: group.key, className: 'dsh_bing_group' },
      h('div', { className: 'dsh_bing_groupLabel' }, group.label),
      options)
  })

  return h('div', { className: 'dsh_bing_picker', ref: rootRef },
    h('button', {
      type: 'button',
      className: 'dsh_bing_trigger',
      'aria-expanded': open ? 'true' : 'false',
      onClick: () => setOpen(current => !current),
    },
    h('span', { className: 'dsh_bing_triggerLabel' }, labelOf(value, library, t)),
    h('span', { className: 'dsh_bing_caret' }, '▾')),
    open ? h('div', { className: 'dsh_bing_panel', role: 'listbox' }, sections) : null)
}

function Toggle(props) {
  return h('div', { className: 'dsh_bing_row' },
    h('input', {
      id: props.id,
      className: 'dsh_bing_check',
      type: 'checkbox',
      checked: props.checked,
      onChange: event => props.onChange(event.target.checked),
    }),
    h('div', { className: 'dsh_bing_rowText' },
      h('label', { className: 'dsh_bing_rowLabel', htmlFor: props.id }, props.label),
      props.desc === undefined ? null : h('span', { className: 'dsh_bing_rowDesc' }, props.desc)))
}

function SoundRow(props) {
  const { group, label, t, settings, set, library, onPreview } = props
  return h('div', { className: 'dsh_bing_soundRow' },
    h('span', { className: 'dsh_bing_soundLabel' }, label),
    h(SoundPicker, {
      value: settings.sounds[group],
      library,
      t,
      onPick: id => set({ sounds: { ...settings.sounds, [group]: id } }),
      onPreview,
    }))
}

function LibraryCard(props) {
  const { t, library, onAdd, onRemove, note } = props
  const [cache, setCache] = useState(null)
  const cacheInfoRef = useRef(props.cacheInfo)
  useEffect(() => {
    cacheInfoRef.current = props.cacheInfo
  }, [props.cacheInfo])
  useEffect(() => {
    const loader = cacheInfoRef.current
    if (typeof loader !== 'function') return
    void loader().then(value => {
      if (value !== null && typeof value === 'object') setCache(value)
    }).catch(() => {})
  }, [])
  return h('div', { className: 'dsh_bing_card' },
    h('h3', { className: 'dsh_bing_cardTitle' }, t('libraryTitle')),
    library.custom.length === 0
      ? h('span', { className: 'dsh_bing_muted' }, t('libraryEmpty'))
      : h('ul', { className: 'dsh_bing_list' }, library.custom.map(item => h('li', {
        key: item.id,
        className: 'dsh_bing_listRow',
      },
      h('span', null, item.name + (item.bytes ? ' · ' + formatBytes(item.bytes) : '')),
      h('button', {
        type: 'button',
        className: 'dsh_bing_button dsh_bing_danger',
        onClick: () => onRemove(item.id),
      }, t('remove'))))),
    h('div', { className: 'dsh_bing_actions' },
      h('button', { type: 'button', className: 'dsh_bing_button', onClick: onAdd }, t('addSound')),
      note === '' ? null : h('span', { className: 'dsh_bing_note' }, note)),
    cache === null ? null : h('div', { className: 'dsh_bing_row' },
      h('span', { className: 'dsh_bing_muted' },
        cache.files > 0
          ? fmt(t('cacheInUse'), { files: String(cache.files), size: formatBytes(cache.bytes) })
          : t('cacheEmpty')),
      cache.files > 0
        ? h('button', {
          type: 'button',
          className: 'dsh_bing_button',
          onClick: () => {
            void props.clearCache().then(value => {
              if (value !== null && typeof value === 'object') setCache({ files: 0, bytes: 0 })
            }).catch(() => {})
          },
        }, t('cacheClear'))
        : null))
}

function ControlPanel(props) {
  const t = typeof props.t === 'function' ? props.t : key => key
  const settings = useSettings(props.store)
  const { library, reload } = useLibrary(props.loadLibrary)
  const [note, setNote] = useState('')
  const set = props.set
  const preview = id => {
    void props.previewSound(id)
  }
  const addSound = () => {
    void props.pickFile().then(path => {
      if (path === '') return null
      return props.importSound(path)
    }).then(name => {
      if (name === null || name === undefined) {
        setNote(t('addFailed'))
        return
      }
      setNote(fmt(t('added'), { name }))
      reload()
    }).catch(() => setNote(t('addFailed')))
  }
  const removeSound = id => {
    void props.deleteSound(id).then(ok => {
      if (ok === true) {
        setNote(t('removed'))
        reload()
      }
    }).catch(() => {})
  }
  return h('div', { className: 'dsh_bing_section' },
    h('h2', { className: 'dsh_bing_h2' }, t('title')),
    h('p', { className: 'dsh_bing_subtitle' }, t('subtitle')),
    h('div', { className: 'dsh_bing_card' },
      h(Toggle, {
        id: 'dsh-bing-enabled',
        label: t('enabled'),
        desc: t('enabledDesc'),
        checked: settings.enabled,
        onChange: value => set({ enabled: value }),
      }),
      h(Toggle, {
        id: 'dsh-bing-sound',
        label: t('sound'),
        desc: t('soundDesc'),
        checked: settings.soundEnabled,
        onChange: value => set({ soundEnabled: value }),
      })),
    h('div', { className: 'dsh_bing_card' },
      h('h3', { className: 'dsh_bing_cardTitle' }, t('whenTitle')),
      h('span', { className: 'dsh_bing_rowDesc' }, t('whenDesc')),
      h(Toggle, { id: 'dsh-bing-completed', label: t('whenCompleted'), checked: settings.notifyCompleted, onChange: value => set({ notifyCompleted: value }) }),
      h(Toggle, { id: 'dsh-bing-error', label: t('whenError'), checked: settings.notifyError, onChange: value => set({ notifyError: value }) }),
      h(Toggle, { id: 'dsh-bing-aborted', label: t('whenAborted'), checked: settings.notifyAborted, onChange: value => set({ notifyAborted: value }) }),
      h(Toggle, { id: 'dsh-bing-blocked', label: t('whenBlocked'), checked: settings.notifyBlocked, onChange: value => set({ notifyBlocked: value }) }),
      h(Toggle, { id: 'dsh-bing-max', label: t('whenMaxTokens'), checked: settings.notifyMaxTokens, onChange: value => set({ notifyMaxTokens: value }) })),
    h('div', { className: 'dsh_bing_card' },
      h('h3', { className: 'dsh_bing_cardTitle' }, t('pendingTitle')),
      h('span', { className: 'dsh_bing_rowDesc' }, t('pendingDesc')),
      h(Toggle, { id: 'dsh-bing-approval', label: t('pendingApproval'), checked: settings.notifyApproval, onChange: value => set({ notifyApproval: value }) }),
      h(Toggle, { id: 'dsh-bing-question', label: t('pendingQuestion'), checked: settings.notifyQuestion, onChange: value => set({ notifyQuestion: value }) }),
      h(Toggle, { id: 'dsh-bing-plan', label: t('pendingPlanReview'), checked: settings.notifyPlanReview, onChange: value => set({ notifyPlanReview: value }) })),
    h('div', { className: 'dsh_bing_card' },
      h('h3', { className: 'dsh_bing_cardTitle' }, t('soundsTitle')),
      h('span', { className: 'dsh_bing_rowDesc' }, t('soundsDesc')),
      h(SoundRow, { group: 'finished', label: t('soundFinished'), t, settings, set, library, onPreview: preview }),
      h(SoundRow, { group: 'error', label: t('soundError'), t, settings, set, library, onPreview: preview }),
      h(SoundRow, { group: 'attention', label: t('soundAttention'), t, settings, set, library, onPreview: preview }),
      h(SoundRow, { group: 'reminder', label: t('soundReminder'), t, settings, set, library, onPreview: preview }),
      h('div', { className: 'dsh_bing_actions' },
        h('button', { type: 'button', className: 'dsh_bing_button', onClick: () => props.sendTest() }, t('testButton')))),
    h('div', { className: 'dsh_bing_card' },
      h('h3', { className: 'dsh_bing_cardTitle' }, t('remindTitle')),
      h('span', { className: 'dsh_bing_rowDesc' }, t('remindDesc')),
      h('label', { className: 'dsh_bing_row' },
        h('input', {
          className: 'dsh_bing_input',
          type: 'number',
          min: 1,
          max: 240,
          value: settings.remindAfterMinutes,
          onChange: event => set({ remindAfterMinutes: Number(event.target.value) }),
        }),
        h('span', { className: 'dsh_bing_rowLabel' }, t('remindMinutes')))),
    h(LibraryCard, {
      t,
      library,
      onAdd: addSound,
      onRemove: removeSound,
      note,
      cacheInfo: props.cacheInfo,
      clearCache: props.clearCache,
    }))
}

function BundleConfig(props) {
  return h(ControlPanel, props)
}

module.exports = { BundleConfig, ControlPanel, SoundPicker, labelOf, useLibrary, useSettings }