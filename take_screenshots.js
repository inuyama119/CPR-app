import puppeteer from 'puppeteer';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Viewport for mobile
  await page.setViewport({ width: 390, height: 844 });
  
  await page.goto('http://localhost:5173');
  
  // Click Standard
  await page.click('#btn-standard');
  await wait(1500); // Wait for animation
  await page.screenshot({ path: 'standard_evaluation.png', fullPage: true });
  
  // Click Home
  await page.click('button.secondary');
  await wait(500);
  
  // Click Training
  await page.click('#btn-training');
  await wait(1500);
  await page.screenshot({ path: 'training_evaluation.png', fullPage: true });

  await browser.close();
})();
