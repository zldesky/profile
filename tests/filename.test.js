import { describe, expect, it } from 'vitest'

import { monthStamp, resumeFileName, safeFilePart } from '@/utils/filename'

describe('safeFilePart', () => {
  it('去掉文件名里非法的字符', () => {
    expect(safeFilePart('前端/后端:开发*工程师', 'x')).toBe('前端 后端 开发 工程师')
    expect(safeFilePart('a\\b?c"d<e>f|g', 'x')).toBe('a b c d e f g')
  })

  it('去掉首尾的空白与点（Windows 不允许以点结尾）', () => {
    expect(safeFilePart('  张伟.  ', 'x')).toBe('张伟')
    expect(safeFilePart('...', 'fallback')).toBe('fallback')
  })

  it('折叠连续空白', () => {
    expect(safeFilePart('前端   开发', 'x')).toBe('前端 开发')
  })

  it('为空或全是非法字符时用兜底', () => {
    expect(safeFilePart('', '简历')).toBe('简历')
    expect(safeFilePart('///', '简历')).toBe('简历')
    expect(safeFilePart(null, '简历')).toBe('简历')
    expect(safeFilePart(undefined, '简历')).toBe('简历')
  })

  it('超长时截断，保留可读前缀', () => {
    const long = '张'.repeat(100)
    expect(safeFilePart(long, 'x').length).toBe(40)
    expect(safeFilePart(long, 'x', 10).length).toBe(10)
  })
})

describe('resumeFileName', () => {
  it('姓名 + 岗位', () => {
    expect(resumeFileName({ name: '张伟', jobTitle: '前端开发工程师', extension: 'pdf' })).toBe(
      '张伟_前端开发工程师.pdf',
    )
  })

  it('没有岗位时降级为「姓名」，不补一个没有信息的「简历」', () => {
    expect(resumeFileName({ name: '张伟', extension: 'pdf' })).toBe('张伟.pdf')
    expect(resumeFileName({ name: '张伟', jobTitle: '  ', extension: 'pdf' })).toBe('张伟.pdf')
  })

  it('连姓名都没有时仍返回可用文件名（不能因为没填名字就下载失败）', () => {
    expect(resumeFileName({ extension: 'pdf' })).toBe('简历.pdf')
    expect(resumeFileName({})).toBe('简历')
  })

  it('带后缀时拼在岗位之后', () => {
    expect(
      resumeFileName({ name: '张伟', jobTitle: '前端', suffix: '202610', extension: 'pdf' }),
    ).toBe('张伟_前端_202610.pdf')
  })

  it('没有岗位但有后缀时不会产生连续下划线', () => {
    expect(resumeFileName({ name: '张伟', suffix: '202610', extension: 'txt' })).toBe(
      '张伟_202610.txt',
    )
  })

  it('脏输入被清洗后仍得到合法文件名（这个结果要能直接落到磁盘）', () => {
    const name = resumeFileName({
      name: '张/伟',
      jobTitle: '前端:开发*工程师',
      extension: 'pdf',
    })
    expect(name).toBe('张 伟_前端 开发 工程师.pdf')
    // 关键断言：不含任何非法字符，且不以点/空格结尾
    expect(/[\\/:*?"<>|]/.test(name)).toBe(false)
    expect(name.endsWith('.pdf')).toBe(true)
  })
})

describe('monthStamp', () => {
  it('输出 YYYYMM 并补零', () => {
    expect(monthStamp(new Date('2026-01-05T00:00:00Z'))).toBe('202601')
    expect(monthStamp(new Date('2026-10-24T00:00:00Z'))).toBe('202610')
    expect(monthStamp(new Date('2026-12-31T00:00:00Z'))).toBe('202612')
  })

  it('长度固定为 6（排序即时间序）', () => {
    expect(monthStamp(new Date('2026-03-01T00:00:00Z')).length).toBe(6)
  })
})
