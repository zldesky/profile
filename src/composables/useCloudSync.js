import { shallowRef, watch } from 'vue'

import { useAuth } from '@/composables/useAuth'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { debounce } from '@/utils/helpers'
import { fetchCloudResume, saveCloudResume } from '@/utils/cloudResume'

/**
 * 云端同步。登录后生效，未登录时编辑器保持纯本地，不发出任何请求。
 *
 * 同步策略（对单用户单简历足够，也最不容易丢数据）：
 *  - 登录成功：云端有快照 → 以云端为准载入（换设备/重装浏览器的恢复路径）；
 *              云端没有 → 把当前本地简历推上去（首次登录的一次性迁移）；
 *  - 编辑期间：改动防抖 1.2s 后整体覆盖推送（本地 400ms 自动保存之上再加一层）；
 *  - 会话过期：回到匿名态并提示，本地编辑不中断。
 *
 * 最后写入者胜出：同一账号多开编辑时后保存的赢。简历场景下
 * 「两份都想要」应走导出 JSON 备份，而不是做字段级合并。
 */
export function useCloudSync() {
  const store = useResumeStore()
  const auth = useAuth()
  const { toast } = useToast()

  /** 登录瞬间的恢复/迁移进行中，供界面提示 */
  const syncing = shallowRef(false)

  /** 推送失败时降级为纯本地，下次改动再尝试；不打断输入 */
  const pushLater = debounce(() => {
    if (!auth.user.value) return
    saveCloudResume(store.resume).catch((error) => {
      if (error.code === 'AUTH_EXPIRED') {
        auth.markExpired()
        toast('登录已过期，已切换为本地编辑')
        return
      }
      toast(`云端保存失败：${error.message}`, 3200)
    })
  }, 1200)

  watch(
    () => auth.user.value,
    async (loggedIn) => {
      if (!loggedIn) return

      syncing.value = true
      try {
        const remote = await fetchCloudResume()
        if (remote) {
          store.replaceResume(remote)
          store.save()
          toast('已从云端恢复简历')
        } else {
          await saveCloudResume(store.resume)
          toast('本地简历已同步到云端')
        }
      } catch (error) {
        if (error.code === 'AUTH_EXPIRED') {
          auth.markExpired()
          toast('登录已过期，已切换为本地编辑')
        } else {
          toast(`云端同步失败：${error.message}`, 3600)
        }
      } finally {
        syncing.value = false
      }
    },
  )

  // 与本地自动保存同一触发源；未登录时这里直接短路，不排队不请求
  watch(
    () => store.resume,
    () => {
      if (auth.user.value) pushLater()
    },
    { deep: true },
  )

  /** 关页/切后台前把未满防抖窗口的改动用 keepalive 请求发出 */
  function flushOnHide() {
    if (!auth.user.value) return
    pushLater.cancel()
    saveCloudResume(store.resume, { keepalive: true }).catch(() => {
      // 页面正在卸载，已无 UI 可提示；下次打开时会以服务端/本地较新者为准
    })
  }
  window.addEventListener('pagehide', flushOnHide)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide()
  })

  return { syncing }
}
