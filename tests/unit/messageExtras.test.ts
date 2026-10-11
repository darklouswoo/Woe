











import { parseMessageExtras } from '../../src/utils/messageExtras'

describe('parseMessageExtras（消息专用 extras 读取归一化）', () => {
  describe('合法顶层对象：原样返回', () => {
    test.each([
      ['普通对象', '{"client::display":"dense"}', { 'client::display': 'dense' }],
      [
        '嵌套对象与数组保留',
        '{"nested":{"list":[1,2,3],"deep":{"flags":[true,null]}}}',
        { nested: { list: [1, 2, 3], deep: { flags: [true, null] } } },
      ],
      ['合法空对象 {} 保留', '{}', {}],
      ['对象内空数组/空对象保留', '{"empty_arr":[],"empty_obj":{}}', { empty_arr: [], empty_obj: {} }],
      ['前后空白不阻断合法 JSON', '  {"padded":1}  ', { padded: 1 }],
    ])('%s', (_label, raw, expected) => {
      expect(parseMessageExtras(raw)).toEqual(expected)
    })

    test('内部数组保持数组类型（不被展平/复制丢失）', () => {
      const parsed = parseMessageExtras('{"list":[1,2,3]}')
      expect(Array.isArray(parsed!.list)).toBe(true)
      expect(parsed!.list).toHaveLength(3)
    })

    test('每次调用独立解析：两次结果相等但不是同一引用', () => {
      const first = parseMessageExtras('{"a":[1]}')
      const second = parseMessageExtras('{"a":[1]}')
      expect(first).toEqual(second)
      expect(first).not.toBe(second)
    })
  })

  describe('省略为 undefined：缺省/空值/JSON null/畸形/顶层非对象', () => {
    test.each([
      ['undefined 输入', undefined],
      ['null 输入', null],
      ['空字符串', ''],
      ['纯空白（空格/制表/换行）', ' \t\n '],
      ['JSON null 字面量', 'null'],
      ['畸形 JSON（未闭合）', 'not-json{'],
      ['畸形 JSON（截断对象）', '{"unterminated":'],
      ['顶层数组', '[1,2,3]'],
      ['顶层字符串', '"plain-string"'],
      ['顶层数值（整数）', '42'],
      ['顶层数值（负小数）', '-3.5'],
      ['顶层 boolean true', 'true'],
      ['顶层 boolean false', 'false'],
    ])('%s => undefined', (_label, raw) => {
      expect(parseMessageExtras(raw)).toBeUndefined()
    })

    test('防御非字符串输入（历史调用方传入意外类型）=> undefined', () => {
      expect(parseMessageExtras(123 as unknown as string)).toBeUndefined()
      expect(parseMessageExtras([] as unknown as string)).toBeUndefined()
      expect(parseMessageExtras({} as unknown as string)).toBeUndefined()
    })
  })
})
