import {expect,test} from '@playwright/test';
test('usable document',async({page})=>{await page.goto('/');await expect(page.locator('body')).toBeVisible();});
