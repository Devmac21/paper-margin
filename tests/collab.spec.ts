/**
 * Multi-user specs for reading circles. Each test drives real signed-in
 * browser contexts against the dev worker; nothing in the app is mocked.
 *
 * Needs usable test accounts in the local pool:
 *   npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin
 *
 * The last test adds a real arXiv paper, which runs the digest job and spends
 * one small model call from the app owner's credits. Set PM_SKIP_AI=1 to skip it.
 */
import { test, expect, loadAllTestAccounts, type MultiplayerUser } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 3,
  `Needs 3 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin`.',
)

const stamp = () => `__test-${Date.now()}__`

async function createCircle(user: MultiplayerUser, name: string): Promise<{ url: string; invite: string }> {
  await user.page.goto('/home')
  await user.page.getByLabel('Circle name').fill(name)
  await user.page.getByRole('button', { name: 'Create circle' }).click()
  await expect(user.page.getByTestId('circle-name')).toHaveText(name, { timeout: 15_000 })
  const invite = await user.page.getByRole('textbox', { name: 'Invite link' }).inputValue()
  return { url: user.page.url(), invite }
}

async function joinCircle(user: MultiplayerUser, invite: string, name: string) {
  await user.page.goto(new URL(invite).pathname)
  await expect(user.page.getByTestId('invite-circle-name')).toHaveText(name, { timeout: 15_000 })
  await user.page.getByRole('button', { name: 'Join circle' }).click()
  await expect(user.page.getByTestId('circle-name')).toHaveText(name, { timeout: 15_000 })
}

async function deleteCircle(owner: MultiplayerUser, url: string) {
  await owner.page.goto(url)
  await owner.page.getByRole('button', { name: 'Delete circle' }).click()
  await owner.page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(owner.page).toHaveURL(/\/home$/)
}

test('a circle is private until you join with the invite link', async ({ users }) => {
  const [owner, friend, outsider] = await users(3)
  const name = `${stamp()} Private circle`
  const circle = await createCircle(owner, name)
  try {
    // An outsider who guesses the URL gets nothing: the DO never sends the rows.
    await outsider.page.goto(new URL(circle.url).pathname)
    await expect(outsider.page.getByText('Circle not found')).toBeVisible({ timeout: 15_000 })

    await joinCircle(friend, circle.invite, name)

    // The owner's member list updates live, without a reload.
    await expect(owner.page.getByTestId('member-list').locator('li')).toHaveCount(2, { timeout: 15_000 })

    // The outsider still cannot see it.
    await outsider.page.reload()
    await expect(outsider.page.getByText('Circle not found')).toBeVisible({ timeout: 15_000 })
  } finally {
    await deleteCircle(owner, circle.url)
  }
})

test('a member can opt out of the digest and leave the circle', async ({ users }) => {
  const [owner, friend] = await users(2)
  const name = `${stamp()} Digest circle`
  const circle = await createCircle(owner, name)
  try {
    await joinCircle(friend, circle.invite, name)
    const toggle = friend.page.getByRole('switch', { name: 'Weekly digest email' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    // Stored booleans come back as 0/1; the opt-out must survive a reload.
    await friend.page.reload()
    await expect(friend.page.getByRole('switch', { name: 'Weekly digest email' })).toHaveAttribute(
      'aria-checked',
      'false',
      { timeout: 15_000 },
    )

    await friend.page.getByRole('button', { name: 'Leave circle' }).click()
    await friend.page.getByRole('button', { name: 'Leave', exact: true }).click()
    await expect(friend.page).toHaveURL(/\/home$/)
    await friend.page.goto(new URL(circle.url).pathname)
    await expect(friend.page.getByText('Circle not found')).toBeVisible({ timeout: 15_000 })
    await expect(owner.page.getByTestId('member-list').locator('li')).toHaveCount(1, { timeout: 15_000 })
  } finally {
    await deleteCircle(owner, circle.url)
  }
})

test('invalid invite links are refused', async ({ users }) => {
  const [user] = await users(1)
  await user.page.goto('/join/zzzzzzzzzz')
  await expect(user.page.getByText('This invite link is not valid.')).toBeVisible({ timeout: 15_000 })
})

test('margin notes and presence sync between readers', async ({ users }) => {
  test.skip(process.env.PM_SKIP_AI === '1', 'PM_SKIP_AI=1 skips the paper digest (spends a model call)')
  test.setTimeout(240_000)
  const [owner, friend] = await users(2)
  const name = `${stamp()} Notes circle`
  const circle = await createCircle(owner, name)
  try {
    await joinCircle(friend, circle.invite, name)

    await owner.page.getByLabel('arXiv link or id').fill('https://arxiv.org/abs/1706.03762')
    await owner.page.getByRole('button', { name: 'Add paper' }).click()

    // Both readers watch the same job progress through their record subscription.
    const ready = (u: MultiplayerUser) =>
      expect(u.page.locator('[data-testid="paper-list"] li[data-status="ready"]')).toHaveCount(1, { timeout: 180_000 })
    await Promise.all([ready(owner), ready(friend)])

    await owner.page.getByRole('link', { name: 'Attention Is All You Need' }).click()
    await friend.page.getByRole('link', { name: 'Attention Is All You Need' }).click()
    await expect(owner.page.getByTestId('reading-guide')).toBeVisible()
    await expect(friend.page.getByTestId('reading-guide')).toBeVisible()

    // Presence: each reader sees the other in the header.
    await expect(owner.page.getByTestId('readers-summary')).toBeVisible({ timeout: 20_000 })

    // Typing indicator, then the note itself, arrive live for the other reader.
    const body = `${stamp()} Does the method section explain the scaling factor?`
    await owner.page.getByTestId('notes-button-method').click()
    await friend.page.getByTestId('notes-button-method').click()
    await owner.page.getByTestId('note-input').pressSequentially('Does the', { delay: 40 })
    await expect(friend.page.getByTestId('typing-indicator')).toContainText('is writing', { timeout: 10_000 })
    await owner.page.getByTestId('note-input').fill(body)
    await owner.page.getByRole('button', { name: 'Post note' }).click()
    await expect(friend.page.getByTestId('margin-panel').getByText(body)).toBeVisible({ timeout: 15_000 })

    // Replies thread under the note on both sides.
    const reply = `${stamp()} It is 1/sqrt(d_k).`
    await friend.page.getByTestId('note-thread').first().getByRole('button', { name: 'Reply' }).click()
    await friend.page.getByTestId('reply-input').fill(reply)
    await friend.page.getByRole('button', { name: 'Reply', exact: true }).last().click()
    await expect(owner.page.getByTestId('margin-panel').getByText(reply)).toBeVisible({ timeout: 15_000 })

    // Only the author gets edit controls.
    await expect(friend.page.getByTestId('note').first().getByRole('button', { name: 'Edit' })).toHaveCount(0)
  } finally {
    await deleteCircle(owner, circle.url)
  }
})
