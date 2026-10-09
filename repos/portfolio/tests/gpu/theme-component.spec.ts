import { expect, test } from '@playwright/test'
import { LOOKS } from '../../app/journey/stops'

test.beforeEach(async ({ page }) => { await page.goto('/tests/gpu/harness.html') })
test.afterEach(async ({ page }) => {
  await page.evaluate(() => { window.cityGpu.unmountComponent(); document.documentElement.classList.remove('dark') })
})
for (const dark of [false, true]) {
  test(`DOM ${dark ? 'dark' : 'light'} wins over stale initial props`, async ({ page }) => {
    await page.evaluate(dark => {
      document.documentElement.classList.toggle('dark', dark)
      return window.cityGpu.mountComponent({ failure: 'none', chapter: 0, initialDark: !dark })
    }, dark)
    await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(true)
    const first = await page.evaluate(() => window.cityGpu.componentThemeStatus())
    expect(first.calls).toEqual([{ isDark: dark, animate: false }])
    const expected = LOOKS[dark ? 'dark' : 'light'].intro.skyColor
    expected.forEach((v, i) => expect(first.sky![i]).toBeCloseTo(v, 4))
    await page.evaluate(dark => window.cityGpu.setComponentDark(dark), dark)
    // Allow real RAF updates after the plugin-equivalent prop synchronization.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const synced = await page.evaluate(() => window.cityGpu.componentThemeStatus())
    expect(synced.calls).toEqual([{ isDark: dark, animate: false }, { isDark: dark, animate: undefined }])
    expected.forEach((v, i) => expect(synced.sky![i]).toBeCloseTo(v, 4))
    expect(await page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(0)
  })
}
test('a later actual toggle animates at the current chapter', async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    return window.cityGpu.mountComponent({ failure: 'none', chapter: 0, initialDark: false })
  })
  await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(true)
  const before = await page.evaluate(() => window.cityGpu.componentThemeStatus())
  await page.evaluate(() => { document.documentElement.classList.add('dark'); return window.cityGpu.setComponentDark(true) })
  const justToggled = await page.evaluate(() => window.cityGpu.componentThemeStatus())
  expect(justToggled.calls.at(-1)).toEqual({ isDark: true, animate: undefined })
  const distance = (a: number[], b: readonly number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0)
  expect(distance(justToggled.sky!, before.sky!)).toBeLessThan(.1)
  await expect.poll(async () => {
    const status = await page.evaluate(() => window.cityGpu.componentThemeStatus())
    return distance(status.sky!, LOOKS.dark.intro.skyColor)
  }, { timeout: 30000 }).toBeLessThan(.01)
})
