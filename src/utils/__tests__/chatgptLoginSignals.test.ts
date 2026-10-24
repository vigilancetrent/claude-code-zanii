import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  handleMainSigint,
  isChatGPTLoginActive,
  setChatGPTLoginActive,
} from '../chatgptLoginSignals.js'

const originalArgv = process.argv
const listeners: Array<() => void> = []
let exit: ReturnType<typeof spyOn>

function register(listener: () => void): void {
  listeners.push(listener)
  process.on('SIGINT', listener)
}

beforeEach(() => {
  process.argv = [process.execPath, 'synthetic-cli']
  setChatGPTLoginActive(false)
  exit = spyOn(process, 'exit').mockImplementation(() => undefined as never)
})
afterEach(() => {
  for (const listener of listeners.splice(0))
    process.removeListener('SIGINT', listener)
  setChatGPTLoginActive(false)
  process.argv = originalArgv
  exit.mockRestore()
})

describe('main SIGINT dispatch during ChatGPT login', () => {
  test('an earlier real main dispatcher yields to the later login cancellation listener', () => {
    let cancellations = 0
    register(handleMainSigint)
    register(() => {
      cancellations++
    })
    setChatGPTLoginActive(true)

    process.emit('SIGINT')

    expect(isChatGPTLoginActive()).toBe(true)
    expect(cancellations).toBe(1)
    expect(exit).not.toHaveBeenCalled()
  })

  test('retains the normal exit after login releases ownership', () => {
    setChatGPTLoginActive(true)
    setChatGPTLoginActive(false)
    register(handleMainSigint)

    process.emit('SIGINT')

    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  test.each([
    '-p',
    '--print',
  ])('still leaves %s cancellation to print mode', flag => {
    process.argv.push(flag)
    register(handleMainSigint)

    process.emit('SIGINT')

    expect(exit).not.toHaveBeenCalled()
  })
})
