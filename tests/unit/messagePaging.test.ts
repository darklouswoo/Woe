












import {
  parseMessagePaging,
  isValidMessagePaging,
  type MessagePagingResult
} from '../../src/utils/messagePaging';


function parse(query: string): MessagePagingResult {
  return parseMessagePaging(new URLSearchParams(query));
}

function expectOk(query: string, limit: number, since: number) {
  const result = parse(query);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual({ limit, since });
  }
}

const LIMIT_ERROR_BODY = {
  error: 'Bad Request',
  errorCode: 400,
  errorDescription: 'Invalid limit parameter: must be an integer between 1 and 200'
};

const SINCE_ERROR_BODY = {
  error: 'Bad Request',
  errorCode: 400,
  errorDescription: 'Invalid since parameter: must be a non-negative integer'
};

async function expectLimitError(query: string) {
  const result = parse(query);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toEqual(LIMIT_ERROR_BODY);
  }
}

async function expectSinceError(query: string) {
  const result = parse(query);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toEqual(SINCE_ERROR_BODY);
  }
}

describe('parseMessagePaging（严格解析）', () => {
  describe('缺省与空串', () => {
    test('全部省略 => limit 100 / since 0', () => {
      expectOk('', 100, 0);
    });

    test('limit 省略 => 100；since 省略 => 0', () => {
      expectOk('since=42', 100, 42);
      expectOk('limit=7', 7, 0);
    });

    test('since 空串按 0', () => {
      expectOk('since=', 100, 0);
    });

    test('limit 空串显式非法（与 since 空串语义不同）', async () => {
      await expectLimitError('limit=');
    });
  });

  describe('合法值', () => {
    test('limit=1/100/200、since=0/42 => 合法', () => {
      expectOk('limit=1', 1, 0);
      expectOk('limit=100', 100, 0);
      expectOk('limit=200', 200, 0);
      expectOk('since=0', 100, 0);
      expectOk('since=42', 100, 42);
      expectOk('limit=1&since=0', 1, 0);
      expectOk('limit=200&since=42', 200, 42);
    });

    test('limit 允许编码正号与前导零（%2B2 / 002 / %2B200）', () => {
      expectOk('limit=%2B2', 2, 0);
      expectOk('limit=002', 2, 0);
      expectOk('limit=%2B200', 200, 0);
      expectOk('limit=0001', 1, 0);
    });

    test('since 只允许无符号数字与前导零（002 / 000 => 2 / 0；%2B42 拒绝）', () => {
      expectOk('since=002', 100, 2);
      expectOk('since=000', 100, 0);
      expectOk('since=007', 100, 7);
    });

    test('since=Number.MAX_SAFE_INTEGER 合法（JS 安全整数上限）', () => {
      expectOk('since=9007199254740991', 100, Number.MAX_SAFE_INTEGER);
    });
  });

  describe('非法 limit => 400（完整十进制解析，无 clamp 纠正）', () => {
    test.each([
      ['limit=abc'],
      ['limit=1.5'],
      ['limit=10abc'],
      ['limit=1e2'],
      ['limit=0'],
      ['limit=-1'],
      ['limit=201'],
      ['limit=%2B201'],

      ['limit=9007199254740993'],

      ['limit=999999999999999999999999999999']
    ])('%s => 400', async (query) => {
      await expectLimitError(query);
    });

    test('空白不 trim：编码空格（%205）与字面 + 解码出的空格均拒绝', async () => {
      await expectLimitError('limit=%205');
      await expectLimitError('limit=5%20');

      await expectLimitError('limit=+5');
    });
  });

  describe('非法 since => 400', () => {
    test.each([
      ['since=abc'],
      ['since=-1'],
      ['since=1.5'],
      ['since=10abc'],

      ['since=9007199254740992'],

      ['since=999999999999999999999999999999']
    ])('%s => 400', async (query) => {
      await expectSinceError(query);
    });

    test('since 不允许任何符号（%2B42 拒绝）与空白（%2042 / 42%20 拒绝）', async () => {
      await expectSinceError('since=%2B42');
      await expectSinceError('since=%2042');
      await expectSinceError('since=42%20');
    });
  });

  describe('重复参数 => 使用首值', () => {
    test('首值合法 => 采用首值，后值不参与', () => {
      expectOk('limit=5&limit=abc', 5, 0);
      expectOk('limit=5&limit=999', 5, 0);
      expectOk('since=42&since=abc', 100, 42);
      expectOk('since=42&since=1', 100, 42);
    });

    test('首值非法 => 400，不能用后值覆盖拯救', async () => {
      await expectLimitError('limit=abc&limit=5');
      await expectLimitError('limit=&limit=5');
      await expectSinceError('since=abc&since=42');
    });
  });

  test('limit 与 since 同时非法 => 先报 limit 错误', async () => {
    await expectLimitError('limit=abc&since=abc');
  });
});

describe('isValidMessagePaging（handler 纵深防御）', () => {
  test('合法数值 => true', () => {
    expect(isValidMessagePaging(100, 0)).toBe(true);
    expect(isValidMessagePaging(1, 0)).toBe(true);
    expect(isValidMessagePaging(200, 42)).toBe(true);
    expect(isValidMessagePaging(100, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  test.each([
    ['NaN limit', Number.NaN, 0],
    ['NaN since', 100, Number.NaN],
    ['limit 0', 0, 0],
    ['limit 201', 201, 0],
    ['limit 1.5', 1.5, 0],
    ['limit Infinity', Number.POSITIVE_INFINITY, 0],
    ['since -1', 100, -1],
    ['since 1.5', 100, 1.5],
    ['since 超安全整数', 100, Number.MAX_SAFE_INTEGER + 1],
    ['since Infinity', 100, Number.POSITIVE_INFINITY]
  ])('%s => false', (_label, limit, since) => {
    expect(isValidMessagePaging(limit, since)).toBe(false);
  });
});
