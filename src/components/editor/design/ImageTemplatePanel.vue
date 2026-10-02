<script setup>
/**
 * 图片生成模板：导入一张参考简历截图，在本地分析出版式骨架与主色，
 * 套用到「自由定制」模板的布局参数上，生成一份可继续微调的自有模板。
 *
 * 两条图片来源：
 * - 本地文件：FileReader 直接读，全程不离开浏览器；
 * - 网络链接：经本机服务 /api/image-proxy 代取（外链画进 Canvas 会因
 *   CORS 污染读不出像素，且代理侧做了 SSRF 防护），需要登录后使用。
 */
import { ref } from 'vue'

import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { analyzeResumeImage } from '@/utils/imageTemplate'

const store = useResumeStore()
const { toast } = useToast()

const fileInput = ref(null)
const imageUrl = ref('')
const summary = ref('')
const busy = ref(false)

/** 把图片画到小尺寸画布上再取像素，240px 宽足以支撑区域统计且很快 */
async function analyzeFromSrc(src) {
  const image = new Image()
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => reject(new Error('图片加载失败，请换一张试试'))
    image.src = src
  })
  const scale = Math.min(1, 240 / image.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  return analyzeResumeImage(data, canvas.width, canvas.height)
}

/** 分析结果落到自由定制模板：识别不了的维度保留现状 */
function applyAnalysis(analysis) {
  const customLayout = { ...store.theme.customLayout }
  if (analysis.header) customLayout.header = analysis.header
  if (analysis.mode) customLayout.mode = analysis.mode
  if (analysis.ratio) customLayout.ratio = analysis.ratio
  const patch = { customLayout }
  if (analysis.accent) patch.accent = analysis.accent
  store.setTheme(patch)
  store.resume.template = 'custom'
}

async function runAnalysisTask(task) {
  if (busy.value) return
  busy.value = true
  try {
    const analysis = await task()
    applyAnalysis(analysis)
    summary.value = analysis.findings.join('；')
    toast('已按图片生成模板参数')
  } catch (error) {
    toast(error.message || '分析失败')
  } finally {
    busy.value = false
  }
}

function handleFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast('请选择图片文件')
    return
  }
  const src = URL.createObjectURL(file)
  runAnalysisTask(async () => {
    try {
      return await analyzeFromSrc(src)
    } finally {
      URL.revokeObjectURL(src)
    }
  })
}

function importFromUrl() {
  const url = imageUrl.value.trim()
  if (!/^https?:\/\//.test(url)) {
    toast('请粘贴 http/https 开头的图片链接')
    return
  }
  runAnalysisTask(async () => {
    const response = await fetch('/api/image-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.message || '抓取失败，也可以把图片保存到本地上传')
    }
    return analyzeFromSrc(payload.dataUrl)
  })
}
</script>

<template>
  <div class="ed-group">
    <div class="ed-group-title"><span>图片生成模板</span></div>

    <input
      ref="fileInput"
      class="img-file-input"
      type="file"
      accept="image/*"
      @change="handleFile"
    />
    <button class="ed-btn ed-btn-block" :disabled="busy" @click="fileInput.click()">
      {{ busy ? '分析中…' : '上传本机图片' }}
    </button>

    <div class="img-url-row">
      <input
        v-model="imageUrl"
        class="ed-input"
        type="url"
        placeholder="粘贴网络图片链接"
        @keydown.enter="importFromUrl"
      />
      <button class="ed-btn" :disabled="busy" @click="importFromUrl">抓取</button>
    </div>

    <p v-if="summary" class="img-summary">{{ summary }}</p>

    <p class="ed-hint">
      分析在本机完成：识别色带页头、左右色栏、双栏比例与主色，并套用到「自由定制」模板，识别不到的项保持现状，之后可在上方继续微调。抓取网络图片需登录并经本机服务代理；也可以把图片保存到本机后直接上传。
    </p>
  </div>
</template>

<style scoped>
.img-file-input {
  display: none;
}

.img-url-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.img-url-row .ed-input {
  flex: 1 1 auto;
  min-width: 0;
}

.img-summary {
  margin-top: 8px;
  padding: 7px 9px;
  border-radius: 8px;
  background: #f2f7f2;
  color: #256b43;
  font-size: 12px;
  line-height: 1.55;
}
</style>
