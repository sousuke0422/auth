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
})
