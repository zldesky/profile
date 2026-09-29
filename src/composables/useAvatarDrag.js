import { computed, shallowRef, toValue } from 'vue'

import { MM_TO_PX } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

/**
 * 头像拖拽定位与边界测量。
 *
 * 边界规则：
 *  - 水平：取「头像所在容器」与「纸张内边距」的交集，跨不出容器左右边界；
 *  - 垂直：向上不越过容器顶部，向下最多让出一个头像的高度，
 *    页头随之等量撑高，因此头像始终留在页头内，不可能压住正文。
 *
 * 测得的结果写入 store 作为唯一边界，拖拽与面板滑杆共用。
 *
 * @param {import('vue').Ref<HTMLElement|null>} paperRef 纸张元素
 * @param {import('vue').Ref<number>} zoom 当前缩放比
 */
export function useAvatarDrag(paperRef, zoom) {
  const store = useResumeStore()

  const dragging = shallowRef(false)

  /** 拖拽过程中的实时偏移读数 */
  const offset = computed(() => ({
    x: Math.round(Number(store.basics.avatarPos?.dx) || 0),
    y: Math.round(Number(store.basics.avatarPos?.dy) || 0),
  }))

  /**
   * 测量可拖拽范围。
   * getBoundingClientRect 已包含当前 translate，需先扣除再计算，
   * 否则边界会随拖动一起漂移。
   */
  function syncLimits() {
    const paper = toValue(paperRef)
    const avatar = paper?.querySelector('.r-avatar')
    const container = avatar?.parentElement
    if (!paper || !avatar || !container) return

    const scale = toValue(zoom) || 1
    const mmPerPx = 1 / (MM_TO_PX * scale)
    const paperRect = paper.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const avatarRect = avatar.getBoundingClientRect()

    /*
     * 预览被 v-show 隐藏时所有矩形都是 0，据此算出的边界会把偏移夹到错误的值上，
     * 而且 setAvatarPos 会把结果写回数据。等容器重新可见时会再测一次，直接跳过即可。
     */
    if (!paperRect.width || !avatarRect.width) return

    const offsetX = (Number(store.basics.avatarPos?.dx) || 0) * MM_TO_PX * scale
    const offsetY = (Number(store.basics.avatarPos?.dy) || 0) * MM_TO_PX * scale
    const baseLeft = avatarRect.left - offsetX
    const baseRight = avatarRect.right - offsetX
    const baseTop = avatarRect.top - offsetY
    const baseBottom = avatarRect.bottom - offsetY

    const padX = store.theme.mh * MM_TO_PX * scale
    const padY = store.theme.mv * MM_TO_PX * scale

    const minX = Math.max(paperRect.left + padX, containerRect.left)
    const maxX = Math.min(paperRect.right - padX, containerRect.right)

    store.setAvatarLimits({
      minDx: (minX - baseLeft) * mmPerPx,
      maxDx: (maxX - baseRight) * mmPerPx,
      minDy: (Math.max(paperRect.top + padY, containerRect.top) - baseTop) * mmPerPx,
      maxDy: Math.min(
        store.basics.avatarHeight,
        (paperRect.bottom - padY - baseBottom) * mmPerPx,
      ),
    })

    // 切换模板或改尺寸后边界会变，用新边界重新裁剪一次当前偏移
    store.setAvatarPos({})
  }

  /**
   * 头像拖拽。
   * 只累计原始位移并交给 store，由 store 按已测得的边界统一裁剪。
   */
  function onPaperPointerDown(event) {
    const avatar = event.target.closest?.('.r-avatar')
    if (!avatar || event.button !== 0) return

    event.preventDefault()

    const mmPerPx = 1 / (MM_TO_PX * (toValue(zoom) || 1))
    const startX = event.clientX
    const startY = event.clientY
    const baseDx = Number(store.basics.avatarPos?.dx) || 0
    const baseDy = Number(store.basics.avatarPos?.dy) || 0

    dragging.value = true
    avatar.setPointerCapture(event.pointerId)

    const onMove = (moveEvent) => {
      store.setAvatarPos({
        dx: baseDx + (moveEvent.clientX - startX) * mmPerPx,
        dy: baseDy + (moveEvent.clientY - startY) * mmPerPx,
      })
    }

    const onUp = () => {
      dragging.value = false
      avatar.removeEventListener('pointermove', onMove)
      avatar.removeEventListener('pointerup', onUp)
      avatar.removeEventListener('pointercancel', onUp)
    }

    avatar.addEventListener('pointermove', onMove)
    avatar.addEventListener('pointerup', onUp)
    avatar.addEventListener('pointercancel', onUp)
  }

  return { dragging, offset, syncLimits, onPaperPointerDown }
}
