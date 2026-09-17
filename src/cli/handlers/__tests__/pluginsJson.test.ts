import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { runPluginOpJson } from '../plugins'

describe('runPluginOpJson', () => {
  const exitSpy = spyOn(process, 'exit').mockImplementation(
    (() => undefined) as never,
  )
  const outSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
  afterEach(() => {
    exitSpy.mockClear()
    outSpy.mockClear()
  })

  test('success → JSON with ok:true and exit 0', async () => {
    await runPluginOpJson(async () => ({
      success: true,
      message: 'installed',
      pluginId: 'x@m',
      scope: 'user',
    }))
    const line = String(outSpy.mock.calls[0]?.[0])
    expect(JSON.parse(line)).toEqual({
      ok: true,
      message: 'installed',
      pluginId: 'x@m',
      scope: 'user',
    })
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  test('thrown error → ok:false and exit 1', async () => {
    await runPluginOpJson(async () => {
      throw new Error('boom')
    })
    expect(JSON.parse(String(outSpy.mock.calls[0]?.[0]))).toEqual({
      ok: false,
      message: 'boom',
    })
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
