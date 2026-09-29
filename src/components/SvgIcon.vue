<script setup>
/**
 * 统一图标组件。
 * 线条图标用于简历正文，实心感图标用于编辑器操作区，两者共用 stroke 绘制风格。
 */
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, default: 'none' },
  size: { type: [Number, String], default: 16 },
})

/** 每个图标由若干 path / circle / rect 描述，统一 24x24 视图盒 */
const ICONS = {
  none: [],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21a8 8 0 0 1 16 0'],
  cake: [
    'M4 20h16v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6Z',
    'M4 16h16',
    'M12 8V5',
    'M8 8V6',
    'M16 8V6',
  ],
  phone: [
    'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.5-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z',
  ],
  mail: ['M2 5h20v14H2z', 'm2 6 10 7 10-7'],
  location: [
    'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z',
    'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  ],
  briefcase: ['M2 8h20v13H2z', 'M9 8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3', 'M2 14h20'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  coin: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M12 7v10',
    'M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4',
  ],
  school: ['m3 9 9-5 9 5-9 5-9-5Z', 'M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5'],
  star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3Z'],
  award: ['M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z', 'm8.2 13.6-1.2 8L12 19l5 2.6-1.2-8'],
  link: [
    'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1',
    'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  ],
  github: [
    'M9 19c-4 1.4-4-2.2-6-2.8m12 5.3v-3.5c0-1 .1-1.4-.5-2 2.8-.3 4.5-1.5 4.5-5a4 4 0 0 0-1.1-2.7c.1-.9.1-1.8-.2-2.6 0 0-1.4 0-2.7 1a9.3 9.3 0 0 0-5 0C9.7 5.4 8.3 5.4 8.3 5.4c-.3.8-.3 1.7-.2 2.6A4 4 0 0 0 7 10.7c0 3.5 1.7 4.7 4.5 5-.6.6-.6 1.2-.5 2v3.5',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 15H6L5 6', 'M10 11v6M14 11v6'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  up: ['m6 14 6-6 6 6'],
  down: ['m6 10 6 6 6-6'],
  drag: ['M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  eyeOff: [
    'M3 3l18 18',
    'M10.6 10.6a3 3 0 0 0 4.2 4.2',
    'M6.7 6.8C4 8.4 2 12 2 12s3.6 7 10 7c2 0 3.7-.7 5.2-1.6',
    'M19.8 15.3C21.3 13.8 22 12 22 12s-3.6-7-10-7c-.7 0-1.4.1-2 .2',
  ],
  download: ['M12 3v12', 'm7 11 5 5 5-5', 'M4 21h16'],
  upload: ['M12 20V8', 'm7 12 5-5 5 5', 'M4 4h16'],
  print: ['M7 8V3h10v5', 'M5 8h14v8H5z', 'M8 16h8v5H8z'],
  image: ['M3 5h18v14H3z', 'M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', 'm4 17 5-5 4 4 3-3 4 4'],
  palette: [
    'M12 21a9 9 0 1 1 0-18c5 0 9 3.6 9 8 0 2.2-1.8 4-4 4h-1.5a2 2 0 0 0-1.4 3.4A1.7 1.7 0 0 1 12 21Z',
    'M7.5 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    'M11 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    'M15.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  ],
  layout: ['M3 4h18v16H3z', 'M3 9h18', 'M9 9v11'],
  text: ['M5 5h14', 'M5 10h11', 'M5 15h14', 'M5 20h8'],
  check: ['m5 13 4 4 10-11'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  zoomIn: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3', 'M11 8v6M8 11h6'],
  zoomOut: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3', 'M8 11h6'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7', 'M21 3v5h-5'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  lock: ['M6 11h12v9H6z', 'M9 11V8a3 3 0 0 1 6 0v3'],
}

const paths = computed(() => ICONS[props.name] || ICONS.none)
const pixelSize = computed(() => `${props.size}px`)
</script>

<template>
  <svg
    class="svg-icon"
    :width="pixelSize"
    :height="pixelSize"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>

<style scoped>
.svg-icon {
  flex: 0 0 auto;
  vertical-align: middle;
}
</style>
