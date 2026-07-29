import { expect, test } from '@playwright/test';

test('loads the globe shell and opens the archive index', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('民族志数据档案', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开地点档案' }).click();
  await expect(page.getByRole('heading', { name: '地点档案' })).toBeVisible();
  await expect(page.getByText('还没有民族志档案')).toBeVisible();
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
  await expect(page.getByText('尚无可构建研究网络的田野资料')).toBeVisible();
  await page.getByRole('button', { name: '研究网络', exact: true }).click();
  await page.getByRole('button', { name: '主题图层' }).click();
  await expect(page.locator('.theme-layer-panel').getByText('主题图层', { exact: true })).toBeVisible();
});
