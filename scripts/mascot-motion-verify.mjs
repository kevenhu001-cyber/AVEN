import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const source = new URL('../docs/design/prototypes/mascot-motion/', import.meta.url);
const names = ['idle', 'blink', 'curious', 'happy', 'thinking', 'surprise', 'sleepy', 'hello'];
const evidence = await mkdtemp(join(tmpdir(), 'aven-mascot-'));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
let checks = 0;
const verify = (condition, label) => {
  assert.ok(condition, label);
  checks++;
};
try {
  const page = await browser.newPage({ viewport: { width: 728, height: 760 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(new URL('index.html', source).href);
  await expect(page).toHaveTitle('AVEN · 小圆的八种心情');
  await expect(page.locator('#stage-button')).toBeVisible();
  verify((await page.locator('#mascot circle').count()) === 1, 'one circular silhouette');
  verify((await page.locator('#mascot rect').count()) === 2, 'only two capsule eyes');
  for (const state of names) {
    await page.locator(`[data-state="${state}"]`).click();
    await expect(page.locator('#mascot')).toHaveAttribute('data-motion', state);
    await expect(page.locator(`[data-state="${state}"]`)).toHaveAttribute('aria-pressed', 'true');
    verify(
      (await page.locator('[data-state][aria-pressed="true"]').count()) === 1,
      `${state}: one selected expression`,
    );
    verify(
      await page
        .locator('#mascot')
        .evaluate((svg) =>
          svg.getAnimations({ subtree: true }).some((a) => a.playState === 'running'),
        ),
      `${state}: animation is running`,
    );
    const frames = await page.locator('#mascot').evaluate((svg) => {
      const animations = svg.getAnimations({ subtree: true });
      animations.forEach((animation) => animation.pause());
      return [0, 300, 700, 1300, 2300].map((time) => {
        animations.forEach((animation) => {
          animation.currentTime = time;
        });
        const body = svg.querySelector('.body');
        const matrix = body.getScreenCTM();
        return {
          radius: body.r.baseVal.value,
          scaleX: Math.hypot(matrix.a, matrix.b),
          scaleY: Math.hypot(matrix.c, matrix.d),
          skew: matrix.a * matrix.c + matrix.b * matrix.d,
        };
      });
    });
    verify(
      frames.every(
        (frame) =>
          frame.radius === 79 &&
          Math.abs(frame.scaleX - frame.scaleY) < 0.00001 &&
          Math.abs(frame.skew) < 0.00001,
      ),
      `${state}: circle remains circular at five animation times`,
    );
    await page
      .locator('#mascot')
      .evaluate((svg) => svg.getAnimations({ subtree: true }).forEach((a) => a.play()));
    await page.screenshot({ path: join(evidence, `${state}.png`), fullPage: true });
  }
  await page.locator('[data-state="idle"]').click();
  const timeBefore = await page
    .locator('#mascot')
    .evaluate((svg) => svg.getAnimations({ subtree: true })[0].currentTime);
  await page.waitForTimeout(140);
  const timeAfter = await page
    .locator('#mascot')
    .evaluate((svg) => svg.getAnimations({ subtree: true })[0].currentTime);
  verify(timeAfter > timeBefore, 'animation clock really advances');
  await page.locator('#pause').click();
  await expect(page.locator('#mascot')).toHaveAttribute('data-paused', 'true');
  await page
    .locator('#mascot')
    .evaluate((svg) =>
      Promise.all(svg.getAnimations({ subtree: true }).map((animation) => animation.ready)),
    );
  const pausedBefore = await page
    .locator('#mascot')
    .evaluate((svg) => svg.getAnimations({ subtree: true }).map((a) => a.currentTime));
  await page.waitForTimeout(140);
  const pausedAfter = await page
    .locator('#mascot')
    .evaluate((svg) => svg.getAnimations({ subtree: true }).map((a) => a.currentTime));
  verify(
    pausedBefore.every((time, index) => Math.abs(time - pausedAfter[index]) < 1),
    'pause freezes animation frames',
  );
  await page.locator('#pause').click();
  const box = await page.locator('#stage-button').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await expect
    .poll(() =>
      page.locator('#mascot').evaluate((svg) => parseFloat(svg.style.getPropertyValue('--look-x'))),
    )
    .toBeLessThan(0);
  verify(
    await page
      .locator('#mascot')
      .evaluate((svg) => parseFloat(svg.style.getPropertyValue('--look-y')) < 0),
    'gaze follows mouse',
  );
  await page.locator('#follow').uncheck();
  verify(
    await page
      .locator('#mascot')
      .evaluate((svg) => svg.style.getPropertyValue('--look-x') === '0px'),
    'disabling gaze recenters eyes',
  );
  await page.locator('[data-state="idle"]').focus();
  await page.keyboard.press('End');
  await expect(page.locator('[data-state="hello"]')).toBeFocused();
  await expect(page.locator('#mascot')).toHaveAttribute('data-motion', 'hello');
  await page.locator('#stage-button').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#mascot')).toHaveAttribute('data-motion', 'happy');
  checks += 2;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#mascot')).toHaveAttribute('data-reduced', 'true');
  verify(
    await page
      .locator('#mascot')
      .evaluate((svg) => svg.getAnimations({ subtree: true }).length === 0),
    'system reduced motion stops all animations',
  );
  await expect(page.locator('#pause')).toBeDisabled();
  await expect(page.locator('#autoplay')).toBeDisabled();
  await expect(page.locator('#follow')).toBeDisabled();
  await page.locator('[data-state="sleepy"]').click();
  await expect(page.locator('#current-name')).toHaveText('困困了');
  verify(
    await page
      .locator('#mascot .eye')
      .first()
      .evaluate((eye) => getComputedStyle(eye).transform !== 'none'),
    'reduced motion keeps selected expression',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#pause')).toBeEnabled();
  for (const width of [320, 390, 728]) {
    await page.setViewportSize({ width, height: 760 });
    verify(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${width}px: no horizontal overflow`,
    );
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    verify(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${width}px: enlarged text fits`,
    );
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  }
  verify(errors.length === 0, `console errors: ${errors.join(', ')}`);
  const timed = await browser.newPage();
  await timed.clock.install();
  await timed.goto(new URL('index.html', source).href);
  await timed.locator('#autoplay').check();
  await timed.clock.fastForward(5100);
  await expect(timed.locator('#mascot')).toHaveAttribute('data-motion', 'idle');
  await timed.locator('#pause').click();
  await timed.clock.fastForward(10000);
  await expect(timed.locator('#mascot')).toHaveAttribute('data-motion', 'idle');
  await timed.locator('#pause').click();
  await timed.clock.fastForward(5100);
  await expect(timed.locator('#mascot')).toHaveAttribute('data-motion', 'blink');
  checks += 3;
  for (const state of [...names, 'static']) {
    await page.goto(new URL(`aven-${state}.svg`, source).href);
    const shape = await page.locator('circle').evaluate((circle) => ({
      cx: circle.cx.baseVal.value,
      cy: circle.cy.baseVal.value,
      r: circle.r.baseVal.value,
    }));
    verify(
      shape.cx === 100 && shape.cy === 100 && shape.r === 79,
      `${state}: standalone SVG is circular`,
    );
    if (state !== 'static') {
      verify(
        await page
          .locator('svg')
          .evaluate((svg) => svg.getAnimations({ subtree: true }).length > 0),
        `${state}: exported SVG animates without JS`,
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      verify(
        await page
          .locator('svg')
          .evaluate((svg) => svg.getAnimations({ subtree: true }).length === 0),
        `${state}: exported SVG respects reduced motion`,
      );
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
  }
  console.log(
    JSON.stringify({ checks, result: 'passed', expressions: names.length, evidence }, null, 2),
  );
} finally {
  await browser.close();
}
