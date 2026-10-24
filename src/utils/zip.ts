/**
 * 最小 ZIP 打包（纯函数，只做 STORE 模式，不压缩）。
 *
 * 为什么手写而不是引一个库：投递包只需要「把两三个文件装进一个包」。
 * 为此引一个 zip 依赖（连同它的依赖树）不划算 —— 而这个格式的**不压缩**子集
 * 只有几十行，且完全可测。
 *
 * 为什么用 STORE（不压缩）而不是 deflate：
 *  - PDF 本身已经是压缩过的，再 deflate 一次几乎不减小，只增加 CPU 与复杂度；
 *  - 纯文本几百字节，压不压无所谓。
 *  换来的好处是实现里没有 zlib 依赖，浏览器与 Node 里跑的是同一份代码。
 *
 * 格式要点（PKZIP 2.0，无 ZIP64、无加密、无目录项之外的扩展字段）：
 *   每个文件 = 本地文件头 + 数据
 *   最后 = 中央目录 + 中央目录结束记录
 * 所有多字节整数均为小端序。CRC-32 必须有，否则 Windows 解压会报错。
 */

/** 一个待打包的条目 */
export interface ZipEntry {
  /** 包内路径，用 `/` 分隔 */
  name: string
  /** 文件内容 */
  data: Uint8Array
}

/**
 * CRC-32（IEEE 802.3）查表实现。
 * ZIP 的文件头里必须带它，缺了或错了会导致解压失败。
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 把 UTF-8 字符串转成字节；不依赖 TextEncoder 之外的东西 */
export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * DOS 时间/日期（ZIP 头里的格式，1980 年起算）。
 * 用固定时间而不是当前时间：同样的输入产出**逐字节相同**的包，
 * 这让「打包是否稳定」可以被测试断言（否则每次 diff 都不同）。
 */
const DOS_TIME = 0
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1

/** 写一个小端 u32/u16 到数组 */
function pushU16(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff)
}

function pushU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

/**
 * 打包成 ZIP。
 *
 * @param entries 条目列表（顺序即包内顺序）
 * @returns ZIP 文件的字节内容
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const list = Array.isArray(entries) ? entries.filter((e) => e && e.name) : []
  const chunks: number[] = []
  /** 每个条目在中央目录里需要的信息 */
  const central: {
    nameBytes: Uint8Array
    crc: number
    size: number
    offset: number
  }[] = []

  for (const entry of list) {
    const nameBytes = utf8Bytes(entry.name)
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array()
    const crc = crc32(data)
    const offset = chunks.length

    // ---- 本地文件头 ----
    pushU32(chunks, 0x04034b50) // 签名
    pushU16(chunks, 20) // 需要版本 2.0
    pushU16(chunks, 0x0800) // 通用标志：文件名为 UTF-8（bit 11）
    pushU16(chunks, 0) // 压缩方式：0 = STORE
    pushU16(chunks, DOS_TIME)
    pushU16(chunks, DOS_DATE)
    pushU32(chunks, crc)
    pushU32(chunks, data.length) // 压缩后大小（STORE 时等于原始大小）
    pushU32(chunks, data.length) // 原始大小
    pushU16(chunks, nameBytes.length)
    pushU16(chunks, 0) // 扩展字段长度
    for (const byte of nameBytes) chunks.push(byte)
    for (const byte of data) chunks.push(byte)

    central.push({ nameBytes, crc, size: data.length, offset })
  }

  // ---- 中央目录 ----
  const centralStart = chunks.length
  for (const item of central) {
    pushU32(chunks, 0x02014b50)
    pushU16(chunks, 20) // 创建者版本
    pushU16(chunks, 20) // 需要版本
    pushU16(chunks, 0x0800) // 同样标记 UTF-8
    pushU16(chunks, 0) // STORE
    pushU16(chunks, DOS_TIME)
    pushU16(chunks, DOS_DATE)
    pushU32(chunks, item.crc)
    pushU32(chunks, item.size)
    pushU32(chunks, item.size)
    pushU16(chunks, item.nameBytes.length)
    pushU16(chunks, 0) // 扩展字段
    pushU16(chunks, 0) // 注释
    pushU16(chunks, 0) // 起始磁盘号
    pushU16(chunks, 0) // 内部属性
    pushU32(chunks, 0) // 外部属性
    pushU32(chunks, item.offset)
    for (const byte of item.nameBytes) chunks.push(byte)
  }

  // ---- 中央目录结束记录 ----
  const centralSize = chunks.length - centralStart
  pushU32(chunks, 0x06054b50)
  pushU16(chunks, 0) // 当前磁盘号
  pushU16(chunks, 0) // 中央目录起始磁盘号
  pushU16(chunks, central.length) // 本盘条目数
  pushU16(chunks, central.length) // 总条目数
  pushU32(chunks, centralSize)
  pushU32(chunks, centralStart)
  pushU16(chunks, 0) // 注释长度

  return new Uint8Array(chunks)
}

/**
 * 把字节内容包成浏览器可下载的 Blob。
 *
 * 这里显式 `new Uint8Array(...)` 复制一份再交给 Blob：
 * TS 5.9 起 `Uint8Array` 的泛型参数是 `ArrayBufferLike`，而 `BlobPart` 要求
 * `ArrayBuffer`（不含 SharedArrayBuffer）。直接传会报
 * 「Uint8Array<ArrayBufferLike> 不能赋给 BlobPart」。
 * 复制一次既消掉了类型问题，也保证 Blob 之后不会被调用方就地改动。
 */
export function zipBlob(entries: ZipEntry[]): Blob {
  const bytes = buildZip(entries)
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return new Blob([copy], { type: 'application/zip' })
}
