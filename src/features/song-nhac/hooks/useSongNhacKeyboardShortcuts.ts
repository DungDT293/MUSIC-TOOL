/**
 * Phím tắt cho Sóng nhạc: Delete, Escape, Ctrl+C, Ctrl+V, Ctrl+D, Ctrl+Z, Ctrl+Y.
 * Không kích hoạt khi đang nhập trong input/textarea.
 */

import { useEffect } from 'react'
import { useSongNhacLayerStore } from '../store/songNhacLayerStore'

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return el.isContentEditable
}

export function useSongNhacKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return

      const store = useSongNhacLayerStore.getState()
      const {
        selectedLayerId,
        selectedIds,
        removeLayer,
        removeSelectedLayers,
        setSelectedLayerId,
        duplicateLayer,
        duplicateSelectedLayers,
        copyLayer,
        copySelectedLayers,
        pasteLayers,
        undo,
        redo,
      } = store

      if (e.key === 'Escape') {
        setSelectedLayerId(null)
        e.preventDefault()
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 1) {
          removeSelectedLayers()
          e.preventDefault()
        } else if (selectedLayerId) {
          removeLayer(selectedLayerId)
          e.preventDefault()
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedIds.length > 1) {
          copySelectedLayers()
          e.preventDefault()
        } else if (selectedLayerId) {
          copyLayer(selectedLayerId)
          e.preventDefault()
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (store.clipboard.length > 0) {
          pasteLayers()
          e.preventDefault()
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        if (selectedIds.length > 1) {
          duplicateSelectedLayers()
          e.preventDefault()
        } else if (selectedLayerId) {
          duplicateLayer(selectedLayerId)
          e.preventDefault()
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          store.redo()
        } else {
          store.undo()
        }
        e.preventDefault()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        store.redo()
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
