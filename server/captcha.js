/**
 * 滑块拼图验证码（零依赖）。
 *
 * 防的是脚本批量注册：缺口横向坐标只存在服务端内存里，响应中拿不到，
 * 拖动结果必须落在 ±容差内才算通过。图形是程序生成的 SVG（data URI
 * 交给 <img> 渲染，脚本不会执行），不需要任何图像处理依赖。
 *
 * 流程：
 *   1. GET /api/captcha       → 挑战 {id, 背景图, 拼图块, 块的纵坐标}；
 *   2. POST /api/captcha/verify {id, x} → 通过则签发一次性通过令牌；
 *   3. 注册接口 consume(令牌) → 用后即焚，重放/伪造/过期都过不去。
 *
 * 挑战与令牌的状态都在内存（重启即失效，挑战本身只活几分钟，无所谓）。
 * 单实例部署这是零成本方案；将来要多实例，把 pending/passed 换成
 * 共享存储，或显式设置 CAPTCHA_SECRET 让签名跨实例一致。
 */
import crypto from 'node:crypto'

import { safeEqual } from './auth.js'

/** 视图盒尺寸：前端按此等比缩放渲染，坐标换算见 SliderCaptcha 组件 */
export const VIEW_WIDTH = 320
export const VIEW_HEIGHT = 160
/** 拼图块边长与凸起半径（视图盒坐标） */
const PIECE_SIZE = 46
const KNOB_RADIUS = 8
/** 缺口横向位置的取值范围：两侧留边，保证块与凸起完整落在画布内 */
const MIN_X = 20
const MAX_X = VIEW_WIDTH - PIECE_SIZE - 20

/**
 * 创建验证码实例。
 * @param {object} [options]
 * @param {string} [options.secret] HMAC 密钥；留空则每次启动随机生成
 * @param {number} [options.ttlMs] 挑战有效期
 * @param {number} [options.passTtlMs] 通过令牌有效期
 * @param {number} [options.tolerance] 拖动结果与缺口坐标的容差
 * @param {number} [options.maxPending] 未完成挑战的内存上限，防刷爆
 * @param {() => number} [options.randomX] 缺口横向坐标（测试注入用）
 * @param {() => number} [options.randomY] 缺口纵向坐标（测试注入用）
 */
export function createCaptcha({
  secret = '',
  ttlMs = 3 * 60 * 1000,
  passTtlMs = 10 * 60 * 1000,
  tolerance = 7,
  maxPending = 5000,
  randomX = () => crypto.randomInt(MIN_X, MAX_X + 1),
  randomY = () => crypto.randomInt(14, VIEW_HEIGHT - PIECE_SIZE - 14),
} = {}) {
  const key = Buffer.from(secret.trim() || crypto.randomBytes(32).toString('hex'))

  /** @type {Map<string, { x: number, exp: number }>} 挑战 id → 缺口坐标 */
  const pending = new Map()
  /** @type {Map<string, number>} 通过令牌 jti → 过期时间（一次性凭证） */
  const passed = new Map()

  function sign(payload) {
    return crypto.createHmac('sha256', key).update(payload).digest('base64url')
  }

  function sweep(now) {
    for (const [id, entry] of pending) if (entry.exp <= now) pending.delete(id)
    for (const [jti, exp] of passed) if (exp <= now) passed.delete(jti)
  }

  /**
   * 生成一张挑战。场景内容（渐变 + 噪点图形）只画一次，
   * 背景与拼图块共用，块内用 clipPath 裁出缺口对应区域——
   * 拖到缺口横向位置时内容恰好对齐。
   */
  function challenge() {
    const now = Date.now()
    sweep(now)

    // 超过内存上限就丢掉最早的挑战：刷挑战接口烧不掉服务端内存
    if (pending.size >= maxPending) {
      pending.delete(pending.keys().next().value)
    }

    const id = crypto.randomBytes(12).toString('base64url')
    const x = randomX()
    const y = randomY()
    const exp = now + ttlMs
    pending.set(id, { x, exp })

    // 场景：底色渐变 + 随机半透明图形噪点，让缺口区域不易被边缘检测直接抠走
    const hue = crypto.randomInt(0, 360)
    const hue2 = (hue + crypto.randomInt(70, 200)) % 360
    const shapes = []
    for (let i = 0; i < 7; i += 1) {
      const h = (hue + crypto.randomInt(-45, 45) + 360) % 360
      const opacity = crypto.randomInt(15, 45) / 100
      if (i % 3 === 2) {
        const cx = crypto.randomInt(0, VIEW_WIDTH)
        const cy = crypto.randomInt(0, VIEW_HEIGHT)
        const r = crypto.randomInt(10, 30)
        shapes.push(
          `<path d="M${cx} ${cy - r} L${cx + r} ${cy + r} L${cx - r} ${cy + r} Z" ` +
            `fill="hsl(${h}, 60%, 55%)" opacity="${opacity}"/>`,
        )
      } else {
        const rx = crypto.randomInt(0, VIEW_WIDTH)
        const ry = crypto.randomInt(0, VIEW_HEIGHT)
        shapes.push(
          `<circle cx="${rx}" cy="${ry}" r="${crypto.randomInt(8, 34)}" ` +
            `fill="hsl(${h}, 60%, 55%)" opacity="${opacity}"/>`,
        )
      }
    }
    const content =
      `<rect width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}" fill="url(#${id}g)"/>` + shapes.join('')

    const holeRect = `<rect x="${x}" y="${y}" width="${PIECE_SIZE}" height="${PIECE_SIZE}" rx="8"/>`
    const knob = `<circle cx="${x + PIECE_SIZE / 2}" cy="${y}" r="${KNOB_RADIUS}"/>`

    const background =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}">` +
      `<defs>` +
      `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="hsl(${hue}, 62%, 72%)"/>` +
      `<stop offset="1" stop-color="hsl(${hue2}, 55%, 45%)"/>` +
      `</linearGradient>` +
      `<mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}">` +
      `<rect width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}" fill="#fff"/>` +
      holeRect.replace('/>', ' fill="#000"/>') +
      knob.replace('/>', ' fill="#000"/>') +
      `</mask></defs>` +
      content +
      `<rect width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}" fill="#0f172a" opacity="0.6" mask="url(#${id}m)"/>` +
      `</svg>`

    // 拼图块：viewBox 直接裁成缺口区域的小图（含上方凸起的余量），
    // 元素随拖动整体平移，落到缺口横向位置时内容恰好对齐。
    // 凸起朝上，viewBox 从 y-KNOB_RADIUS 起，clipPath 用平移后的局部坐标。
    const piece =
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="${x} ${y - KNOB_RADIUS} ${PIECE_SIZE} ${PIECE_SIZE + KNOB_RADIUS}">` +
      `<defs><clipPath id="${id}c">` +
      `<rect x="0" y="${KNOB_RADIUS}" width="${PIECE_SIZE}" height="${PIECE_SIZE}" rx="8"/>` +
      `<circle cx="${PIECE_SIZE / 2}" cy="${KNOB_RADIUS}" r="${KNOB_RADIUS}"/>` +
      `</clipPath></defs>` +
      `<g clip-path="url(#${id}c)">${content}</g>` +
      `<g fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.5">` +
      `<rect x="0" y="${KNOB_RADIUS}" width="${PIECE_SIZE}" height="${PIECE_SIZE}" rx="8"/>` +
      `</g>` +
      `</svg>`

    const toDataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

    return {
      id,
      exp,
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      pieceY: y,
      background: toDataUri(background),
      piece: toDataUri(piece),
    }
  }

  /**
   * 校验拖动结果。挑战无论成败都立刻作废：每个 id 只有一次机会，
   * 爆破只能靠不断拉新挑战，成本被容差与请求量天然抬高。
   * @param {string} id 挑战 id
   * @param {number} answerX 前端换算到视图盒坐标的横向位置
   * @returns {{ ok: true, token: string } | { ok: false, reason: 'invalid' | 'expired' | 'mismatch' }}
   */
  function verify(id, answerX) {
    const now = Date.now()

    // 先取出并作废本次挑战，再清理其余过期的：
    // 顺序反了会让刚过期的挑战在 sweep 里被清掉，永远报不出 expired
    const entry = typeof id === 'string' ? pending.get(id) : undefined
    if (!entry) {
      sweep(now)
      return { ok: false, reason: 'invalid' }
    }
    pending.delete(id)
    sweep(now)

    if (entry.exp <= now) return { ok: false, reason: 'expired' }

    const answer = Number(answerX)
    if (!Number.isFinite(answer) || Math.abs(answer - entry.x) > tolerance) {
      return { ok: false, reason: 'mismatch' }
    }

    const jti = crypto.randomBytes(16).toString('base64url')
    const exp = now + passTtlMs
    passed.set(jti, exp)
    const payload = `${jti}.${exp}`
    return { ok: true, token: `${payload}.${sign(payload)}` }
  }

  /**
   * 消费通过令牌：签名不符、已过期、已用过都返回 false。
   * 在注册这类有副作用的接口里调用，验证通过一次只放行一次。
   * @param {string} token verify 签发的令牌
   */
  function consume(token) {
    const parts = String(token || '').split('.')
    if (parts.length !== 3) return false

    const [jti, exp, signature] = parts
    if (!safeEqual(signature, sign(`${jti}.${exp}`))) return false
    if (Number(exp) <= Date.now()) return false
    // 不存在（伪造或过期清理）与已用（重放）都会 delete 失败
    return passed.delete(jti)
  }

  return { challenge, verify, consume }
}
