import { test, expect } from '@playwright/test'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket.
    await page.goto('/home')
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
  })

  test('every circle action refuses an anonymous caller', async ({ request }) => {
    for (const name of ['createCircle', 'joinCircle', 'addPaper', 'addNote', 'removePaper', 'previewDigest']) {
      const res = await request.post(`/api/actions/${name}`, { data: {} })
      expect(res.status(), name).toBe(401)
    }
  })

  test('unknown actions and prototype keys are not callable', async ({ request }) => {
    const res = await request.post('/api/actions/constructor', {
      headers: { Authorization: 'Bearer not-a-jwt' },
      data: {},
    })
    expect(res.status()).toBe(401)
  })

  test('presence rooms only exist for papers and require sign-in', async ({ request }) => {
    expect((await request.get('/ws/presence/canvas:anything')).status()).toBe(404)
    expect((await request.get('/ws/presence/paper:some-paper')).status()).toBe(401)
    expect((await request.get('/ws/presence/paper:some-paper?token=forged')).status()).toBe(401)
  })
})
