import { expect, test, type Page } from '@playwright/test';
import { serializeArchiveBackup } from '../src/archiveBackup';
import { PUBLIC_DEMO_ARCHIVES } from '../src/demoArchives';

async function expandDemoArchiveRoute(page: Page) {
  const panel = page.locator('.archive-index-panel');
  for (const label of ['亚洲', '印度尼西亚', '东爪哇省', '帕雷（Mojokuto）']) {
    const summary = panel.locator('summary').filter({ hasText: label }).first();
    const details = summary.locator('..');
    if (await details.getAttribute('open') === null) await summary.click();
  }
}

test('loads the globe shell and opens the archive index', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('民族志数据档案', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开地点档案' }).click();
  await expect(page.getByRole('heading', { name: '地点档案' })).toBeVisible();
  await expandDemoArchiveRoute(page);
  await expect(page.locator('.archive-index-panel').getByRole('button', { name: /The Religion of Java/ })).toBeVisible();
  await expect(page.getByText('当前仅展示随网站发布的只读演示档案')).toBeVisible();
  await expect(page.getByRole('button', { name: '导出私人档案' })).toBeDisabled();
});

test('switches map views and opens the temporal and research tools', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/');
  await page.getByRole('button', { name: '平面' }).click();
  await expect(page.getByRole('button', { name: '平面' })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter(message => /WebGL scene failed|Cannot read properties of null/.test(message))).toEqual([]);
  await expect(page.getByText('无法启动 3D 地球')).toBeHidden();
  await page.getByRole('button', { name: '地球' }).click();
  await expect(page.getByRole('button', { name: '地球' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '平面' }).click();
  await expect(page.getByText('无法启动 3D 地球')).toBeHidden();
  await page.getByRole('button', { name: '时间图谱' }).click();
  await expect(page.locator('.time-atlas').getByText('时间图谱', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '自动播放' })).toBeVisible();
  await expect(page.getByRole('button', { name: '作品首次出版' })).toBeVisible();
  await expect(page.getByRole('button', { name: '中文译本' })).toBeVisible();
  await page.getByRole('button', { name: '显示全部年代' }).click();
  await page.getByRole('button', { name: '研究网络', exact: true }).click();
  await expect(page.locator('.research-network-panel').getByText('研究网络', { exact: true })).toBeVisible();
  await expect(page.getByText('Clifford Geertz', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '研究网络', exact: true }).click();
  await page.getByRole('button', { name: '主题图层' }).click();
  await expect(page.locator('.theme-layer-panel').getByText('主题图层', { exact: true })).toBeVisible();
  await expect(page.locator('.theme-layer-panel').getByText('宗教', { exact: true })).toBeVisible();
});

test('imports, exports and clears private archives without removing the public demo', async ({ page }) => {
  const privateArchive = structuredClone(PUBLIC_DEMO_ARCHIVES[0]);
  privateArchive.id = 'e2e-private-archive';
  privateArchive.ownerId = 'local-demo-user';
  privateArchive.title = 'E2E 私人档案';
  privateArchive.editions = privateArchive.editions?.map(edition => ({ ...edition, title: 'E2E 私人档案' }));
  const backup = serializeArchiveBackup([privateArchive]);

  await page.goto('/');
  await page.getByRole('button', { name: '打开地点档案' }).click();
  await page.locator('label', { hasText: '导入并合并' }).locator('input').setInputFiles({
    name: 'ethnographic-archives.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup)
  });
  await expect(page.getByText('本机保存了 1 份私人档案')).toBeVisible();
  await expandDemoArchiveRoute(page);
  await expect(page.getByText('E2E 私人档案', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出私人档案' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^ethnographic-archives-\d{4}-\d{2}-\d{2}\.json$/);

  page.on('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: '清空私人档案' }).click();
  await expect(page.locator('.archive-index-panel')).not.toHaveClass(/is-open/);
  await page.getByRole('button', { name: '打开地点档案' }).click();
  await expect(page.getByText('当前仅展示随网站发布的只读演示档案')).toBeVisible();
  await expandDemoArchiveRoute(page);
  await expect(page.locator('.archive-index-panel').getByRole('button', { name: /The Religion of Java/ })).toBeVisible();
});
