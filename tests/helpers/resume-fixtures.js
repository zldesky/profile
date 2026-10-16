/**
 * 测试用的简历数据构造器。
 *
 * 走 normalizeResume 的输入形态：只给关键字段，缺的由归一化补齐。
 * 默认带一个 text 模块，需要空模块时由调用方自己把 sections 清掉——
 * 刻意不在这里给「完整默认简历」，因为默认简历自带 6 个模块，
 * 用它做断言基准很容易把「按索引取模块」写错。
 */

/** 一份最小可用的简历数据 */
export function makeResume(name = '测试姓名') {
  return {
    version: 2,
    template: 'classic',
    basics: { name, jobTitle: '前端开发工程师' },
    sections: [{ type: 'text', title: '自我评价', visible: true, content: '一段自我评价' }],
  }
}

/** 多份简历，姓名各不相同（多文档相关测试用） */
export function makeResumeNamed(name) {
  return makeResume(name)
}
