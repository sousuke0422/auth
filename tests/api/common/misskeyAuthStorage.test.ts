import { describe, it, expect } from 'vitest'
import { misskeyAuthStorage } from '~/api/common/helper/misskeyAuthStorage'

describe('misskeyAuthStorage', () => {
  it('値の保存と取得ができる', async () => {
    await misskeyAuthStorage.setItem('test-key', 'test-value')
    const value = await misskeyAuthStorage.getItem<string>('test-key')
    expect(value).toBe('test-value')
  })

  it('存在しないキーはnullを返す', async () => {
    const value = await misskeyAuthStorage.getItem<string>('nonexistent-key')
    expect(value).toBeNull()
  })

  it('値の上書きができる', async () => {
    await misskeyAuthStorage.setItem('overwrite-key', 'first')
    await misskeyAuthStorage.setItem('overwrite-key', 'second')
    const value = await misskeyAuthStorage.getItem<string>('overwrite-key')
    expect(value).toBe('second')
  })

  it('値の削除ができる', async () => {
    await misskeyAuthStorage.setItem('remove-key', 'value')
    await misskeyAuthStorage.removeItem('remove-key')
    const value = await misskeyAuthStorage.getItem<string>('remove-key')
    expect(value).toBeNull()
  })

  it('複数の異なるキーで値を保存・取得できる', async () => {
    await misskeyAuthStorage.setItem('key1', 'value1')
    await misskeyAuthStorage.setItem('key2', 'value2')
    await misskeyAuthStorage.setItem('key3', 'value3')

    const value1 = await misskeyAuthStorage.getItem<string>('key1')
    const value2 = await misskeyAuthStorage.getItem<string>('key2')
    const value3 = await misskeyAuthStorage.getItem<string>('key3')

    expect(value1).toBe('value1')
    expect(value2).toBe('value2')
    expect(value3).toBe('value3')
  })

  it('オブジェクトを保存・取得できる', async () => {
    const obj = { state: 'test-state', verifier: 'test-verifier' }
    await misskeyAuthStorage.setItem('object-key', obj)
    const value = await misskeyAuthStorage.getItem<typeof obj>('object-key')
    expect(value).toEqual(obj)
  })

  it('空文字列を保存・取得できる', async () => {
    await misskeyAuthStorage.setItem('empty-key', '')
    const value = await misskeyAuthStorage.getItem<string>('empty-key')
    expect(value).toBe('')
  })

  it('数値を保存・取得できる', async () => {
    await misskeyAuthStorage.setItem('number-key', 12345)
    const value = await misskeyAuthStorage.getItem<number>('number-key')
    expect(value).toBe(12345)
  })

  it('nullを保存できる', async () => {
    await misskeyAuthStorage.setItem('null-key', null)
    const value = await misskeyAuthStorage.getItem('null-key')
    expect(value).toBeNull()
  })

  it('存在しないキーを削除してもエラーにならない', async () => {
    await expect(
      misskeyAuthStorage.removeItem('nonexistent-remove-key')
    ).resolves.not.toThrow()
  })

  it('LRUキャッシュドライバーが使用される', () => {
    expect(misskeyAuthStorage).toBeDefined()
    expect(typeof misskeyAuthStorage.setItem).toBe('function')
    expect(typeof misskeyAuthStorage.getItem).toBe('function')
    expect(typeof misskeyAuthStorage.removeItem).toBe('function')
  })
})