









import { normalizeMediaPath } from '../../src/utils/mediaPath'

describe('normalizeMediaPath（精确映射）', () => {
  describe('已知媒体前缀归一化', () => {
    test('旧契约 /api/v1/image/ 前缀转为 image/', () => {
      expect(normalizeMediaPath('/api/v1/image/app-images/1-123')).toBe('image/app-images/1-123')
    })

    test('历史形态 /image/ 前缀转为 image/', () => {
      expect(normalizeMediaPath('/image/user-avatars/2-456')).toBe('image/user-avatars/2-456')
    })

    test('新契约 image/ 开头保持不变', () => {
      expect(normalizeMediaPath('image/plugin-images/3-789')).toBe('image/plugin-images/3-789')
    })
  })

  describe('非媒体值原样通过', () => {
    test('外部 http(s) URL 不变', () => {
      expect(normalizeMediaPath('https://cdn.example.test/logo.png')).toBe('https://cdn.example.test/logo.png')
      expect(normalizeMediaPath('http://cdn.example.test/a.jpg')).toBe('http://cdn.example.test/a.jpg')
    })

    test('协议相对 URL 不变', () => {
      expect(normalizeMediaPath('//cdn.example.test/logo.png')).toBe('//cdn.example.test/logo.png')
    })

    test('data URL 不变', () => {
      expect(normalizeMediaPath('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    })

    test('未识别的相对路径不变（只识别已知媒体前缀）', () => {
      expect(normalizeMediaPath('favicon.ico')).toBe('favicon.ico')
      expect(normalizeMediaPath('/static/defaultapp.png')).toBe('/static/defaultapp.png')
    })

    test('前缀不在开头时不转换（精确匹配开头）', () => {
      expect(normalizeMediaPath('foo/api/v1/image/x')).toBe('foo/api/v1/image/x')
      expect(normalizeMediaPath('prefix/image/x')).toBe('prefix/image/x')
    })
  })

  describe('空值与 fallback', () => {
    test('null/undefined/空串无 fallback 时返回空串', () => {
      expect(normalizeMediaPath(null)).toBe('')
      expect(normalizeMediaPath(undefined)).toBe('')
      expect(normalizeMediaPath('')).toBe('')
    })

    test('应用无图 fallback 为 static/defaultapp.png', () => {
      expect(normalizeMediaPath(null, 'static/defaultapp.png')).toBe('static/defaultapp.png')
      expect(normalizeMediaPath(undefined, 'static/defaultapp.png')).toBe('static/defaultapp.png')
      expect(normalizeMediaPath('', 'static/defaultapp.png')).toBe('static/defaultapp.png')
    })

    test('有值时 fallback 不参与', () => {
      expect(normalizeMediaPath('image/a', 'static/defaultapp.png')).toBe('image/a')
      expect(normalizeMediaPath('/api/v1/image/a', 'static/defaultapp.png')).toBe('image/a')
    })
  })
})
